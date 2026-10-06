/**
 * G6 -- exam evidence isolation, on a LOCAL EPHEMERAL Postgres only (127.0.0.1 / localhost), after the full
 * migration chain + track-b-v2-apply --write + track-b-v2-learning-catalog --write
 * (exam-platform-v2-migration-chain-cert.sh step [10]).
 *
 * Primary scenario (real writers and readers, no mocks): one independent Student, two targets that share
 * canonical concepts (PAA and PISA 2022 share 16 in the governed catalogue).
 *   1. both targets started; the shared concepts are in the Student's plan ("Añadir a mi plan")
 *   2. PISA needs its own diagnostic
 *   3. a real PAA attempt: recordSimulationItemResponse on PAA objectives mapped to SHARED concepts, completed + scored
 *   4. PISA re-resolved: still needs its diagnostic; Journey output byte-identical; no PAA gap / readiness / coverage
 *   5. PAA advanced from its own evidence; the Knowledge State kept the shared evidence (longitudinal)
 *   6. a PISA attempt: only PISA advances; PAA unchanged
 * plus legacy unscoped evidence, longitudinal Learning OS evidence, readiness snapshot, blueprint coverage,
 * examGapsFor domain, onboarding gate (technical / internal / retired / Student-valid targets), Blueprint OFF/SHADOW.
 *
 * Modes: G6_CERT_MODE=assert (default; exit 1 on any failed check) | observe (prints the same observations
 * without asserting -- used to reproduce the defect on the pre-G6 baseline).
 *
 * The QB capability flags `canRunDiagnostic` / `canPractice` are FORCED true for the plan / next-step / Journey
 * reads (harness assumption "PISA and PAA had Student content"); the ephemeral catalogue has DEV fixtures only,
 * which QB correctly never offers to a Student. Nothing else is overridden.
 */
import { createHash } from 'crypto';

const url = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  console.error(`REFUSED: ${url.hostname} is not a local ephemeral database`);
  process.exit(2);
}
const OBSERVE = process.env.G6_CERT_MODE === 'observe';

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

