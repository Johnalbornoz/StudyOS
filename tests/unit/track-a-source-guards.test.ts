/**
 * Track A (Roles E2E) -- structural guards. Role modules assign, observe,
 * organize and report; they never write the learner's cognition (mastery,
 * knowledge state, evidence, memory, transfer, readiness). The Track A
 * migration is additive. Role surfaces are localized, and the new copy
 * exists in every locale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { ROLES_MESSAGES, fillMessage } from '@/lib/i18n/roles-messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ROLE_MODULES = [
  'src/lib/teacher/class-assignment.service.ts',
  'src/lib/teacher/intervention.service.ts',
  'src/lib/notifications/role-notifications.service.ts',
  'src/lib/institution/membership-events.ts',
  'src/lib/institution/route-guard.ts',
  'src/services/institution.service.ts',
  'src/services/parent.service.ts',
  'src/app/api/parent/child-requests/route.ts',
  'src/app/api/teacher/classes/[classId]/assignments/route.ts',
  'src/app/api/institutions/[id]/grades/route.ts',
  'src/app/api/institutions/[id]/classes/route.ts',
  'src/app/api/institutions/[id]/classes/[classId]/enrollments/route.ts',
  'src/app/api/institutions/[id]/classes/[classId]/enrollments/[enrollmentId]/end/route.ts',
  'src/app/api/student/class-invitations/[id]/respond/route.ts',
  'src/app/api/notifications/inbox/route.ts',
];

const COGNITIVE_TABLES = [
  'learning_evidence',
  'mastery_records',
  'concept_knowledge_state',
  'learner_skill_state',
  'learner_competency_state',
  'concept_transfer_state',
  'readiness_snapshots',
  'learner_gap_diagnoses',
  'memory_state',
  'concept_memory_state',
];

describe('Track A role modules never write learner cognition', () => {
  for (const file of ROLE_MODULES) {
    it(file, () => {
      const code = strip(read(file));
      for (const table of COGNITIVE_TABLES) {
        expect(code, `${file} writes ${table}`).not.toMatch(new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+${table}\\b`, 'i'));
      }
      expect(code).not.toMatch(/\bupdateMastery\s*\(/);
      expect(code).not.toMatch(/\brecalculateConceptKnowledgeState\s*\(/);
    });
  }

  it('a class assignment is created only through the certified per-learner assignTeacherIntervention', () => {
    const code = strip(read('src/lib/teacher/class-assignment.service.ts'));
    expect(code).not.toMatch(/INSERT INTO teacher_interventions/);
    expect(code).toMatch(/assignTeacherIntervention\(/);
  });
});

describe('Track A migration is additive', () => {
  const sql = strip(read('database/migrations/20261018_1000_track_a_roles_e2e.sql').replace(/^--.*$/gm, ''));
  it('creates/drops no table and drops no column', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  });
  it('new checks on existing rows are NOT VALID or widen an existing set', () => {
    expect(sql).toMatch(/teacher_assignments_scope_present[\s\S]*NOT VALID/);
    expect(sql).toMatch(/CHECK \(status IN \('PENDING', 'ACTIVE', 'DECLINED', 'ENDED'\)\)/);
  });
});

describe('Role surfaces are localized', () => {
  it('every Track A key exists, non-empty, in every locale', () => {
    const keys = Object.keys(ROLES_MESSAGES.es);
    for (const locale of LOCALES) {
      const t = getMessages(locale) as Record<string, string>;
      for (const k of keys) expect(t[k], `${locale}:${k}`).toBeTruthy();
    }
  });

  it('placeholders are filled, never shown raw', () => {
    expect(fillMessage('{a} de {b}', { a: 2, b: 5 })).toBe('2 de 5');
    expect(fillMessage('{missing}!', {})).toBe('!');
    for (const locale of LOCALES) {
      expect(fillMessage(getMessages(locale)['teacherClass.result'], { correct: 3, total: 4 })).not.toMatch(/[{}]/);
    }
  });

  it('the account page has no hard-coded Spanish role labels any more', () => {
    const code = strip(read('src/app/role-select/page.tsx'));
    expect(code).not.toMatch(/'Padre, madre, tutor o coach'|'Profesor'|Añadir rol:/);
    expect(code).toMatch(/t\[`role\.\$\{role\}\.name` as const\]/);
  });

  it('the institution sub-navigation has no hard-coded fallback label and wraps on phones', () => {
    const code = strip(read('src/app/dashboard/institution/[institutionId]/InstitutionSubNav.tsx'));
    expect(code).not.toMatch(/'Solicitudes'/);
    expect(code).toMatch(/ta-subnav/);
  });

  it('the notifications page never provisions a Student identity (it works in every workspace)', () => {
    const code = strip(read('src/app/dashboard/notifications/page.tsx'));
    expect(code).not.toMatch(/getOrCreateStudentId/);
    expect(code).toMatch(/resolveCurrentWorkspace/);
  });
});
