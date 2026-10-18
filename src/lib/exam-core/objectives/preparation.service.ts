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
import { readinessMode } from '@/lib/exam-core/question-bank/capability-overlay.service';
import { engineReadinessForVersion } from '@/lib/exam-bank/readiness/readiness-authority.service';
import { technicalExamAttemptSql } from '../audience';
import { examAttemptEvidenceSql, inExamScopeSql } from '../evidence-scope';
import { readinessFor, selectableSql } from '../catalog/readiness-view';
import { db } from '@/lib/db';
import { track } from '@/lib/analytics';
import { createStudentExamProfile, getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import type { StudentExamProfile } from '@/lib/assessment/types';
import { findOpenSimulationAttemptForProfile } from '@/lib/simulation/attempt.service';
import { calendarDaysUntil } from '@/lib/experience/goal';
import { acceptExamSession, objectiveSessionModel, storedExamSession } from './objective-session';
import { normalizeInterestArea } from '@/lib/student/interest-areas';
import { canonicalConceptLabels } from '@/lib/learning-plan/labels';
import { learningObjectiveLabel } from '../catalog/objective-localization';
import { presentObjective } from './objective-display';
import { READINESS_ORDER, type ReadinessState, type ComponentReadiness } from '../catalog/readiness';
import { addConceptToStudentLearning } from '../catalog/learning-links.service';
import { createExamInstance, toInstanceView } from '../exam-instance.service';
import { examObjectives, objectiveByKey, objectiveForConfig, type ExamObjective } from './objective-catalog';
import { isObjectiveExposed } from '../student-exposure';
import { computeCapabilities, objectiveStatusKey, type ExamPreparationCapabilities, type ObjectiveEntry, restrictByReadinessEngine, type EngineModeVerdicts } from './capabilities';
import { buildPreparationPlan, nextStep, type ExamEvidence, type LearnerConceptState, type PreparationPlan, type RequirementInput, examReadinessEvidenceOf, type ExamReadinessCellSummary, type StoredReadinessProjection } from './preparation-plan';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import type { OverallReadinessStatus, ReadinessSnapshot } from '@/lib/readiness/types';
import { applyBankReadinessOverlay } from '../question-bank/capability-overlay.service';
import { acquireLaunchLock } from '@/services/activity-launch-lock.service';
import { objectiveEligibilityForStudent } from '../eligibility/eligibility.service';
import { cambridgeFlowObjectiveKeys } from '../cambridge/school-subject-map';
import { parseFreeze } from '../cambridge/creation-flow';

/** FD Cambridge §16: objectives of the Cambridge school flow are created only through it (it freezes the target). */
const CAMBRIDGE_FLOW_OBJECTIVES = new Set(cambridgeFlowObjectiveKeys());

export class PreparationError extends Error {
  constructor(public readonly code: 'OBJECTIVE_NOT_FOUND' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'CAPABILITY_NOT_AVAILABLE' | 'REQUIREMENT_NOT_IN_PREPARATION' | 'IN_PROGRESS' | 'INVALID_EXAM_SESSION' | 'INVALID_INTEREST_AREA' | 'CAMBRIDGE_CREATION_FLOW_REQUIRED' | 'SERIES_CHANGE_FLOW_REQUIRED', detail?: string) {
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
    examVersionId: row.exam_version_id ?? null,
    mockAttemptType: r.mockAttemptType === 'REDUCED_MOCK' || r.mockAttemptType === 'FULL_MOCK' || r.mockAttemptType === 'PREPARATION_MOCK' ? r.mockAttemptType : null,
  };
}

/** The persisted catalogue entries inside an objective (its primary node and descendants). */
const inObjective = (o: ExamObjective, key: string) => key === o.nodeKey || key.startsWith(`${o.nodeKey}.`);

async function bridgeMappingsByConfig(configKeys: string[]): Promise<Map<string, number>> {
  if (!configKeys.length) return new Map();
  const r = await db.query(
    `SELECT d.config_key, count(DISTINCT m.id)::int AS n
       FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
       JOIN assessment_blueprints b ON b.exam_version_id = v.id AND b.purpose IS NULL
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

/**
 * The exam definition + published version a NEW preparation is bound to, when the objective names one exam.
 *
 * C13-P1-01: a TEST objective (the whole test is the objective: PAA) may be bound to several governed FORMS of that one
 * exam (PAA: v2.paa -- practice + reduced mock -- and v2.paa-full-length). It used to require exactly one config key, so
 * a PAA preparation was created with no definition and no version until its first attempt filled them. Now such an
 * objective is bound to its first catalogue form that has a published version, provided every form is the same exam
 * family. A subject level with several exams (IB History SL + HL) is not one exam: it stays unbound, as before.
 * What the preparation OFFERS never depends on this choice (see preparation-availability.ts).
 */
export interface StartableDefinitionRow { config_key: string; exam_family: string | null; definition_id: string; version_id: string }
export function pickStartableDefinition(o: Pick<ExamObjective, 'kind' | 'configKeys'>, rows: readonly StartableDefinitionRow[]): { definitionId: string; versionId: string } | null {
  const of = (row: StartableDefinitionRow | undefined) => (row ? { definitionId: row.definition_id, versionId: row.version_id } : null);
  if (o.configKeys.length === 1) return of(rows.find((r) => r.config_key === o.configKeys[0]));
  if (o.configKeys.length === 0 || o.kind !== 'EXAM') return null;
  const families = new Set(rows.map((r) => r.exam_family));
  if (rows.length === 0 || families.size !== 1 || families.has(null)) return null;
  for (const k of o.configKeys) {
    const row = rows.find((r) => r.config_key === k);
    if (row) return of(row);
  }
  return null;
}

async function startableDefinition(o: ExamObjective): Promise<{ definitionId: string; versionId: string } | null> {
  if (!o.configKeys.length || (o.configKeys.length > 1 && o.kind !== 'EXAM')) return null;
  // the latest PUBLISHED version of each ACTIVE definition of the objective's config keys
  const r = await db.query(
    `SELECT DISTINCT ON (d.config_key) d.config_key, d.exam_family, d.id AS definition_id, v.id AS version_id FROM exam_definitions d
       JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
      WHERE d.config_key = ANY($1::text[]) AND d.status = 'ACTIVE' ORDER BY d.config_key, v.created_at DESC`,
    [o.configKeys]
  );
  return pickStartableDefinition(o, r.rows as StartableDefinitionRow[]);
}

export interface CreatePreparationInput {
  objectiveKey: string;
  examDate?: string;
  purpose?: string;
  targetInstitutionName?: string;
  targetQualification?: string;
  timezone?: string;
  source?: 'STUDENT' | 'INSTITUTION';
  /** Set only by the Cambridge creation flow (cambridge/creation.service.ts); never accepted from a request body. */
  viaCambridgeFlow?: boolean;
}

export async function createObjectivePreparation(studentId: string, input: CreatePreparationInput): Promise<{ profile: StudentExamProfile; created: boolean; capabilities: ExamPreparationCapabilities }> {
  const o = objectiveByKey(input.objectiveKey);
  // Pilot exposure: an objective hidden from Students is not created (existing preparations stay readable).
  if (!o || !isObjectiveExposed(o)) throw new PreparationError('OBJECTIVE_NOT_FOUND');
  // FD Cambridge §16: programme -> subject -> tier -> year -> series, then a frozen target -- never a bare objective.
  if (!input.viaCambridgeFlow && CAMBRIDGE_FLOW_OBJECTIVES.has(o.key)) throw new PreparationError('CAMBRIDGE_CREATION_FLOW_REQUIRED');
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

/** The Student's country of study when their personal profile states one (read-only; null otherwise). */
export async function studentCountryOfStudy(studentId: string): Promise<string | null> {
  const r = await db.query(`SELECT country_of_study FROM student_academic_profile WHERE student_id = $1`, [studentId]).catch(() => ({ rows: [] as any[] }));
  return r.rows[0]?.country_of_study ?? null;
}

export async function updatePreparationDetails(
  studentId: string,
  profileId: string,
  patch: {
    examDate?: string | null;
    targetInstitutionName?: string | null;
    targetQualification?: string | null;
    purpose?: string | null;
    /** T1 final delta (C): "ES:<SERIES>:<YEAR>" from the governed session catalogue, or null to clear. */
    examSession?: string | null;
    /** T1 final delta (D): canonical interest-area ID (+ optional detail for OTHER), or null to clear. */
    interestArea?: string | null;
    interestAreaDetail?: string | null;
  },
  now: Date = new Date()
): Promise<StudentExamProfile> {
  const p = await getStudentExamProfile(profileId);
  if (!p || p.studentId !== studentId) throw new PreparationError('NOT_FOUND');
  if (p.status === 'ARCHIVED') throw new PreparationError('NOT_ACTIVE');
  const sets: string[] = [];
  const vals: unknown[] = [profileId];
  const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  const frozen = parseFreeze(p.objectiveContext?.cambridgeFreeze);
  if (patch.examSession !== undefined && frozen) {
    // FD Cambridge §18: a frozen series changes only through the explicit, audited series change (POST .../series).
    // Re-sending the frozen value is not a change.
    if (patch.examSession !== `ES:${frozen.examSeries}:${frozen.examYear}`) throw new PreparationError('SERIES_CHANGE_FLOW_REQUIRED');
  } else if (patch.examSession !== undefined) {
    if (patch.examSession === null) {
      set('target_exam_series', null);
      set('target_exam_year', null);
    } else {
      // Only a series the governed catalogue offers for THIS objective (programme / syllabus / region / year).
      const objective = await profileObjective(p);
      const model = objective ? objectiveSessionModel(objective, await studentCountryOfStudy(studentId)) : null;
      const accepted = model ? acceptExamSession(patch.examSession, model, now, storedExamSession(p)) : null;
      if (!accepted) throw new PreparationError('INVALID_EXAM_SESSION');
      set('target_exam_series', accepted.series);
      set('target_exam_year', accepted.year);
    }
  }
  if (patch.interestArea !== undefined) {
    const area = normalizeInterestArea(patch.interestArea, patch.interestAreaDetail);
    if (!area) throw new PreparationError('INVALID_INTEREST_AREA');
    set('interest_area', area.interestArea);
    set('interest_area_detail', area.interestAreaDetail);
  }
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
       JOIN assessment_blueprints b ON b.exam_version_id = v.id AND b.purpose IS NULL
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

/**
 * The Student's OWN learner state for canonical concepts (read-only; one learner state per canonical concept).
 * G6: plus the concept's evidence split by the exam scope of `examTargetId` (longitudinal + this target's
 * attempts vs another target's / unscoped legacy attempts) -- the Knowledge State itself is not touched.
 */
async function learnerStates(studentId: string, canonicalIds: string[], examTargetId: string): Promise<Map<string, LearnerConceptState>> {
  const out = new Map<string, LearnerConceptState>();
  if (!canonicalIds.length) return out;
  const r = await db.query(
    `SELECT DISTINCT ON (ccm.canonical_concept_id) ccm.canonical_concept_id, c.id AS concept_id, c.subject_id,
            ks.mastery_state, ks.validation_readiness, COALESCE(ks.critical_misconception_count, 0) AS critical, COALESCE(ks.evidence_count, 0) AS evidence,
            ms.memory_status, (ms.next_review_at IS NOT NULL AND ms.next_review_at <= now()) AS due,
            ev.in_scope, ev.out_of_scope_exam
       FROM concepts c JOIN subjects s ON s.id = c.subject_id AND s.student_id = $1
       JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = c.id AND ccm.status = 'MATCHED'
       LEFT JOIN concept_knowledge_state ks ON ks.student_id = $1 AND ks.concept_id = c.id
       LEFT JOIN concept_memory_state ms ON ms.student_id = $1 AND ms.concept_id = c.id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE ${inExamScopeSql('le', '$3')})::int AS in_scope,
                count(*) FILTER (WHERE ${examAttemptEvidenceSql('le')} AND NOT ${inExamScopeSql('le', '$3')})::int AS out_of_scope_exam
           FROM learning_evidence le WHERE le.student_id = $1 AND le.concept_id = c.id
       ) ev ON true
      WHERE ccm.canonical_concept_id = ANY($2::uuid[])
      ORDER BY ccm.canonical_concept_id, ks.updated_at DESC NULLS LAST, c.created_at`,
    [studentId, canonicalIds, examTargetId]
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
      examScope: { inScopeEvidence: Number(x.in_scope ?? 0), outOfScopeExamEvidence: Number(x.out_of_scope_exam ?? 0) },
    });
  }
  return out;
}

const asClass = (c: string): ExamEvidence['classification'] | null => (c === 'STRENGTH' || c === 'DEVELOPING' || c === 'GAP' ? c : null);

/**
 * Latest StudyUs evidence per requirement code for THIS exam target, and per canonical concept from OTHER
 * targets (context only). G6: "own" is decided by the attempt's own target (simulation_attempts.exam_profile_id),
 * never by a shared code, concept or exam family.
 *
 * C13-P1-02: a scored result classifies EVERY blueprint objective, the unanswered ones included (earned 0 of the
 * objective's available points -> "GAP"). An objective nobody answered is not evidence: only objectives with at least
 * one scored response in that attempt count. And an attempt that wrote Exam Readiness evidence is read through Exam
 * Readiness (E-1, `examReadinessByConcept`) -- its per-objective result is never this target's own signal; it is used
 * only for a legacy attempt recorded before Exam Readiness existed.
 */
async function examEvidence(studentId: string, codes: string[], canonicalIds: string[], examTargetId: string, readinessAttemptIds: ReadonlySet<string>) {
  const byCode = new Map<string, ExamEvidence>();
  const byConcept = new Map<string, ExamEvidence>();
  if (!codes.length && !canonicalIds.length) return { byCode, byConcept };
  const r = await db.query(
    `SELECT lo.code, o->>'classification' AS cls, r.created_at, d.name AS exam_name, (sa.exam_profile_id = $4::uuid) AS own_target, sa.exam_attempt_id,
            COALESCE((SELECT array_agg(m.canonical_concept_id) FROM objective_concept_mappings m WHERE m.learning_objective_id = lo.id AND m.status = 'PUBLISHED'), '{}') AS concepts
       FROM simulation_attempts sa
       JOIN exam_attempt_results r ON r.exam_attempt_id = sa.exam_attempt_id AND r.status = 'SCORED'
       JOIN exam_versions v ON v.id = sa.exam_version_id JOIN exam_definitions d ON d.id = v.exam_definition_id
       CROSS JOIN LATERAL jsonb_array_elements(r.objective_results) o
       JOIN learning_objectives lo ON lo.id = (o->>'learningObjectiveId')::uuid
      WHERE sa.student_id = $1 AND o->>'classification' IN ('STRENGTH', 'DEVELOPING', 'GAP') AND NOT ${technicalExamAttemptSql('sa.exam_attempt_id')}
        AND EXISTS (SELECT 1 FROM exam_attempt_item_responses ir WHERE ir.exam_attempt_id = sa.exam_attempt_id AND ir.learning_objective_id = lo.id AND ir.score IS NOT NULL AND ir.max_score > 0)
        AND (lo.code = ANY($2::text[]) OR EXISTS (SELECT 1 FROM objective_concept_mappings m WHERE m.learning_objective_id = lo.id AND m.status = 'PUBLISHED' AND m.canonical_concept_id = ANY($3::uuid[])))
      ORDER BY r.created_at DESC`,
    [studentId, codes, canonicalIds, examTargetId]
  );
  for (const x of r.rows as any[]) {
    const cls = asClass(x.cls);
    if (!cls) continue;
    const ev: ExamEvidence = { classification: cls, at: new Date(x.created_at).toISOString(), examName: x.exam_name, sameExam: x.own_target === true };
    if (ev.sameExam && codes.includes(x.code) && !byCode.has(x.code) && !readinessAttemptIds.has(x.exam_attempt_id)) byCode.set(x.code, ev);
    // Another exam's result on the same concept: context only (different form of assessment and purpose).
    if (!ev.sameExam) for (const c of x.concepts as string[]) if (!byConcept.has(c)) byConcept.set(c, ev);
  }
  return { byCode, byConcept };
}

/**
 * E-1: this exam target's Exam Readiness per canonical concept (exam_readiness_evidence; independent scored responses).
 * Absent table (an older database) = no readiness signal, never an error.
 */
async function examReadinessByConcept(studentId: string, canonicalIds: string[], examTargetId: string): Promise<Map<string, ExamReadinessCellSummary>> {
  const out = new Map<string, ExamReadinessCellSummary>();
  if (!canonicalIds.length) return out;
  try {
    const r = await db.query(
      `SELECT canonical_concept_id, count(*) FILTER (WHERE independent)::int AS n, avg(fraction) FILTER (WHERE independent) AS mean, max(occurred_at) AS last_at
         FROM exam_readiness_evidence WHERE student_id = $1 AND exam_target_id = $2::uuid AND canonical_concept_id = ANY($3::uuid[])
        GROUP BY canonical_concept_id`,
      [studentId, examTargetId, canonicalIds],
    );
    for (const x of r.rows as any[]) out.set(x.canonical_concept_id, { canonicalConceptId: x.canonical_concept_id, independentAttempts: Number(x.n), meanFraction: x.mean === null ? null : Number(x.mean), lastAt: x.last_at ? new Date(x.last_at).toISOString() : null });
  } catch (e) {
    if ((e as { code?: string })?.code !== '42P01') throw e;
  }
  return out;
}

/** Attempts of this exam target that recorded Exam Readiness evidence (E-1). Absent table = none. */
async function examReadinessAttempts(studentId: string, examTargetId: string): Promise<Set<string>> {
  try {
    const r = await db.query(`SELECT DISTINCT exam_attempt_id FROM exam_readiness_evidence WHERE student_id = $1 AND exam_target_id = $2::uuid`, [studentId, examTargetId]);
    return new Set((r.rows as any[]).map((x) => x.exam_attempt_id as string));
  } catch (e) {
    if ((e as { code?: string })?.code !== '42P01') throw e;
    return new Set();
  }
}

/**
 * C13-P1-02: the STORED readiness snapshot of this target (never recomputed here) projected onto requirements:
 * which learning objectives have an evidenced blueprint target and which have a diagnosed one. A snapshot of an exam
 * version that is not one of this preparation's governed forms is stale and not read. C14 integration: a preparation can
 * span several governed forms of one exam (PAA: v2.paa + v2.paa-full-length), and a snapshot is computed for the version
 * of the attempt that completed -- so any of the preparation's form versions is accepted (C13-P1-01 binds a new profile
 * to its first form, which never changes when a later attempt uses another form).
 */
/** Pure: a stored snapshot is this preparation's when its version is one of the preparation's governed forms (or the profile's own version). */
export function snapshotBelongsToPreparation(snapshotVersionId: string, formVersionIds: readonly string[], profileVersionId: string | null): boolean {
  const accepted = new Set([...formVersionIds, ...(profileVersionId ? [profileVersionId] : [])]);
  return accepted.size === 0 || accepted.has(snapshotVersionId);
}
export interface PreparationReadiness { overallStatus: OverallReadinessStatus; calculatedAt: string; diagnosedTargets: number; evidencedTargets: number; totalTargets: number }
async function storedReadinessFor(profile: StudentExamProfile, formVersionIds: readonly string[] = []): Promise<{ summary: PreparationReadiness; projection: StoredReadinessProjection } | null> {
  const snapshot = await getLatestReadinessSnapshot(profile.id).catch(() => null);
  if (!snapshot) return null;
  if (!snapshotBelongsToPreparation(snapshot.examVersionId, formVersionIds, profile.examVersionId ?? null)) return null;
  const targets = snapshot.blueprintCoverage?.targets ?? [];
  const ids = [...new Set(targets.map((t) => t.targetId))];
  const loByTarget = new Map<string, string>();
  if (ids.length) {
    const r = await db.query(`SELECT id, learning_objective_id FROM blueprint_objective_targets WHERE id = ANY($1::uuid[])`, [ids]);
    for (const x of r.rows as any[]) loByTarget.set(x.id, x.learning_objective_id);
  }
  return { summary: readinessSummary(snapshot), projection: projectReadinessSnapshot(snapshot, loByTarget) };
}

export function readinessSummary(s: ReadinessSnapshot): PreparationReadiness {
  const targets = s.blueprintCoverage?.targets ?? [];
  return { overallStatus: s.overallStatus, calculatedAt: s.calculatedAt, diagnosedTargets: targets.filter((t) => !!t.diagnosisId).length, evidencedTargets: s.blueprintCoverage?.supportedAndEvidenced ?? 0, totalTargets: s.blueprintCoverage?.totalTargets ?? targets.length };
}

/** Pure: snapshot targets -> requirement (learning objective) sets. */
export function projectReadinessSnapshot(s: Pick<ReadinessSnapshot, 'overallStatus' | 'blueprintCoverage'>, loByTarget: ReadonlyMap<string, string>): StoredReadinessProjection {
  const evidencedObjectiveIds = new Set<string>();
  const diagnosedObjectiveIds = new Set<string>();
  for (const t of s.blueprintCoverage?.targets ?? []) {
    const lo = loByTarget.get(t.targetId);
    if (!lo) continue;
    if (t.status === 'SUPPORTED_AND_EVIDENCED') evidencedObjectiveIds.add(lo);
    if (t.diagnosisId) diagnosedObjectiveIds.add(lo);
  }
  return { overallStatus: s.overallStatus, evidencedObjectiveIds, diagnosedObjectiveIds };
}

/** The engine's verdicts for a version (ENFORCE only; null = not evaluated: SHADOW, no version, or no governed blueprint). */
async function engineVerdictsFor(examVersionId: string | null): Promise<EngineModeVerdicts | null> {
  if (!examVersionId || readinessMode() !== 'ENFORCE') return null;
  const view = await engineReadinessForVersion(examVersionId).catch(() => null);
  return view ? { anyPractice: Object.values(view.practiceBySection).some((s) => s !== 'NOT_READY'), reducedMock: view.reducedMock, fullMock: view.fullMock } : null;
}

/** R-1 per governed form: each form's entries are restricted by that form's own engine verdict (ENFORCE only). */
export async function restrictByEachFormEngine(caps: ExamPreparationCapabilities, verdictsFor: (examVersionId: string | null) => Promise<EngineModeVerdicts | null> = engineVerdictsFor): Promise<ExamPreparationCapabilities> {
  let out = caps;
  for (const v of caps.formVersionIds ?? []) out = restrictByReadinessEngine(out, await verdictsFor(v), v);
  return out;
}

/** Other active preparations whose requirements map to the same canonical concepts (real mappings only, never by name). */
async function otherPreparationsByConcept(studentId: string, excludeProfileId: string, canonicalIds: string[], language = 'en'): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!canonicalIds.length) return out;
  const others = (await db.query(`SELECT id, objective_key, exam_definition_id FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' AND id <> $2`, [studentId, excludeProfileId])).rows;
  for (const p of others) {
    const o = await profileObjective({ objectiveKey: p.objective_key, examDefinitionId: p.exam_definition_id });
    if (!o || !o.configKeys.length) continue;
    const r = await db.query(
      `SELECT DISTINCT m.canonical_concept_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
         JOIN assessment_blueprints b ON b.exam_version_id = v.id AND b.purpose IS NULL JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
         JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
        WHERE d.config_key = ANY($1::text[]) AND m.canonical_concept_id = ANY($2::uuid[])`,
      [o.configKeys, canonicalIds]
    );
    for (const x of r.rows as any[]) {
      if (!out.has(x.canonical_concept_id)) out.set(x.canonical_concept_id, []);
      const shown = presentObjective(o, language).label;
      if (!out.get(x.canonical_concept_id)!.includes(shown)) out.get(x.canonical_concept_id)!.push(shown);
    }
  }
  return out;
}

