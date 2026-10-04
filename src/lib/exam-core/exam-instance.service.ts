/**
 * Exam V2 -- exam instances (sections 28-34, 42-45).
 *
 * An exam instance is what the Student chose: which papers (components), in
 * which MODE and rigor. It wraps exactly one simulation attempt -- the attempt
 * engine (sections, clocks, autosave, grading, results) is unchanged.
 *
 *   PRACTICE  -- adaptive level (FOUNDATION..CHALLENGE, moves between
 *                sessions with the last result), per-item feedback allowed,
 *                form built when it starts; unfilled positions may be
 *                generated (validated) at delivery.
 *   MOCK      -- the official format: form ASSEMBLED AND FROZEN when the
 *                instance becomes READY (before start): no hints, no Tutor,
 *                no per-item feedback, no regeneration, no swap. Target
 *                difficulty 1.0. Official timing.
 *   CHALLENGE -- a frozen Mock form at difficulty ~1.10 (1.05-1.15), labelled
 *                "harder than the standard format". Never presented as the
 *                official exam.
 *
 * Lifecycle: DRAFT -> READY -> IN_PROGRESS -> COMPLETED | ARCHIVED, and
 * DELETED from any state (rules in `deleteExamInstance`). A "new attempt"
 * is always a NEW instance from zero; an instance is never reset.
 */
