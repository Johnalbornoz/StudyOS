/**
 * F10 -- INV-F10-19: no new F10 file may import or call the legacy
 * exam-readiness.service.ts (a single opaque percentage + fabricated
 * predicted score). F10's own exam-preparation surface is built
 * exclusively on F9's readiness/simulation engines. See
 * docs/implementation/f10/F10_LEGACY_READINESS_CONTAINMENT.md for the
 * full inventory of existing (pre-F10) callers this test does NOT
 * touch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F10_LIB_FILES = ['src/lib/parent/read-model.service.ts', 'src/lib/parent/privacy-classification.ts'];

const F10_ROUTE_FILES = [
  'src/app/api/parent/learners/route.ts',
  'src/app/api/parent/learners/[studentId]/overview/route.ts',
  'src/app/api/parent/learners/[studentId]/subjects/route.ts',
  'src/app/api/parent/learners/[studentId]/activity/route.ts',
  'src/app/api/parent/learners/[studentId]/exam-prep/route.ts',
  'src/app/api/parent/learners/[studentId]/attention/route.ts',
];

const ALL_F10_FILES = [...F10_LIB_FILES, ...F10_ROUTE_FILES];

describe('F10 does not introduce a new legacy-readiness caller', () => {
  it('all F10 files exist', () => {
    for (const relPath of ALL_F10_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('no F10 file imports the legacy exam-readiness service', () => {
    for (const relPath of ALL_F10_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      // Matches an actual import path, not a doc-comment mention of the
      // legacy service's name (several F10 files reference it in prose
      // precisely to explain why they don't call it).
      expect(src, `${relPath} must not import exam-readiness.service`).not.toMatch(/from\s+['"].*exam-readiness\.service['"]/);
      expect(src, `${relPath} must not call calculateExamReadiness`).not.toMatch(/calculateExamReadiness\(/);
    }
  });

  it('no F10 file reads the legacy cached exam_readiness column via assessment.service', () => {
    for (const relPath of ALL_F10_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import getUpcomingForStudent (legacy-readiness-tainted)`).not.toMatch(/getUpcomingForStudent/);
      expect(src, `${relPath} must not reference exam_readiness column`).not.toMatch(/exam_readiness\b/);
    }
  });

  it('the exam-prep read model sources readiness exclusively from F9', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/parent/read-model.service.ts'), 'utf-8');
    expect(src).toMatch(/@\/lib\/readiness\/readiness\.service/);
    expect(src).toMatch(/@\/lib\/simulation\/(full-mock-eligibility|eligibility)\.service/);
  });

  it('every Parent read-model function taking a studentId re-validates F2 authorization', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/parent/read-model.service.ts'), 'utf-8');
    const exported = [...src.matchAll(/export async function (getParent\w+)\(/g)].map((m) => m[1]);
    expect(exported).toEqual(
      expect.arrayContaining([
        'getParentLearners',
        'getParentLearnerOverview',
        'getParentSubjectProgress',
        'getParentRecentActivity',
        'getParentExamPreparation',
        'getParentAttentionAreas',
      ])
    );
    for (const fn of exported.filter((name) => name !== 'getParentLearners')) {
      const start = src.indexOf(`export async function ${fn}(`);
      const body = src.slice(start, start + 600);
      expect(body, `${fn} must call requireAccess as its own authorization check`).toMatch(/requireAccess\(actorUserId, studentId\)/);
    }
  });
});
