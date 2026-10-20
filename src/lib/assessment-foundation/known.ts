/**
 * B1 -- explicit knowledge semantics for the canonical assessment contracts.
 *
 * A contract field whose source data may be absent is never filled with a default: it is KNOWN (with its
 * value), UNKNOWN (the source does not record it) or NOT_APPLICABLE (the notion does not exist for this
 * kind of thing). A consumer that needs the value must handle the other two.
 */
export type Known<T> = { state: 'KNOWN'; value: T } | { state: 'UNKNOWN' } | { state: 'NOT_APPLICABLE' };

export const known = <T>(value: T): Known<T> => ({ state: 'KNOWN', value });
export const UNKNOWN: Known<never> = { state: 'UNKNOWN' };
export const NOT_APPLICABLE: Known<never> = { state: 'NOT_APPLICABLE' };

/** KNOWN when the value is present (not null / undefined / empty string), UNKNOWN otherwise. Never a default. */
export function knownOrUnknown<T>(value: T | null | undefined): Known<T> {
  if (value === null || value === undefined) return UNKNOWN;
  if (typeof value === 'string' && value.trim() === '') return UNKNOWN;
  return known(value);
}

export const valueOf = <T>(k: Known<T>): T | null => (k.state === 'KNOWN' ? k.value : null);
export const isKnown = <T>(k: Known<T>): k is { state: 'KNOWN'; value: T } => k.state === 'KNOWN';
