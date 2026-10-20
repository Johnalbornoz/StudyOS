/**
 * READ-ONLY adapter: the Exam Bank and its governance, as they are in a database NOW -> the input contract of the
 * generic Exam Bank Readiness Engine (`evaluateExamBankReadiness`).
 *
 * It reads; it never writes. No publication, no snapshot refresh, no catalogue / card / runtime / evidence change.
 * Every query it issues is a SELECT, and `loadReadinessInput` takes the connection it is given (callers run it inside
 * a READ ONLY transaction: scripts/operations/exam-bank/paa-readiness-shadow.ts).
 *
 * What it maps (each a pure function below, unit-tested without a database):
 *   assessment system / version     exam_versions + exam_definitions
 *   blueprint and bucket demand     blueprint_objective_targets -> the same blueprint cells the bank health uses
 *   certified supply                question_bank_items.lineage_class:
 *                                     CORE_DERIVED     -> the instance's certification state + the DB refusal function
 *                                     PILOT_CERTIFIED  -> exam_bank_pilot_item_certifications + the in-scope function
 *                                     LEGACY           -> LEGACY_UNGOVERNED (no certification record exists)
 *   runtime eligibility             delivery scope + the Question Bank lifecycle / usage axis (`isEligible`)
 *   rights                          instance rights category / refusal; reuse rights of LEGACY rows
 *   response-format / scoring       the stored content shape -> a response format; the runtime capability table
 *   stimulus                        content.stimulus
 *   difficulty calibration          calibration columns -> a DifficultyProfile (a missing index stays null)
 *   depth / Student exposure        computed by the engine; exposure from exam_item_usage, keyed by BANK ITEM
 */
import { itemMatchesCell } from '@/lib/exam-core/question-bank/health';
import { deriveBlueprintCells, type BlueprintCell } from '@/lib/exam-core/question-bank/cells';
import { isEligible, type DeliveryUse, type LifecycleState, type CalibrationConfidence } from '@/lib/exam-core/question-bank/lifecycle';
import { itemDimensionValues } from '@/lib/exam-core/slot-constraints';
import type { BlueprintBucket, ModeRequirements, ReadinessBlueprint, ReadinessInput } from './bank-readiness';
import type { CertificationState, DeliveryScope, RightsStatus, RuntimeCapabilities, SupplyRow } from './certification-state';
import { profileFromAuthoredLevel, type DifficultyProfile } from './difficulty';

export const READINESS_ADAPTER_VERSION = 'exam-bank-readiness-adapter-1';

// ------------------------------------------------------------------------------------------------ formats
export type AdapterResponseFormat =
  | 'SELECTED_RESPONSE' | 'MULTI_SELECT' | 'STRUCTURED_RESPONSE' | 'NUMERIC_ENTRY' | 'MATH_EXPRESSION' | 'MULTI_PART' | 'MULTI_PART_UNKEYED'
  | 'SHORT_TEXT_KEYED' | 'FREE_TEXT_UNKEYED' | 'RUBRIC_ASSESSED' | 'PORTFOLIO' | 'SHORT_RESPONSE_KEYED' | 'UNKNOWN';

/** The response format of a stored bank version, from its shape (the same precedence the Exam Core grader uses). */
export function responseFormatOf(content: any): AdapterResponseFormat {
  if (!content || typeof content !== 'object') return 'UNKNOWN';
  if (content.portfolio) return 'PORTFOLIO';
  if (Array.isArray(content.parts) && content.parts.length > 0) {
    const keyed = content.parts.every((p: any) => (p.answerFormat === 'math' ? !!p.math : p.answerFormat === 'text' ? Array.isArray(p.acceptableAnswers) && p.acceptableAnswers.length > 0 : true));
    return keyed ? 'MULTI_PART' : 'MULTI_PART_UNKEYED';
  }
  // a certified version keeps the system's governed format: an IB SHORT_RESPONSE keyed by the canonical contract
  if (content.itemType === 'SHORT_RESPONSE' && content.math?.responseContract) return 'SHORT_RESPONSE_KEYED';
  if (content.answerFormat === 'single_choice') return 'SELECTED_RESPONSE';
  if (content.answerFormat === 'multi_choice') return 'MULTI_SELECT';
  if (['matching', 'ordering', 'classification'].includes(content.answerFormat)) return 'STRUCTURED_RESPONSE';
  if (content.math) return content.math.kind === 'NUMBER' ? 'NUMERIC_ENTRY' : 'MATH_EXPRESSION';
  if (Array.isArray(content.acceptableAnswers) && content.acceptableAnswers.length > 0) return 'SHORT_TEXT_KEYED';
  if (content.rubric) return 'RUBRIC_ASSESSED';
  return content.answerFormat === 'text' ? 'FREE_TEXT_UNKEYED' : 'UNKNOWN';
}

