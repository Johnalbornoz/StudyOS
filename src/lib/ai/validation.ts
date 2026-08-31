import type { AIValidationResult } from './types';
import { parseAIJson } from '@/lib/ai-json';

/** The shape every adapter hands back before validation. */
export interface RawTextResponse {
  text: string;
}

export function ok<T>(value: T): AIValidationResult<T> {
  return { valid: true, value };
}

export function invalid<T>(...errors: string[]): AIValidationResult<T> {
  return { valid: false, errors };
}

/**
 * Parses `raw.text` as JSON (via the pre-existing parseAIJson, which
 * already strips markdown code fences) and runs `check` against the
 * parsed value. `check` returns either an error-message array (empty
 * = valid) or throws -- either is treated as validation failure, never
 * as an unvalidated pass-through (Step 10/11).
 */
export function validateJson<T>(raw: RawTextResponse, check: (parsed: any) => { value: T; errors: string[] }): AIValidationResult<T> {
  const parsed = parseAIJson(raw.text);
  const { value, errors } = check(parsed);
  if (errors.length > 0) return invalid(...errors);
  return ok(value);
}

/** Minimal structural checks reused across validators -- required fields, types, enum membership, finite bounds. */
export const checks = {
  isString(v: unknown): v is string {
    return typeof v === 'string';
  },
  isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
  },
  isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
  },
  isBoolean(v: unknown): v is boolean {
    return typeof v === 'boolean';
  },
  isArray(v: unknown): v is unknown[] {
    return Array.isArray(v);
  },
  isOneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
    return typeof v === 'string' && (options as readonly string[]).includes(v);
  },
  inBounds(v: number, min: number, max: number): boolean {
    return v >= min && v <= max;
  },
};

/** Clamps a number into [min, max] -- for coercing an AI-reported numeric field into an already-implied business bound, never a new pedagogical threshold (Step 10). */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
