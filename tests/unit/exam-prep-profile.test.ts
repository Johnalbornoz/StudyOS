/**
 * Exam Prep profile remove / restart -- HTTP contract of
 * DELETE /api/exam-profiles/[id] and POST /api/exam-profiles/[id]/restart,
 * and the dashboard card's "⋯" menu. The real-database behaviour (archive,
 * cancel, retention, clean re-add, one active profile, parallel double submit)
 * is proven by scripts/operations/track-b-exam-profile-scenarios.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_n: string, h: unknown) => h }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock('@/lib/exam-core/route-auth', () => ({ requireActor: vi.fn(), requireOwnerOf: vi.fn() }));
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({ getStudentExamProfile: vi.fn() }));
vi.mock('@/lib/exam-core/prep-profile.service', () => {
  class ExamProfileError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return { ExamProfileError, archiveExamProfile: vi.fn(), restartExamProfile: vi.fn() };
});

import { requireActor, requireOwnerOf } from '@/lib/exam-core/route-auth';
import { getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { archiveExamProfile, restartExamProfile, ExamProfileError } from '@/lib/exam-core/prep-profile.service';
import { DELETE as removeRoute } from '@/app/api/exam-profiles/[id]/route';
import { POST as restartRoute } from '@/app/api/exam-profiles/[id]/restart/route';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';
import { ProfileCard } from '@/app/dashboard/exam-prep/ProfileCard';

const PROFILE = '55555555-5555-5555-5555-555555555555';
const OWNER = '11111111-1111-1111-1111-111111111111';
const req = (method: string, body: unknown = { confirm: true }) => new NextRequest('http://localhost/api', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
  vi.mocked(getStudentExamProfile).mockResolvedValue({ id: PROFILE, studentId: OWNER, status: 'ACTIVE' } as any);
});

describe.each([
  ['DELETE /api/exam-profiles/[id]', () => removeRoute as any, 'DELETE', () => vi.mocked(archiveExamProfile)],
  ['POST /api/exam-profiles/[id]/restart', () => restartRoute as any, 'POST', () => vi.mocked(restartExamProfile)],
])('%s', (_name, route, method, service) => {
  it('owner -> 200 and the service gets the owner + confirmations', async () => {
    vi.mocked(requireOwnerOf).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
    service().mockResolvedValue({ status: 'ARCHIVED', newProfileId: 'n' } as any);
    const r = await route()(req(method, { confirm: true, confirmInProgress: true }), ctx(PROFILE));
    expect(r.status).toBe(200);
    expect(service()).toHaveBeenCalledWith(PROFILE, { ownerStudentId: OWNER, confirm: true, confirmInProgress: true });
  });
  it('not the owner (another Student, a Teacher, a Parent, a Coordinator) -> 404, service never called', async () => {
    vi.mocked(requireOwnerOf).mockResolvedValue({ ok: false, status: 403, error: 'FORBIDDEN' } as any);
    expect((await route()(req(method), ctx(PROFILE))).status).toBe(404);
    expect(service()).not.toHaveBeenCalled();
  });
  it('unknown profile -> 404; malformed id or extra fields -> 400; signed out -> 401', async () => {
    vi.mocked(getStudentExamProfile).mockResolvedValue(null);
    expect((await route()(req(method), ctx(PROFILE))).status).toBe(404);
    expect((await route()(req(method), ctx('x'))).status).toBe(400);
    expect((await route()(req(method, { confirm: true, purge: true }), ctx(PROFILE))).status).toBe(400);
    vi.mocked(requireActor).mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHORIZED' } as any);
    expect((await route()(req(method), ctx(PROFILE))).status).toBe(401);
  });
  it('missing (in-progress) confirmation -> 409 with the code the menu reacts to', async () => {
    vi.mocked(requireOwnerOf).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
    service().mockRejectedValue(new (ExamProfileError as any)('IN_PROGRESS_CONFIRMATION_REQUIRED'));
    const r = await route()(req(method), ctx(PROFILE));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('IN_PROGRESS_CONFIRMATION_REQUIRED');
  });
});

describe('dashboard card + copy', () => {
  const es = MESSAGES.es as unknown as Record<string, string>;
  it('the agreed Spanish copy', () => {
    expect(es['examPrep.profile.remove.action']).toBe('Quitar de mi preparación');
    expect(es['examPrep.profile.remove.title']).toBe('¿Quieres quitar este examen de tu preparación?');
    expect(es['examPrep.profile.remove.body']).toBe('Se quitará de tu plan de preparación. Tus resultados anteriores y lo que ya aprendiste no se perderán.');
    expect(es['examPrep.profile.remove.cta']).toBe('Quitar preparación');
    expect(es['examPrep.profile.remove.inProgress']).toBe('Tienes un simulacro en curso. Al quitar esta preparación, ese intento se cancelará y no podrás continuarlo.');
    expect(es['examPrep.profile.restart.action']).toBe('Empezar de nuevo');
  });
  it('every locale has every profile-menu string', () => {
    const keys = Object.keys(es).filter((k) => k.startsWith('examPrep.profile.'));
    expect(keys.length).toBe(15);
    for (const loc of LOCALES) for (const k of keys) expect((MESSAGES[loc] as unknown as Record<string, string>)[k], `${loc} ${k}`).toBeTruthy();
  });
  it('each card shows "Ver preparación" and the ⋯ menu named after the exam', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileCard, {
        profileId: PROFILE,
        examName: 'PAA (Prueba de Aptitud Académica)',
        hasInProgress: false,
        labels: es,
        info: createElement('p', null, 'PAA (Prueba de Aptitud Académica)'),
        primary: createElement('a', { href: `/dashboard/exam-prep/${PROFILE}`, className: 'btn btn-primary' }, es['ex.viewPrep']),
      })
    );
    expect(html).toContain(`>${es['ex.viewPrep']}<`);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Más acciones: PAA (Prueba de Aptitud Académica)"');
  });
});
