/** Masks an email for admin surfaces: first two characters of the local part, domain kept. */
export function maskEmail(email: string | null): string {
  if (!email) return '(sin correo)';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}
