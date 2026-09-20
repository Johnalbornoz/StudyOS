/**
 * F13 -- Design System Consolidation. Wraps the EXISTING `.empty-state`
 * CSS class. Every empty state names WHAT is empty and, where one
 * exists, the next valid action (task section 26) -- never a bare
 * "No data."
 */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}
