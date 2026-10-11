/**
 * B5-F -- the supply trigger of the canonical assessment flow (IO).
 *
 *   Learning surface / setup  ->  ask the EXISTING replenishment worker for this Student + concept
 *   worker (its own invocation) ->  measures the pool against its own safe-depth rule, generates if short
 *   generated questions (validated by the generators' quality gate) -> the Student's question cache
 *   Blueprint Core -> selects among the questions that are eligible NOW
 *
 * This module only ASKS. It generates nothing, selects nothing and waits for nothing: the Question Bank /
 * cache stays the content authority and B2 the selection authority. A start never generates synchronously,
 * and a setup with nothing to offer still says so -- the request only makes a later visit succeed.
 *
 * Idempotent by the queue's own rule: one open job per Student + concept (`prepare:<student>:<concept>`),
 * so repeated renders cannot pile up jobs. Whether anything is generated is the worker's decision (it is a
 * no-op when the pool is already deep enough, or when the Learning Decision has no activity for the concept).
 */
import { db } from '@/lib/db';
import { scheduleDeliveryReplenishment } from '@/services/activity-delivery-worker.service';

/** A setup names a handful of concepts; a request is never allowed to fan out further than this. */
export const MAX_SUPPLY_TARGETS = 5;

export interface SupplyDeps {
  schedule: typeof scheduleDeliveryReplenishment;
}

export interface SupplyScope {
  canonicalConceptIds?: readonly string[];
  learnerConceptIds?: readonly string[];
}

/**
 * Requests replenishment for the Student's OWN concepts behind a scope. Only concepts that belong to the
 * Student are ever queued (the scope comes from a URL). Returns the learner concepts requested.
 */
export async function requestAssessmentSupply(studentId: string, scope: SupplyScope, overrides: Partial<SupplyDeps> = {}): Promise<string[]> {
  const deps: SupplyDeps = { schedule: scheduleDeliveryReplenishment, ...overrides };
  const canonical = [...new Set(scope.canonicalConceptIds ?? [])];
  const learner = [...new Set(scope.learnerConceptIds ?? [])];
  if (canonical.length === 0 && learner.length === 0) return [];
  const r = await db.query(
    `SELECT DISTINCT c.id AS concept_id, c.subject_id
       FROM concepts c JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id AND m.status = 'MATCHED'
      WHERE s.student_id = $1 AND (c.id::text = ANY($2::text[]) OR m.canonical_concept_id::text = ANY($3::text[]))
      ORDER BY c.id LIMIT $4`,
    [studentId, learner, canonical, MAX_SUPPLY_TARGETS]
  );
  const targets = r.rows as Array<{ concept_id: string; subject_id: string }>;
  for (const t of targets) await deps.schedule({ studentId, subjectId: t.subject_id, conceptId: t.concept_id });
  return targets.map((t) => t.concept_id);
}

/** After a canonical completion: keep the concepts just practised supplied. Never part of the result. */
export async function requestSupplyForSession(studentId: string, sessionId: string, overrides: Partial<SupplyDeps> = {}): Promise<string[]> {
  const r = await db.query(`SELECT concept_ids FROM quiz_sessions WHERE id = $1 AND student_id = $2 AND assessment_snapshot IS NOT NULL`, [sessionId, studentId]);
  const ids = ((r.rows[0]?.concept_ids ?? []) as string[]).filter(Boolean);
  return ids.length > 0 ? requestAssessmentSupply(studentId, { learnerConceptIds: ids }, overrides) : [];
}
