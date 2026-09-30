import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentId, verifySubjectAccess } from '@/lib/auth';
import { query } from '@/lib/db';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { analyzeDocument, ImportError } from '@/services/document-import.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

/**
 * POST /api/content/import/analyze (multipart: file, subjectId)
 *
 * Upload + parse + PROPOSE concepts for the Student's own subject. The
 * Student is resolved from the session (never from the body); the subject
 * must be theirs. Returns only candidate labels + whether each already
 * exists -- never the extracted text or any technical payload. Creates no
 * concept, evidence or mastery.
 */
export const maxDuration = 120;

async function handlePOST(req: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  const file = form.get('file');
  const subjectId = form.get('subjectId');
  if (!(file instanceof File) || typeof subjectId !== 'string') return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  if (!(await verifySubjectAccess(studentId, subjectId))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const subject = await query(`SELECT name FROM subjects WHERE id = $1 AND student_id = $2`, [subjectId, studentId]);
    const language = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
    const result = await analyzeDocument({ studentId, subjectId, subjectName: subject.rows[0]?.name ?? '', file, language });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof ImportError) {
      const status = err.code === 'FILE_TOO_LARGE' ? 413 : err.code === 'UNSUPPORTED_FILE' ? 415 : 422;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error('[content/import/analyze] failed', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'EXTRACTION_FAILED' }, { status: 500 });
  }
}

export const POST = withAiRequestMetrics('POST /api/content/import/analyze', handlePOST);
