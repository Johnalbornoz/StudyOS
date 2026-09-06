/**
 * Phase 8 -- Step 8F1: the READ-ONLY learner-facing plan view model.
 *
 * Composes only read sources -- the 8B read boundary
 * (`getLearningPlanHorizon`), concept-label lookup, and curriculum
 * eligibility -- into a shape the "Tu plan" page and the Today "Tu
 * camino" strip render directly. It performs NO writes, calls NO
 * projector, never rebuilds / rolls / reconciles a plan, and calls NO
 * AI. Every learner-facing string is delivered as a deterministic i18n
 * KEY (`whyKey`, `activityType`, `dayBucket`, `statusKey`); the raw
 * `reason_code` / `source` / `priority_at_plan_time` / `operation_key` /
 * policy version / Transfer & Memory internals never leave the server.
 */
import { db, type DbExecutor } from '@/lib/db';
import { getLearningPlanHorizon } from '@/services/learning-plan-read.service';
import { getCurriculumEligibleConcepts } from '@/services/curriculum-eligibility-read.service';
import { loadConceptLabels } from '@/services/learning-os-snapshot.service';
import {
  planItemWhyKey,
  planItemStatusKey,
  planItemDayBucket,
  canLearnerSkip,
  type PlanItemDayBucket,
} from '@/lib/learning-plan-presentation';
import type { ActivityType } from '@/lib/activity-taxonomy';

export interface LearnerPlanItemView {
  id: string;
  conceptId: string | null;
  conceptLabel: string;
  subjectName: string;
  activityType: ActivityType;
  scheduledDate: string;
  timeWindow: string | null;
  estimatedMinutes: number;
  whyKey: string;
  statusKey: string;
  dayBucket: PlanItemDayBucket;
  canSkip: boolean;
}

export interface LearnerExtraPracticeOption {
  conceptId: string;
  conceptLabel: string;
  subjectName: string;
}

export interface LearnerPlanView {
  hasPlan: boolean;
  horizonStart: string | null;
  horizonEnd: string | null;
  timezone: string | null;
  timezoneAssumed: boolean;
  capacityAssumed: boolean;
  items: LearnerPlanItemView[];
  /** Concepts the learner could add as extra practice (no live plan item yet). */
  extraPracticeOptions: LearnerExtraPracticeOption[];
}

const EMPTY: LearnerPlanView = {
  hasPlan: false,
  horizonStart: null,
  horizonEnd: null,
  timezone: null,
  timezoneAssumed: true,
  capacityAssumed: true,
  items: [],
  extraPracticeOptions: [],
};

export async function getLearnerPlanView(
  studentId: string,
  todayIso: string,
  preferredLanguage: string,
  client: DbExecutor = db,
): Promise<LearnerPlanView> {
  const horizon = await getLearningPlanHorizon(studentId, client);

  const eligible = await getCurriculumEligibleConcepts(studentId, 3, client).catch(() => []);
  const liveConceptIds = new Set((horizon?.items ?? []).map((i) => i.conceptId).filter((v): v is string => !!v));
  const extraConceptIds = eligible.map((e) => e.conceptId).filter((cid) => !liveConceptIds.has(cid)).slice(0, 8);

  const labelIds = [
    ...(horizon?.items ?? []).map((i) => i.conceptId).filter((v): v is string => !!v),
    ...extraConceptIds,
  ];
  const labels = labelIds.length ? await loadConceptLabels(labelIds, preferredLanguage) : new Map();

  if (!horizon) {
    return {
      ...EMPTY,
      extraPracticeOptions: extraConceptIds.map((cid) => ({
        conceptId: cid,
        conceptLabel: labels.get(cid)?.label ?? cid,
        subjectName: labels.get(cid)?.subjectName ?? '',
      })),
    };
  }

  const goal = (horizon.plan.goalContext ?? {}) as Record<string, unknown>;

  return {
    hasPlan: true,
    horizonStart: horizon.plan.horizonStart,
    horizonEnd: horizon.plan.horizonEnd,
    timezone: horizon.plan.timezone,
    timezoneAssumed: horizon.plan.timezoneAssumed,
    capacityAssumed: goal.capacityAssumed === true,
    items: horizon.items.map((it) => ({
      id: it.id,
      conceptId: it.conceptId,
      conceptLabel: it.conceptId ? labels.get(it.conceptId)?.label ?? it.conceptId : '',
      subjectName: it.conceptId ? labels.get(it.conceptId)?.subjectName ?? '' : '',
      activityType: it.intendedActivityType,
      scheduledDate: it.scheduledDate,
      timeWindow: it.timeWindow,
      estimatedMinutes: it.estimatedMinutes,
      whyKey: planItemWhyKey(it.reasonCode),
      statusKey: planItemStatusKey(it.status),
      dayBucket: planItemDayBucket(it.scheduledDate, todayIso),
      canSkip: canLearnerSkip(it.reasonCode),
    })),
    extraPracticeOptions: extraConceptIds.map((cid) => ({
      conceptId: cid,
      conceptLabel: labels.get(cid)?.label ?? cid,
      subjectName: labels.get(cid)?.subjectName ?? '',
    })),
  };
}