/**
 * What the running Exam Core can render and score WITHOUT a marker or a model, today. RUBRIC_ASSESSED and
 * FREE_TEXT_UNKEYED are rendered but scored by AI assessors (no governed policy admits that for certified exam
 * content); PORTFOLIO needs a submission flow. They are therefore not scorable for readiness.
 */
export const RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  renderableFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'STRUCTURED_RESPONSE', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'MULTI_PART', 'MULTI_PART_UNKEYED', 'SHORT_TEXT_KEYED', 'SHORT_RESPONSE_KEYED', 'FREE_TEXT_UNKEYED', 'RUBRIC_ASSESSED'],
  scorableFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'STRUCTURED_RESPONSE', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'MULTI_PART', 'SHORT_TEXT_KEYED', 'SHORT_RESPONSE_KEYED'],
  stimulusKinds: ['TEXT_PASSAGE'],
};

// ------------------------------------------------------------------------------------------------ raw rows
/** One bank version as the adapter's SELECT returns it. */
export interface RawSupplyRow {
  id: string;
  learning_objective_id: string;
  question_type: string | null;
  content: any;
  /** The bank version's template fingerprint (wording with numbers masked); absent on older rows. */
  template_fingerprint?: string | null;
  status: string;
  bank_lifecycle_status: string | null;
  usage_eligibility: string[] | null;
  exam_alignment: string | null;
  difficulty_index: string | number | null;
  calibration_confidence: string | null;
  calibration_sample_size: number | null;
  calibrated_at: string | Date | null;
  bank_item_id: string | null;
  lineage_class: string | null;
  retired_at: string | Date | null;
  current_version_id: string | null;
  provenance: string | null;
  // CORE_DERIVED
  inst_state: string | null;
  inst_mode: string | null;
  inst_scopes: string[] | null;
  inst_rights_category: string | null;
  inst_refusal: string | null;
  // PILOT_CERTIFIED
  pilot_state: string | null;
  pilot_revoked: boolean | null;
  pilot_in_scope: boolean | null;
  pilot_deliverable: boolean | null;
  // LEGACY
  legacy_reuse_rights: string | null;
}

const RIGHTS_REFUSALS = new Set(['RIGHTS_NOT_VALID', 'RIGHTS_STATE_NOT_DELIVERABLE']);
const SCOPE_REFUSALS = new Set(['SCOPE_NOT_GRANTED', 'NO_ELIGIBILITY_SCOPE']);
const CERT_REFUSALS = new Set(['NOT_CERTIFIED', 'NO_CERTIFICATION_MODE', 'NO_CERTIFICATION_POLICY']);
const KNOWN_STATES: readonly CertificationState[] = ['HUMAN_CERTIFIED', 'AUTOMATED_CERTIFIED_PILOT', 'REVIEW_REQUIRED', 'REJECTED', 'DRAFT', 'VALIDATING', 'QUARANTINED', 'RETIRED'];

export interface AdaptedRow { row: SupplyRow; notes: string[] }

/** The difficulty profile of a version. A missing index is null -- never 1.0. */
export function difficultyProfileOfRaw(r: Pick<RawSupplyRow, 'content' | 'difficulty_index' | 'calibration_confidence' | 'calibration_sample_size' | 'calibrated_at' | 'provenance'>): DifficultyProfile {
  const stored = r.difficulty_index === null || r.difficulty_index === undefined ? null : Number(r.difficulty_index);
  const authoredIndex = typeof r.content?.difficultyIndex === 'number' ? r.content.difficultyIndex : null;
  const sample = Number(r.calibration_sample_size ?? 0);
  const at = r.calibrated_at ? new Date(r.calibrated_at).toISOString() : null;
  if (sample > 0 && at) {
    // Field evidence exists. The engine counts it as calibrated only with an index on the exam-relative scale.
    return { difficultyIndex: stored, difficultyBand: null, confidence: confidenceOf(r.calibration_confidence), calibrationSource: 'EMPIRICAL', sampleSize: sample, lastCalibratedAt: at };
  }
  const index = stored ?? authoredIndex;
  if (index !== null && Number.isFinite(index)) {
    // An authored or modelled index: a prior, never a calibration. Fixtures carry a default 1.0 -- CONSTRUCT_DESIGN.
    return { difficultyIndex: index, difficultyBand: null, confidence: 0.3, calibrationSource: (r.provenance ?? 'FIXTURE') === 'FIXTURE' ? 'CONSTRUCT_DESIGN' : 'AUTOMATED_PRIOR', sampleSize: 0, lastCalibratedAt: null };
  }
  return profileFromAuthoredLevel(Number.isFinite(Number(r.content?.difficulty)) ? Number(r.content.difficulty) : 3);
}
const confidenceOf = (c: string | null): number => ({ HIGH_CONFIDENCE: 0.9, MODERATE_CONFIDENCE: 0.7, EARLY_SIGNAL: 0.4, INSUFFICIENT_DATA: 0.1 } as Record<string, number>)[c ?? ''] ?? 0;

