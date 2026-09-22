'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    await fetch(`/api/admin/users/invitations/${invitationId}/revoke`, { method: 'POST' });
    setBusy(false);
    router.refresh();
  }

  return <button className="btn btn-ghost" disabled={busy} onClick={revoke}>Revocar</button>;
}
