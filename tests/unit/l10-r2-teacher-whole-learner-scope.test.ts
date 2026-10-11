/**
 * L10-R2 -- TEACHER WHOLE-LEARNER SCOPE (Orchestrator ruling).
 *
 * Teacher learner data requires ALL of: an authorized Student, an authorized Class, an authorized Subject.
 * A Teacher must not receive another subject's academic data merely because the learner belongs to the class.
 * A payload that cannot be sliced by subject is refused to a Teacher (fail closed). Coordinator access is not
 * broadened.
 *
 * Audit result, one row per Teacher-reachable learner-wide surface:
 *
 *   GET /api/learners/[id]/summary        every subject of the learner            -> Teacher refused
 *   GET /api/readiness                    exam-wide readiness snapshots           -> Teacher refused
 *   GET /api/readiness/[id]               one exam-wide snapshot                  -> Teacher refused
 *   GET /api/exam-profiles                the learner's exam goals                -> Teacher refused
 *   POST /api/simulation/eligibility      exam-wide eligibility                   -> Teacher refused
 *   GET /api/learning/session-eligibility learner-wide                            -> authorized = false
 *   GET /api/diagnostics                  ONE concept of the learner              -> only inside the subject
 *   GET /api/diagnostics/[id]/explain     ONE diagnosis (one concept)             -> only inside the subject
 *   GET /api/teaching/interventions/[id]  one session (one concept)               -> only inside the subject
 *   GET /api/simulation/attempts/[id]     exam-wide attempt state and scores      -> Teacher refused
 *   GET /api/simulation/attempts/[id]/result  per-objective slice                 -> only inside the subject
 *   getTeacherStudentOverview             learner-wide counts + readiness         -> counts inside the subject; readiness withheld
 *   getTeacherClassExamGaps               gaps / goals / AICE                     -> gaps inside the subject; goals, AICE withheld
 *
 * A small relational world stands behind the REAL guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const { w } = vi.hoisted(() => ({
  w: {
    MATHS: 'subject-maths',
    READING: 'subject-reading',
    /** actor -> how they reach the learner */
    actors: { kid: 'OWNER', mum: 'PARENT', 'maths-teacher': 'TEACHER', coordinator: 'COORDINATOR', stranger: 'NONE', 'teacher-and-parent': 'TEACHER+PARENT' } as Record<string, string>,
    /** the canonical subjects a teacher holds for this learner */
    teacherSubjects: { 'maths-teacher': ['subject-maths'], 'teacher-and-parent': ['subject-maths'] } as Record<string, string[]>,
    /** learner concept -> canonical subject (MATCHED mapping), null = no confirmed counterpart */
    concepts: { 'lc-math': 'subject-maths', 'lc-read': 'subject-reading', 'lc-unmapped': null } as Record<string, string | null>,
    mastery: ['lc-math', 'lc-read', 'lc-read2'],
    debts: ['lc-math', 'lc-read'],
    sql: [] as string[],
  },
}));

