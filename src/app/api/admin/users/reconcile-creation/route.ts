import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { reconcileUserCreation, PrivilegedRoleForbiddenError, InstitutionRequiredError } from '@/services/user-admin.service';

const Schema = z.object({
  clerkUserId: z.string().min(1),
  email: z.string().email(),
  initialRole: z.enum(['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION_ADMIN']).nullable().optional(),
  isTest: z.boolean().optional(),
  institutionId: z.string().uuid().optional(),
});

/** Safe to call repeatedly with the same clerkUserId -- resumes a creation that succeeded in Clerk but failed in Postgres, never creates a second Clerk account. */
export async function POST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.users.reconcile-creation');
  if ('error' in guard) return guard.error;

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const result = await reconcileUserCreation(guard.admin.actor.id, validated.clerkUserId, validated.email, validated.initialRole ?? null, validated.isTest ?? false, validated.institutionId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof PrivilegedRoleForbiddenError) return NextResponse.json({ error: 'PRIVILEGED_ROLE_FORBIDDEN' }, { status: 403 });
    if (error instanceof InstitutionRequiredError) return NextResponse.json({ error: 'INSTITUTION_REQUIRED_FOR_COORDINATOR' }, { status: 400 });
    return NextResponse.json({ error: 'RECONCILE_FAILED', message: (error as Error).message }, { status: 500 });
  }
}
