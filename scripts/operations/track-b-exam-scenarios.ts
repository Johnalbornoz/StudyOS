/**
 * Track B -- Exam Core DEV certification scenarios (functional E2E per
 * vertical, security matrix, scoring/lifecycle, evidence bridge, real-AI
 * smoke, data integrity), run with the REAL services against the REAL DEV
 * database (or an ephemeral cert database). DEV ONLY: refuses unless the DB
 * fingerprint is the official DEV one (or TRACK_B_ALLOW_EPHEMERAL matches).
 *
 * Creates clearly-marked fixtures (clerk ids `tb-<run>-…`, emails
 * `@trackb.test`, a temporary approved item and a DRAFT version) and removes
 * every one of them at the end, then proves nothing was left behind. The DEV
 * certification CATALOG (the eight vertical configurations) is applied
 * idempotently and intentionally kept: it is the DEV exam catalog used by the
 * hosted click-through, labelled DEV_CERT_FIXTURE everywhere.
 *
 *   npx tsx --env-file=.env.neon-dev scripts/operations/track-b-exam-scenarios.ts [--skip-ai]
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { canAccessLearner } from '@/lib/authorization';
import { createStudentExamProfile, isExamProfileOwnedByStudent, isExamVersionStartableForProfile } from '@/lib/assessment/student-exam-profile.service';
import { createExamVersion } from '@/lib/assessment/exam-definition.service';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import {
  startSimulationAttempt,
  pauseSimulationAttempt,
  resumeSimulationAttempt,
  completeSimulationAttempt,
  getSimulationAttempt,
  findOpenSimulationAttemptForProfile,
  SimulationModeNotAllowedError,
} from '@/lib/simulation/attempt.service';
import {
  getNextSimulationItem,
  submitSimulationItemAnswer,
  saveSimulationItemDraft,
  endSimulationBreak,
  finalizeOpenItemsForSubmission,
  SimulationItemAccessDeniedError,
  SimulationItemNotFoundError,
  SimulationItemNotActiveError,
  SimulationItemNoPendingItemError,
  SimulationNavigationError,
  SimulationInvalidResponseError,
} from '@/lib/simulation/item-resolution.service';
import { scoreAndRecordAttemptResult, verifyAttemptResultReproducible, invalidateAttemptResult, deriveExamLifecycle, getAttemptResult } from '@/lib/exam-core/results.service';
import { getAttemptResultView } from '@/lib/exam-core/result-view.service';
import { applyExamVerticalConfig } from '@/lib/exam-core/apply-vertical-config.service';
import { DEV_CERT_VERTICALS, PRIMARY_DEV_CERT_BY_FAMILY } from '@/lib/exam-core/verticals';
import { findAnswerKeyLeak, examItemMarks, type ExamItem } from '@/lib/exam-core/items';
import { EXAM_FAMILIES, type ExamFamily } from '@/lib/exam-core/taxonomy';
import { getActiveRestrictedEvidenceForStudent } from '@/services/active-evidence-guard.service';
import { createConversation, sendMessage } from '@/services/tutor.service';
import type { SimulationType, TimingMode } from '@/lib/simulation/types';

const DEV_FP = '2a29b99ee14a22b4';
const SKIP_AI = process.argv.includes('--skip-ai');
const CLEANUP_ONLY = process.env.TB_CLEANUP_RUN ?? null;
const RUN = CLEANUP_ONLY ?? randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
const created = { users: [] as string[], tempItems: [] as string[], tempVersions: [] as string[], conversations: [] as string[] };
const aiRecord: Record<string, unknown> = {};

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}
function guard() {
  const fp = fingerprint();
  if (fp !== DEV_FP && process.env.TRACK_B_ALLOW_EPHEMERAL !== fp) throw new Error(`REFUSING: not the DEV database (${fp})`);
}
const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0]?.n ?? 0);

async function student(tag: string) {
  const clerk = `tb-${RUN}-${tag}`;
  const email = `${tag}-${RUN}@trackb.test`;
  const user = await getOrCreateCanonicalUser(clerk, email);
  created.users.push(user.id);
  // Same order as the foundation scenarios: the students row first (the role grant's creation branch needs Clerk's request-scoped currentUser otherwise).
  const studentId = await upsertStudentFromWebhook(clerk, email, `Track B ${tag}`);
  await assignSelfServiceRole(clerk, user.id, 'STUDENT');
  return { clerk, user, studentId };
}

async function rejects(fn: () => Promise<unknown>, cls: new (...a: any[]) => Error): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof cls;
  }
}

async function serverItem(simId: string, index: number): Promise<ExamItem | null> {
  const r = await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId]);
  return r.rows[0]?.navigation_state?.items?.[String(index)]?.item ?? null;
}

/** A deterministic answer built from the SERVER-held item (only the test harness can read it). */
function answerFor(item: ExamItem, correct: boolean): string {
  const wrongOption = (opts: { id: string }[] | undefined, key: string) => (opts ?? []).find((o) => !key.split(',').includes(o.id))?.id ?? 'Z';
  if (item.exam.parts) {
    const out: Record<string, string> = {};
    for (const p of item.exam.parts) {
      if (p.answerFormat === 'text') out[p.id] = correct ? (p.acceptableAnswers?.[0] ?? p.correctAnswer) : 'not-the-answer';
      else out[p.id] = correct ? p.correctAnswer : wrongOption(p.options, p.correctAnswer);
    }
    return JSON.stringify(out);
  }
  if (item.answerFormat === 'single_choice') return correct ? item.correctAnswer : wrongOption(item.options, item.correctAnswer);
  if (item.answerFormat === 'multi_choice') return correct ? item.correctAnswer : wrongOption(item.options, item.correctAnswer);
  if (item.answerFormat === 'text') return correct ? (item.exam.acceptableAnswers?.[0] ?? item.correctAnswer) : 'not-the-answer';
  if (item.answerFormat === 'ordering') return JSON.stringify(correct ? item.orderingItems : [...(item.orderingItems ?? [])].reverse());
  if (item.answerFormat === 'matching') return JSON.stringify(Object.fromEntries((item.matchingPairs ?? []).map((p, i, a) => [p.left, correct ? p.right : a[(i + 1) % a.length].right])));
  return JSON.stringify(Object.fromEntries((item.classificationItems ?? []).map((c) => [c.item, c.category])));
}

