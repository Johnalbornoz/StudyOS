'use client';

export default function StatusToggle({
  active,
  busy,
  onToggle,
  labelActive,
  labelInactive,
}: {
  active: boolean;
  busy: boolean;
  onToggle: () => void;
  labelActive: string;
  labelInactive: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '5px 12px',
        borderRadius: 'var(--radius-full)',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-base)',
        cursor: busy ? 'default' : 'pointer',
        fontSize: 12.5,
        fontWeight: 650,
        fontFamily: 'inherit',
        color: active ? 'var(--success)' : 'var(--text-muted)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: active ? 'var(--success)' : 'var(--text-muted)',
          flexShrink: 0,
        }}
      />
      {active ? labelActive : labelInactive}
    </button>
  );
}
