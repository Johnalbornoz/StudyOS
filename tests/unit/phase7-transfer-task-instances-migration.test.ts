/**
 * Phase 7 -- Step 7D1: static checks on the additive
 * transfer_task_instances migration and its TS column mirror.
 *
 * No DB connection -- reads the migration SQL and the pure
 * TRANSFER_TASK_INSTANCE_COLUMNS mirror as text / imports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TRANSFER_TASK_INSTANCE_COLUMNS } from '@/lib/transfer-task-identity';

const MIGRATIONS_DIR = join(process.cwd(), 'database/migrations');
const MIGRATION_FILE = '20260908_1000_phase7_transfer_task_instances.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf-8');

describe('7D1 -- transfer_task_instances migration is additive and correctly shaped', () => {
  it('exists and is the latest migration by filename order', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain(MIGRATION_FILE);
    expect(files[files.length - 1]).toBe(MIGRATION_FILE);
  });

  it('uses a fresh date segment -- no keyset collision with an earlier migration', () => {
    const dates = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.split('_')[0]);
    // '20260908' appears exactly once (this file)
    expect(dates.filter((d) => d === '20260908')).toEqual(['20260908']);
  });

  it('creates exactly one table: transfer_task_instances', () => {
    const creates = [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => m[1]);
    expect(creates).toEqual(['transfer_task_instances']);
  });

  it('is purely additive -- no destructive or rewrite statements, no seed rows', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('id is the PK and equals the server-minted transferTaskId (no surrogate, no default)', () => {
    expect(sql).toMatch(/id UUID PRIMARY KEY/);
    expect(sql).not.toMatch(/id UUID PRIMARY KEY DEFAULT/); // minted by the route, not the DB
  });

  it('FKs student_id + concept_id NOT NULL, subject_id nullable', () => {
    expect(sql).toMatch(/student_id UUID NOT NULL REFERENCES students\(id\)/);
    expect(sql).toMatch(/concept_id UUID NOT NULL REFERENCES concepts\(id\)/);
    expect(sql).toMatch(/subject_id UUID REFERENCES subjects\(id\)/);
    expect(sql).not.toMatch(/subject_id UUID NOT NULL/);
  });

  it('CHECK-constrains distance and modality to the canonical enums', () => {
    expect(sql).toMatch(/transfer_distance IN \('NEAR', 'MID', 'FAR'\)/);
    expect(sql).toMatch(/transfer_modality IN \('STRUCTURAL', 'REPRESENTATIONAL'\)/);
  });

  it('carries both hashes, the family id, generator versions and the novelty flag', () => {
    expect(sql).toMatch(/task_family_id TEXT NOT NULL/);
    expect(sql).toMatch(/prompt_fingerprint TEXT NOT NULL/);
    expect(sql).toMatch(/prompt_exact_hash TEXT NOT NULL/);
    expect(sql).toMatch(/generator_prompt_version TEXT NOT NULL/);
    expect(sql).toMatch(/novelty_validation_passed BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).toMatch(/created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  });

  it('novelty_dimensions / target_concept_ids default to empty arrays', () => {
    expect(sql).toMatch(/novelty_dimensions TEXT\[\] NOT NULL DEFAULT '\{\}'/);
    expect(sql).toMatch(/target_concept_ids UUID\[\] NOT NULL DEFAULT '\{\}'/);
  });

  it('has the registry lookup indexes and introduces no other table', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_transfer_task_instances_student_concept/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_transfer_task_instances_fingerprint/);
    expect(sql).not.toMatch(/concept_transfer_state|learning_evidence|mastery_records|concept_knowledge_state/);
  });

  it('the TS column mirror matches the migration columns exactly, in order', () => {
    const createIdx = sql.search(/CREATE TABLE/i);
    const open = sql.indexOf('(', createIdx);
    const close = sql.indexOf('\n);', open);
    const body = sql.slice(open, close);
    const sqlCols = [...body.matchAll(/^ {2}(\w+) +(?:UUID|TEXT|BOOLEAN|TIMESTAMPTZ)/gm)].map((m) => m[1]);
    expect(sqlCols).toEqual([...TRANSFER_TASK_INSTANCE_COLUMNS]);
  });
});
