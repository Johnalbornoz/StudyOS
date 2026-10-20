/**
 * Track A -- Institution governance over classes (server-side locks).
 *
 *  - Institution-owned class plan content (owner_scope INSTITUTION): the
 *    institution sets concept, priority, institution target date, period and
 *    required; the Teacher sees it read-only and cannot remove or change those
 *    fields (FIELD_LOCKED_BY_INSTITUTION). The Teacher may keep a separate
 *    planning date (class_plan_concepts.target_date) that never overwrites,
 *    nor goes past, the institution date.
 *  - Institution tasks (institution_assignments): title, concept,
 *    instructions, dates, period, priority, required and delivery mode are
 *    locked. Delivery:
 *      TEACHER_SELECTS_RECIPIENTS -- the Teacher only chooses recipients
 *        (whole class or selected ACTIVE learners of an authorized target class);
 *      DIRECT_ALL_STUDENTS        -- every ACTIVE learner of each target class
 *        gets it on publish; the Teacher monitors.
 *  - Teacher-owned tasks stay fully editable by their Teacher.
 * Learner state is never touched: recipients enter their plan through the
 * universal enrollment (1 student + 1 concept = 1 learner state, no reset).
 * Every change and every DENIED attempt is audited.
 */
import { db } from '@/lib/db';
import { canAccessInstitution, canTeacherAccessLearner } from '@/lib/authorization';
import { enrollCanonicalConcept } from '@/lib/learning-plan/personal-plan.service';
import { canonicalConceptLabels } from '@/lib/learning-plan/labels';
import { getTeacherClass, publishClassAssignment } from '@/lib/teacher/class-assignment.service';
import { assignInstitutionDirectIntervention } from '@/lib/teacher/intervention.service';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import { FieldLockedError, recordGovernanceEvent } from './academic-governance';

export class GovernanceError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'NOT_ALLOWED' | 'CONCEPT_NOT_IN_CLASS_SUBJECT' | 'CLASS_NOT_TARGET' | 'INVALID_DATES' | 'RECIPIENT_NOT_IN_CLASS' | 'DIRECT_DELIVERY') {
    super(code);
    this.name = 'GovernanceError';
  }
}

export const INSTITUTION_PLAN_LOCKS = ['concept', 'priority', 'institution_target_date', 'period', 'required_for_class', 'removal'] as const;
/** A DATE column as YYYY-MM-DD (pg returns local midnight: read local parts, never toISOString, which shifts east of UTC). */
const day = (v: any): string | null =>
  v ? (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10)) : null;
const iso = (v: any): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

async function requireAdmin(actorUserId: string, institutionId: string) {
  if (!(await canAccessInstitution(actorUserId, institutionId, 'TEACHER_ASSIGNMENT_MANAGE'))) throw new GovernanceError('NOT_ALLOWED');
}
async function requireClassOfInstitution(institutionId: string, classId: string) {
  const r = await db.query(`SELECT id, name, canonical_subject_id, institution_id FROM classes WHERE id = $1`, [classId]);
  if (!r.rows[0] || r.rows[0].institution_id !== institutionId) throw new GovernanceError('NOT_FOUND');
  return r.rows[0];
}

// ---------------------------------------------------------------------------
// Institution-owned class plan content
// ---------------------------------------------------------------------------

