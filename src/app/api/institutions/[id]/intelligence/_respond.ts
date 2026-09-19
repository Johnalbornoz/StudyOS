/**
 * F12 -- shared response helper for Institution Intelligence routes.
 * Every route resolves the actor server-side and lets the service layer
 * itself decide authorization -- this helper only translates the two
 * known denial errors into the correct HTTP status, never swallows or
 * reinterprets them.
 */
import { NextResponse } from 'next/server';
import { InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { NoActiveAnalyticsPolicyError } from '@/lib/institution-intelligence';

export async function respondFromService<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    if (error instanceof NoActiveAnalyticsPolicyError) {
      return NextResponse.json({ error: 'MIN_COHORT_POLICY_OPEN_DECISION' }, { status: 409 });
    }
    if (error instanceof Error && /not found|does not belong/.test(error.message)) {
      return NextResponse.json({ error: 'NOT_FOUND_OR_INVALID_SCOPE' }, { status: 404 });
    }
    throw error;
  }
}
