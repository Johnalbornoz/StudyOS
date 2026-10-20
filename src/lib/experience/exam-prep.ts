/**
 * UX-2 -- presentation vocabulary for "Preparación de examen".
 *
 * Pure lookups over values the server already produced. Backend enum
 * values (`simulationType`, `timingMode`, readiness statuses, eligibility
 * reason codes) are never shown to the Student and never changed; nothing
 * here decides eligibility, readiness or what to practise.
 */
import type { MessageKey } from '@/lib/i18n/messages';
import type { OverallReadinessStatus } from '@/lib/readiness/types';

export const SIMULATION_TYPES = ['MINI_MOCK', 'FULL_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM'] as const;
export type SimulationType = (typeof SIMULATION_TYPES)[number];
/** Offered as primary choices; the other two need a target id and live under "advanced". */
export const PRIMARY_SIMULATION_TYPES = ['MINI_MOCK', 'FULL_MOCK'] as const satisfies readonly SimulationType[];

export const TIMING_MODES = ['UNTIMED', 'TRAINING_TIMED', 'OFFICIAL_SIMULATION_TIMED'] as const;
export type TimingMode = (typeof TIMING_MODES)[number];

// Compile-time guarantee: every enum value has Student copy.
type TypeKeys = `ex.type.${SimulationType}` | `ex.typeBody.${SimulationType}`;
type TimingKeys = `ex.timing.${TimingMode}` | `ex.timingBody.${TimingMode}`;
const _copy: TypeKeys | TimingKeys extends MessageKey ? true : never = true;
void _copy;

/**
 * B1-C -- the label of what an attempt IS. An attempt that belongs to an exam instance is named by the
 * instance's mode (the stored simulation type of every instance attempt is FULL_MOCK, whatever its mode), so
 * a practice instance is never presented as a full mock. An attempt with no instance keeps its type label.
 */
export function attemptKindLabelKey(a: { simulationType: string; instanceMode?: string | null; instanceFidelity?: string | null }): string {
  if (a.simulationType === 'PREPARATION_MOCK') return 'exv2.mode.MOCK.preparation';
  if (a.instanceMode === 'MOCK') return a.instanceFidelity === 'FULL' ? 'exv2.mode.MOCK.full' : 'exv2.mode.MOCK.reduced';
  if (a.instanceMode) return `exv2.mode.${a.instanceMode}`;
  return `ex.type.${a.simulationType}`;
}

export function simulationTypeLabelKey(type: SimulationType): `ex.type.${SimulationType}` {
  return `ex.type.${type}`;
}
export function simulationTypeBodyKey(type: SimulationType): `ex.typeBody.${SimulationType}` {
  return `ex.typeBody.${type}`;
}
export function timingModeLabelKey(mode: TimingMode): `ex.timing.${TimingMode}` {
  return `ex.timing.${mode}`;
}
export function timingModeBodyKey(mode: TimingMode): `ex.timingBody.${TimingMode}` {
  return `ex.timingBody.${mode}`;
}

/**
 * The F9 overall readiness statuses in their own declared order (the
 * union in lib/readiness/types.ts) -- used only to draw where the
 * server-reported status sits on that scale.
 */
export const READINESS_ORDER: readonly OverallReadinessStatus[] = [
  'INSUFFICIENT_EVIDENCE',
  'EARLY_PREPARATION',
  'DEVELOPING',
  'SIMULATION_READY',
  'FULL_MOCK_ELIGIBLE',
];

/**
 * Eligibility reasons come back as codes (e.g. "MANDATORY_DOMAIN_INCOMPLETE:
 * <id>"). The Student sees one plain sentence per category, never the code.
 */
export type EligibilityReasonKey = 'ex.reason.unavailable' | 'ex.reason.domainIncomplete' | 'ex.reason.needsTarget' | 'ex.reason.notFound';

export function eligibilityReasonKey(reason: string): EligibilityReasonKey {
  const code = reason.split(':')[0].trim();
  if (code === 'MANDATORY_DOMAIN_INCOMPLETE') return 'ex.reason.domainIncomplete';
  if (code === 'LEARNING_OBJECTIVE_ID_REQUIRED' || code === 'ACADEMIC_SUBJECT_ID_REQUIRED') return 'ex.reason.needsTarget';
  if (code === 'NO_BLUEPRINT_TARGET_FOR_OBJECTIVE' || code === 'NO_BLUEPRINT_TARGETS_FOR_SUBJECT') return 'ex.reason.notFound';
  return 'ex.reason.unavailable';
}

/** De-duplicated Student messages for a list of reasons (several codes can map to one sentence). */
export function eligibilityReasonKeys(reasons: readonly string[]): EligibilityReasonKey[] {
  return [...new Set(reasons.map(eligibilityReasonKey))];
}
