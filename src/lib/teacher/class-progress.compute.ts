/**
 * Track A -- Class Progress Intelligence: PURE aggregation of already
 * governed facts (no IO, no clock). Every number here is a count or ratio
 * over inputs the loader read from existing sources:
 *
 *  - canonical decision per (learner, concept): stage, requirements
 *    (qualifying / non-qualifying evidence per LEARN..TRANSFER), REINFORCE,
 *    next action, journey progress anchor -- the ONE engine, verbatim;
 *  - real evidence rows (ids + timestamps) the decision was computed from;
 *  - Twin memory signal (retention due / next review) -- the read model the
 *    learner view already uses;
 *  - ACTIVE misconceptions, exam gaps (latest result per objective < 0.5),
 *    class assignments, class-plan target dates, exam dates.
 *
 * Nothing is predicted, diagnosed or fabricated. Rules are explicit and
 * documented next to each output (see docs/learning-plan/CLASS_PROGRESS_INTELLIGENCE.md).
 */
import type { CanonicalPedagogicalDecision, PedagogicalStage } from '@/lib/pedagogical-engine/types';

export const PHASES = ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'] as const;
export type Phase = (typeof PHASES)[number];
export const BUCKETS = ['NOT_STARTED', ...PHASES, 'CONSOLIDATED'] as const;
export type Bucket = (typeof BUCKETS)[number];
export type GapReason = 'EXAM_GAP' | 'REINFORCE' | 'MISCONCEPTION';
export type Quadrant = 'ADVANCED_SOLID' | 'CONSOLIDATING' | 'ADVANCING_WITH_GAPS' | 'NEEDS_SUPPORT';
export type NextActionKind = 'REINFORCE' | 'RETENTION' | 'LEARN' | 'PRACTICE' | 'PROVE' | 'TRANSFER' | 'WAIT' | 'ADD_PLAN' | 'EXPLORE_NEXT';

/** Rule constants (auditable). */
export const RULES = {
  quadrantThreshold: 50,
  targetRiskDays: 14,
  assignmentRiskDays: 7,
  recommendationMinStudents: 2,
  trendMaxWeeks: 26,
  timelineHorizonDays: 60,
} as const;

export interface ProgressLearner {
  id: string;
  name: string;
}
export interface ProgressConcept {
  id: string;
  label: string;
  topicKey: string | null;
  topicLabel: string | null;
  inClassPlan: boolean;
  targetDate: string | null; // YYYY-MM-DD
  period: string | null;
}
export interface ProgressPair {
  studentId: string;
  conceptId: string;
  learnerConceptId: string;
  decision: CanonicalPedagogicalDecision | null;
  evidence: Array<{ id: string; timestamp: string }>;
  memory: { retentionDue: boolean; nextReviewAt: string | null } | null;
  misconception: { activeCount: number; lastSeenAt: string | null } | null;
}
export interface ProgressExamGap {
  studentId: string;
  conceptId: string;
  examName: string;
  objectiveCode: string | null;
  fraction: number;
  at: string;
}
export interface ProgressAssignment {
  groupId: string;
  title: string;
  conceptId: string | null;
  studentId: string;
  status: string; // ASSIGNED | IN_PROGRESS | COMPLETED | EXPIRED
  assignedAt: string;
  dueAt: string | null;
}
export interface ProgressExamDate {
  studentId: string;
  examName: string;
  examDate: string; // YYYY-MM-DD
}
export interface ProgressInputs {
  now: string;
  /** Inclusive lower bound of the time window (null = all time). */
  windowFrom: string | null;
  learners: ProgressLearner[];
  concepts: ProgressConcept[];
  pairs: ProgressPair[];
  examGaps: ProgressExamGap[];
  assignments: ProgressAssignment[];
  examDates: ProgressExamDate[];
}

export interface StudentRef {
  studentId: string;
  name: string;
}
export interface GapItem {
  studentId: string;
  name: string;
  conceptId: string;
  reasons: Array<{ type: GapReason; examName?: string; objectiveCode?: string | null; fraction?: number; at?: string | null; misconceptions?: number }>;
}

const DAY = 86_400_000;
const inWindow = (iso: string | null | undefined, from: string | null, now: string) => !!iso && (from === null || iso >= from) && iso <= now;
const isoDay = (iso: string) => iso.slice(0, 10);
const key = (s: string, c: string) => `${s}:${c}`;

