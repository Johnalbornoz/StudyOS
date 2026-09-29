import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * UX-2 -- the one inline alert. A failed read must look like a failure,
 * never like "no data": pages render this (tone="error") with a retry
 * action instead of an empty state. `role="alert"` only for errors so a
 * screen reader interrupts for failures, not for informational notes.
 */
export function InlineAlert({
  tone,
  title,
  body,
  actions,
}: {
  tone: 'error' | 'warning' | 'info';
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'warning' ? AlertTriangle : Info;
  return (
    <div className={`ui-alert ui-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="ui-alert-icon" size={20} strokeWidth={2} aria-hidden />
      <div className="ui-alert-body">
        <div className="ui-alert-title">{title}</div>
        {body && <div className="ui-alert-text">{body}</div>}
        {actions && <div className="ui-alert-actions">{actions}</div>}
      </div>
    </div>
  );
}