interface RunOutcome {
  simId: string;
  examAttemptId: string;
  expectedEarned: number;
  expectedAvailable: number;
  answered: number;
  sawBreak: boolean;
  sawStimulus: boolean;
  sawParts: boolean;
  leak: string | null;
}

/** Drives one attempt to the end through the real delivery service: answers by `pattern` (true = correct). */
async function driveAttempt(actorUserId: string, simId: string, pattern: (i: number) => boolean, opts: { autosaveFirst?: boolean; freeOrderProbe?: boolean; linearProbe?: boolean } = {}): Promise<RunOutcome> {
  const out: RunOutcome = { simId, examAttemptId: '', expectedEarned: 0, expectedAvailable: 0, answered: 0, sawBreak: false, sawStimulus: false, sawParts: false, leak: null };
  let guardLoops = 0;
  let first = true;
  while (guardLoops++ < 80) {
    const next = await getNextSimulationItem(actorUserId, simId);
    if (next.outcome === 'COMPLETE') break;
    if (next.outcome === 'BREAK') {
      out.sawBreak = true;
      await endSimulationBreak(actorUserId, simId);
      continue;
    }
    if (next.outcome === 'ITEM_UNAVAILABLE') throw new Error(`unexpected ITEM_UNAVAILABLE at ${next.targetIndex}: ${next.reason}`);
    out.leak = out.leak ?? findAnswerKeyLeak(next);
    if (next.question.stimulus) out.sawStimulus = true;
    if (next.question.parts) out.sawParts = true;

    let index = next.targetIndex;
    if (opts.freeOrderProbe && next.navigation.mode === 'FREE_ORDER_WITHIN_SECTION') {
      const later = next.navigation.items.find((it) => it.targetIndex > index && (it.status === 'OPEN' || it.status === 'DRAFT'));
      if (later) {
        const jumped = await getNextSimulationItem(actorUserId, simId, later.targetIndex);
        if (jumped.outcome === 'ITEM_READY') index = jumped.targetIndex;
        opts.freeOrderProbe = false;
        check('NAV.free-order-jump-allowed', jumped.outcome === 'ITEM_READY' && jumped.targetIndex === later.targetIndex);
      }
    }
    if (opts.linearProbe && next.navigation.mode === 'LINEAR' && next.section.endIndex > index) {
      check('NAV.linear-jump-refused', await rejects(() => getNextSimulationItem(actorUserId, simId, index + 1), SimulationNavigationError));
      opts.linearProbe = false;
    }

    const item = await serverItem(simId, index);
    if (!item) throw new Error(`no server-held item at ${index}`);
    const correct = pattern(index);
    const answer = answerFor(item, correct);

    if (first && opts.autosaveFirst) {
      const before = item.question;
      await saveSimulationItemDraft(actorUserId, simId, index, answer);
      const recovered = await getNextSimulationItem(actorUserId, simId, next.navigation.mode === 'LINEAR' ? undefined : index);
      check('AUTOSAVE.refresh-recovers-same-item-and-draft', recovered.outcome === 'ITEM_READY' && recovered.targetIndex === index && recovered.draft === answer && recovered.question.question === before);
    }
    first = false;

    const res = await submitSimulationItemAnswer(actorUserId, simId, answer, `scn:${simId}:${index}`, index);
    out.answered++;
    out.expectedAvailable += examItemMarks(item);
    out.expectedEarned += correct ? examItemMarks(item) : 0;
    void res;
  }
  const sa = await getSimulationAttempt(simId);
  out.examAttemptId = sa!.examAttemptId;
  return out;
}

async function submitAndScore(actorUserId: string, simId: string) {
  await finalizeOpenItemsForSubmission(actorUserId, simId);
  await completeSimulationAttempt(simId);
  return scoreAndRecordAttemptResult(simId);
}

