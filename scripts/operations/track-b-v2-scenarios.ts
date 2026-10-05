/**
 * Exam V2 -- DEV scenarios with the REAL services against the REAL DEV database
 * (or an ephemeral cert database): catalogue selection, Practice / Mock /
 * Challenge instances, frozen forms, math grading with method marks, strict
 * readiness, delete rules, retest novelty, the Exam -> Learning bridge, the
 * portfolio pipeline (upload -> scan -> thumbnail -> submission -> double
 * assessor), media security and the DEV fixture reset. Completion block: PAA
 * (full test, area / skill practice, results by area, Add-and-reinforce) and
 * IB sciences (Physics / Chemistry HL mocks, structure-only levels, CAS).
 *
 * Requires the operator steps first: track-b-v2-apply.ts --write and
 * track-b-v2-learning-catalog.ts --write (66 configurations are not re-applied here).
 *
 * DEV ONLY (fingerprint guard). Fixtures are clearly marked (`tb2-<run>-…`,
 * `@trackb.test`) and removed at the end; the V2 catalogue (verticals +
 * structure) is applied idempotently and kept.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-v2-scenarios.ts [--skip-ai]
 * (.env.local of the Track B worktree = DEV; it carries the media signing secret)
 */
import { createHash, randomBytes } from 'crypto';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { updateMastery } from '@/services/mastery.service';
import { V2_VERTICALS } from '@/lib/exam-core/verticals/v2';
import { listStructureFamilies, listStructureChildren, resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';
import { createExamInstance, startExamInstance, deleteExamInstance, newInstanceFromExisting, getExamInstance, ensureExamProfile, ExamInstanceError, toInstanceView, listExamInstances } from '@/lib/exam-core/exam-instance.service';
import { listProfileAttempts } from '@/lib/exam-core/catalog.service';
import { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission, SimulationItemAccessDeniedError, SimulationInvalidResponseError } from '@/lib/simulation/item-resolution.service';
import { completeSimulationAttempt, getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { scoreAndRecordAttemptResult, getAttemptResult } from '@/lib/exam-core/results.service';
import { getAttemptResultView } from '@/lib/exam-core/result-view.service';
import { buildLearningBridge, requestConceptForObjective } from '@/lib/exam-core/learning-bridge.service';
import { findAnswerKeyLeak, type ExamItem } from '@/lib/exam-core/items';
import { storeMedia, readMediaForOwner, MediaError } from '@/lib/exam-core/media/media.service';
import { loadPortfolioContext, addArtifact, getSubmissionView, SubmissionError } from '@/lib/exam-core/submissions/submission.service';
import { resetStudentExamFixtures } from '@/lib/exam-core/dev-fixture-reset';
import { addConceptToStudentLearning } from '@/lib/exam-core/catalog/learning-links.service';
import type { ExamNavState } from '@/lib/exam-core/navigation-state';

const DEV_FP = '2a29b99ee14a22b4';
const SKIP_AI = process.argv.includes('--skip-ai');
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
const created = { users: [] as string[] };

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}
function guard() {
  const fp = fingerprint();
  if (fp !== DEV_FP && process.env.TRACK_B_ALLOW_EPHEMERAL !== fp) throw new Error(`REFUSING: not the DEV database (${fp})`);
}
const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0]?.n ?? 0);
async function rejects(fn: () => Promise<unknown>, cls: new (...a: any[]) => Error, code?: string): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof cls && (!code || (e as any).code === code);
  }
}

async function student(tag: string) {
  const clerk = `tb2-${RUN}-${tag}`;
  const email = `${tag}-${RUN}@trackb.test`;
  const user = await getOrCreateCanonicalUser(clerk, email);
  created.users.push(user.id);
  const studentId = await upsertStudentFromWebhook(clerk, email, `Track B V2 ${tag}`);
  await assignSelfServiceRole(clerk, user.id, 'STUDENT');
  return { user, studentId };
}

/** A key answer written the way the key asks for it (significant figures / decimal places), keeping its unit. */
function asStudentWould(math: { answers: string[]; significantFigures?: number; decimalPlaces?: number }): string {
  const raw = math.answers[0];
  const m = raw.match(/^(-?\d+(?:\.\d+)?)(\s+.*)?$/);
  if (!m || (math.significantFigures === undefined && math.decimalPlaces === undefined)) return raw;
  const v = Number(m[1]);
  const num = math.decimalPlaces !== undefined ? v.toFixed(math.decimalPlaces) : Number(v.toPrecision(math.significantFigures)).toString();
  // toString drops trailing zeros a s.f. count needs (0.0800): pad back with toPrecision when the value is not an integer.
  const padded = math.significantFigures !== undefined && !Number.isInteger(Number(num)) ? v.toPrecision(math.significantFigures) : num;
  return padded + (m[2] ?? '');
}

/** The correct answer for a SERVER-HELD item (built from its key -- the client never sees it). */
function correctAnswer(item: ExamItem): string {
  const e = item.exam;
  if (e.parts) return JSON.stringify(Object.fromEntries(e.parts.map((p) => [p.id, p.answerFormat === 'math' ? asStudentWould(p.math!) : p.correctAnswer])));
  if (e.math) return asStudentWould(e.math);
  return item.correctAnswer ?? '';
}
function wrongAnswer(item: ExamItem): string {
  const e = item.exam;
  if (e.parts) return JSON.stringify(Object.fromEntries(e.parts.map((p) => [p.id, p.answerFormat === 'math' ? '999999' : p.answerFormat === 'text' ? 'zzz' : (p.options ?? []).find((o) => o.id !== p.correctAnswer)!.id])));
  if (e.math) return '999999';
  if (item.answerFormat === 'single_choice') return (item.options ?? []).find((o) => o.id !== item.correctAnswer)!.id;
  if (item.answerFormat === 'multi_choice') return (item.options ?? []).filter((o) => !item.correctAnswer.split(',').includes(o.id)).map((o) => o.id).slice(0, 1).join(',') || 'A';
  return 'zzz';
}

