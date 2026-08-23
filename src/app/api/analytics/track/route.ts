import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { track } from '@/lib/analytics';
import { z } from 'zod';

/**
 * The one client-callable entry point into the existing analytics
 * event log (src/lib/analytics.ts) -- every other track() call in the
 * app happens server-side inside a service. This exists only so
 * client components (e.g. the Quiz math toolbar) can log non-invasive
 * UI events without a dedicated route per feature. Never accepts or
 * stores answer content -- `properties` is passed through as-is, so
 * callers must not put anything private in it.
 */
const Schema = z.object({
  studentId: z.string().uuid(),
  eventName: z.string().min(1).max(100),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    await track(validated.studentId, validated.eventName, validated.properties);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