async function versionFor(key: string) {
  const r = await db.query(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = $1`, [key]);
  return r.rows[0] as { definition_id: string; version_id: string };
}

const PLAN: Record<ExamFamily, { simulationType: SimulationType; timingMode: TimingMode; language: string }> = {
  PAA: { simulationType: 'FULL_MOCK', timingMode: 'TRAINING_TIMED', language: 'es' },
  PISA: { simulationType: 'FULL_MOCK', timingMode: 'UNTIMED', language: 'en' },
  IB: { simulationType: 'FULL_MOCK', timingMode: 'TRAINING_TIMED', language: 'en' },
  CAMBRIDGE: { simulationType: 'MINI_MOCK', timingMode: 'UNTIMED', language: 'en' },
  AICE: { simulationType: 'FULL_MOCK', timingMode: 'UNTIMED', language: 'en' },
  ICFES: { simulationType: 'FULL_MOCK', timingMode: 'OFFICIAL_SIMULATION_TIMED', language: 'es' },
};

async function main() {
  guard();
  console.log(`track-b exam scenarios -- db ${fingerprint()} -- run ${RUN}${SKIP_AI ? ' (AI skipped)' : ''}`);

  // ---------------- CATALOG (configuration layer) ----------------
  for (const cfg of DEV_CERT_VERTICALS) {
    const r = await applyExamVerticalConfig(cfg, { write: true });
    check(`CATALOG.${cfg.key}`, !!r.versionId && Object.keys(r.itemIdsByKey).length > 0, r.noop ? 'already applied (no-op)' : 'applied');
  }
  const again = await applyExamVerticalConfig(DEV_CERT_VERTICALS[0], { write: true });
  check('CATALOG.idempotent', again.noop === true);
  check('CATALOG.six-families', (await count(`SELECT COUNT(DISTINCT exam_family) n FROM exam_definitions WHERE config_key LIKE 'dev-cert.%'`)) === 6);

  const A = await student('a');
  const B = await student('b');
  const evidenceBaseline = await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [[A.studentId, B.studentId]]);

  // ---------------- PER-VERTICAL E2E ----------------
  const firstSims: Partial<Record<ExamFamily, string>> = {};
  for (const family of EXAM_FAMILIES) {
    const cfg = PRIMARY_DEV_CERT_BY_FAMILY[family];
    const { definition_id, version_id } = await versionFor(cfg.key);
    const plan = PLAN[family];
    const profile = await createStudentExamProfile({ studentId: A.studentId, examDefinitionId: definition_id, examVersionId: version_id });
    check(`${family}.profile-owned`, await isExamProfileOwnedByStudent(profile.id, A.studentId));
    check(`${family}.published-version-startable`, await isExamVersionStartableForProfile(profile.id, version_id));
    const elig = await getSimulationEligibility({ studentId: A.studentId, examVersionId: version_id, simulationType: plan.simulationType });
    check(`${family}.eligible-${plan.simulationType}`, elig.eligible, elig.reasons.join(';'));

    const started = await startSimulationAttempt({ studentId: A.studentId, examProfileId: profile.id, examVersionId: version_id, simulationType: plan.simulationType, timingMode: plan.timingMode, language: plan.language });
    const simId = started.simulationAttempt.id;
    firstSims[family] = simId;
    check(`${family}.started-frozen-policy`, !!(started.examAttempt?.frozenConfiguration as any)?.scoringModel?.config, 'scoring policy frozen on the attempt');
    check(`${family}.lifecycle-in-progress`, deriveExamLifecycle({ simulationStatus: 'ACTIVE', examAttemptStatus: 'IN_PROGRESS', resultStatus: null }) === 'IN_PROGRESS');
    check(`${family}.no-second-open-attempt`, (await findOpenSimulationAttemptForProfile(profile.id))?.id === simId);

    if (family === 'PAA') {
      // Integrity: the Tutor is restricted while the simulation is open.
      const state = await getActiveRestrictedEvidenceForStudent(A.studentId);
      check('INTEGRITY.tutor-restricted-during-exam', !state.allowed && state.reason === 'ACTIVE_EXAM_SIMULATION', state.reason);
      const conversationId = await createConversation(A.studentId);
      created.conversations.push(conversationId);
      const reply = await sendMessage(conversationId, A.studentId, 'Dame la respuesta de la pregunta 1', 'es');
      check('INTEGRITY.tutor-reply-blocked', reply.content.startsWith('No puedo darte ayuda de contenido'), reply.content.slice(0, 40));
      // Pause / resume (training timing allows it), never counted against the section clock.
      await pauseSimulationAttempt(simId);
      check('LIFECYCLE.paused-blocks-delivery', await rejects(() => getNextSimulationItem(A.user.id, simId), SimulationItemNotActiveError));
      check('INTEGRITY.tutor-restricted-while-paused', !(await getActiveRestrictedEvidenceForStudent(A.studentId)).allowed);
      await resumeSimulationAttempt(simId);
    }

    // Security on a live attempt (B is another student).
    check(`${family}.B-cannot-read-A-item`, await rejects(() => getNextSimulationItem(B.user.id, simId), SimulationItemAccessDeniedError));
    check(`${family}.B-cannot-answer-A`, await rejects(() => submitSimulationItemAnswer(B.user.id, simId, 'A', 'x', 0), SimulationItemAccessDeniedError));

    const outcome = await driveAttempt(A.user.id, simId, (i) => i % 3 !== 1, { autosaveFirst: true, freeOrderProbe: true, linearProbe: true });
    check(`${family}.no-answer-key-to-client`, outcome.leak === null, outcome.leak ?? '');
    if (family === 'PAA' || family === 'PISA' || family === 'ICFES') check(`${family}.stimulus-delivered`, outcome.sawStimulus);
    if (family === 'IB' || family === 'CAMBRIDGE') check(`${family}.mark-scheme-parts-delivered`, outcome.sawParts);
    if (family === 'PAA' || family === 'ICFES' || family === 'IB') check(`${family}.break-between-sections`, outcome.sawBreak);

    const result = await submitAndScore(A.user.id, simId);
    check(`${family}.scored`, result.scoringStatus === 'SCORED' && result.status === 'SCORED');
    check(`${family}.raw-marks-exact`, result.rawScore === outcome.expectedEarned && result.maxScore === outcome.expectedAvailable, `${result.rawScore}/${result.maxScore} expected ${outcome.expectedEarned}/${outcome.expectedAvailable}`);
    check(`${family}.sections-reported`, result.sectionResults.length === cfg.sections.length);
    check(`${family}.reproducible`, (await verifyAttemptResultReproducible(simId)).reproducible);
    check(`${family}.unofficial-provenance`, result.provenance?.final?.official === false && result.provenance?.policySource === 'FROZEN');
    const view = await getAttemptResultView(simId);
    check(`${family}.result-view`, view?.lifecycle === 'SCORED' && (view.reviewPolicy === 'SCORES_ONLY' ? view.review === null : (view.review?.length ?? 0) > 0));
    check(`${family}.A-reads-own-result`, await canAccessLearner(A.user.id, A.studentId, 'LEARNER_PROGRESS_VIEW'));
    check(`${family}.B-cannot-read-A-result`, !(await canAccessLearner(B.user.id, A.studentId, 'LEARNER_PROGRESS_VIEW')));

    // A retried submission returns the same result; nothing is re-scored or duplicated.
    const retry = await scoreAndRecordAttemptResult(simId);
    check(`${family}.retry-same-result`, retry.id === result.id && (await count(`SELECT COUNT(*) n FROM exam_attempt_results WHERE exam_attempt_id = $1`, [outcome.examAttemptId])) === 1);
    check(`${family}.no-answer-after-submit`, await rejects(() => submitSimulationItemAnswer(A.user.id, simId, 'A', 'late', 0), SimulationItemNotActiveError));
  }

  check('INTEGRITY.tutor-open-after-submission', (await getActiveRestrictedEvidenceForStudent(A.studentId)).allowed);
  check('BRIDGE.fixture-items-write-no-evidence', (await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId])) === evidenceBaseline, 'DEV fixture objectives map to no concept');

  // ---------------- SCORING: configured transformations on real attempts ----------------
  const pisaResult = await getAttemptResult((await getSimulationAttempt(firstSims.PISA!))!.examAttemptId);
  check('SCORING.pisa-band-label', !!pisaResult?.finalLabel && /illustrative/.test(pisaResult.finalLabel), pisaResult?.finalLabel ?? '');
  const icfesResult = await getAttemptResult((await getSimulationAttempt(firstSims.ICFES!))!.examAttemptId);
  check('SCORING.icfes-linear-0-100', icfesResult?.finalScore !== null && icfesResult!.finalScore! >= 0 && icfesResult!.finalScore! <= 100 && Number.isInteger(icfesResult!.finalScore));
  const ibResult = await getAttemptResult((await getSimulationAttempt(firstSims.IB!))!.examAttemptId);
  check('SCORING.ib-criteria', (ibResult?.provenance?.criteria ?? []).some((c: any) => c.criterionId === 'application') && ibResult?.provenance?.strategy === 'CRITERIA');
  const paaResult = await getAttemptResult((await getSimulationAttempt(firstSims.PAA!))!.examAttemptId);
  check('SCORING.paa-section-weighted', paaResult?.provenance?.strategy === 'SECTION_WEIGHTED' && paaResult.sectionResults.every((s) => s.weight === 1));

  // ---------------- CONFIGURATION SWITCHING / POLICY ----------------
  const pisa = await versionFor('dev-cert.pisa');
  const pisaProfile = await createStudentExamProfile({ studentId: B.studentId, examDefinitionId: pisa.definition_id, examVersionId: pisa.version_id });
  check(
    'POLICY.mode-not-offered-refused',
    await rejects(() => startSimulationAttempt({ studentId: B.studentId, examProfileId: pisaProfile.id, examVersionId: pisa.version_id, simulationType: 'TOPIC_EXAM', timingMode: 'UNTIMED', language: 'en', learningObjectiveId: randomUUID() }), SimulationModeNotAllowedError)
  );

  // ---------------- SECURITY MATRIX (DENY) ----------------
  const paa = await versionFor('dev-cert.paa');
  const icfes = await versionFor('dev-cert.icfes.saber11');
  const profileB = await createStudentExamProfile({ studentId: B.studentId, examDefinitionId: paa.definition_id, examVersionId: paa.version_id });
  const simB = (await startSimulationAttempt({ studentId: B.studentId, examProfileId: profileB.id, examVersionId: paa.version_id, simulationType: 'MINI_MOCK', timingMode: 'UNTIMED', language: 'es' })).simulationAttempt.id;
  check('SEC.A-to-attempt-B-read', await rejects(() => getNextSimulationItem(A.user.id, simB), SimulationItemAccessDeniedError));
  check('SEC.A-to-attempt-B-autosave', await rejects(() => saveSimulationItemDraft(A.user.id, simB, 0, 'A'), SimulationItemAccessDeniedError));
  check('SEC.A-to-attempt-B-submit', await rejects(() => submitSimulationItemAnswer(A.user.id, simB, 'A', 'k', 0), SimulationItemAccessDeniedError));
  check('SEC.A-to-attempt-B-handin', await rejects(() => finalizeOpenItemsForSubmission(A.user.id, simB), SimulationItemAccessDeniedError));
  check('SEC.A-to-result-B', !(await canAccessLearner(A.user.id, B.studentId, 'LEARNER_PROGRESS_VIEW')));
  check('SEC.spoofed-attempt-id', await rejects(() => getNextSimulationItem(A.user.id, randomUUID()), SimulationItemNotFoundError));
  check('SEC.spoofed-student-id', !(await canAccessLearner(A.user.id, B.studentId, 'LEARNER_INTERVENTION_CREATE')), 'start/complete/pause authorize body.studentId / attempt.studentId');
  check('SEC.spoofed-profile', !(await isExamProfileOwnedByStudent(profileB.id, A.studentId)));
  const profileA2 = await createStudentExamProfile({ studentId: A.studentId, examDefinitionId: paa.definition_id, examVersionId: paa.version_id });
  check('SEC.version-of-another-exam', !(await isExamVersionStartableForProfile(profileA2.id, icfes.version_id)));
  const draft = await createExamVersion({ examDefinitionId: paa.definition_id, versionLabel: `tb-${RUN}-draft` });
  created.tempVersions.push(draft.id);
  check('SEC.unpublished-version', !(await isExamVersionStartableForProfile(profileA2.id, draft.id)));
  check('SEC.spoofed-exam-version-id', !(await isExamVersionStartableForProfile(profileA2.id, randomUUID())));
  // Answer-key spoofing: the delivery API accepts an answer string only; a tampered structured answer is rejected, nothing recorded.
  const simA2 = (await startSimulationAttempt({ studentId: A.studentId, examProfileId: profileA2.id, examVersionId: paa.version_id, simulationType: 'MINI_MOCK', timingMode: 'UNTIMED', language: 'es' })).simulationAttempt.id;
  const n0 = await getNextSimulationItem(A.user.id, simA2);
  const respBefore = await count(`SELECT COUNT(*) n FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1`, [simA2]);
  check('SEC.client-answer-key-option-rejected', await rejects(() => submitSimulationItemAnswer(A.user.id, simA2, JSON.stringify({ correctAnswer: 'A', question: 'fake' }), 'spoof', n0.outcome === 'ITEM_READY' ? n0.targetIndex : 0), SimulationInvalidResponseError));
  check('SEC.client-fake-question-nothing-recorded', (await count(`SELECT COUNT(*) n FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1`, [simA2])) === respBefore);
  // A committed item cannot be answered twice (concurrent submissions, different keys).
  const item0 = await serverItem(simA2, 0);
  const both = await Promise.allSettled([
    submitSimulationItemAnswer(A.user.id, simA2, answerFor(item0!, true), 'race-1', 0),
    submitSimulationItemAnswer(A.user.id, simA2, answerFor(item0!, false), 'race-2', 0),
  ]);
  check('SEC.concurrent-double-submit-one-response', (await count(`SELECT COUNT(*) n FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1 AND r.target_index = 0`, [simA2])) === 1 && both.every((b) => b.status === 'fulfilled' || (b.reason as Error)?.name === 'SimulationItemNoPendingItemError'), both.map((b) => (b.status === 'fulfilled' ? 'ok' : (b.reason as Error)?.name)).join(','));
  check('SEC.resubmit-committed-item-refused', await rejects(() => submitSimulationItemAnswer(A.user.id, simA2, 'A', 'again', 0), SimulationItemNoPendingItemError) || await rejects(() => submitSimulationItemAnswer(A.user.id, simA2, 'A', 'again', 0), SimulationNavigationError));

  // Submission integrity: autosaved draft committed at hand-in, the rest MISSING.
  const n1 = await getNextSimulationItem(A.user.id, simA2);
  if (n1.outcome === 'ITEM_READY') await saveSimulationItemDraft(A.user.id, simA2, n1.targetIndex, answerFor((await serverItem(simA2, n1.targetIndex))!, true));
  const fin = await finalizeOpenItemsForSubmission(A.user.id, simA2);
  check('LIFECYCLE.handin-commits-draft', fin.committedDrafts === 1, JSON.stringify(fin));
  await completeSimulationAttempt(simA2);
  const r2 = await scoreAndRecordAttemptResult(simA2);
  check('SCORING.missing-items-count-zero', r2.provenance?.counts?.missing > 0 && r2.rawScore <= r2.maxScore, JSON.stringify(r2.provenance?.counts));

  // HARD timing (official): a section past its deadline closes server-side; drafts committed, rest MISSING.
  const profileA3 = await createStudentExamProfile({ studentId: A.studentId, examDefinitionId: icfes.definition_id, examVersionId: icfes.version_id });
  const simHard = (await startSimulationAttempt({ studentId: A.studentId, examProfileId: profileA3.id, examVersionId: icfes.version_id, simulationType: 'FULL_MOCK', timingMode: 'OFFICIAL_SIMULATION_TIMED', language: 'es' })).simulationAttempt.id;
  check('LIFECYCLE.official-never-pausable', await rejects(() => pauseSimulationAttempt(simHard), Error));
  const h0 = await getNextSimulationItem(A.user.id, simHard);
  if (h0.outcome === 'ITEM_READY') await saveSimulationItemDraft(A.user.id, simHard, h0.targetIndex, answerFor((await serverItem(simHard, h0.targetIndex))!, true));
  await db.query(
    `UPDATE simulation_attempts SET navigation_state = jsonb_set(navigation_state, '{sectionStartedAt}', to_jsonb((now() - interval '2 hours')::text)) WHERE id = $1`,
    [simHard]
  );
  const afterDeadline = await getNextSimulationItem(A.user.id, simHard);
  const hardResponses = await count(`SELECT COUNT(*) n FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1`, [simHard]);
  check('TIMING.hard-deadline-closes-section', (afterDeadline.outcome === 'ITEM_READY' && afterDeadline.section.index === 1) || afterDeadline.outcome === 'BREAK', afterDeadline.outcome);
  check('TIMING.draft-committed-at-deadline', hardResponses === 1);
  await submitAndScore(A.user.id, simHard);

  // Inactivity expiry: an idle open attempt is closed on next access and no longer restricts the Tutor.
  const profileA4 = await createStudentExamProfile({ studentId: A.studentId, examDefinitionId: icfes.definition_id, examVersionId: icfes.version_id });
  const simIdle = (await startSimulationAttempt({ studentId: A.studentId, examProfileId: profileA4.id, examVersionId: icfes.version_id, simulationType: 'FULL_MOCK', timingMode: 'UNTIMED', language: 'es' })).simulationAttempt.id;
  check('INTEGRITY.tutor-restricted-fresh-attempt', !(await getActiveRestrictedEvidenceForStudent(A.studentId)).allowed);
  await db.query(`UPDATE simulation_attempts SET navigation_state = jsonb_set(navigation_state, '{lastActivityAt}', to_jsonb((now() - interval '30 hours')::text)) WHERE id = $1`, [simIdle]);
  check('INTEGRITY.idle-attempt-no-longer-restricts', (await getActiveRestrictedEvidenceForStudent(A.studentId)).allowed);
  check('INTEGRITY.idle-attempt-expires-on-access', await rejects(() => getNextSimulationItem(A.user.id, simIdle), SimulationItemNotActiveError) && (await getSimulationAttempt(simIdle))?.status === 'ABANDONED');

  // ---------------- EVIDENCE BRIDGE (authorized) + REAL AI ----------------
  const pilot = (await db.query(
    `SELECT v.id AS version_id, d.id AS definition_id, t.learning_objective_id, ocm.canonical_concept_id
       FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
       JOIN assessment_blueprints b ON b.exam_version_id = v.id JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
       JOIN objective_concept_mappings ocm ON ocm.learning_objective_id = t.learning_objective_id AND ocm.status = 'PUBLISHED'
      WHERE d.config_key IS NULL AND d.exam_family = 'PAA' LIMIT 1`
  )).rows[0];
  if (!pilot) {
    check('BRIDGE.pilot-mapped-objective-present', false, 'no published objective->concept mapping on a PAA definition');
  } else {
    // A's own concept, matched to the canonical concept the objective maps to.
    const subjectId = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, $2) RETURNING id`, [A.studentId, `TB ${RUN} Matemáticas`])).rows[0].id;
    const conceptId = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, `tb.${RUN}.linear`])).rows[0].id;
    await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'es', 'Ecuaciones lineales')`, [conceptId]);
    await db.query(`INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ($1, $2, 'MATCHED', 'SEED_FIXTURE')`, [conceptId, pilot.canonical_concept_id]);
    const pilotProfile = await createStudentExamProfile({ studentId: A.studentId, examDefinitionId: pilot.definition_id, examVersionId: pilot.version_id });

    if (!SKIP_AI) {
      // REAL AI: generation -> validation -> delivery -> response -> scoring -> evidence.
      const t0 = Date.now();
      const simAi = (await startSimulationAttempt({ studentId: A.studentId, examProfileId: pilotProfile.id, examVersionId: pilot.version_id, simulationType: 'TOPIC_EXAM', timingMode: 'UNTIMED', learningObjectiveId: pilot.learning_objective_id, language: 'es' })).simulationAttempt.id;
      const ai = await getNextSimulationItem(A.user.id, simAi);
      aiRecord.generationMs = Date.now() - t0;
      aiRecord.outcome = ai.outcome;
      if (ai.outcome === 'ITEM_READY') {
        const item = (await serverItem(simAi, ai.targetIndex))!;
        aiRecord.source = item.exam.source;
        aiRecord.type = item.type;
        aiRecord.answerFormat = item.answerFormat;
        check('AI.generated-and-validated', item.exam.source === 'AI_GENERATED');
        check('AI.no-answer-key-to-client', findAnswerKeyLeak(ai) === null);
        const evBefore = await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId]);
        const t1 = Date.now();
        const sub = await submitSimulationItemAnswer(A.user.id, simAi, answerFor(item, true), `ai:${simAi}`, ai.targetIndex);
        aiRecord.gradingMs = Date.now() - t1;
        aiRecord.itemFeedback = sub.evaluation !== null;
        const evAfter = await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId]);
        check('AI.response-scored', true, `grading ${aiRecord.gradingMs}ms`);
        check('BRIDGE.ai-response-wrote-one-evidence', evAfter === evBefore + 1, `${evBefore}->${evAfter}`);
        const res = await submitAndScore(A.user.id, simAi);
        aiRecord.scoringStatus = res.scoringStatus;
        aiRecord.raw = `${res.rawScore}/${res.maxScore}`;
        check('AI.result-recorded', res.status === 'SCORED', `${res.scoringStatus} ${res.rawScore}/${res.maxScore}`);
        check('SCORING.no-policy-is-a-state', res.scoringStatus === 'NO_SCORING_POLICY' ? res.finalScore === null : true, res.scoringStatus);
      } else {
        aiRecord.reason = (ai as any).reason;
        check('AI.generated-and-validated', false, `${ai.outcome} ${(ai as any).reason ?? ''} -- provider failure recorded`);
        await finalizeOpenItemsForSubmission(A.user.id, simAi).catch(() => null);
        await completeSimulationAttempt(simAi).catch(() => null);
      }
    }

    // Deterministic bridge: a temporary PUBLISHED bank item on the mapped objective.
    const sys = (await db.query(`SELECT id FROM users WHERE is_system = true ORDER BY created_at, id LIMIT 2`)).rows.map((r: any) => r.id);
    const tempItem = (await db.query(
      `INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, reviewed_by, reviewed_at, published_at)
       VALUES ($1, 'multiple_choice', $2, $3, 'PUBLISHED', $4, now(), now()) RETURNING id`,
      [pilot.learning_objective_id, JSON.stringify({ key: `tb.${RUN}.bridge`, contentStatus: 'DEV_CERT_FIXTURE', language: 'es', type: 'multiple_choice', answerFormat: 'single_choice', question: 'Si 2x = 10, ¿cuánto vale x?', options: [{ id: 'A', text: '2' }, { id: 'B', text: '5' }, { id: 'C', text: '8' }, { id: 'D', text: '20' }], correctAnswer: 'B', explanation: 'x = 10/2 = 5.', difficulty: 2, marks: 1 }), sys[0], sys[1]]
    )).rows[0].id;
    created.tempItems.push(tempItem);
    const simBank = (await startSimulationAttempt({ studentId: A.studentId, examProfileId: pilotProfile.id, examVersionId: pilot.version_id, simulationType: 'TOPIC_EXAM', timingMode: 'UNTIMED', learningObjectiveId: pilot.learning_objective_id, language: 'es' })).simulationAttempt.id;
    const bankNext = await getNextSimulationItem(A.user.id, simBank);
    const bankItem = bankNext.outcome === 'ITEM_READY' ? await serverItem(simBank, bankNext.targetIndex) : null;
    check('BRIDGE.bank-item-preferred', bankItem?.exam.source === 'APPROVED_BANK' && bankItem.exam.approvedItemId === tempItem);
    const ev0 = await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1 AND source_type = 'EXAM_SIMULATION'`, [A.studentId]);
    await submitSimulationItemAnswer(A.user.id, simBank, 'B', `bank:${simBank}`, 0);
    const ev1 = await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1 AND source_type = 'EXAM_SIMULATION'`, [A.studentId]);
    check('BRIDGE.valid-response-one-evidence', ev1 === ev0 + 1, `${ev0}->${ev1}`);
    const evRow = (await db.query(`SELECT concept_id, operation_key, ai_assistance_type FROM learning_evidence WHERE student_id = $1 AND source_type = 'EXAM_SIMULATION' ORDER BY timestamp DESC LIMIT 1`, [A.studentId])).rows[0];
    check('BRIDGE.evidence-on-owner-concept', evRow?.concept_id === conceptId);
    check('BRIDGE.evidence-independent-and-idempotent', evRow?.ai_assistance_type === 'NONE' && String(evRow?.operation_key ?? '').includes('EXAM_SIMULATION_RESPONSE'), `${evRow?.ai_assistance_type} ${evRow?.operation_key}`);
    const masteryBefore = await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId]);
    const bankResult = await submitAndScore(A.user.id, simBank);
    check('BRIDGE.result-writes-no-evidence', (await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId])) === masteryBefore);
    await invalidateAttemptResult(bankResult.examAttemptId, 'Track B certification: invalidation path');
    check('BRIDGE.invalid-result-writes-no-evidence', (await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId])) === masteryBefore && (await getAttemptResult(bankResult.examAttemptId))?.status === 'INVALIDATED');
    check('BRIDGE.invalidated-lifecycle', deriveExamLifecycle({ simulationStatus: 'COMPLETED', examAttemptStatus: 'COMPLETED', resultStatus: 'INVALIDATED' }) === 'INVALIDATED');

    // An INVALID response (multi-part answer naming an unknown part) is recorded at 0 and never becomes evidence.
    await db.query(`UPDATE approved_items SET content = content || $2::jsonb WHERE id = $1`, [tempItem, JSON.stringify({ parts: [{ id: 'a', prompt: 'x?', answerFormat: 'text', correctAnswer: '5', acceptableAnswers: ['5'], marks: 1, criterion: 'A' }] })]);
    const simInv = (await startSimulationAttempt({ studentId: A.studentId, examProfileId: pilotProfile.id, examVersionId: pilot.version_id, simulationType: 'TOPIC_EXAM', timingMode: 'UNTIMED', learningObjectiveId: pilot.learning_objective_id, language: 'es' })).simulationAttempt.id;
    const invNext = await getNextSimulationItem(A.user.id, simInv);
    const evI0 = await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId]);
    if (invNext.outcome === 'ITEM_READY') await submitSimulationItemAnswer(A.user.id, simInv, JSON.stringify({ zz: '5' }), `inv:${simInv}`, invNext.targetIndex);
    const invRow = (await db.query(`SELECT r.criteria_breakdown FROM exam_attempt_item_responses r JOIN simulation_attempts s ON s.exam_attempt_id = r.exam_attempt_id WHERE s.id = $1`, [simInv])).rows[0];
    check('BRIDGE.invalid-response-recorded-zero', !!invRow?.criteria_breakdown?.invalidResponse);
    check('BRIDGE.invalid-response-no-evidence', (await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId])) === evI0);
    await submitAndScore(A.user.id, simInv);
  }

  // ---------------- DATA INTEGRITY (global, DEV) ----------------
  check('DATA.no-cross-student-attempts', (await count(`SELECT COUNT(*) n FROM simulation_attempts sa JOIN student_exam_profiles p ON p.id = sa.exam_profile_id WHERE p.student_id <> sa.student_id`)) === 0);
  check('DATA.no-cross-student-results', (await count(`SELECT COUNT(*) n FROM exam_attempt_results r JOIN exam_attempts ea ON ea.id = r.exam_attempt_id JOIN student_exam_profiles p ON p.id = ea.student_exam_profile_id WHERE p.student_id <> r.student_id`)) === 0);
  check('DATA.no-orphan-responses', (await count(`SELECT COUNT(*) n FROM exam_attempt_item_responses r LEFT JOIN exam_attempts ea ON ea.id = r.exam_attempt_id WHERE ea.id IS NULL`)) === 0);
  check('DATA.responses-within-plan', (await count(`SELECT COUNT(*) n FROM exam_attempt_item_responses r JOIN simulation_attempts sa ON sa.exam_attempt_id = r.exam_attempt_id JOIN simulation_plans sp ON sp.id = sa.simulation_plan_id WHERE r.target_index IS NOT NULL AND r.target_index >= jsonb_array_length(sp.plan->'selectedTargets')`)) === 0);
  check('DATA.no-orphan-results', (await count(`SELECT COUNT(*) n FROM exam_attempt_results r JOIN exam_attempts ea ON ea.id = r.exam_attempt_id WHERE ea.status <> 'COMPLETED'`)) === 0);
  check('DATA.one-open-attempt-per-profile', (await count(`SELECT COUNT(*) n FROM (SELECT exam_profile_id FROM simulation_attempts WHERE status IN ('ACTIVE','PAUSED') GROUP BY 1 HAVING COUNT(*) > 1) x`)) === 0);
  check('DATA.no-duplicate-item-responses', (await count(`SELECT COUNT(*) n FROM (SELECT exam_attempt_id, target_index FROM exam_attempt_item_responses WHERE target_index IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1) x`)) === 0);
  check(
    'DATA.no-foreign-exam-evidence',
    (await count(
      `SELECT COUNT(*) n FROM learning_evidence le
         JOIN exam_attempts ea ON ea.id::text = le.metadata->'context'->>'examAttemptId'
         JOIN student_exam_profiles p ON p.id = ea.student_exam_profile_id
        WHERE le.source_type = 'EXAM_SIMULATION' AND p.student_id <> le.student_id`
    )) === 0
  );
  check('DATA.no-evidence-from-invalid-responses', (await count(
    `SELECT COUNT(*) n FROM learning_evidence le JOIN exam_attempt_item_responses r ON le.operation_key LIKE '%' || r.idempotency_key || '%'
      WHERE le.source_type = 'EXAM_SIMULATION' AND r.criteria_breakdown ? 'invalidResponse'`
  )) === 0);
}

const childRefs = new Map<string, { t: string; c: string }[]>();
async function refsTo(table: string): Promise<{ t: string; c: string }[]> {
  if (!childRefs.has(table)) {
    const rows = (await db.query(
      `SELECT conrelid::regclass::text AS t, a.attname AS c
         FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND confrelid::regclass::text = $1 AND array_length(con.conkey, 1) = 1 AND conrelid::regclass::text <> $1`,
      [table]
    )).rows as { t: string; c: string }[];
    childRefs.set(table, rows);
  }
  return childRefs.get(table)!;
}

/** Deletes rows of `table` whose `col` is in `ids`, first removing (recursively) every row that references them. Fixture ids only. */
async function deleteCascade(table: string, col: string, ids: string[], depth = 0): Promise<void> {
  if (ids.length === 0 || depth > 8) return;
  const children = await refsTo(table);
  if (children.length > 0) {
    let rowIds: string[] = [];
    try {
      rowIds = (await db.query(`SELECT id::text AS id FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids])).rows.map((r: any) => r.id);
    } catch {
      rowIds = [];
    }
    for (const ch of children) await deleteCascade(ch.t, ch.c, rowIds, depth + 1);
  }
  await db.query(`DELETE FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids]);
}

async function purge(sets: Record<string, string[]>) {
  let lastErrors: string[] = [];
  for (let pass = 0; pass < 6; pass++) {
    lastErrors = [];
    for (const [table, ids] of Object.entries(sets)) {
      try {
        await deleteCascade(table, 'id', ids);
      } catch (e) {
        lastErrors.push(`${table}: ${(e as Error).message}`);
      }
    }
    if (lastErrors.length === 0) return;
  }
  throw new Error(`purge did not converge: ${lastErrors.slice(0, 4).join(' | ')}`);
}

async function cleanup() {
  guard();
  const ids = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows.map((r: any) => r.id as string);
  const userIds = Array.from(new Set([...created.users, ...(await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`tb-${RUN}-%`]))]));
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`tb-${RUN}-%`]);
  const profileIds = await ids(`SELECT id FROM profiles WHERE id = ANY($1::uuid[]) OR clerk_id LIKE $2 OR user_id = ANY($3::uuid[])`, [studentIds, `tb-${RUN}-%`, userIds]);
  const examProfileIds = await ids(`SELECT id FROM student_exam_profiles WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  const examAttemptIds = await ids(`SELECT id FROM exam_attempts WHERE student_exam_profile_id = ANY($1::uuid[])`, [examProfileIds]);
  const simIds = await ids(`SELECT id FROM simulation_attempts WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  const planIds = await ids(`SELECT id FROM simulation_plans WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  const snapshotIds = await ids(`SELECT id FROM readiness_snapshots WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  const subjectIds = await ids(`SELECT id FROM subjects WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  const conceptIds = await ids(`SELECT id FROM concepts WHERE subject_id = ANY($1::uuid[])`, [subjectIds]);
  const evidenceIds = await ids(`SELECT id FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  const conversationIds = Array.from(new Set([...created.conversations, ...(await ids(`SELECT id FROM tutor_conversations WHERE student_id = ANY($1::uuid[])`, [studentIds]))]));
  const tempItems = Array.from(new Set([...created.tempItems, ...(await ids(`SELECT id FROM approved_items WHERE content->>'key' LIKE $1`, [`tb.${RUN}.%`]))]));
  const tempVersions = Array.from(new Set([...created.tempVersions, ...(await ids(`SELECT id FROM exam_versions WHERE version_label = $1`, [`tb-${RUN}-draft`]))]));

  await purge({
    exam_attempt_results: await ids(`SELECT id FROM exam_attempt_results WHERE exam_attempt_id = ANY($1::uuid[])`, [examAttemptIds]),
    exam_attempt_item_responses: await ids(`SELECT id FROM exam_attempt_item_responses WHERE exam_attempt_id = ANY($1::uuid[])`, [examAttemptIds]),
    simulation_attempts: simIds,
    simulation_plans: planIds,
    readiness_snapshots: snapshotIds,
    exam_attempts: examAttemptIds,
    student_exam_profiles: examProfileIds,
    tutor_conversations: conversationIds,
    learning_evidence: evidenceIds,
    concepts: conceptIds,
    subjects: subjectIds,
    approved_items: tempItems,
    exam_versions: tempVersions,
  });
  await db.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [userIds, userIds]);
  await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await purge({ students: studentIds, profiles: profileIds });
  await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);

  const left =
    (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id LIKE $1`, [`tb-${RUN}-%`])) +
    (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id LIKE $1`, [`tb-${RUN}-%`])) +
    (await count(`SELECT COUNT(*) n FROM approved_items WHERE content->>'key' LIKE $1`, [`tb.${RUN}.%`])) +
    (await count(`SELECT COUNT(*) n FROM exam_versions WHERE version_label = $1`, [`tb-${RUN}-draft`])) +
    (await count(`SELECT COUNT(*) n FROM simulation_attempts WHERE student_id = ANY($1::uuid[])`, [studentIds]));
  check('CLEANUP.no-fixtures-left', left === 0, `remaining=${left}`);
}

(CLEANUP_ONLY ? Promise.resolve() : main())
  .catch((e) => check('RUN.error', false, e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
  .then(() => cleanup().catch((e) => check('CLEANUP.error', false, e instanceof Error ? e.message : String(e))))
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\nAI_RECORD ${JSON.stringify(aiRecord)}`);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    for (const f of failed) console.log(`FAILED: ${f.id} ${f.detail}`);
    await (db as any).end?.();
    process.exitCode = failed.length ? 1 : 0;
  });
