/**
 * Exam Prep -- POST /api/exam-profiles/[id]/restart  { confirm: true, confirmInProgress? }
 * "Empezar de nuevo": archives the Student's OWN preparation and creates a
 * new, clean active one for the same exam in one transaction
 * (prep-profile.service.ts). History and learning are preserved. A repeated
 * call returns the same new profile. Owner-only (anyone else: 404).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, requireOwnerOf } from '@/lib/exam-core/route-auth';
import { getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { restartExamProfile, ExamProfileError } from '@/lib/exam-core/prep-profile.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const UUID = /^[0-9a-f-]{36}$/i;
const Schema = z.strictObject({ confirm: z.boolean().default(false), confirmInProgress: z.boolean().default(false) });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireActor('/api/exam-profiles:restart', 20);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!UUID.test(id)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const parsed = Schema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const profile = await getStudentExamProfile(id);
  if (!profile) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const owner = await requireOwnerOf(gate.actorUserId, profile.studentId);
  if (!owner.ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const out = await restartExamProfile(profile.id, { ownerStudentId: profile.studentId, ...parsed.data });
    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    if (err instanceof ExamProfileError) return NextResponse.json({ error: err.code }, { status: err.code === 'NOT_FOUND' ? 404 : 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/exam-profiles/[id]/restart', handlePOST);
