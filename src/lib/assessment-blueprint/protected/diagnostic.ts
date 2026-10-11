/**
 * B2-A -- DIAGNOSTIC as a blueprint purpose (pure; selection hook only).
 *
 * A Diagnostic blueprint is concept-oriented and is not a mock: it has no slots, no fidelity and no stored
 * mock type. This file gives it a depth requirement the existing solver can satisfy -- a number of DIRECT,
 * dedicated questions per targeted concept, stated by a StudyUs policy.
 *
 * What it does NOT establish: that the selected questions are INDEPENDENT observations. That needs
 * item-level attribution and stimulus identity from the Question Bank and the independence rule owned by
 * the evidence layer. Until then a Diagnostic selection is a selection, not Q1 Diagnostic readiness.
 */
import { targetKey, type TargetKind } from '../solver/candidate';
import type { TargetPlan, TargetRequirement } from '../solver/plan';

/** The Question Bank now records attribution and stimulus identity (B2-B1); the independence rule is still the evidence layer's (B3). */
export const Q1_DIAGNOSTIC_FULL_SEMANTICS = 'DEFERRED_TO_B3' as const;

/** The depth a Diagnostic blueprint asks for. A StudyUs policy value, supplied by the caller; never a constant here. */
export interface DiagnosticDepthRequirement {
  /** DIRECT, dedicated questions wanted per targeted concept. */
  directQuestionsPerTarget: number;
  authority: 'STUDYUS_POLICY';
  policyRef: { id: string; version: string };
}

export function diagnosticTargetRequirements(kind: TargetKind, targetIds: readonly string[], depth: DiagnosticDepthRequirement): TargetRequirement[] {
  const n = Math.max(1, Math.floor(depth.directQuestionsPerTarget));
  return [...new Set(targetIds)].sort().map((id) => ({ targetKey: targetKey(kind, id), kind, id, priority: 1, opportunities: n, directOpportunities: n, independentDemonstrations: n }));
}

/**
 * The target plan of a Diagnostic blueprint: every target needs its DIRECT, dedicated questions; SUPPORTING
 * and DERIVED coverage count for nothing; no single question stands for two concepts. `hardExcludeExposed`
 * is decided by the pool's exposure rule, and is applied to the candidates before the solver runs.
 */
export function diagnosticTargetPlan(kind: TargetKind, targetIds: readonly string[], depth: DiagnosticDepthRequirement): TargetPlan {
  return {
    mode: 'TARGETS',
    family: 'EXAM_PREPARATION',
    targets: diagnosticTargetRequirements(kind, targetIds, depth),
    accept: { supporting: false, derived: false },
    soft: { difficulty: null, diversity: { questionTypes: 1, difficultyLevels: 1 }, avoidRecent: true },
    hard: { excludeRecent: false, maxSeconds: null },
    unresolvedTargets: [],
  };
}
