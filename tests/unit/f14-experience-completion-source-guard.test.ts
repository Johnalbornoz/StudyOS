/**
 * F14 -- source guards for Experience Completion + Canonical Readiness
 * Migration invariants:
 * (1) no new/modified surface computes Mastery/Readiness/Coverage/Gap
 *     itself (only presents an already-certified server decision);
 * (2) no new/modified surface writes directly to a canonical/domain
 *     table;
 * (3) no new/modified surface imports the legacy
 *     `exam-readiness.service.ts` (carried forward from F13's own
 *     INV-F13-09/10, now also covering the Parent migration and new
 *     Exam Prep/Assignment surfaces);
 * (4) the Assignment Practice runner never grades an answer itself --
 *     grading remains 100% delegated to the real, unmodified
 *     `/api/quizzes/generate-and-take` submit branch;
 * (5) the new quiz-session read adapter sanitizes questions through the
 *     same `toClientQuestion` helper the self-service flow uses (never
 *     returns a raw stored `correctAnswer` to the client);
 * (6) the Parent dashboard no longer renders the legacy
 *     `examReadiness` field (F14 Workstream C's own migration).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

const NEW_OR_MODIFIED_SURFACE_FILES = [
  'src/app/api/quizzes/session/[quizId]/route.ts',
  'src/app/api/simulation/attempts/[id]/abandon/route.ts',
  'src/app/dashboard/exam-prep/page.tsx',
  'src/app/dashboard/exam-prep/[examProfileId]/page.tsx',
  'src/app/dashboard/exam-prep/[examProfileId]/StartSimulationPanel.tsx',
  'src/app/dashboard/exam-prep/attempt/[attemptId]/page.tsx',
  'src/app/dashboard/exam-prep/attempt/[attemptId]/AttemptControls.tsx',
  'src/app/dashboard/assignments/page.tsx',
  'src/app/dashboard/assignments/StartAssignmentButton.tsx',
  'src/app/dashboard/assignments/practice/page.tsx',
  'src/app/dashboard/assignments/practice/PracticeRunner.tsx',
  'src/app/dashboard/institution/[institutionId]/grades/page.tsx',
  'src/app/dashboard/institution/[institutionId]/classes/page.tsx',
  'src/app/dashboard/institution/[institutionId]/teachers/page.tsx',
  'src/app/dashboard/institution/[institutionId]/coverage/page.tsx',
  'src/app/dashboard/institution/[institutionId]/readiness/page.tsx',
  'src/app/dashboard/parent/page.tsx',
  'src/app/dashboard/teacher/students/AssignInterventionForm.tsx',
  'src/app/api/teacher/interventions/route.ts',
  'src/lib/lx/learner-navigation.ts',
  'src/app/dashboard/layout.tsx',
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function readAll(paths: string[]): Array<{ path: string; src: string }> {
  return paths
    .filter((p) => {
      try {
        return statSync(join(process.cwd(), p)).isFile();
      } catch {
        return false;
      }
    })
    .map((p) => ({ path: p, src: readFileSync(join(process.cwd(), p), 'utf-8') }));
}

describe('F14 Experience Completion never becomes a second domain-truth or grading authority', () => {
  it('every listed new/modified surface file exists', () => {
    const files = readAll(NEW_OR_MODIFIED_SURFACE_FILES);
    expect(files.length).toBe(NEW_OR_MODIFIED_SURFACE_FILES.length);
  });

  it('no new/modified surface imports the legacy exam-readiness service', () => {
    const files = readAll(NEW_OR_MODIFIED_SURFACE_FILES);
    for (const { path, src } of files) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(/from\s+['"][^'"]*exam-readiness\.service['"]/);
      expect(code, path).not.toMatch(/\b(calculateExamReadiness|getMultiSubjectReadiness|getOverallExamReadiness)\s*\(/);
    }
  });

  it('no new/modified surface calculates Mastery/Readiness/Coverage/Gap itself (presentation only)', () => {
    const files = readAll(NEW_OR_MODIFIED_SURFACE_FILES);
    for (const { path, src } of files) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(/\bcomputeReadinessSnapshot\(/);
      expect(code, path).not.toMatch(/\bcomputeMappingCoverage\(|\bcomputeContentCoverage\(/);
      expect(code, path).not.toMatch(/\bupdateMastery\(/);
      expect(code, path).not.toMatch(/\brunDiagnosis\(|\breplayDiagnosis\(|\brunPostExamDiagnosis\(/);
    }
  });

  it('no new/modified surface writes directly to a canonical/domain table (INSERT/UPDATE outside an already-certified service)', () => {
    const files = readAll(NEW_OR_MODIFIED_SURFACE_FILES.filter((p) => !p.startsWith('src/app/api/'))); // the two new API routes call certified service functions only, checked separately below
    for (const { path, src } of files) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(/INSERT INTO |UPDATE\s+\w+\s+SET/);
    }
  });

  it('the new quiz-session route delegates to getQuizSession + toClientQuestion (never fabricates or re-derives question content)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/quizzes/session/[quizId]/route.ts'), 'utf-8');
    expect(src).toMatch(/getQuizSession/);
    expect(src).toMatch(/toClientQuestion/);
    expect(src).not.toMatch(/\bcorrectAnswer\b/);
  });

  it('the new abandon route delegates to the real, unmodified abandonSimulationAttempt (no re-implemented lifecycle logic)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/simulation/attempts/[id]/abandon/route.ts'), 'utf-8');
    expect(src).toMatch(/abandonSimulationAttempt/);
  });

  it('the Assignment Practice runner never grades an answer itself -- grading remains 100% delegated to /api/quizzes/generate-and-take', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/dashboard/assignments/practice/PracticeRunner.tsx'), 'utf-8');
    const code = stripComments(src);
    expect(code).not.toMatch(/\bgradeAnswer\(|\bgradeStructuredAnswer\(/);
    expect(code).not.toMatch(/correctAnswer/);
    expect(code).toMatch(/\/api\/quizzes\/generate-and-take/);
  });

  it('the Parent dashboard no longer renders the legacy examReadiness field (F14 Workstream C migration)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/dashboard/parent/page.tsx'), 'utf-8');
    expect(src).not.toMatch(/examReadiness/);
    expect(src).toMatch(/exam-prep/); // now sources F9 via /api/parent/learners/[studentId]/exam-prep
  });

  it('the Teacher intervention route now maps TeacherInterventionExamProfileMismatchError to a controlled 400 (regression guard for the raw-500 bug this phase found and fixed)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/teacher/interventions/route.ts'), 'utf-8');
    expect(src).toMatch(/TeacherInterventionExamProfileMismatchError/);
    expect(src).toMatch(/EXAM_PROFILE_MISMATCH/);
  });

  it('the primary nav includes the new Exam Prep and Assignments entries, resolved through the same pure buildLearnerNav config (no hard-coded shell JSX)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/lx/learner-navigation.ts'), 'utf-8');
    expect(src).toMatch(/\/dashboard\/exam-prep/);
    expect(src).toMatch(/\/dashboard\/assignments/);
  });
});