export function bucketOf(pair: ProgressPair | undefined): Bucket {
  if (!pair || !pair.decision) return 'NOT_STARTED';
  return pair.decision.stage as Bucket;
}

function requirement(decision: CanonicalPedagogicalDecision | null, stage: Phase) {
  return decision?.requirements.find((r) => r.stage === stage) ?? null;
}
const proveSatisfied = (pair: ProgressPair | undefined) => requirement(pair?.decision ?? null, 'PROVE')?.status === 'SATISFIED';

/**
 * Retention due (explicit rule): the Twin memory signal says retention is
 * due, OR the canonical decision's current stage is RETAIN and it is
 * executable now (the retention window has opened).
 */
export function retentionDue(pair: ProgressPair | undefined): boolean {
  if (!pair) return false;
  return pair.memory?.retentionDue === true || (pair.decision?.stage === 'RETAIN' && pair.decision.actionState === 'EXECUTABLE');
}

/**
 * Active gaps (real signals only), per learner × concept:
 *  - EXAM_GAP: latest exam result for an objective mapped to the concept < 0.5, dated in the window;
 *  - REINFORCE: the canonical decision's own intervention (failed PROVE / retention rollback);
 *  - MISCONCEPTION: ACTIVE misconceptions for the concept, last seen in the window.
 */
export function computeGaps(input: ProgressInputs): GapItem[] {
  const names = new Map(input.learners.map((l) => [l.id, l.name]));
  const conceptIds = new Set(input.concepts.map((c) => c.id));
  const items = new Map<string, GapItem>();
  const add = (studentId: string, conceptId: string, reason: GapItem['reasons'][number]) => {
    if (!names.has(studentId) || !conceptIds.has(conceptId)) return;
    const k = key(studentId, conceptId);
    const item = items.get(k) ?? { studentId, name: names.get(studentId)!, conceptId, reasons: [] };
    item.reasons.push(reason);
    items.set(k, item);
  };
  for (const g of input.examGaps) {
    if (inWindow(g.at, input.windowFrom, input.now)) add(g.studentId, g.conceptId, { type: 'EXAM_GAP', examName: g.examName, objectiveCode: g.objectiveCode, fraction: g.fraction, at: g.at });
  }
  for (const p of input.pairs) {
    if (p.decision?.intervention === 'REINFORCE') add(p.studentId, p.conceptId, { type: 'REINFORCE', at: null });
    if ((p.misconception?.activeCount ?? 0) > 0 && (input.windowFrom === null || inWindow(p.misconception!.lastSeenAt, input.windowFrom, input.now))) {
      add(p.studentId, p.conceptId, { type: 'MISCONCEPTION', misconceptions: p.misconception!.activeCount, at: p.misconception!.lastSeenAt });
    }
  }
  return [...items.values()];
}

