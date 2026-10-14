/**
 * A statement guard for read-only operations scripts (shadow reports): anything but a read is refused before it
 * reaches the database. Transaction control and `SET TRANSACTION READ ONLY` are allowed.
 */
const WRITE = /^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke|merge|refresh|vacuum|comment|copy|lock|call|do|reindex|cluster|notify|listen|set\s+(?!transaction\s+read\s+only))/i;
const CTE_WRITE = /\)\s*(insert|update|delete|merge)\b/i;
const TX = /^\s*(begin|commit|rollback|start\s+transaction|set\s+transaction\s+read\s+only)\b/i;
const SIDE_EFFECT_FUNCTIONS = /\b(nextval|setval|pg_advisory_lock|pg_advisory_xact_lock)\s*\(/i;

export function assertReadOnly(text: unknown): void {
  const t = typeof text === 'string' ? text : (text as { text?: string } | null)?.text ?? '';
  if (TX.test(t)) return;
  if (WRITE.test(t) || CTE_WRITE.test(t) || SIDE_EFFECT_FUNCTIONS.test(t)) throw new Error(`READ_ONLY_GUARD refused: ${t.trim().slice(0, 100)}`);
}
