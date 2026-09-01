/**
 * Phase 1E, Steps 5-8: Learning Velocity (student + concept, and
 * student/subject aggregate).
 *
 * Primary granularity: STUDENT + CONCEPT. Milestones are the real
 * MasteryState values the Knowledge State projector already produces
 * (PROVISIONAL_MASTERY, VALIDATED_MASTERY, kept distinct, never
 * collapsed) -- no new mastery-state definition is introduced.
 *
 * Step 6 (release-blocking for correctness): Phase 0E2's decision_events
 * audit trail only exists from 2026-08-31 forward. A concept whose
 * CURRENT state already implies a milestone was reached, but with no
 * recorded decision_events row for it, means the milestone was reached
 * before recording began -- reported as `historyComplete: false`, NEVER
 * estimated or backfilled from the current state's date.
 *
 * Batched across however many concepts are requested (Step 28): 3
 * fixed-shape queries total, never one query per concept.
 */
import { db } from '@/lib/db';
import type { MasteryState } from '@/services/knowledge-state.service';
import {
  type LearningVelocitySummary,
  type AggregateVelocitySummary,
  type MetricResult,
  type MilestoneTiming,
  LEARNING_VELOCITY_MODEL_VERSION,
  metricAvailable,
  metricUnavailable,
  quality,
} from './types';

/** Ranks derivable by the current Knowledge State projector, plus AT_RISK/INTERVENTION_REQUIRED handled defensively (Step 5's own comment: 2.2A never produces them today, but a future projector might). */
const MASTERY_RANK: Record<MasteryState, number> = {
  UNKNOWN: 0,
  LEARNING: 1,
  DEVELOPING: 2,
  PROVISIONAL_MASTERY: 3,
  VALIDATED_MASTERY: 4,
  AT_RISK: 4,
  INTERVENTION_REQUIRED: 4,
};

