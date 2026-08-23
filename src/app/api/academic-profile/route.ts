import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { getOrCreateStudentId } from '@/lib/auth';
import { getAcademicProfile, upsertAcademicProfile } from '@/services/academic-profile.service';

const ProfileSchema = z.object({
  countryOfStudy: z.enum(['CO', 'MX', 'US', 'DE', 'OTHER']),
  schoolYear: z.string().nullish(),
  curriculumType: z.enum(['national', 'ib', 'other', 'not_sure']),
  ibProgramme: z.enum(['MYP', 'DP']).nullish(),
  ibYear: z.string().nullish(),
  academicYear: z.string().nullish(),
  schoolName: z.string().nullish(),
  profileCompleted: z.boolean().optional(),
});

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const studentId = await getOrCreateStudentId(clerkUserId);
  const profile = await getAcademicProfile(studentId);
  return NextResponse.json({ data: profile });
}

export async function POST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await request.json();
  const parsed = ProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const profile = await upsertAcademicProfile(studentId, parsed.data);
  return NextResponse.json({ data: profile });
}
