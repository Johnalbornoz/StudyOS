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
  <span className="qbr-yesno">
    <label><input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> {yes}</label>
    <label><input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> {no}</label>
  </span>
);

/** One Sí / No decision as its own fieldset (legend = the question asked). Presentational only. */
const DecisionTile = ({ name, legend, value, onChange, yes, no, children }: { name: string; legend: string; value: boolean | undefined; onChange: (v: boolean) => void; yes?: string; no?: string; children?: React.ReactNode }) => (
  <fieldset className={`qbr-tile${value === undefined ? '' : ' qbr-tile--done'}`}>
    <legend>{legend}</legend>
    {children}
    <YesNo name={name} value={value} onChange={onChange} yes={yes} no={no} />
    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{value === undefined ? 'Pendiente' : 'Respondido'}</span>
  </fieldset>
);

/** The automated pre-review, shown to the human as REFERENCE (never a decision). */
export interface AutomatedReviewProps {
  result: string;
  findings: Array<{ code: string; severity: string }>;
  validatorSummary: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Approve / Request correction / Reject, with the reviewer's difficulty, use and alignment. */
export function ReviewActions({ versionId, initial, official, checklist = [], pilot = null, automated = null }: { versionId: string; initial: { difficulty: number | null; usage: string[]; alignment: string }; official: boolean; checklist?: Array<{ key: string; label: string }>; pilot?: PilotReviewProps | null; automated?: AutomatedReviewProps | null }) {
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
  // Progress and what is still missing -- read from the SAME booleans that gate the buttons (no new rule).
  const answeredCount = checklist.filter((c) => typeof checked[c.key] === 'boolean').length;
  const failedCount = checklist.filter((c) => checked[c.key] === false).length;
  const classificationMissing = !!pilot && (!competency || !content || !studyUsDifficulty || !answer);
  const attentionMissing = pilot ? pilot.attentionPoints.filter((p) => !attention[p.code]).length : 0;
  const missingForApproval = [
    ...(checklist.length - answeredCount > 0 ? [plural(checklist.length - answeredCount, 'criterio', 'criterios')] : []),
    ...(attentionMissing > 0 ? [plural(attentionMissing, 'punto de atención', 'puntos de atención')] : []),
    ...(classificationMissing ? ['la clasificación del revisor'] : []),
    ...(usage.length === 0 ? ['al menos un uso'] : []),
  ];
  const approvalStatus = failedCount > 0
    ? `No se puede aprobar: ${plural(failedCount, 'criterio marcado', 'criterios marcados')} «No».`
    : missingForApproval.length
      ? `Para aprobar aún faltan: ${missingForApproval.join(', ').replace(/, ([^,]*)$/, ' y $1')}.`
      : 'Listo para aprobar.';
  const correctionStatus = gated && anyFailed
    ? `Para solicitar corrección: comentario${pilot ? ' y notas de corrección' : ''}. Para rechazar: comentario con el motivo.`
    : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} aria-label="Revisión académica">
      {(automated || (pilot && pilot.attentionPoints.length > 0)) && (
        <section className="card qbr-card" aria-labelledby="qbr-auto">
          <h2 id="qbr-auto">Revisión automática</h2>
          <p className="qbr-sub">La validación automática no equivale a una aprobación humana. Úsala solo como referencia.</p>
          {automated && (
            <div className="qbr-chips" style={{ marginBottom: 'var(--space-3)' }}>
              <span className={`chip ${automated.result === 'PASS' ? 'chip-good' : 'chip-warn'}`}>Validación automática: {automated.result === 'PASS' ? 'Superada' : automated.result === 'NOT_APPLICABLE' ? 'No aplica' : 'No superada'}</span>
              <span className="chip">{plural(automated.findings.length, 'hallazgo', 'hallazgos')}</span>
              {automated.findings.map((f) => <span key={f.code} className="chip">{f.code}{f.severity === 'WARN' ? ' (aviso)' : ''}</span>)}
            </div>
          )}
          {automated?.validatorSummary && <p style={{ margin: '0 0 var(--space-3)', fontSize: 14 }}>{automated.validatorSummary}</p>}
          {pilot && pilot.attentionPoints.length > 0 && (
            <>
              <p className="qbr-kicker">Puntos de atención — confirma o descarta cada uno</p>
              <div className="qbr-grid-3">
                {pilot.attentionPoints.map((p, n) => (
                  <DecisionTile key={p.code} name={`ap-${p.code}`} legend={`${n + 1}. ${p.text}`} value={attention[p.code] === undefined ? undefined : attention[p.code] === 'CONFIRMED'} onChange={(v) => setAttention((x) => ({ ...x, [p.code]: v ? 'CONFIRMED' : 'NOT_CONFIRMED' }))} yes="Confirmo" no="No confirmo" />
                ))}
              </div>
            </>
          )}
        </section>
      )}
      {checklist.length > 0 && (
        <section className="card qbr-card" aria-labelledby="qbr-checklist">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <h2 id="qbr-checklist">Revisión académica</h2>
            <strong aria-live="polite">{answeredCount} / {checklist.length} revisados</strong>
          </div>
          <p className="qbr-sub">Valida cada criterio antes de tomar una decisión. La revisión automática es solo una referencia.</p>
          <div className="qbr-grid-3">
            {checklist.map((c) => (
              <DecisionTile key={c.key} name={`cl-${c.key}`} legend={c.label} value={checked[c.key]} onChange={(v) => setChecked((x) => ({ ...x, [c.key]: v }))} />
            ))}
          </div>
        </section>
      )}
      <section className="card qbr-card" aria-labelledby="qbr-classification">
        <h2 id="qbr-classification">{pilot ? 'Tu clasificación' : 'Revisión académica'}</h2>
        {pilot && (
          <>
            <p className="qbr-sub">Lo que tú determinas. La propuesta del generador aparece entre paréntesis; nada viene seleccionado.</p>
            <div className="qbr-grid-4" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="qbr-field">
                Competencia
                <select value={competency} onChange={(e) => setCompetency(e.target.value)}>
                  <option value="" disabled>— elige —</option>
                  {pilot.competencyOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <small>(propuesta: {pilot.competencyOptions.find((o) => o.key === pilot.proposal.competency)?.label ?? 'sin etiqueta'})</small>
              </label>
              <label className="qbr-field">
                Categoría de contenido
                <select value={content} onChange={(e) => setContent(e.target.value)}>
                  <option value="" disabled>— elige —</option>
                  {pilot.contentOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <small>(propuesta: {pilot.contentOptions.find((o) => o.key === pilot.proposal.contentCategory)?.label ?? 'sin etiqueta'})</small>
              </label>
              <label className="qbr-field">
                Dificultad StudyUs
                <select value={studyUsDifficulty} onChange={(e) => setStudyUsDifficulty(e.target.value)}>
                  <option value="" disabled>— elige —</option>
                  {DIFFICULTIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <small>(propuesta: {DIFFICULTIES.find(([k]) => k === pilot.proposal.difficulty)?.[1] ?? 'sin dato'}; nunca un nivel de desempeño Icfes)</small>
              </label>
              <label className="qbr-field">
                Respuesta correcta según tu revisión
                <select value={answer} onChange={(e) => setAnswer(e.target.value)}>
                  <option value="" disabled>— elige —</option>
                  {pilot.options.map((o) => <option key={o.id} value={o.id}>{o.id}</option>)}
                  <option value={NO_SINGLE_ANSWER}>Ninguna o más de una</option>
                </select>
              </label>
            </div>
          </>
        )}
        {!pilot && (
          <label className="qbr-field" style={{ maxWidth: 280, marginBottom: 'var(--space-4)' }}>
            Dificultad validada
            <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
              <option value={2}>Baja</option>
              <option value={3}>Media</option>
              <option value={4}>Alta</option>
            </select>
          </label>
        )}
        <div className="qbr-grid-4" style={{ alignItems: 'start' }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0, gridColumn: 'span 2', minWidth: 0 }}>
            <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Uso</legend>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', fontSize: 14 }}>
              {USAGES.map(([k, label]) => (
                <label key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 32 }}>
                  <input type="checkbox" checked={usage.includes(k)} onChange={(e) => setUsage((u) => (e.target.checked ? [...u, k] : u.filter((x) => x !== k)))} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="qbr-field">
            Alineación con el examen
            <select value={alignment} onChange={(e) => setAlignment(e.target.value)}>
              <option value="PRACTICE">Práctica</option>
              <option value="EXAM_STYLE">Estilo examen</option>
              <option value="MOCK_READY">Apta para simulacro</option>
              {official && <option value="OFFICIAL">Oficial</option>}
            </select>
          </label>
        </div>
        {mockUse && alignment !== 'MOCK_READY' && alignment !== 'OFFICIAL' && <p style={{ color: 'var(--warning)', margin: 'var(--space-2) 0 0' }}>El uso en simulacro requiere «Apta para simulacro».</p>}
      </section>
      <section className="card qbr-card" aria-labelledby="qbr-notes">
        <h2 id="qbr-notes">Observaciones del revisor</h2>
        <div className={pilot ? 'qbr-grid-4' : undefined} style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <label className="qbr-field" style={pilot ? { gridColumn: 'span 2' } : undefined}>
            {pilot ? 'Comentario / motivo' : 'Notas'}
            <small>Explica tu decisión. Obligatorio para solicitar corrección o rechazar.</small>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Obligatorias para solicitar corrección (comentario) o rechazar (motivo)" />
          </label>
          {pilot && (
            <label className="qbr-field" style={{ gridColumn: 'span 2' }}>
              Notas de corrección
              <small>Instrucciones concretas de qué cambiar. Obligatorias para solicitar corrección.</small>
              <textarea value={correctionNotes} onChange={(e) => setCorrectionNotes(e.target.value)} rows={4} placeholder="Obligatorias para solicitar corrección: qué hay que cambiar" />
            </label>
          )}
        </div>
      </section>
      <div className="qbr-decision" role="region" aria-label="Decisión">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14, minWidth: 0 }}>
          <strong>Estado de revisión{checklist.length > 0 ? `: ${answeredCount} de ${checklist.length} criterios completados` : ''}</strong>
          <span id="qbr-approval-status" aria-live="polite" style={{ color: 'var(--text-muted)' }}>{approvalStatus}</span>
          {correctionStatus && <span id="qbr-correction-status" style={{ color: 'var(--text-muted)' }}>{correctionStatus}</span>}
          {msg && <span role="status">{msg}</span>}
        </div>
        <div className="qbr-decision-actions">
          <button className="btn btn-ghost qbr-btn-reject" disabled={busy || !canReject} aria-describedby={correctionStatus ? 'qbr-correction-status' : undefined} onClick={() => send('REJECTED')}>Rechazar</button>
          <button className="btn btn-secondary" disabled={busy || !canCorrect} aria-describedby={correctionStatus ? 'qbr-correction-status' : undefined} onClick={() => send('CORRECTION_REQUESTED')}>Solicitar corrección</button>
          <button className="btn btn-primary" disabled={busy || usage.length === 0 || !checklistComplete || !canApprove} aria-describedby="qbr-approval-status" onClick={() => send('APPROVED')}>Aprobar</button>
        </div>
      </div>
    </div>
  );
}
