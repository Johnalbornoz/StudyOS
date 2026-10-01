/**
 * Track A -- Teacher learner view: what a Teacher sees about ONE learner of
 * ONE class they teach, scoped to that class's canonical subject.
 *
 * Projection only. Every learning fact comes from the existing, certified
 * READ functions (no hidden writes -- see the Track A teacher readiness
 * audit): the canonical pedagogical decision (stage, next action, practice
 * window, last successful PROVE), the evidence summary/history, the memory
 * and transfer read models, misconception counts and prerequisite
 * diagnoses. Nothing here writes mastery, evidence, knowledge state,
 * retention, transfer or misconceptions, and nothing derives a second
 * learning state: "needs help" is a presentation over the engine's own
 * outputs (REINFORCE, waiting retention, active misconceptions) plus
 * operational assignment status.
 *
 * Never shown: Tutor conversations, parent data, billing, subjects outside
 * the class's subject, other learners.
 */
import { db } from '@/lib/db';
import { canTeacherAccessLearner } from '@/lib/authorization';
import { getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision/canonical-decision.service';
import type { ActionState, NextCanonicalAction, PedagogicalStage } from '@/lib/pedagogical-engine/types';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { getConceptEvidenceHistory, getConceptEvidenceSummary } from '@/services/learner-model.service';
import { getTwinMemorySignal } from '@/services/memory-read.service';
import { getConceptTransferDepth } from '@/services/transfer-read.service';
import { getMisconceptionCountsForConcept } from '@/services/misconception.service';
import { getActiveDiagnoses } from '@/services/cognitive-diagnosis.service';
import type { MemoryStatus } from '@/lib/memory-policy';
import type { TransferDepth } from '@/lib/transfer-policy';
import { getTeacherClass, listClassAssignments, type TeacherClassContext, type LearnerAssignmentOutcome } from './class-assignment.service';
import type { TeacherInterventionStatus } from '@/lib/student/teacher-intervention-execution.service';

export class TeacherLearnerAccessDeniedError extends Error {
  constructor() {
    super('actor cannot view this learner in this class');
    this.name = 'TeacherLearnerAccessDeniedError';
  }
}

export interface LearnerConceptState {
  canonicalConceptId: string;
  topic: string;
  /** False when the learner has no MATCHED concept for this topic yet (nothing practised / not in their plan). */
  inLearnerPlan: boolean;
  stage: PedagogicalStage | null;
  actionState: ActionState | null;
  nextAction: NextCanonicalAction | null;
  nextEligibleAt: string | null;
  reinforce: boolean;
  practice: { passesInWindow: number; requiredPasses: number } | null;
  lastSuccessfulProveAt: string | null;
  retention: { status: MemoryStatus; due: boolean; nextReviewAt: string | null; lastSuccessfulAt: string | null } | null;
  transferDepth: TransferDepth | null;
  evidence: { totalAttempts: number; correctAttempts: number; independentAttempts: number; independentCorrect: number; lastEvidenceAt: string | null };
  recentActivity: Array<{ at: string; sourceType: string; activityType: string | null; result: string; scorePercent: number | null; independent: boolean }>;
  misconceptions: { active: number; critical: number; recurring: number; items: Array<{ description: string; occurrences: number }> };
  /** Last 30 days of graded answers: small slips vs real errors (grader's learner signal). */
  answerSignals: { minorSlips: number; mathErrors: number; misconceptions: number };
  prerequisiteGaps: Array<{ label: string; state: string }>;
  /** The canonical decision could not be read (shown as "no disponible", never guessed). */
  decisionUnavailable: boolean;
}

export type AttentionReason = 'OVERDUE_ASSIGNMENT' | 'MISCONCEPTION' | 'REINFORCE' | 'PREREQUISITE_GAP' | 'RETENTION_DUE' | 'NOT_STARTED';
export type TeacherSuggestion = 'ASSIGN_REINFORCEMENT' | 'REVIEW_MISCONCEPTION' | 'ASSIGN_PREREQUISITE' | 'ASSIGN_RETENTION' | 'FOLLOW_UP_ASSIGNMENT' | 'ASSIGN_FIRST_PRACTICE';

export interface AttentionItem {
  reason: AttentionReason;
  topic: string;
  canonicalConceptId: string | null;
  /** Free text from the read models (misconception description, prerequisite label, assignment title). */
  detail: string | null;
  suggestion: TeacherSuggestion;
}

export interface TeacherLearnerView {
  student: { id: string; name: string };
  klass: TeacherClassContext;
  concepts: LearnerConceptState[];
  assignments: Array<{ interventionId: string; title: string; topic: string; status: TeacherInterventionStatus; assignedAt: string; startsAt: string | null; dueAt: string | null; result: LearnerAssignmentOutcome['result'] }>;
  attention: AttentionItem[];
}

const SUGGESTION_FOR: Record<AttentionReason, TeacherSuggestion> = {
  OVERDUE_ASSIGNMENT: 'FOLLOW_UP_ASSIGNMENT',
  MISCONCEPTION: 'REVIEW_MISCONCEPTION',
  REINFORCE: 'ASSIGN_REINFORCEMENT',
  PREREQUISITE_GAP: 'ASSIGN_PREREQUISITE',
  RETENTION_DUE: 'ASSIGN_RETENTION',
  NOT_STARTED: 'ASSIGN_FIRST_PRACTICE',
};

/** Ordered by how urgently a Teacher should act (index = priority). */
const ATTENTION_ORDER: AttentionReason[] = ['OVERDUE_ASSIGNMENT', 'MISCONCEPTION', 'REINFORCE', 'PREREQUISITE_GAP', 'RETENTION_DUE', 'NOT_STARTED'];

/**
 * Pure: who needs help, on what, why, and what the Teacher can do -- read
 * straight off the engine's own outputs and the assignment status. Never
 * a new threshold over scores.
 */
export function deriveTeacherAttention(concepts: LearnerConceptState[], assignments: TeacherLearnerView['assignments']): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const a of assignments) {
    if (a.status === 'EXPIRED') items.push({ reason: 'OVERDUE_ASSIGNMENT', topic: a.topic, canonicalConceptId: null, detail: a.title, suggestion: SUGGESTION_FOR.OVERDUE_ASSIGNMENT });
  }
  for (const c of concepts) {
    const push = (reason: AttentionReason, detail: string | null = null) =>
      items.push({ reason, topic: c.topic, canonicalConceptId: c.canonicalConceptId, detail, suggestion: SUGGESTION_FOR[reason] });
    if (!c.inLearnerPlan || (c.evidence.totalAttempts === 0 && !c.decisionUnavailable && (c.stage === null || c.stage === 'LEARN'))) {
      push('NOT_STARTED');
      continue;
    }
    if (c.misconceptions.active > 0) push('MISCONCEPTION', c.misconceptions.items[0]?.description ?? null);
    if (c.reinforce) push('REINFORCE');
    for (const gap of c.prerequisiteGaps.slice(0, 2)) push('PREREQUISITE_GAP', gap.label);
    if (c.retention?.due) push('RETENTION_DUE');
  }
  return items.sort((a, b) => ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason));
}

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

