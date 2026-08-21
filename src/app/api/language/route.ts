import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage, setInterfaceLanguage } from '@/lib/i18n/language';
import { isLocale } from '@/lib/i18n/messages';

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  return NextResponse.json({ locale });
}

export async function POST(req: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  if (!isLocale(body.locale)) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 });
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  await setInterfaceLanguage(studentId, body.locale);
  return NextResponse.json({ success: true, locale: body.locale });
}
