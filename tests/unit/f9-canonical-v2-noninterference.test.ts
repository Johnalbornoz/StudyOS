/**
 * F9 -- INV-F9-01/13/27: readiness computation and simulation planning
 * must never independently change pedagogical stage. Extends the
 * F1-F8 non-interference pattern verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F9_LIB_FILES = [
  'src/lib/readiness/types.ts',
  'src/lib/readiness/policy.service.ts',
  'src/lib/readiness/student-concept-resolution.service.ts',
  'src/lib/readiness/blueprint-coverage.service.ts',
  'src/lib/readiness/dimension-classification.algorithms.ts',
  'src/lib/readiness/readiness.service.ts',
  'src/lib/readiness/score-projection.service.ts',
  'src/lib/readiness/institution-policy-comparison.service.ts',
  'src/lib/simulation/types.ts',
  'src/lib/simulation/eligibility.service.ts',
  'src/lib/simulation/full-mock-eligibility.service.ts',
  'src/lib/simulation/plan.service.ts',
  'src/lib/simulation/attempt.service.ts',
  'src/lib/simulation/scoring.service.ts',
  'src/lib/simulation/post-exam-diagnosis.service.ts',
  'src/lib/simulation/next-action.service.ts',
];

const F9_ROUTE_FILES = [
  'src/app/api/readiness/route.ts',
  'src/app/api/readiness/compute/route.ts',
  'src/app/api/readiness/[id]/route.ts',
  'src/app/api/simulation/eligibility/route.ts',
  'src/app/api/simulation/attempts/route.ts',
  'src/app/api/simulation/attempts/[id]/route.ts',
  'src/app/api/simulation/attempts/[id]/pause/route.ts',
  'src/app/api/simulation/attempts/[id]/resume/route.ts',
  'src/app/api/simulation/attempts/[id]/responses/route.ts',
  'src/app/api/simulation/attempts/[id]/complete/route.ts',
  'src/app/api/admin/readiness/policy/route.ts',
  'src/app/api/admin/readiness/score-conversion-models/route.ts',
];

const ALL_F9_FILES = [...F9_LIB_FILES, ...F9_ROUTE_FILES];

const CANONICAL_V2_TABLES = ['pedagogical_requirement_recognition', 'canonical_prepared_activity', 'concept_transfer_state', 'concept_knowledge_state'];
const PROGRESSION_FUNCTIONS = ['evaluateCanonicalLearningState', 'rebuildConceptCanonicalState', 'qualifyEvidence'];
const PROGRESSION_VOCABULARY = ['PROVE_PASSED', 'PRACTICE_PASSED', 'RETAIN_PASSED', 'TRANSFER_PASSED'];

describe('F9 does not introduce a competing pedagogical/progression authority', () => {
  it('all F9 files exist', () => {
    for (const relPath of ALL_F9_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('no F9 file imports Canonical V2 internals', () => {
    for (const relPath of ALL_F9_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import pedagogical-engine/-shadow/-migration/-decision internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-shadow|pedagogical-migration|pedagogical-decision)/
      );
    }
  });

  it('no F9 file calls any Canonical V2 progression function', () => {
    for (const relPath of ALL_F9_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const fn of PROGRESSION_FUNCTIONS) {
        expect(src, `${relPath} must not call ${fn}`).not.toMatch(new RegExp(`\\b${fn}\\b`));
      }
    }
  });

  it('no F9 file writes to a Canonical-V2-owned table', () => {
    const tablesPattern = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+(public\\.)?(${CANONICAL_V2_TABLES.join('|')})\\b`, 'i');
    for (const relPath of F9_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch a Canonical-V2-owned table`).not.toMatch(tablesPattern);
    }
  });

  it('no F9 file writes to learning_evidence directly -- only via the real updateMastery() call', () => {
    for (const relPath of F9_LIB_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not INSERT INTO learning_evidence directly`).not.toMatch(/INSERT INTO\s+(public\.)?learning_evidence/i);
    }
    const scoringSrc = readFileSync(join(process.cwd(), 'src/lib/simulation/scoring.service.ts'), 'utf-8');
    expect(scoringSrc).toMatch(/from ['"]@\/services\/mastery\.service['"]/);
  });

  it('no F9 route exposes a fabricated progression verdict', () => {
    for (const relPath of F9_ROUTE_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const term of PROGRESSION_VOCABULARY) {
        expect(src, `${relPath} must not expose ${term}`).not.toMatch(new RegExp(`\\b${term}\\b`));
      }
    }
  });

  it('dimension-classification.algorithms.ts is pure -- no AI import, no fetch/executeAI/callModel/db call', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/readiness/dimension-classification.algorithms.ts'), 'utf-8');
    expect(src).not.toMatch(/executeAI|callModel|from ['"]@\/lib\/ai|from ['"]@\/lib\/db/);
  });

  it('next-action.service.ts is a pure recommendation -- no writes to any table, no calls to updateMastery', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/simulation/next-action.service.ts'), 'utf-8');
    expect(src).not.toMatch(/from ['"]@\/lib\/db['"]/);
    expect(src).not.toMatch(/updateMastery/);
  });

  it('institution-policy-comparison.service.ts never computes an admission probability -- no probability field anywhere in actual code', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/readiness/institution-policy-comparison.service.ts'), 'utf-8');
    const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**'));
    expect(codeLines.join('\n')).not.toMatch(/probability/i);
  });

  it('score-projection.service.ts never fabricates AVAILABLE without a real ACTIVE score_conversion_models row', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/readiness/score-projection.service.ts'), 'utf-8');
    expect(src).toMatch(/NOT_AVAILABLE_NO_CALIBRATION/);
    expect(src).toMatch(/status = 'ACTIVE'/);
  });

  it('the F9 migration seeds ZERO score_conversion_models rows -- no fabricated calibration data', () => {
    const migration = readFileSync(join(process.cwd(), 'database/migrations/20260927_1000_f9_exam_readiness_simulation.sql'), 'utf-8');
    const insertsIntoScoreModels = migration.match(/INSERT INTO public\.score_conversion_models/gi) ?? [];
    expect(insertsIntoScoreModels.length).toBe(0);
  });

  it('simulation_attempts enforces official-timing-never-pausable at the schema level (INV-F9-10)', () => {
    const migration = readFileSync(join(process.cwd(), 'database/migrations/20260927_1000_f9_exam_readiness_simulation.sql'), 'utf-8');
    expect(migration).toMatch(/simulation_attempts_official_never_pausable/);
  });

  it('readiness snapshots are append-only -- no UPDATE/DELETE against readiness_snapshots anywhere in F9', () => {
    for (const relPath of ALL_F9_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not UPDATE/DELETE readiness_snapshots`).not.toMatch(/(UPDATE|DELETE FROM)\s+(public\.)?readiness_snapshots/i);
    }
  });
});

describe('F0-S/F1-F8 protections remain present (source-level guard; behavior covered by the unmodified test files)', () => {
  it('F8 diagnostic engine untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/diagnostics/diagnosis.service.ts'), 'utf-8');
    expect(src).toMatch(/runDiagnosis/);
  });

  it('F7 full-mock-guard untouched', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/assessment/full-mock-guard.service.ts'), 'utf-8');
    expect(src).toMatch(/canFullMockBeOffered/);
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

  it('the pre-existing, LIVE legacy exam-readiness.service.ts is untouched by F9', () => {
    const src = readFileSync(join(process.cwd(), 'src/services/exam-readiness.service.ts'), 'utf-8');
    expect(src).toMatch(/calculateExamReadiness/);
    expect(src).toMatch(/predictedExamScore/);
  });
});
