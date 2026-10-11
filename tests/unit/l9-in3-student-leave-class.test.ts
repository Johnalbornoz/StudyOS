/**
 * L9 IN-3 -- a Student leaves a class.
 *
 * The REAL leave service, the REAL `endClassEnrollment` and the REAL `canTeacherAccessLearner`
 * run against an in-memory database (tests/unit/l9-roster-fake-db.ts). What is asserted:
 *   - the Student ends their OWN ACTIVE enrollment (existing transition ACTIVE -> ENDED);
 *   - the class teacher's access to the learner is gone on the next check;
 *   - a Student cannot end another Student's enrollment (404, row untouched, no write);
 *   - unknown / malformed / pending / already-ended ids are the same 404 (no existence oracle);
 *   - only a signed-in holder of the STUDENT role reaches the service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createFakeDb } from './l9-roster-fake-db';

const fake = createFakeDb();
vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: any[]) => fake.query(sql, params), connect: vi.fn() } }));

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: vi.fn(async () => null) }));
const requireStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ requireStudentId: (...a: any[]) => requireStudentIdMock(...a) }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn(async () => 'en') }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { leaveClassAsStudent, listOwnActiveEnrollments } from '@/lib/institution/student-class-membership';
import { canTeacherAccessLearner } from '@/lib/authorization';
import { POST as leavePOST } from '@/app/api/student/class-enrollments/[id]/leave/route';
import { GET as listGET } from '@/app/api/student/class-enrollments/route';
import { InstitutionalContextCard } from '@/app/dashboard/profile/InstitutionalContextCard';
import { ROSTER_MESSAGES } from '@/lib/i18n/institution-roster-messages';

const INST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLASS_1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const CLASS_2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const MY_ENR = 'e1111111-1111-4111-8111-111111111111';
const MY_ENR_2 = 'e2222222-2222-4222-8222-222222222222';
const MY_PENDING = 'e3333333-3333-4333-8333-333333333333';
const OTHER_ENR = 'e9999999-9999-4999-8999-999999999999';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const post = () => new Request('http://localhost/x', { method: 'POST' }) as any;
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const statusOf = (id: string) => fake.t.class_enrollments.find((e) => e.id === id)?.status;

beforeEach(() => {
  for (const k of Object.keys(fake.t) as Array<keyof typeof fake.t>) fake.t[k].length = 0;
  fake.reset();
  authMock.mockResolvedValue({ userId: 'clerk-me' });
  requireStudentIdMock.mockResolvedValue(ME);
  fake.t.institutions.push({ id: INST, name: 'School A', status: 'ACTIVE' });
  fake.t.classes.push({ id: CLASS_1, institution_id: INST, name: 'Math 11', status: 'ACTIVE' }, { id: CLASS_2, institution_id: INST, name: 'Physics 11', status: 'ACTIVE' });
  fake.t.students.push({ id: ME, user_id: 'u-me' }, { id: OTHER, user_id: 'u-other' });
  fake.t.class_enrollments.push(
    { id: MY_ENR, class_id: CLASS_1, student_id: ME, status: 'ACTIVE' },
    { id: MY_ENR_2, class_id: CLASS_2, student_id: ME, status: 'ACTIVE' },
    { id: OTHER_ENR, class_id: CLASS_1, student_id: OTHER, status: 'ACTIVE' }
  );
  // one APPROVED teacher assigned to CLASS_1 only
  fake.t.institution_memberships.push({ id: 'm-teacher', institution_id: INST, user_id: 'u-teacher', membership_role: 'TEACHER', status: 'APPROVED' });
  fake.t.teacher_assignments.push({ id: 'ta-1', institution_membership_id: 'm-teacher', class_id: CLASS_1, status: 'ACTIVE' });
});

describe('the Student leaves their own class', () => {
  it('ACTIVE -> ENDED through the existing end-enrollment function; the teacher\'s access is gone on the next check', async () => {
    expect(await canTeacherAccessLearner('u-teacher', ME)).toBe(true);

    const res = await leavePOST(post(), at(MY_ENR));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ enrollmentId: MY_ENR, status: 'ENDED' });
    expect(statusOf(MY_ENR)).toBe('ENDED');
    expect(await canTeacherAccessLearner('u-teacher', ME)).toBe(false);
    // only this enrollment changed: the Student's other class and the other Student are untouched
    expect(statusOf(MY_ENR_2)).toBe('ACTIVE');
    expect(statusOf(OTHER_ENR)).toBe('ACTIVE');
    expect(await canTeacherAccessLearner('u-teacher', OTHER)).toBe(true);
    // the row is ended by the existing UPDATE (soft; never a DELETE), and the class stops feeding the plan
    expect(fake.writes().some((q) => /UPDATE class_enrollments ce SET status = 'ENDED'/.test(q.sql))).toBe(true);
    expect(fake.log.some((q) => /UPDATE student_concept_sources SET active = false/.test(q.sql))).toBe(true);
    expect(fake.log.some((q) => /DELETE FROM/i.test(q.sql))).toBe(false);
  });

  it('is audited with the Student as the actor', async () => {
    await leavePOST(post(), at(MY_ENR));
    expect(fake.t.events).toEqual([expect.objectContaining({ institution_id: INST, actor_user_id: 'u-me', actor_scope: 'STUDENT', object_type: 'ENROLLMENT', object_id: MY_ENR, action: 'STUDENT_LEFT_CLASS', new_values: { status: 'ENDED', classId: CLASS_1, studentId: ME } })]);
  });

  it('leaving twice: the second call is 404 and changes nothing', async () => {
    expect((await leavePOST(post(), at(MY_ENR))).status).toBe(200);
    fake.reset();
    expect((await leavePOST(post(), at(MY_ENR))).status).toBe(404);
    expect(fake.writes()).toEqual([]);
  });
});

describe('a Student cannot end anything that is not their own ACTIVE enrollment', () => {
  it('another Student\'s enrollment: 404, row untouched, no write, teacher access to that learner unchanged', async () => {
    const res = await leavePOST(post(), at(OTHER_ENR));
    expect(res.status).toBe(404);
    expect(statusOf(OTHER_ENR)).toBe('ACTIVE');
    expect(fake.writes()).toEqual([]);
    expect(await canTeacherAccessLearner('u-teacher', OTHER)).toBe(true);
    expect(await leaveClassAsStudent(ME, OTHER_ENR)).toBeNull();
  });

  it('unknown, malformed, pending and already-ended ids are all the same 404', async () => {
    fake.t.class_enrollments.push({ id: MY_PENDING, class_id: CLASS_2, student_id: ME, status: 'PENDING' });
    const responses = await Promise.all([UNKNOWN, 'not-a-uuid', MY_PENDING, OTHER_ENR].map(async (id) => {
      const res = await leavePOST(post(), at(id));
      return { status: res.status, body: await res.json() };
    }));
    for (const r of responses) expect(r).toEqual({ status: 404, body: { error: 'NOT_FOUND' } });
    expect(statusOf(MY_PENDING)).toBe('PENDING'); // a pending invitation is answered through "respond", not here
    expect(fake.writes()).toEqual([]);
  });

  it('the student id is always the caller\'s own resolved identity (nothing in the request can name another student)', async () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/student/class-enrollments/[id]/leave/route.ts'), 'utf-8');
    expect(src).toMatch(/const studentId = await requireStudentId\(clerkUserId\)/);
    expect(src).toMatch(/leaveClassAsStudent\(studentId, enrollmentId\)/);
    expect(src).not.toMatch(/request\.json|searchParams|body\./);
    const svc = readFileSync(join(process.cwd(), 'src/lib/institution/student-class-membership.ts'), 'utf-8');
    expect(svc).toMatch(/WHERE ce\.id = \$1 AND ce\.student_id = \$2 AND ce\.status = 'ACTIVE'/);
    expect(svc).toMatch(/endClassEnrollment\(own\.institution_id, own\.class_id, enrollmentId\)/);
    expect(svc).not.toMatch(/UPDATE |INSERT INTO|DELETE FROM/); // the transition itself stays in the existing lifecycle function
  });
});

describe('only a signed-in Student', () => {
  it('unauthenticated -> 401; no STUDENT role (a parent, teacher or coordinator account) -> 403; nothing is read or written', async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    expect((await leavePOST(post(), at(MY_ENR))).status).toBe(401);
    requireStudentIdMock.mockResolvedValueOnce(null);
    expect((await leavePOST(post(), at(MY_ENR))).status).toBe(403);
    authMock.mockResolvedValueOnce({ userId: null });
    expect((await listGET()).status).toBe(401);
    requireStudentIdMock.mockResolvedValueOnce(null);
    expect((await listGET()).status).toBe(403);
    expect(statusOf(MY_ENR)).toBe('ACTIVE');
    expect(fake.log).toEqual([]);
  });
});

describe('the Student\'s own class list', () => {
  it('returns only the caller\'s ACTIVE enrollments, with the id needed to leave', async () => {
    fake.t.class_enrollments.push({ id: MY_PENDING, class_id: CLASS_2, student_id: OTHER, status: 'PENDING' });
    const res = await listGET();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.locale).toBe('en');
    expect(data.enrollments.map((e: any) => e.enrollmentId).sort()).toEqual([MY_ENR, MY_ENR_2].sort());
    expect(data.enrollments[0]).toEqual({ enrollmentId: expect.any(String), classId: expect.any(String), className: expect.any(String), institutionName: 'School A' });
    expect(await listOwnActiveEnrollments(OTHER)).toEqual([expect.objectContaining({ enrollmentId: OTHER_ENR })]);
  });
});

describe('UI contract', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
  it('the control is mounted in the already-mounted institutional card; profile/page.tsx is not edited', () => {
    expect(read('src/app/dashboard/profile/InstitutionalContextCard.tsx')).toMatch(/<StudentClassMemberships \/>/);
    expect(read('src/app/dashboard/profile/page.tsx')).not.toMatch(/StudentClassMemberships|class-enrollments/);
  });
  it('the card still renders on the server with its existing props (the class list loads in the browser)', () => {
    const context: any = { resolverVersion: 'x', status: 'COMPLETE', confidence: 'HIGH', institutions: [], pendingInstitutions: [], missingInformation: [], conflicts: [], provenanceSummary: {} };
    const html = renderToStaticMarkup(createElement(InstitutionalContextCard, { context, labels: { 'jx.inst.title': 'Your academic path', 'jx.inst.lead': 'lead' } }));
    expect(html).toContain('Your academic path');
    expect(html).not.toContain('data-student-classes'); // nothing until the Student's classes are loaded
  });
  it('leaving asks for confirmation, calls the leave route, and never uses the coordinator route', () => {
    const src = read('src/app/dashboard/profile/StudentClassMemberships.tsx');
    expect(src).toMatch(/\/api\/student\/class-enrollments\/\$\{e\.enrollmentId\}\/leave/);
    expect(src).toMatch(/irost\.leave\.confirmBody/);
    expect(src).toMatch(/role=\{msg\.ok \? 'status' : 'alert'\}/);
    expect(src).not.toMatch(/\/api\/institutions\//);
  });
  it('every locale has every string of this lane', () => {
    const keys = Object.keys(ROSTER_MESSAGES.es).sort();
    for (const loc of ['en', 'de', 'fr', 'pt'] as const) {
      expect(Object.keys(ROSTER_MESSAGES[loc]).sort(), loc).toEqual(keys);
      for (const k of keys) expect((ROSTER_MESSAGES[loc] as any)[k], `${loc}/${k}`).toBeTruthy();
    }
  });
});
