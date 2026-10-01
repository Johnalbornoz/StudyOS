/**
 * F1 -- role assignment security. Covers AC-F1-08/09: neither
 * INSTITUTION_ADMIN nor STUDYUS_ADMIN can be self-assigned through any
 * path this module exposes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const clientMock = { query: (...a: any[]) => clientQueryMock(...a), release: vi.fn() };
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: async () => clientMock } }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: vi.fn(async () => {}) }));

const getOrCreateStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ getOrCreateStudentId: (...a: any[]) => getOrCreateStudentIdMock(...a) }));

import { assignSelfServiceRole } from '@/lib/identity/role-assignment.service';
import { isSelfServiceRole, SELF_SERVICE_ROLES } from '@/lib/identity';

/** Persona rows the account already holds (the transaction's SELECT). */
function holding(rows: Array<{ role: string; status: 'ACTIVE' | 'REVOKED' }>) {
  clientQueryMock.mockImplementation(async (sql: string) => (/FROM user_roles WHERE user_id/.test(sql) ? { rows } : { rows: [] }));
}
const clientSql = () => clientQueryMock.mock.calls.map((c) => String(c[0]));
const inserted = () => clientQueryMock.mock.calls.filter((c) => /INSERT INTO user_roles/.test(String(c[0])));

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  clientQueryMock.mockReset();
  holding([]);
  getOrCreateStudentIdMock.mockReset().mockResolvedValue('student-1');
});

describe('SelfServiceRole vocabulary', () => {
  it('is exactly STUDENT, PARENT, TEACHER -- never INSTITUTION_ADMIN or STUDYUS_ADMIN', () => {
    expect([...SELF_SERVICE_ROLES].sort()).toEqual(['PARENT', 'STUDENT', 'TEACHER']);
  });

  it('isSelfServiceRole rejects both privileged roles and arbitrary strings', () => {
    expect(isSelfServiceRole('INSTITUTION_ADMIN')).toBe(false);
    expect(isSelfServiceRole('STUDYUS_ADMIN')).toBe(false);
    expect(isSelfServiceRole('SUPERUSER')).toBe(false);
    expect(isSelfServiceRole('')).toBe(false);
    expect(isSelfServiceRole('STUDENT')).toBe(true);
  });
});

describe('assignSelfServiceRole -- ONE primary persona per account (Track A product amendment)', () => {
  it('1. an account with no persona may select one: STUDENT is granted and the legacy students row is ensured', async () => {
    expect(await assignSelfServiceRole('clerk-1', 'u1', 'STUDENT')).toBe('GRANTED');
    expect(inserted()[0][1]).toEqual(['u1', 'STUDENT']);
    expect(getOrCreateStudentIdMock).toHaveBeenCalledWith('clerk-1');
  });

  it('PARENT and TEACHER are granted without ever touching students/getOrCreateStudentId', async () => {
    expect(await assignSelfServiceRole('clerk-2', 'u2', 'PARENT')).toBe('GRANTED');
    expect(await assignSelfServiceRole('clerk-3', 'u3', 'TEACHER')).toBe('GRANTED');
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });

  const conflicts: Array<[string, 'STUDENT' | 'PARENT' | 'TEACHER', string]> = [
    ['2. Student cannot self-add Parent', 'PARENT', 'STUDENT'],
    ['3. Student cannot self-add Teacher', 'TEACHER', 'STUDENT'],
    ['4. Parent cannot self-add Student', 'STUDENT', 'PARENT'],
    ['5. Parent cannot self-add Teacher', 'TEACHER', 'PARENT'],
    ['6. Teacher cannot self-add Student', 'STUDENT', 'TEACHER'],
    ['7. Teacher cannot self-add Parent', 'PARENT', 'TEACHER'],
  ];
  for (const [name, requested, held] of conflicts) {
    it(name, async () => {
      holding([{ role: held, status: 'ACTIVE' }]);
      expect(await assignSelfServiceRole('clerk-1', 'u1', requested)).toBe('PERSONA_EXISTS');
      expect(inserted()).toHaveLength(0);
      expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
    });
  }

  it('8. the existing persona is stable: re-selecting it is a no-op (no second row, no error)', async () => {
    holding([{ role: 'TEACHER', status: 'ACTIVE' }]);
    expect(await assignSelfServiceRole('clerk-1', 'u1', 'TEACHER')).toBe('ALREADY_ACTIVE');
    expect(inserted()).toHaveLength(0);
  });

  it('9. a CAPABILITY (INSTITUTION_ADMIN / STUDYUS_ADMIN) is not a persona: only STUDENT/PARENT/TEACHER rows are counted', async () => {
    await assignSelfServiceRole('clerk-1', 'u1', 'TEACHER');
    const select = clientSql().find((q) => /FROM user_roles WHERE user_id/.test(q))!;
    expect(select).toMatch(/role IN \('STUDENT', 'PARENT', 'TEACHER'\)/);
  });

  it('a revoked persona is never re-granted, and still blocks choosing a different one', async () => {
    holding([{ role: 'PARENT', status: 'REVOKED' }]);
    expect(await assignSelfServiceRole('clerk-1', 'u1', 'PARENT')).toBe('REVOKED');
    expect(await assignSelfServiceRole('clerk-1', 'u1', 'STUDENT')).toBe('PERSONA_EXISTS');
    expect(inserted()).toHaveLength(0);
  });

  it('check and write are one transaction serialized on the user row (two concurrent choices cannot both win)', async () => {
    await assignSelfServiceRole('clerk-1', 'u1', 'PARENT');
    const sqls = clientSql();
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toMatch(/SELECT id FROM users WHERE id = \$1 FOR UPDATE/);
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(inserted()[0][0]).toMatch(/ON CONFLICT \(user_id, role\) DO NOTHING/);
  });

  it('the role parameter type structurally excludes privileged roles -- this is a compile-time guarantee, demonstrated here by the exported type', () => {
    // @ts-expect-error -- INSTITUTION_ADMIN is not assignable to SelfServiceRole
    const _illegal: import('@/lib/identity').SelfServiceRole = 'INSTITUTION_ADMIN';
    // @ts-expect-error -- STUDYUS_ADMIN is not assignable to SelfServiceRole
    const _illegal2: import('@/lib/identity').SelfServiceRole = 'STUDYUS_ADMIN';
    void _illegal;
    void _illegal2;
  });
});
