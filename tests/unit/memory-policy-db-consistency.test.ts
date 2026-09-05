/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6D Section 4: proves the persisted MemoryPolicy v1 seed row in
 * database/migrations/20260906_1000_phase6_memory_state.sql exactly
 * matches MEMORY_POLICY_V1 in src/lib/memory-policy.ts, WITHOUT
 * applying the migration or connecting to any database -- this parses
 * the migration file's own SQL text as a fixture. One canonical
 * comparison, not policy values duplicated by hand across many tests.
 *
 * The migration itself was separately, behaviorally validated end-to-
 * end (schema, FKs, CHECK constraints, the seed row's actual values)
 * against an ephemeral local Postgres instance -- never production --
 * as part of Step 6D's report; this test is the fast, DB-free,
 * CI-safe guard that keeps the code and the SQL from silently
 * drifting apart afterward.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MEMORY_POLICY_V1, EXCLUDED_ACTIVITY_TYPES } from '@/lib/memory-policy';

const MIGRATION_PATH = join(process.cwd(), 'database/migrations/20260906_1000_phase6_memory_state.sql');

const SEED_COLUMNS = [
  'version',
  'minimum_retention_gap_days',
  'qualifying_activity_types',
  'excluded_activity_types',
  'demonstrated_retention_max_evidence',
  'recency_weight_decay',
  'difficulty_weighting_enabled',
  'cognitive_weighting_enabled',
  'stability_developing_at_successes',
  'stability_stable_at_successes',
  'review_interval_days_by_success_count',
  'minimum_review_interval_days',
  'maximum_review_interval_days',
  'retrievability_decay_constant_k',
] as const;

/** Splits a SQL VALUES(...) tuple's inner text on top-level commas only -- commas inside a '...' string literal (including a JSON array embedded in one) never split. */
function splitSqlTuple(tuple: string): string[] {
  const values: string[] = [];
  let inString = false;
  let current = '';
  for (const ch of tuple) {
    if (ch === "'") {
      inString = !inString;
      current += ch;
      continue;
    }
    if (!inString && ch === ',') {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) values.push(current.trim());
  return values;
}

function parseSeedRow(sql: string): Record<(typeof SEED_COLUMNS)[number], string> {
  const match = sql.match(/INSERT INTO memory_policies \(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON CONFLICT/);
  if (!match) throw new Error('Could not locate the memory_policies seed INSERT in the migration file -- has it been renamed/restructured?');

  const declaredColumns = splitSqlTuple(match[1]).map((c) => c.trim());
  const rawValues = splitSqlTuple(match[2]);
  if (declaredColumns.length !== rawValues.length) {
    throw new Error(`Column count (${declaredColumns.length}) does not match value count (${rawValues.length}) in the seed INSERT`);
  }

  const row: Partial<Record<(typeof SEED_COLUMNS)[number], string>> = {};
  declaredColumns.forEach((col, i) => {
    row[col as (typeof SEED_COLUMNS)[number]] = rawValues[i];
  });
  for (const col of SEED_COLUMNS) {
    if (row[col] === undefined) throw new Error(`Seed INSERT is missing expected column "${col}"`);
  }
  return row as Record<(typeof SEED_COLUMNS)[number], string>;
}

function parseSqlInt(raw: string): number {
  return parseInt(raw.trim(), 10);
}
function parseSqlNumeric(raw: string): number {
  return parseFloat(raw.trim());
}
function parseSqlBool(raw: string): boolean {
  return raw.trim().toLowerCase() === 'true';
}
function parseSqlJsonbArray(raw: string): unknown[] {
  // e.g. '["RETENTION_CHECK","SOLO_CHECK"]'::jsonb  or  '[3,4,7,14,28,56,84]'::jsonb
  const stringLiteralMatch = raw.trim().match(/^'([\s\S]*)'::jsonb$/);
  if (!stringLiteralMatch) throw new Error(`Expected a '...'::jsonb literal, got: ${raw}`);
  return JSON.parse(stringLiteralMatch[1]);
}

describe('MemoryPolicy v1: migration seed row matches MEMORY_POLICY_V1 exactly', () => {
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8');
  const seed = parseSeedRow(migrationSql);

  it('version', () => {
    expect(parseSqlInt(seed.version)).toBe(MEMORY_POLICY_V1.version);
  });

  it('minimumRetentionGapDays', () => {
    expect(parseSqlInt(seed.minimum_retention_gap_days)).toBe(MEMORY_POLICY_V1.minimumRetentionGapDays);
  });

  it('qualifyingActivityTypes (same set, order-independent)', () => {
    const dbValues = parseSqlJsonbArray(seed.qualifying_activity_types);
    expect([...dbValues].sort()).toEqual([...MEMORY_POLICY_V1.qualifyingActivityTypes].sort());
  });

  it('excludedActivityTypes (same set, order-independent)', () => {
    const dbValues = parseSqlJsonbArray(seed.excluded_activity_types);
    expect([...dbValues].sort()).toEqual([...EXCLUDED_ACTIVITY_TYPES].sort());
  });

  it('demonstratedRetentionMaxEvidence', () => {
    expect(parseSqlInt(seed.demonstrated_retention_max_evidence)).toBe(MEMORY_POLICY_V1.demonstratedRetentionMaxEvidence);
  });

  it('recencyWeightDecay', () => {
    expect(parseSqlNumeric(seed.recency_weight_decay)).toBeCloseTo(MEMORY_POLICY_V1.recencyWeightDecay, 10);
  });

  it('difficultyWeighting: DB boolean false <=> code numeric weight 1.0 (both express "disabled", by two different, deliberately-shaped representations)', () => {
    expect(parseSqlBool(seed.difficulty_weighting_enabled)).toBe(false);
    expect(MEMORY_POLICY_V1.difficultyWeight).toBe(1.0);
  });

  it('cognitiveWeighting: DB boolean false <=> code numeric weight 1.0', () => {
    expect(parseSqlBool(seed.cognitive_weighting_enabled)).toBe(false);
    expect(MEMORY_POLICY_V1.cognitiveLevelWeight).toBe(1.0);
  });

  it('stabilityDevelopingAtSuccesses', () => {
    expect(parseSqlInt(seed.stability_developing_at_successes)).toBe(MEMORY_POLICY_V1.stabilityDevelopingAtSuccesses);
  });

  it('stabilityStableAtSuccesses', () => {
    expect(parseSqlInt(seed.stability_stable_at_successes)).toBe(MEMORY_POLICY_V1.stabilityStableAtSuccesses);
  });

  it('reviewIntervalDaysBySuccessCount (exact sequence, order matters)', () => {
    expect(parseSqlJsonbArray(seed.review_interval_days_by_success_count)).toEqual([...MEMORY_POLICY_V1.reviewIntervalDaysBySuccessCount]);
  });

  it('minimumReviewIntervalDays', () => {
    expect(parseSqlInt(seed.minimum_review_interval_days)).toBe(MEMORY_POLICY_V1.minimumReviewIntervalDays);
  });

  it('maximumReviewIntervalDays', () => {
    expect(parseSqlInt(seed.maximum_review_interval_days)).toBe(MEMORY_POLICY_V1.maximumReviewIntervalDays);
  });

  it('retrievabilityDecayConstantK', () => {
    expect(parseSqlNumeric(seed.retrievability_decay_constant_k)).toBeCloseTo(MEMORY_POLICY_V1.retrievabilityDecayConstantK, 10);
  });
});