export async function setInstitutionClassPlanConcept(params: {
  institutionId: string;
  classId: string;
  actorUserId: string;
  canonicalConceptId: string;
  priority?: 'HIGH' | 'NORMAL' | 'LOW';
  institutionTargetDate?: string | null;
  period?: string | null;
  required?: boolean;
}) {
  await requireAdmin(params.actorUserId, params.institutionId);
  const klass = await requireClassOfInstitution(params.institutionId, params.classId);
  const ok = await db.query(`SELECT 1 FROM canonical_concepts WHERE id = $1 AND canonical_subject_id = $2 AND status = 'ACTIVE'`, [params.canonicalConceptId, klass.canonical_subject_id]);
  if (!ok.rows[0]) throw new GovernanceError('CONCEPT_NOT_IN_CLASS_SUBJECT');
  const before = (await db.query(`SELECT * FROM class_plan_concepts WHERE class_id = $1 AND canonical_concept_id = $2`, [params.classId, params.canonicalConceptId])).rows[0];
  const r = await db.query(
    `INSERT INTO class_plan_concepts (class_id, canonical_concept_id, priority, institution_target_date, period, required_for_class, owner_scope, locked_fields, order_index, added_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'INSTITUTION', $7, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM class_plan_concepts WHERE class_id = $1), $8)
     ON CONFLICT (class_id, canonical_concept_id) DO UPDATE SET priority = EXCLUDED.priority, institution_target_date = EXCLUDED.institution_target_date,
       period = EXCLUDED.period, required_for_class = EXCLUDED.required_for_class, owner_scope = 'INSTITUTION', locked_fields = EXCLUDED.locked_fields,
       status = 'ACTIVE', removed_at = NULL, removed_by_user_id = NULL, supplemental = false,
       target_date = CASE WHEN class_plan_concepts.target_date IS NOT NULL AND EXCLUDED.institution_target_date IS NOT NULL AND class_plan_concepts.target_date > EXCLUDED.institution_target_date
                          THEN NULL ELSE class_plan_concepts.target_date END,
       updated_at = now()
     RETURNING id`,
    [params.classId, params.canonicalConceptId, params.priority ?? 'NORMAL', params.institutionTargetDate ?? null, params.period ?? null, params.required ?? true, [...INSTITUTION_PLAN_LOCKS], params.actorUserId]
  );
  await recordGovernanceEvent({
    institutionId: params.institutionId,
    actorUserId: params.actorUserId,
    actorScope: 'INSTITUTION',
    objectType: 'CLASS_PLAN_CONCEPT',
    objectId: r.rows[0].id,
    action: before ? 'INSTITUTION_PLAN_UPDATED' : 'INSTITUTION_PLAN_ADDED',
    fields: ['priority', 'institution_target_date', 'period', 'required_for_class', 'owner_scope'],
    oldValues: before ? { priority: before.priority, institution_target_date: day(before.institution_target_date), period: before.period, required_for_class: before.required_for_class, owner_scope: before.owner_scope } : {},
    newValues: { classId: params.classId, canonicalConceptId: params.canonicalConceptId, priority: params.priority ?? 'NORMAL', institution_target_date: params.institutionTargetDate ?? null, period: params.period ?? null, required_for_class: params.required ?? true, owner_scope: 'INSTITUTION' },
  });
  return { id: r.rows[0].id };
}

