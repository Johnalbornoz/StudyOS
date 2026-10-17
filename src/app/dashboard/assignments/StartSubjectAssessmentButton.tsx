'use client';

/**
 * Overnight 2026-10-16 -- Start / Continue / New attempt of a teacher-assigned subject Test / Mock. POSTs to the
 * owner-only attempts route (which decides: resume the active attempt, or generate the next one while the window is
 * open and attempts remain) and opens the subject assessment runner on the returned attempt. Decides nothing itself.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n/messages';
import { AccessRequiredNotice } from '@/components/ui/AccessRequiredNotice';
import { isEntitlementRequired } from '@/lib/lx/access-required';

export function StartSubjectAssessmentButton({ interventionId, label, labels, locale }: { interventionId: string; label: string; labels: { starting: string; error: string }; locale: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessRequired, setAccessRequired] = useState(false);

  async function onStart() {
    setBusy(true);
    setError(null);
    setAccessRequired(false);
    try {
      const res = await fetch(`/api/student/subject-assessment-assignments/${interventionId}/attempts`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (isEntitlementRequired(res.status, body)) { setAccessRequired(true); return; }
      if (!res.ok || !body?.data?.quizId) { setError(labels.error); router.refresh(); return; }
      const { quizId, subjectId, quizMode } = body.data;
      router.push(`/dashboard/quiz?subjectId=${encodeURIComponent(subjectId)}&mode=${quizMode}&subjectSessionId=${encodeURIComponent(quizId)}`);
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onStart}>{busy ? labels.starting : label}</button>
      {accessRequired && <AccessRequiredNotice locale={locale} />}
      {error && <p role="alert" style={{ fontSize: 12.5, color: 'var(--error)', margin: 0 }}>{error}</p>}
    </div>
  );
}
