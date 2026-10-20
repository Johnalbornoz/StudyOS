'use client';

/**
 * The Student's own scheduled exams of this Subject: when, how many concepts, start, cancel.
 * Any number may be listed. Starting one opens the assessment setup naming the schedule; what it assesses is
 * read from the schedule on the server. This component decides nothing about questions.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/messages';
import { getAdHocExamMessages } from '@/lib/i18n/ad-hoc-exam-messages';
import { AD_HOC_SCHEDULED_EVENT, scheduledAdHocExamHref } from '@/lib/assessment-experience/ad-hoc-exam';

interface Schedule {
  id: string;
  conceptIds: string[];
  scopeIntact: boolean;
  depth: 'QUICK' | 'BALANCED' | 'DEEP';
  availableMinutes: number | null;
  difficultyBand: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  scheduledAt: string;
  status: 'SCHEDULED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
  quizSessionId: string | null;
}

export default function ScheduledExams({ subjectId, locale }: { subjectId: string; locale: Locale }) {
  const m = getAdHocExamMessages(locale);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // re-read the clock so an exam becomes startable when its moment arrives (the server decides either way)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/assessments/ad-hoc/schedules?subjectId=${encodeURIComponent(subjectId)}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.success && Array.isArray(body.data?.schedules)) setSchedules(body.data.schedules);
    } catch {
      /* the list is a convenience: the Subject page works without it */
    }
  }, [subjectId]);

  useEffect(() => {
    load();
    window.addEventListener(AD_HOC_SCHEDULED_EVENT, load);
    return () => window.removeEventListener(AD_HOC_SCHEDULED_EVENT, load);
  }, [load]);

  async function cancel(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/assessments/ad-hoc/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } finally {
      setBusy(null);
      load();
    }
  }

  if (schedules.length === 0) return null;
  // the Student's own clock and zone: the moment is shown where they are now
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="card" aria-labelledby="scheduled-exams-title" style={{ marginBottom: 'var(--space-6)' }} data-scheduled-exams>
      <h2 id="scheduled-exams-title" style={{ fontSize: 17, margin: 0 }}>{m['adhoc.scheduledTitle']}</h2>
      <ul style={{ listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {schedules.map((s) => (
          <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }} data-schedule-status={s.status}>
            <div>
              <div className="tabular" style={{ fontWeight: 600, fontSize: 14 }}>{when.format(new Date(s.scheduledAt))}</div>
              <div className="tabular" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {s.conceptIds.length} {m['adhoc.selected']} · {m[`adhoc.size.${s.depth}`]}{s.availableMinutes ? ` · ${s.availableMinutes} ${m['adhoc.minutes']}` : ''}{s.difficultyBand ? ` · ${m['adhoc.difficultyLabel']}: ${m[`adhoc.difficulty.${s.difficultyBand}`]}` : ''}
              </div>
              {!s.scopeIntact && <div role="status" style={{ color: 'var(--error)', fontSize: 13 }}>{m['adhoc.scopeChanged']}</div>}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {s.status === 'STARTED' && s.quizSessionId && <Link href={`/dashboard/assessment/${encodeURIComponent(s.quizSessionId)}`} className="btn btn-primary">{m['adhoc.continueScheduled']}</Link>}
              {s.status === 'SCHEDULED' && s.scopeIntact && now >= new Date(s.scheduledAt).getTime() && <Link href={scheduledAdHocExamHref(s.id)} className="btn btn-primary">{m['adhoc.startScheduled']}</Link>}
              {s.status === 'SCHEDULED' && s.scopeIntact && now < new Date(s.scheduledAt).getTime() && <span className="tabular" style={{ color: 'var(--text-muted)', fontSize: 13, alignSelf: 'center' }} data-schedule-due="false">{m['adhoc.notDueShort']}</span>}
              {s.status === 'SCHEDULED' && <button type="button" className="btn btn-ghost" disabled={busy === s.id} onClick={() => cancel(s.id)}>{m['adhoc.cancelScheduled']}</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