/** Teacher-side guard for class plan writes (called by class-plan.service before any change). */
export async function enforceClassPlanLocks(params: {
  classId: string;
  canonicalConceptId: string;
  actorUserId: string;
  institutionId: string;
  requested: { priority?: unknown; period?: unknown; requiredForClass?: unknown; targetDate?: string | null; remove?: boolean };
}): Promise<void> {
  const row = (await db.query(`SELECT owner_scope, locked_fields, priority, period, required_for_class, institution_target_date FROM class_plan_concepts WHERE class_id = $1 AND canonical_concept_id = $2 AND status = 'ACTIVE'`, [
    params.classId,
    params.canonicalConceptId,
  ])).rows[0];
  const denied: string[] = [];
  if (row?.owner_scope === 'INSTITUTION') {
    const locked: string[] = row.locked_fields ?? [];
    if (params.requested.remove && locked.includes('removal')) denied.push('removal');
    if (params.requested.priority !== undefined && params.requested.priority !== row.priority && locked.includes('priority')) denied.push('priority');
    if (params.requested.period !== undefined && (params.requested.period ?? null) !== (row.period ?? null) && locked.includes('period')) denied.push('period');
    if (params.requested.requiredForClass !== undefined && params.requested.requiredForClass !== row.required_for_class && locked.includes('required_for_class')) denied.push('required_for_class');
    const inst = day(row.institution_target_date);
    if (params.requested.targetDate && inst && params.requested.targetDate > inst) denied.push('institution_target_date');
  }
  // A concept the institution curriculum marks REQUIRED can never be made "not required" by a teacher.
  if (params.requested.requiredForClass === false) {
    const req = await db.query(
      `SELECT 1 FROM classes c JOIN institution_curriculum_concepts icc ON icc.curriculum_id = c.institution_curriculum_id
       WHERE c.id = $1 AND icc.canonical_concept_id = $2 AND icc.status = 'ACTIVE' AND icc.classification = 'REQUIRED'`,
      [params.classId, params.canonicalConceptId]
    );
    if (req.rows[0]) denied.push('required_for_class');
  }
  if (denied.length) {
    await recordGovernanceEvent({
      institutionId: params.institutionId,
      actorUserId: params.actorUserId,
      actorScope: 'TEACHER',
      objectType: 'CLASS_PLAN_CONCEPT',
      objectId: null,
      action: params.requested.remove ? 'REMOVE_ATTEMPT' : 'UPDATE_ATTEMPT',
      fields: [...new Set(denied)],
      newValues: { classId: params.classId, canonicalConceptId: params.canonicalConceptId, requested: params.requested },
      outcome: 'DENIED',
    });
    throw new FieldLockedError([...new Set(denied)]);
  }
}

// ---------------------------------------------------------------------------
// Institution tasks
// ---------------------------------------------------------------------------

export interface InstitutionAssignmentView {
  id: string;
  title: string;
  canonicalConceptId: string;
  conceptLabel: string;
  instructions: string | null;
  startsAt: string | null;
  dueAt: string | null;
  period: string | null;
  priority: string;
  required: boolean;
  deliveryMode: 'TEACHER_SELECTS_RECIPIENTS' | 'DIRECT_ALL_STUDENTS';
  lockedFields: string[];
  teacherEditableFields: string[];
  status: string;
  institutionName: string;
  createdAt: string;
  targets: Array<{ classId: string; className: string; groupId: string; recipients: number; completed: number; activeLearners: number }>;
}

export async function createInstitutionAssignment(params: {
  institutionId: string;
  actorUserId: string;
  canonicalConceptId: string;
  title: string;
  instructions?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
  period?: string | null;
  priority?: 'HIGH' | 'NORMAL' | 'LOW';
  required?: boolean;
  deliveryMode: 'TEACHER_SELECTS_RECIPIENTS' | 'DIRECT_ALL_STUDENTS';
  classIds: string[];
  requestId?: string | null;
}): Promise<{ id: string; replayed: boolean; delivered: number }> {
  await requireAdmin(params.actorUserId, params.institutionId);
  if (params.requestId) {
    const prior = await db.query(`SELECT id FROM institution_assignments WHERE request_id = $1 AND institution_id = $2`, [params.requestId, params.institutionId]);
    if (prior.rows[0]) return { id: prior.rows[0].id, replayed: true, delivered: 0 };
  }
  if (params.startsAt && params.dueAt && new Date(params.dueAt) <= new Date(params.startsAt)) throw new GovernanceError('INVALID_DATES');
  const classes = [];
  for (const classId of [...new Set(params.classIds)]) {
    const k = await requireClassOfInstitution(params.institutionId, classId);
    const ok = await db.query(`SELECT 1 FROM canonical_concepts WHERE id = $1 AND canonical_subject_id = $2 AND status = 'ACTIVE'`, [params.canonicalConceptId, k.canonical_subject_id]);
    if (!ok.rows[0]) throw new GovernanceError('CONCEPT_NOT_IN_CLASS_SUBJECT');
    classes.push(k);
  }
  if (classes.length === 0) throw new GovernanceError('CLASS_NOT_TARGET');
  const created = await db.query(
    `INSERT INTO institution_assignments (institution_id, canonical_concept_id, title, instructions, starts_at, due_at, period, priority, required, delivery_mode, request_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      params.institutionId,
      params.canonicalConceptId,
      params.title.trim().slice(0, 200),
      params.instructions ?? null,
      params.startsAt ?? null,
      params.dueAt ?? null,
      params.period ?? null,
      params.priority ?? 'NORMAL',
      params.required ?? true,
      params.deliveryMode,
      params.requestId ?? null,
      params.actorUserId,
    ]
  );
  const id: string = created.rows[0].id;
  for (const k of classes) await db.query(`INSERT INTO institution_assignment_targets (assignment_id, class_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, k.id]);
  await recordGovernanceEvent({
    institutionId: params.institutionId,
    actorUserId: params.actorUserId,
    actorScope: 'INSTITUTION',
    objectType: 'INSTITUTION_ASSIGNMENT',
    objectId: id,
    action: 'CREATED',
    fields: ['title', 'concept', 'instructions', 'starts_at', 'due_at', 'period', 'priority', 'required', 'delivery_mode', 'targets'],
    newValues: { title: params.title, canonicalConceptId: params.canonicalConceptId, startsAt: params.startsAt ?? null, dueAt: params.dueAt ?? null, deliveryMode: params.deliveryMode, classIds: classes.map((k) => k.id) },
  });
  let delivered = 0;
  if (params.deliveryMode === 'DIRECT_ALL_STUDENTS') delivered = await deliverDirect(id, params.actorUserId);
  return { id, replayed: false, delivered };
}

