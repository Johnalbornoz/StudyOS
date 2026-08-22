/**
 * Deterministic accent color per subject, so subjects are visually
 * distinguishable at a glance (dashboard cards, subject page header)
 * without needing a color picker or a DB column -- the same subject
 * id always maps to the same color.
 */

const PALETTE = [
  '#2F6B5E', // brand teal
  '#4A5FBF', // indigo
  '#B8722E', // amber/terracotta
  '#8A4FBF', // plum
  '#3D7A9E', // slate blue
  '#A14444', // rust
  '#5C7A3D', // moss
  '#B0558A', // mauve
];

export function getSubjectAccentColor(subjectId: string): string {
  let hash = 0;
  for (let i = 0; i < subjectId.length; i++) {
    hash = (hash * 31 + subjectId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
