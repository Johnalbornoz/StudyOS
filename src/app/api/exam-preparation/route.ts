/**
 * Exam preparation, objective first -- POST /api/exam-preparation
 *
 * "¿Para qué examen quieres prepararte?": the Student chooses ANY objective of
 * the governed catalogue (catalogue-only included). Readiness never blocks the
 * choice; the response says which activities the preparation offers today
 * (capabilities, computed on the server). Idempotent: a retry or a double
 * click returns the same active preparation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createObjectivePreparation } from '@/lib/exam-core/objectives/preparation.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentGate, preparationErrorResponse } from './route-helpers';

const CreateSchema = z.strictObject({
  objectiveKey: z.string().regex(/^[a-z0-9._-]{1,120}$/),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purpose: z.string().trim().max(200).optional(),
  targetInstitutionName: z.string().trim().max(200).optional(),
  targetQualification: z.string().trim().max(200).optional(),
  timezone: z.string().max(100).optional(),
});

async function handlePOST(request: NextRequest) {
  const gate = await studentGate('/api/exam-preparation:create', 20);
  if (!gate.ok) return gate.res;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const { profile, created, capabilities } = await createObjectivePreparation(gate.studentId, parsed.data);
    return NextResponse.json({ success: true, data: { profile: { id: profile.id, objectiveKey: profile.objectiveKey, status: profile.status }, created, capabilities } }, { status: created ? 201 : 200 });
  } catch (err) {
    return preparationErrorResponse(err);
  }
}

export const POST = withAiRequestMetrics('POST /api/exam-preparation', handlePOST);
