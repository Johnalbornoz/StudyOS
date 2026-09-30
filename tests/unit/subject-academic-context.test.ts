/**
 * Subjects inherit the student's academic context (IB programme/year come
 * from "Mi perfil académico"; DP subjects require HL/SL).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  queryMock: vi.fn(),
  profileMock: vi.fn(),
  requireStudentIdMock: vi.fn(),
  verifyAuthMock: vi.fn(),
  verifyStudentAccessMock: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'clerk_1' }) }));
vi.mock('@/lib/db', () => ({
  query: (...a: any[]) => h.queryMock(...a),
  db: {
    query: (...a: any[]) => h.queryMock(...a),
    // create runs in one transaction on a checked-out client
    connect: async () => ({ query: (...a: any[]) => h.queryMock(...a), release: () => {} }),
  },
}));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: async () => 'es' }));
vi.mock('@/services/academic-profile.service', () => ({ getAcademicProfile: (...a: any[]) => h.profileMock(...a) }));
vi.mock('@/lib/auth', () => ({
  requireStudentId: (...a: any[]) => h.requireStudentIdMock(...a),
  verifyAuth: (...a: any[]) => h.verifyAuthMock(...a),
  verifyStudentAccess: (...a: any[]) => h.verifyStudentAccessMock(...a),
}));

import { deriveSubjectAcademicContext, resolveSubjectIbFields } from '@/lib/student/subject-academic-context';
import { POST as createSubject } from '@/app/api/subjects/create/route';
import { PATCH as updateSubject } from '@/app/api/subjects/[id]/route';
import { NextRequest } from 'next/server';

const DP2 = { curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2' };
const MYP = { curriculumType: 'ib', ibProgramme: 'MYP', ibYear: 'MYP 3' };
const NATIONAL = { curriculumType: 'national', ibProgramme: null, ibYear: null };
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222';

const post = (body: unknown) => new NextRequest('https://dev.test/api/subjects/create', { method: 'POST', body: JSON.stringify(body) });
const patch = (body: unknown) => new NextRequest(`https://dev.test/api/subjects/${SUBJECT_ID}`, { method: 'PATCH', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  h.requireStudentIdMock.mockResolvedValue(STUDENT_ID);
  h.verifyAuthMock.mockResolvedValue({ userId: 'clerk_1', role: 'student' });
  h.verifyStudentAccessMock.mockResolvedValue(true);
  h.queryMock.mockImplementation(defaultDb);
});

/** No existing subject; INSERT returns the new id; everything else is a harmless row. */
async function defaultDb(sql: string) {
  if (/^SELECT id FROM subjects WHERE student_id/.test(sql)) return { rows: [], rowCount: 0 };
  return { rows: [{ id: SUBJECT_ID }], rowCount: 1 };
}
const insertCalls = () => h.queryMock.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO subjects'));
const insertParams = () => insertCalls()[0][1];

describe('context derivation', () => {
  it('DP profile -> DP subjects with required level; MYP -> no level; national -> no IB', () => {
    expect(deriveSubjectAcademicContext(DP2)).toEqual({ programme: 'DP', year: 'DP2', requiresLevel: true });
    expect(deriveSubjectAcademicContext(MYP)).toEqual({ programme: 'MYP', year: 'MYP 3', requiresLevel: false });
    expect(deriveSubjectAcademicContext(NATIONAL)).toEqual({ programme: 'none', year: null, requiresLevel: false });
    expect(deriveSubjectAcademicContext(null)).toEqual({ programme: 'none', year: null, requiresLevel: false });
  });
});

describe('forbidden states', () => {
  const dp = deriveSubjectAcademicContext(DP2);

  it('DP profile + MYP subject is rejected', () => {
    expect(resolveSubjectIbFields(dp, { ibProgramme: 'MYP', ibLevel: 'HL' })).toEqual({ ok: false, error: 'IB_PROGRAMME_MISMATCH' });
  });

  it('DP profile + null/none/omitted programme is stored as DP, never as none/null', () => {
    for (const ibProgramme of [null, undefined, 'none']) {
      const r = resolveSubjectIbFields(dp, { ibProgramme, ibLevel: 'SL' });
      expect(r).toEqual({ ok: true, fields: { ib_programme: 'DP', ib_subject_group: null, ib_level: 'SL' } });
    }
  });

  it('DP subject without HL/SL is rejected; an invalid level too', () => {
    expect(resolveSubjectIbFields(dp, {})).toEqual({ ok: false, error: 'IB_LEVEL_REQUIRED' });
    expect(resolveSubjectIbFields(dp, { ibLevel: '' })).toEqual({ ok: false, error: 'IB_LEVEL_REQUIRED' });
    expect(resolveSubjectIbFields(dp, { ibLevel: 'XL' })).toEqual({ ok: false, error: 'IB_LEVEL_INVALID' });
  });

  it('non-IB students are unaffected: IB input is ignored and stored as none', () => {
    const r = resolveSubjectIbFields(deriveSubjectAcademicContext(NATIONAL), { ibSubjectGroup: 'sciences', ibLevel: 'HL' });
    expect(r).toEqual({ ok: true, fields: { ib_programme: 'none', ib_subject_group: null, ib_level: null } });
  });

  it('MYP keeps the group, never a level; unknown groups are rejected', () => {
    const myp = deriveSubjectAcademicContext(MYP);
    expect(resolveSubjectIbFields(myp, { ibSubjectGroup: 'sciences', ibLevel: 'HL' })).toEqual({
      ok: true, fields: { ib_programme: 'MYP', ib_subject_group: 'sciences', ib_level: null },
    });
    expect(resolveSubjectIbFields(myp, { ibSubjectGroup: 'astrology' })).toEqual({ ok: false, error: 'IB_SUBJECT_GROUP_INVALID' });
  });
});

