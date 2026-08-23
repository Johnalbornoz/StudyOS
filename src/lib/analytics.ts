/**
 * Product Analytics (Phase 2, brief section 85): a minimal internal
 * event log, not tied to any external provider -- the event names the
 * brief specifies are what matter architecturally; where they
 * eventually ship (PostHog, Amplitude, a warehouse export) is a later,
 * separate decision. Never allowed to break the actual feature it's
 * instrumenting, so failures are swallowed.
 */

import { db } from '@/lib/db';

export async function track(studentId: string, eventName: string, properties?: Record<string, unknown>): Promise<void> {
  try {
    await db.query(
      `INSERT INTO analytics_events (student_id, event_name, properties) VALUES ($1, $2, $3)`,
      [studentId, eventName, properties ? JSON.stringify(properties) : null]
    );
  } catch (err) {
    console.error(`analytics track failed (${eventName}):`, err);
  }
}
