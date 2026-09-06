/**
 * Phase 8 -- Step 8A1: static guard on the additive
 * learning_plan / learning_plan_item migration and its TS column
 * mirrors. No DB connection -- reads the SQL and the pure mirrors.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { LEARNING_PLAN_COLUMNS, LEARNING_PLAN_ITEM_COLUMNS } from '@/lib/learning-plan-state';
import {
  LEARNING_PLAN_ITEM_STATUSES,
  ORCHESTRATION_REASON_CODES,
  ORCHESTRATION_SOURCES,
} from '@/lib/learning-orchestration-policy';

const MIGRATIONS_DIR = join(process.cwd(), 'database/migrations');
const MIGRATION_FILE = '20260909_1000_phase8_learning_plan.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf-8');
/** SQL with `-- ...` line comments stripped -- for checks that must ignore explanatory prose. */
const sqlNoComments = sql.replace(/^\s*--.*$/gm, '');

function tableBody(name: string): string {
  const open = sql.indexOf('(', sql.search(new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+${name}\\b`, 'i')));
  const close = sql.indexOf('\n);', open);
  return sql.slice(open, close);
}

describe('8A1 -- learning_plan / learning_plan_item migration is additive and correctly shaped', () => {
  it('exists with a fresh date segment (no keyset collision); 8F1 adds the only newer Phase 8 migration', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain(MIGRATION_FILE);
    const idx = files.indexOf(MIGRATION_FILE);
    // Nothing sorts between 8A1 and the 8F1 unavailable-dates migration.
    expect(files[idx + 1]).toBe('20260910_1000_phase8_unavailable_dates.sql');
    const dates = files.map((f) => f.split('_')[0]);
    expect(dates.filter((d) => d === '20260909')).toEqual(['20260909']);
  });

  it('creates exactly two tables: learning_plan then learning_plan_item', () => {
    const creates = [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => m[1]);
    expect(creates).toEqual(['learning_plan', 'learning_plan_item']);
  });

  it('is purely additive -- no destructive / rewrite / seed statements, and no SQL statement touches legacy study-plan tables', () => {
    expect(sqlNoComments).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
    expect(sqlNoComments).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sqlNoComments).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sqlNoComments).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sqlNoComments).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sqlNoComments).not.toMatch(/\bTRUNCATE\b/i);
    expect(sqlNoComments).not.toMatch(/\bstudy_plans\b|\bstudy_sessions\b|\bstudy_session_items\b/);
  });

  it('learning_plan: id PK, student FK, status + policy-version checks, horizon bounds, timezone, jsonb goal_context', () => {
    const b = tableBody('learning_plan');
    expect(b).toMatch(/id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(b).toMatch(/student_id UUID NOT NULL REFERENCES students\(id\)/);
    expect(b).toMatch(/status TEXT NOT NULL DEFAULT 'ACTIVE'\s*\n?\s*CHECK \(status IN \('ACTIVE', 'SUPERSEDED'\)\)/);
    expect(b).toMatch(/orchestration_policy_version INT NOT NULL\s*\n?\s*CHECK \(orchestration_policy_version > 0\)/);
    expect(b).toMatch(/horizon_start DATE NOT NULL/);
    expect(b).toMatch(/horizon_end DATE NOT NULL/);
    expect(b).toMatch(/planning_anchor_at TIMESTAMPTZ NOT NULL/);
    expect(b).toMatch(/timezone TEXT NOT NULL/);
    expect(b).toMatch(/timezone_assumed BOOLEAN NOT NULL DEFAULT true/);
    expect(b).toMatch(/goal_context JSONB NOT NULL DEFAULT '\{\}'/);
    expect(b).toMatch(/CHECK \(horizon_end >= horizon_start\)/);
    expect(b).toMatch(/CHECK \(horizon_end <= horizon_start \+ 13\)/); // 14-day inclusive bound
  });

  it('learning_plan: exactly ONE ACTIVE plan per student (partial unique index)', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_plan_one_active\s*\n?\s*ON learning_plan \(student_id\)\s*\n?\s*WHERE status = 'ACTIVE'/);
  });

  it('learning_plan_item: FKs, checks, unique operation_key, jsonb provenance, nullable self-FK supersede', () => {
    const b = tableBody('learning_plan_item');
    expect(b).toMatch(/plan_id UUID NOT NULL REFERENCES learning_plan\(id\)/);
    expect(b).toMatch(/student_id UUID NOT NULL REFERENCES students\(id\)/);
    expect(b).toMatch(/subject_id UUID NOT NULL REFERENCES subjects\(id\)/);
    expect(b).toMatch(/concept_id UUID REFERENCES concepts\(id\)/);
    expect(b).not.toMatch(/concept_id UUID NOT NULL/);
    expect(b).toMatch(/estimated_minutes INT NOT NULL CHECK \(estimated_minutes > 0\)/);
    expect(b).toMatch(/orchestration_policy_version INT NOT NULL\s*\n?\s*CHECK \(orchestration_policy_version > 0\)/);
    expect(b).toMatch(/priority_at_plan_time INT NOT NULL/);
    expect(b).toMatch(/operation_key TEXT NOT NULL/);
    expect(b).toMatch(/provenance JSONB NOT NULL DEFAULT '\{\}'/);
    expect(b).toMatch(/superseded_by_item_id UUID REFERENCES learning_plan_item\(id\)/);
    expect(b).not.toMatch(/ON DELETE CASCADE/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_plan_item_operation_key\s*\n?\s*ON learning_plan_item \(operation_key\)/);
  });

  it('learning_plan_item: status / reason_code / source / intended_activity_type CHECK lists match the canonical unions exactly', () => {
    const b = tableBody('learning_plan_item');
    for (const s of LEARNING_PLAN_ITEM_STATUSES) expect(b).toContain(`'${s}'`);
    for (const rc of ORCHESTRATION_REASON_CODES) expect(b).toContain(`'${rc}'`);
    for (const src of ORCHESTRATION_SOURCES) expect(b).toContain(`'${src}'`);
    for (const at of ['PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION', 'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM']) {
      expect(b).toContain(`'${at}'`);
    }
  });

  it('has the required item indexes (plan/date, live student/date partial, student/concept) and no others', () => {
    const idxNames = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/gi)].map((m) => m[1]).sort();
    expect(idxNames).toEqual([
      'idx_learning_plan_item_operation_key',
      'idx_learning_plan_item_plan_date',
      'idx_learning_plan_item_student_concept',
      'idx_learning_plan_item_student_date_live',
      'idx_learning_plan_one_active',
      'idx_learning_plan_student',
    ]);
    expect(sql).toMatch(/idx_learning_plan_item_student_date_live[\s\S]*?WHERE status IN \('PLANNED', 'READY'\)/);
  });

  it('TS column mirrors match the migration columns exactly, in order', () => {
    for (const [name, mirror] of [
      ['learning_plan', LEARNING_PLAN_COLUMNS],
      ['learning_plan_item', LEARNING_PLAN_ITEM_COLUMNS],
    ] as const) {
      const body = tableBody(name);
      const sqlCols = [...body.matchAll(/^ {2}(\w+) +(?:UUID|TEXT|INT|BOOLEAN|TIMESTAMPTZ|DATE|JSONB)/gm)].map((m) => m[1]);
      expect(sqlCols).toEqual([...mirror]);
    }
  });
});
