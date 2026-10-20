/**
 * Track A -- UX fix: notification READ state is independent from business
 * ACTION state, the badge counts unread notifications only (same model for
 * every role), and Institution Intelligence never exposes technical ids
 * (governed context, smart defaults, explanations and empty states in 5
 * locales, foreign ids ignored).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
const accessMock = vi.fn();
vi.mock('@/lib/institution-intelligence', () => ({ requireInstitutionAccess: (...a: any[]) => accessMock(...a) }));

import { isNotificationActionPending, type PendingAction } from '@/lib/notifications/pending-actions.service';
import { buildParentNav, buildTeacherNav, buildInstitutionNav, buildAdminNav } from '@/lib/lx/workspace-navigation';
import { getMessages } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(p, 'utf-8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  accessMock.mockReset().mockResolvedValue(undefined);
});

describe('read state vs pending action', () => {
  const actions: PendingAction[] = [
    { kind: 'CLASS_INVITATION', id: 'enr-1', createdAt: '2026-10-01', href: null, className: 'Math 11', institutionName: 'ALBO' },
    { kind: 'PARENT_REQUEST', id: 'parent-1', createdAt: '2026-10-01', href: null, parentName: 'Pilar' },
    { kind: 'TEACHER_REQUEST', id: 'mem-1', createdAt: '2026-10-01', href: '/x', institutionName: 'ALBO', teacherEmail: 't@x.com' },
  ];
  it('an invitation can be READ and still PENDING (read state never consulted)', () => {
    expect(isNotificationActionPending({ type: 'CLASS_ENROLLMENT_INVITE', payload: { className: 'Math 11', institutionName: 'ALBO' } }, actions)).toBe(true);
    expect(isNotificationActionPending({ type: 'CLASS_ENROLLMENT_INVITE', payload: { enrollmentId: 'enr-1', className: 'Other' } }, actions)).toBe(true);
    expect(isNotificationActionPending({ type: 'PARENT_LINK_REQUEST', payload: { parentId: 'parent-1' } }, actions)).toBe(true);
    expect(isNotificationActionPending({ type: 'TEACHER_MEMBERSHIP_REQUESTED', payload: { teacherEmail: 't@x.com' } }, actions)).toBe(true);
  });
  it('once answered (no pending action) the same notification is no longer pending; informative types never are', () => {
    expect(isNotificationActionPending({ type: 'CLASS_ENROLLMENT_INVITE', payload: { enrollmentId: 'enr-2', className: 'Math 11' } }, actions)).toBe(false);
    expect(isNotificationActionPending({ type: 'CLASS_ENROLLMENT_INVITE', payload: { className: 'Math 11' } }, [])).toBe(false);
    expect(isNotificationActionPending({ type: 'ASSIGNMENT_PUBLISHED', payload: {} }, actions)).toBe(false);
  });
});

describe('badge = unread notifications, same model for every role', () => {
  it('every workspace navigation carries the notifications badge and drops it at 0', () => {
    for (const build of [buildParentNav, buildTeacherNav, buildInstitutionNav, buildAdminNav]) {
      const items = build({ notifCount: 4 } as any).flatMap((g) => g.items);
      expect(items.find((i) => i.key === 'notifications')?.badge).toBe(4);
      expect(build({ notifCount: 0 } as any).flatMap((g) => g.items).find((i) => i.key === 'notifications')?.badge).toBeFalsy();
    }
  });
  it('the layout counts the account inbox unread rows for EVERY workspace (Student included, never capped, never pending actions)', () => {
    const layout = strip(read('src/app/dashboard/layout.tsx'));
    expect(layout).not.toMatch(/getUnreadNotifications/);
    expect(layout.match(/countAccountUnread\(canonicalUser\.id, availableWorkspaces\)/g)?.length).toBe(2);
    expect(layout).not.toMatch(/listPendingActions|pending-actions/);
    expect(layout).toMatch(/buildAdminNav\(\{ notifCount \}\)/);
  });
  it('the shell updates the badge without reload from the page announcement', () => {
    const shell = read('src/app/dashboard/LearnerShell.tsx');
    expect(shell).toMatch(/addEventListener\('studyus:unread-notifications'/);
    const controls = read('src/app/dashboard/notifications/InboxReadState.tsx');
    expect(controls).toMatch(/UNREAD_EVENT = 'studyus:unread-notifications'/);
    expect(controls).toMatch(/post\(\{ ids: displayedUnreadIds \}\)/);
    expect(controls).toMatch(/done\.current = true/);
  });
});

describe('inbox writes stay inside the caller scope', () => {
  it('mark unread only touches the caller rows and only READ ones', async () => {
    const { markInboxUnread } = await import('@/lib/notifications/role-notifications.service');
    dbQueryMock.mockImplementation(async (sql: string) => (sql.startsWith('UPDATE') ? { rowCount: 1, rows: [] } : { rows: [] }));
    await markInboxUnread('u1', 'TEACHER', ['n1']);
    const update = dbQueryMock.mock.calls.find((c) => String(c[0]).startsWith('UPDATE'))!;
    expect(update[0]).toMatch(/SET read_at = NULL WHERE \(n\.recipient_user_id = \$1 AND n\.workspace = \$2\) AND n\.read_at IS NOT NULL AND n\.id = ANY\(\$3::uuid\[\]\)/);
    expect(update[1]).toEqual(['u1', 'TEACHER', ['n1']]);
    expect(await markInboxUnread('u1', 'TEACHER', [])).toBe(0);
  });
  it('the inbox API answers with the new unread count and requires ids to mark unread', () => {
    const route = read('src/app/api/notifications/inbox/route.ts');
    expect(route).toMatch(/unread: z\.boolean\(\)\.optional\(\)\s*\}\)\.refine\(\(v\) => !v\.unread \|\| \(v\.ids\?\.length \?\? 0\) > 0\)/);
    expect(route).toMatch(/data: \{ marked, unreadCount \}/);
  });
});

describe('Institution Intelligence context', () => {
  const pages = ['coverage', 'readiness', 'interventions', 'attention'].map((p) => [p, strip(read(`src/app/dashboard/institution/[institutionId]/${p}/page.tsx`))] as const);
  it('no page exposes or asks for technical ids', () => {
    for (const [p, src] of pages) {
      expect(src, p).not.toMatch(/Structure Version ID|Exam Version ID|Class ID|name="structureVersionId"|name="examVersionId"|name="classId"/);
      expect(src, p).toMatch(/loadContext\(actor\.id, institutionId, sp, t\)/);
      expect(src, p).toMatch(/<IntelligenceHeader /);
    }
  });
  it('explanations, context labels and empty states exist in all 5 locales (and are translated)', () => {
    const keys = ['iix.help.coverage', 'iix.help.readiness', 'iix.help.interventions', 'iix.help.attention', 'iix.noCurriculum.title', 'iix.noCurriculum.body', 'iix.noCurriculum.cta', 'iix.empty.coverage', 'iix.empty.readiness', 'iix.empty.interventions', 'iix.empty.attention', 'iix.programme', 'iix.version', 'iix.grade', 'iix.subject', 'iix.period', 'nux.pending.chip', 'nux.markUnread'] as const;
    const en = getMessages('en') as Record<string, string>;
    for (const locale of ['es', 'en', 'de', 'fr', 'pt'] as const) {
      const t = getMessages(locale) as Record<string, string>;
      for (const k of keys) {
        expect(t[k], `${locale} ${k}`).toBeTruthy();
        if (locale !== 'en' && k !== 'iix.programme') expect(t[k], `${locale} ${k}`).not.toBe(en[k]); // 'Programme' is also French
      }
    }
    expect(getMessages('es')['iix.help.coverage']).toBe('Consulta qué parte del currículo seleccionado ya está siendo trabajada por tus clases y estudiantes y qué contenido aún está pendiente.');
    expect(getMessages('es')['iix.noCurriculum.title']).toBe('Tu institución todavía no tiene un currículo configurado.');
  });

  function curricula(rows: any[]) {
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM institution_curricula ic')) return { rows };
      if (sql.includes('FROM classes WHERE institution_id')) return { rows: [{ id: 'class-1', name: 'Math 11A' }] };
      if (sql.includes('FROM exam_versions ev')) return { rows: [{ id: 'exam-1', name: 'IB Math AA', version_label: '2025' }] };
      return { rows: [] };
    });
  }
  const row = (id: string, o: Partial<any> = {}) => ({ id, title: 'Math', programme_label: null, academic_year: '2026', grade_id: null, grade_name: null, canonical_subject_id: 'cs', canonical_subject_name: 'Mathematics', base_structure_version_id: null, version_label: null, subject_name: null, level: null, programme_name: null, created_at: '2026-01-01', ...o });
  const labels = { general: 'Catálogo general', allGrades: 'Todos los grados' };

  it('a single curriculum is selected without asking; the structure version stays internal', async () => {
    const { getIntelligenceContext } = await import('@/lib/institution/intelligence-context.service');
    curricula([row('c1', { base_structure_version_id: 'sv-1', programme_name: 'IB Diploma Programme', version_label: 'Curriculum 2025', subject_name: 'Mathematics AA', level: 'HL', grade_id: 'g1', grade_name: 'DP2' })]);
    const ctx = await getIntelligenceContext('coord', 'inst', {}, labels);
    expect(ctx.selected).toMatchObject({ curriculumId: 'c1', programme: 'IB Diploma Programme', version: 'Curriculum 2025 · 2026', grade: 'DP2', subject: 'Mathematics AA HL' });
    expect(ctx.structureVersionId).toBe('sv-1');
    expect(JSON.stringify(ctx.curricula)).not.toContain('sv-1');
    expect(ctx.examVersionId).toBe('exam-1');
    expect(ctx.period).toBe('current');
  });

  it('smart default prefers a published base and a specific grade; a foreign curriculum / class / exam id is ignored', async () => {
    const { getIntelligenceContext } = await import('@/lib/institution/intelligence-context.service');
    curricula([row('general'), row('ib', { base_structure_version_id: 'sv', grade_id: 'g' })]);
    const ctx = await getIntelligenceContext('coord', 'inst', { curriculum: 'other-institution-curriculum', classId: 'foreign-class', exam: 'foreign-exam' }, labels);
    expect(ctx.selected?.curriculumId).toBe('ib');
    expect(ctx.classId).toBeNull();
    expect(ctx.examVersionId).toBe('exam-1');
    expect(dbQueryMock.mock.calls[0][1]).toEqual(['inst']);
  });

  it('no curriculum → no selection (the page shows the configure-curriculum empty state)', async () => {
    const { getIntelligenceContext } = await import('@/lib/institution/intelligence-context.service');
    curricula([]);
    const ctx = await getIntelligenceContext('coord', 'inst', {}, labels);
    expect(ctx).toMatchObject({ selected: null, curricula: [], structureVersionId: null });
  });

  it('access is checked before any curriculum is read', async () => {
    const { getIntelligenceContext } = await import('@/lib/institution/intelligence-context.service');
    accessMock.mockRejectedValue(new Error('denied'));
    await expect(getIntelligenceContext('intruder', 'inst', {}, labels)).rejects.toThrow('denied');
    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});
