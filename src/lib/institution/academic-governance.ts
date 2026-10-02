/**
 * Track A -- academic governance hierarchy (frozen):
 *
 *   Authority   defines the official reference (immutable, versioned).
 *   Institution defines what the school requires and when.
 *   Teacher     operates the class where the Institution delegated authority.
 *   Student     executes assigned work and may keep learning autonomously.
 *
 * A lower level may ADD within its scope but may never modify a locked
 * decision of a higher level. Locks are enforced server-side (this module +
 * the services that call it); the UI only reflects them.
 *
 * Every governed change -- applied or denied -- is audited in
 * academic_governance_events (actor, institution, object, fields, old, new).
 */
import { db, type DbExecutor } from '@/lib/db';

export type OwnerScope = 'AUTHORITY' | 'INSTITUTION' | 'TEACHER' | 'STUDENT';
export type ActorScope = OwnerScope | 'PLATFORM';

export class FieldLockedError extends Error {
  readonly code = 'FIELD_LOCKED_BY_INSTITUTION' as const;
  constructor(public readonly fields: string[]) {
    super(`FIELD_LOCKED_BY_INSTITUTION: ${fields.join(', ')}`);
    this.name = 'FieldLockedError';
  }
}

export async function recordGovernanceEvent(
  event: {
    institutionId: string | null;
    actorUserId: string | null;
    actorScope: ActorScope;
    objectType: string;
    objectId: string | null;
    action: string;
    fields?: string[];
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    outcome?: 'APPLIED' | 'DENIED';
  },
  client: DbExecutor = db
): Promise<void> {
  await client.query(
    `INSERT INTO academic_governance_events (institution_id, actor_user_id, actor_scope, object_type, object_id, action, fields, old_values, new_values, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      event.institutionId,
      event.actorUserId,
      event.actorScope,
      event.objectType,
      event.objectId,
      event.action,
      event.fields ?? [],
      JSON.stringify(event.oldValues ?? {}),
      JSON.stringify(event.newValues ?? {}),
      event.outcome ?? 'APPLIED',
    ]
  );
}

/** Which of the requested fields a lower level may not change. */
export function lockedFieldsTouched(requested: string[], lockedFields: readonly string[]): string[] {
  return requested.filter((f) => lockedFields.includes(f));
}
