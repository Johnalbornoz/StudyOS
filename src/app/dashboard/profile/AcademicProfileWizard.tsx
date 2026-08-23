'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  COUNTRIES, SCHOOL_YEARS_BY_COUNTRY, IB_MYP_YEARS, IB_DP_YEARS,
  type CountryOfStudy, type CurriculumType,
} from '@/lib/academic-options';

interface Messages {
  [key: string]: string;
}

type Step = 'country' | 'grade' | 'curriculum' | 'ibProgramme' | 'ibYear' | 'academicYear' | 'done';

function OptionButton({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn"
      style={{
        justifyContent: 'flex-start', width: '100%', height: 46,
        background: selected ? 'var(--brand-subtle)' : 'var(--bg-base)',
        border: `1px solid ${selected ? 'var(--brand)' : 'var(--border-default)'}`,
        color: selected ? 'var(--brand-ink)' : 'var(--text-primary)',
      }}
    >
      {label}
    </button>
  );
}

export default function AcademicProfileWizard({
  t,
  initial,
}: {
  t: Messages;
  initial: {
    countryOfStudy: CountryOfStudy | null;
    schoolYear: string | null;
    curriculumType: CurriculumType | null;
    ibProgramme: 'MYP' | 'DP' | null;
    ibYear: string | null;
    academicYear: string | null;
  };
}) {
  const router = useRouter();
  const [country, setCountry] = useState<CountryOfStudy | null>(initial.countryOfStudy);
  const [grade, setGrade] = useState<string | null>(initial.schoolYear);
  const [curriculum, setCurriculum] = useState<CurriculumType | null>(initial.curriculumType);
  const [ibProgramme, setIbProgramme] = useState<'MYP' | 'DP' | null>(initial.ibProgramme);
  const [ibYear, setIbYear] = useState<string | null>(initial.ibYear);
  const [academicYear, setAcademicYear] = useState(initial.academicYear || '');
  const [saving, setSaving] = useState(false);

  const steps: Step[] = ['country', 'grade', 'curriculum'];
  if (curriculum === 'ib') steps.push('ibProgramme', 'ibYear');
  steps.push('academicYear', 'done');

  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  // If curriculum changes away from IB after ibProgramme/ibYear were
  // already answered, keep the answers in state (harmless) -- they're
  // simply skipped from the step list and cleared server-side by
  // upsertAcademicProfile when curriculumType !== 'ib'.
  useEffect(() => {
    if (stepIndex >= steps.length) setStepIndex(steps.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curriculum]);

  async function save(completed: boolean) {
    if (!country || !curriculum) return;
    setSaving(true);
    try {
      await fetch('/api/academic-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryOfStudy: country,
          schoolYear: grade,
          curriculumType: curriculum,
          ibProgramme,
          ibYear,
          academicYear: academicYear || null,
          profileCompleted: completed,
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    await save(false);
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function back() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function finish() {
    await save(true);
    setStepIndex(steps.length - 1);
    router.refresh();
  }

  const canContinue =
    (step === 'country' && !!country) ||
    (step === 'grade' && !!grade) ||
    (step === 'curriculum' && !!curriculum) ||
    (step === 'ibProgramme' && !!ibProgramme) ||
    (step === 'ibYear' && !!ibYear) ||
    (step === 'academicYear' && true);

  const stepNumber = stepIndex + 1;
  const totalSteps = steps.length - 1; // exclude "done" from the count shown to the user

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      {step !== 'done' && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-6)' }}>
            {steps.slice(0, -1).map((s, i) => (
              <div
                key={s}
                style={{
                  flex: 1, height: 4, borderRadius: 'var(--radius-full)',
                  background: i <= stepIndex ? 'var(--brand)' : 'var(--border-default)',
                }}
              />
            ))}
          </div>
          <p className="label" style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
            {t['profile.stepOf'].replace('{current}', String(stepNumber)).replace('{total}', String(totalSteps))}
          </p>
        </>
      )}

      {step === 'country' && (
        <>
          <h2 style={{ marginBottom: 'var(--space-4)' }}>{t['profile.stepCountryQuestion']}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {COUNTRIES.map((c) => (
              <OptionButton key={c.value} selected={country === c.value} label={c.label} onClick={() => setCountry(c.value)} />
            ))}
          </div>
        </>
      )}

      {step === 'grade' && country && (
        <>
          <h2 style={{ marginBottom: 'var(--space-4)' }}>{t['profile.stepGradeQuestion']}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {SCHOOL_YEARS_BY_COUNTRY[country].map((g) => (
              <OptionButton key={g} selected={grade === g} label={g} onClick={() => setGrade(g)} />
            ))}
          </div>
        </>
      )}

      {step === 'curriculum' && (
        <>
          <h2 style={{ marginBottom: 'var(--space-4)' }}>{t['profile.stepCurriculumQuestion']}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <OptionButton selected={curriculum === 'national'} label={t['profile.curriculumNational']} onClick={() => setCurriculum('national')} />
            <OptionButton selected={curriculum === 'ib'} label={t['profile.curriculumIB']} onClick={() => setCurriculum('ib')} />
            <OptionButton selected={curriculum === 'other'} label={t['profile.curriculumOther']} onClick={() => setCurriculum('other')} />
            <OptionButton selected={curriculum === 'not_sure'} label={t['profile.curriculumNotSure']} onClick={() => setCurriculum('not_sure')} />
          </div>
        </>
      )}

      {step === 'ibProgramme' && (
        <>
          <h2 style={{ marginBottom: 'var(--space-4)' }}>{t['profile.stepIbProgrammeQuestion']}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <OptionButton selected={ibProgramme === 'MYP'} label="MYP" onClick={() => { setIbProgramme('MYP'); setIbYear(null); }} />
            <OptionButton selected={ibProgramme === 'DP'} label="DP" onClick={() => { setIbProgramme('DP'); setIbYear(null); }} />
          </div>
        </>
      )}

      {step === 'ibYear' && ibProgramme && (
        <>
          <h2 style={{ marginBottom: 'var(--space-4)' }}>{t['profile.stepIbYearQuestion']}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {(ibProgramme === 'MYP' ? IB_MYP_YEARS : IB_DP_YEARS).map((y) => (
              <OptionButton key={y} selected={ibYear === y} label={y} onClick={() => setIbYear(y)} />
            ))}
          </div>
        </>
      )}

      {step === 'academicYear' && (
        <>
          <h2 style={{ marginBottom: 'var(--space-4)' }}>{t['profile.stepAcademicYearQuestion']}</h2>
          <input
            type="text"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            placeholder={t['profile.academicYearPlaceholder']}
            style={{
              width: '100%', height: 46, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
              padding: '0 var(--space-4)', fontFamily: 'inherit', fontSize: 15,
            }}
          />
        </>
      )}

      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
          <h2 style={{ marginBottom: 'var(--space-2)' }}>{t['profile.completedTitle']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>{t['profile.completedBody']}</p>
        </div>
      )}

      {step !== 'done' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-6)' }}>
          <button className="btn btn-secondary" onClick={back} disabled={stepIndex === 0 || saving} style={{ visibility: stepIndex === 0 ? 'hidden' : 'visible' }}>
            {t['profile.back']}
          </button>
          {step === 'academicYear' ? (
            <button className="btn btn-primary" onClick={finish} disabled={saving}>
              {t['profile.finish']}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={next} disabled={!canContinue || saving}>
              {t['profile.continue']}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
