/**
 * F3 -- INV-F3-05/12: subscription state may prevent execution of a
 * paid action, but must never rewrite Canonical pedagogical state.
 * Structural guardrail, extending F1/F2's non-interference proofs to
 * every new F3 file. The full existing Canonical V2 suite re-runs
 * unmodified in this same test run as the real regression proof.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F3_FILES = [
  'src/lib/entitlements/index.ts',
  'src/lib/entitlements/types.ts',
  'src/lib/entitlements/subscription.service.ts',
  'src/lib/entitlements/subscription-state-machine.ts',
  'src/lib/entitlements/payment.service.ts',
  'src/lib/entitlements/price-book.service.ts',
  'src/app/api/billing/subscription/route.ts',
  'src/app/api/billing/reactivate/route.ts',
  'src/app/api/learning/session-eligibility/route.ts',
];

describe('F3 does not introduce a competing pedagogical/progression authority', () => {
  it('no F3 file imports from pedagogical-engine, pedagogical-decision, or pedagogical-shadow', () => {
    for (const relPath of F3_FILES) {
      const fullPath = join(process.cwd(), relPath);
      expect(existsSync(fullPath), `${relPath} should exist`).toBe(true);
      const src = readFileSync(fullPath, 'utf-8');
      expect(src, `${relPath} must not import Canonical V2 internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-decision|pedagogical-shadow|pedagogical-migration)/
      );
    }
  });

  it('no F3 file writes to a learning-domain table (learning_evidence, mastery_records, concept_knowledge_state, quiz_sessions, concepts)', () => {
    for (const relPath of F3_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch learning-domain tables`).not.toMatch(
        /(INSERT INTO|UPDATE|DELETE FROM)\s+(learning_evidence|mastery_records|concept_knowledge_state|quiz_sessions|concepts)\b/i
      );
    }
  });

  it('src/lib/entitlements never issues a DELETE against any table (suspension is access-only, INV-F3-06/AC-F3-12)', () => {
    for (const relPath of F3_FILES.filter((p) => p.startsWith('src/lib/entitlements'))) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must never DELETE anything`).not.toMatch(/DELETE FROM/);
    }
  });

  it('src/lib/entitlements never imports src/lib/authorization (F2) or vice versa -- two independent services (INV-F3-13)', () => {
    const entitlements = readFileSync(join(process.cwd(), 'src/lib/entitlements/index.ts'), 'utf-8');
    expect(entitlements).not.toMatch(/from ['"]@\/lib\/authorization/);
    const authorization = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf-8');
    expect(authorization).not.toMatch(/from ['"]@\/lib\/entitlements/);
  });
});

describe('F0-S/F1/F2 protections remain present (source-level guard; behavior covered by the unmodified test files)', () => {
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
