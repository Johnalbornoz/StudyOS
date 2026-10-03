/**
 * Track B / B1 + section 20 -- where an exam item comes from.
 *
 *   1. The APPROVED BANK first: a PUBLISHED `approved_items` row for the
 *      target's learning objective (and question type / difficulty when the
 *      blueprint configures them), never one already used in this attempt.
 *      Selection is deterministic per attempt (sha256(attemptId:itemId)), so a
 *      refresh never swaps the item and two attempts get different variants.
 *      Items sharing a stimulus (PISA units, reading passages) are kept
 *      together: an item with the previous item's stimulus is preferred.
 *   2. Otherwise the EXISTING AI generator (unchanged), for the attempt
 *      owner's own concept, then validated against the blueprint target:
 *      structure / answer validity, question type, difficulty range and a
 *      published objective mapping. An invalid generation is retried once and
 *      then reported as unavailable -- never delivered, never graded, never
 *      evidence.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { generatePracticeQuestions } from '@/services/quiz-generation.service';
import { ComponentDefinitionSchema, componentDefinitionForAI } from './component-definition';
import { examItemFromApproved, examItemFromGenerated, validateExamItemStructure, type ExamItem } from './items';

export type ItemUnavailableReason = 'NO_CURRICULUM_MAPPING' | 'CONCEPT_NOT_MATCHED' | 'NO_ITEM_GENERATED';

export interface ItemSourcingTarget {
  learningObjectiveId: string;
  /** V2: the component whose definition (structure contract) the generator receives. */
  assessmentComponentId?: string;
  questionType: string | null;
  difficultyRange: { min: number; max: number } | null;
}

export type ItemSourcingResult = { outcome: 'READY'; item: ExamItem } | { outcome: 'UNAVAILABLE'; reason: ItemUnavailableReason };

function variantRank(attemptId: string, itemId: string): string {
  return createHash('sha256').update(`${attemptId}:${itemId}`).digest('hex');
}

export async function selectApprovedBankItem(params: {
  attemptId: string;
  target: ItemSourcingTarget;
  excludeApprovedItemIds: string[];
  preferredStimulusKey: string | null;
}): Promise<ExamItem | null> {
  const result = await db.query(
    `SELECT id, learning_objective_id, content FROM approved_items
      WHERE learning_objective_id = $1 AND status = 'PUBLISHED'
        AND ($2::text IS NULL OR question_type = $2)
        AND NOT (id = ANY($3::uuid[]))`,
    [params.target.learningObjectiveId, params.target.questionType, params.excludeApprovedItemIds]
  );
  const candidates = result.rows
    .map((row: any) => examItemFromApproved(row))
    .filter((item): item is ExamItem => item !== null)
    .filter((item) => !params.target.difficultyRange || (item.difficulty >= params.target.difficultyRange.min && item.difficulty <= params.target.difficultyRange.max));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aKeep = params.preferredStimulusKey !== null && a.exam.stimulus?.key === params.preferredStimulusKey ? 0 : 1;
    const bKeep = params.preferredStimulusKey !== null && b.exam.stimulus?.key === params.preferredStimulusKey ? 0 : 1;
    if (aKeep !== bKeep) return aKeep - bKeep;
    return variantRank(params.attemptId, a.id).localeCompare(variantRank(params.attemptId, b.id));
  });
  return candidates[0];
}

/** Exam-context validation of a generated item against its blueprint target (pure). */
export function validateGeneratedItemForTarget(item: ExamItem, target: ItemSourcingTarget): { valid: boolean; reasons: string[] } {
  const structural = validateExamItemStructure(item);
  const reasons = [...structural.reasons];
  if (target.questionType && item.type !== target.questionType) reasons.push(`QUESTION_TYPE_MISMATCH:${item.type}`);
  if (target.difficultyRange && (item.difficulty < target.difficultyRange.min || item.difficulty > target.difficultyRange.max)) reasons.push(`DIFFICULTY_OUT_OF_RANGE:${item.difficulty}`);
  if (item.learningObjectiveId && item.learningObjectiveId !== target.learningObjectiveId) reasons.push('OBJECTIVE_MISMATCH');
  return { valid: reasons.length === 0, reasons };
}

export async function generateValidatedItem(params: {
  studentId: string;
  target: ItemSourcingTarget;
  language: string;
  maxTries?: number;
}): Promise<ItemSourcingResult> {
  const bridge = await resolveActivityMetadataForObjective(params.target.learningObjectiveId);
  if (!bridge || bridge.canonicalConceptIds.length === 0) return { outcome: 'UNAVAILABLE', reason: 'NO_CURRICULUM_MAPPING' };

  let studentConceptId: string | null = null;
  for (const canonicalConceptId of bridge.canonicalConceptIds) {
    studentConceptId = await resolveStudentConceptForCanonicalConcept(params.studentId, canonicalConceptId);
    if (studentConceptId) break;
  }
  if (!studentConceptId) return { outcome: 'UNAVAILABLE', reason: 'CONCEPT_NOT_MATCHED' };

  const subjectRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [studentConceptId]);
  const subjectId = subjectRow.rows[0]?.subject_id;
  if (!subjectId) return { outcome: 'UNAVAILABLE', reason: 'NO_CURRICULUM_MAPPING' };

  const range = params.target.difficultyRange;
  const midDifficulty = range ? Math.round((range.min + range.max) / 2) : undefined;
  // V2: the component definition is the structure contract -- the generator fills content inside it, never invents structure.
  let contract: string | null = null;
  if (params.target.assessmentComponentId) {
    const def = await db.query(`SELECT definition FROM assessment_components WHERE id = $1`, [params.target.assessmentComponentId]).catch(() => ({ rows: [] as any[] }));
    const parsed = def.rows[0]?.definition ? ComponentDefinitionSchema.safeParse(def.rows[0].definition) : null;
    if (parsed?.success) contract = componentDefinitionForAI(parsed.data);
  }
  const guidance = [params.target.questionType ? `Use exactly this question type: ${params.target.questionType}.` : '', contract ?? ''].filter(Boolean).join('\n\n') || undefined;
  const maxTries = Math.max(1, Math.min(2, params.maxTries ?? 2));

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    let questions;
    try {
      questions = await generatePracticeQuestions(studentConceptId, params.studentId, subjectId, { count: 1, difficulty: midDifficulty, guidance, language: params.language, activityType: 'EXAM_SIMULATION' });
    } catch (err) {
      console.log('[exam-core]', JSON.stringify({ at: 'ai_item_generation_failed', attempt, error: err instanceof Error ? err.name : 'unknown' }));
      continue;
    }
    const question = questions[0];
    if (!question) continue;
    const item = examItemFromGenerated(question, params.target.learningObjectiveId);
    const verdict = validateGeneratedItemForTarget(item, params.target);
    if (verdict.valid) return { outcome: 'READY', item };
    console.log('[exam-core]', JSON.stringify({ at: 'ai_item_rejected', attempt, reasons: verdict.reasons }));
  }
  return { outcome: 'UNAVAILABLE', reason: 'NO_ITEM_GENERATED' };
}

export async function sourceExamItem(params: {
  attemptId: string;
  studentId: string;
  target: ItemSourcingTarget;
  excludeApprovedItemIds: string[];
  preferredStimulusKey: string | null;
  language: string;
}): Promise<ItemSourcingResult> {
  const banked = await selectApprovedBankItem(params);
  if (banked) return { outcome: 'READY', item: banked };
  return generateValidatedItem({ studentId: params.studentId, target: params.target, language: params.language });
}
