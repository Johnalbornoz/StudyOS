/**
 * F11-B -- source guard proving the Teacher Intervention domain never
 * imports the generic canAccessLearner (which composes Owner/Parent/
 * Teacher as equivalent) and never grants access via
 * LEARNER_INTERVENTION_CREATE (F8's owner-only permission, preserved
 * unchanged). Mirrors F11-A's own guard test for the same reason.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F11B_LIB_FILES = ['src/lib/teacher/intervention.service.ts'];

const F11B_ROUTE_FILES = [
  'src/app/api/teacher/interventions/route.ts',
  'src/app/api/teacher/interventions/[id]/cancel/route.ts',
  'src/app/api/teacher/students/[studentId]/interventions/route.ts',
];

const ALL_F11B_FILES = [...F11B_LIB_FILES, ...F11B_ROUTE_FILES];

describe('F11-B Teacher Intervention domain resolves access through Teacher-specific primitives only', () => {
  it('all F11-B files exist', () => {
    for (const relPath of ALL_F11B_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('intervention.service.ts never imports the generic canAccessLearner', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teacher/intervention.service.ts'), 'utf-8');
    expect(src).not.toMatch(/import\s*\{[^}]*\bcanAccessLearner\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
  });

  it('intervention.service.ts never references LEARNER_INTERVENTION_CREATE (F8 owner-only permission, untouched)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teacher/intervention.service.ts'), 'utf-8');
    expect(src).not.toMatch(/LEARNER_INTERVENTION_CREATE/);
  });

  it('intervention.service.ts imports canAccessClass and canTeacherManageIntervention from the canonical F2 authorization module', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teacher/intervention.service.ts'), 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*\bcanAccessClass\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
    expect(src).toMatch(/import\s*\{[^}]*\bcanTeacherManageIntervention\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
  });

  it('intervention.service.ts never imports or calls any F8 evidence-writing or session-starting function', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teacher/intervention.service.ts'), 'utf-8');
    expect(src).not.toMatch(/writeInterventionEvidence|startInterventionSession|recordInterventionAttempt|updateMastery/);
  });

  it('no F11-B route performs its own authorization logic beyond resolving the actor and delegating to the domain service', () => {
    for (const relPath of F11B_ROUTE_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import canAccessLearner`).not.toMatch(/canAccessLearner/);
      expect(src, `${relPath} must not import isActiveParentOf`).not.toMatch(/isActiveParentOf/);
    }
  });

  it('the assign function re-runs class access, active enrollment, and teacher-learner checks explicitly, never inferring from stored ids alone', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teacher/intervention.service.ts'), 'utf-8');
    const start = src.indexOf('async function requireAssignmentAuthorization');
    const body = src.slice(start, start + 1200);
    expect(body).toMatch(/canAccessClass\(/);
    expect(body).toMatch(/class_enrollments/);
    expect(body).toMatch(/status = 'ACTIVE'/);
    expect(body).toMatch(/canTeacherManageIntervention\(/);
  });
});
