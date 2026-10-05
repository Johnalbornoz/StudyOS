/**
 * Exam eligibility -- explicit exam / assessment assignment to a class.
 *
 * An Institution Admin (any class of their institution) or the class's Teacher
 * may ADD a preparation objective to a class. Governance:
 *   - curriculum exams (IB DP, Cambridge ...) only when the class's EXPLICIT
 *     curriculum binding is a programme that hosts that framework (catalogue
 *     evidence) -- an IB class is never assigned Cambridge;
 *   - assessments outside the curriculum (PISA, PAA, Saber 11) may be assigned
 *     to any class: the assignment IS the explicit eligibility reason.
 * The assignment never changes any Student's Academic Profile, curriculum,
 * learner state, scoring or evidence. Every grant, revoke and denial is audited
 * in academic_governance_events. Foreign classes are NOT_FOUND (never leak).
 */
import { db } from '@/lib/db';
import { recordGovernanceEvent } from '@/lib/institution/academic-governance';
import { examObjectives, objectiveByKey, type ExamObjective, type ObjectiveFramework } from '../objectives/objective-catalog';
import { loadEligibilityGraph } from './graph';
import { NON_CURRICULUM_FRAMEWORKS, programmeFrameworks, type EligibilityGraph } from './rules';

export type ExamAssignmentErrorCode = 'NOT_FOUND' | 'OBJECTIVE_NOT_FOUND' | 'OBJECTIVE_NOT_COMPATIBLE' | 'CLASS_NOT_ACTIVE';

export class ExamAssignmentError extends Error {
  constructor(public readonly code: ExamAssignmentErrorCode) {
    super(code);
    this.name = 'ExamAssignmentError';
  }
}

export type AssignmentActorScope = 'INSTITUTION' | 'TEACHER';

interface ClassRow { id: string; name: string; institution_id: string; status: string; programme_id: string | null; programme_name: string | null }

async function loadClass(institutionId: string, classId: string): Promise<ClassRow | null> {
  const r = await db.query(
    `SELECT c.id, c.name, c.institution_id, c.status, p.id AS programme_id, p.name AS programme_name
       FROM classes c
       LEFT JOIN institution_curricula ic ON ic.id = c.institution_curriculum_id AND ic.status = 'ACTIVE'
       LEFT JOIN academic_subjects s ON s.id = ic.base_academic_subject_id
       LEFT JOIN academic_programmes p ON p.id = COALESCE(ic.academic_programme_id, s.programme_id)
      WHERE c.id = $1 AND c.institution_id = $2`,
    [classId, institutionId]
  );
  return (r.rows[0] as ClassRow) ?? null;
}

/** Pure: the frameworks a class may be assigned (exported for tests). */
export function assignableFrameworks(classProgrammeId: string | null, graph: EligibilityGraph): Set<ObjectiveFramework> {
  const out = new Set<ObjectiveFramework>(NON_CURRICULUM_FRAMEWORKS);
  const gp = classProgrammeId ? graph.programmes.find((p) => p.programmeId === classProgrammeId) : undefined;
  if (gp) for (const f of programmeFrameworks(gp)) out.add(f);
  return out;
}

export interface ClassExamAssignmentView {
  id: string;
  objectiveKey: string;
  label: string;
  framework: ObjectiveFramework | null;
  assignedByScope: AssignmentActorScope;
  createdAt: string;
}

export async function listClassExamAssignments(institutionId: string, classId: string): Promise<{ className: string; curriculum: string | null; assignments: ClassExamAssignmentView[]; assignable: Array<Pick<ExamObjective, 'key' | 'label' | 'framework' | 'kind'>> }> {
  const klass = await loadClass(institutionId, classId);
  if (!klass) throw new ExamAssignmentError('NOT_FOUND');
  const [rows, graph] = await Promise.all([
    db.query(`SELECT id, objective_key, assigned_by_scope, created_at FROM class_exam_assignments WHERE class_id = $1 AND status = 'ACTIVE' ORDER BY created_at`, [classId]),
    loadEligibilityGraph(),
  ]);
  const allowed = assignableFrameworks(klass.programme_id, graph);
  const active = new Set(rows.rows.map((r: any) => r.objective_key as string));
  return {
    className: klass.name,
    curriculum: klass.programme_name,
    assignments: rows.rows.map((r: any) => {
      const o = objectiveByKey(r.objective_key);
      return { id: r.id, objectiveKey: r.objective_key, label: o?.label ?? r.objective_key, framework: o?.framework ?? null, assignedByScope: r.assigned_by_scope, createdAt: new Date(r.created_at).toISOString() };
    }),
    assignable: examObjectives()
      .filter((o) => allowed.has(o.framework) && !active.has(o.key))
      .map((o) => ({ key: o.key, label: o.label, framework: o.framework, kind: o.kind })),
  };
}

