import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { isAllowlistedAdminUser } from '@/lib/admin/admin-identity';
import { adminForceDeleteSubject } from '@/services/admin.service';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!isAllowlistedAdminUser(user)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await params;
  await adminForceDeleteSubject(id);
  return NextResponse.json({ success: true });
}
