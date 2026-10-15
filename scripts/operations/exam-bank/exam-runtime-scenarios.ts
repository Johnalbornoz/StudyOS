/**
 * TRACK B -- the standardized exam runtime over the PERSISTED Certified Exam Bank. DEV and the Track B Preview candidate's own database.
 *
 * Drives real attempts through the Exam Core services (the same ones the Student routes call) for PAA Matemáticas:
 *   P  Exam Practice       the catalogue entry, a PRACTICE instance, delivery, scoring, evidence
 *   M  Reduced Mock        a MOCK instance of the Matemáticas component: a frozen form, delivery, scoring, evidence
 *   C  Challenge           a CHALLENGE instance of the Matemáticas component
 *   F  Full Mock           must NOT be available: the blueprint coverage is REDUCED
 *   E  eligibility         an item that stops being eligible is not served and a frozen form with it does not start
 *   X  the boundary        no provider call for a question, no Learning or Internal Assessment item touched
 *
 * Creates one clearly-marked fixture Student (clerk id `ebr-<run>`) and removes everything of theirs at the end.
 *
 *   EXAM_BANK_PUBLICATION_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/exam-bank/exam-runtime-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';

process.env.ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED = 'true';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';

/** Where this may run: DEV, and the Track B Preview candidate's own database (never the shared Preview database, never Production). */
const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4c249c68e0627b9f': 'PREVIEW_TRACK_B', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean }[] = [];
const check = (id: string, ok: boolean, detail = ''): void => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`); };

async function main(): Promise<void> {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (!TARGETS[fp] || process.env.EXAM_BANK_PUBLICATION_FP !== fp) throw new Error(`REFUSING: database ${fp} is not an authorised target`);
  const { db } = await import('@/lib/db');
  const { getOrCreateCanonicalUser } = await import('@/lib/identity/canonical-user.service');
  const { upsertStudentFromWebhook } = await import('@/lib/auth');
  const { refreshVersionHealth } = await import('@/lib/exam-core/question-bank/health.service');
  const { resolveExamLevel } = await import('@/lib/exam-core/catalog/structure.service');
  const { createExamInstance, startExamInstance, ensureExamProfile, getExamInstance, ExamInstanceError } = await import('@/lib/exam-core/exam-instance.service');
  const { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission, revealSimulationItemStrategy } = await import('@/lib/simulation/item-resolution.service');
  const { completeSimulationAttempt, getSimulationAttempt } = await import('@/lib/simulation/attempt.service');
  const { finalizeExamCompletion } = await import('@/lib/exam-core/post-completion');
  const { examAvailabilityForVersion } = await import('@/lib/assessment-experience/assessment-experience.service');
  const { findAnswerKeyLeak } = await import('@/lib/exam-core/items');
  const { enrollCanonicalConcept } = await import('@/lib/learning-plan/personal-plan.service');
  const { examBankDeliveryScope, certifiedSupplySql } = await import('@/lib/exam-bank/delivery-scope');
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);
  console.log(`exam runtime scenarios -- ${TARGETS[fp]} db ${fp} -- run ${RUN} -- scope ${examBankDeliveryScope()}`);

  const paa = await one(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = 'v2.paa'`);
  const math = await one(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND section_key = 'matematicas'`, [paa.version_id]);
  const objectives = (await db.query(`SELECT DISTINCT lo.id, lo.code FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id WHERE t.assessment_component_id = $1 ORDER BY lo.code`, [math.id])).rows as { id: string; code: string }[];
  const boundary = async () => one(`SELECT (SELECT count(*) FROM question_bank_candidates)::int AS learner_items, (SELECT count(*) FROM approved_items)::int AS approved_items, (SELECT count(*) FROM question_bank_items)::int AS bank_items, (SELECT count(*) FROM generation_jobs)::int AS generation_jobs, (SELECT count(*) FROM assessment_item_instances)::int AS instances`);
  const before = await boundary();
  const providerCalls = async (S: string) => n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1`, [S]);
  const questionProviderCalls = async (S: string) => n(`SELECT count(*)::int AS n FROM ai_execution_events WHERE student_id = $1 AND capability = 'QUESTION_GENERATION'`, [S]);

  // the bank's readiness is a stored snapshot: refreshed after a publication, never recomputed on a Student request
  const health = await refreshVersionHealth(paa.version_id);
  const mathHealth = health?.health.components.find((c: any) => c.sectionKey === 'matematicas') as any;
  check('H1  the bank health snapshot sees the persisted supply: Matemáticas practice ready, a REDUCED form assembles, a FULL form does not', !!mathHealth && mathHealth.practice === true && mathHealth.reducedAssembles === true && mathHealth.fullAssembles === false, JSON.stringify({ practice: mathHealth?.practice, reduced: mathHealth?.reducedAssembles, full: mathHealth?.fullAssembles, reducedForms: mathHealth?.reducedFormCapacity }));

  const clerk = `ebr-${RUN}`;
  const user = await getOrCreateCanonicalUser(clerk, `${clerk}@exam-bank.test`);
  const S = await upsertStudentFromWebhook(clerk, `${clerk}@exam-bank.test`, 'exam bank runtime cert');
  const actor = user.id as string;
  const { assignSelfServiceRole } = await import('@/lib/identity/role-assignment.service');
  await assignSelfServiceRole(clerk, actor, 'STUDENT');
  try {
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'exam bank runtime cert') ON CONFLICT (id) DO NOTHING`, [S]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [S]);
    // the Student owns the concepts the exam's objectives assess, so that an exam result has a concept to be evidence of
    const concepts = (await db.query(`SELECT DISTINCT m.canonical_concept_id AS id FROM objective_concept_mappings m WHERE m.learning_objective_id = ANY($1::uuid[]) AND m.status = 'PUBLISHED'`, [objectives.map((o) => o.id)])).rows as { id: string }[];
    for (const c of concepts) await enrollCanonicalConcept(S, c.id, { type: 'SELF_SELECTED', actorUserId: null }, null).catch(() => undefined);
    const learnerConcepts = (await db.query(`SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1`, [S])).rows.map((r: any) => r.id as string);
    console.log(`INFO  fixture Student ${S}: ${objectives.length} objectives, ${concepts.length} mapped canonical concepts, ${learnerConcepts.length} own concepts`);
    const learningEvidenceBefore = await n(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [S]);

    /** Drives one started attempt to its end with the SERVER-held key (the harness reads it; a client never can). */
    const drive = async (simId: string, pattern: (i: number) => boolean, reveal: (i: number) => boolean = () => false) => {
      const out = { delivered: 0, unavailable: 0, leak: null as string | null, approvedItemIds: [] as string[], objectiveOf: [] as string[], coached: 0, targets: new Set<number>(), strategyBeforeAsking: 0, revealed: 0, revealRefusals: [] as string[], reviews: [] as any[], noShortcut: 0, strategyTypes: new Set<string>() };
      for (let guard = 0; guard < 80; guard += 1) {
        const next = await getNextSimulationItem(actor, simId);
        if (next.outcome === 'COMPLETE') break;
        if (next.outcome !== 'ITEM_READY') { out.unavailable += 1; throw new Error(`unexpected ${next.outcome} at ${(next as any).targetIndex}: ${(next as any).reason ?? ''}`); }
        out.leak = out.leak ?? findAnswerKeyLeak(next);
        const state = (await one(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId])).navigation_state.items[String(next.targetIndex)];
        const item = state.item;
        out.approvedItemIds.push(item.exam.approvedItemId);
        out.objectiveOf.push(state.ctx.learningObjectiveId);
        // ---- Practice Coach: present only in coached practice; the strategy only after it was asked for
        if (next.coach) { out.coached += 1; out.targets.add(next.coach.timing.targetSeconds); if (next.coach.strategy) out.strategyBeforeAsking += 1; }
        if (reveal(out.delivered) || !next.coach) {
          try {
            const shown = await revealSimulationItemStrategy(actor, simId, next.targetIndex);
            out.revealed += 1; out.strategyTypes.add(shown.strategy.strategyType); if (shown.strategy.noReliableShortcut) out.noShortcut += 1;
            const again = await getNextSimulationItem(actor, simId, next.targetIndex);
            if (again.outcome !== 'ITEM_READY' || !again.coach?.assisted || !again.coach.strategy) throw new Error('a revealed strategy is not held on the attempt');
          } catch (e: any) { out.revealRefusals.push(String(e?.code ?? e?.message ?? e)); }
        }
        const answer = pattern(out.delivered) ? String(item.exam.acceptableAnswers?.[0] ?? item.correctAnswer) : '987654321';
        const submitted = await submitSimulationItemAnswer(actor, simId, answer, `ebr:${simId}:${next.targetIndex}`, next.targetIndex);
        if (submitted.speedReview) out.reviews.push(submitted.speedReview);
        out.delivered += 1;
      }
      return out;
    };
    const finish = async (simId: string) => {
      await finalizeOpenItemsForSubmission(actor, simId);
      await completeSimulationAttempt(simId);
      return finalizeExamCompletion(simId, S, 'exam-runtime-scenarios');
    };
    /** Every delivered item is a row of the Certified Exam Bank that resolves to an eligible certified instance of the right bucket. */
    const certifiedFacts = async (approvedItemIds: string[], objectiveIds: string[]) => {
      const rows = (await db.query(
        `SELECT ai.id, ai.learning_objective_id, lo.code, qi.lineage_class, i.blueprint_bucket_id, i.certification_state, i.certification_mode, i.item_type, i.item_difficulty, i.primary_concept_stable_id,
                (SELECT b.objective_code FROM assessment_blueprint_buckets b WHERE b.bucket_id = i.blueprint_bucket_id LIMIT 1) AS bucket_objective,
                EXISTS (SELECT 1 FROM student_eligible_item_instances_pilot e WHERE e.id = i.id) AS eligible
           FROM approved_items ai JOIN learning_objectives lo ON lo.id = ai.learning_objective_id JOIN question_bank_items qi ON qi.id = ai.bank_item_id LEFT JOIN assessment_item_instances i ON i.id = qi.item_instance_id
          WHERE ai.id = ANY($1::uuid[])`, [approvedItemIds])).rows as any[];
      const byId = new Map(rows.map((r) => [r.id as string, r]));
      const all = approvedItemIds.map((id) => byId.get(id));
      return {
        certified: all.every((r) => r && r.lineage_class === 'CORE_DERIVED' && r.eligible && r.item_type === 'EXAM_BANK_ITEM' && r.certification_state === 'AUTOMATED_CERTIFIED_PILOT' && r.certification_mode === 'INHERITED_DETERMINISTIC_CERTIFICATION'),
        rightBucket: all.every((r, k) => r && r.learning_objective_id === objectiveIds[k] && r.bucket_objective === r.code && Number(r.item_difficulty) >= 1 && Number(r.item_difficulty) <= 5),
        distinct: new Set(approvedItemIds).size === approvedItemIds.length,
        byObjective: all.reduce((m: Record<string, number>, r) => { m[r.code] = (m[r.code] ?? 0) + 1; return m; }, {}),
      };
    };
    // Evidence separation (EXAM_EVIDENCE_KNOWLEDGE_STATE): SEPARATED (default) -> exam evidence is Exam Readiness evidence
    // (exam_readiness_evidence), never Learning evidence; LEGACY -> the previous Learning evidence rows.
    const SEPARATED = (await import('@/lib/exam-readiness/exam-readiness-evidence.service')).examEvidenceKnowledgeStateMode() === 'SEPARATED';
    const readinessOf = async (examAttemptId: string) => (await db.query(`SELECT e.*, (qc.canonical_concept_id = e.canonical_concept_id) AS primary_concept FROM exam_readiness_evidence e LEFT JOIN question_bank_item_concepts qc ON qc.approved_item_id = e.approved_item_id AND qc.role = 'PRIMARY' WHERE e.student_id = $1 AND e.exam_attempt_id = $2`, [S, examAttemptId])).rows;
    const examEvidenceOf = async (examAttemptId: string) => (await db.query(`SELECT source_type, metadata, concept_id FROM learning_evidence WHERE student_id = $1 AND (metadata->'assessment'->>'examAttemptId' = $2 OR metadata->'context'->>'examAttemptId' = $2 OR metadata->>'examAttemptId' = $2 OR metadata::text LIKE '%' || $2 || '%')`, [S, examAttemptId])).rows as any[];

    /* ------------------------------------------------ P: Exam Practice ------------------------------------------------ */
    const cards = await examAvailabilityForVersion(paa.version_id);
    check('P0  Exam Prep: exam practice is offered from the certified bank; a mock is not offered on content counts alone; a challenge is not offered without calibrated difficulty', cards.evaluated && cards.eligibleQuestions > 0 && cards.options.find((o: any) => o.type === 'EXAM_PRACTICE')?.available === true && cards.options.find((o: any) => o.type === 'FULL_MOCK')?.available !== true && cards.options.find((o: any) => o.type === 'EXAM_CHALLENGE')?.available === false && cards.options.find((o: any) => o.type === 'EXAM_CHALLENGE')?.reason === 'DIFFICULTY_NOT_CALIBRATED', `eligible ${cards.eligibleQuestions}; ${cards.options.map((o: any) => `${o.type}:${o.available}`).join(' ')}`);
    const level = await resolveExamLevel('paa.practice.matematicas', 'es');
    const comp = level?.components.find((c: any) => c.componentId === math.id) as any;
    check('P1  the catalogue offers PAA Matemáticas practice (readiness from the bank snapshot, ENFORCE)', !!level && level.modes.includes('PRACTICE') && !!comp, level ? `modes ${level.modes.join(',')}; component ${comp?.readiness}` : 'node not selectable');
    const profileId = await ensureExamProfile(S, paa.definition_id, paa.version_id);
    const calls0 = await providerCalls(S);
    const practice = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: paa.version_id, componentIds: [math.id], mode: 'PRACTICE' });
    const pStarted = await startExamInstance(practice.id, { language: 'es' });
    check('P2  a practice instance is created and started', pStarted.status === 'IN_PROGRESS' && !!pStarted.simulationAttemptId, pStarted.status);
    const pSim = pStarted.simulationAttemptId!;
    const pRun = await drive(pSim, (i) => i % 4 !== 3);
    const pFacts = await certifiedFacts(pRun.approvedItemIds, pRun.objectiveOf);
    check('P3  every question is a Certified Exam Bank item with an eligible certified instance', pRun.delivered === 12 && pFacts.certified && pFacts.distinct, `${pRun.delivered} delivered ${JSON.stringify(pFacts.byObjective)}`);
    check('P4  each is of the blueprint position\'s own objective and bucket, with a 1-5 difficulty', pFacts.rightBucket);
    check('P5  no answer key reaches the client', pRun.leak === null, pRun.leak ?? '');
    const pDone = await finish(pSim);
    const pExamAttempt = (await getSimulationAttempt(pSim))!.examAttemptId;
    const pScore = await one(`SELECT count(*)::int AS responses, sum(score)::float AS earned, sum(max_score)::float AS available, count(*) FILTER (WHERE item_source = 'APPROVED_BANK' AND approved_item_id IS NOT NULL)::int AS from_bank FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [pExamAttempt]);
    check('P6  responses are scored deterministically: 9 of 12 right, as answered', Number(pScore.responses) === 12 && Number(pScore.earned) === 9 && Number(pScore.available) === 12 && Number(pScore.from_bank) === 12, JSON.stringify(pScore));
    check('P7  the attempt completes with a result', !!pDone.result && (await getSimulationAttempt(pSim))!.status === 'COMPLETED', JSON.stringify({ gap: pDone.gapRefresh }));
    const pEvidence = await examEvidenceOf(pExamAttempt);
    const classes = [...new Set(pEvidence.map((e) => `${e.source_type}/${e.metadata?.assessment?.supply?.family ?? '-'}/${e.metadata?.assessment?.supply?.evidenceClass ?? '-'}`))];
    const pReadiness = await readinessOf(pExamAttempt);
    if (SEPARATED) check('P8  evidence is EXAM_ASSESSMENT Exam Readiness evidence (one row per response, PAA, standardized exam) and NOT Learning evidence', pReadiness.length === 12 && pReadiness.every((e: any) => e.evidence_class === 'EXAM_ASSESSMENT' && e.system_id === 'PAA') && pEvidence.length === 0, `${pReadiness.length} readiness rows, ${pEvidence.length} learning rows`);
    else check('P8  evidence is written as EXAM_ASSESSMENT (standardized exam), on the Student\'s own concepts', pEvidence.length > 0 && pEvidence.every((e) => e.metadata?.assessment?.supply?.family === 'STANDARDIZED_EXAM' && e.metadata?.assessment?.supply?.evidenceClass === 'EXAM_ASSESSMENT' && e.metadata?.assessment?.supply?.itemCategory === 'EXAM_BANK_ITEM' && learnerConcepts.includes(e.concept_id)), `${pEvidence.length} rows ${classes.join(' ')}`);
    const conceptOk = await n(`SELECT count(*)::int AS n FROM exam_attempt_item_responses r JOIN question_bank_item_concepts ic ON ic.approved_item_id = r.approved_item_id AND ic.role = 'PRIMARY' JOIN concept_catalog_mapping m ON m.canonical_concept_id = ic.canonical_concept_id AND m.status = 'MATCHED' JOIN learning_evidence e ON e.concept_id = m.learner_concept_id AND e.student_id = $2 WHERE r.exam_attempt_id = $1 AND e.metadata::text LIKE '%' || $1 || '%'`, [pExamAttempt, S]).catch(() => -1);
    if (SEPARATED) check('P8b each response is evidence of the item\'s own certified concept (its PRIMARY attribution), not of every concept of the objective', pReadiness.filter((e: any) => e.primary_concept === true).length === 12, `${pReadiness.filter((e: any) => e.primary_concept === true).length} of ${pReadiness.length} on the PRIMARY concept`);
    else check('P8b each response is evidence of the item\'s own certified concept (its PRIMARY attribution), not of every concept of the objective', conceptOk >= 12 && pEvidence.length === 12, `${conceptOk} response-to-concept matches, ${pEvidence.length} evidence rows`);
    check('P9  no Learning or Internal Assessment evidence was written by the exam', (await n(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1 AND metadata->'assessment'->'supply'->>'family' IN ('LEARNING', 'INTERNAL_ASSESSMENT')`, [S])) === 0 && (await n(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [S])) === learningEvidenceBefore + pEvidence.length);
    check('P10 no provider was asked for a question', (await questionProviderCalls(S)) === 0, `provider calls of any kind during the attempt: ${(await providerCalls(S)) - calls0}`);
    check('P11 exposure is recorded: the 12 items are in this Student\'s history', (await n(`SELECT count(DISTINCT approved_item_id)::int AS n FROM exam_item_usage WHERE student_id = $1 AND approved_item_id = ANY($2::uuid[])`, [S, pRun.approvedItemIds])) === 12);
    const practice2 = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: paa.version_id, componentIds: [math.id], mode: 'PRACTICE' });
    const p2Sim = (await startExamInstance(practice2.id, { language: 'es' })).simulationAttemptId!;
    const p2Run = await drive(p2Sim, () => true, (i) => i < 12 && i % 4 === 0);
    await finish(p2Sim);
    const p2Exam = (await one(`SELECT exam_attempt_id FROM simulation_attempts WHERE id = $1`, [p2Sim])).exam_attempt_id as string;
    const p2Coach = (await db.query(`SELECT grading_detail->'coach' AS coach, score, max_score FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 ORDER BY target_index`, [p2Exam])).rows as { coach: any; score: string; max_score: string }[];
    const p2Evidence = await examEvidenceOf(p2Exam);
    check('S1  coached practice: every item shows a target time (65 s, OFFICIAL_DERIVED) and no strategy until it is asked for', p2Run.coached === 12 && [...p2Run.targets].join() === '65' && p2Run.strategyBeforeAsking === 0, `${p2Run.coached} coached, targets ${[...p2Run.targets]}`);
    check('S2  "Ver estrategia rápida" returns the item\'s certified strategy and is held on the attempt', p2Run.revealed === 3 && p2Run.revealRefusals.length === 0, `${p2Run.revealed} revealed ${[...p2Run.strategyTypes]} ${p2Run.revealRefusals}`);
    check('S3  a strategy opened before answering makes the response ASSISTED, stored with the exact inherited family', p2Coach.length === 12 && p2Coach.filter((r) => r.coach?.assisted === true).length === 3 && p2Coach.every((r) => r.coach?.strategy?.itemCertificationState === 'INHERITED_DETERMINISTIC' && r.coach.strategy.familyCertificationState === 'AUTOMATED_CERTIFIED_PILOT' && /^[a-f0-9]{64}$/.test(r.coach.strategy.strategyDigest) && typeof r.coach.elapsedSeconds === 'number'), `${p2Coach.filter((r) => r.coach?.assisted === true).length} assisted of ${p2Coach.length}`);
    check('S4  the score is unaffected (12 of 12) and each answer gets a time review with the certified method', p2Coach.every((r) => Number(r.score) === Number(r.max_score)) && p2Run.reviews.length === 12 && p2Run.reviews.filter((r) => r.assisted).length === 3 && p2Run.reviews.every((r) => r.correct && r.targetSeconds === 65 && r.strategy.fastPath.length > 0 && r.strategy.directPath.length > 0 && r.verdict), `${p2Run.reviews.length} reviews`);
    const p2Readiness = await readinessOf(p2Exam);
    if (SEPARATED) check('S5  assisted responses are not independent evidence: 9 independent Exam Readiness rows (3 ASSISTED) for 12 correct answers', p2Readiness.filter((e: any) => e.independent).length === 9 && p2Readiness.filter((e: any) => e.status === 'ASSISTED' && !e.independent).length === 3, `${p2Readiness.filter((e: any) => e.independent).length} independent, ${p2Readiness.filter((e: any) => e.status === 'ASSISTED').length} assisted`);
    else check('S5  assisted responses are not independent evidence: 9 EXAM_ASSESSMENT rows for 12 correct answers', p2Evidence.length === 9, `${p2Evidence.length} evidence rows`);
    // deterministic: read from the persisted bank an item whose family is NO_RELIABLE_SHORTCUT and resolve it as the runtime does
    const { coachOfItem } = await import('@/lib/exam-bank/strategies/coach');
    const { examItemFromApproved } = await import('@/lib/exam-core/items');
    const nsRows = (await db.query(`SELECT ai.id, ai.learning_objective_id, ai.content FROM approved_items ai JOIN question_bank_items qi ON qi.current_version_id = ai.id WHERE qi.lineage_class = 'CORE_DERIVED' AND ai.content->>'question' ~ '^Si x\\(' LIMIT 3`)).rows;
    const nsCoaches = nsRows.map((r: any) => { const it = examItemFromApproved(r); return it ? coachOfItem(it) : null; });
    const allRows = (await db.query(`SELECT ai.id, ai.learning_objective_id, ai.content FROM approved_items ai JOIN question_bank_items qi ON qi.current_version_id = ai.id JOIN exam_versions v ON v.id = qi.exam_version_id JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE qi.lineage_class = 'CORE_DERIVED' AND d.config_key = 'v2.paa' AND ai.status = 'PUBLISHED'`)).rows;
    const covered = allRows.filter((r: any) => { const it = examItemFromApproved(r); return !!it && !!coachOfItem(it); }).length;
    check('S6  NO_RELIABLE_SHORTCUT is a governed result: persisted items of that family resolve to it', nsRows.length === 3 && nsCoaches.every((c: any) => c?.strategy.strategyType === 'NO_RELIABLE_SHORTCUT'), `${nsCoaches.map((c: any) => c?.strategy.strategyId).join(',')}`);
    check('S6b every persisted PAA Matemáticas Exam Bank item resolves to a certified, proven strategy', allRows.length === 296 && covered === 296, `${covered} of ${allRows.length}`);
    check('P12 a second practice prefers items the Student has not met: none of the first 12 is repeated', p2Run.delivered === 12 && p2Run.approvedItemIds.every((id) => !pRun.approvedItemIds.includes(id)), `${p2Run.approvedItemIds.filter((id) => pRun.approvedItemIds.includes(id)).length} repeated`);

    /* ------------------------------------------------ M: Reduced Mock ------------------------------------------------ */
    const fullLevel = await resolveExamLevel('paa.full', 'es');
    console.log(`INFO  catalogue entry paa.full (the whole PAA: Lectura, Redacción, Matemáticas, Inglés) is ${fullLevel ? `offered with modes ${fullLevel.modes.join(',') || 'none'}` : 'not offered'}: a PAA mock in the catalogue is the whole package`);
    const mock = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: paa.version_id, componentIds: [math.id], mode: 'MOCK' });
    const mockRow = (await getExamInstance(mock.id))!;
    const mockSlots = (mockRow.form?.slots ?? []) as any[];
    check('M1  a Matemáticas mock freezes a complete form from the certified bank', mockRow.status === 'READY' && mockSlots.length === 12 && mockSlots.every((s) => !!s.approvedItemId), `${mockSlots.filter((s) => s.approvedItemId).length}/${mockSlots.length} positions`);
    const mStarted = await startExamInstance(mock.id, { language: 'es' });
    const mSim = mStarted.simulationAttemptId!;
    const mType = (await one(`SELECT simulation_type FROM simulation_attempts WHERE id = $1`, [mSim])).simulation_type;
    check('M2  it starts as a REDUCED mock -- never a full one', mType === 'REDUCED_MOCK', String(mType));
    const mRun = await drive(mSim, (i) => i % 2 === 0);
    const mFacts = await certifiedFacts(mRun.approvedItemIds, mRun.objectiveOf);
    const expectedByObjective = { 'paa.mat.algebra': 3, 'paa.mat.aritmetica': 3, 'paa.mat.datos': 2, 'paa.mat.geometria': 3, 'paa.mat.probabilidad': 1 } as Record<string, number>;
    check('M3  the 12 positions are the frozen form\'s items, certified, each of its own bucket (3 aritmética, 3 álgebra, 3 geometría, 2 datos, 1 probabilidad)', mRun.delivered === 12 && mFacts.certified && mFacts.rightBucket && mFacts.distinct && JSON.stringify(mRun.approvedItemIds) === JSON.stringify(mockSlots.map((s) => s.approvedItemId)) && Object.keys(expectedByObjective).every((k) => mFacts.byObjective[k] === expectedByObjective[k]), JSON.stringify(mFacts.byObjective));
    await finish(mSim);
    const mExamAttempt = (await getSimulationAttempt(mSim))!.examAttemptId;
    const mScore = await one(`SELECT count(*)::int AS responses, sum(score)::float AS earned FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [mExamAttempt]);
    const mEvidence = await examEvidenceOf(mExamAttempt);
    check('S7  a simulation shows no target, no strategy and refuses the reveal; nothing is ASSISTED', mRun.coached === 0 && mRun.revealed === 0 && mRun.reviews.length === 0 && mRun.revealRefusals.length === 12 && mRun.revealRefusals.every((c) => c === 'STRATEGY_NOT_AVAILABLE_IN_SIMULATION') && (await n(`SELECT count(*)::int AS n FROM exam_attempt_item_responses r JOIN simulation_attempts sa ON sa.exam_attempt_id = r.exam_attempt_id WHERE sa.id = $1 AND r.grading_detail->'coach'->>'assisted' = 'true'`, [mSim])) === 0, `${mRun.revealRefusals.length} refusals ${[...new Set(mRun.revealRefusals)]}`);
    check('M4  scored (6 of 12 right, as answered) and completed', Number(mScore.responses) === 12 && Number(mScore.earned) === 6 && (await getSimulationAttempt(mSim))!.status === 'COMPLETED', JSON.stringify(mScore));
    if (SEPARATED) { const r = await readinessOf(mExamAttempt); check('M5  evidence is EXAM_ASSESSMENT Exam Readiness evidence, not Learning evidence', r.length === 12 && r.every((e: any) => e.evidence_class === 'EXAM_ASSESSMENT') && mEvidence.length === 0, `${r.length} readiness rows, ${mEvidence.length} learning rows`); }
    else check('M5  evidence is EXAM_ASSESSMENT', mEvidence.length > 0 && mEvidence.every((e) => e.metadata?.assessment?.supply?.evidenceClass === 'EXAM_ASSESSMENT'), `${mEvidence.length} rows`);
    check('M6  the mock did not reuse an item this Student met in practice', mRun.approvedItemIds.every((id) => !pRun.approvedItemIds.includes(id) && !p2Run.approvedItemIds.includes(id)));

    /* ------------------------------------------------ C: Challenge ------------------------------------------------ */
    const challenge = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: paa.version_id, componentIds: [math.id], mode: 'CHALLENGE' });
    const cSlots = ((await getExamInstance(challenge.id))!.form?.slots ?? []) as any[];
    const cStarted = await startExamInstance(challenge.id, { language: 'es' });
    const cSim = cStarted.simulationAttemptId!;
    const cType = (await one(`SELECT simulation_type FROM simulation_attempts WHERE id = $1`, [cSim])).simulation_type;
    const cRun = await drive(cSim, () => true);
    const cFacts = await certifiedFacts(cRun.approvedItemIds, cRun.objectiveOf);
    const cDifficulty = (await db.query(`SELECT (ai.content->>'difficulty')::int AS d FROM approved_items ai WHERE ai.id = ANY($1::uuid[])`, [cRun.approvedItemIds])).rows.map((r: any) => Number(r.d));
    const mDifficulty = (await db.query(`SELECT (ai.content->>'difficulty')::int AS d FROM approved_items ai WHERE ai.id = ANY($1::uuid[])`, [mRun.approvedItemIds])).rows.map((r: any) => Number(r.d));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    check('C1  a Matemáticas challenge freezes a complete form and starts as EXAM_CHALLENGE', cSlots.length === 12 && cSlots.every((s) => !!s.approvedItemId) && cType === 'EXAM_CHALLENGE', `${cSlots.length} positions; ${cType}`);
    check('C2  its items are certified and of their own buckets', cRun.delivered === 12 && cFacts.certified && cFacts.rightBucket && cFacts.distinct, JSON.stringify(cFacts.byObjective));
    // What the Exam Core calls a challenge is a form whose CALIBRATED difficulty index is above the real exam's. A certified
    // item carries a 1-5 difficulty and no calibrated index, and none is invented for it: the challenge runs, but it is not
    // verifiably harder than a mock until calibration exists.
    const cForm = (await getExamInstance(challenge.id))!.form as any;
    check('C2b the challenge is honest about its difficulty: no calibrated index is claimed, and the form says the challenge band was not reached', cForm?.difficultyBandMet === false && (cForm?.notes ?? []).includes('CHALLENGE_BAND_NOT_REACHED') && (await n(`SELECT count(*)::int AS n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.lineage_class = 'CORE_DERIVED' AND (ai.difficulty_index IS NOT NULL OR ai.content ? 'difficultyIndex')`)) === 0, `form index ${cForm?.difficultyIndex}, band met ${cForm?.difficultyBandMet}; mean 1-5 difficulty challenge ${mean(cDifficulty).toFixed(2)} vs mock ${mean(mDifficulty).toFixed(2)}`);
    await finish(cSim);
    const cExamAttempt = (await getSimulationAttempt(cSim))!.examAttemptId;
    const cEvidence = await examEvidenceOf(cExamAttempt);
    const cReadiness = await readinessOf(cExamAttempt);
    if (SEPARATED) check('C3  scored 12 of 12, completed, evidence EXAM_ASSESSMENT Exam Readiness evidence', Number((await one(`SELECT sum(score)::float AS earned FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [cExamAttempt])).earned) === 12 && (await getSimulationAttempt(cSim))!.status === 'COMPLETED' && cReadiness.length === 12 && cEvidence.length === 0, `${cReadiness.length} readiness rows, ${cEvidence.length} learning rows`);
    else check('C3  scored 12 of 12, completed, evidence EXAM_ASSESSMENT', Number((await one(`SELECT sum(score)::float AS earned FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [cExamAttempt])).earned) === 12 && (await getSimulationAttempt(cSim))!.status === 'COMPLETED' && cEvidence.length > 0 && cEvidence.every((e) => e.metadata?.assessment?.supply?.evidenceClass === 'EXAM_ASSESSMENT'), `${cEvidence.length} evidence rows`);

    /* ------------------------------------------------ F: Full Mock ------------------------------------------------ */
    check('F1  the bank health says a FULL Matemáticas form does not assemble (55 official positions; the certified blueprint is REDUCED)', mathHealth?.fullAssembles === false && Number(mathHealth?.fullFormCapacity) === 0, `official ${mathHealth?.officialItemCount}, reduced positions ${mathHealth?.reducedPositions}`);
    check('F2  no attempt of this Student was ever started as FULL_MOCK', (await n(`SELECT count(*)::int AS n FROM simulation_attempts WHERE student_id = $1 AND simulation_type = 'FULL_MOCK'`, [S])) === 0);
    // The whole-PAA mock is the package of its four components: it is offered exactly when every one of them has
    // certified supply for a reduced form (Lectura, Redacción and Inglés got theirs from the PAA pilot publication).
    const everyComponentReady = (health?.health.components ?? []).length === 4 && (health?.health.components ?? []).every((c: any) => c.reducedAssembles === true);
    check('F3  the catalogue offers the whole-PAA mock exactly when all four components have certified supply for a reduced form', everyComponentReady ? !!fullLevel && fullLevel.modes.includes('MOCK') : !fullLevel || fullLevel.modes.length === 0, `${everyComponentReady ? 'all four ready' : 'not all ready'}; ${fullLevel ? `modes ${fullLevel.modes.join(',')}` : 'not offered'}`);

    /* ------------------------------------------------ E: eligibility is checked NOW ------------------------------------------------ */
    // a quality incident on one renderer envelope quarantines its instances: opened here, and resolved again below
    const frozen = await createExamInstance({ studentId: S, examProfileId: profileId, examVersionId: paa.version_id, componentIds: [math.id], mode: 'MOCK' });
    const frozenIds = (((await getExamInstance(frozen.id))!.form?.slots ?? []) as any[]).map((s) => s.approvedItemId as string);
    const victim = await one(`SELECT i.envelope_hash, count(*)::int AS n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id JOIN assessment_item_instances i ON i.id = qi.item_instance_id WHERE ai.id = ANY($1::uuid[]) GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [frozenIds]);
    const eligibleBefore = await n(`SELECT count(*)::int AS n FROM approved_items ai WHERE ai.id = ANY($1::uuid[]) AND ${certifiedSupplySql('ai')}`, [frozenIds]);
    const incident = (await one(`INSERT INTO assessment_envelope_incidents (envelope_hash, reason, opened_by) VALUES ($1, 'Runtime certification: a simulated quality incident, resolved by the same run.', $2) RETURNING id`, [victim.envelope_hash, `exam-runtime-scenarios:${RUN}`])).id;
    try {
      const eligibleDuring = await n(`SELECT count(*)::int AS n FROM approved_items ai WHERE ai.id = ANY($1::uuid[]) AND ${certifiedSupplySql('ai')}`, [frozenIds]);
      check('E1  an open incident on an envelope withdraws its items from delivery at once', eligibleBefore === 12 && eligibleDuring === 12 - Number(victim.n), `${eligibleBefore} -> ${eligibleDuring}`);
      let refused = '';
      try { await startExamInstance(frozen.id, { language: 'es' }); } catch (e) { refused = e instanceof ExamInstanceError ? e.code : String(e); }
      check('E2  a frozen form holding a withdrawn item does not start', refused === 'EXAM_CONTENT_NO_LONGER_ELIGIBLE', refused || 'it started');
    } finally {
      await db.query(`UPDATE assessment_envelope_incidents SET status = 'RESOLVED', resolved_by = $2, resolved_at = now() WHERE id = $1`, [incident, `exam-runtime-scenarios:${RUN}`]);
    }
    check('E3  with the incident resolved the same form is eligible again', (await n(`SELECT count(*)::int AS n FROM approved_items ai WHERE ai.id = ANY($1::uuid[]) AND ${certifiedSupplySql('ai')}`, [frozenIds])) === 12);
    check('E4  a deployment that is not told it is a pilot delivers none of the pilot-certified supply (scope defaults to PRODUCTION)', examBankDeliveryScope({}) === 'PRODUCTION' && (await n(`SELECT count(*)::int AS n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id AND qi.lineage_class = 'CORE_DERIVED' WHERE ${certifiedSupplySql('ai', 'PRODUCTION')}`)) === 0);

    /* ------------------------------------------------ X: the boundary ------------------------------------------------ */
    const after = await boundary();
    check('X1  the exam runtime wrote no Learning or Internal Assessment item, no Exam Bank row and queued no generation job', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
    check('X2  across four completed attempts (48 questions) no provider was asked for a question', (await questionProviderCalls(S)) === 0, `provider calls of any kind for this Student: ${await providerCalls(S)}`);
  } finally {
    const { cleanupFixtureStudent } = await import('./fixture-cleanup');
    const remaining = await cleanupFixtureStudent(db, S, actor);
    check('CLEANUP  the fixture Student and everything of theirs is removed', remaining === 0, `remaining rows ${remaining}`);
  }
  await db.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