(async () => {
  process.env.EXAM_BLUEPRINT_V2 = 'OFF';
  process.env.STUDENT_JOURNEY_V2 = 'UX';
  const { db } = await import('@/lib/db');
  const { createObjectivePreparation, buildProfilePlan, objectiveCapabilities } = await import('@/lib/exam-core/objectives/preparation.service');
  const { nextStep } = await import('@/lib/exam-core/objectives/preparation-plan');
  const { objectiveForConfig } = await import('@/lib/exam-core/objectives/objective-catalog');
  const { getStudentExamProfile } = await import('@/lib/assessment/student-exam-profile.service');
  const { enrollCanonicalConcept } = await import('@/lib/learning-plan/personal-plan.service');
  const { startSimulationAttempt, completeSimulationAttempt } = await import('@/lib/simulation/attempt.service');
  const { recordSimulationItemResponse } = await import('@/lib/simulation/scoring.service');
  const { finalizeExamCompletion } = await import('@/lib/exam-core/post-completion');
  const { deriveExamGaps, getExamPreparationPlan } = await import('@/lib/learning-plan/exam-bridge.service');
  const { computeReadinessSnapshot } = await import('@/lib/readiness/readiness.service');
  const { examGapsFor } = await import('@/lib/exam-core/exam-gaps.service');
  const { loadStudentExamJourneyFacts } = await import('@/lib/exam-journey/facts.server');
  const { resolveStudentExamJourney } = await import('@/lib/exam-journey/resolver');
  const { loadGateState } = await import('@/lib/student/onboarding-gate.server');
  const { bridgeExamResponseToEvidence } = await import('@/lib/assessment/evidence-bridge.service');
  const { updateMastery } = await import('@/services/mastery.service');
  const { runDiagnosis } = await import('@/lib/diagnostics/diagnosis.service');
  const { fetchEvidenceForDiagnosis } = await import('@/lib/diagnostics/evidence-gate.service');

  // ------------------------------------------------------------ setup
  const newStudent = async (tag: string) => {
    const clerk = `g6-${tag}-${Date.now()}`;
    const user = (await db.query(`INSERT INTO users (clerk_id, email, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [clerk, `${clerk}@example.invalid`])).rows[0];
    await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'STUDENT', 'ACTIVE', 'SELF_REGISTRATION')`, [user.id]);
    const id = (await db.query(`INSERT INTO students (clerk_id, email, user_id) VALUES ($1, $2, $3) RETURNING id`, [clerk, `${clerk}@example.invalid`, user.id])).rows[0].id as string;
    // Same identity rows the real sign-in creates (src/lib/auth.ts): subjects reference profiles(id).
    await db.query(`INSERT INTO profiles (id, user_type, full_name, user_id) VALUES ($1, 'student', $2, $3)`, [id, clerk, user.id]);
    await db.query(`INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [id]);
    return { id, clerk };
  };
  const version = async (key: string) => (await db.query(`SELECT v.id FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE d.config_key = $1 AND v.status = 'PUBLISHED' ORDER BY v.created_at DESC LIMIT 1`, [key])).rows[0].id as string;
  const conceptsOf = async (key: string) =>
    new Set(
      (
        await db.query(
          `SELECT DISTINCT m.canonical_concept_id AS id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
             JOIN assessment_blueprints b ON b.exam_version_id = v.id JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
             JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED' WHERE d.config_key = $1`,
          [key]
        )
      ).rows.map((r: any) => r.id as string)
    );
  const PAA = 'v2.paa';
  const PISA = 'v2.pisa.2022';
  const [paaVersion, pisaVersion] = [await version(PAA), await version(PISA)];
  const [paaConcepts, pisaConcepts] = [await conceptsOf(PAA), await conceptsOf(PISA)];
  const shared = [...paaConcepts].filter((c) => pisaConcepts.has(c));
  check('setup: PAA and PISA share canonical concepts (governed mappings)', shared.length > 0, `${shared.length}`);

  const student = await newStudent('main');
  const paaObjective = objectiveForConfig(PAA)!;
  const pisaObjective = objectiveForConfig(PISA)!;
  // Dated targets: the Journey then decides on preparation (diagnostic), not on the missing date.
  const paa = (await createObjectivePreparation(student.id, { objectiveKey: paaObjective.key, examDate: '2027-01-10' })).profile;
  const pisa = (await createObjectivePreparation(student.id, { objectiveKey: pisaObjective.key, examDate: '2027-01-10' })).profile;
  // The Student added the shared concepts to their plan (one learner concept per canonical concept).
  for (const c of shared) await enrollCanonicalConcept(student.id, c, { type: 'SELF_SELECTED' });

  // Harness: Student content assumed for both exams (see header); everything else is the real capability.
  const capsOf = async (o: typeof paaObjective) => ({ ...(await objectiveCapabilities(o)), canRunDiagnostic: true, canPractice: true });
  const [paaCaps, pisaCaps] = [await capsOf(paaObjective), await capsOf(pisaObjective)];
  const planOf = async (profileId: string, o: typeof paaObjective, caps: any) => buildProfilePlan(student.id, (await getStudentExamProfile(profileId))!, o, caps);
  const stepOf = (plan: any, diagnosticDone = false) => nextStep({ openAttemptId: null, plan, canPractice: true, canRunDiagnostic: true, diagnosticDone, canViewStructure: true, canPlanDiploma: false, hasExamDate: false }).kind;
  const journeyOf = async (profileId: string) => {
    const facts = (await loadStudentExamJourneyFacts(student.id, '2026-10-05')).find((f) => f.target?.examTargetId === profileId)!;
    return resolveStudentExamJourney({ ...facts, content: facts.content ? { ...facts.content, practice: true, diagnostic: true } : facts.content });
  };
  /** Top-level resolution fields that differ (for a readable failure detail). */
  const diffKeys = (a: any, b: any) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(a[k]).slice(0, 160)} => ${JSON.stringify(b[k]).slice(0, 160)}`).join(' || ');
  /**
   * The resolution without its TRANSPARENCY fields: `readinessStatus.crossExamEvidenceRisk` and the
   * CROSS_EXAM_EVIDENCE_RISK reason report that a concept's ONE longitudinal Knowledge State now also holds
   * another exam's attempt evidence (a genuinely shared, non-exam field). Every decision field stays.
   */
  const decisions = (r: any) => ({ ...r, readinessStatus: { ...r.readinessStatus, crossExamEvidenceRisk: undefined }, resolutionReasons: r.resolutionReasons.filter((x: any) => x.code !== 'CROSS_EXAM_EVIDENCE_RISK') });
  const summary = (p: any) => (p ? `counts=${JSON.stringify(p.counts)} coverage=${p.coverage.mappedWithEvidence}/${p.coverage.mapped}` : 'null');
  const pisaConceptGaps = async (opts: any) => (await deriveExamGaps([student.id], [...pisaConcepts], opts)).length;

  // ------------------------------------------------------------ 2. PISA before
  const pisaPlan0 = await planOf(pisa.id, pisaObjective, pisaCaps);
  const pisaStep0 = stepOf(pisaPlan0);
  const pisaJourney0 = await journeyOf(pisa.id);
  const paaPlan0 = await planOf(paa.id, paaObjective, paaCaps);
  check('2 PISA initially needs its diagnostic (plan next step)', pisaStep0 === 'DIAGNOSTIC', `${pisaStep0} ${summary(pisaPlan0)}`);
  check('2 PISA initially needs its diagnostic (Journey)', pisaJourney0.recommendedNextAction.kind === 'START_DIAGNOSTIC', `${pisaJourney0.state} / ${pisaJourney0.recommendedNextAction.kind}`);

  // ------------------------------------------------------------ 3. a real PAA attempt on shared concepts
  const paaTargets = (
    await db.query(
      `SELECT DISTINCT ON (t.learning_objective_id) t.learning_objective_id, t.assessment_component_id
         FROM assessment_blueprints b JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
         JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
        WHERE b.exam_version_id = $1 AND m.canonical_concept_id = ANY($2::uuid[])`,
      [paaVersion, shared]
    )
  ).rows as Array<{ learning_objective_id: string; assessment_component_id: string }>;
  const runAttempt = async (profileId: string, versionId: string, targets: typeof paaTargets, correctEvery: number) => {
    const { simulationAttempt, examAttempt } = await startSimulationAttempt({
      studentId: student.id, examProfileId: profileId, examVersionId: versionId, simulationType: 'FULL_MOCK', timingMode: 'UNTIMED', language: 'es',
      learningObjectiveIds: targets.map((t) => t.learning_objective_id),
    });
    let i = 0;
    for (const t of targets) {
      i += 1;
      await recordSimulationItemResponse({
        examAttemptId: examAttempt!.id, studentId: student.id, examVersionId: versionId, examTargetId: profileId,
        assessmentComponentId: t.assessment_component_id, learningObjectiveId: t.learning_objective_id,
        question: { id: `q-${i}`, conceptId: null, type: 'multiple_choice', question: '¿Cuánto es 2 + 2?', options: ['3', '4', '5', '6'], correctAnswer: '4', explanation: '2 + 2 = 4', difficulty: 3 } as any,
        studentAnswer: i % correctEvery === 0 ? '4' : '5', idempotencyKey: `g6-${profileId}-${i}`, targetIndex: i - 1,
      } as any);
    }
    await completeSimulationAttempt(simulationAttempt.id);
    await finalizeExamCompletion(simulationAttempt.id, student.id, 'g6-cert');
    return { simulationAttemptId: simulationAttempt.id, examAttemptId: examAttempt!.id };
  };
  const paaAttempt = await runAttempt(paa.id, paaVersion, paaTargets, 3); // 1 in 3 correct -> PAA gaps on shared concepts
  const paaEvidence = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE metadata->'examScope'->>'examTargetId' = $2)::int AS scoped FROM learning_evidence WHERE student_id = $1 AND source_type = 'EXAM_SIMULATION'`, [student.id, paa.id])).rows[0];
  check('3 the PAA attempt wrote EXAM_SIMULATION evidence on the shared concepts', paaEvidence.n > 0, `${paaEvidence.n} rows over ${paaTargets.length} objectives`);
  check('3 write path: every PAA evidence row carries its exam target (metadata.examScope)', paaEvidence.n > 0 && paaEvidence.scoped === paaEvidence.n, `${paaEvidence.scoped}/${paaEvidence.n}`);

  // ------------------------------------------------------------ 4. PISA after the PAA attempt
  const pisaPlan1 = await planOf(pisa.id, pisaObjective, pisaCaps);
  const pisaStep1 = stepOf(pisaPlan1);
  const pisaJourney1 = await journeyOf(pisa.id);
  check('T1 PAA evidence does not complete / skip the PISA diagnostic (plan next step)', pisaStep1 === 'DIAGNOSTIC', `${pisaStep1} ${summary(pisaPlan1)}`);
  check('T1 PISA requirement counts unchanged by PAA evidence', JSON.stringify(pisaPlan1?.counts) === JSON.stringify(pisaPlan0?.counts), `${summary(pisaPlan0)} -> ${summary(pisaPlan1)}`);
  check('T1/T14 PISA Journey output byte-identical after the PAA attempt', JSON.stringify(pisaJourney1) === JSON.stringify(pisaJourney0), `${pisaJourney0.recommendedNextAction.kind} -> ${pisaJourney1.recommendedNextAction.kind} ${diffKeys(pisaJourney0, pisaJourney1)}`);
  check('T5 PISA-scoped gaps ignore the PAA attempt', (await pisaConceptGaps({ examProfileId: pisa.id })) === 0, `${await pisaConceptGaps({ examProfileId: pisa.id })}`);
  const pisaExamPlan = await getExamPreparationPlan(student.id, pisa.id, 'es');
  const pisaGapConcepts = pisaExamPlan.areas.flatMap((a) => a.concepts).filter((c) => c.status === 'NEEDS_REINFORCEMENT').length;
  check('T5 getExamPreparationPlan(PISA) shows no PAA gap', pisaGapConcepts === 0, `${pisaGapConcepts} concepts NEEDS_REINFORCEMENT`);
  const pisaSnap = await computeReadinessSnapshot({ studentId: student.id, examProfileId: pisa.id, examVersionId: pisaVersion });
  check('T6 PISA readiness snapshot counts no PAA evidence', pisaSnap.evidenceCounts.total === 0 && pisaSnap.simulationHistoryUsed.length === 0, `evidence=${pisaSnap.evidenceCounts.total} sims=${pisaSnap.simulationHistoryUsed.length}`);
  check('T7 PISA blueprint coverage not satisfied by the PAA attempt', pisaSnap.blueprintCoverage.supportedAndEvidenced === 0, JSON.stringify(pisaSnap.blueprintCoverage));

  // ------------------------------------------------------------ 5. PAA advanced; Knowledge State longitudinal
  const paaPlan1 = await planOf(paa.id, paaObjective, paaCaps);
  check('T3 PAA advances from its own evidence', (paaPlan1?.coverage.mappedWithEvidence ?? 0) > (paaPlan0?.coverage.mappedWithEvidence ?? 0) && stepOf(paaPlan1) !== 'DIAGNOSTIC', `${summary(paaPlan0)} -> ${summary(paaPlan1)} next=${stepOf(paaPlan1)}`);
  check('T3 PAA-scoped gaps include the PAA attempt', (await deriveExamGaps([student.id], null, { examProfileId: paa.id })).some((g) => g.examAttemptId === paaAttempt.examAttemptId));
  const paaSnap = await computeReadinessSnapshot({ studentId: student.id, examProfileId: paa.id, examVersionId: paaVersion });
  check('T6 PAA readiness snapshot uses PAA evidence', paaSnap.evidenceCounts.total > 0 && paaSnap.simulationHistoryUsed.length === 1, `evidence=${paaSnap.evidenceCounts.total} sims=${paaSnap.simulationHistoryUsed.length}`);
  const ks = (await db.query(`SELECT count(*) FILTER (WHERE COALESCE(ks.evidence_count, 0) > 0)::int AS n FROM concept_knowledge_state ks WHERE ks.student_id = $1`, [student.id])).rows[0].n;
  check('T4 the Knowledge State keeps the shared PAA evidence (longitudinal)', ks > 0, `${ks} learner concepts with evidence`);
  const gapsAll = await deriveExamGaps([student.id]);
  check('T4/T11 unscoped (Learning OS) gap view still sees the PAA gaps, tagged with their target', gapsAll.length > 0 && gapsAll.every((g) => g.examProfileId === paa.id), `${gapsAll.length}`);

  // examGapsFor: the domain comes from the attempt's own version.
  const agg = await examGapsFor([student.id], { includePerStudent: false });
  const paaDomains = new Set((await db.query(`SELECT name FROM assessment_components WHERE exam_version_id = $1`, [paaVersion])).rows.map((r: any) => r.name as string));
  check('T8 examGapsFor domains belong to the attempt\'s exam version', agg.byDomain.length > 0 && agg.byDomain.every((d) => d.domain === '' || paaDomains.has(d.domain)), agg.byDomain.map((d) => `${d.exam}:${d.domain}`).join(' | '));

  // ------------------------------------------------------------ 6. a PISA attempt advances PISA only
  const pisaTargets = (
    await db.query(
      `SELECT DISTINCT ON (t.learning_objective_id) t.learning_objective_id, t.assessment_component_id
         FROM assessment_blueprints b JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
         JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
        WHERE b.exam_version_id = $1 AND m.canonical_concept_id = ANY($2::uuid[])`,
      [pisaVersion, shared]
    )
  ).rows as Array<{ learning_objective_id: string; assessment_component_id: string }>;
  const paaJourneyBefore = await journeyOf(paa.id);
  await runAttempt(pisa.id, pisaVersion, pisaTargets, 1); // all correct
  const pisaPlan2 = await planOf(pisa.id, pisaObjective, pisaCaps);
  check('T2 PISA-scoped evidence advances PISA', (pisaPlan2?.coverage.mappedWithEvidence ?? 0) > (pisaPlan1?.coverage.mappedWithEvidence ?? 0) && stepOf(pisaPlan2) !== 'DIAGNOSTIC', `${summary(pisaPlan1)} -> ${summary(pisaPlan2)} next=${stepOf(pisaPlan2)}`);
  const paaJourneyAfter = await journeyOf(paa.id);
  check('T9/T14 PAA Journey decisions byte-identical after the PISA attempt', JSON.stringify(decisions(paaJourneyAfter)) === JSON.stringify(decisions(paaJourneyBefore)), diffKeys(decisions(paaJourneyBefore), decisions(paaJourneyAfter)));
  check('T9 the shared Knowledge State blend is reported on PAA, never hidden', paaJourneyAfter.readinessStatus.crossExamEvidenceRisk === true && paaJourneyAfter.resolutionReasons.some((x) => x.code === 'CROSS_EXAM_EVIDENCE_RISK'), JSON.stringify(paaJourneyAfter.resolutionReasons.find((x) => x.code === 'CROSS_EXAM_EVIDENCE_RISK')?.detail ?? null));

  // ------------------------------------------------------------ Phase 7: same exam, a new target (sequential)
  // Two ACTIVE targets of one exam cannot exist (uq_student_exam_profiles_one_active / _objective). The reachable
  // case is archive + re-create (e.g. retaking PAA next year). Decision: exam-requirement satisfaction is
  // TARGET-scoped -- the new target starts its own diagnostic; the old attempts stay with the old target; the
  // longitudinal Knowledge State is kept.
  {
    const { archiveExamProfile } = await import('@/lib/exam-core/prep-profile.service');
    const { listProfileAttempts } = await import('@/lib/exam-core/catalog.service');
    const archived = await archiveExamProfile(paa.id, { ownerStudentId: student.id, confirm: true, confirmInProgress: true });
    const paa2 = (await createObjectivePreparation(student.id, { objectiveKey: paaObjective.key, examDate: '2027-01-10' })).profile;
    check('P7 a re-created PAA target is a NEW target', paa2.id !== paa.id, `${(archived as any).status ?? JSON.stringify(archived).slice(0, 60)}`);
    const plan2 = await planOf(paa2.id, paaObjective, paaCaps);
    check('P7 the new PAA target does not inherit the archived target\'s exam evidence (own diagnostic)', stepOf(plan2) === 'DIAGNOSTIC' && plan2?.coverage.mappedWithEvidence === 0, `${stepOf(plan2)} ${summary(plan2)}`);
    check('P7 attempt history stays with the archived target', (await listProfileAttempts(paa.id)).length === 1 && (await listProfileAttempts(paa2.id)).length === 0);
    const ksAfter = (await db.query(`SELECT count(*) FILTER (WHERE COALESCE(ks.evidence_count, 0) > 0)::int AS n FROM concept_knowledge_state ks WHERE ks.student_id = $1`, [student.id])).rows[0].n;
    check('P7 the Knowledge State is kept across targets (longitudinal)', ksAfter >= ks, `${ks} -> ${ksAfter}`);
  }

  // ------------------------------------------------------------ legacy + longitudinal evidence (second Student)
  // A fresh learner with PISA only: one shared concept carries ONLY an unscoped legacy exam row (the F7 bridge
  // shape), another ONLY a Learning OS quiz row (longitudinal).
  {
    const s2 = await newStudent('legacy');
    const p2 = (await createObjectivePreparation(s2.id, { objectiveKey: pisaObjective.key })).profile;
    const [legacyCanonical, quizCanonical] = shared;
    const enrollOne = async (c: string) => (await enrollCanonicalConcept(s2.id, c, { type: 'SELF_SELECTED' })).learnerConceptId as string;
    const legacyConcept = await enrollOne(legacyCanonical);
    const quizConcept = await enrollOne(quizCanonical);
    const subjectOf = async (c: string) => (await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [c])).rows[0].subject_id as string;
    const lo = (await db.query(`SELECT learning_objective_id FROM objective_concept_mappings WHERE canonical_concept_id = $1 AND status = 'PUBLISHED' LIMIT 1`, [legacyCanonical])).rows[0].learning_objective_id;
    for (let i = 0; i < 4; i++) await bridgeExamResponseToEvidence({ studentId: s2.id, conceptId: legacyConcept, subjectId: await subjectOf(legacyConcept), learningObjectiveId: lo, result: 'correct', difficulty: 3, scorePercent: 100 });
    for (let i = 0; i < 4; i++)
      await updateMastery({ studentId: s2.id, conceptId: quizConcept, subjectId: await subjectOf(quizConcept), evidence: { sourceType: 'PRACTICE_QUIZ', result: 'correct', difficulty: 3, scorePercent: 100 }, telemetry: { activityType: 'quiz', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' } } as any);
    const plan = await buildProfilePlan(s2.id, (await getStudentExamProfile(p2.id))!, pisaObjective, pisaCaps);
    const labelOf = (canonical: string) => plan?.requirements.flatMap((r) => r.concepts).find((c) => c.canonicalConceptId === canonical)?.label;
    check('T10 legacy unscoped exam evidence does not satisfy a PISA requirement', labelOf(legacyCanonical) === 'NO_EVIDENCE', `${labelOf(legacyCanonical)}`);
    check('T11 Learning OS quiz evidence still counts for PISA (longitudinal knowledge)', labelOf(quizCanonical) !== 'NO_EVIDENCE', `${labelOf(quizCanonical)}`);
    const ks2 = (await db.query(`SELECT evidence_count FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2`, [s2.id, legacyConcept])).rows[0]?.evidence_count ?? 0;
    check('T11 legacy evidence stays in the Knowledge State', Number(ks2) > 0, `${ks2}`);
    // The diagnosis evidence reader: the Learning OS view (no target) vs a PISA-target diagnosis.
    const general = await fetchEvidenceForDiagnosis(s2.id, legacyConcept);
    const scoped = await (fetchEvidenceForDiagnosis as any)(s2.id, legacyConcept, undefined, { examTargetId: p2.id });
    check('T10/T11 general diagnosis reads the legacy evidence; a PISA-target diagnosis does not', general.length === 4 && scoped.length === 0, `general=${general.length} scoped=${scoped.length}`);
    await runDiagnosis({ studentId: s2.id, conceptId: legacyConcept, examTargetId: p2.id } as any); // the scoped path runs end to end
  }

  // ------------------------------------------------------------ onboarding gate (T12 / T13)
  {
    const make = async (name: string, status: string, configKey: string | null) => (await db.query(`INSERT INTO exam_definitions (name, exam_family, status, config_key) VALUES ($1, 'PAA', $2, $3) RETURNING id`, [name, status, configKey])).rows[0].id as string;
    const tech = await make('G6 technical', 'ACTIVE', `dev-cert.g6-${Date.now()}`);
    const internal = await make('G6 internal pilot', 'ACTIVE', null);
    const retired = await make('G6 retired', 'RETIRED', `v2.g6-retired-${Date.now()}`);
    const s3 = await newStudent('gate');
    for (const d of [tech, internal, retired]) await db.query(`INSERT INTO student_exam_profiles (student_id, exam_definition_id, status) VALUES ($1, $2, 'ACTIVE')`, [s3.id, d]);
    const g3 = await loadGateState(s3.clerk);
    check('T12 technical / internal / retired targets do not count as an exam target', g3?.examTargetCount === 0, `${g3?.examTargetCount}`);
    await createObjectivePreparation(s3.id, { objectiveKey: paaObjective.key });
    const g4 = await loadGateState(s3.clerk);
    check('T13 a Student-valid target still counts (independent exam onboarding without subjects)', g4?.examTargetCount === 1 && g4?.subjectCount === 0, `${g4?.examTargetCount} targets / ${g4?.subjectCount} subjects`);
    const hasGoal = (await db.query(`SELECT 1 FROM student_exam_profiles WHERE student_id = $1 AND ${(await import('@/lib/student/onboarding-gate')).VALID_EXAM_TARGET_PREDICATE} LIMIT 1`, [s3.id])).rows.length;
    check('T13 the bare predicate (first destination / onboarding bounce) agrees', hasGoal === 1);
  }

  // ------------------------------------------------------------ Blueprint OFF vs SHADOW (T15)
  process.env.EXAM_BLUEPRINT_V2 = 'SHADOW';
  const pisaShadow = await journeyOf(pisa.id);
  const pisaPlanShadow = await planOf(pisa.id, pisaObjective, pisaCaps);
  process.env.EXAM_BLUEPRINT_V2 = 'OFF';
  check('T15 Blueprint SHADOW: Journey and plan identical to OFF', JSON.stringify(pisaShadow) === JSON.stringify(await journeyOf(pisa.id)) && JSON.stringify(pisaPlanShadow) === JSON.stringify(await planOf(pisa.id, pisaObjective, pisaCaps)));

  // ------------------------------------------------------------ Saber unchanged (T16)
  const saberCaps = await objectiveCapabilities(objectiveForConfig('v2.saber11.math')!);
  check('T16 Saber: no full / reduced mock for Students (content NONE)', saberCaps.canRunFullMock === false && saberCaps.canRunReducedMock === false);

  await db.end?.();
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  console.log(JSON.stringify({ database: fp, mode: OBSERVE ? 'observe' : 'assert', checks }, null, 2));
  console.log(`G6_CERT ${checks.filter((c) => c.ok).length}/${checks.length}`);
  process.exit(OBSERVE || checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => {
  console.error('CERT_ERROR', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
