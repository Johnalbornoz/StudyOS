'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { SUBJECT_CATALOG, catalogSubject, catalogSubjectByName, normalizeName, type SubjectSuggestion } from '@/lib/experience/subject-catalog';
import { localizeSubjectName } from '@/lib/i18n/catalog-labels';
import { localizeCatalogSubjectName } from '@/lib/exam-core/catalog/subject-localization';
import { ACADEMIC_PROFILE_MESSAGES } from '@/lib/i18n/academic-profile-messages';

/**
 * UX-5 closure -- "¿Qué quieres aprender?". The Student SELECTS a subject
 * from the controlled list (profile-based suggestions first, the full list
 * under "Ver todas"); there is no free-text subject. The server resolves
 * the stored name / IB group / target language from the catalog key.
 *
 * REM-T1-04: "Para ti" lists the subjects of the Student's Academic Profile with
 * their exact variant/level first, and a level the profile already states
 * (e.g. Mathematics AA HL) is never asked again -- "Cambiar nivel" stays an
 * explicit action. The full catalog stays under "Ver todas".
 */
export default function SubjectPicker({
  locale,
  suggestions,
  owned,
  requiresLevel,
  profileLabel,
  knownLevels = {},
}: {
  locale: Locale;
  suggestions: SubjectSuggestion[];
  owned: { id: string; name: string }[];
  /** DP: every subject needs HL/SL (subject-academic-context.ts). */
  requiresLevel: boolean;
  profileLabel: string | null;
  /** REM-T1-04: catalog key -> HL/SL already stated by the Academic Profile. */
  knownLevels?: Record<string, 'HL' | 'SL'>;
}) {
  const t = getMessages(locale);
  const acp = ACADEMIC_PROFILE_MESSAGES[locale] as Record<string, string>;
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [levelFor, setLevelFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  // Synchronous guard: a double click fires before `busy` re-renders the buttons disabled.
  const inFlight = useRef(false);

  const ownedKeys = useMemo(() => new Set(owned.map((o) => catalogSubjectByName(o.name)?.key).filter(Boolean)), [owned]);
  const name = (key: string) => catalogSubject(key)?.names[locale] ?? key;
  const rest = useMemo(() => {
    const q = normalizeName(search);
    return SUBJECT_CATALOG.filter((e) => !ownedKeys.has(e.key)).filter(
      (e) => !q || Object.values(e.names).some((n) => normalizeName(n).includes(q)),
    );
  }, [search, ownedKeys]);

  async function choose(key: string, explicitLevel?: 'HL' | 'SL', askLevel = false) {
    // A level the Academic Profile already states is reused; asking is only on explicit request.
    const ibLevel = explicitLevel ?? (askLevel ? undefined : knownLevels[key]);
    if (requiresLevel && !ibLevel) {
      setLevelFor(key);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(key);
    setError(false);
    try {
      const res = await fetch('/api/subjects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogKey: key, ibLevel: ibLevel ?? null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.subjectId) throw new Error('create failed');
      // Next: pick the concept inside Aprender.
      router.push(`/dashboard/learn?subjectId=${body.subjectId}`);
      router.refresh();
    } catch {
      // Stay on the page with the choice still visible; the Student can retry.
      setError(true);
      setBusy(null);
      inFlight.current = false;
    }
  }

  // T1 final delta (G): "Mathematics: analysis and approaches · HL" -> the official name in the interface locale; the level code stays.
  const profileSubjectLabel = (label: string) => label.split(' · ').map((part, i) => (i === 0 ? localizeCatalogSubjectName(part, locale) : part)).join(' · ');
  const option = (key: string, badge?: string, label?: string) => (
    <li key={key}>
      <button type="button" className="sp-option" onClick={() => choose(key)} disabled={!!busy} aria-describedby={badge ? `sp-b-${key}` : undefined} data-subject-key={key}>
        <span className="sp-option-name">{label ?? name(key)}</span>
        {badge && <span id={`sp-b-${key}`} className="sp-badge">{badge}</span>}
        <ArrowRight size={16} strokeWidth={2} aria-hidden className="sp-option-go" />
      </button>
      {requiresLevel && knownLevels[key] ? (
        <button type="button" className="btn btn-ghost sp-change-level" disabled={!!busy} onClick={() => choose(key, undefined, true)}>
          {acp['acp.forYou.changeLevel']}
        </button>
      ) : null}
    </li>
  );

  if (levelFor) {
    return (
      <section className="card sp-level" aria-labelledby="sp-level-title">
        <h2 id="sp-level-title" className="sp-level-title">{t['sp.levelTitle'].replace('{subject}', name(levelFor))}</h2>
        <div className="sp-level-actions">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => choose(levelFor, 'HL')}>{t['sp.levelHL']}</button>
          <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => choose(levelFor, 'SL')}>{t['sp.levelSL']}</button>
          <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setLevelFor(null)}>{t['sp.cancel']}</button>
        </div>
        {busy && <p className="sp-status" role="status">{t['sp.adding'].replace('{subject}', name(busy))}</p>}
        {error && <p className="sp-error" role="alert">{t['sp.error']}</p>}
      </section>
    );
  }

  return (
    <div className="sp">
      {owned.length > 0 && (
        <section aria-labelledby="sp-yours">
          <h2 id="sp-yours" className="sp-heading">{t['sp.yours']}</h2>
          <ul className="sp-grid">
            {owned.map((o) => (
              <li key={o.id}>
                <Link href={`/dashboard/learn?subjectId=${o.id}`} className="sp-option">
                  <span className="sp-option-name">{localizeSubjectName(o.name, locale)}</span>
                  <ArrowRight size={16} strokeWidth={2} aria-hidden className="sp-option-go" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggestions.length > 0 && (
        <section aria-labelledby="sp-for-you">
          <h2 id="sp-for-you" className="sp-heading">{t['sp.forYou']}</h2>
          {profileLabel && <p className="sp-note">{t['sp.forYouProfile'].replace('{profile}', profileLabel)}</p>}
          <ul className="sp-grid" data-for-you>
            {suggestions.map((s) =>
              s.reason === 'PROFILE_SUBJECT' ? option(s.key, undefined, s.label ? profileSubjectLabel(s.label) : undefined) : option(s.key, s.reason === 'EXAM' ? t['sp.examBadge'] : undefined)
            )}
          </ul>
        </section>
      )}

      <details className="sp-all" open={suggestions.length === 0 || undefined}>
        <summary className="sp-all-summary">{t['sp.all']}</summary>
        <label className="sp-search">
          <span className="sr-only">{t['sp.search']}</span>
          <Search size={16} strokeWidth={2} aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t['sp.searchPlaceholder']} autoComplete="off" />
        </label>
        {rest.length === 0 ? <p className="sp-note">{t['sp.noMatch']}</p> : <ul className="sp-grid">{rest.map((e) => option(e.key))}</ul>}
      </details>

      {busy && <p className="sp-status" role="status">{t['sp.adding'].replace('{subject}', name(busy))}</p>}
      {error && <p className="sp-error" role="alert">{t['sp.error']}</p>}
    </div>
  );
}
