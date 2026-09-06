import type { getMessages } from '@/lib/i18n/messages';

/**
 * Phase 6 Closeout A: a presentation-only, in-flow indicator telling
 * the learner whether THIS attempt is assisted or independent, and
 * whether hints / AI help are available.
 *
 * Presentation only. It renders copy the caller has already decided.
 * It contains NO policy: no mastery/retention/hint thresholds, no
 * SupportLevel computation, no EvidenceMode derivation, no call to
 * getTeachingIntent / getLearningDecisions. The server
 * (ai-permission-policy.ts::canUseAI, re-checked in every AI route)
 * remains the sole authority for whether AI can actually be used --
 * this component never gates anything.
 *
 * The caller passes `assistanceMode` / `hintsAvailable` / `context`
 * derived from information it already has (the quiz mode from the URL,
 * or the fixed identity of the Explain / Transfer activity) -- the
 * TeachingIntent.supportLevel tiers (HIGH_SUPPORT / GUIDED /
 * PARTIAL_SUPPORT / MINIMAL_SUPPORT) are deliberately NOT surfaced
 * here: they are shown only by the 6L-B1 remediation shell, and
 * fetching them would add a full getLearningDecisions per activity load.
 *
 * Raw enum values (SupportLevel / EvidenceMode / ActivityType) and any
 * diagnosis (primaryBarrier / misconceptionCode / helpDependencyFlag /
 * calibration) are never rendered.
 */

type Messages = ReturnType<typeof getMessages>;

export type AssistanceMode = 'SUPPORTED' | 'INDEPENDENT';

/**
 * Which explanatory sentence an INDEPENDENT attempt gets. `SOLO` is the
 * neutral default -- "on your own, no hints" without implying a formal
 * exam. `ASSESSMENT` / `DIAGNOSTIC` / `EXPLAIN` swap in wording specific
 * to those activity shapes. Ignored entirely for `SUPPORTED`.
 */
export type LearningSupportContext = 'PRACTICE' | 'SOLO' | 'ASSESSMENT' | 'DIAGNOSTIC' | 'EXPLAIN';

export interface LearningSupportStatusProps {
  assistanceMode: AssistanceMode;
  /** Only meaningful (and only rendered) when assistanceMode === 'SUPPORTED'. */
  hintsAvailable?: boolean;
  /** Picks the INDEPENDENT explanatory sentence. Defaults to 'SOLO'. */
  context?: LearningSupportContext;
  t: Messages;
}

function independentNoteKey(context: LearningSupportContext | undefined): keyof Messages {
  switch (context) {
    case 'ASSESSMENT':
      return 'support.assessmentNote';
    case 'DIAGNOSTIC':
      return 'support.diagnosticNote';
    case 'EXPLAIN':
      return 'support.explainNote';
    default:
      return 'support.independentNote';
  }
}

export default function LearningSupportStatus({ assistanceMode, hintsAvailable, context, t }: LearningSupportStatusProps) {
  const supported = assistanceMode === 'SUPPORTED';
  const title = supported ? t['support.assistedTitle'] : t['support.independentTitle'];
  const note = supported
    ? hintsAvailable
      ? t['support.assistedHintNote']
      : null
    : t[independentNoteKey(context)];

  return (
    <div
      role="note"
      aria-label={title}
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
        marginBottom: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-subtle)',
      }}
    >
      {/* Decorative only -- the text below carries the full meaning. */}
      <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1.3, flexShrink: 0 }}>
        {supported ? '💬' : '✏️'}
      </span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-secondary)' }}>{title}</div>
        {note && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{note}</div>}
      </div>
    </div>
  );
}
