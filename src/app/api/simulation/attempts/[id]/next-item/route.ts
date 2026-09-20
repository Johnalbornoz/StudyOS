/**
 * F15 -- GET/POST /api/simulation/attempts/[id]/next-item
 *
 * The new wiring IVG-F14-01 deferred: GET resolves (generating if
 * needed) the current item; POST submits the student's answer for it.
 * Both delegate entirely to item-resolution.service.ts, which itself
 * delegates grading to the real, unmodified F9 `recordSimulationItemResponse`
 * -- this route performs no grading or generation decision of its own.
 * Owner-only, same as every other simulation-attempt route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, checkRateLimit } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { logPilotEvent } from '@/lib/observability/pilot-events';
import {
  getNextSimulationItem,
  submitSimulationItemAnswer,
  skipUnavailableSimulationItem,
  SimulationItemAccessDeniedError,
  SimulationItemNotFoundError,
  SimulationItemNotActiveError,
  SimulationItemNoPendingItemError,
} from '@/lib/simulation/item-resolution.service';

function mapError(error: unknown) {
  if (error instanceof SimulationItemNotFoundError) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (error instanceof SimulationItemAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (error instanceof SimulationItemNotActiveError) return NextResponse.json({ error: 'ATTEMPT_NOT_ACTIVE', message: error.message }, { status: 409 });
  if (error instanceof SimulationItemNoPendingItemError) return NextResponse.json({ error: 'NO_PENDING_ITEM', message: error.message }, { status: 409 });
  throw error;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  // F15 -- unlike most GET routes, this one can trigger real AI question
  // generation (item-resolution.service.ts) -- it is not read-only from
  // a cost perspective, so it is rate-limited like a generation endpoint.
  if (!checkRateLimit(authContext.userId, '/api/simulation/attempts/next-item:get', 60, 60)) {
    logPilotEvent('rate_limited', { route: '/api/simulation/attempts/next-item', actorUserId: authContext.userId });
    return NextResponse.json({ error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const result = await getNextSimulationItem(actor.id, id);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return mapError(error);
  }
}

const SubmitSchema = z.object({
  action: z.enum(['submit', 'skip']).default('submit'),
  studentAnswer: z.string().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = SubmitSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    if (validated.action === 'skip') {
      const result = await skipUnavailableSimulationItem(actor.id, id);
      return NextResponse.json({ success: true, data: result });
    }
    if (!validated.studentAnswer) return NextResponse.json({ error: 'INVALID_INPUT', message: 'studentAnswer is required for action=submit' }, { status: 400 });
    const result = await submitSimulationItemAnswer(actor.id, id, validated.studentAnswer, validated.idempotencyKey);
    logPilotEvent('question_answered', { route: '/api/simulation/attempts/next-item', attemptId: id, targetIndex: result.targetIndex, done: result.done });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return mapError(error);
  }
}
