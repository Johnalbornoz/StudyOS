'use client';

/**
 * F14 Workstream A / UX-2 -- self-service exam practice.
 *
 * POSTs to the real, unmodified F9 `/api/simulation/attempts` route with
 * exactly the same body as before (including `language: 'en'`, which is
 * the existing behaviour and is left untouched here). This component makes
 * no eligibility decision: MINI_MOCK/FULL_MOCK eligibility arrives
 * pre-computed from the server; TOPIC_EXAM/DOMAIN_EXAM are checked
 * server-side on submit. UX-2 changes presentation only: choice cards
 * instead of raw enum selects, and the server's reason codes shown as
 * plain sentences (lib/experience/exam-prep.ts), never verbatim.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InlineAlert } from '@/components/ui/InlineAlert';
import {
  PRIMARY_SIMULATION_TYPES,
  TIMING_MODES,
  eligibilityReasonKeys,
  type EligibilityReasonKey,
  type SimulationType,
  type TimingMode,
} from '@/lib/experience/exam-prep';

export interface StartSimulationLabels {
  title: string;
  lead: string;
  typeLegend: string;
  timingLegend: string;
  advanced: string;
  learningObjectiveIdLabel: string;
  academicSubjectIdLabel: string;
  targetIdHint: string;
  submit: string;
  submitting: string;
  error: string;
  types: Record<SimulationType, { title: string; body: string }>;
  timings: Record<TimingMode, { title: string; body: string }>;
  reasons: Record<EligibilityReasonKey, string>;
}

function Choice({ name, value, checked, onChange, title, body }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; body: string }) {
  return (
    <label className="ui-choice">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
      <span className="ui-choice-title">{title}</span>
      <span className="ui-choice-body">{body}</span>
    </label>
  );
}

export function StartSimulationPanel({
  studentId,
  examProfileId,
  examVersionId,
  miniMockEligible,
  miniMockReasons,
  fullMockEligible,
  fullMockReasons,
  labels,
}: {
  studentId: string;
  examProfileId: string;
  examVersionId: string;
  miniMockEligible: boolean;
  miniMockReasons: string[];
  fullMockEligible: boolean;
  fullMockReasons: string[];
  labels: StartSimulationLabels;
}) {
  const router = useRouter();
  const [simulationType, setSimulationType] = useState<SimulationType>('MINI_MOCK');
  const [timingMode, setTimingMode] = useState<TimingMode>('UNTIMED');
  const [learningObjectiveId, setLearningObjectiveId] = useState('');
  const [academicSubjectId, setAcademicSubjectId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKeys, setErrorKeys] = useState<EligibilityReasonKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  const blockedReasons =
    simulationType === 'MINI_MOCK' ? (miniMockEligible ? [] : miniMockReasons)
    : simulationType === 'FULL_MOCK' ? (fullMockEligible ? [] : fullMockReasons)
    : []; // TOPIC_EXAM/DOMAIN_EXAM eligibility depends on the id typed below -- checked server-side on submit only
  const blockedKeys = eligibilityReasonKeys(blockedReasons);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setErrorKeys([]);
    try {
      const res = await fetch('/api/simulation/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          examProfileId,
          examVersionId,
          simulationType,
          timingMode,
          language: 'en',
          ...(simulationType === 'TOPIC_EXAM' ? { learningObjectiveId } : {}),
          ...(simulationType === 'DOMAIN_EXAM' ? { academicSubjectId } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const reasons = body?.data?.eligibility?.reasons;
        if (Array.isArray(reasons) && reasons.length > 0) setErrorKeys(eligibilityReasonKeys(reasons));
        else if (body?.error === 'TIMING_NOT_CONFIGURED') setErrorKeys(['ex.reason.unavailable']);
        else setError(labels.error);
        return;
      }
      router.push(`/dashboard/exam-prep/attempt/${body.data.simulationAttempt.id}`);
    } catch {
      setError(labels.error);
    } finally {
      setSubmitting(false);
    }
  }

  const advancedOpen = simulationType === 'TOPIC_EXAM' || simulationType === 'DOMAIN_EXAM';

  return (
    <section className="card ex-practice" aria-labelledby="ex-practice-title">
      <div>
        <h2 id="ex-practice-title" className="ex-practice-title">{labels.title}</h2>
        <p className="ui-intro-lead" style={{ marginTop: 'var(--space-1)' }}>{labels.lead}</p>
      </div>
      <form onSubmit={onSubmit} className="ui-form">
        <fieldset className="ui-choices">
          <legend className="ui-label">{labels.typeLegend}</legend>
          {PRIMARY_SIMULATION_TYPES.map((type) => (
            <Choice key={type} name="simulationType" value={type} checked={simulationType === type} onChange={() => setSimulationType(type)} title={labels.types[type].title} body={labels.types[type].body} />
          ))}
        </fieldset>

        <details className="ui-disclosure" open={advancedOpen}>
          <summary>{labels.advanced}</summary>
          <div className="ui-disclosure-body ui-form">
            <fieldset className="ui-choices">
              {(['TOPIC_EXAM', 'DOMAIN_EXAM'] as const).map((type) => (
                <Choice key={type} name="simulationType" value={type} checked={simulationType === type} onChange={() => setSimulationType(type)} title={labels.types[type].title} body={labels.types[type].body} />
              ))}
            </fieldset>
            {simulationType === 'TOPIC_EXAM' && (
              <label className="ui-field">
                <span className="ui-label">{labels.learningObjectiveIdLabel}</span>
                <input className="ui-input" value={learningObjectiveId} onChange={(e) => setLearningObjectiveId(e.target.value)} required />
                <span className="ui-hint">{labels.targetIdHint}</span>
              </label>
            )}
            {simulationType === 'DOMAIN_EXAM' && (
              <label className="ui-field">
                <span className="ui-label">{labels.academicSubjectIdLabel}</span>
                <input className="ui-input" value={academicSubjectId} onChange={(e) => setAcademicSubjectId(e.target.value)} required />
                <span className="ui-hint">{labels.targetIdHint}</span>
              </label>
            )}
          </div>
        </details>

        <fieldset className="ui-choices">
          <legend className="ui-label">{labels.timingLegend}</legend>
          {TIMING_MODES.map((mode) => (
            <Choice key={mode} name="timingMode" value={mode} checked={timingMode === mode} onChange={() => setTimingMode(mode)} title={labels.timings[mode].title} body={labels.timings[mode].body} />
          ))}
        </fieldset>

        {blockedKeys.length > 0 && <InlineAlert tone="info" title={blockedKeys.map((k) => labels.reasons[k]).join(' ')} />}
        {errorKeys.length > 0 && <InlineAlert tone="warning" title={errorKeys.map((k) => labels.reasons[k]).join(' ')} />}
        {error && <InlineAlert tone="error" title={error} />}

        <div className="ui-form-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || blockedKeys.length > 0} aria-busy={submitting}>
            {submitting ? labels.submitting : labels.submit}
          </button>
        </div>
      </form>
    </section>
  );
}
