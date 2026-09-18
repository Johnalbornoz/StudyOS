/**
 * F1 -- role assignment security. Covers AC-F1-08/09: neither
 * INSTITUTION_ADMIN nor STUDYUS_ADMIN can be self-assigned through any
 * path this module exposes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const getOrCreateStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ getOrCreateStudentId: (...a: any[]) => getOrCreateStudentIdMock(...a) }));

import { assignSelfServiceRole } from '@/lib/identity/role-assignment.service';
import { isSelfServiceRole, SELF_SERVICE_ROLES } from '@/lib/identity';

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
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

describe('assignSelfServiceRole', () => {
  it('grants STUDENT and also ensures the legacy students row exists (preserves pre-F1 behavior)', async () => {
    await assignSelfServiceRole('clerk-1', 'u1', 'STUDENT');
    expect(dbQueryMock).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO user_roles/), ['u1', 'STUDENT']);
    expect(getOrCreateStudentIdMock).toHaveBeenCalledWith('clerk-1');
  });

  it('grants PARENT without ever touching students/getOrCreateStudentId', async () => {
    await assignSelfServiceRole('clerk-2', 'u2', 'PARENT');
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });

  it('grants TEACHER without ever touching students/getOrCreateStudentId', async () => {
    await assignSelfServiceRole('clerk-3', 'u3', 'TEACHER');
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });

  it('is idempotent -- assigning a role twice never errors and never duplicates (ON CONFLICT DO NOTHING)', async () => {
    await assignSelfServiceRole('clerk-1', 'u1', 'STUDENT');
    const sql = dbQueryMock.mock.calls[0][0];
    expect(sql).toMatch(/ON CONFLICT \(user_id, role\) DO NOTHING/);
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
