/**
 * B1 -- ExamGapCandidate: what Exam Preparation PUBLISHES about a learner's needs (pure).
 *
 * It EXTENDS the existing gap read (`ExamGap`, learning-plan/exam-bridge.service `deriveExamGaps`): the same
 * facts, as a candidate learning need the canonical Learning Decision Authority may weigh.
 *
 * Boundaries:
 *   - A candidate exists because the exam evidence shows it. It does not depend on the Student accepting a
 *     recommendation; acceptance governs optional plans, not whether the gap exists.
 *   - A candidate carries NO placement or activity instruction. Exam Preparation never puts an activity in
 *     Today and never names the next learning activity: prioritising is the Learning Decision Authority's,
 *     rendering is Experience's. The schema is strict, so a field such as `putIntoToday` or
 *     `nextLearningActivity` cannot be carried by it.
 *
 * Nothing here ranks candidates or writes anything. B1 defines what is published; wiring the Learning
 * Decision Authority to read it is later work.
 */
import { z } from 'zod';

export const EXAM_GAP_CANDIDATE_VERSION = 1 as const;

const ID = z.string().min(1).max(200);

export const ExamGapCandidateSchema = z.strictObject({
  v: z.literal(EXAM_GAP_CANDIDATE_VERSION),
  studentId: ID,
  /** Canonical identity of the need. */
  canonicalConceptId: ID,
  learningObjectiveId: ID.nullable(),
  /** G6: the exam target whose own attempt showed the gap. */
  examTargetId: ID,
  examAttemptId: ID,
  /** Evidence: the fraction of marks obtained on the objective in that attempt (0..1). */
  evidence: z.strictObject({ fraction: z.number().min(0).max(1), observedAt: z.string().min(1) }),
  /** Severity derived from the evidence only. */
  severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  /** Exam relevance, where the blueprint states it; never estimated. */
  relevance: z.strictObject({ assessmentComponentId: ID.nullable(), blueprintTargets: z.number().int().min(0).nullable() }),
  /** Date context of the target, for the authority to weigh; no urgency score is computed here. */
  urgency: z.strictObject({ targetDate: z.string().nullable(), intendedSession: z.strictObject({ series: z.string(), year: z.number().int() }).nullable() }),
});

export type ExamGapCandidate = z.infer<typeof ExamGapCandidateSchema>;

/** The existing gap read's row (structurally `ExamGap`). */
export interface ExamGapFacts {
  studentId: string;
  canonicalConceptId: string;
  examProfileId: string;
  examAttemptId: string;
  learningObjectiveId: string;
  fraction: number;
  at: string;
}

/** Severity from the observed fraction alone (the existing gap threshold is 0.5: below it, a gap). */
export function gapSeverity(fraction: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (fraction < 0.25) return 'HIGH';
  if (fraction < 0.5) return 'MEDIUM';
  return 'LOW';
}

export function examGapCandidateFrom(
  gap: ExamGapFacts,
  context: { assessmentComponentId?: string | null; blueprintTargets?: number | null; targetDate?: string | null; intendedSession?: { series: string; year: number } | null } = {}
): ExamGapCandidate {
  return ExamGapCandidateSchema.parse({
    v: EXAM_GAP_CANDIDATE_VERSION,
    studentId: gap.studentId,
    canonicalConceptId: gap.canonicalConceptId,
    learningObjectiveId: gap.learningObjectiveId ?? null,
    examTargetId: gap.examProfileId,
    examAttemptId: gap.examAttemptId,
    evidence: { fraction: Math.min(1, Math.max(0, gap.fraction)), observedAt: gap.at },
    severity: gapSeverity(gap.fraction),
    relevance: { assessmentComponentId: context.assessmentComponentId ?? null, blueprintTargets: context.blueprintTargets ?? null },
    urgency: { targetDate: context.targetDate ?? null, intendedSession: context.intendedSession ?? null },
  });
}

export const examGapCandidatesFrom = (gaps: readonly ExamGapFacts[]): ExamGapCandidate[] => gaps.map((g) => examGapCandidateFrom(g));
