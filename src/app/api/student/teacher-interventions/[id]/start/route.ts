/**
 * F11-C1 -- POST /api/student/teacher-interventions/[id]/start
 *
 * Requires a client-supplied idempotencyKey (minted once by the client
 * when the student clicks "Start", resent unchanged on any retry).
 * Authorization is Student/Owner ONLY, resolved inside
 * startConceptReinforcementExecution via isOwner -- this route performs
 * no independent authorization logic and never falls back to Teacher
 * or Parent access.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import {
  startConceptReinforcementExecution,
  StudentInterventionAccessDeniedError,
  StudentInterventionNotFoundError,
  StudentInterventionNotStartableError,
} from '@/lib/student/teacher-intervention-execution.service';

const StartSchema = z.object({ idempotencyKey: z.string().min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = StartSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const result = await startConceptReinforcementExecution(actor.id, id, validated.idempotencyKey);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof StudentInterventionAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (error instanceof StudentInterventionNotFoundError) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (error instanceof StudentInterventionNotStartableError) return NextResponse.json({ error: 'NOT_STARTABLE', message: error.message }, { status: 409 });
    throw error;
  }
}
