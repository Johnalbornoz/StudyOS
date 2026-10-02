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
  // Teacher E2E readiness
  'src/lib/teacher/learner-view.service.ts',
  'src/lib/institution/class-invitations.ts',
  'src/app/api/teacher/classes/[classId]/enrollments/route.ts',
  'src/app/api/teacher/classes/[classId]/enrollments/[enrollmentId]/end/route.ts',
  'src/app/api/teacher/classes/[classId]/students/[studentId]/route.ts',
  'src/app/api/teacher/classes/[classId]/attention/route.ts',
  'src/app/api/institutions/[id]/classes/[classId]/route.ts',
  'src/app/dashboard/teacher/classes/[classId]/page.tsx',
  'src/app/dashboard/teacher/classes/[classId]/students/[studentId]/page.tsx',
  'src/app/dashboard/teacher/classes/[classId]/students/page.tsx',
  'src/app/dashboard/teacher/classes/[classId]/plan/page.tsx',
  'src/app/dashboard/teacher/classes/[classId]/assignments/page.tsx',
  'src/app/dashboard/teacher/classes/[classId]/progress/page.tsx',
  'src/app/dashboard/institution/[institutionId]/curriculum/page.tsx',
  'src/app/dashboard/plan/page.tsx',
  'src/app/dashboard/plan/exam/[examProfileId]/page.tsx',
  'src/app/dashboard/admin/concept-proposals/page.tsx',
  'src/lib/learning-plan/personal-plan.service.ts',
  'src/lib/learning-plan/class-plan.service.ts',
  'src/lib/learning-plan/institution-curriculum.service.ts',
  'src/lib/learning-plan/exam-bridge.service.ts',
  'src/lib/learning-plan/recommendations.service.ts',
  'src/lib/learning-plan/concept-proposals.service.ts',
  'src/lib/learning-plan/curriculum.service.ts',
  'src/lib/learning-plan/student-views.service.ts',
  'src/lib/teacher/class-progress.service.ts',
  'src/lib/teacher/class-progress.compute.ts',
  'src/app/api/teacher/classes/[classId]/progress/route.ts',
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
      let code = strip(read(file));
      if (file === 'src/lib/learning-plan/personal-plan.service.ts') {
        // The universal enrollment creates a concept the learner never had with the same zero-initialized
        // "not started" record every new concept gets -- never overwriting an existing one.
        const init = /INSERT INTO mastery_records \(student_id, concept_id, subject_id, mastery_score, confidence_score, attempt_count, correct_count, incorrect_count\)\s+VALUES \(\$1, \$2, \$3, 0, 0, 0, 0, 0\) ON CONFLICT \(student_id, concept_id\) DO NOTHING/g;
        expect(code.match(init)?.length).toBe(1);
        code = code.replace(init, '');
      }
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
    expect(fillMessage('{n} {n:estudiante|estudiantes}', { n: 1 })).toBe('1 estudiante');
    expect(fillMessage('{n} {n:estudiante|estudiantes}', { n: 3 })).toBe('3 estudiantes');
    expect(fillMessage('{n} {n:estudiante|estudiantes}', { n: 0 })).toBe('0 estudiantes');
    for (const locale of LOCALES) {
      expect(fillMessage(getMessages(locale)['teacherClass.result'], { correct: 3, total: 4 })).not.toMatch(/[{}]/);
    }
  });

  it('the account page has no hard-coded Spanish role labels any more', () => {
    const code = strip(read('src/app/role-select/page.tsx'));
    expect(code).not.toMatch(/'Padre, madre, tutor o coach'|'Profesor'|Añadir rol:/);
    expect(code).toMatch(/t\[`role\.\$\{p\}\.name` as MessageKey\]/);
  });

  it('the institution sub-navigation has no hard-coded fallback label and wraps on phones', () => {
    const code = strip(read('src/app/dashboard/institution/[institutionId]/InstitutionSubNav.tsx'));
    expect(code).not.toMatch(/'Solicitudes'/);
    expect(code).toMatch(/ta-subnav/);
  });

  it('the notifications page never provisions a Student identity (it works in every workspace)', () => {
    const code = strip(read('src/app/dashboard/notifications/page.tsx'));
    expect(code).not.toMatch(/getOrCreateStudentId/);
    expect(code).toMatch(/listAccountInbox/);
  });
});

