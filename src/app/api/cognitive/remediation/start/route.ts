import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getDiagnosis } from '@/services/cognitive-diagnosis.service';
import { startRemediation, remediationStepHref } from '@/services/remediation.service';
import { db } from '@/lib/db';
import { z } from 'zod';

const Schema = z.object({
  diagnosisId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const diagnosis = await getDiagnosis(validated.diagnosisId);
    if (!diagnosis) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const canAccess = await verifyStudentAccess(authContext.userId, diagnosis.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (diagnosis.state !== 'CONFIRMED') {
      return NextResponse.json({ error: 'DIAGNOSIS_NOT_CONFIRMED' }, { status: 400 });
    }

    const path = await startRemediation(validated.diagnosisId);
    const firstStep = path.steps[0];
    const subjectRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [path.rootCauseConceptId]);
    const subjectId = subjectRow.rows[0]?.subject_id;
    const href = firstStep && subjectId ? remediationStepHref(firstStep, { id: path.id, subjectId }) : null;

    return NextResponse.json({ success: true, path, href });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    if (error.message === 'DIAGNOSIS_NOT_FOUND' || error.message === 'DIAGNOSIS_NOT_CONFIRMED') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Remediation start error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
