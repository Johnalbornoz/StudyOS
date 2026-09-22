import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import {
  createUserFull,
  EmailAlreadyExistsError,
  PartialUserCreationError,
  PrivilegedRoleForbiddenError,
  InstitutionRequiredError,
  CoordinatorRequiresDirectCreationError,
} from '@/services/user-admin.service';

const Schema = z.object({
  email: z.string().email(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  locale: z.string().max(10).optional(),
  isTest: z.boolean().optional(),
  temporaryPassword: z.string().min(8).max(128).optional(),
  sendInvitation: z.boolean().optional(),
  initialRole: z.enum(['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION_ADMIN']).nullable().optional(),
  institutionId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.users.create');
  if ('error' in guard) return guard.error;

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  if (!validated.sendInvitation && !validated.temporaryPassword) {
    return NextResponse.json({ error: 'TEMPORARY_PASSWORD_OR_INVITATION_REQUIRED' }, { status: 400 });
  }

  try {
    const result = await createUserFull(guard.admin.actor.id, {
      email: validated.email,
      firstName: validated.firstName,
      lastName: validated.lastName,
      locale: validated.locale,
      isTest: validated.isTest ?? false,
      temporaryPassword: validated.temporaryPassword,
      sendInvitation: validated.sendInvitation ?? false,
      initialRole: validated.initialRole ?? null,
      institutionId: validated.institutionId,
    });
    // The temporary password itself is never included in this response
    // -- the admin already knows it, since they typed it.
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof EmailAlreadyExistsError) return NextResponse.json({ error: 'EMAIL_ALREADY_EXISTS' }, { status: 409 });
    if (error instanceof PrivilegedRoleForbiddenError) return NextResponse.json({ error: 'PRIVILEGED_ROLE_FORBIDDEN' }, { status: 403 });
    if (error instanceof InstitutionRequiredError) return NextResponse.json({ error: 'INSTITUTION_REQUIRED_FOR_COORDINATOR' }, { status: 400 });
    if (error instanceof CoordinatorRequiresDirectCreationError) return NextResponse.json({ error: 'COORDINATOR_REQUIRES_DIRECT_CREATION' }, { status: 400 });
    if (error instanceof PartialUserCreationError) {
      return NextResponse.json({ error: 'PARTIAL_CREATION', clerkUserId: error.clerkUserId, stage: error.stage }, { status: 409 });
    }
    throw error;
  }
}
