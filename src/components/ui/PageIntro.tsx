import type { ReactNode } from 'react';

/**
 * UX-2 -- the page intro shared by the primary Student destinations
 * (Mi ruta, Progreso, Preparación de examen): optional breadcrumb, one
 * <h1>, a lead line and optional actions. Hoy keeps its own greeting
 * intro but uses the same type scale.
 */
export function PageIntro({ title, lead, crumb, actions }: { title: string; lead?: string; crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ui-intro">
      <div className="ui-intro-text">
        {crumb && <p className="ui-intro-crumb">{crumb}</p>}
        <h1>{title}</h1>
        {lead && <p className="ui-intro-lead">{lead}</p>}
      </div>
      {actions && <div className="ui-intro-actions">{actions}</div>}
    </header>
  );
}
