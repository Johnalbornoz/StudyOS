/**
 * Cambridge AICE + PISA 2022 -- DEV scenarios with the REAL services against
 * the REAL DEV database (or an ephemeral cert database).
 *
 * AICE: catalogue + routes, the Diploma plan (credits, groups, multi-group
 * choice, validation, series), recorded results (window, points, band only
 * with a valid composition), a 9709 Mock on an official route, the Learning
 * Bridge (no duplicates, EXAM_GAP provenance), aggregation scope, security.
 * PISA: practice by domain and by process, multi-source unit, open response,
 * the three-domain simulation (frozen, no help), results by domain, bridge,
 * delete + new attempt, explorer readiness states, security.
 *
 * DEV ONLY (fingerprint guard). Fixtures (`tbx-<run>-…`, `@trackb.test`) are
 * removed at the end; the V2 catalogue is applied by the operator scripts.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-aice-pisa-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { upsertAcademicProfile } from '@/services/academic-profile.service';
import { listStructureChildren, resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';
import { createExamInstance, startExamInstance, deleteExamInstance, newInstanceFromExisting, getExamInstance, ensureExamProfile, ExamInstanceError } from '@/lib/exam-core/exam-instance.service';
import { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission, SimulationItemAccessDeniedError } from '@/lib/simulation/item-resolution.service';
import { completeSimulationAttempt, getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { scoreAndRecordAttemptResult, getAttemptResult } from '@/lib/exam-core/results.service';
import { getAttemptResultView } from '@/lib/exam-core/result-view.service';
import { buildLearningBridge, reinforceFromExamGap } from '@/lib/exam-core/learning-bridge.service';
import { createPlan, addPlanEntry, updatePlanEntry, removePlanEntry, getPlanView, recordResult, AicePlanError } from '@/lib/exam-core/aice/plan.service';
import { examGapsFor } from '@/lib/exam-core/exam-gaps.service';
import { resetStudentExamFixtures } from '@/lib/exam-core/dev-fixture-reset';
import { findAnswerKeyLeak, type ExamItem } from '@/lib/exam-core/items';
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
  if (fp !== DEV_FP && process.env.TRACK_B_ALLOW_EPHEMERAL !== fp) throw new Error(`REFUSING: not the DEV database (${fp})`);
  return fp;
}
const count = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0]?.n ?? 0);
async function rejects(fn: () => Promise<unknown>, test: (e: any) => boolean = () => true) {
  try {
    await fn();
    return false;
  } catch (e) {
    return test(e);
  }
}
const code = (c: string) => (e: any) => e?.code === c;

async function student(tag: string, country = 'CO') {
  const clerk = `tbx-${RUN}-${tag}`;
  const email = `x-${tag}-${RUN}@trackb.test`;
  const user = await getOrCreateCanonicalUser(clerk, email);
  const studentId = await upsertStudentFromWebhook(clerk, email, `Track B x ${tag}`);
  await assignSelfServiceRole(clerk, user.id, 'STUDENT');
  await upsertAcademicProfile(studentId, { countryOfStudy: country, schoolYear: '11', curriculumType: 'other', academicYear: '2026', profileCompleted: true } as any);
  return { user, studentId };
}

function asStudentWould(math: { answers: string[]; significantFigures?: number; decimalPlaces?: number }): string {
  const raw = math.answers[0];
  const m = raw.match(/^(-?\d+(?:\.\d+)?)(\s+.*)?$/);
  if (!m || (math.significantFigures === undefined && math.decimalPlaces === undefined)) return raw;
  const v = Number(m[1]);
  const num = math.decimalPlaces !== undefined ? v.toFixed(math.decimalPlaces) : Number(v.toPrecision(math.significantFigures)).toString();
  const padded = math.significantFigures !== undefined && !Number.isInteger(Number(num)) ? v.toPrecision(math.significantFigures) : num;
  return padded + (m[2] ?? '');
}
function correct(item: ExamItem): string {
  const e = item.exam;
  if (e.parts) return JSON.stringify(Object.fromEntries(e.parts.map((p) => [p.id, p.answerFormat === 'math' ? asStudentWould(p.math!) : p.correctAnswer])));
  if (e.math) return asStudentWould(e.math);
  return item.correctAnswer ?? '';
}
function wrong(item: ExamItem): string {
  const e = item.exam;
  if (e.parts) return JSON.stringify(Object.fromEntries(e.parts.map((p) => [p.id, p.answerFormat === 'math' ? '999999' : p.answerFormat === 'text' ? 'zzz' : (p.options ?? []).find((o) => o.id !== p.correctAnswer)!.id])));
  if (e.math) return '999999';
  if (item.answerFormat === 'single_choice') return (item.options ?? []).find((o) => o.id !== item.correctAnswer)!.id;
  if (item.answerFormat === 'multi_choice') return (item.options ?? []).filter((o) => !item.correctAnswer.split(',').includes(o.id)).map((o) => o.id).slice(0, 1).join(',') || 'A';
  return 'No sé.';
}
async function nav(simId: string) {
  return (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId])).rows[0].navigation_state as ExamNavState;
}
async function run(actor: string, simId: string, answer: (item: ExamItem, i: number) => string, max = 80) {
  let leak: string | null = null;
  let breaks = 0;
  const delivered: ExamItem[] = [];
  for (let i = 0; i < max; i++) {
    const next = await getNextSimulationItem(actor, simId);
    if (next.outcome === 'BREAK') {
      breaks++;
      await db.query(`UPDATE simulation_attempts SET navigation_state = jsonb_set(navigation_state, '{breakUntil}', 'null') WHERE id = $1`, [simId]);
      continue;
    }
    if (next.outcome !== 'ITEM_READY') break;
    leak = leak ?? findAnswerKeyLeak(next);
    const item = (await nav(simId)).items[String(next.targetIndex)].item!;
    delivered.push(item);
    const r = await submitSimulationItemAnswer(actor, simId, answer(item, next.targetIndex), `x:${simId}:${next.targetIndex}`, next.targetIndex);
    if (r.done) break;
  }
  await finalizeOpenItemsForSubmission(actor, simId);
  await completeSimulationAttempt(simId);
  const result = await scoreAndRecordAttemptResult(simId);
  return { leak, breaks, delivered, result };
}

async function main() {
  console.log(`track-b AICE + PISA scenarios -- db ${guard()} -- run ${RUN}`);
  const A = await student('a');
  const B = await student('b');

  // ================================================================ AICE: catalogue + routes
  const groups = await listStructureChildren({ family: 'CAMBRIDGE', parentKey: 'cie.aice', language: 'es', audience: 'TECHNICAL_DEMO' });
  check('AICE.catalog-core-and-groups', groups.map((g) => g.key).join() === 'cie.aice.core,cie.aice.g1,cie.aice.g2,cie.aice.g3,cie.aice.g4', groups.map((g) => `${g.key}:${g.readiness}`).join(' '));
  const lvl = (await resolveExamLevel('cie.aice.g1.9709.as', 'es', { audience: 'TECHNICAL_DEMO' }))!;
  check('AICE.9709-as-components-and-routes', lvl.components.map((c) => c.name.split(' ').slice(0, 2).join(' ')).join('|') === 'Paper 1|Paper 2|Paper 4|Paper 5' && lvl.routes.length === 3 && lvl.routes.every((r) => r.key === 'AS_ONLY' && r.componentIds.length === 2), lvl.routes.map((r) => r.componentIds.length).join());
  const lvlA = (await resolveExamLevel('cie.aice.g1.9709.a', 'es', { audience: 'TECHNICAL_DEMO' }))!;
  check('AICE.9709-a-linear-and-staged', lvlA.routes.filter((r) => r.key === 'A_LEVEL_LINEAR').length === 2 && lvlA.routes.filter((r) => r.key === 'A_LEVEL_STAGED' && r.stage === 1).length === 3, `${lvlA.routes.length} options`);
  check('AICE.catalog-only-subject-not-startable', (await resolveExamLevel('cie.aice.g1.9990.a', 'es', { audience: 'TECHNICAL_DEMO' })) === null);

  // ================================================================ AICE: Diploma plan
  const plan = await createPlan(A.studentId);
  const plan2 = await createPlan(A.studentId);
  check('AICE.plan-created-once', plan.id === plan2.id);
  const e = (syllabusCode: string, level: 'AS' | 'A', extra: Record<string, unknown> = {}) => addPlanEntry(A.studentId, { syllabusCode, level, ...extra } as any);
  await e('9239', 'AS');
  await e('9709', 'A', { expectedSeries: { year: 2027, month: 6 } });
  await e('9093', 'AS');
  await e('9708', 'A');
  let v = await getPlanView(A.studentId);
  check('AICE.plan-6-of-7', v.planEvaluation.totalCredits === 6 && !v.planEvaluation.complete && v.planEvaluation.issues.some((i) => i.code === 'CREDITS_SHORT'), JSON.stringify(v.planEvaluation.groups.map((g) => [g.group, g.credits])));
  const psych = await e('9990', 'AS');
  v = await getPlanView(A.studentId);
  check('AICE.multi-group-needs-choice', v.entries.find((x) => x.syllabusCode === '9990')!.needsGroupChoice && v.planEvaluation.issues.some((i) => i.code === 'GROUP_NOT_CHOSEN'));
  await updatePlanEntry(A.studentId, psych.id, { countedGroup: 'GROUP_3' });
  v = await getPlanView(A.studentId);
  check('AICE.plan-complete-7-credits', v.planEvaluation.totalCredits === 7 && v.planEvaluation.complete && v.planEvaluation.coreIncluded, JSON.stringify(v.planEvaluation.groups.map((g) => [g.group, g.credits, g.satisfied])));
  check('AICE.entry-shows-code-level-credits-version-readiness', (() => { const m = v.entries.find((x) => x.syllabusCode === '9709')!; return m.level === 'A' && m.credits === 2 && m.syllabusVersion === '2026-2027' && m.readiness === 'REDUCED_MOCK_READY' && !!m.prepareNodeKey && m.expectedSeries?.month === 6; })());
  check('AICE.reject-level-not-offered', await rejects(() => e('8021', 'A'), code('LEVEL_NOT_OFFERED')));
  check('AICE.reject-group-not-eligible', await rejects(() => updatePlanEntry(A.studentId, psych.id, { countedGroup: 'GROUP_2' }), code('GROUP_NOT_ELIGIBLE')));
  check('AICE.reject-march-outside-india', await rejects(() => e('9702', 'AS', { expectedSeries: { year: 2027, month: 3 } }), code('SERIES_NOT_AVAILABLE')));
  check('AICE.reject-duplicate-subject', await rejects(() => e('9709', 'AS'), code('ALREADY_PLANNED')));
  check('AICE.foreign-entry-denied', await rejects(() => updatePlanEntry(B.studentId, psych.id, { level: 'A' }), code('NOT_FOUND')) && await rejects(() => removePlanEntry(B.studentId, psych.id), code('NOT_FOUND')));

  // ================================================================ AICE: results (governed) -> Diploma
  const rec = (syllabusCode: string, level: 'AS' | 'A', grade: string, year: number, month: 3 | 6 | 11) => recordResult({ studentId: A.studentId, syllabusCode, level, series: { year, month }, grade, source: 'DEV_FIXTURE', recordedByUserId: A.user.id });
  check('AICE.result-grade-validated', await rejects(() => rec('9093', 'AS', 'A*', 2026, 6), (x) => x instanceof AicePlanError && x.code === 'INVALID_GRADE'));
  await rec('9239', 'AS', 'b', 2026, 6);
  await rec('9709', 'A', 'A', 2027, 6);
  await rec('9093', 'AS', 'c', 2026, 11);
  await rec('9708', 'A', 'B', 2027, 6);
  await rec('9990', 'AS', 'a', 2026, 11);
  await rec('9702', 'AS', 'a', 2024, 6); // outside the window, never deleted
  v = await getPlanView(A.studentId);
  check('AICE.diploma-points-and-band', v.diploma.compositionValid && v.diploma.points === 50 + 120 + 40 + 100 + 60 && v.diploma.band === 'DISTINCTION', `${v.diploma.points} ${v.diploma.band}`);
  check('AICE.old-result-outside-window-kept', v.diploma.results.some((r) => r.syllabusCode === '9702' && r.status === 'OUTSIDE_WINDOW') && (await count(`SELECT count(*) n FROM cambridge_results WHERE student_id = $1`, [A.studentId])) === 6);
  // Excellent results but no Group 2 / Group 3 credit: no Diploma, whatever the points.
  const recB = (syllabusCode: string, level: 'AS' | 'A', grade: string) => recordResult({ studentId: B.studentId, syllabusCode, level, series: { year: 2027, month: 6 }, grade, source: 'DEV_FIXTURE', recordedByUserId: B.user.id });
  await recB('9239', 'AS', 'a');
  await recB('9709', 'A', 'A*');
  await recB('9702', 'A', 'A*');
  await recB('9701', 'A', 'A*');
  const vb = await getPlanView(B.studentId);
  check('AICE.points-but-group-missing-no-band', !vb.diploma.compositionValid && vb.diploma.band === null && vb.diploma.points === 0, vb.diploma.issues.map((i) => i.code).join());

  // ================================================================ AICE: 9709 Mock on an official route + bridge
  const prof = await ensureExamProfile(A.studentId, lvl.examDefinitionId, lvl.examVersionId);
  const route = lvl.routes.find((r) => r.componentIds.length === 2 && r.componentIds.every((id) => lvl.components.find((c) => c.componentId === id)?.name.startsWith('Paper 1') || lvl.components.find((c) => c.componentId === id)?.name.startsWith('Paper 4')))!;
  const mock = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: prof, examVersionId: lvl.examVersionId, componentIds: route.componentIds, mode: 'MOCK' });
  check('AICE.9709-mock-frozen-reduced', !!mock.formFrozenAt && mock.form?.fidelity === 'REDUCED', `${mock.form?.coveragePercent}%`);
  const ms = (await startExamInstance(mock.id, { language: 'en' })).simulationAttemptId!;
  const mnav = await nav(ms);
  check('AICE.9709-mock-no-help', mnav.policy?.itemFeedback === 'NEVER' && mnav.policy?.tutorAssistance === 'BLOCKED');
  const mr = await run(A.user.id, ms, (item, i) => (i === 0 ? wrong(item) : correct(item)));
  check('AICE.9709-mock-scored-math-engine', mr.result.maxScore > 0 && mr.result.rawScore < mr.result.maxScore && mr.leak === null && mr.breaks === 1, `${mr.result.rawScore}/${mr.result.maxScore}`);
  const mv = (await getAttemptResultView(ms))!;
  check('AICE.results-by-component-no-official-grade', mv.reporting?.scaleNote === 'NO_OFFICIAL_SCALE' && new Set(mv.objectives.filter((o) => o.classification !== 'NOT_ASSESSED').map((o) => o.componentId)).size === 2, `${mv.reporting?.groups.length} groups`);
  const mb = await buildLearningBridge({ simulationAttemptId: ms, studentId: A.studentId, objectives: mv.objectives });
  const add = mb.find((b) => b.action.kind === 'ADD_AND_REINFORCE');
  check('AICE.bridge-offers-concept', !!add, mb.map((b) => `${b.code}:${b.action.kind}`).join(' '));
  if (add && add.action.kind === 'ADD_AND_REINFORCE') {
    const before = await count(`SELECT count(*) n FROM canonical_concepts`);
    const r1 = await reinforceFromExamGap(A.studentId, { simulationAttemptId: ms, learningObjectiveId: add.learningObjectiveId, canonicalConceptId: add.action.canonicalConceptId, language: 'en' });
    const r2 = await reinforceFromExamGap(A.studentId, { simulationAttemptId: ms, learningObjectiveId: add.learningObjectiveId, canonicalConceptId: add.action.canonicalConceptId, language: 'en' });
    check('AICE.bridge-adds-once-same-learner-state', !r1.alreadyStudying && r2.alreadyStudying && r1.studentConceptId === r2.studentConceptId && (await count(`SELECT count(*) n FROM canonical_concepts`)) === before);
    check('AICE.bridge-exam-gap-provenance-once', (await count(`SELECT count(*) n FROM exam_gap_concept_links WHERE student_id = $1 AND canonical_concept_id = $2 AND source = 'EXAM_GAP'`, [A.studentId, add.action.canonicalConceptId])) === 1);
    const canonicalConceptId = add.action.canonicalConceptId;
    check('AICE.bridge-foreign-attempt-denied', await rejects(() => reinforceFromExamGap(B.studentId, { simulationAttemptId: ms, learningObjectiveId: add.learningObjectiveId, canonicalConceptId, language: 'en' }), code('NOT_FOUND')));
  }
  check('AICE.security-other-student-cannot-read-attempt', await rejects(() => getNextSimulationItem(B.user.id, ms), (x) => x instanceof SimulationItemAccessDeniedError));

  // ================================================================ PISA: catalogue + readiness states
  const pisaRoot = await listStructureChildren({ family: 'PISA', parentKey: 'pisa.2022', language: 'es', audience: 'TECHNICAL_DEMO' });
  // QB D3 (engine view, after the governed re-apply): PISA stops at PRACTICE_READY -- a competency benchmark, never a mock.
  check('PISA.domains-and-benchmark', pisaRoot.map((n) => n.key).join() === 'pisa.2022.full,pisa.2022.math,pisa.2022.reading,pisa.2022.science' && pisaRoot.every((n) => n.readiness === 'PRACTICE_READY'), pisaRoot.map((n) => `${n.key}:${n.readiness}`).join(' '));
  const reading = (await resolveExamLevel('pisa.2022.reading', 'es', { audience: 'TECHNICAL_DEMO' }))!;
  check('PISA.domain-detail', !!reading.description && reading.modes.join() === 'PRACTICE' && reading.bank?.items === 14 && reading.bank.lengthCoveragePercent === null);
  const ibEcon = await listStructureChildren({ family: 'IB', parentKey: 'ib.dp.economics', language: 'es', audience: 'TECHNICAL_DEMO' });
  check('READINESS.structure-only-shown-as-such', ibEcon.every((n) => n.readiness === 'STRUCTURE_READY' && !n.bankInProgress));

  // ================================================================ PISA: practice by process (Reading -> evaluate & reflect)
  const evalNode = (await resolveExamLevel('pisa.2022.reading.evaluate', 'es', { audience: 'TECHNICAL_DEMO' }))!;
  const pprof = await ensureExamProfile(A.studentId, evalNode.examDefinitionId, evalNode.examVersionId);
  const pi = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: pprof, examVersionId: evalNode.examVersionId, componentIds: evalNode.components.map((c) => c.componentId), mode: 'PRACTICE', focusObjectiveIds: evalNode.focusObjectiveIds });
  const ps = (await startExamInstance(pi.id, { language: 'es' })).simulationAttemptId!;
  check('PISA.practice-feedback-on', (await nav(ps)).policy?.itemFeedback === 'AFTER_EACH_ITEM');
  const pr = await run(A.user.id, ps, (item) => correct(item));
  const objIds = (await db.query(`SELECT DISTINCT learning_objective_id::text AS id FROM approved_items WHERE id = ANY($1::uuid[])`, [pr.delivered.map((d) => d.exam.approvedItemId)])).rows.map((r: any) => r.id);
  check('PISA.process-practice-only-focus', pr.delivered.length >= 3 && objIds.every((o) => evalNode.focusObjectiveIds.includes(o)), `${pr.delivered.length} items`);

  // ================================================================ PISA: three-domain simulation
  const full = (await resolveExamLevel('pisa.2022.full', 'es', { audience: 'TECHNICAL_DEMO' }))!;
  // QB D3: the three-domain entry is a competency benchmark (practice), and a MOCK is refused.
  check('PISA.benchmark-three-domains-fixed', full.componentsFixed && full.components.length === 3 && full.modes.join() === 'PRACTICE');
  check('PISA.mock-refused-competency-benchmark', await rejects(() => createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: pprof, examVersionId: full.examVersionId, componentIds: full.components.map((c) => c.componentId), mode: 'MOCK' }), code('MODE_NOT_AVAILABLE')));
  const sim = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: pprof, examVersionId: full.examVersionId, componentIds: full.components.map((c) => c.componentId), mode: 'PRACTICE' });
  const ss = (await startExamInstance(sim.id, { language: 'es' })).simulationAttemptId!;
  const frozen = JSON.stringify((await getExamInstance(sim.id))!.form);
  const snav = await nav(ss);
  check('PISA.benchmark-practice-three-domains', snav.policy?.itemFeedback === 'AFTER_EACH_ITEM' && snav.sections.map((s) => s.key).join() === 'math,reading,science');
  const sr = await run(A.user.id, ss, (item, i) => (i % 4 === 0 ? wrong(item) : correct(item)));
  check('PISA.benchmark-complete-no-regeneration', JSON.stringify((await getExamInstance(sim.id))!.form) === frozen && sr.leak === null && sr.result.maxScore > 0, `${sr.result.rawScore}/${sr.result.maxScore} breaks=${sr.breaks}`);
  check('PISA.simulation-shared-stimulus-units', sr.delivered.some((d) => d.exam.stimulus) && new Set(sr.delivered.filter((d) => d.exam.stimulus).map((d) => d.exam.stimulus!.key)).size >= 3);
  const sv = (await getAttemptResultView(ss))!;
  check('PISA.results-by-domain-no-pisa-score', sv.reporting?.scaleNote === 'NO_OFFICIAL_SCALE' && sv.reporting?.groups.map((g) => g.key).join() === 'math,reading,science');
  const sb = await buildLearningBridge({ simulationAttemptId: ss, studentId: A.studentId, objectives: sv.objectives });
  const padd = sb.find((b) => b.action.kind === 'ADD_AND_REINFORCE');
  check('PISA.bridge-mapped-gap', !!padd, sb.map((b) => `${b.code}:${b.action.kind}`).join(' '));
  if (padd && padd.action.kind === 'ADD_AND_REINFORCE') {
    const r1 = await reinforceFromExamGap(A.studentId, { simulationAttemptId: ss, learningObjectiveId: padd.learningObjectiveId, canonicalConceptId: padd.action.canonicalConceptId, language: 'es' });
    const again = await buildLearningBridge({ simulationAttemptId: ss, studentId: A.studentId, objectives: (await getAttemptResultView(ss))!.objectives });
    check('PISA.bridge-then-already-working', !r1.alreadyStudying && again.find((b) => b.learningObjectiveId === padd.learningObjectiveId)?.action.kind === 'REINFORCE');
  }
  // Teacher / institution aggregation: only the given Students
  const agg = await examGapsFor([A.studentId], { families: ['PISA'], includePerStudent: true });
  check('PISA.aggregation-scoped', agg.studentsWithResults === 1 && agg.perStudent.every((p) => p.studentId === A.studentId) && agg.byDomain.length > 0, `${agg.byObjective.length} objectives`);
  const none = await examGapsFor([B.studentId], { families: ['PISA'], includePerStudent: false });
  check('PISA.aggregation-other-tenant-empty', none.studentsWithResults === 0 && none.perStudent.length === 0);
  // Delete + new attempt from zero
  const ea = (await getSimulationAttempt(ss))!.examAttemptId;
  const before = await getAttemptResult(ea);
  await deleteExamInstance(sim.id, { confirm: true, ownerStudentId: A.studentId });
  check('PISA.delete-keeps-result', (await getAttemptResult(ea))?.responseSetHash === before?.responseSetHash && (await getExamInstance(sim.id))?.status === 'DELETED');
  check('PISA.foreign-delete-denied', await rejects(() => deleteExamInstance(pi.id, { confirm: true, ownerStudentId: B.studentId }), (x) => x instanceof ExamInstanceError && x.code === 'NOT_FOUND'));
  const again = await newInstanceFromExisting(sim.id, { contentAudience: 'TECHNICAL_DEMO' });
  check('PISA.new-attempt-fresh-ids', again.id !== sim.id && again.simulationAttemptId === null && again.mode === 'PRACTICE');
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
  const userIds = await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`tbx-${RUN}-%`]);
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`tbx-${RUN}-%`]);
  for (let pass = 0; pass < 4; pass++) {
    try {
      for (const sid of studentIds) await resetStudentExamFixtures({ studentId: sid, confirm: 'RESET-DEV-FIXTURES' }).catch(() => undefined);
      await deleteCascade('exam_gap_concept_links', 'student_id', studentIds);
      await deleteCascade('cambridge_results', 'student_id', studentIds);
      await deleteCascade('aice_diploma_plans', 'student_id', studentIds);
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
  const left = (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id LIKE $1`, [`tbx-${RUN}-%`])) + (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id LIKE $1`, [`tbx-${RUN}-%`]));
  check('CLEANUP.no-fixtures-left', left === 0, `remaining=${left}`);
}

main()
  .catch((e) => check('RUN.error', false, e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
  .then(() => cleanup().catch((e) => check('CLEANUP.error', false, e instanceof Error ? e.message : String(e))))
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    for (const f of failed) console.log(`FAILED: ${f.id} ${f.detail}`);
    await (db as any).end?.();
    process.exitCode = failed.length ? 1 : 0;
  });
