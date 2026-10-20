/**
 * Human Agency P0-4 -- renders the FIXED safety response a route returned
 * (422 { error: 'SAFETY_RESPONSE', safety }). Purely presentational: every
 * string comes from the server's reviewed copy and verified allowlist; this
 * component never composes or fetches crisis content itself.
 */
export interface SafetyNoticeData {
  status: 'SAFETY_SIGNAL' | 'IMMEDIATE_DANGER_SIGNAL';
  title: string;
  body: string;
  resourcesTitle: string | null;
  resources: Array<{ name: string; contactType: string; contactValue: string; availability?: string }>;
  generic: string | null;
  notified: string | null;
  continueText: string;
}

export function safetyFromBody(body: unknown): SafetyNoticeData | null {
  const b = body as { error?: unknown; safety?: unknown } | null;
  return b && b.error === 'SAFETY_RESPONSE' && b.safety && typeof b.safety === 'object' ? (b.safety as SafetyNoticeData) : null;
}

export function SafetyNotice({ safety }: { safety: SafetyNoticeData }) {
  return (
    <div className="card" role="alert" aria-live="assertive" data-testid="safety-notice" data-status={safety.status} style={{ borderLeft: '4px solid var(--warning, #b45309)' }}>
      <strong style={{ display: 'block', marginBottom: 'var(--space-2)' }}>{safety.title}</strong>
      <p style={{ margin: '0 0 var(--space-2)' }}>{safety.body}</p>
      {safety.resourcesTitle && safety.resources.length > 0 && (
        <>
          <p style={{ margin: '0 0 var(--space-1)' }}>{safety.resourcesTitle}</p>
          <ul style={{ margin: '0 0 var(--space-2)', paddingLeft: 20 }}>
            {safety.resources.map((r) => (
              <li key={`${r.name}-${r.contactValue}`}>
                {r.name}: {r.contactValue}
                {r.availability ? ` (${r.availability})` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {safety.generic && <p style={{ margin: '0 0 var(--space-2)' }}>{safety.generic}</p>}
      {safety.notified && <p style={{ margin: '0 0 var(--space-2)' }}>{safety.notified}</p>}
      <p className="ui-hint" style={{ margin: 0 }}>{safety.continueText}</p>
    </div>
  );
}