async function serverItem(simId: string, index: number): Promise<ExamItem | undefined> {
  const nav = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId])).rows[0]?.navigation_state as ExamNavState;
  return nav?.items?.[String(index)]?.item;
}

/** Answers every deliverable item (correctly or not), then hands in and scores. */
async function runAttempt(actor: string, simId: string, answer: (item: ExamItem, i: number) => string, max = 40) {
  let leak: string | null = null;
  let answered = 0;
  let breaks = 0;
  for (let i = 0; i < max; i++) {
    const next = await getNextSimulationItem(actor, simId);
    if (next.outcome === 'COMPLETE') break;
    if (next.outcome === 'BREAK') {
      breaks++;
      await db.query(`UPDATE simulation_attempts SET navigation_state = jsonb_set(navigation_state, '{breakUntil}', 'null') WHERE id = $1`, [simId]);
      continue;
    }
    if (next.outcome !== 'ITEM_READY') break;
    leak = leak ?? findAnswerKeyLeak(next);
    const item = (await serverItem(simId, next.targetIndex))!;
    if (item.exam.portfolio) break;
    const r = await submitSimulationItemAnswer(actor, simId, answer(item, next.targetIndex), `v2:${simId}:${next.targetIndex}`, next.targetIndex);
    answered++;
    if (r.done) break;
  }
  await finalizeOpenItemsForSubmission(actor, simId);
  await completeSimulationAttempt(simId);
  const result = await scoreAndRecordAttemptResult(simId);
  return { leak, answered, breaks, result };
}

