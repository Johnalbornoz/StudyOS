/**
 * Question Bank Factory -- runtime controls (DB): Platform Admin settings in
 * `platform_settings`, audited changes, the effective configuration per
 * trigger, the consumption snapshot and de-duplicated consumption alerts.
 * Changes apply on the next request / run: no redeploy.
 */
import { db } from '@/lib/db';
import { recordAdminAction } from '@/lib/admin/audit';
import { aiVolumeLimits } from '@/lib/ai/operational-limits';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import { factoryConfig } from './policy';
import {
  applySettingsPatch,
  consumptionLevel,
  effectiveFactoryConfig,
  FACTORY_SETTINGS_KEY,
  resolveFactorySettings,
  type AlertLevel,
  type EffectiveFactoryConfig,
  type FactoryRuntimeSettings,
  type FactoryRuntimeSettingsPatch,
  type FactoryTrigger,
  type ResolvedFactorySettings,
} from './runtime-settings';

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));

/** Stored settings, or the environment bootstrap when none are stored (or the table does not exist in this database). */
export async function loadFactorySettings(): Promise<ResolvedFactorySettings> {
  const base = factoryConfig();
  try {
    const r = await db.query(`SELECT value, updated_at, updated_by FROM platform_settings WHERE key = $1`, [FACTORY_SETTINGS_KEY]);
    const row = r.rows[0];
    return resolveFactorySettings(row?.value ?? null, base, { updatedAt: iso(row?.updated_at), updatedBy: row?.updated_by ?? null });
  } catch (err: any) {
    // 42P01 = platform_settings not migrated in this database: keep the previous env-driven behaviour.
    if (err?.code === '42P01') return resolveFactorySettings(null, base);
    throw err;
  }
}

export async function effectiveConfigFor(trigger: FactoryTrigger): Promise<EffectiveFactoryConfig> {
  return effectiveFactoryConfig(factoryConfig(), await loadFactorySettings(), trigger);
}

/** Platform Admin change: validated, Production-guarded, versioned, audited in the same transaction. */
export async function updateFactorySettings(actorUserId: string, patch: FactoryRuntimeSettingsPatch): Promise<ResolvedFactorySettings> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT value FROM platform_settings WHERE key = $1 FOR UPDATE`, [FACTORY_SETTINGS_KEY]);
    const current = resolveFactorySettings(r.rows[0]?.value ?? null, factoryConfig()).settings;
    const next = applySettingsPatch(current, patch);
    const changed = (Object.keys(next) as Array<keyof FactoryRuntimeSettings>).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]));
    await client.query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now(), version = platform_settings.version + 1`,
      [FACTORY_SETTINGS_KEY, JSON.stringify(next), actorUserId]
    );
    await recordAdminAction(
      {
        actorUserId,
        action: 'PLATFORM_SETTING_UPDATED',
        targetType: 'PLATFORM_SETTING',
        targetId: FACTORY_SETTINGS_KEY,
        previousState: Object.fromEntries(changed.map((k) => [k, current[k]])),
        newState: Object.fromEntries(changed.map((k) => [k, next[k]])),
        reason: changed.length ? `changed: ${changed.join(', ')}` : 'no change',
      },
      client
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return loadFactorySettings();
}

/* ------------------------------------------------------------------ */
/* Consumption                                                          */
/* ------------------------------------------------------------------ */

export interface ConsumptionSnapshot {
  platform: { usedToday: number; limitToday: number; remainingToday: number; percent: number; level: AlertLevel; monthCalls: number | null };
  factory: {
    callsToday: number;
    softBudget: number;
    softBudgetPercent: number;
    hardSafetyLimit: number;
    itemsGeneratedToday: number;
    acceptedToday: number;
    rejectedToday: number;
    repairedToday: number;
    failedRequestsToday: number;
    costTodayUSD: number;
    callsPerAccepted: number | null;
  };
  alerts: Array<{ id: string; threshold: number; level: string; callsUsed: number; callsLimit: number; raisedAt: string; acknowledgedAt: string | null }>;
}

