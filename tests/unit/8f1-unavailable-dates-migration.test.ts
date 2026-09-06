/**
 * Phase 8 -- Step 8F1: static guard on the additive
 * `student_unavailable_dates` migration. No DB connection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(process.cwd(), 'database/migrations');
const MIGRATION_FILE = '20260910_1000_phase8_unavailable_dates.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf-8');
const sqlNoComments = sql.replace(/^\s*--.*$/gm, '');

describe('8F1 -- student_unavailable_dates migration is additive and correctly shaped', () => {
  it('uses a fresh date segment and no keyset collision', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain(MIGRATION_FILE);
    const dates = files.map((f) => f.split('_')[0]);
    expect(dates.filter((d) => d === '20260910')).toEqual(['20260910']);
  });

  it('creates exactly one table: student_unavailable_dates', () => {
    const creates = [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => m[1]);
    expect(creates).toEqual(['student_unavailable_dates']);
  });

  it('is purely additive -- no destructive / rewrite / seed statements', () => {
    expect(sqlNoComments).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
    expect(sqlNoComments).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sqlNoComments).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sqlNoComments).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sqlNoComments).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('does not touch any legacy study-plan table', () => {
    expect(sqlNoComments).not.toMatch(/study_plans?\b/i);
    expect(sqlNoComments).not.toMatch(/study_sessions?\b/i);
    expect(sqlNoComments).not.toMatch(/study_session_items?\b/i);
  });

  it('keys on (student_id, unavailable_date), FKs students(id) ON DELETE CASCADE, and is DATE-typed', () => {
    expect(sql).toMatch(/PRIMARY KEY \(student_id, unavailable_date\)/i);
    expect(sql).toMatch(/student_id\s+UUID NOT NULL REFERENCES students\(id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/unavailable_date\s+DATE NOT NULL/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_student_unavailable_dates_student/i);
  });
});
