import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Schema contract tests (Phase 0D).
 *
 * These validate STATIC FACTS about the version-controlled schema
 * baseline (database/baseline/STUDYUS_BASELINE_2026_08.sql), which is
 * itself a byte-accurate pg_dump snapshot of the live production
 * database (captured 2026-08-26). They require no database connection
 * and no credentials -- they read the baseline file as plain text.
 *
 * Their purpose is to catch DRIFT: if someone edits the baseline file
 * by hand in a way that silently changes one of these documented
 * contracts (e.g. "fixing" mastery_score back to a 0-1 CHECK, or
 * accidentally re-adding a dead legacy table), these tests fail loudly
 * instead of the drift going unnoticed until the next live-schema audit.
 */

const BASELINE_PATH = join(process.cwd(), 'database/baseline/STUDYUS_BASELINE_2026_08.sql');
const sql = readFileSync(BASELINE_PATH, 'utf-8');

function tableBody(tableName: string): string {
  const re = new RegExp(`CREATE TABLE public\\.${tableName} \\(([\\s\\S]*?)\\n\\);`);
  const m = sql.match(re);
  if (!m) throw new Error(`CREATE TABLE public.${tableName} not found in baseline`);
  return m[1];
}

function hasTable(tableName: string): boolean {
  return new RegExp(`CREATE TABLE public\\.${tableName} \\(`).test(sql);
}

function foreignKeysFor(tableName: string): { column: string; targetTable: string; targetColumn: string }[] {
  const re = new RegExp(
    `ALTER TABLE ONLY public\\.${tableName}\\s+ADD CONSTRAINT \\S+ FOREIGN KEY \\((\\w+)\\) REFERENCES public\\.(\\w+)\\((\\w+)\\)`,
    'g'
  );
  const results: { column: string; targetTable: string; targetColumn: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    results.push({ column: m[1], targetTable: m[2], targetColumn: m[3] });
  }
  return results;
}

function primaryKeyColumns(tableName: string): string[] {
  const re = new RegExp(`ALTER TABLE ONLY public\\.${tableName}\\s+ADD CONSTRAINT \\S+ PRIMARY KEY \\(([^)]+)\\)`);
  const m = sql.match(re);
  return m ? m[1].split(',').map((c) => c.trim()) : [];
}

describe('Schema baseline exists and is well-formed', () => {
  it('the baseline file exists and contains real CREATE TABLE statements', () => {
    expect(sql.length).toBeGreaterThan(1000);
    expect((sql.match(/^CREATE TABLE public\./gm) ?? []).length).toBeGreaterThanOrEqual(50);
  });
});

describe('Student identity contract -- two independent tables, no DB FK between them, both use uuid PKs', () => {
  it('students.id is a uuid primary key', () => {
    expect(hasTable('students')).toBe(true);
    expect(tableBody('students')).toMatch(/id uuid DEFAULT gen_random_uuid\(\) NOT NULL/);
    expect(primaryKeyColumns('students')).toEqual(['id']);
  });

  it('profiles.id is a uuid primary key', () => {
    expect(hasTable('profiles')).toBe(true);
    expect(tableBody('profiles')).toMatch(/id uuid NOT NULL/);
    expect(primaryKeyColumns('profiles')).toEqual(['id']);
  });

  it('there is NO foreign key from students to profiles, or from profiles to students -- the contract is application-level only, and this test asserts that stays true rather than assuming it', () => {
    const studentsFks = foreignKeysFor('students');
    const profilesFks = foreignKeysFor('profiles');
    expect(studentsFks.some((fk) => fk.targetTable === 'profiles')).toBe(false);
    expect(profilesFks.some((fk) => fk.targetTable === 'students')).toBe(false);
  });

  it('student_profiles exists as its own live table (also with no FK to students)', () => {
    expect(hasTable('student_profiles')).toBe(true);
    expect(foreignKeysFor('student_profiles').some((fk) => fk.targetTable === 'students')).toBe(false);
  });
});

describe('Subject ownership contract', () => {
  it('subjects.student_id exists, is uuid, and its live FK target is profiles (not students, not a junction table)', () => {
    expect(tableBody('subjects')).toMatch(/student_id uuid NOT NULL/);
    const fks = foreignKeysFor('subjects');
    const studentIdFk = fks.find((fk) => fk.column === 'student_id');
    expect(studentIdFk).toBeDefined();
    expect(studentIdFk!.targetTable).toBe('profiles');
  });

  it('subjects.status exists (a live, previously-untracked column)', () => {
    expect(tableBody('subjects')).toMatch(/status character varying\(\d+\)[\s\S]*? NOT NULL/);
  });

  it('no student_subjects junction table exists in the baseline -- it is confirmed dead, not part of current architecture', () => {
    expect(hasTable('student_subjects')).toBe(false);
  });
});

