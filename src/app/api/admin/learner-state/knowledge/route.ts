/**
 * F5 -- GET /api/admin/learner-state/knowledge?studentId=&conceptId=
 *
 * Explainability wrapper (task 16) around the EXISTING, unchanged
 * concept_knowledge_state authority -- read-only, no new storage.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { explainKnowledgeState } from '@/lib/learner-state/knowledge-state-explain.service';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const conceptId = searchParams.get('conceptId');
  if (!studentId || !conceptId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const explanation = await explainKnowledgeState(studentId, conceptId);
  return NextResponse.json({ success: true, data: { explanation } });
}
