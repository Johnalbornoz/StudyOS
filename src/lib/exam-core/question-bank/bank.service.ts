/**
 * Question Bank Factory -- the BANK CORE (DB): stable items, immutable
 * versions, governed transitions with audit history.
 *
 *   question_bank_items  -- stable identity; `current_version_id` is the version
 *                           that represents the item now;
 *   approved_items       -- one row per immutable version (the existing delivery /
 *                           grading / attempt references keep pointing at it);
 *   question_bank_lifecycle_events -- append-only audit of every transition.
 *
 * A correction is a NEW version: the version an attempt used is never
 * rewritten (a DB trigger refuses it), and the old version is superseded only
 * when the new one becomes deliverable, so delivery never has a gap.
 */
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { db } from '@/lib/db';
import { itemFingerprints } from '../fingerprints';
import { ApprovedItemContentSchema, contentOriginOf } from '../items';
import { assertTransition, deliveryStatusFor, LifecycleTransitionError, type LifecycleState, type TransitionActor } from './lifecycle';
import { provenanceFromOrigin, type Provenance } from './policy';

export class BankError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'NO_SYSTEM_IDENTITY' | 'INVALID_CONTENT' | 'RETIRED', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BankError';
  }
}

export function contentHash(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

async function withTx<T>(fn: (c: PoolClient) => Promise<T>, outer?: PoolClient): Promise<T> {
  if (outer) return fn(outer);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function systemAuthorId(client: Pick<PoolClient, 'query'> = db): Promise<string> {
  const r = await client.query(`SELECT id FROM users WHERE is_system = true ORDER BY created_at ASC, id ASC LIMIT 1`);
  if (!r.rows[0]) throw new BankError('NO_SYSTEM_IDENTITY', 'a technical (is_system) user is required as the author of generated items');
  return r.rows[0].id;
}

/* ------------------------------------------------------------------ */
/* Transitions                                                          */
/* ------------------------------------------------------------------ */

export interface TransitionParams {
  versionId: string;
  to: LifecycleState;
  reason: string;
  actor: TransitionActor;
  runId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * The ONE way a version changes lifecycle. Locks the row, checks the
 * transition (actor, provenance), keeps `approved_items.status` consistent,
 * maintains the item's current version / retirement, and audits.
 */
export async function transitionVersion(p: TransitionParams, outer?: PoolClient): Promise<{ from: LifecycleState | null; to: LifecycleState }> {
  return withTx(async (c) => {
    const r = await c.query(
      `SELECT ai.id, ai.status, ai.bank_lifecycle_status, ai.bank_item_id, qi.provenance, qi.current_version_id, qi.retired_at
         FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE ai.id = $1 FOR UPDATE OF ai`,
      [p.versionId]
    );
    const row = r.rows[0];
    if (!row) throw new BankError('NOT_FOUND', p.versionId);
    const from = (row.bank_lifecycle_status ?? (row.status === 'PUBLISHED' ? 'ACTIVE' : null)) as LifecycleState | null;
    assertTransition(from, p.to, { actor: p.actor, provenance: row.provenance, reason: p.reason });
    if (from === p.to) return { from, to: p.to };
    const status = deliveryStatusFor(p.to);
    await c.query(
      `UPDATE approved_items SET bank_lifecycle_status = $2, status = $3,
              published_at = CASE WHEN $3 = 'PUBLISHED' THEN COALESCE(published_at, now()) ELSE published_at END,
              reviewed_by = CASE WHEN $4::uuid IS NOT NULL THEN $4::uuid ELSE reviewed_by END,
              reviewed_at = CASE WHEN $4::uuid IS NOT NULL THEN now() ELSE reviewed_at END
        WHERE id = $1`,
      [p.versionId, p.to, status, p.actor.kind === 'ADMIN' ? p.actor.userId : null]
    );
    // A newer version becoming deliverable supersedes the version it replaces (never earlier: no delivery gap).
    if (['PILOT', 'CALIBRATED', 'ACTIVE'].includes(p.to) && row.current_version_id && row.current_version_id !== p.versionId) {
      const prev = await c.query(`SELECT bank_lifecycle_status, status FROM approved_items WHERE id = $1 FOR UPDATE`, [row.current_version_id]);
      const prevState = (prev.rows[0]?.bank_lifecycle_status ?? null) as LifecycleState | null;
      if (prevState && !['REJECTED', 'RETIRED', 'SUPERSEDED'].includes(prevState)) {
        await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'SUPERSEDED', status = 'RETIRED' WHERE id = $1`, [row.current_version_id]);
        await audit(c, row.bank_item_id, row.current_version_id, prevState, 'SUPERSEDED', `SUPERSEDED_BY:${p.versionId}`, p.actor, p.runId ?? null, null);
      }
      await c.query(`UPDATE question_bank_items SET current_version_id = $2, updated_at = now() WHERE id = $1`, [row.bank_item_id, p.versionId]);
    }
    if (p.to === 'RETIRED' && row.current_version_id === p.versionId) {
      await c.query(`UPDATE question_bank_items SET retired_at = now(), retire_reason = $2, updated_at = now() WHERE id = $1 AND retired_at IS NULL`, [row.bank_item_id, p.reason.slice(0, 300)]);
    }
    if (p.actor.kind === 'ADMIN') await c.query(`UPDATE question_bank_items SET reviewed_at = now() WHERE id = $1`, [row.bank_item_id]);
    await audit(c, row.bank_item_id, p.versionId, from, p.to, p.reason, p.actor, p.runId ?? null, p.detail ?? null);
    return { from, to: p.to };
  }, outer);
}

async function audit(c: Pick<PoolClient, 'query'>, bankItemId: string, versionId: string, from: string | null, to: string, reason: string, actor: TransitionActor, runId: string | null, detail: Record<string, unknown> | null) {
  await c.query(
    `INSERT INTO question_bank_lifecycle_events (bank_item_id, approved_item_id, from_status, to_status, reason, actor_kind, actor_user_id, run_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [bankItemId, versionId, from, to, reason.slice(0, 500), actor.kind, actor.kind === 'ADMIN' ? actor.userId : null, runId, detail ? JSON.stringify(detail) : null]
  );
}

/* ------------------------------------------------------------------ */
/* Items and versions                                                   */
/* ------------------------------------------------------------------ */

export interface NewVersionInput {
  content: Record<string, unknown>;
  learningObjectiveId: string;
  questionType: string;
  targetDifficulty: number | null;
  validationReport?: Record<string, unknown> | null;
}

async function insertVersion(c: Pick<PoolClient, 'query'>, bankItemId: string, versionNumber: number, v: NewVersionInput, lifecycle: LifecycleState, authorId: string, supersedes: string | null): Promise<string> {
  const parsed = ApprovedItemContentSchema.safeParse(v.content);
  // Content that is not even the stored item shape is never written (the pipeline rejects it before).
  if (!parsed.success) throw new BankError('INVALID_CONTENT', parsed.error.issues[0]?.message);
  const fp = itemFingerprints(parsed.data);
  const r = await c.query(
    `INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, difficulty_index, semantic_fingerprint, template_fingerprint, reasoning_fingerprint, stimulus_fingerprint,
                                 bank_item_id, version_number, bank_lifecycle_status, content_hash, supersedes_version_id, validation_report, target_difficulty, calibration_confidence, lifecycle_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'INSUFFICIENT_DATA', now()) RETURNING id`,
    [
      v.learningObjectiveId, v.questionType, JSON.stringify(v.content), authorId, deliveryStatusFor(lifecycle), contentOriginOf(parsed.data), parsed.data.difficultyIndex ?? null,
      fp.semantic, fp.template, fp.reasoning, fp.stimulus, bankItemId, versionNumber, lifecycle, contentHash(v.content), supersedes, v.validationReport ? JSON.stringify(v.validationReport) : null, v.targetDifficulty,
    ]
  );
  return r.rows[0].id;
}

/** A generated candidate: a NEW stable item (STUDYUS_GENERATED) with version 1 in DRAFT_AI. */
export async function createGeneratedItem(p: {
  itemKey: string;
  examVersionId: string;
  componentId: string;
  cellKey: string;
  language: string;
  generationRequestId: string;
  generationMetadata: Record<string, unknown>;
  version: NewVersionInput;
  runId?: string | null;
}, outer?: PoolClient): Promise<{ bankItemId: string; versionId: string }> {
  return withTx(async (c) => {
    const author = await systemAuthorId(c);
    const item = await c.query(
      `INSERT INTO question_bank_items (item_key, exam_version_id, assessment_component_id, learning_objective_id, cell_key, provenance, language, generation_request_id, generation_metadata)
       VALUES ($1, $2, $3, $4, $5, 'STUDYUS_GENERATED', $6, $7, $8) RETURNING id`,
      [p.itemKey, p.examVersionId, p.componentId, p.version.learningObjectiveId, p.cellKey, p.language, p.generationRequestId, JSON.stringify(p.generationMetadata)]
    );
    const bankItemId = item.rows[0].id;
    const versionId = await insertVersion(c, bankItemId, 1, p.version, 'DRAFT_AI', author, null);
    await c.query(`UPDATE question_bank_items SET current_version_id = $2 WHERE id = $1`, [bankItemId, versionId]);
    await audit(c, bankItemId, versionId, null, 'DRAFT_AI', 'GENERATED', { kind: 'SYSTEM' }, p.runId ?? null, { generationRequestId: p.generationRequestId });
    return { bankItemId, versionId };
  }, outer);
}

/**
 * The next version of an item. `replaceNow` (a repair of a version that was
 * never delivered) supersedes the previous version at once; otherwise (a
 * correction of a delivered item) the previous version stays current until the
 * new one becomes deliverable.
 */
export async function createNextVersion(p: { bankItemId: string; version: NewVersionInput; lifecycle: 'DRAFT_AI' | 'VALIDATING'; replaceNow: boolean; reason: string; actor: TransitionActor; runId?: string | null }, outer?: PoolClient): Promise<{ versionId: string; versionNumber: number }> {
  return withTx(async (c) => {
    const item = await c.query(`SELECT id, current_version_id, retired_at FROM question_bank_items WHERE id = $1 FOR UPDATE`, [p.bankItemId]);
    if (!item.rows[0]) throw new BankError('NOT_FOUND', p.bankItemId);
    if (item.rows[0].retired_at) throw new BankError('RETIRED', p.bankItemId);
    const n = Number((await c.query(`SELECT COALESCE(max(version_number), 0) AS n FROM approved_items WHERE bank_item_id = $1`, [p.bankItemId])).rows[0].n) + 1;
    const author = p.actor.kind === 'ADMIN' ? p.actor.userId : await systemAuthorId(c);
    const prev = item.rows[0].current_version_id as string | null;
    const versionId = await insertVersion(c, p.bankItemId, n, p.version, p.lifecycle, author, prev);
    await audit(c, p.bankItemId, versionId, null, p.lifecycle, p.reason, p.actor, p.runId ?? null, { versionNumber: n, supersedes: prev });
    if (p.replaceNow && prev) {
      await transitionVersion({ versionId: prev, to: 'SUPERSEDED', reason: `REPLACED_BY_V${n}`, actor: p.actor, runId: p.runId }, c);
      await c.query(`UPDATE question_bank_items SET current_version_id = $2, updated_at = now() WHERE id = $1`, [p.bankItemId, versionId]);
    }
    return { versionId, versionNumber: n };
  }, outer);
}

export async function recordValidationReport(versionId: string, report: Record<string, unknown>, outer?: PoolClient): Promise<void> {
  // validation_report is metadata (not content): the immutability guard allows it.
  await (outer ?? db).query(`UPDATE approved_items SET validation_report = $2 WHERE id = $1`, [versionId, JSON.stringify(report)]);
}

/**
 * Registers bank identity for approved_items written by paths that predate
 * the factory (governed vertical apply, F7 item workflow): one item + version
 * 1 per row, PUBLISHED -> ACTIVE. Idempotent; never changes content.
 */
export async function ensureBankIdentities(outer?: PoolClient): Promise<number> {
  return withTx(async (c) => {
    const ins = await c.query(`
      INSERT INTO question_bank_items (id, item_key, exam_version_id, assessment_component_id, learning_objective_id, provenance, language, current_version_id, created_at, reviewed_at)
      SELECT ai.id,
             COALESCE(NULLIF(ai.content->>'key', ''), 'legacy') || CASE WHEN EXISTS (SELECT 1 FROM question_bank_items q WHERE q.learning_objective_id = ai.learning_objective_id AND q.item_key = ai.content->>'key') OR ai.content->>'key' IS NULL THEN '#' || ai.id::text ELSE '' END,
             origin.exam_version_id, origin.assessment_component_id, ai.learning_objective_id,
             CASE COALESCE(ai.content_origin, ai.content->>'contentOrigin', CASE ai.content->>'contentStatus' WHEN 'OFFICIAL_LICENSED' THEN 'LICENSED' WHEN 'DEV_CERT_FIXTURE' THEN 'FIXTURE' ELSE 'GENERATED' END)
               WHEN 'OFFICIAL' THEN 'OFFICIAL' WHEN 'LICENSED' THEN 'LICENSED' WHEN 'FIXTURE' THEN 'FIXTURE' ELSE 'STUDYUS_GENERATED' END,
             COALESCE(NULLIF(ai.content->>'language', ''), 'es'), ai.id, ai.created_at, ai.reviewed_at
        FROM approved_items ai
        LEFT JOIN LATERAL (
          SELECT b.exam_version_id, t.assessment_component_id FROM blueprint_objective_targets t
            JOIN assessment_blueprints b ON b.id = t.blueprint_id JOIN exam_versions v ON v.id = b.exam_version_id
           WHERE t.learning_objective_id = ai.learning_objective_id ORDER BY (v.status = 'PUBLISHED') DESC, v.created_at DESC LIMIT 1
        ) origin ON true
       WHERE ai.bank_item_id IS NULL
      ON CONFLICT DO NOTHING
      RETURNING id`);
    if (ins.rows.length === 0) return 0;
    const ids = ins.rows.map((r: any) => r.id);
    await c.query(
      `UPDATE approved_items ai SET bank_item_id = ai.id, version_number = 1,
              target_difficulty = CASE WHEN (ai.content->>'difficulty') ~ '^[1-5]$' THEN (ai.content->>'difficulty')::int ELSE NULL END,
              calibration_confidence = COALESCE(ai.calibration_confidence, 'INSUFFICIENT_DATA'),
              content_hash = encode(sha256(convert_to(ai.content::text, 'UTF8')), 'hex'),
              bank_lifecycle_status = CASE ai.status WHEN 'PUBLISHED' THEN 'ACTIVE' WHEN 'APPROVED' THEN 'VALIDATED' WHEN 'IN_REVIEW' THEN 'REVIEW_REQUIRED'
                                                     WHEN 'REJECTED' THEN 'REJECTED' WHEN 'RETIRED' THEN 'RETIRED' ELSE NULL END,
              lifecycle_updated_at = now()
        WHERE ai.id = ANY($1::uuid[]) AND ai.bank_item_id IS NULL`,
      [ids]
    );
    await c.query(
      `INSERT INTO question_bank_lifecycle_events (bank_item_id, approved_item_id, from_status, to_status, reason, actor_kind, detail)
       SELECT ai.id, ai.id, NULL, ai.bank_lifecycle_status, 'BANK_REGISTRATION', 'SYSTEM', jsonb_build_object('legacyStatus', ai.status)
         FROM approved_items ai WHERE ai.id = ANY($1::uuid[]) AND ai.bank_lifecycle_status IS NOT NULL`,
      [ids]
    );
    return ids.length;
  }, outer);
}

export function provenanceOfContent(content: unknown): Provenance {
  const parsed = ApprovedItemContentSchema.safeParse(content);
  return parsed.success ? provenanceFromOrigin(contentOriginOf(parsed.data)) : 'STUDYUS_GENERATED';
}

export { LifecycleTransitionError };