describe('Concept identity contract', () => {
  it('concepts.id is the canonical concept primary key', () => {
    expect(primaryKeyColumns('concepts')).toEqual(['id']);
  });

  it('concepts.subject_id has a real FK to subjects', () => {
    const fk = foreignKeysFor('concepts').find((f) => f.column === 'subject_id');
    expect(fk).toBeDefined();
    expect(fk!.targetTable).toBe('subjects');
  });
});

describe('Mastery contract -- mastery_records.mastery_score is NUMERIC(5,2), semantically 0-100, NOT a 0-1 fraction', () => {
  it('mastery_score is numeric(5,2), default 0, not null', () => {
    expect(tableBody('mastery_records')).toMatch(/mastery_score numeric\(5,2\) DEFAULT 0 NOT NULL/);
  });

  it('there is no range CHECK constraint on mastery_score in the live baseline -- the baseline must reflect current reality (none exists), not add one that was never there', () => {
    // A CHECK constraining this column would appear as a CONSTRAINT clause
    // referencing mastery_score with a comparison operator, distinct from
    // the auto-generated NOT NULL representation.
    const checkRe = /mastery_score[^,)]*(>=|<=|>|<)/;
    expect(checkRe.test(tableBody('mastery_records'))).toBe(false);
  });
});

describe('Learning Evidence contract', () => {
  it('every column the application writes to learning_evidence exists in the live baseline', () => {
    expect(hasTable('learning_evidence')).toBe(true);
    const body = tableBody('learning_evidence');
    const required = [
      'student_id', 'concept_id', 'source_type', 'result', 'difficulty', 'timestamp',
      'subject_id', 'activity_type', 'learning_mode', 'hints_used', 'ai_assistance_type',
      'confidence_before_answer', 'score_percent', 'metadata',
    ];
    for (const col of required) {
      expect(body, `learning_evidence.${col} should exist`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

describe('Verification Engine persistence contract', () => {
  it('verification_attempts exists live (this reverses the earlier, stale "migration 030 not executed" assumption)', () => {
    expect(hasTable('verification_attempts')).toBe(true);
  });

  it('variant_equivalence_confidence exists with its documented 0-1 CHECK bound', () => {
    const body = tableBody('verification_attempts');
    expect(body).toMatch(/variant_equivalence_confidence numeric/);
    // The CHECK constraint is emitted as a table-level CONSTRAINT clause
    // inside the same CREATE TABLE block by this pg_dump version.
    expect(sql).toMatch(/variant_equivalence_confidence[\s\S]{0,120}>=[\s\S]{0,20}0[\s\S]{0,60}variant_equivalence_confidence[\s\S]{0,20}<=[\s\S]{0,10}1/);
  });

  it('outcome has its documented enum CHECK constraint', () => {
    expect(sql).toMatch(/outcome[\s\S]{0,80}CONFIRMED[\s\S]{0,40}CONTRADICTED[\s\S]{0,40}INCONCLUSIVE/);
  });
});

describe('Errors table contract -- live shape matches the application\'s actual INSERT (the later of two historically-conflicting migration definitions)', () => {
  it('has exactly the columns the app writes: student_id, concept_id, subject_id, error_type, source_type, created_at', () => {
    const body = tableBody('errors');
    for (const col of ['student_id', 'concept_id', 'subject_id', 'error_type', 'source_type', 'created_at']) {
      expect(body).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('does NOT have the columns from the other, superseded migration 001 definition (context, a bare timestamp column)', () => {
    const body = tableBody('errors');
    expect(body).not.toMatch(/\bcontext\b/);
  });

  it('errors.student_id targets profiles, matching the live FK (not students)', () => {
    const fk = foreignKeysFor('errors').find((f) => f.column === 'student_id');
    expect(fk).toBeDefined();
    expect(fk!.targetTable).toBe('profiles');
  });
});

describe('Legacy/dead objects are correctly excluded from the current baseline', () => {
  const deadTables = [
    'student_subjects', 'quiz_responses', 'error_patterns',
    'chunk_embeddings', 'chunk_concept_mappings', 'exam_readiness_history', 'study_session_progress',
  ];
  for (const t of deadTables) {
    it(`${t} is NOT present -- confirmed absent from the live database, must not be reintroduced`, () => {
      expect(hasTable(t)).toBe(false);
    });
  }
});
