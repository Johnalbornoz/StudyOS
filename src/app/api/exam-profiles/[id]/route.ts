/**
 * Exam Prep -- DELETE /api/exam-profiles/[id]  { confirm: true, confirmInProgress? }
 * "Quitar de mi preparación": archives the Student's OWN exam preparation
 * profile (prep-profile.service.ts). Results, responses, scoring audit,
 * learning evidence and learner state are never deleted. An in-progress
 * simulation needs `confirmInProgress: true` (it is cancelled).
 * Owner-only: a Parent, Teacher or Coordinator -- or another Student -- gets
 * 404. Repeating the call returns the same outcome.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, requireOwnerOf } from '@/lib/exam-core/route-auth';
import { getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { archiveExamProfile, ExamProfileError } from '@/lib/exam-core/prep-profile.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const UUID = /^[0-9a-f-]{36}$/i;
const Schema = z.strictObject({ confirm: z.boolean().default(false), confirmInProgress: z.boolean().default(false) });

async function handleDELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireActor('/api/exam-profiles:remove', 20);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!UUID.test(id)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const parsed = Schema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const profile = await getStudentExamProfile(id);
  if (!profile) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // The actor must BE the Student: a Parent / Teacher / Coordinator never removes a Student's own preparation.
  const owner = await requireOwnerOf(gate.actorUserId, profile.studentId);
  if (!owner.ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const out = await archiveExamProfile(profile.id, { ownerStudentId: profile.studentId, ...parsed.data });
    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    if (err instanceof ExamProfileError) return NextResponse.json({ error: err.code }, { status: err.code === 'NOT_FOUND' ? 404 : 409 });
    throw err;
  }
}

export const DELETE = withAiRequestMetrics('DELETE /api/exam-profiles/[id]', handleDELETE);
