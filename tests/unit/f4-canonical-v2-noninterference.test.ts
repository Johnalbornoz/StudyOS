/**
 * F4 -- INV-F4-01/06/11/16/17/18: the canonical catalog is a purely
 * additive, parallel domain. It must never become a competing
 * pedagogical/progression authority, never touch any of the 19
 * evidence/state tables that FK to the per-student concepts.id, never
 * modify concepts/subjects/topics/subtopics themselves, and never cross-
 * import with F2 authorization or F3 entitlements. Extends the F1/F2/F3
 * non-interference proof pattern to every new F4 file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F4_LIB_FILES = [
  'src/lib/catalog/types.ts',
  'src/lib/catalog/canonical-catalog.service.ts',
  'src/lib/catalog/prerequisite.service.ts',
  'src/lib/catalog/mapping.service.ts',
];

const F4_ROUTE_FILES = [
  'src/app/api/admin/catalog/subjects/route.ts',
  'src/app/api/admin/catalog/concepts/route.ts',
  'src/app/api/admin/catalog/mappings/route.ts',
  'src/app/api/admin/catalog/mappings/confirm/route.ts',
  'src/app/api/admin/catalog/taxonomy/route.ts',
];

const ALL_F4_FILES = [...F4_LIB_FILES, ...F4_ROUTE_FILES];

const EVIDENCE_STATE_TABLES = [
  'learning_evidence',
  'mastery_records',
  'mastery_events',
  'concept_knowledge_state',
  'concept_memory_state',
  'concept_transfer_state',
  'misconception_signatures',
  'student_misconceptions',
  'validation_cycles',
  'validation_events',
  'calibration_conflicts',
  'cognitive_diagnoses',
  'remediation_paths',
  'remediation_steps',
  'errors',
  'learning_debt',
  'assessment_concept_coverage',
  'study_session_items',
  'quiz_sessions',
  'verification_attempts',
];

describe('F4 does not introduce a competing pedagogical/progression authority', () => {
  it('all F4 files exist', () => {
    for (const relPath of ALL_F4_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('no F4 file imports from pedagogical-engine, pedagogical-decision, or pedagogical-shadow', () => {
    for (const relPath of ALL_F4_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import Canonical V2 internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-decision|pedagogical-shadow|pedagogical-migration)/
      );
    }
  });

  it('no F4 file writes to any of the 19 evidence/state tables', () => {
    const tablesPattern = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+(${EVIDENCE_STATE_TABLES.join('|')})\\b`, 'i');
    for (const relPath of ALL_F4_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch any evidence/state table`).not.toMatch(tablesPattern);
    }
  });

  it('no F4 file writes to concepts, subjects, topics, or subtopics (read-only access to learner concept identity)', () => {
    const pattern = /(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(concepts|subjects|topics|subtopics)\b/i;
    for (const relPath of ALL_F4_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must never write to concepts/subjects/topics/subtopics`).not.toMatch(pattern);
    }
  });

  it('src/lib/catalog never issues a DELETE against any table (catalog curation is additive/corrective, not destructive, this phase)', () => {
    for (const relPath of F4_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must never DELETE anything`).not.toMatch(/DELETE FROM/i);
    }
  });

  it('src/lib/catalog never imports src/lib/authorization (F2) or src/lib/entitlements (F3), and vice versa', () => {
    for (const relPath of F4_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import F2 authorization`).not.toMatch(/from ['"]@\/lib\/authorization/);
      expect(src, `${relPath} must not import F3 entitlements`).not.toMatch(/from ['"]@\/lib\/entitlements/);
    }
    const authorization = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf-8');
    expect(authorization).not.toMatch(/from ['"]@\/lib\/catalog/);
    const entitlements = readFileSync(join(process.cwd(), 'src/lib/entitlements/index.ts'), 'utf-8');
    expect(entitlements).not.toMatch(/from ['"]@\/lib\/catalog/);
  });

  it('canonical_concepts has no uniqueness constraint on name (INV-F4-04 -- same name may legitimately mean different concepts)', () => {
    const migration = readFileSync(
      join(process.cwd(), 'database/migrations/20260922_1000_f4_learning_architecture_2.sql'),
      'utf-8'
    );
    expect(migration).not.toMatch(/UNIQUE\s*\(\s*canonical_subject_id\s*,\s*name\s*\)/i);
    expect(migration).not.toMatch(/canonical_concepts[\s\S]*?name\s+text\s+NOT\s+NULL\s+UNIQUE/i);
  });

  it('the migration never merges by name alone -- ambiguous candidates never auto-pick a single canonical concept', () => {
    const migration = readFileSync(
      join(process.cwd(), 'database/migrations/20260922_1000_f4_learning_architecture_2.sql'),
      'utf-8'
    );
    expect(migration).toMatch(/AMBIGUOUS/);
    expect(migration).toMatch(/never auto-picked/i);
  });
});

describe('F0-S/F1/F2/F3 protections remain present (source-level guard; behavior covered by the unmodified test files)', () => {
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
