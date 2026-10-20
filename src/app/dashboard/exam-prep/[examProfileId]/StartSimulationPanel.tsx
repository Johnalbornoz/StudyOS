'use client';

/**
 * F14 Workstream A / UX-2 -- self-service exam practice.
 *
 * POSTs to the real F9 `/api/simulation/attempts` route with the same body
 * shape as before; Track B passes the Student's interface language instead
 * of a fixed 'en' (AI-generated items and free-text grading follow it). This component makes
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
  SIMULATION_TYPES,
  TIMING_MODES,
  eligibilityReasonKeys,
  type EligibilityReasonKey,
  type SimulationType,
  type TimingMode,
} from '@/lib/experience/exam-prep';

export interface StartSimulationLabels {
  topicLabel: string;
  areaLabel: string;
  inProgress: string;
  notAllowed: string;
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

export interface PracticeArea {
  componentId: string;
  name: string;
  academicSubjectId: string | null;
  objectives: Array<{ id: string; description: string }>;
}

export function StartSimulationPanel({
  studentId,
  examProfileId,
  examVersionId,
  miniMockEligible,
  miniMockReasons,
  fullMockEligible,
  fullMockReasons,
  areas = [],
  allowedTypes,
  allowedTimings,
  language = 'es',
  initialArea,
  labels,
}: {
  studentId: string;
  examProfileId: string;
  examVersionId: string;
  miniMockEligible: boolean;
  miniMockReasons: string[];
  fullMockEligible: boolean;
  fullMockReasons: string[];
  /** Track B: areas/objectives to target by NAME (never a typed id). */
  areas?: PracticeArea[];
  /** Track B: the version's delivery policy decides which modes exist. */
  allowedTypes?: SimulationType[];
  allowedTimings?: TimingMode[];
  /** The Student's interface language -- items and grading follow it. */
  language?: string;
  initialArea?: string;
  labels: StartSimulationLabels;
}) {
  const router = useRouter();
  const typeAllowed = (type: SimulationType) => !allowedTypes || allowedTypes.includes(type);
  const timingOptions = TIMING_MODES.filter((m) => !allowedTimings || allowedTimings.includes(m));
  const firstType = (initialArea ? 'DOMAIN_EXAM' : PRIMARY_SIMULATION_TYPES.find(typeAllowed) ?? SIMULATION_TYPES.find(typeAllowed) ?? 'MINI_MOCK') as SimulationType;
  const [simulationType, setSimulationType] = useState<SimulationType>(firstType);
  const [timingMode, setTimingMode] = useState<TimingMode>(timingOptions[0] ?? 'UNTIMED');
  const [learningObjectiveId, setLearningObjectiveId] = useState(areas[0]?.objectives[0]?.id ?? '');
  const [academicSubjectId, setAcademicSubjectId] = useState(initialArea ?? areas.find((a) => a.academicSubjectId)?.academicSubjectId ?? '');
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
          language,
          ...(simulationType === 'TOPIC_EXAM' ? { learningObjectiveId } : {}),
          ...(simulationType === 'DOMAIN_EXAM' ? { academicSubjectId } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.error === 'ATTEMPT_IN_PROGRESS' && body?.data?.simulationAttemptId) {
        // Never a second attempt: take the Student back to the one already running.
        setError(labels.inProgress);
        router.push(`/dashboard/exam-prep/attempt/${body.data.simulationAttemptId}`);
        return;
      }
      if (!res.ok) {
        if (body?.error === 'SIMULATION_MODE_NOT_ALLOWED') {
          setError(labels.notAllowed);
          return;
        }
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
          {PRIMARY_SIMULATION_TYPES.map((type) =>
            typeAllowed(type) ? (
              <Choice key={type} name="simulationType" value={type} checked={simulationType === type} onChange={() => setSimulationType(type)} title={labels.types[type].title} body={labels.types[type].body} />
            ) : null
          )}
        </fieldset>

        <details className="ui-disclosure" open={advancedOpen}>
          <summary>{labels.advanced}</summary>
          <div className="ui-disclosure-body ui-form">
            <fieldset className="ui-choices">
              {(['TOPIC_EXAM', 'DOMAIN_EXAM'] as const).filter(typeAllowed).map((type) => (
                <Choice key={type} name="simulationType" value={type} checked={simulationType === type} onChange={() => setSimulationType(type)} title={labels.types[type].title} body={labels.types[type].body} />
              ))}
            </fieldset>
            {/* Track B: targets are chosen by NAME (radio cards), never by a typed id. */}
            {simulationType === 'TOPIC_EXAM' && (
              <fieldset className="ui-choices">
                <legend className="ui-label">{labels.topicLabel}</legend>
                {areas.flatMap((a) =>
                  a.objectives.map((o) => (
                    <Choice key={o.id} name="learningObjectiveId" value={o.id} checked={learningObjectiveId === o.id} onChange={() => setLearningObjectiveId(o.id)} title={o.description} body={a.name} />
                  ))
                )}
              </fieldset>
            )}
            {simulationType === 'DOMAIN_EXAM' && (
              <fieldset className="ui-choices">
                <legend className="ui-label">{labels.areaLabel}</legend>
                {areas
                  .filter((a, i) => a.academicSubjectId && areas.findIndex((b) => b.academicSubjectId === a.academicSubjectId) === i)
                  .map((a) => (
                    <Choice key={a.componentId} name="academicSubjectId" value={a.academicSubjectId!} checked={academicSubjectId === a.academicSubjectId} onChange={() => setAcademicSubjectId(a.academicSubjectId!)} title={a.name} body="" />
                  ))}
              </fieldset>
            )}
          </div>
        </details>

        <fieldset className="ui-choices">
          <legend className="ui-label">{labels.timingLegend}</legend>
          {timingOptions.map((mode) => (
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
