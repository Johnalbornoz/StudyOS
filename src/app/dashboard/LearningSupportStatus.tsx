import { MessageCircle, PenLine } from 'lucide-react';
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

  // UX-3: one quiet line (icon · title · note) -- the session header
  // already frames the activity, so this is context, not a banner.
  const Icon = supported ? MessageCircle : PenLine;
  return (
    <div role="note" aria-label={title} className="ls-support" data-mode={supported ? 'supported' : 'independent'}>
      {/* Decorative only -- the text carries the full meaning. */}
      <span className="ls-support-icon" aria-hidden><Icon size={16} strokeWidth={2} /></span>
      <p className="ls-support-text">
        <strong>{title}</strong>
        {note && <span> · {note}</span>}
      </p>
    </div>
  );
}
