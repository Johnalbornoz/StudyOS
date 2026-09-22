import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';

/**
 * Fase 2A -- the destination for a SUSPENDED or ARCHIVED account,
 * redirected here by `src/app/dashboard/layout.tsx` before any
 * workspace/role resolution. Deliberately outside `/dashboard` so it
 * can never itself trigger the same redirect (no loop). Renders
 * unconditionally for an authenticated caller whose account is not
 * ACTIVE; an ACTIVE account that lands here directly is sent back to
 * `/dashboard` rather than shown a confusing suspended message it
 * doesn't apply to.
 */
export default async function AccountSuspendedPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
  const canonicalUser = await getOrCreateCanonicalUser(clerkUserId, email);

  if (canonicalUser.status === 'ACTIVE') redirect('/dashboard');

  const message =
    canonicalUser.status === 'SUSPENDED'
      ? 'Tu cuenta ha sido suspendida temporalmente. Tus datos se conservan. Si crees que esto es un error, contacta a soporte.'
      : 'Esta cuenta ha sido archivada. Tus datos se conservan. Si crees que esto es un error, contacta a soporte.';

  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: 20, marginBottom: 'var(--space-3)' }}>Acceso no disponible</h1>
      <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
    </div>
  );
}
