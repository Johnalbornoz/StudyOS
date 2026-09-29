import type { ReactNode } from 'react';

/**
 * UX-2 -- a titled page section: one semantic <h2>, an optional trailing
 * action (link), and its content. Keeps section hierarchy consistent
 * without each page hand-styling its own headings.
 */
export function Section({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className="ui-section" aria-labelledby={headingId}>
      <div className="ui-section-head">
        <h2 className="ui-section-title" id={headingId}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
