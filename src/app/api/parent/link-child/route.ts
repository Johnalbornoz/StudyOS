import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateParentId } from '@/lib/auth';
import { linkChildByEmail, unlinkChild } from '@/services/parent.service';
import { z } from 'zod';

const LinkSchema = z.object({ childEmail: z.string().email() });
const UnlinkSchema = z.object({ studentId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parentId = await getOrCreateParentId(clerkUserId);
  const body = await request.json();

  let validated;
  try {
    validated = LinkSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', message: error.errors?.[0]?.message || 'Invalid email' },
      { status: 400 }
    );
  }

  try {
    const child = await linkChildByEmail(parentId, validated.childEmail);
    return NextResponse.json({ success: true, data: { child } });
  } catch (error: any) {
    if (error.message === 'NO_STUDENT_FOUND') {
      return NextResponse.json(
        { error: 'NO_STUDENT_FOUND', message: 'No student account exists with that email yet.' },
        { status: 404 }
      );
    }
    console.error('Error linking child:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', details: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parentId = await getOrCreateParentId(clerkUserId);
  const body = await request.json();

  let validated;
  try {
    validated = UnlinkSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', message: error.errors?.[0]?.message },
      { status: 400 }
    );
  }

  await unlinkChild(parentId, validated.studentId);
  return NextResponse.json({ success: true });
}