async function loadAssignment(assignmentId: string) {
  const r = await db.query(`SELECT ia.*, i.name AS institution_name FROM institution_assignments ia JOIN institutions i ON i.id = ia.institution_id WHERE ia.id = $1`, [assignmentId]);
  if (!r.rows[0]) throw new GovernanceError('NOT_FOUND');
  return r.rows[0];
}

/** DIRECT_ALL_STUDENTS: every ACTIVE learner of every target class, as the institution. Idempotent per learner. */
async function deliverDirect(assignmentId: string, actorUserId: string): Promise<number> {
  const a = await loadAssignment(assignmentId);
  const targets = (await db.query(`SELECT class_id, assignment_group_id FROM institution_assignment_targets WHERE assignment_id = $1`, [assignmentId])).rows;
  let delivered = 0;
  for (const t of targets) {
    const learners = (await db.query(
      `SELECT s.id, s.user_id FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
       WHERE ce.class_id = $1 AND ce.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM teacher_interventions ti WHERE ti.assignment_group_id = $2 AND ti.student_id = s.id)`,
      [t.class_id, t.assignment_group_id]
    )).rows;
    for (const l of learners) {
      const plan = await enrollCanonicalConcept(l.id, a.canonical_concept_id, { type: 'INSTITUTION_ASSIGNMENT', key: assignmentId, classId: t.class_id, institutionId: a.institution_id, actorUserId });
      await assignInstitutionDirectIntervention(actorUserId, {
        classId: t.class_id,
        studentId: l.id,
        interventionType: 'CONCEPT_REINFORCEMENT',
        target: { targetType: 'CONCEPT', conceptId: plan.learnerConceptId },
        instructions: a.instructions ?? undefined,
        dueAt: iso(a.due_at) ?? undefined,
        startsAt: iso(a.starts_at) ?? undefined,
        title: a.title,
        assignmentGroupId: t.assignment_group_id,
        addedToPlan: plan.conceptCreated || plan.entryCreated || plan.restored,
        institutionAssignmentId: assignmentId,
      });
      delivered += 1;
      if (l.user_id) {
        await notifyUser({
          recipientUserId: l.user_id,
          workspace: 'STUDENT',
          type: 'ASSIGNMENT_PUBLISHED',
          title: 'Nueva tarea de tu institución',
          message: `${a.institution_name} te asignó: ${a.title}.`,
          payload: { conceptName: a.title, title: a.title },
          actionHref: '/dashboard/assignments',
        });
      }
    }
  }
  return delivered;
}

