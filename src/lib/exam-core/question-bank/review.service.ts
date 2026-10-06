/**
 * Question Bank V2 -- HUMAN CERTIFICATION (DB).
 *
 *   AI generates -> the automated pipeline validates -> (an editor may correct: a NEW version)
 *   -> a DIFFERENT person certifies: Approve / Request correction / Reject.
 *
 * Approve records the reviewer's validated difficulty, usage eligibility and exam alignment
 * on the version and moves it to ACTIVE (generated content cannot become ACTIVE without an
 * APPROVED review -- enforced again by the DB trigger `question_bank_quality_guard`).
 * Request correction -> REVIEW_REQUIRED; Reject -> REJECTED (excluded from every use).
 * Every decision is an append-only `question_bank_reviews` row + a lifecycle audit event.
 */
import type { PoolClient } from 'pg';
import { db } from '@/lib/db';
import { createNextVersion, transitionVersion } from './bank.service';
import { checkReview, ReviewError, type ExamAlignment, type ReviewDecision, type ReviewInput, type UsageType } from './quality';
import { runDeterministicValidation } from './validation';
import { cellSpecFor } from './queue.service';
import { loadVersionHealthInputs } from './health.service';
import { deliveryStatusFor, type LifecycleState } from './lifecycle';
import type { Provenance } from './policy';
import { attentionPointsFor, difficultyInternal, PilotReviewAssessmentSchema, proposalFromContent } from './pilots/human-review';

async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export interface ReviewResult {
  reviewId: string;
  decision: ReviewDecision;
  lifecycle: LifecycleState;
  usage: UsageType[] | null;
  alignment: ExamAlignment | null;
}

