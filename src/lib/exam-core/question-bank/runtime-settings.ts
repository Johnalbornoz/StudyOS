/**
 * Question Bank Factory -- RUNTIME controls (pure).
 *
 * Three independent decisions, never one switch:
 *   A. product capability       -- factoryEnabled (master)
 *   B. administrative consumption -- onDemandEnabled, demoMode, soft budget,
 *                                    alert thresholds (warnings, never blocks)
 *   C. automatic scheduling     -- scheduledEnabled (Factory ON does NOT imply it)
 *
 * Source of truth in normal operation: the Platform Admin settings stored in
 * `platform_settings` (key `question_bank.factory`). The environment is only
 * the BOOTSTRAP default (no stored row yet = exactly the previous env-driven
 * behaviour) and the EMERGENCY fallback (QUESTION_BANK_FACTORY_KILL_SWITCH).
 *
 * Demo Mode turns the administrative limits (soft daily budget, per-run soft
 * cap, small batch size, scheduled allowlist for on-demand runs) into
 * telemetry. It never touches the hard technical protections: provider
 * limits, the shared platform AI ceiling (+ reserve), the hard daily safety
 * limit, the runaway per-run ceiling, the run deadline, the one-run-at-a-time
 * lock and idempotency. It never changes question governance (generated items
 * still land in PILOT and need review before ACTIVE). Demo Mode can never be
 * enabled in Production.
 */
import { z } from 'zod';
import type { FactoryConfig } from './policy';

type Env = Record<string, string | undefined>;

export const FACTORY_SETTINGS_KEY = 'question_bank.factory';

/** Demo Mode ceilings: product-sized, still bounded (DB allows 1..25 candidates per request, generated in AI calls of 5). */
export const DEMO_MAX_BATCH = 25;
/** Runaway-loop protection per run in Demo Mode (calls). */
export const DEMO_RUNAWAY_MAX_PER_RUN = 60;

export const FactoryRuntimeSettingsSchema = z.strictObject({
  factoryEnabled: z.boolean(),
  onDemandEnabled: z.boolean(),
  scheduledEnabled: z.boolean(),
  demoMode: z.boolean(),
  /** Factory AI calls per UTC day before the soft budget is reached (blocks only outside Demo Mode). */
  dailySoftBudget: z.number().int().min(0).max(100_000),
  /** Consumption alert thresholds, % of the platform AI day ceiling: informational, warning, critical. Never block. */
  warningThresholds: z.tuple([z.number().int().min(1).max(99), z.number().int().min(1).max(99), z.number().int().min(1).max(99)]).refine(([a, b, c]) => a < b && b < c, 'thresholds must increase'),
  /** Hard safety ceiling of factory AI calls per UTC day (runaway protection). Always enforced. */
  hardSafetyLimit: z.number().int().min(1).max(100_000),
});
export type FactoryRuntimeSettings = z.infer<typeof FactoryRuntimeSettingsSchema>;

export const FactoryRuntimeSettingsPatchSchema = z.strictObject({
  factoryEnabled: z.boolean().optional(),
  onDemandEnabled: z.boolean().optional(),
  scheduledEnabled: z.boolean().optional(),
  demoMode: z.boolean().optional(),
  dailySoftBudget: z.number().int().min(0).max(100_000).optional(),
  warningThresholds: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
  hardSafetyLimit: z.number().int().min(1).max(100_000).optional(),
});
export type FactoryRuntimeSettingsPatch = z.infer<typeof FactoryRuntimeSettingsPatchSchema>;

export function deploymentEnvironment(env: Env = process.env): string {
  return env.VERCEL_TARGET_ENV ?? env.VERCEL_ENV ?? 'development';
}

export const isProductionEnvironment = (env: Env = process.env) => deploymentEnvironment(env) === 'production';
export const killSwitchOn = (env: Env = process.env) => env.QUESTION_BANK_FACTORY_KILL_SWITCH === 'true';

/** Bootstrap defaults = the previous environment-driven behaviour (no stored settings yet). */
export function settingsFromEnvironment(base: FactoryConfig): FactoryRuntimeSettings {
  return {
    factoryEnabled: base.enabled,
    onDemandEnabled: base.enabled,
    // The scheduled run used to start whenever the factory was enabled; with no allowlisted exam it did nothing.
    scheduledEnabled: base.enabled && base.examConfigKeys.length > 0,
    demoMode: false,
    dailySoftBudget: base.dailyBudget,
    warningThresholds: [50, 75, 90],
    hardSafetyLimit: base.hardDailyLimit,
  };
}

