/**
 * Question Bank Factory -- bank health from the DATABASE (the live bank, not
 * the static vertical configuration), persisted as snapshots.
 *
 * Health is computed in the background (factory run, admin refresh, CLI) and
 * stored in `question_bank_health_snapshots`; Student launch paths only ever
 * read the latest snapshot row -- never recompute coverage on Start.
 */
import { db } from '@/lib/db';
import { examItemFromApproved, examItemMarks } from '../items';
import { ComponentDefinitionSchema } from '../component-definition';
import { adapterFor } from './adapters';
import { deriveBlueprintCells, type BlueprintTargetInput, type ComponentInput, type BlueprintCell } from './cells';
import { computeBankHealth, HEALTH_ENGINE_VERSION, type BankHealth, type BankItemFact, type QueueFact } from './health';
import type { CalibrationConfidence, LifecycleState } from './lifecycle';
import { DEFAULT_ELIGIBILITY } from './lifecycle';
import { DEFAULT_REUSE_POLICY, provenanceFromOrigin, type CellTargetOverride, type Provenance } from './policy';

export interface BankVersionMeta {
  examVersionId: string;
  examDefinitionId: string;
  definitionName: string;
  family: string;
  configKey: string | null;
  versionLabel: string;
  versionStatus: string;
  blueprintId: string;
  structureOnly: boolean;
  contentStatus: string | null;
}

export interface VersionHealthInputs {
  meta: BankVersionMeta;
  components: ComponentInput[];
  componentDefinitions: Record<string, { responseFormats: string[]; calculatorPolicy: string | null } | null>;
  cells: BlueprintCell[];
  items: BankItemFact[];
  /** Question / stimulus text of current versions per objective (novelty checks, exemplars). Server-side only. */
  texts: Array<{ versionId: string; learningObjectiveId: string; question: string; stimulusText: string | null; stimulusTitle: string | null; options: string[]; language: string; hasStimulus: boolean; cognitiveDemand: string | null; difficulty: number | null; published: boolean }>;
  queue: QueueFact[];
  targetOverrides: { versionDefault: CellTargetOverride | null; byCell: Record<string, CellTargetOverride> };
}

const toMeta = (r: any): BankVersionMeta => ({
  examVersionId: r.version_id,
  examDefinitionId: r.definition_id,
  definitionName: r.definition_name,
  family: r.exam_family,
  configKey: r.config_key ?? null,
  versionLabel: r.version_label,
  versionStatus: r.version_status,
  blueprintId: r.blueprint_id,
  structureOnly: r.navigation_rules?.structureOnly === true,
  contentStatus: r.navigation_rules?.contentStatus ?? null,
});

const META_SQL = `SELECT v.id AS version_id, d.id AS definition_id, d.name AS definition_name, d.exam_family, d.config_key, v.version_label, v.status AS version_status, v.navigation_rules, b.id AS blueprint_id
                    FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id JOIN assessment_blueprints b ON b.exam_version_id = v.id`;

/** Every PUBLISHED exam version with a blueprint (the bank-health universe). */
export async function listBankVersions(): Promise<BankVersionMeta[]> {
  const r = await db.query(`${META_SQL} WHERE v.status = 'PUBLISHED' ORDER BY d.exam_family, d.name`);
  return r.rows.map(toMeta);
}

export async function bankVersionMeta(examVersionId: string): Promise<BankVersionMeta | null> {
  const r = await db.query(`${META_SQL} WHERE v.id = $1`, [examVersionId]);
  return r.rows[0] ? toMeta(r.rows[0]) : null;
}

