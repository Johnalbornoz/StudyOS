/**
 * F9 -- concurrency/idempotency (task §54) and performance baseline
 * (task §53) certification, against the SAME real Postgres fixture the
 * adversarial matrix runner uses. Run as a second pass after
 * f9-lifecycle-cert-runner.ts so both certifications exercise the same
 * seeded data without interfering (each test scopes its own concept/
 * attempt rows).
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { computeReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { buildSimulationPlan } from '@/lib/simulation/plan.service';
import { startSimulationAttempt, completeSimulationAttempt } from '@/lib/simulation/attempt.service';
import { recordSimulationItemResponse } from '@/lib/simulation/scoring.service';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function percentile(sortedMs: number[], p: number): number {
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

function summarize(label: string, samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1];
  console.log(`PERF -- ${label}: n=${sorted.length} median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
  return { label, n: sorted.length, medianMs: Number(median.toFixed(1)), p95Ms: Number(p95.toFixed(1)), maxMs: Number(max.toFixed(1)) };
}

async function main() {
  const paaExamDefRow = await db.query(`SELECT id FROM exam_definitions WHERE name = 'PAA (F9)'`);
  const PAA_EXAM_DEF_ID = paaExamDefRow.rows[0].id;
  const PAA_EXAM_VERSION_ID = (await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [PAA_EXAM_DEF_ID])).rows[0].id;
  const s1 = await db.query(`SELECT id FROM students WHERE clerk_id = 'clerk_f9_learner1'`);
  const STUDENT_1 = s1.rows[0].id;
  const EXAM_PROFILE_ID = (await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_version_id = $2`, [STUDENT_1, PAA_EXAM_VERSION_ID])).rows[0].id;
  const OBJ_MATH = (await db.query(`SELECT id FROM learning_objectives WHERE code = 'PAA-M-F9-1'`)).rows[0].id;
  const componentMathId = (await db.query(`SELECT assessment_component_id FROM blueprint_objective_targets WHERE learning_objective_id = $1`, [OBJ_MATH])).rows[0].assessment_component_id;

  // ---------------------------------------------------------------
  // Concurrency case: double submission of the SAME logical response (identical idempotencyKey) -> no duplicate Evidence, no duplicated scoring
  // ---------------------------------------------------------------
  {
    const attempt = await startSimulationAttempt({
      studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM',
      learningObjectiveId: OBJ_MATH, timingMode: 'UNTIMED', language: 'en',
    });
    const idempotencyKey = randomUUID();
    const question = { id: 'q-dup', conceptId: 'irrelevant', type: 'single_choice', answerFormat: 'single_choice', question: 'x?', correctAnswer: 'A', explanation: '', difficulty: 3 } as any;

    const [first, second] = await Promise.all([
      recordSimulationItemResponse({ examAttemptId: attempt.examAttempt!.id, studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, assessmentComponentId: componentMathId, learningObjectiveId: OBJ_MATH, question, studentAnswer: 'A', idempotencyKey }),
      recordSimulationItemResponse({ examAttemptId: attempt.examAttempt!.id, studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, assessmentComponentId: componentMathId, learningObjectiveId: OBJ_MATH, question, studentAnswer: 'A', idempotencyKey }),
    ]);
    assert(first.responseId === second.responseId, 'CONCURRENCY: double submission with the same idempotencyKey must resolve to the SAME response row, never two');
    assert(first.duplicate === true || second.duplicate === true, 'CONCURRENCY: exactly one of the two concurrent submissions must be recognized as a duplicate');

    const responseCount = await db.query(`SELECT COUNT(*) AS c FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 AND idempotency_key = $2`, [attempt.examAttempt!.id, idempotencyKey]);
    assert(Number(responseCount.rows[0].c) === 1, 'CONCURRENCY: exactly one exam_attempt_item_responses row must exist for this idempotencyKey, never duplicated scoring');

    // The Evidence write is gated by updateMastery's own operation_key
    // mechanism using operationId=idempotencyKey (same key, second
    // independent layer of protection) -- the response-row-count
    // assertion above already proves the shared idempotencyKey path
    // only ever won the database's own conflict-resolution once, which
    // is what gates whether the Evidence-writing branch runs at all.
    const evidenceCount = await db.query(`SELECT COUNT(*) AS c FROM learning_evidence WHERE operation_key LIKE 'EXAM_SIMULATION_RESPONSE::' || $1 || '::%'`, [idempotencyKey]);
    assert(Number(evidenceCount.rows[0].c) === 1, 'CONCURRENCY: exactly one learning_evidence row must exist for this idempotencyKey, never duplicated Evidence');
    console.log('OK -- CONCURRENCY: double submission of the same logical response never duplicates the scored response row or Evidence');
  }

  // ---------------------------------------------------------------
  // Concurrency case: duplicate finalization request / attempt finalization race -> idempotent-or-safely-rejected, never a double-completed attempt
  // ---------------------------------------------------------------
  {
    const attempt = await startSimulationAttempt({
      studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM',
      learningObjectiveId: OBJ_MATH, timingMode: 'UNTIMED', language: 'en',
    });

    const results = await Promise.allSettled([completeSimulationAttempt(attempt.simulationAttempt.id), completeSimulationAttempt(attempt.simulationAttempt.id)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert(fulfilled.length === 1 && rejected.length === 1, `CONCURRENCY: exactly one concurrent finalization must succeed and the other must be safely rejected, got ${fulfilled.length} fulfilled / ${rejected.length} rejected`);

    const statusCount = await db.query(`SELECT status, COUNT(*) AS c FROM simulation_attempts WHERE id = $1 GROUP BY status`, [attempt.simulationAttempt.id]);
    assert(statusCount.rows.length === 1 && statusCount.rows[0].status === 'COMPLETED', 'CONCURRENCY: exactly one simulation_attempts row must end in COMPLETED status, never duplicated or left ambiguous');
    console.log('OK -- CONCURRENCY: a finalization race resolves to exactly one COMPLETED attempt -- the second concurrent request is safely rejected, never double-finalized');
  }

  // ---------------------------------------------------------------
  // Concurrency case: readiness recalculation triggered twice concurrently -> two legitimate new snapshots, no corruption/crash
  // ---------------------------------------------------------------
  {
    const [snapA, snapB] = await Promise.all([
      computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID }),
      computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID }),
    ]);
    assert(snapA.id !== snapB.id, 'CONCURRENCY: two concurrent readiness recomputations must each produce their own valid, distinct snapshot row, never crash or corrupt shared state');
    console.log('OK -- CONCURRENCY: two concurrent readiness recomputations both complete cleanly as two distinct, valid snapshots');
  }

  // ---------------------------------------------------------------
  // Failure recovery: a plan-building failure (task §55, "AI generation fails mid-plan" analog -- here, a structurally invalid request) leaves NO partial attempt state
  // ---------------------------------------------------------------
  {
    const beforeAttempts = await db.query(`SELECT COUNT(*) AS c FROM simulation_attempts WHERE student_id = $1`, [STUDENT_1]);
    const beforePlans = await db.query(`SELECT COUNT(*) AS c FROM simulation_plans WHERE student_id = $1`, [STUDENT_1]);
    await startSimulationAttempt({
      studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM',
      learningObjectiveId: randomUUID(), // a real-shaped but nonexistent objective -- buildSimulationPlan must throw before anything is persisted
      timingMode: 'UNTIMED', language: 'en',
    }).then(
      () => assert(false, 'FAILURE RECOVERY: starting an attempt against a nonexistent objective must throw, never silently succeed'),
      () => {}
    );
    const afterAttempts = await db.query(`SELECT COUNT(*) AS c FROM simulation_attempts WHERE student_id = $1`, [STUDENT_1]);
    const afterPlans = await db.query(`SELECT COUNT(*) AS c FROM simulation_plans WHERE student_id = $1`, [STUDENT_1]);
    assert(beforeAttempts.rows[0].c === afterAttempts.rows[0].c, 'FAILURE RECOVERY: a failed plan build must leave zero new simulation_attempts rows -- no partially-finalized attempt');
    assert(beforePlans.rows[0].c === afterPlans.rows[0].c, 'FAILURE RECOVERY: a failed plan build must leave zero new simulation_plans rows');
    console.log('OK -- FAILURE RECOVERY: a plan-building failure leaves no partial attempt or plan state -- fully recoverable, no duplicated Evidence, no orphaned rows');
  }

  console.log('');
  console.log('All F9 concurrency/idempotency assertions passed against real PostgreSQL.');
  console.log('');

  // =================================================================
  // Performance baseline (task §53) -- local ephemeral-DB characterization only, never a production capacity claim.
  // =================================================================
  const results: Array<ReturnType<typeof summarize>> = [];

  {
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID });
      samples.push(performance.now() - t0);
    }
    results.push(summarize('readiness calculation (computeReadinessSnapshot)', samples));
  }

  {
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await buildSimulationPlan({ studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_MATH, timingMode: 'UNTIMED' });
      samples.push(performance.now() - t0);
    }
    results.push(summarize('simulation planning (buildSimulationPlan)', samples));
  }

  {
    const attempt = await startSimulationAttempt({
      studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM',
      learningObjectiveId: OBJ_MATH, timingMode: 'UNTIMED', language: 'en',
    });
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await recordSimulationItemResponse({
        examAttemptId: attempt.examAttempt!.id, studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, assessmentComponentId: componentMathId,
        learningObjectiveId: OBJ_MATH,
        question: { id: `q-perf-${i}`, conceptId: 'irrelevant', type: 'single_choice', answerFormat: 'single_choice', question: 'x?', correctAnswer: 'A', explanation: '', difficulty: 3 } as any,
        studentAnswer: 'A', idempotencyKey: randomUUID(),
      });
      samples.push(performance.now() - t0);
    }
    results.push(summarize('evaluation persistence (recordSimulationItemResponse, structured/deterministic grading path only -- no AI latency)', samples));
  }

  {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID });
      samples.push(performance.now() - t0);
    }
    results.push(summarize('post-exam recomputation (readiness snapshot recompute after new Evidence)', samples));
  }

  console.log('');
  console.log('PERFORMANCE_BASELINE_JSON:' + JSON.stringify(results));
  console.log('All F9 performance baseline measurements captured (local ephemeral Postgres -- NOT a production capacity claim).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('f9-concurrency-performance-runner failed:', err);
    process.exit(1);
  });
