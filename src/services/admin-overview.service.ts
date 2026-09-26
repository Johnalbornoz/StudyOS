/**
 * Professional Admin Console -- Resumen. Every figure is a real,
 * server-computed COUNT against the same tables every other admin
 * function already reads -- never a client-side derived or cached
 * number.
 */
import { db } from '@/lib/db';

export interface AdminOverview {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  archivedUsers: number;
  students: number;
  parents: number;
  teachers: number;
  institutionAdmins: number;
  testAccounts: number;
  pendingInvitations: number;
  pendingTeacherRequests: number;
  syncInconsistencies: number;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [
    userStatus,
    roleCounts,
    testAccounts,
    pendingTeacherRequests,
  ] = await Promise.all([
    // Technical identities (`is_system`) are not people -- excluded from every human count.
    db.query(`SELECT status, COUNT(*)::int AS c FROM users WHERE NOT is_system GROUP BY status`),
    db.query(`SELECT ur.role, COUNT(*)::int AS c FROM user_roles ur JOIN users u ON u.id = ur.user_id
              WHERE ur.status = 'ACTIVE' AND NOT u.is_system GROUP BY ur.role`),
    db.query(`SELECT COUNT(*)::int AS c FROM users WHERE is_test = true AND NOT is_system`),
    db.query(`SELECT COUNT(*)::int AS c FROM institution_memberships WHERE membership_role = 'TEACHER' AND status = 'PENDING'`),
  ]);

  const statusMap: Record<string, number> = {};
  for (const row of userStatus.rows) statusMap[row.status] = row.c;

  const roleMap: Record<string, number> = {};
  for (const row of roleCounts.rows) roleMap[row.role] = row.c;

  const totalUsers = Object.values(statusMap).reduce((a, b) => a + b, 0);

  return {
    totalUsers,
    activeUsers: statusMap.ACTIVE ?? 0,
    suspendedUsers: statusMap.SUSPENDED ?? 0,
    archivedUsers: statusMap.ARCHIVED ?? 0,
    students: roleMap.STUDENT ?? 0,
    parents: roleMap.PARENT ?? 0,
    teachers: roleMap.TEACHER ?? 0,
    institutionAdmins: roleMap.INSTITUTION_ADMIN ?? 0,
    testAccounts: testAccounts.rows[0]?.c ?? 0,
    // Pending Clerk invitations are intentionally NOT counted here --
    // they require a live Clerk API call (see listPendingInvitations
    // in user-admin.service.ts); the UI fetches that count separately
    // rather than making this read-only summary depend on Clerk being
    // reachable.
    pendingInvitations: 0,
    pendingTeacherRequests: pendingTeacherRequests.rows[0]?.c ?? 0,
    syncInconsistencies: 0,
  };
}
