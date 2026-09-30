'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { matchConcepts, isSameConcept, type FinderConcept } from '@/lib/experience/concept-finder';

/**
 * UX-5 closure -- "¿Qué quieres aprender?" inside a subject.
 *
 * 1. What the Student types is resolved against the concepts that ALREADY
 *    exist (this subject first, then their other subjects) -- a match
 *    links to that concept; nothing is created.
 * 2. Only when nothing existing fits does it offer proposals (the existing
 *    /api/concepts/suggest), each behind an explicit "Añadir a {materia}"
 *    action that uses the existing concept-creation flow. A proposal that
 *    equals an existing concept is never offered as new.
 */
export default function ConceptFinder({
  studentId,
  subjectId,
  subjectName,
  locale,
  concepts,
  autoFocus = false,
}: {
  studentId: string;
  subjectId: string;
  subjectName: string;
  locale: Locale;
  /** Every concept the Student already has (all subjects). */
  concepts: FinderConcept[];
  autoFocus?: boolean;
}) {
  const t = getMessages(locale);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [proposals, setProposals] = useState<string[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const seq = useRef(0);
  const inFlight = useRef(false);

  const matches = useMemo(() => matchConcepts(q, concepts, subjectId).slice(0, 6), [q, concepts, subjectId]);
  const wantsProposals = q.trim().length >= 3 && matches.length < 2;

  useEffect(() => {
    if (!wantsProposals) {
      setProposals([]);
      setLoadingProposals(false);
      return;
    }
    const id = ++seq.current;
    setLoadingProposals(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/concepts/suggest?studentId=${studentId}&subjectId=${subjectId}&partial=${encodeURIComponent(q.trim())}&language=${locale}`,
        );
        const body = await res.json().catch(() => null);
        if (id !== seq.current) return;
        const list: string[] = res.ok && Array.isArray(body?.data?.suggestions) ? body.data.suggestions : [];
        // never propose as "new" something the Student already has
        setProposals(list.filter((p) => typeof p === 'string' && p.trim() && !concepts.some((c) => isSameConcept(c.title, p))).slice(0, 4));
      } catch {
        if (id === seq.current) setProposals([]);
      } finally {
        if (id === seq.current) setLoadingProposals(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [q, wantsProposals, studentId, subjectId, locale, concepts]);

  async function add(label: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setAdding(label);
    setError(false);
    try {
      const res = await fetch('/api/concepts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, subjectId, label: label.trim(), language: locale }),
      });
      const body = await res.json().catch(() => null);
      const conceptId = body?.data?.conceptId;
      if (!res.ok || !conceptId) throw new Error('create failed');
      // The concept's mission page carries the canonical Start.
      router.push(`/dashboard/subjects/${subjectId}/concepts/${conceptId}`);
    } catch {
      setError(true);
      setAdding(null);
      inFlight.current = false;
    }
  }

  return (
    <div className="cf">
      <label className="cf-search">
        <span className="sr-only">{t['cf.label'].replace('{subject}', subjectName)}</span>
        <Search size={18} strokeWidth={2} aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t['cf.placeholder']}
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={!!adding}
          aria-describedby="cf-hint"
        />
      </label>
      <p id="cf-hint" className="cf-hint">{t['cf.hint']}</p>

      {matches.length > 0 && (
        <section aria-labelledby="cf-existing">
          <h3 id="cf-existing" className="cf-heading">{t['cf.existing']}</h3>
          <ul className="cf-list">
            {matches.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard/subjects/${c.subjectId}/concepts/${c.id}`} className="cf-item">
                  <span className="cf-item-title">{c.title}</span>
                  <span className="cf-item-meta">{[c.subjectName, c.topic].filter(Boolean).join(' › ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {wantsProposals && (
        <section aria-labelledby="cf-new" aria-busy={loadingProposals || undefined}>
          <h3 id="cf-new" className="cf-heading">{t['cf.proposals'].replace('{subject}', subjectName)}</h3>
          {loadingProposals ? (
            <p className="cf-hint" role="status">{t['cf.searching']}</p>
          ) : proposals.length === 0 ? (
            <p className="cf-hint">{t['cf.noProposals']}</p>
          ) : (
            <ul className="cf-list">
              {proposals.map((p) => (
                <li key={p}>
                  <button type="button" className="cf-item cf-item--new" onClick={() => add(p)} disabled={!!adding}>
                    <span className="cf-item-title">{p}</span>
                    <span className="cf-add">
                      <Plus size={16} strokeWidth={2} aria-hidden />
                      {t['cf.addTo'].replace('{subject}', subjectName)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {adding && <p className="cf-hint" role="status">{t['cf.adding'].replace('{concept}', adding)}</p>}
      {error && <p className="sp-error" role="alert">{t['cf.error']}</p>}
    </div>
  );
}
