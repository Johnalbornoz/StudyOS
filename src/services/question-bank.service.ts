/**
 * LEARNING_ACTIVITY_DELIVERY -- the VALIDATED question bank.
 *
 * Every question that passed a certified generation pipeline (Quality Gate,
 * semantic verification, novelty) is stored once as a VALIDATED candidate
 * for its (concept, activity type, language, academic context). Activities
 * are then assembled from the bank with no AI call. Concept-scoped, so a
 * candidate can never reach another learner.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { fingerprintQuestion } from '@/lib/lx/exact-duplicate-novelty';
import { questionSignature } from '@/lib/lx/question-diversity';
import { academicContextFingerprint, type AcademicContext, type DeliveryActivityType } from '@/lib/activity-delivery/contract';
import type { BankCandidate } from '@/lib/activity-delivery/assembly';

export interface BankInsertMeta {
  studentId: string;
  conceptId: string;
  activityType: DeliveryActivityType;
  language: string;
  academic: AcademicContext;
  generator: { provider: string | null; model: string | null; promptId: string | null; promptVersion: string; operationId: string | null };
}

function clampDifficulty(d: unknown): number {
  const n = Math.round(Number(d));
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
}

/**
 * Stores quality-gated questions as VALIDATED candidates (idempotent on
 * content). Returns the candidate id of every question (new or already
 * banked), aligned with the input, and how many were new.
 */
export async function addValidatedCandidates(questions: GeneratedQuestion[], meta: BankInsertMeta, client: DbExecutor = db): Promise<{ inserted: number; ids: Array<string | null> }> {
  let inserted = 0;
  const ids: Array<string | null> = [];
  const academicFp = academicContextFingerprint(meta.academic);
  for (const q of questions) {
    if (!q || typeof q.question !== 'string' || !q.question.trim()) {
      ids.push(null);
      continue;
    }
    const contentFingerprint = fingerprintQuestion(q);
    const r = await client.query(
      `INSERT INTO question_bank_candidates (student_id, concept_id, activity_type, language, academic_context, academic_context_fingerprint,
                                             difficulty, question_type, answer_format, reasoning_type, cognitive_level, question_intent,
                                             skill_target, misconception_target, transfer_depth, question, content_fingerprint, template_signature,
                                             generator_provider, generator_model, generator_prompt_id, generator_prompt_version, generation_operation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       ON CONFLICT (concept_id, activity_type, language, content_fingerprint) DO NOTHING
       RETURNING id`,
      [
        meta.studentId, meta.conceptId, meta.activityType, meta.language, JSON.stringify(meta.academic), academicFp,
        clampDifficulty(q.difficulty), q.type, q.answerFormat ?? 'text', q.expectedReasoningType ?? null, q.cognitiveLevel ?? null,
        q.questionIntent ?? null, q.learningObjectiveId ?? null, (q as { misconceptionTarget?: string }).misconceptionTarget ?? null,
        q.transferDepth ?? null, JSON.stringify(q), contentFingerprint, JSON.stringify(questionSignature(q, meta.language)),
        meta.generator.provider, meta.generator.model, meta.generator.promptId, meta.generator.promptVersion, meta.generator.operationId,
      ],
    );
    if (r.rows[0]?.id) {
      inserted++;
      ids.push(r.rows[0].id);
    } else {
      const existing = await client.query(
        `SELECT id FROM question_bank_candidates WHERE concept_id = $1 AND activity_type = $2 AND language = $3 AND content_fingerprint = $4`,
        [meta.conceptId, meta.activityType, meta.language, contentFingerprint],
      );
      ids.push(existing.rows[0]?.id ?? null);
    }
  }
  return { inserted, ids };
}

/** Most candidates one assembly considers. */
export const BANK_POOL_LIMIT = 400;

/**
 * The VALIDATED pool for one activity contract, with per-learner delivery
 * state. The pool is bounded, so WHICH rows it holds matters: never
 * delivered first, then least used, then newest. With `excludeDelivered`
 * (independent checks, which can never reuse an item) delivered rows are
 * not loaded at all -- otherwise a long-lived bank whose oldest rows were
 * all delivered would look empty.
 */
export async function loadBankPool(
  params: { studentId: string; conceptId: string; activityType: DeliveryActivityType; language: string; academic: AcademicContext; excludeDelivered: boolean },
  client: DbExecutor = db,
): Promise<BankCandidate[]> {
  const r = await client.query(
    `SELECT * FROM (
       SELECT c.id, c.question, c.difficulty, c.content_fingerprint, c.transfer_depth, c.usage_count, c.created_at,
              EXISTS (SELECT 1 FROM question_bank_deliveries d WHERE d.candidate_id = c.id AND d.student_id = $1) AS delivered
         FROM question_bank_candidates c
        WHERE c.concept_id = $2 AND c.student_id = $1 AND c.activity_type = $3 AND c.language = $4
          AND c.academic_context_fingerprint = $5 AND c.validation_status = 'VALIDATED'
     ) pool
     WHERE NOT ($6::boolean AND pool.delivered)
     ORDER BY pool.delivered, pool.usage_count, pool.created_at DESC
     LIMIT $7`,
    [params.studentId, params.conceptId, params.activityType, params.language, academicContextFingerprint(params.academic), params.excludeDelivered, BANK_POOL_LIMIT],
  );
  return r.rows.map((row) => ({
    id: row.id,
    question: row.question,
    difficulty: Number(row.difficulty),
    contentFingerprint: row.content_fingerprint,
    transferDepth: row.transfer_depth,
    usageCount: Number(row.usage_count),
    delivered: row.delivered === true,
  }));
}

/** Records which candidates were delivered in a session (idempotent) and bumps their usage. */
export async function recordBankDeliveries(candidateIds: string[], quizSessionId: string, studentId: string, client: DbExecutor = db): Promise<void> {
  if (candidateIds.length === 0) return;
  await client.query(
    `WITH ins AS (
       INSERT INTO question_bank_deliveries (candidate_id, quiz_session_id, student_id)
       SELECT unnest($1::uuid[]), $2, $3
       ON CONFLICT DO NOTHING
       RETURNING candidate_id
     )
     UPDATE question_bank_candidates SET usage_count = usage_count + 1, last_used_at = now()
      WHERE id IN (SELECT candidate_id FROM ins)`,
    [candidateIds, quizSessionId, studentId],
  );
}
