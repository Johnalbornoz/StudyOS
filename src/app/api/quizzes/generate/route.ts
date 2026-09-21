import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentId } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from '@/lib/entitlements';
import { generateQuestion } from '@/services/ai.service';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // AI quiz generation is a paid capability -- gated server-side.
  const studentId = await requireStudentId(userId);
  if (!studentId) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  const actor = await getOrCreateCanonicalUser(userId);
  const entitled = await canUseCapability(actor.id, studentId, 'LEARNING_FULL_ACCESS');
  if (!entitled) {
    return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });
  }

  try {
    const { concept, difficulty = 3, count = 5 } = await req.json();

    if (!concept) {
      return NextResponse.json({ error: 'Missing concept' }, { status: 400 });
    }

    const questions = [];
    for (let i = 0; i < count; i++) {
      const questionJson = await generateQuestion(concept, difficulty);
      questions.push(JSON.parse(questionJson));
    }

    return NextResponse.json({ success: true, questions });
  } catch (error) {
    console.error('Quiz generation error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
