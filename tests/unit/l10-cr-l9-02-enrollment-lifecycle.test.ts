/**
 * CR-L9-02 (Orchestrator) -- an ENDED or DECLINED class enrolment is never reactivated in place.
 *
 * Required regressions:
 *   - ended enrolment + coordinator add    => no direct active reactivation
 *   - declined enrolment + coordinator add => no direct active reactivation
 *   - historical relation preserved
 *   - new eligible enrolment follows the canonical pending / acceptance lifecycle
 *   - active existing enrolment            => deterministic, no duplicate
 *   - bulk behaviour remains non-reactivating
 *
 * The fixture is an in-memory `class_enrollments` table that enforces what migration 20261120_1500
 * enforces (one OPEN row per learner per class; a closed row never changes status), behind the real
 * services. The same cases run against a real Postgres in scripts/l10-ephemeral-db-test.sh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const { w, h } = vi.hoisted(() => ({
  w: { rows: [] as Array<{ id: string; class_id: string; student_id: string; status: string; created_at: number; invited_by_user_id: string | null }>, seq: 0, clock: 0 },
  h: { notify: null as any, audit: null as any },
}));

const INST = 'inst-1';
const CLASS_A = 'class-a';
const CLASS_B = 'class-b';
const STU = 'stu-1';
const NEW = 'stu-new';
const COORD = 'coord-1';

vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: (...a: any[]) => h.notify(...a) }));
vi.mock('@/lib/institution/academic-governance', () => ({ recordGovernanceEvent: (...a: any[]) => h.audit(...a) }));
vi.mock('@/lib/identity/display-identity', () => ({ resolveDisplayIdentities: async () => new Map() }));
vi.mock('@/lib/institution/curriculum-management.service', () => ({ assignClassCurriculum: vi.fn(), compatibleCurriculaForClass: vi.fn(async () => []) }));
vi.mock('@/lib/teacher/class-assignment.service', () => ({ isTeacherOfClass: async () => false }));
vi.mock('@/lib/db', () => {
  const students: Record<string, { id: string; user_id: string }> = { 'kid@school.test': { id: 'stu-1', user_id: 'user-stu-1' }, 'new@school.test': { id: 'stu-new', user_id: 'user-stu-new' } };
  const classes: Record<string, any> = { 'class-a': { id: 'class-a', name: 'A', institution_id: 'inst-1', status: 'ACTIVE' }, 'class-b': { id: 'class-b', name: 'B', institution_id: 'inst-1', status: 'ACTIVE' } };
  const open = (r: any) => r.status === 'PENDING' || r.status === 'ACTIVE';
  const unique = () => Object.assign(new Error('duplicate key value violates unique constraint "uq_class_enrollments_one_open"'), { code: '23505', constraint: 'uq_class_enrollments_one_open' });
  const query = async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/ON CONFLICT \(class_id, student_id\)/.test(s)) throw new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'); // what Postgres says after 20261120_1500
    if (/^SELECT \* FROM classes WHERE id = \$1 AND institution_id = \$2/.test(s)) return { rows: classes[p[0]]?.institution_id === p[1] ? [classes[p[0]]] : [] };
    if (/FROM classes c LEFT JOIN grades g/.test(s)) return { rows: classes[p[0]]?.institution_id === p[1] ? [{ id: p[0], name: classes[p[0]].name, grade_id: null, grade_name: null, canonical_subject_id: null, subject_name: null }] : [] };
    if (/^SELECT id, name, status FROM institutions WHERE id = \$1/.test(s)) return { rows: [{ id: 'inst-1', name: 'School', status: 'ACTIVE' }] };
    if (/FROM students s JOIN users u ON u\.id = s\.user_id/.test(s)) {
      const st = students[String(p[0]).trim().toLowerCase()];
      return { rows: st ? [{ id: st.id, student_id: st.id, user_id: st.user_id }] : [] };
    }
    if (/^SELECT 1 FROM class_enrollments ce JOIN classes c ON c\.id = ce\.class_id WHERE ce\.student_id = \$1 AND c\.institution_id = \$2 AND ce\.status = 'ACTIVE'/.test(s)) {
      return { rows: w.rows.some((r) => r.student_id === p[0] && classes[r.class_id]?.institution_id === p[1] && r.status === 'ACTIVE') ? [{ ok: 1 }] : [] };
    }
    if (/^SELECT id, status FROM class_enrollments WHERE class_id = \$1 AND student_id = \$2 ORDER BY \(status IN \('PENDING', 'ACTIVE'\)\) DESC, created_at DESC/.test(s)) {
      return { rows: w.rows.filter((r) => r.class_id === p[0] && r.student_id === p[1]).sort((a, b) => Number(open(b)) - Number(open(a)) || b.created_at - a.created_at).map((r) => ({ id: r.id, status: r.status })) };
    }
    if (/^SELECT id FROM class_enrollments WHERE class_id = \$1 AND student_id = \$2 AND status = 'ACTIVE'/.test(s)) return { rows: w.rows.filter((r) => r.class_id === p[0] && r.student_id === p[1] && r.status === 'ACTIVE').map((r) => ({ id: r.id })) };
    if (/^INSERT INTO class_enrollments/.test(s)) {
      const status = /'(PENDING|ACTIVE)'/.exec(s)![1];
      if (w.rows.some((r) => r.class_id === p[0] && r.student_id === p[1] && open(r))) throw unique();
      const row = { id: `enr-${++w.seq}`, class_id: p[0], student_id: p[1], status, created_at: ++w.clock, invited_by_user_id: p[2] ?? null };
      w.rows.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (/^UPDATE class_enrollments SET status = 'ACTIVE', responded_at = NOW\(\) WHERE id = \$1 AND status = 'PENDING'/.test(s)) {
      const r = w.rows.find((x) => x.id === p[0] && x.status === 'PENDING');
      if (r) r.status = 'ACTIVE';
      return { rows: r ? [{ id: r.id }] : [] };
    }
    if (/^UPDATE class_enrollments ce SET status = \$3, responded_at = NOW\(\)/.test(s)) {
      const r = w.rows.find((x) => x.id === p[0] && x.student_id === p[1] && x.status === 'PENDING');
      if (r) r.status = p[2];
      return { rows: r ? [{ invited_by_user_id: r.invited_by_user_id, institution_id: 'inst-1', class_id: r.class_id, name: classes[r.class_id].name }] : [] };
    }
    if (/^UPDATE class_enrollments ce SET status = 'ENDED', ended_at = NOW\(\)/.test(s)) {
      const r = w.rows.find((x) => x.id === p[0] && x.class_id === p[1] && open(x));
      if (r) r.status = 'ENDED';
      return { rows: r ? [{ id: r.id, student_id: r.student_id }] : [] };
    }
    if (/^WITH retired AS/.test(s)) return { rows: [] };
    if (/^UPDATE class_enrollments/.test(s)) throw new Error(`a status write the lifecycle does not define: ${s.slice(0, 120)}`);
    throw new Error(`unexpected SQL in fixture: ${s.slice(0, 140)}`);
  };
  return { db: { query, connect: vi.fn() } };
});

import { addStudentToClass, enrollInstitutionStudent, moveStudent, InstitutionOpsError } from '@/lib/institution/institution-operations.service';
import { enrollStudentDirectly, enrollStudent, inviteStudentToClass, respondToClassInvitation, endClassEnrollment, getClassEnrollmentState } from '@/services/institution.service';

const seed = (class_id: string, student_id: string, status: string) => {
  const row = { id: `enr-${++w.seq}`, class_id, student_id, status, created_at: ++w.clock, invited_by_user_id: null };
  w.rows.push(row);
  return row;
};
const statuses = (classId: string, studentId = STU) => w.rows.filter((r) => r.class_id === classId && r.student_id === studentId).map((r) => r.status).sort();
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 'OK';
  } catch (error) {
    return error instanceof InstitutionOpsError ? error.code : `UNEXPECTED ${(error as Error).message}`;
  }
};

beforeEach(() => {
  w.rows.length = 0;
  w.seq = 0;
  w.clock = 0;
  h.notify = vi.fn(async () => 'n-1');
  h.audit = vi.fn(async () => undefined);
  seed(CLASS_A, STU, 'ACTIVE'); // the learner is an active student of this institution (so the direct path would apply)
});

describe('ended enrolment + coordinator add => no direct active reactivation', () => {
  it('the learner is INVITED again; nothing becomes ACTIVE; the ENDED row is untouched', async () => {
    const ended = seed(CLASS_B, STU, 'ENDED');
    const result = await addStudentToClass(INST, CLASS_B, 'kid@school.test', COORD);
    expect(result.outcome).toBe('INVITED');
    expect(statuses(CLASS_B)).toEqual(['ENDED', 'PENDING']);
    expect(w.rows.find((r) => r.id === ended.id)!.status).toBe('ENDED');
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLASS_ENROLLMENT_INVITE', workspace: 'STUDENT' }));
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'STUDENT_INVITED' }));
    expect(h.audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'STUDENT_ENROLLED' }));
  });

  it('the direct paths refuse it too: enrollStudentDirectly, "enrol in another class" and "move"', async () => {
    seed(CLASS_B, STU, 'ENDED');
    expect(await enrollStudentDirectly(CLASS_B, STU, COORD)).toEqual({ outcome: 'REQUIRES_INVITATION', previous: 'ENDED' });
    expect(await code(() => enrollInstitutionStudent(INST, STU, CLASS_B, COORD))).toBe('INVALID_STATE');
    expect(await code(() => moveStudent(INST, STU, CLASS_A, CLASS_B, COORD))).toBe('INVALID_STATE');
    expect(statuses(CLASS_B)).toEqual(['ENDED']);
    expect(statuses(CLASS_A)).toEqual(['ACTIVE']); // a refused move ends nothing
  });
});

describe('declined enrolment + coordinator add => no direct active reactivation', () => {
  it('the learner is INVITED again; the DECLINED row stays as the record of the refusal', async () => {
    const declined = seed(CLASS_B, STU, 'DECLINED');
    expect((await addStudentToClass(INST, CLASS_B, 'kid@school.test', COORD)).outcome).toBe('INVITED');
    expect(statuses(CLASS_B)).toEqual(['DECLINED', 'PENDING']);
    expect(w.rows.find((r) => r.id === declined.id)!.status).toBe('DECLINED');
    expect(await enrollStudentDirectly(CLASS_B, STU, COORD)).toMatchObject({ outcome: 'REQUIRES_INVITATION' });
  });
});

describe('historical relation preserved', () => {
  it('leave, re-invite, decline, re-invite, accept: every closed row survives, in order', async () => {
    const first = seed(CLASS_B, STU, 'ACTIVE');
    await endClassEnrollment(INST, CLASS_B, first.id);
    await addStudentToClass(INST, CLASS_B, 'kid@school.test', COORD);
    const second = (await getClassEnrollmentState(CLASS_B, STU)).open!;
    await respondToClassInvitation(STU, second.id, false);
    await addStudentToClass(INST, CLASS_B, 'kid@school.test', COORD);
    const third = (await getClassEnrollmentState(CLASS_B, STU)).open!;
    await respondToClassInvitation(STU, third.id, true);
    expect(w.rows.filter((r) => r.class_id === CLASS_B).map((r) => [r.id, r.status])).toEqual([[first.id, 'ENDED'], [second.id, 'DECLINED'], [third.id, 'ACTIVE']]);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  it('getClassEnrollmentState reads the open row and the most recent closed one, never "the" row', async () => {
    seed(CLASS_B, STU, 'ENDED');
    seed(CLASS_B, STU, 'DECLINED');
    const pending = seed(CLASS_B, STU, 'PENDING');
    expect(await getClassEnrollmentState(CLASS_B, STU)).toEqual({ open: { id: pending.id, status: 'PENDING' }, lastClosed: expect.objectContaining({ status: 'DECLINED' }) });
    expect(await getClassEnrollmentState(CLASS_B, NEW)).toEqual({ open: null, lastClosed: null });
  });

  it('no writer in the lifecycle relies on the dropped one-row-per-pair constraint', () => {
    for (const f of ['src/services/institution.service.ts', 'src/lib/institution/institution-operations.service.ts']) {
      const code = readFileSync(join(process.cwd(), f), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
      expect(code).not.toMatch(/ON CONFLICT \(class_id, student_id\)/);
      expect(code).not.toMatch(/class_enrollments\.status IN \('DECLINED', 'ENDED'/);
    }
  });
});

describe('new eligible enrolment follows the canonical pending / acceptance lifecycle', () => {
  it('after a departure: PENDING grants nothing, and only the Student\'s acceptance makes it ACTIVE', async () => {
    seed(CLASS_B, STU, 'ENDED');
    await addStudentToClass(INST, CLASS_B, 'kid@school.test', COORD);
    const pending = (await getClassEnrollmentState(CLASS_B, STU)).open!;
    expect(pending.status).toBe('PENDING');
    expect(await respondToClassInvitation('someone-else', pending.id, true)).toBeNull(); // only the invited Student
    expect((await getClassEnrollmentState(CLASS_B, STU)).open!.status).toBe('PENDING');
    expect(await respondToClassInvitation(STU, pending.id, true)).toMatchObject({ classId: CLASS_B });
    expect(statuses(CLASS_B)).toEqual(['ACTIVE', 'ENDED']);
  });

  it('a learner with NO history in the class keeps the existing rules', async () => {
    // already an active student of this institution: enrolled directly (unchanged)
    expect((await addStudentToClass(INST, CLASS_B, 'kid@school.test', COORD)).outcome).toBe('ENROLLED');
    expect(statuses(CLASS_B)).toEqual(['ACTIVE']);
    // not a student of this institution: invited, pending until they accept (unchanged)
    expect((await addStudentToClass(INST, CLASS_B, 'new@school.test', COORD)).outcome).toBe('INVITED');
    expect(statuses(CLASS_B, NEW)).toEqual(['PENDING']);
    expect(await code(() => addStudentToClass(INST, CLASS_B, 'nobody@school.test', COORD))).toBe('NO_STUDENT_ACCOUNT');
  });
});

describe('active existing enrolment => deterministic, no duplicate', () => {
  it('every entry point answers "already", and no row is added', async () => {
    seed(CLASS_B, STU, 'ACTIVE');
    expect(await code(() => addStudentToClass(INST, CLASS_B, 'kid@school.test', COORD))).toBe('ALREADY_ENROLLED');
    expect(await inviteStudentToClass(INST, CLASS_B, 'kid@school.test', COORD)).toEqual({ outcome: 'ALREADY_ACTIVE' });
    expect(await enrollStudentDirectly(CLASS_B, STU, COORD)).toMatchObject({ outcome: 'ALREADY_ACTIVE' });
    await enrollStudent(CLASS_B, STU);
    expect(statuses(CLASS_B)).toEqual(['ACTIVE']);
  });

  it('a pending invitation is not duplicated either', async () => {
    seed(CLASS_B, NEW, 'PENDING');
    expect(await code(() => addStudentToClass(INST, CLASS_B, 'new@school.test', COORD))).toBe('ALREADY_ENROLLED');
    expect(await inviteStudentToClass(INST, CLASS_B, 'new@school.test', COORD)).toEqual({ outcome: 'ALREADY_PENDING' });
    expect(statuses(CLASS_B, NEW)).toEqual(['PENDING']);
  });

  it('two invitations at once: the one-open-row index lets exactly one through, the other reads ALREADY_PENDING', async () => {
    seed(CLASS_B, STU, 'ENDED');
    const [a, b] = await Promise.all([inviteStudentToClass(INST, CLASS_B, 'kid@school.test', COORD), inviteStudentToClass(INST, CLASS_B, 'kid@school.test', COORD)]);
    expect([a.outcome, b.outcome].sort()).toEqual(['ALREADY_PENDING', 'INVITED']);
    expect(statuses(CLASS_B)).toEqual(['ENDED', 'PENDING']);
  });
});

describe('bulk behaviour remains non-reactivating', () => {
  it('the single add, once per address over a mixed list, never reopens a closed row and never duplicates', async () => {
    // Bulk add (L9 IN-1) is the single add per address; whatever list it is given, this is what each call can do.
    seed(CLASS_B, STU, 'ENDED');
    const outcomes: string[] = [];
    for (const email of ['kid@school.test', 'kid@school.test', 'new@school.test', 'new@school.test', 'nobody@school.test']) {
      outcomes.push(await addStudentToClass(INST, CLASS_B, email, COORD).then((r) => r.outcome, (e) => (e as InstitutionOpsError).code));
    }
    expect(outcomes).toEqual(['INVITED', 'ALREADY_ENROLLED', 'INVITED', 'ALREADY_ENROLLED', 'NO_STUDENT_ACCOUNT']);
    expect(statuses(CLASS_B)).toEqual(['ENDED', 'PENDING']);
    expect(statuses(CLASS_B, NEW)).toEqual(['PENDING']);
    expect(w.rows.some((r) => r.class_id === CLASS_B && r.status === 'ACTIVE')).toBe(false);
  });
});

describe('the database holds the rule too (migration 20261120_1500)', () => {
  const sql = readFileSync(join(process.cwd(), 'database/migrations/20261120_1500_cr_l9_02_enrollment_history.sql'), 'utf8');
  it('one OPEN row per learner per class; closed rows are unlimited history', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS class_enrollments_unique/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_class_enrollments_one_open\s+ON public\.class_enrollments \(class_id, student_id\)\s+WHERE status IN \('PENDING', 'ACTIVE'\)/);
  });
  it('a closed row can never change status, whoever writes', () => {
    expect(sql).toMatch(/OLD\.status IN \('ENDED', 'DECLINED'\) AND NEW\.status IS DISTINCT FROM OLD\.status/);
    expect(sql).toMatch(/RAISE EXCEPTION 'CLASS_ENROLLMENT_CLOSED_ROW_IS_HISTORY/);
    expect(sql).toMatch(/BEFORE UPDATE OF status ON public\.class_enrollments/);
  });
});

describe('L10-R1: every SQL caller follows the new lifecycle contract (repository-wide)', () => {
  const root = process.cwd();
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|sql|sh)$/.test(n) ? [p] : []; });
  const rel = (f: string) => f.slice(root.length + 1);
  const code = (f: string) => readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|--).*$/gm, '');
  const sources = [...walk(join(root, 'src')), ...walk(join(root, 'scripts'))];

  it('nothing in src/ or scripts/ infers the dropped constraint: no `ON CONFLICT (class_id, student_id)`', () => {
    expect(sources.filter((f) => /ON CONFLICT\s*\(\s*class_id\s*,\s*student_id\s*\)/i.test(code(f))).map(rel)).toEqual([]);
  });

  it('no later migration re-creates the one-row-per-pair constraint', () => {
    const later = readdirSync(join(root, 'database/migrations')).filter((f) => f > '20261120_1500_z');
    for (const f of later) expect(code(join(root, 'database/migrations', f)), f).not.toMatch(/class_enrollments_unique|UNIQUE\s*\(\s*class_id\s*,\s*student_id\s*\)/);
  });

  it('application code never reads "the" enrolment of a learner in a class without saying which one', () => {
    // After 20261120_1500 a pair can have one OPEN row and any number of closed ones. A read by
    // (class_id, student_id) must filter by status or order explicitly (as getClassEnrollmentState does).
    const offenders: string[] = [];
    for (const f of walk(join(root, 'src'))) {
      for (const m of code(f).matchAll(/FROM class_enrollments WHERE class_id = \$1 AND student_id = \$2([^`]*)`/g)) {
        if (!/status|ORDER BY/.test(m[1])) offenders.push(`${rel(f)}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every INSERT into class_enrollments in src/ lives in the lifecycle module', () => {
    const writers = walk(join(root, 'src')).filter((f) => /INSERT INTO class_enrollments/.test(code(f))).map(rel);
    expect(writers).toEqual(['src/services/institution.service.ts']);
  });
});
