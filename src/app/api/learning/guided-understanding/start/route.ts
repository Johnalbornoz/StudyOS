/**
 * POST /api/learning/guided-understanding/start -- starts (or resumes) the adaptive guided LEARN session of
 * one concept (operator rule 2026-10-16: LEARN = guided understanding, 4..7 interactions, no score gate).
 *
 * Body: { studentId, subjectId, conceptId, language? }
 *
 * Order (same discipline as the other learner routes): authenticated -> the actor IS this Student ->
 * subject + concept are the Student's own -> licence -> no restricted evidence collection open anywhere
 * (assistance guard) -> the FRESH canonical decision says LEARN is executable for this concept, else
 * 403 LEARN_NOT_AUTHORIZED -> one model call for the first interaction. The response never carries an
 * answer key. Writes no evidence (that happens once, on close -- see the turn route).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, verifySubjectAccess, verifyConceptsAccess, checkRateLimit } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { isOwner } from '@/lib/authorization';
import { learningLicenceRequiredResponseForActor } from '@/lib/entitlements/learning-gate';
import { instructionalAssistanceLockedResponse } from '@/lib/ai/instructional-assistance-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { isLocale } from '@/lib/i18n/messages';
import { resolveLanguageForSubject } from '@/services/subject-generation-context.service';
import { startGuidedLearnSession } from '@/services/learn-guided.service';

const StartSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  conceptId: z.string().uuid(),
  language: z.string().optional(),
});

const FAILURE_STATUS = { LEARN_NOT_AUTHORIZED: 403, CONCEPT_NOT_FOUND: 404, GENERATION_FAILED: 503 } as const;
const FAILURE_MESSAGE = {
  LEARN_NOT_AUTHORIZED: 'This concept is not currently at the LEARN stage.',
  CONCEPT_NOT_FOUND: 'Concept not found.',
  GENERATION_FAILED: 'The first interaction could not be prepared. Try again.',
} as const;

async function handlePOST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: z.infer<typeof StartSchema>;
  try {
    body = StartSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  if (!(await isOwner(actor.id, body.studentId))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!checkRateLimit(actor.id, 'learn-guided-start', 10, 60)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });

  const [subjectOwned, conceptOwned] = await Promise.all([
    verifySubjectAccess(body.studentId, body.subjectId),
    verifyConceptsAccess(body.studentId, [body.conceptId], body.subjectId),
  ]);
  if (!subjectOwned || !conceptOwned) return NextResponse.json({ error: 'FORBIDDEN', message: 'Cannot access this subject or concept' }, { status: 403 });

  // L11 / EN-2 (D-8a): instructional AI is part of the licence -- refused before any generation.
  const licenceRequired = await learningLicenceRequiredResponseForActor(actor.id, body.studentId);
  if (licenceRequired) return licenceRequired;
  // Human Agency P0-1: no AI teaching while restricted evidence is being collected anywhere for this Student.
  const assistanceLocked = await instructionalAssistanceLockedResponse(body.studentId);
  if (assistanceLocked) return assistanceLocked;

  const language = isLocale(body.language) ? body.language : await resolveLanguageForSubject(body.subjectId, body.studentId);
  const result = await startGuidedLearnSession({ studentId: body.studentId, subjectId: body.subjectId, conceptId: body.conceptId, language });
  if (!result.ok) return NextResponse.json({ error: result.code, message: FAILURE_MESSAGE[result.code] }, { status: FAILURE_STATUS[result.code] });
  const { ok: _ok, ...data } = result;
  return NextResponse.json({ success: true, data });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/learning/guided-understanding/start', handlePOST);