vi.mock('@/lib/db', () => {
  const has = (actor: string, r: string) => (w.actors[actor] ?? 'NONE').split('+').includes(r);
  const query = async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    w.sql.push(s);
    const yes = (ok: boolean) => ({ rows: ok ? [{ ok: 1 }] : [] });
    if (/^SELECT DISTINCT c\.canonical_subject_id FROM teacher_assignments ta/.test(s)) return { rows: (has(p[0], 'TEACHER') ? w.teacherSubjects[p[0]] ?? [] : []).map((canonical_subject_id) => ({ canonical_subject_id })) };
    if (/FROM concept_catalog_mapping ccm JOIN canonical_concepts cc ON cc\.id = ccm\.canonical_concept_id WHERE ccm\.learner_concept_id = \$1/.test(s)) return { rows: w.concepts[p[0]] ? [{ canonical_subject_id: w.concepts[p[0]] }] : [] };
    if (/^SELECT ccm\.learner_concept_id FROM concept_catalog_mapping ccm/.test(s)) return { rows: Object.entries(w.concepts).filter(([, subj]) => subj && (p[1] as string[]).includes(subj)).map(([learner_concept_id]) => ({ learner_concept_id })) };
    // relationship checks of resolveLearnerReadScope
    if (/FROM parent_student_relationships psr/.test(s)) return yes(has(p[0], 'PARENT'));
    if (/FROM teacher_assignments ta JOIN institution_memberships im .* JOIN class_enrollments ce/.test(s)) return yes(has(p[0], 'TEACHER'));
    if (/FROM institution_memberships im JOIN institutions i .* membership_role = 'INSTITUTION_ADMIN'/.test(s)) return yes(has(p[0], 'COORDINATOR'));
    if (/^SELECT 1 FROM students s JOIN users u ON/.test(s)) return yes(has(p[1], 'OWNER'));
    // teacher overview
    if (/^SELECT name, email FROM students WHERE id = \$1/.test(s)) return { rows: [{ name: 'Kid', email: null }] };
    if (/^SELECT count\(\*\)::int AS n FROM mastery_records WHERE student_id = \$1 AND concept_id = ANY/.test(s)) return { rows: [{ n: w.mastery.filter((c) => (p[1] as string[]).includes(c)).length }] };
    if (/^SELECT count\(\*\)::int AS n FROM learning_debt ld JOIN subjects s/.test(s)) return { rows: [{ n: w.debts.filter((c) => (p[1] as string[]).includes(c)).length }] };
    if (/^SELECT MAX\("timestamp"\) AS last_at FROM learning_evidence WHERE student_id = \$1 AND concept_id = ANY/.test(s)) return { rows: [{ last_at: (p[1] as string[]).includes('lc-math') ? '2026-10-10T10:00:00Z' : null }] };
    return { rows: [] };
  };
  return { db: { query, connect: vi.fn() } };
});

import { canReadLearnerRoute, teacherMayReadLearnerConcept, learnerConceptsInTeacherSubjects } from '@/lib/authorization/teacher-subject-scope';
import { getTeacherStudentOverview } from '@/lib/teacher/read-model.service';
import { LEARNER_READ_SCOPE } from '@/lib/authorization/permissions';

const LEARNER = 'learner-1';
const root = process.cwd();
const route = (r: string) => readFileSync(join(root, 'src/app/api', r, 'route.ts'), 'utf8');
const code = (text: string) => text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

beforeEach(() => {
  w.sql.length = 0;
});

describe('a learner-wide payload cannot be sliced by subject => a Teacher is refused', () => {
  it('Teacher: refused for both whole-learner permissions', async () => {
    expect(await canReadLearnerRoute('maths-teacher', LEARNER, 'LEARNER_PROGRESS_VIEW', 'DENY')).toBe(false);
    expect(await canReadLearnerRoute('maths-teacher', LEARNER, 'LEARNER_PROFILE_VIEW', 'DENY')).toBe(false);
  });

  it('the owner and an accepted Parent are unaffected', async () => {
    for (const actor of ['kid', 'mum']) {
      expect(await canReadLearnerRoute(actor, LEARNER, 'LEARNER_PROGRESS_VIEW', 'DENY')).toBe(true);
      expect(await canReadLearnerRoute(actor, LEARNER, 'LEARNER_PROFILE_VIEW', 'DENY')).toBe(true);
    }
  });

  it('a Teacher who is ALSO the learner\'s accepted Parent reads as the Parent', async () => {
    expect(await canReadLearnerRoute('teacher-and-parent', LEARNER, 'LEARNER_PROGRESS_VIEW', 'DENY')).toBe(true);
  });

  it('Coordinator access is not broadened: refused on every rule', async () => {
    expect(LEARNER_READ_SCOPE.COORDINATOR).not.toContain('LEARNER_PROGRESS_VIEW');
    expect(await canReadLearnerRoute('coordinator', LEARNER, 'LEARNER_PROGRESS_VIEW', 'DENY')).toBe(false);
    expect(await canReadLearnerRoute('coordinator', LEARNER, 'LEARNER_PROFILE_VIEW', 'DENY')).toBe(false);
    expect(await canReadLearnerRoute('coordinator', LEARNER, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: 'lc-math' })).toBe(false);
  });

  it('no relationship: refused', async () => {
    expect(await canReadLearnerRoute('stranger', LEARNER, 'LEARNER_PROGRESS_VIEW', 'DENY')).toBe(false);
    expect(await canReadLearnerRoute('stranger', LEARNER, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: 'lc-math' })).toBe(false);
  });
});

