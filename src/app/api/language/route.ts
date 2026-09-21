import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentId } from '@/lib/auth';
import { getOrCreateCanonicalUser, hasRole } from '@/lib/identity';
import { getInterfaceLanguage, setInterfaceLanguage } from '@/lib/i18n/language';
import { isLocale } from '@/lib/i18n/messages';

/**
 * Language preference is keyed by `students.id` for a Student (exactly
 * as before -- must never change to avoid resetting every existing
 * Student's saved preference) and by the F1 canonical `users.id` for
 * every other role, matching the same split the dashboard layout
 * already uses (`DashboardLayout`'s own STUDENT vs. non-STUDENT
 * branches). A non-Student caller must never provision a phantom
 * `students` row just to read/set a language preference.
 */
async function resolvePreferenceKey(clerkUserId: string): Promise<string> {
  const canonicalUser = await getOrCreateCanonicalUser(clerkUserId);
  if (await hasRole(canonicalUser.id, 'STUDENT')) {
    const studentId = await requireStudentId(clerkUserId);
    if (studentId) return studentId;
  }
  return canonicalUser.id;
}

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const key = await resolvePreferenceKey(clerkUserId);
  const locale = await getInterfaceLanguage(key);
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

  const key = await resolvePreferenceKey(clerkUserId);
  await setInterfaceLanguage(key, body.locale);
  return NextResponse.json({ success: true, locale: body.locale });
}
