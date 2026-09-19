/**
 * F10 -- GET /api/parent/learners/[studentId]/exam-prep
 *
 * Sourced exclusively from F9's readiness/simulation engines -- never
 * the legacy exam-readiness.service.ts (INV-F10-19, see
 * F10_LEGACY_READINESS_CONTAINMENT.md). `data: null` is a valid
 * response meaning "no active Exam Profile", not an error.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getParentExamPreparation, ParentAccessDeniedError } from '@/lib/parent/read-model.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const examPrep = await getParentExamPreparation(actor.id, studentId);
    return NextResponse.json({ success: true, data: examPrep });
  } catch (error) {
    if (error instanceof ParentAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}
