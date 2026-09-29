import type { ReactNode } from 'react';
import type { ActivityKind } from '@/lib/experience/learning-session';

/**
 * UX-3 -- the focused learning-session header, shared by every activity.
 *
 * kind kicker (Entrénalo / Demuéstralo / …) · concept · subject context ·
 * purpose line · position inside the activity. Presentation only: every
 * value arrives already resolved (the activity kind from the launched
 * mode, the position from the question batch the server returned).
 * Exit lives in the Focus Mode bar, so there is no navigation here.
 */
export function SessionHeader({
  kind,
  kindLabel,
  title,
  context,
  purpose,
  progress,
  tools,
}: {
  kind: ActivityKind;
  kindLabel: string;
  title: string;
  context?: string | null;
  purpose?: string | null;
  /** 1-based position; omitted before questions exist (teaching, preparing, results). */
  progress?: { current: number; total: number; text: string; label: string } | null;
  tools?: ReactNode;
}) {
  const pct = progress && progress.total > 0 ? Math.min(100, Math.max(0, (progress.current / progress.total) * 100)) : 0;
  return (
    <header className="ls-head" data-kind={kind}>
      <div className="ls-head-row">
        <span className="ls-kicker">{kindLabel}</span>
        {tools && <div className="ls-head-tools">{tools}</div>}
      </div>
      <h1 className="ls-title">{title}</h1>
      {context && context !== title && <p className="ls-context">{context}</p>}
      {purpose && <p className="ls-purpose">{purpose}</p>}
      {progress && progress.total > 0 && (
        <div className="ls-progress">
          <span className="ls-progress-count">{progress.text}</span>
          <span
            className="ls-progress-track"
            role="progressbar"
            aria-label={progress.label}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.current}
            aria-valuetext={progress.text}
          >
            <span className="ls-progress-fill" style={{ width: `${pct}%` }} />
          </span>
        </div>
      )}
    </header>
  );
}
