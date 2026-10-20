/**
 * Platform Admin (STUDYUS_ADMIN) -- GET /api/admin/question-bank/questions/[versionId]
 *
 * Question detail for academic certification: question, answer, explanation, concept, objective,
 * difficulty (declared / validated / observed), use, exam alignment, provenance, automated
 * validation, human review, exposure, versions and audit. Content-authorised admins only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { questionDetail } from '@/lib/exam-core/question-bank/review-admin.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.questionBank.question');
  if ('error' in guard) return guard.error;
  const { versionId } = await params;
  if (!z.string().uuid().safeParse(versionId).success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const d = await questionDetail(versionId);
  if (!d) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: d });
}

export const GET = withAiRequestMetrics('GET /api/admin/question-bank/questions/[versionId]', handleGET);
