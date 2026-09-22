import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { createTestIdentity, NotTestEnvironmentError } from '@/services/user-admin.service';

const Schema = z.object({
  alias: z.string().min(1).max(40),
  purpose: z.string().min(1).max(300),
  initialRole: z.enum(['STUDENT', 'PARENT', 'TEACHER']).nullable().optional(),
});

/**
 * Mechanism B: creates a real Clerk account via the Backend API
 * (server-to-server, never the public /sign-up form -- not subject to
 * the Cloudflare Turnstile check that blocks automated browser
 * sign-up) and immediately marks it a TEST identity. Preview-only,
 * enforced inside the service, not just here (fails closed even if
 * this route were reached some other way).
 */
export async function POST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.users.test-identity.create');
  if ('error' in guard) return guard.error;

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const result = await createTestIdentity(guard.admin.actor.id, {
      alias: validated.alias,
      purpose: validated.purpose,
      initialRole: validated.initialRole ?? null,
    });
    // The one-time credential pair is returned ONLY in this single
    // response, to the STUDYUS_ADMIN who just requested it -- never
    // persisted, never logged, never included in any list/detail read
    // afterward.
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof NotTestEnvironmentError) {
      return NextResponse.json({ error: 'NOT_PREVIEW_ENVIRONMENT' }, { status: 403 });
    }
    throw error;
  }
}