async function readConceptState(studentId: string, topic: { id: string; name: string }, diagnoses: Awaited<ReturnType<typeof getActiveDiagnoses>>): Promise<LearnerConceptState> {
  const conceptId = await resolveStudentConceptForCanonicalConcept(studentId, topic.id);
  const empty: LearnerConceptState = {
    canonicalConceptId: topic.id,
    topic: topic.name,
    inLearnerPlan: false,
    stage: null,
    actionState: null,
    nextAction: null,
    nextEligibleAt: null,
    reinforce: false,
    practice: null,
    lastSuccessfulProveAt: null,
    retention: null,
    transferDepth: null,
    evidence: { totalAttempts: 0, correctAttempts: 0, independentAttempts: 0, independentCorrect: 0, lastEvidenceAt: null },
    recentActivity: [],
    misconceptions: { active: 0, critical: 0, recurring: 0, items: [] },
    answerSignals: { minorSlips: 0, mathErrors: 0, misconceptions: 0 },
    prerequisiteGaps: [],
    decisionUnavailable: false,
  };
  if (!conceptId) return empty;

  const [decision, summary, history, memory, transfer, misconceptionCounts, misconceptionItems, signals] = await Promise.all([
    getCanonicalPedagogicalDecision({ studentId, conceptId }).then((r) => r.decision).catch(() => null),
    getConceptEvidenceSummary(studentId, conceptId),
    getConceptEvidenceHistory(studentId, conceptId, 5),
    getTwinMemorySignal(db, studentId, conceptId),
    getConceptTransferDepth(db, studentId, conceptId),
    getMisconceptionCountsForConcept(studentId, conceptId),
    db.query(
      `SELECT ms.description, sm.occurrence_count FROM student_misconceptions sm
       JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
       WHERE sm.student_id = $1 AND ms.concept_id = $2 AND sm.status = 'ACTIVE'
       ORDER BY sm.occurrence_count DESC, sm.last_seen DESC LIMIT 3`,
      [studentId, conceptId]
    ),
    db.query(
      `SELECT g.learner_signal, COUNT(*)::int AS n
       FROM quiz_responses qr
       JOIN LATERAL (SELECT learner_signal FROM quiz_response_grades WHERE response_id = qr.id ORDER BY graded_at DESC LIMIT 1) g ON true
       WHERE qr.student_id = $1 AND qr.concept_id = $2 AND qr.created_at > NOW() - INTERVAL '30 days'
       GROUP BY g.learner_signal`,
      [studentId, conceptId]
    ),
  ]);
  const signalCount = (s: string) => signals.rows.find((r: any) => r.learner_signal === s)?.n ?? 0;

  return {
    ...empty,
    inLearnerPlan: true,
    stage: decision?.stage ?? null,
    actionState: decision?.actionState ?? null,
    nextAction: decision?.nextCanonicalAction ?? null,
    nextEligibleAt: decision?.nextEligibleAt ?? null,
    reinforce: decision?.intervention === 'REINFORCE',
    practice: decision?.practiceProgress ? { passesInWindow: decision.practiceProgress.passesInWindow, requiredPasses: decision.practiceProgress.requiredPasses } : null,
    lastSuccessfulProveAt: decision?.lastQualifyingProveAt ?? null,
    retention: memory
      ? { status: memory.memoryStatus, due: memory.retentionDue, nextReviewAt: memory.nextReviewAt, lastSuccessfulAt: memory.lastSuccessfulRetentionAt }
      : null,
    transferDepth: transfer,
    evidence: {
      totalAttempts: summary.totalAttempts,
      correctAttempts: summary.correctAttempts,
      independentAttempts: summary.soloAttempts,
      independentCorrect: summary.soloCorrect,
      lastEvidenceAt: iso(summary.lastEvidenceDate),
    },
    recentActivity: history.map((h) => ({
      at: iso(h.timestamp)!,
      sourceType: h.sourceType,
      activityType: h.activityType,
      result: h.result,
      scorePercent: h.scorePercent,
      independent: h.learningMode === 'SOLO',
    })),
    misconceptions: {
      active: misconceptionCounts.activeCount,
      critical: misconceptionCounts.criticalCount,
      recurring: misconceptionCounts.recurringCount,
      items: misconceptionItems.rows.map((r: any) => ({ description: r.description, occurrences: r.occurrence_count })),
    },
    answerSignals: { minorSlips: signalCount('MINOR_SLIP'), mathErrors: signalCount('MATH_ERROR'), misconceptions: signalCount('MISCONCEPTION') },
    prerequisiteGaps: diagnoses.filter((d) => d.targetConceptId === conceptId).map((d) => ({ label: d.candidateLabel, state: d.state })),
    decisionUnavailable: decision === null,
  };
}