/** One raw version -> one engine supply row (+ why each governance fact was set). Pure. */
export function supplyRowOf(r: RawSupplyRow, ctx: { scope: DeliveryScope; use: DeliveryUse; bucketIds: string[] }): AdaptedRow {
  const notes: string[] = [];
  let certification: CertificationState = 'LEGACY_UNGOVERNED';
  let lineageComplete = false;
  let rights: RightsStatus = 'UNKNOWN';
  let productionReleased = false;
  const lineage = r.lineage_class ?? 'LEGACY';
  if (lineage === 'CORE_DERIVED') {
    const state = (r.inst_state ?? '') as CertificationState;
    certification = KNOWN_STATES.includes(state) ? state : 'DRAFT';
    productionReleased = (r.inst_scopes ?? []).includes('PRODUCTION');
    const refusal = r.inst_refusal;
    if (refusal) notes.push(`instance refusal ${refusal}`);
    if (refusal && CERT_REFUSALS.has(refusal) && certification !== 'REVIEW_REQUIRED' && certification !== 'REJECTED') certification = 'DRAFT';
    rights = refusal && RIGHTS_REFUSALS.has(refusal) ? 'RESTRICTED' : r.inst_rights_category ? 'CLEARED' : 'UNKNOWN';
    // Any other refusal (core / adapter / applicability / blueprint / renderer / envelope / quarantine / difficulty)
    // breaks the governed chain this content inherits from: lineage is not complete.
    lineageComplete = !refusal || CERT_REFUSALS.has(refusal) || RIGHTS_REFUSALS.has(refusal) || SCOPE_REFUSALS.has(refusal);
    // the scope the instance itself was granted
    if (!(r.inst_scopes ?? []).includes(ctx.scope)) { notes.push(`scopes ${(r.inst_scopes ?? []).join(',') || 'none'}`); if (certification === 'HUMAN_CERTIFIED') lineageComplete = false; }
  } else if (lineage === 'PILOT_CERTIFIED') {
    certification = r.pilot_state === 'AUTOMATED_CERTIFIED_PILOT' && !r.pilot_revoked ? 'AUTOMATED_CERTIFIED_PILOT' : r.pilot_revoked ? 'RETIRED' : 'DRAFT';
    lineageComplete = r.pilot_in_scope === true;
    rights = certification === 'AUTOMATED_CERTIFIED_PILOT' ? 'CLEARED' : 'UNKNOWN';
    if (ctx.scope === 'PILOT_PREVIEW' && r.pilot_deliverable !== true) notes.push('not in exam_bank_pilot_deliverable_versions');
  } else {
    notes.push('LEGACY: no certification record');
    lineageComplete = false;
    rights = ['STUDYUS_OWNED', 'LICENSED_FOR_USE', 'OFFICIALLY_AUTHORIZED'].includes(r.legacy_reuse_rights ?? '') ? 'CLEARED' : r.legacy_reuse_rights === 'PROHIBITED' ? 'RESTRICTED' : 'UNKNOWN';
  }
  const isCurrentVersion = r.bank_item_id ? r.current_version_id === r.id : true;
  const lifecycleDeliverable = isEligible({ lifecycle: (r.bank_lifecycle_status ?? null) as LifecycleState | null, usage: r.usage_eligibility, alignment: r.exam_alignment, provenance: r.provenance ?? undefined, status: r.status, isCurrentVersion, retired: !!r.retired_at, calibrationConfidence: (r.calibration_confidence ?? null) as CalibrationConfidence | null }, ctx.use);
  if (!lifecycleDeliverable) notes.push(`lifecycle ${r.bank_lifecycle_status ?? 'NULL'} / ${r.status} / usage ${(r.usage_eligibility ?? []).join(',') || 'any'} / provenance ${r.provenance ?? 'unknown'}`);
  return {
    row: {
      itemId: r.bank_item_id ?? r.id, contentDigest: r.id, templateKey: r.template_fingerprint ?? null, bucketIds: ctx.bucketIds, certification, productionReleased, lineageComplete, rights,
      responseFormat: responseFormatOf(r.content), stimulusKind: r.content?.stimulus ? 'TEXT_PASSAGE' : null, stimulusId: r.content?.stimulus?.key ?? null,
      retired: !!r.retired_at || !isCurrentVersion, lifecycleDeliverable, difficulty: difficultyProfileOfRaw(r),
    },
    notes,
  };
}

