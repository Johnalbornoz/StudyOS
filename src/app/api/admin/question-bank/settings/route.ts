/**
 * Platform Admin (STUDYUS_ADMIN) -- /api/admin/question-bank/settings
 *
 *   GET   runtime Factory controls (factory / on-demand / scheduled / Demo
 *         Mode, soft budget, alert thresholds, hard safety limit), where they
 *         come from, and the consumption view with today's alerts.
 *   PUT   strict partial update. Applies at runtime (next request / run, no
 *         redeploy). Demo Mode is refused in Production. Audited in
 *         admin_audit_log (who, old value, new value, when) in the same
 *         transaction as the change.
 *   POST  { acknowledgeAlertId } acknowledges one consumption alert.
 *
 * Every other caller gets 401 / 403 from the admin guard.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { FactoryRuntimeSettingsPatchSchema, FactorySettingsError } from '@/lib/exam-core/question-bank/runtime-settings';
import { acknowledgeConsumptionAlert, consumptionSnapshot, loadFactorySettings, updateFactorySettings } from '@/lib/exam-core/question-bank/runtime-settings.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function view() {
  const resolved = await loadFactorySettings();
  return { ...resolved, consumption: await consumptionSnapshot(resolved.settings) };
}

async function handleGET() {
  const guard = await guardAdminUsersRoute('admin.questionBank.settings');
  if ('error' in guard) return guard.error;
  return NextResponse.json({ success: true, data: await view() });
}

async function handlePUT(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.questionBank.settings.update');
  if ('error' in guard) return guard.error;
  const parsed = FactoryRuntimeSettingsPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    await updateFactorySettings(guard.admin.actor.id, parsed.data);
  } catch (err) {
    if (err instanceof FactorySettingsError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === 'DEMO_MODE_NOT_ALLOWED_IN_PRODUCTION' ? 403 : 400 });
    throw err;
  }
  return NextResponse.json({ success: true, data: await view() });
}

const Ack = z.strictObject({ acknowledgeAlertId: z.string().uuid() });

async function handlePOST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.questionBank.settings.ack');
  if ('error' in guard) return guard.error;
  const parsed = Ack.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  return NextResponse.json({ success: true, data: { acknowledged: await acknowledgeConsumptionAlert(parsed.data.acknowledgeAlertId, guard.admin.actor.id) } });
}

export const GET = withAiRequestMetrics('GET /api/admin/question-bank/settings', handleGET);
export const PUT = withAiRequestMetrics('PUT /api/admin/question-bank/settings', handlePUT);
export const POST = withAiRequestMetrics('POST /api/admin/question-bank/settings', handlePOST);
