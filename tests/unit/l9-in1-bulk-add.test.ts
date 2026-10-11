/**
 * L9 IN-1 -- bulk add from an email list.
 *
 * The REAL services run against an in-memory database (tests/unit/l9-roster-fake-db.ts): the bulk
 * functions, the single adds they call, and the institution guard. What is asserted:
 *   - a list is the single add, once per address (existing accounts only; unknown addresses are
 *     reported and nothing is created for them);
 *   - a closed relation is NEVER re-opened by a list (L4-18: a DECLINED enrollment; also ENDED,
 *     and for teachers REJECTED / REVOKED / SUSPENDED / PENDING);
 *   - a coordinator of another institution gets 403 and nothing is written; another
 *     institution's class is 404;
 *   - the list is bounded and never trusted (limit, strict body, per-address validation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createFakeDb } from './l9-roster-fake-db';

const fake = createFakeDb();
vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: any[]) => fake.query(sql, params), connect: vi.fn() } }));

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));
let actorId = 'coord-A';
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn(async () => ({ id: actorId })) }));
const notifyUserMock = vi.fn(async (..._a: any[]) => 'n-1');
vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: (...a: any[]) => notifyUserMock(...a), notifyInstitutionAdmins: vi.fn(async () => 0) }));

import { addStudentToClass, bulkAddStudentsToClass, bulkInviteTeachers } from '@/lib/institution/institution-operations.service';
import { BULK_EMAIL_LIMIT, normalizeEmailList, parseEmailText } from '@/lib/institution/email-list';
import { POST as bulkStudentsPOST } from '@/app/api/institutions/[id]/students/bulk/route';
import { POST as bulkTeachersPOST } from '@/app/api/institutions/[id]/teachers/bulk/route';

const INST_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INST_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLASS_A1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const CLASS_A2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
const CLASS_B1 = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';

function student(key: string, opts: { status?: string } = {}) {
  fake.t.users.push({ id: `u-${key}`, email: `${key}@school.test`, status: opts.status ?? 'ACTIVE' });
  fake.t.user_roles.push({ user_id: `u-${key}`, role: 'STUDENT', status: 'ACTIVE' });
  fake.t.students.push({ id: `s-${key}`, user_id: `u-${key}`, email: `${key}@school.test` });
}
function teacher(key: string) {
  fake.t.users.push({ id: `u-${key}`, email: `${key}@school.test`, status: 'ACTIVE' });
  fake.t.user_roles.push({ user_id: `u-${key}`, role: 'TEACHER', status: 'ACTIVE' });
}
const enrollment = (key: string, classId: string, status: string) => fake.t.class_enrollments.push({ id: `e-${key}-${classId.slice(0, 2)}`, class_id: classId, student_id: `s-${key}`, status });
const enrollmentOf = (key: string, classId: string) => fake.t.class_enrollments.find((e) => e.student_id === `s-${key}` && e.class_id === classId);
const outcomeOf = (r: { results: Array<{ email: string; outcome: string }> }, key: string) => r.results.find((x) => x.email === `${key}@school.test`)?.outcome;
const post = (body: unknown) => new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as any;
const at = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const k of Object.keys(fake.t) as Array<keyof typeof fake.t>) fake.t[k].length = 0;
  fake.reset();
  notifyUserMock.mockClear();
  actorId = 'coord-A';
  verifyAuthMock.mockResolvedValue({ userId: 'clerk-coord', email: 'coord@school.test' });
  fake.t.institutions.push({ id: INST_A, name: 'School A', status: 'ACTIVE' }, { id: INST_B, name: 'School B', status: 'ACTIVE' });
  fake.t.classes.push({ id: CLASS_A1, institution_id: INST_A, name: 'Math 11', status: 'ACTIVE' }, { id: CLASS_A2, institution_id: INST_A, name: 'Physics 11', status: 'ACTIVE' }, { id: CLASS_B1, institution_id: INST_B, name: 'Chem B', status: 'ACTIVE' });
  fake.t.institution_memberships.push({ id: 'm-coord-A', institution_id: INST_A, user_id: 'coord-A', membership_role: 'INSTITUTION_ADMIN', status: 'APPROVED' }, { id: 'm-coord-B', institution_id: INST_B, user_id: 'coord-B', membership_role: 'INSTITUTION_ADMIN', status: 'APPROVED' });
});

describe('email list: read once in the browser, validated again on the server', () => {
  it('reads one per line, comma / semicolon separated, and CSV rows with other columns', () => {
    expect(parseEmailText('a@x.org\nb@x.org, c@x.org; d@x.org')).toEqual(['a@x.org', 'b@x.org', 'c@x.org', 'd@x.org']);
    expect(parseEmailText('name,email\n"Ana Ruiz","ana@x.org"\nLuis,<luis@x.org>')).toEqual(['ana@x.org', 'luis@x.org']);
  });
  it('normalizes: trims, lower-cases, de-duplicates, and sets non-emails apart', () => {
    expect(normalizeEmailList([' Ana@X.org ', 'ana@x.org', 'not-an-email', 'a@b', ''])).toEqual({ emails: ['ana@x.org'], invalid: ['not-an-email', 'a@b'] });
  });
});

describe('bulk students: the single add, once per address', () => {
  it('30 addresses: existing accounts are invited or enrolled, unknown ones are reported, nothing is created', async () => {
    for (let i = 0; i < 20; i++) student(`new${i}`); // no relation with the institution -> invited (consent)
    for (let i = 0; i < 5; i++) {
      student(`inst${i}`); // already an ACTIVE student of this institution (other class) -> enrolled
      enrollment(`inst${i}`, CLASS_A2, 'ACTIVE');
    }
    const emails = [...Array.from({ length: 20 }, (_, i) => `new${i}@school.test`), ...Array.from({ length: 5 }, (_, i) => `inst${i}@school.test`), ...Array.from({ length: 5 }, (_, i) => `ghost${i}@school.test`)];
    const studentsBefore = fake.t.students.length;
    const usersBefore = fake.t.users.length;

    const r = await bulkAddStudentsToClass(INST_A, CLASS_A1, emails, 'coord-A');

    expect(r.results).toHaveLength(30);
    expect(r.summary).toEqual({ INVITED: 20, ENROLLED: 5, NO_STUDENT_ACCOUNT: 5 });
    expect(fake.t.class_enrollments.filter((e) => e.class_id === CLASS_A1 && e.status === 'PENDING')).toHaveLength(20);
    expect(fake.t.class_enrollments.filter((e) => e.class_id === CLASS_A1 && e.status === 'ACTIVE')).toHaveLength(5);
    expect(fake.t.students).toHaveLength(studentsBefore); // never creates a Student
    expect(fake.t.users).toHaveLength(usersBefore);
    expect(notifyUserMock).toHaveBeenCalledTimes(20); // one invitation notice per invited student, none for unknown addresses
    // every single add is audited as before, plus one summary event for the list
    expect(fake.t.events.filter((e) => e.action === 'STUDENT_INVITED')).toHaveLength(20);
    expect(fake.t.events.filter((e) => e.action === 'STUDENT_ENROLLED')).toHaveLength(5);
    expect(fake.t.events.filter((e) => e.action === 'STUDENTS_BULK_ADDED')).toEqual([expect.objectContaining({ institution_id: INST_A, actor_user_id: 'coord-A', object_type: 'CLASS', object_id: CLASS_A1, new_values: { submitted: 30, INVITED: 20, ENROLLED: 5, NO_STUDENT_ACCOUNT: 5 } })]);
  });

  it('L4-18: a DECLINED enrollment is never re-activated (nor re-invited) by a list -- even for an institution student', async () => {
    student('declined');
    enrollment('declined', CLASS_A2, 'ACTIVE'); // institution student: the single add would enroll them ACTIVE directly
    enrollment('declined', CLASS_A1, 'DECLINED');
    fake.reset();

    const r = await bulkAddStudentsToClass(INST_A, CLASS_A1, ['declined@school.test'], 'coord-A');

    expect(outcomeOf(r, 'declined')).toBe('PREVIOUSLY_DECLINED');
    expect(enrollmentOf('declined', CLASS_A1)?.status).toBe('DECLINED');
    expect(fake.writes().filter((q) => /class_enrollments/.test(q.sql))).toEqual([]);
    expect(notifyUserMock).not.toHaveBeenCalled();
  });

  it('an ENDED enrollment (the student left, or was removed) is not re-opened by a list either', async () => {
    student('left');
    enrollment('left', CLASS_A2, 'ACTIVE');
    enrollment('left', CLASS_A1, 'ENDED');
    fake.reset();

    const r = await bulkAddStudentsToClass(INST_A, CLASS_A1, ['left@school.test'], 'coord-A');

    expect(outcomeOf(r, 'left')).toBe('PREVIOUSLY_ENDED');
    expect(enrollmentOf('left', CLASS_A1)?.status).toBe('ENDED');
    expect(fake.writes().filter((q) => /class_enrollments/.test(q.sql))).toEqual([]);
  });

  it('already ACTIVE / PENDING, inactive accounts, non-emails and duplicates are reported; one bad address never stops the rest', async () => {
    student('active');
    enrollment('active', CLASS_A1, 'ACTIVE');
    student('pending');
    enrollment('pending', CLASS_A1, 'PENDING');
    student('disabled', { status: 'DISABLED' });
    student('fresh');

    const r = await bulkAddStudentsToClass(INST_A, CLASS_A1, ['active@school.test', 'nope', 'pending@school.test', 'disabled@school.test', 'FRESH@school.test', 'fresh@school.test'], 'coord-A');

    expect(r.results).toHaveLength(5); // the duplicate is submitted once
    expect(outcomeOf(r, 'active')).toBe('ALREADY_ENROLLED');
    expect(outcomeOf(r, 'pending')).toBe('ALREADY_ENROLLED');
    expect(outcomeOf(r, 'disabled')).toBe('NO_STUDENT_ACCOUNT');
    expect(outcomeOf(r, 'fresh')).toBe('INVITED');
    expect(r.results.find((x) => x.email === 'nope')?.outcome).toBe('INVALID_EMAIL');
    expect(enrollmentOf('active', CLASS_A1)?.status).toBe('ACTIVE');
    expect(enrollmentOf('pending', CLASS_A1)?.status).toBe('PENDING');
  });

  it('a class of ANOTHER institution is NOT_FOUND for the whole list; an archived class is refused; nothing is written', async () => {
    student('x');
    await expect(bulkAddStudentsToClass(INST_A, CLASS_B1, ['x@school.test'], 'coord-A')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    fake.t.classes.find((c) => c.id === CLASS_A1)!.status = 'ARCHIVED';
    await expect(bulkAddStudentsToClass(INST_A, CLASS_A1, ['x@school.test'], 'coord-A')).rejects.toMatchObject({ code: 'CLASS_ARCHIVED' });
    expect(fake.writes()).toEqual([]);
  });
});

describe('enrollment lookup: an OPEN row always wins over closed history; else the newest CLOSED row', () => {
  // More than one row per (class, student): closed rows are history. They are inserted BEFORE the
  // open / newest row on purpose, so "the first row found" is the wrong answer in every case.
  const row = (key: string, id: string, status: string, created_at: string) => fake.t.class_enrollments.push({ id, class_id: CLASS_A1, student_id: `s-${key}`, status, created_at });
  const run = async (key: string) => {
    fake.reset();
    const r = await bulkAddStudentsToClass(INST_A, CLASS_A1, [`${key}@school.test`], 'coord-A');
    return { outcome: outcomeOf(r, key), enrollmentWrites: fake.writes().filter((q) => /class_enrollments/.test(q.sql)).length };
  };

  it('ACTIVE + historical ENDED => ACTIVE (already enrolled; nothing written)', async () => {
    student('back');
    row('back', 'e-old', 'ENDED', '2026-01-10T00:00:00Z');
    row('back', 'e-now', 'ACTIVE', '2026-09-01T00:00:00Z');
    expect(await run('back')).toEqual({ outcome: 'ALREADY_ENROLLED', enrollmentWrites: 0 });
    await expect(addStudentToClass(INST_A, CLASS_A1, 'back@school.test', 'coord-A')).rejects.toMatchObject({ code: 'ALREADY_ENROLLED' }); // the single add reads the same row
  });

  it('PENDING + historical DECLINED => PENDING (already invited; nothing written)', async () => {
    student('again');
    row('again', 'e-old', 'DECLINED', '2026-01-10T00:00:00Z');
    row('again', 'e-now', 'PENDING', '2026-09-01T00:00:00Z');
    expect(await run('again')).toEqual({ outcome: 'ALREADY_ENROLLED', enrollmentWrites: 0 });
  });

  it('an OPEN row wins even when a CLOSED row is more recent', async () => {
    student('odd');
    row('odd', 'e-closed-later', 'ENDED', '2026-09-01T00:00:00Z');
    row('odd', 'e-open-earlier', 'ACTIVE', '2026-01-10T00:00:00Z');
    expect(await run('odd')).toEqual({ outcome: 'ALREADY_ENROLLED', enrollmentWrites: 0 });
  });

  it('multiple CLOSED => the newest by created_at', async () => {
    student('twice');
    row('twice', 'e-1', 'ENDED', '2026-09-01T00:00:00Z'); // newest, inserted first
    row('twice', 'e-2', 'DECLINED', '2026-01-10T00:00:00Z');
    expect(await run('twice')).toEqual({ outcome: 'PREVIOUSLY_ENDED', enrollmentWrites: 0 });
    student('twice2');
    row('twice2', 'e-3', 'ENDED', '2026-01-10T00:00:00Z');
    row('twice2', 'e-4', 'DECLINED', '2026-09-01T00:00:00Z');
    row('twice2', 'e-5', 'ENDED', '2026-03-01T00:00:00Z');
    expect(await run('twice2')).toEqual({ outcome: 'PREVIOUSLY_DECLINED', enrollmentWrites: 0 });
  });

  it('multiple CLOSED with the same created_at => the highest id', async () => {
    student('tie');
    row('tie', 'e-b', 'DECLINED', '2026-05-05T00:00:00Z'); // highest id, inserted first
    row('tie', 'e-a', 'ENDED', '2026-05-05T00:00:00Z');
    expect(await run('tie')).toEqual({ outcome: 'PREVIOUSLY_DECLINED', enrollmentWrites: 0 });
    student('tie2');
    row('tie2', 'e-c', 'DECLINED', '2026-05-05T00:00:00Z');
    row('tie2', 'e-d', 'ENDED', '2026-05-05T00:00:00Z');
    expect(await run('tie2')).toEqual({ outcome: 'PREVIOUSLY_ENDED', enrollmentWrites: 0 });
  });

  it('no rows => none: the address goes on to the single add', async () => {
    student('first');
    expect(await run('first')).toEqual({ outcome: 'INVITED', enrollmentWrites: 1 });
  });

  it('the lookup is one read with the canonical ordering, and no write', () => {
    const svc = readFileSync(join(process.cwd(), 'src/lib/institution/institution-operations.service.ts'), 'utf-8');
    const fn = svc.slice(svc.indexOf('async function enrollmentOf('), svc.indexOf('\n}\n', svc.indexOf('async function enrollmentOf(')));
    expect(fn.replace(/\s+/g, ' ')).toContain("WHERE class_id = $1 AND student_id = $2 ORDER BY (status IN ('PENDING', 'ACTIVE')) DESC, created_at DESC, id DESC LIMIT 1");
    expect(fn).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/);
  });
});

describe('bulk teachers: only where there is no relation yet', () => {
  it('invites new teacher accounts; every existing relation is reported and left exactly as it is', async () => {
    for (const k of ['t-new', 't-approved', 't-invited', 't-pending', 't-rejected', 't-revoked', 't-suspended']) teacher(k);
    student('not-a-teacher');
    for (const [k, status] of [['t-approved', 'APPROVED'], ['t-invited', 'INVITED'], ['t-pending', 'PENDING'], ['t-rejected', 'REJECTED'], ['t-revoked', 'REVOKED'], ['t-suspended', 'SUSPENDED']] as const) {
      fake.t.institution_memberships.push({ id: `m-${k}`, institution_id: INST_A, user_id: `u-${k}`, membership_role: 'TEACHER', status });
    }
    const before = JSON.stringify(fake.t.institution_memberships);
    fake.reset();

    const r = await bulkInviteTeachers(INST_A, ['t-new', 't-approved', 't-invited', 't-pending', 't-rejected', 't-revoked', 't-suspended', 'not-a-teacher', 'ghost'].map((k) => `${k}@school.test`), 'coord-A');

    expect(Object.fromEntries(r.results.map((x) => [x.email.split('@')[0], x.outcome]))).toEqual({
      't-new': 'INVITED',
      't-approved': 'ALREADY_MEMBER',
      't-invited': 'ALREADY_INVITED',
      't-pending': 'PENDING_REQUEST', // a list is not an approval
      't-rejected': 'NEEDS_REVIEW',
      't-revoked': 'NEEDS_REVIEW',
      't-suspended': 'NEEDS_REVIEW', // a list never lifts a suspension
      'not-a-teacher': 'NO_TEACHER_ACCOUNT',
      ghost: 'NO_TEACHER_ACCOUNT',
    });
    const created = fake.t.institution_memberships.filter((m) => m.user_id === 'u-t-new');
    expect(created).toEqual([expect.objectContaining({ institution_id: INST_A, membership_role: 'TEACHER', status: 'INVITED' })]);
    expect(JSON.stringify(fake.t.institution_memberships.filter((m) => m.user_id !== 'u-t-new'))).toBe(before);
    expect(fake.writes().filter((q) => /institution_memberships/.test(q.sql))).toHaveLength(1);
    expect(notifyUserMock).toHaveBeenCalledTimes(1);
    expect(fake.t.events.filter((e) => e.action === 'TEACHERS_BULK_INVITED')).toHaveLength(1);
  });
});

describe('routes: coordinator of THIS institution only', () => {
  it('students/bulk: 200 with one outcome per address for the institution\'s own coordinator', async () => {
    student('a');
    const res = await bulkStudentsPOST(post({ classId: CLASS_A1, emails: ['a@school.test', 'ghost@school.test'] }), at(INST_A));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.summary).toEqual({ INVITED: 1, NO_STUDENT_ACCOUNT: 1 });
  });

  it('students/bulk: a coordinator of ANOTHER institution gets 403 and nothing is read or written for the list', async () => {
    student('a');
    actorId = 'coord-B';
    fake.reset();
    const res = await bulkStudentsPOST(post({ classId: CLASS_A1, emails: ['a@school.test'] }), at(INST_A));
    expect(res.status).toBe(403);
    expect(fake.writes()).toEqual([]);
    expect(fake.log.filter((q) => /students|class_enrollments/.test(q.sql))).toEqual([]);
    expect(fake.t.class_enrollments).toEqual([]);
  });

  it('students/bulk: their own institution id with ANOTHER institution\'s class is 404 (no cross-tenant enrollment)', async () => {
    student('a');
    actorId = 'coord-B';
    const res = await bulkStudentsPOST(post({ classId: CLASS_A1, emails: ['a@school.test'] }), at(INST_B));
    expect(res.status).toBe(404);
    expect(fake.t.class_enrollments).toEqual([]);
  });

  it('teachers/bulk: a coordinator of ANOTHER institution gets 403 and nothing is written', async () => {
    teacher('t');
    actorId = 'coord-B';
    fake.reset();
    const res = await bulkTeachersPOST(post({ emails: ['t@school.test'] }), at(INST_A));
    expect(res.status).toBe(403);
    expect(fake.writes()).toEqual([]);
    expect(fake.t.institution_memberships.filter((m) => m.membership_role === 'TEACHER')).toEqual([]);
  });

  it('unauthenticated -> 401; a non-coordinator (e.g. a teacher or student account) -> 403', async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    expect((await bulkStudentsPOST(post({ classId: CLASS_A1, emails: ['a@school.test'] }), at(INST_A))).status).toBe(401);
    verifyAuthMock.mockResolvedValueOnce(null);
    expect((await bulkTeachersPOST(post({ emails: ['a@school.test'] }), at(INST_A))).status).toBe(401);
    actorId = 'u-someone-else';
    expect((await bulkStudentsPOST(post({ classId: CLASS_A1, emails: ['a@school.test'] }), at(INST_A))).status).toBe(403);
    expect((await bulkTeachersPOST(post({ emails: ['a@school.test'] }), at(INST_A))).status).toBe(403);
  });

  it('bounded and strict: malformed ids 404; empty, oversized or extra-field bodies 400; nothing written', async () => {
    expect((await bulkStudentsPOST(post({ classId: CLASS_A1, emails: ['a@school.test'] }), at('not-a-uuid'))).status).toBe(404);
    const tooMany = Array.from({ length: BULK_EMAIL_LIMIT + 1 }, (_, i) => `s${i}@school.test`);
    for (const body of [{ classId: CLASS_A1, emails: [] }, { classId: CLASS_A1, emails: tooMany }, { classId: 'nope', emails: ['a@school.test'] }, { classId: CLASS_A1, emails: ['a@school.test'], institutionId: INST_B }, { classId: CLASS_A1, emails: 'a@school.test' }, null]) {
      expect((await bulkStudentsPOST(post(body), at(INST_A))).status).toBe(400);
    }
    for (const body of [{ emails: [] }, { emails: tooMany }, { emails: ['a@school.test'], role: 'INSTITUTION_ADMIN' }, null]) {
      expect((await bulkTeachersPOST(post(body), at(INST_A))).status).toBe(400);
    }
    expect(fake.writes()).toEqual([]);
  });
});

describe('source contract', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
  it.each(['students/bulk/route.ts', 'teachers/bulk/route.ts'])('%s uses the existing institution guard and conventions', (f) => {
    const src = read(`src/app/api/institutions/[id]/${f}`);
    expect(src).toMatch(/requireInstitutionAdminActor\(id, 'TEACHER_ASSIGNMENT_MANAGE'\)/);
    expect(src).toMatch(/allUuids\(/);
    expect(src).toMatch(/z\.strictObject/);
    expect(src).not.toMatch(/export async function (GET|POST|PATCH|DELETE)\(/);
  });
  it('the bulk functions go through the existing single adds and issue no enrollment / membership write of their own', () => {
    const svc = read('src/lib/institution/institution-operations.service.ts');
    const body = (name: string) => svc.slice(svc.indexOf(`export async function ${name}(`), svc.indexOf('\n}\n', svc.indexOf(`export async function ${name}(`)));
    expect(body('bulkAddStudentsToClass')).toMatch(/await addStudentToClass\(institutionId, classId, email, actorUserId\)/);
    expect(body('bulkInviteTeachers')).toMatch(/await inviteTeacher\(institutionId, email, actorUserId\)/);
    for (const name of ['bulkAddStudentsToClass', 'bulkInviteTeachers']) expect(body(name)).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM|enrollActive\(/);
  });
  it('no migration and no schema statement in this lane\'s sources', () => {
    for (const f of ['src/lib/institution/email-list.ts', 'src/lib/institution/student-class-membership.ts', 'src/app/api/institutions/[id]/students/bulk/route.ts', 'src/app/api/institutions/[id]/teachers/bulk/route.ts']) {
      expect(read(f)).not.toMatch(/ALTER TABLE|CREATE TABLE|ADD COLUMN/i);
    }
  });
});
