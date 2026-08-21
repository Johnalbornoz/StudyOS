'use client';

import { useEffect, useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';

interface SubjectSummary {
  subjectId: string;
  name: string;
  avgMastery: number | null;
  conceptCount: number;
  activeDebtCount: number;
}

interface UpcomingExam {
  subjectId: string;
  subjectName?: string;
  scheduledDate: string;
  daysUntil: number;
  examReadiness: number | null;
}

interface ChildOverview {
  studentId: string;
  name: string;
  subjects: SubjectSummary[];
  totalActiveDebt: number;
  upcomingExams: UpcomingExam[];
}

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

export default function ParentPage() {
  const [locale, setLocale] = useState<Locale>('es');
  const [childEmail, setChildEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [children, setChildren] = useState<{ studentId: string; name: string; email: string }[]>([]);
  const [overviews, setOverviews] = useState<Record<string, ChildOverview>>({});
  const [loading, setLoading] = useState(true);

  const t = getMessages(locale);

  async function loadChildren() {
    const [langRes, childrenRes] = await Promise.all([
      fetch('/api/language'),
      fetch('/api/parent/children'),
    ]);
    const lang = await langRes.json();
    if (lang.locale) setLocale(lang.locale);
    const body = await childrenRes.json();
    const list = body.data?.children || [];
    setChildren(list);

    const entries = await Promise.all(
      list.map(async (c: any) => {
        const res = await fetch(`/api/parent/child-overview?studentId=${c.studentId}`);
        const overviewBody = await res.json();
        return [c.studentId, overviewBody.data] as const;
      })
    );
    setOverviews(Object.fromEntries(entries));
    setLoading(false);
  }

  useEffect(() => {
    loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function linkChild() {
    if (!childEmail.trim()) return;
    setLinking(true);
    setLinkError(null);
    try {
      const res = await fetch('/api/parent/link-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childEmail: childEmail.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setLinkError(body.error === 'NO_STUDENT_FOUND' ? t['parent.linkErrorNotFound'] : body.message || t['common.error']);
        return;
      }
      setChildEmail('');
      await loadChildren();
    } finally {
      setLinking(false);
    }
  }

  async function unlink(studentId: string) {
    await fetch('/api/parent/link-child', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId }),
    });
    await loadChildren();
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>{t['parent.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '62ch' }}>
          {t['parent.subtitle']}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-8)' }}>
        <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
          {t['parent.linkLabel']}
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <input
            type="email"
            value={childEmail}
            onChange={(e) => setChildEmail(e.target.value)}
            placeholder={t['parent.linkPlaceholder']}
            style={{
              flex: 1, height: 38, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
              padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14,
            }}
          />
          <button className="btn btn-primary" disabled={!childEmail.trim() || linking} onClick={linkChild}>
            {t['parent.linkButton']}
          </button>
        </div>
        {linkError && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{linkError}</p>}
      </div>

      {!loading && children.length === 0 && (
        <div className="card empty-state">
          <strong>{t['parent.noChildren']}</strong>
          {t['parent.noChildrenBody']}
        </div>
      )}

      {children.map((child) => {
        const overview = overviews[child.studentId];
        return (
          <div key={child.studentId} className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <h2 style={{ margin: 0 }}>{child.name}</h2>
              <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => unlink(child.studentId)}>
                {t['parent.unlink']}
              </button>
            </div>

            {overview && (
              <>
                <div style={{ display: 'flex', gap: 'var(--space-6)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
                  <div>
                    <div className="label" style={{ color: 'var(--text-muted)' }}>{t['parent.activeDebt']}</div>
                    <div className="tabular" style={{ fontSize: 22, fontWeight: 650 }}>{overview.totalActiveDebt}</div>
                  </div>
                  <div>
                    <div className="label" style={{ color: 'var(--text-muted)' }}>{t['parent.upcomingExam']}</div>
                    {overview.upcomingExams.length > 0 ? (
                      <div style={{ fontSize: 14 }}>
                        {overview.upcomingExams.slice(0, 1).map((e) => (
                          <span key={e.subjectId}>
                            {e.subjectName} — {e.scheduledDate} ({e.daysUntil}d)
                            {e.examReadiness !== null && (
                              <> · {t['parent.readiness']}: <strong>{Math.round(e.examReadiness)}%</strong></>
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{t['parent.noUpcomingExam']}</div>
                    )}
                  </div>
                </div>

                <p className="label" style={{ color: 'var(--text-muted)', marginBottom: 8 }}>{t['parent.subjects']}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {overview.subjects.map((s) => (
                    <div key={s.subjectId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '10px 0' }}>
                      <span style={{ flex: '0 0 160px', fontWeight: 600, fontSize: 14 }}>{s.name}</span>
                      <div className="mastery-row" style={{ flex: 1 }}>
                        <div className="mastery-bar">
                          <span className={masteryFillClass(s.avgMastery ?? 0)} style={{ width: `${s.avgMastery ?? 0}%` }} />
                        </div>
                        <span className="mastery-pct tabular">{s.avgMastery !== null ? `${s.avgMastery}%` : '—'}</span>
                      </div>
                      <span style={{ fontSize: 12.5, color: s.activeDebtCount > 0 ? 'var(--error)' : 'var(--text-muted)', flexShrink: 0 }}>
                        {s.conceptCount} {t['parent.concepts']}
                        {s.activeDebtCount > 0 && ` (${s.activeDebtCount})`}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
