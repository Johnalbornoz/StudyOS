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

// F13: this schema was never extended when F11-C4 added the EXAM
// target branch to assignTeacherIntervention's own real
// TeacherInterventionTarget union (src/lib/teacher/intervention.service.ts)
// -- discovered during F13's inspection. Fixed here so the Exam
// Reinforcement assignment UI (task section 18) has a real route to
// call. The three EXAM variants match that union's own three
// simulation_type-specific shapes exactly (TOPIC_EXAM needs
// learningObjectiveId, DOMAIN_EXAM needs academicSubjectId, MINI_MOCK/
// FULL_MOCK need neither). Nested as its own z.discriminatedUnion (on
// simulationType) and combined via z.union rather than a single flat
// discriminatedUnion, since Zod's discriminatedUnion requires a unique
// literal per branch and 'EXAM' would otherwise repeat three times.
const ExamTargetSchema = z.discriminatedUnion('simulationType', [
  z.object({ targetType: z.literal('EXAM'), examProfileId: z.string().uuid(), simulationType: z.literal('TOPIC_EXAM'), learningObjectiveId: z.string().uuid() }),
  z.object({ targetType: z.literal('EXAM'), examProfileId: z.string().uuid(), simulationType: z.literal('DOMAIN_EXAM'), academicSubjectId: z.string().uuid() }),
  z.object({ targetType: z.literal('EXAM'), examProfileId: z.string().uuid(), simulationType: z.enum(['MINI_MOCK', 'FULL_MOCK']) }),
]);

const TargetSchema = z.union([
  z.discriminatedUnion('targetType', [
    z.object({ targetType: z.literal('CONCEPT'), conceptId: z.string().uuid() }),
    z.object({ targetType: z.literal('SKILL'), skillId: z.string().uuid() }),
    z.object({ targetType: z.literal('COMPETENCY'), competencyId: z.string().uuid() }),
    z.object({ targetType: z.literal('LEARNING_OBJECTIVE'), learningObjectiveId: z.string().uuid() }),
  ]),
  ExamTargetSchema,
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
