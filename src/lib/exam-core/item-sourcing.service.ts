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
import { lifecycleSqlFor } from './question-bank/lifecycle';
import { contentAudienceFor, examAudienceOf, type ContentAudience } from './audience';

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
  /** Question Bank V2 exposure memory: prefer items this Student has not seen, then lower global exposure. */
  studentId?: string;
  /** STUDENT (default): never a DEV fixture. */
  contentAudience?: ContentAudience;
}): Promise<ExamItem | null> {
  // Practice-usable versions only (usage eligibility + lifecycle; a legacy row keeps every use).
  const result = await db.query(
    `SELECT ai.id, ai.learning_objective_id, ai.content,
            EXISTS (SELECT 1 FROM exam_item_usage u WHERE u.approved_item_id = ai.id AND u.student_id = $4::uuid) AS seen,
            (SELECT count(DISTINCT u.student_id) FROM exam_item_usage u WHERE u.approved_item_id = ai.id)::int AS exposure
       FROM approved_items ai
      WHERE ai.learning_objective_id = $1 AND ai.status = 'PUBLISHED' AND ${lifecycleSqlFor('PRACTICE', undefined, params.contentAudience ?? 'STUDENT')}
        AND ($2::text IS NULL OR ai.question_type = $2)
        AND NOT (ai.id = ANY($3::uuid[]))`,
    [params.target.learningObjectiveId, params.target.questionType, params.excludeApprovedItemIds, params.studentId ?? null]
  );
  const seen = new Map(result.rows.map((r: any) => [r.id as string, { seen: !!r.seen, exposure: Number(r.exposure ?? 0) }]));
  const candidates = result.rows
    .map((row: any) => examItemFromApproved(row))
    .filter((item): item is ExamItem => item !== null)
    .filter((item) => !params.target.difficultyRange || (item.difficulty >= params.target.difficultyRange.min && item.difficulty <= params.target.difficultyRange.max));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aKeep = params.preferredStimulusKey !== null && a.exam.stimulus?.key === params.preferredStimulusKey ? 0 : 1;
    const bKeep = params.preferredStimulusKey !== null && b.exam.stimulus?.key === params.preferredStimulusKey ? 0 : 1;
    if (aKeep !== bKeep) return aKeep - bKeep;
    const sa = seen.get(a.id)!;
    const sb = seen.get(b.id)!;
    if (sa.seen !== sb.seen) return Number(sa.seen) - Number(sb.seen);
    if (sa.exposure !== sb.exposure) return sa.exposure - sb.exposure;
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

/**
 * The content audience of a delivery: TECHNICAL_DEMO for a technical / internal exam or an in-process technical
 * demo instance, STUDENT otherwise (and whenever it cannot be resolved). `to_jsonb(i)` keeps this working on a
 * database where the instance audience column (20261031_1000) is not applied yet.
 */
export async function deliveryContentAudience(attemptId: string): Promise<ContentAudience> {
  const r = await db
    .query(
      `SELECT d.config_key, to_jsonb(i)->>'content_audience' AS instance_audience
         FROM simulation_attempts sa JOIN exam_versions v ON v.id = sa.exam_version_id JOIN exam_definitions d ON d.id = v.exam_definition_id
         LEFT JOIN exam_instances i ON i.simulation_attempt_id = sa.id
        WHERE sa.id = $1 LIMIT 1`,
      [attemptId]
    )
    .catch(() => ({ rows: [] as any[] }));
  const row = r.rows[0];
  if (!row) return 'STUDENT';
  return contentAudienceFor(examAudienceOf(row.config_key), row.instance_audience === 'TECHNICAL_DEMO' ? 'TECHNICAL_DEMO' : 'STUDENT');
}

export async function sourceExamItem(params: {
  attemptId: string;
  studentId: string;
  target: ItemSourcingTarget;
  excludeApprovedItemIds: string[];
  preferredStimulusKey: string | null;
  language: string;
}): Promise<ItemSourcingResult> {
  const banked = await selectApprovedBankItem({ ...params, contentAudience: await deliveryContentAudience(params.attemptId) });
  if (banked) {
    // Exposure memory: this Student has now seen this version (best effort; never blocks delivery).
    await db
      .query(
        `INSERT INTO exam_item_usage (student_id, approved_item_id, semantic_fingerprint, template_fingerprint, delivery_use)
         SELECT $1, ai.id, ai.semantic_fingerprint, ai.template_fingerprint, 'PRACTICE' FROM approved_items ai WHERE ai.id = $2`,
        [params.studentId, banked.exam.approvedItemId]
      )
      .catch(() => undefined);
    return { outcome: 'READY', item: banked };
  }
  return generateValidatedItem({ studentId: params.studentId, target: params.target, language: params.language });
}
