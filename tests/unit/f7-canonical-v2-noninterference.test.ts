/**
 * F7 -- INV-F7-01/02/20: assessment scoring must never independently
 * change pedagogical stage. Extends the F1-F6 non-interference pattern.
 * The full existing Canonical V2 test suite re-runs unmodified in this
 * same run as the real regression proof (see F7_QA_REPORT.md).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F7_LIB_FILES = [
  'src/lib/assessment/types.ts',
  'src/lib/assessment/exam-definition.service.ts',
  'src/lib/assessment/component.service.ts',
  'src/lib/assessment/blueprint.service.ts',
  'src/lib/assessment/item-bank.service.ts',
  'src/lib/assessment/student-exam-profile.service.ts',
  'src/lib/assessment/institution-policy.service.ts',
  'src/lib/assessment/generation-contract.service.ts',
  'src/lib/assessment/validation.service.ts',
  'src/lib/assessment/evaluation.service.ts',
  'src/lib/assessment/exam-attempt.service.ts',
  'src/lib/assessment/evidence-bridge.service.ts',
  'src/lib/assessment/full-mock-guard.service.ts',
];

const F7_ROUTE_FILES = [
  'src/app/api/admin/assessment/exam-definitions/route.ts',
  'src/app/api/admin/assessment/exam-versions/route.ts',
  'src/app/api/admin/assessment/exam-versions/transition/route.ts',
  'src/app/api/admin/assessment/full-mock-guard/route.ts',
  'src/app/api/admin/assessment/institution-policies/route.ts',
  'src/app/api/admin/assessment/institution-policies/verify/route.ts',
  'src/app/api/exam-profiles/route.ts',
];

const ALL_F7_FILES = [...F7_LIB_FILES, ...F7_ROUTE_FILES];

const CANONICAL_V2_TABLES = ['pedagogical_requirement_recognition', 'canonical_prepared_activity', 'concept_transfer_state', 'concept_knowledge_state'];
const PROGRESSION_FUNCTIONS = ['evaluateCanonicalLearningState', 'rebuildConceptCanonicalState', 'qualifyEvidence'];
const PROGRESSION_VOCABULARY = ['PROVE_PASSED', 'PRACTICE_PASSED', 'RETAIN_PASSED', 'TRANSFER_PASSED'];

describe('F7 does not introduce a competing pedagogical/progression authority', () => {
  it('all F7 files exist', () => {
    for (const relPath of ALL_F7_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('no F7 file imports from pedagogical-engine, pedagogical-decision, pedagogical-shadow, or pedagogical-migration', () => {
    for (const relPath of ALL_F7_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import Canonical V2 internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-decision|pedagogical-shadow|pedagogical-migration)/
      );
    }
  });

  it('no F7 file calls any Canonical V2 progression function', () => {
    for (const relPath of ALL_F7_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const fn of PROGRESSION_FUNCTIONS) {
        expect(src, `${relPath} must not call ${fn}`).not.toMatch(new RegExp(`\\b${fn}\\b`));
      }
    }
  });

  it('no F7 file writes to a Canonical-V2-owned table (SQL, not doc comments)', () => {
    const tablesPattern = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+(public\\.)?(${CANONICAL_V2_TABLES.join('|')})\\b`, 'i');
    for (const relPath of F7_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch a Canonical-V2-owned table`).not.toMatch(tablesPattern);
    }
  });

  it('no F7 file writes to learning_evidence directly -- only via the real updateMastery() call', () => {
    for (const relPath of F7_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not INSERT INTO learning_evidence directly`).not.toMatch(/INSERT INTO\s+(public\.)?learning_evidence/i);
    }
    const bridgeSrc = readFileSync(join(process.cwd(), 'src/lib/assessment/evidence-bridge.service.ts'), 'utf-8');
    expect(bridgeSrc).toMatch(/from ['"]@\/services\/mastery\.service['"]/);
  });

  it('no F7 route exposes a fabricated progression verdict', () => {
    for (const relPath of F7_ROUTE_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const term of PROGRESSION_VOCABULARY) {
        expect(src, `${relPath} must not expose ${term}`).not.toMatch(new RegExp(`\\b${term}\\b`));
      }
    }
  });

  it('the evidence bridge never fabricates competencyIds -- attaches metadata only conditionally', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/assessment/evidence-bridge.service.ts'), 'utf-8');
    expect(src).toMatch(/attachedCompetencyIds\.length > 0/);
  });

  it('src/lib/assessment never imports F2 authorization or F3 entitlements directly into its lib services (routes may, per task 35/36)', () => {
    for (const relPath of F7_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import F2 authorization`).not.toMatch(/from ['"]@\/lib\/authorization/);
      expect(src, `${relPath} must not import F3 entitlements`).not.toMatch(/from ['"]@\/lib\/entitlements/);
    }
  });

  it('blueprint targets reference F6 learning_objectives, never structure_nodes directly (INV-F6-05/INV-F7-05)', () => {
    const migration = readFileSync(join(process.cwd(), 'database/migrations/20260925_1000_f7_assessment_framework_engine.sql'), 'utf-8');
    expect(migration).toMatch(/learning_objective_id uuid NOT NULL REFERENCES public\.learning_objectives\(id\)/);
    const codeLines = migration.split('\n').filter((l) => !l.trim().startsWith('--'));
    expect(codeLines.join('\n')).not.toMatch(/structure_node_id/);
  });

  it('an unconfigured timing/tool-rule status can never carry rule data at the schema level', () => {
    const migration = readFileSync(join(process.cwd(), 'database/migrations/20260925_1000_f7_assessment_framework_engine.sql'), 'utf-8');
    expect(migration).toMatch(/assessment_components_timing_consistency/);
    expect(migration).toMatch(/assessment_components_tool_rule_consistency/);
  });

  it('institution policy threshold_rules requires VERIFIED at the schema level (AC-F7-07)', () => {
    const migration = readFileSync(join(process.cwd(), 'database/migrations/20260925_1000_f7_assessment_framework_engine.sql'), 'utf-8');
    expect(migration).toMatch(/institution_exam_policies_threshold_requires_verification/);
  });
});

describe('F0-S/F1-F6 protections remain present (source-level guard; behavior covered by the unmodified test files)', () => {
  it('F6 curriculum mapping service untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/curriculum/activity-metadata-bridge.service.ts'), 'utf-8');
    expect(src).toMatch(/resolveActivityMetadataForObjective/);
  });

  it('F5 Learner State projectors untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/learner-state/skill-state.service.ts'), 'utf-8');
    expect(src).toMatch(/projectSkillState/);
  });

  it('F4 canonical catalog mapping service untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/catalog/mapping.service.ts'), 'utf-8');
    expect(src).toMatch(/ensureCatalogMapping/);
  });

  it('F3 entitlement authority untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/entitlements/index.ts'), 'utf-8');
    expect(src).toMatch(/canUseCapability/);
  });

  it('F2 authorization service untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf-8');
    expect(src).toMatch(/canAccessLearner/);
  });

  it('F1 identity/workspace layer untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/identity/workspace.service.ts'), 'utf-8');
    expect(src).toMatch(/resolveAvailableWorkspaces/);
  });

  it('F0-S: quiz-session ownership, content authorization, /api/test containment, AI gateway limiter all still present', () => {
    const gat = readFileSync(join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf-8');
    expect(gat).toMatch(/quizSession\.studentId !== validated\.studentId/);
    const testRoute = readFileSync(join(process.cwd(), 'src/app/api/test/route.ts'), 'utf-8');
    expect(testRoute).toMatch(/VERCEL_ENV/);
    const gateway = readFileSync(join(process.cwd(), 'src/lib/ai/gateway.ts'), 'utf-8');
    expect(gateway).toMatch(/reserveAICall/);
  });
});
