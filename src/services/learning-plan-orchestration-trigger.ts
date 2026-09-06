/**
 * Phase 8 -- Step 8E1: the lightweight post-commit orchestration
 * notification helper.
 *
 * Called from high-level write boundaries AFTER a canonical mutation
 * has COMMITTED (never inside a cognitive transaction). It is
 * FAIL-SOFT by contract: any failure is logged and swallowed, and the
 * already-committed canonical result is returned unchanged. It NEVER
 * throws, NEVER rolls anything back, and NEVER creates a first plan --
 * a background trigger only maintains an ALREADY-ACTIVE plan; the first
 * plan is always explicit (8D1 `POST /api/learning/plan/rebuild`).
 *
 * §8E1.7: `mastery.service.ts` must not depend on Phase 8 planning
 * internals -- it depends only on THIS module, and this module reaches
 * `maintainLearningPlan` through a lazy `import()` so there is no
 * static import edge from Phase 2 into Phase 8.
 *
 * §8E1.8 MVP debt: for now this fires a bounded replan after every
 * accepted evidence application (no per-transition filtering). It is
 * bounded (one maintenance pass, batched reads, no AI) and the second
 * pass for an unchanged state is a semantic no-op. Optimizing to fire
 * only on a meaningful KS / retention / verification / transfer
 * transition is documented follow-up debt.
 */
import { db } from '@/lib/db';
import { logOperationalWarning } from '@/lib/observability/operational-log';

export type OrchestrationChangeCause =
  | 'EVIDENCE_APPLIED'
  | 'VERIFICATION_RESOLVED'
  | 'RETENTION_RESULT'
  | 'TRANSFER_RESULT'
  | 'REMEDIATION_CHANGED'
  | 'ASSESSMENT_CHANGED'
  | 'AVAILABILITY_CHANGED'
  | 'LEARNER_SCHEDULE_CHANGED';

export async function notifyLearningOrchestrationChange(studentId: string, cause: OrchestrationChangeCause): Promise<void> {
  try {
    // Only maintain an already-active plan -- never auto-create one.
    const active = await db.query(`SELECT 1 FROM learning_plan WHERE student_id = $1 AND status = 'ACTIVE' LIMIT 1`, [studentId]);
    if ((active.rowCount ?? 0) === 0) return;

    const { maintainLearningPlan } = await import('@/services/learning-plan-maintenance.service');
    await maintainLearningPlan(studentId, new Date());
  } catch (error) {
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'notifyLearningOrchestrationChange',
      error,
      context: { failedSource: cause },
    });
  }
}
