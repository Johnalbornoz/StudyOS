/**
 * Question Bank Factory -- the governed item-version LIFECYCLE (pure).
 *
 *   DRAFT_AI -> VALIDATING -> VALIDATED -> PILOT -> CALIBRATED -> ACTIVE
 *   exceptions: REPAIR_REQUIRED, REVIEW_REQUIRED, REJECTED, SUSPENDED, RETIRED,
 *               SUPERSEDED (a newer version of the same item replaced this one).
 *
 * The lifecycle lives on the item VERSION (an `approved_items` row) and is
 * kept consistent with the pre-existing `approved_items.status`: a version is
 * PUBLISHED exactly when it is PILOT, CALIBRATED or ACTIVE.
 *
 * PUBLISHED is NOT "Student-deliverable". A PILOT version passed automated
 * validation only and awaits a qualified human reviewer (pilots/human-review.ts):
 * it is never shown to a Student. Student delivery is decided by ONE rule,
 * `DEFAULT_ELIGIBILITY` -- through `isEligible` (in memory) and
 * `lifecycleSqlFor` (SQL); every Student-facing selector uses one of them. The same transition table is enforced by the database
 * trigger `question_bank_version_guard` (migration 20261026_1000) -- an
 * invalid transition fails twice, never silently.
 */

import { contentAudienceSql, type ContentAudience } from '../audience';
import { MOCK_USAGES, usageAllows, type UsageType } from './quality';
import type { Provenance } from './policy';