export async function assignExamToClass(input: { institutionId: string; classId: string; objectiveKey: string; actorUserId: string; actorScope: AssignmentActorScope }): Promise<{ id: string; created: boolean }> {
  const klass = await loadClass(input.institutionId, input.classId);
  if (!klass) throw new ExamAssignmentError('NOT_FOUND');
  const objective = objectiveByKey(input.objectiveKey);
  const audit = (action: string, outcome: 'APPLIED' | 'DENIED', objectId: string | null, extra: Record<string, unknown> = {}) =>
    recordGovernanceEvent({
      institutionId: input.institutionId,
      actorUserId: input.actorUserId,
      actorScope: input.actorScope,
      objectType: 'CLASS_EXAM_ASSIGNMENT',
      objectId,
      action,
      fields: ['objective_key'],
      newValues: { classId: input.classId, objectiveKey: input.objectiveKey, ...extra },
      outcome,
    });
  if (!objective) throw new ExamAssignmentError('OBJECTIVE_NOT_FOUND');
  if (klass.status !== 'ACTIVE') {
    await audit('ASSIGN', 'DENIED', null, { reason: 'CLASS_NOT_ACTIVE' });
    throw new ExamAssignmentError('CLASS_NOT_ACTIVE');
  }
  const allowed = assignableFrameworks(klass.programme_id, await loadEligibilityGraph());
  if (!allowed.has(objective.framework)) {
    await audit('ASSIGN', 'DENIED', null, { reason: 'OBJECTIVE_NOT_COMPATIBLE', classCurriculum: klass.programme_name });
    throw new ExamAssignmentError('OBJECTIVE_NOT_COMPATIBLE');
  }
  const inserted = await db.query(
    `INSERT INTO class_exam_assignments (institution_id, class_id, objective_key, assigned_by_user_id, assigned_by_scope)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (class_id, objective_key) WHERE status = 'ACTIVE' DO NOTHING
     RETURNING id`,
    [input.institutionId, input.classId, objective.key, input.actorUserId, input.actorScope]
  );
  if (inserted.rows[0]) {
    await audit('ASSIGN', 'APPLIED', inserted.rows[0].id, { framework: objective.framework });
    return { id: inserted.rows[0].id, created: true };
  }
  const existing = await db.query(`SELECT id FROM class_exam_assignments WHERE class_id = $1 AND objective_key = $2 AND status = 'ACTIVE'`, [input.classId, objective.key]);
  return { id: existing.rows[0].id, created: false };
}

export async function revokeClassExamAssignment(input: { institutionId: string; classId: string; assignmentId: string; actorUserId: string; actorScope: AssignmentActorScope }): Promise<void> {
  const r = await db.query(
    `UPDATE class_exam_assignments SET status = 'REVOKED', revoked_at = now(), revoked_by_user_id = $4
      WHERE id = $1 AND class_id = $2 AND institution_id = $3 AND status = 'ACTIVE'
      RETURNING objective_key`,
    [input.assignmentId, input.classId, input.institutionId, input.actorUserId]
  );
  if (!r.rows[0]) throw new ExamAssignmentError('NOT_FOUND');
  await recordGovernanceEvent({
    institutionId: input.institutionId,
    actorUserId: input.actorUserId,
    actorScope: input.actorScope,
    objectType: 'CLASS_EXAM_ASSIGNMENT',
    objectId: input.assignmentId,
    action: 'REVOKE',
    fields: ['status'],
    oldValues: { status: 'ACTIVE', objectiveKey: r.rows[0].objective_key },
    newValues: { status: 'REVOKED' },
  });
}

export function examAssignmentErrorStatus(code: ExamAssignmentErrorCode): number {
  return code === 'NOT_FOUND' || code === 'OBJECTIVE_NOT_FOUND' ? 404 : code === 'CLASS_NOT_ACTIVE' ? 409 : 422;
}