/** The institution edits its own task (dates, text...) -- propagated to every recipient row; audited old → new. */
export async function updateInstitutionAssignment(params: {
  institutionId: string;
  actorUserId: string;
  assignmentId: string;
  patch: { title?: string; instructions?: string | null; startsAt?: string | null; dueAt?: string | null; period?: string | null; priority?: 'HIGH' | 'NORMAL' | 'LOW' };
}) {
  await requireAdmin(params.actorUserId, params.institutionId);
  const a = await loadAssignment(params.assignmentId);
  if (a.institution_id !== params.institutionId) throw new GovernanceError('NOT_FOUND');
  const next = {
    title: params.patch.title?.trim() || a.title,
    instructions: params.patch.instructions !== undefined ? params.patch.instructions : a.instructions,
    starts_at: params.patch.startsAt !== undefined ? params.patch.startsAt : iso(a.starts_at),
    due_at: params.patch.dueAt !== undefined ? params.patch.dueAt : iso(a.due_at),
    period: params.patch.period !== undefined ? params.patch.period : a.period,
    priority: params.patch.priority ?? a.priority,
  };
  if (next.starts_at && next.due_at && new Date(next.due_at) <= new Date(next.starts_at)) throw new GovernanceError('INVALID_DATES');
  await db.query(`UPDATE institution_assignments SET title = $2, instructions = $3, starts_at = $4, due_at = $5, period = $6, priority = $7, updated_at = now() WHERE id = $1`, [
    a.id,
    next.title,
    next.instructions,
    next.starts_at,
    next.due_at,
    next.period,
    next.priority,
  ]);
  await db.query(`UPDATE teacher_interventions SET title = $2, instructions = $3, starts_at = $4, due_at = $5, updated_at = now() WHERE institution_assignment_id = $1 AND status <> 'CANCELLED'`, [
    a.id,
    next.title,
    next.instructions,
    next.starts_at,
    next.due_at,
  ]);
  const old = { title: a.title, instructions: a.instructions, starts_at: iso(a.starts_at), due_at: iso(a.due_at), period: a.period, priority: a.priority };
  const fields = Object.keys(next).filter((k) => String((next as any)[k] ?? '') !== String((old as any)[k] ?? ''));
  await recordGovernanceEvent({
    institutionId: params.institutionId,
    actorUserId: params.actorUserId,
    actorScope: 'INSTITUTION',
    objectType: 'INSTITUTION_ASSIGNMENT',
    objectId: a.id,
    action: 'UPDATED',
    fields,
    oldValues: Object.fromEntries(fields.map((f) => [f, (old as any)[f]])),
    newValues: Object.fromEntries(fields.map((f) => [f, (next as any)[f]])),
  });
  return { updated: fields };
}

