/**
 * Foundation (Roles E2E + Exam Core shared base) -- the 21 shared invariants
 * of docs/foundation/ROLES_EXAMS_SHARED_FOUNDATION.md §22, as fast regression
 * guards. Behaviour that needs a real schema (role coexistence, parent /
 * teacher / institution / attempt isolation against real rows) is proven by
 * the DEV functional scenarios in scripts/operations/foundation-scenarios.ts
 * (FOUNDATION_CERTIFICATION_REPORT.md); this file pins the contracts so a
 * later track cannot silently regress them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const dbQueryMock = vi.fn();
const clientQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: async () => ({ query: (...a: any[]) => clientQueryMock(...a), release: () => {} }) } }));
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<any>()), getOrCreateStudentId: vi.fn().mockResolvedValue('student-1') }));
const recordAdminActionMock = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: (...a: any[]) => recordAdminActionMock(...a) }));

import { assignSelfServiceRole } from '@/lib/identity/role-assignment.service';
import { resolveAvailableWorkspaces, resolveDefaultWorkspace } from '@/lib/identity/workspace.service';
import { workspaceForRole, WORKSPACE_PRIORITY } from '@/lib/identity/types';
import { canAccessLearner, isActiveParentOf, canTeacherAccessLearner, canAccessInstitution } from '@/lib/authorization';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const rolesRows = (roles: string[]) => ({ rows: roles.map((role) => ({ role, status: 'ACTIVE', granted_via: 'SELF_REGISTRATION' })) });

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  clientQueryMock.mockReset().mockResolvedValue({ rows: [] });
  recordAdminActionMock.mockReset().mockResolvedValue(undefined);
});

// Track A product amendment (2026-10-01): one canonical user, ONE primary
// persona; institution / StudyUs administration are capabilities. The
// additive-persona assertions (4b) were replaced; the security invariants
// (no duplicate user, audited grants, revoked never re-granted, privileged
// roles never self-service) are unchanged.
describe('IDENTITY / SINGLE PERSONA + CAPABILITIES (1-5)', () => {
  it('1+2. one User holds many roles: user_roles is UNIQUE (user_id, role) and keyed to the same users row', () => {
    const f1 = read('database/migrations/20260919_1000_f1_unified_identity.sql');
    expect(f1).toMatch(/CREATE TABLE[^;]*user_roles[\s\S]*UNIQUE \(user_id, role\)/);
    expect(f1).toMatch(/CONSTRAINT users_clerk_id_key UNIQUE \(clerk_id\)/);
  });

  it('2. granting a role never creates a users row (role assignment only inserts into user_roles)', async () => {
    expect(await assignSelfServiceRole('clerk-1', 'user-1', 'PARENT')).toBe('GRANTED');
    const sqls = [...dbQueryMock.mock.calls, ...clientQueryMock.mock.calls].map((c) => String(c[0]));
    expect(sqls.every((s) => !/INSERT INTO users/i.test(s))).toBe(true);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROLE_ADDED', actorUserId: 'user-1', reason: 'SELF_SERVICE' }));
  });

  it('3. a new students row is only ever created for an ACTIVE STUDENT role (getOrCreateStudentId creation gate)', () => {
    const src = read('src/lib/auth.ts');
    const fn = src.slice(src.indexOf('export async function getOrCreateStudentId'), src.indexOf('export async function upsertStudentFromWebhook'));
    const gate = fn.indexOf("r.role = 'STUDENT' AND r.status = 'ACTIVE'");
    expect(gate).toBeGreaterThan(fn.indexOf('SELECT id FROM students WHERE clerk_id')); // existing-row path first, untouched
    expect(gate).toBeLessThan(fn.indexOf('upsertStudentRecord(')); // gate before any creation
    expect(fn).toMatch(/throw new StudentRoleRequiredError\(\)/);
  });

  it('4. STUDYUS_ADMIN is a capability alongside the one persona: both contexts exist, admin does not hide Student', async () => {
    dbQueryMock.mockResolvedValue(rolesRows(['STUDYUS_ADMIN', 'STUDENT']));
    const available = await resolveAvailableWorkspaces('user-1');
    expect(available).toEqual(expect.arrayContaining(['STUDENT', 'ADMIN']));
  });

  it('4b. no "add another role": the shell shows the ONE persona, never a persona switcher; the account page never offers a second persona', () => {
    const sw = read('src/app/dashboard/WorkspaceSwitcher.tsx');
    expect(sw).not.toMatch(/role-select|addRole|\/api\/identity\/workspace|useState/);
    expect(read('src/app/dashboard/layout.tsx')).not.toMatch(/workspace\.addRole|addRoleLabel/);
    const page = read('src/app/role-select/page.tsx');
    expect(page).not.toMatch(/rolesNotYetHeld|account\.addTitle|Añadir otro rol/);
    expect(page).toMatch(/const canChoose = !persona && !revokedPersona/);
    expect(read('src/app/api/identity/roles/select/route.ts')).toMatch(/outcome === 'PERSONA_EXISTS'[\s\S]*status: 409/);
  });

  it('4c. a REVOKED role is never silently re-granted by self-service', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => (/FROM user_roles WHERE user_id/.test(sql) ? { rows: [{ role: 'STUDENT', status: 'REVOKED' }] } : { rows: [] }));
    expect(await assignSelfServiceRole('clerk-1', 'user-1', 'STUDENT')).toBe('REVOKED');
    expect(recordAdminActionMock).not.toHaveBeenCalled();
    expect(read('src/app/api/identity/roles/select/route.ts')).toMatch(/outcome === 'REVOKED'[\s\S]*ROLE_REVOKED[\s\S]*status: 409/);
  });

  it('5. active-workspace resolution is deterministic (fixed priority, independent of grant order)', async () => {
    expect(WORKSPACE_PRIORITY).toEqual(['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION', 'ADMIN']);
    dbQueryMock.mockResolvedValue(rolesRows(['STUDYUS_ADMIN', 'PARENT', 'STUDENT']));
    const a = await resolveDefaultWorkspace('user-1');
    dbQueryMock.mockResolvedValue(rolesRows(['STUDENT', 'STUDYUS_ADMIN', 'PARENT']));
    const b = await resolveDefaultWorkspace('user-1');
    expect(a).toBe('STUDENT');
    expect(b).toBe(a);
    expect(workspaceForRole('STUDYUS_ADMIN')).toBe('ADMIN');
  });
});

describe('PARENT (6-8)', () => {
  it('6+7. parent access requires an ACCEPTED relationship to THIS learner, resolved from the actor\'s own canonical user', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    expect(await isActiveParentOf('parent-user', 'learner-A')).toBe(false);
    const [sql, params] = dbQueryMock.mock.calls[0];
    expect(String(sql)).toMatch(/psr\.status = 'accepted'/);
    expect(String(sql)).toMatch(/p\.user_id = \$1 AND psr\.student_id = \$2/);
    expect(params).toEqual(['parent-user', 'learner-A']);
  });

  it('8. Parent A -> Student B: no accepted row for (A,B) => denied for every learner permission', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    for (const p of ['LEARNER_PROGRESS_VIEW', 'LEARNER_PROFILE_VIEW', 'LEARNER_INTERVENTION_CREATE'] as const) {
      expect(await canAccessLearner('parent-A', 'student-B', p)).toBe(false);
    }
  });
});

describe('TEACHER / INSTITUTION (9-12)', () => {
  it('9+10. teacher access requires APPROVED membership + ACTIVE assignment + ACTIVE enrollment in the SAME institution', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    expect(await canTeacherAccessLearner('teacher-user', 'learner-1')).toBe(false);
    const sql = String(dbQueryMock.mock.calls[0][0]);
    for (const c of [/im\.status = 'APPROVED'/, /ta\.status = 'ACTIVE'/, /ce\.status = 'ACTIVE'/, /c\.institution_id = im\.institution_id/, /membership_role = 'TEACHER'/]) {
      expect(sql).toMatch(c);
    }
  });

  it('11+12. institution scope is bound to exactly one institution_id (A never reads B)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    expect(await canAccessInstitution('admin-A', 'inst-B', 'INSTITUTION_INTELLIGENCE_VIEW')).toBe(false);
    const [sql, params] = dbQueryMock.mock.calls[0];
    expect(String(sql)).toMatch(/institution_id = \$2/);
    expect(String(sql)).toMatch(/status = 'APPROVED'/);
    expect(params).toEqual(['admin-A', 'inst-B']);
  });
});

describe('ASSIGNMENT (13-14)', () => {
  it('13. a teacher assignment can only point at a grade/class of the membership\'s own institution (guarded INSERT)', () => {
    const svc = read('src/services/institution.service.ts');
    const fn = svc.slice(svc.indexOf('export async function createTeacherAssignment'), svc.indexOf('export async function endTeacherAssignment'));
    expect(fn).toMatch(/g\.institution_id = im\.institution_id/);
    expect(fn).toMatch(/c\.institution_id = im\.institution_id/);
    expect(fn).toMatch(/throw new Error\('SCOPE_OUTSIDE_INSTITUTION'\)/);
  });

  it('14. assignment / teacher / institution layers never write canonical cognitive state', () => {
    const files = [
      'src/services/institution.service.ts',
      'src/lib/student/teacher-intervention-execution.service.ts',
    ];
    for (const f of files) {
      const s = read(f);
      expect(s, f).not.toMatch(/(INSERT INTO|UPDATE)\s+(mastery_records|concept_knowledge_state|learning_evidence|concept_memory_state|concept_transfer_state)/);
    }
  });

  it('14b. the Student learning-route guard is owner-only: no session-claim role (admin/teacher) can read or WRITE another learner\'s evidence', () => {
    const src = read('src/lib/auth.ts');
    const body = src.slice(src.indexOf('export async function verifyStudentAccess'), src.indexOf('async function isUserStudent'));
    expect(body).toMatch(/return isUserStudent\(userId, studentId\)/);
    expect(body).not.toMatch(/role === 'admin'|role === 'teacher'/);
  });
});

describe('EXAM (15-19)', () => {
  it('15+16. every attempt-scoped route resolves the attempt and authorizes against attempt.studentId', () => {
    for (const r of ['complete', 'pause', 'resume', 'abandon']) {
      const s = read(`src/app/api/simulation/attempts/[id]/${r}/route.ts`);
      expect(s, r).toMatch(/canAccessLearner\(actor\.id, attempt\.studentId, 'LEARNER_INTERVENTION_CREATE'\)/);
    }
    expect(read('src/lib/simulation/item-resolution.service.ts')).toMatch(/isOwner\(/);
  });

  it('16b. an attempt can only start on a PUBLISHED version of the profile\'s own exam definition', () => {
    const route = read('src/app/api/simulation/attempts/route.ts');
    expect(route.indexOf('isExamVersionStartableForProfile(')).toBeGreaterThan(route.indexOf('isExamProfileOwnedByStudent(validated'));
    expect(route.indexOf('isExamVersionStartableForProfile(')).toBeLessThan(route.indexOf('startSimulationAttempt(validated)'));
    const svc = read('src/lib/assessment/student-exam-profile.service.ts');
    expect(svc).toMatch(/v\.exam_definition_id = p\.exam_definition_id[\s\S]*v\.status = 'PUBLISHED'/);
  });

  it('17+18. no route grades a client-supplied question (the forgeable /responses path is removed; grading only via the server-held item)', () => {
    expect(existsSync(join(process.cwd(), 'src/app/api/simulation/attempts/[id]/responses'))).toBe(false);
    const walkRoutes = (dir: string): string[] =>
      readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkRoutes(join(dir, e.name)) : e.name === 'route.ts' ? [join(dir, e.name)] : []));
    for (const f of walkRoutes('src/app/api')) expect(read(f), f).not.toMatch(/recordSimulationItemResponse/);
  });

  it('18b. exam layers never write mastery directly -- only through the canonical updateMastery evidence pipeline', () => {
    for (const f of ['src/lib/simulation/scoring.service.ts', 'src/lib/simulation/attempt.service.ts', 'src/lib/readiness/readiness.service.ts']) {
      const s = read(f);
      expect(s, f).not.toMatch(/(INSERT INTO|UPDATE)\s+(mastery_records|concept_knowledge_state|learning_evidence)/);
    }
    expect(read('src/lib/simulation/scoring.service.ts')).toMatch(/updateMastery\(/);
  });

  it('19. exam evidence is written only against the ATTEMPT OWNER\'s own concept, idempotently, as non-assisted EXAM_SIMULATION evidence', () => {
    const s = read('src/lib/simulation/scoring.service.ts');
    expect(s).toMatch(/resolveStudentConceptForCanonicalConcept\(/);
    expect(s).toMatch(/EXAM_SIMULATION_RESPONSE/);
    expect(s).toMatch(/sourceType: 'EXAM_SIMULATION'/);
  });

  it('19b. creating an exam profile is owner-only (a read permission never gates a write)', () => {
    const s = read('src/app/api/exam-profiles/route.ts');
    const post = s.slice(s.indexOf('export async function POST'));
    expect(post).toMatch(/'LEARNER_INTERVENTION_CREATE'/);
    expect(post).not.toMatch(/'LEARNER_PROFILE_VIEW'/);
  });
});

describe('ENTITLEMENTS (20-21)', () => {
  it('20. parent access is authorization-only: the parent read model never consults a paid entitlement', () => {
    const s = read('src/lib/parent/read-model.service.ts');
    expect(s).toMatch(/isActiveParentOf/);
    expect(s).not.toMatch(/canUseCapability|resolveLearningAccess/);
  });

  it('21. role/relationship checks and entitlement checks are separate modules (entitlements never import authorization)', () => {
    const ent = read('src/lib/entitlements/index.ts');
    expect(ent).not.toMatch(/from '@\/lib\/authorization'/);
    const authz = read('src/lib/authorization/index.ts');
    expect(authz).not.toMatch(/from '@\/lib\/entitlements'/);
  });
});
