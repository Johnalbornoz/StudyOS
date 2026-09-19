/**
 * F11-B -- POST /api/teacher/interventions/[id]/cancel
 *
 * TEACHER_INTERVENTION_CANCEL, gated by the actor's CURRENT teacher
 * relationship to the intervention's own student_id (looked up
 * server-side inside cancelTeacherIntervention -- never a
 * client-supplied studentId).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { cancelTeacherIntervention, TeacherInterventionAccessDeniedError, TeacherInterventionNotFoundError } from '@/lib/teacher/intervention.service';

const CancelSchema = z.object({ reason: z.string().optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = CancelSchema.parse(await request.json().catch(() => ({})));
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const intervention = await cancelTeacherIntervention(actor.id, id, validated.reason);
    return NextResponse.json({ success: true, data: { intervention } });
  } catch (error) {
    if (error instanceof TeacherInterventionAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (error instanceof TeacherInterventionNotFoundError) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    throw error;
  }
}
