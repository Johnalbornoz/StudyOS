'use client';

/**
 * Exam Prep -- the "⋯" menu of one exam preparation (dashboard card and
 * detail page): "Quitar de mi preparación" and "Empezar de nuevo". Each asks
 * for an in-page confirmation saying that results and learning are kept; with
 * a simulation in progress it also requires an explicit tick acknowledging
 * that the attempt will be cancelled.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type L = Record<string, string>;
type Action = 'remove' | 'restart';

export function ProfileMenu({
  profileId,
  examName,
  hasInProgress: initialInProgress,
  labels: l,
  afterRemove,
  actions = ['remove', 'restart'],
  onRemoved,
}: {
  profileId: string;
  examName: string;
  hasInProgress: boolean;
  labels: L;
  /** Where to go after removing it: stay (the card disappears) or back to the dashboard (detail page). */
  afterRemove: 'stay' | 'dashboard';
  actions?: Action[];
  onRemoved?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [inProgress, setInProgress] = useState(initialInProgress);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
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

  function ask(action: Action) {
    setOpen(false);
    setAck(false);
    setError(null);
    setConfirming(action);
  }

  async function confirm() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(confirming === 'remove' ? `/api/exam-profiles/${profileId}` : `/api/exam-profiles/${profileId}/restart`, {
        method: confirming === 'remove' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, confirmInProgress: inProgress && ack }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok) {
        // A simulation was started meanwhile (e.g. in another tab): ask for the extra confirmation.
        if (b?.error === 'IN_PROGRESS_CONFIRMATION_REQUIRED') {
          setInProgress(true);
          setAck(false);
          return;
        }
        setError(l['examPrep.profile.error']);
        return;
      }
      setConfirming(null);
      if (confirming === 'restart') {
        router.push(`/dashboard/exam-prep/${b.data.newProfileId}`);
        return;
      }
      onRemoved?.();
      if (afterRemove === 'dashboard') router.push('/dashboard/exam-prep');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const blocked = inProgress && !ack;
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
          {actions.includes('restart') && (
            <button ref={actions[0] === 'restart' ? firstItem : undefined} type="button" role="menuitem" className="exv2-menu-item" onClick={() => ask('restart')}>
              {l['examPrep.profile.restart.action']}
            </button>
          )}
          {actions.includes('remove') && (
            <button ref={actions[0] === 'remove' ? firstItem : undefined} type="button" role="menuitem" className="exv2-menu-item is-danger" onClick={() => ask('remove')}>
              {l['examPrep.profile.remove.action']}
            </button>
          )}
        </div>
      )}
      {confirming && (
        <div className="exv2-confirm" role="alertdialog" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`}>
          <p id={`${id}-t`} className="exv2-confirm-title">{l[`examPrep.profile.${confirming}.title`]}</p>
          <p id={`${id}-b`} className="ui-hint">{l[`examPrep.profile.${confirming}.body`]}</p>
          {inProgress && (
            <>
              <p className="exv2-note is-warn" role="note">{l[`examPrep.profile.${confirming}.inProgress`]}</p>
              <label className="exv2-ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {l['examPrep.profile.inProgress.ack']}
              </label>
            </>
          )}
          <div className="xr-next-actions">
            <button type="button" className={confirming === 'remove' ? 'btn btn-danger' : 'btn btn-primary'} onClick={confirm} disabled={busy || blocked}>
              {l[`examPrep.profile.${confirming}.cta`]}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(null)} disabled={busy}>{l['exv2.delete.no']}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="xr-error">{error}</p>}
    </div>
  );
}
