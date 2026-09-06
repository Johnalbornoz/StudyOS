/**
 * Phase 7 -- Step 7B1: Transfer task identity + prompt fingerprint.
 *
 * Pure tests for src/lib/transfer-task-identity.ts: deterministic
 * structural prompt normalization, the fingerprint hash, canonical
 * task-id resolution, and the identity metadata builder. No DB, no AI,
 * no clock, no random.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  normalizeTransferPrompt,
  computeTransferPromptFingerprint,
  buildTransferTaskIdentityMetadata,
  resolveTransferTaskId,
} from '@/lib/transfer-task-identity';

const fp = computeTransferPromptFingerprint;

describe('7B1 -- normalizeTransferPrompt', () => {
  it('is idempotent on an already-normalized prompt', () => {
    const n = normalizeTransferPrompt('A cyclist rounds a bend at 12 m/s.');
    expect(normalizeTransferPrompt(n)).toBe(n);
  });
  it('replaces integers / decimals / signed / percentages with <number>', () => {
    expect(normalizeTransferPrompt('use 10 and 3.5 and -7 and 25%')).toBe('use <number> and <number> and <number> and <number>');
  });
  it('empty and whitespace-only normalize to the empty string', () => {
    expect(normalizeTransferPrompt('')).toBe('');
    expect(normalizeTransferPrompt('   \n\t ')).toBe('');
  });
});

describe('7B1 -- fingerprint: surface-only variants collapse', () => {
  const BASE = 'A car takes a turn of radius 40 m at 15 m/s. Find the centripetal acceleration.';
  it('identical prompt -> identical fingerprint', () => {
    expect(fp(BASE)).toBe(fp(BASE));
  });
  it('case change -> same fingerprint', () => {
    expect(fp(BASE.toUpperCase())).toBe(fp(BASE));
  });
  it('whitespace change -> same fingerprint', () => {
    expect(fp('A car   takes a turn of radius 40 m\n at 15 m/s.  Find the centripetal acceleration.')).toBe(fp(BASE));
  });
  it('trailing / surrounding punctuation change -> same fingerprint', () => {
    expect(fp('"A car takes a turn of radius 40 m at 15 m/s. Find the centripetal acceleration."')).toBe(fp(BASE));
    expect(fp('A car takes a turn of radius 40 m at 15 m/s — find the centripetal acceleration')).toBe(fp(BASE));
  });
  it('integer numeric substitution -> same fingerprint ("solve with 10" vs "solve with 42")', () => {
    expect(fp('Solve with 10')).toBe(fp('Solve with 42'));
  });
  it('decimal numeric substitution -> same fingerprint', () => {
    expect(fp('The rate is 3.5 per hour')).toBe(fp('The rate is 12.75 per hour'));
  });
  it('percentage numeric substitution -> same fingerprint', () => {
    expect(fp('Increase the price by 25%')).toBe(fp('Increase the price by 8%'));
  });
  it('unicode NFKC-equivalent forms -> same fingerprint', () => {
    // "ﬀ" (U+FB00 LATIN SMALL LIGATURE FF) NFKC-folds to "ff"
    expect(fp('a diﬀerence in slope')).toBe(fp('a difference in slope'));
    // full-width digits fold to ASCII, then to <number>
    expect(fp('add １０ apples')).toBe(fp('add 10 apples'));
  });
  it('returns a stable lowercase 64-hex string equal to sha256(normalized)', () => {
    const f = fp(BASE);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(f).toBe(createHash('sha256').update(normalizeTransferPrompt(BASE), 'utf8').digest('hex'));
  });
});

describe('7B1 -- fingerprint: meaningful lexical structure is preserved (no over-collapse)', () => {
  const pairs: Array<[string, string, string]> = [
    ['velocity vs acceleration', 'Compute the velocity at t = 3 s', 'Compute the acceleration at t = 3 s'],
    ['different verb/goal', 'Prove that the sequence converges', 'Explain why the sequence converges'],
    ['different reasoning structure', 'Find x such that f(x) = 0', 'Given f(x) = 0, describe the graph of f near x'],
    ['different domain nouns', 'A spring stores elastic energy', 'A battery stores chemical energy'],
    ['added constraint clause', 'Maximize the area of the rectangle', 'Maximize the area of the rectangle using only 12 m of fencing'],
  ];
  for (const [label, a, b] of pairs) {
    it(`${label} -> different fingerprints`, () => {
      expect(fp(a)).not.toBe(fp(b));
    });
  }
});

describe('7B1 -- determinism', () => {
  it('same input -> same fingerprint across 200 runs', () => {
    const p = 'A ladder of length 5 m leans against a wall; the base is 3 m out. How fast is the top sliding?';
    const first = fp(p);
    for (let i = 0; i < 200; i++) expect(fp(p)).toBe(first);
  });
});

describe('7B1 -- resolveTransferTaskId', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  it('only activityId -> ok, that value', () => {
    expect(resolveTransferTaskId({ activityId: A })).toEqual({ ok: true, taskId: A });
  });
  it('only transferTaskId -> ok, that value', () => {
    expect(resolveTransferTaskId({ transferTaskId: A })).toEqual({ ok: true, taskId: A });
  });
  it('both equal -> ok', () => {
    expect(resolveTransferTaskId({ transferTaskId: A, activityId: A })).toEqual({ ok: true, taskId: A });
  });
  it('both different -> CONFLICTING_TASK_IDS', () => {
    expect(resolveTransferTaskId({ transferTaskId: A, activityId: B })).toEqual({ ok: false, error: 'CONFLICTING_TASK_IDS' });
  });
  it('neither -> MISSING_TASK_ID', () => {
    expect(resolveTransferTaskId({})).toEqual({ ok: false, error: 'MISSING_TASK_ID' });
    expect(resolveTransferTaskId({ transferTaskId: null, activityId: undefined })).toEqual({ ok: false, error: 'MISSING_TASK_ID' });
  });
});

describe('7B1 -- buildTransferTaskIdentityMetadata', () => {
  const TASK = '33333333-3333-4333-8333-333333333333';
  const CONCEPT = '44444444-4444-4444-8444-444444444444';
  it('computes promptFingerprint from the supplied prompt and carries the minimal shape', () => {
    const meta = buildTransferTaskIdentityMetadata({
      transferTaskId: TASK,
      sourceConceptId: CONCEPT,
      transferDistance: 'MID',
      prompt: 'Apply it in a new setting with 7 items',
    });
    expect(meta).toEqual({
      transferTaskId: TASK,
      sourceConceptId: CONCEPT,
      transferDistance: 'MID',
      promptFingerprint: fp('Apply it in a new setting with 7 items'),
    });
    expect(meta).not.toHaveProperty('generatorVersion');
    expect(meta).not.toHaveProperty('generatorPromptVersion');
  });
  it('includes generator fields only when provided', () => {
    const meta = buildTransferTaskIdentityMetadata({
      transferTaskId: TASK,
      sourceConceptId: CONCEPT,
      transferDistance: 'FAR',
      prompt: 'x',
      generatorVersion: 'gen-1',
      generatorPromptVersion: 'v1',
    });
    expect(meta.generatorVersion).toBe('gen-1');
    expect(meta.generatorPromptVersion).toBe('v1');
  });
});
