/**
 * Migration 20261121_1000 -- student-owned scheduled assessments (ledger 86 -> 87). Structural checks.
 *
 * The file is read as text: this test applies nothing. What it pins is the shape the ruling asked for --
 * additive, independent of the school "next exam" and of every official exam record, several schedules per
 * Subject allowed, a real moment with a timezone, the native type of quiz_sessions.id, and the indexes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { REQUESTED_DIFFICULTY_BANDS } from '@/lib/exam-core/question-bank/requested-difficulty';

const DIR = join(process.cwd(), 'database/migrations');
const FILE = '20261121_1000_student_scheduled_assessments.sql';
const raw = readFileSync(join(DIR, FILE), 'utf-8');
const ddl = raw.replace(/^\s*--.*$/gm, '');
const table = (name: string) => {
  const m = ddl.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`table ${name} not found`);
  return m[1];
};

describe('migration 20261121_1000: one additive file, the new tail', () => {
  it('is the only migration after the L10 batch: ledger 86 -> 87', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    // the first file after the L10 batch; QF V5.1 (20261121_1100) and the curriculum-convergence files (20261122_*) come after it
    expect(files.filter((f) => f >= '20261121' && f < '20261122')).toEqual([FILE, '20261121_1100_qf51_construct_core_lineage.sql']);
    // 85 governed files + the baseline row = ledger 86 before this file
    expect(files.indexOf(FILE)).toBe(85);
  });

  it('creates two tables and five indexes, and changes nothing that exists', () => {
    expect(ddl.match(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)).toEqual(['CREATE TABLE IF NOT EXISTS public.student_scheduled_assessments', 'CREATE TABLE IF NOT EXISTS public.student_scheduled_assessment_concepts']);
    expect((ddl.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+)/g) ?? []).map((x) => x.split(' ').pop())).toEqual([
      'idx_student_scheduled_assessments_upcoming',
      'idx_student_scheduled_assessments_student_status',
      'idx_student_scheduled_assessments_subject',
      'uq_student_scheduled_assessments_session',
      'idx_student_scheduled_assessment_concepts_concept',
    ]);
    expect(ddl.replace(/ON DELETE (CASCADE|SET NULL)/g, '')).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE|TRIGGER|FUNCTION)\b/);
    // the runner owns the transaction and the ledger row
    expect(ddl).not.toMatch(/\b(BEGIN|COMMIT)\b|schema_migrations/);
    expect(raw).toMatch(/-- Rollback:[\s\S]*DROP TABLE IF EXISTS public\.student_scheduled_assessment_concepts;[\s\S]*DROP TABLE IF EXISTS public\.student_scheduled_assessments;[\s\S]*DELETE FROM schema_migrations WHERE version = '20261121_1000';/);
  });
});

describe('student_scheduled_assessments', () => {
  const t = table('student_scheduled_assessments');

  it('is the Student\'s own: student and Subject by foreign key', () => {
    expect(t).toMatch(/student_id uuid NOT NULL REFERENCES public\.students\(id\) ON DELETE CASCADE/);
    expect(t).toMatch(/subject_id uuid NOT NULL REFERENCES public\.subjects\(id\) ON DELETE CASCADE/);
  });

  it('the difficulty the Student chose is kept on the schedule: the bank\'s three item bands, or not stated', () => {
    expect(t).toMatch(/difficulty_band text,/);
    expect(t).toMatch(/CHECK \(difficulty_band IS NULL OR difficulty_band IN \('LOW', 'MEDIUM', 'HIGH'\)\)/);
    expect([...REQUESTED_DIFFICULTY_BANDS]).toEqual(['LOW', 'MEDIUM', 'HIGH']);
  });

  it('a moment and a timezone: timestamptz, never a date', () => {
    expect(t).toMatch(/scheduled_at timestamptz NOT NULL/);
    expect(t).toMatch(/timezone text NOT NULL/);
    expect(t).toMatch(/CHECK \(char_length\(timezone\) BETWEEN 1 AND 64\)/);
    expect(t).not.toMatch(/\bdate\b(?! AND)/i);
  });

  it('quiz_session_id has the native type of quiz_sessions.id (TEXT) and a real foreign key', () => {
    const baseline = readFileSync(join(process.cwd(), 'database/baseline/STUDYUS_BASELINE_2026_08.sql'), 'utf-8');
    expect(baseline).toMatch(/CREATE TABLE public\.quiz_sessions \(\s+id text NOT NULL,/);
    expect(baseline).toMatch(/ADD CONSTRAINT quiz_sessions_pkey PRIMARY KEY \(id\);/);
    expect(t).toMatch(/quiz_session_id text REFERENCES public\.quiz_sessions\(id\) ON DELETE SET NULL/);
  });

  it('only this exam: one intent, the three sizes, the four states, no official / mock / grade vocabulary', () => {
    expect(t).toMatch(/CHECK \(intent = 'AD_HOC_CONCEPT_EXAM'\)/);
    expect(t).toMatch(/CHECK \(depth IN \('QUICK', 'BALANCED', 'DEEP'\)\)/);
    expect(t).toMatch(/CHECK \(status IN \('SCHEDULED', 'STARTED', 'COMPLETED', 'CANCELLED'\)\)/);
    expect(t).toMatch(/status text NOT NULL DEFAULT 'SCHEDULED'/);
    expect(t).toMatch(/available_minutes integer,/);
    expect(t).toMatch(/concept_count integer NOT NULL/);
    expect(ddl).not.toMatch(/official|mock|predicted|grade|exam_version|exam_definition|assessment_occurrences|assessment_schedule_rules|simulation_plans|learning_plan/i);
  });

  it('the lifecycle is consistent in the table itself', () => {
    expect(t).toMatch(/status IN \('SCHEDULED', 'CANCELLED'\) AND quiz_session_id IS NULL AND started_at IS NULL AND completed_at IS NULL/);
    expect(t).toMatch(/status = 'STARTED' AND started_at IS NOT NULL AND completed_at IS NULL/);
    expect(t).toMatch(/status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL/);
    expect(t).toMatch(/CHECK \(\(status = 'CANCELLED'\) = \(cancelled_at IS NOT NULL\)\)/);
  });

  it('several schedules per Student and per Subject are allowed: nothing is unique on them', () => {
    expect(t).not.toMatch(/UNIQUE/);
    const unique = ddl.match(/CREATE UNIQUE INDEX[\s\S]*?;/g) ?? [];
    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatch(/\(quiz_session_id\)\s+WHERE quiz_session_id IS NOT NULL/);
    expect(unique[0]).not.toMatch(/student_id|subject_id/);
  });

  it('indexes: upcoming, student + status + moment, Subject', () => {
    expect(ddl).toMatch(/idx_student_scheduled_assessments_upcoming\s+ON public\.student_scheduled_assessments \(student_id, scheduled_at\)\s+WHERE status = 'SCHEDULED';/);
    expect(ddl).toMatch(/idx_student_scheduled_assessments_student_status\s+ON public\.student_scheduled_assessments \(student_id, status, scheduled_at\);/);
    expect(ddl).toMatch(/idx_student_scheduled_assessments_subject\s+ON public\.student_scheduled_assessments \(subject_id, scheduled_at\);/);
  });
});

describe('student_scheduled_assessment_concepts', () => {
  it('the exact concept scope, one row per concept, gone with its schedule', () => {
    const t = table('student_scheduled_assessment_concepts');
    expect(t).toMatch(/scheduled_assessment_id uuid NOT NULL REFERENCES public\.student_scheduled_assessments\(id\) ON DELETE CASCADE/);
    expect(t).toMatch(/concept_id uuid NOT NULL REFERENCES public\.concepts\(id\) ON DELETE CASCADE/);
    expect(t).toMatch(/PRIMARY KEY \(scheduled_assessment_id, concept_id\)/);
  });
});

describe('the code that writes these tables agrees with them', () => {
  const service = readFileSync(join(process.cwd(), 'src/services/ad-hoc-exam-schedule.service.ts'), 'utf-8');
  it('every column the service names exists, and it writes no other table', () => {
    for (const col of ['student_id', 'subject_id', 'intent', 'scheduled_at', 'timezone', 'depth', 'available_minutes', 'difficulty_band', 'concept_count', 'status', 'quiz_session_id', 'started_at', 'completed_at', 'cancelled_at', 'updated_at']) {
      expect(table('student_scheduled_assessments'), col).toMatch(new RegExp(`\\b${col}\\b`));
    }
    const written = [...service.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/g)].map((m) => m[1]);
    expect([...new Set(written)].sort()).toEqual(['student_scheduled_assessment_concepts', 'student_scheduled_assessments']);
    expect(service).not.toMatch(/DELETE FROM/);
  });
});
