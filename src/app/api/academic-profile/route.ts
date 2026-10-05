import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { requireStudentId } from '@/lib/auth';
import { getAcademicProfile, upsertAcademicProfile } from '@/services/academic-profile.service';
import { AcademicProfileSelectionError, getProfileCurriculum, saveAcademicProfileSelection } from '@/services/academic-profile-catalogue.service';
import { getOrCreateCanonicalUser } from '@/lib/identity';

const ProfileSchema = z.object({
  countryOfStudy: z.enum(['CO', 'MX', 'US', 'DE', 'OTHER']),
  schoolYear: z.string().nullish(),
  curriculumType: z.enum(['national', 'ib', 'other', 'not_sure']),
  ibProgramme: z.enum(['MYP', 'DP']).nullish(),
  ibYear: z.string().nullish(),
  academicYear: z.string().nullish(),
  schoolName: z.string().nullish(),
  profileCompleted: z.boolean().optional(),
  // Phase A: catalogue selection (Nacional / Internacional -> programme -> qualification -> subjects).
  // Present -> validated against the catalogue and audited; absent -> legacy save (country / grade / type only).
  curriculumScope: z.enum(['NATIONAL', 'INTERNATIONAL']).nullish(),
  academicProgrammeId: z.string().uuid().nullish(),
  academicQualificationId: z.string().uuid().nullish(),
  academicSubjectIds: z.array(z.string().uuid()).max(40).optional(),
});

async function handleGET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const [profile, curriculum] = await Promise.all([getAcademicProfile(studentId), getProfileCurriculum(studentId)]);
  return NextResponse.json({ data: profile ? { ...profile, curriculum } : null });
}

async function handlePOST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await request.json();
  const parsed = ProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const d = parsed.data;
  if (d.curriculumScope !== undefined) {
    try {
      const actor = await getOrCreateCanonicalUser(clerkUserId, null);
      await saveAcademicProfileSelection(
        studentId,
        {
          countryOfStudy: d.countryOfStudy,
          schoolYear: d.schoolYear ?? null,
          curriculumScope: d.curriculumScope ?? null,
          academicProgrammeId: d.academicProgrammeId ?? null,
          academicQualificationId: d.academicQualificationId ?? null,
          academicSubjectIds: d.academicSubjectIds ?? [],
          curriculumType: d.curriculumType === 'not_sure' ? 'not_sure' : 'other',
          academicYear: d.academicYear ?? null,
          profileCompleted: d.profileCompleted ?? true,
        },
        actor.id
      );
    } catch (error) {
      if (error instanceof AcademicProfileSelectionError) return NextResponse.json({ error: error.code }, { status: 422 });
      throw error;
    }
    const [profile, curriculum] = await Promise.all([getAcademicProfile(studentId), getProfileCurriculum(studentId)]);
    return NextResponse.json({ data: profile ? { ...profile, curriculum } : null });
  }
  const profile = await upsertAcademicProfile(studentId, d);
  return NextResponse.json({ data: profile });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/academic-profile', handleGET);
export const POST = withAiRequestMetrics('POST /api/academic-profile', handlePOST);
