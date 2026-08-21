import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { createConversation, getConversations } from '@/services/tutor.service';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'Missing studentId' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const conversations = await getConversations(studentId);
  return NextResponse.json({ success: true, data: { conversations } });
}

const CreateSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await request.json();
  let validated;
  try {
    validated = CreateSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const conversationId = await createConversation(validated.studentId, validated.subjectId);
  return NextResponse.json({ success: true, data: { conversationId } });
}