export async function listInstitutionAssignments(institutionId: string, locale: string, classId?: string | null): Promise<InstitutionAssignmentView[]> {
  const r = await db.query(
    `SELECT ia.*, i.name AS institution_name,
       COALESCE(json_agg(json_build_object(
         'classId', t.class_id, 'className', c.name, 'groupId', t.assignment_group_id,
         'recipients', (SELECT COUNT(*) FROM teacher_interventions ti WHERE ti.assignment_group_id = t.assignment_group_id AND ti.status <> 'CANCELLED'),
         'completed', (SELECT COUNT(*) FROM teacher_interventions ti WHERE ti.assignment_group_id = t.assignment_group_id AND ti.status = 'COMPLETED'),
         'activeLearners', (SELECT COUNT(*) FROM class_enrollments ce WHERE ce.class_id = t.class_id AND ce.status = 'ACTIVE')
       ) ORDER BY c.name) FILTER (WHERE t.class_id IS NOT NULL), '[]') AS targets
     FROM institution_assignments ia
     JOIN institutions i ON i.id = ia.institution_id
     LEFT JOIN institution_assignment_targets t ON t.assignment_id = ia.id
     LEFT JOIN classes c ON c.id = t.class_id
     WHERE ia.institution_id = $1 AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM institution_assignment_targets x WHERE x.assignment_id = ia.id AND x.class_id = $2))
     GROUP BY ia.id, i.name
     ORDER BY ia.created_at DESC`,
    [institutionId, classId ?? null]
  );
  const labels = await canonicalConceptLabels(r.rows.map((x: any) => x.canonical_concept_id), locale);
  return r.rows.map((x: any) => ({
    id: x.id,
    title: x.title,
    canonicalConceptId: x.canonical_concept_id,
    conceptLabel: labels.get(x.canonical_concept_id) ?? '',
    instructions: x.instructions,
    startsAt: iso(x.starts_at),
    dueAt: iso(x.due_at),
    period: x.period,
    priority: x.priority,
    required: x.required,
    deliveryMode: x.delivery_mode,
    lockedFields: x.locked_fields ?? [],
    teacherEditableFields: x.teacher_editable_fields ?? [],
    status: x.status,
    institutionName: x.institution_name,
    createdAt: iso(x.created_at)!,
    targets: (x.targets ?? []).filter((t: any) => !classId || t.classId === classId).map((t: any) => ({ ...t, recipients: Number(t.recipients), completed: Number(t.completed), activeLearners: Number(t.activeLearners) })),
  }));
}

/** Teacher view of the institution tasks targeting a class they teach (read-only fields + recipients of that class). */
export async function listClassInstitutionAssignments(teacherUserId: string, classId: string, locale: string) {
  const klass = await getTeacherClass(teacherUserId, classId);
  if (!klass) throw new GovernanceError('NOT_ALLOWED');
  const list = await listInstitutionAssignments(klass.institutionId, locale, classId);
  const recipients = list.length
    ? (await db.query(`SELECT assignment_group_id, student_id FROM teacher_interventions WHERE assignment_group_id = ANY($1::uuid[]) AND status <> 'CANCELLED'`, [list.flatMap((a) => a.targets.map((t) => t.groupId))])).rows
    : [];
  return list.map((a) => ({ ...a, recipientIds: recipients.filter((r: any) => a.targets.some((t) => t.groupId === r.assignment_group_id)).map((r: any) => r.student_id as string) }));
}

/** The Teacher's ONLY action on an institution task: choose recipients (whole class or selected ACTIVE learners). Idempotent per learner. */
export async function addInstitutionAssignmentRecipients(params: { teacherUserId: string; assignmentId: string; classId: string; studentIds?: string[] | null }) {
  const klass = await getTeacherClass(params.teacherUserId, params.classId);
  if (!klass) throw new GovernanceError('NOT_ALLOWED');
  const a = await loadAssignment(params.assignmentId);
  if (a.institution_id !== klass.institutionId) throw new GovernanceError('NOT_FOUND');
  const target = (await db.query(`SELECT assignment_group_id FROM institution_assignment_targets WHERE assignment_id = $1 AND class_id = $2`, [a.id, params.classId])).rows[0];
  if (!target) throw new GovernanceError('CLASS_NOT_TARGET');
  if (a.delivery_mode === 'DIRECT_ALL_STUDENTS') throw new GovernanceError('DIRECT_DELIVERY');
  if (!(a.teacher_editable_fields ?? []).includes('recipients')) throw new FieldLockedError(['recipients']);
  const result = await publishClassAssignment(params.teacherUserId, {
    classId: params.classId,
    canonicalConceptId: a.canonical_concept_id,
    title: a.title,
    instructions: a.instructions,
    startsAt: iso(a.starts_at),
    dueAt: iso(a.due_at),
    studentIds: params.studentIds ?? null,
    requestId: target.assignment_group_id,
    governed: { institutionAssignmentId: a.id },
  });
  await recordGovernanceEvent({
    institutionId: a.institution_id,
    actorUserId: params.teacherUserId,
    actorScope: 'TEACHER',
    objectType: 'INSTITUTION_ASSIGNMENT',
    objectId: a.id,
    action: 'RECIPIENTS_ASSIGNED',
    fields: ['recipients'],
    newValues: { classId: params.classId, studentIds: result.assigned.map((x) => x.studentId), selected: Boolean(params.studentIds?.length) },
  });
  return result;
}

