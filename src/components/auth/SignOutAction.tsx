'use client';

/**
 * REM-T1-01 -- a visible "Sign out" control for every authenticated stage,
 * including the pre-product ones (role selection, Student context choice,
 * Academic Profile onboarding, first-use onboarding) where the dashboard
 * navigation (and its Clerk UserButton) is intentionally not shown.
 *
 * Uses Clerk's native sign-out: the session is ended server-side by Clerk and
 * the browser returns to the normal authentication flow (/sign-in).
 */
import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { LogOut } from 'lucide-react';

export default function SignOutAction({ label, className = 'btn btn-ghost', redirectUrl = '/sign-in' }: { label: string; className?: string; redirectUrl?: string }) {
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      data-testid="sign-out"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut({ redirectUrl });
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <LogOut size={16} strokeWidth={2} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
