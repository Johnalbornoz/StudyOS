import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 0E2 schema contract tests for
 * database/migrations/20260831_1400_ai_execution_and_decision_audit.sql
 * -- static facts about the new audit tables, parsed as plain text.
 * No database connection required (mirrors tests/unit/schema-contract.test.ts's
 * approach for the Phase 0D baseline, applied here to this migration
 * instead, since these tables don't exist in the baseline snapshot).
 */

const MIGRATION_PATH = join(
  process.cwd(),
  'database/migrations/20260831_1400_ai_execution_and_decision_audit.sql'
);
const sql = readFileSync(MIGRATION_PATH, 'utf-8');

function tableBody(tableName: string): string {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName} \\(([\\s\\S]*?)\\n\\);`);
  const m = sql.match(re);
  if (!m) throw new Error(`CREATE TABLE IF NOT EXISTS ${tableName} not found in migration`);
  return m[1];
}

describe('Phase 0E2 migration is well-formed', () => {
  it('the migration file exists and defines exactly the two new tables', () => {
    expect(sql.length).toBeGreaterThan(500);
    expect((sql.match(/^CREATE TABLE IF NOT EXISTS \w+/gm) ?? []).length).toBe(2);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_execution_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS decision_events');
  });

  it('is additive only -- no ALTER TABLE against any pre-existing table, no DROP', () => {
    expect(sql).not.toMatch(/ALTER TABLE\s+(?!ONLY)?\s*(students|profiles|subjects|concepts|mastery_records|learning_evidence|verification_attempts|concept_knowledge_state|learning_debt)\b/i);
    expect(sql).not.toMatch(/\bDROP TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP COLUMN\b/i);
  });
});

describe('ai_execution_events contract', () => {
  const body = tableBody('ai_execution_events');

  it('has the Phase 0E1 execution identity columns: execution_id (unique), capability, risk, provider, model, prompt_id, prompt_version', () => {
    expect(body).toMatch(/execution_id\s+uuid NOT NULL UNIQUE/);
    for (const col of ['capability', 'risk', 'provider', 'model', 'prompt_id', 'prompt_version']) {
      expect(body).toMatch(new RegExp(`${col}\\s+text NOT NULL`));
    }
  });

  it('has status/validation_status/fallback_used/error_code/duration_ms with the documented CHECK constraints', () => {
    expect(body).toMatch(/status\s+text NOT NULL/);
    expect(sql).toMatch(/ai_execution_events_status_check CHECK \(status IN \('SUCCESS', 'FAILURE'\)\)/);
    expect(sql).toMatch(/ai_execution_events_validation_status_check CHECK \(validation_status IN \('PASSED', 'FAILED', 'NOT_APPLICABLE'\)\)/);
    expect(sql).toMatch(/ai_execution_events_duration_ms_check CHECK \(duration_ms >= 0\)/);
  });

  it('student_id is a plain, unconstrained uuid column -- deliberately NOT a foreign key (Step 4 identity decision)', () => {
    expect(body).toMatch(/student_id\s+uuid,/);
    expect(body).not.toMatch(/student_id\s+uuid REFERENCES/);
  });

  it('concept_id and subject_id ARE real foreign keys, ON DELETE SET NULL', () => {
    expect(body).toMatch(/subject_id\s+uuid REFERENCES subjects\(id\) ON DELETE SET NULL/);
    expect(body).toMatch(/concept_id\s+uuid REFERENCES concepts\(id\) ON DELETE SET NULL/);
  });

  it('never declares a raw prompt/response/answer/credential column (Step 3 privacy rule)', () => {
    for (const forbidden of ['raw_prompt', 'raw_response', 'prompt_text', 'response_text', 'student_answer', 'api_key', 'credential', 'password']) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('decision_events contract', () => {
  const body = tableBody('decision_events');

  it('has the documented decision identity columns: decision_id (unique), decision_type, engine, engine_version', () => {
    expect(body).toMatch(/decision_id\s+uuid NOT NULL UNIQUE/);
    expect(body).toMatch(/decision_type\s+text NOT NULL/);
    expect(body).toMatch(/engine\s+text NOT NULL/);
    expect(body).toMatch(/engine_version\s+text NOT NULL/);
  });

  it('student_id is a plain, unconstrained uuid column -- deliberately NOT a foreign key (same identity decision as ai_execution_events)', () => {
    expect(body).toMatch(/student_id\s+uuid,/);
    expect(body).not.toMatch(/student_id\s+uuid REFERENCES/);
  });

  it('ai_execution_id references ai_execution_events(execution_id), ON DELETE SET NULL -- never fabricated, always nullable', () => {
    expect(body).toMatch(/ai_execution_id\s+uuid REFERENCES ai_execution_events \(execution_id\) ON DELETE SET NULL/);
  });

  it('source_event_id has no FK target (deliberately polymorphic across domain tables per source_event_type)', () => {
    expect(body).not.toMatch(/source_event_id\s+uuid REFERENCES/);
  });

  it('carries previous_state/new_state/reason_code/reason_details as the uniform cross-engine shape', () => {
    for (const col of ['previous_state', 'new_state', 'reason_details']) {
      expect(body).toMatch(new RegExp(`${col}\\s+jsonb`));
    }
    expect(body).toMatch(/reason_code\s+text/);
  });

  it('never declares a raw prompt/response/answer/credential column (Step 3/25 privacy rule)', () => {
    for (const forbidden of ['raw_prompt', 'raw_response', 'prompt_text', 'response_text', 'student_answer', 'api_key', 'credential', 'password']) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });
});
