'use client';

/**
 * Track A (A2) -- Parent workspace.
 *
 * Reads ONLY through the F10 Parent Read Model routes
 * (/api/parent/learners/**), each of which re-validates an ACCEPTED
 * relationship server-side (`isActiveParentOf`) on every request -- the
 * child id in the URL (?child=) is selection context, never a grant.
 * Before acceptance there is nothing to show: pending requests are never
 * listed with the child's identity (no account-existence oracle).
 *
 * Read-only by construction: no control here answers, submits evidence,
 * or changes anything for the learner. Parent access needs no paid
 * license (the read model never consults entitlements).
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getMessages, type Locale, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { StatusBadge, toneForDimensionStatus } from '@/components/ui/StatusBadge';
import { QUANTITY_FILL_CLASS } from '@/lib/experience/progress-tone';

interface Learner {
  studentId: string;
  name: string;
}
interface Overview {
  name: string;
  subjectCount: number;
  conceptsWithEvidence: number;
  areasNeedingAttentionCount: number;
  latestReadinessStatus: string;
  lastActivityAt: string | null;
}
interface SubjectProgress {
  subjectId: string;
  name: string;
  totalConcepts: number;
  conceptsWithQualifyingEvidence: number;
  activeAreasNeedingAttention: number;
}
interface ActivityItem {
  kind: 'practice' | 'simulation';
  occurredAt: string;
}
interface AttentionArea {
  category: string;
}
interface ExamPrep {
  examName: string;
  examDate: string | null;
  dimensions: Array<{ dimension: string; status: string }>;
}
interface ReceivedInvitation {
  id: string;
  studentName: string;
}
interface ChildData {
  overview: Overview | null;
  subjects: SubjectProgress[];
  activity: ActivityItem[];
  attention: AttentionArea[];
  examPrep: ExamPrep | null;
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default function ParentPageRoute() {
  return (
    <Suspense fallback={null}>
      <ParentPage />
    </Suspense>
  );
}

function ParentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [locale, setLocale] = useState<Locale>('es');
  const [learners, setLearners] = useState<Learner[] | null>(null);
  const [invitations, setInvitations] = useState<ReceivedInvitation[]>([]);
  const [child, setChild] = useState<ChildData | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const t = getMessages(locale);

  const selectedId = useMemo(() => {
    const requested = searchParams.get('child');
    if (!learners || learners.length === 0) return null;
    return learners.some((l) => l.studentId === requested) ? requested : learners[0].studentId;
  }, [learners, searchParams]);

  const loadLists = useCallback(async () => {
    const [lang, list, inv] = await Promise.all([getJson('/api/language'), getJson('/api/parent/learners'), getJson('/api/parent/invitations')]);
    if (lang?.locale) setLocale(lang.locale);
    setLearners(list?.data?.learners ?? []);
    setInvitations(inv?.data?.invitations ?? []);
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (!selectedId) {
      setChild(null);
      return;
    }
    let cancelled = false;
    setChild(null);
    const base = `/api/parent/learners/${selectedId}`;
    Promise.all([getJson(`${base}/overview`), getJson(`${base}/subjects`), getJson(`${base}/activity`), getJson(`${base}/attention`), getJson(`${base}/exam-prep`)]).then(
      ([o, s, a, at, e]) => {
        if (cancelled) return;
        setChild({
          overview: o?.data ?? null,
          subjects: s?.data?.subjects ?? [],
          activity: (a?.data?.activity ?? []).slice(0, 8),
          attention: at?.data?.areas ?? [],
          examPrep: e?.data ?? null,
        });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function sendRequest() {
    if (!email.trim()) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/parent/child-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (res.status === 429) setMessage({ text: t['parentHome.addChild.tooMany'], error: true });
    else if (!res.ok) setMessage({ text: t['account.error.generic'], error: true });
    else {
      setEmail('');
      setMessage({ text: t['parentHome.addChild.sent'] });
    }
    setBusy(false);
  }

  async function respondInvitation(id: string, decision: 'accept' | 'decline') {
    setBusy(true);
    const res = await fetch(`/api/parent/invitations/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) setMessage({ text: t['account.error.generic'], error: true });
    await loadLists();
    setBusy(false);
  }

  async function unlink(learner: Learner) {
    if (!window.confirm(fillMessage(t['parentHome.unlinkConfirm'], { name: learner.name }))) return;
    setBusy(true);
    await fetch('/api/parent/link-child', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: learner.studentId }),
    });
    router.replace('/dashboard/parent');
    await loadLists();
    setBusy(false);
  }

  const selected = learners?.find((l) => l.studentId === selectedId) ?? null;
  const attentionCategories = child ? [...new Set(child.attention.map((a) => a.category))] : [];

  return (
    <div className="ta-stack">
      <header>
        <h1>{t['parentHome.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '62ch' }}>{t['parentHome.subtitle']}</p>
      </header>

      {invitations.length > 0 && (
        <section className="card list-card" aria-labelledby="received-invitations">
          <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
            <h2 id="received-invitations" style={{ fontSize: 15 }}>{t['parentHome.invitations.title']}</h2>
          </div>
          {invitations.map((inv) => (
            <div key={inv.id} className="list-row" style={{ flexWrap: 'wrap' }}>
              <div className="row-main" style={{ flexBasis: 220 }}>
                <div className="row-title">{fillMessage(t['parentHome.invitations.body'], { name: inv.studentName })}</div>
              </div>
              <div className="ta-actions">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => respondInvitation(inv.id, 'decline')}>
                  {t['parent.decline']}
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => respondInvitation(inv.id, 'accept')}>
                  {t['parent.accept']}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {learners && learners.length > 1 && (
        <nav aria-label={t['parentHome.childSwitcher']} className="ta-switcher">
          {learners.map((l) => (
            <button
              key={l.studentId}
              type="button"
              className={l.studentId === selectedId ? 'btn btn-primary' : 'btn btn-secondary'}
              aria-pressed={l.studentId === selectedId}
              onClick={() => router.replace(`/dashboard/parent?child=${l.studentId}`)}
            >
              {l.name}
            </button>
          ))}
        </nav>
      )}

      {learners === null ? (
        <p className="ta-msg">{t['common.loading']}</p>
      ) : learners.length === 0 ? (
        <div className="card empty-state">
          <strong>{t['parentHome.empty.title']}</strong>
          {t['parentHome.empty.body']}
        </div>
      ) : (
        selected && (
          <section aria-labelledby="child-name" className="ta-stack">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 id="child-name" style={{ fontSize: 22 }}>
                {selected.name} <span className="chip">{t['parentHome.readOnly']}</span>
              </h2>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => unlink(selected)}>
                {t['parentHome.unlink']}
              </button>
            </div>

            {!child ? (
              <p className="ta-msg">{t['common.loading']}</p>
            ) : (
              <>
                {child.overview && (
                  <div className="ta-grid">
                    <div className="card ta-metric">
                      <span className="ta-metric-label">{t['parentHome.overview.subjects']}</span>
                      <span className="ta-metric-value">{child.overview.subjectCount}</span>
                    </div>
                    <div className="card ta-metric">
                      <span className="ta-metric-label">{t['parentHome.overview.concepts']}</span>
                      <span className="ta-metric-value">{child.overview.conceptsWithEvidence}</span>
                    </div>
                    <div className="card ta-metric">
                      <span className="ta-metric-label">{t['parentHome.overview.attention']}</span>
                      <span className="ta-metric-value">{child.overview.areasNeedingAttentionCount}</span>
                    </div>
                    <div className="card ta-metric">
                      <span className="ta-metric-label">{t['parentHome.overview.lastActivity']}</span>
                      <span className="ta-metric-text">
                        {child.overview.lastActivityAt ? new Date(child.overview.lastActivityAt).toLocaleDateString(locale) : t['parentHome.overview.never']}
                      </span>
                    </div>
                    <div className="card ta-metric">
                      <span className="ta-metric-label">{t['parentHome.overview.readiness']}</span>
                      <span className="ta-metric-text">
                        {t[`readiness.overall.${child.overview.latestReadinessStatus}` as MessageKey] ?? t['readiness.overall.NO_ACTIVE_EXAM_PROFILE']}
                      </span>
                    </div>
                  </div>
                )}

                <section className="card ta-card" aria-labelledby="subjects-title">
                  <h3 id="subjects-title">{t['parentHome.subjectsTitle']}</h3>
                  {child.subjects.length === 0 ? (
                    <p className="ta-msg">{t['parentHome.subjectsEmpty']}</p>
                  ) : (
                    <ul className="role-list">
                      {child.subjects.map((s) => {
                        const pct = s.totalConcepts > 0 ? Math.round((s.conceptsWithQualifyingEvidence / s.totalConcepts) * 100) : 0;
                        return (
                          <li key={s.subjectId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: 14 }}>{s.name}</strong>
                              <span className="ta-msg">
                                {fillMessage(t['parentHome.subjectRow'], { done: s.conceptsWithQualifyingEvidence, total: s.totalConcepts })}
                              </span>
                            </div>
                            <div
                              className="mastery-bar"
                              style={{ flex: 'none', width: '100%' }}
                              role="progressbar"
                              aria-label={s.name}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={pct}
                            >
                              <span className={QUANTITY_FILL_CLASS} style={{ width: `${pct}%` }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section className="card ta-card" aria-labelledby="attention-title">
                  <h3 id="attention-title">{t['parentHome.attentionTitle']}</h3>
                  {attentionCategories.length === 0 ? (
                    <p className="ta-msg">{t['parentHome.attention.empty']}</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {attentionCategories.map((c) => (
                        <li key={c} className="ta-msg" style={{ color: 'var(--text-primary)' }}>
                          {t[`parentHome.attention.${c}` as MessageKey] ?? c}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="card ta-card" aria-labelledby="exam-title">
                  <h3 id="exam-title">{t['parentHome.examTitle']}</h3>
                  {!child.examPrep ? (
                    <p className="ta-msg">{t['parentHome.examNone']}</p>
                  ) : (
                    <>
                      <p className="ta-msg" style={{ color: 'var(--text-primary)' }}>
                        <strong>{child.examPrep.examName}</strong>
                        {child.examPrep.examDate ? ` · ${t['parentHome.examDate']}: ${new Date(child.examPrep.examDate).toLocaleDateString(locale)}` : ''}
                      </p>
                      <div className="ta-actions">
                        {child.examPrep.dimensions.map((d) => (
                          <StatusBadge key={d.dimension} label={t[`readiness.dimension.${d.dimension}` as MessageKey] ?? d.dimension} tone={toneForDimensionStatus(d.status)} />
                        ))}
                      </div>
                    </>
                  )}
                </section>

                <section className="card ta-card" aria-labelledby="activity-title">
                  <h3 id="activity-title">{t['parentHome.activityTitle']}</h3>
                  {child.activity.length === 0 ? (
                    <p className="ta-msg">{t['parentHome.activity.empty']}</p>
                  ) : (
                    <ul className="role-list">
                      {child.activity.map((a, i) => (
                        <li key={`${a.occurredAt}-${i}`} className="ta-msg" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                          <span style={{ color: 'var(--text-primary)' }}>
                            {a.kind === 'simulation' ? t['parentHome.activity.simulation'] : t['parentHome.activity.practice']}
                          </span>
                          <span>{new Date(a.occurredAt).toLocaleString(locale)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </section>
        )
      )}

      <section className="card ta-card" aria-labelledby="add-child">
        <h2 id="add-child">{t['parentHome.addChild.title']}</h2>
        <p className="ta-msg">{t['parentHome.addChild.body']}</p>
        <form
          className="ta-form"
          onSubmit={(e) => {
            e.preventDefault();
            sendRequest();
          }}
        >
          <label htmlFor="child-email">{t['parentHome.addChild.label']}</label>
          <div className="ta-row">
            <input id="child-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
              {t['parentHome.addChild.submit']}
            </button>
          </div>
        </form>
        {message && (
          <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
            {message.text}
          </p>
        )}
      </section>
    </div>
  );
}