describe('a single-concept payload => a Teacher reads it only inside an authorized subject', () => {
  it('authorized class + matching subject => visible', async () => {
    expect(await canReadLearnerRoute('maths-teacher', LEARNER, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: 'lc-math' })).toBe(true);
    expect(await teacherMayReadLearnerConcept('maths-teacher', LEARNER, 'lc-math')).toBe(true);
  });
  it('authorized class + another subject of the same learner => hidden', async () => {
    expect(await canReadLearnerRoute('maths-teacher', LEARNER, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: 'lc-read' })).toBe(false);
  });
  it('a concept with no confirmed subject, or no concept at all => hidden (fail closed)', async () => {
    for (const c of ['lc-unmapped', 'lc-does-not-exist', null, undefined]) expect(await canReadLearnerRoute('maths-teacher', LEARNER, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: c })).toBe(false);
  });
  it('a teacher with no subject scope for this learner (class without a linked subject) => hidden', async () => {
    w.teacherSubjects['maths-teacher'] = [];
    expect(await canReadLearnerRoute('maths-teacher', LEARNER, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: 'lc-math' })).toBe(false);
    w.teacherSubjects['maths-teacher'] = ['subject-maths'];
  });
});

describe('every Teacher-reachable whole-learner route uses the gate, with the rule its payload calls for', () => {
  const DENY: Array<[string, RegExp]> = [
    ['learners/[id]/summary', /canReadLearnerRoute\(actor\.id, learnerId, 'LEARNER_PROGRESS_VIEW', 'DENY'\)/],
    ['readiness', /canReadLearnerRoute\(actor\.id, studentId, 'LEARNER_PROGRESS_VIEW', 'DENY'\)/],
    ['readiness/[id]', /canReadLearnerRoute\(actor\.id, snapshot\.studentId, 'LEARNER_PROGRESS_VIEW', 'DENY'\)/],
    ['exam-profiles', /canReadLearnerRoute\(actor\.id, studentId, 'LEARNER_PROFILE_VIEW', 'DENY'\)/],
    ['simulation/eligibility', /canReadLearnerRoute\(actor\.id, validated\.studentId, 'LEARNER_PROGRESS_VIEW', 'DENY'\)/],
    ['learning/session-eligibility', /canReadLearnerRoute\(actor\.id, studentId, 'LEARNER_PROGRESS_VIEW', 'DENY'\)/],
  ];
  for (const [r, pattern] of DENY) it(`${r}: learner-wide => 'DENY' for a Teacher`, () => expect(code(route(r))).toMatch(pattern));

  it('diagnostics: scoped by the requested concept', () => {
    expect(code(route('diagnostics'))).toMatch(/canReadLearnerRoute\(actor\.id, studentId, 'LEARNER_PROGRESS_VIEW', \{ learnerConceptId: conceptId \}\)/);
  });
  it('diagnostics/[id]/explain: scoped by the diagnosis\' own concept', () => {
    expect(code(route('diagnostics/[id]/explain'))).toMatch(/canReadLearnerRoute\(actor\.id, diagnosis\.studentId, 'LEARNER_PROGRESS_VIEW', \{ learnerConceptId: diagnosis\.conceptId \}\)/);
  });
  it('teaching/interventions/[id]: scoped by the session\'s concept; a Teacher outside the subject is refused', () => {
    expect(code(route('teaching/interventions/[id]'))).toMatch(/teacherMayReadLearnerConcept\(actor\.id, session\.studentId, diagnosis\?\.conceptId \?\? null\)/);
    expect(code(route('teaching/interventions/[id]'))).toMatch(/if \(teacherOnly && !teacherInSubject\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}, \{ status: 403 \}\);/);
  });
  it('simulation/attempts/[id]: a Teacher is refused (exam-wide); the result route serves only the subject slice', () => {
    expect(code(route('simulation/attempts/[id]'))).toMatch(/if \(!owner && !summaryReader\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}/);
    expect(code(route('simulation/attempts/[id]/result'))).toMatch(/resolveResultViewContext\(/);
  });

  it('NO route under src/app/api still grants a learner-wide READ through the unsliced check', () => {
    // `canAccessLearner(..., 'LEARNER_PROGRESS_VIEW' | 'LEARNER_PROFILE_VIEW')` admits any Teacher of any class of the learner.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : n === 'route.ts' ? [p] : []; });
    const offenders = walk(join(root, 'src/app/api')).filter((f) => /canAccessLearner\([^)]*'LEARNER_(PROGRESS|PROFILE)_VIEW'\)/.test(code(readFileSync(f, 'utf8')))).map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it('the remaining canAccessLearner calls are owner-only (acting in the learner\'s own work)', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : n === 'route.ts' ? [p] : []; });
    const permissions = new Set<string>();
    for (const f of walk(join(root, 'src/app/api'))) for (const m of code(readFileSync(f, 'utf8')).matchAll(/canAccessLearner\([^)]*'(LEARNER_[A-Z_]+)'\)/g)) permissions.add(m[1]);
    expect([...permissions]).toEqual(['LEARNER_INTERVENTION_CREATE']);
    expect(LEARNER_READ_SCOPE.TEACHER).not.toContain('LEARNER_INTERVENTION_CREATE');
    expect(LEARNER_READ_SCOPE.PARENT).not.toContain('LEARNER_INTERVENTION_CREATE');
  });

  it('the gate module stays outside the exam core (and so outside the AI import graph)', () => {
    expect(readFileSync(join(root, 'src/lib/authorization/teacher-subject-scope.ts'), 'utf8')).not.toMatch(/from '@\/lib\/exam-core|from '@\/services/);
  });
});

