import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStudentId, verifySubjectAccess } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { importSelectedConcepts, ImportError, IMPORT_MAX_SELECTION } from '@/services/document-import.service';

/**
 * POST /api/content/import/confirm { subjectId, sourceId, keys[] }
 *
 * Adds ONLY the concepts the Student explicitly selected, by the keys the
 * server itself proposed for this source (never free text). Existing
 * concepts are reused; new ones go through the existing explicit creation
 * path. No evidence, mastery or stage is written.
 */
const Body = z.object({
  subjectId: z.string().uuid(),
  sourceId: z.string().uuid(),
  keys: z.array(z.string().regex(/^c\d{1,3}$/)).min(1).max(IMPORT_MAX_SELECTION),
});

async function handlePOST(req: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!(await verifySubjectAccess(studentId, body.subjectId))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const language = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
    const result = await importSelectedConcepts({ studentId, subjectId: body.subjectId, sourceId: body.sourceId, keys: body.keys, language });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof ImportError) return NextResponse.json({ error: err.code }, { status: err.code === 'NOT_FOUND' ? 404 : 400 });
    console.error('[content/import/confirm] failed', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'IMPORT_FAILED' }, { status: 500 });
  }
}

// AI request metrics convention for AI-reaching routes (new concepts are classified into topics by AI).
export const POST = withAiRequestMetrics('POST /api/content/import/confirm', handlePOST);
