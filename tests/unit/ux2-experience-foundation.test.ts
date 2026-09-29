/**
 * UX-2 -- Experience Foundation + Student Shell + Home.
 *
 * Certifies the presentation layer added in UX-2 without touching any
 * cognitive rule:
 *   1. "Tu siguiente reto" presents the CANONICAL activity the Start button
 *      launches -- never the legacy activityType when the gate is on.
 *   2. Waiting / consolidated / blocked canonical states never render Start.
 *   3. Result milestones follow server-reported requirement status, never a
 *      score threshold (the 50% "PROVED/RETAINED" bug).
 *   4. Progress colour follows authoritative state -- no 75/50 thresholds.
 *   5. todayNarrative.LEARN_CHECK exists and is semantically LEARN_CHECK.
 *   6. GAP-10: remediation Explain/Transfer links carry the subject.
 *   7. Readiness security: exam-profile ownership is enforced.
 *   8. Shell / Home / responsive foundations (source contracts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { presentNextChallenge, factsCompatibleWithAuthority, type NextChallengeInput } from '@/lib/experience/next-challenge';
import { resolveResultMilestone } from '@/lib/experience/result-milestone';
import { journeyStageTone, progressFillClass, QUANTITY_FILL_CLASS } from '@/lib/experience/progress-tone';
import { challengeVerb, stageLabel } from '@/lib/experience/vocabulary';
import { selectGoalProfile, calendarDaysUntil } from '@/lib/experience/goal';
import { presentedActivityTypeForCanonical } from '@/lib/pedagogical-decision/concept-mission-override';
import { journeyStageLabel } from '@/app/dashboard/path/journeyStageLabel';
import { activityNarrative } from '@/app/dashboard/activityNarrative';
import { remediationStepHref, type RemediationStep } from '@/services/remediation.service';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import type { CanonicalLearningSession } from '@/lib/pedagogical-decision/canonical-session-launch';
import type { LearningFact } from '@/lib/adaptive-learning-policy';
import type { StudentExamProfile } from '@/lib/assessment/types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function launch(over: Partial<CanonicalLearningSession>): CanonicalLearningSession {
  return {
    policyVersion: 'studyus-canonical-v1',
    canonicalRevision: 'rev',
    stage: 'PROVE',
    actionState: 'EXECUTABLE',
    activityType: 'PROVE',
    launchStatus: 'READY',
    launchTarget: '/dashboard/quiz?mode=canonical_prove',
    launchParams: { mode: 'canonical_prove', maxQuestions: '10' },
    waitingReason: null,
    nextEligibleAt: null,
    notReadyReason: null,
    ...over,
  } as CanonicalLearningSession;
}

const FACTS: LearningFact[] = [
  { kind: 'examApproaching', daysUntil: 4 } as LearningFact,
  { kind: 'retentionReviewDue' } as LearningFact,
  { kind: 'independenceGap' } as LearningFact,
  { kind: 'prerequisiteGap', blockedConceptCount: 2 } as LearningFact,
];

function input(over: Partial<NextChallengeInput>): NextChallengeInput {
  return {
    conceptId: 'c1',
    subjectId: 's1',
    legacyDecision: { activityType: 'PRACTICE', facts: FACTS },
    canonicalAuthority: true,
    canonical: launch({}),
    legacyGate: { waiting: false, nextEligibleAt: null, zeroGapBlocked: false },
    ...over,
  };
}

/* ================================================================== *
 * 1 -- the hero shows exactly the canonical activity it launches.     *
 * ================================================================== */
