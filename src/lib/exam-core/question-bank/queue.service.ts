/**
 * Question Bank Factory -- the durable GENERATION QUEUE.
 *
 * Idempotent: at most one open (PENDING / RUNNING) request per exam version +
 * blueprint cell (partial unique index), so re-running the gap analysis, two
 * overlapping runs or a retried manual request never create duplicate work.
 * Claiming uses `FOR UPDATE SKIP LOCKED` + a lease: two workers can never fill
 * the same cell at once, and a crashed worker's lease expires back to PENDING.
 * Attempts are bounded (no infinite retry) with exponential backoff.
 */
import type { PilotCellParams } from './pilots/saber11-math';
import { db } from '@/lib/db';
import { adapterFor } from './adapters';
import { prioritizeGaps, type BankHealth, type CellHealth } from './health';
import { backoffMinutes, type FactoryConfig } from './policy';
import type { CellSpec } from './validation';
import type { BlueprintCell } from './cells';
import type { VersionHealthInputs } from './health.service';

export type RequestReason = 'EMPTY' | 'FORM_BLOCKER' | 'LOW_VARIETY' | 'LOW_CALIBRATION' | 'MISCONCEPTION_COVERAGE' | 'MANUAL_SMALL_BATCH' | 'DEMAND_SHORTAGE';

export interface GenerationRequest {
  id: string;
  examVersionId: string;
  blueprintId: string;
  cellKey: string;
  learningObjectiveId: string;
  assessmentComponentId: string;
  requestedCount: number;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  reason: RequestReason;
  generationParams: { spec?: CellSpec; aggregate?: { summary: string; sampleSize: number; misconceptionCode?: string } | null; difficultyMix?: Partial<Record<'LOW' | 'MEDIUM' | 'HIGH', number>>; demand?: Record<string, unknown>; /** A governed population pilot (content category, competence, assertion, locale, review checklist). */ pilot?: PilotCellParams };
  language: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  attemptCount: number;
  maxAttempts: number;
  candidatesCreated: number;
  accepted: number;
  rejected: number;
  repaired: number;
  reviewRequired: number;
}

const toRequest = (r: any): GenerationRequest => ({
  id: r.id,
  examVersionId: r.exam_version_id,
  blueprintId: r.blueprint_id,
  cellKey: r.cell_key,
  learningObjectiveId: r.learning_objective_id,
  assessmentComponentId: r.assessment_component_id,
  requestedCount: r.requested_count,
  priority: r.priority,
  reason: r.reason,
  generationParams: r.generation_params ?? {},
  language: r.language,
  status: r.status,
  attemptCount: r.attempt_count,
  maxAttempts: r.max_attempts,
  candidatesCreated: r.candidates_created,
  accepted: r.accepted,
  rejected: r.rejected,
  repaired: r.repaired,
  reviewRequired: r.review_required,
});

/** DB bound on one request (chunked into AI calls of 5 by the factory). */
export const MAX_REQUEST_COUNT = 25;

export function reasonForPriority(priority: CellHealth['priority']): RequestReason {
  return priority === 'P0' ? 'EMPTY' : priority === 'P1' ? 'FORM_BLOCKER' : priority === 'P2' ? 'LOW_VARIETY' : 'LOW_CALIBRATION';
}

const mode = <T,>(xs: T[]): T | null => {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return best;
};

/** What a cell asks a generator for -- derived from the blueprint, the component definition and the cell's own items (pure). */
export function cellSpecFor(cell: BlueprintCell, inputs: Pick<VersionHealthInputs, 'texts' | 'componentDefinitions' | 'meta'>): CellSpec {
  const adapter = adapterFor(inputs.meta.family);
  const own = inputs.texts.filter((t) => t.learningObjectiveId === cell.learningObjectiveId);
  const def = inputs.componentDefinitions[cell.componentId];
  const domain: CellSpec['domain'] = def?.responseFormats.some((f) => f === 'NUMERIC_ENTRY' || f === 'MATH_EXPRESSION') ? 'MATH' : 'TEXT';
  const stimulusRequired = adapter.unitPolicy.mode === 'UNIT' || (own.length > 0 && own.filter((t) => t.hasStimulus).length * 2 >= own.length);
  const difficulties = own.map((t) => t.difficulty).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const target = cell.difficultyRange ? Math.round((cell.difficultyRange.min + cell.difficultyRange.max) / 2) : difficulties.length ? difficulties[Math.floor(difficulties.length / 2)] : 3;
  const optionCounts = own.map((t) => t.options.length).filter((n) => n >= 2);
  return {
    cellKey: cell.cellKey,
    learningObjectiveId: cell.learningObjectiveId,
    questionType: cell.questionType,
    difficultyRange: cell.difficultyRange,
    targetDifficulty: target,
    cognitiveDemand: mode(own.map((t) => t.cognitiveDemand).filter((d): d is string => !!d)),
    language: mode(own.map((t) => t.language)) ?? 'es',
    answerFormats: [...adapter.generation.answerFormats],
    optionCount: mode(optionCounts) ?? adapter.generation.optionCount,
    domain,
    stimulusRequired,
    stimulusOnlyEvidence: stimulusRequired && domain === 'TEXT',
  };
}

