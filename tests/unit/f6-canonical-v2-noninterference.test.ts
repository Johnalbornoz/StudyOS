/**
 * F6 -- INV-F6-16/17: curriculum alignment is context, not progression
 * authority. Extends the F1-F5 non-interference proof pattern. The full
 * existing Canonical V2 test suite re-runs unmodified in this same run
 * as the real regression proof (see F6_QA_REPORT.md).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F6_LIB_FILES = [
  'src/lib/curriculum/types.ts',
  'src/lib/curriculum/organization.service.ts',
  'src/lib/curriculum/structure.service.ts',
  'src/lib/curriculum/objective.service.ts',
  'src/lib/curriculum/mapping.service.ts',
  'src/lib/curriculum/resource.service.ts',
  'src/lib/curriculum/editorial.service.ts',
  'src/lib/curriculum/coverage.service.ts',
  'src/lib/curriculum/activity-metadata-bridge.service.ts',
  'src/lib/curriculum/private-content-alignment.service.ts',
];

const F6_ROUTE_FILES = [
  'src/app/api/admin/curriculum/structures/route.ts',
  'src/app/api/admin/curriculum/structure-nodes/route.ts',
  'src/app/api/admin/curriculum/objectives/route.ts',
  'src/app/api/admin/curriculum/mappings/route.ts',
  'src/app/api/admin/curriculum/mappings/transition/route.ts',
  'src/app/api/admin/curriculum/coverage/route.ts',
];

const ALL_F6_FILES = [...F6_LIB_FILES, ...F6_ROUTE_FILES];

const CANONICAL_V2_TABLES = ['pedagogical_requirement_recognition', 'canonical_prepared_activity', 'concept_transfer_state'];
const F5_STATE_TABLES = ['learner_skill_state', 'learner_competency_state', 'learner_transfer_analytics', 'aggregation_policy_versions'];
const PROGRESSION_VOCABULARY = ['PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER_ELIGIBLE', 'QUALIFIES', 'DOES_NOT_QUALIFY'];

describe('F6 does not introduce a competing pedagogical/progression authority', () => {
  it('all F6 files exist', () => {
    for (const relPath of ALL_F6_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('no F6 file imports from pedagogical-engine, pedagogical-decision, pedagogical-shadow, or pedagogical-migration', () => {
    for (const relPath of ALL_F6_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import Canonical V2 internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-decision|pedagogical-shadow|pedagogical-migration)/
      );
    }
  });

  it('no F6 file writes to any Canonical-V2-owned table or any F5 Learner State table', () => {
    const tablesPattern = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+(public\\.)?(${[...CANONICAL_V2_TABLES, ...F5_STATE_TABLES].join('|')})\\b`, 'i');
    for (const relPath of ALL_F6_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch a Canonical-V2-owned or F5 Learner State table`).not.toMatch(tablesPattern);
    }
  });

  it('no F6 file writes to learning_evidence, mastery_records, concept_knowledge_state, concepts, subjects, or canonical_concepts', () => {
    const pattern = /(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(learning_evidence|mastery_records|concept_knowledge_state|concepts|subjects|canonical_concepts|skills|competencies)\b/i;
    for (const relPath of ALL_F6_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must be read-only with respect to these tables`).not.toMatch(pattern);
    }
  });

  it('no F6 route returns a PRACTICE/PROVE/RETAIN/TRANSFER-shaped progression verdict', () => {
    for (const relPath of F6_ROUTE_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const term of PROGRESSION_VOCABULARY) {
        expect(src, `${relPath} must not expose ${term}`).not.toMatch(new RegExp(`\\b${term}\\b`));
      }
    }
  });

  it('src/lib/curriculum never imports F2 authorization, F3 entitlements, or F5 learner-state, and vice versa', () => {
    for (const relPath of F6_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import F2 authorization`).not.toMatch(/from ['"]@\/lib\/authorization/);
      expect(src, `${relPath} must not import F3 entitlements`).not.toMatch(/from ['"]@\/lib\/entitlements/);
      expect(src, `${relPath} must not import F5 learner-state`).not.toMatch(/from ['"]@\/lib\/learner-state/);
    }
    const authorization = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf-8');
    expect(authorization).not.toMatch(/from ['"]@\/lib\/curriculum/);
    const learnerState = readFileSync(join(process.cwd(), 'src/lib/learner-state/skill-state.service.ts'), 'utf-8');
    expect(learnerState).not.toMatch(/from ['"]@\/lib\/curriculum/);
  });

  it('editorial grants never touch user_roles or the F1 Role enum (task 32)', () => {
    // Doc comments may name user_roles to explain why it's NOT queried --
    // the real assertion is that no actual SQL clause (FROM/JOIN/UPDATE/
    // INSERT INTO) touches it.
    const src = readFileSync(join(process.cwd(), 'src/lib/curriculum/editorial.service.ts'), 'utf-8');
    expect(src).not.toMatch(/(FROM|JOIN|INTO|UPDATE)\s+user_roles/);
    expect(src).toMatch(/curriculum_editorial_grants/);
  });

  it('mapping tables reference F4 canonical_concepts/skills/competencies by id -- never a duplicated knowledge table (INV-F6-01/02)', () => {
    const migration = readFileSync(
      join(process.cwd(), 'database/migrations/20260924_1000_f6_curriculum_standards_mapping.sql'),
      'utf-8'
    );
    expect(migration).toMatch(/canonical_concept_id uuid NOT NULL REFERENCES public\.canonical_concepts\(id\)/);
    expect(migration).toMatch(/skill_id uuid NOT NULL REFERENCES public\.skills\(id\)/);
    expect(migration).toMatch(/competency_id uuid NOT NULL REFERENCES public\.competencies\(id\)/);
    expect(migration).not.toMatch(/CREATE TABLE[\s\S]{0,200}(ib_|cambridge_|paa_)concepts/i);
  });

  it('no F6 table has a student_id column (INV-F6-15 -- no framework-specific learner state)', () => {
    // The migration's own header comment names "student_id" to state this
    // invariant in prose -- the real assertion is that no actual column
    // definition (a line ending in a type/constraint, not a "--" comment)
    // declares one.
    const migration = readFileSync(
      join(process.cwd(), 'database/migrations/20260924_1000_f6_curriculum_standards_mapping.sql'),
      'utf-8'
    );
    const codeLines = migration.split('\n').filter((line) => !line.trim().startsWith('--'));
    expect(codeLines.join('\n')).not.toMatch(/student_id/);
  });
});

describe('F0-S/F1/F2/F3/F4/F5 protections remain present (source-level guard; behavior covered by the unmodified test files)', () => {
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
