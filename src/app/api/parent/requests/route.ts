import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateStudentId } from '@/lib/auth';
import { getPendingRequestsForStudent, respondToRequest } from '@/services/parent.service';
import { z } from 'zod';

/** Pending parent link-requests for the current (student) user. */
export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const requests = await getPendingRequestsForStudent(studentId);
  return NextResponse.json({ success: true, data: { requests } });
}

const RespondSchema = z.object({
  parentId: z.string().uuid(),
  accept: z.boolean(),
});

export async function POST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const body = await request.json();

  let validated;
  try {
    validated = RespondSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  await respondToRequest(studentId, validated.parentId, validated.accept);
  return NextResponse.json({ success: true });
}