/** Pareto: canonical concept → distinct affected learners, descending, with cumulative % of all (learner, concept) gap incidences. */
export function computePareto(gaps: GapItem[], concepts: ProgressConcept[]) {
  const byConcept = new Map<string, GapItem[]>();
  for (const g of gaps) byConcept.set(g.conceptId, [...(byConcept.get(g.conceptId) ?? []), g]);
  const label = new Map(concepts.map((c) => [c.id, c.label]));
  const rows = [...byConcept.entries()]
    .map(([conceptId, items]) => ({ conceptId, label: label.get(conceptId) ?? '', count: new Set(items.map((i) => i.studentId)).size, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const total = rows.reduce((t, r) => t + r.count, 0);
  let running = 0;
  return rows.map((r) => {
    running += r.count;
    return { ...r, cumulativePercent: total === 0 ? 0 : Math.round((running / total) * 1000) / 10 };
  });
}

/** Current phase distribution over (learner × concept in scope); NOT_STARTED = not in plan or no decision yet. */
export function computePhaseDistribution(input: ProgressInputs) {
  const byKey = new Map(input.pairs.map((p) => [key(p.studentId, p.conceptId), p]));
  const label = new Map(input.concepts.map((c) => [c.id, c.label]));
  const dist = Object.fromEntries(BUCKETS.map((b) => [b, [] as Array<StudentRef & { conceptId: string; conceptLabel: string }>])) as Record<Bucket, Array<StudentRef & { conceptId: string; conceptLabel: string }>>;
  for (const l of input.learners) {
    for (const c of input.concepts) {
      dist[bucketOf(byKey.get(key(l.id, c.id)))].push({ studentId: l.id, name: l.name, conceptId: c.id, conceptLabel: label.get(c.id) ?? '' });
    }
  }
  return BUCKETS.map((b) => ({ bucket: b, pairs: dist[b].length, students: new Set(dist[b].map((x) => x.studentId)).size, items: dist[b] }));
}

/** ISO week start (Monday, UTC) of a timestamp. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/**
 * Weekly trend: for each week of the window and each requirement
 * LEARN..TRANSFER, the evidence items the canonical engine counted as
 * QUALIFYING for that requirement (by the evidence's own timestamp), and
 * the distinct learners behind them.
 */
export function computeTrend(input: ProgressInputs) {
  const events: Array<{ week: string; phase: Phase; studentId: string }> = [];
  for (const p of input.pairs) {
    if (!p.decision) continue;
    const at = new Map(p.evidence.map((e) => [e.id, e.timestamp]));
    for (const phase of PHASES) {
      for (const id of requirement(p.decision, phase)?.qualifyingEvidenceIds ?? []) {
        const ts = at.get(id);
        if (ts && inWindow(ts, input.windowFrom, input.now)) events.push({ week: weekStart(ts), phase, studentId: p.studentId });
      }
    }
  }
  if (events.length === 0) return { weeks: [] as Array<{ week: string; phases: Record<Phase, { evidence: number; students: number }> }>, totalEvidence: 0 };
  const first = input.windowFrom ? weekStart(input.windowFrom) : events.map((e) => e.week).sort()[0];
  const last = weekStart(input.now);
  const weeks: string[] = [];
  for (let t = Date.parse(first); t <= Date.parse(last); t += 7 * DAY) weeks.push(new Date(t).toISOString().slice(0, 10));
  const kept = weeks.slice(-RULES.trendMaxWeeks);
  return {
    weeks: kept.map((week) => ({
      week,
      phases: Object.fromEntries(
        PHASES.map((phase) => {
          const e = events.filter((x) => x.week === week && x.phase === phase);
          return [phase, { evidence: e.length, students: new Set(e.map((x) => x.studentId)).size }];
        })
      ) as Record<Phase, { evidence: number; students: number }>,
    })),
    totalEvidence: events.length,
  };
}

/**
 * Student quadrant (documented formula):
 *  X = plan progress = mean over the concepts in scope of the canonical
 *      journey-progress anchor (0 when the concept is not in the learner's plan).
 *  Y = learning solidity = 100 × Q / (Q + N), where Q / N are the
 *      qualifying / non-qualifying evidence items the canonical engine
 *      recorded for the PROVE, RETAIN and TRANSFER requirements of those
 *      concepts (evidence dated in the window). Undefined (no point) when
 *      the learner has no PROVE/RETAIN/TRANSFER attempt yet.
 *  Threshold 50 on both axes.
 */
export function computeQuadrant(input: ProgressInputs) {
  const byKey = new Map(input.pairs.map((p) => [key(p.studentId, p.conceptId), p]));
  return input.learners.map((l) => {
    let progress = 0;
    let q = 0;
    let nq = 0;
    for (const c of input.concepts) {
      const p = byKey.get(key(l.id, c.id));
      progress += p?.decision?.journeyProgressPercent ?? 0;
      if (!p?.decision) continue;
      const at = new Map(p.evidence.map((e) => [e.id, e.timestamp]));
      for (const phase of ['PROVE', 'RETAIN', 'TRANSFER'] as const) {
        const r = requirement(p.decision, phase);
        if (!r) continue;
        q += r.qualifyingEvidenceIds.filter((id) => inWindow(at.get(id), input.windowFrom, input.now)).length;
        nq += r.nonQualifyingEvidenceIds.filter((id) => inWindow(at.get(id), input.windowFrom, input.now)).length;
      }
    }
    const x = input.concepts.length === 0 ? 0 : Math.round((progress / input.concepts.length) * 10) / 10;
    const y = q + nq === 0 ? null : Math.round((100 * q) / (q + nq) * 10) / 10;
    return { studentId: l.id, name: l.name, x, y, quadrant: y === null ? null : quadrantOf(x, y), demonstrations: q + nq };
  });
}

export function quadrantOf(x: number, y: number): Quadrant {
  const t = RULES.quadrantThreshold;
  if (x >= t) return y >= t ? 'ADVANCED_SOLID' : 'ADVANCING_WITH_GAPS';
  return y >= t ? 'CONSOLIDATING' : 'NEEDS_SUPPORT';
}

/** Next recommended action per learner (rule order documented in the doc): reinforce → retention → engine next action of the least advanced concept → add plan → explore next. */
export function nextActionFor(studentId: string, input: ProgressInputs, gaps: GapItem[]): { kind: NextActionKind; conceptId: string | null; until?: string | null } {
  const mine = input.pairs.filter((p) => p.studentId === studentId);
  const gap = gaps.find((g) => g.studentId === studentId);
  if (gap) return { kind: 'REINFORCE', conceptId: gap.conceptId };
  const due = mine.find((p) => retentionDue(p));
  if (due) return { kind: 'RETENTION', conceptId: due.conceptId };
  const open = mine.filter((p) => p.decision && p.decision.stage !== 'CONSOLIDATED').sort((a, b) => (a.decision!.journeyProgressPercent ?? 0) - (b.decision!.journeyProgressPercent ?? 0));
  const executable = open.find((p) => p.decision!.actionState === 'EXECUTABLE');
  if (executable) {
    const a = executable.decision!.nextCanonicalAction;
    const kind: NextActionKind = a === 'RETENTION_CHECK' ? 'RETENTION' : a === 'NONE' ? 'PRACTICE' : (a as NextActionKind);
    return { kind, conceptId: executable.conceptId };
  }
  const waiting = open.find((p) => p.decision!.actionState === 'WAITING');
  if (waiting) return { kind: 'WAIT', conceptId: waiting.conceptId, until: waiting.decision!.nextEligibleAt };
  const inPlan = new Set(mine.map((p) => p.conceptId));
  const missing = input.concepts.find((c) => c.inClassPlan && !inPlan.has(c.id));
  if (missing) return { kind: 'ADD_PLAN', conceptId: missing.id };
  return { kind: 'EXPLORE_NEXT', conceptId: null };
}

export function computeStudents(input: ProgressInputs, gaps: GapItem[], quadrant: ReturnType<typeof computeQuadrant>) {
  const q = new Map(quadrant.map((x) => [x.studentId, x]));
  return input.learners.map((l) => {
    const mine = input.pairs.filter((p) => p.studentId === l.id);
    const phases = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
    for (const c of input.concepts) phases[bucketOf(mine.find((p) => p.conceptId === c.id))] += 1;
    const lastActivity = mine.flatMap((p) => p.evidence.map((e) => e.timestamp)).sort().pop() ?? null;
    return {
      studentId: l.id,
      name: l.name,
      progress: q.get(l.id)?.x ?? 0,
      solidity: q.get(l.id)?.y ?? null,
      quadrant: q.get(l.id)?.quadrant ?? null,
      phases,
      activeGaps: gaps.filter((g) => g.studentId === l.id).length,
      gapConcepts: gaps.filter((g) => g.studentId === l.id).map((g) => g.conceptId),
      retentionDue: mine.filter((p) => retentionDue(p)).length,
      lastActivity,
      nextAction: nextActionFor(l.id, input, gaps),
    };
  });
}

/**
 * Timeline (next RULES.timelineHorizonDays days, plus overdue items):
 *  - assignment due dates; at risk = due within RULES.assignmentRiskDays (or overdue) and the learner has not started (ASSIGNED);
 *  - class-plan target dates; at risk = target within RULES.targetRiskDays (or past) and the learner's PROVE requirement is not SATISFIED;
 *  - retention: memory next review dates in the horizon, and reviews due now;
 *  - exam dates of the learners' exam profiles covering the class subject.
 */
export function computeTimeline(input: ProgressInputs) {
  const now = Date.parse(input.now);
  const horizon = now + RULES.timelineHorizonDays * DAY;
  const names = new Map(input.learners.map((l) => [l.id, l.name]));
  const label = new Map(input.concepts.map((c) => [c.id, c.label]));
  const byKey = new Map(input.pairs.map((p) => [key(p.studentId, p.conceptId), p]));
  const events: Array<{ type: 'ASSIGNMENT_DUE' | 'TARGET_DATE' | 'RETENTION' | 'EXAM'; date: string; title: string; conceptId: string | null; students: StudentRef[]; atRisk: StudentRef[] }> = [];
  const ref = (id: string): StudentRef => ({ studentId: id, name: names.get(id) ?? '' });

  const groups = new Map<string, ProgressAssignment[]>();
  for (const a of input.assignments) if (a.dueAt && names.has(a.studentId)) groups.set(a.groupId, [...(groups.get(a.groupId) ?? []), a]);
  for (const [, rows] of groups) {
    const due = Date.parse(rows[0].dueAt!);
    if (due > horizon) continue;
    const open = rows.filter((r) => r.status !== 'COMPLETED');
    if (open.length === 0 && due < now) continue;
    const risky = due - now <= RULES.assignmentRiskDays * DAY ? rows.filter((r) => r.status === 'ASSIGNED' || r.status === 'EXPIRED') : [];
    events.push({ type: 'ASSIGNMENT_DUE', date: isoDay(rows[0].dueAt!), title: rows[0].title, conceptId: rows[0].conceptId, students: open.map((r) => ref(r.studentId)), atRisk: risky.map((r) => ref(r.studentId)) });
  }
  for (const c of input.concepts) {
    if (!c.inClassPlan || !c.targetDate) continue;
    const t = Date.parse(`${c.targetDate}T23:59:59Z`);
    if (t > horizon) continue;
    const notYet = input.learners.filter((l) => !proveSatisfied(byKey.get(key(l.id, c.id))));
    if (t < now - 7 * DAY && notYet.length === 0) continue;
    const risky = t - now <= RULES.targetRiskDays * DAY ? notYet : [];
    events.push({ type: 'TARGET_DATE', date: c.targetDate, title: c.label, conceptId: c.id, students: notYet.map((l) => ref(l.id)), atRisk: risky.map((l) => ref(l.id)) });
  }
  const retention = new Map<string, { conceptId: string; students: string[] }>();
  for (const p of input.pairs) {
    const dueNow = retentionDue(p);
    const next = p.memory?.nextReviewAt ? Date.parse(p.memory.nextReviewAt) : null;
    if (!dueNow && (next === null || next > horizon)) continue;
    const date = dueNow ? isoDay(input.now) : isoDay(p.memory!.nextReviewAt!);
    const k = `${date}:${p.conceptId}`;
    const e = retention.get(k) ?? { conceptId: p.conceptId, students: [] };
    e.students.push(p.studentId);
    retention.set(k, e);
  }
  for (const [k, e] of retention) events.push({ type: 'RETENTION', date: k.slice(0, 10), title: label.get(e.conceptId) ?? '', conceptId: e.conceptId, students: e.students.map(ref), atRisk: [] });
  const exams = new Map<string, string[]>();
  for (const x of input.examDates) {
    const t = Date.parse(`${x.examDate}T00:00:00Z`);
    if (t < now - DAY || t > horizon || !names.has(x.studentId)) continue;
    const k = `${x.examDate}|${x.examName}`;
    exams.set(k, [...(exams.get(k) ?? []), x.studentId]);
  }
  for (const [k, ids] of exams) events.push({ type: 'EXAM', date: k.split('|')[0], title: k.split('|')[1], conceptId: null, students: ids.map(ref), atRisk: [] });
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
}

export function computeSummary(input: ProgressInputs, gaps: GapItem[]) {
  const byKey = new Map(input.pairs.map((p) => [key(p.studentId, p.conceptId), p]));
  const names = new Map(input.learners.map((l) => [l.id, l.name]));
  const refs = (ids: Iterable<string>) => [...new Set(ids)].filter((id) => names.has(id)).map((id) => ({ studentId: id, name: names.get(id)! })).sort((a, b) => a.name.localeCompare(b.name));
  const worked = input.concepts.filter((c) => input.pairs.some((p) => p.conceptId === c.id && p.evidence.some((e) => inWindow(e.timestamp, input.windowFrom, input.now))));
  const assignments = input.assignments.filter((a) => names.has(a.studentId) && inWindow(a.assignedAt, input.windowFrom, input.now));
  const completed = assignments.filter((a) => a.status === 'COMPLETED').length;
  const plan = input.concepts.filter((c) => c.inClassPlan);
  const advanced = plan.length === 0 ? [] : input.learners.filter((l) => plan.every((c) => proveSatisfied(byKey.get(key(l.id, c.id))))).map((l) => l.id);
  const recentExam = gaps.filter((g) => g.reasons.some((r) => r.type === 'EXAM_GAP'));
  return {
    activeStudents: refs(input.learners.map((l) => l.id)),
    conceptsWorked: worked.map((c) => ({ conceptId: c.id, label: c.label })),
    assignments: { total: assignments.length, completed, percent: assignments.length === 0 ? null : Math.round((completed / assignments.length) * 100), pending: refs(assignments.filter((a) => a.status !== 'COMPLETED').map((a) => a.studentId)) },
    studentsWithGaps: refs(gaps.map((g) => g.studentId)),
    retentionDue: refs(input.pairs.filter((p) => retentionDue(p)).map((p) => p.studentId)),
    advancedBeyondPlan: refs(advanced),
    recentExamGaps: { incidences: recentExam.length, students: refs(recentExam.map((g) => g.studentId)) },
  };
}

/** Exam integration: exam gaps grouped by (exam, concept) -- exam, concept, learners, latest date, objective evidence. */
export function computeExamGroups(input: ProgressInputs) {
  const names = new Map(input.learners.map((l) => [l.id, l.name]));
  const label = new Map(input.concepts.map((c) => [c.id, c.label]));
  const groups = new Map<string, { examName: string; conceptId: string; label: string; latest: string; items: Array<StudentRef & { objectiveCode: string | null; fraction: number; at: string }> }>();
  for (const g of input.examGaps) {
    if (!names.has(g.studentId) || !label.has(g.conceptId) || !inWindow(g.at, input.windowFrom, input.now)) continue;
    const k = `${g.examName}|${g.conceptId}`;
    const e = groups.get(k) ?? { examName: g.examName, conceptId: g.conceptId, label: label.get(g.conceptId)!, latest: g.at, items: [] };
    e.items.push({ studentId: g.studentId, name: names.get(g.studentId)!, objectiveCode: g.objectiveCode, fraction: g.fraction, at: g.at });
    if (g.at > e.latest) e.latest = g.at;
    groups.set(k, e);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || b.latest.localeCompare(a.latest));
}

export type RecommendationKind = 'REINFORCE' | 'RETENTION' | 'ADVANCED' | 'TARGET_RISK';
/**
 * Actionable recommendations -- rules only, always "evidence/reason → learner group → action":
 *  - REINFORCE: a concept with ≥ RULES.recommendationMinStudents learners with active gaps;
 *  - RETENTION: ≥ 1 learner with retention due;
 *  - ADVANCED: ≥ 1 learner with PROVE satisfied on every class-plan concept in scope;
 *  - TARGET_RISK: a class-plan target date at risk (rule in computeTimeline) for ≥ 1 learner.
 */
export function computeRecommendations(
  pareto: ReturnType<typeof computePareto>,
  summary: ReturnType<typeof computeSummary>,
  timeline: ReturnType<typeof computeTimeline>
) {
  const recs: Array<{ kind: RecommendationKind; conceptId: string | null; label: string | null; students: StudentRef[]; reasons: GapReason[] }> = [];
  for (const row of pareto) {
    if (row.count < RULES.recommendationMinStudents) continue;
    const students = [...new Map(row.items.map((i) => [i.studentId, { studentId: i.studentId, name: i.name }])).values()];
    recs.push({ kind: 'REINFORCE', conceptId: row.conceptId, label: row.label, students, reasons: [...new Set(row.items.flatMap((i) => i.reasons.map((r) => r.type)))] });
  }
  if (summary.retentionDue.length > 0) recs.push({ kind: 'RETENTION', conceptId: null, label: null, students: summary.retentionDue, reasons: [] });
  if (summary.advancedBeyondPlan.length > 0) recs.push({ kind: 'ADVANCED', conceptId: null, label: null, students: summary.advancedBeyondPlan, reasons: [] });
  for (const e of timeline) {
    if (e.type === 'TARGET_DATE' && e.atRisk.length > 0) recs.push({ kind: 'TARGET_RISK', conceptId: e.conceptId, label: e.title, students: e.atRisk, reasons: [] });
  }
  return recs;
}

export function computeClassProgress(input: ProgressInputs) {
  const gaps = computeGaps(input);
  const pareto = computePareto(gaps, input.concepts);
  const quadrant = computeQuadrant(input);
  const summary = computeSummary(input, gaps);
  const timeline = computeTimeline(input);
  return {
    summary,
    trend: computeTrend(input),
    pareto,
    quadrant,
    phases: computePhaseDistribution(input),
    timeline,
    students: computeStudents(input, gaps, quadrant),
    recommendations: computeRecommendations(pareto, summary, timeline),
    exams: computeExamGroups(input),
    gaps,
  };
}

export type ClassProgressComputed = ReturnType<typeof computeClassProgress>;
export type { PedagogicalStage };
