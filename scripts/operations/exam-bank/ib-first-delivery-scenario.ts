/**
 * TRACK B -- the FIRST IB item, delivered end-to-end in DEV through the Exam Core services the Student routes call.
 *
 *   governed blueprint (v2.ib.math-aa-hl/p1, bucket aahl.p1.functions#0, HUMAN_CERTIFIED)
 *   -> certified IB Bank supply (CF-IB-AAHL-01 quadratic minimum, SHORT_RESPONSE, projection 3, canonical contract)
 *   -> frozen DEV attempt (PRACTICE, focused on aahl.p1.functions: one position)
 *   -> Student SHORT_RESPONSE answer -> canonical scorer -> marks
 *   -> exam evidence: what the CURRENT writer does, and the TARGET model (Exam Readiness) applied to the same response
 *
 * DEV ONLY. One clearly-marked fixture Student (clerk `ebr-ib-<run>`), removed at the end. 0 provider calls for questions.
 *
 *   EXAM_BANK_PUBLICATION_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/exam-bank/ib-first-delivery-scenario.ts [--out <json>]
 */
import { createHash, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';

process.env.ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED = 'true';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';

const DEV = '2a29b99ee14a22b4';
/** Where this may run: DEV and the pilot candidate's own database (never the frozen Preview database). */
const TARGETS: Readonly<Record<string, string>> = { [DEV]: 'DEV', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = ''): void => { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? `  [${detail}]` : ''}`); };

async function main(): Promise<number> {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (!TARGETS[fp] || process.env.EXAM_BANK_PUBLICATION_FP !== fp) throw new Error(`REFUSING: database ${fp} is not an authorised target`);
  const at = process.argv.indexOf('--out'); const out = at > 0 ? process.argv[at + 1] : null;
  const { db } = await import('@/lib/db');
  const { getOrCreateCanonicalUser } = await import('@/lib/identity/canonical-user.service');
  const { upsertStudentFromWebhook } = await import('@/lib/auth');
  const { assignSelfServiceRole } = await import('@/lib/identity/role-assignment.service');
  const { createExamInstance, startExamInstance, ensureExamProfile } = await import('@/lib/exam-core/exam-instance.service');
  const { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission } = await import('@/lib/simulation/item-resolution.service');
  const { completeSimulationAttempt, getSimulationAttempt } = await import('@/lib/simulation/attempt.service');
  const { finalizeExamCompletion } = await import('@/lib/exam-core/post-completion');
  const { findAnswerKeyLeak } = await import('@/lib/exam-core/items');
  const { certifiedSupplySql } = await import('@/lib/exam-bank/delivery-scope');
  const { applyEvidence, emptyStores } = await import('@/lib/exam-bank/readiness/evidence-boundary');
  const { cleanupFixtureStudent } = await import('./fixture-cleanup');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);

  const ib = await one(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = 'v2.ib.math-aa-hl'`);
  const p1 = await one(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND section_key = 'p1'`, [ib.version_id]);
  const functions = await one(`SELECT DISTINCT lo.id FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id WHERE t.assessment_component_id = $1 AND lo.code = 'aahl.p1.functions'`, [p1.id]);
  const row = await one(
    `SELECT ai.id, ai.content, qi.lineage_class, qi.item_instance_id, i.certification_state, i.certification_mode, i.blueprint_bucket_id, i.primary_concept_stable_id,
            EXISTS (SELECT 1 FROM student_eligible_item_instances_pilot e WHERE e.id = i.id) AS eligible, ${certifiedSupplySql('ai', 'PILOT_PREVIEW')} AS supply
       FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id AND qi.current_version_id = ai.id JOIN assessment_item_instances i ON i.id = qi.item_instance_id
      WHERE ai.learning_objective_id = $1 AND i.system_id = 'IB'`, [functions.id]);
  check('B1  the IB Bank row exists: CORE_DERIVED, projection 3, canonical contract, SHORT_RESPONSE, answer marks', !!row && row.lineage_class === 'CORE_DERIVED' && row.content?.certified?.projection === 'exam-bank-projection-3' && row.content?.math?.responseContract?.version === 'canonical-response-1' && row.content?.itemType === 'SHORT_RESPONSE', row ? `${row.content.question} key ${row.content.correctAnswer} [${row.content.marks}]` : 'missing');
  check('B2  its instance is certified (automated pilot, inherited deterministic), eligible in the pilot scope, in the human-certified bucket', !!row && row.certification_state === 'AUTOMATED_CERTIFIED_PILOT' && row.certification_mode === 'INHERITED_DETERMINISTIC_CERTIFICATION' && row.eligible === true && row.supply === true && row.blueprint_bucket_id === 'v2.ib.math-aa-hl/p1/aahl.p1.functions#0' && row.primary_concept_stable_id === 'math.alg.quadratics');

  const clerk = `ebr-ib-${RUN}`;
  const user = await getOrCreateCanonicalUser(clerk, `${clerk}@exam-bank.test`);
  const S = await upsertStudentFromWebhook(clerk, `${clerk}@exam-bank.test`, 'ib first delivery');
  const actor = user.id as string;
  await assignSelfServiceRole(clerk, actor, 'STUDENT');
  const report: Record<string, unknown> = { kind: 'IB_FIRST_DELIVERY_DEV', run: RUN, database: TARGETS[fp], bankItem: row ? { approvedItemId: row.id, prompt: row.content.question, key: row.content.correctAnswer, marks: row.content.marks } : null };
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'ib first delivery') ON CONFLICT (id) DO NOTHING`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    const questionCalls = async () => n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1 AND capability = 'QUESTION_GENERATION'`, [S]);
    const anyCalls = async () => n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1`, [S]);
    const planBefore = await n(`SELECT count(*)::int AS n FROM student_plan_entries WHERE student_id = $1`, [S]);
    const profileId = await ensureExamProfile(S, ib.definition_id, ib.version_id);

    /** One practice attempt on the functions position, answered with `answer`. */
    const attempt = async (answer: string) => {
      const inst = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: ib.version_id, componentIds: [p1.id], mode: 'PRACTICE', focusObjectiveIds: [functions.id] });
      const started = await startExamInstance(inst.id, { language: 'en' });
      // the attempt is frozen at start: the assessment snapshot (canonical execution) holds the served item
      const frozen = await one(`SELECT form, form_frozen_at, assessment_snapshot FROM exam_instances WHERE id = $1`, [inst.id]);
      const sim = started.simulationAttemptId!;
      const next = await getNextSimulationItem(actor, sim);
      const state = next.outcome === 'ITEM_READY' ? (await one(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [sim])).navigation_state.items[String(next.targetIndex)] : null;
      const leak = next.outcome === 'ITEM_READY' ? findAnswerKeyLeak(next) : null;
      const submitted = next.outcome === 'ITEM_READY' ? await submitSimulationItemAnswer(actor, sim, answer, `ib1:${sim}:${next.targetIndex}`, next.targetIndex) : null;
      await finalizeOpenItemsForSubmission(actor, sim);
      await completeSimulationAttempt(sim);
      const done = await finalizeExamCompletion(sim, S, 'ib-first-delivery');
      const examAttemptId = (await getSimulationAttempt(sim))!.examAttemptId;
      const responses = (await db.query(`SELECT approved_item_id, item_source, score, max_score, scoring_strategy, review_status, grading_detail, normalized_response FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttemptId])).rows;
      const evidence = await n(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1 AND (metadata->'examScope'->>'examAttemptId' = $2 OR metadata->'context'->>'examAttemptId' = $2)`, [S, examAttemptId]);
      return { inst, frozen, started, next, state, leak, submitted, done, examAttemptId, responses, evidence };
    };

    const calls0 = await anyCalls();
    const a = await attempt('20,75');
    const snap = JSON.stringify(a.frozen?.assessment_snapshot ?? {});
    check('A1  a PRACTICE instance focused on aahl.p1.functions is created and frozen at start: its assessment snapshot holds the certified IB item (one position)', !!a.frozen?.assessment_snapshot && snap.includes(row.id), `snapshot ${a.frozen?.assessment_snapshot ? 'present' : 'absent'}; holds the item ${snap.includes(row.id)}`);
    check('A2  the attempt starts and serves exactly that item, as a SHORT_RESPONSE, with no answer key on the wire', a.next.outcome === 'ITEM_READY' && a.state?.item?.exam?.approvedItemId === row.id && a.leak === null, a.next.outcome);
    const r1 = a.responses[0];
    check('S1  the Student\'s SHORT_RESPONSE "20,75" is scored by the canonical contract: 4/4', a.responses.length === 1 && Number(r1.score) === 4 && Number(r1.max_score) === 4 && r1.review_status === 'NONE' && r1.grading_detail?.contract === 'canonical-response-1', JSON.stringify({ score: r1?.score, max: r1?.max_score, strategy: r1?.scoring_strategy, verdict: r1?.grading_detail?.verdict }));
    const b = await attempt('20.8');
    const r2 = b.responses[0];
    check('S2  a second attempt answering "20.8" scores 0/4 (exact value required; no partial credit invented)', b.responses.length === 1 && Number(r2.score) === 0 && Number(r2.max_score) === 4, JSON.stringify({ score: r2?.score, verdict: r2?.grading_detail?.verdict }));
    const c = await attempt('83/4');
    check('S3  a third attempt answering "83/4" (the keyed fraction) scores 4/4', c.responses.length === 1 && Number(c.responses[0].score) === 4);
    check('X1  no provider was asked for a question (0 QUESTION_GENERATION calls)', (await questionCalls()) === 0, `provider calls of any kind: ${(await anyCalls()) - calls0}`);
    check('X2  no Learning Plan membership was created by the exam', (await n(`SELECT count(*)::int AS n FROM student_plan_entries WHERE student_id = $1`, [S])) === planBefore);

    // ---- exam evidence: the current writer (needs a concept the Student owns) and the TARGET model on the same responses
    check('E1  current writer: no evidence (the Student owns no concept; exam prep never enrols one) -- the known PAA-FOLLOWUP-02 gap, not mutated here', a.evidence + b.evidence + c.evidence === 0, `${a.evidence + b.evidence + c.evidence} rows`);
    const stores = emptyStores();
    for (const [k, x] of [a, b, c].entries()) {
      applyEvidence(stores, { studentId: S, type: 'EXAM_ASSESSMENT', conceptStableId: 'math.alg.quadratics', correct: Number(x.responses[0]?.score) === 4, fraction: Number(x.responses[0]?.score) / 4, assisted: false, responseFormat: 'SHORT_RESPONSE', difficultyIndex: null, responseTimeMs: null, occurredAt: new Date(Date.now() + k).toISOString(), examTarget: { examTargetId: profileId, assessmentSystem: 'IB', assessmentVersion: '0-2-0-illustrative', profile: 'MATH_AA_HL', component: 'p1', paper: 'P1', blueprintBucketId: 'v2.ib.math-aa-hl/p1/aahl.p1.functions#0', examAttemptId: x.examAttemptId }, idempotencyKey: `ib1:${x.examAttemptId}` });
    }
    const cell = [...stores.examReadiness.values()][0];
    check('E2  TARGET model: the three responses become ONE Exam Readiness cell (IB / P1 / functions bucket / math.alg.quadratics), no plan entry, no Knowledge State change', stores.examReadiness.size === 1 && cell.attemptCount === 3 && cell.independentCorrectCount === 2 && stores.knowledgeState.size === 0 && stores.learningPlan.size === 0, JSON.stringify({ attempts: cell?.attemptCount, correct: cell?.independentCorrectCount }));
    report.attempts = [a, b, c].map((x) => ({ examAttemptId: x.examAttemptId, response: x.responses[0] ? { score: Number(x.responses[0].score), max: Number(x.responses[0].max_score), strategy: x.responses[0].scoring_strategy, contract: x.responses[0].grading_detail?.contract, verdict: x.responses[0].grading_detail?.verdict } : null, evidenceRows: x.evidence }));
    report.examReadinessTarget = cell;
  } finally {
    const remaining = await cleanupFixtureStudent(db, S, actor).catch((e) => { console.error(e); return -1; });
    check('Z1  the fixture Student and everything of theirs is removed', remaining === 0, `${remaining} rows left`);
    report.results = results;
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    await db.end();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} PASS`);
  return failed === 0 ? 0 : 1;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
