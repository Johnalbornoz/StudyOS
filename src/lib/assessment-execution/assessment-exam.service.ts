/**
 * B5-R -- the exam side of the canonical execution boundary (IO).
 *
 * The Exam Core stays the authority of an exam attempt: it creates the instance, freezes its form, decides
 * the stored attempt type (B1), runs the attempt and scores it. This module adds two things around it, and
 * only when canonical execution is enabled:
 *
 *   attachExamInstanceProvenance   at start: a FrozenAssessment that REFERENCES the instance's frozen form and
 *                                  records, per position, what the item covered. From then on the attempt is
 *                                  CANONICAL: the legacy objective -> first-concept shortcut stands down.
 *   completeExamAssessmentEvidence at completion: the attempt's own scored responses go through the B3 loop.
 *
 * Neither changes a form, a score, an attempt type or a fallback rule. If the provenance cannot be attached
 * the attempt simply stays LEGACY -- a start is never blocked by it.
 */
import { db } from '@/lib/db';
import { loadQuestionCoverage } from '@/lib/assessment-foundation/question-coverage.service';
import { assessmentPathOf } from '@/lib/simulation/preparation-simulation';
import { isSnapshotExecutionEnabled } from './assessment-start.service';
import { formPositionsOf, freezeExamInstanceProvenance, FreezeError } from './frozen-assessment';
import { canonicalNextDecision, completeAssessmentEvidence, persistAssessmentSnapshot, type EvidenceLoopDeps, type EvidenceLoopResult } from './assessment-execution.service';
import type { ScoredResponse } from './evidence-plan';

export type AttachOutcome = { attached: true; snapshotId: string; stored: 'NEW' | 'ALREADY_STORED' } | { attached: false; reason: 'DISABLED' | 'INSTANCE_NOT_FOUND' | 'FORM_NOT_FROZEN' | 'COVERAGE_UNAVAILABLE' | 'NOT_STORED'; detail?: string };

export interface AttachDeps {
  enabled: () => boolean;
  loadCoverage: typeof loadQuestionCoverage;
}

export async function attachExamInstanceProvenance(instanceId: string, asOf: string, overrides: Partial<AttachDeps> = {}): Promise<AttachOutcome> {
  const deps: AttachDeps = { enabled: isSnapshotExecutionEnabled, loadCoverage: loadQuestionCoverage, ...overrides };
  if (!deps.enabled()) return { attached: false, reason: 'DISABLED' };
  const r = await db.query(
    `SELECT ei.student_id, ei.exam_profile_id, ei.exam_version_id, ei.component_ids, ei.mode, ei.form, ei.content_audience, sa.simulation_type
       FROM exam_instances ei LEFT JOIN simulation_attempts sa ON sa.id = ei.simulation_attempt_id
      WHERE ei.id = $1`,
    [instanceId]
  );
  const row = r.rows[0];
  if (!row) return { attached: false, reason: 'INSTANCE_NOT_FOUND' };
  const positions = formPositionsOf(row.form);
  if (positions.length === 0) return { attached: false, reason: 'FORM_NOT_FROZEN' };
  try {
    const coverages = await deps.loadCoverage(positions.map((p) => ({ store: 'REVIEWED_EXAM_BANK' as const, id: p.itemId })));
    const frozen = freezeExamInstanceProvenance({
      positions,
      coverages,
      studentId: row.student_id,
      createdAt: asOf,
      // the stored attempt type was decided by B1 at start; the path only restates it
      path: assessmentPathOf({ simulationType: row.simulation_type ?? null, instanceMode: row.mode, formFrozen: true, formFidelity: row.form?.fidelity ?? null }),
      exam: { examTargetId: row.exam_profile_id ?? null, examVersionId: row.exam_version_id, assessmentComponentIds: [...(row.component_ids ?? [])].sort() },
      contentAudience: row.content_audience === 'TECHNICAL_DEMO' ? 'TECHNICAL_DEMO' : 'STUDENT',
    });
    const stored = await persistAssessmentSnapshot({ kind: 'EXAM_INSTANCE', id: instanceId }, frozen);
    return stored.ok ? { attached: true, snapshotId: frozen.snapshotId, stored: stored.stored } : { attached: false, reason: 'NOT_STORED', detail: stored.reason };
  } catch (e) {
    return { attached: false, reason: 'COVERAGE_UNAVAILABLE', detail: e instanceof FreezeError ? e.code : e instanceof Error ? e.message.slice(0, 160) : undefined };
  }
}

export type ExamEvidenceResult = EvidenceLoopResult | { ok: false; reason: 'NOT_CANONICAL' };

/**
 * The canonical evidence of a completed exam attempt, from its own stored responses. Called after the Exam
 * Core has scored the attempt; it reads the scores and never changes them. A LEGACY attempt is not processed
 * here (its evidence was written by the legacy path while it was answered).
 */
export async function completeExamAssessmentEvidence(simulationAttemptId: string, studentId: string, loopDeps: Partial<EvidenceLoopDeps> = { nextDecision: canonicalNextDecision }): Promise<ExamEvidenceResult> {
  const found = await db.query(
    `SELECT ei.id AS instance_id, sa.exam_attempt_id
       FROM exam_instances ei JOIN simulation_attempts sa ON sa.id = ei.simulation_attempt_id
      WHERE sa.id = $1 AND ei.student_id = $2 AND ei.assessment_snapshot IS NOT NULL`,
    [simulationAttemptId, studentId]
  ).catch((e: { code?: string }) => {
    if (e?.code === '42703') return { rows: [] as any[] };
    throw e;
  });
  const instance = found.rows[0];
  if (!instance) return { ok: false, reason: 'NOT_CANONICAL' };
  const rows = await db.query(`SELECT id, approved_item_id, score, max_score, review_status, (grading_detail->'coach'->>'assisted') = 'true' AS assisted FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 AND approved_item_id IS NOT NULL ORDER BY created_at, id`, [instance.exam_attempt_id]);
  const responses: ScoredResponse[] = (rows.rows as Array<{ id: string; approved_item_id: string; score: string | number | null; max_score: string | number | null; review_status: string | null; assisted: boolean | null }>).map((row) => {
    const itemKey = `REVIEWED_EXAM_BANK:${row.approved_item_id}`;
    const max = row.max_score === null ? null : Number(row.max_score);
    // a response awaiting review is not evidence until a reviewer confirms its mark (the existing rule)
    if (row.review_status === 'REVIEW_REQUIRED') return { itemKey, responseRef: row.id, status: 'PENDING_REVIEW', fraction: null };
    // coached practice: the Student opened the speed strategy before answering -- practice, not independent evidence
    if (row.assisted === true) return { itemKey, responseRef: row.id, status: 'ASSISTED', fraction: null };
    if (row.score === null || max === null || max <= 0) return { itemKey, responseRef: row.id, status: 'UNANSWERED', fraction: null };
    return { itemKey, responseRef: row.id, status: 'SCORED', fraction: Math.max(0, Math.min(1, Number(row.score) / max)) };
  });
  return completeAssessmentEvidence({ record: { kind: 'EXAM_INSTANCE', id: instance.instance_id }, studentId, attemptRef: instance.exam_attempt_id, responses }, loopDeps);
}