interface ConceptEvidenceRow {
  concept_id: string;
  first_evidence_at: string;
  distinct_dates: string[]; // sorted ascending, 'YYYY-MM-DD'
}
interface MilestoneEventRow {
  concept_id: string;
  mastery_state: string;
  created_at: string;
}
interface CurrentStateRow {
  concept_id: string;
  mastery_state: MasteryState;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

/** Distinct dates strictly between (inclusive) two date strings, from an already-sorted array. */
function activeDaysInWindow(dates: string[], startDate: string, endDate: string): number {
  return dates.filter((d) => d >= startDate && d <= endDate).length;
}

function longestGap(dates: string[]): number | null {
  if (dates.length < 2) return null;
  let max = 0;
  for (let i = 1; i < dates.length; i++) {
    const gap = daysBetween(dates[i - 1], dates[i]);
    if (gap > max) max = gap;
  }
  return max;
}

function toMilestone(eventAt: string | undefined, currentRank: number, requiredRank: number): MilestoneTiming {
  if (eventAt) return { reached: true, historyComplete: true, at: eventAt };
  if (currentRank >= requiredRank) return { reached: true, historyComplete: false, at: null };
  return { reached: false, historyComplete: false, at: null };
}

/** Pure: computes one concept's summary from already-fetched, already-grouped rows. */
export function computeLearningVelocity(
  firstEvidenceAt: string,
  distinctDates: string[],
  provisionalEventAt: string | undefined,
  validatedEventAt: string | undefined,
  currentMasteryState: MasteryState | null
): LearningVelocitySummary {
  const currentRank = currentMasteryState ? MASTERY_RANK[currentMasteryState] : 0;
  const provisionalMastery = toMilestone(provisionalEventAt, currentRank, 3);
  const validatedMastery = toMilestone(validatedEventAt, currentRank, 4);

  const firstDate = firstEvidenceAt.slice(0, 10);

  return {
    firstEvidenceAt,
    provisionalMastery,
    validatedMastery,
    calendarDaysToProvisional: provisionalMastery.historyComplete ? daysBetween(firstEvidenceAt, provisionalMastery.at as string) : null,
    activeStudyDaysToProvisional: provisionalMastery.historyComplete
      ? activeDaysInWindow(distinctDates, firstDate, (provisionalMastery.at as string).slice(0, 10))
      : null,
    calendarDaysToValidated: validatedMastery.historyComplete ? daysBetween(firstEvidenceAt, validatedMastery.at as string) : null,
    activeStudyDaysToValidated: validatedMastery.historyComplete
      ? activeDaysInWindow(distinctDates, firstDate, (validatedMastery.at as string).slice(0, 10))
      : null,
    longestInactiveGapDays: longestGap(distinctDates),
    quality: quality(distinctDates.length, distinctDates[distinctDates.length - 1] ?? null, LEARNING_VELOCITY_MODEL_VERSION),
  };
}

/**
 * Read-only, batched (Step 28): 3 fixed-shape queries regardless of
 * how many concepts are requested. Returns a result per requested
 * concept id (concepts with zero evidence are INSUFFICIENT_EVIDENCE).
 */
export async function readLearningVelocityForConcepts(
  studentId: string,
  conceptIds: string[]
): Promise<Map<string, MetricResult<LearningVelocitySummary>>> {
  const results = new Map<string, MetricResult<LearningVelocitySummary>>();
  if (conceptIds.length === 0) return results;

  const [evidenceResult, milestoneResult, currentStateResult] = await Promise.all([
    db.query<ConceptEvidenceRow>(
      `SELECT concept_id, MIN(timestamp) AS first_evidence_at,
              array_agg(DISTINCT timestamp::date ORDER BY timestamp::date) AS distinct_dates
       FROM learning_evidence
       WHERE student_id = $1 AND concept_id = ANY($2)
       GROUP BY concept_id`,
      [studentId, conceptIds]
    ),
    db.query<MilestoneEventRow>(
      `SELECT DISTINCT ON (concept_id, new_state ->> 'masteryState') concept_id, new_state ->> 'masteryState' AS mastery_state, created_at
       FROM decision_events
       WHERE student_id = $1 AND concept_id = ANY($2) AND decision_type = 'KNOWLEDGE_STATE_PROJECTED'
       ORDER BY concept_id, new_state ->> 'masteryState', created_at ASC`,
      [studentId, conceptIds]
    ),
    db.query<CurrentStateRow>(
      `SELECT concept_id, mastery_state FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = ANY($2)`,
      [studentId, conceptIds]
    ),
  ]);

  const evidenceByConcept = new Map(evidenceResult.rows.map((r) => [r.concept_id, r]));
  const currentStateByConcept = new Map(currentStateResult.rows.map((r) => [r.concept_id, r.mastery_state]));
  const milestonesByConcept = new Map<string, Map<string, string>>();
  for (const row of milestoneResult.rows) {
    const m = milestonesByConcept.get(row.concept_id) ?? new Map<string, string>();
    m.set(row.mastery_state, row.created_at);
    milestonesByConcept.set(row.concept_id, m);
  }

  for (const conceptId of conceptIds) {
    const evidence = evidenceByConcept.get(conceptId);
    if (!evidence) {
      results.set(conceptId, metricUnavailable('INSUFFICIENT_EVIDENCE', 'No learning_evidence rows exist for this concept.'));
      continue;
    }
    const milestones = milestonesByConcept.get(conceptId);
    results.set(
      conceptId,
      metricAvailable(
        computeLearningVelocity(
          evidence.first_evidence_at,
          (evidence.distinct_dates || []).map((d) => String(d).slice(0, 10)),
          milestones?.get('PROVISIONAL_MASTERY'),
          milestones?.get('VALIDATED_MASTERY'),
          currentStateByConcept.get(conceptId) ?? null
        )
      )
    );
  }
  return results;
}

export async function readLearningVelocity(studentId: string, conceptId: string): Promise<MetricResult<LearningVelocitySummary>> {
  const map = await readLearningVelocityForConcepts(studentId, [conceptId]);
  return map.get(conceptId) ?? metricUnavailable('INSUFFICIENT_EVIDENCE', 'No learning_evidence rows exist for this concept.');
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Pure: Step 8's aggregation rule -- median across concepts with
 * genuinely available (historyComplete) milestone velocity, NOT a
 * naive mean (a single multi-year-old concept would otherwise distort
 * the whole aggregate). Reports qualifyingConceptCount/totalConceptCount
 * so the aggregate's real coverage is always visible.
 */
export function aggregateLearningVelocity(perConcept: Map<string, MetricResult<LearningVelocitySummary>>): AggregateVelocitySummary {
  const available = [...perConcept.values()].filter((r): r is Extract<typeof r, { available: true }> => r.available);

  const provisionalDays = available.map((r) => r.value.calendarDaysToProvisional).filter((v): v is number => v !== null);
  const provisionalActiveDays = available.map((r) => r.value.activeStudyDaysToProvisional).filter((v): v is number => v !== null);
  const validatedDays = available.map((r) => r.value.calendarDaysToValidated).filter((v): v is number => v !== null);
  const validatedActiveDays = available.map((r) => r.value.activeStudyDaysToValidated).filter((v): v is number => v !== null);

  // A concept "qualifies" for this aggregate if it contributed at least
  // one historyComplete milestone timing to any of the four medians above.
  const qualifyingConceptCount = available.filter(
    (r) => r.value.provisionalMastery.historyComplete || r.value.validatedMastery.historyComplete
  ).length;

  return {
    medianCalendarDaysToProvisional: median(provisionalDays),
    medianActiveStudyDaysToProvisional: median(provisionalActiveDays),
    medianCalendarDaysToValidated: median(validatedDays),
    medianActiveStudyDaysToValidated: median(validatedActiveDays),
    qualifyingConceptCount,
    totalConceptCount: perConcept.size,
    quality: quality(qualifyingConceptCount, null, LEARNING_VELOCITY_MODEL_VERSION),
  };
}
