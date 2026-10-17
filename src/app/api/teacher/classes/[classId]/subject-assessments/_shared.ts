/**
 * Shared request schema and error mapping of the Teacher's subject Test / Mock assignment routes. Not a route file
 * (underscore-prefixed folders/files are private in the App Router; this module only exports helpers).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { TeacherClassAccessDeniedError, NoLearnersToAssignError, InvalidClassAssignmentError } from '@/lib/teacher/class-assignment.service';
import { SubjectAssignmentError } from '@/lib/teacher/subject-assessment-assignment.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DraftSchema = z.object({
  kind: z.enum(['TEST', 'MOCK']),
  conceptIds: z.array(z.string().uuid()).min(1).max(200),
  difficulty: z.enum(['BASICO', 'INTERMEDIO', 'AVANZADO', 'MIXTO', 'LOW', 'MEDIUM', 'HIGH', 'MIXED']),
  startDate: isoDate,
  endDate: isoDate,
  maxAttempts: z.number().int().min(1).max(10),
  timing: z.object({ timed: z.boolean(), durationMinutes: z.number().int().min(1).max(600).nullable() }),
});

export const PublishSchema = DraftSchema.extend({
  title: z.string().trim().max(200).nullable().optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
  studentIds: z.array(z.string().uuid()).max(500).nullable().optional(),
  requestId: z.string().uuid().nullable().optional(),
});

export async function actorFor() {
  const authContext = await verifyAuth();
  if (!authContext) return null;
  return getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
}

/** Known refusals -> status + code (never a raw message); anything else rethrows. */
export function mapAssignmentError(error: unknown): NextResponse {
  if (error instanceof TeacherClassAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (error instanceof NoLearnersToAssignError) return NextResponse.json({ error: 'NO_LEARNERS_TO_ASSIGN' }, { status: 422 });
  if (error instanceof InvalidClassAssignmentError) return NextResponse.json({ error: error.code }, { status: error.code === 'FIELD_LOCKED_BY_INSTITUTION' ? 403 : 422 });
  if (error instanceof SubjectAssignmentError) return NextResponse.json({ error: error.code }, { status: error.status });
  throw error;
}
