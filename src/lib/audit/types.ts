import type { AIProvenance } from '@/lib/ai';

/**
 * Every decision type StudyUs actually records today (Phase 0E2 Step
 * 6). Deliberately does NOT include any future Learning Decision
 * Engine / Adaptive Teaching Engine type -- only real, existing
 * deterministic decisions get instrumented. See
 * docs/architecture/audit-trail.md for which candidates from the task
 * spec were considered and deliberately deferred, and why.
 */
export type DecisionType =
  | 'MASTERY_UPDATED'
  | 'KNOWLEDGE_STATE_PROJECTED'
  | 'VERIFICATION_REQUIRED'
  | 'VERIFICATION_NOT_REQUIRED'
  | 'VERIFICATION_RESOLVED'
  | 'LEARNING_DEBT_CREATED'
  | 'LEARNING_DEBT_RESOLVED'
  | 'MISCONCEPTION_RECORDED'
  // Phase 2C: a real lifecycle transition, not a new decision engine --
  // recorded from the same misconception-engine, alongside
  // MISCONCEPTION_RECORDED, only on an actual ACTIVE->RESOLVED or
  // RESOLVED->ACTIVE transition (never on every read).
  | 'MISCONCEPTION_RESOLVED'
  | 'MISCONCEPTION_REACTIVATED'
  // Phase 2D: Intervention Lifecycle. Recorded only on a genuine,
  // first-time state transition -- never on an idempotent replay (a
  // diagnosis re-INSERT that hits ON CONFLICT DO NOTHING, a
  // startRemediation call that returns an already-open path, or a
  // completeRemediationStep replay of an already-completed step all
  // emit none of these). DIAGNOSIS_RESOLVED covers both CONFIRMED and
  // REJECTED outcomes of a Diagnostic Check (reasonCode distinguishes
  // them) -- "resolved" here means "the open hypothesis question was
  // answered either way," not "the underlying cognitive problem is
  // fixed" (that is INTERVENTION_COMPLETED's job). See
  // docs/audits/STUDYUS_PHASE_2_FINAL_COGNITIVE_MASTERY_CERTIFICATION.md
  // §3 for the full lifecycle audit.
  | 'DIAGNOSIS_CREATED'
  | 'DIAGNOSIS_RESOLVED'
  | 'INTERVENTION_STARTED'
  | 'INTERVENTION_COMPLETED'
  // Phase 5F.2: recorded once per computed TeachingIntent by
  // adaptive-teaching.service.ts -- the minimal honest strategy
  // provenance the task's 5B.6/5F.2 instructions ask for, reusing this
  // existing generic audit trail rather than a new table/migration.
  // `decision_type`/`engine` are plain `text` columns with no DB-level
  // CHECK constraint (see database/migrations/
  // 20260831_1400_ai_execution_and_decision_audit.sql) -- only this TS
  // union is closed, so adding this value requires zero migration.
  | 'TEACHING_STRATEGY_SELECTED'
  // Phase 6 Step 6E: recorded by memory-projector.service.ts ONLY when
  // a genuine semantic Phase 6 MemoryState transition occurs (never on
  // an idempotent re-projection that leaves state unchanged, and never
  // on a duplicate operation_key application, which never reaches the
  // projector at all). SHADOW MODE: this is a write-only audit trail --
  // no product consumer reads Phase 6 state or these events yet. Same
  // zero-migration precedent as TEACHING_STRATEGY_SELECTED above.
  | 'MEMORY_ANCHOR_ESTABLISHED'
  | 'QUALIFIED_RETENTION_SUCCESS'
  | 'QUALIFIED_RETENTION_PARTIAL'
  | 'QUALIFIED_RETENTION_FAILURE'
  | 'MEMORY_STATE_REPROJECTED';

/**
 * Which existing deterministic engine produced this decision (Step 8).
 * `engineVersion` is a plain code constant (`'v1'`) unless a real,
 * already-existing policy/version number is available (e.g. the
 * knowledge-state projector's own `mastery_policy_version`/
 * `projection_version`) -- never fabricated semantic precision.
 */
export type DecisionEngine =
  | 'mastery-engine'
  | 'knowledge-state-projector'
  | 'verification-engine'
  | 'debt-resolution-engine'
  | 'misconception-engine'
  // Phase 2D: cognitive-diagnosis.service.ts (DIAGNOSIS_*) and
  // remediation.service.ts (INTERVENTION_*) -- two existing, separate
  // services, one shared engine label since both produce Intervention
  // Lifecycle transitions over the same diagnosis->remediation chain.
  | 'intervention-engine'
  // Phase 5: adaptive-teaching.service.ts -- see TEACHING_STRATEGY_SELECTED.
  | 'adaptive-teaching-engine'
  // Phase 6 Step 6E: memory-projector.service.ts -- see MEMORY_ANCHOR_ESTABLISHED etc.
  | 'memory-engine';

export interface DecisionEventInput {
  decisionType: DecisionType;
  engine: DecisionEngine;
  engineVersion: string;
  studentId?: string | null;
  subjectId?: string | null;
  conceptId?: string | null;
  /** Which domain table this decision was derived from, e.g. 'learning_evidence' | 'verification_attempts' | 'learning_debt'. */
  sourceEventType?: string | null;
  /** The row id in that domain table, when one exists yet at record time. */
  sourceEventId?: string | null;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  /** Machine-readable, drawn only from a reason the existing algorithm actually exposes (Step 7) -- never invented. */
  reasonCode?: string | null;
  reasonDetails?: Record<string, unknown> | null;
  /**
   * Set ONLY when this decision's evidence came from one unambiguous
   * AI execution (Step 15) -- never fabricated when evidence was
   * deterministic, or spanned multiple/zero AI calls (e.g. a
   * multi-question quiz bucket mixing AI-graded and structured
   * answers leaves this null; the full per-question list still lives
   * in the source learning_evidence.metadata).
   */
  aiExecutionId?: string | null;
  /** Extra safe, non-content metadata -- same content restrictions as ai_execution_events.metadata (Step 3/25). */
  metadata?: Record<string, unknown> | null;
}

/** Convenience: pulls just the executionId out of an AIProvenance, since that's ALL a decision_events row is ever allowed to reference. */
export function aiExecutionIdOf(provenance: AIProvenance | null | undefined): string | null {
  return provenance?.aiExecutionId ?? null;
}
