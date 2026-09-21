import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireStudentId } from '@/lib/auth';

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) {
    return NextResponse.json({ error: 'FORBIDDEN', message: 'This account has no active STUDENT role.' }, { status: 403 });
  }

  return NextResponse.json({ studentId });
}
