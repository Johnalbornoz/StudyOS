/**
 * Fase 2A -- GET the global user list (+ pending Clerk invitations,
 * merged) for STUDYUS_ADMIN only. Every filter is applied server-side;
 * no institution-scoped actor (INSTITUTION_ADMIN/coordinator) can ever
 * reach this route, since `guardAdminUsersRoute` requires the real
 * STUDYUS_ADMIN role, which is never granted to a coordinator.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { listUsers, listPendingInvitations, type UserListFilters } from '@/services/user-admin.service';
import type { Role } from '@/lib/identity';

const VALID_ROLES: Role[] = ['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION_ADMIN', 'STUDYUS_ADMIN'];
const VALID_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;

export async function GET(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.users.list');
  if ('error' in guard) return guard.error;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  const roleParam = searchParams.get('role');
  const statusParam = searchParams.get('status');

  const filters: UserListFilters = {
    query: searchParams.get('query') || undefined,
    role: roleParam && (VALID_ROLES as string[]).includes(roleParam) ? (roleParam as Role) : undefined,
    status: statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as any) : undefined,
    workspace: searchParams.get('workspace') || undefined,
    isTest: searchParams.get('isTest') === 'true' ? true : searchParams.get('isTest') === 'false' ? false : undefined,
    institutionId: searchParams.get('institutionId') || undefined,
  };

  const includeInvitations = searchParams.get('includeInvitations') !== 'false' && page === 1;

  const [users, invitations] = await Promise.all([
    listUsers(filters, page, pageSize),
    includeInvitations ? listPendingInvitations(filters.query) : Promise.resolve([]),
  ]);

  return NextResponse.json({ success: true, data: { users: users.items, totalCount: users.totalCount, page, pageSize, pendingInvitations: invitations } });
}
