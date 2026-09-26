/**
 * The concept page's "AHORA" block must never render empty.
 *
 * Pure presentation of `ConceptMissionNow` -- it never chooses the
 * activity (that is the canonical Learning Engine's decision, passed
 * through verbatim), it only guarantees what the student sees:
 *   - an action title, a short "why this is next", a visible CTA label and
 *     an accessible label, all non-empty in the interface language;
 *   - a launchable destination (a real concept id), or else the safe
 *     no-action card instead of a broken button.
 * Deterministic fallbacks cover a missing/blank translation, a missing
 * recommendation and an invalid destination.
 */
import type { ActivityType } from '@/lib/activity-taxonomy';
import type { getMessages, MessageKey } from '@/lib/i18n/messages';
import type { ConceptMissionNow, ConceptMissionNowFallback } from './concept-mission';
import { activityLabel } from '@/app/dashboard/activityLabel';
import { activityCta } from '@/app/dashboard/activityCta';

type T = ReturnType<typeof getMessages>;

export type NowPresentation =
  | {
      kind: 'ACTION';
      activityType: ActivityType;
      actionConceptId: string;
      title: string;
      /** Shown only when the decision carries no explanatory facts. */
      why: string | null;
      ctaLabel: string;
      accessibleLabel: string;
    }
  | { kind: 'NO_ACTION'; fallback: ConceptMissionNowFallback };

/** "Why this is next" copy for activity types that have a dedicated sentence. */
const WHY_KEYS: Partial<Record<ActivityType, MessageKey>> = {
  LEARN_CHECK: 'activityWhy.LEARN_CHECK',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function isLaunchableConceptId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

export function resolveNowPresentation(now: ConceptMissionNow | null | undefined, t: T): NowPresentation {
  if (!now) return { kind: 'NO_ACTION', fallback: 'CANONICAL_ACTION_UNAVAILABLE' };

  if (now.kind === 'CANONICAL_ACTION' && now.activityType) {
    if (!isLaunchableConceptId(now.actionConceptId)) {
      // A decision we cannot launch is shown as "not available right now", never as a dead button.
      return { kind: 'NO_ACTION', fallback: 'CANONICAL_ACTION_UNAVAILABLE' };
    }
    const type = now.activityType;
    // Always through the certified mappers; the fallbacks only cover a blank/missing message.
    const title = text(activityLabel(now.activityType, t)) ?? t['conceptMission.nowFallbackTitle'];
    const ctaLabel = text(activityCta(now.activityType, t)) ?? t['conceptMission.nowFallbackCta'];
    const whyKey = WHY_KEYS[type];
    const why = now.facts.length > 0 ? null : (whyKey ? text(t[whyKey]) : null) ?? t['conceptMission.nowWhyDefault'];
    return {
      kind: 'ACTION',
      activityType: type,
      actionConceptId: now.actionConceptId,
      title,
      why,
      ctaLabel,
      accessibleLabel: `${ctaLabel}: ${title}`,
    };
  }

  return { kind: 'NO_ACTION', fallback: now.fallback ?? 'CANONICAL_ACTION_UNAVAILABLE' };
}
