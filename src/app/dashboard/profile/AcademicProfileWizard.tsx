'use client';

/**
 * Student Academic Profile -- asked once, changed only on purpose.
 *
 *   Country -> Grade -> Nacional | Internacional -> Programme (from the canonical
 *   catalogue, compatible with the grade) -> Qualification (only when the programme
 *   has several) -> Subjects (optional) -> Academic year
 *
 * Programmes come from GET /api/academic-profile/options (catalogue only, never a
 * hardcoded list). "Mi programa no aparece" keeps the scope without a programme.
 * Everything is saved in ONE request at the end (validated and audited on the
 * server); changing the curriculum never erases learning history.
 *
 * REM-T1-03: the final step is driven by the programme -- an examination session
 * for IB Diploma / Cambridge (governed series, programme-sessions.ts), a controlled
 * school year otherwise. No free text.
 * REM-T1-06: explicit Cancel on every step; real changes ask "Discard unsaved
 * changes?". Nothing is official until Finish succeeds (draft until then).
 * REM-T1-07: countries and grade labels render in the interface locale; the
 * stored values and catalogue IDs never change.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRIES, SCHOOL_YEARS_BY_COUNTRY, type CountryOfStudy, type CurriculumType } from '@/lib/academic-options';
import type { Locale } from '@/lib/i18n/messages';
import { countryDisplayName, gradeDisplayLabel } from '@/lib/i18n/catalog-labels';
import {
  canonicalTimeContextText,
  formatTimeContext,
  parseTimeContextKey,
  resolveTimeContextModel,
  storedTimeContext,
  timeContextFitsModel,
  timeContextKey,
  timeContextOptions,
} from '@/lib/student/time-context';
import { cancelOutcome, isProfileDraftDirty, wizardActions, type ProfileDraft } from '@/lib/student/academic-profile-draft';

interface Messages {
  [key: string]: string;
}

type Scope = 'NATIONAL' | 'INTERNATIONAL' | 'other' | 'not_sure';
type Step = 'country' | 'grade' | 'scope' | 'programme' | 'qualification' | 'subjects' | 'academicYear' | 'done';
const NOT_LISTED = 'NOT_LISTED';

interface ProgrammeOption {
  id: string;
  name: string;
  authority: string;
  compatible: boolean;
  qualifications: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string; level: string | null; qualificationId: string | null }>;
}
interface Options {
  national: { country: string | null; countryName: string | null; programmes: ProgrammeOption[] };
  international: Array<{ authorityId: string; authority: string; programmes: ProgrammeOption[] }>;
}

function OptionButton({ selected, label, hint, onClick }: { selected: boolean; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="btn acp-option"
      style={{
        background: selected ? 'var(--brand-subtle)' : 'var(--bg-base)',
        border: `1px solid ${selected ? 'var(--brand)' : 'var(--border-default)'}`,
        color: selected ? 'var(--brand-ink)' : 'var(--text-primary)',
      }}
    >
      <span className="acp-option-label">{label}</span>
      {hint ? <span className="acp-option-hint">{hint}</span> : null}
    </button>
  );
}

export interface WizardInitial {
  countryOfStudy: CountryOfStudy | null;
  schoolYear: string | null;
  curriculumType: CurriculumType | null;
  curriculumScope: 'NATIONAL' | 'INTERNATIONAL' | null;
  academicProgrammeId: string | null;
  academicQualificationId: string | null;
  academicSubjectIds: string[];
  academicYear: string | null;
  /** REM-T1-03: structured time context, when stored (legacy rows only have `academicYear`). */
  academicYearStart?: number | null;
  academicYearEnd?: number | null;
  examSeries?: string | null;
  examYear?: number | null;
  profileCompleted: boolean;
}

function initialScope(i: WizardInitial): Scope | null {
  if (i.curriculumScope) return i.curriculumScope;
  if (i.curriculumType === 'national') return 'NATIONAL';
  if (i.curriculumType === 'ib') return 'INTERNATIONAL';
  if (i.curriculumType === 'other' || i.curriculumType === 'not_sure') return i.curriculumType;
  return null;
}