/**
 * Turns the highest-value gaps into bounded work. Only P0-P2 cells (P3 needs
 * field evidence, not more items), only families the generator supports, and
 * never more than `maxOpen` open requests for the version in total -- the queue
 * is topped up run after run, it never grows without bound. Returns the
 * requests created now.
 */
export async function enqueueGaps(inputs: VersionHealthInputs, health: BankHealth, cfg: Pick<FactoryConfig, 'maxBatch'>, maxOpen = 5): Promise<GenerationRequest[]> {
  const adapter = adapterFor(inputs.meta.family);
  if (!adapter.generation.supported) return [];
  const open = Number((await db.query(`SELECT count(*)::int AS n FROM question_bank_generation_requests WHERE exam_version_id = $1 AND status IN ('PENDING', 'RUNNING')`, [inputs.meta.examVersionId])).rows[0]?.n ?? 0);
  const room = Math.max(0, maxOpen - open);
  const created: GenerationRequest[] = [];
  for (const gap of prioritizeGaps(health.cells)) {
    if (created.length >= room) break;
    const cell = inputs.cells.find((c) => c.cellKey === gap.cellKey);
    if (!cell || gap.priority === 'P3' || gap.priority === 'P4') continue;
    const spec = cellSpecFor(cell, inputs);
    const r = await db.query(
      `INSERT INTO question_bank_generation_requests (exam_version_id, blueprint_id, cell_key, learning_objective_id, assessment_component_id, requested_count, priority, reason, generation_params, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (exam_version_id, cell_key) WHERE status IN ('PENDING', 'RUNNING') DO NOTHING
       RETURNING *`,
      [inputs.meta.examVersionId, inputs.meta.blueprintId, cell.cellKey, cell.learningObjectiveId, cell.componentId, Math.min(cfg.maxBatch, gap.generationNeed), gap.priority, reasonForPriority(gap.priority), JSON.stringify({ spec }), spec.language]
    );
    if (r.rows[0]) created.push(toRequest(r.rows[0]));
  }
  return created;
}

/** A controlled small batch for ONE cell, requested by an authorised admin. Returns the open request (existing or new). */
export async function enqueueManual(p: {
  inputs: VersionHealthInputs;
  cellKey: string;
  count: number;
  requestedBy: string;
  idempotencyKey: string | null;
  maxBatch: number;
  /** V2 demand-driven request: the difficulty mix to generate and the demand that justified it. */
  difficultyMix?: Partial<Record<'LOW' | 'MEDIUM' | 'HIGH', number>> | null;
  demand?: Record<string, unknown> | null;
  /** A governed population pilot: the exact cell requirement beyond the blueprint (content category, competence, ...). */
  pilot?: PilotCellParams | null;
}): Promise<{ request: GenerationRequest; created: boolean }> {
  const cell = p.inputs.cells.find((c) => c.cellKey === p.cellKey);
  if (!cell) throw new Error('CELL_NOT_FOUND');
  const count = Math.max(1, Math.min(p.maxBatch, MAX_REQUEST_COUNT, p.count));
  const spec = cellSpecFor(cell, p.inputs);
  // A pilot batch is an explicit manual batch (with its own difficulty plan), never a demand signal.
  const reason: RequestReason = p.pilot ? 'MANUAL_SMALL_BATCH' : p.difficultyMix ? 'DEMAND_SHORTAGE' : 'MANUAL_SMALL_BATCH';
  const params = { spec, ...(p.difficultyMix ? { difficultyMix: p.difficultyMix } : {}), ...(p.demand ? { demand: p.demand } : {}), ...(p.pilot ? { pilot: p.pilot } : {}) };
  const ins = await db.query(
    `INSERT INTO question_bank_generation_requests (exam_version_id, blueprint_id, cell_key, learning_objective_id, assessment_component_id, requested_count, priority, reason, generation_params, language, requested_by, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, 'P1', $11, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING RETURNING *`,
    [p.inputs.meta.examVersionId, p.inputs.meta.blueprintId, cell.cellKey, cell.learningObjectiveId, cell.componentId, count, JSON.stringify(params), spec.language, p.requestedBy, p.idempotencyKey, reason]
  );
  if (ins.rows[0]) return { request: toRequest(ins.rows[0]), created: true };
  const open = await db.query(
    `SELECT * FROM question_bank_generation_requests WHERE (idempotency_key = $3 AND $3::text IS NOT NULL) OR (exam_version_id = $1 AND cell_key = $2 AND status IN ('PENDING', 'RUNNING')) ORDER BY created_at DESC LIMIT 1`,
    [p.inputs.meta.examVersionId, cell.cellKey, p.idempotencyKey]
  );
  return { request: toRequest(open.rows[0]), created: false };
}

