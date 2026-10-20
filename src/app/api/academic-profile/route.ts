import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { requireStudentId } from '@/lib/auth';
import { getAcademicProfile, upsertAcademicProfile } from '@/services/academic-profile.service';
import { AcademicProfileSelectionError, getProfileCurriculum, saveAcademicProfileSelection } from '@/services/academic-profile-catalogue.service';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { db } from '@/lib/db';
import {
  canonicalTimeContextText,
  isAcceptedTimeContext,
  resolveTimeContextModel,
  storedTimeContext,
  timeContextColumns,
  type TimeContext,
} from '@/lib/student/time-context';

// REM-T1-03: the final step is a CONTROLLED, structured value (never free text).
const TimeContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SCHOOL_YEAR'), startYear: z.number().int().min(2000).max(2100), endYear: z.number().int().min(2000).max(2100) }),
  // Canonical awarding-body series only (IB May/November, Cambridge March/June/November).
  z.object({ kind: z.literal('EXAM_SESSION'), series: z.enum(['MAY', 'NOVEMBER', 'MARCH', 'JUNE']), year: z.number().int().min(2000).max(2100) }),
]);

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
  timeContext: TimeContextSchema.nullish(),
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

  // REM-T1-03: the time context is driven by the programme (exam session for IB / Cambridge, a controlled
  // school year otherwise), validated server-side. A legacy `academicYear` string is accepted only when it
  // reads unambiguously as a valid value. The text column keeps the canonical display string for older readers.
  const programmeName = d.academicProgrammeId
    ? ((await db.query(`SELECT name FROM academic_programmes WHERE id = $1`, [d.academicProgrammeId])).rows[0]?.name as string | undefined) ?? null
    : null;
  const qualificationName = d.academicQualificationId
    ? ((await db.query(`SELECT name FROM academic_qualifications WHERE id = $1`, [d.academicQualificationId])).rows[0]?.name as string | undefined) ?? null
    : null;
  // Series availability: programme / qualification / region / year (syllabus codes are not on catalogue
  // subjects yet, so the governed programme-level availability applies -- never an unsupported series).
  const model = resolveTimeContextModel({ country: d.countryOfStudy, programmeName, qualificationName });
  const existing = await getAcademicProfile(studentId);
  const submitted: TimeContext | null = d.timeContext ?? (d.academicYear ? storedTimeContext({ academicYear: d.academicYear }) : null);
  if (d.profileCompleted !== false && (!submitted || !isAcceptedTimeContext(submitted, model, new Date(), existing ? storedTimeContext(existing) : null))) {
    return NextResponse.json({ error: 'TIME_CONTEXT_INVALID' }, { status: 400 });
  }
  const timeColumns = timeContextColumns(submitted);
  const academicYear = submitted ? canonicalTimeContextText(submitted) : d.academicYear ?? null;

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
          academicYear,
          profileCompleted: d.profileCompleted ?? true,
          timeColumns,
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
  const profile = await upsertAcademicProfile(studentId, { ...d, academicYear, timeColumns });
  return NextResponse.json({ data: profile });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/academic-profile', handleGET);
export const POST = withAiRequestMetrics('POST /api/academic-profile', handlePOST);
