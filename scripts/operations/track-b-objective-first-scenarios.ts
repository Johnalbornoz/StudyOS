/**
 * Exam preparation, OBJECTIVE FIRST -- DEV scenarios with the REAL services
 * against the REAL DEV database (sections 70-80 of the spec).
 *
 *   70 catalogue-only objective        71 structure-only objective
 *   72 practice-ready (gap -> plan)    73 reduced mock (labels, coverage)
 *   74 full mock gate                  75 existing knowledge (no reset / duplicate)
 *   76 cross-exam reuse (shared knowledge; another exam's result is context only)
 *   77 multiple goals, one learner state
 *   78 independent Student             79 institutional context (suggest, never force)
 *   80 security (foreign, manipulated readiness, unavailable launch, scope, double submit)
 *
 * DEV ONLY (fingerprint guard). Fixtures (`tbo-<run>-…`, `@trackb.test`) are
 * removed at the end, including their telemetry rows.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-objective-first-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { upsertAcademicProfile } from '@/services/academic-profile.service';
import { resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';
import { createExamInstance, startExamInstance, ensureExamProfile, getExamInstance, toInstanceView } from '@/lib/exam-core/exam-instance.service';
import { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission } from '@/lib/simulation/item-resolution.service';
import { completeSimulationAttempt } from '@/lib/simulation/attempt.service';
import { scoreAndRecordAttemptResult } from '@/lib/exam-core/results.service';
import { getAttemptResultView } from '@/lib/exam-core/result-view.service';
import { addConceptToStudentLearning } from '@/lib/exam-core/catalog/learning-links.service';
import { archiveExamProfile, restartExamProfile } from '@/lib/exam-core/prep-profile.service';
import { resetStudentExamFixtures } from '@/lib/exam-core/dev-fixture-reset';
import { examGoalsFor } from '@/lib/exam-core/exam-gaps.service';
import { examObjectives, objectiveByKey } from '@/lib/exam-core/objectives/objective-catalog';
import { loadPickerData } from '@/lib/exam-core/objectives/picker';
import {
  allObjectiveCapabilities,
  createObjectivePreparation,
  getPreparationView,
  startPreparationDiagnostic,
  addConceptFromPreparation,
  updatePreparationDetails,
  PreparationError,
} from '@/lib/exam-core/objectives/preparation.service';
import type { ExamItem } from '@/lib/exam-core/items';
import type { ExamNavState } from '@/lib/exam-core/navigation-state';

const DEV_FP = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV_FP) throw new Error(`REFUSING: not the DEV database (${fp})`);
  return fp;
}
const count = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0]?.n ?? 0);
async function rejects(fn: () => Promise<unknown>, codeWanted: string) {
  try {
    await fn();
    return false;
  } catch (e: any) {
    return e?.code === codeWanted || e instanceof PreparationError && e.code === codeWanted;
  }
}

async function student(tag: string, ctx: { country?: string; curriculum?: string } = {}) {
  const clerk = `tbo-${RUN}-${tag}`;
  const email = `o-${tag}-${RUN}@trackb.test`;
  const user = await getOrCreateCanonicalUser(clerk, email);
  const studentId = await upsertStudentFromWebhook(clerk, email, `Track B objective ${tag}`);
  await assignSelfServiceRole(clerk, user.id, 'STUDENT');
  await upsertAcademicProfile(studentId, { countryOfStudy: ctx.country ?? 'CO', schoolYear: '11', curriculumType: ctx.curriculum ?? 'other', academicYear: '2026', profileCompleted: true } as any);
  return { user, studentId };
}

function wrong(item: ExamItem): string {
  const e = item.exam;
  if (e.parts) return JSON.stringify(Object.fromEntries(e.parts.map((p) => [p.id, p.answerFormat === 'math' ? '999999' : p.answerFormat === 'text' ? 'zzz' : (p.options ?? []).find((o) => o.id !== p.correctAnswer)!.id])));
  if (e.math) return '999999';
  if (item.answerFormat === 'single_choice') return (item.options ?? []).find((o) => o.id !== item.correctAnswer)!.id;
  if (item.answerFormat === 'multi_choice') return (item.options ?? []).filter((o) => !item.correctAnswer.split(',').includes(o.id)).map((o) => o.id).slice(0, 1).join(',') || 'A';
  return 'No sé.';
}
async function runAll(actor: string, simId: string, answer: (item: ExamItem) => string, max = 80) {
  for (let i = 0; i < max; i++) {
    const next = await getNextSimulationItem(actor, simId);
    if (next.outcome === 'BREAK') {
      await db.query(`UPDATE simulation_attempts SET navigation_state = jsonb_set(navigation_state, '{breakUntil}', 'null') WHERE id = $1`, [simId]);
      continue;
    }
    if (next.outcome !== 'ITEM_READY') break;
    const navState = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId])).rows[0].navigation_state as ExamNavState;
    const item = navState.items[String(next.targetIndex)].item!;
    const r = await submitSimulationItemAnswer(actor, simId, answer(item), `o:${simId}:${next.targetIndex}`, next.targetIndex);
    if (r.done) break;
  }
  await finalizeOpenItemsForSubmission(actor, simId);
  await completeSimulationAttempt(simId);
  return scoreAndRecordAttemptResult(simId);
}

/** DEV fixture: write a learner state for one of the Student's concepts (as the Learning Engine would have). */
async function setLearnerState(studentId: string, conceptId: string, subjectId: string, s: { mastery: string; readiness: string; memory?: string; dueDaysAgo?: number; transfer?: number }) {
  const policy = Number((await db.query(`SELECT COALESCE(max(version), 1) AS v FROM mastery_policies`).catch(() => ({ rows: [{ v: 1 }] }))).rows[0].v) || 1;
  await db.query(
    `INSERT INTO concept_knowledge_state (student_id, concept_id, subject_id, mastery_state, validation_readiness, evidence_count, independent_evidence_count, transfer_score, mastery_policy_version)
     VALUES ($1, $2, $3, $4, $5, 6, 4, $6, $7)
     ON CONFLICT (student_id, concept_id) DO UPDATE SET mastery_state = EXCLUDED.mastery_state, validation_readiness = EXCLUDED.validation_readiness, evidence_count = 6, transfer_score = EXCLUDED.transfer_score, updated_at = now()`,
    [studentId, conceptId, subjectId, s.mastery, s.readiness, s.transfer ?? null, policy]
  );
  if (s.memory) {
    await db.query(
      `INSERT INTO concept_memory_state (student_id, concept_id, policy_version, memory_status, next_review_at) VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (student_id, concept_id) DO UPDATE SET memory_status = EXCLUDED.memory_status, next_review_at = EXCLUDED.next_review_at`,
      [studentId, conceptId, s.memory, s.dueDaysAgo !== undefined ? new Date(Date.now() - s.dueDaysAgo * 86400000) : new Date(Date.now() + 30 * 86400000)]
    );
  }
}

