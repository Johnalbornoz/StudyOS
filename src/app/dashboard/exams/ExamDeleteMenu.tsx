'use client';

/**
 * Exam history -- the "⋯" menu of one exam row / card. Its one action is
 * named after what deleting means in that state:
 *
 *   NOT_STARTED  "Eliminar examen"              ¿Quieres eliminar este examen?
 *   IN_PROGRESS  "Cancelar y eliminar intento"  No podrás continuar este intento.
 *   COMPLETED    "Eliminar de mi historial"     the result is kept; learning is not lost
 *   ENDED        "Eliminar de mi historial"     (a cancelled / expired attempt)
 *
 * Every state asks for an explicit in-page confirmation (no browser dialog)
 * before calling the owner-only DELETE endpoint with `{ confirm: true }`.
 */
import { useEffect, useId, useRef, useState } from 'react';

type L = Record<string, string>;
export type ExamDeleteKind = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'ENDED';

export function ExamDeleteMenu({ kind, endpoint, examName, labels: l, onDeleted }: { kind: ExamDeleteKind; endpoint: string; examName: string; labels: L; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) {
        setOpen(false);
        if (e instanceof KeyboardEvent) trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
      if (!r.ok) {
        setError(l['exv2.error.generic']);
        return;
      }
      setConfirming(false);
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`exv2-menu${confirming || error ? ' is-expanded' : ''}`} ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="btn btn-ghost exv2-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={`${l['exv2.menu.more']}: ${examName}`}
        title={l['exv2.menu.more']}
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div id={`${id}-menu`} role="menu" className="exv2-menu-list">
          <button
            ref={item}
            type="button"
            role="menuitem"
            className="exv2-menu-item is-danger"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
          >
            {l[`exv2.delete.${kind}.action`]}
          </button>
        </div>
      )}
      {confirming && (
        <div className="exv2-confirm" role="alertdialog" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`}>
          <p id={`${id}-t`} className="exv2-confirm-title">{l[`exv2.delete.${kind}.title`]}</p>
          <p id={`${id}-b`} className="ui-hint">{l[`exv2.delete.${kind}.body`]}</p>
          <div className="xr-next-actions">
            <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={busy}>{l[`exv2.delete.${kind}.action`]}</button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>{l['exv2.delete.no']}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="xr-error">{error}</p>}
    </div>
  );
}
