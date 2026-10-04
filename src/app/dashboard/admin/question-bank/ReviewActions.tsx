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
};

/** Approve / Request correction / Reject, with the reviewer's difficulty, use and alignment. */
export function ReviewActions({ versionId, initial, official }: { versionId: string; initial: { difficulty: number | null; usage: string[]; alignment: string }; official: boolean }) {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<number>(initial.difficulty ?? 3);
  const [usage, setUsage] = useState<string[]>(initial.usage);
  const [alignment, setAlignment] = useState<string>(initial.alignment);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async (decision: 'APPROVED' | 'CORRECTION_REQUESTED' | 'REJECTED') => {
    setBusy(true);
    setMsg(null);
    const body = decision === 'APPROVED' ? { decision, notes: notes || undefined, validatedDifficulty: difficulty, usage, alignment } : { decision, notes };
    const r = await fetch(`/api/admin/question-bank/questions/${versionId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    setMsg(r?.ok ? 'Decisión registrada.' : ERRORS[j?.error] ?? `No se pudo registrar (${j?.error ?? 'error'}).`);
    router.refresh();
  };
  const mockUse = usage.some((u) => u === 'REDUCED_MOCK' || u === 'FULL_MOCK');
  return (
    <section className="card" style={{ padding: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)', fontSize: 13.5 }} aria-label="Revisión académica">
      <h2 style={{ fontSize: 15, margin: 0 }}>Revisión académica</h2>
      <label>
        Dificultad validada{' '}
        <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
          <option value={2}>Baja</option>
          <option value={3}>Media</option>
          <option value={4}>Alta</option>
        </select>
      </label>
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
        Notas{' '}
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%' }} placeholder="Obligatorias para solicitar corrección o rechazar" />
      </label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy || usage.length === 0} onClick={() => send('APPROVED')}>Aprobar</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => send('CORRECTION_REQUESTED')}>Solicitar corrección</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => send('REJECTED')}>Rechazar</button>
      </div>
      {msg && <span style={{ color: 'var(--text-muted)' }}>{msg}</span>}
    </section>
  );
}
