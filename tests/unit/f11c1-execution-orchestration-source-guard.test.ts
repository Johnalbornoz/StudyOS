/**
 * F11-C1 -- source guard proving the execution orchestration layer:
 * (1) never authorizes execution via Teacher or Parent or the generic
 * composed canAccessLearner -- Student/Owner (isOwner) only;
 * (2) never touches F8 (no diagnosis, no intervention_sessions/
 * attempts, no LEARNER_INTERVENTION_CREATE);
 * (3) never writes learning_evidence/mastery_records/readiness
 * directly -- the existing Practice engine remains the sole writer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F11C1_LIB_FILES = ['src/lib/student/teacher-intervention-execution.service.ts'];

const F11C1_ROUTE_FILES = [
  'src/app/api/student/teacher-interventions/route.ts',
  'src/app/api/student/teacher-interventions/[id]/start/route.ts',
];

const ALL_F11C1_FILES = [...F11C1_LIB_FILES, ...F11C1_ROUTE_FILES];

describe('F11-C1 execution orchestration is Student/Owner-only and never a learning engine', () => {
  it('all F11-C1 files exist', () => {
    for (const relPath of ALL_F11C1_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('the orchestration service never imports canAccessLearner, canTeacherAccessLearner, canTeacherManageIntervention, or isActiveParentOf', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/student/teacher-intervention-execution.service.ts'), 'utf-8');
    // Only an actual import matters -- the file's own doc comment names
    // these functions in prose to explain why they are NOT used.
    expect(src).not.toMatch(/import\s*\{[^}]*\b(canAccessLearner|canTeacherAccessLearner|canTeacherManageIntervention|isActiveParentOf)\b[^}]*\}\s*from/);
  });

  it('the orchestration service imports isOwner from the canonical authorization module', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/student/teacher-intervention-execution.service.ts'), 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*\bisOwner\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
  });

  it('the orchestration service never touches F8 (diagnosis, intervention_sessions/attempts, LEARNER_INTERVENTION_CREATE)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/student/teacher-intervention-execution.service.ts'), 'utf-8');
    // Only an actual call/import/SQL-table-reference matters -- the
    // file's own doc comment names these in prose to explain why they
    // are NOT used here.
    expect(src).not.toMatch(/\brunDiagnosis\(|\bstartInterventionSession\(|\brecordInterventionAttempt\(|\bwriteInterventionEvidence\(|['"]LEARNER_INTERVENTION_CREATE['"]|FROM intervention_sessions|FROM intervention_attempts|INTO intervention_sessions|INTO intervention_attempts/);
  });

  it('the orchestration service never writes learning_evidence, mastery_records, or readiness_snapshots directly', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/student/teacher-intervention-execution.service.ts'), 'utf-8');
    expect(src).not.toMatch(/updateMastery|INSERT INTO learning_evidence|INSERT INTO mastery_records|INSERT INTO readiness_snapshots/);
  });

  it('the orchestration service reuses the real Practice generation/persistence functions, never re-implementing them', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/student/teacher-intervention-execution.service.ts'), 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*\bgeneratePracticeQuestions\b[^}]*\}\s*from\s*['"]@\/services\/quiz-generation\.service['"]/);
    expect(src).toMatch(/import\s*\{[^}]*\bstoreQuiz\b[^}]*,?\s*\bgetQuizSession\b[^}]*\}\s*from\s*['"]@\/services\/quiz-persistence\.service['"]/);
  });

  it('no F11-C1 route performs its own authorization logic beyond resolving the actor and delegating to the orchestration service', () => {
    for (const relPath of F11C1_ROUTE_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import canAccessLearner`).not.toMatch(/canAccessLearner/);
      expect(src, `${relPath} must not import Teacher authorization`).not.toMatch(/canTeacherAccessLearner|canTeacherManageIntervention/);
      expect(src, `${relPath} must not import Parent authorization`).not.toMatch(/isActiveParentOf/);
    }
  });

  it('the start route never accepts a client-supplied studentId (identity resolution only)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/student/teacher-interventions/[id]/start/route.ts'), 'utf-8');
    expect(src).not.toMatch(/studentId/);
  });

  it('the list route never accepts a client-supplied studentId', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/student/teacher-interventions/route.ts'), 'utf-8');
    expect(src).not.toMatch(/searchParams|params:/);
  });
});
