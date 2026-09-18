/**
 * F8 -- INV-F8-01/02/20: F8 diagnosis/intervention selection must
 * never independently change pedagogical stage. Extends the F1-F7
 * non-interference pattern verbatim. The full existing Canonical V2
 * test suite re-runs unmodified in this same run as the real
 * regression proof (see F8_QA_REPORT.md).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F8_LIB_FILES = [
  'src/lib/diagnostics/types.ts',
  'src/lib/diagnostics/policy.service.ts',
  'src/lib/diagnostics/evidence-gate.service.ts',
  'src/lib/diagnostics/classification.algorithms.ts',
  'src/lib/diagnostics/diagnosis.service.ts',
  'src/lib/diagnostics/explain.service.ts',
  'src/lib/teaching/types.ts',
  'src/lib/teaching/intervention-policy.service.ts',
  'src/lib/teaching/intervention-selection.service.ts',
  'src/lib/teaching/framework-context.service.ts',
  'src/lib/teaching/command-term-teaching.service.ts',
  'src/lib/teaching/session.service.ts',
  'src/lib/teaching/feedback.service.ts',
  'src/lib/teaching/evidence-integration.service.ts',
  'src/lib/teaching/ai-teaching-contract.service.ts',
];

const F8_ROUTE_FILES = [
  'src/app/api/diagnostics/run/route.ts',
  'src/app/api/diagnostics/route.ts',
  'src/app/api/diagnostics/[id]/explain/route.ts',
  'src/app/api/teaching/interventions/route.ts',
  'src/app/api/teaching/interventions/[id]/route.ts',
  'src/app/api/teaching/interventions/[id]/attempts/route.ts',
  'src/app/api/admin/diagnostics/policy/route.ts',
  'src/app/api/admin/teaching/intervention-policy/route.ts',
  'src/app/api/admin/teaching/command-term-interpretations/route.ts',
  'src/app/api/admin/teaching/command-term-interpretations/activate/route.ts',
];

const ALL_F8_FILES = [...F8_LIB_FILES, ...F8_ROUTE_FILES];

const CANONICAL_V2_TABLES = ['pedagogical_requirement_recognition', 'canonical_prepared_activity', 'concept_transfer_state', 'concept_knowledge_state'];
const PROGRESSION_FUNCTIONS = ['evaluateCanonicalLearningState', 'rebuildConceptCanonicalState', 'qualifyEvidence'];
const PROGRESSION_VOCABULARY = ['PROVE_PASSED', 'PRACTICE_PASSED', 'RETAIN_PASSED', 'TRANSFER_PASSED'];

describe('F8 does not introduce a competing pedagogical/progression authority', () => {
  it('all F8 files exist', () => {
    for (const relPath of ALL_F8_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('no F8 file imports Canonical V2 internals other than the read-only getCanonicalPedagogicalDecision entry point', () => {
    for (const relPath of ALL_F8_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import pedagogical-engine/-shadow/-migration internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-shadow|pedagogical-migration)/
      );
      const decisionImport = src.match(/from ['"]@\/lib\/pedagogical-decision[^'"]*['"]/g) ?? [];
      for (const imp of decisionImport) {
        expect(imp, `${relPath} may only import the read-only canonical-decision.service module`).toMatch(/canonical-decision\.service/);
      }
    }
  });

  it('no F8 file calls any Canonical V2 progression function', () => {
    for (const relPath of ALL_F8_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const fn of PROGRESSION_FUNCTIONS) {
        expect(src, `${relPath} must not call ${fn}`).not.toMatch(new RegExp(`\\b${fn}\\b`));
      }
    }
  });

  it('no F8 file writes to a Canonical-V2-owned table (SQL, not doc comments)', () => {
    const tablesPattern = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+(public\\.)?(${CANONICAL_V2_TABLES.join('|')})\\b`, 'i');
    for (const relPath of F8_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch a Canonical-V2-owned table`).not.toMatch(tablesPattern);
    }
  });

  it('no F8 file writes to learning_evidence directly -- only via the real updateMastery() call', () => {
    for (const relPath of F8_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not INSERT INTO learning_evidence directly`).not.toMatch(/INSERT INTO\s+(public\.)?learning_evidence/i);
    }
    const evidenceSrc = readFileSync(join(process.cwd(), 'src/lib/teaching/evidence-integration.service.ts'), 'utf-8');
    expect(evidenceSrc).toMatch(/from ['"]@\/services\/mastery\.service['"]/);
  });

  it('no F8 route exposes a fabricated progression verdict', () => {
    for (const relPath of F8_ROUTE_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const term of PROGRESSION_VOCABULARY) {
        expect(src, `${relPath} must not expose ${term}`).not.toMatch(new RegExp(`\\b${term}\\b`));
      }
    }
  });

  it('classification.algorithms.ts is pure -- no AI import, no fetch/executeAI/callModel call', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/diagnostics/classification.algorithms.ts'), 'utf-8');
    expect(src).not.toMatch(/executeAI|callModel|from ['"]@\/lib\/ai/);
  });

  it('evidence-integration.service.ts never attaches competencyIds metadata -- F8 introduces no competency-attachment path (INV-F8-12)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teaching/evidence-integration.service.ts'), 'utf-8');
    const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    expect(codeLines.join('\n')).not.toMatch(/competencyIds/);
  });

  it('session.service.ts refuses to record an attempt for a PROVE session', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teaching/session.service.ts'), 'utf-8');
    expect(src).toMatch(/ProveNotRecordableHereError/);
  });

  it('diagnosis persistence is append-only -- no UPDATE/DELETE against learner_gap_diagnoses anywhere in F8', () => {
    for (const relPath of ALL_F8_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not UPDATE/DELETE learner_gap_diagnoses`).not.toMatch(/(UPDATE|DELETE FROM)\s+(public\.)?learner_gap_diagnoses/i);
    }
  });

  it('migration keeps blueprint-shaped ordering out of scope: F8 tables never reference structure_node_id', () => {
    const migration = readFileSync(join(process.cwd(), 'database/migrations/20260926_1000_f8_framework_aware_teaching_exam_skills.sql'), 'utf-8');
    const codeLines = migration.split('\n').filter((l) => !l.trim().startsWith('--'));
    expect(codeLines.join('\n')).not.toMatch(/structure_node_id/);
  });

  it('command_term_interpretations enforces at most one ACTIVE row per (term, programme) and per (term, default) at the schema level', () => {
    const migration = readFileSync(join(process.cwd(), 'database/migrations/20260926_1000_f8_framework_aware_teaching_exam_skills.sql'), 'utf-8');
    expect(migration).toMatch(/idx_cti_one_active_per_term_programme/);
    expect(migration).toMatch(/idx_cti_one_active_default/);
  });
});

describe('F0-S/F1-F7 protections remain present (source-level guard; behavior covered by the unmodified test files)', () => {
  it('F7 assessment framework service untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/assessment/generation-contract.service.ts'), 'utf-8');
    expect(src).toMatch(/resolveGenerationContext/);
  });

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

  it('F2 authorization service untouched apart from F8 being its first real LEARNER_INTERVENTION_CREATE consumer', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf-8');
    expect(src).toMatch(/canAccessLearner/);
    expect(src).toMatch(/LEARNER_INTERVENTION_CREATE/);
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
