import type { getMessages } from '@/lib/i18n/messages';
import { getDifficultyPresentation, formatDifficultyCompact, formatDifficultyAccessible } from '@/lib/lx/difficulty-presentation';

/**
 * UX/CANON-R1 PART C/S -- the shared, reusable difficulty indicator for
 * every learner-facing question/activity surface. Presentation only:
 * it renders exactly the canonical `difficulty` value it's given, never
 * computes or infers one. Secondary to the question (small, muted,
 * never dominant), not a control (plain text, no interactive role, not
 * keyboard-focusable), never relies on color alone (the compact text
 * itself carries the number and tier name; a fuller sr-only string
 * carries the same information in natural language for assistive
 * tech). `title` reuses this file's existing native-tooltip
 * convention (see the calculatorAllowed indicator below) rather than
 * adding a new tooltip dependency.
 *
 * `t` MUST be the ACTIVITY-language message set (PART F) -- the
 * caller's own `at`, never the shell/interface locale's messages.
 */
export default function DifficultyBadge({ difficulty, t }: { difficulty: number; t: ReturnType<typeof getMessages> }) {
  const presentation = getDifficultyPresentation(difficulty, t);
  const visible = formatDifficultyCompact(presentation, t);
  const accessible = formatDifficultyAccessible(presentation, t);
  return (
    <span title={t['difficulty.autoAdjustExplanation']} style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{accessible}</span>
    </span>
  );
}
