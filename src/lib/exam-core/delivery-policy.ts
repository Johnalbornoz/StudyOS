/**
 * Track B / B1+B10 -- the DELIVERY policy of an exam version: navigation,
 * section progression, breaks, pause, feedback, result review, allowed
 * simulation modes and integrity. Stored as configuration in the existing
 * `exam_versions.navigation_rules` jsonb column (no new table), validated
 * here, then RESOLVED against the attempt's timing mode / simulation type and
 * FROZEN on the attempt at start (simulation_attempts.navigation_state.policy)
 * so a later configuration change never alters an attempt in flight.
 *
 * Integrity is not configurable downward: every exam attempt writes
 * independent (`aiAssistanceType: 'NONE'`) evidence, so the Tutor is always
 * restricted while an attempt is ACTIVE or PAUSED. A configuration that asks
 * for anything else is rejected, never silently honoured.
 */
import { z } from 'zod';
import type { SimulationType, TimingMode } from '@/lib/simulation/types';

export const SIMULATION_TYPE_VALUES = ['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'] as const;
export const TIMING_MODE_VALUES = ['UNTIMED', 'TRAINING_TIMED', 'OFFICIAL_SIMULATION_TIMED'] as const;

export const DeliveryPolicySchema = z.object({
  /** LINEAR: items strictly in order, no return. FREE_ORDER_WITHIN_SECTION: any open item of the current section, an answer is final once submitted. */
  navigation: z.enum(['LINEAR', 'FREE_ORDER_WITHIN_SECTION']).default('LINEAR'),
  /** Breaks between sections, keyed by the section key AFTER which the break happens. */
  breaks: z.array(z.object({ afterSectionKey: z.string().min(1), minutes: z.number().int().min(1).max(120) })).default([]),
  /** Item-level feedback while the attempt is running. AUTO = only in untimed topic/domain practice. */
  itemFeedback: z.enum(['AUTO', 'NEVER', 'AFTER_EACH_ITEM']).default('AUTO'),
  /** What the Student sees after submission. */
  resultReview: z.enum(['FULL', 'SCORES_ONLY']).default('FULL'),
  allowedSimulationTypes: z.array(z.enum(SIMULATION_TYPE_VALUES)).min(1).default([...SIMULATION_TYPE_VALUES]),
  allowedTimingModes: z.array(z.enum(TIMING_MODE_VALUES)).min(1).default([...TIMING_MODE_VALUES]),
  /** Permitted resources shown to the Student (calculator, formula sheet, dictionary...). Presentation + audit only. */
  permittedResources: z.array(z.string().min(1).max(60)).default([]),
  integrity: z
    .object({
      tutorAssistance: z.literal('BLOCKED').default('BLOCKED'),
      /** Hours without any activity after which an open attempt expires (lazy, on next access). */
      inactivityExpiryHours: z.number().int().min(1).max(168).default(24),
    })
    .default({ tutorAssistance: 'BLOCKED', inactivityExpiryHours: 24 }),
});

export type DeliveryPolicyConfig = z.infer<typeof DeliveryPolicySchema>;

export interface ResolvedDeliveryPolicy {
  v: 1;
  navigation: DeliveryPolicyConfig['navigation'];
  breaks: DeliveryPolicyConfig['breaks'];
  itemFeedback: 'NEVER' | 'AFTER_EACH_ITEM';
  resultReview: DeliveryPolicyConfig['resultReview'];
  permittedResources: string[];
  /** Hard = sections close at their deadline (official timing); soft = over-time is shown, never enforced. */
  timeLimit: 'NONE' | 'SOFT' | 'HARD';
  pauseAllowed: boolean;
  tutorAssistance: 'BLOCKED';
  inactivityExpiryHours: number;
}

export type ParsedDeliveryPolicy = { ok: true; policy: DeliveryPolicyConfig } | { ok: false; detail: string };

/**
 * `navigation_rules` predates Track B and may be NULL or carry legacy keys;
 * NULL means "all defaults", never an error. Unknown legacy keys are ignored
 * (zod strips them); a present-but-invalid known key is an error.
 */
export function parseDeliveryPolicy(raw: unknown): ParsedDeliveryPolicy {
  const parsed = DeliveryPolicySchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, policy: parsed.data };
}

export function resolveDeliveryPolicy(config: DeliveryPolicyConfig, simulationType: SimulationType, timingMode: TimingMode): ResolvedDeliveryPolicy {
  const itemFeedback =
    config.itemFeedback === 'AUTO'
      ? timingMode === 'UNTIMED' && (simulationType === 'TOPIC_EXAM' || simulationType === 'DOMAIN_EXAM')
        ? 'AFTER_EACH_ITEM'
        : 'NEVER'
      : config.itemFeedback;
  return {
    v: 1,
    navigation: config.navigation,
    breaks: config.breaks,
    // Official simulation timing never shows per-item feedback, whatever the config says.
    itemFeedback: timingMode === 'OFFICIAL_SIMULATION_TIMED' ? 'NEVER' : itemFeedback,
    resultReview: config.resultReview,
    permittedResources: config.permittedResources,
    timeLimit: timingMode === 'UNTIMED' ? 'NONE' : timingMode === 'OFFICIAL_SIMULATION_TIMED' ? 'HARD' : 'SOFT',
    // INV-F9-10: official simulation timing never permits pause.
    pauseAllowed: timingMode !== 'OFFICIAL_SIMULATION_TIMED',
    tutorAssistance: 'BLOCKED',
    inactivityExpiryHours: config.integrity.inactivityExpiryHours,
  };
}

export function isModeAllowed(config: DeliveryPolicyConfig, simulationType: SimulationType, timingMode: TimingMode): { allowed: boolean; reason?: 'SIMULATION_TYPE_NOT_ALLOWED' | 'TIMING_MODE_NOT_ALLOWED' } {
  if (!config.allowedSimulationTypes.includes(simulationType)) return { allowed: false, reason: 'SIMULATION_TYPE_NOT_ALLOWED' };
  if (!config.allowedTimingModes.includes(timingMode)) return { allowed: false, reason: 'TIMING_MODE_NOT_ALLOWED' };
  return { allowed: true };
}
