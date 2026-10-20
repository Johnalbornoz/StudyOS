'use client';

/**
 * REM-T1-02 -- the two Student contexts. One click = one decision: the choice
 * is saved and the Student moves straight to that context's next step (the
 * same interaction for both cards, so no persistent selected state is needed;
 * the previously saved choice is marked when the Student comes back).
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, GraduationCap, Target } from 'lucide-react';

type ContextType = 'ACADEMIC' | 'EXAM_PREP';

export default function StudentContextChoice({ labels: l, current }: { labels: Record<string, string>; current: ContextType | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<ContextType | null>(null);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  async function choose(contextType: ContextType) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(contextType);
    setError(false);
    try {
      const r = await fetch('/api/student/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextType }) });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.data?.next) throw new Error();
      router.push(b.data.next);
      router.refresh();
    } catch {
      setError(true);
      setBusy(null);
      inFlight.current = false;
    }
  }

  const card = (type: ContextType, icon: React.ReactNode) => (
    <button
      type="button"
      className="card prep-start-option"
      data-context={type}
      aria-current={current === type ? 'true' : undefined}
      disabled={!!busy}
      aria-busy={busy === type}
      onClick={() => choose(type)}
      style={{ textAlign: 'left', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', border: current === type ? '1px solid var(--brand)' : undefined }}
    >
      <span aria-hidden>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <strong>{l[`acp.ctx.${type}`]}</strong>
        <span className="ui-hint">{l[`acp.ctx.${type}.hint`]}</span>
      </span>
      <ArrowRight size={18} strokeWidth={2} aria-hidden />
    </button>
  );

  return (
    <section className="prep-start" aria-label={l['acp.ctx.title']}>
      <div className="prep-start-options">
        {card('ACADEMIC', <GraduationCap size={22} strokeWidth={2} />)}
        {card('EXAM_PREP', <Target size={22} strokeWidth={2} />)}
      </div>
      {error ? <p className="ui-hint ta-msg-error" role="alert">{l['acp.ctx.error']}</p> : null}
    </section>
  );
}
