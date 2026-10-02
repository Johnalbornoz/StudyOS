/**
 * Track A -- Teacher Class Progress Intelligence: pure rules (filters /
 * window, phase counts, Pareto, quadrant formula, drill-down, target-date
 * risk, retention due, exam gaps, empty state, learner without evidence,
 * recommendations) and the query layer's fixed query count (no N+1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import type { CanonicalPedagogicalDecision } from '@/lib/pedagogical-engine/types';
import {
  computeClassProgress,
  computeGaps,
  computePareto,
  computeQuadrant,
  computePhaseDistribution,
  computeTrend,
  computeTimeline,
  quadrantOf,
  retentionDue,
  weekStart,
  type ProgressInputs,
  type ProgressPair,
} from '@/lib/teacher/class-progress.compute';

const NOW = '2026-10-02T12:00:00.000Z';
const STAGES = ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'] as const;
const ANCHOR: Record<string, number> = { LEARN: 0, PRACTICE: 25, PROVE: 50, RETAIN: 75, TRANSFER: 90, CONSOLIDATED: 100 };

function decision(stage: string, opts: { q?: Partial<Record<string, string[]>>; nq?: Partial<Record<string, string[]>>; satisfied?: string[]; reinforce?: boolean; actionState?: string; next?: string; eligible?: string | null } = {}): CanonicalPedagogicalDecision {
  return {
    stage,
    currentStage: stage,
    actionState: opts.actionState ?? 'EXECUTABLE',
    nextCanonicalAction: opts.next ?? (stage === 'RETAIN' ? 'RETENTION_CHECK' : stage),
    requirements: STAGES.map((s) => ({
      stage: s,
      status: (opts.satisfied ?? []).includes(s) ? 'SATISFIED' : 'UNSATISFIED',
      qualifyingEvidenceCount: opts.q?.[s]?.length ?? 0,
      nonQualifyingEvidenceCount: opts.nq?.[s]?.length ?? 0,
      qualifyingEvidenceIds: opts.q?.[s] ?? [],
      nonQualifyingEvidenceIds: opts.nq?.[s] ?? [],
      reasonCodes: [],
      waitingUntil: null,
      satisfactionBasis: null,
    })),
    intervention: opts.reinforce ? 'REINFORCE' : null,
    nextEligibleAt: opts.eligible ?? null,
    journeyProgressPercent: ANCHOR[stage],
  } as unknown as CanonicalPedagogicalDecision;
}
const pair = (studentId: string, conceptId: string, d: CanonicalPedagogicalDecision | null, evidence: Array<[string, string]> = [], extra: Partial<ProgressPair> = {}): ProgressPair => ({
  studentId,
  conceptId,
  learnerConceptId: `lc-${studentId}-${conceptId}`,
  decision: d,
  evidence: evidence.map(([id, timestamp]) => ({ id, timestamp })),
  memory: null,
  misconception: null,
  ...extra,
});
function base(over: Partial<ProgressInputs> = {}): ProgressInputs {
  return {
    now: NOW,
    windowFrom: null,
    learners: [
      { id: 'ana', name: 'Ana' },
      { id: 'beto', name: 'Beto' },
      { id: 'cata', name: 'Cata' },
    ],
    concepts: [
      { id: 'deriv', label: 'Derivación', topicKey: 't1', topicLabel: 'Cálculo', inClassPlan: true, targetDate: '2026-10-10', period: 'T1' },
      { id: 'integ', label: 'Integración', topicKey: 't1', topicLabel: 'Cálculo', inClassPlan: true, targetDate: null, period: 'T2' },
    ],
    pairs: [],
    examGaps: [],
    assignments: [],
    examDates: [],
    ...over,
  };
}

describe('phase distribution', () => {
  it('counts every learner × concept; not in plan = NOT_STARTED; each phase lists its learners', () => {
    const input = base({ pairs: [pair('ana', 'deriv', decision('PRACTICE')), pair('beto', 'deriv', decision('PROVE')), pair('ana', 'integ', decision('LEARN'))] });
    const d = Object.fromEntries(computePhaseDistribution(input).map((p) => [p.bucket, p]));
    expect(d.NOT_STARTED.pairs).toBe(3);
    expect(d.PRACTICE.pairs).toBe(1);
    expect(d.PROVE.items.map((x) => x.name)).toEqual(['Beto']);
    expect(Object.values(d).reduce((t, p) => t + p.pairs, 0)).toBe(6);
  });
});

describe('gaps and Pareto (real signals only)', () => {
  const input = base({
    pairs: [pair('ana', 'deriv', decision('PROVE', { reinforce: true })), pair('beto', 'deriv', decision('PRACTICE'), [], { misconception: { activeCount: 2, lastSeenAt: '2026-09-30T00:00:00Z' } }), pair('cata', 'integ', decision('LEARN'))],
    examGaps: [
      { studentId: 'cata', conceptId: 'deriv', examName: 'IB AA SL', objectiveCode: '5.1', fraction: 0.2, at: '2026-09-28T00:00:00Z' },
      { studentId: 'cata', conceptId: 'integ', examName: 'IB AA SL', objectiveCode: '5.2', fraction: 0.4, at: '2026-08-01T00:00:00Z' },
      { studentId: 'outsider', conceptId: 'deriv', examName: 'IB AA SL', objectiveCode: '5.1', fraction: 0.1, at: '2026-09-28T00:00:00Z' },
    ],
  });
  it('REINFORCE, active misconception and exam gap each make a gap with its reason; learners outside the class never appear', () => {
    const gaps = computeGaps(input);
    expect(gaps.map((g) => `${g.studentId}:${g.conceptId}:${g.reasons.map((r) => r.type).join('+')}`).sort()).toEqual(['ana:deriv:REINFORCE', 'beto:deriv:MISCONCEPTION', 'cata:deriv:EXAM_GAP', 'cata:integ:EXAM_GAP']);
  });
  it('Pareto: descending affected learners with cumulative %', () => {
    const p = computePareto(computeGaps(input), input.concepts);
    expect(p.map((r) => [r.label, r.count, r.cumulativePercent])).toEqual([
      ['Derivación', 3, 75],
      ['Integración', 1, 100],
    ]);
    expect(p[0].items.map((i) => i.name)).toEqual(['Ana', 'Beto', 'Cata']);
  });
  it('the time window filters dated gaps (exam date, misconception last seen) but keeps the engine REINFORCE', () => {
    const gaps = computeGaps({ ...input, windowFrom: '2026-09-29T00:00:00Z' });
    expect(gaps.map((g) => `${g.studentId}:${g.conceptId}`).sort()).toEqual(['ana:deriv', 'beto:deriv']);
  });
});

describe('quadrant (documented formula)', () => {
  it('X = mean journey anchor over scope concepts (0 if not in plan); Y = qualifying / (qualifying + non-qualifying) PROVE/RETAIN/TRANSFER evidence', () => {
    const input = base({
      pairs: [
        pair('ana', 'deriv', decision('RETAIN', { q: { PROVE: ['e1'] }, nq: { RETAIN: ['e2'] } }), [['e1', '2026-09-01T00:00:00Z'], ['e2', '2026-09-20T00:00:00Z']]),
        pair('ana', 'integ', decision('PROVE', { q: { PROVE: ['e3'] } }), [['e3', '2026-09-21T00:00:00Z']]),
        pair('beto', 'deriv', decision('PRACTICE')),
      ],
    });
    const q = Object.fromEntries(computeQuadrant(input).map((p) => [p.studentId, p]));
    expect(q.ana).toMatchObject({ x: 62.5, y: 66.7, quadrant: 'ADVANCED_SOLID', demonstrations: 3 });
    expect(q.beto).toMatchObject({ x: 12.5, y: null, quadrant: null });
    expect(q.cata).toMatchObject({ x: 0, y: null });
  });
  it('window applies to the evidence counted for solidity', () => {
    const input = base({ windowFrom: '2026-09-15T00:00:00Z', pairs: [pair('ana', 'deriv', decision('RETAIN', { q: { PROVE: ['e1'] }, nq: { RETAIN: ['e2'] } }), [['e1', '2026-09-01T00:00:00Z'], ['e2', '2026-09-20T00:00:00Z']])] });
    expect(computeQuadrant(input)[0].y).toBe(0);
  });
  it('labels: threshold 50 on both axes', () => {
    expect(quadrantOf(60, 60)).toBe('ADVANCED_SOLID');
    expect(quadrantOf(20, 80)).toBe('CONSOLIDATING');
    expect(quadrantOf(70, 30)).toBe('ADVANCING_WITH_GAPS');
    expect(quadrantOf(10, 10)).toBe('NEEDS_SUPPORT');
  });
});

describe('trend', () => {
  it('weekly qualifying evidence per phase with distinct learners, inside the window only', () => {
    const input = base({
      windowFrom: '2026-09-14T00:00:00Z',
      pairs: [
        pair('ana', 'deriv', decision('PROVE', { q: { LEARN: ['a1'], PRACTICE: ['a2', 'a3'] } }), [['a1', '2026-09-01T10:00:00Z'], ['a2', '2026-09-15T10:00:00Z'], ['a3', '2026-09-16T10:00:00Z']]),
        pair('beto', 'deriv', decision('PRACTICE', { q: { PRACTICE: ['b1'] } }), [['b1', '2026-09-17T10:00:00Z']]),
      ],
    });
    const t = computeTrend(input);
    expect(t.totalEvidence).toBe(3);
    const w = t.weeks.find((x) => x.week === weekStart('2026-09-15T10:00:00Z'))!;
    expect(w.phases.PRACTICE).toEqual({ evidence: 3, students: 2 });
    expect(w.phases.LEARN.evidence).toBe(0);
    expect(t.weeks[0].week).toBe('2026-09-14');
  });
  it('no evidence → empty trend (the page shows the "not enough activity" state, never fabricated bars)', () => {
    expect(computeTrend(base())).toEqual({ weeks: [], totalEvidence: 0 });
  });
});

describe('retention, target dates and timeline', () => {
  it('retention due = memory says due, or RETAIN executable now', () => {
    expect(retentionDue(pair('a', 'c', decision('PROVE'), [], { memory: { retentionDue: true, nextReviewAt: null } }))).toBe(true);
    expect(retentionDue(pair('a', 'c', decision('RETAIN')))).toBe(true);
    expect(retentionDue(pair('a', 'c', decision('RETAIN', { actionState: 'WAITING' })))).toBe(false);
  });
  it('target date at risk = within 14 days and PROVE not satisfied; assignment at risk = due ≤ 7 days and not started', () => {
    const input = base({
      pairs: [pair('ana', 'deriv', decision('RETAIN', { satisfied: ['LEARN', 'PRACTICE', 'PROVE'] })), pair('beto', 'deriv', decision('PRACTICE'))],
      assignments: [
        { groupId: 'g1', title: 'Refuerzo', conceptId: 'deriv', studentId: 'ana', status: 'COMPLETED', assignedAt: '2026-09-25T00:00:00Z', dueAt: '2026-10-05T00:00:00Z' },
        { groupId: 'g1', title: 'Refuerzo', conceptId: 'deriv', studentId: 'beto', status: 'ASSIGNED', assignedAt: '2026-09-25T00:00:00Z', dueAt: '2026-10-05T00:00:00Z' },
      ],
      examDates: [{ studentId: 'cata', examName: 'IB AA SL', examDate: '2026-11-01' }],
    });
    const tl = computeTimeline(input);
    const target = tl.find((e) => e.type === 'TARGET_DATE')!;
    expect(target.atRisk.map((s) => s.name).sort()).toEqual(['Beto', 'Cata']);
    const due = tl.find((e) => e.type === 'ASSIGNMENT_DUE')!;
    expect(due.atRisk.map((s) => s.name)).toEqual(['Beto']);
    expect(tl.find((e) => e.type === 'EXAM')?.students.map((s) => s.name)).toEqual(['Cata']);
    expect(tl.map((e) => e.date)).toEqual([...tl.map((e) => e.date)].sort());
  });
});

describe('summary, students, recommendations, exams', () => {
  const input = base({
    pairs: [
      pair('ana', 'deriv', decision('RETAIN', { satisfied: ['LEARN', 'PRACTICE', 'PROVE'] }), [['x1', '2026-09-30T00:00:00Z']]),
      pair('ana', 'integ', decision('TRANSFER', { satisfied: ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN'] })),
      pair('beto', 'deriv', decision('PROVE', { reinforce: true })),
    ],
    examGaps: [{ studentId: 'cata', conceptId: 'deriv', examName: 'IB AA SL', objectiveCode: '5.1', fraction: 0.25, at: '2026-09-28T00:00:00Z' }],
    assignments: [
      { groupId: 'g1', title: 'Refuerzo', conceptId: 'deriv', studentId: 'ana', status: 'COMPLETED', assignedAt: '2026-09-25T00:00:00Z', dueAt: null },
      { groupId: 'g1', title: 'Refuerzo', conceptId: 'deriv', studentId: 'beto', status: 'IN_PROGRESS', assignedAt: '2026-09-25T00:00:00Z', dueAt: null },
    ],
  });
  const v = computeClassProgress(input);

  it('summary metrics carry the exact learner lists for drill-down', () => {
    expect(v.summary.activeStudents.map((s) => s.name)).toEqual(['Ana', 'Beto', 'Cata']);
    expect(v.summary.conceptsWorked.map((c) => c.conceptId)).toEqual(['deriv']);
    expect(v.summary.assignments).toMatchObject({ total: 2, completed: 1, percent: 50 });
    expect(v.summary.assignments.pending.map((s) => s.name)).toEqual(['Beto']);
    expect(v.summary.studentsWithGaps.map((s) => s.name)).toEqual(['Beto', 'Cata']);
    expect(v.summary.retentionDue.map((s) => s.name)).toEqual(['Ana']);
    expect(v.summary.advancedBeyondPlan.map((s) => s.name)).toEqual(['Ana']);
    expect(v.summary.recentExamGaps.students.map((s) => s.name)).toEqual(['Cata']);
  });

  it('student table: state per phase, gaps, retention, last activity and the rule-based next action; no evidence → not started', () => {
    const rows = Object.fromEntries(v.students.map((s) => [s.studentId, s]));
    expect(rows.ana).toMatchObject({ activeGaps: 0, retentionDue: 1, lastActivity: '2026-09-30T00:00:00Z', nextAction: { kind: 'RETENTION', conceptId: 'deriv' } });
    expect(rows.beto.nextAction).toEqual({ kind: 'REINFORCE', conceptId: 'deriv' });
    expect(rows.cata).toMatchObject({ phases: expect.objectContaining({ NOT_STARTED: 2 }), lastActivity: null, progress: 0 });
    expect(rows.cata.nextAction.kind).toBe('REINFORCE');
    const noEvidence = computeClassProgress(base({ examGaps: [] })).students.find((s) => s.studentId === 'cata')!;
    expect(noEvidence.nextAction).toEqual({ kind: 'ADD_PLAN', conceptId: 'deriv' });
  });

  it('recommendations always carry reason → group → action and only fire on their rule', () => {
    const kinds = v.recommendations.map((r) => `${r.kind}:${r.students.map((s) => s.name).join('|')}`);
    expect(kinds).toContain('REINFORCE:Beto|Cata');
    expect(kinds).toContain('RETENTION:Ana');
    expect(kinds).toContain('ADVANCED:Ana');
    expect(v.recommendations.find((r) => r.kind === 'REINFORCE')!.reasons.sort()).toEqual(['EXAM_GAP', 'REINFORCE']);
    expect(computeClassProgress(base()).recommendations.filter((r) => r.kind !== 'TARGET_RISK')).toEqual([]);
  });

  it('exam integration: exam, concept, learners, date and objective evidence', () => {
    expect(v.exams).toEqual([{ examName: 'IB AA SL', conceptId: 'deriv', label: 'Derivación', latest: '2026-09-28T00:00:00Z', items: [{ studentId: 'cata', name: 'Cata', objectiveCode: '5.1', fraction: 0.25, at: '2026-09-28T00:00:00Z' }] }]);
  });
});

// ---------------------------------------------------------------------------
// Query layer: fixed number of queries whatever the class size (no N+1)
// ---------------------------------------------------------------------------

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
vi.mock('@/lib/teacher/class-assignment.service', () => ({
  getTeacherClass: vi.fn(async (actor: string) => (actor === 'teacher' ? { id: 'k1', name: 'Math', institutionId: 'i1', institutionName: 'I', gradeName: null, subjectId: 'math', subjectName: 'Mathematics' } : null)),
}));
vi.mock('@/lib/learning-plan/labels', () => ({ canonicalConceptLabels: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, id]))) }));

describe('getClassProgress query layer', () => {
  function world(learners: number) {
    const ids = Array.from({ length: learners }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    dbQueryMock.mockReset().mockImplementation(async (raw: any) => {
      const sql: string = typeof raw === 'string' ? raw : raw?.text ?? '';
      if (sql.includes('FROM class_enrollments ce JOIN students s')) return { rows: ids.map((id, i) => ({ id, name: `S${i}` })) };
      if (sql.includes('FROM class_plan_concepts cpc')) return { rows: [{ canonical_concept_id: 'c1', target_date: null, period: null, added_at: NOW }, { canonical_concept_id: 'c2', target_date: null, period: null, added_at: NOW }] };
      if (sql.includes('FROM student_plan_entries')) return { rows: ids.flatMap((id) => [{ student_id: id, canonical_concept_id: 'c1', learner_concept_id: `${id}-1` }, { student_id: id, canonical_concept_id: 'c2', learner_concept_id: `${id}-2` }]) };
      if (sql.includes("to_regclass('public.exam_attempt_results')")) return { rows: [{ present: false }] };
      return { rows: [] };
    });
    return ids;
  }

  beforeEach(() => dbQueryMock.mockReset());

  it('the same number of DB round trips for 5 and for 200 learners', async () => {
    const { getClassProgress } = await import('@/lib/teacher/class-progress.service');
    world(5);
    const small = await getClassProgress('teacher', 'k1', { period: 'all' }, 'es', new Date(NOW));
    const smallCalls = dbQueryMock.mock.calls.length;
    world(200);
    const large = await getClassProgress('teacher', 'k1', { period: 'all' }, 'es', new Date(NOW));
    const largeCalls = dbQueryMock.mock.calls.length;
    expect(small.phases.reduce((t, p) => t + p.pairs, 0)).toBe(10);
    expect(large.phases.reduce((t, p) => t + p.pairs, 0)).toBe(400);
    expect(largeCalls).toBe(smallCalls);
    expect(largeCalls).toBeLessThanOrEqual(20);
  });

  it('anyone but the Teacher of the class is refused before any learner data is read', async () => {
    const { getClassProgress, ClassProgressError } = await import('@/lib/teacher/class-progress.service');
    world(5);
    await expect(getClassProgress('other-teacher', 'k1', { period: 'all' }, 'es')).rejects.toBeInstanceOf(ClassProgressError);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('the learner selection filter only narrows within the class', async () => {
    const { getClassProgress } = await import('@/lib/teacher/class-progress.service');
    const ids = world(5);
    const v = await getClassProgress('teacher', 'k1', { period: 'all', students: [ids[0], 'ffffffff-ffff-4fff-8fff-ffffffffffff'] }, 'es', new Date(NOW));
    expect(v.summary.activeStudents.map((s) => s.studentId)).toEqual([ids[0]]);
  });
});

describe('privacy and responsive guards', () => {
  const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const svc = strip(readFileSync('src/lib/teacher/class-progress.service.ts', 'utf-8'));
  const page = strip(readFileSync('src/app/dashboard/teacher/classes/[classId]/progress/page.tsx', 'utf-8'));
  const css = readFileSync('src/app/globals.css', 'utf-8');
  it('never reads tutor transcripts, parent data or billing; never writes', () => {
    for (const src of [svc, page]) {
      expect(src).not.toMatch(/tutor_|chat_messages|conversations|parent_student|\bprofiles\b|subscriptions|billing|stripe/i);
      expect(src).not.toMatch(/\b(INSERT INTO|DELETE FROM|UPDATE\s+\w+\s+SET)\b/);
    }
    expect(svc).toMatch(/canonical_subject_id = \$2/);
  });
  it('mobile order is summary → recommendations → students → visuals, and the matrix is desktop-only', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 767px) {\n  .cpi-summary'));
    expect(mobile).toMatch(/\.cpi-summary \{ order: 1; \}[\s\S]*\.cpi-recs \{ order: 2; \}[\s\S]*\.cpi-table \{ order: 3; \}[\s\S]*\.cpi-visuals \{ order: 4;/);
    expect(mobile).toMatch(/\.cpi-matrix-desktop \{ display: none; \}/);
    expect(page).toMatch(/t\['cpi\.notEnough'\]/);
  });
});
