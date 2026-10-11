/**
 * L7-R1 -- Parent completion: PA-3 (released results), PA-4 (onboarding), PA-5 (parent pays).
 *
 * PA-3 and PA-5 run the REAL routes, the REAL Parent read model and the REAL Shared Foundation
 * code (isActiveParentOf, LEARNER_READ_SCOPE, resolveResultViewContext,
 * isAttemptResultVisibleToStudent, shapeAttemptResultViewForScope, isAttemptDeletedFromHistory,
 * isLiveBillingActor) against an in-memory database. Only Clerk, the canonical-user lookup, the
 * heavy result-view assembly and the payment provider call are stubbed. The stubbed result view
 * deliberately carries item-level content, so "no raw item data" is asserted on what comes out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const CHILD = '11111111-1111-4111-8111-111111111111';
const OTHER_CHILD = '22222222-2222-4222-8222-222222222222';
const PARENT_USER = 'user-parent';
const STRANGER_USER = 'user-stranger';
const SECRETS = ['QUESTION-TEXT-SENTINEL', 'LEARNER-ANSWER-SENTINEL', 'CORRECT-ANSWER-SENTINEL', 'RUBRIC-QUOTE-SENTINEL', 'PROVENANCE-SENTINEL', 'RESPONSE-HASH-SENTINEL', 'INVALIDATION-REASON-SENTINEL'];

interface FakeAttempt { id: string; studentId: string; status: string; hidden: boolean; instanceDeleted: boolean; result: null | 'SCORED' | 'INVALIDATED'; createdAt: number }
const state = {
  relationships: [] as Array<{ parentUserId: string; studentId: string; status: string }>,
  activeParentRoles: new Set<string>(),
  attempts: [] as FakeAttempt[],
};
const session = { clerkUserId: null as string | null };
const USER_BY_CLERK: Record<string, string> = { clerk_parent: PARENT_USER, clerk_stranger: STRANGER_USER };

function fakeQuery(sql: string, params: any[] = []) {
  const rows = (r: any[]) => ({ rows: r, rowCount: r.length });
  if (/FROM parent_student_relationships psr\s+JOIN profiles p ON p\.id = psr\.parent_id\s+WHERE p\.user_id = \$1 AND psr\.student_id = \$2 AND psr\.status = 'accepted'/.test(sql)) {
    // L10 SF-1: the guard's own query also requires an ACTIVE account holding an ACTIVE PARENT role.
    const roleChecked = /ar\.role = 'PARENT' AND ar\.status = 'ACTIVE'/.test(sql);
    const ok = state.relationships.some((r) => r.parentUserId === params[0] && r.studentId === params[1] && r.status === 'accepted') && (!roleChecked || state.activeParentRoles.has(params[0]));
    return rows(ok ? [{ ok: 1 }] : []);
  }
  if (/FROM simulation_attempts WHERE student_id = \$1 ORDER BY created_at DESC/.test(sql)) {
    return rows(state.attempts.filter((a) => a.studentId === params[0]).sort((a, b) => b.createdAt - a.createdAt).slice(0, params[1]).map((a) => ({ id: a.id, status: a.status })));
  }
  if (/sa\.hidden_at IS NOT NULL OR EXISTS/.test(sql)) {
    const a = state.attempts.find((x) => x.id === params[0]);
    return rows(a ? [{ deleted: a.hidden || a.instanceDeleted }] : []);
  }
  return rows([]); // isOwner and everything else: no row
}

vi.mock('@/lib/db', () => {
  const query = async (sql: string, params?: any[]) => fakeQuery(sql, params);
  return { db: { query, connect: vi.fn() }, query };
});
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: session.clerkUserId, sessionClaims: {} }),
  currentUser: async () => (session.clerkUserId ? { primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: 'parent@example.com', verification: { status: 'verified' } }] } : null),
}));
vi.mock('@/lib/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/identity')>()),
  getOrCreateCanonicalUser: async (clerkUserId: string) => ({ id: USER_BY_CLERK[clerkUserId] }),
}));
/** The canonical view as the exam core would build it for the OWNER: full item review included. */
vi.mock('@/lib/exam-core/result-view.service', () => ({
  getAttemptResultView: async (id: string) => {
    const a = state.attempts.find((x) => x.id === id);
    if (!a) return null;
    return {
      attemptId: a.id,
      examProfileId: 'profile-1',
      simulationType: 'MINI_MOCK',
      timingMode: 'TIMED',
      lifecycle: a.result ?? 'IN_PROGRESS',
      exam: { definitionName: 'PAA', family: 'PAA', versionLabel: '2026', examYear: 2026, examSession: null, contentStatus: null },
      result: a.result && {
        id: 'r-' + a.id, examAttemptId: 'ea-' + a.id, studentId: a.studentId, examVersionId: 'v1', scoringModelId: null, scoringEngineVersion: '1', scoringPolicyHash: 'RESPONSE-HASH-SENTINEL',
        status: a.result, scoringStatus: 'SCORED', rawScore: 14, maxScore: 20, finalScore: 610, finalLabel: null, sectionResults: [], objectiveResults: [],
        provenance: { note: 'PROVENANCE-SENTINEL' }, responseSetHash: 'RESPONSE-HASH-SENTINEL', scoredAt: '2026-10-10T10:00:00.000Z',
        invalidatedAt: a.result === 'INVALIDATED' ? '2026-10-11T10:00:00.000Z' : null, invalidationReason: a.result === 'INVALIDATED' ? 'INVALIDATION-REASON-SENTINEL' : null, strictReadiness: null, reviewRequiredCount: 0,
      },
      objectives: [
        { learningObjectiveId: 'lo1', code: 'A', description: 'd', fraction: 1, earned: 2, available: 2, classification: 'STRENGTH', componentId: null, concepts: [] },
        { learningObjectiveId: 'lo2', code: 'B', description: 'd', fraction: 0.2, earned: 1, available: 5, classification: 'GAP', componentId: null, concepts: [] },
      ],
      review: [{ targetIndex: 0, sectionName: 's', question: 'QUESTION-TEXT-SENTINEL', stimulusTitle: null, yourAnswer: 'LEARNER-ANSWER-SENTINEL', correctAnswer: 'CORRECT-ANSWER-SENTINEL', earned: 0, available: 1, status: 'INCORRECT', explanation: null, answerKind: 'STANDARD', reviewRequired: false, rubric: { criteria: [], evidence: [{ criterionId: 'c', quote: 'RUBRIC-QUOTE-SENTINEL' }], rationale: null, adjudicated: false } }],
      reviewPolicy: 'FULL',
      reporting: null,
      completion: { answered: 18, total: 20, missing: 2 },
      minutesUsed: 42,
      institutionPolicies: [],
      readinessStatus: null,
    };
  },
}));
const checkoutMock = vi.fn(async (..._a: any[]) => ({ checkoutUrl: 'https://pay.example/checkout' }));
vi.mock('@/services/payment.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/payment.service')>()),
  createMercadoPagoCheckout: (...a: any[]) => checkoutMock(...a),
}));

