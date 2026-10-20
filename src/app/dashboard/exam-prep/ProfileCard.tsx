'use client';

/**
 * Exam Prep dashboard -- one preparation card: what it is (server-rendered),
 * "Ver preparación" / "Continuar", and the "⋯" menu. Removing it hides the
 * card at once (the server list no longer includes it after refresh).
 */
import { useState, type ReactNode } from 'react';
import { ProfileMenu } from './ProfileMenu';

export function ProfileCard({ info, primary, profileId, examName, hasInProgress, labels }: { info: ReactNode; primary: ReactNode; profileId: string; examName: string; hasInProgress: boolean; labels: Record<string, string> }) {
  const [removed, setRemoved] = useState(false);
  if (removed) return null;
  return (
    <li className="card ex-card">
      <div>{info}</div>
      <div className="ex-card-actions">
        {primary}
        <ProfileMenu profileId={profileId} examName={examName} hasInProgress={hasInProgress} labels={labels} afterRemove="stay" onRemoved={() => setRemoved(true)} />
      </div>
    </li>
  );
}
