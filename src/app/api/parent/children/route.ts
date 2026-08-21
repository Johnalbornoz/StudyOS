import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getOrCreateParentId } from '@/lib/auth';
import { getLinkedChildren } from '@/services/parent.service';

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parentId = await getOrCreateParentId(clerkUserId);
  const children = await getLinkedChildren(parentId);
  return NextResponse.json({ success: true, data: { children } });
}
