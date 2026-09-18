/**
 * F8 -- GET /api/diagnostics/[id]/explain (task §11)
 *
 * The diagnosis's own studentId (not a query param) determines the
 * access check -- a caller cannot spoof authorization by supplying an
 * unrelated studentId.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getDiagnosisById } from '@/lib/diagnostics/diagnosis.service';
import { explainDiagnosis } from '@/lib/diagnostics/explain.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const diagnosis = await getDiagnosisById(id);
  if (!diagnosis) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, diagnosis.studentId, 'LEARNER_PROGRESS_VIEW');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const explanation = await explainDiagnosis(id);
  return NextResponse.json({ success: true, data: { explanation } });
}