export async function reviewVersion(p: { versionId: string; reviewerUserId: string; input: ReviewInput }): Promise<ReviewResult> {
  return withTx(async (c) => {
    const r = await c.query(
      `SELECT ai.id, ai.bank_item_id, ai.bank_lifecycle_status, ai.created_by, ai.validation_report, ai.learning_objective_id, ai.content, qi.provenance, qi.item_key,
              (SELECT gr.generation_params->'pilot'->'reviewChecklist' FROM question_bank_generation_requests gr WHERE gr.id = qi.generation_request_id) AS required_checklist,
              (SELECT gr.generation_params->'pilot'->>'batch' FROM question_bank_generation_requests gr WHERE gr.id = qi.generation_request_id) AS pilot_batch,
              EXISTS (SELECT 1 FROM blueprint_objective_targets t WHERE t.learning_objective_id = ai.learning_objective_id) AS in_cell
         FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE ai.id = $1 FOR UPDATE OF ai`,
      [p.versionId]
    );
    const row = r.rows[0];
    if (!row) throw new ReviewError('NOT_REVIEWABLE', 'not found');
    const requiredChecklist = Array.isArray(row.required_checklist) ? row.required_checklist : null;
    // A governed pilot item: the reviewer also records what THEY determine (pilots/human-review.ts).
    const pilot = requiredChecklist?.length ? { proposal: proposalFromContent(row.content), attentionPointCodes: attentionPointsFor(row.item_key, row.pilot_batch ?? '').map((x) => x.code) } : null;
    const decided = checkReview(
      { provenance: row.provenance as Provenance, lifecycle: row.bank_lifecycle_status, createdBy: row.created_by, automatedOutcome: row.validation_report?.outcome ?? (row.provenance === 'STUDYUS_GENERATED' ? null : 'PASS'), inBlueprintCell: row.in_cell, requiredChecklist, pilot },
      p.input,
      p.reviewerUserId
    );
    const decision = p.input.decision;
    const assessment = pilot ? PilotReviewAssessmentSchema.parse(p.input.assessment) : null;
    // Pilot: the validated difficulty IS the reviewer's StudyUs difficulty (never a pre-filled default).
    const validatedDifficulty = assessment ? difficultyInternal(assessment.reviewedDifficulty) : p.input.validatedDifficulty;
    const automated = row.validation_report ? JSON.stringify({ outcome: row.validation_report.outcome ?? null, stage: row.validation_report.stage ?? null, issues: (row.validation_report.issues ?? []).map((i: any) => i.code) }) : null;
    const baseValues = [p.versionId, row.bank_item_id, decision, p.reviewerUserId, p.input.notes?.trim() || null, validatedDifficulty, decision === 'APPROVED' ? decided.usage : null, decision === 'APPROVED' ? decided.alignment : null, automated];
    // The checklist column (20261101_1000) is written only when a checklist is given (pilot items).
    const checklist = p.input.checklist && Object.keys(p.input.checklist).length ? p.input.checklist : null;
    // The structured assessment column (20261104_1000) is written only for pilot items.
    const ins = assessment
      ? await c.query(
          `INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, review_notes, validated_difficulty, usage_eligibility, exam_alignment, automated_validation, review_checklist, review_assessment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [...baseValues, JSON.stringify(checklist), JSON.stringify(assessment)]
        )
      : checklist
      ? await c.query(
          `INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, review_notes, validated_difficulty, usage_eligibility, exam_alignment, automated_validation, review_checklist)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [...baseValues, JSON.stringify(checklist)]
        )
      : await c.query(
          `INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, review_notes, validated_difficulty, usage_eligibility, exam_alignment, automated_validation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          baseValues
        );
    const actor = { kind: 'ADMIN' as const, userId: p.reviewerUserId };
    let to: LifecycleState;
    if (decision === 'APPROVED') {
      await c.query(`UPDATE approved_items SET usage_eligibility = $2, exam_alignment = $3, validated_difficulty = COALESCE($4, validated_difficulty) WHERE id = $1`, [p.versionId, decided.usage, decided.alignment, validatedDifficulty]);
      to = row.bank_lifecycle_status === 'CALIBRATED' ? 'CALIBRATED' : 'ACTIVE';
      if (row.bank_lifecycle_status === 'VALIDATED' && row.provenance === 'STUDYUS_GENERATED') {
        await transitionVersion({ versionId: p.versionId, to: 'PILOT', reason: 'REVIEW:PILOT_BEFORE_ACTIVE', actor }, c);
      }
      if (row.bank_lifecycle_status === 'REVIEW_REQUIRED') {
        // A reviewed item goes back into service at the stage it had earned (generated: PILOT first).
        await transitionVersion({ versionId: p.versionId, to: row.provenance === 'STUDYUS_GENERATED' ? 'PILOT' : 'ACTIVE', reason: 'REVIEW:CLEARED', actor }, c);
      }
    } else if (decision === 'REJECTED') {
      // Through the governed table: a delivered / piloting version is first held for review, then rejected.
      if (['PILOT', 'CALIBRATED', 'ACTIVE', 'SUSPENDED'].includes(row.bank_lifecycle_status)) {
        await transitionVersion({ versionId: p.versionId, to: 'REVIEW_REQUIRED', reason: 'REVIEW:HOLD_BEFORE_REJECTION', actor }, c);
      }
      to = 'REJECTED';
    } else {
      if (row.bank_lifecycle_status === 'VALIDATED') {
        await transitionVersion({ versionId: p.versionId, to: 'PILOT', reason: 'REVIEW:PILOT_BEFORE_CORRECTION', actor }, c);
      }
      to = 'REVIEW_REQUIRED';
    }
    await transitionVersion({ versionId: p.versionId, to, reason: `REVIEW:${decision}${p.input.notes ? `:${p.input.notes.slice(0, 200)}` : ''}`, actor, detail: { reviewId: ins.rows[0].id, usage: decided.usage, alignment: decided.alignment, validatedDifficulty } }, c);
    return { reviewId: ins.rows[0].id, decision, lifecycle: to, usage: decision === 'APPROVED' ? decided.usage : null, alignment: decision === 'APPROVED' ? decided.alignment : null };
  });
}

/**
 * An EDITOR corrects a version: the correction is a NEW version (never an overwrite), validated
 * automatically again; it needs a review by someone other than its editor before ACTIVE.
 */
export async function correctVersion(p: { versionId: string; editorUserId: string; patch: { question?: string; options?: Array<{ id: string; text: string }>; correctAnswer?: string; explanation?: string; difficulty?: number }; notes: string }): Promise<{ versionId: string; versionNumber: number; lifecycle: LifecycleState; issues: string[] }> {
  const r = await db.query(
    `SELECT ai.id, ai.bank_item_id, ai.content, ai.learning_objective_id, ai.question_type, ai.bank_lifecycle_status, ai.validation_report, qi.exam_version_id, qi.cell_key, qi.current_version_id
       FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE ai.id = $1`,
    [p.versionId]
  );
  const row = r.rows[0];
  if (!row) throw new ReviewError('NOT_REVIEWABLE', 'not found');
  if (row.current_version_id !== p.versionId) throw new ReviewError('NOT_REVIEWABLE', 'only the current version can be corrected');
  const content = { ...row.content, ...Object.fromEntries(Object.entries(p.patch).filter(([, v]) => v !== undefined)) };
  const delivered = !!row.bank_lifecycle_status && deliveryStatusFor(row.bank_lifecycle_status as LifecycleState) === 'PUBLISHED';
  const next = await createNextVersion({
    bankItemId: row.bank_item_id,
    version: { content, learningObjectiveId: row.learning_objective_id, questionType: row.question_type, targetDifficulty: typeof content.difficulty === 'number' ? content.difficulty : null },
    lifecycle: 'VALIDATING',
    // A version Students could already receive stays current until the correction is certified.
    replaceNow: !delivered,
    reason: `CORRECTION:${p.notes.slice(0, 200)}`,
    actor: { kind: 'ADMIN', userId: p.editorUserId },
  });
  // Automated validation again (deterministic stages; the verification material carries over).
  const inputs = row.exam_version_id ? await loadVersionHealthInputs(row.exam_version_id) : null;
  const cell = inputs?.cells.find((c) => c.cellKey === row.cell_key);
  let issues: string[] = [];
  let lifecycle: LifecycleState = 'VALIDATING';
  if (inputs && cell) {
    const spec = cellSpecFor(cell, inputs);
    const existing = inputs.texts.filter((t) => t.learningObjectiveId === cell.learningObjectiveId && t.versionId !== p.versionId && t.versionId !== next.versionId).map((t) => ({ versionId: t.versionId, question: t.question, stimulusText: t.stimulusText }));
    const det = runDeterministicValidation(content, spec, row.validation_report?.verification ?? { verificationExpression: null, evidenceQuote: null }, existing);
    issues = det.issues.map((i) => i.code);
    const outcome = det.outcome === 'PASS' || det.outcome === 'NEEDS_AI_VALIDATION' ? 'PASS' : det.outcome;
    await db.query(`UPDATE approved_items SET validation_report = $2 WHERE id = $1`, [next.versionId, JSON.stringify({ stage: 'DETERMINISTIC', outcome, issues: det.issues, corrected: true, verification: row.validation_report?.verification ?? null })]);
    if (outcome === 'PASS') {
      await transitionVersion({ versionId: next.versionId, to: 'VALIDATED', reason: 'CORRECTION_VALIDATED', actor: { kind: 'SYSTEM' } });
      await transitionVersion({ versionId: next.versionId, to: 'PILOT', reason: 'PILOT_ENTRY', actor: { kind: 'SYSTEM' } });
      lifecycle = 'PILOT';
    } else {
      await transitionVersion({ versionId: next.versionId, to: 'REVIEW_REQUIRED', reason: issues.join(',') || 'CORRECTION_FAILED_VALIDATION', actor: { kind: 'SYSTEM' } });
      lifecycle = 'REVIEW_REQUIRED';
    }
  }
  return { versionId: next.versionId, versionNumber: next.versionNumber, lifecycle, issues };
}
