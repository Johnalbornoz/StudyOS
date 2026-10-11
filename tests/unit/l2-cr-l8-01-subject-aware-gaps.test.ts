/**
 * CR-L8-01 (assessment side, L2) -- subject-aware exam-gap aggregates.
 *
 * The exam-gaps service gains `canonicalSubjectIds`: when given, every aggregate is built only from gap
 * objectives with a published concept of those canonical subjects, and it fails closed. Authorization (WHO may
 * ask for which subject) is the caller's; nothing here reads an actor, a role or a class.
 */
import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: unknown[]) => query(...args) } }));

import { aggregateGapRows, examGapsFor, scopeGapRowsToSubjects, subjectScopeOf, type GapRow } from '@/lib/exam-core/exam-gaps.service';

const MATH = '11111111-1111-4111-8111-111111111111';
const READING = '22222222-2222-4222-8222-222222222222';
const SCIENCE = '33333333-3333-4333-8333-333333333333';
const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const row = (over: Partial<GapRow>): GapRow => ({ student_id: ANA, family: 'PAA', exam: 'PAA 2021', objective_id: 'obj-math-1', code: 'paa.mat.algebra', description: 'Álgebra', domain: 'Matemáticas', canonical_concept_id: 'c-linear', canonical_subject_id: MATH, concept_name: 'Ecuaciones lineales', student_concept_id: null, ...over });

/** One multi-subject exam: Ana has a maths gap, a reading gap, an objective with no concept mapping, and one objective mapped to concepts of two subjects. Bea has a reading gap only. */
const ROWS: GapRow[] = [
  row({}),
  row({ objective_id: 'obj-read-1', code: 'paa.lect.inferencia', description: 'Inferencia', domain: 'Lectura', canonical_concept_id: 'c-inference', canonical_subject_id: READING, concept_name: 'Inferencia textual' }),
  row({ objective_id: 'obj-unmapped', code: 'paa.x', description: 'Sin mapa', domain: 'Lectura', canonical_concept_id: null, canonical_subject_id: null, concept_name: null }),
  row({ objective_id: 'obj-data', code: 'paa.mat.datos', description: 'Datos', domain: 'Matemáticas', canonical_concept_id: 'c-data-math', canonical_subject_id: MATH, concept_name: 'Representación de datos' }),
  row({ objective_id: 'obj-data', code: 'paa.mat.datos', description: 'Datos', domain: 'Matemáticas', canonical_concept_id: 'c-data-reading', canonical_subject_id: READING, concept_name: 'Información cuantitativa en textos' }),
  row({ student_id: BEA, objective_id: 'obj-read-1', code: 'paa.lect.inferencia', description: 'Inferencia', domain: 'Lectura', canonical_concept_id: 'c-inference', canonical_subject_id: READING, concept_name: 'Inferencia textual' }),
];

beforeEach(() => {
  query.mockReset();
  // The fake database ignores the scope parameter on purpose: the tests below then prove the service's own
  // filter is sufficient, not only the SQL predicate.
  query.mockResolvedValue({ rows: ROWS });
});

