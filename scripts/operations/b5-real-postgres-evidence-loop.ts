/**
 * B5 -- the B3 evidence loop through the REAL `updateMastery`, on a real Postgres.
 *
 * LOCAL THROWAWAY DATABASE ONLY. It refuses any DATABASE_URL whose host is not loopback, so it can never
 * touch a hosted environment. It creates its own synthetic Student and content rows, runs the loop with
 * its default (real) dependencies and prints what the database holds before and after.
 *
 * Build the database first (schema baseline + ledger + `scripts/db-migrate.ts`), then:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/<db> npx tsx scripts/operations/b5-real-postgres-evidence-loop.ts
 *
 * Exit code 0 only when every check passed.
 */
import { randomUUID } from 'crypto';

const target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
  console.error(`REFUSED: ${target.hostname} is not a loopback database. This script only runs on a local throwaway Postgres.`);
  process.exit(2);
}

async function main() {
  const { db } = await import('@/lib/db');
  const { coverageOfLearningCacheItem, coverageOfReviewedBankItem } = await import('@/lib/assessment-foundation/question-coverage');
  const { projectEvidenceNeeds, solveLearningBlueprint, solveExamPreparationBlueprint, solveOfficialBlueprint } = await import('@/lib/assessment-blueprint');
  const { freezeAssessment, executionRefs } = await import('@/lib/assessment-execution');
  const { completeAssessmentEvidence, learningActivityFor, loadAssessmentSnapshot, persistAssessmentSnapshot } = await import('@/lib/assessment-execution/assessment-execution.service');
  const { resultViewOf } = await import('@/lib/assessment-experience/views');
  type QuestionCoverage = import('@/lib/assessment-foundation/question-coverage').QuestionCoverage;
  type ScoredResponse = import('@/lib/assessment-execution').ScoredResponse;

  const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  };
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[];
  const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];

  /* ---------------- synthetic fixtures ---------------- */
  const AS_OF = new Date().toISOString();
  const run = randomUUID().slice(0, 8);
  const student = (await one(`INSERT INTO students (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`b5-fixture-${run}`, `b5-fixture-${run}@example.invalid`])).id as string;
  const other = (await one(`INSERT INTO students (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`b5-other-${run}`, `b5-other-${run}@example.invalid`])).id as string;
  // The legacy identity pair: evidence, mastery and subjects reference `profiles`, with the Student's own id.
  for (const id of [student, other]) await q(`INSERT INTO profiles (id, user_type) VALUES ($1, 'student')`, [id]);
  const subject = (await one(`INSERT INTO subjects (student_id, name) VALUES ($1, 'B5 fixture subject') RETURNING id`, [student])).id as string;
  const canonicalSubject = (await one(`INSERT INTO canonical_subjects (name) VALUES ($1) RETURNING id`, [`B5 fixture ${run}`])).id as string;
  if ((await q(`SELECT 1 FROM mastery_policies LIMIT 1`)).length === 0) {
    // The schema baseline carries no data; this mirrors the one policy row every environment has (version 1).
    await q(
      `INSERT INTO mastery_policies (version, minimum_understanding, minimum_independence, minimum_application, minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days)
       VALUES (1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14)`
    );
  }
  const concept: Record<string, { canonical: string; learner: string }> = {};
  for (const [key, method] of [['C1', 'PLAN_ENROLLMENT'], ['C2', 'PLAN_ENROLLMENT'], ['C3', 'EXACT_LABEL_MATCH'], ['C4', 'PLAN_ENROLLMENT']] as const) {
    const canonical = (await one(`INSERT INTO canonical_concepts (canonical_subject_id, name) VALUES ($1, $2) RETURNING id`, [canonicalSubject, `B5 ${key} ${run}`])).id as string;
    const learner = (await one(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subject, `b5-${key}-${run}`])).id as string;
    // C3 is linked by a label match only: TRANSITIONAL, unresolved for assessment use.
    await q(`INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ($1, $2, 'MATCHED', $3)`, [learner, canonical, method]);
    concept[key] = { canonical, learner };
  }
  const C = (k: string) => concept[k].canonical;
  const identity = (k: string) => ({ status: 'CANONICAL' as const, learnerConceptId: concept[k].learner, canonicalConceptId: C(k), basis: 'CREATED_FROM_CANONICAL' as const });
  const cached = (id: string, k: string, also: Array<[string, 'PRIMARY' | 'SUPPORTING']> = []): QuestionCoverage => {
    const c = coverageOfLearningCacheItem({ candidateId: id, studentId: student, learnerConceptId: concept[k].learner, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: identity(k) });
    return { ...c, concepts: [...c.concepts, ...also.map(([kk, role]) => ({ canonicalConceptId: C(kk), role, basis: 'ITEM_ATTRIBUTION' as const }))] };
  };
  const session = async (id: string, mode: string) => {
    await q(`INSERT INTO quiz_sessions (id, student_id, subject_id, questions, expires_at, quiz_mode) VALUES ($1, $2, $3, '[]'::jsonb, now() + interval '1 hour', $4)`, [id, student, subject, mode]);
    return { kind: 'QUIZ_SESSION' as const, id };
  };
  const policy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };
  const learn = (coverages: QuestionCoverage[], keys: string[], intent: 'CUSTOM_CONCEPT_PRACTICE' | 'MASTERY_CHECK' | 'RETENTION_CHECK', curriculum?: Array<{ structureVersionId: string; academicSubjectId: string }>) => {
    const ids = keys.map(C);
    const solution = solveLearningBlueprint({ policy: { studentId: student, intent, depth: 'QUICK', canonicalConceptIds: ids, needs: projectEvidenceNeeds(ids, [], policy, AS_OF), curriculum }, coverages, asOf: AS_OF });
    return freezeAssessment({ solution, coverages, studentId: student, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', intent, activity: learningActivityFor(solution.requirement!.evidence!.activityType, intent) });
  };
  const scored = (key: string, fraction: number): ScoredResponse => ({ itemKey: key, responseRef: null, status: 'SCORED', fraction });
  const evidenceRows = (learner: string) => q(`SELECT id, source_type, result, score_percent, operation_key, activity_type, metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp"`, [student, learner]);
  const ks = (learner: string) => one(`SELECT mastery_state, evidence_count, independent_evidence_count, validation_readiness FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2`, [student, learner]);
  const mastery = (learner: string) => one(`SELECT mastery_score, attempt_count FROM mastery_records WHERE student_id = $1 AND concept_id = $2`, [student, learner]);
  const events = async (learner: string) => Number((await one(`SELECT count(*)::int AS n FROM mastery_events e JOIN mastery_records r ON r.id = e.mastery_id WHERE r.student_id = $1 AND r.concept_id = $2`, [student, learner])).n);

  /* ---------------- 1. snapshot persistence on a real row ---------------- */
  const pool = [cached('q1', 'C1', [['C2', 'SUPPORTING']]), cached('q3', 'C3'), cached('q4', 'C4')];
  const frozen = learn(pool, ['C1', 'C2', 'C3', 'C4'], 'CUSTOM_CONCEPT_PRACTICE');
  const rec = await session(`b5-${run}-practice`, 'topic_practice');
  check('legacy row reads with a NULL snapshot (historical compatibility)', (await loadAssessmentSnapshot(rec)).ok === false);
  check('snapshot stored once (NEW)', JSON.stringify(await persistAssessmentSnapshot(rec, frozen)) === JSON.stringify({ ok: true, stored: 'NEW' }));
  check('same snapshot again is a no-op (ALREADY_STORED)', JSON.stringify(await persistAssessmentSnapshot(rec, frozen)) === JSON.stringify({ ok: true, stored: 'ALREADY_STORED' }));
  const differentSnapshot = learn([cached('q4', 'C4')], ['C4'], 'CUSTOM_CONCEPT_PRACTICE');
  check('a different snapshot for the same record is refused', JSON.stringify(await persistAssessmentSnapshot(rec, differentSnapshot)) === JSON.stringify({ ok: false, reason: 'ALREADY_FROZEN_DIFFERENTLY' }));
  const reloaded = await loadAssessmentSnapshot(rec);
  check('the stored snapshot round-trips through JSONB and still verifies', reloaded.ok && reloaded.frozen.snapshotId === frozen.snapshotId && JSON.stringify(executionRefs(reloaded.frozen)) === JSON.stringify(executionRefs(frozen)));
  const rejected = await db.query(`UPDATE quiz_sessions SET assessment_snapshot = '{"not":"a snapshot"}'::jsonb WHERE id = $1`, [`b5-${run}-practice`]).then(() => false, (e: any) => e.code === '23514');
  check('the database CHECK rejects a malformed snapshot shape (23514)', rejected);
  check('a snapshot cannot be stored for another Student\'s record', JSON.stringify(await persistAssessmentSnapshot(rec, { ...frozen, studentId: other })) === JSON.stringify({ ok: false, reason: 'STUDENT_MISMATCH' }));

  /* ---------------- 2. the loop through the real updateMastery ---------------- */
  const before = { ks: await ks(concept.C1.learner), mastery: await mastery(concept.C1.learner), evidence: (await evidenceRows(concept.C1.learner)).length };
  console.log('BEFORE C1', JSON.stringify(before));
  const input = { record: rec, studentId: student, attemptRef: rec.id, responses: frozen.items.map((i) => scored(i.key, 1)) };
  const first = await completeAssessmentEvidence(input, { log: () => undefined });
  if (!first.ok) throw new Error(`loop refused: ${first.reason}`);
  const after = { ks: await ks(concept.C1.learner), mastery: await mastery(concept.C1.learner), evidence: await evidenceRows(concept.C1.learner) };
  console.log('AFTER  C1', JSON.stringify({ ks: after.ks, mastery: after.mastery, evidence: after.evidence.map((e) => ({ source_type: e.source_type, result: e.result, score_percent: e.score_percent, operation_key: e.operation_key })) }));
  check('C1 (single PRIMARY, canonical link): one learning_evidence row', after.evidence.length === 1);
  check('C1 evidence carries the server-built operation key', after.evidence[0]?.operation_key === `QUIZ_SUBMISSION::${rec.id}::${concept.C1.learner}`);
  check('C1 evidence source is the registry value (PRACTICE_QUIZ)', after.evidence[0]?.source_type === 'PRACTICE_QUIZ');
  const meta = after.evidence[0]?.metadata ?? {};
  check('evidence provenance: snapshot, family, policy, response, role', meta.assessment?.snapshotId === frozen.snapshotId && meta.assessment?.family === 'LEARNING' && meta.assessment?.attributionRole === 'PRIMARY' && meta.assessment?.responses?.length === 1 && meta.activityType === 'PRACTICE' && meta.evidenceMode === 'PRACTICE');
  check('the SUPPORTING concept is recorded on the source evidence, not credited', (meta.assessment?.nonConsequential ?? []).some((n: any) => n.canonicalConceptId === C('C2') && n.status === 'NON_CONSEQUENTIAL'));
  check('mastery_records row created and one mastery_events row', before.mastery === undefined && after.mastery !== undefined && (await events(concept.C1.learner)) === 1);
  check('Knowledge State recalculated by the writer (row exists, evidence_count = 1)', before.ks === undefined && Number(after.ks?.evidence_count) === 1, after.ks);
  check('C2 (SUPPORTING only): no evidence, no mastery, no Knowledge State', (await evidenceRows(concept.C2.learner)).length === 0 && (await mastery(concept.C2.learner)) === undefined && (await ks(concept.C2.learner)) === undefined);
  check('C3 (TRANSITIONAL label link): no evidence', (await evidenceRows(concept.C3.learner)).length === 0);
  check('C4 (single PRIMARY): evidence written', (await evidenceRows(concept.C4.learner)).length === 1);
  const outcome = (k: string) => first.state.attributionOutcomes.filter((o) => o.canonicalConceptId === C(k)).map((o) => o.status).join();
  check('attribution outcomes: C1 ATTRIBUTED, C2 NON_CONSEQUENTIAL, C3 UNRESOLVED_CONCEPT, C4 ATTRIBUTED', outcome('C1') === 'ATTRIBUTED' && outcome('C2') === 'NON_CONSEQUENTIAL' && outcome('C3') === 'UNRESOLVED_CONCEPT' && outcome('C4') === 'ATTRIBUTED', [outcome('C1'), outcome('C2'), outcome('C3'), outcome('C4')]);
  check('partial attribution: the score is whole (3 of 3 scored) although one concept could not be attributed', first.state.score.scored === 3 && first.state.score.meanFraction === 1);
  check('PostAssessmentState reports the state change for C1', first.state.conceptStateChanges.some((c) => c.canonicalConceptId === C('C1') && c.before === null && c.after !== null));
  check('the B4 result view reads it: evidence for C1 and C4, C2 not attributable', (() => { const v = resultViewOf(first.state); const s = (k: string) => v.concepts.find((x) => x.canonicalConceptId === C(k))?.status; return s('C1') === 'EVIDENCE_OBTAINED' && s('C4') === 'EVIDENCE_OBTAINED' && s('C2') === 'NOT_ATTRIBUTABLE' && v.learningAttribution === 'AVAILABLE'; })());

  /* ---------------- 3. exactly-once on the database ---------------- */
  const snapshotOfState = async () => JSON.stringify({ ks: await ks(concept.C1.learner), mastery: await mastery(concept.C1.learner), events: await events(concept.C1.learner), evidence: (await evidenceRows(concept.C1.learner)).length });
  const settled = await snapshotOfState();
  const retry = await completeAssessmentEvidence(input, { log: () => undefined });
  check('retry: every application reports DUPLICATE_IDEMPOTENT', retry.ok && retry.state.evidence.length === 2 && retry.state.evidence.every((e) => e.status === 'DUPLICATE_IDEMPOTENT'));
  check('retry: evidence, mastery, events and Knowledge State are unchanged', (await snapshotOfState()) === settled);
  const racing = await Promise.all(Array.from({ length: 6 }, () => completeAssessmentEvidence(input, { log: () => undefined })));
  check('six concurrent completions: still one evidence row per (attempt, concept)', (await snapshotOfState()) === settled && racing.every((r) => r.ok && r.state.evidence.every((e) => e.status === 'DUPLICATE_IDEMPOTENT')));
  const keys = await q(`SELECT operation_key, count(*)::int AS n FROM learning_evidence WHERE student_id = $1 GROUP BY 1`, [student]);
  check('one row per operation key in the table', keys.length === 2 && keys.every((k) => k.n === 1), keys);
  const unique = await db.query(`INSERT INTO learning_evidence (student_id, concept_id, source_type, result, difficulty, subject_id, operation_key) VALUES ($1, $2, 'PRACTICE_QUIZ', 'correct', 3, $3, $4)`, [student, concept.C1.learner, subject, `QUIZ_SUBMISSION::${rec.id}::${concept.C1.learner}`]).then(() => 'INSERTED', (e: any) => `${e.code}:${e.constraint}`);
  check('the unique index is the final protection (direct duplicate insert -> 23505)', unique === '23505:learning_evidence_operation_key_unique_idx', unique);

  // a genuinely concurrent FIRST application: a fresh attempt, six racers
  const rec2 = await session(`b5-${run}-race`, 'topic_practice');
  const frozen2 = learn([cached('r1', 'C4')], ['C4'], 'CUSTOM_CONCEPT_PRACTICE');
  await persistAssessmentSnapshot(rec2, frozen2);
  const c4Before = { evidence: (await evidenceRows(concept.C4.learner)).length, events: await events(concept.C4.learner) };
  const race = await Promise.all(Array.from({ length: 6 }, () => completeAssessmentEvidence({ record: rec2, studentId: student, attemptRef: rec2.id, responses: [scored(frozen2.items[0].key, 1)] }, { log: () => undefined })));
  const statuses = race.flatMap((r) => (r.ok ? r.state.evidence.map((e) => e.status) : ['REFUSED']));
  check('concurrent first application: exactly one APPLIED, five DUPLICATE_IDEMPOTENT', statuses.filter((s) => s === 'APPLIED').length === 1 && statuses.filter((s) => s === 'DUPLICATE_IDEMPOTENT').length === 5, statuses);
  check('concurrent first application: one new evidence row and one new mastery event', (await evidenceRows(concept.C4.learner)).length === c4Before.evidence + 1 && (await events(concept.C4.learner)) === c4Before.events + 1);

  /* ---------------- 4. independent evidence and retention through the existing projectors ---------------- */
  const recProve = await session(`b5-${run}-prove`, 'canonical_prove');
  const frozenProve = learn([cached('p1', 'C1')], ['C1'], 'MASTERY_CHECK');
  await persistAssessmentSnapshot(recProve, frozenProve);
  const ksBeforeProve = await ks(concept.C1.learner);
  const prove = await completeAssessmentEvidence({ record: recProve, studentId: student, attemptRef: recProve.id, responses: [scored(frozenProve.items[0].key, 1)] }, { log: () => undefined });
  const ksAfterProve = await ks(concept.C1.learner);
  console.log('PROVE  C1', JSON.stringify({ before: ksBeforeProve, after: ksAfterProve }));
  check('independent PROVE: outcome is ATTRIBUTED and independent', prove.ok && prove.state.attributionOutcomes[0]?.status === 'ATTRIBUTED' && prove.state.attributionOutcomes[0]?.independent === true);
  // The projector's own rule (knowledge-state.service): evidence written without assistance counts as independent,
  // whatever the activity. B3 changes none of that; this only proves the PROVE evidence went through it.
  check('independent PROVE: the projector counted one more evidence and one more independent evidence', Number(ksAfterProve?.evidence_count) === Number(ksBeforeProve?.evidence_count) + 1 && Number(ksAfterProve?.independent_evidence_count) === Number(ksBeforeProve?.independent_evidence_count) + 1, { before: ksBeforeProve, after: ksAfterProve });
  check('Knowledge State moved through the canonical projector (state before -> after reported by the loop)', prove.ok && prove.state.conceptStateChanges[0]?.before === ksBeforeProve?.mastery_state && prove.state.conceptStateChanges[0]?.after === ksAfterProve?.mastery_state, prove.ok ? prove.state.conceptStateChanges : null);
  const recRetain = await session(`b5-${run}-retain`, 'canonical_retain');
  const frozenRetain = learn([cached('t1', 'C1')], ['C1'], 'RETENTION_CHECK');
  await persistAssessmentSnapshot(recRetain, frozenRetain);
  const retain = await completeAssessmentEvidence({ record: recRetain, studentId: student, attemptRef: recRetain.id, responses: [scored(frozenRetain.items[0].key, 1)] }, { log: () => undefined });
  const memory = await one(`SELECT memory_status, policy_version FROM concept_memory_state WHERE student_id = $1 AND concept_id = $2`, [student, concept.C1.learner]);
  console.log('RETAIN C1', JSON.stringify({ retentionCheckQualified: retain.ok ? retain.state.evidence[0]?.retentionCheckQualified : null, memory }));
  check('retention check: written as RETENTION_CHECK and the memory projector answered (qualified is a boolean, memory state row exists)', retain.ok && retain.state.evidence[0]?.status === 'APPLIED' && typeof retain.state.evidence[0]?.retentionCheckQualified === 'boolean' && memory !== undefined, { memory });

  /* ---------------- 5. cross-curriculum: one state, contextual provenance ---------------- */
  const recA = await session(`b5-${run}-curr-a`, 'topic_practice');
  const recB = await session(`b5-${run}-curr-b`, 'topic_practice');
  const refA = [{ structureVersionId: 'sv-curriculum-a', academicSubjectId: 'subj-a' }];
  const refB = [{ structureVersionId: 'sv-curriculum-b', academicSubjectId: 'subj-b' }];
  await persistAssessmentSnapshot(recA, learn([cached('xa', 'C4')], ['C4'], 'CUSTOM_CONCEPT_PRACTICE', refA));
  await persistAssessmentSnapshot(recB, learn([cached('xb', 'C4')], ['C4'], 'CUSTOM_CONCEPT_PRACTICE', refB));
  await completeAssessmentEvidence({ record: recA, studentId: student, attemptRef: recA.id, responses: [scored('LEARNING_ITEM_CACHE:xa', 0.2)] }, { log: () => undefined });
  await completeAssessmentEvidence({ record: recB, studentId: student, attemptRef: recB.id, responses: [scored('LEARNING_ITEM_CACHE:xb', 1)] }, { log: () => undefined });
  const c4 = await evidenceRows(concept.C4.learner);
  const ksRows = await q(`SELECT count(*)::int AS n FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2`, [student, concept.C4.learner]);
  const curricula = c4.map((e) => e.metadata?.assessment?.curriculum?.[0]?.structureVersionId ?? null);
  check('cross-curriculum: ONE Knowledge State row for the concept', ksRows[0].n === 1);
  check('cross-curriculum: each evidence row keeps the curriculum it was produced under', curricula.includes('sv-curriculum-a') && curricula.includes('sv-curriculum-b'), curricula);

  /* ---------------- 6. exam families on real rows ---------------- */
  const definition = (await one(`INSERT INTO exam_definitions (name, exam_family) VALUES ($1, 'B5_FIXTURE') RETURNING id`, [`B5 fixture exam ${run}`])).id as string;
  const version = (await one(`INSERT INTO exam_versions (exam_definition_id, version_label) VALUES ($1, 'v1') RETURNING id`, [definition])).id as string;
  const profile = (await one(`INSERT INTO student_exam_profiles (student_id, exam_definition_id, exam_version_id) VALUES ($1, $2, $3) RETURNING id`, [student, definition, version])).id as string;
  const component = (await one(`INSERT INTO assessment_components (exam_version_id, name, component_type) VALUES ($1, 'Paper 1', 'PAPER') RETURNING id`, [version])).id as string;
  const instanceWith = async (mode: string, simulationType: string, audience: 'STUDENT' | 'TECHNICAL_DEMO') => {
    const attempt = (await one(`INSERT INTO exam_attempts (student_exam_profile_id, exam_version_id, frozen_configuration) VALUES ($1, $2, '{}'::jsonb) RETURNING id`, [profile, version])).id as string;
    const plan = (await one(`INSERT INTO simulation_plans (student_id, exam_version_id, simulation_type, plan) VALUES ($1, $2, $3, '{}'::jsonb) RETURNING id`, [student, version, simulationType])).id as string;
    const sim = (await one(`INSERT INTO simulation_attempts (exam_attempt_id, student_id, exam_profile_id, exam_version_id, simulation_type, simulation_plan_id, timing_mode, pause_allowed, language) VALUES ($1, $2, $3, $4, $5, $6, 'UNTIMED', true, 'es') RETURNING id`, [attempt, student, profile, version, simulationType, plan])).id as string;
    const instance = (await one(`INSERT INTO exam_instances (student_id, exam_profile_id, exam_version_id, component_ids, mode, timing_mode, status, form, form_frozen_at, simulation_attempt_id, content_audience) VALUES ($1, $2, $3, $4::uuid[], $5, 'UNTIMED', 'IN_PROGRESS', '{}'::jsonb, now(), $6, $7) RETURNING id`, [student, profile, version, [component], mode, sim, audience])).id as string;
    return { record: { kind: 'EXAM_INSTANCE' as const, id: instance }, attempt };
  };
  // the widened CHECK accepts every B1 attempt type on real Postgres
  const types: string[] = [];
  for (const [mode, type] of [['PRACTICE', 'EXAM_PRACTICE'], ['CHALLENGE', 'EXAM_CHALLENGE'], ['MOCK', 'REDUCED_MOCK'], ['MOCK', 'FULL_MOCK']] as const) {
    await instanceWith(mode, type, 'STUDENT');
    types.push(type);
  }
  check('simulation types EXAM_PRACTICE / EXAM_CHALLENGE / REDUCED_MOCK / FULL_MOCK are accepted by the CHECK constraints', types.length === 4);
  const badType = await db.query(`INSERT INTO simulation_plans (student_id, exam_version_id, simulation_type, plan) VALUES ($1, $2, 'TECHNICAL_DEMO', '{}'::jsonb)`, [student, version]).then(() => false, (e: any) => e.code === '23514');
  check('an unknown simulation type is still rejected (23514)', badType);

  const bank = (id: string, objective: string, keys: string[], explicit: boolean): QuestionCoverage => {
    const c = coverageOfReviewedBankItem({
      approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 2, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
      usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null,
      bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: version, assessmentComponentId: component, currentVersionId: id, retired: false, language: 'es' }, sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1,
      scope: { structureVersionId: 'sv-exam', academicSubjectId: 'subj-exam' }, objectiveConcepts: keys.map((k) => ({ canonicalConceptId: C(k), relationType: 'FULL' as const })),
    });
    return explicit ? { ...c, concepts: [{ canonicalConceptId: C(keys[0]), role: 'PRIMARY', basis: 'ITEM_ATTRIBUTION' }] } : c;
  };
  const exam = { examTargetId: profile, examVersionId: version, assessmentComponentIds: [component] };

  // EXAM_PREPARATION: one derived item, one with explicit item-level attribution
  const prepBank = [bank('prep-derived', 'lo-1', ['C1', 'C2'], false), bank('prep-explicit', 'lo-2', ['C4'], true)];
  const prepSolution = solveExamPreparationBlueprint({ policy: { studentId: student, examTargetId: profile, examVersionId: version, objective: 'COVERAGE', examObjectives: [{ learningObjectiveId: 'lo-1', assessmentComponentId: component, blueprintPositions: 1 }, { learningObjectiveId: 'lo-2', assessmentComponentId: component, blueprintPositions: 1 }], gaps: [] }, coverages: prepBank });
  const prepFrozen = freezeAssessment({ solution: prepSolution, coverages: prepBank, studentId: student, createdAt: AS_OF, path: 'EXAM_PRACTICE', intent: 'COVERAGE', exam });
  const prep = await instanceWith('PRACTICE', 'EXAM_PRACTICE', 'STUDENT');
  check('exam instance: snapshot stored on exam_instances', JSON.stringify(await persistAssessmentSnapshot(prep.record, prepFrozen)) === JSON.stringify({ ok: true, stored: 'NEW' }));
  const c4EvidenceBefore = (await evidenceRows(concept.C4.learner)).length;
  const c1EvidenceBefore = (await evidenceRows(concept.C1.learner)).length;
  const noGaps = { readExamGaps: async () => [], log: () => undefined };
  const prepRun = await completeAssessmentEvidence({ record: prep.record, studentId: student, attemptRef: prep.attempt, responses: prepFrozen.items.map((i) => scored(i.key, 0.5)) }, noGaps);
  const c4Rows = await evidenceRows(concept.C4.learner);
  const examRow = c4Rows[c4Rows.length - 1];
  check('exam preparation: explicit item attribution -> one EXAM_SIMULATION evidence row', prepRun.ok && c4Rows.length === c4EvidenceBefore + 1 && examRow.source_type === 'EXAM_SIMULATION' && examRow.result === 'partial');
  check('exam preparation: derived-only item -> no evidence for its concepts', (await evidenceRows(concept.C1.learner)).length === c1EvidenceBefore && prepRun.ok && prepRun.state.attributionOutcomes.filter((o) => o.itemKey.endsWith('prep-derived')).every((o) => o.status === 'DERIVED_ONLY'));
  check('exam scope on the evidence row: target (from the attempt FK), version, attempt', examRow.metadata?.examScope?.examTargetId === profile && examRow.metadata?.examScope?.examVersionId === version && examRow.metadata?.examScope?.examAttemptId === prep.attempt && examRow.metadata?.examScope?.source === 'EXAM_ATTEMPT');
  check('exam operation key is attempt + frozen position', String(examRow.operation_key).startsWith(`EXAM_SIMULATION_RESPONSE::${prep.attempt}.`));
  const prepRetry = await completeAssessmentEvidence({ record: prep.record, studentId: student, attemptRef: prep.attempt, responses: prepFrozen.items.map((i) => scored(i.key, 0.5)) }, noGaps);
  check('exam preparation retry: nothing written twice', prepRetry.ok && prepRetry.state.evidence.every((e) => e.status === 'DUPLICATE_IDEMPOTENT') && (await evidenceRows(concept.C4.learner)).length === c4EvidenceBefore + 1);
  const foreign = await instanceWith('PRACTICE', 'EXAM_PRACTICE', 'STUDENT');
  check('an attempt that is not the instance\'s own is refused', JSON.stringify(await completeAssessmentEvidence({ record: prep.record, studentId: student, attemptRef: foreign.attempt, responses: [] }, noGaps)) === JSON.stringify({ ok: false, reason: 'ATTEMPT_NOT_BOUND_TO_SNAPSHOT' }));

  // OFFICIAL_EXAM: derived-only items -> score valid, no learning evidence
  const officialBank = [bank('off-1', 'lo-1', ['C1', 'C2'], false), bank('off-2', 'lo-2', ['C4'], false)];
  const positions = [0, 1].map((index) => ({ index, blueprintObjectiveTargetId: `bot-${index}`, assessmentComponentId: component, learningObjectiveId: `lo-${index + 1}`, questionType: null, difficultyRange: null }));
  const officialFrozen = freezeAssessment({ solution: solveOfficialBlueprint({ policy: { studentId: student, examTargetId: profile, examVersionId: version, blueprintId: null, positions }, coverages: officialBank }), coverages: officialBank, studentId: student, createdAt: AS_OF, path: 'REDUCED_MOCK', exam });
  const official = await instanceWith('MOCK', 'REDUCED_MOCK', 'STUDENT');
  await persistAssessmentSnapshot(official.record, officialFrozen);
  const totalBefore = Number((await one(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [student])).n);
  const officialRun = await completeAssessmentEvidence({ record: official.record, studentId: student, attemptRef: official.attempt, responses: officialFrozen.items.map((i) => scored(i.key, 1)) }, noGaps);
  const totalAfter = Number((await one(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [student])).n);
  check('official exam, derived-only coverage: score valid (4 of 4 marks) and NO learning evidence written', officialRun.ok && officialRun.state.score.marks?.obtained === 4 && officialRun.state.score.marks?.available === 4 && totalAfter === totalBefore && officialRun.state.learnerEvidence === 'NONE');
  check('the B4 result view renders it as "score available, attribution unavailable"', officialRun.ok && resultViewOf(officialRun.state).learningAttribution === 'UNAVAILABLE');

  // TECHNICAL_DEMO: explicit attribution and a perfect score still produce nothing
  const demoBank = [bank('demo-1', 'lo-1', ['C1'], true), bank('demo-2', 'lo-2', ['C4'], true)];
  const demoFrozen = freezeAssessment({ solution: solveOfficialBlueprint({ policy: { studentId: student, examTargetId: profile, examVersionId: version, blueprintId: null, positions }, coverages: demoBank }), coverages: demoBank, studentId: student, createdAt: AS_OF, path: 'REDUCED_MOCK', exam });
  const demo = await instanceWith('MOCK', 'REDUCED_MOCK', 'TECHNICAL_DEMO');
  await persistAssessmentSnapshot(demo.record, demoFrozen);
  const demoRun = await completeAssessmentEvidence({ record: demo.record, studentId: student, attemptRef: demo.attempt, responses: demoFrozen.items.map((i) => scored(i.key, 1)) }, noGaps);
  const totalDemo = Number((await one(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [student])).n);
  check('TECHNICAL_DEMO instance: scored, zero learner evidence rows', demoRun.ok && demoRun.state.learnerEvidence === 'NO_CONSEQUENTIAL_LEARNER_EVIDENCE' && totalDemo === totalAfter && demoRun.state.score.meanFraction === 1);

  /* ---------------- 7. unanswered questions are not evidence ---------------- */
  const recPartial = await session(`b5-${run}-partial`, 'topic_practice');
  const frozenPartial = learn([cached('u1', 'C1'), cached('u2', 'C4')], ['C1', 'C4'], 'CUSTOM_CONCEPT_PRACTICE');
  await persistAssessmentSnapshot(recPartial, frozenPartial);
  const c1Count = (await evidenceRows(concept.C1.learner)).length;
  const c4Count = (await evidenceRows(concept.C4.learner)).length;
  const answeredKey = frozenPartial.items.find((i) => i.coverage.some((x) => x.canonicalConceptId === C('C1')))!.key;
  const openKey = frozenPartial.items.find((i) => i.key !== answeredKey)!.key;
  const partial1 = await completeAssessmentEvidence({ record: recPartial, studentId: student, attemptRef: recPartial.id, responses: [scored(answeredKey, 1), { itemKey: openKey, responseRef: null, status: 'UNANSWERED', fraction: null }] }, { log: () => undefined });
  check('abandoned / partial attempt: evidence only for the answered question', partial1.ok && (await evidenceRows(concept.C1.learner)).length === c1Count + 1 && (await evidenceRows(concept.C4.learner)).length === c4Count);
  // resume: the same snapshot is loaded; completing later adds only what was missing
  const resumed = await loadAssessmentSnapshot(recPartial);
  check('resume loads the same frozen assessment (same id, same questions, same order)', resumed.ok && resumed.frozen.snapshotId === frozenPartial.snapshotId && JSON.stringify(executionRefs(resumed.frozen)) === JSON.stringify(executionRefs(frozenPartial)));
  const partial2 = await completeAssessmentEvidence({ record: recPartial, studentId: student, attemptRef: recPartial.id, responses: [scored(answeredKey, 1), scored(openKey, 1)] }, { log: () => undefined });
  check('completion after resume: the answered concept is not written again, the new one is', partial2.ok && (await evidenceRows(concept.C1.learner)).length === c1Count + 1 && (await evidenceRows(concept.C4.learner)).length === c4Count + 1);

  /* ---------------- 8. one start authority: new vs resume, and execution authority ---------------- */
  const { startLearningAssessment, executionAuthorityOfQuizSession, executionAuthorityOfExamAttempt } = await import('@/lib/assessment-execution/assessment-start.service');
  const candidate = async (k: string, text: string) =>
    (await one(
      `INSERT INTO question_bank_candidates (student_id, concept_id, activity_type, language, academic_context, academic_context_fingerprint, difficulty, question_type, answer_format, question, content_fingerprint, template_signature, validation_status, generator_prompt_version)
       VALUES ($1, $2, 'PRACTICE', 'es', '{}'::jsonb, $3, 3, 'multiple_choice', 'single_choice', $4::jsonb, $5, '{}'::jsonb, 'VALIDATED', 'b5-fixture') RETURNING id`,
      [student, concept[k].learner, `ctx-${run}`, JSON.stringify({ id: `fx-${k}`, type: 'multiple_choice', answerFormat: 'single_choice', question: text, correctAnswer: 'a', explanation: 'fixture' }), `fp-${run}-${k}-${text}`]
    )).id as string;
  const candC1 = await candidate('C1', 'Fixture question on C1');
  const candC4 = await candidate('C4', 'Fixture question on C4');
  // the earlier fixture sessions are finished: a completed session is never resumed
  await q(`UPDATE quiz_sessions SET status = 'completed', completed_at = now() WHERE student_id = $1`, [student]);
  let solves = 0;
  const solve = (async (_studentId: string, request: { intent: 'CUSTOM_CONCEPT_PRACTICE'; depth: 'QUICK'; canonicalConceptIds?: readonly string[] }) => {
    solves += 1;
    const coverages = [
      coverageOfLearningCacheItem({ candidateId: candC1, studentId: student, learnerConceptId: concept.C1.learner, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: identity('C1') }),
      coverageOfLearningCacheItem({ candidateId: candC4, studentId: student, learnerConceptId: concept.C4.learner, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: identity('C4') }),
    ];
    const ids = [...(request.canonicalConceptIds ?? [])];
    return { ok: true as const, coverages, solution: solveLearningBlueprint({ policy: { studentId: student, intent: request.intent, depth: request.depth, canonicalConceptIds: ids, needs: projectEvidenceNeeds(ids, [], policy, AS_OF) }, coverages, asOf: AS_OF }) };
  }) as never;
  const startInput = { studentId: student, request: { intent: 'CUSTOM_CONCEPT_PRACTICE' as const, depth: 'QUICK' as const, canonicalConceptIds: [C('C1'), C('C4')] }, asOf: AS_OF };
  const quiet = { solve, log: () => undefined };
  check('start is OFF unless the flag is on', JSON.stringify(await startLearningAssessment(startInput, { ...quiet })) === JSON.stringify({ ok: false, reason: 'DISABLED' }) && solves === 0);
  const started = await startLearningAssessment(startInput, { ...quiet, enabled: () => true });
  if (!started.ok) throw new Error(`start refused: ${started.reason}`);
  const startedRow = await one(`SELECT student_id, status, quiz_mode, activity_type, evidence_mode, questions, assessment_snapshot FROM quiz_sessions WHERE id = $1`, [started.record.id]);
  check('new start: ONE Blueprint Core call, a session created already frozen', solves === 1 && started.resumed === false && startedRow.assessment_snapshot?.snapshotId === started.snapshotId && startedRow.status === 'active');
  check('the session serves exactly the frozen questions, in the frozen order, each tied to its snapshot item', JSON.stringify(startedRow.questions.map((x: any) => x.assessmentItemKey)) === JSON.stringify(startedRow.assessment_snapshot.items.map((i: any) => i.key)) && startedRow.questions.length === started.questions);
  check('activity and evidence mode on the session are the frozen ones', startedRow.quiz_mode === 'topic_practice' && startedRow.activity_type === 'PRACTICE' && startedRow.evidence_mode === 'PRACTICE');
  const deliveries = Number((await one(`SELECT count(*)::int AS n FROM question_bank_deliveries WHERE quiz_session_id = $1`, [started.record.id])).n);
  const usage = await q(`SELECT usage_count FROM question_bank_candidates WHERE id = ANY($1::uuid[])`, [[candC1, candC4]]);
  check('delivery is recorded in the existing ledger and exposure is bumped', deliveries === 2 && usage.every((u) => Number(u.usage_count) === 1));
  const resumedStart = await startLearningAssessment(startInput, { ...quiet, enabled: () => true });
  check('resume: same request -> same session, same snapshot, and NO second selection', resumedStart.ok && resumedStart.resumed === true && resumedStart.record.id === started.record.id && resumedStart.snapshotId === started.snapshotId && solves === 1);
  const sessionsForStudent = Number((await one(`SELECT count(*)::int AS n FROM quiz_sessions WHERE student_id = $1 AND id LIKE 'quiz-b5-%'`, [student])).n);
  check('resume created no second session', sessionsForStudent === 1);
  check('execution authority: a started session is CANONICAL; a session without a snapshot is LEGACY', (await executionAuthorityOfQuizSession(started.record.id)) === 'CANONICAL' && (await executionAuthorityOfQuizSession((await session(`b5-${run}-legacy`, 'topic_practice')).id)) === 'LEGACY');
  const legacyInstance = await instanceWith('PRACTICE', 'EXAM_PRACTICE', 'STUDENT');
  check('execution authority of exam attempts: snapshot instance CANONICAL, plain instance LEGACY', (await executionAuthorityOfExamAttempt(prep.attempt)) === 'CANONICAL' && (await executionAuthorityOfExamAttempt(legacyInstance.attempt)) === 'LEGACY');
  // the started attempt completes through the loop, from its own stored snapshot
  const startedRun = await completeAssessmentEvidence({ record: started.record, studentId: student, attemptRef: started.record.id, responses: startedRow.questions.map((x: any) => scored(x.assessmentItemKey, 1)) }, { log: () => undefined });
  check('a started attempt completes through the canonical loop and writes its evidence once', startedRun.ok && startedRun.state.evidence.length === 2 && startedRun.state.evidence.every((e) => e.status === 'APPLIED') && startedRun.state.assessment.snapshotId === started.snapshotId);

  /* ---------------- summary ---------------- */
  const failed = checks.filter((c) => !c.ok);
  console.log(`\nREAL POSTGRES EVIDENCE LOOP: ${checks.length - failed.length} / ${checks.length} checks passed`);
  await db.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