import { db } from '@/lib/db';
import { getBlueprintForVersion, listObjectiveTargets } from '@/lib/assessment/blueprint.service';
import { listComponentsForVersion } from '@/lib/assessment/component.service';
import { orderTargetsBySection } from '@/lib/simulation/plan.service';
import { startSimulationAttempt, abandonSimulationAttempt, getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { createStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { examItemFromApproved, examItemMarks } from './items';
import { lifecycleSqlFor } from './question-bank/lifecycle';
import { DEFAULT_REUSE_POLICY } from './question-bank/policy';
import { DEFAULT_DEMAND_POLICY } from './question-bank/demand';
import { assembleForm, nextPracticeLevel, type AssembledForm, type FormPosition, type InstanceMode, type PoolItem, type PracticeLevel, type StudentUsage } from './form-assembly';
import type { ExamItemState } from './navigation-state';
import type { TimingMode } from '@/lib/simulation/types';

export type InstanceStatus = 'DRAFT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED' | 'DELETED';
export type Rigor = 'OFFICIAL_FIDELITY' | 'STRICT_READINESS';

export interface ExamInstance {
  id: string;
  studentId: string;
  examProfileId: string;
  examVersionId: string;
  structureNodeId: string | null;
  componentIds: string[];
  /** Skill-level practice: only these objectives (empty = all). */
  focusObjectiveIds: string[];
  mode: InstanceMode;
  rigor: Rigor;
  practiceLevel: PracticeLevel | null;
  timingMode: TimingMode;
  status: InstanceStatus;
  form: AssembledForm | null;
  formFrozenAt: string | null;
  difficultyIndex: number | null;
  simulationAttemptId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export class ExamInstanceError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'COMPONENT_NOT_IN_VERSION'
      | 'COMPONENT_NOT_SIMULATION_CAPABLE'
      | 'INVALID_STATE'
      | 'TIMING_NOT_ALLOWED_FOR_MODE'
      | 'NO_ITEMS_FOR_FORM'
      | 'CONFIRMATION_REQUIRED'
      | 'PROFILE_ARCHIVED'
      | 'ATTEMPT_IN_PROGRESS',
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ExamInstanceError';
  }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);

function toInstance(r: any): ExamInstance {
  return {
    id: r.id,
    studentId: r.student_id,
    examProfileId: r.exam_profile_id,
    examVersionId: r.exam_version_id,
    structureNodeId: r.structure_node_id,
    componentIds: r.component_ids,
    focusObjectiveIds: r.focus_objective_ids ?? [],
    mode: r.mode,
    rigor: r.rigor,
    practiceLevel: r.practice_level,
    timingMode: r.timing_mode,
    status: r.status,
    form: r.form,
    formFrozenAt: iso(r.form_frozen_at),
    difficultyIndex: r.difficulty_index === null ? null : Number(r.difficulty_index),
    simulationAttemptId: r.simulation_attempt_id,
    createdAt: iso(r.created_at)!,
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
  };
}

/** Mock and Challenge always run on official timing; Practice never does. */
export function timingFor(mode: InstanceMode, requested: TimingMode | undefined): TimingMode {
  if (mode !== 'PRACTICE') return 'OFFICIAL_SIMULATION_TIMED';
  if (requested === 'OFFICIAL_SIMULATION_TIMED') throw new ExamInstanceError('TIMING_NOT_ALLOWED_FOR_MODE', 'practice is untimed or training-timed');
  return requested ?? 'UNTIMED';
}

/* ------------------------------------------------------------------ */
/* Form assembly (DB reads -> pure assembleForm)                        */
/* ------------------------------------------------------------------ */

async function formInputs(examVersionId: string, componentIds: string[], studentId: string, focusObjectiveIds: string[] = [], mode: InstanceMode = 'MOCK') {
  const blueprint = await getBlueprintForVersion(examVersionId);
  if (!blueprint) throw new ExamInstanceError('NO_ITEMS_FOR_FORM', 'version has no blueprint');
  const components = await listComponentsForVersion(examVersionId);
  const only = new Set(componentIds);
  const focus = focusObjectiveIds.length ? new Set(focusObjectiveIds) : null;
  const targets = orderTargetsBySection((await listObjectiveTargets(blueprint.id)).filter((t) => only.has(t.assessmentComponentId) && (!focus || focus.has(t.learningObjectiveId))), components);
  const positions: FormPosition[] = targets.map((t, index) => ({
    index,
    blueprintObjectiveTargetId: t.id,
    assessmentComponentId: t.assessmentComponentId,
    learningObjectiveId: t.learningObjectiveId,
    questionType: t.questionType,
    difficultyRange: t.difficultyMin !== null && t.difficultyMax !== null ? { min: t.difficultyMin, max: t.difficultyMax } : null,
  }));
  const objectiveIds = [...new Set(positions.map((p) => p.learningObjectiveId).filter((x): x is string => !!x))];
  // A mock whose positions reach every selected component's published item count is a FULL-length form:
  // it draws only items certified for FULL_MOCK; otherwise a Mock / Challenge draws REDUCED_MOCK items.
  const officialCounts = await db.query(`SELECT id, definition->>'officialItemCount' AS n FROM assessment_components WHERE id = ANY($1::uuid[])`, [[...only]]);
  const fullLength = officialCounts.rows.length > 0 && officialCounts.rows.every((r: any) => r.n !== null && positions.filter((p) => p.assessmentComponentId === r.id).length >= Number(r.n));
  const use = mode === 'PRACTICE' ? 'PRACTICE' : fullLength ? 'FULL_MOCK' : 'REDUCED_MOCK';
  // Question Bank content-use policy (server-authoritative): practice may use PILOT items, a Mock / Challenge
  // only ACTIVE / CALIBRATED ones -- a mock is never filled with weaker content to reach its length.
  const poolRows = await db.query(
    `SELECT ai.id, ai.learning_objective_id, ai.question_type, ai.content, ai.difficulty_index, ai.template_fingerprint, ai.semantic_fingerprint, ai.content_origin
       FROM approved_items ai WHERE ai.status = 'PUBLISHED' AND ai.learning_objective_id = ANY($1::uuid[]) AND ${lifecycleSqlFor(use)}`,
    [objectiveIds]
  );
  const pool: PoolItem[] = [];
  for (const r of poolRows.rows) {
    const item = examItemFromApproved(r);
    if (!item) continue;
    pool.push({
      id: r.id,
      learningObjectiveId: r.learning_objective_id,
      questionType: r.question_type,
      difficulty: item.difficulty,
      difficultyIndex: r.difficulty_index === null ? item.exam.difficultyIndex ?? null : Number(r.difficulty_index),
      marks: examItemMarks(item),
      templateFingerprint: r.template_fingerprint,
      semanticFingerprint: r.semantic_fingerprint,
      stimulusKey: item.exam.stimulus?.key ?? null,
      contentOrigin: r.content_origin ?? item.exam.contentOrigin ?? null,
    });
  }
  // Exposure memory (Question Bank V2): what THIS Student has seen (recently = within the reuse cooldown),
  // how many Students have seen each candidate, and how many OTHER Students met it in the planning horizon.
  const usageRows = await db.query(`SELECT approved_item_id, template_fingerprint, used_at > now() - ($2::int * interval '1 day') AS recent FROM exam_item_usage WHERE student_id = $1`, [studentId, DEFAULT_REUSE_POLICY.studentExposureCooldownDays]);
  const usage: StudentUsage = { approvedItemIds: new Set<string>(), templateFingerprints: new Set<string>(), recentApprovedItemIds: new Set<string>(), globalExposure: new Map(), peerExposure: new Map(), exposureCeiling: DEFAULT_DEMAND_POLICY.targetMaxStudentsPerQuestion };
  for (const u of usageRows.rows) {
    if (u.approved_item_id) usage.approvedItemIds.add(u.approved_item_id);
    if (u.approved_item_id && u.recent) usage.recentApprovedItemIds!.add(u.approved_item_id);
    if (u.template_fingerprint) usage.templateFingerprints.add(u.template_fingerprint);
  }
  const poolIds = pool.map((p) => p.id);
  if (poolIds.length) {
    const exposure = await db.query(
      `SELECT approved_item_id, count(DISTINCT student_id)::int AS students,
              count(DISTINCT student_id) FILTER (WHERE student_id <> $2 AND used_at > now() - ($3::int * interval '1 day'))::int AS peers
         FROM exam_item_usage WHERE approved_item_id = ANY($1::uuid[]) GROUP BY 1`,
      [poolIds, studentId, DEFAULT_DEMAND_POLICY.horizonDays]
    );
    for (const e of exposure.rows) {
      usage.globalExposure!.set(e.approved_item_id, e.students);
      usage.peerExposure!.set(e.approved_item_id, e.peers);
    }
  }
  const officialMarksByComponent: Record<string, number | null> = {};
  const officialItemsByComponent: Record<string, number | null> = {};
  const sizes = await db.query(`SELECT id, max_marks, definition->>'officialItemCount' AS item_count FROM assessment_components WHERE id = ANY($1::uuid[])`, [[...only]]);
  for (const row of sizes.rows) {
    officialMarksByComponent[row.id] = row.max_marks === null ? null : Number(row.max_marks);
    officialItemsByComponent[row.id] = row.item_count === null ? null : Number(row.item_count);
  }
  return { positions, pool, usage, officialMarksByComponent, officialItemsByComponent, use };
}

async function freezeForm(instance: ExamInstance): Promise<AssembledForm> {
  const { use, ...inputs } = await formInputs(instance.examVersionId, instance.componentIds, instance.studentId, instance.focusObjectiveIds, instance.mode);
  const form = assembleForm({ seed: instance.id, mode: instance.mode, practiceLevel: instance.practiceLevel, ...inputs });
  if (!form.slots.some((s) => s.approvedItemId) && instance.mode !== 'PRACTICE') throw new ExamInstanceError('NO_ITEMS_FOR_FORM');
  await db.query(`UPDATE exam_instances SET form = $2, form_frozen_at = now(), difficulty_index = $3 WHERE id = $1`, [instance.id, JSON.stringify(form), form.difficultyIndex]);
  const used = form.slots.filter((s) => s.approvedItemId).map((s) => s.approvedItemId!);
  if (used.length > 0) {
    await db.query(
      `INSERT INTO exam_item_usage (student_id, approved_item_id, semantic_fingerprint, template_fingerprint, exam_instance_id, delivery_use)
       SELECT $1, ai.id, ai.semantic_fingerprint, ai.template_fingerprint, $2, $4 FROM approved_items ai WHERE ai.id = ANY($3::uuid[])`,
      [instance.studentId, instance.id, used, use]
    );
  }
  return form;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

export async function getExamInstance(id: string): Promise<ExamInstance | null> {
  const r = await db.query(`SELECT * FROM exam_instances WHERE id = $1`, [id]);
  if (r.rows.length === 0) return null;
  return syncFromAttempt(toInstance(r.rows[0]));
}

/** Instance status follows its attempt: a submitted attempt completes it, an abandoned one archives it. */
async function syncFromAttempt(instance: ExamInstance): Promise<ExamInstance> {
  if (instance.status !== 'IN_PROGRESS' || !instance.simulationAttemptId) return instance;
  const attempt = await getSimulationAttempt(instance.simulationAttemptId);
  const next = attempt?.status === 'COMPLETED' ? 'COMPLETED' : attempt?.status === 'ABANDONED' ? 'ARCHIVED' : null;
  if (!next) return instance;
  const r = await db.query(`UPDATE exam_instances SET status = $2, completed_at = COALESCE(completed_at, now()) WHERE id = $1 AND status = 'IN_PROGRESS' RETURNING *`, [instance.id, next]);
  return r.rows[0] ? toInstance(r.rows[0]) : instance;
}

export async function listExamInstances(studentId: string, examProfileId?: string): Promise<ExamInstance[]> {
  const r = await db.query(
    `SELECT * FROM exam_instances WHERE student_id = $1 AND status <> 'DELETED' AND ($2::uuid IS NULL OR exam_profile_id = $2) ORDER BY created_at DESC LIMIT 100`,
    [studentId, examProfileId ?? null]
  );
  const out: ExamInstance[] = [];
  for (const row of r.rows) out.push(await syncFromAttempt(toInstance(row)));
  return out;
}

async function lastPracticeOutcome(studentId: string, examProfileId: string): Promise<{ level: PracticeLevel; fraction: number | null } | null> {
  const r = await db.query(
    `SELECT i.practice_level, res.raw_score, res.max_score
       FROM exam_instances i
       LEFT JOIN simulation_attempts sa ON sa.id = i.simulation_attempt_id
       LEFT JOIN exam_attempt_results res ON res.exam_attempt_id = sa.exam_attempt_id AND res.status = 'SCORED'
      WHERE i.student_id = $1 AND i.exam_profile_id = $2 AND i.mode = 'PRACTICE' AND i.status <> 'DELETED' AND sa.status = 'COMPLETED'
      ORDER BY res.scored_at DESC NULLS LAST, i.created_at DESC LIMIT 1`,
    [studentId, examProfileId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const max = Number(row.max_score);
  return { level: row.practice_level ?? 'STANDARD', fraction: row.raw_score !== null && max > 0 ? Number(row.raw_score) / max : null };
}

export async function createExamInstance(params: {
  studentId: string;
  examProfileId: string;
  examVersionId: string;
  componentIds: string[];
  mode: InstanceMode;
  rigor?: Rigor;
  practiceLevel?: PracticeLevel;
  timingMode?: TimingMode;
  structureNodeId?: string;
  /** Skill-level practice (PRACTICE only). */
  focusObjectiveIds?: string[];
}): Promise<ExamInstance> {
  if (params.focusObjectiveIds?.length && params.mode !== 'PRACTICE') throw new ExamInstanceError('INVALID_STATE', 'skill focus is practice-only');
  // A preparation the Student removed (ARCHIVED) never gets new exams.
  const prof = await db.query(`SELECT status FROM student_exam_profiles WHERE id = $1 AND student_id = $2`, [params.examProfileId, params.studentId]);
  if (!prof.rows[0]) throw new ExamInstanceError('NOT_FOUND', 'exam profile');
  if (prof.rows[0].status === 'ARCHIVED') throw new ExamInstanceError('PROFILE_ARCHIVED');
  const components = await listComponentsForVersion(params.examVersionId);
  const ids = [...new Set(params.componentIds)];
  if (ids.length === 0) throw new ExamInstanceError('COMPONENT_NOT_IN_VERSION', 'select at least one paper');
  for (const id of ids) {
    const c = components.find((x) => x.id === id);
    if (!c) throw new ExamInstanceError('COMPONENT_NOT_IN_VERSION', id);
    if (!c.simulationCapable) throw new ExamInstanceError('COMPONENT_NOT_SIMULATION_CAPABLE', id);
  }
  const selected = components.filter((c) => ids.includes(c.id));
  const ordered = selected.map((c) => c.id);
  // Coursework (portfolio / project) has no official time: such a selection is untimed in every mode.
  const untimedComponents = selected.some((c) => c.timingStatus !== 'CONFIGURED' || c.durationMinutes === null);
  const timingMode = untimedComponents ? 'UNTIMED' : timingFor(params.mode, params.timingMode);
  let practiceLevel: PracticeLevel | null = null;
  if (params.mode === 'PRACTICE') {
    if (params.practiceLevel) practiceLevel = params.practiceLevel;
    else {
      const last = await lastPracticeOutcome(params.studentId, params.examProfileId);
      practiceLevel = last ? nextPracticeLevel(last.level, last.fraction) : 'STANDARD';
    }
  }
  const r = await db.query(
    `INSERT INTO exam_instances (student_id, exam_profile_id, exam_version_id, structure_node_id, component_ids, mode, rigor, practice_level, timing_mode, status, focus_objective_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT', $10) RETURNING *`,
    [params.studentId, params.examProfileId, params.examVersionId, params.structureNodeId ?? null, ordered, params.mode, params.rigor ?? 'OFFICIAL_FIDELITY', practiceLevel, timingMode, params.focusObjectiveIds ?? []]
  );
  const instance = toInstance(r.rows[0]);
  if (instance.mode !== 'PRACTICE') {
    try {
      await freezeForm(instance);
    } catch (err) {
      await db.query(`UPDATE exam_instances SET status = 'DELETED', deleted_at = now(), delete_reason = 'FORM_ASSEMBLY_FAILED' WHERE id = $1`, [instance.id]);
      throw err;
    }
  }
  const ready = await db.query(`UPDATE exam_instances SET status = 'READY' WHERE id = $1 AND status = 'DRAFT' RETURNING *`, [instance.id]);
  return toInstance(ready.rows[0]);
}

/** Server-held items for every filled form slot, keyed by plan position. */
async function presetFromForm(instance: ExamInstance, form: AssembledForm, plan: { selectedTargets: Array<{ blueprintObjectiveTargetId: string; assessmentComponentId: string; commandTermId: string | null }> }): Promise<Record<number, ExamItemState>> {
  const ids = form.slots.map((s) => s.approvedItemId).filter((x): x is string => !!x);
  const rows = ids.length ? (await db.query(`SELECT id, learning_objective_id, content FROM approved_items WHERE id = ANY($1::uuid[])`, [ids])).rows : [];
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  const bySlot = new Map(form.slots.map((s) => [s.blueprintObjectiveTargetId, s]));
  const now = new Date().toISOString();
  const preset: Record<number, ExamItemState> = {};
  plan.selectedTargets.forEach((t, index) => {
    const slot = bySlot.get(t.blueprintObjectiveTargetId);
    const row = slot?.approvedItemId ? byId.get(slot.approvedItemId) : null;
    const item = row ? examItemFromApproved(row) : null;
    const ctx = { assessmentComponentId: t.assessmentComponentId, learningObjectiveId: row?.learning_objective_id ?? null, commandTermId: t.commandTermId };
    if (item) preset[index] = { status: 'DELIVERED', item, ctx, deliveredAt: now };
    // A frozen form never generates: an unfilled position is excluded (the form says REDUCED).
    else if (instance.mode !== 'PRACTICE') preset[index] = { status: 'EXCLUDED', unavailableReason: 'NO_ITEM_GENERATED', ctx };
  });
  return preset;
}

export async function startExamInstance(instanceId: string, params: { language: string; timezone?: string }): Promise<ExamInstance> {
  const instance = await getExamInstance(instanceId);
  if (!instance) throw new ExamInstanceError('NOT_FOUND');
  if (instance.status === 'IN_PROGRESS') return instance;
  if (instance.status !== 'READY') throw new ExamInstanceError('INVALID_STATE', instance.status);
  const open = await db.query(`SELECT id FROM simulation_attempts WHERE exam_profile_id = $1 AND status IN ('ACTIVE','PAUSED') LIMIT 1`, [instance.examProfileId]);
  if (open.rows[0]) throw new ExamInstanceError('ATTEMPT_IN_PROGRESS', open.rows[0].id);

  const form = instance.form ?? (await freezeForm(instance));
  const { simulationAttempt } = await startSimulationAttempt({
    studentId: instance.studentId,
    examProfileId: instance.examProfileId,
    examVersionId: instance.examVersionId,
    simulationType: 'FULL_MOCK',
    timingMode: instance.timingMode,
    language: params.language,
    timezone: params.timezone,
    assessmentComponentIds: instance.componentIds,
    learningObjectiveIds: instance.focusObjectiveIds.length ? instance.focusObjectiveIds : undefined,
    itemFeedback: instance.mode === 'PRACTICE' ? 'AFTER_EACH_ITEM' : 'NEVER',
    presetItems: (plan) => presetFromForm(instance, form, plan),
  });
  const r = await db.query(
    `UPDATE exam_instances SET status = 'IN_PROGRESS', simulation_attempt_id = $2, started_at = now() WHERE id = $1 AND status = 'READY' RETURNING *`,
    [instance.id, simulationAttempt.id]
  );
  return toInstance(r.rows[0]);
}

/**
 * Deletion rules (section 43):
 *   DRAFT / READY  -> DELETED; the unseen form is discarded and its item usage released.
 *   IN_PROGRESS    -> only with `confirm`; the attempt is abandoned (no result), then DELETED.
 *   COMPLETED      -> only with `confirm`; SOFT delete: the instance is DELETED (hidden from the
 *                     Student's visible history). The attempt, its responses, its SCORED result
 *                     and every piece of consolidated learning evidence are preserved untouched.
 *   ARCHIVED       -> DELETED.
 *   DELETED        -> no-op (idempotent).
 */
export async function deleteExamInstance(instanceId: string, params: { confirm: boolean; reason?: string; ownerStudentId: string }): Promise<{ instance: ExamInstance; resultPreserved: boolean; attemptAbandoned: boolean }> {
  const instance = await getExamInstance(instanceId);
  // Owner-scoped in the service too (defense in depth): another Student's instance does not exist for this caller.
  if (!instance || instance.studentId !== params.ownerStudentId) throw new ExamInstanceError('NOT_FOUND');
  if (instance.status === 'DELETED') return { instance, resultPreserved: instance.completedAt !== null, attemptAbandoned: false };
  let attemptAbandoned = false;
  if ((instance.status === 'IN_PROGRESS' || instance.status === 'COMPLETED') && !params.confirm) throw new ExamInstanceError('CONFIRMATION_REQUIRED', instance.status);

  if (instance.status === 'DRAFT' || instance.status === 'READY') {
    await db.query(`DELETE FROM exam_item_usage WHERE exam_instance_id = $1`, [instance.id]);
  }
  if (instance.status === 'IN_PROGRESS' && instance.simulationAttemptId) {
    const attempt = await getSimulationAttempt(instance.simulationAttemptId);
    if (attempt && (attempt.status === 'ACTIVE' || attempt.status === 'PAUSED')) {
      await abandonSimulationAttempt(attempt.id);
      attemptAbandoned = true;
    }
  }
  // COMPLETED: nothing below the instance is touched -- result and evidence stay as consolidated history.
  const resultPreserved = instance.status === 'COMPLETED';
  const r = await db.query(`UPDATE exam_instances SET status = 'DELETED', deleted_at = now(), delete_reason = $2 WHERE id = $1 AND status <> 'DELETED' RETURNING *`, [instance.id, (params.reason ?? 'STUDENT_REQUEST').slice(0, 200)]);
  console.log('[exam-core]', JSON.stringify({ at: 'exam_instance_deleted', instanceId: instance.id, from: instance.status, resultPreserved, attemptAbandoned }));
  return { instance: r.rows[0] ? toInstance(r.rows[0]) : instance, resultPreserved, attemptAbandoned };
}

/** A new attempt is always a NEW instance from zero (same papers, mode and rigor; a Mock gets a fresh form). */
export async function newInstanceFromExisting(instanceId: string): Promise<ExamInstance> {
  const prev = await getExamInstance(instanceId);
  if (!prev) throw new ExamInstanceError('NOT_FOUND');
  // The old preparation may have been removed or restarted since: the new attempt goes to the ACTIVE one.
  const prevProfile = (await db.query(`SELECT exam_definition_id, status FROM student_exam_profiles WHERE id = $1`, [prev.examProfileId])).rows[0];
  const examProfileId = prevProfile?.status === 'ARCHIVED' ? await ensureExamProfile(prev.studentId, prevProfile.exam_definition_id, prev.examVersionId) : prev.examProfileId;
  return createExamInstance({
    studentId: prev.studentId,
    examProfileId,
    examVersionId: prev.examVersionId,
    componentIds: prev.componentIds,
    mode: prev.mode,
    rigor: prev.rigor,
    timingMode: prev.mode === 'PRACTICE' ? prev.timingMode : undefined,
    structureNodeId: prev.structureNodeId ?? undefined,
    focusObjectiveIds: prev.focusObjectiveIds.length ? prev.focusObjectiveIds : undefined,
  });
}

export async function findInstanceByAttempt(simulationAttemptId: string): Promise<ExamInstance | null> {
  const r = await db.query(`SELECT * FROM exam_instances WHERE simulation_attempt_id = $1`, [simulationAttemptId]);
  return r.rows[0] ? syncFromAttempt(toInstance(r.rows[0])) : null;
}

/* ------------------------------------------------------------------ */
/* Client-safe view (no item ids, no keys)                              */
/* ------------------------------------------------------------------ */

export interface ExamInstanceView {
  id: string;
  mode: InstanceMode;
  rigor: Rigor;
  practiceLevel: PracticeLevel | null;
  timingMode: TimingMode;
  status: InstanceStatus;
  exam: { definitionName: string; family: string; versionLabel: string };
  components: Array<{ id: string; name: string }>;
  form: null | {
    fidelity: 'FULL' | 'REDUCED';
    coveragePercent: number;
    difficultyIndex: number | null;
    targetDifficulty: number;
    difficultyBandMet: boolean;
    notes: string[];
    positions: number;
    filled: number;
    components: Array<{ componentId: string; officialMarks: number | null; officialItems: number | null; plannedMarks: number; positions: number; filled: number }>;
  };
  frozen: boolean;
  simulationAttemptId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** The scored result of a completed instance (raw / max), for the history card. */
  result: { rawScore: number; maxScore: number } | null;
}

export async function toInstanceView(instance: ExamInstance): Promise<ExamInstanceView> {
  const meta = (
    await db.query(
      `SELECT d.name AS definition_name, d.exam_family, v.version_label FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE v.id = $1`,
      [instance.examVersionId]
    )
  ).rows[0];
  const comps = (await db.query(`SELECT id, name, definition->>'officialName' AS official FROM assessment_components WHERE id = ANY($1::uuid[])`, [instance.componentIds])).rows;
  const byId = new Map(comps.map((c: any) => [c.id, c.official ?? c.name]));
  const scored = instance.status === 'COMPLETED' && instance.simulationAttemptId
    ? (await db.query(`SELECT r.raw_score, r.max_score FROM simulation_attempts sa JOIN exam_attempt_results r ON r.exam_attempt_id = sa.exam_attempt_id WHERE sa.id = $1 AND r.status = 'SCORED'`, [instance.simulationAttemptId])).rows[0]
    : null;
  const f = instance.form;
  return {
    id: instance.id,
    mode: instance.mode,
    rigor: instance.rigor,
    practiceLevel: instance.practiceLevel,
    timingMode: instance.timingMode,
    status: instance.status,
    exam: { definitionName: meta?.definition_name ?? '', family: meta?.exam_family ?? '', versionLabel: meta?.version_label ?? '' },
    components: instance.componentIds.map((id) => ({ id, name: byId.get(id) ?? '' })),
    form: f
      ? {
          fidelity: f.fidelity,
          coveragePercent: f.coveragePercent,
          difficultyIndex: f.difficultyIndex,
          targetDifficulty: f.targetDifficulty,
          difficultyBandMet: f.difficultyBandMet,
          notes: f.notes,
          positions: f.slots.length,
          filled: f.slots.filter((s) => s.approvedItemId).length,
          components: f.components.map((c) => ({ componentId: c.componentId, officialMarks: c.officialMarks, officialItems: c.officialItems ?? null, plannedMarks: c.plannedMarks, positions: c.positions, filled: c.filled })),
        }
      : null,
    frozen: !!instance.formFrozenAt && instance.mode !== 'PRACTICE',
    simulationAttemptId: instance.simulationAttemptId,
    createdAt: instance.createdAt,
    startedAt: instance.startedAt,
    completedAt: instance.completedAt,
    result: scored ? { rawScore: Number(scored.raw_score), maxScore: Number(scored.max_score) } : null,
  };
}

/**
 * Ensures the Student has an exam profile for the version's definition (reused when one exists).
 * Objective first: a preparation chosen for the objective of this exam (e.g. PISA 2022, possibly
 * chosen while it was catalogue only) is the SAME preparation -- it is reused and now names its exam.
 */
export async function ensureExamProfile(studentId: string, examDefinitionId: string, examVersionId: string): Promise<string> {
  // The Student's ACTIVE preparation for this exam (one at most); an archived one is never reused --
  // choosing the exam again after "Quitar de mi preparación" starts a new, clean preparation.
  const existing = await db.query(
    `SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_definition_id = $2 AND status <> 'ARCHIVED' ORDER BY created_at DESC LIMIT 1`,
    [studentId, examDefinitionId]
  );
  if (existing.rows[0]) {
    await db.query(`UPDATE student_exam_profiles SET exam_version_id = $2 WHERE id = $1 AND exam_version_id IS NULL`, [existing.rows[0].id, examVersionId]);
    return existing.rows[0].id;
  }
  const configKey = (await db.query(`SELECT config_key FROM exam_definitions WHERE id = $1`, [examDefinitionId])).rows[0]?.config_key as string | undefined;
  const { objectiveForConfig } = await import('./objectives/objective-catalog');
  const objective = configKey ? objectiveForConfig(configKey) : null;
  if (objective) {
    const byObjective = await db.query(
      `UPDATE student_exam_profiles SET exam_definition_id = $3, exam_version_id = COALESCE(exam_version_id, $4), updated_at = now()
        WHERE id = (SELECT id FROM student_exam_profiles WHERE student_id = $1 AND objective_key = $2 AND status <> 'ARCHIVED' AND exam_definition_id IS NULL LIMIT 1)
        RETURNING id`,
      [studentId, objective.key, examDefinitionId, examVersionId]
    );
    if (byObjective.rows[0]) return byObjective.rows[0].id;
  }
  const p = await createStudentExamProfile({
    studentId,
    examDefinitionId,
    examVersionId,
    ...(objective ? { objectiveKey: objective.key, objectiveFramework: objective.framework, objectiveContext: { label: objective.label, ...objective.context }, source: 'EXAM_INSTANCE' as const } : {}),
  });
  return p.id;
}