export type FormLength = 'REDUCED' | 'FULL';
/** The buckets of one governed blueprint scope: cells (of the given sections) with positions in one form of that length. */
export function bucketsOf(cells: readonly BlueprintCell[], sectionKeys: readonly string[] | null, length: FormLength = 'REDUCED'): BlueprintBucket[] {
  const positions = (c: BlueprintCell): number => (length === 'FULL' ? c.fullPositions : c.reducedPositions);
  return cells.filter((c) => (!sectionKeys || sectionKeys.includes(c.sectionKey)) && positions(c) > 0).map((c) => ({ bucketId: c.cellKey, requiredPositions: positions(c), allowedFormats: null }));
}

/** The cells a version may fill (the health rule `itemMatchesCell`). */
export function cellsOfRow(r: Pick<RawSupplyRow, 'learning_objective_id' | 'question_type' | 'content'>, cells: readonly BlueprintCell[]): string[] {
  const difficulty = Number.isInteger(r.content?.difficulty) ? r.content.difficulty : 3;
  const dims = itemDimensionValues(r.content, typeof r.content?.marks === 'number' ? r.content.marks : 1);
  return cells.filter((c) => itemMatchesCell({ learningObjectiveId: r.learning_objective_id, questionType: r.question_type ?? '', difficulty, dimensions: dims }, c)).map((c) => c.cellKey);
}

// ------------------------------------------------------------------------------------------------ IO (SELECT only)
export interface Queryable { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }

export interface LoadedReadinessScope {
  examVersionId: string;
  family: string;
  versionLabel: string;
  cells: BlueprintCell[];
  rows: RawSupplyRow[];
  sections: string[];
  pilotEnvironmentDeclared: boolean;
}