async function main() {
  console.log(`track-b objective-first scenarios -- db ${guard()} -- run ${RUN}`);
  const caps = await allObjectiveCapabilities('es');
  const objectives = examObjectives();
  const statusOf = (k: string) => caps.get(k)!;

  // ================================================================ catalogue-level facts (metrics)
  const n = (pred: (k: string) => boolean) => objectives.filter((o) => pred(o.key)).length;
  console.log(
    `METRICS cataloged=${objectives.length} selectable=${objectives.length} structure=${n((k) => statusOf(k).canViewStructure && !statusOf(k).canPlanDiploma)} practice=${n((k) => statusOf(k).canPractice)} reduced=${n((k) => statusOf(k).canRunReducedMock)} full=${n((k) => statusOf(k).canRunFullMock)} planner=${n((k) => statusOf(k).canPlanDiploma)}`
  );

  // ================================================================ 78 independent Student / 70 CATALOG_ONLY
  const A = await student('indep');
  const picker = await loadPickerData(A.studentId, 'es');
  check('EXPLORER.all-objectives-selectable', picker.objectives.length === objectives.length && objectives.length === 153, `${picker.objectives.length}`);
  const catalogOnly = objectives.find((o) => o.framework === 'CIE_AS_A' && statusOf(o.key).readiness === 'CATALOG_ONLY')!;
  check('S70.catalog-only-shown-addable', picker.objectives.find((o) => o.key === catalogOnly.key)?.status === 'canAdd', catalogOnly.key);
  const p70 = await createObjectivePreparation(A.studentId, { objectiveKey: catalogOnly.key });
  check('S70.preparation-created-without-exam', p70.created && p70.profile.examDefinitionId === null && p70.profile.objectiveKey === catalogOnly.key);
  const p70b = await createObjectivePreparation(A.studentId, { objectiveKey: catalogOnly.key });
  check('S70.retry-same-preparation', p70b.profile.id === p70.profile.id && !p70b.created);
  const v70 = (await getPreparationView(A.studentId, p70.profile.id))!;
  check('S70.no-practice-no-mock', !v70.capabilities.canPractice && !v70.capabilities.canRunReducedMock && !v70.capabilities.canRunFullMock && !v70.capabilities.canRunDiagnostic);
  check('S70.capability-explained', v70.capabilities.unavailableReasons.some((r) => r.reason === 'NOT_CONFIGURED') && v70.plan === null && ['SET_GOAL_DETAILS', 'EXPLORE_LEARNING', 'REVIEW_STRUCTURE'].includes(v70.next.kind), v70.next.kind);
  check('S70.no-fabricated-curriculum', (await count(`SELECT count(*) n FROM subjects WHERE student_id = $1`, [A.studentId])) === 0);
  check('S70.telemetry-once', (await count(`SELECT count(*) n FROM analytics_events WHERE student_id = $1 AND event_name = 'exam_objective_selected' AND properties->>'objectiveKey' = $2 AND (properties->>'practiceAvailable')::boolean = false`, [A.studentId, catalogOnly.key])) === 1);
  check('S70.diagnostic-denied-server-side', await rejects(() => startPreparationDiagnostic(A.studentId, p70.profile.id), 'CAPABILITY_NOT_AVAILABLE'));
  await updatePreparationDetails(A.studentId, p70.profile.id, { examDate: '2027-06-01', targetQualification: 'AICE Diploma' });
  const r70 = await restartExamProfile(p70.profile.id, { ownerStudentId: A.studentId, confirm: true });
  const after = (await db.query(`SELECT objective_key, exam_date, target_qualification, status FROM student_exam_profiles WHERE id = $1`, [r70.newProfileId])).rows[0];
  check('S70.restart-keeps-objective-and-goal', after.objective_key === catalogOnly.key && after.status === 'ACTIVE' && !!after.exam_date && after.target_qualification === 'AICE Diploma');
  await archiveExamProfile(r70.newProfileId, { ownerStudentId: A.studentId, confirm: true });
  const readd = await createObjectivePreparation(A.studentId, { objectiveKey: catalogOnly.key });
  check('S70.remove-then-re-add-clean', readd.created && readd.profile.id !== r70.newProfileId && readd.profile.id !== p70.profile.id);

  // ================================================================ 71 STRUCTURE_ONLY
  const structureOnly = objectives.find((o) => o.key === 'ib.dp.economics.hl')!;
  const p71 = await createObjectivePreparation(A.studentId, { objectiveKey: structureOnly.key });
  const v71 = (await getPreparationView(A.studentId, p71.profile.id))!;
  check('S71.structure-visible', v71.capabilities.canViewStructure && (v71.objective.catalogParts.length > 0 || (v71.plan?.requirements.length ?? 0) > 0), `parts=${v71.objective.catalogParts.length} reqs=${v71.plan?.requirements.length ?? 0}`);
  check('S71.framework-visible', v71.objective.context.programme === 'IB Diploma Programme' && !!v71.objective.context.level);
  check('S71.practice-unavailable', !v71.capabilities.canPractice && v71.capabilities.unavailableReasons.some((r) => r.capability === 'PRACTICE' && (r.reason === 'STRUCTURE_ONLY' || r.reason === 'BANK_IN_PROGRESS')));
  check('S71.no-fake-items', (await resolveExamLevel('ib.dp.economics.hl', 'es')) === null && (await count(`SELECT count(*) n FROM exam_instances WHERE exam_profile_id = $1`, [p71.profile.id])) === 0);

  // ================================================================ 72 PRACTICE_READY: practice -> gap -> plan -> same learner state
  const X = await student('cross');
  const pPaa = await createObjectivePreparation(X.studentId, { objectiveKey: 'paa', examDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) });
  check('S72.paa-selectable-practice-available', pPaa.capabilities.canPractice && pPaa.capabilities.canRunDiagnostic);
  const area = (await resolveExamLevel('paa.practice.matematicas', 'es'))!;
  const prof = await ensureExamProfile(X.studentId, area.examDefinitionId, area.examVersionId);
  check('S72.activity-uses-the-same-preparation', prof === pPaa.profile.id);
  const inst = await createExamInstance({ studentId: X.studentId, examProfileId: prof, examVersionId: area.examVersionId, componentIds: area.components.map((c) => c.componentId), mode: 'PRACTICE' });
  const sim = (await startExamInstance(inst.id, { language: 'es' })).simulationAttemptId!;
  await runAll(X.user.id, sim, wrong);
  const v72 = (await getPreparationView(X.studentId, pPaa.profile.id))!;
  const gapReqs = v72.plan!.requirements.filter((r) => r.status === 'NEEDS_REINFORCEMENT');
  check('S72.gap-generated', gapReqs.length > 0 && gapReqs.every((r) => !!r.recommendation.gapExam), `${gapReqs.length} gaps`);
  const linear = gapReqs.find((r) => r.concepts.some((c) => c.name === 'Ecuaciones lineales')) ?? gapReqs.find((r) => r.recommendation.action === 'ADD_TO_PLAN');
  const ccId = linear!.concepts.find((c) => c.name === 'Ecuaciones lineales')?.canonicalConceptId ?? linear!.recommendation.canonicalConceptId!;
  check('S72.recommendation-add-to-plan-explained', linear!.recommendation.action === 'ADD_TO_PLAN' && linear!.recommendation.reasons.includes('EXAM_GAP') && linear!.priority.factors.includes('GAP_SEVERITY'));
  const conceptsBefore = await count(`SELECT count(*) n FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1`, [X.studentId]);
  check('S72.no-mass-enrolment', conceptsBefore === 0, `concepts=${conceptsBefore}`);
  const added = await addConceptFromPreparation(X.studentId, pPaa.profile.id, { learningObjectiveId: linear!.learningObjectiveId, canonicalConceptId: ccId, language: 'es' });
  const again = await addConceptFromPreparation(X.studentId, pPaa.profile.id, { learningObjectiveId: linear!.learningObjectiveId, canonicalConceptId: ccId, language: 'es' });
  check('S72.reinforce-once-same-learner-state', !added.alreadyStudying && again.alreadyStudying && again.studentConceptId === added.studentConceptId);
  check('S72.provenance-once', (await count(`SELECT count(*) n FROM exam_gap_concept_links WHERE student_id = $1 AND canonical_concept_id = $2`, [X.studentId, ccId])) === 1);
  const v72b = (await getPreparationView(X.studentId, pPaa.profile.id))!;
  check('S72.then-continue-reinforcing', v72b.plan!.requirements.find((r) => r.learningObjectiveId === linear!.learningObjectiveId)!.recommendation.action === 'CONTINUE_CONCEPT');

  // ================================================================ 76 CROSS EXAM: the PAA concept is the same learner state in PISA
  const pPisa = await createObjectivePreparation(X.studentId, { objectiveKey: 'pisa.2022' });
  const v76 = (await getPreparationView(X.studentId, pPisa.profile.id))!;
  const shared = v76.plan!.requirements.filter((r) => r.concepts.some((c) => c.canonicalConceptId === ccId));
  const sharedConcept = shared[0]?.concepts.find((c) => c.canonicalConceptId === ccId);
  check('S76.same-learner-state-reused', shared.length > 0 && sharedConcept?.learner?.studentConceptId === added.studentConceptId, `${shared.length} PISA requirements`);
  // Same content, different exam: the PAA gap is CONTEXT in PISA (to confirm in PISA's format), never a PISA gap.
  check('S76.other-exam-result-is-context-not-status', shared.every((r) => r.status === 'NEEDS_CONFIRMATION' && r.recommendation.gapExam === null && (r.recommendation.otherExam ?? '').startsWith('PAA') && r.recommendation.reasons.includes('OTHER_EXAM_GAP')), shared.map((r) => `${r.status}:${r.recommendation.reasons.join('+')}`).join(' '));
  check('S76.also-relevant-real-mapping', (sharedConcept?.alsoRelevantFor ?? []).some((x) => x.startsWith('PAA')), (sharedConcept?.alsoRelevantFor ?? []).join());
  check('S76.no-duplicate-concept', (await count(`SELECT count(*) n FROM concepts c JOIN subjects s ON s.id = c.subject_id JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id WHERE s.student_id = $1 AND m.canonical_concept_id = $2`, [X.studentId, ccId])) === 1);

  // ================================================================ 73 REDUCED MOCK (PISA)
  check('S73.preparation-selectable-reduced', v76.capabilities.canRunReducedMock && !v76.capabilities.canRunFullMock && v76.capabilities.reducedMocks.some((m) => m.nodeKey === 'pisa.2022.math' && m.lengthCoveragePercent === 27));
  const full = (await resolveExamLevel('pisa.2022.full', 'es'))!;
  const mockProf = await ensureExamProfile(X.studentId, full.examDefinitionId, full.examVersionId);
  const mock = await createExamInstance({ studentId: X.studentId, examProfileId: mockProf, examVersionId: full.examVersionId, componentIds: full.components.map((c) => c.componentId), mode: 'MOCK' });
  const mockView = await toInstanceView(mock);
  check('S73.mock-labelled-reduced', mockProf === pPisa.profile.id && mockView.form?.fidelity === 'REDUCED', `${mockView.form?.fidelity} ${mockView.form?.coveragePercent}%`);
  const ms = (await startExamInstance(mock.id, { language: 'es' })).simulationAttemptId!;
  await runAll(X.user.id, ms, wrong);
  const rv = (await getAttemptResultView(ms))!;
  check('S73.no-official-score-claim', rv.reporting?.scaleNote === 'NO_OFFICIAL_SCALE');

  // ================================================================ 74 FULL MOCK gate
  const fullObj = objectives.find((o) => statusOf(o.key).canRunFullMock)!;
  check('S74.full-mock-only-when-full-ready', !!fullObj && objectives.filter((o) => statusOf(o.key).canRunFullMock).every((o) => statusOf(o.key).readiness === 'FULL_MOCK_READY'), fullObj?.key);
  const practiceOnly = (await resolveExamLevel('paa.practice.matematicas', 'es'))!;
  check('S74.mock-on-practice-entry-denied', !practiceOnly.modes.includes('MOCK'));
  check('S74.catalog-only-launch-denied', (await resolveExamLevel(catalogOnly.nodeKey, 'es')) === null);

  // ================================================================ 75 EXISTING KNOWLEDGE (A transfer, B retain, C practice)
  const E = await student('known');
  // Three single-concept PISA requirements: the Student already studies those concepts.
  const tmpPisa = (await db.query(
    `SELECT m.canonical_concept_id AS id, cc.name FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
       JOIN assessment_blueprints b ON b.exam_version_id = v.id JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
       JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
       JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
      WHERE d.config_key = 'v2.pisa.2022'
        AND (SELECT count(*) FROM objective_concept_mappings m2 WHERE m2.learning_objective_id = t.learning_objective_id AND m2.status = 'PUBLISHED') = 1
      GROUP BY m.canonical_concept_id, cc.name ORDER BY cc.name LIMIT 3`
  )).rows as Array<{ id: string; name: string }>;
  const states = [
    { mastery: 'VALIDATED_MASTERY', readiness: 'READY', memory: 'STABLE', transfer: 0.9 },
    { mastery: 'VALIDATED_MASTERY', readiness: 'WAITING_FOR_RETENTION', memory: 'WAITING_FOR_RETENTION', dueDaysAgo: 2 },
    { mastery: 'DEVELOPING', readiness: 'INSUFFICIENT_EVIDENCE' },
  ];
  const known: Array<{ id: string; conceptId: string }> = [];
  for (let i = 0; i < tmpPisa.length; i++) {
    const a = await addConceptToStudentLearning(E.studentId, tmpPisa[i].id, 'es');
    await setLearnerState(E.studentId, a.studentConceptId, a.subjectId, states[i]);
    known.push({ id: tmpPisa[i].id, conceptId: a.studentConceptId });
  }
  const snapshot = async () => JSON.stringify((await db.query(`SELECT concept_id, mastery_state, validation_readiness, evidence_count, transfer_score FROM concept_knowledge_state WHERE student_id = $1 ORDER BY concept_id`, [E.studentId])).rows);
  const before = await snapshot();
  const conceptsE = await count(`SELECT count(*) n FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1`, [E.studentId]);
  const pE = await createObjectivePreparation(E.studentId, { objectiveKey: 'pisa.2022' });
  const vE = (await getPreparationView(E.studentId, pE.profile.id))!;
  check('S75.no-reset', (await snapshot()) === before);
  check('S75.no-duplicate', (await count(`SELECT count(*) n FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1`, [E.studentId])) === conceptsE && conceptsE === 3);
  const st = (cid: string) => vE.plan!.requirements.filter((r) => r.concepts.length === 1 && r.concepts[0].canonicalConceptId === cid).map((r) => r.status);
  check('S75.existing-evidence-reused', st(known[0].id).every((s) => s === 'ALREADY_STRONG') && st(known[1].id).every((s) => s === 'NEEDS_CONFIRMATION') && st(known[2].id).every((s) => s === 'NEEDS_CONFIRMATION') && st(known[0].id).length > 0, `${st(known[0].id)}|${st(known[1].id)}|${st(known[2].id)}`);
  const labelsE = vE.plan!.requirements.flatMap((r) => r.concepts).filter((c) => known.some((k) => k.id === c.canonicalConceptId)).map((c) => c.label);
  check('S75.what-you-know-labels', labelsE.includes('DEMONSTRATED') && labelsE.includes('MAINTENANCE') && labelsE.includes('IN_PROGRESS'), [...new Set(labelsE)].join());
  check('S75.strong-not-recommended', !vE.plan!.recommendations.some((r) => r.status === 'ALREADY_STRONG'));
  check('S75.no-evidence-not-weakness', vE.plan!.requirements.filter((r) => r.concepts.every((c) => !c.learner && !c.examEvidence) && !r.ownEvidence && r.concepts.length).every((r) => r.status === 'NO_EVIDENCE'));
  check('S75.prioritizes-gaps-and-no-evidence', vE.next.kind === 'DIAGNOSTIC' || vE.next.kind === 'CONTINUE_CONCEPT', vE.next.kind);
  check('S75.coverage-orientation', vE.plan!.coverage.mapped > 0 && vE.plan!.coverage.mappedWithEvidence >= 3, `${vE.plan!.coverage.mappedWithEvidence}/${vE.plan!.coverage.mapped}`);

  // Diagnostic: optional, samples the practice-ready areas, never duplicated.
  const [d1, d2] = await Promise.all([startPreparationDiagnostic(E.studentId, pE.profile.id), startPreparationDiagnostic(E.studentId, pE.profile.id)]);
  const diagRows = await count(`SELECT count(*) n FROM exam_instances WHERE exam_profile_id = $1 AND purpose = 'DIAGNOSTIC' AND status <> 'DELETED'`, [pE.profile.id]);
  const dInst = (await getExamInstance(d1.instanceId))!;
  check('S75.diagnostic-samples-areas-practice-mode', dInst.mode === 'PRACTICE' && dInst.componentIds.length === 3, `components=${dInst.componentIds.length}`);
  check('S80.diagnostic-double-submit-one', diagRows === 1 && d1.instanceId === d2.instanceId, `rows=${diagRows}`);
  const d3 = await startPreparationDiagnostic(E.studentId, pE.profile.id);
  check('S75.diagnostic-resumed-not-duplicated', d3.reused && d3.instanceId === d1.instanceId);

  // ================================================================ 77 MULTIPLE GOALS
  const pAice = await createObjectivePreparation(X.studentId, { objectiveKey: 'cie.aice.diploma' });
  const p9709 = await createObjectivePreparation(X.studentId, { objectiveKey: 'cie.asal.9709.as' });
  const active = await count(`SELECT count(*) n FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED'`, [X.studentId]);
  check('S77.multiple-preparations', active === 4 && pAice.capabilities.canPlanDiploma && !pAice.capabilities.canPractice, `active=${active}`);
  await archiveExamProfile(p9709.profile.id, { ownerStudentId: X.studentId, confirm: true });
  const v77 = (await getPreparationView(X.studentId, pPisa.profile.id))!;
  check('S77.no-cross-profile-corruption', v77.profile.status === 'ACTIVE' && (await getPreparationView(X.studentId, pPaa.profile.id))!.profile.status === 'ACTIVE' && v77.plan!.requirements.some((r) => r.concepts.some((c) => c.learner?.studentConceptId === added.studentConceptId)));

  // ================================================================ 79 INSTITUTIONAL / academic context
  const I = await student('inst', { country: 'US', curriculum: 'ib' });
  const pickI = await loadPickerData(I.studentId, 'es');
  check('S79.context-suggests-compatible', pickI.suggested.includes('IB_DP') && pickI.frameworks[0].key === 'IB_DP');
  check('S79.does-not-force-or-hide', pickI.objectives.length === objectives.length);
  const pI = await createObjectivePreparation(I.studentId, { objectiveKey: 'paa' });
  check('S79.unrelated-goal-allowed', pI.created);

  // ================================================================ 62/63 teacher / institution aggregates, scoped
  const goalsXI = await examGoalsFor([X.studentId, I.studentId], { includePerStudent: true });
  const goalsA = await examGoalsFor([A.studentId], { includePerStudent: false });
  check('S63.goals-aggregated', goalsXI.studentsPreparing === 2 && goalsXI.byObjective.find((o) => o.objectiveKey === 'paa')?.students === 2 && goalsXI.perStudent.length === 2);
  check('S80.aggregation-scoped', !goalsA.byObjective.some((o) => o.objectiveKey === 'paa') && goalsA.perStudent.length === 0);

  // ================================================================ 80 SECURITY
  check('S80.foreign-preparation-view', (await getPreparationView(A.studentId, pPaa.profile.id)) === null);
  check('S80.foreign-diagnostic', await rejects(() => startPreparationDiagnostic(A.studentId, pE.profile.id), 'NOT_FOUND'));
  check('S80.foreign-add-concept', await rejects(() => addConceptFromPreparation(A.studentId, pPaa.profile.id, { learningObjectiveId: linear!.learningObjectiveId, canonicalConceptId: ccId, language: 'es' }), 'NOT_FOUND'));
  check('S80.foreign-update', await rejects(() => updatePreparationDetails(A.studentId, pPaa.profile.id, { examDate: '2030-01-01' }), 'NOT_FOUND'));
  check('S80.requirement-not-in-preparation', await rejects(() => addConceptFromPreparation(X.studentId, pPisa.profile.id, { learningObjectiveId: linear!.learningObjectiveId, canonicalConceptId: ccId, language: 'es' }), 'REQUIREMENT_NOT_IN_PREPARATION') || shared.some((r) => r.learningObjectiveId === linear!.learningObjectiveId));
  check('S80.archived-preparation-inactive', await rejects(() => startPreparationDiagnostic(X.studentId, p9709.profile.id), 'NOT_ACTIVE'));
  const dup = await Promise.all([1, 2, 3].map(() => createObjectivePreparation(A.studentId, { objectiveKey: 'saber11' })));
  check('S80.double-submit-one-preparation', new Set(dup.map((d) => d.profile.id)).size === 1 && (await count(`SELECT count(*) n FROM student_exam_profiles WHERE student_id = $1 AND objective_key = 'saber11' AND status <> 'ARCHIVED'`, [A.studentId])) === 1);
  check('S80.unknown-objective', await rejects(() => createObjectivePreparation(A.studentId, { objectiveKey: 'not.an.objective' }), 'OBJECTIVE_NOT_FOUND'));
  check('S80.objective-catalog-consistent', !!objectiveByKey('pisa.2022') && caps.size === objectives.length);
}

