/**
 * L9 IN-1 -- an email list for a bulk add. Pure (no I/O): the browser uses it to read a pasted
 * or uploaded list, the server uses it again on what it receives (the client is never trusted).
 */

/** At most this many distinct addresses per request. */
export const BULK_EMAIL_LIMIT = 100;

const EMAIL_RE = /^[^\s@<>,;"'()]+@[^\s@<>,;"'()]+\.[^\s@<>,;"'()]+$/;

export function isEmail(value: string): boolean {
  return value.length <= 320 && EMAIL_RE.test(value);
}

/**
 * Entries of a pasted or uploaded list (one per line, or separated by commas / semicolons /
 * spaces; a CSV with other columns works because only the cells containing "@" are kept).
 */
export function parseEmailText(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((cell) => cell.replace(/^[<"'(]+|[>"').]+$/g, ''))
    .filter((cell) => cell.includes('@'));
}

/** Trimmed, lower-cased, de-duplicated; entries that are not an email are returned apart. */
export function normalizeEmailList(entries: readonly string[]): { emails: string[]; invalid: string[] } {
  const emails = new Set<string>();
  const invalid = new Set<string>();
  for (const entry of entries) {
    const value = entry.trim().toLowerCase();
    if (!value) continue;
    if (isEmail(value)) emails.add(value);
    else invalid.add(value.slice(0, 320));
  }
  return { emails: [...emails], invalid: [...invalid] };
}
