/**
 * LX-4P-PERF-R1D R3 -- the deferred, OPTIONAL interactive-formula widget.
 *
 * Its own request lifecycle, deliberately separate from
 * `GET /api/concepts/[id]/explanation`: the explanation endpoint returns
 * as soon as the MODEL-required content is ready, and the client fetches
 * this only after MODEL is already renderable. A slow or failed response
 * here never affects MODEL availability.
 *
 * `{ interactiveFormula: InteractiveFormula | null }` -- null whenever the
 * concept has no clean numeric formula, the explanation isn't generated
 * yet, or generation/validation failed. No AI call is made for
 * non-eligible concepts (R6).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getInteractiveFormula } from '@/services/concept-explanation.service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const language = searchParams.get('language') || 'en';
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const interactiveFormula = await getInteractiveFormula(studentId, id, language);
    return NextResponse.json({ success: true, data: { interactiveFormula } });
  } catch (error: any) {
    if (error?.message === 'CONCEPT_NOT_FOUND') {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (error?.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    // Optional enrichment: never surface a 500 that a client might treat
    // as a blocking error -- degrade to "no widget".
    console.error('Get interactive formula error:', error);
    return NextResponse.json({ success: true, data: { interactiveFormula: null } });
  }
}