export interface ResolvedFactorySettings {
  settings: FactoryRuntimeSettings;
  source: 'PLATFORM_ADMIN' | 'ENVIRONMENT_DEFAULT';
  killSwitch: boolean;
  /** Demo Mode was stored ON but this is Production: forced OFF. */
  demoBlockedByEnvironment: boolean;
  environment: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function resolveFactorySettings(stored: unknown, base: FactoryConfig, meta: { updatedAt?: string | null; updatedBy?: string | null } = {}, env: Env = process.env): ResolvedFactorySettings {
  const parsed = stored == null ? null : FactoryRuntimeSettingsSchema.safeParse(stored);
  // An unreadable stored value never widens anything: fall back to the bootstrap defaults.
  const settings = parsed?.success ? { ...parsed.data } : settingsFromEnvironment(base);
  const production = isProductionEnvironment(env);
  const demoBlockedByEnvironment = production && settings.demoMode;
  if (production) settings.demoMode = false;
  return {
    settings,
    source: parsed?.success ? 'PLATFORM_ADMIN' : 'ENVIRONMENT_DEFAULT',
    killSwitch: killSwitchOn(env),
    demoBlockedByEnvironment,
    environment: deploymentEnvironment(env),
    updatedAt: parsed?.success ? meta.updatedAt ?? null : null,
    updatedBy: parsed?.success ? meta.updatedBy ?? null : null,
  };
}

export class FactorySettingsError extends Error {
  constructor(public readonly code: 'INVALID_SETTINGS' | 'DEMO_MODE_NOT_ALLOWED_IN_PRODUCTION', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FactorySettingsError';
  }
}

/** Applies an admin patch; refuses Demo Mode in Production. */
export function applySettingsPatch(current: FactoryRuntimeSettings, patch: FactoryRuntimeSettingsPatch, env: Env = process.env): FactoryRuntimeSettings {
  const next = FactoryRuntimeSettingsSchema.safeParse({ ...current, ...patch });
  if (!next.success) throw new FactorySettingsError('INVALID_SETTINGS', next.error.issues[0]?.message ?? 'invalid');
  if (next.data.demoMode && isProductionEnvironment(env)) throw new FactorySettingsError('DEMO_MODE_NOT_ALLOWED_IN_PRODUCTION', 'Demo Mode cannot be enabled in Production');
  return next.data;
}

export type FactoryTrigger = 'SCHEDULED' | 'MANUAL' | 'CLI';

export interface EffectiveFactoryConfig extends FactoryConfig {
  demoMode: boolean;
  /** Why the factory is unavailable for this trigger (null = available). */
  unavailableReason: 'KILL_SWITCH' | 'FACTORY_DISABLED' | 'ON_DEMAND_DISABLED' | 'SCHEDULED_DISABLED' | null;
}

/** The configuration one run / request actually uses, for its trigger. */
export function effectiveFactoryConfig(base: FactoryConfig, resolved: ResolvedFactorySettings, trigger: FactoryTrigger): EffectiveFactoryConfig {
  const s = resolved.settings;
  const unavailableReason = resolved.killSwitch
    ? 'KILL_SWITCH'
    : !s.factoryEnabled
      ? 'FACTORY_DISABLED'
      : trigger === 'SCHEDULED'
        ? s.scheduledEnabled ? null : 'SCHEDULED_DISABLED'
        : s.onDemandEnabled ? null : 'ON_DEMAND_DISABLED';
  const demo = s.demoMode;
  return {
    ...base,
    enabled: unavailableReason === null,
    dailyBudget: s.dailySoftBudget,
    softBudgetEnforced: !demo,
    hardDailyLimit: s.hardSafetyLimit,
    maxBatch: demo ? DEMO_MAX_BATCH : base.maxBatch,
    maxPerRun: demo ? Math.max(base.maxPerRun, DEMO_RUNAWAY_MAX_PER_RUN) : base.maxPerRun,
    demoMode: demo,
    unavailableReason,
  };
}

/* ------------------------------------------------------------------ */
/* Consumption alerts (never block: 100% is the hard platform ceiling)  */
/* ------------------------------------------------------------------ */

export type AlertLevel = 'NORMAL' | 'INFO' | 'WARNING' | 'CRITICAL' | 'HARD_LIMIT';

export function consumptionLevel(used: number, limit: number, thresholds: readonly [number, number, number]): { percent: number; level: AlertLevel; crossed: Array<{ threshold: number; level: Exclude<AlertLevel, 'NORMAL'> }> } {
  const percent = limit > 0 ? (used / limit) * 100 : 100;
  const steps: Array<{ threshold: number; level: Exclude<AlertLevel, 'NORMAL'> }> = [
    { threshold: thresholds[0], level: 'INFO' },
    { threshold: thresholds[1], level: 'WARNING' },
    { threshold: thresholds[2], level: 'CRITICAL' },
    { threshold: 100, level: 'HARD_LIMIT' },
  ];
  const crossed = steps.filter((x) => percent >= x.threshold);
  return { percent, level: crossed.length ? crossed[crossed.length - 1].level : 'NORMAL', crossed };
}
