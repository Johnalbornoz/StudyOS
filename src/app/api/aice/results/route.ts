/**
 * Cambridge AICE -- POST /api/aice/results
 * Records one Cambridge result for a Student. Never the Student: only an
 * approved INSTITUTION_ADMIN (coordinator) of an institution where the
 * Student has an ACTIVE enrolment, with an official statement or a
 * coordinator verification as the source. Grades are validated per level
 * (AS a-e, A Level A*-E, U).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/lib/exam-core/route-auth';
import { requireLearnerInInstitution, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { recordResult, AicePlanError } from '@/lib/exam-core/aice/plan.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.strictObject({
  institutionId: z.string().uuid(),
  studentId: z.string().uuid(),
  syllabusCode: z.string().regex(/^\d{4}$/),
  level: z.enum(['AS', 'A']),
  series: z.strictObject({ year: z.number().int().min(2000).max(2100), month: z.union([z.literal(3), z.literal(6), z.literal(11)]) }),
  grade: z.string().min(1).max(2),
  source: z.enum(['OFFICIAL_STATEMENT', 'COORDINATOR_VERIFIED']),
});

async function handlePOST(request: NextRequest) {
  const gate = await requireActor('/api/aice/results', 30);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    await requireLearnerInInstitution(gate.actorUserId, parsed.data.institutionId, parsed.data.studentId);
  } catch (err) {
    if (err instanceof InstitutionIntelligenceAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw err;
  }
  try {
    const { institutionId: _i, ...rest } = parsed.data;
    return NextResponse.json({ success: true, data: await recordResult({ ...rest, recordedByUserId: gate.actorUserId }) });
  } catch (err) {
    if (err instanceof AicePlanError) return NextResponse.json({ error: err.code }, { status: 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/aice/results', handlePOST);
