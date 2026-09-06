/**
 * Phase 8 -- Step 8G1: a READ-ONLY compatibility mapper that renders
 * the CANONICAL `learning_plan` in the shape the deprecated
 * `/api/study-plan/generate` endpoint used to return.
 *
 * This exists only so any lingering external caller of that endpoint
 * keeps working. It performs NO writes, reads the canonical plan via
 * the 8B read boundary, and NEVER touches the legacy `study_plans` /
 * `study_sessions` / `study_session_items` tables (which remain as
 * frozen historical data).
 */
import { db, type DbExecutor } from '@/lib/db';
import { getLearningPlanHorizon } from '@/services/learning-plan-read.service';
import { loadConceptLabels } from '@/services/learning-os-snapshot.service';
import { legacyPriorityBand, type LegacyPriorityBand } from '@/lib/learning-plan-presentation';

export interface LegacyStudyPlanItemShape {
  conceptId: string | null;
  canonicalId: string;
  label: string;
  activityType: string;
  estimatedMinutes: number;
  priority: LegacyPriorityBand;
}

export interface LegacyStudyPlanSessionShape {
  date: string; // ISO timestamp (legacy shape used Date.toISOString())
  totalMinutes: number;
  items: LegacyStudyPlanItemShape[];
  subjectBreakdown: Array<{ subjectId: string; subjectName: string; minutes: number; conceptCount: number }>;
}

export interface LegacyStudyPlanShape {
  planId: string | null;
  plan: {
    startDate: string;
    endDate: string;
    sessions: LegacyStudyPlanSessionShape[];
    totalStudyMinutes: number;
    subjectsInPlan: string[];
    criticalConceptsCount: number;
    /** Marker so a caller can see this is the canonical plan, not a legacy row. */
    canonical: true;
  } | null;
}

function isoTs(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00.000Z`).toISOString();
}

/** Map the ACTIVE canonical plan to the legacy response shape. `plan: null` when there is no ACTIVE plan. */
export async function getLegacyShapedCanonicalPlan(
  studentId: string,
  preferredLanguage: string,
  client: DbExecutor = db,
): Promise<LegacyStudyPlanShape> {
  const horizon = await getLearningPlanHorizon(studentId, client);
  if (!horizon) return { planId: null, plan: null };

  const conceptIds = horizon.items.map((i) => i.conceptId).filter((v): v is string => !!v);
  const labels = conceptIds.length ? await loadConceptLabels(conceptIds, preferredLanguage) : new Map();

  const byDate = new Map<string, typeof horizon.items>();
  for (const it of horizon.items) {
    const arr = byDate.get(it.scheduledDate) ?? [];
    arr.push(it);
    byDate.set(it.scheduledDate, arr);
  }

  const subjectNames = new Set<string>();
  let criticalConceptsCount = 0;
  let totalStudyMinutes = 0;

  const sessions: LegacyStudyPlanSessionShape[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => {
      const subjectMinutes = new Map<string, { name: string; minutes: number; conceptCount: number }>();
      const shaped = items.map((it) => {
        const info = it.conceptId ? labels.get(it.conceptId) : null;
        const priority = legacyPriorityBand(it.reasonCode);
        if (priority === 'CRITICAL') criticalConceptsCount += 1;
        totalStudyMinutes += it.estimatedMinutes;
        if (info?.subjectName) subjectNames.add(info.subjectName);
        const agg = subjectMinutes.get(it.subjectId) ?? { name: info?.subjectName ?? '', minutes: 0, conceptCount: 0 };
        agg.minutes += it.estimatedMinutes;
        agg.conceptCount += 1;
        subjectMinutes.set(it.subjectId, agg);
        return {
          conceptId: it.conceptId,
          canonicalId: info?.canonicalId ?? it.conceptId ?? '',
          label: info?.label ?? it.conceptId ?? '',
          activityType: it.intendedActivityType,
          estimatedMinutes: it.estimatedMinutes,
          priority,
        };
      });
      return {
        date: isoTs(date),
        totalMinutes: shaped.reduce((s, x) => s + x.estimatedMinutes, 0),
        items: shaped,
        subjectBreakdown: [...subjectMinutes.entries()].map(([subjectId, v]) => ({
          subjectId,
          subjectName: v.name,
          minutes: v.minutes,
          conceptCount: v.conceptCount,
        })),
      };
    });

  return {
    planId: horizon.plan.id,
    plan: {
      startDate: isoTs(horizon.plan.horizonStart),
      endDate: isoTs(horizon.plan.horizonEnd),
      sessions,
      totalStudyMinutes,
      subjectsInPlan: [...subjectNames],
      criticalConceptsCount,
      canonical: true,
    },
  };
}