describe('POST /api/subjects/create enforces the inherited context', () => {
  it('DP2 student: stores IB/DP with the chosen level and group', async () => {
    h.profileMock.mockResolvedValue(DP2);
    const res = await createSubject(post({ name: 'Matemáticas', ibSubjectGroup: 'mathematics', ibLevel: 'HL' }));
    expect(res.status).toBe(200);
    expect(insertParams().slice(4)).toEqual(['DP', 'mathematics', 'HL']);
  });

  it('DP2 student: an MYP subject is rejected and nothing is written', async () => {
    h.profileMock.mockResolvedValue(DP2);
    const res = await createSubject(post({ name: 'Física', ibProgramme: 'MYP', ibLevel: 'HL' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'IB_PROGRAMME_MISMATCH' });
    expect(h.queryMock).not.toHaveBeenCalled();
  });

  it('DP2 student: missing HL/SL is rejected and nothing is written', async () => {
    h.profileMock.mockResolvedValue(DP2);
    const res = await createSubject(post({ name: 'Química', ibProgramme: 'none' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'IB_LEVEL_REQUIRED' });
    expect(h.queryMock).not.toHaveBeenCalled();
  });

  it('national student: IB fields are never stored', async () => {
    h.profileMock.mockResolvedValue(NATIONAL);
    const res = await createSubject(post({ name: 'Historia', ibProgramme: 'DP', ibLevel: 'HL' }));
    // a client claiming DP for a non-IB student is a contradiction too
    expect(res.status).toBe(400);
    const ok = await createSubject(post({ name: 'Historia' }));
    expect(ok.status).toBe(200);
    expect(insertParams().slice(4)).toEqual(['none', null, null]);
  });

  it('UX-5: free text that is not a catalog subject is rejected and nothing is written', async () => {
    h.profileMock.mockResolvedValue(NATIONAL);
    const res = await createSubject(post({ name: 'Mi materia inventada' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'SUBJECT_NOT_IN_CATALOG' });
    const unknownKey = await createSubject(post({ catalogKey: 'astrology' }));
    expect(unknownKey.status).toBe(400);
    expect(h.queryMock).not.toHaveBeenCalled();
  });

  it('UX-5: a catalog key stores the catalog name (interface language) and IB group, never client values', async () => {
    h.profileMock.mockResolvedValue(DP2);
    const res = await createSubject(post({ catalogKey: 'english', ibSubjectGroup: 'arts', ibLevel: 'SL', name: 'ignored' }));
    expect(res.status).toBe(200);
    expect(insertParams()).toEqual([STUDENT_ID, 'Inglés', 'en', 'match_interface', 'DP', 'language_acquisition', 'SL']);
  });

  it('UX-5: choosing a subject the Student already has returns it instead of duplicating', async () => {
    h.profileMock.mockResolvedValue(NATIONAL);
    h.queryMock.mockImplementation(async (sql: string) =>
      /^SELECT id FROM subjects WHERE student_id/.test(sql) ? { rows: [{ id: SUBJECT_ID }], rowCount: 1 } : { rows: [], rowCount: 0 });
    const res = await createSubject(post({ catalogKey: 'history' }));
    expect(await res.json()).toEqual({ success: true, subjectId: SUBJECT_ID, existing: true });
    expect(insertCalls()).toHaveLength(0);
  });

  it('only an active Student can create subjects', async () => {
    h.requireStudentIdMock.mockResolvedValue(null);
    const res = await createSubject(post({ name: 'X' }));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/subjects/[id] enforces the same rules', () => {
  const params = { params: Promise.resolve({ id: SUBJECT_ID }) };

  it('rejects switching a DP student subject to MYP, and removing its level', async () => {
    h.profileMock.mockResolvedValue(DP2);
    h.queryMock.mockResolvedValue({ rows: [{ id: SUBJECT_ID, ib_subject_group: 'mathematics', ib_level: 'HL' }], rowCount: 1 });
    const mismatch = await updateSubject(patch({ studentId: STUDENT_ID, ibProgramme: 'MYP' }), params);
    expect(mismatch.status).toBe(400);
    const noLevel = await updateSubject(patch({ studentId: STUDENT_ID, ibLevel: null }), params);
    expect(noLevel.status).toBe(400);
    expect(h.queryMock.mock.calls.every(([sql]) => !String(sql).startsWith('UPDATE'))).toBe(true);
  });

  it('changing only the group keeps the stored level and writes DP', async () => {
    h.profileMock.mockResolvedValue(DP2);
    h.queryMock.mockResolvedValue({ rows: [{ id: SUBJECT_ID, ib_subject_group: 'mathematics', ib_level: 'SL' }], rowCount: 1 });
    const res = await updateSubject(patch({ studentId: STUDENT_ID, ibSubjectGroup: 'sciences' }), params);
    expect(res.status).toBe(200);
    const update = h.queryMock.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE'));
    expect(update?.[1]).toEqual(['DP', 'sciences', 'SL', SUBJECT_ID]);
  });
});
