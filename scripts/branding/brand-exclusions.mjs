/**
 * Paths where "StudyUS" is TECHNICAL or DATA-BACKED and must not be renamed by
 * the branding codemod (shared by the codemod and the brand regression guard).
 */
export const BRAND_EXCLUSIONS = [
  // Persisted exam content with configuration fingerprints (re-apply would refuse).
  /^src\/lib\/exam-core\/verticals\//,
  /^src\/lib\/exam-core\/catalog\//,
  /^src\/lib\/exam-core\/aice\/.*\.generated\.ts$/,
  /\.generated\.ts$/,
  // AI prompt templates (prompt-versioned; not rendered UI).
  /^src\/lib\/exam-core\/question-bank\/prompts\.ts$/,
  /^src\/lib\/ai\/prompts\//,
  // The branding tooling and guard themselves name the old spelling on purpose.
  /^tests\/unit\/brand-guard\.test\.ts$/,
];
