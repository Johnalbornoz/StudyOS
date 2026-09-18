/**
 * F2 -- INV-F2-10/11: Canonical V2 remains the only pedagogical
 * progression authority; no F2 authorization file modifies
 * pedagogical state. Structural guardrail, extending F1's
 * f1-canonical-v2-noninterference.test.ts to the new F2 files. The
 * full existing Canonical V2 suite re-runs unmodified in this same
 * test run as the real regression proof.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F2_FILES = [
  'src/lib/authorization/index.ts',
  'src/lib/authorization/permissions.ts',
  'src/services/institution.service.ts',
  'src/app/api/institutions/[id]/membership/route.ts',
  'src/app/api/institutions/[id]/memberships/pending/route.ts',
  'src/app/api/institutions/[id]/memberships/[membershipId]/decide/route.ts',
  'src/app/api/institutions/[id]/memberships/[membershipId]/revoke/route.ts',
  'src/app/api/institutions/[id]/assignments/route.ts',
  'src/app/api/institutions/assignments/[id]/end/route.ts',
  'src/app/api/learners/[id]/summary/route.ts',
  'src/app/api/admin/institutions/route.ts',
  'src/app/api/admin/institutions/[id]/invite-admin/route.ts',
  'src/app/api/parent/relationships/revoke/route.ts',
];

describe('F2 does not introduce a competing pedagogical/progression authority', () => {
  it('no F2 file imports from pedagogical-engine, pedagogical-decision, or pedagogical-shadow', () => {
    for (const relPath of F2_FILES) {
      const fullPath = join(process.cwd(), relPath);
      expect(existsSync(fullPath), `${relPath} should exist`).toBe(true);
      const src = readFileSync(fullPath, 'utf-8');
      expect(src, `${relPath} must not import Canonical V2 internals`).not.toMatch(
        /from ['"]@\/lib\/(pedagogical-engine|pedagogical-decision|pedagogical-shadow|pedagogical-migration)/
      );
    }
  });

  it('no F2 file writes to a learning-domain table (learning_evidence, mastery_records, concept_knowledge_state, quiz_sessions)', () => {
    for (const relPath of F2_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not touch learning-domain tables`).not.toMatch(
        /(INSERT INTO|UPDATE|DELETE FROM)\s+(learning_evidence|mastery_records|concept_knowledge_state|quiz_sessions)/i
      );
    }
  });

  it('the parent/institution/assignment "revoke"/"end" paths never issue a DELETE against any table (INV-F2-07/08)', () => {
    const revokePaths = [
      'src/services/parent.service.ts',
      'src/services/institution.service.ts',
    ];
    for (const relPath of revokePaths) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must never DELETE a relationship/membership/assignment row`).not.toMatch(/DELETE FROM/);
    }
  });
});

describe('F1/F0-S protections remain present (source-level guard; real behavior covered by the unmodified test files)', () => {
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

  it('canTeacherAccessStudent is no longer a hardcoded false stub', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/auth.ts'), 'utf-8');
    const idx = src.indexOf('async function canTeacherAccessStudent');
    const slice = src.slice(idx, idx + 500);
    expect(slice).not.toMatch(/return false;\s*\n\s*} catch/);
    expect(slice).toMatch(/canTeacherAccessStudentByClerkId/);
  });
});
