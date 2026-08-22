'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const DISMISS_KEY = 'studyus.onboarding.dismissed';

interface Step {
  done: boolean;
  title: string;
  body: string;
  cta: string;
  href: string;
}

export default function OnboardingChecklist({
  title,
  steps,
  dismissLabel,
}: {
  title: string;
  steps: Step[];
  dismissLabel: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (dismissed) return null;

  const firstPendingIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="card" style={{ marginBottom: 'var(--space-8)', position: 'relative' }}>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        style={{
          position: 'absolute', top: 'var(--space-4)', right: 'var(--space-4)',
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1,
        }}
      >
        ×
      </button>

      <h2 style={{ fontSize: 16, marginBottom: 'var(--space-4)' }}>{title}</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
            <div
              aria-hidden
              style={{
                flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
                background: step.done ? 'var(--brand)' : 'var(--bg-subtle)',
                color: step.done ? '#fff' : 'var(--text-muted)',
                border: step.done ? 'none' : '1px solid var(--border-default)',
              }}
            >
              {step.done ? '✓' : i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: step.done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: step.done ? 'line-through' : 'none' }}>
                {step.title}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 2 }}>{step.body}</div>
            </div>
            {!step.done && i === firstPendingIndex && (
              <Link href={step.href} className="btn btn-primary" style={{ flexShrink: 0, fontSize: 13 }}>
                {step.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
