import type { ActivityType } from '@/lib/activity-taxonomy';
import type { getMessages } from '@/lib/i18n/messages';

/**
 * Step 6L-A: UI translation only, mirroring activityLabel.ts's own
 * pattern exactly -- maps the existing ActivityType taxonomy to an
 * imperative, student-facing CTA verb ("Reforzar ahora", "Verificar
 * que ya lo dominas", ...), distinct from activityLabel's noun-form
 * badge text ("Sesión de reparación"). Never introduces a new activity
 * taxonomy, never changes what ActivityType a canonical decision
 * carries, and never chooses the activity itself -- the caller must
 * already have a real `ActivityType` from a canonical Phase 4
 * LearningDecision (or an equivalent certified source); this function
 * only renders it.
 */
export function activityCta(activityType: ActivityType, t: ReturnType<typeof getMessages>): string {
  return t[`activityCta.${activityType}` as keyof typeof t];
}
