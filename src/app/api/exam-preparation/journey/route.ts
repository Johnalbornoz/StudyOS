/**
 * Student Exam Journey V2 (J2) -- GET /api/exam-preparation/journey
 *
 * INTERNAL DIAGNOSTIC -- not a public API contract, never consumed by Student UX.
 * Shadow inspection: the caller's OWN exam journeys exactly as the resolver
 * computes them (one per exam target, or one "no target" resolution). Exists
 * only while STUDENT_JOURNEY_V2=SHADOW (404 otherwise). Owner-only, read-only;
 * the response carries no Student id, name or email (target ids, catalogue keys
 * and enums only). It lets the shadow be observed and tested on DEV without log access.
 */
import { NextResponse } from 'next/server';
import { isStudentJourneyShadowEnabled } from '@/lib/exam-journey/feature-flag';
import { resolveStudentExamJourneys } from '@/lib/exam-journey/shadow.server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentGate } from '../route-helpers';

const JOURNEY_DIAGNOSTIC_MARKER = 'JOURNEY_SHADOW_DIAGNOSTIC';

async function handleGET() {
  if (!isStudentJourneyShadowEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const gate = await studentGate('/api/exam-preparation/journey', 30);
  if (!gate.ok) return gate.res;
  const asOf = new Date().toISOString().slice(0, 10);
  const journeys = await resolveStudentExamJourneys(gate.studentId, asOf);
  return NextResponse.json(
    { success: true, internal: JOURNEY_DIAGNOSTIC_MARKER, data: { mode: 'SHADOW', asOf, journeys } },
    { headers: { 'Cache-Control': 'no-store', 'X-StudyUs-Internal': JOURNEY_DIAGNOSTIC_MARKER } }
  );
}

export const GET = withAiRequestMetrics('GET /api/exam-preparation/journey', handleGET);
