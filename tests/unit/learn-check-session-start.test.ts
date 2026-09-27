/**
 * LEARN_CHECK session start in demo mode -- the CTA and the API never
 * contradict each other: an unlicensed Student is told a licence is needed
 * BEFORE any launch, instead of reaching a quiz that fails with 403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  verifyStudentAccess: vi.fn(),
  getOrCreateCanonicalUser: vi.fn(),
  canUseCapability: vi.fn(),
  resolveConceptSubjectForStudent: vi.fn(),
  getCanonicalPedagogicalDecision: vi.fn(),
  resolveCanonicalLaunch: vi.fn(),
  startLearningSession: vi.fn(),
  getLearningDecisions: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ verifyAuth: h.verifyAuth, verifyStudentAccess: h.verifyStudentAccess }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: h.getOrCreateCanonicalUser }));
vi.mock('@/lib/entitlements', () => ({ canUseCapability: h.canUseCapability }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn(async () => 'es') }));
vi.mock('@/services/learning-session-engine.service', () => ({ startLearningSession: h.startLearningSession }));
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({ getLearningDecisions: h.getLearningDecisions }));
vi.mock('@/lib/pedagogical-decision', () => ({
  isCanonicalEngineV1Enabled: () => true,
  getCanonicalPedagogicalDecision: h.getCanonicalPedagogicalDecision,
  CanonicalDecisionUnavailableError: class extends Error {},
  resolveCanonicalLaunch: h.resolveCanonicalLaunch,
  resolveConceptSubjectForStudent: h.resolveConceptSubjectForStudent,
}));

import { POST } from '@/app/api/learning/session/start/route';
import { classifySessionLaunch, LICENSE_CTA_PATH } from '@/lib/lx/session-launch-outcome';
import { getMessages } from '@/lib/i18n/messages';
import { NextRequest } from 'next/server';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const CONCEPT = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '33333333-3333-4333-8333-333333333333';
const LAUNCH = { launchStatus: 'READY', launchTarget: `/dashboard/quiz?mode=canonical_learn_check&conceptId=${CONCEPT}` };

const req = (body: unknown) => new NextRequest('https://dev.test/api/learning/session/start', { method: 'POST', body: JSON.stringify(body) });
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyAuth.mockResolvedValue({ userId: 'clerk_1', email: 'ana@example.com', role: 'student' });
  h.verifyStudentAccess.mockResolvedValue(true);
  h.getOrCreateCanonicalUser.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });
  h.canUseCapability.mockResolvedValue(true);
  h.resolveConceptSubjectForStudent.mockResolvedValue({ subjectId: SUBJECT });
  h.getCanonicalPedagogicalDecision.mockResolvedValue({ decision: { activityType: 'LEARN_CHECK' } });
  h.resolveCanonicalLaunch.mockReturnValue(LAUNCH);
});

describe('POST /api/learning/session/start', () => {
  it('a valid, licensed Student starts LEARN_CHECK', async () => {
    const res = await POST(req({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.session).toEqual(LAUNCH);
    expect(h.canUseCapability).toHaveBeenCalledWith('user-1', STUDENT, 'LEARNING_FULL_ACCESS');
  });

  it('another student\'s learner/subject stays 403 (ownership checked before anything else)', async () => {
    h.verifyStudentAccess.mockResolvedValue(false);
    const res = await POST(req({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('FORBIDDEN');
    expect(h.canUseCapability).not.toHaveBeenCalled();
    expect(h.resolveCanonicalLaunch).not.toHaveBeenCalled();
  });

  it('a concept that is not the student\'s is still refused', async () => {
    h.resolveConceptSubjectForStudent.mockResolvedValue(null);
    const res = await POST(req({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status).toBe(404);
    expect(h.resolveCanonicalLaunch).not.toHaveBeenCalled();
  });

  it('a user without the Student role stays blocked (access check fails -> 403, no entitlement lookup)', async () => {
    h.verifyAuth.mockResolvedValue({ userId: 'clerk_parent', email: 'p@example.com', role: 'parent' });
    h.verifyStudentAccess.mockResolvedValue(false);
    const res = await POST(req({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status).toBe(403);
    expect(h.canUseCapability).not.toHaveBeenCalled();
  });

  it('demo mode (no LEARNING_FULL_ACCESS) -> 403 ENTITLEMENT_REQUIRED before any decision or launch; nothing is started', async () => {
    h.canUseCapability.mockResolvedValue(false);
    const res = await POST(req({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ENTITLEMENT_REQUIRED');
    // no session, no decision computation, no launch -> no evidence can exist
    expect(h.getCanonicalPedagogicalDecision).not.toHaveBeenCalled();
    expect(h.resolveCanonicalLaunch).not.toHaveBeenCalled();
    expect(h.startLearningSession).not.toHaveBeenCalled();
  });
});

describe('CTA and API never contradict each other', () => {
  it('the button maps a licence refusal to its own explained state, never a generic retry', () => {
    expect(classifySessionLaunch(403, { error: 'ENTITLEMENT_REQUIRED' })).toEqual({ kind: 'LICENSE_REQUIRED' });
    expect(classifySessionLaunch(200, { data: { session: LAUNCH } })).toEqual({ kind: 'LAUNCH', target: LAUNCH.launchTarget });
    expect(classifySessionLaunch(403, { error: 'FORBIDDEN' })).toEqual({ kind: 'UNAVAILABLE' });
    expect(classifySessionLaunch(200, { data: { session: { launchStatus: 'UNAVAILABLE' } } })).toEqual({ kind: 'UNAVAILABLE' });
    expect(classifySessionLaunch(500, null)).toEqual({ kind: 'UNAVAILABLE' });
    expect(LICENSE_CTA_PATH).toBe('/dashboard/billing');
  });

  it('session start and quiz generation enforce the SAME capability and error code', () => {
    const start = read('src/app/api/learning/session/start/route.ts');
    const generate = read('src/app/api/quizzes/generate-and-take/route.ts');
    for (const src of [start, generate]) {
      expect(src).toMatch(/canUseCapability\([^)]*'LEARNING_FULL_ACCESS'\)/);
      expect(src).toMatch(/error: 'ENTITLEMENT_REQUIRED'/);
    }
  });

  it('the quiz page shows the licence state (not "try again") for ENTITLEMENT_REQUIRED on both generation paths', () => {
    const quiz = read('src/app/dashboard/quiz/page.tsx');
    expect(quiz).toMatch(/if \(errorReason === 'ENTITLEMENT_REQUIRED'\) return licenseRequiredCard\(\);/);
    expect(quiz).toMatch(/if \(genErrorReason === 'ENTITLEMENT_REQUIRED'\) return licenseRequiredCard\(\);/);
    expect(quiz).toMatch(/err\.reason = 'ENTITLEMENT_REQUIRED'/);
  });
});

describe('localized errors', () => {
  it('licence copy exists in Spanish (and every locale)', () => {
    expect(getMessages('es')['learning.licenseRequiredTitle']).toBe('Actividad incluida en la licencia');
    expect(getMessages('es')['learning.licenseRequiredBody']).toMatch(/modo demostración/);
    for (const l of ['en', 'de', 'fr', 'pt']) {
      expect(getMessages(l)['learning.licenseRequiredBody']).toMatch(/\S/);
    }
  });

  it('before the activity establishes its language, quiz error screens follow the INTERFACE language (never a hard-coded en)', () => {
    const quiz = read('src/app/dashboard/quiz/page.tsx');
    expect(quiz).not.toMatch(/useState<Locale>\('en'\);/);
    // the interface locale is adopted for `at` until generation/switch sets the activity language (LX-4P-R3 afterwards)
    expect(quiz).toMatch(/if \(!activityLanguageEstablishedRef\.current\) setQuizLanguage\(lang\.locale\);/);
    expect(quiz).toMatch(/activityLanguageEstablishedRef\.current = true;\n\s+setQuizLanguage\(data\.language\);/);
    // the prepare-failed copy is localized (es differs from en)
    expect(getMessages('es')['practice.prepareFailedBody']).not.toBe(getMessages('en')['practice.prepareFailedBody']);
  });
});
