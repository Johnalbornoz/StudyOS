/**
 * EA-1 -- canonical JSON and its sha256 (pure; hashing is computation, not IO).
 *
 * The same technique as the generation harness (`generator/provider.ts`): object keys sorted at every depth,
 * `undefined` members dropped, one value -> one text -> one hash. It is restated here, not imported, because the
 * dependency runs the other way: the Production OS consumes an adaptation specification, and the adaptation
 * engine must not depend on the Production OS. A test proves the two implementations give the same hash.
 */
import { createHash } from 'crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export const sha256OfCanonicalJson = (value: unknown): string => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

/** Freezes a value and everything it holds. A specification is an immutable generation input. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
