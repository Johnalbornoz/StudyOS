/**
 * Exam preparation, objective first -- server side (DB).
 *
 *   objectiveCapabilities / allObjectiveCapabilities
 *       getExamPreparationCapabilities: what each objective can do, from the
 *       persisted catalogue state (server-authoritative).
 *   createObjectivePreparation
 *       Choose ANY catalogue objective (catalogue-only included). Idempotent:
 *       one active preparation per Student and objective; a legacy profile for
 *       the same exam is adopted, never duplicated.
 *   getPreparationView
 *       The preparation home: capabilities + the personalized plan built from
 *       the EXISTING learner model (nothing is reset, nothing is enrolled).
 *   startPreparationDiagnostic
 *       A practice instance sampling every practice-ready area (optional).
 *   addConceptFromPreparation
 *       "Añadir a mi plan" for one mapped requirement concept: the same path as
 *       the exam bridge (one learner state per canonical concept), provenance
 *       EXAM_PREPARATION recorded once.
 */
import { db } from '@/lib/db';
import { track } from '@/lib/analytics';
import { createStudentExamProfile, getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import type { StudentExamProfile } from '@/lib/assessment/types';
import { findOpenSimulationAttemptForProfile } from '@/lib/simulation/attempt.service';
import { calendarDaysUntil } from '@/lib/experience/goal';
import { READINESS_ORDER, type ReadinessState, type ComponentReadiness } from '../catalog/readiness';
import { addConceptToStudentLearning } from '../catalog/learning-links.service';
import { createExamInstance, toInstanceView } from '../exam-instance.service';
import { examObjectives, objectiveByKey, objectiveForConfig, type ExamObjective } from './objective-catalog';
import { computeCapabilities, objectiveStatusKey, type ExamPreparationCapabilities, type ObjectiveEntry } from './capabilities';
import { buildPreparationPlan, nextStep, type ExamEvidence, type LearnerConceptState, type PreparationPlan, type RequirementInput } from './preparation-plan';
import { applyBankReadinessOverlay } from '../question-bank/capability-overlay.service';
import { acquireLaunchLock } from '@/services/activity-launch-lock.service';
import { objectiveEligibilityForStudent } from '../eligibility/eligibility.service';

export class PreparationError extends Error {
  constructor(public readonly code: 'OBJECTIVE_NOT_FOUND' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'CAPABILITY_NOT_AVAILABLE' | 'REQUIREMENT_NOT_IN_PREPARATION' | 'IN_PROGRESS', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PreparationError';
  }
}

// ---------------------------------------------------------------- capabilities

const isReadiness = (s: unknown): s is ReadinessState => READINESS_ORDER.includes(s as ReadinessState);

function toEntry(row: any, language: string): ObjectiveEntry {
  const r = row.metadata?.readiness ?? {};
  const comps = (r.components ?? []) as ComponentReadiness[];
  const lengths = comps.map((c) => c.lengthCoveragePercent).filter((x): x is number => x !== null && x !== undefined);
  return {
    key: row.node_key,
    type: row.node_type,
    label: (row.labels && row.labels[language]) || row.label,
    purpose: row.metadata?.purpose ?? null,
    state: isReadiness(r.state) ? r.state : 'CATALOG_ONLY',
    modes: Array.isArray(r.modes) ? r.modes : [],
    selectable: !!row.selectable,
    bankInProgress: !!r.bankInProgress,
    sectionBound: !!row.metadata?.bind?.sectionKey,
    lengthCoveragePercent: comps.length && lengths.length === comps.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null,
  };
}

/** The persisted catalogue entries inside an objective (its primary node and descendants). */
const inObjective = (o: ExamObjective, key: string) => key === o.nodeKey || key.startsWith(`${o.nodeKey}.`);

async function bridgeMappingsByConfig(configKeys: string[]): Promise<Map<string, number>> {
  if (!configKeys.length) return new Map();
  const r = await db.query(
    `SELECT d.config_key, count(DISTINCT m.id)::int AS n
       FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
       JOIN assessment_blueprints b ON b.exam_version_id = v.id
       JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
       JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
      WHERE d.config_key = ANY($1::text[]) AND d.status IN ('ACTIVE', 'DRAFT')
      GROUP BY d.config_key`,
    [configKeys]
  );
  return new Map(r.rows.map((x: any) => [x.config_key, x.n]));
}

/** getExamPreparationCapabilities for every objective at once (Explorer). */
export async function allObjectiveCapabilities(language = 'es'): Promise<Map<string, ExamPreparationCapabilities>> {
  const objectives = examObjectives();
  const [nodes, bridge] = await Promise.all([
    db.query(`SELECT node_key, node_type, label, labels, selectable, metadata, exam_version_id, assessment_component_id FROM assessment_structure_nodes WHERE status = 'ACTIVE'`),
    bridgeMappingsByConfig([...new Set(objectives.flatMap((o) => o.configKeys))]),
  ]);
  // Question Bank: bank-derived readiness (ENFORCE) from precomputed snapshots; a no-op in SHADOW.
  const rows = (await applyBankReadinessOverlay(nodes.rows as any[])) as any[];
  // Index rows by their objective (prefix match on the node key's ancestors).
  const byObjectiveNode = new Map<string, any[]>();
  const primaries = new Map(objectives.map((o) => [o.nodeKey, o]));
  for (const row of rows) {
    const parts = String(row.node_key).split('.');
    for (let i = parts.length; i > 0; i--) {
      const k = parts.slice(0, i).join('.');
      if (primaries.has(k)) {
        if (!byObjectiveNode.has(k)) byObjectiveNode.set(k, []);
        byObjectiveNode.get(k)!.push(row);
      }
    }
  }
  const out = new Map<string, ExamPreparationCapabilities>();
  for (const o of objectives) {
    const entries = (byObjectiveNode.get(o.nodeKey) ?? []).filter((row) => inObjective(o, row.node_key)).map((row) => toEntry(row, language));
    const mappings = o.configKeys.reduce((a, k) => a + (bridge.get(k) ?? 0), 0);
    out.set(o.key, computeCapabilities(o, entries, mappings));
  }
  return out;
}

export async function objectiveCapabilities(o: ExamObjective, language = 'es'): Promise<ExamPreparationCapabilities> {
  const [nodes, bridge] = await Promise.all([
    db.query(
      `SELECT node_key, node_type, label, labels, selectable, metadata, exam_version_id, assessment_component_id FROM assessment_structure_nodes
        WHERE status = 'ACTIVE' AND (node_key = $1 OR node_key LIKE $2)`,
      [o.nodeKey, `${o.nodeKey.replace(/[%_]/g, (c) => `\\${c}`)}.%`]
    ),
    bridgeMappingsByConfig(o.configKeys),
  ]);
  const mappings = o.configKeys.reduce((a, k) => a + (bridge.get(k) ?? 0), 0);
  const rows = await applyBankReadinessOverlay(nodes.rows as any[]);
  return computeCapabilities(o, rows.map((row: any) => toEntry(row, language)), mappings);
}

// ---------------------------------------------------------------- profiles

/** The objective a profile targets: its objective key, else the objective of its exam definition (legacy / instance-created). */
export async function profileObjective(profile: Pick<StudentExamProfile, 'objectiveKey' | 'examDefinitionId'>): Promise<ExamObjective | null> {
  if (profile.objectiveKey) return objectiveByKey(profile.objectiveKey);
  if (!profile.examDefinitionId) return null;
  const d = (await db.query(`SELECT config_key FROM exam_definitions WHERE id = $1`, [profile.examDefinitionId])).rows[0];
  return d?.config_key ? objectiveForConfig(d.config_key) : null;
}

async function startableDefinition(o: ExamObjective): Promise<{ definitionId: string; versionId: string } | null> {
  // Only when the objective is ONE configured exam (PAA, PISA, an IB / Cambridge subject level).
  if (o.configKeys.length !== 1) return null;
  const r = await db.query(
    `SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d
       JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
      WHERE d.config_key = $1 AND d.status = 'ACTIVE' ORDER BY v.created_at DESC LIMIT 1`,
    [o.configKeys[0]]
  );
  return r.rows[0] ? { definitionId: r.rows[0].definition_id, versionId: r.rows[0].version_id } : null;
}

export interface CreatePreparationInput {
  objectiveKey: string;
  examDate?: string;
  purpose?: string;
  targetInstitutionName?: string;
  targetQualification?: string;
  timezone?: string;
  source?: 'STUDENT' | 'INSTITUTION';
}

export async function createObjectivePreparation(studentId: string, input: CreatePreparationInput): Promise<{ profile: StudentExamProfile; created: boolean; capabilities: ExamPreparationCapabilities }> {
  const o = objectiveByKey(input.objectiveKey);
  if (!o) throw new PreparationError('OBJECTIVE_NOT_FOUND');
  const [def, node, capabilities, eligibility] = await Promise.all([
    startableDefinition(o),
    db.query(`SELECT id FROM assessment_structure_nodes WHERE node_key = $1 AND status = 'ACTIVE'`, [o.nodeKey]),
    objectiveCapabilities(o),
    objectiveEligibilityForStudent(studentId, o),
  ]);
  // Exam eligibility is recorded, never enforced: a Student may still choose an unrelated objective on purpose (personal goal).
  const assigned = eligibility.reasons.some((r) => r.code === 'INSTITUTION_ASSIGNED');
  const eligibilityContext = { recommended: eligibility.eligible, reasons: [...new Set(eligibility.reasons.map((r) => r.code))] };
  const before = (await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' AND (objective_key = $2 OR ($3::uuid IS NOT NULL AND exam_definition_id = $3))`, [studentId, o.key, def?.definitionId ?? null])).rows[0];
  const profile = await createStudentExamProfile({
    studentId,
    examDefinitionId: def?.definitionId ?? null,
    examVersionId: def?.versionId,
    objectiveKey: o.key,
    objectiveFramework: o.framework,
    objectiveNodeId: node.rows[0]?.id ?? null,
    objectiveContext: { label: o.label, ...o.context, eligibility: eligibilityContext },
    examDate: input.examDate,
    purpose: input.purpose,
    targetInstitutionName: input.targetInstitutionName,
    targetQualification: input.targetQualification,
    programmeContext: o.context.programme ?? undefined,
    subjectFocus: o.context.subject ?? undefined,
    timezone: input.timezone,
    source: input.source ?? (assigned ? 'INSTITUTION' : 'STUDENT'),
  });
  // A preparation that existed for the same exam before objectives (legacy / created from an instance) is ADOPTED.
  if (!profile.objectiveKey) {
    await db.query(
      `UPDATE student_exam_profiles SET objective_key = $2, objective_framework = $3, objective_node_id = COALESCE(objective_node_id, $4), objective_context = COALESCE(objective_context, $5), updated_at = now()
        WHERE id = $1 AND objective_key IS NULL`,
      [profile.id, o.key, o.framework, node.rows[0]?.id ?? null, JSON.stringify({ label: o.label, ...o.context })]
    );
  }
  const created = !before;
  if (created) {
    // Demand telemetry: which objectives Students choose, and what StudyUs could offer at that moment. No personal data beyond the event's own student row.
    await track(studentId, 'exam_objective_selected', {
      objectiveKey: o.key,
      framework: o.framework,
      subject: o.context.subject,
      level: o.context.level,
      version: o.context.version,
      readiness: capabilities.readiness,
      status: objectiveStatusKey(capabilities),
      practiceAvailable: capabilities.canPractice,
      mockAvailable: capabilities.canRunReducedMock || capabilities.canRunFullMock,
      recommended: eligibility.eligible,
      eligibilityReasons: eligibilityContext.reasons,
    });
  }
  return { profile: (await getStudentExamProfile(profile.id))!, created, capabilities };
}

export async function updatePreparationDetails(studentId: string, profileId: string, patch: { examDate?: string | null; targetInstitutionName?: string | null; targetQualification?: string | null; purpose?: string | null }): Promise<StudentExamProfile> {
  const p = await getStudentExamProfile(profileId);
  if (!p || p.studentId !== studentId) throw new PreparationError('NOT_FOUND');
  if (p.status === 'ARCHIVED') throw new PreparationError('NOT_ACTIVE');
  const sets: string[] = [];
  const vals: unknown[] = [profileId];
  const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.examDate !== undefined) set('exam_date', patch.examDate);
  if (patch.targetInstitutionName !== undefined) set('target_institution_name', patch.targetInstitutionName);
  if (patch.targetQualification !== undefined) set('target_qualification', patch.targetQualification);
  if (patch.purpose !== undefined) set('purpose', patch.purpose);
  if (sets.length) await db.query(`UPDATE student_exam_profiles SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  return (await getStudentExamProfile(profileId))!;
}

// ---------------------------------------------------------------- the plan

interface RequirementRow { id: string; code: string; description: string; area: string; items: number }

async function objectiveRequirements(configKeys: string[]): Promise<RequirementRow[]> {
  if (!configKeys.length) return [];
  const r = await db.query(
    `SELECT lo.id, lo.code, lo.description, min(ac.name) AS area, COALESCE(sum(t.target_item_count), 0)::int AS items
       FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
       JOIN assessment_blueprints b ON b.exam_version_id = v.id
       JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
       JOIN learning_objectives lo ON lo.id = t.learning_objective_id
       JOIN assessment_components ac ON ac.id = t.assessment_component_id
      WHERE d.config_key = ANY($1::text[]) AND d.status IN ('ACTIVE', 'DRAFT')
      GROUP BY lo.id, lo.code, lo.description
      ORDER BY min(ac.sequence_order) NULLS LAST, lo.code`,
    [configKeys]
  );
  return r.rows.map((x: any) => ({ id: x.id, code: x.code ?? x.id, description: x.description, area: x.area, items: x.items }));
}

/** Requirement -> canonical concepts (PUBLISHED, reviewed links only). */
async function requirementConcepts(objectiveIds: string[]): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const out = new Map<string, Array<{ id: string; name: string }>>();
  if (!objectiveIds.length) return out;
  const r = await db.query(
    `SELECT m.learning_objective_id, cc.id, cc.name FROM objective_concept_mappings m JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
      WHERE m.learning_objective_id = ANY($1::uuid[]) AND m.status = 'PUBLISHED' ORDER BY cc.name`,
    [objectiveIds]
  );
  for (const x of r.rows as any[]) {
    if (!out.has(x.learning_objective_id)) out.set(x.learning_objective_id, []);
    const list = out.get(x.learning_objective_id)!;
    if (!list.some((c) => c.id === x.id)) list.push({ id: x.id, name: x.name });
  }
  return out;
}

/** The Student's OWN learner state for canonical concepts (read-only; one learner state per canonical concept). */
async function learnerStates(studentId: string, canonicalIds: string[]): Promise<Map<string, LearnerConceptState>> {
  const out = new Map<string, LearnerConceptState>();
  if (!canonicalIds.length) return out;
  const r = await db.query(
    `SELECT DISTINCT ON (ccm.canonical_concept_id) ccm.canonical_concept_id, c.id AS concept_id, c.subject_id,
            ks.mastery_state, ks.validation_readiness, COALESCE(ks.critical_misconception_count, 0) AS critical, COALESCE(ks.evidence_count, 0) AS evidence,
            ms.memory_status, (ms.next_review_at IS NOT NULL AND ms.next_review_at <= now()) AS due
       FROM concepts c JOIN subjects s ON s.id = c.subject_id AND s.student_id = $1
       JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = c.id AND ccm.status = 'MATCHED'
       LEFT JOIN concept_knowledge_state ks ON ks.student_id = $1 AND ks.concept_id = c.id
       LEFT JOIN concept_memory_state ms ON ms.student_id = $1 AND ms.concept_id = c.id
      WHERE ccm.canonical_concept_id = ANY($2::uuid[])
      ORDER BY ccm.canonical_concept_id, ks.updated_at DESC NULLS LAST, c.created_at`,
    [studentId, canonicalIds]
  );
  for (const x of r.rows as any[]) {
    out.set(x.canonical_concept_id, {
      studentConceptId: x.concept_id,
      subjectId: x.subject_id,
      masteryState: x.mastery_state ?? null,
      validationReadiness: x.validation_readiness ?? null,
      memoryStatus: x.memory_status ?? null,
      retentionDue: !!x.due,
      criticalMisconceptions: Number(x.critical),
      evidenceCount: Number(x.evidence),
    });
  }
  return out;
}

const asClass = (c: string): ExamEvidence['classification'] | null => (c === 'STRENGTH' || c === 'DEVELOPING' || c === 'GAP' ? c : null);

/** Latest StudyUs evidence per requirement code in THIS exam, and per canonical concept from OTHER exams (context only). */
async function examEvidence(studentId: string, codes: string[], canonicalIds: string[], configKeys: string[]) {
  const byCode = new Map<string, ExamEvidence>();
  const byConcept = new Map<string, ExamEvidence>();
  if (!codes.length && !canonicalIds.length) return { byCode, byConcept };
  const r = await db.query(
    `SELECT lo.code, o->>'classification' AS cls, r.created_at, d.name AS exam_name, d.config_key,
            COALESCE((SELECT array_agg(m.canonical_concept_id) FROM objective_concept_mappings m WHERE m.learning_objective_id = lo.id AND m.status = 'PUBLISHED'), '{}') AS concepts
       FROM simulation_attempts sa
       JOIN exam_attempt_results r ON r.exam_attempt_id = sa.exam_attempt_id AND r.status = 'SCORED'
       JOIN exam_versions v ON v.id = sa.exam_version_id JOIN exam_definitions d ON d.id = v.exam_definition_id
       CROSS JOIN LATERAL jsonb_array_elements(r.objective_results) o
       JOIN learning_objectives lo ON lo.id = (o->>'learningObjectiveId')::uuid
      WHERE sa.student_id = $1 AND o->>'classification' IN ('STRENGTH', 'DEVELOPING', 'GAP')
        AND (lo.code = ANY($2::text[]) OR EXISTS (SELECT 1 FROM objective_concept_mappings m WHERE m.learning_objective_id = lo.id AND m.status = 'PUBLISHED' AND m.canonical_concept_id = ANY($3::uuid[])))
      ORDER BY r.created_at DESC`,
    [studentId, codes, canonicalIds]
  );
  for (const x of r.rows as any[]) {
    const cls = asClass(x.cls);
    if (!cls) continue;
    const ev: ExamEvidence = { classification: cls, at: new Date(x.created_at).toISOString(), examName: x.exam_name, sameExam: configKeys.includes(x.config_key) };
    if (ev.sameExam && codes.includes(x.code) && !byCode.has(x.code)) byCode.set(x.code, ev);
    // Another exam's result on the same concept: context only (different form of assessment and purpose).
    if (!ev.sameExam) for (const c of x.concepts as string[]) if (!byConcept.has(c)) byConcept.set(c, ev);
  }
  return { byCode, byConcept };
}

/** Other active preparations whose requirements map to the same canonical concepts (real mappings only, never by name). */
async function otherPreparationsByConcept(studentId: string, excludeProfileId: string, canonicalIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!canonicalIds.length) return out;
  const others = (await db.query(`SELECT id, objective_key, exam_definition_id FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' AND id <> $2`, [studentId, excludeProfileId])).rows;
  for (const p of others) {
    const o = await profileObjective({ objectiveKey: p.objective_key, examDefinitionId: p.exam_definition_id });
    if (!o || !o.configKeys.length) continue;
    const r = await db.query(
      `SELECT DISTINCT m.canonical_concept_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
         JOIN assessment_blueprints b ON b.exam_version_id = v.id JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
         JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
        WHERE d.config_key = ANY($1::text[]) AND m.canonical_concept_id = ANY($2::uuid[])`,
      [o.configKeys, canonicalIds]
    );
    for (const x of r.rows as any[]) {
      if (!out.has(x.canonical_concept_id)) out.set(x.canonical_concept_id, []);
      if (!out.get(x.canonical_concept_id)!.includes(o.label)) out.get(x.canonical_concept_id)!.push(o.label);
    }
  }
  return out;
}

export async function buildProfilePlan(studentId: string, profile: StudentExamProfile, objective: ExamObjective, caps: ExamPreparationCapabilities): Promise<PreparationPlan | null> {
  const reqs = await objectiveRequirements(objective.configKeys);
  // Catalogue only: no governed requirements -- nothing is invented to fill the plan.
  if (!reqs.length) return null;
  const conceptsByReq = await requirementConcepts(reqs.map((r) => r.id));
  const canonicalIds = [...new Set([...conceptsByReq.values()].flat().map((c) => c.id))];
  const [learner, evidence, also] = await Promise.all([
    learnerStates(studentId, canonicalIds),
    examEvidence(studentId, reqs.map((r) => r.code), canonicalIds, objective.configKeys),
    otherPreparationsByConcept(studentId, profile.id, canonicalIds),
  ]);
  const totalItems = reqs.reduce((a, r) => a + r.items, 0);
  const inputs: RequirementInput[] = reqs.map((r) => ({
    learningObjectiveId: r.id,
    code: r.code,
    description: r.description,
    area: r.area,
    weight: totalItems ? r.items / totalItems : 1 / reqs.length,
    ownEvidence: evidence.byCode.get(r.code) ?? null,
    concepts: (conceptsByReq.get(r.id) ?? []).map((c) => ({
      canonicalConceptId: c.id,
      name: c.name,
      learner: learner.get(c.id) ?? null,
      examEvidence: evidence.byConcept.get(c.id) ?? null,
      alsoRelevantFor: also.get(c.id) ?? [],
    })),
  }));
  const todayIso = new Date().toISOString().slice(0, 10);
  return buildPreparationPlan(inputs, { examDaysLeft: profile.examDate ? calendarDaysUntil(profile.examDate, todayIso) : null, canPractice: caps.canPractice, canRunDiagnostic: caps.canRunDiagnostic });
}

export interface PreparationView {
  profile: StudentExamProfile;
  objective: ExamObjective;
  capabilities: ExamPreparationCapabilities;
  plan: PreparationPlan | null;
  next: ReturnType<typeof nextStep>;
  openAttemptId: string | null;
  diagnostic: { instanceId: string; status: string } | null;
}

export async function getPreparationView(studentId: string, profileId: string, language = 'es'): Promise<PreparationView | null> {
  const profile = await getStudentExamProfile(profileId);
  if (!profile || profile.studentId !== studentId) return null;
  const objective = await profileObjective(profile);
  if (!objective) return null;
  const capabilities = await objectiveCapabilities(objective, language);
  const [plan, open, diag] = await Promise.all([
    buildProfilePlan(studentId, profile, objective, capabilities),
    findOpenSimulationAttemptForProfile(profile.id),
    db.query(`SELECT id, status FROM exam_instances WHERE exam_profile_id = $1 AND purpose = 'DIAGNOSTIC' AND status <> 'DELETED' ORDER BY created_at DESC LIMIT 1`, [profile.id]),
  ]);
  const diagnostic = diag.rows[0] ? { instanceId: diag.rows[0].id, status: diag.rows[0].status } : null;
  const next = nextStep({
    openAttemptId: open?.id ?? null,
    plan,
    canPractice: capabilities.canPractice,
    canRunDiagnostic: capabilities.canRunDiagnostic,
    diagnosticDone: !!diagnostic,
    canViewStructure: capabilities.canViewStructure,
    canPlanDiploma: capabilities.canPlanDiploma,
    hasExamDate: !!profile.examDate,
  });
  return { profile, objective, capabilities, plan, next, openAttemptId: open?.id ?? null, diagnostic };
}

// ---------------------------------------------------------------- activities from the preparation

async function activeOwnedProfile(studentId: string, profileId: string) {
  const profile = await getStudentExamProfile(profileId);
  if (!profile || profile.studentId !== studentId) throw new PreparationError('NOT_FOUND');
  if (profile.status === 'ARCHIVED') throw new PreparationError('NOT_ACTIVE');
  const objective = await profileObjective(profile);
  if (!objective) throw new PreparationError('NOT_FOUND');
  return { profile, objective };
}

/**
 * "Diagnosticar mi preparación": a PRACTICE instance over every practice-ready
 * area of the objective's exam (a sample of the major areas, never a full
 * curriculum walk). Server-authoritative: readiness is read from the persisted
 * catalogue; a profile whose objective cannot practise gets CAPABILITY_NOT_AVAILABLE.
 */
export async function startPreparationDiagnostic(studentId: string, profileId: string) {
  const { profile, objective } = await activeOwnedProfile(studentId, profileId);
  const caps = await objectiveCapabilities(objective);
  if (!caps.canRunDiagnostic) throw new PreparationError('CAPABILITY_NOT_AVAILABLE', 'DIAGNOSTIC');
  // Double click / parallel retry: one diagnostic per preparation at a time. A TRANSACTION-scoped
  // advisory lock pinned to one connection (safe behind Neon's transaction pooler, with a lock
  // timeout); a session-level lock/unlock pair can orphan the lock there and hang the retry.
  const lock = await acquireLaunchLock(`exam-prep-diagnostic:${profile.id}`);
  try {
    return await createOrResumeDiagnostic(profile, objective);
  } finally {
    await lock.release();
  }
}

async function createOrResumeDiagnostic(profile: StudentExamProfile, objective: ExamObjective) {
  const studentId = profile.studentId;
  // An unfinished diagnostic is resumed, never duplicated (retry / double click).
  const existing = (await db.query(`SELECT * FROM exam_instances WHERE exam_profile_id = $1 AND purpose = 'DIAGNOSTIC' AND status IN ('DRAFT', 'READY', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1`, [profile.id])).rows[0];
  if (existing) {
    const { getExamInstance } = await import('../exam-instance.service');
    const inst = await getExamInstance(existing.id);
    return { instanceId: existing.id as string, reused: true, instance: inst ? await toInstanceView(inst) : null };
  }
  const rows = (
    await db.query(
      `SELECT n.exam_version_id, n.metadata, d.id AS definition_id FROM assessment_structure_nodes n
         JOIN exam_definitions d ON d.id = n.exam_definition_id AND d.status = 'ACTIVE'
        WHERE n.status = 'ACTIVE' AND n.selectable = true AND n.exam_version_id IS NOT NULL AND (n.node_key = $1 OR n.node_key LIKE $2)`,
      [objective.nodeKey, `${objective.nodeKey}.%`]
    )
  ).rows as any[];
  // Practice-ready components per version, from the persisted readiness.
  const byVersion = new Map<string, { definitionId: string; sections: Set<string> }>();
  for (const r of rows) {
    for (const c of (r.metadata?.readiness?.components ?? []) as Array<{ sectionKey: string; state: ReadinessState }>) {
      if (!['PRACTICE_READY', 'REDUCED_MOCK_READY', 'FULL_MOCK_READY'].includes(c.state)) continue;
      if (!byVersion.has(r.exam_version_id)) byVersion.set(r.exam_version_id, { definitionId: r.definition_id, sections: new Set() });
      byVersion.get(r.exam_version_id)!.sections.add(c.sectionKey);
    }
  }
  const best = [...byVersion.entries()].sort((a, b) => b[1].sections.size - a[1].sections.size)[0];
  if (!best) throw new PreparationError('CAPABILITY_NOT_AVAILABLE', 'DIAGNOSTIC');
  const [versionId, { definitionId, sections }] = best;
  const comps = (await db.query(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND section_key = ANY($2::text[]) AND simulation_capable = true ORDER BY sequence_order NULLS LAST`, [versionId, [...sections]])).rows.map((x: any) => x.id as string);
  if (!comps.length) throw new PreparationError('CAPABILITY_NOT_AVAILABLE', 'DIAGNOSTIC');
  // The preparation now names its exam (it may have been chosen as catalogue only before the exam was published).
  await db.query(`UPDATE student_exam_profiles SET exam_definition_id = COALESCE(exam_definition_id, $2), exam_version_id = COALESCE(exam_version_id, $3) WHERE id = $1`, [profile.id, definitionId, versionId]);
  const instance = await createExamInstance({ studentId, examProfileId: profile.id, examVersionId: versionId, componentIds: comps, mode: 'PRACTICE', practiceLevel: 'STANDARD', timingMode: 'UNTIMED' });
  await db.query(`UPDATE exam_instances SET purpose = 'DIAGNOSTIC' WHERE id = $1`, [instance.id]);
  return { instanceId: instance.id, reused: false, instance: await toInstanceView(instance) };
}

/**
 * "Añadir a mi plan" from the preparation plan. Only a requirement OF THIS
 * preparation and one of its PUBLISHED concept links are accepted; the concept
 * joins the Student's own learning (or is reused as it is) -- the same learner
 * state whatever exam it came from.
 */
export async function addConceptFromPreparation(studentId: string, profileId: string, p: { learningObjectiveId: string; canonicalConceptId: string; language: string }) {
  const { profile, objective } = await activeOwnedProfile(studentId, profileId);
  const ok = await db.query(
    `SELECT 1 FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
       JOIN assessment_blueprints b ON b.exam_version_id = v.id JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
       JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
      WHERE d.config_key = ANY($1::text[]) AND t.learning_objective_id = $2::uuid AND m.canonical_concept_id = $3::uuid LIMIT 1`,
    [objective.configKeys, p.learningObjectiveId, p.canonicalConceptId]
  );
  if (!ok.rows.length) throw new PreparationError('REQUIREMENT_NOT_IN_PREPARATION');
  const added = await addConceptToStudentLearning(studentId, p.canonicalConceptId, p.language);
  const link = await db.query(
    `INSERT INTO exam_gap_concept_links (student_id, canonical_concept_id, student_concept_id, learning_objective_id, exam_profile_id, source)
     VALUES ($1, $2, $3, $4, $5, 'EXAM_PREPARATION') ON CONFLICT (student_id, canonical_concept_id) DO NOTHING RETURNING id`,
    [studentId, p.canonicalConceptId, added.studentConceptId, p.learningObjectiveId, profile.id]
  );
  if (!added.existed || link.rows.length) {
    // Same orchestration signal as the exam bridge: the ONE Personal Learning Plan picks the concept up.
    const { notifyLearningOrchestrationChange } = await import('@/services/learning-plan-orchestration-trigger');
    await notifyLearningOrchestrationChange(studentId, 'ASSESSMENT_CHANGED');
  }
  return { studentConceptId: added.studentConceptId, subjectId: added.subjectId, alreadyStudying: added.existed, href: `/dashboard/subjects/${added.subjectId}/concepts/${added.studentConceptId}` };
}
