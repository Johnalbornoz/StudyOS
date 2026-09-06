/**
 * Phase 6 Closeout D1 -- structured operational logging for the
 * learning engine's failure boundaries.
 *
 * SCOPE: observability only. Emitting a line here NEVER alters control
 * flow -- callers keep their exact original throw/return/fallback
 * behavior; this module only makes an already-handled failure visible
 * in the deployment platform's structured logs.
 *
 * Server-only. No DB, no external package, no network, no clock beyond
 * the pure deployment-version helper. One failure -> one single-line
 * `[ops]` JSON record on stdout/stderr, which Vercel captures into
 * Runtime Logs. Operational failures deliberately do NOT go into the
 * domain audit tables (decision_events / ai_execution_events /
 * learning_debt_events) -- those are typed semantic-event stores, and a
 * DB-backed logger is useless in the failure that matters most (DB
 * unavailable).
 *
 * Privacy (Closeout D0 decision 1): `studentId` MUST NOT appear in
 * operational logs. The context is a CLOSED allowlist built key by key
 * -- an arbitrary object is never spread in, so `studentId`, `email`,
 * prompts, answers, request bodies, headers, tokens, etc. cannot leak
 * even if a caller passes them. `errorMessage` is length-bounded and
 * run through a conservative secret scrubber; the Error object itself
 * and its stack are never serialized.
 */

import { buildDeploymentVersion } from '@/lib/deployment-version';

export type OperationalSeverity = 'ERROR' | 'WARN';

/**
 * The ONLY fields a caller may attach. Every key is optional and
 * non-sensitive: UUIDs (conceptId/subjectId), an enum (activityType),
 * a bounded route string, the name of the dependency that failed, and
 * small aggregate counters. Anything not in this list is dropped by
 * `pickAllowedContext` before serialization.
 */
export interface OperationalContext {
  route?: string;
  failedSource?: string;
  conceptId?: string;
  subjectId?: string;
  activityType?: string;
  count?: number;
  conceptIds?: string[];
}

const ALLOWED_CONTEXT_KEYS = [
  'route',
  'failedSource',
  'conceptId',
  'subjectId',
  'activityType',
  'count',
  'conceptIds',
] as const;

const MAX_ERROR_MESSAGE_LENGTH = 300;
const MAX_CONCEPT_IDS_LOGGED = 50;

/**
 * Conservative redaction of obvious secret material that could appear
 * in a raw error message (a failed `pg` connection error famously
 * embeds the connection string). Not a guarantee -- the real guarantee
 * is that structured context is allowlisted and the Error/stack is
 * never serialized -- just defence in depth for the one free-text
 * field.
 */
function scrubSecrets(message: string): string {
  return message
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"']+/gi, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9._-]{10,}/g, '[redacted]')
    // key=value / key: value where the key name looks sensitive (allow a
    // prefix so DB_PASSWORD, CLERK_SECRET_KEY, x-api-key etc. all match)
    .replace(
      /([A-Za-z]*[_-]?(?:password|passwd|secret|token|api[_-]?key|authorization))(\s*[:=]\s*)(\S+)/gi,
      '$1$2[redacted]',
    )
    // never emit a student identifier, even if an error message embeds
    // one (Closeout D0 decision 1) -- studentId is not an allowlisted
    // context field either
    .replace(/\b(student(?:[_-]?id)?)(\s*[:=]\s*)(\S+)/gi, '$1$2[redacted]');
}

function normalizeErrorMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  const raw = error instanceof Error ? error.message : String(error);
  if (!raw) return undefined;
  const scrubbed = scrubSecrets(raw);
  return scrubbed.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${scrubbed.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
    : scrubbed;
}

function errorName(error: unknown): string | undefined {
  if (error instanceof Error && typeof error.name === 'string' && error.name.length > 0) return error.name;
  return undefined;
}

/** Build the context object key by key from the allowlist -- never spread. */
function pickAllowedContext(context: OperationalContext | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!context) return out;
  for (const key of ALLOWED_CONTEXT_KEYS) {
    const value = (context as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    if (key === 'conceptIds') {
      if (Array.isArray(value)) {
        out[key] = value.filter((v): v is string => typeof v === 'string').slice(0, MAX_CONCEPT_IDS_LOGGED);
      }
      continue;
    }
    if (key === 'count') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
      continue;
    }
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

interface OperationalLogInput {
  subsystem: string;
  operation: string;
  error?: unknown;
  context?: OperationalContext;
}

function emit(severity: OperationalSeverity, input: OperationalLogInput): void {
  try {
    const version = buildDeploymentVersion(process.env);
    const line: Record<string, unknown> = {
      at: severity === 'ERROR' ? 'operational_error' : 'operational_warning',
      severity,
      subsystem: input.subsystem,
      operation: input.operation,
    };
    const name = errorName(input.error);
    if (name) line.errorName = name;
    const message = normalizeErrorMessage(input.error);
    if (message) line.errorMessage = message;
    Object.assign(line, pickAllowedContext(input.context));
    line.commitSha = version.commitSha;
    line.environment = version.environment;

    const serialized = JSON.stringify(line);
    if (severity === 'ERROR') console.error('[ops]', serialized);
    else console.warn('[ops]', serialized);
  } catch {
    // Observability must never break the request. If building or
    // writing the line fails, drop it silently -- the caller's own
    // error handling is entirely unaffected.
  }
}

/**
 * A required learner-state / decision dependency failed. Emit this
 * BEFORE rethrowing -- it does not and must not change that the error
 * still propagates.
 */
export function logOperationalError(input: {
  subsystem: string;
  operation: string;
  error: unknown;
  context?: OperationalContext;
}): void {
  emit('ERROR', input);
}

/**
 * An optional / already-fail-soft dependency failed and the request
 * continues on its existing documented fallback. Emit this in addition
 * to returning that unchanged fallback value.
 */
export function logOperationalWarning(input: {
  subsystem: string;
  operation: string;
  error?: unknown;
  context?: OperationalContext;
}): void {
  emit('WARN', input);
}
