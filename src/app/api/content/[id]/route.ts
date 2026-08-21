import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { deleteContentSource } from '@/services/content.service';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const deleted = await deleteContentSource(studentId, id);
  if (!deleted) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
