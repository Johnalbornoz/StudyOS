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

  // F10 / INV-F10 account-enumeration fix (task §6): whether or not
  // `childEmail` matches a real student account, the caller gets the
  // exact same response. Previously a distinct 404 NO_STUDENT_FOUND vs
  // 200 success was a live oracle for "does this email have a student
  // account" -- the non-match case is now logged server-side only.
  const GENERIC_RESPONSE = {
    success: true,
    message: 'If that email belongs to a student account, a request has been sent to them.',
  };
  try {
    await linkChildByEmail(parentId, validated.childEmail);
    return NextResponse.json(GENERIC_RESPONSE);
  } catch (error: any) {
    if (error.message === 'NO_STUDENT_FOUND') {
      console.info('link-child: no matching student for provided email (not disclosed to caller)');
      return NextResponse.json(GENERIC_RESPONSE);
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
