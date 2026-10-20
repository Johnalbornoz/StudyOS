/**
 * Platform Admin (STUDYUS_ADMIN) -- /api/admin/question-bank/health/[examVersionId]
 *
 *   GET  -- drill-down: per blueprint cell (section · requirement · band) the
 *           required / eligible / pilot / queued / deficit / priority, and WHY
 *           each readiness level is or is not reached.
 *   POST -- recompute this version's health snapshot now (DB only, no AI).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { bankHealthDetail } from '@/lib/exam-core/question-bank/admin.service';
import { refreshVersionHealth } from '@/lib/exam-core/question-bank/health.service';
import { ensureBankIdentities } from '@/lib/exam-core/question-bank/bank.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Id = z.string().uuid();

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ examVersionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.questionBank.detail');
  if ('error' in guard) return guard.error;
  const { examVersionId } = await params;
  if (!Id.safeParse(examVersionId).success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const detail = await bankHealthDetail(examVersionId);
  if (!detail) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: detail });
}

async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ examVersionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.questionBank.refresh');
  if ('error' in guard) return guard.error;
  const { examVersionId } = await params;
  if (!Id.safeParse(examVersionId).success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  await ensureBankIdentities();
  const r = await refreshVersionHealth(examVersionId);
  if (!r) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: await bankHealthDetail(examVersionId) });
}

export const GET = withAiRequestMetrics('GET /api/admin/question-bank/health/[examVersionId]', handleGET);
export const POST = withAiRequestMetrics('POST /api/admin/question-bank/health/[examVersionId]', handlePOST);
