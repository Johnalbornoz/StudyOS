/**
 * Track A -- Institution workspace operations: route guards, error mapping (foreign ids never
 * leak), UI contract (quick actions, setup wizard, empty-state CTAs, ⋯ menus), additive migration.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() } }));

import { InstitutionOpsError } from '@/lib/institution/institution-operations.service';
import { governedError } from '@/lib/institution/route-errors';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('error mapping: tenant-safe, explicit', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['TEACHER_NOT_AVAILABLE', 404],
    ['CURRICULUM_NOT_AVAILABLE', 404],
    ['DUPLICATE_CLASS_NAME', 409],
    ['DUPLICATE_GRADE_NAME', 409],
    ['ALREADY_ENROLLED', 409],
    ['GRADE_HAS_ACTIVE_CLASSES', 409],
    ['GRADE_HAS_DEPENDENCIES', 409],
    ['CLASS_ARCHIVED', 409],
    ['INVALID_STATE', 409],
    ['GRADE_REQUIRED', 422],
    ['NO_TEACHER_ACCOUNT', 422],
    ['NO_STUDENT_ACCOUNT', 422],
    ['DOMAIN_MISMATCH', 422],
  ] as const)('%s -> %i', async (code, status) => {
    const res = governedError(new InstitutionOpsError(code as any));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(code);
  });
});

describe('every new operation route is guarded', () => {
  const OPS_ROUTES = [
    'grades/route.ts',
    'grades/[gradeId]/route.ts',
    'grades/[gradeId]/archive/route.ts',
    'grades/[gradeId]/reactivate/route.ts',
    'classes/route.ts',
    'classes/[classId]/route.ts',
    'classes/[classId]/archive/route.ts',
    'classes/[classId]/reactivate/route.ts',
    'classes/[classId]/teacher/route.ts',
    'classes/[classId]/curriculum/route.ts',
    'teachers/route.ts',
    'teachers/[membershipId]/suspend/route.ts',
    'teachers/[membershipId]/reactivate/route.ts',
    'students/route.ts',
    'students/[studentId]/enroll/route.ts',
    'students/[studentId]/move/route.ts',
    'coordinators/[membershipId]/reactivate/route.ts',
  ];
  it.each(OPS_ROUTES)('%s: coordinator of THIS institution, malformed ids 404, strict bodies', (f) => {
    const src = read(`src/app/api/institutions/[id]/${f}`);
    expect(src).toMatch(/requireInstitutionAdminActor\(id(?:|: institutionId)?\b|requireInstitutionAdminActor\(institutionId/);
    expect(src).toMatch(/allUuids\(/);
    expect(src).not.toMatch(/export async function (GET|POST|PATCH|DELETE)\(/);
  });
  it('teacher invitations: the caller\'s OWN membership only, never an id-chosen user', () => {
    const list = read('src/app/api/teacher/institution-invitations/route.ts');
    const respond = read('src/app/api/teacher/institution-invitations/[membershipId]/respond/route.ts');
    expect(list).toMatch(/listMyTeacherInvitations\(actor\.id\)/);
    expect(respond).toMatch(/respondTeacherInvitation\(actor\.id, membershipId/);
    const svc = read('src/lib/institution/institution-operations.service.ts');
    expect(svc).toMatch(/WHERE id = \$1 AND user_id = \$2 AND membership_role = 'TEACHER'/);
  });
});

describe('service rules (source)', () => {
  const svc = read('src/lib/institution/institution-operations.service.ts');
  it('a class needs a grade; grade / teacher / curriculum are tenant-scoped; no Student is created', () => {
    expect(svc).toMatch(/if \(!gradeId\) throw new InstitutionOpsError\('GRADE_REQUIRED'\)/);
    expect(svc).toMatch(/SELECT \* FROM grades WHERE id = \$1 AND institution_id = \$2/);
    expect(svc).toMatch(/membership_role = 'TEACHER' AND status = 'APPROVED'`, \[membershipId, institutionId\]/);
    expect(svc).not.toMatch(/INSERT INTO students|upsertStudentFromWebhook|createUser\(/);
  });
  it('archive never deletes; delete only when nothing depends on the grade', () => {
    expect(svc).toMatch(/GRADE_HAS_ACTIVE_CLASSES/);
    expect(svc).toMatch(/GRADE_HAS_DEPENDENCIES/);
    expect(svc.match(/DELETE FROM/g)).toHaveLength(1); // the dependency-free grade only
  });
  it('every write is audited', () => {
    for (const action of ['GRADE_CREATED', 'GRADE_UPDATED', 'GRADE_ARCHIVED', 'GRADE_REACTIVATED', 'GRADE_DELETED', 'CLASS_CREATED', 'CLASS_UPDATED', 'CLASS_ARCHIVED', 'CLASS_REACTIVATED', 'TEACHER_ASSIGNED', 'TEACHER_UNASSIGNED', 'TEACHER_INVITED', 'TEACHER_SUSPENDED', 'TEACHER_REACTIVATED', 'STUDENT_ENROLLED', 'STUDENT_INVITED', 'STUDENT_MOVED', 'STUDENT_REMOVED_FROM_CLASS', 'COORDINATOR_REACTIVATED']) {
      expect(svc, action).toContain(`'${action}'`);
    }
  });
  it('an archived class leaves the teacher\'s working list (history stays)', () => {
    expect(read('src/lib/teacher/read-model.service.ts')).toMatch(/AND c\.status = 'ACTIVE'/);
  });
});

describe('UI contract', () => {
  const dir = 'src/app/dashboard/institution/[institutionId]';
  it('summary: quick actions and the first-time setup wizard with progress', () => {
    const src = read(`${dir}/page.tsx`);
    expect(src).toMatch(/data-quick-actions/);
    for (const k of ['grade', 'class', 'curriculum', 'teacher', 'student', 'coordinator', 'assignment']) expect(src).toContain(`iops.quick.${k}`);
    expect(src).toMatch(/data-setup-wizard/);
    expect(src).toMatch(/<progress /);
  });
  it.each([
    ['grades/page.tsx', 'grades', 'iops.grades.emptyCta'],
    ['classes/page.tsx', 'classes', 'iops.classes.emptyCta'],
    ['teachers/page.tsx', 'teachers', 'iops.teachers.invite'],
    ['students/page.tsx', 'students', 'iops.students.add'],
  ])('%s: never an empty tab without a CTA; rows have a ⋯ menu', (f, key, cta) => {
    const src = read(`${dir}/${f}`);
    expect(src).toContain(`data-empty="${key}"`);
    expect(src).toContain(cta);
    expect(src).toMatch(/<RowMenu /);
  });
  it('detail pages exist for grade, class, teacher and student', () => {
    for (const p of ['grades/[gradeId]/page.tsx', 'classes/[classId]/page.tsx', 'teachers/[membershipId]/page.tsx', 'students/[studentId]/page.tsx']) expect(existsSync(join(ROOT, dir, p)), p).toBe(true);
  });
  it('row menu is keyboard / screen-reader usable and 44px', () => {
    const ops = read(`${dir}/OpsActions.tsx`);
    expect(ops).toMatch(/<summary aria-label=\{`\$\{l\['iops\.common\.menu'\]\}: \$\{label\}`\}/);
    expect(ops).toMatch(/role="menuitem"/);
    expect(read('src/app/globals.css')).toMatch(/\.ta-menu-item \{[^}]*min-height: var\(--touch-target/);
  });
  it('the class form never preselects a curriculum and requires a grade', () => {
    const ops = read(`${dir}/OpsActions.tsx`);
    expect(ops).toMatch(/const \[curriculumId, setCurriculumId\] = useState\(''\); \/\/ never preselected/);
    expect(ops).toMatch(/<select required value=\{gradeId\}/);
  });
});

describe('migration 20261018_1700 is additive', () => {
  const sql = read('database/migrations/20261018_1700_track_a_institution_operations.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  it('adds columns / checks; widens the membership status check only', () => {
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE|UPDATE /);
    expect(sql.match(/DROP CONSTRAINT/g)).toHaveLength(1);
    expect(sql).toMatch(/'PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'INVITED', 'SUSPENDED'/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'/);
  });
});
