/**
 * F12 -- source guards for the Institution Intelligence invariants:
 * (1) zero direct learning_evidence/learner state/readiness/diagnostic/
 *     Canonical writes anywhere in the module;
 * (2) no legacy readiness import (INV-F12-09);
 * (3) no Teacher quality/ranking score computation (INV-F12-13/14);
 * (4) no new authorization primitive -- only F2's canAccessInstitution/
 *     canAccessClass are used (INV-F12-22);
 * (5) no AI call site for metric computation (task section 34).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MODULE_DIR = 'src/lib/institution-intelligence';

function readAllModuleFiles(): Array<{ path: string; src: string }> {
  const dir = join(process.cwd(), MODULE_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ path: `${MODULE_DIR}/${f}`, src: readFileSync(join(dir, f), 'utf-8') }));
}

/** Strips /** *\/ block comments and // line comments so guards below check real CODE, never prose that documents the very invariant being guarded (e.g. a comment explaining "never import exam-readiness.service" would otherwise self-trigger the guard). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('F12 Institution Intelligence never becomes a second academic-truth or authorization authority', () => {
  it('the module directory exists and contains the expected files', () => {
    const files = readAllModuleFiles();
    const names = files.map((f) => f.path);
    for (const expected of ['authorization.ts', 'policy.service.ts', 'roster.service.ts', 'learning.service.ts', 'coverage.service.ts', 'readiness.service.ts', 'diagnostics.service.ts', 'interventions.service.ts', 'attention.service.ts', 'index.ts']) {
      expect(names.some((n) => n.endsWith(expected)), `${expected} should exist`).toBe(true);
    }
  });

  it('zero direct writes to learning_evidence, mastery_records, learner state, readiness, diagnostic, or Canonical V2 tables anywhere in the module', () => {
    const files = readAllModuleFiles();
    for (const { path, src } of files) {
      expect(src, `${path}`).not.toMatch(/INSERT INTO learning_evidence|UPDATE learning_evidence/);
      expect(src, `${path}`).not.toMatch(/INSERT INTO mastery_records|UPDATE mastery_records/);
      expect(src, `${path}`).not.toMatch(/INSERT INTO learner_skill_state|UPDATE learner_skill_state/);
      expect(src, `${path}`).not.toMatch(/INSERT INTO learner_competency_state|UPDATE learner_competency_state/);
      expect(src, `${path}`).not.toMatch(/INSERT INTO concept_knowledge_state|UPDATE concept_knowledge_state/);
      expect(src, `${path}`).not.toMatch(/INSERT INTO readiness_snapshots|UPDATE readiness_snapshots/);
      expect(src, `${path}`).not.toMatch(/INSERT INTO learner_gap_diagnoses|UPDATE learner_gap_diagnoses/);
      expect(src, `${path}`).not.toMatch(/pedagogical_requirement_recognition|canonical_prepared_activity|concept_transfer_state/);
      expect(src, `${path}`).not.toMatch(/\bupdateMastery\(/);
      expect(src, `${path}`).not.toMatch(/\brunDiagnosis\(|\breplayDiagnosis\(/);
      expect(src, `${path}`).not.toMatch(/\bcomputeReadinessSnapshot\(/);
    }
  });

  it('no file in the module imports the legacy exam-readiness service (INV-F12-09)', () => {
    const files = readAllModuleFiles();
    for (const { path, src } of files) {
      const code = stripComments(src);
      expect(code, `${path}`).not.toMatch(/from\s+['"][^'"]*exam-readiness\.service['"]/);
      expect(code, `${path}`).not.toMatch(/\b(calculateExamReadiness|getMultiSubjectReadiness|getOverallExamReadiness)\s*\(/);
    }
  });

  it('no Teacher performance/quality/ranking score is computed anywhere (INV-F12-13/14)', () => {
    const files = readAllModuleFiles();
    for (const { path, src } of files) {
      const code = stripComments(src);
      expect(code, `${path}`).not.toMatch(/teacherScore|teacherRank|teacherQuality|bestTeacher|worstTeacher|TEACHER_QUALITY|TEACHER_RANK/i);
      expect(code, `${path}`).not.toMatch(/ORDER BY[^;]*teacher[^;]*(score|rank)/i);
    }
  });

  it('no AI call site exists for metric computation (task section 34)', () => {
    const files = readAllModuleFiles();
    for (const { path, src } of files) {
      expect(src, `${path}`).not.toMatch(/executeAI|generateObject|generateText|anthropic\(|openai\(/i);
    }
  });

  it('authorization.ts introduces no new primitive -- it only composes F2\'s real canAccessInstitution/canAccessClass', () => {
    const src = readFileSync(join(process.cwd(), MODULE_DIR, 'authorization.ts'), 'utf-8');
    expect(src).toMatch(/canAccessInstitution/);
    expect(src).toMatch(/canAccessClass/);
    expect(src).not.toMatch(/membership_role\s*===\s*'INSTITUTION_ADMIN'/);
    expect(src).not.toMatch(/role\s*===\s*'INSTITUTION_ADMIN'\s*(&&|\?)/);
  });

  it('the small-cohort policy fails closed when no ACTIVE policy exists -- never a hard-coded product default (task section 27)', () => {
    const src = readFileSync(join(process.cwd(), MODULE_DIR, 'policy.service.ts'), 'utf-8');
    expect(src).toMatch(/NoActiveAnalyticsPolicyError/);
    expect(src).toMatch(/OPEN_DECISION/);
    expect(src).not.toMatch(/minimumCohortSize\s*[:=]\s*\d/);
  });

  it('roster/learning/readiness/interventions services never issue one query per learner (no per-row loop containing a db.query call)', () => {
    const files = readAllModuleFiles();
    for (const { path, src } of files) {
      // A for/forEach/map loop body containing db.query would be the N+1 smell this guards against.
      const loopWithQuery = /for\s*\([^)]*\)\s*\{[^}]*db\.query/.test(src) || /\.(forEach|map)\([^)]*=>\s*\{[^}]*db\.query/.test(src);
      expect(loopWithQuery, `${path} should not contain a per-iteration db.query call`).toBe(false);
    }
  });
});