export async function loadVersionHealthInputs(examVersionId: string): Promise<VersionHealthInputs | null> {
  const meta = await bankVersionMeta(examVersionId);
  if (!meta) return null;
  const [compRows, targetRows, queueRows, targetOverrideRows] = await Promise.all([
    db.query(`SELECT id, section_key, name, sequence_order, definition, max_marks, simulation_capable FROM assessment_components WHERE exam_version_id = $1 ORDER BY sequence_order NULLS LAST, created_at`, [examVersionId]),
    db.query(
      `SELECT t.id, t.learning_objective_id, lo.code AS objective_code, lo.description AS objective_description, t.assessment_component_id, t.question_type, t.difficulty_min, t.difficulty_max, ct.term AS command_term
         FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id LEFT JOIN command_terms ct ON ct.id = t.command_term_id
        WHERE t.blueprint_id = $1 ORDER BY t.created_at, t.id`,
      [meta.blueprintId]
    ),
    db.query(`SELECT cell_key, status, requested_count FROM question_bank_generation_requests WHERE exam_version_id = $1 AND status IN ('PENDING', 'RUNNING')`, [examVersionId]),
    db.query(`SELECT cell_key, target_forms, min_usable, desired_items, min_active, min_calibrated, max_generation_priority FROM question_bank_cell_targets WHERE exam_version_id = $1`, [examVersionId]),
  ]);
  const componentDefinitions: VersionHealthInputs['componentDefinitions'] = {};
  const components: ComponentInput[] = compRows.rows.map((c: any, i: number) => {
    const def = c.definition ? ComponentDefinitionSchema.safeParse(c.definition) : null;
    componentDefinitions[c.id] = def?.success ? { responseFormats: def.data.responseFormats, calculatorPolicy: def.data.calculatorPolicy ?? null } : null;
    return {
      id: c.id,
      sectionKey: c.section_key ?? c.id,
      name: (def?.success ? def.data.officialName : null) ?? c.name,
      order: c.sequence_order ?? i,
      officialItemCount: def?.success ? def.data.officialItemCount ?? null : null,
      maxMarks: c.max_marks === null ? null : Number(c.max_marks),
      simulationCapable: c.simulation_capable === true,
    };
  });
  const targets: BlueprintTargetInput[] = targetRows.rows.map((t: any) => ({
    id: t.id,
    learningObjectiveId: t.learning_objective_id,
    objectiveCode: t.objective_code,
    objectiveDescription: t.objective_description,
    assessmentComponentId: t.assessment_component_id,
    questionType: t.question_type,
    difficultyMin: t.difficulty_min,
    difficultyMax: t.difficulty_max,
    commandTerm: t.command_term,
  }));
  const objectiveIds = [...new Set(targets.map((t) => t.learningObjectiveId))];
  const itemRows = objectiveIds.length
    ? (
        await db.query(
          `SELECT ai.id, ai.learning_objective_id, ai.question_type, ai.content, ai.status, ai.bank_lifecycle_status, ai.difficulty_index, ai.template_fingerprint, ai.semantic_fingerprint,
                  ai.content_origin, ai.calibration_confidence, ai.bank_item_id, ai.usage_eligibility, ai.exam_alignment, ai.validated_difficulty, qi.provenance, qi.retired_at, qi.current_version_id
             FROM approved_items ai LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id
            WHERE ai.learning_objective_id = ANY($1::uuid[])`,
          [objectiveIds]
        )
      ).rows
    : [];
  const items: BankItemFact[] = [];
  const texts: VersionHealthInputs['texts'] = [];
  const maxMarks: Record<string, number> = {};
  for (const r of itemRows) {
    const isCurrent = r.bank_item_id ? r.current_version_id === r.id : true;
    const item = examItemFromApproved({ id: r.id, learning_objective_id: r.learning_objective_id, content: r.content });
    if (isCurrent && r.content?.question) {
      texts.push({
        versionId: r.id,
        learningObjectiveId: r.learning_objective_id,
        question: String(r.content.question),
        stimulusText: r.content.stimulus?.text ?? null,
        stimulusTitle: r.content.stimulus?.title ?? null,
        options: Array.isArray(r.content.options) ? r.content.options.map((o: any) => String(o?.text ?? '')) : [],
        language: String(r.content.language ?? 'es'),
        hasStimulus: !!r.content.stimulus,
        cognitiveDemand: typeof r.content.tags?.cognitiveDemand === 'string' ? r.content.tags.cognitiveDemand : null,
        difficulty: Number.isInteger(r.content.difficulty) ? r.content.difficulty : null,
        published: r.status === 'PUBLISHED',
      });
    }
    if (!item) continue; // not deliverable by the exam engine: never counted as bank content
    const marks = examItemMarks(item);
    const provenance: Provenance = r.provenance ?? provenanceFromOrigin(item.exam.contentOrigin);
    items.push({
      versionId: r.id,
      bankItemId: r.bank_item_id ?? r.id,
      learningObjectiveId: r.learning_objective_id,
      questionType: r.question_type,
      difficulty: item.difficulty,
      difficultyIndex: r.difficulty_index === null ? item.exam.difficultyIndex ?? null : Number(r.difficulty_index),
      marks,
      templateFingerprint: r.template_fingerprint,
      semanticFingerprint: r.semantic_fingerprint,
      stimulusKey: item.exam.stimulus?.key ?? null,
      provenance,
      lifecycle: (r.bank_lifecycle_status ?? null) as LifecycleState | null,
      status: r.status,
      isCurrentVersion: isCurrent,
      retired: !!r.retired_at,
      calibrationConfidence: (r.calibration_confidence ?? null) as CalibrationConfidence | null,
      usage: r.usage_eligibility ?? null,
      alignment: r.exam_alignment ?? null,
      validatedDifficulty: r.validated_difficulty ?? null,
    });
    // Same basis as the catalogue readiness: the largest item of the objective decides its marks per position.
    maxMarks[r.learning_objective_id] = Math.max(maxMarks[r.learning_objective_id] ?? 0, marks);
  }
  // Marks per cell only matter for components that publish marks but no item count.
  const provisional = deriveBlueprintCells(targets, components);
  const marksByCell = Object.fromEntries(provisional.map((c) => [c.cellKey, maxMarks[c.learningObjectiveId] ?? 1]));
  const cells = deriveBlueprintCells(targets, components, marksByCell);

  const byCell: Record<string, CellTargetOverride> = {};
  let versionDefault: CellTargetOverride | null = null;
  for (const t of targetOverrideRows.rows) {
    const o: CellTargetOverride = {
      targetForms: t.target_forms === null ? null : Number(t.target_forms),
      minUsable: t.min_usable,
      desiredItems: t.desired_items,
      minActive: t.min_active,
      minCalibrated: t.min_calibrated,
      maxGenerationPriority: t.max_generation_priority,
    };
    if (t.cell_key) byCell[t.cell_key] = o;
    else versionDefault = o;
  }
  return {
    meta,
    components,
    componentDefinitions,
    cells,
    items,
    texts,
    queue: queueRows.rows.map((q: any) => ({ cellKey: q.cell_key, status: q.status, requestedCount: q.requested_count })),
    targetOverrides: { versionDefault, byCell },
  };
}

