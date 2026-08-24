import type { ActivityType } from '@/lib/activity-taxonomy';
import type { getMessages } from '@/lib/i18n/messages';

/**
 * UI translation only -- maps the existing ActivityType taxonomy
 * (src/lib/activity-taxonomy.ts) to a localized, student-friendly
 * label. Never introduces a new activity taxonomy or changes what
 * ActivityType a decision carries.
 */
export function activityLabel(activityType: ActivityType, t: ReturnType<typeof getMessages>): string {
  return t[`activityLabel.${activityType}` as keyof typeof t];
}
