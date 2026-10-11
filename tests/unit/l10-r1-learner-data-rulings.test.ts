/**
 * L10-R1 -- D-1 FINAL RULINGS (Orchestrator, 2026-10-11).
 *
 *  TEACHER item-level detail: only for a Student of an authorized class, data inside the authorized
 *    academic subject, and a submitted attempt. Never a draft. What cannot be attributed to the subject
 *    is withheld.
 *  PARENT / COORDINATOR: no raw item-level answers.
 *  RELEASED: a Parent or Coordinator sees a result only when that same result is visible to the Student
 *    under the assessment's publication rules -- not "scored and not invalidated".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({ query: vi.fn(), deleted: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.query(...a) } }));
vi.mock('@/lib/exam-core/history.service', () => ({ isAttemptDeletedFromHistory: (...a: any[]) => h.deleted(...a) }));

import { shapeAttemptResultViewForScope, type ResultViewContext } from '@/lib/authorization/learner-data-scope';
import { isAttemptResultVisibleToStudent, resolveResultViewContext, teacherMayReadLearnerConcept, canonicalConceptsInSubjects } from '@/lib/authorization/learner-result-scope';
import { LEARNER_READ_SCOPE } from '@/lib/authorization/permissions';
import { teacherSubjectScopeForLearner } from '@/lib/authorization';

const MATHS = 'subject-maths';
const READING = 'subject-reading';
const scope = (...relationships: Array<keyof typeof LEARNER_READ_SCOPE>) => ({ relationships, permissions: [...new Set(relationships.flatMap((r) => [...LEARNER_READ_SCOPE[r]]))] });
const ctx = (over: Partial<ResultViewContext> = {}): ResultViewContext => ({ studentVisible: true, submitted: true, teacherConceptIds: new Set(), teacherSubjectIds: [], ...over });
const view = (status: 'SCORED' | 'INVALIDATED' | null = 'SCORED') => ({
  result: status ? { status, finalScore: 640, sectionResults: [{ key: 'math', name: 'Matemáticas' }, { key: 'read', name: 'Lectura' }] } : null,
  review: [{ question: 'Q-math', yourAnswer: 'A1', correctAnswer: 'K1' }, { question: 'Q-read', yourAnswer: 'A2', correctAnswer: 'K2' }],
  reviewPolicy: 'FULL' as const,
  objectives: [
    { learningObjectiveId: 'lo-math', concepts: [{ canonicalConceptId: 'c-math' }] },
    { learningObjectiveId: 'lo-read', concepts: [{ canonicalConceptId: 'c-read' }] },
    { learningObjectiveId: 'lo-both', concepts: [{ canonicalConceptId: 'c-math' }, { canonicalConceptId: 'c-read' }] },
    { learningObjectiveId: 'lo-unmapped', concepts: [] },
  ],
});

beforeEach(() => {
  h.query.mockReset().mockResolvedValue({ rows: [] });
  h.deleted.mockReset().mockResolvedValue(false);
});

describe('RELEASED = visible to the Student, under the assessment\'s own rules', () => {
  it('a submitted attempt the Student has not removed is visible -- whether its result is SCORED or INVALIDATED', async () => {
    expect(await isAttemptResultVisibleToStudent({ id: 'a1', status: 'COMPLETED' })).toBe(true);
    for (const status of ['SCORED', 'INVALIDATED'] as const) {
      const shaped = shapeAttemptResultViewForScope(view(status), scope('PARENT'), ctx())!;
      expect((shaped.result as any).status).toBe(status); // the same result the Student sees, with its own status
    }
  });

  it('an attempt that is not submitted is not visible (the Student has no result page for it)', async () => {
    for (const status of ['IN_PROGRESS', 'PAUSED', 'NOT_STARTED', 'ABANDONED']) expect(await isAttemptResultVisibleToStudent({ id: 'a1', status })).toBe(false);
    expect(h.deleted).not.toHaveBeenCalled();
  });

  it('an attempt the Student removed from their history is not visible to them -- so not to a Parent or Coordinator either, even though it is SCORED', async () => {
    h.deleted.mockResolvedValue(true);
    expect(await isAttemptResultVisibleToStudent({ id: 'a1', status: 'COMPLETED' })).toBe(false);
    const context = await resolveResultViewContext({ actorUserId: 'parent', scope: scope('PARENT'), attempt: { id: 'a1', status: 'COMPLETED', studentId: 's1' }, objectiveConceptIds: [] });
    expect(context.studentVisible).toBe(false);
    for (const r of ['PARENT', 'COORDINATOR', 'TEACHER'] as const) expect(shapeAttemptResultViewForScope(view('SCORED'), scope(r), { ...context, teacherConceptIds: new Set(['c-math']) })).toBeNull();
  });

  it('fails closed when visibility cannot be read', async () => {
    h.deleted.mockRejectedValue(new Error('db down'));
    expect(await isAttemptResultVisibleToStudent({ id: 'a1', status: 'COMPLETED' })).toBe(false);
  });

  it('the owner is never subject to it (their own data, in any state)', async () => {
    h.deleted.mockResolvedValue(true);
    const context = await resolveResultViewContext({ actorUserId: 'student', scope: scope('OWNER'), attempt: { id: 'a1', status: 'IN_PROGRESS', studentId: 's1' }, objectiveConceptIds: [] });
    const v = view(null);
    expect(shapeAttemptResultViewForScope(v, scope('OWNER'), context)).toBe(v);
    expect(h.deleted).not.toHaveBeenCalled();
  });

  it('pinned to the Student result page: the two conditions it applies before rendering are the two this predicate applies', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/dashboard/exam-prep/attempt/[attemptId]/result/page.tsx'), 'utf8');
    expect(page).toMatch(/if \(attempt\.status !== 'COMPLETED'\) redirect\(/);
    expect(page).toMatch(/if \(instance\?\.status === 'DELETED'\) notFound\(\);/);
    expect(page).toMatch(/if \(await isAttemptDeletedFromHistory\(attempt\.id\)\) notFound\(\);/);
    // ...and it does NOT hide an INVALIDATED result from the Student (it flags it), nor gate on scoring:
    expect(page).toMatch(/result\?\.status === 'INVALIDATED' && <InlineAlert/);
    expect(page).not.toMatch(/status !== 'SCORED'\) (notFound|redirect)/);
    const history = readFileSync(join(process.cwd(), 'src/lib/exam-core/history.service.ts'), 'utf8');
    expect(history).toMatch(/sa\.hidden_at IS NOT NULL OR EXISTS \(SELECT 1 FROM exam_instances i WHERE i\.simulation_attempt_id = sa\.id AND i\.status = 'DELETED'\)/);
  });
});

describe('PARENT and COORDINATOR: a summary, never raw item-level answers', () => {
  it('the item review is removed and the policy reads SCORES_ONLY', () => {
    for (const r of ['PARENT', 'COORDINATOR'] as const) {
      const shaped = shapeAttemptResultViewForScope(view(), scope(r), ctx())!;
      expect(shaped.review).toBeNull();
      expect(shaped.reviewPolicy).toBe('SCORES_ONLY');
      expect(JSON.stringify(shaped)).not.toMatch(/yourAnswer|correctAnswer|Q-math|Q-read/);
      expect((shaped.result as any).finalScore).toBe(640);
    }
  });
  it('nothing before a result exists, and nothing for a draft', () => {
    expect(shapeAttemptResultViewForScope(view(null), scope('PARENT'), ctx())).toBeNull();
    expect(shapeAttemptResultViewForScope(view(), scope('PARENT'), ctx({ submitted: false }))).toBeNull();
    expect(shapeAttemptResultViewForScope(view(), scope('COORDINATOR'), ctx({ studentVisible: false }))).toBeNull();
  });
});

describe('TEACHER: only the authorized subject slice of a submitted attempt', () => {
  const maths = ctx({ teacherConceptIds: new Set(['c-math']), teacherSubjectIds: [MATHS] });

  it('a Mathematics teacher receives the Mathematics objectives of a multi-subject exam, and nothing of Reading', () => {
    const shaped = shapeAttemptResultViewForScope(view(), scope('TEACHER'), maths)!;
    expect(shaped.objectives.map((o: any) => o.learningObjectiveId)).toEqual(['lo-math', 'lo-both']);
    expect(shaped.objectives.find((o: any) => o.learningObjectiveId === 'lo-both')!.concepts).toEqual([{ canonicalConceptId: 'c-math' }]);
    expect(JSON.stringify(shaped)).not.toMatch(/c-read|lo-read|Lectura|Q-read|lo-unmapped/);
  });

  it('what cannot be attributed to the subject is withheld: exam-wide scores and the item review', () => {
    const shaped = shapeAttemptResultViewForScope(view(), scope('TEACHER'), maths)!;
    expect(shaped.result).toBeNull();
    expect(shaped.review).toBeNull();
    expect(shaped.subjectScope).toEqual({ canonicalSubjectIds: [MATHS], scores: 'WITHHELD', itemReview: 'WITHHELD' });
    expect(JSON.stringify(shaped)).not.toMatch(/yourAnswer|correctAnswer|finalScore|Q-math/);
  });

  it('a teacher with no subject scope for this learner, or an attempt with nothing in their subject, receives nothing', () => {
    expect(shapeAttemptResultViewForScope(view(), scope('TEACHER'), ctx())).toBeNull();
    expect(shapeAttemptResultViewForScope(view(), scope('TEACHER'), ctx({ teacherConceptIds: new Set(['c-physics']), teacherSubjectIds: ['subject-physics'] }))).toBeNull();
  });

  it('never a draft or in-progress attempt, and never an attempt hidden from the Student', () => {
    expect(shapeAttemptResultViewForScope(view(), scope('TEACHER'), { ...maths, submitted: false })).toBeNull();
    expect(shapeAttemptResultViewForScope(view(null), scope('TEACHER'), maths)).toBeNull();
    expect(shapeAttemptResultViewForScope(view(), scope('TEACHER'), { ...maths, studentVisible: false })).toBeNull();
  });

  it('the teacher context is built from the classes the teacher is authorized for with THIS learner', async () => {
    h.query.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ');
      if (/SELECT DISTINCT c\.canonical_subject_id FROM teacher_assignments ta/.test(s)) return { rows: [{ canonical_subject_id: MATHS }] };
      if (/FROM canonical_concepts WHERE id = ANY\(\$1::uuid\[\]\) AND canonical_subject_id = ANY\(\$2::uuid\[\]\)/.test(s)) return { rows: [{ id: 'c-math' }] };
      return { rows: [] };
    });
    const context = await resolveResultViewContext({ actorUserId: 'teacher', scope: scope('TEACHER'), attempt: { id: 'a1', status: 'COMPLETED', studentId: 's1' }, objectiveConceptIds: ['c-math', 'c-read'] });
    expect([...context.teacherConceptIds]).toEqual(['c-math']);
    expect(context.teacherSubjectIds).toEqual([MATHS]);
    const scopeSql = h.query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ')).find((s) => s.includes('SELECT DISTINCT c.canonical_subject_id'))!;
    // authorized class, authorized teacher, enrolled learner, active institution and class, a linked subject
    for (const fragment of ["im.membership_role = 'TEACHER'", "im.status = 'APPROVED'", "ta.status = 'ACTIVE'", "ce.student_id = $2 AND ce.status = 'ACTIVE'", "c.status = 'ACTIVE'", "i.status = 'ACTIVE'", 'c.canonical_subject_id IS NOT NULL', "ar.role = 'TEACHER' AND ar.status = 'ACTIVE'"]) expect(scopeSql).toContain(fragment);
  });

  it('subject scope and concept attribution fail closed', async () => {
    h.query.mockRejectedValue(new Error('db down'));
    expect(await teacherSubjectScopeForLearner('t', 's')).toEqual([]);
    expect((await canonicalConceptsInSubjects(['c-math'], [MATHS])).size).toBe(0);
    expect((await canonicalConceptsInSubjects([], [MATHS])).size).toBe(0);
    expect((await canonicalConceptsInSubjects(['c-math'], [])).size).toBe(0);
  });

  describe('item-level intervention attempts (teaching/interventions/[id])', () => {
    const world = (teacherSubjects: string[], conceptSubject: string | null) =>
      h.query.mockImplementation(async (sql: string) => {
        const s = sql.replace(/\s+/g, ' ');
        if (/SELECT DISTINCT c\.canonical_subject_id FROM teacher_assignments ta/.test(s)) return { rows: teacherSubjects.map((canonical_subject_id) => ({ canonical_subject_id })) };
        if (/FROM concept_catalog_mapping ccm JOIN canonical_concepts cc/.test(s)) return { rows: conceptSubject ? [{ canonical_subject_id: conceptSubject }] : [] };
        return { rows: [] };
      });

    it('matching subject => the teacher may read the detail', async () => {
      world([MATHS], MATHS);
      expect(await teacherMayReadLearnerConcept('t', 's', 'concept-1')).toBe(true);
    });
    it('different subject => not', async () => {
      world([MATHS], READING);
      expect(await teacherMayReadLearnerConcept('t', 's', 'concept-1')).toBe(false);
    });
    it('a concept with no confirmed canonical counterpart is in nobody\'s subject', async () => {
      world([MATHS], null);
      expect(await teacherMayReadLearnerConcept('t', 's', 'concept-1')).toBe(false);
      expect(await teacherMayReadLearnerConcept('t', 's', null)).toBe(false);
    });
    it('only MATCHED catalogue mappings count', async () => {
      world([MATHS], MATHS);
      await teacherMayReadLearnerConcept('t', 's', 'concept-1');
      expect(h.query.mock.calls.map((c) => String(c[0])).find((s) => s.includes('concept_catalog_mapping'))).toMatch(/ccm\.status = 'MATCHED'/);
    });
    it('the route refuses a teacher outside the subject and never returns attempts to a Parent', () => {
      const route = readFileSync(join(process.cwd(), 'src/app/api/teaching/interventions/[id]/route.ts'), 'utf8');
      expect(route).toMatch(/if \(teacherOnly && !teacherInSubject\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}, \{ status: 403 \}\);/);
      expect(route).toMatch(/if \(!owner && !teacherInSubject\) \{\s*return NextResponse\.json\(\{ success: true, data: \{ session, attempts: \[\]/);
    });
  });
});

describe('COORDINATOR stays off the eleven legacy whole-learner routes', () => {
  it('the two permissions those routes ask for are not in the coordinator scope', () => {
    expect(LEARNER_READ_SCOPE.COORDINATOR).not.toContain('LEARNER_PROGRESS_VIEW');
    expect(LEARNER_READ_SCOPE.COORDINATOR).not.toContain('LEARNER_PROFILE_VIEW');
    expect(LEARNER_READ_SCOPE.COORDINATOR).not.toContain('LEARNER_ASSESSMENT_DETAIL_VIEW');
  });
  it('each of the eleven still asks for one of those two (or the owner-only permission)', () => {
    const routes = ['learners/[id]/summary', 'readiness', 'readiness/[id]', 'diagnostics', 'diagnostics/[id]/explain', 'simulation/eligibility', 'exam-profiles', 'teaching/interventions/[id]', 'learning/session-eligibility'];
    for (const r of routes) {
      const src = readFileSync(join(process.cwd(), 'src/app/api', r, 'route.ts'), 'utf8');
      expect(src, r).toMatch(/'LEARNER_PROGRESS_VIEW'|'LEARNER_PROFILE_VIEW'/);
      expect(src, r).not.toMatch(/'LEARNER_GAPS_VIEW'/);
    }
    // The two attempt routes serve a Coordinator a released SUMMARY only, and say so in code.
    const attempt = readFileSync(join(process.cwd(), 'src/app/api/simulation/attempts/[id]/route.ts'), 'utf8');
    expect(attempt).toMatch(/const summaryAttempt = \{ id: attempt\.id, studentId: attempt\.studentId, status: attempt\.status \};/);
    expect(attempt).toMatch(/if \(!owner && !summaryReader\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}/);
  });
});
