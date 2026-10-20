/**
 * Question Bank Factory -- runtime Platform Admin controls (hot configuration
 * + Demo Mode). Pure policy + source-level guarantees.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { budgetStop, factoryConfig } from '@/lib/exam-core/question-bank/policy';
import {
  applySettingsPatch,
  consumptionLevel,
  DEMO_MAX_BATCH,
  DEMO_RUNAWAY_MAX_PER_RUN,
  effectiveFactoryConfig,
  FactorySettingsError,
  resolveFactorySettings,
  settingsFromEnvironment,
  type FactoryRuntimeSettings,
} from '@/lib/exam-core/question-bank/runtime-settings';
import { assertTransition } from '@/lib/exam-core/question-bank/lifecycle';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PREVIEW = { VERCEL_ENV: 'preview' };
const PRODUCTION = { VERCEL_ENV: 'production' };
const base = factoryConfig({ QUESTION_BANK_FACTORY_ENABLED: 'true', QUESTION_BANK_DAILY_BUDGET: '20' });
const stored = (over: Partial<FactoryRuntimeSettings> = {}): FactoryRuntimeSettings => ({
  factoryEnabled: true,
  onDemandEnabled: true,
  scheduledEnabled: false,
  demoMode: false,
  dailySoftBudget: 20,
  warningThresholds: [50, 75, 90],
  hardSafetyLimit: 1000,
  ...over,
});
const room = { usedToday: 0, usedThisRun: 0, platformRemaining: 4000 };

describe('bootstrap: no stored settings = the previous environment-driven behaviour', () => {
  it('env defaults (factory OFF unless QUESTION_BANK_FACTORY_ENABLED=true; budget enforced; small batch)', () => {
    const off = effectiveFactoryConfig(factoryConfig({}), resolveFactorySettings(null, factoryConfig({}), {}, PREVIEW), 'MANUAL');
    expect(off.enabled).toBe(false);
    const r = resolveFactorySettings(null, base, {}, PREVIEW);
    expect(r.source).toBe('ENVIRONMENT_DEFAULT');
    const cfg = effectiveFactoryConfig(base, r, 'MANUAL');
    expect(cfg).toMatchObject({ enabled: true, dailyBudget: 20, softBudgetEnforced: true, maxBatch: 3, maxPerRun: 6, demoMode: false });
    expect(budgetStop(cfg, { ...room, usedToday: 20 })).toBe('DAILY_BUDGET');
    // The scheduled run needs an allowlisted exam, exactly as before.
    expect(settingsFromEnvironment(base).scheduledEnabled).toBe(false);
    expect(settingsFromEnvironment(factoryConfig({ QUESTION_BANK_FACTORY_ENABLED: 'true', QUESTION_BANK_FACTORY_EXAMS: 'v2.paa' })).scheduledEnabled).toBe(true);
  });

  it('an unreadable stored value never widens anything (falls back to the env defaults)', () => {
    const r = resolveFactorySettings({ factoryEnabled: 'yes', demoMode: true }, factoryConfig({}), {}, PREVIEW);
    expect(r.source).toBe('ENVIRONMENT_DEFAULT');
    expect(r.settings.demoMode).toBe(false);
    expect(r.settings.factoryEnabled).toBe(false);
  });
});

describe('runtime switches (Platform Admin settings win over the environment)', () => {
  it('admin settings enable the factory even when the env default is OFF -- no redeploy', () => {
    const r = resolveFactorySettings(stored(), factoryConfig({}), { updatedAt: '2026-10-04T12:00:00Z', updatedBy: 'u1' }, PREVIEW);
    expect(r.source).toBe('PLATFORM_ADMIN');
    expect(effectiveFactoryConfig(factoryConfig({}), r, 'MANUAL').enabled).toBe(true);
  });

  it('factory OFF blocks every trigger; on-demand OFF blocks only on-demand', () => {
    const off = resolveFactorySettings(stored({ factoryEnabled: false, scheduledEnabled: true }), base, {}, PREVIEW);
    expect(effectiveFactoryConfig(base, off, 'MANUAL')).toMatchObject({ enabled: false, unavailableReason: 'FACTORY_DISABLED' });
    expect(effectiveFactoryConfig(base, off, 'SCHEDULED')).toMatchObject({ enabled: false, unavailableReason: 'FACTORY_DISABLED' });
    const noOnDemand = resolveFactorySettings(stored({ onDemandEnabled: false, scheduledEnabled: true }), base, {}, PREVIEW);
    expect(effectiveFactoryConfig(base, noOnDemand, 'MANUAL')).toMatchObject({ enabled: false, unavailableReason: 'ON_DEMAND_DISABLED' });
    expect(effectiveFactoryConfig(base, noOnDemand, 'SCHEDULED').enabled).toBe(true);
  });

  it('the scheduler is independent: Factory ON does not imply scheduled generation', () => {
    const r = resolveFactorySettings(stored({ scheduledEnabled: false }), base, {}, PREVIEW);
    expect(effectiveFactoryConfig(base, r, 'MANUAL').enabled).toBe(true);
    expect(effectiveFactoryConfig(base, r, 'SCHEDULED')).toMatchObject({ enabled: false, unavailableReason: 'SCHEDULED_DISABLED' });
  });

  it('the environment kill switch is the emergency fallback: it stops everything', () => {
    const r = resolveFactorySettings(stored({ demoMode: true }), base, {}, { ...PREVIEW, QUESTION_BANK_FACTORY_KILL_SWITCH: 'true' });
    expect(effectiveFactoryConfig(base, r, 'MANUAL')).toMatchObject({ enabled: false, unavailableReason: 'KILL_SWITCH' });
  });
});

describe('Demo Mode: administrative limits become telemetry; hard protections stay', () => {
  const demo = effectiveFactoryConfig(base, resolveFactorySettings(stored({ demoMode: true }), base, {}, PREVIEW), 'MANUAL');

  it('soft daily budget, per-run soft cap and the batch of 3 no longer block', () => {
    expect(demo).toMatchObject({ demoMode: true, softBudgetEnforced: false, maxBatch: DEMO_MAX_BATCH, maxPerRun: DEMO_RUNAWAY_MAX_PER_RUN });
    expect(budgetStop(demo, { ...room, usedToday: 20 })).toBeNull();
    expect(budgetStop(demo, { ...room, usedToday: 300, usedThisRun: 20 })).toBeNull();
  });

  it('keeps the hard daily safety limit, the runaway per-run ceiling and the shared-AI reserve', () => {
    expect(budgetStop(demo, { ...room, usedToday: 1000 })).toBe('HARD_LIMIT');
    expect(budgetStop(demo, { ...room, usedThisRun: DEMO_RUNAWAY_MAX_PER_RUN })).toBe('MAX_PER_RUN');
    expect(budgetStop(demo, { ...room, platformRemaining: 400 })).toBe('AI_RESERVE');
    expect(budgetStop(demo, { ...room, platformRemaining: null })).toBe('AI_RESERVE');
    expect(demo.runDeadlineMs).toBe(base.runDeadlineMs);
  });

  it('never changes question governance: generated items still need PILOT before ACTIVE', () => {
    expect(() => assertTransition('VALIDATED', 'ACTIVE', { actor: { kind: 'ADMIN', userId: 'a' }, provenance: 'STUDYUS_GENERATED', reason: 'demo' })).toThrow(/PILOT_REQUIRED/);
    expect(read('src/lib/exam-core/question-bank/runtime-settings.ts')).not.toMatch(/transitionVersion|provenance\s*=|OFFICIAL'/);
  });
});

describe('Production: Demo Mode is technically blocked', () => {
  it('a stored Demo Mode is forced OFF in Production', () => {
    const r = resolveFactorySettings(stored({ demoMode: true }), base, {}, PRODUCTION);
    expect(r.settings.demoMode).toBe(false);
    expect(r.demoBlockedByEnvironment).toBe(true);
    expect(effectiveFactoryConfig(base, r, 'MANUAL')).toMatchObject({ demoMode: false, softBudgetEnforced: true, maxBatch: 3 });
  });

  it('an admin cannot turn Demo Mode ON in Production; elsewhere it is allowed', () => {
    expect(() => applySettingsPatch(stored(), { demoMode: true }, PRODUCTION)).toThrow(FactorySettingsError);
    expect(() => applySettingsPatch(stored(), { demoMode: true }, { VERCEL_TARGET_ENV: 'production' })).toThrow(/DEMO_MODE_NOT_ALLOWED_IN_PRODUCTION/);
    expect(applySettingsPatch(stored(), { demoMode: true }, PREVIEW).demoMode).toBe(true);
    expect(applySettingsPatch(stored(), { demoMode: false }, PRODUCTION).demoMode).toBe(false);
  });

  it('invalid patches are refused (thresholds must increase)', () => {
    expect(() => applySettingsPatch(stored(), { warningThresholds: [90, 75, 50] }, PREVIEW)).toThrow(/INVALID_SETTINGS/);
  });
});

describe('consumption alerts (50 / 75 / 90 inform; 100 = hard technical protection only)', () => {
  it('levels', () => {
    const t = [50, 75, 90] as const;
    expect(consumptionLevel(33, 5000, t)).toMatchObject({ level: 'NORMAL', crossed: [] });
    expect(consumptionLevel(2500, 5000, t).level).toBe('INFO');
    expect(consumptionLevel(3750, 5000, t).level).toBe('WARNING');
    expect(consumptionLevel(4500, 5000, t)).toMatchObject({ level: 'CRITICAL' });
    expect(consumptionLevel(4500, 5000, t).crossed.map((c) => c.threshold)).toEqual([50, 75, 90]);
    expect(consumptionLevel(5000, 5000, t).level).toBe('HARD_LIMIT');
  });

  it('alerts never feed the budget decision', () => {
    expect(read('src/lib/exam-core/question-bank/policy.ts')).not.toMatch(/warningThresholds|consumptionLevel/);
  });

  it('raised once per day and threshold, acknowledgement persisted', () => {
    const sql = read('database/migrations/20261027_1000_platform_runtime_settings.sql');
    expect(sql).toMatch(/UNIQUE \(day, threshold_percent\)/);
    expect(sql).toMatch(/acknowledged_at/);
    expect(read('src/lib/exam-core/question-bank/runtime-settings.service.ts')).toMatch(/ON CONFLICT \(day, threshold_percent\) DO NOTHING/);
  });
});

describe('wiring, security and audit (source-level)', () => {
  it('every factory entry point reads the runtime configuration, not the env switch', () => {
    for (const f of ['src/app/api/admin/question-bank/generate/route.ts', 'src/app/api/internal/question-bank-factory/route.ts', 'src/app/dashboard/admin/question-bank/[examVersionId]/page.tsx']) {
      expect(read(f), f).toMatch(/effectiveConfigFor\(/);
      expect(read(f), f).not.toMatch(/factoryConfig\(\)/);
    }
    expect(read('src/app/api/internal/question-bank-factory/route.ts')).toMatch(/effectiveConfigFor\('SCHEDULED'\)/);
    expect(read('src/lib/exam-core/question-bank/factory.service.ts')).toMatch(/opts\.cfg \?\? \(await effectiveConfigFor\(opts\.trigger\)\)/);
  });

  it('settings API: Platform Admin only, strict body, audited in the same transaction', () => {
    const route = read('src/app/api/admin/question-bank/settings/route.ts');
    expect(route.match(/guardAdminUsersRoute\(/g)?.length).toBe(3);
    expect(route).toMatch(/FactoryRuntimeSettingsPatchSchema\.safeParse/);
    const svc = read('src/lib/exam-core/question-bank/runtime-settings.service.ts');
    expect(svc).toMatch(/action: 'PLATFORM_SETTING_UPDATED'/);
    expect(svc).toMatch(/previousState:/);
    expect(svc).toMatch(/newState:/);
    expect(svc).toMatch(/recordAdminAction\([\s\S]*?client\s*\)/);
  });

  it('the misleading scheduled-allowlist line is gone; on-demand / scheduled states are explicit', () => {
    const page = read('src/app/dashboard/admin/question-bank/operations/page.tsx');
    expect(page).not.toMatch(/Exámenes habilitados para la ejecución programada/);
    expect(page).toMatch(/Generación bajo demanda:/);
    expect(page).toMatch(/Generación programada:/);
    expect(page).not.toMatch(/QUESTION_BANK_/);
  });

  it('Student request paths never start the factory', () => {
    for (const f of ['src/lib/exam-core/exam-instance.service.ts', 'src/lib/exam-core/item-sourcing.service.ts']) expect(read(f), f).not.toMatch(/runFactory|enqueueManual/);
  });
});