export const LIFECYCLE_STATES = [
  'DRAFT_AI', 'VALIDATING', 'VALIDATED', 'PILOT', 'CALIBRATED', 'ACTIVE',
  'REPAIR_REQUIRED', 'REVIEW_REQUIRED', 'REJECTED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Allowed transitions -- mirrors `question_bank_transition_allowed` in the migration (tests assert they agree). */
export const LIFECYCLE_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  DRAFT_AI: ['VALIDATING', 'REJECTED'],
  VALIDATING: ['VALIDATED', 'REPAIR_REQUIRED', 'REVIEW_REQUIRED', 'REJECTED'],
  REPAIR_REQUIRED: ['SUPERSEDED', 'REJECTED', 'REVIEW_REQUIRED'],
  REVIEW_REQUIRED: ['VALIDATED', 'PILOT', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED'],
  VALIDATED: ['PILOT', 'ACTIVE', 'REJECTED', 'RETIRED', 'SUPERSEDED'],
  PILOT: ['CALIBRATED', 'ACTIVE', 'REVIEW_REQUIRED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED'],
  CALIBRATED: ['ACTIVE', 'REVIEW_REQUIRED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED'],
  ACTIVE: ['CALIBRATED', 'REVIEW_REQUIRED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED'],
  SUSPENDED: ['ACTIVE', 'PILOT', 'REVIEW_REQUIRED', 'RETIRED', 'SUPERSEDED'],
  REJECTED: [],
  RETIRED: [],
  SUPERSEDED: [],
};

export const TERMINAL_STATES: readonly LifecycleState[] = ['REJECTED', 'RETIRED', 'SUPERSEDED'];

export type ApprovedItemStatus = 'DRAFT' | 'PROPOSED' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'RETIRED';

/** The `approved_items.status` a lifecycle state implies (the delivery contract). */
export function deliveryStatusFor(state: LifecycleState): ApprovedItemStatus {
  switch (state) {
    case 'PILOT':
    case 'CALIBRATED':
    case 'ACTIVE':
      return 'PUBLISHED';
    case 'DRAFT_AI':
    case 'VALIDATING':
      return 'DRAFT';
    case 'VALIDATED':
      return 'APPROVED';
    case 'REPAIR_REQUIRED':
    case 'REVIEW_REQUIRED':
    case 'SUSPENDED':
      return 'IN_REVIEW';
    case 'REJECTED':
      return 'REJECTED';
    case 'RETIRED':
    case 'SUPERSEDED':
      return 'RETIRED';
  }
}

export type TransitionActor = { kind: 'SYSTEM' } | { kind: 'ADMIN'; userId: string } | { kind: 'MIGRATION' };

export class LifecycleTransitionError extends Error {
  constructor(public readonly code: 'INVALID_TRANSITION' | 'PILOT_REQUIRED' | 'ADMIN_REQUIRED' | 'REASON_REQUIRED', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'LifecycleTransitionError';
  }
}

/** Transitions only an authorised human may take (never the unattended factory). */
const ADMIN_ONLY: ReadonlyArray<[LifecycleState, LifecycleState]> = [
  ['REVIEW_REQUIRED', 'VALIDATED'],
  ['REVIEW_REQUIRED', 'PILOT'],
  ['REVIEW_REQUIRED', 'ACTIVE'],
  ['VALIDATED', 'ACTIVE'],
  ['PILOT', 'ACTIVE'],
  ['SUSPENDED', 'ACTIVE'],
  ['SUSPENDED', 'PILOT'],
];

/**
 * Throws unless `from -> to` is allowed for this actor and item provenance.
 * Generated content (STUDYUS_GENERATED) can never skip PILOT, whoever asks.
 */
export function assertTransition(from: LifecycleState | null, to: LifecycleState, ctx: { actor: TransitionActor; provenance: string; reason: string }): void {
  if (!ctx.reason || !ctx.reason.trim()) throw new LifecycleTransitionError('REASON_REQUIRED', `${from} -> ${to}`);
  if (from === null || from === to) return;
  if (!LIFECYCLE_TRANSITIONS[from].includes(to)) throw new LifecycleTransitionError('INVALID_TRANSITION', `${from} -> ${to}`);
  if (from === 'VALIDATED' && to === 'ACTIVE' && ctx.provenance === 'STUDYUS_GENERATED') throw new LifecycleTransitionError('PILOT_REQUIRED', 'generated items must pilot first');
  if (ctx.actor.kind !== 'ADMIN' && ADMIN_ONLY.some(([f, t]) => f === from && t === to)) throw new LifecycleTransitionError('ADMIN_REQUIRED', `${from} -> ${to}`);
}

export function canTransition(from: LifecycleState | null, to: LifecycleState, ctx: { actor: TransitionActor; provenance: string }): boolean {
  try {
    assertTransition(from, to, { ...ctx, reason: 'check' });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Content-use eligibility (server-authoritative, explicit per mode)    */
/* ------------------------------------------------------------------ */

export type DeliveryUse = 'PRACTICE' | 'REDUCED_MOCK' | 'FULL_MOCK' | 'FULL_MOCK_CALIBRATED';

export const CALIBRATION_CONFIDENCE = ['INSUFFICIENT_DATA', 'EARLY_SIGNAL', 'MODERATE_CONFIDENCE', 'HIGH_CONFIDENCE'] as const;
export type CalibrationConfidence = (typeof CALIBRATION_CONFIDENCE)[number];
export const confidenceAtLeast = (c: CalibrationConfidence | null | undefined, min: CalibrationConfidence) =>
  CALIBRATION_CONFIDENCE.indexOf(c ?? 'INSUFFICIENT_DATA') >= CALIBRATION_CONFIDENCE.indexOf(min);

export interface EligibilityPolicy {
  /** Lifecycle states each use may draw from. */
  states: Record<DeliveryUse, readonly LifecycleState[]>;
  /** Minimum calibration confidence for the calibrated full form. */
  calibratedMinConfidence: CalibrationConfidence;
}

/**
 * The ONE Student delivery rule. Every Student use (practice -- which also serves diagnostics --, reduced and
 * full mocks) draws only from human-approved content: ACTIVE (human review PASS) or CALIBRATED (ACTIVE plus
 * field evidence). PILOT (automated pass, awaiting human review), REVIEW_REQUIRED (correction required),
 * REJECTED (human or automated) and every earlier state are never Student-deliverable: the Student is never
 * the academic reviewer. The calibrated full form additionally needs field evidence; a mock is never filled
 * with weaker content to reach its length. DEV fixtures are excluded by audience (see `isEligible`).
 * Admin / reviewer / technical tools read PILOT directly, never through this rule.
 */
export const DEFAULT_ELIGIBILITY: EligibilityPolicy = {
  states: {
    PRACTICE: ['CALIBRATED', 'ACTIVE'],
    REDUCED_MOCK: ['CALIBRATED', 'ACTIVE'],
    FULL_MOCK: ['CALIBRATED', 'ACTIVE'],
    FULL_MOCK_CALIBRATED: ['CALIBRATED', 'ACTIVE'],
  },
  calibratedMinConfidence: 'MODERATE_CONFIDENCE',
};

/** Lifecycle states a Student may ever receive: derived from `DEFAULT_ELIGIBILITY` (never a second list). */
export const STUDENT_DELIVERABLE_STATES: readonly LifecycleState[] = [...new Set(Object.values(DEFAULT_ELIGIBILITY.states).flat())];

export interface EligibilityFacts {
  lifecycle: LifecycleState | null;
  /** V2 quality metadata (NULL = legacy row = every use). */
  usage?: readonly string[] | null;
  alignment?: string | null;
  provenance?: string;
  /** approved_items.status (legacy rows without a lifecycle). */
  status: string;
  isCurrentVersion: boolean;
  retired: boolean;
  calibrationConfidence: CalibrationConfidence | null;
}

/** Effective lifecycle of a version: a legacy PUBLISHED row without a lifecycle behaves as ACTIVE. */
export function effectiveLifecycle(f: Pick<EligibilityFacts, 'lifecycle' | 'status'>): LifecycleState | null {
  if (f.lifecycle) return f.lifecycle;
  return f.status === 'PUBLISHED' ? 'ACTIVE' : null;
}

/** The usage type a delivery use requires (V2 usage eligibility). */
export const USAGE_FOR_USE: Record<DeliveryUse, UsageType> = { PRACTICE: 'PRACTICE', REDUCED_MOCK: 'REDUCED_MOCK', FULL_MOCK: 'FULL_MOCK', FULL_MOCK_CALIBRATED: 'FULL_MOCK' };

/**
 * May this version be delivered for `use`? `audience` STUDENT (the default) never accepts a DEV fixture
 * (unknown provenance counts as a fixture); TECHNICAL_DEMO is the in-process engine / certification context.
 */
export function isEligible(f: EligibilityFacts, use: DeliveryUse, policy: EligibilityPolicy = DEFAULT_ELIGIBILITY, audience: ContentAudience = 'STUDENT'): boolean {
  if (f.retired || !f.isCurrentVersion || f.status !== 'PUBLISHED') return false;
  if (audience === 'STUDENT' && (f.provenance ?? 'FIXTURE') === 'FIXTURE') return false;
  const state = effectiveLifecycle(f);
  if (!state || !policy.states[use].includes(state)) return false;
  if (use === 'FULL_MOCK_CALIBRATED' && !confidenceAtLeast(f.calibrationConfidence, policy.calibratedMinConfidence)) return false;
  // V2: the version must be eligible for this use (a PRACTICE-only item never enters a mock).
  if (!usageAllows(f.usage ?? null, f.alignment ?? null, (f.provenance ?? 'FIXTURE') as Provenance, USAGE_FOR_USE[use])) return false;
  return true;
}

/** SQL predicate fragment for the lifecycle states a delivery use may draw from (alias `ai`). */
export function lifecycleSqlFor(use: DeliveryUse, policy: EligibilityPolicy = DEFAULT_ELIGIBILITY, audience: ContentAudience = 'STUDENT'): string {
  const states = policy.states[use].map((s) => `'${s}'`).join(', ');
  // A legacy row without a lifecycle is the grandfathered ACTIVE state (only when ACTIVE is allowed).
  const legacy = policy.states[use].includes('ACTIVE') ? 'ai.bank_lifecycle_status IS NULL OR ' : '';
  // V2 usage eligibility + exam alignment (NULL = legacy row = every use). Constants only: no input reaches this SQL.
  const usage = USAGE_FOR_USE[use];
  const alignment = MOCK_USAGES.includes(usage) ? ` AND (ai.exam_alignment IS NULL OR ai.exam_alignment IN ('MOCK_READY', 'OFFICIAL'))` : '';
  // Content audience: a Student delivery never draws a DEV fixture (TECHNICAL_DEMO adds nothing).
  const content = audience === 'STUDENT' ? ` AND ${contentAudienceSql('STUDENT', 'ai')}` : '';
  return `((${legacy}ai.bank_lifecycle_status IN (${states})) AND (ai.usage_eligibility IS NULL OR '${usage}' = ANY(ai.usage_eligibility))${alignment}${content})`;
}
