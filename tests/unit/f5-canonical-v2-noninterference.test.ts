/**
 * F5 -- INV-F5-05/06/07/08/09: analytical Learner State must never become
 * a competing pedagogical/progression authority. Extends the F1-F4
 * non-interference proof pattern to every new F5 file. The full existing
 * Canonical V2 test suite re-runs unmodified in this same test run as the
 * real regression proof (see F5_QA_REPORT.md).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F5_LIB_FILES = [
  'src/lib/learner-state/types.ts',
  'src/lib/learner-state/algorithms/state-classification.ts',
  'src/lib/learner-state/policy.service.ts',
  'src/lib/learner-state/skill-state.service.ts',
  'src/lib/learner-state/competency-state.service.ts',
  'src/lib/learner-state/transfer-analytics.service.ts',
  'src/lib/learner-state/knowledge-state-explain.service.ts',
];

const F5_ROUTE_FILES = [
  'src/app/api/admin/learner-state/skill/route.ts',
  'src/app/api/admin/learner-state/competency/route.ts',
  'src/app/api/admin/learner-state/transfer/route.ts',
  'src/app/api/admin/learner-state/knowledge/route.ts',
  'src/app/api/admin/learner-state/policy/route.ts',
  'src/app/api/admin/learner-state/replay/route.ts',
];

const ALL_F5_FILES = [...F5_LIB_FILES, ...F5_ROUTE_FILES];

// Canonical V2-owned tables and progression vocabulary that no F5 file
// may write to or expose as its own verdict.
const CANONICAL_V2_TABLES = ['pedagogical_requirement_recognition', 'canonical_prepared_activity', 'concept_transfer_state'];
const PROGRESSION_VOCABULARY = ['PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER_ELIGIBLE', 'QUALIFIES', 'DOES_NOT_QUALIFY'];

describe('F5 does not introduce a competing pedagogical/progression authority', () => {
  it('all F5 files exist', () => {
    for (const relPath of ALL_F5_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('no F5 file imports from pedagogical-engine, pedagogical-decision, pedagogical-shadow, or pedagogical-migration', () => {
    for (const relPath of ALL_F5_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import Canonical V2 internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-decision|pedagogical-shadow|pedagogical-migration)/
      );
    }
  });

  it('no F5 file calls qualifyEvidence, evaluateCanonicalLearningState, or rebuildConceptCanonicalState', () => {
    for (const relPath of ALL_F5_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src).not.toMatch(/qualifyEvidence|evaluateCanonicalLearningState|rebuildConceptCanonicalState/);
    }
  });

  it('no F5 file writes to any Canonical-V2-owned table', () => {
    const tablesPattern = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+(public\\.)?(${CANONICAL_V2_TABLES.join('|')})\\b`, 'i');
    for (const relPath of ALL_F5_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch a Canonical-V2-owned table`).not.toMatch(tablesPattern);
    }
  });

  it('no F5 file writes to learning_evidence, mastery_records, concept_knowledge_state, concept_memory_state, concepts, or subjects', () => {
    const pattern = /(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(learning_evidence|mastery_records|concept_knowledge_state|concept_memory_state|concepts|subjects)\b/i;
    for (const relPath of ALL_F5_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must be read-only with respect to these tables`).not.toMatch(pattern);
    }
  });

  it('no F5 route returns a PRACTICE/PROVE/RETAIN/TRANSFER-shaped progression verdict', () => {
    for (const relPath of F5_ROUTE_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const term of PROGRESSION_VOCABULARY) {
        expect(src, `${relPath} must not expose ${term}`).not.toMatch(new RegExp(`\\b${term}\\b`));
      }
    }
  });

  it('src/lib/learner-state never imports F2 authorization or F3 entitlements, and vice versa', () => {
    for (const relPath of F5_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import F2 authorization`).not.toMatch(/from ['"]@\/lib\/authorization/);
      expect(src, `${relPath} must not import F3 entitlements`).not.toMatch(/from ['"]@\/lib\/entitlements/);
    }
    const authorization = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf-8');
    expect(authorization).not.toMatch(/from ['"]@\/lib\/learner-state/);
    const entitlements = readFileSync(join(process.cwd(), 'src/lib/entitlements/index.ts'), 'utf-8');
    expect(entitlements).not.toMatch(/from ['"]@\/lib\/learner-state/);
  });

  it('Skill/Competency state is never derived from the F4 concept->skill/competency graph (AC-F5-05/04)', () => {
    // Doc comments may name these tables (lowercase "from") to explain why
    // they're NOT used -- the real assertion is that no actual SQL clause
    // (uppercase FROM/JOIN, this codebase's consistent SQL style) reads
    // from them. Intentionally case-sensitive.
    const skillSrc = readFileSync(join(process.cwd(), 'src/lib/learner-state/skill-state.service.ts'), 'utf-8');
    expect(skillSrc).not.toMatch(/(FROM|JOIN)\s+canonical_concept_skills/);
    const competencySrc = readFileSync(join(process.cwd(), 'src/lib/learner-state/competency-state.service.ts'), 'utf-8');
    expect(competencySrc).not.toMatch(/(FROM|JOIN)\s+(skill_competencies|canonical_concept_competencies)/);
  });
});

describe('F0-S/F1/F2/F3/F4 protections remain present (source-level guard; behavior covered by the unmodified test files)', () => {
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
