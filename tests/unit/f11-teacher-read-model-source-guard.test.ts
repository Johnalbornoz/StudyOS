/**
 * F11-A -- source guard proving src/lib/teacher/read-model.service.ts
 * never imports or calls the generic canAccessLearner, which
 * deliberately composes Owner/Parent/Teacher as equivalent for F5-F9's
 * "any authorized viewer" routes -- exactly the composition that
 * caused F10's Parent Read Model authorization-widening bug. This
 * guard exists specifically to prevent that regression from recurring
 * on the Teacher side.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const F11_LIB_FILES = ['src/lib/teacher/read-model.service.ts'];

const F11_ROUTE_FILES = [
  'src/app/api/teacher/classes/route.ts',
  'src/app/api/teacher/classes/[classId]/roster/route.ts',
  'src/app/api/teacher/students/[studentId]/overview/route.ts',
];

const ALL_F11_FILES = [...F11_LIB_FILES, ...F11_ROUTE_FILES];

describe('F11-A Teacher Read Model resolves access through Teacher-specific primitives only', () => {
  it('all F11-A files exist', () => {
    for (const relPath of ALL_F11_FILES) {
      expect(existsSync(join(process.cwd(), relPath)), `${relPath} should exist`).toBe(true);
    }
  });

  it('read-model.service.ts never imports the generic canAccessLearner', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teacher/read-model.service.ts'), 'utf-8');
    expect(src).not.toMatch(/import\s*\{[^}]*\bcanAccessLearner\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
  });

  it('read-model.service.ts imports canTeacherAccessLearner and canAccessClass from the canonical F2 authorization module', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teacher/read-model.service.ts'), 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*\bcanTeacherAccessLearner\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
    expect(src).toMatch(/import\s*\{[^}]*\bcanAccessClass\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
  });

  it('every exported getTeacher* function taking a studentId or classId re-validates authorization as its own first action', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/teacher/read-model.service.ts'), 'utf-8');
    const exported = [...src.matchAll(/export async function (getTeacher\w+)\(/g)].map((m) => m[1]);
    expect(exported).toEqual(expect.arrayContaining(['getTeacherAssignedClasses', 'getTeacherClassRoster', 'getTeacherStudentOverview']));

    for (const fn of ['getTeacherClassRoster', 'getTeacherStudentOverview']) {
      const start = src.indexOf(`export async function ${fn}(`);
      const body = src.slice(start, start + 400);
      expect(body, `${fn} must call a require*Access guard as its own first action`).toMatch(/await require(LearnerAccess|ClassAccess)\(/);
    }
  });

  it('no F11-A route performs its own authorization logic beyond resolving the actor and delegating to the read model', () => {
    for (const relPath of F11_ROUTE_FILES) {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
      expect(src, `${relPath} must not import canAccessLearner`).not.toMatch(/canAccessLearner/);
      expect(src, `${relPath} must not import isActiveParentOf`).not.toMatch(/isActiveParentOf/);
    }
  });
});
