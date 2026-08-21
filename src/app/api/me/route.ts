import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getOrCreateStudentId } from '@/lib/auth';

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const studentId = await getOrCreateStudentId(clerkUserId);

  return NextResponse.json({ studentId });
}