describe('Single primary persona (Track A product amendment)', () => {
  const walk = (dir: string): string[] => {
    const { readdirSync, statSync } = require('fs') as typeof import('fs');
    return readdirSync(join(process.cwd(), dir)).flatMap((name: string) => {
      const rel = `${dir}/${name}`;
      return statSync(join(process.cwd(), rel)).isDirectory() ? walk(rel) : /\.(tsx?|ts)$/.test(name) ? [rel] : [];
    });
  };

  it('no UI or API offers "add another role" any more (the old key may exist in the catalog, nothing renders it)', () => {
    const offenders = walk('src')
      .filter((f) => !f.startsWith('src/lib/i18n/'))
      .filter((f) => /workspace\.addRole|addRoleLabel|Añadir otro rol|rolesNotYetHeld/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the account page gives a persona holder "Ir a mi espacio de {persona}" and never the persona choice', () => {
    const page = strip(read('src/app/role-select/page.tsx'));
    expect(page).toMatch(/fillMessage\(t\['account\.goToWorkspace'\], \{ persona: personaName \}\)/);
    expect(page).toMatch(/\{canChoose && \(/);
    expect(getMessages('es')['account.goToWorkspace'].replace('{persona}', getMessages('es')['role.TEACHER.name'])).toBe('Ir a mi espacio de Profesor');
  });

  it('an approved teacher with no classes gets the specified empty state (the workspace is never blocked)', () => {
    const es = getMessages('es');
    expect(es['teacherHome.noClasses']).toBe('Aún no tienes clases asignadas.');
    expect(es['teacherHome.noClassesApproved']).toBe('Cuando tu institución te asigne una clase o grado, aparecerá aquí.');
    const page = strip(read('src/app/dashboard/teacher/page.tsx'));
    expect(page).toMatch(/EmptyState title=\{t\['teacherHome\.noClasses'\]\} body=\{approved \? t\['teacherHome\.noClassesApproved'\]/);
  });

  it('capabilities are reached by route, never by switching: institution and admin pages force their context; other pages render the persona', async () => {
    const { resolveShellContext } = await import('@/lib/admin/shell-context');
    const available = ['TEACHER', 'INSTITUTION', 'ADMIN'] as const;
    expect(resolveShellContext({ pathname: '/dashboard/institution/x', available: [...available], stored: 'TEACHER', defaultWorkspace: 'TEACHER' }).workspace).toBe('INSTITUTION');
    expect(resolveShellContext({ pathname: '/dashboard/admin/users', available: [...available], stored: 'TEACHER', defaultWorkspace: 'TEACHER' }).workspace).toBe('ADMIN');
    expect(resolveShellContext({ pathname: '/dashboard/notifications', available: [...available], stored: 'ADMIN', defaultWorkspace: 'TEACHER' }).workspace).toBe('TEACHER');
    expect(resolveShellContext({ pathname: '/dashboard', available: ['INSTITUTION'], stored: null, defaultWorkspace: 'INSTITUTION' }).workspace).toBe('INSTITUTION');
  });

  it('the admin console can assign a persona only when the account has none active', () => {
    const svc = strip(read('src/services/user-admin.service.ts'));
    expect(svc).toMatch(/role IN \('STUDENT', 'PARENT', 'TEACHER'\) AND role <> \$2 AND status = 'ACTIVE'/);
    expect(svc).toMatch(/throw new PersonaExistsError\(\)/);
  });
});

describe('Teacher learner view stays a read-only projection of the canonical read models', () => {
  const view = strip(read('src/lib/teacher/learner-view.service.ts'));
  const pages = ['src/app/dashboard/teacher/classes/[classId]/page.tsx', 'src/app/dashboard/teacher/classes/[classId]/students/[studentId]/page.tsx'].map((f) => strip(read(f)));

  it('uses the ONE canonical decision authority and never a read path with hidden writes', () => {
    expect(view).toMatch(/getCanonicalPedagogicalDecision\(/);
    for (const src of [view, ...pages]) {
      expect(src).not.toMatch(/\b(getActiveDebts|getLearningDecisions|getLearningOSSnapshot|getSubjectHierarchy|getTeachingIntent\w*|getBestLearningDecisionForConcept|loadConceptNextChallenge|recordStudentMisconception|recalculateConceptKnowledgeState|ensureConceptLocalizations|getUpcomingForStudent)\(/);
      expect(src).not.toMatch(/\b(INSERT INTO|DELETE FROM)\b|\bUPDATE\s+\w+\s+SET\b/);
    }
  });

  it('never reads Tutor conversations, parent data or billing', () => {
    for (const src of [view, ...pages]) {
      expect(src).not.toMatch(/tutor_|chat_messages|conversations|parent_student_relationships|profiles\b|subscriptions|billing|stripe|entitlement/i);
    }
  });

  it('every learner read is gated by teaching THIS class + ACTIVE enrollment + the teacher relationship', () => {
    expect(view).toMatch(/getTeacherClass\(actorUserId, classId\)/);
    expect(view).toMatch(/status = 'ACTIVE'/);
    expect(view).toMatch(/canTeacherAccessLearner\(actorUserId, studentId\)/);
  });

  it('the Teacher cannot edit phases, mastery or evidence from the UI (no such control or route)', () => {
    for (const src of pages) expect(src).not.toMatch(/\/api\/(mastery|evidence|learning-state|knowledge)/);
  });
});
