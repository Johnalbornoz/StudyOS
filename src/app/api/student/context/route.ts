import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { requireStudentId } from '@/lib/auth';
import { getStoredStudentContextType, setStudentContextType } from '@/services/student-context.service';
import { nextPathForContext } from '@/lib/student/student-context';

/**
 * REM-T1-02 -- "What best describes your current situation?"
 *   GET  -> { data: { contextType } }   (null = not chosen)
 *   POST { contextType: 'ACADEMIC' | 'EXAM_PREP' } -> { data: { contextType, next } }
 * Only the signed-in, ACTIVE Student (requireStudentId never provisions anyone).
 * The primary role stays STUDENT; nothing else is modified.
 */
const Body = z.object({ contextType: z.enum(['ACADEMIC', 'EXAM_PREP']) });

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(userId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  return NextResponse.json({ data: { contextType: await getStoredStudentContextType(studentId) } });
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const studentId = await requireStudentId(userId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  await setStudentContextType(studentId, parsed.data.contextType);
  return NextResponse.json({ data: { contextType: parsed.data.contextType, next: nextPathForContext(parsed.data.contextType) } });
}