const childRefs = new Map<string, { t: string; c: string }[]>();
async function refsTo(table: string) {
  if (!childRefs.has(table)) {
    const rows = (await db.query(
      `SELECT conrelid::regclass::text AS t, a.attname AS c FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND confrelid::regclass::text = $1 AND array_length(con.conkey, 1) = 1 AND conrelid::regclass::text <> $1`,
      [table]
    )).rows as { t: string; c: string }[];
    childRefs.set(table, rows);
  }
  return childRefs.get(table)!;
}
async function deleteCascade(table: string, col: string, ids: string[], depth = 0): Promise<void> {
  if (ids.length === 0 || depth > 8) return;
  for (const ch of await refsTo(table)) {
    let rowIds: string[] = [];
    try {
      rowIds = (await db.query(`SELECT id::text AS id FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids])).rows.map((r: any) => r.id);
    } catch {
      rowIds = [];
    }
    await deleteCascade(ch.t, ch.c, rowIds, depth + 1);
  }
  await db.query(`DELETE FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids]);
}

async function cleanup() {
  guard();
  const ids = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows.map((r: any) => r.id as string);
  const userIds = await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`tbo-${RUN}-%`]);
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`tbo-${RUN}-%`]);
  for (let pass = 0; pass < 4; pass++) {
    try {
      for (const sid of studentIds) await resetStudentExamFixtures({ studentId: sid, confirm: 'RESET-DEV-FIXTURES' }).catch(() => undefined);
      await deleteCascade('exam_gap_concept_links', 'student_id', studentIds);
      await deleteCascade('analytics_events', 'student_id', studentIds);
      await deleteCascade('concept_memory_state', 'student_id', studentIds);
      await deleteCascade('concept_knowledge_state', 'student_id', studentIds);
      await db.query(`UPDATE student_exam_profiles SET replaced_by_profile_id = NULL WHERE student_id = ANY($1::uuid[])`, [studentIds]);
      await deleteCascade('student_exam_profiles', 'student_id', studentIds);
      await deleteCascade('learning_evidence', 'student_id', studentIds);
      await deleteCascade('subjects', 'student_id', studentIds);
      await deleteCascade('student_academic_profile', 'student_id', studentIds);
      await db.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [userIds, userIds]);
      await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await deleteCascade('students', 'id', studentIds);
      await deleteCascade('profiles', 'user_id', userIds);
      await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
      break;
    } catch (e) {
      if (pass === 3) throw e;
    }
  }
  const left = (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id LIKE $1`, [`tbo-${RUN}-%`])) + (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id LIKE $1`, [`tbo-${RUN}-%`]));
  check('CLEANUP.no-fixtures-left', left === 0, `remaining=${left}`);
}

main()
  .catch((e) => check('RUN.error', false, e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
  .then(() => cleanup().catch((e) => check('CLEANUP.error', false, e instanceof Error ? e.message : String(e))))
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await db.end();
    process.exitCode = failed.length ? 1 : 0;
  });
