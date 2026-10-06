'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const USAGES = [
  ['PRACTICE', 'Práctica'],
  ['DIAGNOSTIC', 'Diagnóstico'],
  ['QUIZ', 'Quiz'],
  ['REDUCED_MOCK', 'Simulacro reducido'],
  ['FULL_MOCK', 'Simulacro completo'],
] as const;
const ERRORS: Record<string, string> = {
  SELF_REVIEW: 'Quien creó o corrigió esta versión no puede certificarla.',
  AUTOMATED_VALIDATION_NOT_PASSED: 'La validación automática no se superó: solicita una corrección o recházala.',
  OFFICIAL_NOT_ALLOWED: 'El contenido generado por StudyUs nunca puede ser «Oficial».',
  MOCK_USE_NEEDS_MOCK_READY: 'Para usarla en simulacros, la alineación debe ser «Apta para simulacro».',
  MOCK_READY_NEEDS_BLUEPRINT: 'Solo una pregunta de una celda del blueprint puede ser apta para simulacro.',
  NOTES_REQUIRED: 'Escribe una nota (mínimo 5 caracteres).',
  NOT_REVIEWABLE: 'Esta versión no se puede revisar en su estado actual.',
  CHECKLIST_INCOMPLETE: 'Responde cada punto de la lista de revisión (para aprobar, todos deben ser «Sí»).',
  CHECKLIST_FAILURE_REQUIRED: 'Para solicitar corrección o rechazar, marca al menos un punto como «No».',
  PILOT_REVIEW_INVALID: 'La revisión está incompleta o es incoherente con la lista (competencia, contenido, dificultad, clave, notas de corrección o puntos de atención).',
  RULE_VIOLATION: 'La base de datos rechazó la decisión por una regla de revisión.',
};
const DIFFICULTIES = [['BASIC', 'Básica'], ['INTERMEDIATE', 'Intermedia'], ['ADVANCED', 'Avanzada']] as const;
const NO_SINGLE_ANSWER = 'NO_SINGLE_ANSWER';

/** A governed pilot item: what the generator proposed, and what the HUMAN must decide explicitly. */
export interface PilotReviewProps {
  contract: string;
  proposal: { competency: string | null; contentCategory: string | null; difficulty: string | null; answerKey: string | null };
  attentionPoints: Array<{ code: string; text: string }>;
  competencyOptions: Array<{ key: string; label: string }>;
  contentOptions: Array<{ key: string; label: string }>;
  options: Array<{ id: string; text: string }>;
}

const YesNo = ({ name, value, onChange, yes = 'Sí', no = 'No' }: { name: string; value: boolean | undefined; onChange: (v: boolean) => void; yes?: string; no?: string }) => (
  <span style={{ display: 'inline-flex', gap: 'var(--space-2)', flexShrink: 0 }}>
    <label style={{ display: 'inline-flex', gap: 4 }}><input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> {yes}</label>
    <label style={{ display: 'inline-flex', gap: 4 }}><input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> {no}</label>
  </span>
);