/** Everything the adapter needs for one exam version, read with SELECTs only. */
export async function loadReadinessScope(q: Queryable, examVersionId: string): Promise<LoadedReadinessScope | null> {
  const meta = (await q.query(
    `SELECT v.id, d.exam_family, v.version_label, b.id AS blueprint_id FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id
       JOIN assessment_blueprints b ON b.exam_version_id = v.id AND b.purpose IS NULL WHERE v.id = $1`, [examVersionId])).rows[0];
  if (!meta) return null;
  const [comps, targets, env] = await Promise.all([
    q.query(`SELECT id, section_key, name, sequence_order, definition, max_marks, simulation_capable FROM assessment_components WHERE exam_version_id = $1 ORDER BY sequence_order NULLS LAST, created_at`, [examVersionId]),
    q.query(`SELECT t.id, t.learning_objective_id, lo.code AS objective_code, lo.description AS objective_description, t.assessment_component_id, t.question_type, t.difficulty_min, t.difficulty_max, ct.term AS command_term
               FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id LEFT JOIN command_terms ct ON ct.id = t.command_term_id
              WHERE t.blueprint_id = $1 ORDER BY t.created_at, t.id`, [meta.blueprint_id]),
    q.query(`SELECT EXISTS (SELECT 1 FROM public.exam_bank_pilot_environment) AS declared`).catch(() => ({ rows: [{ declared: false }] })),
  ]);
  const components = comps.rows.map((c: any, i: number) => ({ id: c.id, sectionKey: c.section_key ?? c.id, name: c.definition?.officialName ?? c.name, order: c.sequence_order ?? i, officialItemCount: c.definition?.officialItemCount ?? null, maxMarks: c.max_marks === null ? null : Number(c.max_marks), simulationCapable: c.simulation_capable === true }));
  const cells = deriveBlueprintCells(targets.rows.map((t: any) => ({ id: t.id, learningObjectiveId: t.learning_objective_id, objectiveCode: t.objective_code, objectiveDescription: t.objective_description, assessmentComponentId: t.assessment_component_id, questionType: t.question_type, difficultyMin: t.difficulty_min, difficultyMax: t.difficulty_max, commandTerm: t.command_term })), components);
  const objectiveIds = [...new Set(cells.map((c) => c.learningObjectiveId))];
  const rows = objectiveIds.length === 0 ? [] : (await q.query(
    `SELECT ai.id, ai.learning_objective_id, ai.question_type, ai.content, ai.status, ai.bank_lifecycle_status, ai.usage_eligibility, ai.exam_alignment, ai.template_fingerprint,
            ai.difficulty_index, ai.calibration_confidence, ai.calibration_sample_size, ai.calibrated_at, ai.bank_item_id,
            qi.lineage_class, qi.retired_at, qi.current_version_id, qi.provenance,
            inst.certification_state AS inst_state, inst.certification_mode AS inst_mode, inst.eligibility_scopes AS inst_scopes, inst.rights_category AS inst_rights_category,
            CASE WHEN inst.id IS NULL THEN NULL ELSE public.assessment_item_instance_refusal(inst) END AS inst_refusal,
            pc.certification_state AS pilot_state, (pc.revoked_at IS NOT NULL) AS pilot_revoked,
            CASE WHEN pc.id IS NULL THEN NULL ELSE public.exam_bank_pilot_certification_in_scope(pc) END AS pilot_in_scope,
            EXISTS (SELECT 1 FROM public.exam_bank_pilot_deliverable_versions pv WHERE pv.approved_item_id = ai.id) AS pilot_deliverable,
            (SELECT r.reuse_rights FROM public.question_bank_content_rights r WHERE r.content_type = 'ITEM_VERSION' AND r.content_id = ai.id AND r.superseded_at IS NULL ORDER BY r.recorded_at DESC LIMIT 1) AS legacy_reuse_rights
       FROM approved_items ai
       LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id
       LEFT JOIN public.assessment_item_instances inst ON inst.id = qi.item_instance_id
       LEFT JOIN public.exam_bank_pilot_item_certifications pc ON pc.approved_item_id = ai.id
      WHERE ai.learning_objective_id = ANY($1::uuid[])`, [objectiveIds])).rows as RawSupplyRow[];
  return { examVersionId, family: meta.exam_family, versionLabel: meta.version_label, cells, rows, sections: [...new Set(cells.map((c) => c.sectionKey))], pilotEnvironmentDeclared: env.rows[0]?.declared === true };
}

/** A Student's exposure, keyed by BANK ITEM (a new version of a seen item is still a seen item). */
export async function loadStudentExposure(q: Queryable, studentId: string): Promise<Map<string, string>> {
  const r = await q.query(
    `SELECT COALESCE(ai.bank_item_id, ai.id) AS item_id, max(u.used_at) AS last_used FROM exam_item_usage u JOIN approved_items ai ON ai.id = u.approved_item_id
      WHERE u.student_id = $1 GROUP BY 1`, [studentId]);
  return new Map(r.rows.map((x: any) => [String(x.item_id), new Date(x.last_used).toISOString()]));
}

/** Engine input for one scope of a loaded version. Pure. */
export function readinessInputOf(scope: LoadedReadinessScope, p: { deliveryScope: DeliveryScope; mode: ModeRequirements; use: DeliveryUse; sectionKeys: readonly string[] | null; length?: FormLength; exposure?: Map<string, string>; now?: Date }): { input: ReadinessInput; notes: Map<string, string[]> } {
  const cells = scope.cells.filter((c) => !p.sectionKeys || p.sectionKeys.includes(c.sectionKey));
  const blueprint: ReadinessBlueprint = {
    assessmentSystem: scope.family, assessmentVersion: scope.versionLabel, profile: null, component: p.sectionKeys?.length === 1 ? p.sectionKeys[0] : null,
    blueprintId: `${scope.examVersionId}/governed`, blueprintVersion: p.length === 'FULL' ? 'current/full' : 'current/reduced', buckets: bucketsOf(cells, null, p.length ?? 'REDUCED'),
  };
  const notes = new Map<string, string[]>();
  const supply: SupplyRow[] = [];
  for (const r of scope.rows) {
    const bucketIds = cellsOfRow(r, cells);
    if (bucketIds.length === 0) continue;
    const a = supplyRowOf(r, { scope: p.deliveryScope, use: p.use, bucketIds });
    supply.push(a.row);
    notes.set(r.id, a.notes);
  }
  // one row per BANK ITEM: only its current version can be delivered (other versions are `retired` here)
  return { input: { blueprint, mode: p.mode, scope: p.deliveryScope, capabilities: RUNTIME_CAPABILITIES, supply, exposure: p.exposure, now: p.now }, notes };
}
