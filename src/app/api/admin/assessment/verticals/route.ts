/**
 * Track B / B2 -- GET/POST /api/admin/assessment/verticals
 *
 * GET lists the DEV certification vertical configurations and whether each is
 * applied. POST applies ONE configuration (a catalog key, or an explicit
 * configuration document) -- dry-run by default (`write: false` runs inside a
 * rolled-back transaction). StudyUs admin only (same allowlist gate as every
 * /api/admin/assessment route). A configuration is the ONLY way a vertical is
 * created: no per-vertical code path exists.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { db } from '@/lib/db';
import { applyExamVerticalConfig, VerticalConfigError } from '@/lib/exam-core/apply-vertical-config.service';
import { DEV_CERT_VERTICALS as V1_VERTICALS } from '@/lib/exam-core/verticals';
import { V2_VERTICALS } from '@/lib/exam-core/verticals/v2';

const DEV_CERT_VERTICALS = [...V1_VERTICALS, ...V2_VERTICALS];
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, status: 401, error: 'UNAUTHORIZED' };
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return { ok: false as const, status: 403, error: 'FORBIDDEN' };
  return { ok: true as const };
}

async function handleGET() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const applied = await db.query(`SELECT config_key, id FROM exam_definitions WHERE config_key = ANY($1::text[])`, [DEV_CERT_VERTICALS.map((v) => v.key)]);
  const byKey = new Map(applied.rows.map((r: any) => [r.config_key, r.id]));
  return NextResponse.json({
    success: true,
    data: { verticals: DEV_CERT_VERTICALS.map((v) => ({ key: v.key, family: v.family, contentStatus: v.contentStatus, name: v.definition.name, appliedDefinitionId: byKey.get(v.key) ?? null })) },
  });
}

const Schema = z.strictObject({
  key: z.string().min(1).max(80).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  write: z.boolean().default(false),
});

async function handlePOST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.key && !parsed.data.config)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const config = parsed.data.config ?? DEV_CERT_VERTICALS.find((v) => v.key === parsed.data.key);
  if (!config) return NextResponse.json({ error: 'UNKNOWN_VERTICAL' }, { status: 404 });

  try {
    const result = await applyExamVerticalConfig(config, { write: parsed.data.write });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof VerticalConfigError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === 'INVALID_CONFIG' ? 400 : 409 });
    throw err;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/admin/assessment/verticals', handleGET);
export const POST = withAiRequestMetrics('POST /api/admin/assessment/verticals', handlePOST);
