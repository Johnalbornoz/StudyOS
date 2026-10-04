/**
 * Question Bank Factory runtime controls -- operator script.
 *
 *   verify            (DEV only)     exercises the real services: bootstrap defaults,
 *                                    admin update + audit row, effective config per
 *                                    trigger, Production block, alert de-duplication;
 *                                    then restores the previous stored state.
 *   configure-demo    (Preview only) applies the Preview demo configuration through the
 *                                    governed, audited settings service:
 *                                    factory ON, on-demand ON, Demo Mode ON, scheduled OFF.
 *   show                             prints the stored + effective settings.
 *
 *   QB_RUNTIME_FP=<fp> npx tsx --env-file=<env> scripts/operations/qb-factory-runtime-controls.ts <mode>
 *
 * Refuses Production always, and any database whose fingerprint differs from QB_RUNTIME_FP.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { factoryConfig } from '@/lib/exam-core/question-bank/policy';
import { applySettingsPatch, effectiveFactoryConfig, FACTORY_SETTINGS_KEY, resolveFactorySettings } from '@/lib/exam-core/question-bank/runtime-settings';
import { consumptionSnapshot, effectiveConfigFor, loadFactorySettings, updateFactorySettings } from '@/lib/exam-core/question-bank/runtime-settings.service';

const DEV = '2a29b99ee14a22b4';
const PREVIEW = '53d158d5811e7ee0';
const PRODUCTION = '6671e7382d808d06';
const mode = process.argv[2] ?? 'show';

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

async function operatorId(): Promise<string> {
  const r = await db.query(`SELECT id FROM users WHERE is_system = true ORDER BY created_at ASC, id ASC LIMIT 1`);
  if (!r.rows[0]) throw new Error('NO_SYSTEM_IDENTITY');
  return r.rows[0].id;
}

async function show() {
  const resolved = await loadFactorySettings();
  const manual = await effectiveConfigFor('MANUAL');
  const scheduled = await effectiveConfigFor('SCHEDULED');
  const consumption = await consumptionSnapshot(resolved.settings);
  console.log(JSON.stringify({ resolved, effective: { MANUAL: { enabled: manual.enabled, reason: manual.unavailableReason, demoMode: manual.demoMode, maxBatch: manual.maxBatch, maxPerRun: manual.maxPerRun, softBudgetEnforced: manual.softBudgetEnforced, hardDailyLimit: manual.hardDailyLimit }, SCHEDULED: { enabled: scheduled.enabled, reason: scheduled.unavailableReason } }, consumption: { platform: consumption.platform, factory: consumption.factory, alerts: consumption.alerts.length } }, null, 1));
}

async function verify() {
  const before = (await db.query(`SELECT value, version, updated_by, updated_at FROM platform_settings WHERE key = $1`, [FACTORY_SETTINGS_KEY])).rows[0] ?? null;
  const actor = await operatorId();
  const auditBefore = Number((await db.query(`SELECT count(*) n FROM admin_audit_log WHERE action = 'PLATFORM_SETTING_UPDATED'`)).rows[0].n);
  try {
    if (!before) check('bootstrap = environment default', (await loadFactorySettings()).source === 'ENVIRONMENT_DEFAULT');
    await updateFactorySettings(actor, { factoryEnabled: false });
    let m = await effectiveConfigFor('MANUAL');
    check('factory OFF blocks on-demand at runtime', !m.enabled && m.unavailableReason === 'FACTORY_DISABLED');
    await updateFactorySettings(actor, { factoryEnabled: true, onDemandEnabled: true, scheduledEnabled: false, demoMode: true });
    m = await effectiveConfigFor('MANUAL');
    const s = await effectiveConfigFor('SCHEDULED');
    check('factory ON + on-demand ON works at runtime (no redeploy)', m.enabled);
    check('scheduler independent (OFF while factory ON)', !s.enabled && s.unavailableReason === 'SCHEDULED_DISABLED');
    check('Demo Mode: soft budget not enforced, batch 10, runaway cap 60', m.demoMode && !m.softBudgetEnforced && m.maxBatch === 10 && m.maxPerRun === 60);
    const audit = (await db.query(`SELECT previous_state, new_state, actor_user_id, environment FROM admin_audit_log WHERE action = 'PLATFORM_SETTING_UPDATED' ORDER BY occurred_at DESC LIMIT 1`)).rows[0];
    const auditAfter = Number((await db.query(`SELECT count(*) n FROM admin_audit_log WHERE action = 'PLATFORM_SETTING_UPDATED'`)).rows[0].n);
    check('every change audited (who / old / new / when)', auditAfter - auditBefore === 2 && audit.actor_user_id === actor && audit.previous_state?.demoMode === false && audit.new_state?.demoMode === true, JSON.stringify({ prev: audit.previous_state, next: audit.new_state }));
    const prodResolved = resolveFactorySettings({ ...(await loadFactorySettings()).settings }, factoryConfig(), {}, { VERCEL_ENV: 'production' });
    let refused = false;
    try {
      applySettingsPatch(prodResolved.settings, { demoMode: true }, { VERCEL_ENV: 'production' });
    } catch {
      refused = true;
    }
    check('Production: stored Demo Mode forced OFF and enabling refused', !prodResolved.settings.demoMode && refused && !effectiveFactoryConfig(factoryConfig(), prodResolved, 'MANUAL').demoMode);
    // Alert de-duplication on the real table (inside a rolled-back transaction).
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const ins = `INSERT INTO question_bank_consumption_alerts (day, threshold_percent, level, calls_used, calls_limit) VALUES ((now() AT TIME ZONE 'UTC')::date, 50, 'INFO', 1, 2) ON CONFLICT (day, threshold_percent) DO NOTHING RETURNING id`;
      const a = await c.query(ins);
      const b = await c.query(ins);
      check('consumption alert raised once per day and threshold', a.rows.length + b.rows.length <= 1);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  } finally {
    // Restore the stored state exactly as it was (DEV verification only).
    if (before) await db.query(`UPDATE platform_settings SET value = $2, version = $3, updated_by = $4, updated_at = $5 WHERE key = $1`, [FACTORY_SETTINGS_KEY, before.value, before.version, before.updated_by, before.updated_at]);
    else await db.query(`DELETE FROM platform_settings WHERE key = $1`, [FACTORY_SETTINGS_KEY]);
    console.log(`restored stored settings to ${before ? 'previous value' : 'none (environment default)'}`);
  }
}

async function configureDemo() {
  const actor = await operatorId();
  await updateFactorySettings(actor, { factoryEnabled: true, onDemandEnabled: true, demoMode: true, scheduledEnabled: false });
  await show();
}

async function main() {
  const fp = fingerprint();
  if (fp === PRODUCTION) throw new Error('REFUSING: production database');
  if (process.env.QB_RUNTIME_FP !== fp) throw new Error(`REFUSING: QB_RUNTIME_FP (${process.env.QB_RUNTIME_FP}) != database (${fp})`);
  console.log(JSON.stringify({ db: fp, mode }));
  if (mode === 'verify') {
    if (fp !== DEV) throw new Error('REFUSING: verify runs on DEV only');
    await verify();
  } else if (mode === 'configure-demo') {
    if (fp !== PREVIEW) throw new Error('REFUSING: configure-demo runs on Preview only');
    await configureDemo();
  } else await show();
  await db.end();
  if (checks.some((c) => !c.ok)) process.exit(1);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});
