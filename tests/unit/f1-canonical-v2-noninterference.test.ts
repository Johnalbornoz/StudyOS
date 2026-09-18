/**
 * F1 -- INV-F1-09: Canonical V2 remains the only pedagogical
 * progression authority. This is a structural guardrail, not a
 * behavioral one (the full existing Canonical V2 suite already
 * re-runs unmodified as part of this same test run and is the real
 * regression proof) -- it exists so that if a future edit to any F1
 * file starts importing from the pedagogical engine, this test names
 * exactly which invariant just broke, immediately, in this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F1_FILES = [
  'src/lib/identity/types.ts',
  'src/lib/identity/canonical-user.service.ts',
  'src/lib/identity/role-assignment.service.ts',
  'src/lib/identity/workspace.service.ts',
  'src/lib/identity/index.ts',
  'src/app/api/identity/me/route.ts',
  'src/app/api/identity/roles/select/route.ts',
  'src/app/api/identity/workspace/route.ts',
  'src/services/identity-backfill.service.ts',
];

describe('F1 does not introduce a competing pedagogical/progression authority', () => {
  it('no F1 file imports from pedagogical-engine, pedagogical-decision, or pedagogical-shadow', () => {
    for (const relPath of F1_FILES) {
      const fullPath = join(process.cwd(), relPath);
      expect(existsSync(fullPath), `${relPath} should exist`).toBe(true);
      const src = readFileSync(fullPath, 'utf-8');
      expect(src, `${relPath} must not import Canonical V2 internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-decision|pedagogical-shadow|pedagogical-migration)/
      );
    }
  });

  it('no F1 file computes, derives, or references a "stage"/"journeyStage"/"canonicalRevision" -- workspace is a UI-context value, not a learning-progression value', () => {
    for (const relPath of F1_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not reference pedagogical stage/progression concepts`).not.toMatch(
        /journeyStage|canonicalRevision|evaluateCanonicalLearningState|getCanonicalPedagogicalDecision/
      );
    }
  });

  it('no F1 file writes to a learning-domain table (learning_evidence, mastery_records, concept_knowledge_state, quiz_sessions)', () => {
    for (const relPath of F1_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch learning-domain tables`).not.toMatch(
        /(INSERT INTO|UPDATE|DELETE FROM)\s+(learning_evidence|mastery_records|concept_knowledge_state|quiz_sessions)/i
      );
    }
  });
});

describe('F0-S security fixes remain present (source-level guard, real behavior covered by the unmodified f0s-*.test.ts files)', () => {
  it('generate-and-take still enforces quiz-session ownership', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf-8');
    expect(src).toMatch(/quizSession\.studentId !== validated\.studentId/);
  });

  it('content search/process still resolve authorization server-side', () => {
    const search = readFileSync(join(process.cwd(), 'src/app/api/content/search/route.ts'), 'utf-8');
    const process_ = readFileSync(join(process.cwd(), 'src/app/api/content/process/route.ts'), 'utf-8');
    expect(search).toMatch(/verifyStudentAccess/);
    expect(search).toMatch(/verifySubjectAccess/);
    expect(process_).toMatch(/verifyContentSourceAccess/);
    expect(search).not.toMatch(/TODO: Verify authorization/);
    expect(process_).not.toMatch(/TODO: Verify authorization/);
  });

  it('/api/test remains disabled outside local development', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/test/route.ts'), 'utf-8');
    expect(src).toMatch(/VERCEL_ENV/);
  });

  it('the AI gateway still reserves a volume slot before contacting any provider', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/ai/gateway.ts'), 'utf-8');
    expect(src).toMatch(/reserveAICall/);
  });
});
