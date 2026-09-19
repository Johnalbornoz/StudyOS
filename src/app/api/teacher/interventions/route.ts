/**
 * F11-B -- POST /api/teacher/interventions
 *
 * Assigns a Teacher Intervention (pedagogical intent only -- never
 * executes anything, never writes canonical evidence). Authorization
 * is delegated entirely to assignTeacherIntervention's own full chain
 * (class access, active enrollment, teacher-learner relationship);
 * this route performs no independent authorization logic.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { assignTeacherIntervention, TeacherInterventionAccessDeniedError, TeacherInterventionInvalidTargetError } from '@/lib/teacher/intervention.service';

const TargetSchema = z.discriminatedUnion('targetType', [
  z.object({ targetType: z.literal('CONCEPT'), conceptId: z.string().uuid() }),
  z.object({ targetType: z.literal('SKILL'), skillId: z.string().uuid() }),
  z.object({ targetType: z.literal('COMPETENCY'), competencyId: z.string().uuid() }),
  z.object({ targetType: z.literal('LEARNING_OBJECTIVE'), learningObjectiveId: z.string().uuid() }),
]);

const AssignSchema = z.object({
  classId: z.string().uuid(),
  studentId: z.string().uuid(),
  interventionType: z.enum(['CONCEPT_REINFORCEMENT', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE', 'EXAM_PRACTICE']),
  target: TargetSchema,
  reason: z.string().optional(),
  instructions: z.string().optional(),
  dueAt: z.string().datetime().optional(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = AssignSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const intervention = await assignTeacherIntervention(actor.id, validated);
    return NextResponse.json({ success: true, data: { intervention } });
  } catch (error) {
    if (error instanceof TeacherInterventionAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (error instanceof TeacherInterventionInvalidTargetError) return NextResponse.json({ error: 'INVALID_TARGET', message: error.message }, { status: 400 });
    throw error;
  }
}
