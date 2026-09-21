import Link from 'next/link';

/**
 * Onboarding/authorization rework (2026-09-21) -- the visible cue for
 * "estudiante en modo demostración / sin licencia" (task's own
 * required minimum UX state). Purely informational: the actual block
 * on premium routes is server-side (`canUseCapability` inside each
 * route handler, e.g. src/app/api/quizzes/generate/route.ts) and does
 * not depend on this banner being shown or clicked.
 */
export default function LicenseBanner({ message, cta }: { message: string; cta: string }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        marginBottom: 'var(--space-4)',
        borderRadius: 8,
        background: 'var(--warning-bg, #fff7ed)',
        border: '1px solid var(--warning-border, #fdba74)',
        color: 'var(--warning-ink, #9a3412)',
        fontSize: 14,
      }}
    >
      <span>{message}</span>
      <Link href="/dashboard/billing" className="btn" style={{ whiteSpace: 'nowrap' }}>
        {cta}
      </Link>
    </div>
  );
}