describe('UX-2 §11 -- Today hero canonical consistency', () => {
  it('gate on: the presented activity is the canonical launch activity, never the legacy one (legacy PRACTICE vs canonical PROVE)', () => {
    const view = presentNextChallenge(input({}));
    expect(view.status).toBe('READY');
    if (view.status !== 'READY') return;
    expect(view.authority).toBe('CANONICAL');
    expect(view.activityType).toBe('SOLO_CHECK'); // PROVE's certified learner-facing type
    expect(view.activityType).not.toBe('PRACTICE');
    expect(view.challenge).toBe('SOLO_CHECK');
    expect(view.stage).toBe('PROVE');
    expect(view.itemCount).toBe(10);
  });

  it('every canonical activity type presents through the SAME certified mapping Concept Mission uses', () => {
    for (const type of ['LEARN_CHECK', 'PRACTICE', 'PROVE', 'RETENTION_CHECK', 'TRANSFER', 'REINFORCE'] as const) {
      const view = presentNextChallenge(input({ canonical: launch({ activityType: type }) }));
      expect(view.status).toBe('READY');
      if (view.status !== 'READY') continue;
      expect(view.activityType).toBe(presentedActivityTypeForCanonical(type));
      expect(view.challenge).toBe(type === 'REINFORCE' ? 'REINFORCE' : presentedActivityTypeForCanonical(type));
      expect(view.reinforce).toBe(type === 'REINFORCE');
    }
  });

  it('gate on with no canonical launch (read failed) is UNAVAILABLE -- never a silent fallback to the legacy activity', () => {
    const view = presentNextChallenge(input({ canonical: null }));
    expect(view).toMatchObject({ status: 'UNAVAILABLE', reason: 'CANONICAL_READ_FAILED', authority: 'CANONICAL' });
  });

  it('gate on: legacy waiting/zero-gap flags are ignored -- the canonical launchStatus alone decides', () => {
    const view = presentNextChallenge(input({ legacyGate: { waiting: true, nextEligibleAt: 'x', zeroGapBlocked: true } }));
    expect(view.status).toBe('READY');
  });

  it('gate off: the legacy activity and legacy gates apply unchanged (backward compatible)', () => {
    const ready = presentNextChallenge(input({ canonicalAuthority: false, canonical: null }));
    expect(ready).toMatchObject({ status: 'READY', authority: 'LEGACY', activityType: 'PRACTICE', challenge: 'PRACTICE', stage: null });
    if (ready.status === 'READY') expect(ready.facts).toEqual(FACTS);
    expect(presentNextChallenge(input({ canonicalAuthority: false, canonical: null, legacyGate: { waiting: true, nextEligibleAt: 'd', zeroGapBlocked: false } })))
      .toMatchObject({ status: 'WAITING', nextEligibleAt: 'd' });
    expect(presentNextChallenge(input({ canonicalAuthority: false, canonical: null, legacyGate: { waiting: false, nextEligibleAt: null, zeroGapBlocked: true } })))
      .toMatchObject({ status: 'UNAVAILABLE', reason: 'ZERO_GAP' });
  });

  it('under the canonical authority only concept-priority facts are shown -- activity-justifying legacy facts could contradict the launched activity', () => {
    const view = presentNextChallenge(input({}));
    if (view.status !== 'READY') throw new Error('expected READY');
    expect(view.facts.map((f) => f.kind)).toEqual(['examApproaching', 'prerequisiteGap']);
    expect(factsCompatibleWithAuthority(FACTS, 'LEGACY')).toEqual(FACTS);
  });

  it('the Start button and the hero read the SAME canonical launch function /api/learning/session/start runs', () => {
    const route = strip(read('src/app/api/learning/session/start/route.ts'));
    const snapshot = strip(read('src/services/learning-os-snapshot.service.ts'));
    const loader = strip(read('src/lib/experience/next-challenge.server.ts'));
    for (const src of [route, snapshot, loader]) {
      expect(src).toMatch(/getCanonicalPedagogicalDecision\(/);
      expect(src).toMatch(/resolveCanonicalLaunch\(\{/);
    }
    // the button still sends only the concept -- the server re-derives the activity
    const button = read('src/app/dashboard/StartSessionButton.tsx');
    expect(button.match(/body:\s*JSON\.stringify\(\{([^}]*)\}\)/)![1]).not.toMatch(/activityType|mode|stage/);
  });

  it('no Home/My Path hero renders the legacy decision activityType any more', () => {
    for (const p of ['src/app/dashboard/today/page.tsx', 'src/app/dashboard/path/page.tsx', 'src/app/dashboard/NextChallengeCard.tsx']) {
      const src = strip(read(p));
      expect(src, p).not.toMatch(/activity(Cta|Label|Narrative)\(\s*(best|overview\.current)[\w.?]*\.activityType/);
    }
  });
});

describe('UX-2 §11 -- loadConceptNextChallenge reads the same canonical launch for non-hero concepts', () => {
  beforeEach(() => vi.resetModules());

  it('reuses the snapshot override for the snapshot concept, and reads fresh canonical state for any other concept', async () => {
    const getCanonicalPedagogicalDecision = vi.fn(async () => ({ decision: { marker: 'd' } }));
    const resolveCanonicalLaunch = vi.fn(() => launch({ activityType: 'TRANSFER', stage: 'TRANSFER' }));
    vi.doMock('@/lib/pedagogical-decision', () => ({
      isCanonicalEngineV1Enabled: () => true,
      getCanonicalPedagogicalDecision,
      resolveCanonicalLaunch,
      CanonicalDecisionUnavailableError: class extends Error {},
    }));
    const { loadConceptNextChallenge } = await import('@/lib/experience/next-challenge.server');
    const decision = (id: string) => ({ actionConceptId: id, subjectId: 's1', activityType: 'PRACTICE', facts: [] }) as any;
    const snapshot = {
      nextExecutableItem: { decision: decision('hero') },
      canonicalOverride: launch({ activityType: 'LEARN_CHECK', stage: 'LEARN' }),
      nextExecutableItemWaiting: false,
      nextExecutableItemNextEligibleAt: null,
      nextExecutableItemZeroGapBlocked: false,
    } as any;

    const hero = await loadConceptNextChallenge({ studentId: 'st', subjectId: 's1', conceptId: 'hero', legacyDecision: decision('hero'), snapshot });
    expect(hero).toMatchObject({ status: 'READY', activityType: 'LEARN_CHECK' });
    expect(getCanonicalPedagogicalDecision).not.toHaveBeenCalled();

    const other = await loadConceptNextChallenge({ studentId: 'st', subjectId: 's1', conceptId: 'other', legacyDecision: decision('other'), snapshot });
    expect(other).toMatchObject({ status: 'READY', activityType: 'TRANSFER' });
    expect(getCanonicalPedagogicalDecision).toHaveBeenCalledWith({ studentId: 'st', conceptId: 'other' });
    expect(resolveCanonicalLaunch).toHaveBeenCalledWith({ subjectId: 's1', conceptId: 'other', decision: { marker: 'd' } });
    vi.doUnmock('@/lib/pedagogical-decision');
  });
});

/* ================================================================== *
 * 2 -- waiting / gating consistency across Student surfaces.          *
 * ================================================================== */
describe('UX-2 §14 -- Start honours the authoritative gates on every surface', () => {
  it('WAITING, CONSOLIDATED, LOCKED, BLOCKED and NOT_READY never produce a READY (startable) view', () => {
    expect(presentNextChallenge(input({ canonical: launch({ launchStatus: 'WAITING', activityType: null, nextEligibleAt: '2026-10-09' }) })))
      .toMatchObject({ status: 'WAITING', nextEligibleAt: '2026-10-09' });
    expect(presentNextChallenge(input({ canonical: launch({ launchStatus: 'CONSOLIDATED', activityType: null }) }))).toMatchObject({ status: 'CONSOLIDATED' });
    expect(presentNextChallenge(input({ canonical: launch({ launchStatus: 'LOCKED', activityType: null }) }))).toMatchObject({ status: 'UNAVAILABLE', reason: 'LOCKED' });
    expect(presentNextChallenge(input({ canonical: launch({ launchStatus: 'BLOCKED', activityType: null }) }))).toMatchObject({ status: 'UNAVAILABLE', reason: 'BLOCKED' });
    expect(presentNextChallenge(input({ canonical: launch({ launchStatus: 'NOT_READY' }) }))).toMatchObject({ status: 'UNAVAILABLE', reason: 'NOT_READY' });
    expect(presentNextChallenge(input({ canonical: launch({ launchStatus: 'READY', activityType: null }) }))).toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('the subject detail page and the subject path page only render Start for a READY view', () => {
    const subject = strip(read('src/app/dashboard/subjects/[id]/page.tsx'));
    expect(subject).toMatch(/loadConceptNextChallenge\(\{/);
    expect(subject).toMatch(/subjectChallenge\?\.status === 'READY' \? \(/);
    expect(subject).not.toMatch(/activityCta\(subjectDecision\.activityType/);

    const path = strip(read('src/app/dashboard/path/[subjectId]/page.tsx'));
    expect(path).toMatch(/loadConceptNextChallenge\(\{/);
    expect(path).toMatch(/const ready = onCurrentDecision\?\.status === 'READY' \? onCurrentDecision : null;/);
    expect(path).toMatch(/\{concept\.isCurrent && ready && \(\s*<StartSessionButton/);
    // gate-off fallback reuses the SAME isRetentionWaiting rule My Path's overview uses
    expect(path).toMatch(/isRetentionWaiting\(currentConcept\.journey\.currentStage, context\.memorySignals\.get\(currentDecision\.actionConceptId\)\?\.retentionDue\)/);
  });

  it('Today\'s secondary rows use the same presenter -- a non-READY row shows a date or a concept link, never Start', () => {
    const today = strip(read('src/app/dashboard/today/page.tsx'));
    expect(today).toMatch(/loadConceptNextChallenge\(\{/);
    const row = today.slice(today.indexOf('function PlanRow('), today.indexOf('export default async function TodayPage'));
    expect(row).toMatch(/view\.status === 'READY' \? \(\s*<StartSessionButton/);
    expect(row).toMatch(/xp\.availableOn/);
  });

  it('the hero card renders StartSessionButton only in its READY branch', () => {
    const card = strip(read('src/app/dashboard/NextChallengeCard.tsx'));
    const readyStart = card.indexOf("if (view.status === 'READY')");
    const readyEnd = card.indexOf("if (view.status === 'WAITING')");
    expect(card.slice(readyStart, readyEnd)).toMatch(/<StartSessionButton/);
    expect(card.slice(0, readyStart).replace(/import StartSessionButton[^\n]*\n/, '')).not.toMatch(/<StartSessionButton/);
    expect(card.slice(readyEnd)).not.toMatch(/<StartSessionButton/);
  });
});

/* ================================================================== *
 * 3 -- milestones follow authoritative requirement status.            *
 * ================================================================== */
describe('UX-2 §13 -- no score-threshold milestone inference', () => {
  it('a 50% quick_check ("good" score tier) is NOT celebrated as PROVED unless the server reports sufficiency', () => {
    expect(resolveResultMilestone({ quizMode: 'quick_check', proveSufficiency: { sufficient: false } })).toBeNull();
    expect(resolveResultMilestone({ quizMode: 'quick_check', proveSufficiency: null })).toBeNull();
    expect(resolveResultMilestone({ quizMode: 'quick_check', proveSufficiency: { sufficient: true } })).toBe('PROVED');
  });

  it('RETAINED requires the canonical RETAIN requirement to be SATISFIED, and never a too-soon attempt', () => {
    const satisfied = { requirements: [{ stage: 'PROVE', status: 'SATISFIED' }, { stage: 'RETAIN', status: 'SATISFIED' }] };
    const unsatisfied = { requirements: [{ stage: 'RETAIN', status: 'UNSATISFIED' }] };
    expect(resolveResultMilestone({ quizMode: 'retention_check', canonicalResults: null })).toBeNull();
    expect(resolveResultMilestone({ quizMode: 'retention_check', canonicalResults: unsatisfied })).toBeNull();
    expect(resolveResultMilestone({ quizMode: 'retention_check', canonicalResults: satisfied })).toBe('RETAINED');
    expect(resolveResultMilestone({ quizMode: 'retention_check', canonicalResults: satisfied, retentionCheckQualified: false })).toBeNull();
  });

  it('practice and every other mode never get an achievement milestone', () => {
    for (const quizMode of ['topic_practice', 'review', 'canonical_prove', 'canonical_learn_check', 'cumulative_assessment']) {
      expect(resolveResultMilestone({ quizMode, proveSufficiency: { sufficient: true } })).toBeNull();
    }
  });

  it('the presenter reads no score, and the quiz page no longer derives a pass from messageKey', () => {
    const src = strip(read('src/lib/experience/result-milestone.ts'));
    expect(src).not.toMatch(/score|messageKey|>=|<=|\b80\b|\b50\b/);
    const quiz = strip(read('src/app/dashboard/quiz/page.tsx'));
    expect(quiz).not.toMatch(/messageKey !== 'keep_going'/);
    expect(quiz).toMatch(/resolveResultMilestone\(\{/);
  });
});

describe('UX-2 §13 -- progress colour follows state, not 75/50 thresholds', () => {
  const FILES = [
    'src/app/dashboard/page.tsx',
    'src/app/dashboard/subjects/[id]/HierarchicalConceptList.tsx',
    'src/app/dashboard/subjects/[id]/ConceptList.tsx',
    'src/app/dashboard/parent/page.tsx',
    'src/app/dashboard/admin/[studentId]/AdminSubjectRow.tsx',
  ];
  it('the five former masteryFillClass copies are gone', () => {
    for (const f of FILES) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/masteryFillClass|>=\s*75|>=\s*50/);
      expect(src, f).toMatch(/@\/lib\/experience\/progress-tone/);
    }
  });
  it('tone is a pure lookup over the canonical journey stage (and REINFORCE overlay); aggregates are a neutral quantity', () => {
    expect(journeyStageTone('NOT_STARTED')).toBe('neutral');
    expect(journeyStageTone('LEARN')).toBe('neutral');
    expect(journeyStageTone('PRACTICE')).toBe('active');
    expect(journeyStageTone('PROVE')).toBe('active');
    expect(journeyStageTone('RETAIN')).toBe('strong');
    expect(journeyStageTone('CONSOLIDATED')).toBe('strong');
    expect(journeyStageTone('RETAIN', 'REINFORCE')).toBe('attention');
    expect(progressFillClass('strong')).toBe('fill-good');
    expect(QUANTITY_FILL_CLASS).toBe('fill-brand');
    expect(strip(read('src/lib/experience/progress-tone.ts'))).not.toMatch(/score|percent|>=|<=/i);
  });
});

/* ================================================================== *
 * 5 -- LEARN_CHECK narrative.                                          *
 * ================================================================== */
describe('UX-2 §15 -- todayNarrative.LEARN_CHECK', () => {
  it('exists and is non-empty in every locale, and differs from the PRACTICE / SOLO_CHECK sentences', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      const s = activityNarrative('LEARN_CHECK', t);
      expect(s, locale).toBeTruthy();
      expect(s).not.toBe(activityNarrative('PRACTICE', t));
      expect(s).not.toBe(activityNarrative('SOLO_CHECK', t));
    }
  });
  it('describes understanding first, then a check -- never independence or a test (LEARN_CHECK allows assistance)', () => {
    const es = activityNarrative('LEARN_CHECK', getMessages('es'));
    expect(es).toMatch(/entiendes/);
    expect(es).toMatch(/compruebas/);
    expect(es).not.toMatch(/sin ayuda|por tu cuenta|examen|demuestra/i);
    const en = activityNarrative('LEARN_CHECK', getMessages('en'));
    expect(en).toMatch(/understand/i);
    expect(en).not.toMatch(/without help|on your own|exam|prove/i);
  });
});

/* ================================================================== *
 * 6 -- GAP-10.                                                         *
 * ================================================================== */
describe('UX-2 §16 -- GAP-10 remediation links preserve the subject', () => {
  const step = (stepType: RemediationStep['stepType'], conceptId = 'concept-1'): RemediationStep =>
    ({ id: 'step-1', stepType, conceptId, sequence: 1, status: 'active', result: null }) as RemediationStep;

  it('EXPLAIN and TRANSFER carry subjectId, conceptId, the concept label (when it is this step\'s concept) and remediationStepId', () => {
    for (const [type, page] of [['EXPLAIN', 'explain'], ['TRANSFER', 'transfer']] as const) {
      const href = remediationStepHref(step(type), { id: 'p', subjectId: 'subj-9', conceptId: 'concept-1', conceptLabel: 'Ley de Ohm & potencia' });
      expect(href.startsWith(`/dashboard/cognitive/${page}?`)).toBe(true);
      const q = new URLSearchParams(href.split('?')[1]);
      expect(q.get('subjectId')).toBe('subj-9');
      expect(q.get('conceptId')).toBe('concept-1');
      expect(q.get('conceptLabel')).toBe('Ley de Ohm & potencia');
      expect(q.get('remediationStepId')).toBe('step-1');
    }
  });

  it('a label resolved for a different concept is never attached; the subject still is', () => {
    const q = new URLSearchParams(remediationStepHref(step('EXPLAIN', 'concept-2'), { id: 'p', subjectId: 's', conceptId: 'concept-1', conceptLabel: 'X' }).split('?')[1]);
    expect(q.get('subjectId')).toBe('s');
    expect(q.has('conceptLabel')).toBe(false);
    const bare = new URLSearchParams(remediationStepHref(step('TRANSFER'), { id: 'p', subjectId: 's' }).split('?')[1]);
    expect(bare.get('subjectId')).toBe('s');
  });

  it('every other step type resolves to exactly the same destination and mode as before (routing only)', () => {
    const path = { id: 'p', subjectId: 's' };
    expect(remediationStepHref(step('LEARN'), path)).toBe('/dashboard/quiz?subjectId=s&conceptId=concept-1&mode=topic_practice&remediationStepId=step-1');
    expect(remediationStepHref(step('GUIDED_PRACTICE'), path)).toBe('/dashboard/quiz?subjectId=s&conceptId=concept-1&mode=topic_practice&remediationStepId=step-1');
    expect(remediationStepHref(step('RETRIEVAL'), path)).toBe('/dashboard/quiz?subjectId=s&conceptId=concept-1&mode=quick_check&remediationStepId=step-1');
    expect(remediationStepHref(step('SOLO_VERIFY'), path)).toBe('/dashboard/quiz?subjectId=s&conceptId=concept-1&mode=cumulative_assessment&remediationStepId=step-1');
  });

  it('the remediation shell passes the concept it already resolved', () => {
    const src = strip(read('src/lib/remediation-session-view.ts'));
    expect(src).toMatch(/remediationStepHref\(activeStep, \{\s*id: path\.id,\s*subjectId: conceptRowData\.subject_id,\s*conceptId: path\.rootCauseConceptId,\s*conceptLabel: conceptRowData\.label,\s*\}\)/);
  });
});

/* ================================================================== *
 * 7 -- readiness exam-profile ownership (SECURITY FIX).                *
 * ================================================================== */
const authMocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  canAccessLearner: vi.fn(),
  dbQuery: vi.fn(),
  compute: vi.fn(),
  latest: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), verifyAuth: () => authMocks.verifyAuth() }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: async () => ({ id: 'actor-a' }) }));
vi.mock('@/lib/authorization', () => ({ canAccessLearner: (...a: unknown[]) => authMocks.canAccessLearner(...a) }));
vi.mock('@/lib/db', () => ({ db: { query: (...a: unknown[]) => authMocks.dbQuery(...a), connect: vi.fn() }, query: (...a: unknown[]) => authMocks.dbQuery(...a) }));
vi.mock('@/lib/readiness/readiness.service', () => ({
  computeReadinessSnapshot: (...a: unknown[]) => authMocks.compute(...a),
  getLatestReadinessSnapshot: (...a: unknown[]) => authMocks.latest(...a),
  listReadinessSnapshots: (...a: unknown[]) => authMocks.list(...a),
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const PROFILE_A = '22222222-2222-4222-8222-222222222222';
const PROFILE_B = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';

describe('UX-2 §17 -- SECURITY: /api/readiness enforces exam-profile ownership', () => {
  beforeEach(() => {
    authMocks.verifyAuth.mockReset().mockResolvedValue({ userId: 'clerk-a', email: null });
    authMocks.canAccessLearner.mockReset().mockResolvedValue(true);
    // ownership table: PROFILE_A belongs to STUDENT_A, PROFILE_B does not
    authMocks.dbQuery.mockReset().mockImplementation(async (sql: string, params: unknown[]) => {
      if (/FROM student_exam_profiles WHERE id = \$1 AND student_id = \$2/.test(sql)) {
        return { rows: params[0] === PROFILE_A && params[1] === STUDENT_A ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    });
    authMocks.compute.mockReset().mockResolvedValue({ id: 'snap' });
    authMocks.latest.mockReset().mockResolvedValue({ id: 'snap-latest' });
    authMocks.list.mockReset().mockResolvedValue([]);
  });

  it('GET: an authorized learner asking for ANOTHER learner\'s profile id gets 404 and no snapshot is read', async () => {
    const { GET } = await import('@/app/api/readiness/route');
    const res: any = await GET({ url: `https://t/api/readiness?studentId=${STUDENT_A}&examProfileId=${PROFILE_B}` } as any);
    expect(res.status).toBe(404);
    expect(authMocks.latest).not.toHaveBeenCalled();
    expect(authMocks.list).not.toHaveBeenCalled();
    const resAll: any = await GET({ url: `https://t/api/readiness?studentId=${STUDENT_A}&examProfileId=${PROFILE_B}&all=true` } as any);
    expect(resAll.status).toBe(404);
    expect(authMocks.list).not.toHaveBeenCalled();
  });

  it('GET: the learner\'s own profile still returns its latest snapshot (response unchanged)', async () => {
    const { GET } = await import('@/app/api/readiness/route');
    const res: any = await GET({ url: `https://t/api/readiness?studentId=${STUDENT_A}&examProfileId=${PROFILE_A}` } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { snapshot: { id: 'snap-latest' } } });
    expect(authMocks.latest).toHaveBeenCalledWith(PROFILE_A);
  });

  it('POST compute: a snapshot can never be written against another learner\'s profile', async () => {
    const { POST } = await import('@/app/api/readiness/compute/route');
    const res: any = await POST({ json: async () => ({ studentId: STUDENT_A, examProfileId: PROFILE_B, examVersionId: VERSION }) } as any);
    expect(res.status).toBe(404);
    expect(authMocks.compute).not.toHaveBeenCalled();
    const ok: any = await POST({ json: async () => ({ studentId: STUDENT_A, examProfileId: PROFILE_A, examVersionId: VERSION }) } as any);
    expect(ok.status).toBe(200);
    expect(authMocks.compute).toHaveBeenCalledWith({ studentId: STUDENT_A, examProfileId: PROFILE_A, examVersionId: VERSION });
  });

  it('authorization still runs first: a denied learner gets 403 before any ownership lookup', async () => {
    authMocks.canAccessLearner.mockResolvedValue(false);
    const { GET } = await import('@/app/api/readiness/route');
    const res: any = await GET({ url: `https://t/api/readiness?studentId=${STUDENT_A}&examProfileId=${PROFILE_A}` } as any);
    expect(res.status).toBe(403);
    expect(authMocks.dbQuery).not.toHaveBeenCalled();
  });

  it('the readiness calculation itself is untouched by the fix', () => {
    for (const p of ['src/app/api/readiness/route.ts', 'src/app/api/readiness/compute/route.ts']) {
      expect(read(p)).toMatch(/isExamProfileOwnedByStudent\(/);
    }
    expect(read('src/lib/readiness/readiness.service.ts')).not.toMatch(/isExamProfileOwnedByStudent|UX-2/);
  });
});

/* ================================================================== *
 * 8 -- vocabulary, shell, Home, responsive foundations.                *
 * ================================================================== */
describe('UX-2 §12 -- one learner vocabulary', () => {
  it('every challenge kind has copy in every locale', () => {
    const kinds = ['PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION', 'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM', 'LEARN_CHECK', 'REINFORCE'] as const;
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const k of kinds) expect(challengeVerb(k, t), `${locale}:${k}`).toBeTruthy();
    }
    const es = getMessages('es');
    expect(challengeVerb('PRACTICE', es)).toBe('Entrénalo');
    expect(challengeVerb('SOLO_CHECK', es)).toBe('Demuéstralo');
  });

  it('My Path and Concept Mission render the SAME stage labels (one vocabulary), without jargon', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const stage of ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER', 'CONSOLIDATED'] as const) {
        expect(journeyStageLabel(stage, t)).toBe(stageLabel(stage, t));
        expect(stageLabel(stage, t)).toBe(t[`conceptMission.stage.${stage}`]);
      }
    }
    const es = getMessages('es');
    expect([stageLabel('RETAIN', es), stageLabel('TRANSFER', es), stageLabel('CONSOLIDATED', es)]).toEqual(['Recordar', 'Aplicar', 'Dominado']);
    expect(stageLabel('PROVE', es)).toBe('Demostrar'); // certified product name unchanged
  });
});

describe('UX-2 §8/§9 -- Student shell', () => {
  const SHELL = read('src/app/dashboard/LearnerShell.tsx');
  const CSS = read('src/app/globals.css');

  it('bottom tabs come only from the nav config\'s mobileTab flags; the "Más" tab opens the same focus-trapped drawer', () => {
    expect(SHELL).toMatch(/const tabs = allItems\.filter\(\(i\) => i\.mobileTab\)\.slice\(0, 4\);/);
    const tabBar = SHELL.slice(SHELL.indexOf('function TabBar('), SHELL.indexOf('function Footer('));
    expect(tabBar).toMatch(/ref=\{moreRef\}/);
    expect(tabBar).toMatch(/aria-controls="lx-drawer"/);
    expect(tabBar).toMatch(/aria-current=\{active \? 'page' : undefined\}/);
    expect(SHELL).toMatch(/moreRef=\{menuBtnRef\}/);
    // the hamburger remains for workspaces without tabs (parent/teacher/institution/admin)
    expect(SHELL).toMatch(/\{!hasTabs && \(\s*<button\s*ref=\{menuBtnRef\}/);
  });

  it('secondary/account groups are native disclosures that open automatically when they hold the current page', () => {
    expect(SHELL).toMatch(/<details key=\{group\.kind\} className="lx-nav-group" open=\{expandAll \|\| holdsActive\}>/);
  });

  it('the tab bar is phone/tablet only and reserves space so content is never hidden under it', () => {
    expect(CSS).toMatch(/\.lx-tabbar \{ display: none; \}/);
    const mq = CSS.slice(CSS.indexOf('@media (max-width: 1023px) {\n  .lx-tabbar'));
    expect(mq).toMatch(/position: fixed;/);
    expect(mq).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(mq).toMatch(/\.lx-shell--tabs \.lx-main \{ padding-bottom: calc\(/);
    expect(CSS).toMatch(/\.lx-tab \{[^}]*min-height: 60px;/);
  });

  it('client-only route boundaries get the shell\'s resolved language', () => {
    expect(SHELL).toMatch(/<ShellLocaleProvider value=\{locale\}>\{children\}<\/ShellLocaleProvider>/);
    expect(read('src/app/dashboard/layout.tsx')).toMatch(/locale=\{locale\}/);
  });
});

describe('UX-2 §10/§21 -- Home structure and states', () => {
  const TODAY = strip(read('src/app/dashboard/today/page.tsx'));

  it('loading and error boundaries exist for the shell/Home and are honest (retry, never "no data")', () => {
    expect(existsSync(join(process.cwd(), 'src/app/dashboard/today/loading.tsx'))).toBe(true);
    const err = read('src/app/dashboard/error.tsx');
    expect(err).toMatch(/^'use client';/);
    const body = read('src/app/dashboard/RouteErrorState.tsx');
    expect(body).toMatch(/onClick=\{\(\) => retry\(\)\}/);
    expect(body).toMatch(/tone="error"/);
    expect(read('src/components/ui/InlineAlert.tsx')).toMatch(/role=\{tone === 'error' \? 'alert' : 'status'\}/);
  });

  it('the goal names an EXISTING exam profile only -- never invented', () => {
    expect(TODAY).toMatch(/selectGoalProfile\(examProfiles, todayIso\)/);
    expect(TODAY).toMatch(/\{goalProfile && goalName && \(/);
    const profile = (over: Partial<StudentExamProfile>): StudentExamProfile => ({
      id: 'p', studentId: 's', examDefinitionId: 'd', examVersionId: null, purpose: null, programmeContext: null,
      subjectFocus: null, examDate: null, timezone: null, institutionTargetId: null, status: 'ACTIVE', ...over,
    });
    expect(selectGoalProfile([], '2026-09-29')).toBeNull();
    expect(selectGoalProfile([profile({ status: 'ARCHIVED' })], '2026-09-29')).toBeNull();
    expect(selectGoalProfile([profile({ id: 'past', examDate: '2026-01-01' })], '2026-09-29')).toBeNull();
    expect(selectGoalProfile([profile({ id: 'late', examDate: '2027-05-01' }), profile({ id: 'soon', examDate: '2026-11-02' })], '2026-09-29')!.id).toBe('soon');
    expect(calendarDaysUntil('2026-10-01', '2026-09-29')).toBe(2);
  });

  it('the progress snapshot shows only existing authoritative values (learning days this week, the plan\'s own minutes)', () => {
    expect(TODAY).toMatch(/getLearningDaysThisWeek\(studentId\)/);
    expect(TODAY).toMatch(/snapshot\.dailyPlan\.plannedMinutes/);
    expect(TODAY).not.toMatch(/readiness|masteryScore|mastery_score|avgMastery|getStudentProgressOverview/i);
  });

  it('a snapshot read failure renders an error with Retry -- never the caught-up/empty copy', () => {
    const unresolved = TODAY.slice(TODAY.indexOf("todayState === 'UNRESOLVED' ? ("));
    expect(unresolved.slice(0, 600)).toMatch(/<InlineAlert\s*tone="error"/);
  });
});

describe('UX-2 §23 -- no learning rules in the UX-2 presentation layer', () => {
  const OWNED = [
    'src/lib/experience/next-challenge.ts',
    'src/lib/experience/next-challenge.server.ts',
    'src/lib/experience/vocabulary.ts',
    'src/lib/experience/progress-tone.ts',
    'src/lib/experience/result-milestone.ts',
    'src/lib/experience/goal.ts',
    'src/app/dashboard/NextChallengeCard.tsx',
    'src/app/dashboard/StageTrack.tsx',
    'src/app/dashboard/today/page.tsx',
    'src/app/dashboard/LearnerShell.tsx',
    'src/components/ui/StatTile.tsx',
  ];
  it('no score thresholds, mastery/readiness computation or activity selection in UX-2 files', () => {
    for (const f of OWNED) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/(score|mastery|readiness|percent|retention)\w*\s*[<>]=?\s*\d/i);
      expect(src, f).not.toMatch(/selectActivityType|rankLearningDecisions|computeLearningState|evaluateCanonicalLearningState|buildDailyLearningPlan|selectExecutableNextAction/);
      expect(src, f).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
    }
  });
});

describe('UX-2 §19/§20 -- responsive and content foundations', () => {
  const CSS = read('src/app/globals.css');
  it('wide math scrolls inside its own box and the main column can shrink (no page-level horizontal overflow)', () => {
    expect(CSS).toMatch(/\.katex-display \{ overflow-x: auto;/);
    expect(CSS).toMatch(/\.lx-main \{ min-width: 0; \}/);
    expect(CSS).toMatch(/body \{ overflow-wrap: break-word; \}/);
  });
  it('touch devices get 44px buttons and 16px form text (no iOS focus zoom)', () => {
    const coarse = CSS.slice(CSS.indexOf('@media (pointer: coarse)'));
    expect(coarse).toMatch(/min-height: var\(--touch-target\)/);
    expect(coarse).toMatch(/font-size: 16px !important/);
    expect(CSS).toMatch(/--touch-target: 44px;/);
  });
  it('buttons may wrap instead of overflowing, and use the page font', () => {
    expect(CSS).toMatch(/\.btn \{\s*font-family: inherit;[\s\S]*?min-height: 40px;/);
  });
  it('animation added by UX-2 respects prefers-reduced-motion', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-skeleton \{ animation: none; \}/);
  });
  it('dark mode defines the new tokens and declares color-scheme so native controls follow', () => {
    const dark = CSS.slice(CSS.indexOf('@media (prefers-color-scheme: dark)'), CSS.indexOf('* {'));
    expect(dark).toMatch(/color-scheme: dark;/);
    expect(dark).toMatch(/--info:/);
    expect(dark).toMatch(/--hero-bg:/);
  });
});

/* ================================================================== *
 * 9 -- public landing (/[locale]) aligned to the UX-2 positioning.     *
 * ================================================================== */
describe('UX-2 landing -- "No estudies más. Estudia mejor."', () => {
  const PAGE = strip(read('src/app/[locale]/page.tsx'));
  const LAYOUT = strip(read('src/app/[locale]/layout.tsx'));
  const LANDING_KEYS = [
    'marketing.h1', 'marketing.subhead', 'marketing.seoTitle', 'marketing.seoDescription', 'marketing.footerTagline',
    'landing.eyebrow', 'landing.previewLabel', 'landing.previewNote', 'landing.previewConcept', 'landing.previewSubject',
    'landing.principlesTitle', 'landing.journeyTitle', 'landing.journeyIntro', 'landing.coachTitle',
    'landing.finalTitle', 'landing.finalBody', 'landing.haveAccount', 'landing.languagesLabel',
    ...[1, 2, 3].flatMap((i) => [`landing.principle${i}Title`, `landing.principle${i}Body`, `landing.coach${i}Title`, `landing.coach${i}Body`]),
    ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`landing.step${i}Name`, `landing.step${i}Body`]),
  ];

  it('the old narrative is gone and the new positioning is the headline in all five languages', () => {
    const expected: Record<string, string> = {
      es: 'No estudies más. Estudia mejor.',
      en: "Don't study more. Study better.",
      de: 'Nicht mehr lernen. Besser lernen.',
      fr: "N'étudie pas plus. Étudie mieux.",
      pt: 'Não estude mais. Estude melhor.',
    };
    for (const locale of LOCALES) {
      const t = getMessages(locale) as unknown as Record<string, string>;
      expect(t['marketing.h1']).toBe(expected[locale]);
      expect(t['marketing.footerTagline']).toBe(expected[locale]);
      expect(t['marketing.seoTitle']).toContain(expected[locale]);
    }
    expect(read('src/lib/i18n/messages.ts')).not.toMatch(/No basta con acertar|Domínalo/);
  });

  it('every landing key has non-empty copy in every locale', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale) as unknown as Record<string, string>;
      for (const k of LANDING_KEYS) expect(t[k]?.trim(), `${locale}:${k}`).toBeTruthy();
    }
  });

  it('the storytelling follows the approved narrative: Descubre → Enfócate → Aprende → Practica → Demuestra → Avanza', () => {
    const es = getMessages('es') as unknown as Record<string, string>;
    expect([1, 2, 3, 4, 5, 6].map((i) => es[`landing.step${i}Name`])).toEqual(['Descubre', 'Enfócate', 'Aprende', 'Practica', 'Demuestra', 'Avanza']);
    expect(PAGE).toMatch(/const JOURNEY = \[1, 2, 3, 4, 5, 6\] as const;/);
    for (const section of ['lp-principles', 'lp-journey', 'lp-coach', 'lp-faq', 'lp-final']) expect(PAGE).toContain(`aria-labelledby="${section}"`);
  });

  it('authentication, sign-up, locale routing and SEO are preserved', () => {
    expect(PAGE).toMatch(/if \(!isSupportedLocale\(locale\)\) notFound\(\);/);
    expect(PAGE).toMatch(/export function generateStaticParams\(\)/);
    expect(PAGE).toMatch(/export async function generateMetadata/);
    expect(PAGE).toMatch(/canonical: `\$\{SITE_URL\}\/\$\{locale\}`/);
    expect(PAGE).toMatch(/'@type': 'FAQPage'/);
    expect(PAGE).toMatch(/href="\/sign-up"/);
    expect(PAGE).toMatch(/href="\/sign-in"/);
    expect(PAGE).toMatch(/href=\{`\/\$\{locale\}\/how-it-works`\}/);
    const nav = LAYOUT.slice(LAYOUT.indexOf('<nav className="mkt-nav"'), LAYOUT.indexOf('</nav>'));
    expect(nav).toMatch(/\/sign-in/);
    expect(nav).toMatch(/\/sign-up/);
    expect(LAYOUT).toMatch(/LOCALES\.map\(\(l\) => \(/);
    expect(LAYOUT).toMatch(/hrefLang=\{l\}/);
    // presentation only: no data access, auth calls or client state on the public page
    expect(PAGE + LAYOUT).not.toMatch(/@\/lib\/db|getOrCreate|@clerk\/nextjs\/server|use client|fetch\(/);
  });

  it('the product preview is a labelled, non-interactive illustration -- never learner data or a working control', () => {
    expect(PAGE).toMatch(/<div className="xp-hero lp-preview-card" aria-hidden="true">/);
    expect(PAGE).toMatch(/<figcaption className="lp-preview-caption">/);
    expect(PAGE).toMatch(/landing\.previewNote/);
    const preview = PAGE.slice(PAGE.indexOf('<figure className="lp-preview">'), PAGE.indexOf('</figure>'));
    expect(preview).not.toMatch(/<Link|<button|href=|StartSessionButton/);
  });

  it('responsive: two-column hero on desktop, single column and full-width CTAs on phones', () => {
    const css = read('src/app/globals.css');
    const lp = css.slice(css.indexOf('UX-2 -- public landing'));
    expect(lp).toMatch(/\.lp-hero-grid \{ display: grid; grid-template-columns: minmax\(0, 1\.05fr\) minmax\(0, 0\.95fr\);/);
    expect(lp).toMatch(/@media \(max-width: 1023px\) \{\s*\.lp-hero-grid \{ grid-template-columns: 1fr;/);
    const phone = lp.slice(lp.indexOf('@media (max-width: 599px)'));
    expect(phone).toMatch(/\.lp-cta-row \.btn \{ width: 100%; \}/);
    expect(phone).toMatch(/\.lp-principles, \.lp-journey \{ grid-template-columns: 1fr; \}/);
  });

  it('How it works uses the same stage vocabulary as the product (no Retener/Transferir jargon)', () => {
    const es = getMessages('es') as unknown as Record<string, string>;
    expect(es['howItWorks.h1']).toBe('Aprender. Practicar. Demostrar. Recordar. Aplicar.');
    expect(es['howItWorks.h1']).not.toMatch(/Retener|Transferir/);
  });
});
