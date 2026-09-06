'use client';

/**
 * Phase 8 -- Step 8F1: "Tu plan" -- the canonical learner view of the
 * rolling 14-day `learning_plan`.
 *
 * This page NEVER generates a disconnected plan: there is no "generate 7
 * days" button and no daily-minutes slider that would fork a second
 * schedule. It reads the canonical plan via `GET /api/learning/plan`
 * (read-only) and offers exactly the sanctioned learner actions:
 *   - Preparar mi plan  -> explicit POST /api/learning/plan/rebuild
 *   - Empezar           -> POST /api/learning/plan/items/:id/launch
 *                          (8E revalidation, never a raw client URL)
 *   - Reprogramar       -> POST .../items/:id/reschedule (server-validated)
 *   - Omitir            -> POST .../items/:id/skip (server authorises)
 *   - Practicar otro    -> POST /api/learning/plan/extra-practice
 *   - Minutos al día    -> POST /api/learning/capacity (canonical writer)
 * plus a one-shot timezone capture (Intl -> POST /api/learning/timezone).
 *
 * The raw reason_code / source / priority / operation_key / policy
 * version / Transfer & Memory internals are never shown -- the server
 * hands back friendly i18n keys.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';
import { activityLabel } from '../activityLabel';
import type { ActivityType } from '@/lib/activity-taxonomy';

interface PlanItemView {
  id: string;
  conceptId: string | null;
  conceptLabel: string;
  subjectName: string;
  activityType: ActivityType;
  scheduledDate: string;
  timeWindow: string | null;
  estimatedMinutes: number;
  whyKey: string;
  statusKey: string;
  dayBucket: 'TODAY' | 'OVERDUE' | 'UPCOMING';
  canSkip: boolean;
}

interface ExtraOption {
  conceptId: string;
  conceptLabel: string;
  subjectName: string;
}

interface PlanView {
  hasPlan: boolean;
  horizonStart: string | null;
  horizonEnd: string | null;
  timezone: string | null;
  timezoneAssumed: boolean;
  capacityAssumed: boolean;
  items: PlanItemView[];
  extraPracticeOptions: ExtraOption[];
}

export default function StudyPlanPage() {
  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [view, setView] = useState<PlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<string | null>(null);
  const [extraConcept, setExtraConcept] = useState('');
  const [minutes, setMinutes] = useState(90);
  const tzCaptured = useRef(false);

  const t = getMessages(locale);

  const loadPlan = useCallback(async (sid: string) => {
    const res = await fetch(`/api/learning/plan?studentId=${sid}`);
    if (!res.ok) {
      setError(t['plan8.loadError']);
      setView(null);
      return;
    }
    const body = await res.json();
    setView(body.data as PlanView);
    setError(null);
  }, [t]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [meRes, langRes] = await Promise.all([fetch('/api/me'), fetch('/api/language')]);
        const me = await meRes.json();
        const lang = await langRes.json();
        if (lang.locale) setLocale(lang.locale);
        if (!me.studentId) return;
        setStudentId(me.studentId);

        // One-shot timezone capture -- the server is the IANA authority.
        if (!tzCaptured.current) {
          tzCaptured.current = true;
          try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (tz) {
              await fetch('/api/learning/timezone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: me.studentId, timezone: tz }),
              });
            }
          } catch {
            /* non-fatal -- planner falls back to an assumed zone */
          }
        }

        await loadPlan(me.studentId);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(url: string, payload: Record<string, unknown>, tag: string) {
    if (!studentId) return;
    setBusy(tag);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t['plan8.actionError']);
        return null;
      }
      return body.data ?? {};
    } finally {
      setBusy(null);
    }
  }

  async function prepare() {
    const data = await post('/api/learning/plan/rebuild', {}, 'prepare');
    if (data && studentId) await loadPlan(studentId);
  }

  async function start(item: PlanItemView) {
    const data = await post(`/api/learning/plan/items/${item.id}/launch`, {}, `start:${item.id}`);
    if (!data) return;
    if (data.launchTarget) {
      window.location.href = data.launchTarget as string;
      return;
    }
    if (studentId) await loadPlan(studentId); // COMPLETE_ALREADY / NO_LONGER_NEEDED -> item drops out
  }

  async function doReschedule(item: PlanItemView, date: string) {
    const data = await post(`/api/learning/plan/items/${item.id}/reschedule`, { date }, `resch:${item.id}`);
    setRescheduleFor(null);
    if (data && studentId) await loadPlan(studentId);
  }

  async function doSkip(item: PlanItemView) {
    if (!window.confirm(t['plan8.skipConfirm'])) return;
    const data = await post(`/api/learning/plan/items/${item.id}/skip`, {}, `skip:${item.id}`);
    if (data && studentId) await loadPlan(studentId);
  }

  async function addExtra() {
    if (!extraConcept) return;
    const data = await post('/api/learning/plan/extra-practice', { conceptId: extraConcept }, 'extra');
    setExtraConcept('');
    if (data && studentId) await loadPlan(studentId);
  }

  async function saveMinutes() {
    const data = await post('/api/learning/capacity', { maxDailyMinutes: minutes }, 'capacity');
    if (data && studentId) await loadPlan(studentId);
  }

  const grouped = useMemo(() => {
    const byDate = new Map<string, PlanItemView[]>();
    for (const it of view?.items ?? []) {
      const arr = byDate.get(it.scheduledDate) ?? [];
      arr.push(it);
      byDate.set(it.scheduledDate, arr);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [view]);

  if (loading) return <div className="card empty-state">{t['common.loading']}</div>;

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1>{t['plan8.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '62ch' }}>{t['plan8.subtitle']}</p>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 'var(--space-5)', borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          {error}
        </div>
      )}

      <div className="card" style={{ marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <label className="label" style={{ color: 'var(--text-muted)' }}>{t['plan8.capacityLabel']}</label>
        <input
          type="number"
          min={15}
          max={300}
          step={15}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          style={{ width: 80, height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14 }}
        />
        <button className="btn btn-secondary" disabled={busy === 'capacity'} onClick={saveMinutes}>
          {t['plan8.capacitySave']}
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled={busy === 'prepare'} onClick={prepare}>
          {busy === 'prepare' ? t['plan8.preparing'] : view?.hasPlan ? t['plan8.refresh'] : t['plan8.prepare']}
        </button>
      </div>

      {!view?.hasPlan ? (
        <div className="card empty-state">
          <strong>{t['plan8.emptyTitle']}</strong>
          {t['plan8.emptyBody']}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {grouped.map(([date, items]) => {
            const bucket = items[0].dayBucket;
            const heading =
              bucket === 'TODAY'
                ? t['plan8.today']
                : bucket === 'OVERDUE'
                  ? t['plan8.overdue']
                  : new Date(date).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' });
            return (
              <div key={date} className="card" style={{ padding: 'var(--space-5)' }}>
                <h3 style={{ margin: '0 0 var(--space-3)', textTransform: 'capitalize', color: bucket === 'OVERDUE' ? 'var(--warning)' : undefined }}>{heading}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {items.map((item) => (
                    <div key={item.id} style={{ borderLeft: '3px solid var(--brand)', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, minWidth: 160 }}>{item.conceptLabel}</span>
                        <span className="tabular" style={{ fontSize: 11, fontWeight: 650, color: 'var(--brand-ink)', background: 'var(--brand-subtle)', borderRadius: 'var(--radius-full)', padding: '2px 9px' }}>
                          {activityLabel(item.activityType, t)}
                        </span>
                        <span className="tabular" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                          {t['plan8.minutes'].replace('{min}', String(item.estimatedMinutes))}
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                        {item.subjectName ? `${item.subjectName} · ` : ''}
                        {t[item.whyKey as keyof typeof t]}
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button className="btn btn-primary btn-sm" disabled={busy === `start:${item.id}`} onClick={() => start(item)}>
                          {busy === `start:${item.id}` ? t['plan8.starting'] : t['plan8.start']}
                        </button>
                        {rescheduleFor === item.id ? (
                          <>
                            <input
                              type="date"
                              min={view.horizonStart ?? undefined}
                              max={view.horizonEnd ?? undefined}
                              defaultValue={item.scheduledDate}
                              onChange={(e) => e.target.value && doReschedule(item, e.target.value)}
                              style={{ height: 32, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', padding: '0 8px', fontFamily: 'inherit', fontSize: 13 }}
                            />
                            <button className="btn btn-ghost btn-sm" onClick={() => setRescheduleFor(null)}>
                              {t['plan8.rescheduleCancel']}
                            </button>
                          </>
                        ) : (
                          <button className="btn btn-secondary btn-sm" onClick={() => setRescheduleFor(item.id)}>
                            {t['plan8.reschedule']}
                          </button>
                        )}
                        {item.canSkip && (
                          <button className="btn btn-ghost btn-sm" disabled={busy === `skip:${item.id}`} onClick={() => doSkip(item)}>
                            {t['plan8.skip']}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <h3 style={{ margin: '0 0 var(--space-3)' }}>{t['plan8.extraPracticeTitle']}</h3>
            {view.extraPracticeOptions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>{t['plan8.extraPracticeNone']}</p>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={extraConcept}
                  onChange={(e) => setExtraConcept(e.target.value)}
                  style={{ height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', padding: '0 8px', fontFamily: 'inherit', fontSize: 14, minWidth: 220 }}
                >
                  <option value="">{t['plan8.extraPracticePlaceholder']}</option>
                  {view.extraPracticeOptions.map((o) => (
                    <option key={o.conceptId} value={o.conceptId}>
                      {o.conceptLabel}
                      {o.subjectName ? ` — ${o.subjectName}` : ''}
                    </option>
                  ))}
                </select>
                <button className="btn btn-secondary" disabled={!extraConcept || busy === 'extra'} onClick={addExtra}>
                  {t['plan8.extraPracticeAdd']}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
