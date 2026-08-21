import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateParentId } from '@/lib/auth';
import { getChildOverview, verifyParentAccess } from '@/services/parent.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';

export async function GET(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'Missing studentId' }, { status: 400 });
  }

  const parentId = await getOrCreateParentId(clerkUserId);
  const canAccess = await verifyParentAccess(parentId, studentId);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const preferredLanguage = await getInterfaceLanguage(studentId).catch(() => 'en');
  const overview = await getChildOverview(studentId, preferredLanguage);
  return NextResponse.json({ success: true, data: overview });
}
