/**
 * Phase 3E -- Learning OS read/snapshot boundary. NOT a decision maker:
 * this file calls getLearningDecisions ONCE per render and hands the
 * exact same decisions to Phase 3D's existing PURE execution policy
 * (buildDailyLearningPlan/selectExecutableNextAction) -- it never
 * scores, ranks, or reorders anything itself. Product surfaces (Today,
 * Learning Debt) consume this snapshot instead of independently calling
 * Phase 3C/3D or re-deriving a recommendation.
 *
 * This is also the concrete protection against the known
 * side-effecting reads inside Phase 3C's signal loader (getActiveDebts/
 * getUpcomingForStudent): one snapshot per server render means those
 * reads happen once, not once per section/component. No polling, no
 * multi-minute cache -- a fresh render always calls getLearningDecisions
 * again, so new evidence is reflected on the very next meaningful
 * request (see docs/architecture, Phase 3E "closed loop").
 */

import { db } from '@/lib/db';
import { getLearningDecisions } from './adaptive-learning-orchestrator.service';
import {
  buildDailyLearningPlan,
  selectExecutableNextAction,
  type DailyLearningPlan,
  type LearningPlanItem,
} from '@/lib/learning-execution-policy';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';

export interface ConceptDisplayInfo {
  label: string;
  canonicalId: string;
  subjectName: string;
}

export interface LearningOSSnapshot {
  studentId: string;
  generatedAt: string;
  decisions: LearningDecision[];
  dailyPlan: DailyLearningPlan;
  nextExecutableItem: LearningPlanItem | null;
  /** Presentation-only: concept id -> display label/subject name. Never a priority field, never used for ordering. */
  conceptLabels: Map<string, ConceptDisplayInfo>;
}

export interface LearningOSSnapshotOptions {
  availableMinutes?: number;
  now?: Date;
  preferredLanguage?: string;
}

const DEFAULT_AVAILABLE_MINUTES = 30;

/**
 * Batch, read-only concept/subject label lookup -- the one additional
 * query a product render needs beyond getLearningDecisions itself (pure
 * presentation data, not a second decision source). Never a duplicate
 * of getActiveDebts/getUpcomingForStudent; never side-effecting.
 */
export async function loadConceptLabels(conceptIds: string[], preferredLanguage: string): Promise<Map<string, ConceptDisplayInfo>> {
  const distinctIds = [...new Set(conceptIds)];
  const labels = new Map<string, ConceptDisplayInfo>();
  if (distinctIds.length === 0) return labels;

  const result = await db.query(
    `SELECT c.id, c.canonical_id, COALESCE(cl.label, c.canonical_id) AS label, s.name AS subject_name
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN LATERAL (
       SELECT label FROM concept_localizations WHERE concept_id = c.id ORDER BY (language = $2) DESC LIMIT 1
     ) cl ON true
     WHERE c.id = ANY($1)`,
    [distinctIds, preferredLanguage]
  );
  for (const row of result.rows) {
    labels.set(row.id, { label: row.label, canonicalId: row.canonical_id, subjectName: row.subject_name });
  }
  return labels;
}

/**
 * One Learning OS snapshot for one product render: exactly one
 * getLearningDecisions call, Phase 3D's existing pure functions applied
 * to those exact decisions, plus one batch label lookup for display.
 * Computed fresh every call -- no cache, so it stays correct in
 * serverless environments and always reflects the latest Knowledge
 * State.
 */
export async function getLearningOSSnapshot(studentId: string, options: LearningOSSnapshotOptions = {}): Promise<LearningOSSnapshot> {
  const preferredLanguage = options.preferredLanguage ?? 'en';
  const decisions = await getLearningDecisions(studentId, preferredLanguage);

  const now = options.now ?? new Date();
  const availableMinutes = options.availableMinutes ?? DEFAULT_AVAILABLE_MINUTES;
  const dailyPlan = buildDailyLearningPlan(studentId, decisions, { availableMinutes, now });
  const nextExecutableItem = selectExecutableNextAction(dailyPlan);

  const conceptIds = decisions.flatMap((d) => [d.actionConceptId, ...d.targetConceptIds]);
  const conceptLabels = await loadConceptLabels(conceptIds, preferredLanguage);

  return {
    studentId,
    generatedAt: now.toISOString(),
    decisions,
    dailyPlan,
    nextExecutableItem,
    conceptLabels,
  };
}
