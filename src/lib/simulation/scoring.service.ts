/**
 * F9 -- scoring integration (task §28), extended by Track B: grading now goes
 * through the exam-core item grader (`gradeExamItem`), which REUSES the
 * existing graders (gradeStructuredAnswer / gradeAnswer) and adds only
 * answer-shape validation, deterministic keyed text answers and multi-part
 * mark schemes. Persistence stays F7's real recordExamAttemptItemResponse.
 * No exam-family branching anywhere.
 */
import { db } from '@/lib/db';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { recordExamAttemptItemResponse } from '@/lib/assessment/evaluation.service';
import type { EvaluationResult } from '@/lib/assessment/types';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { updateMastery } from '@/services/mastery.service';
import { examItemFromGenerated, type ExamItem } from '@/lib/exam-core/items';
import { gradeExamItem, gradeFromRubricOutcome, invalidExamItemGrade, type ExamItemGrade } from '@/lib/exam-core/item-grading';
import { assessSubmission, parsePortfolioAnswer, resolveSubmissionForAnswer, SubmissionError } from '@/lib/exam-core/submissions/submission.service';
import { recordAssessments } from '@/lib/exam-core/assessment/assessment-store';
import { examEvidenceScopeMetadata } from '@/lib/exam-core/evidence-scope';

function isExamItem(q: GeneratedQuestion | ExamItem): q is ExamItem {
  return !!(q as ExamItem).exam;
}

/**
 * Also writes real learning_evidence for the response, through the
 * SAME writer F7's own evidence-bridge and F8's evidence-integration
 * already use (updateMastery, sourceType 'EXAM_SIMULATION' -- the
 * pre-existing F5 evidence source type, never a new one). A simulation
 * attempt is independent evidence by definition (no hint/scaffold path
 * exists inside an exam attempt, and the Tutor is restricted while an
 * attempt is open) -- ai_assistance_type is always 'NONE'. Metadata keys
 * are attached only when genuinely resolved, never fabricated (mirrors
 * F7/F8's own INV-F7-18/INV-F8-12 discipline).
 *
 * Track B: an INVALID response (an answer the rendered controls could never
 * have produced) is recorded with score 0 but NEVER becomes evidence.
 *
 * G6: the evidence carries its exam identity (`metadata.examScope`: target,
 * version, attempt) captured HERE, from the attempt itself -- it keeps
 * feeding the one Knowledge State per concept, but only its own exam target
 * may read it as exam-requirement evidence (see exam-core/evidence-scope.ts).
 */