async function main() {
  guard();
  console.log(`track-b V2 scenarios -- db ${fingerprint()} -- run ${RUN}${SKIP_AI ? ' (AI skipped)' : ''}`);

  // ---- Catalogue ----
  const bound = await count(`SELECT count(*) n FROM assessment_structure_nodes WHERE status = 'ACTIVE' AND exam_version_id IS NOT NULL`);
  const unready = await count(`SELECT count(*) n FROM assessment_structure_nodes WHERE status = 'ACTIVE' AND exam_version_id IS NOT NULL AND NOT (metadata ? 'readiness')`);
  check('CAT.structure-applied', bound >= 18 && unready === 0, `bound=${bound} withoutReadiness=${unready}`);
  const families = await listStructureFamilies('TECHNICAL_DEMO');
  check('CAT.five-frameworks-available', ['IB', 'PISA', 'ICFES', 'PAA', 'CAMBRIDGE'].every((f) => families.find((x) => x.family === f)?.available), families.map((f) => `${f.family}:${f.available}`).join(','));
  const ibRoot = await listStructureChildren({ family: 'IB', parentKey: null, language: 'es', audience: 'TECHNICAL_DEMO' });
  const g5 = await listStructureChildren({ family: 'IB', parentKey: 'ib.dp', language: 'es', audience: 'TECHNICAL_DEMO' });
  const aa = await listStructureChildren({ family: 'IB', parentKey: 'ib.dp.math-aa', language: 'es', audience: 'TECHNICAL_DEMO' });
  check('CAT.ib-dynamic-path', ibRoot[0]?.key === 'ib.dp' && g5.some((n) => n.key === 'ib.dp.g5' && n.available) && g5.some((n) => n.key === 'ib.dp.g1' && !n.available), g5.map((n) => `${n.key}:${n.available}`).join(','));
  const econ = await listStructureChildren({ family: 'IB', parentKey: 'ib.dp.economics', language: 'es', audience: 'TECHNICAL_DEMO' });
  check('CAT.levels-localized-and-gated', aa.find((n) => n.key === 'ib.dp.math-aa.hl')?.isExamLevel === true && aa.find((n) => n.key === 'ib.dp.math-aa.sl')?.available === true && aa.find((n) => n.key === 'ib.dp.math-aa.hl')?.label === 'Nivel Superior (NS)' && econ.length > 0 && econ.every((n) => !n.available && n.readiness === 'STRUCTURE_READY'), econ.map((n) => `${n.key}:${n.available}:${n.readiness}`).join(','));
  const hl = (await resolveExamLevel('ib.dp.math-aa.hl', 'es', { audience: 'TECHNICAL_DEMO' }))!;
  check('CAT.ib-math-hl-three-papers', hl?.components.length === 3 && hl.components.map((c) => c.name).join('|') === 'Paper 1|Paper 2|Paper 3');
  check('CAT.structure-only-not-startable', (await resolveExamLevel('ib.dp.economics.hl', 'es', { audience: 'TECHNICAL_DEMO' })) === null && (await resolveExamLevel('ib.dp.cas', 'es', { audience: 'TECHNICAL_DEMO' })) === null);

  const A = await student('a');
  const B = await student('b');
  const profileFor = async (s: { studentId: string }, node: string) => {
    const lvl = (await resolveExamLevel(node, 'es', { audience: 'TECHNICAL_DEMO' }))!;
    return { lvl, profileId: await ensureExamProfile(s.studentId, lvl.examDefinitionId, lvl.examVersionId) };
  };

  // ---- IB Math AA HL: MOCK on Paper 1 (frozen form, deterministic math grading) ----
  const ib = await profileFor(A, 'ib.dp.math-aa.hl');
  const p1 = ib.lvl.components[0].componentId;
  const mock = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: ib.profileId, examVersionId: ib.lvl.examVersionId, componentIds: [p1], mode: 'MOCK' });
  check('MOCK.ready-and-frozen', mock.status === 'READY' && !!mock.formFrozenAt && mock.timingMode === 'OFFICIAL_SIMULATION_TIMED');
  check('MOCK.reduced-and-honest', mock.form?.fidelity === 'REDUCED' && (mock.form?.coveragePercent ?? 100) < 100, `${mock.form?.coveragePercent}%`);
  check('MOCK.difficulty-in-band', mock.form?.difficultyBandMet === true, String(mock.form?.difficultyIndex));
  check('MOCK.usage-recorded', (await count(`SELECT count(*) n FROM exam_item_usage WHERE exam_instance_id = $1`, [mock.id])) === mock.form!.slots.filter((s) => s.approvedItemId).length);
  const view = await toInstanceView(mock);
  check('MOCK.client-view-has-no-item-ids', !JSON.stringify(view).includes(mock.form!.slots[0].approvedItemId!));
  const started = await startExamInstance(mock.id, { language: 'en' });
  const simId = started.simulationAttemptId!;
  const navAtStart = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId])).rows[0].navigation_state as ExamNavState;
  const presetIds = Object.values(navAtStart.items).map((s) => s.item?.exam.approvedItemId).filter(Boolean).sort();
  check('MOCK.form-preset-before-first-item', presetIds.join() === mock.form!.slots.map((s) => s.approvedItemId).filter(Boolean).sort().join());
  check('MOCK.no-item-feedback', navAtStart.policy?.itemFeedback === 'NEVER' && navAtStart.policy?.tutorAssistance === 'BLOCKED');
  check('SEC.other-student-cannot-read-attempt', await rejects(() => getNextSimulationItem(B.user.id, simId), SimulationItemAccessDeniedError));
  // One answer with working (method marks), the rest correct.
  const first = await getNextSimulationItem(A.user.id, simId);
  if (first.outcome === 'ITEM_READY') {
    const item = (await serverItem(simId, first.targetIndex))!;
    check('MOCK.delivered-item-is-the-frozen-one', !!item.exam.approvedItemId && presetIds.includes(item.exam.approvedItemId));
  }
  const run1 = await runAttempt(A.user.id, simId, (item) => correctAnswer(item));
  check('MOCK.no-answer-key-leak', run1.leak === null, run1.leak ?? '');
  check('MOCK.all-correct-full-marks', run1.result.rawScore === run1.result.maxScore && run1.result.maxScore > 0, `${run1.result.rawScore}/${run1.result.maxScore}`);
  check('MOCK.strict-equals-official-when-all-correct', run1.result.strictReadiness?.earned === run1.result.rawScore, JSON.stringify(run1.result.strictReadiness));
  const resp = (await db.query(`SELECT scoring_strategy, strict_score, normalized_response, content_origin FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1`, [simId])).rows;
  check('GRADE.v2-columns-persisted', resp.length > 0 && resp.every((r: any) => r.scoring_strategy && r.content_origin === 'FIXTURE' && r.strict_score !== null), resp.map((r: any) => r.scoring_strategy).join(','));
  check('GRADE.math-normalized-ast-latex', resp.some((r: any) => r.normalized_response && (r.normalized_response.latex || Object.values(r.normalized_response).some((v: any) => v?.latex))));
  check('MOCK.instance-completed', (await getExamInstance(mock.id))?.status === 'COMPLETED');

  // ---- Retest from zero: a NEW instance, unseen items preferred ----
  const retake = await newInstanceFromExisting(mock.id, { contentAudience: 'TECHNICAL_DEMO' });
  const overlap = retake.form!.slots.filter((s) => s.approvedItemId && mock.form!.slots.some((m) => m.approvedItemId === s.approvedItemId)).length;
  check('RETEST.new-instance-from-zero', retake.id !== mock.id && retake.status === 'READY' && retake.simulationAttemptId === null);
  check('RETEST.prefers-unseen-items', overlap < retake.form!.slots.filter((s) => s.approvedItemId).length, `overlap=${overlap}`);

  // ---- Delete rules ----
  const del1 = await deleteExamInstance(retake.id, { confirm: false, ownerStudentId: A.studentId });
  check('DELETE.ready-instance-deleted-usage-released', del1.instance.status === 'DELETED' && (await count(`SELECT count(*) n FROM exam_item_usage WHERE exam_instance_id = $1`, [retake.id])) === 0);
  check('DELETE.completed-needs-confirmation', await rejects(() => deleteExamInstance(mock.id, { confirm: false, ownerStudentId: A.studentId }), ExamInstanceError, 'CONFIRMATION_REQUIRED'));
  // COMPLETED delete = soft delete of the instance only: result, responses and consolidated evidence preserved.
  const mockExamAttemptId = (await getSimulationAttempt(simId))!.examAttemptId;
  const evidenceSql = `SELECT count(*) n FROM learning_evidence WHERE student_id = $1 AND metadata->'context'->>'examAttemptId' = $2`;
  // Consolidated evidence for this attempt, written through the REAL evidence writer (same call shape as scoring.service).
  const subj = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, $2) RETURNING id`, [A.studentId, `tb2-${RUN} math`])).rows[0].id;
  const conc = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subj, `tb2-${RUN}-logs`])).rows[0].id;
  await updateMastery({
    studentId: A.studentId, conceptId: conc, subjectId: subj,
    evidence: { sourceType: 'EXAM_SIMULATION', result: 'correct', difficulty: 3, scorePercent: 100 },
    telemetry: { activityType: 'EXAM_SIMULATION', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' },
    metadata: { context: { examAttemptId: mockExamAttemptId, simulationSource: true } },
    identity: { operationType: 'EXAM_SIMULATION_RESPONSE', operationId: `tb2-${RUN}-evidence`, conceptId: conc },
  } as never);
  const before = { evidence: await count(evidenceSql, [A.studentId, mockExamAttemptId]), responses: await count(`SELECT count(*) n FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [mockExamAttemptId]), result: await getAttemptResult(mockExamAttemptId) };
  const del2 = await deleteExamInstance(mock.id, { confirm: true, ownerStudentId: A.studentId });
  const afterResult = await getAttemptResult(mockExamAttemptId);
  check('DELETE.completed-soft-delete-result-preserved', del2.resultPreserved && del2.instance.status === 'DELETED' && afterResult?.status === 'SCORED' && afterResult.responseSetHash === before.result?.responseSetHash && afterResult.rawScore === before.result?.rawScore);
  check('DELETE.completed-evidence-and-responses-preserved', before.evidence >= 1 && (await count(evidenceSql, [A.studentId, mockExamAttemptId])) === before.evidence && (await count(`SELECT count(*) n FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [mockExamAttemptId])) === before.responses && before.responses > 0, `evidence=${before.evidence} responses=${before.responses}`);
  check('DELETE.completed-hidden-from-visible-history', !(await listExamInstances(A.studentId, undefined, { includeTechnicalDemo: true })).some((i) => i.id === mock.id) && !(await listProfileAttempts(ib.profileId)).some((a) => a.id === simId));

  // ---- In-progress delete -> attempt cancelled, never resumable -> NEW ATTEMPT FROM ZERO ----
  const ip = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: ib.profileId, examVersionId: ib.lvl.examVersionId, componentIds: [p1], mode: 'MOCK' });
  const ipStarted = await startExamInstance(ip.id, { language: 'en' });
  const ipFirst = await getNextSimulationItem(A.user.id, ipStarted.simulationAttemptId!);
  if (ipFirst.outcome === 'ITEM_READY') {
    const it = (await serverItem(ipStarted.simulationAttemptId!, ipFirst.targetIndex))!;
    await submitSimulationItemAnswer(A.user.id, ipStarted.simulationAttemptId!, correctAnswer(it), `v2:ip:${ipFirst.targetIndex}`, ipFirst.targetIndex);
  }
  check('DELETE.security-other-student-cannot-delete', await rejects(() => deleteExamInstance(ip.id, { confirm: true, ownerStudentId: B.studentId }), ExamInstanceError, 'NOT_FOUND') && (await getExamInstance(ip.id))?.status === 'IN_PROGRESS');
  check('DELETE.in-progress-needs-confirmation', await rejects(() => deleteExamInstance(ip.id, { confirm: false, ownerStudentId: A.studentId }), ExamInstanceError, 'CONFIRMATION_REQUIRED'));
  const ipDel = await deleteExamInstance(ip.id, { confirm: true, ownerStudentId: A.studentId });
  const ipDel2 = await deleteExamInstance(ip.id, { confirm: true, ownerStudentId: A.studentId });
  check('DELETE.in-progress-cancels-attempt-idempotent', ipDel.attemptAbandoned && ipDel.instance.status === 'DELETED' && ipDel2.instance.status === 'DELETED' && (await getSimulationAttempt(ipStarted.simulationAttemptId!))?.status === 'ABANDONED');
  check('DELETE.deleted-attempt-not-resumable', await rejects(() => getNextSimulationItem(A.user.id, ipStarted.simulationAttemptId!), Error));
  check('DELETE.evidence-kept', (await count(`SELECT count(*) n FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1`, [ipStarted.simulationAttemptId])) >= 1);
  const fresh = await newInstanceFromExisting(ip.id, { contentAudience: 'TECHNICAL_DEMO' });
  const freshStarted = await startExamInstance(fresh.id, { language: 'en' });
  const freshNav = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [freshStarted.simulationAttemptId])).rows[0].navigation_state as ExamNavState;
  check('NEW_ATTEMPT_FROM_ZERO', fresh.id !== ip.id && freshStarted.simulationAttemptId !== ipStarted.simulationAttemptId && Object.values(freshNav.items).every((s) => !s.draft && s.status !== 'ANSWERED') && freshNav.sectionStartedAt === null && freshNav.sectionIndex === 0 && (await count(`SELECT count(*) n FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1`, [freshStarted.simulationAttemptId])) === 0);
  await deleteExamInstance(fresh.id, { confirm: true, ownerStudentId: A.studentId });

  // ---- Cambridge: Challenge vs Mock difficulty; partial credit + strict ----
  const cie = await profileFor(A, 'cie.igcse.0580.extended');
  const cMock = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: cie.profileId, examVersionId: cie.lvl.examVersionId, componentIds: cie.lvl.components.map((c) => c.componentId), mode: 'MOCK' });
  const cChal = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: cie.profileId, examVersionId: cie.lvl.examVersionId, componentIds: cie.lvl.components.map((c) => c.componentId), mode: 'CHALLENGE' });
  check('CHALLENGE.harder-than-mock', (cChal.difficultyIndex ?? 0) >= (cMock.difficultyIndex ?? 0), `${cChal.difficultyIndex} vs ${cMock.difficultyIndex}`);
  check('CHALLENGE.labelled-target', cChal.form?.targetDifficulty === 1.1);
  await deleteExamInstance(cMock.id, { confirm: false, ownerStudentId: A.studentId });
  const cs = await startExamInstance(cChal.id, { language: 'en' });
  const run2 = await runAttempt(A.user.id, cs.simulationAttemptId!, (item, i) => (i % 2 === 0 ? correctAnswer(item) : wrongAnswer(item)));
  check('CHALLENGE.scored', run2.result.maxScore > 0 && run2.result.rawScore < run2.result.maxScore, `${run2.result.rawScore}/${run2.result.maxScore}`);
  check('STRICT.never-above-official', (run2.result.strictReadiness?.earned ?? 99) <= run2.result.rawScore);

  // ---- Bridge: weak objectives -> reinforce / governed proposal ----
  const rv = (await getAttemptResultView(cs.simulationAttemptId!))!;
  const bridge = await buildLearningBridge({ simulationAttemptId: cs.simulationAttemptId!, studentId: A.studentId, objectives: rv.objectives });
  check('BRIDGE.entries-for-weak-objectives', bridge.length > 0 && bridge.every((b) => b.questions >= 1 && b.questionsMissed >= 1), bridge.map((b) => `${b.code}:${b.questionsMissed}/${b.questions}:${b.action.kind}`).join(' '));
  const propose = bridge.find((b) => b.action.kind === 'PROPOSE');
  if (propose) {
    const ea = (await getSimulationAttempt(cs.simulationAttemptId!))!.examAttemptId;
    const r1 = await requestConceptForObjective({ studentId: A.studentId, learningObjectiveId: propose.learningObjectiveId, examAttemptId: ea });
    const r2 = await requestConceptForObjective({ studentId: A.studentId, learningObjectiveId: propose.learningObjectiveId, examAttemptId: ea });
    check('BRIDGE.proposal-governed-and-idempotent', r1.status === 'PROPOSED' && r2.alreadyRequested && r1.proposalId === r2.proposalId);
    check('BRIDGE.no-canonical-concept-created', (await count(`SELECT count(*) n FROM learning_concept_proposals WHERE id = $1 AND mapped_canonical_concept_id IS NULL`, [r1.proposalId])) === 1);
  } else check('BRIDGE.proposal-governed-and-idempotent', true, 'all weak objectives already linked to concepts');

  // ---- PAA Practice: adaptive level, per-item feedback, practice never frozen ----
  const paa = await profileFor(A, 'paa.practice.matematicas');
  const pr = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: paa.profileId, examVersionId: paa.lvl.examVersionId, componentIds: paa.lvl.components.map((c) => c.componentId), mode: 'PRACTICE' });
  check('PRACTICE.default-level-and-untimed', pr.practiceLevel === 'STANDARD' && pr.timingMode === 'UNTIMED' && pr.formFrozenAt === null);
  const ps = await startExamInstance(pr.id, { language: 'es' });
  const pnav = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [ps.simulationAttemptId])).rows[0].navigation_state as ExamNavState;
  check('PRACTICE.item-feedback-on', pnav.policy?.itemFeedback === 'AFTER_EACH_ITEM');
  const run3 = await runAttempt(A.user.id, ps.simulationAttemptId!, (item) => correctAnswer(item));
  const pr2 = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: paa.profileId, examVersionId: paa.lvl.examVersionId, componentIds: paa.lvl.components.map((c) => c.componentId), mode: 'PRACTICE' });
  check('PRACTICE.level-adapts-up-after-strong-session', pr2.practiceLevel === 'ADVANCED', `${run3.result.rawScore}/${run3.result.maxScore} -> ${pr2.practiceLevel}`);
  await deleteExamInstance(pr2.id, { confirm: false, ownerStudentId: A.studentId });

  // ---- PISA / Saber: blueprint distribution in the frozen form ----
  const pisa = await profileFor(A, 'pisa.2022.math');
  // QB D3: PISA is a competency benchmark -- a fixed-form MOCK is refused even as a technical demo.
  check('PISA.mock-refused-competency-benchmark', await rejects(() => createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: pisa.profileId, examVersionId: pisa.lvl.examVersionId, componentIds: [pisa.lvl.components[0].componentId], mode: 'MOCK' }), ExamInstanceError, 'MODE_NOT_AVAILABLE'));
  const objCodes = (await db.query(`SELECT lo.code FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id JOIN assessment_blueprints b ON b.id = t.blueprint_id WHERE b.exam_version_id = $1 AND t.assessment_component_id = $2`, [pisa.lvl.examVersionId, pisa.lvl.components[0].componentId])).rows.map((r: any) => r.code as string);
  const perProcess = ['formular', 'emplear', 'interpretar', 'razonar'].map((p) => objCodes.filter((c) => c.endsWith(`.${p}`)).length);
  check('PISA.blueprint-25pct-per-process', perProcess.every((n) => n === 2), perProcess.join('/'));
  const sab = await profileFor(A, 'saber11.math');
  // V2.1 (50 required slots with competence x content constraints): the 15 config fixtures cannot fill a full form, even as a technical demo -- no partial mock.
  check('SABER.v21-50-slots-no-partial-mock', await rejects(() => createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: sab.profileId, examVersionId: sab.lvl.examVersionId, componentIds: [sab.lvl.components[0].componentId], mode: 'MOCK' }), ExamInstanceError, 'FORM_INCOMPLETE'));

  // ---- PAA: first level = Simulacro completo | Practicar un área ----
  const paaKids = await listStructureChildren({ family: 'PAA', parentKey: 'paa', language: 'es', audience: 'TECHNICAL_DEMO' });
  check('PAA.first-level-full-or-practice', paaKids.map((n) => n.key).join() === 'paa.full,paa.practice' && paaKids.every((n) => n.available), paaKids.map((n) => `${n.key}:${n.readiness}`).join(','));
  const areas = await listStructureChildren({ family: 'PAA', parentKey: 'paa.practice', language: 'es', audience: 'TECHNICAL_DEMO' });
  check('PAA.practice-four-areas', areas.map((n) => n.key.split('.').pop()).join() === 'lectura,redaccion,matematicas,ingles');
  const full = await profileFor(A, 'paa.full');
  check('PAA.full-test-fixed-components-mock-challenge', full.lvl.componentsFixed && full.lvl.components.length === 4 && full.lvl.modes.join() === 'MOCK,CHALLENGE' && full.lvl.readiness === 'REDUCED_MOCK_READY', full.lvl.components.map((c) => `${c.name}:${c.officialMinutes}m/${c.plannedMinutes}m`).join(' | '));
  const fm = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: full.profileId, examVersionId: full.lvl.examVersionId, componentIds: full.lvl.components.map((c) => c.componentId), mode: 'MOCK' });
  check('PAA.full-mock-frozen-before-start', fm.status === 'READY' && !!fm.formFrozenAt && fm.timingMode === 'OFFICIAL_SIMULATION_TIMED', `${fm.form?.fidelity} ${fm.form?.coveragePercent}%`);
  const fms = await startExamInstance(fm.id, { language: 'es' });
  const fnav = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [fms.simulationAttemptId])).rows[0].navigation_state as ExamNavState;
  check('PAA.full-mock-official-order', fnav.sections.map((x) => x.key).join() === 'lectura,redaccion,matematicas,ingles', fnav.sections.map((x) => `${x.key}:${x.durationSeconds}s`).join(','));
  check('PAA.full-mock-no-help', fnav.policy?.itemFeedback === 'NEVER' && fnav.policy?.tutorAssistance === 'BLOCKED');
  const frozenBefore = JSON.stringify(fm.form);
  const fRun = await runAttempt(A.user.id, fms.simulationAttemptId!, (item, i) => (i % 3 === 0 ? wrongAnswer(item) : correctAnswer(item)), 60);
  check('PAA.full-mock-breaks-between-blocks', fRun.breaks === 2, `breaks=${fRun.breaks}`);
  check('PAA.full-mock-no-adaptation', JSON.stringify((await getExamInstance(fm.id))!.form) === frozenBefore && fRun.leak === null);
  const fView = (await getAttemptResultView(fms.simulationAttemptId!))!;
  const groups = fView.reporting?.groups ?? [];
  check('PAA.results-by-area-no-fake-scale', fView.reporting?.scaleNote === 'NO_OFFICIAL_SCALE' && groups.map((g) => g.key).join() === 'lectura-redaccion,matematicas,ingles' && groups.find((g) => g.key === 'ingles')?.institutionDefined === true, groups.map((g) => g.label).join(' / '));
  check('PAA.results-by-skill', fView.objectives.filter((o) => o.classification !== 'NOT_ASSESSED').length >= 8 && fView.objectives.every((o) => !!o.componentId), `${fView.objectives.length} objectives`);
  check('PAA.completion-and-time', fView.completion !== null && fView.completion.answered === fRun.answered && fView.minutesUsed !== null, JSON.stringify(fView.completion));
  // Bridge: a curated, PUBLISHED concept link -> "Reforzar ahora" materializes it in the Student's learning.
  const fBridge = await buildLearningBridge({ simulationAttemptId: fms.simulationAttemptId!, studentId: A.studentId, objectives: fView.objectives });
  const add = fBridge.find((b) => b.action.kind === 'ADD_AND_REINFORCE');
  check('PAA.bridge-add-and-reinforce-offered', !!add, fBridge.map((b) => `${b.code}:${b.action.kind}`).join(' '));
  if (add && add.action.kind === 'ADD_AND_REINFORCE') {
    const canonicalBefore = await count(`SELECT count(*) n FROM canonical_concepts`);
    const m1 = await addConceptToStudentLearning(A.studentId, add.action.canonicalConceptId, 'es');
    const m2 = await addConceptToStudentLearning(A.studentId, add.action.canonicalConceptId, 'es');
    check('PAA.bridge-materialized-idempotent-no-new-canonical', m1.studentConceptId === m2.studentConceptId && (await count(`SELECT count(*) n FROM canonical_concepts`)) === canonicalBefore);
    const again = await buildLearningBridge({ simulationAttemptId: fms.simulationAttemptId!, studentId: A.studentId, objectives: (await getAttemptResultView(fms.simulationAttemptId!))!.objectives });
    check('PAA.bridge-now-reinforce', again.find((b) => b.learningObjectiveId === add.learningObjectiveId)?.action.kind === 'REINFORCE');
  }
  check('PAA.full-mock-delete-keeps-result', (await deleteExamInstance(fm.id, { confirm: true, ownerStudentId: A.studentId })).resultPreserved);
  check('SEC.other-student-cannot-delete-paa', await rejects(() => deleteExamInstance(fm.id, { confirm: true, ownerStudentId: B.studentId }), ExamInstanceError, 'NOT_FOUND'));
  const fm2 = await newInstanceFromExisting(fm.id, { contentAudience: 'TECHNICAL_DEMO' });
  check('PAA.new-attempt-from-zero', fm2.id !== fm.id && fm2.simulationAttemptId === null && !!fm2.formFrozenAt);
  await deleteExamInstance(fm2.id, { confirm: false, ownerStudentId: A.studentId });

  // ---- PAA Practice: one area; then one skill ----
  const lect = await profileFor(A, 'paa.practice.lectura');
  check('PAA.area-practice-only-practice', lect.lvl.modes.join() === 'PRACTICE' && lect.lvl.components.length === 1 && lect.lvl.focusObjectiveIds.length === 0);
  const skillNode = (await listStructureChildren({ family: 'PAA', parentKey: 'paa.practice.lectura', language: 'es', audience: 'TECHNICAL_DEMO' })).find((n) => n.key.endsWith('.inferencia'))!;
  const sk = await profileFor(A, skillNode.key);
  check('PAA.skill-practice-focus', sk.lvl.focusObjectiveIds.length >= 1 && sk.lvl.modes.join() === 'PRACTICE', `${skillNode.key} focus=${sk.lvl.focusObjectiveIds.length}`);
  check('PAA.skill-focus-is-practice-only', await rejects(() => createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: sk.profileId, examVersionId: sk.lvl.examVersionId, componentIds: sk.lvl.components.map((c) => c.componentId), mode: 'MOCK', focusObjectiveIds: sk.lvl.focusObjectiveIds }), ExamInstanceError));
  const ski = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: sk.profileId, examVersionId: sk.lvl.examVersionId, componentIds: sk.lvl.components.map((c) => c.componentId), mode: 'PRACTICE', focusObjectiveIds: sk.lvl.focusObjectiveIds });
  const sks = await startExamInstance(ski.id, { language: 'es' });
  const skRun = await runAttempt(A.user.id, sks.simulationAttemptId!, (item) => correctAnswer(item));
  const skNav = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [sks.simulationAttemptId])).rows[0].navigation_state as ExamNavState;
  const deliveredIds = Object.values(skNav.items).map((x) => x.item?.exam.approvedItemId).filter(Boolean) as string[];
  const deliveredObjectives = (await db.query(`SELECT DISTINCT learning_objective_id::text AS id FROM approved_items WHERE id = ANY($1::uuid[])`, [deliveredIds])).rows.map((r: any) => r.id as string);
  check('PAA.skill-practice-only-focus-items', deliveredIds.length >= 1 && deliveredObjectives.every((o) => sk.lvl.focusObjectiveIds.includes(o)), `${skRun.answered} answered, objectives=${deliveredObjectives.length}`);
  await deleteExamInstance(ski.id, { confirm: true, ownerStudentId: A.studentId });

  // ---- IB sciences: Physics HL / Chemistry HL full mocks (Paper 1A + 1B + 2) ----
  for (const sci of ['physics', 'chemistry']) {
    const lvl = await profileFor(A, `ib.dp.${sci}.hl`);
    const names = lvl.lvl.components.map((c) => c.name).join('|');
    check(`IB.${sci}-hl-papers-1a-1b-2`, lvl.lvl.components.length === 3 && !/Paper 3/.test(names) && lvl.lvl.modes.includes('MOCK'), names);
    const m = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: lvl.profileId, examVersionId: lvl.lvl.examVersionId, componentIds: lvl.lvl.components.map((c) => c.componentId), mode: 'MOCK' });
    check(`IB.${sci}-hl-mock-frozen-honest`, !!m.formFrozenAt && m.form?.fidelity === 'REDUCED', `${m.form?.coveragePercent}% of official length`);
    const st = await startExamInstance(m.id, { language: 'en' });
    const r = await runAttempt(A.user.id, st.simulationAttemptId!, (item) => correctAnswer(item), 60);
    check(`IB.${sci}-hl-all-correct-full-marks`, r.result.rawScore === r.result.maxScore && r.result.maxScore > 0 && r.leak === null && r.breaks === 1, `${r.result.rawScore}/${r.result.maxScore} breaks=${r.breaks}`);
    const v = (await getAttemptResultView(st.simulationAttemptId!))!;
    check(`IB.${sci}-hl-results-by-paper`, new Set(v.objectives.map((o) => o.componentId)).size === 3);
    await deleteExamInstance(m.id, { confirm: true, ownerStudentId: A.studentId });
  }

  // ---- IB Visual Arts SL: portfolio pipeline ----
  const va = await profileFor(A, 'ib.dp.visual-arts.sl');
  const aip = va.lvl.components.find((c) => c.name === 'Art-making inquiries portfolio')!.componentId;
  // QB D4: a portfolio counts for the exam but is not mockable -- it is worked as (untimed) practice.
  check('ARTS.portfolio-mock-refused', await rejects(() => createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: va.profileId, examVersionId: va.lvl.examVersionId, componentIds: [aip], mode: 'MOCK' }), ExamInstanceError, 'COMPONENT_NOT_MOCKABLE'));
  const vm = await createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: va.profileId, examVersionId: va.lvl.examVersionId, componentIds: [aip], mode: 'PRACTICE' });
  check('ARTS.coursework-untimed', vm.timingMode === 'UNTIMED');
  const vs = await startExamInstance(vm.id, { language: 'en' });
  const vnext = await getNextSimulationItem(A.user.id, vs.simulationAttemptId!);
  const vq = vnext.outcome === 'ITEM_READY' ? (vnext.question as any) : null;
  check('ARTS.portfolio-item-delivered-with-requirements-only', vq?.inputMode === 'portfolio' && !!vq.portfolioRequirements && !!vq.rubricCriteria && findAnswerKeyLeak(vnext) === null);
  const idx = vnext.outcome === 'ITEM_READY' ? vnext.targetIndex : 0;
  const ctx = await loadPortfolioContext(A.studentId, vm.id, idx);
  check('SEC.other-student-cannot-open-submission', await rejects(() => loadPortfolioContext(B.studentId, vm.id, idx), SubmissionError, 'FORBIDDEN'));
  const png = async (hue: number) => new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: hue, g: 120, b: 200 - hue } } }).png().toBuffer());
  const svg = await storeMedia({ studentId: A.studentId, bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), declaredMime: 'image/png', originalName: 'x.png' });
  check('MEDIA.active-markup-rejected-and-not-stored', svg.scan.status === 'REJECTED' && (await count(`SELECT count(*) n FROM exam_media_objects WHERE id = $1 AND bytes IS NULL`, [svg.id])) === 1);
  const mediaIds: string[] = [];
  for (const h of [20, 90, 160]) {
    const m = await storeMedia({ studentId: A.studentId, bytes: await png(h), declaredMime: 'image/png', originalName: `screen-${h}.png` });
    mediaIds.push(m.id);
    await addArtifact(ctx, { kind: 'PORTFOLIO_PAGE', mediaId: m.id, caption: `Screen ${h}` });
  }
  check('MEDIA.clean-images-stored-with-thumbnails', (await count(`SELECT count(*) n FROM exam_media_objects WHERE id = ANY($1::uuid[]) AND scan_status = 'CLEAN' AND thumbnail IS NOT NULL`, [mediaIds])) === 3);
  check('SEC.other-student-cannot-read-media', await rejects(() => readMediaForOwner(mediaIds[0], B.studentId, 'full'), MediaError, 'FORBIDDEN'));
  const draftSubmission = (await getSubmissionView(ctx)).submissionId;
  check('SUBMISSION.incomplete-cannot-be-committed', await rejects(() => submitSimulationItemAnswer(A.user.id, vs.simulationAttemptId!, JSON.stringify({ submissionId: draftSubmission }), undefined, idx), SimulationInvalidResponseError));
  await addArtifact(ctx, { kind: 'STATEMENT', text: 'I investigated how light changes the meaning of a glass bottle, testing charcoal, ink and photography, and chose ink because of its translucency.' });
  const sv = await getSubmissionView(ctx);
  check('SUBMISSION.complete', sv.completeness.complete && sv.artifacts.every((a) => !a.fileUrl || a.fileUrl.includes('sig=')));
  if (SKIP_AI) {
    check('ARTS.double-assessor', true, 'skipped (--skip-ai)');
  } else {
    const t0 = Date.now();
    await submitSimulationItemAnswer(A.user.id, vs.simulationAttemptId!, JSON.stringify({ submissionId: sv.submissionId }), `v2:arts:${idx}`, idx);
    const subRow = (await db.query(`SELECT status FROM exam_submissions WHERE id = $1`, [sv.submissionId])).rows[0];
    const assessments = await count(`SELECT count(*) n FROM exam_response_assessments WHERE submission_id = $1`, [sv.submissionId]);
    const respRow = (await db.query(`SELECT review_status, score, max_score, scoring_strategy FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1 AND r.target_index = $2`, [vs.simulationAttemptId, idx])).rows[0];
    check('ARTS.submission-assessed-or-review', ['ASSESSED', 'REVIEW_REQUIRED'].includes(subRow?.status) && respRow?.scoring_strategy === 'PORTFOLIO_RUBRIC', `${subRow?.status} ${respRow?.score}/${respRow?.max_score} review=${respRow?.review_status} assessments=${assessments} ${Date.now() - t0}ms`);
    check('ARTS.assessments-persisted-or-honest-review', assessments >= 2 || subRow?.status === 'REVIEW_REQUIRED');
    check('ARTS.review-required-is-not-evidence', respRow?.review_status !== 'REVIEW_REQUIRED' || (await count(`SELECT count(*) n FROM learning_evidence WHERE student_id = $1 AND metadata->'context'->>'examAttemptId' = $2`, [A.studentId, (await getSimulationAttempt(vs.simulationAttemptId!))!.examAttemptId])) === 0);
  }

  // ---- DEV fixture reset (A only; B untouched) ----
  const dry = await resetStudentExamFixtures({ studentId: A.studentId, confirm: 'RESET-DEV-FIXTURES', dryRun: true });
  check('RESET.dry-run-counts', (dry.deleted.exam_instances ?? 0) > 0 && (await count(`SELECT count(*) n FROM exam_instances WHERE student_id = $1`, [A.studentId])) > 0);
  await resetStudentExamFixtures({ studentId: A.studentId, confirm: 'RESET-DEV-FIXTURES' });
  check('RESET.student-exam-data-gone', (await count(`SELECT count(*) n FROM exam_instances WHERE student_id = $1`, [A.studentId])) === 0 && (await count(`SELECT count(*) n FROM simulation_attempts WHERE student_id = $1`, [A.studentId])) === 0 && (await count(`SELECT count(*) n FROM exam_media_objects m JOIN exam_submission_artifacts a ON a.media_object_id = m.id WHERE m.owner_student_id = $1`, [A.studentId])) === 0);
  check('RESET.content-kept', (await count(`SELECT count(*) n FROM exam_definitions WHERE config_key LIKE 'v2.%' AND status = 'ACTIVE'`)) >= V2_VERTICALS.length);
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
  const userIds = Array.from(new Set([...created.users, ...(await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`tb2-${RUN}-%`]))]));
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`tb2-${RUN}-%`]);
  // Proposals created ONLY by this run's Students (a proposal another Student asked for is kept).
  const proposals = await ids(`SELECT p.id FROM learning_concept_proposals p WHERE EXISTS (SELECT 1 FROM learning_concept_proposal_requests r WHERE r.proposal_id = p.id AND r.student_id = ANY($1::uuid[])) AND NOT EXISTS (SELECT 1 FROM learning_concept_proposal_requests r WHERE r.proposal_id = p.id AND NOT (r.student_id = ANY($1::uuid[])))`, [studentIds]);
  for (let pass = 0; pass < 4; pass++) {
    try {
      await deleteCascade('learning_concept_proposals', 'id', proposals);
      for (const sid of studentIds) await resetStudentExamFixtures({ studentId: sid, confirm: 'RESET-DEV-FIXTURES' }).catch(() => undefined);
      await deleteCascade('exam_media_objects', 'owner_student_id', studentIds);
      await deleteCascade('student_exam_profiles', 'student_id', studentIds);
      await deleteCascade('learning_evidence', 'student_id', studentIds);
      await deleteCascade('subjects', 'student_id', studentIds);
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
  const left = (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id LIKE $1`, [`tb2-${RUN}-%`])) + (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id LIKE $1`, [`tb2-${RUN}-%`])) + (await count(`SELECT COUNT(*) n FROM exam_media_objects WHERE owner_student_id = ANY($1::uuid[])`, [studentIds]));
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
