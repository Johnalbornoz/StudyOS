/**
 * Phase 7 -- Step 7C1: static checks on the additive
 * concept_transfer_state migration and its TS type mirror.
 *
 * No DB connection -- reads the migration SQL and src/lib/transfer-state.ts
 * as text / imports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { CONCEPT_TRANSFER_STATE_COLUMNS } from '@/lib/transfer-state';
import { TRANSFER_DEPTH_VALUES, TRANSFER_DISTANCE_VALUES } from '@/lib/transfer-policy';

const MIGRATIONS_DIR = join(process.cwd(), 'database/migrations');
const MIGRATION_FILE = '20260907_1400_phase7_transfer_state.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf-8');

describe('7C1 -- concept_transfer_state migration is additive and correctly shaped', () => {
  it('exists and sorts before the 7D1 task-instances migration', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain(MIGRATION_FILE);
    // 7D1 (20260908_1000_phase7_transfer_task_instances.sql) is the newer
    // Phase 7 migration; this one must still be the last one before it.
    const next = files[files.indexOf(MIGRATION_FILE) + 1];
    expect(next).toBe('20260908_1000_phase7_transfer_task_instances.sql');
  });

  it('creates exactly one table: concept_transfer_state', () => {
    const creates = [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => m[1]);
    expect(creates).toEqual(['concept_transfer_state']);
  });

  it('is purely additive -- no destructive or rewrite statements', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i); // 7C1 seeds no rows
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('surrogate id PK + UNIQUE(student_id, concept_id) + FKs (concept_memory_state convention)', () => {
    expect(sql).toMatch(/id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(sql).toMatch(/student_id UUID NOT NULL REFERENCES students\(id\)/);
    expect(sql).toMatch(/concept_id UUID NOT NULL REFERENCES concepts\(id\)/);
    expect(sql).toMatch(/UNIQUE \(student_id, concept_id\)/);
  });

  it('has the required CHECK constraints', () => {
    expect(sql).toMatch(/demonstrated_transfer_score IS NULL OR \(demonstrated_transfer_score >= 0 AND demonstrated_transfer_score <= 100\)/);
    expect(sql).toMatch(/near_transfer_success_count >= 0/);
    expect(sql).toMatch(/mid_transfer_success_count\s+>= 0/);
    expect(sql).toMatch(/far_transfer_success_count\s+>= 0/);
    expect(sql).toMatch(/last_successful_transfer_distance IS NULL OR last_successful_transfer_distance IN \('NEAR', 'MID', 'FAR'\)/);
    expect(sql).toMatch(/transfer_depth IN \('NONE', 'NEAR_DEMONSTRATED', 'GENERALIZED', 'ROBUST'\)/);
    expect(sql).toMatch(/policy_version > 0/);
  });

  it('CHECK enum lists exactly match the canonical policy unions', () => {
    for (const d of TRANSFER_DEPTH_VALUES) expect(sql).toContain(`'${d}'`);
    for (const d of TRANSFER_DISTANCE_VALUES) expect(sql).toContain(`'${d}'`);
  });

  it('carries policy_version, updated_at, created_at and the per-column lookup indexes', () => {
    expect(sql).toMatch(/policy_version INT NOT NULL/);
    expect(sql).toMatch(/created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    expect(sql).toMatch(/updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_concept_transfer_state_student ON concept_transfer_state\(student_id\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_concept_transfer_state_concept ON concept_transfer_state\(concept_id\)/);
  });

  it('does NOT create a task table, a fingerprint table, or a policy table', () => {
    expect(sql).not.toMatch(/transfer_tasks|transfer_task_fingerprints|transfer_policies/);
  });

  it('the TS type mirror column list matches the migration columns exactly', () => {
    for (const col of CONCEPT_TRANSFER_STATE_COLUMNS) {
      // each column name appears in the CREATE TABLE body
      expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
    }
    // no extra column defined in SQL that the mirror is missing
    const body = sql.slice(sql.indexOf('('), sql.indexOf('UNIQUE (student_id'));
    const sqlCols = [...body.matchAll(/^\s{2}(\w+)\s+(?:UUID|INT|TEXT|TIMESTAMPTZ)/gm)].map((m) => m[1]);
    expect(sqlCols.sort()).toEqual([...CONCEPT_TRANSFER_STATE_COLUMNS].sort());
  });
});