export async function recordSimulationItemResponse(params: {
  examAttemptId: string;
  studentId: string;
  examVersionId: string;
  /** G6: the Student's exam target (student_exam_profiles.id) of this attempt. Read from the attempt when omitted; a mismatch is refused. */
  examTargetId?: string;
  assessmentComponentId: string;
  learningObjectiveId?: string;
  commandTermId?: string | null;
  /** The SERVER-HELD item (never a client-supplied question). A bare GeneratedQuestion is treated as a 1-mark AI item. */
  question: GeneratedQuestion | ExamItem;
  studentAnswer: string;
  language?: string;
  /**
   * Task §54/AC-F9-28: a caller-supplied, stable id for THIS logical
   * submission (minted once, round-tripped unchanged through any
   * transport retry -- never regenerated per attempt, which would make
   * every retry look new). When a response already exists for
   * (examAttemptId, idempotencyKey), that EXISTING response is
   * returned untouched -- the grader is never re-invoked and NO
   * duplicate Evidence is ever written.
   */
  idempotencyKey?: string;
  /** Track B: the item's position in the frozen plan -- at most one committed response per item. */
  targetIndex?: number;
}): Promise<{ responseId: string; evaluation: EvaluationResult; evidenceWritten: boolean; duplicate: boolean; grade: ExamItemGrade }> {
  const item: ExamItem = isExamItem(params.question) ? params.question : examItemFromGenerated(params.question, params.learningObjectiveId ?? null);
  let submissionId: string | null = null;
  const grade = await gradeExamItem(item, params.studentAnswer, params.language ?? 'en', {
    // V2: a portfolio task is answered with the Student's own submission for THIS attempt position.
    portfolioGrader: async (it, answer) => {
      const requested = parsePortfolioAnswer(answer);
      const bound = requested ? await resolveSubmissionForAnswer({ examAttemptId: params.examAttemptId, targetIndex: params.targetIndex, studentId: params.studentId, submissionId: requested }) : null;
      if (!bound) return invalidExamItemGrade(it, answer, 'SUBMISSION_NOT_FOUND');
      try {
        const { outcome, humanOnlyArtifacts } = await assessSubmission({ submissionId: bound, studentId: params.studentId, item: it, language: params.language ?? 'en' });
        submissionId = bound;
        return gradeFromRubricOutcome(it, answer, outcome, it.exam.portfolio!.rubric, { submissionId: bound, humanOnlyArtifacts });
      } catch (err) {
        if (err instanceof SubmissionError && err.code === 'INCOMPLETE') return invalidExamItemGrade(it, answer, 'SUBMISSION_INCOMPLETE');
        throw err;
      }
    },
  });
  const evaluation = grade.evaluation;

  const { id, duplicate } = await recordExamAttemptItemResponse({
    examAttemptId: params.examAttemptId,
    assessmentComponentId: params.assessmentComponentId,
    learningObjectiveId: params.learningObjectiveId,
    approvedItemId: item.exam.approvedItemId ?? undefined,
    itemSnapshot: item as unknown as Record<string, unknown>,
    evaluation,
    idempotencyKey: params.idempotencyKey,
    targetIndex: params.targetIndex,
    itemSource: item.exam.source,
    v2: {
      normalizedResponse: grade.normalizedResponse,
      gradingDetail: grade.detail,
      reviewStatus: grade.reviewStatus,
      contentOrigin: item.exam.contentOrigin ?? null,
      scoringStrategy: grade.scoringStrategy,
      strictScore: grade.strictFraction * grade.maxMarks,
    },
  });
  if (!duplicate && grade.assessments.length > 0) {
    await recordAssessments({ responseId: id, submissionId: submissionId ?? undefined }, grade.assessments, item.exam.key ?? item.exam.approvedItemId);
  }

  if (duplicate) {
    // The first application already wrote Evidence (if any) -- a retry
    // must never re-run updateMastery a second time for the same
    // logical submission.
    return { responseId: id, evaluation, evidenceWritten: false, duplicate: true, grade };
  }

  let evidenceWritten = false;
  // V2: a response awaiting review is not evidence until a reviewer confirms its mark.
  if (grade.status === 'ANSWERED' && grade.reviewStatus === 'NONE' && params.learningObjectiveId) {
    const bridge = await resolveActivityMetadataForObjective(params.learningObjectiveId);
    if (bridge && bridge.canonicalConceptIds.length > 0) {
      let studentConceptId: string | null = null;
      for (const canonicalConceptId of bridge.canonicalConceptIds) {
        studentConceptId = await resolveStudentConceptForCanonicalConcept(params.studentId, canonicalConceptId);
        if (studentConceptId) break;
      }
      if (studentConceptId) {
        const subjectRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [studentConceptId]);
        const subjectId = subjectRow.rows[0]?.subject_id;
        if (subjectId) {
          const metadata: Record<string, unknown> = { context: { examAttemptId: params.examAttemptId, simulationSource: true, itemSource: item.exam.source } };
          if (bridge.skillIds.length > 0) metadata.skillIds = bridge.skillIds;
          metadata.framework = { examVersionId: params.examVersionId };
          const examTargetId = await attemptTargetId(params.examAttemptId, params.examTargetId);
          if (examTargetId) metadata.examScope = examEvidenceScopeMetadata({ examTargetId, examVersionId: params.examVersionId, examAttemptId: params.examAttemptId });
          if (params.commandTermId) metadata.commandTermId = params.commandTermId;
          if (item.type) metadata.questionType = item.type;

          await updateMastery({
            studentId: params.studentId,
            conceptId: studentConceptId,
            subjectId,
            evidence: { sourceType: 'EXAM_SIMULATION', result: grade.fraction >= 1 ? 'correct' : grade.fraction > 0 ? 'partial' : 'incorrect', difficulty: item.difficulty, scorePercent: grade.fraction * 100 },
            telemetry: { activityType: 'EXAM_SIMULATION', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' },
            metadata,
            identity: params.idempotencyKey ? { operationType: 'EXAM_SIMULATION_RESPONSE', operationId: params.idempotencyKey, conceptId: studentConceptId } : undefined,
          });
          evidenceWritten = true;
        }
      }
    }
  }

  return { responseId: id, evaluation, evidenceWritten, duplicate: false, grade };
}

/**
 * G6: the exam target of an attempt, from its own NOT NULL foreign key (never inferred). A caller-supplied
 * target must agree with it. Unreadable attempt -> null: the evidence still carries context.examAttemptId,
 * which identifies the same target deterministically.
 */
async function attemptTargetId(examAttemptId: string, claimed: string | undefined): Promise<string | null> {
  const row = (await db.query(`SELECT student_exam_profile_id FROM exam_attempts WHERE id = $1`, [examAttemptId])).rows?.[0];
  const target = (row?.student_exam_profile_id as string | undefined) ?? null;
  if (target && claimed && claimed !== target) throw new Error(`G6: exam target mismatch for attempt ${examAttemptId}`);
  return target;
}

export async function getSimulationScoreSummary(examAttemptId: string): Promise<{ rawScore: number; maxScore: number; byComponent: Record<string, { score: number; maxScore: number }> }> {
  const result = await db.query(`SELECT assessment_component_id, score, max_score FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttemptId]);
  const byComponent: Record<string, { score: number; maxScore: number }> = {};
  let rawScore = 0;
  let maxScore = 0;
  for (const row of result.rows) {
    const s = Number(row.score) || 0;
    const m = Number(row.max_score) || 0;
    rawScore += s;
    maxScore += m;
    if (!byComponent[row.assessment_component_id]) byComponent[row.assessment_component_id] = { score: 0, maxScore: 0 };
    byComponent[row.assessment_component_id].score += s;
    byComponent[row.assessment_component_id].maxScore += m;
  }
  return { rawScore, maxScore, byComponent };
}
