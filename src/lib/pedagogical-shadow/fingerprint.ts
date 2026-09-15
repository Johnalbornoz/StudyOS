/**
 * CANON-R3 -- a small, deterministic, non-cryptographic hash (FNV-1a),
 * intentionally duplicated from the same technique
 * `src/lib/pedagogical-engine/engine.ts` uses internally for its own
 * `canonicalRevision`, rather than importing it -- the pure engine's
 * own internals stay untouched and unreferenced by this integration
 * layer (see MODULE DEPENDENCY RULES in both reports). Zero
 * dependencies; safe for any plain JSON-serializable input.
 */
export function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
