'use client';

/**
 * F14 Workstream A -- self-service simulation start (task section 4).
 * POSTs to the real, unmodified F9 `/api/simulation/attempts` route --
 * this component performs no eligibility decision itself. TOPIC_EXAM/
 * DOMAIN_EXAM take a raw learning-objective/academic-subject id,
 * mirroring F13's own Teacher `AssignInterventionForm` precedent (no
 * lookup/picker UI exists yet for either on the Teacher side either --
 * a real, disclosed platform gap, not something this panel invents a
 * workaround for). MINI_MOCK/FULL_MOCK eligibility is passed down
 * pre-computed from the server (F9's own `getSimulationEligibility`);
 * a rejected TOPIC_EXAM/DOMAIN_EXAM attempt surfaces the server's own
 * `reasons` verbatim, never a fabricated explanation.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type SimulationType = 'TOPIC_EXAM' | 'DOMAIN_EXAM' | 'MINI_MOCK' | 'FULL_MOCK';
type TimingMode = 'UNTIMED' | 'TRAINING_TIMED' | 'OFFICIAL_SIMULATION_TIMED';

export interface StartSimulationLabels {
  title: string;
  simulationTypeLabel: string;
  timingModeLabel: string;
  learningObjectiveIdLabel: string;
  academicSubjectIdLabel: string;
  submit: string;
  submitting: string;
  notEligible: string;
  error: string;
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
  const [error, setError] = useState<string | null>(null);

  const blockedReasons =
    simulationType === 'MINI_MOCK' ? (miniMockEligible ? [] : miniMockReasons)
    : simulationType === 'FULL_MOCK' ? (fullMockEligible ? [] : fullMockReasons)
    : []; // TOPIC_EXAM/DOMAIN_EXAM eligibility depends on the id typed below -- checked server-side on submit only

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
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
      const body = await res.json();
      if (!res.ok) {
        const reasons = body?.data?.eligibility?.reasons;
        setError(Array.isArray(reasons) && reasons.length > 0 ? reasons.join(', ') : body?.error || labels.error);
        return;
      }
      router.push(`/dashboard/exam-prep/attempt/${body.data.simulationAttempt.id}`);
    } catch {
      setError(labels.error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{labels.title}</h2>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
        {labels.simulationTypeLabel}
        <select value={simulationType} onChange={(e) => setSimulationType(e.target.value as SimulationType)}>
          <option value="MINI_MOCK">MINI_MOCK</option>
          <option value="FULL_MOCK">FULL_MOCK</option>
          <option value="TOPIC_EXAM">TOPIC_EXAM</option>
          <option value="DOMAIN_EXAM">DOMAIN_EXAM</option>
        </select>
      </label>

      {simulationType === 'TOPIC_EXAM' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
          {labels.learningObjectiveIdLabel}
          <input value={learningObjectiveId} onChange={(e) => setLearningObjectiveId(e.target.value)} required />
        </label>
      )}
      {simulationType === 'DOMAIN_EXAM' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
          {labels.academicSubjectIdLabel}
          <input value={academicSubjectId} onChange={(e) => setAcademicSubjectId(e.target.value)} required />
        </label>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
        {labels.timingModeLabel}
        <select value={timingMode} onChange={(e) => setTimingMode(e.target.value as TimingMode)}>
          <option value="UNTIMED">UNTIMED</option>
          <option value="TRAINING_TIMED">TRAINING_TIMED</option>
          <option value="OFFICIAL_SIMULATION_TIMED">OFFICIAL_SIMULATION_TIMED</option>
        </select>
      </label>

      {blockedReasons.length > 0 && (
        <p role="status" style={{ fontSize: 12.5, color: 'var(--warning)' }}>
          {labels.notEligible}: {blockedReasons.join(', ')}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting || blockedReasons.length > 0}>
        {submitting ? labels.submitting : labels.submit}
      </button>

      {error && (
        <p role="alert" style={{ fontSize: 12.5, color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </form>
  );
}