/**
 * A teacher edits one of the class's tasks. Teacher-owned: applied to every
 * recipient row. Institution-owned: every field is locked → denied + audited.
 */
export async function updateClassAssignment(params: {
  teacherUserId: string;
  classId: string;
  groupId: string;
  patch: { title?: string; instructions?: string | null; startsAt?: string | null; dueAt?: string | null };
}) {
  const klass = await getTeacherClass(params.teacherUserId, params.classId);
  if (!klass) throw new GovernanceError('NOT_ALLOWED');
  const rows = (await db.query(`SELECT id, owner_scope, institution_assignment_id, title, instructions, starts_at, due_at, assigned_by_user_id FROM teacher_interventions WHERE assignment_group_id = $1 AND class_id = $2 AND status <> 'CANCELLED'`, [
    params.groupId,
    params.classId,
  ])).rows;
  if (rows.length === 0) throw new GovernanceError('NOT_FOUND');
  const fields = Object.keys(params.patch).filter((k) => (params.patch as any)[k] !== undefined);
  const governed = rows.some((r: any) => r.owner_scope === 'INSTITUTION') || (await db.query(`SELECT 1 FROM institution_assignment_targets WHERE assignment_group_id = $1`, [params.groupId])).rows.length > 0;
  if (governed) {
    await recordGovernanceEvent({
      institutionId: klass.institutionId,
      actorUserId: params.teacherUserId,
      actorScope: 'TEACHER',
      objectType: 'INSTITUTION_ASSIGNMENT',
      objectId: rows[0].institution_assignment_id,
      action: 'UPDATE_ATTEMPT',
      fields,
      oldValues: { title: rows[0].title, due_at: iso(rows[0].due_at), starts_at: iso(rows[0].starts_at) },
      newValues: params.patch,
      outcome: 'DENIED',
    });
    throw new FieldLockedError(fields.map((f) => (f === 'dueAt' ? 'due_at' : f === 'startsAt' ? 'starts_at' : f)));
  }
  const first = rows[0];
  const next = {
    title: params.patch.title?.trim() || first.title,
    instructions: params.patch.instructions !== undefined ? params.patch.instructions : first.instructions,
    starts_at: params.patch.startsAt !== undefined ? params.patch.startsAt : iso(first.starts_at),
    due_at: params.patch.dueAt !== undefined ? params.patch.dueAt : iso(first.due_at),
  };
  if (next.starts_at && next.due_at && new Date(next.due_at) <= new Date(next.starts_at)) throw new GovernanceError('INVALID_DATES');
  await db.query(`UPDATE teacher_interventions SET title = $3, instructions = $4, starts_at = $5, due_at = $6, updated_at = now() WHERE assignment_group_id = $1 AND class_id = $2 AND status <> 'CANCELLED'`, [
    params.groupId,
    params.classId,
    next.title,
    next.instructions,
    next.starts_at,
    next.due_at,
  ]);
  await recordGovernanceEvent({
    institutionId: klass.institutionId,
    actorUserId: params.teacherUserId,
    actorScope: 'TEACHER',
    objectType: 'TEACHER_ASSIGNMENT',
    objectId: params.groupId,
    action: 'UPDATED',
    fields,
    oldValues: { title: first.title, instructions: first.instructions, starts_at: iso(first.starts_at), due_at: iso(first.due_at) },
    newValues: next,
  });
  return { updated: rows.length };
}

/** Recipient eligibility check reused by routes (ACTIVE in class + teacher relationship). */
export async function teacherMayAssign(teacherUserId: string, studentId: string): Promise<boolean> {
  return canTeacherAccessLearner(teacherUserId, studentId);
}
