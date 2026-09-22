import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { listAllPendingMembershipsAcrossInstitutions } from '@/services/institution.service';
import { listPendingInvitations, detectSyncErrors } from '@/services/user-admin.service';

/**
 * Unified pending-work inbox for STUDYUS_ADMIN. Deliberately a NEW,
 * independently-gated route (`requireStudyUSAdmin`, not
 * `canAccessInstitution`) rather than widening F2's own certified
 * institution-scoped authorization function -- a STUDYUS_ADMIN acting
 * globally is a different authority than an INSTITUTION_ADMIN acting
 * on their own institution, and this keeps the two from ever being
 * confused at the authorization layer.
 */
export async function GET(_request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.requests.list');
  if ('error' in guard) return guard.error;

  const [institutionRequests, invitations, syncCheck] = await Promise.all([
    listAllPendingMembershipsAcrossInstitutions(),
    listPendingInvitations().catch(() => []),
    detectSyncErrors(50).catch(() => ({ usersWithoutClerkMatch: [] })),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      institutionRequests,
      invitations,
      syncErrors: syncCheck.usersWithoutClerkMatch,
    },
  });
}
