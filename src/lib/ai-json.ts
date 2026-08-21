/**
 * Claude sometimes wraps JSON responses in markdown code fences
 * (```json ... ```) even when explicitly asked for raw JSON.
 * Strip those before parsing.
 */
export function parseAIJson<T = any>(text: string): T {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  return JSON.parse(stripped);
}