export async function buildProfilePlan(
  studentId: string,
  profile: StudentExamProfile,
  objective: ExamObjective,
  caps: ExamPreparationCapabilities,
  language = 'en',
  readinessProjection: StoredReadinessProjection | null = null
): Promise<PreparationPlan | null> {
  const reqs = await objectiveRequirements(objective.configKeys);
  // Catalogue only: no governed requirements -- nothing is invented to fill the plan.
  if (!reqs.length) return null;
  const conceptsByReq = await requirementConcepts(reqs.map((r) => r.id));
  const canonicalIds = [...new Set([...conceptsByReq.values()].flat().map((c) => c.id))];
  // Micro-delta M03: requirement and concept NAMES are catalogue display labels in the reader's language
  // (learning-objective labels by stable code; canonical_concept_localizations). IDs, codes and areas are unchanged.
  const readinessAttemptIds = await examReadinessAttempts(studentId, profile.id);
  const [learner, evidence, also, conceptLabels, readiness] = await Promise.all([
    learnerStates(studentId, canonicalIds, profile.id),
    examEvidence(studentId, reqs.map((r) => r.code), canonicalIds, profile.id, readinessAttemptIds),
    otherPreparationsByConcept(studentId, profile.id, canonicalIds, language),
    canonicalConceptLabels(canonicalIds, language).catch(() => new Map<string, string>()),
    examReadinessByConcept(studentId, canonicalIds, profile.id),
  ]);
  const totalItems = reqs.reduce((a, r) => a + r.items, 0);
  const inputs: RequirementInput[] = reqs.map((r) => ({
    learningObjectiveId: r.id,
    code: r.code,
    description: learningObjectiveLabel(r.code, language) ?? r.description,
    area: r.area,
    weight: totalItems ? r.items / totalItems : 1 / reqs.length,
    // C13-P1-02: this target's Exam Readiness on the requirement's concepts (E-1, the governed rule), else -- only for a
    // legacy attempt without Exam Readiness evidence -- its result on an ANSWERED objective
    ownEvidence: examReadinessEvidenceOf((conceptsByReq.get(r.id) ?? []).flatMap((c) => (readiness.has(c.id) ? [readiness.get(c.id)!] : [])), objective.label) ?? evidence.byCode.get(r.code) ?? null,
    concepts: (conceptsByReq.get(r.id) ?? []).map((c) => ({
      canonicalConceptId: c.id,
      name: conceptLabels.get(c.id) ?? c.name,
      learner: learner.get(c.id) ?? null,
      examEvidence: evidence.byConcept.get(c.id) ?? null,
      alsoRelevantFor: also.get(c.id) ?? [],
    })),
  }));
  const todayIso = new Date().toISOString().slice(0, 10);
  return buildPreparationPlan(inputs, { examDaysLeft: profile.examDate ? calendarDaysUntil(profile.examDate, todayIso) : null, canPractice: caps.canPractice, canRunDiagnostic: caps.canRunDiagnostic, readiness: readinessProjection });
}