import { GET as getResults } from '@/app/api/parent/learners/[studentId]/results/route';
import { POST as postCheckout } from '@/app/api/payments/checkout/route';
import { isLiveBillingActor } from '@/services/payment.service';
import ParentResultsCard, { resultScoreLine } from '@/app/dashboard/parent/ParentResultsCard';
import ParentOnboarding, { parentOnboardingSteps } from '@/app/dashboard/parent/ParentOnboarding';
import { PARENT_HOME_MESSAGES, getParentHomeMessages } from '@/lib/i18n/parent-home-messages';
import { PARENT_ACCESS_MESSAGES } from '@/lib/i18n/parent-access-messages';
import { LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const results = (studentId: string) => getResults(new Request('http://localhost/api') as any, { params: Promise.resolve({ studentId }) });
const checkout = (body: unknown) => postCheckout(new Request('http://localhost/api/payments/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as any);
const attempt = (id: string, over: Partial<FakeAttempt> = {}): FakeAttempt => ({ id, studentId: CHILD, status: 'COMPLETED', hidden: false, instanceDeleted: false, result: 'SCORED', createdAt: state.attempts.length, ...over });
const setRelationship = (status: string) => (state.relationships = [{ parentUserId: PARENT_USER, studentId: CHILD, status }]);

beforeEach(() => {
  checkoutMock.mockClear();
  state.attempts = [];
  state.activeParentRoles = new Set([PARENT_USER, STRANGER_USER]);
  setRelationship('accepted');
  session.clerkUserId = 'clerk_parent';
});

describe('PA-3 -- released assessment results for a Parent', () => {
  it('accepted Parent + Student-visible result => visible, as a summary', async () => {
    state.attempts = [attempt('a-visible')];
    const res = await results(CHILD);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results).toEqual([
      {
        attemptId: 'a-visible', examName: 'PAA', versionLabel: '2026', simulationType: 'MINI_MOCK', status: 'SCORED', scoringStatus: 'SCORED', scoredAt: '2026-10-10T10:00:00.000Z',
        rawScore: 14, maxScore: 20, finalScore: 610, finalLabel: null, completion: { answered: 18, total: 20, missing: 2 }, minutesUsed: 42,
        objectives: { strengths: 1, developing: 0, gaps: 1, notAssessed: 0 },
      },
    ]);
  });

  it('accepted Parent + result the Student removed from history => not visible (hidden attempt, and deleted exam instance)', async () => {
    state.attempts = [attempt('a-hidden', { hidden: true }), attempt('a-instance-deleted', { instanceDeleted: true }), attempt('a-visible')];
    const body = await (await results(CHILD)).json();
    expect(body.data.results.map((r: any) => r.attemptId)).toEqual(['a-visible']);
  });

  it('a draft / in-progress / abandoned attempt, or one with no result yet, is never listed', async () => {
    state.attempts = [attempt('a-active', { status: 'ACTIVE', result: null }), attempt('a-paused', { status: 'PAUSED', result: null }), attempt('a-abandoned', { status: 'ABANDONED', result: null }), attempt('a-pending', { result: null })];
    expect((await (await results(CHILD)).json()).data.results).toEqual([]);
  });

  it('invalidated but Student-visible result => summary visible, with its status (not "scored && !invalidated")', async () => {
    state.attempts = [attempt('a-invalidated', { result: 'INVALIDATED' })];
    const [r] = (await (await results(CHILD)).json()).data.results;
    expect(r).toMatchObject({ attemptId: 'a-invalidated', status: 'INVALIDATED', rawScore: 14, maxScore: 20 });
  });

  it.each(['pending', 'declined', 'revoked'])('%s Parent relationship => refused (403), nothing read', async (status) => {
    state.attempts = [attempt('a-visible')];
    setRelationship(status);
    const res = await results(CHILD);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
  });

  it('unrelated Parent => refused; a linked Parent => refused for another Student; no session => 401', async () => {
    state.attempts = [attempt('a-visible'), attempt('b-visible', { studentId: OTHER_CHILD })];
    session.clerkUserId = 'clerk_stranger';
    expect((await results(CHILD)).status).toBe(403);
    session.clerkUserId = 'clerk_parent';
    expect((await results(OTHER_CHILD)).status).toBe(403);
    session.clerkUserId = null;
    expect((await results(CHILD)).status).toBe(401);
  });

  it('an accepted relationship whose PARENT role is no longer ACTIVE => refused (the Shared Foundation guard, not a local check)', async () => {
    state.attempts = [attempt('a-visible')];
    state.activeParentRoles.delete(PARENT_USER);
    expect((await results(CHILD)).status).toBe(403);
  });

  it('only the linked child\'s attempts are ever considered', async () => {
    state.attempts = [attempt('a-visible'), attempt('b-visible', { studentId: OTHER_CHILD })];
    expect((await (await results(CHILD)).json()).data.results.map((r: any) => r.attemptId)).toEqual(['a-visible']);
  });

  it('no raw item responses, rubric internals, provenance, hashes or invalidation reason are exposed', async () => {
    state.attempts = [attempt('a-visible'), attempt('a-invalidated', { result: 'INVALIDATED' })];
    const text = JSON.stringify(await (await results(CHILD)).json());
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
    for (const key of ['review', 'question', 'yourAnswer', 'correctAnswer', 'rubric', 'provenance', 'responseSetHash', 'scoringPolicyHash', 'strictReadiness', 'objectiveResults', 'sectionResults', 'invalidationReason']) {
      expect(text, key).not.toContain(`"${key}"`);
    }
  });

  it('source contract: release is decided by the Shared Foundation path, never by a rule in the read model', () => {
    const src = read('src/lib/parent/read-model.service.ts');
    const fn = src.slice(src.indexOf('export async function getParentReleasedResults'));
    expect(fn).toMatch(/await requireAccess\(actorUserId, studentId\);/);
    expect(fn).toMatch(/resolveResultViewContext\(/);
    expect(fn).toMatch(/shapeAttemptResultViewForScope\(view, scope, context\)/);
    expect(fn).toMatch(/relationships: \['PARENT'\], permissions: \[\.\.\.LEARNER_READ_SCOPE\.PARENT\]/);
    // No local copy of the publication rule, in either direction.
    expect(fn).not.toMatch(/hidden_at|DELETED|INVALIDATED|'COMPLETED'|'SCORED'|invalidated/);
    expect(fn).not.toMatch(/resolveLearnerReadScope|canAccessLearner/); // Parent-only: never the union of the actor's relationships
    expect(src).not.toMatch(/import \{[^}]*(resolveLearnerReadScope|canAccessLearner)[^}]*\} from/);
    const route = read('src/app/api/parent/learners/[studentId]/results/route.ts');
    expect(route).toMatch(/getParentReleasedResults\(actor\.id, studentId\)/);
    expect(route).not.toMatch(/@\/lib\/db|parent_student_relationships/);
  });

  it('the card shows the status of an invalidated result and offers no per-question review', () => {
    const l = getParentHomeMessages('en');
    const base = { attemptId: 'a', examName: 'PAA', versionLabel: '2026', scoringStatus: 'SCORED' as const, scoredAt: '2026-10-10T10:00:00.000Z', rawScore: 14, maxScore: 20, finalScore: 610, finalLabel: null, completion: null, minutesUsed: null, objectives: { strengths: 1, developing: 0, gaps: 1, notAssessed: 0 } };
    const html = renderToStaticMarkup(createElement(ParentResultsCard, { results: [{ ...base, status: 'INVALIDATED' as const }], childName: 'Ana', labels: l, locale: 'en' }));
    expect(html).toContain('Invalidated');
    expect(html).toContain('Score: 610 · 14 of 20 marks');
    expect(html).not.toMatch(/<a |href=/);
    expect(resultScoreLine({ ...base, status: 'SCORED', scoringStatus: 'NO_SCORING_POLICY' }, l)).toBe('No score calculated');
    expect(renderToStaticMarkup(createElement(ParentResultsCard, { results: [], childName: 'Ana', labels: l, locale: 'en' }))).toContain('There are no results to show yet.');
  });
});

describe('PA-4 -- Parent onboarding, derived from the relationship (D-4: no stored onboarding state)', () => {
  const page = read('src/app/dashboard/parent/page.tsx');

  it('a new Parent (no accepted relationship) is on step 2; a linked Parent is past onboarding', () => {
    expect(parentOnboardingSteps(0)).toEqual(['done', 'current', 'next']);
    expect(parentOnboardingSteps(1)).toEqual(['done', 'done', 'current']);
  });

  it('the panel renders three ordered steps, marks the current one, and reflects an invitation or a sent request', () => {
    const l = getParentHomeMessages('en');
    const plain = renderToStaticMarkup(createElement(ParentOnboarding, { labels: l, hasInvitation: false, requestSent: false }));
    expect(plain.match(/<li/g)?.length).toBe(3);
    expect(plain.match(/aria-current="step"/g)?.length).toBe(1);
    expect(plain).not.toContain(l['ph.onboarding.step2.invited']);
    expect(renderToStaticMarkup(createElement(ParentOnboarding, { labels: l, hasInvitation: true, requestSent: true }))).toContain(l['ph.onboarding.step2.invited']);
    expect(renderToStaticMarkup(createElement(ParentOnboarding, { labels: l, hasInvitation: false, requestSent: true }))).toContain(l['ph.onboarding.step2.requested']);
  });

  it('the page shows onboarding only while the Parent follows nobody, and the dashboard as soon as a relationship exists', () => {
    expect(page).toMatch(/learners\.length === 0 \? \(\s*\/\/[^\n]*\n\s*<ParentOnboarding /);
    expect(page.match(/<ParentOnboarding /g)?.length).toBe(1);
    // Accepting an invitation reloads the list, which is what moves the Parent to the dashboard.
    expect(page).toMatch(/async function respondInvitation[\s\S]*?await loadLists\(\);/);
  });

  it('onboarding completion is not stored anywhere: no browser storage, no onboarding table or service', () => {
    for (const f of ['src/app/dashboard/parent/page.tsx', 'src/app/dashboard/parent/ParentOnboarding.tsx']) {
      expect(read(f)).not.toMatch(/localStorage|sessionStorage|document\.cookie|user_role_onboarding|role-onboarding/);
    }
  });
});

describe('PA-5 -- a Parent starts a checkout for a linked child', () => {
  it('linked Parent => checkout started for the child, with the Parent as the payer', async () => {
    const res = await checkout({ studentId: CHILD });
    expect(res.status).toBe(200);
    expect((await res.json()).data.checkoutUrl).toBe('https://pay.example/checkout');
    expect(checkoutMock).toHaveBeenCalledTimes(1);
    const [studentId, email, , payerUserId] = checkoutMock.mock.calls[0];
    expect([studentId, email, payerUserId]).toEqual([CHILD, 'parent@example.com', PARENT_USER]);
  });

  it('unlinked Parent => 403, and no checkout is created', async () => {
    session.clerkUserId = 'clerk_stranger';
    expect((await checkout({ studentId: CHILD })).status).toBe(403);
    session.clerkUserId = 'clerk_parent';
    expect((await checkout({ studentId: OTHER_CHILD })).status).toBe(403);
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it.each(['pending', 'declined', 'revoked'])('%s relationship => 403, and no checkout is created', async (status) => {
    setRelationship(status);
    expect((await checkout({ studentId: CHILD })).status).toBe(403);
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it('the binding ends when the Student unlinks: the Parent is no longer a live billing actor and cannot start another checkout', async () => {
    expect(await isLiveBillingActor(PARENT_USER, CHILD)).toBe(true);
    setRelationship('revoked');
    expect(await isLiveBillingActor(PARENT_USER, CHILD)).toBe(false);
    expect((await checkout({ studentId: CHILD })).status).toBe(403);
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it('the Parent page sends the selected child\'s id through the reused SubscribeButton; the Student\'s own checkout is unchanged', () => {
    const page = read('src/app/dashboard/parent/page.tsx');
    expect(page).toMatch(/import SubscribeButton from '@\/app\/dashboard\/billing\/SubscribeButton'/);
    expect(page).toMatch(/<SubscribeButton\s+key=\{selected\.studentId\}\s+studentId=\{selected\.studentId\}/);
    expect(page).not.toMatch(/\/api\/payments\/checkout/); // one caller: the button
    const button = read('src/app/dashboard/billing/SubscribeButton.tsx');
    expect(button).toMatch(/studentId \? \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \}, body: JSON\.stringify\(\{ studentId \}\) \} : \{ method: 'POST' \}/);
    expect(read('src/app/dashboard/billing/page.tsx')).not.toMatch(/studentId=/);
  });
});

describe('copy', () => {
  it.each([['parent-home', PARENT_HOME_MESSAGES], ['parent-access', PARENT_ACCESS_MESSAGES]] as const)('%s: every locale has every key, non-empty, with the same placeholders as Spanish', (_name, catalogs) => {
    const es = catalogs.es as Record<string, string>;
    const keys = Object.keys(es).sort();
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const locale of LOCALES) {
      const c = catalogs[locale] as Record<string, string>;
      expect(Object.keys(c).sort(), locale).toEqual(keys);
      for (const k of keys) {
        expect(c[k].trim(), `${locale}:${k}`).not.toBe('');
        expect(placeholders(c[k]), `${locale}:${k}`).toEqual(placeholders(es[k]));
      }
    }
  });

  it('CR-L10-05: the access card names the two invitation refusals L10 returns', () => {
    const card = read('src/app/dashboard/profile/ParentAccessCard.tsx');
    expect(card).toMatch(/code === 'OWN_EMAIL'/);
    expect(card).toMatch(/code === 'ALREADY_LINKED'/);
  });
});
