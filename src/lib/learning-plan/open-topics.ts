/**
 * T1 UI polish (M02b) -- which curriculum topics the Student has expanded (pure helpers).
 *
 * Adding a concept refreshes the page's server data; the topic the Student was working in must stay
 * expanded, with its sibling concepts still visible. The open set is component state, mirrored in
 * sessionStorage so it also survives a remount of the section (the page can move it when its layout
 * changes, e.g. the first concept of a subject). A per-viewer convenience only: nothing is stored
 * server-side, and the page works the same when storage is unavailable.
 */
export const OPEN_TOPICS_STORAGE_PREFIX = 'studyus.learn.openTopics:';

export function openTopicsStorageKey(subjectId: string): string {
  return `${OPEN_TOPICS_STORAGE_PREFIX}${subjectId}`;
}

/** The next open set after a topic is opened / closed (a new array; order of opening kept). */
export function toggleOpenTopic(open: readonly string[], topicKey: string, isOpen: boolean): string[] {
  const without = open.filter((k) => k !== topicKey);
  return isOpen ? [...without, topicKey] : without;
}

/** Stored value -> topic keys that still exist. Anything unreadable is "nothing open". */
export function parseOpenTopics(raw: string | null | undefined, existing: readonly string[]): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(existing);
    return parsed.filter((k): k is string => typeof k === 'string' && known.has(k));
  } catch {
    return [];
  }
}