describe('Teacher read model: the per-learner overview is cut to the authorized subject', () => {
  beforeEach(() => {
    w.actors['maths-teacher'] = 'TEACHER';
    w.teacherSubjects['maths-teacher'] = ['subject-maths'];
  });

  it('counts only the learner\'s concepts inside the teacher\'s subject (1 of 3 mastery records, 1 of 2 debts)', async () => {
    const overview = await getTeacherStudentOverview('maths-teacher', LEARNER);
    expect([overview.conceptsWithEvidence, overview.areasNeedingAttentionCount]).toEqual([1, 1]);
    expect(overview.lastActivityAt).toBe('2026-10-10T10:00:00Z');
    expect(overview.subjectScope).toEqual({ canonicalSubjectIds: ['subject-maths'] });
  });

  it('exam-wide readiness is withheld, and no readiness or exam-profile table is read', async () => {
    const overview = await getTeacherStudentOverview('maths-teacher', LEARNER);
    expect(overview.latestReadinessStatus).toBe('WITHHELD');
    expect(w.sql.some((s) => /student_exam_profiles|readiness_snapshots/.test(s))).toBe(false);
  });

  it('no learner-wide aggregate is ever issued: every count is filtered by the in-subject concept set', async () => {
    await getTeacherStudentOverview('maths-teacher', LEARNER);
    for (const s of w.sql.filter((q) => /FROM (mastery_records|learning_debt|learning_evidence)/.test(q))) expect(s).toMatch(/concept_id = ANY\(\$2::uuid\[\]\)/);
  });

  it('a teacher with no subject scope for the learner gets zeros, and no aggregate is read at all', async () => {
    w.teacherSubjects['maths-teacher'] = [];
    const overview = await getTeacherStudentOverview('maths-teacher', LEARNER);
    expect([overview.conceptsWithEvidence, overview.areasNeedingAttentionCount, overview.lastActivityAt, overview.latestReadinessStatus]).toEqual([0, 0, null, 'WITHHELD']);
    expect(w.sql.some((s) => /FROM (mastery_records|learning_debt|learning_evidence)/.test(s))).toBe(false);
  });

  it('someone who is not the learner\'s teacher is refused before anything is read', async () => {
    await expect(getTeacherStudentOverview('coordinator', LEARNER)).rejects.toThrow(/not authorized/);
    await expect(getTeacherStudentOverview('mum', LEARNER)).rejects.toThrow(/not authorized/);
    expect(w.sql.some((s) => /FROM (mastery_records|learning_debt|learning_evidence|students WHERE)/.test(s))).toBe(false);
  });

  it('learnerConceptsInTeacherSubjects uses MATCHED mappings of THIS learner\'s own concepts only', async () => {
    const scope = await learnerConceptsInTeacherSubjects('maths-teacher', LEARNER);
    expect([...scope.conceptIds]).toEqual(['lc-math']);
    const sql = w.sql.find((s) => s.startsWith('SELECT ccm.learner_concept_id'))!;
    expect(sql).toMatch(/s\.student_id = \$1 AND ccm\.status = 'MATCHED' AND cc\.canonical_subject_id = ANY\(\$2::uuid\[\]\)/);
  });
});
