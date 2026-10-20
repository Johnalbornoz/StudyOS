/**
 * F6 -- the ONE label set the preparation chooser (ObjectivePicker) reads, for every page that renders it (Exam Prep and
 * Exams). Two hand-written filters drifted: the Exams page omitted acp.prep.*, so the Cambridge family card showed its
 * raw family key, "3 · 91" and an empty button.
 */
export const PREPARATION_CHOOSER_LABEL_PREFIXES = ['prep.', 'elig.', 'acp.prep.', 'exv2.reference.'] as const;

export function preparationChooserLabels(messages: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).filter(([k]) => PREPARATION_CHOOSER_LABEL_PREFIXES.some((p) => k.startsWith(p))));
}
