/**
 * Fase 2A -- the administrative action audit log. Distinct from, and
 * never mixed with, `ai_execution_events`/`decision_events` (those are
 * pedagogical/AI decision provenance, not administrative actions).
 * Every write here is append-only; nothing in this module ever reads
 * back to make an authorization decision -- audit is a record, not a
 * gate. Never accepts a secret/credential value in any field.
 */
import { db } from '@/lib/db';

export type AdminAuditAction =
  | 'INVITE_SENT'
  | 'INVITE_RESENT'
  | 'INVITE_REVOKED'
  | 'ROLE_ADDED'
  | 'ROLE_REVOKED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED'
  | 'USER_ARCHIVED'
  | 'SESSIONS_REVOKED'
  | 'TEST_IDENTITY_CREATED'
  | 'TEST_IDENTITY_CLEANED_UP'
  | 'SYNC_RECONCILED'
  | 'SYNC_ERROR_DETECTED';

export interface RecordAdminActionInput {
  actorUserId: string;
  action: AdminAuditAction;
  targetType: 'USER' | 'ROLE' | 'INVITATION' | 'TEST_IDENTITY';
  targetId?: string | null;
  previousState?: unknown;
  newState?: unknown;
  reason?: string | null;
  result?: 'SUCCESS' | 'FAILURE';
  correlationId?: string | null;
}

/** `environment` is always derived server-side from `VERCEL_ENV`, never accepted from a caller (INV-ADMIN2A-03). */
function resolveEnvironment(): string {
  return process.env.VERCEL_ENV ?? 'development';
}

export async function recordAdminAction(input: RecordAdminActionInput): Promise<void> {
  await db.query(
    `
    INSERT INTO admin_audit_log
      (actor_user_id, action, target_type, target_id, previous_state, new_state, reason, result, environment, correlation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.previousState !== undefined ? JSON.stringify(input.previousState) : null,
      input.newState !== undefined ? JSON.stringify(input.newState) : null,
      input.reason ?? null,
      input.result ?? 'SUCCESS',
      resolveEnvironment(),
      input.correlationId ?? null,
    ]
  );
}

export interface AdminAuditEntry {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  result: string;
  environment: string;
  occurredAt: string;
}

/** History for one target, most recent first. Never returns previous_state/new_state raw blobs to a generic list caller beyond what the UI needs -- callers requiring detail should query explicitly and are responsible for redacting. */
export async function listAuditHistoryForTarget(targetType: string, targetId: string): Promise<AdminAuditEntry[]> {
  const result = await db.query(
    `SELECT id, actor_user_id, action, target_type, target_id, reason, result, environment, occurred_at
     FROM admin_audit_log WHERE target_type = $1 AND target_id = $2 ORDER BY occurred_at DESC LIMIT 100`,
    [targetType, targetId]
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    result: r.result,
    environment: r.environment,
    occurredAt: new Date(r.occurred_at).toISOString(),
  }));
}
