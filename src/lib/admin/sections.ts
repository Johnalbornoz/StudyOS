/**
 * Platform Administration sections -- the single list both the admin
 * console's own sub-navigation (`AdminSubNav`) and the shell's Admin
 * workspace navigation render, so the two can never drift apart.
 * Labels are Spanish-only, matching the rest of the admin console.
 */
export type AdminSection = 'overview' | 'users' | 'invitations' | 'requests' | 'institutions' | 'memberships' | 'test-accounts' | 'audit';

export const ADMIN_HOME = '/dashboard/admin/overview';

export const ADMIN_SECTIONS: ReadonlyArray<{ key: AdminSection; href: string; label: string }> = [
  { key: 'overview', href: ADMIN_HOME, label: 'Resumen' },
  { key: 'users', href: '/dashboard/admin/users', label: 'Usuarios' },
  { key: 'invitations', href: '/dashboard/admin/invitations', label: 'Invitaciones' },
  { key: 'requests', href: '/dashboard/admin/requests', label: 'Solicitudes pendientes' },
  { key: 'institutions', href: '/dashboard/admin/institutions', label: 'Instituciones' },
  { key: 'memberships', href: '/dashboard/admin/memberships', label: 'Membresías y pagos' },
  { key: 'test-accounts', href: '/dashboard/admin/test-accounts', label: 'Cuentas de prueba' },
  { key: 'audit', href: '/dashboard/admin/audit', label: 'Auditoría' },
];