async function classTopics(subjectId: string | null): Promise<Array<{ id: string; name: string }>> {
  if (!subjectId) return [];
  const r = await db.query(`SELECT id, name FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE' ORDER BY name LIMIT 50`, [subjectId]);
  return r.rows.map((row: any) => ({ id: row.id, name: row.name }));
}

function learnerAssignments(all: Awaited<ReturnType<typeof listClassAssignments>>, studentId: string): TeacherLearnerView['assignments'] {
  const out: TeacherLearnerView['assignments'] = [];
  for (const a of all) {
    const mine = a.learners.find((l) => l.studentId === studentId);
    if (!mine) continue;
    out.push({ interventionId: mine.interventionId, title: a.title, topic: a.conceptName, status: mine.status, assignedAt: a.assignedAt, startsAt: a.startsAt, dueAt: a.dueAt, result: mine.result });
  }
  return out;
}

async function requireLearnerInTaughtClass(actorUserId: string, classId: string, studentId: string): Promise<TeacherClassContext> {
  const klass = await getTeacherClass(actorUserId, classId);
  if (!klass) throw new TeacherLearnerAccessDeniedError();
  const enrolled = await db.query(`SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`, [classId, studentId]);
  if (enrolled.rows.length === 0 || !(await canTeacherAccessLearner(actorUserId, studentId))) throw new TeacherLearnerAccessDeniedError();
  return klass;
}