const TODAY = `date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

export async function consumptionSnapshot(settings?: FactoryRuntimeSettings): Promise<ConsumptionSnapshot> {
  const s = settings ?? (await loadFactorySettings()).settings;
  const limitToday = aiVolumeLimits().perDay;
  const [platform, month, runs, items, failed, alerts] = await Promise.all([
    db.query(`SELECT day_calls, day_start = (date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today FROM ai_global_limits WHERE id = true`).catch(() => ({ rows: [] as any[] })),
    db.query(`SELECT count(*)::int AS n FROM ai_execution_events WHERE created_at >= date_trunc('month', now())`).catch(() => ({ rows: [] as any[] })),
    db.query(`SELECT COALESCE(sum(ai_calls),0)::int calls, COALESCE(sum(accepted),0)::int accepted, COALESCE(sum(rejected),0)::int rejected, COALESCE(sum(repaired),0)::int repaired, COALESCE(sum(estimated_cost_usd),0)::float cost
                FROM question_bank_factory_runs WHERE started_at >= ${TODAY}`),
    db.query(`SELECT count(*)::int n FROM question_bank_items WHERE provenance = 'STUDYUS_GENERATED' AND generation_request_id IS NOT NULL AND created_at >= ${TODAY}`),
    db.query(`SELECT count(*)::int n FROM question_bank_generation_requests WHERE status = 'FAILED' AND updated_at >= ${TODAY}`),
    db.query(`SELECT id, threshold_percent, level, calls_used, calls_limit, raised_at, acknowledged_at FROM question_bank_consumption_alerts WHERE day = (now() AT TIME ZONE 'UTC')::date ORDER BY threshold_percent`).catch(() => ({ rows: [] as any[] })),
  ]);
  const row = platform.rows[0];
  const usedToday = row?.today ? Number(row.day_calls) : 0;
  const c = consumptionLevel(usedToday, limitToday, s.warningThresholds);
  const r = runs.rows[0];
  return {
    platform: { usedToday, limitToday, remainingToday: Math.max(0, limitToday - usedToday), percent: c.percent, level: c.level, monthCalls: month.rows[0]?.n ?? null },
    factory: {
      callsToday: r.calls,
      softBudget: s.dailySoftBudget,
      softBudgetPercent: s.dailySoftBudget > 0 ? (r.calls / s.dailySoftBudget) * 100 : 0,
      hardSafetyLimit: s.hardSafetyLimit,
      itemsGeneratedToday: items.rows[0].n,
      acceptedToday: r.accepted,
      rejectedToday: r.rejected,
      repairedToday: r.repaired,
      failedRequestsToday: failed.rows[0].n,
      costTodayUSD: r.cost,
      callsPerAccepted: r.accepted > 0 ? r.calls / r.accepted : null,
    },
    alerts: alerts.rows.map((a: any) => ({ id: a.id, threshold: a.threshold_percent, level: a.level, callsUsed: a.calls_used, callsLimit: a.calls_limit, raisedAt: iso(a.raised_at)!, acknowledgedAt: iso(a.acknowledged_at) })),
  };
}

const LEVEL_COPY: Record<string, string> = {
  INFO: 'informativo',
  WARNING: 'advertencia',
  CRITICAL: 'crítico',
  HARD_LIMIT: 'límite técnico alcanzado',
};

/**
 * Raises each crossed threshold ONCE per UTC day (unique row) and notifies the
 * Platform Admins in their ADMIN workspace. Never blocks anything; never throws.
 */
export async function raiseConsumptionAlerts(): Promise<number> {
  try {
    const { settings } = await loadFactorySettings();
    const snap = await consumptionSnapshot(settings);
    const { crossed } = consumptionLevel(snap.platform.usedToday, snap.platform.limitToday, settings.warningThresholds);
    let raised = 0;
    for (const step of crossed) {
      const ins = await db.query(
        `INSERT INTO question_bank_consumption_alerts (day, threshold_percent, level, calls_used, calls_limit) VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, $3, $4)
         ON CONFLICT (day, threshold_percent) DO NOTHING RETURNING id`,
        [step.threshold, step.level, snap.platform.usedToday, snap.platform.limitToday]
      );
      if (!ins.rows[0]) continue;
      raised += 1;
      const admins = await db.query(`SELECT DISTINCT user_id FROM user_roles WHERE role = 'STUDYUS_ADMIN' AND status = 'ACTIVE'`);
      for (const a of admins.rows) {
        await notifyUser({
          recipientUserId: a.user_id,
          workspace: 'ADMIN',
          type: 'AI_CONSUMPTION_ALERT',
          title: `Consumo de IA: ${step.threshold}% (${LEVEL_COPY[step.level]})`,
          message: `La plataforma ha usado ${snap.platform.usedToday} de ${snap.platform.limitToday} llamadas de IA hoy (${step.threshold}%). ${step.level === 'HARD_LIMIT' ? 'La protección técnica detiene nuevas llamadas hasta mañana.' : 'Es un aviso: la generación sigue funcionando.'}`,
          payload: { threshold: step.threshold, used: snap.platform.usedToday, limit: snap.platform.limitToday },
          actionHref: '/dashboard/admin/question-bank/operations',
        });
      }
    }
    return raised;
  } catch (err) {
    console.error('[question-bank] consumption alerts failed', err instanceof Error ? err.message : err);
    return 0;
  }
}

export async function acknowledgeConsumptionAlert(alertId: string, actorUserId: string): Promise<boolean> {
  const r = await db.query(`UPDATE question_bank_consumption_alerts SET acknowledged_by = $2, acknowledged_at = now() WHERE id = $1 AND acknowledged_at IS NULL RETURNING id`, [alertId, actorUserId]);
  return r.rows.length > 0;
}
