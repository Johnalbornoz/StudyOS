/**
 * F15 / Track B -- GET/POST /api/simulation/attempts/[id]/next-item
 *
 * GET resolves (sourcing if needed) the working item -- optionally a given
 * position (`?index=`) when the attempt's navigation policy allows it. POST:
 *   action=submit   commit the answer for the delivered item (server-held key)
 *   action=autosave store an in-progress answer (never graded)
 *   action=skip     move past an item the platform could not prepare
 *   action=endBreak end a configured break early
 * Everything delegates to item-resolution.service.ts; this route performs no
 * grading or generation decision of its own. Owner-only. The body is
 * validated strictly: unknown fields (a client-supplied question, answer key,
 * studentId or examVersionId) are rejected, never ignored.
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
  saveSimulationItemDraft,
  endSimulationBreak,
  SimulationItemAccessDeniedError,
  SimulationItemNotFoundError,
  SimulationItemNotActiveError,
  SimulationItemNoPendingItemError,
  SimulationNavigationError,
  SimulationInvalidResponseError,
} from '@/lib/simulation/item-resolution.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

function mapError(error: unknown) {
  if (error instanceof SimulationItemNotFoundError) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (error instanceof SimulationItemAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (error instanceof SimulationItemNotActiveError) return NextResponse.json({ error: 'ATTEMPT_NOT_ACTIVE', message: error.message }, { status: 409 });
  if (error instanceof SimulationItemNoPendingItemError) return NextResponse.json({ error: 'NO_PENDING_ITEM', message: error.message }, { status: 409 });
  if (error instanceof SimulationNavigationError) return NextResponse.json({ error: error.code }, { status: 409 });
  if (error instanceof SimulationInvalidResponseError) return NextResponse.json({ error: 'INVALID_RESPONSE', reason: error.reason }, { status: 422 });
  throw error;
}

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const indexParam = new URL(request.url).searchParams.get('index');
  const requestedIndex = indexParam === null ? undefined : Number(indexParam);
  if (requestedIndex !== undefined && (!Number.isInteger(requestedIndex) || requestedIndex < 0 || requestedIndex > 10000)) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
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
    const result = await getNextSimulationItem(actor.id, id, requestedIndex);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return mapError(error);
  }
}

const SubmitSchema = z
  .object({
    action: z.enum(['submit', 'skip', 'autosave', 'endBreak']).default('submit'),
    studentAnswer: z.string().max(20000).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
    targetIndex: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  // Track B: autosave makes this route chatty by design; bound a scripted loop only.
  if (!checkRateLimit(authContext.userId, '/api/simulation/attempts/next-item:post', 240, 60)) {
    logPilotEvent('rate_limited', { route: '/api/simulation/attempts/next-item', actorUserId: authContext.userId });
    return NextResponse.json({ error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }, { status: 429 });
  }
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = SubmitSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues?.[0]?.message ?? error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    if (validated.action === 'skip') {
      const result = await skipUnavailableSimulationItem(actor.id, id, validated.targetIndex);
      return NextResponse.json({ success: true, data: result });
    }
    if (validated.action === 'endBreak') {
      const result = await endSimulationBreak(actor.id, id);
      return NextResponse.json({ success: true, data: result });
    }
    if (validated.action === 'autosave') {
      if (validated.targetIndex === undefined || validated.studentAnswer === undefined) return NextResponse.json({ error: 'INVALID_INPUT', message: 'targetIndex and studentAnswer are required for action=autosave' }, { status: 400 });
      const result = await saveSimulationItemDraft(actor.id, id, validated.targetIndex, validated.studentAnswer);
      return NextResponse.json({ success: true, data: result });
    }
    if (!validated.studentAnswer) return NextResponse.json({ error: 'INVALID_INPUT', message: 'studentAnswer is required for action=submit' }, { status: 400 });
    const result = await submitSimulationItemAnswer(actor.id, id, validated.studentAnswer, validated.idempotencyKey, validated.targetIndex);
    logPilotEvent('question_answered', { route: '/api/simulation/attempts/next-item', attemptId: id, targetIndex: result.targetIndex, done: result.done });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return mapError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/simulation/attempts/[id]/next-item', handleGET);
export const POST = withAiRequestMetrics('POST /api/simulation/attempts/[id]/next-item', handlePOST);