export interface PreparationView {
  profile: StudentExamProfile;
  objective: ExamObjective;
  capabilities: ExamPreparationCapabilities;
  plan: PreparationPlan | null;
  /** C13-P1-02: the stored readiness snapshot of this target (overall status as stored), null = none computed yet. */
  readiness: PreparationReadiness | null;
  next: ReturnType<typeof nextStep>;
  openAttemptId: string | null;
  diagnostic: { instanceId: string; status: string } | null;
}

export async function getPreparationView(studentId: string, profileId: string, language = 'es'): Promise<PreparationView | null> {
  const profile = await getStudentExamProfile(profileId);
  if (!profile || profile.studentId !== studentId) return null;
  const objective = await profileObjective(profile);
  if (!objective) return null;
  // R-1: under ENFORCE the Exam Bank Readiness Engine restricts what the catalogue offers (never adds).
  // C13-P1-01: each governed form by ITS OWN engine -- never by the one version the profile happens to name (NULL on a
  // fresh profile until its first attempt), so the preparation offers the same before and after that attempt.
  const capabilities = await restrictByEachFormEngine(await objectiveCapabilities(objective, language));
  const stored = await storedReadinessFor(profile, capabilities.formVersionIds ?? []);
  const [plan, open, diag] = await Promise.all([
    buildProfilePlan(studentId, profile, objective, capabilities, language, stored?.projection ?? null),
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
    // T1 final delta (C): a governed series + year configures the timing as much as a date does.
    hasExamDate: !!profile.examDate || !!storedExamSession(profile),
  });
  return { profile, objective, capabilities, plan, readiness: stored?.summary ?? null, next, openAttemptId: open?.id ?? null, diagnostic };
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
      `SELECT n.node_key, n.selectable, n.assessment_component_id, n.exam_version_id, n.metadata, d.id AS definition_id FROM assessment_structure_nodes n
         JOIN exam_definitions d ON d.id = n.exam_definition_id AND d.status = 'ACTIVE'
        WHERE n.status = 'ACTIVE' AND n.exam_version_id IS NOT NULL AND (n.node_key = $1 OR n.node_key LIKE $2)`,
      [objective.nodeKey, `${objective.nodeKey}.%`]
    )
  ).rows as any[];
  // Practice-ready components per version. The SAME readiness the capability was offered on: the persisted view with
  // the bank-derived overlay (ENFORCE) -- the diagnostic must never read an older readiness than the button that offers it.
  const READY = ['PRACTICE_READY', 'REDUCED_MOCK_READY', 'FULL_MOCK_READY'];
  // exactly as the capability is computed (objectiveCapabilities): the nodes as stored, then the Student's view of
  // them -- the overlay decides what a Student may select; a stored `selectable` from an older readiness model does not
  const overlaid = ((await applyBankReadinessOverlay(rows)) as any[]).filter((r) => r.selectable);
  const byVersion = new Map<string, { definitionId: string; sections: Set<string>; componentIds: Set<string> }>();
  const slotOf = (r: any) => { if (!byVersion.has(r.exam_version_id)) byVersion.set(r.exam_version_id, { definitionId: r.definition_id, sections: new Set(), componentIds: new Set() }); return byVersion.get(r.exam_version_id)!; };
  for (const r of overlaid) {
    const readiness = (r.metadata?.readiness ?? {}) as { state?: ReadinessState; components?: Array<{ sectionKey: string; state: ReadinessState }> };
    for (const c of readiness.components ?? []) if (READY.includes(c.state)) slotOf(r).sections.add(c.sectionKey);
    // a node bound to ONE component whose own (bank-derived) state is practice-ready names that component directly
    if (r.assessment_component_id && readiness.state && READY.includes(readiness.state)) slotOf(r).componentIds.add(r.assessment_component_id as string);
  }
  const best = [...byVersion.entries()].sort((a, b) => (b[1].sections.size + b[1].componentIds.size) - (a[1].sections.size + a[1].componentIds.size))[0];
  if (!best) throw new PreparationError('CAPABILITY_NOT_AVAILABLE', 'DIAGNOSTIC');
  const [versionId, { definitionId, sections, componentIds }] = best;
  const comps = (await db.query(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND (section_key = ANY($2::text[]) OR id = ANY($3::uuid[])) AND simulation_capable = true ORDER BY sequence_order NULLS LAST`, [versionId, [...sections], [...componentIds]])).rows.map((x: any) => x.id as string);
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
       JOIN assessment_blueprints b ON b.exam_version_id = v.id AND b.purpose IS NULL JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
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
