/**
 * Track A -- recommendations: exam gaps (kept even when in plan), class plan,
 * institution REQUIRED (never auto-added), prerequisites of what the learner
 * is working on (non-blocking; skipped once demonstrated) and the next
 * concepts of the curriculum sequence (max 3 per subject, prerequisites met).
 * One item per concept with every reason, highest priority first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
const planMock = vi.fn();
vi.mock('@/lib/learning-plan/personal-plan.service', () => ({ getPersonalPlan: (...a: any[]) => planMock(...a) }));
const examRecsMock = vi.fn();
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ listOpenExamRecommendations: (...a: any[]) => examRecsMock(...a) }));
const curriculumMock = vi.fn();
vi.mock('@/lib/learning-plan/curriculum.service', () => ({
  resolveCurriculumContext: vi.fn(async () => ({ context: null })),
  getBaseCurriculum: (...a: any[]) => curriculumMock(...a),
  studentCatalogSubjects: vi.fn(async () => [{ subjectId: 'sub', name: 'Mathematics', catalogKey: 'mathematics' }]),
  catalogKeyOf: vi.fn(() => 'mathematics'),
}));
const classCurriculumMock = vi.fn();
vi.mock('@/lib/learning-plan/institution-curriculum.service', () => ({ curriculumForClass: (...a: any[]) => classCurriculumMock(...a) }));
vi.mock('@/lib/learning-plan/labels', () => ({ canonicalConceptLabels: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `L-${id}`]))) }));

import { getStudentRecommendations } from '@/lib/learning-plan/recommendations.service';

const entry = (id: string, stage: string | null, label = `L-${id}`) => ({ canonicalConceptId: id, learnerConceptId: `lc-${id}`, label, subjectName: 'Mathematics', planStatus: 'IN_PLAN', stage });
function world(opts: { entries?: any[]; prereqs?: Array<[string, string]>; sequence?: Array<{ id: string; prereqs?: string[] }>; classes?: boolean; classPlan?: string[]; required?: string[]; examRecs?: Array<{ id: string; canonicalConceptId: string }> }) {
  planMock.mockResolvedValue({ entries: opts.entries ?? [], ownConcepts: [] });
  examRecsMock.mockResolvedValue(opts.examRecs ?? []);
  curriculumMock.mockResolvedValue({ concepts: (opts.sequence ?? []).map((c) => ({ canonicalConceptId: c.id, label: `L-${c.id}`, prerequisiteIds: c.prereqs ?? [] })), areas: [] });
  classCurriculumMock.mockResolvedValue(opts.required ? { curriculumId: 'cur', classifications: new Map(opts.required.map((id) => [id, 'REQUIRED'])) } : null);
  dbQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM class_enrollments ce JOIN classes')) return { rows: opts.classes ? [{ id: 'k1', name: 'Math 11', institution_name: 'ALBO' }] : [] };
    if (sql.includes('FROM class_plan_concepts')) return { rows: (opts.classPlan ?? []).map((id) => ({ canonical_concept_id: id, target_date: '2026-11-15' })) };
    if (sql.includes('FROM canonical_concept_prerequisites')) return { rows: (opts.prereqs ?? []).map(([c, p]) => ({ concept_id: c, prerequisite_concept_id: p })) };
    return { rows: [] };
  });
}

beforeEach(() => {
  dbQueryMock.mockReset();
  planMock.mockReset();
  examRecsMock.mockReset();
  curriculumMock.mockReset();
  classCurriculumMock.mockReset();
});

describe('getStudentRecommendations', () => {
  it('prerequisite of a concept being worked on is recommended (non-blocking), with the concept it unlocks', async () => {
    world({ entries: [entry('derivatives', 'LEARN', 'Derivación')], prereqs: [['derivatives', 'functions']] });
    const recs = await getStudentRecommendations('s1', 'es');
    expect(recs.find((r) => r.canonicalConceptId === 'functions')?.reasons).toEqual([{ type: 'PREREQUISITE', detail: 'Derivación' }]);
  });

  it('a prerequisite already demonstrated, or a concept already demonstrated, produces no prerequisite advice', async () => {
    world({ entries: [entry('derivatives', 'LEARN'), entry('functions', 'PROVE')], prereqs: [['derivatives', 'functions']] });
    expect((await getStudentRecommendations('s1', 'es')).some((r) => r.reasons.some((x) => x.type === 'PREREQUISITE'))).toBe(false);
    world({ entries: [entry('derivatives', 'CONSOLIDATED')], prereqs: [['derivatives', 'functions']] });
    expect((await getStudentRecommendations('s1', 'es')).some((r) => r.reasons.some((x) => x.type === 'PREREQUISITE'))).toBe(false);
  });

  it('next concepts: the first 3 of the sequence not in plan whose prerequisites are demonstrated, after the last one in plan', async () => {
    world({ entries: [entry('a', 'PRACTICE')], sequence: [{ id: 'a' }, { id: 'b' }, { id: 'c', prereqs: ['b'] }, { id: 'd' }, { id: 'e' }, { id: 'f' }] });
    const next = (await getStudentRecommendations('s1', 'es')).filter((r) => r.reasons[0].type === 'NEXT_CONCEPT');
    expect(next.map((r) => r.canonicalConceptId).sort()).toEqual(['b', 'd', 'e']);
    expect(next.find((r) => r.canonicalConceptId === 'b')?.reasons[0].detail).toBe('L-a');
  });

  it('in-plan concepts are never recommended to add again; exam gaps stay visible as "already working on it"', async () => {
    world({ entries: [entry('a', 'LEARN')], sequence: [{ id: 'a' }], classes: true, classPlan: ['a'], required: ['a'], examRecs: [{ id: 'r1', canonicalConceptId: 'a' }] });
    const recs = await getStudentRecommendations('s1', 'es');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ canonicalConceptId: 'a', inPlan: true, learnerConceptId: 'lc-a' });
    expect(recs[0].reasons.map((r) => r.type)).toEqual(['EXAM_GAP']);
  });

  it('one item per concept with every reason, ordered by priority (class plan before required before next)', async () => {
    world({ classes: true, classPlan: ['x'], required: ['x', 'y'], sequence: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] });
    const recs = await getStudentRecommendations('s1', 'es');
    expect(recs.map((r) => r.canonicalConceptId)).toEqual(['x', 'y', 'z']);
    expect(recs[0].reasons.map((r) => r.type)).toEqual(['CLASS_PLAN', 'INSTITUTION_REQUIRED', 'NEXT_CONCEPT']);
    expect(recs[0].reasons[0]).toMatchObject({ classId: 'k1', detail: 'Math 11', targetDate: '2026-11-15' });
    expect(recs[1].reasons[0]).toMatchObject({ type: 'INSTITUTION_REQUIRED', detail: 'ALBO' });
  });
});
