/**
 * Cambridge AICE Diploma -- GET / POST /api/aice/plan
 * GET: the Student's own Diploma plan view (planning + recorded results +
 * evaluation; never an official certification). POST: create the plan
 * ("Preparar Cambridge AICE Diploma"), idempotent. Owner only.
 */
import { NextResponse } from 'next/server';
import { createPlan, getPlanView } from '@/lib/exam-core/aice/plan.service';
import { studentGate } from '@/lib/exam-core/aice/route-helpers';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const g = await studentGate('/api/aice/plan');
  if (!g.ok) return g.response;
  return NextResponse.json({ success: true, data: await getPlanView(g.studentId) });
}

async function handlePOST() {
  const g = await studentGate('/api/aice/plan:create');
  if (!g.ok) return g.response;
  const plan = await createPlan(g.studentId);
  return NextResponse.json({ success: true, data: { planId: plan.id } });
}

export const GET = withAiRequestMetrics('GET /api/aice/plan', handleGET);
export const POST = withAiRequestMetrics('POST /api/aice/plan', handlePOST);
