import { db } from '@/lib/db';
import type { AIExecutionMetadata, AIExecutionContext } from './types';

/**
 * The persistence boundary between the AI gateway and the database
 * (Phase 0E2 Step 9). The gateway itself has zero knowledge of SQL,
 * `ai_execution_events`, or any domain-specific student/mastery logic
 * -- it only calls `record()` on whichever sink is currently active.
 * This keeps `src/lib/ai/gateway.ts` a clean, storage-agnostic AI
 * transport layer, and makes the sink trivially swappable in tests.
 */
export interface AIExecutionAuditEntry {
  execution: AIExecutionMetadata;
  context?: AIExecutionContext;
}

export interface AIExecutionAuditSink {
  record(entry: AIExecutionAuditEntry): Promise<void>;
}

/**
 * Failure policy (Step 10): audit persistence must never break the
 * primary AI/domain operation. This sink catches and logs every error
 * itself -- it NEVER throws. The gateway awaits it (so a caller that
 * cares can rely on the write having been attempted by the time
 * `executeAI()` resolves, which keeps tests deterministic -- see
 * tests/unit/ai-audit.test.ts), but a failed write still resolves
 * normally; it just means an audit row wasn't recorded. There is no
 * scenario where a successful AI execution is lost, rolled back, or
 * reported as failed because the audit database was unavailable.
 */
export const postgresAIExecutionAuditSink: AIExecutionAuditSink = {
  async record({ execution, context }) {
    try {
      await db.query(
        `INSERT INTO ai_execution_events (
           execution_id, capability, risk, provider, model, prompt_id, prompt_version,
           status, validation_status, fallback_used, error_code, duration_ms,
           student_id, subject_id, concept_id, source_component, source_id, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (execution_id) DO NOTHING`,
        [
          execution.executionId,
          execution.capability,
          execution.risk,
          execution.provider,
          execution.model,
          execution.promptId,
          execution.promptVersion,
          execution.success ? 'SUCCESS' : 'FAILURE',
          execution.validationStatus,
          execution.fallbackUsed,
          execution.errorCode ?? null,
          execution.durationMs,
          context?.studentId ?? null,
          context?.subjectId ?? null,
          context?.conceptId ?? null,
          context?.sourceComponent ?? null,
          context?.sourceId ?? null,
          null, // metadata: reserved for future safe, non-content additions -- nothing populates it yet
        ]
      );
    } catch (err) {
      // Observable, never thrown -- see the failure policy note above.
      console.error('[ai-audit] failed to persist ai_execution_events row', {
        executionId: execution.executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

/** Never writes anywhere -- the default sink in test environments (Step 12's documented carve-out) unless a test explicitly installs its own via setAIExecutionAuditSink. */
export const noopAIExecutionAuditSink: AIExecutionAuditSink = {
  async record() {
    // intentionally does nothing
  },
};

// Vitest sets VITEST=true (and NODE_ENV=test) in every test run -- default
// to the no-op sink there so the 655+ pre-existing tests (which never mock
// @/lib/db) don't attempt a real database connection. A test that wants to
// assert on audit persistence installs postgresAIExecutionAuditSink (against
// a mocked @/lib/db) or its own sink explicitly via setAIExecutionAuditSink.
let activeSink: AIExecutionAuditSink = process.env.VITEST === 'true' ? noopAIExecutionAuditSink : postgresAIExecutionAuditSink;

export function setAIExecutionAuditSink(sink: AIExecutionAuditSink): void {
  activeSink = sink;
}

export function getAIExecutionAuditSink(): AIExecutionAuditSink {
  return activeSink;
}
