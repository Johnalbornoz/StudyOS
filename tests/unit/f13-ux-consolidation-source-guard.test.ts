/**
 * F13 -- source guards for the UX Consolidation invariants:
 * (1) no new consolidated surface imports the legacy
 *     `exam-readiness.service.ts` (INV-F13-09/10);
 * (2) no new consolidated surface performs a direct SQL write
 *     (INV-F13-01/04-08 -- the frontend must not become a second
 *     domain-truth authority, and every new page/route is presentation
 *     or a thin pass-through to an already-certified service);
 * (3) no Teacher-quality/ranking computation exists in the new Teacher
 *     surfaces (carried forward from F12's own invariant, now also
 *     enforced at the UI layer);
 * (4) the workspace switcher never asserts a workspace client-side
 *     without going through the real F1 `/api/identity/workspace`
 *     route.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const NEW_SURFACE_FILES = [
  'src/app/dashboard/layout.tsx',
  'src/app/dashboard/LearnerShell.tsx',
  'src/app/dashboard/WorkspaceSwitcher.tsx',
  'src/lib/lx/workspace-navigation.ts',
  'src/app/dashboard/teacher/page.tsx',
  'src/app/dashboard/teacher/classes/[classId]/page.tsx',
  'src/app/dashboard/teacher/students/[studentId]/page.tsx',
  'src/app/dashboard/teacher/students/AssignInterventionForm.tsx',
  'src/app/dashboard/institution/page.tsx',
  'src/app/dashboard/institution/[institutionId]/page.tsx',
  'src/app/dashboard/institution/[institutionId]/InstitutionSubNav.tsx',
  'src/app/dashboard/institution/[institutionId]/learners/page.tsx',
  'src/app/dashboard/institution/[institutionId]/interventions/page.tsx',
  'src/app/dashboard/institution/[institutionId]/attention/page.tsx',
  'src/components/ui/StatusBadge.tsx',
  'src/components/ui/EmptyState.tsx',
  'src/components/ui/MetricCard.tsx',
  'src/components/ui/PageHeader.tsx',
  'src/app/api/institutions/mine/route.ts',
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

describe('F13 UX Consolidation never becomes a second domain-truth or authorization authority', () => {
  it('every listed new/modified consolidated surface file exists', () => {
    const files = readAll(NEW_SURFACE_FILES);
    expect(files.length).toBe(NEW_SURFACE_FILES.length);
  });

  it('no new consolidated surface imports the legacy exam-readiness service (INV-F13-09/10)', () => {
    const files = readAll(NEW_SURFACE_FILES);
    for (const { path, src } of files) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(/from\s+['"][^'"]*exam-readiness\.service['"]/);
      expect(code, path).not.toMatch(/\b(calculateExamReadiness|getMultiSubjectReadiness|getOverallExamReadiness)\s*\(/);
    }
  });

  it('no new consolidated surface writes directly to learning_evidence, learner state, readiness, diagnostic, or Canonical V2 tables (INV-F13-04/05/06/07/08)', () => {
    const files = readAll(NEW_SURFACE_FILES);
    for (const { path, src } of files) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(/INSERT INTO learning_evidence|UPDATE learning_evidence/);
      expect(code, path).not.toMatch(/INSERT INTO learner_skill_state|UPDATE learner_skill_state/);
      expect(code, path).not.toMatch(/INSERT INTO learner_competency_state|UPDATE learner_competency_state/);
      expect(code, path).not.toMatch(/INSERT INTO concept_knowledge_state|UPDATE concept_knowledge_state/);
      expect(code, path).not.toMatch(/INSERT INTO readiness_snapshots|UPDATE readiness_snapshots/);
      expect(code, path).not.toMatch(/INSERT INTO learner_gap_diagnoses|UPDATE learner_gap_diagnoses/);
      expect(code, path).not.toMatch(/pedagogical_requirement_recognition|canonical_prepared_activity|concept_transfer_state/);
      expect(code, path).not.toMatch(/\bupdateMastery\(/);
      expect(code, path).not.toMatch(/\brunDiagnosis\(|\breplayDiagnosis\(/);
      expect(code, path).not.toMatch(/\bcomputeReadinessSnapshot\(/);
    }
  });

  it('no Teacher performance/quality/ranking computation exists in the new Teacher surfaces (carried forward from F12)', () => {
    const files = readAll(NEW_SURFACE_FILES.filter((p) => p.includes('/teacher/')));
    for (const { path, src } of files) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(/teacherScore|teacherRank|teacherQuality|bestTeacher|worstTeacher/i);
    }
  });

  it('the workspace switcher writes through the real F1 POST /api/identity/workspace route, never a client-only state change', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/dashboard/WorkspaceSwitcher.tsx'), 'utf-8');
    expect(src).toMatch(/\/api\/identity\/workspace/);
    expect(src).toMatch(/router\.refresh\(\)/);
  });

  it('layout.tsx resolves workspace via F1\'s real resolveAvailableWorkspaces/getActiveWorkspace, never a hard-coded role check', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/dashboard/layout.tsx'), 'utf-8');
    expect(src).toMatch(/resolveAvailableWorkspaces/);
    expect(src).toMatch(/getActiveWorkspace/);
  });

  it('the teacher intervention assignment route now supports the EXAM target branch (regression guard for the gap this phase found and fixed)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/teacher/interventions/route.ts'), 'utf-8');
    expect(src).toMatch(/targetType:\s*z\.literal\('EXAM'\)/);
    expect(src).toMatch(/simulationType/);
  });
});
