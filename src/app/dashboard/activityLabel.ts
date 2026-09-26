import type { ActivityType } from '@/lib/activity-taxonomy';
import type { getMessages, MessageKey } from '@/lib/i18n/messages';

/**
 * UI translation only -- maps the existing ActivityType taxonomy
 * (src/lib/activity-taxonomy.ts) to a localized, student-friendly
 * label. Never introduces a new activity taxonomy or changes what
 * ActivityType a decision carries.
 */
// Compile-time guarantee: every ActivityType has an activityLabel.* message
// (see activityCta.ts -- the LEARN_CHECK regression).
type ActivityLabelKey = `activityLabel.${ActivityType}`;
const _everyActivityHasLabel: ActivityLabelKey extends MessageKey ? true : never = true;
void _everyActivityHasLabel;

export function activityLabel(activityType: ActivityType, t: ReturnType<typeof getMessages>): string {
  return t[`activityLabel.${activityType}` satisfies ActivityLabelKey];
}
