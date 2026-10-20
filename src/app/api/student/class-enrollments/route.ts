/**
 * L9 IN-3 -- GET /api/student/class-enrollments
 * The Student's own ACTIVE class enrollments (with the enrollment id needed to leave one) and
 * their interface language. `studentId` is always the caller's own resolved identity.
 */
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { listOwnActiveEnrollments } from '@/lib/institution/student-class-membership';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const [enrollments, locale] = await Promise.all([listOwnActiveEnrollments(studentId), getInterfaceLanguage(studentId).catch(() => 'es' as const)]);
  return NextResponse.json({ success: true, data: { enrollments, locale } });
}

export const GET = withAiRequestMetrics('GET /api/student/class-enrollments', handleGET);