/** Approve / Request correction / Reject, with the reviewer's difficulty, use and alignment. */
export function ReviewActions({ versionId, initial, official, checklist = [], pilot = null }: { versionId: string; initial: { difficulty: number | null; usage: string[]; alignment: string }; official: boolean; checklist?: Array<{ key: string; label: string }>; pilot?: PilotReviewProps | null }) {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<number>(initial.difficulty ?? 3);
  const [usage, setUsage] = useState<string[]>(initial.usage);
  const [alignment, setAlignment] = useState<string>(initial.alignment);
  const [notes, setNotes] = useState('');
  // A governed pilot: every point is answered explicitly (Sí / No -- nothing pre-selected, "not answered" is
  // never recorded as "failed"); approving needs every point confirmed (the server and the DB re-check it).
  const [checked, setChecked] = useState<Record<string, boolean | undefined>>({});
  const answered = checklist.every((c) => typeof checked[c.key] === 'boolean');
  const anyFailed = checklist.some((c) => checked[c.key] === false);
  const checklistComplete = checklist.every((c) => checked[c.key] === true);
  // Pilot: what the HUMAN determines -- empty until chosen (never pre-filled with the AI proposal).
  const [competency, setCompetency] = useState('');
  const [content, setContent] = useState('');
  const [studyUsDifficulty, setStudyUsDifficulty] = useState('');
  const [answer, setAnswer] = useState('');
  const [correctionNotes, setCorrectionNotes] = useState('');
  const [attention, setAttention] = useState<Record<string, 'CONFIRMED' | 'NOT_CONFIRMED'>>({});
  const assessmentReady = !pilot || (!!competency && !!content && !!studyUsDifficulty && !!answer && pilot.attentionPoints.every((p) => !!attention[p.code]));
  const notesOk = notes.trim().length >= 5;
  // A checklist (pilot) decision is complete only with every point answered; items without one are unchanged.
  const gated = checklist.length > 0 || !!pilot;
  const canApprove = assessmentReady;
  const canCorrect = !gated || (assessmentReady && notesOk && answered && anyFailed && (!pilot || correctionNotes.trim().length >= 5));
  const canReject = !gated || (assessmentReady && notesOk && answered && anyFailed);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async (decision: 'APPROVED' | 'CORRECTION_REQUESTED' | 'REJECTED') => {
    setBusy(true);
    setMsg(null);
    const list = checklist.length ? { checklist: checked } : {};
    const assessment = pilot
      ? { assessment: { contract: pilot.contract, reviewedCompetency: competency, reviewedContentCategory: content, reviewedDifficulty: studyUsDifficulty, reviewedAnswer: answer, correctionNotes: correctionNotes.trim() || null, attentionPoints: attention } }
      : {};
    // Pilot: the validated difficulty is the reviewer's StudyUs difficulty (sent in the assessment, never a default).
    const body = decision === 'APPROVED' ? { decision, notes: notes || undefined, ...(pilot ? {} : { validatedDifficulty: difficulty }), usage, alignment, ...list, ...assessment } : { decision, notes, ...list, ...assessment };
    const r = await fetch(`/api/admin/question-bank/questions/${versionId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    setMsg(r?.ok ? 'Decisión registrada.' : `${ERRORS[j?.error] ?? `No se pudo registrar (${j?.error ?? 'error'}).`}${j?.detail ? ` [${j.detail}]` : ''}`);
    router.refresh();
  };
  const mockUse = usage.some((u) => u === 'REDUCED_MOCK' || u === 'FULL_MOCK');
  return (
    <section className="card" style={{ padding: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)', fontSize: 13.5 }} aria-label="Revisión académica">
      <h2 style={{ fontSize: 15, margin: 0 }}>Revisión académica</h2>
      {pilot && <p style={{ margin: 0, color: 'var(--text-muted)' }}>La validación automática no equivale a una aprobación humana. Cada punto requiere tu decisión explícita.</p>}
      {checklist.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 6 }}>
          <legend>Lista de revisión (piloto)</legend>
          {checklist.map((c) => (
            <div key={c.key} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <span>{c.label}</span>
              <YesNo name={`cl-${c.key}`} value={checked[c.key]} onChange={(v) => setChecked((x) => ({ ...x, [c.key]: v }))} />
            </div>
          ))}
        </fieldset>
      )}
      {pilot && (
        <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 6 }}>
          <legend>Tu clasificación (propuesta del generador entre paréntesis)</legend>
          <label>
            Competencia{' '}
            <select value={competency} onChange={(e) => setCompetency(e.target.value)}>
              <option value="" disabled>— elige —</option>
              {pilot.competencyOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>{' '}
            <span style={{ color: 'var(--text-muted)' }}>({pilot.competencyOptions.find((o) => o.key === pilot.proposal.competency)?.label ?? 'sin etiqueta'})</span>
          </label>
          <label>
            Categoría de contenido{' '}
            <select value={content} onChange={(e) => setContent(e.target.value)}>
              <option value="" disabled>— elige —</option>
              {pilot.contentOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>{' '}
            <span style={{ color: 'var(--text-muted)' }}>({pilot.contentOptions.find((o) => o.key === pilot.proposal.contentCategory)?.label ?? 'sin etiqueta'})</span>
          </label>
          <label>
            Dificultad StudyUs{' '}
            <select value={studyUsDifficulty} onChange={(e) => setStudyUsDifficulty(e.target.value)}>
              <option value="" disabled>— elige —</option>
              {DIFFICULTIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>{' '}
            <span style={{ color: 'var(--text-muted)' }}>({DIFFICULTIES.find(([k]) => k === pilot.proposal.difficulty)?.[1] ?? 'sin dato'}; nunca un nivel de desempeño Icfes)</span>
          </label>
          <label>
            Respuesta correcta según tu revisión{' '}
            <select value={answer} onChange={(e) => setAnswer(e.target.value)}>
              <option value="" disabled>— elige —</option>
              {pilot.options.map((o) => <option key={o.id} value={o.id}>{o.id}</option>)}
              <option value={NO_SINGLE_ANSWER}>Ninguna o más de una</option>
            </select>
          </label>
        </fieldset>
      )}
      {pilot && pilot.attentionPoints.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 6 }}>
          <legend>Puntos de atención de la pre-revisión automática (confirma o descarta cada uno)</legend>
          {pilot.attentionPoints.map((p) => (
            <div key={p.code} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <span>{p.text}</span>
              <YesNo name={`ap-${p.code}`} value={attention[p.code] === undefined ? undefined : attention[p.code] === 'CONFIRMED'} onChange={(v) => setAttention((x) => ({ ...x, [p.code]: v ? 'CONFIRMED' : 'NOT_CONFIRMED' }))} yes="Confirmo" no="No confirmo" />
            </div>
          ))}
        </fieldset>
      )}
      {!pilot && (
        <label>
          Dificultad validada{' '}
          <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            <option value={2}>Baja</option>
            <option value={3}>Media</option>
            <option value={4}>Alta</option>
          </select>
        </label>
      )}
      <fieldset style={{ border: 0, padding: 0, display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <legend>Uso</legend>
        {USAGES.map(([k, label]) => (
          <label key={k} style={{ display: 'inline-flex', gap: 4 }}>
            <input type="checkbox" checked={usage.includes(k)} onChange={(e) => setUsage((u) => (e.target.checked ? [...u, k] : u.filter((x) => x !== k)))} /> {label}
          </label>
        ))}
      </fieldset>
      <label>
        Alineación con el examen{' '}
        <select value={alignment} onChange={(e) => setAlignment(e.target.value)}>
          <option value="PRACTICE">Práctica</option>
          <option value="EXAM_STYLE">Estilo examen</option>
          <option value="MOCK_READY">Apta para simulacro</option>
          {official && <option value="OFFICIAL">Oficial</option>}
        </select>
      </label>
      {mockUse && alignment !== 'MOCK_READY' && alignment !== 'OFFICIAL' && <span style={{ color: 'var(--warning)' }}>El uso en simulacro requiere «Apta para simulacro».</span>}
      <label>
        {pilot ? 'Comentario / motivo' : 'Notas'}{' '}
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%' }} placeholder="Obligatorias para solicitar corrección (comentario) o rechazar (motivo)" />
      </label>
      {pilot && (
        <label>
          Notas de corrección{' '}
          <textarea value={correctionNotes} onChange={(e) => setCorrectionNotes(e.target.value)} rows={2} style={{ width: '100%' }} placeholder="Obligatorias para solicitar corrección: qué hay que cambiar" />
        </label>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy || usage.length === 0 || !checklistComplete || !canApprove} onClick={() => send('APPROVED')}>Aprobar</button>
        <button className="btn btn-secondary" disabled={busy || !canCorrect} onClick={() => send('CORRECTION_REQUESTED')}>Solicitar corrección</button>
        <button className="btn btn-ghost" disabled={busy || !canReject} onClick={() => send('REJECTED')}>Rechazar</button>
      </div>
      {msg && <span style={{ color: 'var(--text-muted)' }}>{msg}</span>}
    </section>
  );
}
