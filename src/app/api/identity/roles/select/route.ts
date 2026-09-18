/**
 * F1 -- POST /api/identity/roles/select
 *
 * The ONLY network entry point that grants a role to the caller's own
 * canonical identity. `role` is validated by a Zod enum restricted to
 * exactly the 3 self-service roles -- 'INSTITUTION_ADMIN' and
 * 'STUDYUS_ADMIN' are not accepted values, so no request payload,
 * however constructed, can reach them through this route (they fail
 * Zod parsing with INVALID_INPUT, the same generic 400 any other
 * unsupported string gets -- never a distinct error that would
 * confirm those roles exist). `assignSelfServiceRole` itself is
 * additionally typed to the same 3-value union, so even a future
 * caller inside this codebase could not pass one of the two privileged
 * roles through without a compile error. See
 * F1_AUTHORIZATION_BOUNDARY.md.
 *
 * The identity assigned to is always the authenticated caller's own
 * (`verifyAuth().userId`) -- there is no `userId`/`targetUserId` field
 * in the request body to manipulate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser, assignSelfServiceRole, resolveDefaultWorkspace, type SelfServiceRole } from '@/lib/identity';

/**
 * Deliberately a literal Zod enum, not built from SELF_SERVICE_ROLES at
 * runtime -- this is the actual network-facing allowlist, reviewable
 * on its own without indirection. `f1-role-selection-security.test.ts`
 * asserts this literal set stays in sync with SelfServiceRole.
 */
const Schema = z.object({ role: z.enum(['STUDENT', 'PARENT', 'TEACHER']) });

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { role } = Schema.parse(await request.json());

    const user = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
    await assignSelfServiceRole(authContext.userId, user.id, role as SelfServiceRole);
    const defaultWorkspace = await resolveDefaultWorkspace(user.id);

    return NextResponse.json({ success: true, data: { role, defaultWorkspace } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    console.error('Error assigning role:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
