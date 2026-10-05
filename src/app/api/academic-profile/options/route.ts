/**
 * Academic Profile (Phase A) -- GET /api/academic-profile/options?country=&schoolYear=
 * The Student's curriculum options from the canonical catalogue: national programmes
 * of their country and international programmes by authority, each marked compatible
 * (or not) with their grade. Exams (PISA, PAA, Saber 11) are never curricula.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { requireStudentActor } from '@/lib/learning-plan/route-actors';
import { listStudentCurriculumOptions } from '@/services/academic-profile-catalogue.service';

async function handleGET(request: NextRequest) {
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  const sp = new URL(request.url).searchParams;
  const country = (sp.get('country') ?? '').toUpperCase();
  const schoolYear = (sp.get('schoolYear') ?? '').slice(0, 40) || null;
  if (country && !/^[A-Z]{2,5}$/.test(country)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  return NextResponse.json({ data: await listStudentCurriculumOptions(country || null, schoolYear) });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/academic-profile/options', handleGET);