/** One learner, in the context of one class the actor teaches. */
export async function getTeacherLearnerView(actorUserId: string, classId: string, studentId: string): Promise<TeacherLearnerView> {
  const klass = await requireLearnerInTaughtClass(actorUserId, classId, studentId);
  const [student, topics, diagnoses, assignments] = await Promise.all([
    db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]),
    classTopics(klass.subjectId),
    getActiveDiagnoses(studentId).catch(() => []),
    listClassAssignments(actorUserId, classId),
  ]);
  const concepts = await Promise.all(topics.map((t) => readConceptState(studentId, t, diagnoses)));
  const mine = learnerAssignments(assignments, studentId);
  return {
    student: { id: studentId, name: student.rows[0]?.name || student.rows[0]?.email || '' },
    klass,
    concepts,
    assignments: mine,
    attention: deriveTeacherAttention(concepts, mine),
  };
}

export interface ClassLearnerAttention {
  studentId: string;
  name: string;
  attention: AttentionItem[];
  stages: Array<{ topic: string; stage: PedagogicalStage | null; reinforce: boolean }>;
  assignments: { completed: number; pending: number; overdue: number };
}

/** "Who needs help" for a whole class: every ACTIVE learner, most urgent first. */
export async function listClassLearnerAttention(actorUserId: string, classId: string): Promise<{ klass: TeacherClassContext; learners: ClassLearnerAttention[] }> {
  const klass = await getTeacherClass(actorUserId, classId);
  if (!klass) throw new TeacherLearnerAccessDeniedError();
  const [roster, topics, assignments] = await Promise.all([
    db.query(
      `SELECT s.id, s.name, s.email FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
       WHERE ce.class_id = $1 AND ce.status = 'ACTIVE' ORDER BY s.name NULLS LAST, s.email LIMIT 60`,
      [classId]
    ),
    classTopics(klass.subjectId),
    listClassAssignments(actorUserId, classId),
  ]);
  const learners = await Promise.all(
    roster.rows.map(async (s: any): Promise<ClassLearnerAttention> => {
      const diagnoses = await getActiveDiagnoses(s.id).catch(() => []);
      const concepts = await Promise.all(topics.map((t) => readConceptState(s.id, t, diagnoses)));
      const mine = learnerAssignments(assignments, s.id);
      return {
        studentId: s.id,
        name: s.name || s.email || '',
        attention: deriveTeacherAttention(concepts, mine),
        stages: concepts.map((c) => ({ topic: c.topic, stage: c.stage, reinforce: c.reinforce })),
        assignments: {
          completed: mine.filter((a) => a.status === 'COMPLETED').length,
          pending: mine.filter((a) => a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS').length,
          overdue: mine.filter((a) => a.status === 'EXPIRED').length,
        },
      };
    })
  );
  const rank = (l: ClassLearnerAttention) => (l.attention.length === 0 ? ATTENTION_ORDER.length : ATTENTION_ORDER.indexOf(l.attention[0].reason));
  learners.sort((a, b) => rank(a) - rank(b) || b.attention.length - a.attention.length || a.name.localeCompare(b.name));
  return { klass, learners };
}
