'use client';

import { useEffect, useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';

interface PlanItem {
  conceptId: string;
  canonicalId: string;
  label: string;
  activityType: 'review' | 'practice' | 'quiz' | 'deep_dive';
  estimatedMinutes: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

interface PlanSession {
  date: string;
  totalMinutes: number;
  items: PlanItem[];
  subjectBreakdown: { subjectId: string; subjectName: string; minutes: number; conceptCount: number }[];
}

interface Plan {
  startDate: string;
  endDate: string;
  sessions: PlanSession[];
  totalStudyMinutes: number;
  subjectsInPlan: string[];
  criticalConceptsCount: number;
}

const PRIORITY_COLOR: Record<PlanItem['priority'], string> = {
  CRITICAL: 'var(--error)',
  HIGH: 'var(--warning)',
  MEDIUM: 'var(--brand)',
  LOW: 'var(--text-muted)',
};

export default function StudyPlanPage() {
  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dailyMinutes, setDailyMinutes] = useState(90);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const t = getMessages(locale);

  async function load() {
    setLoading(true);
    try {
      const [meRes, langRes] = await Promise.all([fetch('/api/me'), fetch('/api/language')]);
      const me = await meRes.json();
      const lang = await langRes.json();
      if (lang.locale) setLocale(lang.locale);
      if (!me.studentId) return;
      setStudentId(me.studentId);

      const planRes = await fetch(`/api/study-plan/generate?studentId=${me.studentId}`);
      const planBody = await planRes.json();
      setPlan(planBody.data?.plan || null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function generate() {
    if (!studentId) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/study-plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, daysAhead: 7, dailyMinutes }),
      });
      const body = await res.json();
      setPlan(body.data?.plan || null);
    } finally {
      setGenerating(false);
    }
  }

  const activityLabel = (a: PlanItem['activityType']) => t[`study.activity.${a}` as keyof typeof t];
  const priorityLabel = (p: PlanItem['priority']) => t[`study.priority.${p}` as keyof typeof t];

  if (loading) return <div className="card empty-state">{t['common.loading']}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
        <div>
          <h1>{t['study.title']}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '62ch' }}>
            {t['study.subtitle']}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-8)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <label className="label" style={{ color: 'var(--text-muted)' }}>{t['study.dailyMinutesLabel']}</label>
        <input
          type="number"
          min={30}
          max={240}
          step={15}
          value={dailyMinutes}
          onChange={(e) => setDailyMinutes(Number(e.target.value))}
          style={{
            width: 80, height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
            padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14,
          }}
        />
        <button className="btn btn-primary" disabled={generating} onClick={generate}>
          {generating ? t['study.generating'] : plan ? t['study.regenerate'] : t['study.generate']}
        </button>
      </div>

      {!plan ? (
        <div className="card empty-state">
          <strong>{t['study.noPlan']}</strong>
          {t['study.noPlanBody']}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {plan.sessions.map((session) => {
            const dateFormatted = new Date(session.date).toLocaleDateString(locale, {
              weekday: 'long', day: 'numeric', month: 'short',
            });
            return (
              <div key={session.date} className="card" style={{ padding: 'var(--space-5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
                  <h3 style={{ margin: 0, textTransform: 'capitalize' }}>{dateFormatted}</h3>
                  <span className="tabular" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {session.totalMinutes} {t['study.minutesTotal']}
                  </span>
                </div>
                {session.items.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>—</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {session.items.map((item, i) => (
                      <div
                        key={`${item.conceptId}-${i}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                          padding: '8px 0', borderLeft: `3px solid ${PRIORITY_COLOR[item.priority]}`, paddingLeft: 10,
                        }}
                      >
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{item.label}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{activityLabel(item.activityType)}</span>
                        <span
                          style={{
                            fontSize: 11, fontWeight: 650, color: PRIORITY_COLOR[item.priority],
                            textTransform: 'uppercase', letterSpacing: '0.03em',
                          }}
                        >
                          {priorityLabel(item.priority)}
                        </span>
                        <span className="tabular" style={{ fontSize: 12.5, color: 'var(--text-muted)', width: 44, textAlign: 'right' }}>
                          {item.estimatedMinutes}m
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
