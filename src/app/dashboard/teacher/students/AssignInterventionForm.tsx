'use client';

/**
 * F13 -- Teacher Intervention assignment UI (task section 18).
 * CONCEPT/SKILL/COMPETENCY/EXAM are four visually and structurally
 * distinct forms -- switching `targetType` never carries a value over
 * from a previous selection into the new shape, so one target can
 * never be silently inferred from another (task's own explicit
 * requirement). POSTs to the real, unmodified F11-B
 * `/api/teacher/interventions` route -- this component performs no
 * authorization or eligibility decision itself; a rejected request
 * (e.g. PAA Full Mock NOT_READY, wrong class, invalid target) is
 * rendered verbatim as the server's own denial, never silently
 * retried as something else (INV-F13-01).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type TargetType = 'CONCEPT' | 'SKILL' | 'COMPETENCY' | 'EXAM';
type SimulationType = 'TOPIC_EXAM' | 'DOMAIN_EXAM' | 'MINI_MOCK' | 'FULL_MOCK';

export interface AssignInterventionLabels {
  title: string;
  targetTypeLabel: string;
  conceptIdLabel: string;
  skillIdLabel: string;
  competencyIdLabel: string;
  examProfileIdLabel: string;
  simulationTypeLabel: string;
  submit: string;
  submitting: string;
  success: string;
  error: string;
  typeConcept: string;
  typeSkill: string;
  typeCompetency: string;
  typeExam: string;
}

export function AssignInterventionForm({
  classId,
  studentId,
  labels,
}: {
  classId: string;
  studentId: string;
  labels: AssignInterventionLabels;
}) {
  const router = useRouter();
  const [targetType, setTargetType] = useState<TargetType>('CONCEPT');
  const [conceptId, setConceptId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [competencyId, setCompetencyId] = useState('');
  const [examProfileId, setExamProfileId] = useState('');
  const [simulationType, setSimulationType] = useState<SimulationType>('TOPIC_EXAM');
  const [learningObjectiveId, setLearningObjectiveId] = useState('');
  const [academicSubjectId, setAcademicSubjectId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'idle' | 'success' | 'error'>('idle');

  function buildTarget() {
    switch (targetType) {
      case 'CONCEPT':
        return { targetType: 'CONCEPT' as const, conceptId };
      case 'SKILL':
        return { targetType: 'SKILL' as const, skillId };
      case 'COMPETENCY':
        return { targetType: 'COMPETENCY' as const, competencyId };
      case 'EXAM':
        if (simulationType === 'TOPIC_EXAM') return { targetType: 'EXAM' as const, examProfileId, simulationType, learningObjectiveId };
        if (simulationType === 'DOMAIN_EXAM') return { targetType: 'EXAM' as const, examProfileId, simulationType, academicSubjectId };
        return { targetType: 'EXAM' as const, examProfileId, simulationType };
    }
  }

  const interventionTypeForTarget: Record<TargetType, string> = {
    CONCEPT: 'CONCEPT_REINFORCEMENT',
    SKILL: 'SKILL_PRACTICE',
    COMPETENCY: 'COMPETENCY_PRACTICE',
    EXAM: 'EXAM_PRACTICE',
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult('idle');
    try {
      const res = await fetch('/api/teacher/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          studentId,
          interventionType: interventionTypeForTarget[targetType],
          target: buildTarget(),
        }),
      });
      if (!res.ok) {
        setResult('error');
        return;
      }
      setResult('success');
      router.refresh();
    } catch {
      setResult('error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{labels.title}</h2>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
        {labels.targetTypeLabel}
        <select value={targetType} onChange={(e) => setTargetType(e.target.value as TargetType)}>
          <option value="CONCEPT">{labels.typeConcept}</option>
          <option value="SKILL">{labels.typeSkill}</option>
          <option value="COMPETENCY">{labels.typeCompetency}</option>
          <option value="EXAM">{labels.typeExam}</option>
        </select>
      </label>

      {targetType === 'CONCEPT' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
          {labels.conceptIdLabel}
          <input value={conceptId} onChange={(e) => setConceptId(e.target.value)} required />
        </label>
      )}
      {targetType === 'SKILL' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
          {labels.skillIdLabel}
          <input value={skillId} onChange={(e) => setSkillId(e.target.value)} required />
        </label>
      )}
      {targetType === 'COMPETENCY' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
          {labels.competencyIdLabel}
          <input value={competencyId} onChange={(e) => setCompetencyId(e.target.value)} required />
        </label>
      )}
      {targetType === 'EXAM' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
            {labels.examProfileIdLabel}
            <input value={examProfileId} onChange={(e) => setExamProfileId(e.target.value)} required />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
            {labels.simulationTypeLabel}
            <select value={simulationType} onChange={(e) => setSimulationType(e.target.value as SimulationType)}>
              <option value="TOPIC_EXAM">TOPIC_EXAM</option>
              <option value="DOMAIN_EXAM">DOMAIN_EXAM</option>
              <option value="MINI_MOCK">MINI_MOCK</option>
              <option value="FULL_MOCK">FULL_MOCK</option>
            </select>
          </label>
          {simulationType === 'TOPIC_EXAM' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
              Learning objective ID
              <input value={learningObjectiveId} onChange={(e) => setLearningObjectiveId(e.target.value)} required />
            </label>
          )}
          {simulationType === 'DOMAIN_EXAM' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
              Academic subject ID
              <input value={academicSubjectId} onChange={(e) => setAcademicSubjectId(e.target.value)} required />
            </label>
          )}
        </>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? labels.submitting : labels.submit}
      </button>

      {result === 'success' && <p style={{ color: 'var(--success)', fontSize: 13 }}>{labels.success}</p>}
      {result === 'error' && (
        <p role="alert" style={{ color: 'var(--error)', fontSize: 13 }}>
          {labels.error}
        </p>
      )}
    </form>
  );
}
