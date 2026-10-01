/**
 * Track A product amendment (2026-10-01) -- ONE primary persona per account.
 *
 * This used to be a workspace switcher with an "add another role" link
 * (F13 / Foundation F6). Personas are no longer additive, so there is
 * nothing to switch between and nothing to add: the shell shows, plainly,
 * which persona the account is (Estudiante / Familia / Profesor) or which
 * capability context is open (Institución / Administración). Capabilities
 * are reached through ordinary navigation links (dashboard layout), never
 * through a persona-like selector. Server-rendered; no client state.
 */
export type WorkspaceOption = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION' | 'ADMIN';

export default function WorkspaceSwitcher({ label, ariaLabel }: { label: string; ariaLabel: string }) {
  return (
    <div className="lx-workspace-indicator" aria-label={ariaLabel}>
      {label}
    </div>
  );
}
