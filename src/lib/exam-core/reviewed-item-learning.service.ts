/**
 * Reviewed Question Bank items as questions a LEARNING session can deliver.
 *
 * A reviewed item is the existing question shape plus exam-only material: marked parts, a shared stimulus,
 * a mathematical key, a rubric, a portfolio task. A learning session has one answer control and the shared
 * per-question grader, so it can present faithfully only an item that needs none of that material. An item
 * that does is not deliverable here: it is left out, never shown without what it depends on.
 *
 * The exam-only metadata does not travel with the question (it holds accepted answers and marking keys).
 *
 * `loadReviewedLearningQuestions` is a Student reader of the bank: like every other one it filters through
 * the ONE Student delivery rule (`lifecycleSqlFor`), here for PRACTICE and the STUDENT audience. It reads
 * items already chosen and frozen by the Blueprint Core; it selects nothing and never produces content.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { examItemFromApproved } from './items';
import { lifecycleSqlFor } from './question-bank/lifecycle';

export interface ReviewedItemRow {
  id: string;
  learning_objective_id: string;
  content: unknown;
}

/** Pure. null = this item cannot be presented by a learning session as it is. */
export function reviewedItemAsLearningQuestion(row: ReviewedItemRow): GeneratedQuestion | null {
  const item = examItemFromApproved(row);
  if (!item) return null;
  const { exam, ...question } = item;
  if (exam.parts || exam.stimulus || exam.math || exam.method || exam.rubric || exam.portfolio) return null;
  return question;
}

/** The deliverable questions among these item versions, by id. An id that is absent may not be delivered. */
export async function loadReviewedLearningQuestions(approvedItemIds: readonly string[], client: DbExecutor = db): Promise<Map<string, GeneratedQuestion>> {
  const out = new Map<string, GeneratedQuestion>();
  if (approvedItemIds.length === 0) return out;
  const r = await client.query(
    `SELECT ai.id, ai.learning_objective_id, ai.content FROM approved_items ai WHERE ai.id = ANY($1::uuid[]) AND ai.status = 'PUBLISHED' AND ${lifecycleSqlFor('PRACTICE', undefined, 'STUDENT')}`,
    [[...new Set(approvedItemIds)]]
  );
  for (const row of r.rows as ReviewedItemRow[]) {
    const question = reviewedItemAsLearningQuestion(row);
    if (question) out.set(row.id, question);
  }
  return out;
}