export function healthFromInputs(inputs: VersionHealthInputs): BankHealth {
  return computeBankHealth({
    cells: inputs.cells,
    components: inputs.components,
    items: inputs.items,
    queue: inputs.queue,
    targetOverrides: inputs.targetOverrides,
    unitPolicy: adapterFor(inputs.meta.family).unitPolicy,
  });
}

export interface StoredSnapshot {
  id: string;
  examVersionId: string;
  computedAt: string;
  engineVersion: string;
  summary: BankHealth['totals'] & { officialContentCoverage: number; family: string; definitionName: string; versionLabel: string };
  readiness: BankHealth['readiness'];
  cells: BankHealth['cells'];
  components: BankHealth['components'];
}

/** Computes and stores a snapshot for one version (background only). */
export async function refreshVersionHealth(examVersionId: string, runId: string | null = null): Promise<{ health: BankHealth; inputs: VersionHealthInputs } | null> {
  const inputs = await loadVersionHealthInputs(examVersionId);
  if (!inputs) return null;
  const health = healthFromInputs(inputs);
  await db.query(
    `INSERT INTO question_bank_health_snapshots (exam_version_id, engine_version, summary, readiness, cells, policy, run_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      examVersionId,
      HEALTH_ENGINE_VERSION,
      JSON.stringify({ ...health.totals, officialContentCoverage: health.officialContentCoverage, family: inputs.meta.family, definitionName: inputs.meta.definitionName, versionLabel: inputs.meta.versionLabel }),
      JSON.stringify(health.readiness),
      JSON.stringify({ cells: health.cells, components: health.components }),
      JSON.stringify({ eligibility: DEFAULT_ELIGIBILITY, reuse: DEFAULT_REUSE_POLICY, unitPolicy: adapterFor(inputs.meta.family).unitPolicy }),
      runId,
    ]
  );
  return { health, inputs };
}

const toSnapshot = (r: any): StoredSnapshot => ({
  id: r.id,
  examVersionId: r.exam_version_id,
  computedAt: r.computed_at instanceof Date ? r.computed_at.toISOString() : r.computed_at,
  engineVersion: r.engine_version,
  summary: r.summary,
  readiness: r.readiness,
  cells: r.cells?.cells ?? [],
  components: r.cells?.components ?? [],
});

/** Latest snapshot per version (one indexed query; what capability reads use). */
export async function latestSnapshots(examVersionIds?: string[]): Promise<Map<string, StoredSnapshot>> {
  const r = await db.query(
    `SELECT DISTINCT ON (exam_version_id) id, exam_version_id, computed_at, engine_version, summary, readiness, cells
       FROM question_bank_health_snapshots WHERE ($1::uuid[] IS NULL OR exam_version_id = ANY($1::uuid[]))
      ORDER BY exam_version_id, computed_at DESC`,
    [examVersionIds ?? null]
  );
  return new Map(r.rows.map((row: any) => [row.exam_version_id, toSnapshot(row)]));
}
