/**
 * Exam V2 -- GET/POST /api/exams/instances
 *
 * POST creates an exam instance from a catalogue selection: the exam-level
 * node, the chosen components (papers) and the mode. A Mock / Challenge form
 * is assembled and FROZEN here, before the Student starts. Owner-only, with
 * the Learning entitlement. The body is strict; the Student is never taken
 * from the body.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, requireOwnerOf, ownStudentId } from '@/lib/exam-core/route-auth';
import { resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';
import { createExamInstance, ensureExamProfile, listExamInstances, toInstanceView, ExamInstanceError } from '@/lib/exam-core/exam-instance.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const CreateSchema = z.strictObject({
  nodeKey: z.string().regex(/^[a-z0-9._-]{1,120}$/),
  componentIds: z.array(z.string().uuid()).min(1).max(10),
  mode: z.enum(['PRACTICE', 'MOCK', 'CHALLENGE']),
  rigor: z.enum(['OFFICIAL_FIDELITY', 'STRICT_READINESS']).optional(),
  practiceLevel: z.enum(['FOUNDATION', 'STANDARD', 'ADVANCED', 'CHALLENGE']).optional(),
  timingMode: z.enum(['UNTIMED', 'TRAINING_TIMED']).optional(),
  language: z.string().min(2).max(10).default('es'),
});

async function handleGET() {
  const gate = await requireActor();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const studentId = await ownStudentId(gate.actorUserId);
  if (!studentId) return NextResponse.json({ success: true, data: { instances: [] } });
  const instances = await listExamInstances(studentId);
  return NextResponse.json({ success: true, data: { instances: await Promise.all(instances.map(toInstanceView)) } });
}

async function handlePOST(request: NextRequest) {
  const gate = await requireActor('/api/exams/instances:create', 20);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  const body = parsed.data;
  const studentId = await ownStudentId(gate.actorUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const owner = await requireOwnerOf(gate.actorUserId, studentId, { entitled: true });
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });

  const level = await resolveExamLevel(body.nodeKey, body.language);
  if (!level) return NextResponse.json({ error: 'NOT_AVAILABLE' }, { status: 404 });
  const allowed = new Set(level.components.map((c) => c.componentId));
  if (body.componentIds.some((id) => !allowed.has(id))) return NextResponse.json({ error: 'COMPONENT_NOT_IN_SELECTION' }, { status: 400 });
  try {
    const examProfileId = await ensureExamProfile(studentId, level.examDefinitionId, level.examVersionId);
    const instance = await createExamInstance({
      studentId,
      examProfileId,
      examVersionId: level.examVersionId,
      componentIds: body.componentIds,
      mode: body.mode,
      rigor: body.rigor,
      practiceLevel: body.practiceLevel,
      timingMode: body.timingMode,
    });
    return NextResponse.json({ success: true, data: { instance: await toInstanceView(instance) } });
  } catch (err) {
    if (err instanceof ExamInstanceError) return NextResponse.json({ error: err.code }, { status: err.code === 'NOT_FOUND' ? 404 : 409 });
    throw err;
  }
}

export const GET = withAiRequestMetrics('GET /api/exams/instances', handleGET);
export const POST = withAiRequestMetrics('POST /api/exams/instances', handlePOST);
