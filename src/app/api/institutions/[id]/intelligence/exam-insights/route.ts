/**
 * Exam insights for an institution -- GET /api/institutions/[id]/intelligence/exam-insights?family=
 * Coordinator (approved INSTITUTION_ADMIN of THIS institution) only: exam
 * participation, common academic gaps by domain / objective / concept as
 * numbers of Students (no individual answers), and the AICE Diploma planning
 * summary of its Students.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { requireInstitutionAccess } from '@/lib/institution-intelligence';
import { db } from '@/lib/db';
import { examGapsFor, examGoalsFor, examParticipation } from '@/lib/exam-core/exam-gaps.service';
import { institutionAiceSummary } from '@/lib/exam-core/aice/plan.service';
import { respondFromService } from '../_respond';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const family = new URL(request.url).searchParams.get('family');
  if (family && !/^[A-Z]{2,12}$/.test(family)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  return respondFromService(async () => {
    await requireInstitutionAccess(actor.id, institutionId);
    const ids = (await db.query(`SELECT DISTINCT ce.student_id FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE c.institution_id = $1 AND ce.status = 'ACTIVE'`, [institutionId])).rows.map((r: any) => r.student_id as string);
    const [participation, gaps, aice, goals] = await Promise.all([examParticipation(ids), examGapsFor(ids, { families: family ? [family] : undefined, includePerStudent: false }), institutionAiceSummary(institutionId), examGoalsFor(ids, { includePerStudent: false })]);
    return { students: ids.length, participation, goals, gaps, aice };
  });
}

export const GET = withAiRequestMetrics('GET /api/institutions/[id]/intelligence/exam-insights', handleGET);