function persistedDraft(i: WizardInitial): ProfileDraft {
  const stored = storedTimeContext(i);
  return {
    country: i.countryOfStudy,
    grade: i.schoolYear,
    scope: initialScope(i),
    programme: i.academicProgrammeId ?? (i.curriculumScope ? NOT_LISTED : null),
    qualification: i.academicQualificationId,
    subjects: i.academicSubjectIds,
    timeKey: stored ? timeContextKey(stored) : null,
  };
}

export default function AcademicProfileWizard({
  t,
  initial,
  locale = 'es',
  exitHref = null,
}: {
  t: Messages;
  initial: WizardInitial;
  locale?: Locale;
  /** Where Cancel goes when there is no saved profile to return to (first-time onboarding). */
  exitHref?: string | null;
}) {
  const router = useRouter();
  const persisted = useMemo(() => persistedDraft(initial), [initial]);
  const [open, setOpen] = useState(!initial.profileCompleted);
  const [country, setCountry] = useState<CountryOfStudy | null>(initial.countryOfStudy);
  const [grade, setGrade] = useState<string | null>(initial.schoolYear);
  const [scope, setScope] = useState<Scope | null>(initialScope(initial));
  const [programme, setProgramme] = useState<string | null>(persisted.programme);
  const [qualification, setQualification] = useState<string | null>(initial.academicQualificationId);
  const [subjects, setSubjects] = useState<string[]>(initial.academicSubjectIds);
  const [timeKey, setTimeKey] = useState<string | null>(persisted.timeKey);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [now] = useState(() => new Date());
  const [options, setOptions] = useState<Options | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const catalogueScope = scope === 'NATIONAL' || scope === 'INTERNATIONAL';
  useEffect(() => {
    if (!catalogueScope || !country) return;
    let live = true;
    const empty: Options = { national: { country, countryName: null, programmes: [] }, international: [] };
    setOptions(null);
    fetch(`/api/academic-profile/options?country=${encodeURIComponent(country)}&schoolYear=${encodeURIComponent(grade ?? '')}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => { if (live) setOptions(b?.data ?? empty); })
      .catch(() => { if (live) setOptions(empty); });
    return () => { live = false; };
  }, [catalogueScope, country, grade]);

  const allProgrammes = useMemo(() => (options ? [...options.national.programmes, ...options.international.flatMap((a) => a.programmes)] : []), [options]);
  const chosen = programme && programme !== NOT_LISTED ? allProgrammes.find((p) => p.id === programme) ?? null : null;
  const subjectOptions = chosen ? chosen.subjects.filter((s) => !qualification || !s.qualificationId || s.qualificationId === qualification) : [];

  // REM-T1-03: the time context the chosen programme actually uses, as controlled options.
  const timeModel = useMemo(() => resolveTimeContextModel({ country, programmeName: chosen?.name ?? null }), [country, chosen?.name]);
  const timeOptions = useMemo(() => {
    const list = timeContextOptions(timeModel, now);
    const saved = parseTimeContextKey(persisted.timeKey);
    if (saved && timeContextFitsModel(saved, timeModel) && !list.some((o) => timeContextKey(o) === persisted.timeKey)) list.unshift(saved);
    return list;
  }, [timeModel, now, persisted.timeKey]);
  const selectedTime = timeOptions.find((o) => timeContextKey(o) === timeKey) ?? null;
  const legacyTimeText = !persisted.timeKey && initial.academicYear ? initial.academicYear : null;

  const dirty = isProfileDraftDirty(persisted, { country, grade, scope, programme, qualification, subjects, timeKey });
  function resetToPersisted() {
    setCountry(initial.countryOfStudy);
    setGrade(initial.schoolYear);
    setScope(initialScope(initial));
    setProgramme(persisted.programme);
    setQualification(initial.academicQualificationId);
    setSubjects(initial.academicSubjectIds);
    setTimeKey(persisted.timeKey);
    setShowAll(false);
    setFilter('');
    setError(null);
    setStepIndex(0);
  }
  function exitWizard() {
    resetToPersisted();
    setConfirmDiscard(false);
    if (initial.profileCompleted) setOpen(false);
    else if (exitHref) router.push(exitHref);
  }
  function cancel() {
    if (cancelOutcome(dirty) === 'CONFIRM_DISCARD') setConfirmDiscard(true);
    else exitWizard();
  }

  const steps: Step[] = ['country', 'grade', 'scope'];
  if (catalogueScope) steps.push('programme');
  if (chosen && chosen.qualifications.length > 1) steps.push('qualification');
  if (chosen && chosen.subjects.length > 0) steps.push('subjects');
  steps.push('academicYear', 'done');
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  useEffect(() => {
    if (stepIndex >= steps.length) setStepIndex(steps.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length]);

  function resetProgramme() {
    setProgramme(null);
    setQualification(null);
    setSubjects([]);
    setShowAll(false);
  }
  function chooseProgramme(id: string) {
    if (id !== programme) {
      setQualification(null);
      setSubjects([]);
    }
    setProgramme(id);
  }

  async function finish() {
    if (!country || !scope) return;
    setSaving(true);
    setError(null);
    try {
      const qualificationId = chosen ? qualification ?? (chosen.qualifications.length === 1 ? chosen.qualifications[0].id : null) : null;
      const r = await fetch('/api/academic-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryOfStudy: country,
          schoolYear: grade,
          curriculumType: scope === 'NATIONAL' ? 'national' : scope === 'INTERNATIONAL' ? 'other' : scope,
          curriculumScope: catalogueScope ? scope : null,
          academicProgrammeId: chosen?.id ?? null,
          academicQualificationId: qualificationId,
          academicSubjectIds: chosen ? subjects.filter((s) => subjectOptions.some((o) => o.id === s)) : [],
          academicYear: selectedTime ? canonicalTimeContextText(selectedTime) : null,
          timeContext: selectedTime,
          profileCompleted: true,
        }),
      });
      if (!r.ok) throw new Error();
      setStepIndex(steps.length - 1);
      router.refresh();
    } catch {
      setError(t['acp.error.save']);
    } finally {
      setSaving(false);
    }
  }

  const canContinue =
    (step === 'country' && !!country) ||
    (step === 'grade' && !!grade) ||
    (step === 'scope' && !!scope) ||
    (step === 'programme' && (programme === NOT_LISTED || !!chosen)) ||
    (step === 'qualification' && !!qualification) ||
    step === 'subjects' ||
    // Required (controlled): the Student onboarding gate treats a profile without a time context as incomplete.
    (step === 'academicYear' && !!selectedTime);

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary acp-change" onClick={() => { setOpen(true); setStepIndex(0); }}>
        {t['acp.summary.change']}
      </button>
    );
  }

  const programmeList = (list: ProgrammeOption[]) =>
    (showAll ? list : list.filter((p) => p.compatible || p.id === programme)).map((p) => (
      <OptionButton key={p.id} selected={programme === p.id} label={p.name} hint={[p.authority, p.compatible ? null : t['acp.programme.otherGrade']].filter(Boolean).join(' · ')} onClick={() => chooseProgramme(p.id)} />
    ));
  const scopedProgrammes = scope === 'NATIONAL' ? options?.national.programmes ?? [] : options?.international.flatMap((a) => a.programmes) ?? [];
  const compatibleCount = scopedProgrammes.filter((p) => p.compatible).length;
  const words = filter.trim().toLowerCase();

  return (
    <div className="card acp-wizard">
      {step !== 'done' && (
        <>
          <div className="acp-progress">
            {steps.slice(0, -1).map((s, i) => (
              <div key={s} className={i <= stepIndex ? 'acp-progress-bar is-done' : 'acp-progress-bar'} />
            ))}
          </div>
          <p className="label acp-step">{t['profile.stepOf'].replace('{current}', String(stepIndex + 1)).replace('{total}', String(steps.length - 1))}</p>
        </>
      )}

      {step === 'country' && (
        <>
          <h2 className="acp-question">{t['profile.stepCountryQuestion']}</h2>
          <div className="acp-options">
            {COUNTRIES.map((c) => (
              <OptionButton key={c.value} selected={country === c.value} label={countryDisplayName(c.value, locale) || c.label} onClick={() => { if (c.value !== country) { setGrade(null); resetProgramme(); } setCountry(c.value); }} />
            ))}
          </div>
        </>
      )}

      {step === 'grade' && country && (
        <>
          <h2 className="acp-question">{t['profile.stepGradeQuestion']}</h2>
          <div className="acp-options">
            {SCHOOL_YEARS_BY_COUNTRY[country].map((g) => (
              <OptionButton key={g} selected={grade === g} label={gradeDisplayLabel(g, locale)} onClick={() => setGrade(g)} />
            ))}
          </div>
        </>
      )}

      {step === 'scope' && (
        <>
          <h2 className="acp-question">{t['acp.scope.question']}</h2>
          <div className="acp-options">
            {(['NATIONAL', 'INTERNATIONAL'] as const).map((s) => (
              <OptionButton key={s} selected={scope === s} label={t[`acp.scope.${s}`]} hint={t[`acp.scope.${s}.hint`]} onClick={() => { if (s !== scope) resetProgramme(); setScope(s); }} />
            ))}
            <OptionButton selected={scope === 'other'} label={t['acp.scope.other']} onClick={() => { resetProgramme(); setScope('other'); }} />
            <OptionButton selected={scope === 'not_sure'} label={t['acp.scope.notSure']} onClick={() => { resetProgramme(); setScope('not_sure'); }} />
          </div>
        </>
      )}

      {step === 'programme' && (
        <>
          <h2 className="acp-question">{t['acp.programme.question']}</h2>
          {!options ? (
            <p className="acp-hint">{t['acp.programme.loading']}</p>
          ) : (
            <div className="acp-options">
              {scope === 'NATIONAL' ? (
                scopedProgrammes.length === 0 ? (
                  <p className="acp-hint">{t['acp.programme.noneNational']}</p>
                ) : (
                  <>
                    {options.national.countryName ? <p className="acp-group">{t['acp.programme.nationalOf'].replace('{country}', options.national.countryName)}</p> : null}
                    {programmeList(options.national.programmes)}
                  </>
                )
              ) : (
                options.international.map((a) => {
                  const list = programmeList(a.programmes);
                  return list.length ? (
                    <div key={a.authorityId} className="acp-options" role="group" aria-label={a.authority}>
                      <p className="acp-group">{a.authority}</p>
                      {list}
                    </div>
                  ) : null;
                })
              )}
              {compatibleCount === 0 && scopedProgrammes.length > 0 && !showAll ? <p className="acp-hint">{t['acp.programme.noneCompatible']}</p> : null}
              {!showAll && scopedProgrammes.length > compatibleCount ? (
                <button type="button" className="btn btn-ghost acp-more" onClick={() => setShowAll(true)}>{t['acp.programme.showAll']}</button>
              ) : null}
              <OptionButton selected={programme === NOT_LISTED} label={t['acp.programme.notListed']} onClick={() => chooseProgramme(NOT_LISTED)} />
            </div>
          )}
        </>
      )}

      {step === 'qualification' && chosen && (
        <>
          <h2 className="acp-question">{t['acp.qualification.question']}</h2>
          <div className="acp-options">
            {chosen.qualifications.map((q) => (
              <OptionButton key={q.id} selected={qualification === q.id} label={q.name} onClick={() => { if (q.id !== qualification) setSubjects([]); setQualification(q.id); }} />
            ))}
          </div>
        </>
      )}

      {step === 'subjects' && chosen && (
        <>
          <h2 className="acp-question">{t['acp.subjects.question']}</h2>
          <p className="acp-hint">{t['acp.subjects.help']}</p>
          {subjectOptions.length > 10 ? (
            <label className="ui-field">
              <span className="ui-label">{t['acp.subjects.filter']}</span>
              <input className="ui-input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          ) : null}
          <p className="acp-hint" aria-live="polite">{t['acp.subjects.selected'].replace('{n}', String(subjects.length))}</p>
          <ul className="acp-subjects">
            {subjectOptions
              .filter((s) => !words || `${s.name} ${s.level ?? ''}`.toLowerCase().includes(words))
              .map((s) => (
                <li key={s.id}>
                  <label className="acp-subject">
                    <input type="checkbox" checked={subjects.includes(s.id)} onChange={(e) => setSubjects(e.target.checked ? [...subjects, s.id] : subjects.filter((x) => x !== s.id))} />
                    <span>{s.level ? `${s.name} · ${s.level}` : s.name}</span>
                  </label>
                </li>
              ))}
          </ul>
        </>
      )}

      {step === 'academicYear' && (
        <>
          <h2 className="acp-question">{t[`acp.time.question.${timeModel.kind}`] ?? t['profile.stepAcademicYearQuestion']}</h2>
          {timeModel.kind === 'EXAM_SESSION' ? <p className="acp-hint">{t['acp.time.help.EXAM_SESSION']}</p> : null}
          {legacyTimeText ? <p className="acp-hint" data-legacy-time>{(t['acp.time.saved'] ?? '{value}').replace('{value}', legacyTimeText)}</p> : null}
          <div className="acp-options" role="group" aria-label={t[`acp.time.question.${timeModel.kind}`]}>
            {timeOptions.map((o) => (
              <OptionButton key={timeContextKey(o)} selected={timeKey === timeContextKey(o)} label={formatTimeContext(o, locale)} onClick={() => setTimeKey(timeContextKey(o))} />
            ))}
          </div>
        </>
      )}

      {step === 'done' && (
        <div className="acp-done">
          <h2>{t['profile.completedTitle']}</h2>
          <p className="acp-hint">{t['profile.completedBody']}</p>
          {/* Next onboarding step (first subject) or the workspace -- the Student onboarding gate decides where /dashboard leads. */}
          <a href="/dashboard" className="btn btn-primary">{t['profile.continue']}</a>
        </div>
      )}

      {error ? <p className="acp-hint ta-msg-error" role="alert">{error}</p> : null}

      {confirmDiscard && (
        <div className="card acp-discard" role="alertdialog" aria-modal="false" aria-labelledby="acp-discard-title" aria-describedby="acp-discard-body" data-discard-confirm>
          <h3 id="acp-discard-title">{t['acp.discard.title']}</h3>
          <p id="acp-discard-body" className="acp-hint">{t['acp.discard.body']}</p>
          <div className="acp-nav">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDiscard(false)} autoFocus>{t['acp.discard.keep']}</button>
            <button type="button" className="btn btn-primary" onClick={exitWizard} data-discard>{t['acp.discard.confirm']}</button>
          </div>
        </div>
      )}

      {step !== 'done' && !confirmDiscard && (
        <div className="acp-nav" data-actions={wizardActions(stepIndex, step === 'academicYear').join(',')}>
          {wizardActions(stepIndex, step === 'academicYear').map((a) =>
            a === 'cancel' ? (
              initial.profileCompleted || exitHref || dirty ? (
                <button key={a} type="button" className="btn btn-ghost" onClick={cancel} disabled={saving} data-cancel>{t['acp.cancel']}</button>
              ) : null
            ) : a === 'back' ? (
              <button key={a} type="button" className="btn btn-secondary" onClick={() => setStepIndex((i) => Math.max(i - 1, 0))} disabled={saving}>{t['profile.back']}</button>
            ) : a === 'finish' ? (
              <button key={a} type="button" className="btn btn-primary" onClick={finish} disabled={!canContinue || saving}>{t['profile.finish']}</button>
            ) : (
              <button key={a} type="button" className="btn btn-primary" onClick={() => setStepIndex((i) => Math.min(i + 1, steps.length - 1))} disabled={!canContinue || saving}>{t['profile.continue']}</button>
            )
          )}
        </div>
      )}
    </div>
  );
}
