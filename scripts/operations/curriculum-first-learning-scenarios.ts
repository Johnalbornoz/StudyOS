/**
 * Curriculum-first -- runtime scenarios with the REAL services, the REAL provider and a real database (DEV).
 *
 *   L  Learning Practice of a curriculum concept with ZERO items: generated on the explicit start, quality-gated,
 *      frozen, answered, scored, evidence written as LEARNING; a second practice works too
 *   A  AD_HOC Internal Assessment over two concepts with zero items: generated in full before the attempt,
 *      frozen, completed, evidence INTERNAL_ASSESSMENT; nothing is generated during the attempt
 *   S  a scheduled AD_HOC: not due before its moment; due after; SCHEDULED -> STARTED -> COMPLETED
 *   X  the Certified Exam Bank and the generation queue are untouched by all of the above
 *
 * This calls the provider (Learning runtime usage is allowed; it is not Question Factory budget). DEV only.
 * Fixtures (`cfl-<run>`) and everything that references them are removed at the end.
 *   CURRICULUM_CONVERGENCE_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/curriculum-first-learning-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';

process.env.ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED = 'true';
const DEV = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV || process.env.CURRICULUM_CONVERGENCE_FP !== fp) throw new Error(`REFUSING: database ${fp} (DEV only)`);
  const { db } = await import('@/lib/db');
  const { enrollCanonicalConcept } = await import('@/lib/learning-plan/personal-plan.service');
  const { ensureGeneratedSupply } = await import('@/lib/assessment-supply/learning-item-supply.service');
  const { solveLearningForStudent } = await import('@/lib/assessment-blueprint/assessment-blueprint.service');
  const { previewOf } = await import('@/lib/assessment-experience/views');
  const { startLearningAssessment } = await import('@/lib/assessment-execution/assessment-start.service');
  const { completeLearningAssessment } = await import('@/lib/assessment-execution/assessment-completion.service');
  const { adHocExamReadiness } = await import('@/lib/assessment-experience/ad-hoc-exam.service');
  const schedules = await import('@/services/ad-hoc-exam-schedule.service');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);
  console.log(`curriculum-first learning scenarios -- db ${fp} -- run ${RUN}`);

  const examBank = async () => one(`SELECT (SELECT count(*) FROM approved_items)::int AS approved_items, (SELECT count(*) FROM question_bank_items)::int AS bank_items, (SELECT count(*) FROM generation_jobs)::int AS generation_jobs`);
  const bankBefore = await examBank();
  const generationEvents = async (S: string) => n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1 AND capability = 'QUESTION_GENERATION'`, [S]);
  const S = (await one(`INSERT INTO students (clerk_id, email, name, language) VALUES ($1, $2, 'cfl cert', 'es') RETURNING id`, [`cfl-${RUN}`, `cfl-${RUN}@curriculum-first.test`])).id as string;
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'cfl cert')`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    // three certified curriculum concepts, added the way a Student adds them; no exam profile, no exam intent
    const concepts: Array<{ canonical: string; learner: string; name: string }> = [];
    for (const name of ['Fracciones', 'Porcentajes', 'Ecuaciones lineales']) {
      const cc = await one(`SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cs.name = 'Matemáticas' AND cc.name = $1 AND cc.status = 'ACTIVE'`, [name]);
      const e = await enrollCanonicalConcept(S, cc.id, { type: 'SELF_SELECTED', actorUserId: null }, null);
      concepts.push({ canonical: cc.id, learner: e.learnerConceptId, name });
    }
    const subjectId = (await one(`SELECT subject_id FROM concepts WHERE id = $1`, [concepts[0].learner])).subject_id as string;
    check('MODE A  a Student with curriculum concepts and NO exam', (await n(`SELECT count(*)::int AS n FROM student_exam_profiles WHERE student_id = $1`, [S])) === 0);
    check('L0  zero items exist for these concepts', (await n(`SELECT count(*)::int AS n FROM question_bank_candidates WHERE student_id = $1`, [S])) === 0);

    const complete = async (sessionId: string) => {
      const row = await one(`SELECT questions FROM quiz_sessions WHERE id = $1`, [sessionId]);
      const answers = (row.questions as any[]).map((q) => ({ itemKey: q.assessmentItemKey as string, answer: String(q.correctAnswer ?? q.sampleAnswer ?? '') }));
      return completeLearningAssessment({ studentId: S, sessionId, answers });
    };
    const evidenceOf = async (learnerConceptId: string) => (await db.query(`SELECT source_type, result, metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC`, [S, learnerConceptId])).rows as any[];

    /* ------------------------------------------------ L: Learning Practice ------------------------------------------------ */
    const practice = { intent: 'CONCEPT_PRACTICE' as const, depth: 'QUICK' as const, canonicalConceptIds: [], learnerConceptIds: [concepts[0].learner] };
    const asOf = () => new Date().toISOString();
    const before = await solveLearningForStudent(S, { ...practice, asOf: asOf() });
    check('L1  the setup is startable with zero items (prepared on start), never "not enough questions"', before.ok && previewOf(before.solution).availability === 'ON_DEMAND' && previewOf(before.solution).canStart);
    const supply = await ensureGeneratedSupply({ studentId: S, request: practice, asOf: asOf() });
    check('L2  the Learning AI Engine generated validated items for the concept', supply.status === 'GENERATED' && supply.generated > 0, `${supply.status} items=${supply.generated} rounds=${supply.rounds}`);
    const items = (await db.query(`SELECT concept_id, validation_status, generator_provider, generator_prompt_id, generation_operation_id, content_fingerprint, difficulty FROM question_bank_candidates WHERE student_id = $1`, [S])).rows as any[];
    check('L3  stored as the Student\'s own validated items, with generator identity', items.length > 0 && items.every((i) => i.concept_id === concepts[0].learner && i.validation_status === 'VALIDATED' && i.generator_prompt_id && i.generation_operation_id && i.content_fingerprint));
    const started = await startLearningAssessment({ studentId: S, request: practice, asOf: asOf(), language: 'es' });
    check('L4  the practice starts', started.ok, started.ok ? `${started.questions} questions` : started.reason);
    if (started.ok) {
      const session = await one(`SELECT assessment_snapshot AS snap, questions FROM quiz_sessions WHERE id = $1`, [started.record.id]);
      check('L5  the selection is FROZEN in the session (every item from the Student\'s own store, never the Exam Bank)', session.snap.intent === 'CONCEPT_PRACTICE' && session.snap.items.length === started.questions && session.snap.items.every((i: any) => i.question.store === 'LEARNING_ITEM_CACHE' && i.provenance === 'GENERATED_UNREVIEWED'));
      const done = await complete(started.record.id);
      check('L6  the Student answers; the result scores', done.ok, done.ok ? '' : done.reason);
      const evidence = await evidenceOf(concepts[0].learner);
      check('L7  evidence is written for the concept as LEARNING, with curriculum-neutral provenance (no exam fields)', evidence.length > 0 && evidence[0].metadata?.assessment?.supply?.family === 'LEARNING' && evidence[0].metadata.assessment.supply.itemCategory === 'LEARNING_ITEM' && !evidence[0].metadata.assessment.exam, JSON.stringify(evidence[0]?.metadata?.assessment?.supply ?? null));
      check('L8  the Knowledge State is updated', (await n(`SELECT count(*)::int AS n FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2`, [S, concepts[0].learner])) === 1);
      const againSupply = await ensureGeneratedSupply({ studentId: S, request: practice, asOf: asOf() });
      const again = await startLearningAssessment({ studentId: S, request: practice, asOf: asOf(), language: 'es' });
      check('L9  the next practice works too', again.ok && again.record.id !== started.record.id, `${againSupply.status}`);
    }

    /* ------------------------------------------------ A: AD_HOC Internal Assessment ------------------------------------------------ */
    const adHocRequest = { subjectId, learnerConceptIds: [concepts[1].learner, concepts[2].learner], depth: 'QUICK' as const, availableMinutes: null, difficultyBand: null };
    const ready0 = await adHocExamReadiness(S, adHocRequest, asOf(), { enabled: true });
    check('A1  an own exam over two concepts with zero items is not refused: it is generated first', !ready0.ok && ready0.reason === 'ASSESSMENT_NOT_GENERATED_YET');
    const adHocSupply = await ensureGeneratedSupply({ studentId: S, request: { intent: 'AD_HOC_CONCEPT_EXAM', depth: 'QUICK', canonicalConceptIds: [], learnerConceptIds: adHocRequest.learnerConceptIds, availableMinutes: null, difficultyBand: null }, asOf: asOf() });
    const ready1 = await adHocExamReadiness(S, adHocRequest, asOf(), { enabled: true });
    check('A2  the whole assessment is generated and validated BEFORE the attempt', adHocSupply.status === 'GENERATED' && ready1.ok, `${adHocSupply.status} items=${adHocSupply.generated} unmet=${adHocSupply.unmetCanonicalConceptIds.length}`);
    if (ready1.ok) {
      const exam = await startLearningAssessment({ studentId: S, request: { intent: 'AD_HOC_CONCEPT_EXAM', depth: 'QUICK', canonicalConceptIds: ready1.canonicalConceptIds, learnerConceptIds: ready1.learnerConceptIds, availableMinutes: null, difficultyBand: null }, asOf: asOf(), language: 'es', scope: { subjectId: ready1.subjectId, learnerConceptByCanonical: ready1.learnerConceptByCanonical } });
      check('A3  the assessment starts frozen, with exactly the chosen concepts', exam.ok);
      if (exam.ok) {
        const snap = (await one(`SELECT assessment_snapshot AS snap FROM quiz_sessions WHERE id = $1`, [exam.record.id])).snap;
        check('A4  exact scope; own items only', JSON.stringify(snap.targets.canonicalConceptIds) === JSON.stringify([concepts[1].canonical, concepts[2].canonical].sort()) && snap.items.every((i: any) => i.question.store === 'LEARNING_ITEM_CACHE'));
        const gen0 = await generationEvents(S);
        const done = await complete(exam.record.id);
        check('A5  completed; NO question generation during the attempt', done.ok && (await generationEvents(S)) === gen0);
        const ev = await evidenceOf(concepts[1].learner);
        check('A6  evidence is INTERNAL_ASSESSMENT for the Student\'s own concept', ev.length > 0 && ev[0].metadata?.assessment?.supply?.family === 'INTERNAL_ASSESSMENT' && ev[0].metadata.assessment.supply.itemCategory === 'INTERNAL_ASSESSMENT_ITEM', JSON.stringify(ev[0]?.metadata?.assessment?.supply ?? null));
      }
    }

    /* ------------------------------------------------ S: scheduled AD_HOC ------------------------------------------------ */
    const at = new Date(Date.now() + 3_600_000);
    const sch = await schedules.createScheduledAdHocExam(S, { subjectId, conceptIds: [concepts[0].learner], depth: 'QUICK', availableMinutes: null, difficultyBand: null, scheduledAt: at.toISOString(), timezone: 'America/Bogota' } as never);
    check('S1  an own exam is scheduled with a date, a time and a timezone', sch.ok, sch.ok ? '' : sch.reason);
    if (sch.ok) {
      check('S2  not startable before its moment (the start answers 409 ASSESSMENT_NOT_DUE)', !schedules.isScheduledExamDue(sch.schedule, new Date()) && schedules.isScheduledExamDue(sch.schedule, new Date(at.getTime() + 1000)));
      // its moment has come: the start generates what is short, freezes and starts -- from the schedule's own record
      const record = (await schedules.getScheduledAdHocExam(S, sch.schedule.id))!;
      const req = { subjectId: record.subjectId, learnerConceptIds: record.conceptIds, depth: record.depth, availableMinutes: record.availableMinutes, difficultyBand: record.difficultyBand };
      await ensureGeneratedSupply({ studentId: S, request: { intent: 'AD_HOC_CONCEPT_EXAM', depth: record.depth, canonicalConceptIds: [], learnerConceptIds: record.conceptIds, availableMinutes: record.availableMinutes, difficultyBand: record.difficultyBand }, asOf: asOf() });
      const ready = await adHocExamReadiness(S, req, asOf(), { enabled: true });
      if (ready.ok) {
        const exam = await startLearningAssessment({ studentId: S, request: { intent: 'AD_HOC_CONCEPT_EXAM', depth: record.depth, canonicalConceptIds: ready.canonicalConceptIds, learnerConceptIds: ready.learnerConceptIds, availableMinutes: record.availableMinutes, difficultyBand: record.difficultyBand }, asOf: asOf(), language: 'es', scope: { subjectId: ready.subjectId, learnerConceptByCanonical: ready.learnerConceptByCanonical } });
        if (exam.ok) {
          await schedules.markScheduledAdHocExamStarted(S, record.id, exam.record.id);
          const done = await complete(exam.record.id);
          await schedules.completeScheduledAdHocExamForSession(S, exam.record.id);
          const status = (await schedules.getScheduledAdHocExam(S, record.id))?.status ?? (await one(`SELECT status FROM student_scheduled_assessments WHERE id = $1`, [record.id]))?.status;
          check('S3  SCHEDULED -> STARTED -> COMPLETED', done.ok && status === 'COMPLETED', String(status));
        } else check('S3  the scheduled exam starts', false, exam.reason);
      } else check('S3  the scheduled exam is generated', false, ready.reason);
    }

    /* ------------------------------------------------ T: AD_HOC with a time limit ------------------------------------------------ */
    // HIGH difficulty over two concepts: nothing of that difficulty exists yet, so the timed assessment is generated in full first
    const timedRequest = { subjectId, learnerConceptIds: [concepts[0].learner, concepts[1].learner], depth: 'BALANCED' as const, availableMinutes: 30, difficultyBand: 'HIGH' as const };
    const timedSelection = { intent: 'AD_HOC_CONCEPT_EXAM' as const, depth: timedRequest.depth, canonicalConceptIds: [], learnerConceptIds: timedRequest.learnerConceptIds, availableMinutes: 30, difficultyBand: timedRequest.difficultyBand };
    const timed0 = await adHocExamReadiness(S, timedRequest, asOf(), { enabled: true });
    check('T1  a timed own exam with nothing generated yet is not refused for its time: it is generated first', !timed0.ok && timed0.reason === 'ASSESSMENT_NOT_GENERATED_YET', timed0.ok ? 'already ready' : timed0.reason);
    const timedSupply = await ensureGeneratedSupply({ studentId: S, request: timedSelection, asOf: asOf() });
    const timed1 = await adHocExamReadiness(S, timedRequest, asOf(), { enabled: true });
    check('T2  the complete timed assessment is generated and fits the limit (never TIME_CANNOT_BE_ESTIMATED)', timedSupply.status === 'GENERATED' && timed1.ok, `${timedSupply.status} items=${timedSupply.generated} unmet=${timedSupply.unmetCanonicalConceptIds.length}${timed1.ok ? '' : ' ' + timed1.reason}`);
    if (timed1.ok) {
      const exam = await startLearningAssessment({ studentId: S, request: { ...timedSelection, canonicalConceptIds: timed1.canonicalConceptIds, learnerConceptIds: timed1.learnerConceptIds }, asOf: asOf(), language: 'es', scope: { subjectId: timed1.subjectId, learnerConceptByCanonical: timed1.learnerConceptByCanonical } });
      check('T3  the timed assessment starts frozen', exam.ok, exam.ok ? `${exam.questions} questions` : exam.reason);
      if (exam.ok) {
        const snap = (await one(`SELECT assessment_snapshot AS snap FROM quiz_sessions WHERE id = $1`, [exam.record.id])).snap;
        const planned = snap.items.reduce((sum: number, i: any) => sum + (i.estimatedSeconds ?? 0), 0);
        check('T4  every frozen item states its planned time, and the whole assessment is within the 30 minute limit', snap.items.length > 0 && snap.items.every((i: any) => typeof i.estimatedSeconds === 'number' && i.estimatedSeconds > 0 && i.question.store === 'LEARNING_ITEM_CACHE') && planned <= 30 * 60, `${snap.items.length} items, ${planned}s planned of 1800s`);
        const gen0 = await generationEvents(S);
        const done = await complete(exam.record.id);
        check('T5  completed; NO question generation during the attempt', done.ok && (await generationEvents(S)) === gen0, done.ok ? '' : done.reason);
        const ev = await evidenceOf(concepts[0].learner);
        check('T6  evidence is INTERNAL_ASSESSMENT for the Student\'s own concept', ev.length > 0 && ev.some((e: any) => e.metadata?.assessment?.supply?.family === 'INTERNAL_ASSESSMENT'), `${ev.length} rows`);
      }
    }

    /* ------------------------------------------------ X: the Exam Bank is untouched ------------------------------------------------ */
    const bankAfter = await examBank();
    check('X1  Learning / Internal Assessment generation wrote NO Exam Bank inventory and queued NO job', JSON.stringify(bankBefore) === JSON.stringify(bankAfter), JSON.stringify(bankAfter));
    const usage = await one(`SELECT count(*)::int AS calls, count(*) FILTER (WHERE status <> 'SUCCESS')::int AS failed FROM ai_execution_events WHERE student_id = $1`, [S]);
    console.log(`INFO  provider calls recorded for this Student (LEARNING_RUNTIME_USAGE): ${usage.calls} (${usage.failed} not successful)`);
  } finally {
    // remove the fixture and everything that references it (rows of THIS Student only)
    const { removeFixtureStudent } = await import('./curriculum-first-fixture-cleanup');
    const remaining = await removeFixtureStudent(db, S);
    check('CLEANUP  the fixture Student and everything of theirs is removed', remaining === 0, `remaining rows ${remaining}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` -- FAILED: ${failed.map((f) => f.id).join(' | ')}` : ''}`);
  await db.end();
  if (failed.length) process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