describe('CR-L8-01: subject-aware exam-gap aggregates', () => {
  it('matching subject aggregate => returned', async () => {
    const g = await examGapsFor([ANA, BEA], { includePerStudent: true, canonicalSubjectIds: [MATH] });
    expect(g.byObjective.map((o) => o.code).sort()).toEqual(['paa.mat.algebra', 'paa.mat.datos']);
    expect(g.byDomain).toEqual([{ family: 'PAA', exam: 'PAA 2021', domain: 'Matemáticas', students: 1 }]);
    expect(g.byConcept.map((c) => c.canonicalConceptId).sort()).toEqual(['c-data-math', 'c-linear']);
    expect(g.studentsWithResults).toBe(1);
    expect(g.perStudent).toEqual([{ studentId: ANA, gaps: 2, concepts: [{ canonicalConceptId: 'c-linear', name: 'Ecuaciones lineales', studentConceptId: null }, { canonicalConceptId: 'c-data-math', name: 'Representación de datos', studentConceptId: null }] }]);
  });

  it('different subject aggregate => excluded', async () => {
    const g = await examGapsFor([ANA, BEA], { includePerStudent: true, canonicalSubjectIds: [MATH] });
    const text = JSON.stringify(g);
    for (const leaked of ['Lectura', 'Inferencia', 'paa.lect.inferencia', 'c-inference', 'c-data-reading', 'Información cuantitativa', BEA]) expect(text).not.toContain(leaked);
    // a subject nobody has gaps in returns nothing, not everything
    expect(await examGapsFor([ANA, BEA], { includePerStudent: true, canonicalSubjectIds: [SCIENCE] })).toEqual({ studentsWithResults: 0, byDomain: [], byObjective: [], byConcept: [], perStudent: [] });
  });

  it('multi-subject assessment => only the authorized subject slice', async () => {
    const reading = await examGapsFor([ANA, BEA], { includePerStudent: true, canonicalSubjectIds: [READING] });
    expect(reading.byDomain).toEqual(expect.arrayContaining([{ family: 'PAA', exam: 'PAA 2021', domain: 'Lectura', students: 2 }]));
    expect(reading.byObjective.find((o) => o.code === 'paa.lect.inferencia')?.students).toBe(2);
    // the objective mapped to concepts of two subjects contributes ONLY its in-subject concept
    expect(reading.byConcept.map((c) => c.canonicalConceptId).sort()).toEqual(['c-data-reading', 'c-inference']);
    expect(JSON.stringify(reading)).not.toContain('c-data-math');
    expect(JSON.stringify(reading)).not.toContain('paa.mat.algebra');
    // two subjects asked together give the union of the two slices, still without the unmapped objective
    const both = await examGapsFor([ANA, BEA], { includePerStudent: false, canonicalSubjectIds: [MATH, READING] });
    expect(both.byObjective.map((o) => o.code).sort()).toEqual(['paa.lect.inferencia', 'paa.mat.algebra', 'paa.mat.datos']);
    expect(both.perStudent).toEqual([]);
    expect(both.byConcept.every((c) => c.studentIds.length === 0)).toBe(true);
  });

  it('no safe subject mapping => fail closed / omit', async () => {
    // an objective with no published concept mapping is omitted from a scoped answer
    for (const subject of [MATH, READING]) expect(JSON.stringify(await examGapsFor([ANA], { includePerStudent: true, canonicalSubjectIds: [subject] }))).not.toContain('paa.x');
    // a scope that is present but empty, or holds no valid id, matches nothing and does not reach the database
    query.mockClear();
    for (const bad of [[], ['not-a-uuid'], ['', ' '], [null as unknown as string]]) {
      expect(await examGapsFor([ANA, BEA], { includePerStudent: true, canonicalSubjectIds: bad })).toEqual({ studentsWithResults: 0, byDomain: [], byObjective: [], byConcept: [], perStudent: [] });
    }
    expect(query).not.toHaveBeenCalled();
    // a row whose concept has no subject is not admitted either
    expect(scopeGapRowsToSubjects([row({ canonical_subject_id: null })], [MATH])).toEqual([]);
    expect(subjectScopeOf(undefined)).toBeNull();
    expect(subjectScopeOf([MATH.toUpperCase(), MATH, 'x'])).toEqual([MATH]);
  });

  it('existing unscoped behaviour stays as it was (institution / internal callers)', async () => {
    const g = await examGapsFor([ANA, BEA], { includePerStudent: true });
    expect(g.byObjective.map((o) => o.code).sort()).toEqual(['paa.lect.inferencia', 'paa.mat.algebra', 'paa.mat.datos', 'paa.x']);
    expect(g.byDomain.map((d) => d.domain).sort()).toEqual(['Lectura', 'Matemáticas']);
    expect(g.studentsWithResults).toBe(2);
    expect(g.perStudent.find((p) => p.studentId === ANA)?.gaps).toBe(4);
    expect(g).toEqual(aggregateGapRows(ROWS, true));
    // unscoped: the scope parameter is NULL, so the SQL predicate is a no-op
    expect(query.mock.calls[0][1]).toEqual([[ANA, BEA], null, null]);
  });

  it('the scope reaches the query as a parameter, with the same predicate the service applies', async () => {
    await examGapsFor([ANA], { includePerStudent: false, families: ['PAA'], canonicalSubjectIds: [MATH] });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([[ANA], ['PAA'], [MATH]]);
    expect(sql).toContain('cc.canonical_subject_id = ANY($3::uuid[])');
    expect(sql).toContain('$3::uuid[] IS NULL OR');
    expect(sql).toContain("m.status = 'PUBLISHED'");
  });

  it('assessment semantics only: the service reads no actor, role or class, and no Student set is widened', async () => {
    const src = readFileSync('src/lib/exam-core/exam-gaps.service.ts', 'utf8');
    expect(src).not.toMatch(/@\/lib\/authorization|user_roles|class_enrollments|institution_memberships|actorUserId/);
    await examGapsFor([ANA], { includePerStudent: true, canonicalSubjectIds: [READING] });
    expect((query.mock.calls[0][1] as unknown[])[0]).toEqual([ANA]);
    expect(await examGapsFor([], { includePerStudent: true, canonicalSubjectIds: [MATH] })).toEqual({ studentsWithResults: 0, byDomain: [], byObjective: [], byConcept: [], perStudent: [] });
  });
});