/** Expired leases (a crashed worker) go back to PENDING, or FAILED when the attempts are spent. */
export async function reclaimExpiredLeases(): Promise<number> {
  const r = await db.query(
    `UPDATE question_bank_generation_requests
        SET status = CASE WHEN attempt_count >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
            completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
            last_error = 'LEASE_EXPIRED', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE status = 'RUNNING' AND lease_expires_at < now() RETURNING id`
  );
  return r.rows.length;
}

/** Claims the next due request (priority order). Never two workers on one request. */
export async function claimNextRequest(leaseOwner: string, leaseMs: number, onlyExamVersionIds?: string[], onlyRequestId?: string): Promise<GenerationRequest | null> {
  const r = await db.query(
    `UPDATE question_bank_generation_requests SET status = 'RUNNING', lease_owner = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond'),
            attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now()), updated_at = now()
      WHERE id = (
        SELECT id FROM question_bank_generation_requests
         WHERE status = 'PENDING' AND next_attempt_at <= now() AND attempt_count < max_attempts
           AND ($3::uuid[] IS NULL OR exam_version_id = ANY($3::uuid[])) AND ($4::uuid IS NULL OR id = $4::uuid)
         ORDER BY priority, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`,
    [leaseOwner, leaseMs, onlyExamVersionIds ?? null, onlyRequestId ?? null]
  );
  return r.rows[0] ? toRequest(r.rows[0]) : null;
}

export async function addRequestCounters(id: string, d: { candidates?: number; accepted?: number; rejected?: number; repaired?: number; reviewRequired?: number; provider?: string | null; model?: string | null; runId?: string | null }): Promise<void> {
  await db.query(
    `UPDATE question_bank_generation_requests SET candidates_created = candidates_created + $2, accepted = accepted + $3, rejected = rejected + $4, repaired = repaired + $5,
            review_required = review_required + $6, provider = COALESCE($7, provider), model = COALESCE($8, model), last_run_id = COALESCE($9, last_run_id), updated_at = now() WHERE id = $1`,
    [id, d.candidates ?? 0, d.accepted ?? 0, d.rejected ?? 0, d.repaired ?? 0, d.reviewRequired ?? 0, d.provider ?? null, d.model ?? null, d.runId ?? null]
  );
}

export async function completeRequest(id: string, leaseOwner: string): Promise<void> {
  await db.query(`UPDATE question_bank_generation_requests SET status = 'COMPLETED', completed_at = now(), lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND lease_owner = $2`, [id, leaseOwner]);
}

/** Back to PENDING after a provider limit / failure with exponential backoff; FAILED when attempts are spent. Diagnostics kept. */
export async function deferRequest(id: string, leaseOwner: string, error: string): Promise<'PENDING' | 'FAILED'> {
  const r = await db.query(`SELECT attempt_count, max_attempts FROM question_bank_generation_requests WHERE id = $1`, [id]);
  const row = r.rows[0];
  const exhausted = !row || row.attempt_count >= row.max_attempts;
  await db.query(
    `UPDATE question_bank_generation_requests SET status = $3, last_error = $4, lease_owner = NULL, lease_expires_at = NULL,
            next_attempt_at = now() + ($5::int * interval '1 minute'), completed_at = CASE WHEN $3 = 'FAILED' THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1 AND lease_owner = $2`,
    [id, leaseOwner, exhausted ? 'FAILED' : 'PENDING', error.slice(0, 500), backoffMinutes(row?.attempt_count ?? 1)]
  );
  return exhausted ? 'FAILED' : 'PENDING';
}

/** Returns a claimed request untouched (the run stopped before spending anything on it): its attempt is not counted. */
export async function releaseRequest(id: string, leaseOwner: string, note: string): Promise<void> {
  await db.query(
    `UPDATE question_bank_generation_requests SET status = 'PENDING', attempt_count = GREATEST(0, attempt_count - 1), lease_owner = NULL, lease_expires_at = NULL, last_error = $3, updated_at = now()
      WHERE id = $1 AND lease_owner = $2`,
    [id, leaseOwner, note.slice(0, 200)]
  );
}

export async function listRequests(limit = 100): Promise<Array<GenerationRequest & { lastError: string | null; createdAt: string; completedAt: string | null; family: string; definitionName: string }>> {
  const r = await db.query(
    `SELECT q.*, d.exam_family, d.name AS definition_name FROM question_bank_generation_requests q
       JOIN exam_versions v ON v.id = q.exam_version_id JOIN exam_definitions d ON d.id = v.exam_definition_id
      ORDER BY q.created_at DESC LIMIT $1`,
    [limit]
  );
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? null);
  return r.rows.map((row: any) => ({ ...toRequest(row), lastError: row.last_error, createdAt: iso(row.created_at), completedAt: iso(row.completed_at), family: row.exam_family, definitionName: row.definition_name }));
}
