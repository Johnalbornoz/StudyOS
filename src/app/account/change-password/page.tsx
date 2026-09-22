import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import ChangePasswordForm from './ChangePasswordForm';

/**
 * Destino obligatorio para una cuenta creada por un STUDYUS_ADMIN con
 * contraseña temporal (`users.password_change_required`), verificado
 * server-side en `dashboard/layout.tsx` antes de cualquier resolución
 * de workspace/rol. Deliberadamente fuera de `/dashboard`, igual que
 * `/account-suspended`, para que esta misma página nunca dispare su
 * propio redirect (sin loop). Una cuenta que ya cambió su contraseña
 * y llega aquí directamente se envía de vuelta a `/dashboard`.
 */
export default async function ChangePasswordPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
  const canonicalUser = await getOrCreateCanonicalUser(clerkUserId, email);

  // Defensa en profundidad: una cuenta SUSPENDED/ARCHIVED que navegue
  // aquí directamente (sin pasar por dashboard/layout.tsx) sigue
  // bloqueada -- nunca puede completar el cambio y "colarse" al
  // dashboard por esta puerta.
  if (canonicalUser.status !== 'ACTIVE') redirect('/account-suspended');

  if (!canonicalUser.passwordChangeRequired) redirect('/dashboard');

  return (
    <div style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: 20, marginBottom: 'var(--space-2)' }}>Debes establecer una contraseña propia</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 'var(--space-4)' }}>
        Un administrador creó tu cuenta con una contraseña temporal. Por seguridad, debes reemplazarla antes de continuar. No podrás usar StudyUS hasta completar este paso.
      </p>
      <ChangePasswordForm />
    </div>
  );
}
