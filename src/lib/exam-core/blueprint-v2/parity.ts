/**
 * Blueprint Engine V2 / BP-0 -- shadow parity against today's runtime.
 *
 * `runtimeShapeOf(config)` mirrors, without a database, exactly what
 * `applyExamVerticalConfig` writes for a configuration (components in order,
 * allocation item counts, one target row per position, component columns)
 * and what `deriveBlueprintCells` derives from those rows. `checkParity`
 * compares a compiled Blueprint V2 against it. Any difference means the
 * compiler changed a semantic the runtime relies on.
 */
import { parseExamVerticalConfig } from '../vertical-config';
import { deriveBlueprintCells, type BlueprintTargetInput, type ComponentInput } from '../question-bank/cells';
import { normalizeConstraints } from '../slot-constraints';
import type { BlueprintV2 } from './schema';

export interface RuntimeShape {
  components: Array<{ sectionKey: string; order: number; itemCount: number; maxMarks: number | null; weightingPercent: number | null; calculatorPolicy: string | null; durationMinutes: number | null }>;
  targetRows: number;
  cells: Array<{ cellKey: string; reducedPositions: number }>;
  commandTerms: string[];
}

export function runtimeShapeOf(input: unknown): RuntimeShape {
  const parsed = parseExamVerticalConfig(input);
  if (!parsed.ok) throw new Error(`invalid configuration: ${parsed.issues.join('; ')}`);
  const cfg = parsed.config;
  const components: ComponentInput[] = [];
  const targets: BlueprintTargetInput[] = [];
  const shapeComponents: RuntimeShape['components'] = [];
  cfg.sections.forEach((section, order) => {
    const id = `component:${section.key}`;
    const d = section.definition;
    components.push({ id, sectionKey: section.key, name: section.name, order, officialItemCount: d?.officialItemCount ?? null, maxMarks: d?.maxMarks ?? null, simulationCapable: section.simulationCapable });
    shapeComponents.push({
      sectionKey: section.key,
      order,
      itemCount: section.objectives.reduce((n, o) => n + o.targets.reduce((m, t) => m + t.count, 0), 0),
      maxMarks: d ? d.maxMarks : null,
      weightingPercent: d ? d.weightingPercent : null,
      calculatorPolicy: d ? d.calculatorPolicy : null,
      durationMinutes: section.durationMinutes ?? null,
    });
    for (const o of section.objectives) {
      for (const t of o.targets) {
        for (let n = 0; n < t.count; n++) {
          targets.push({
            id: `${section.key}:${o.code}:${targets.length}`,
            learningObjectiveId: `objective:${o.code}`,
            objectiveCode: o.code,
            assessmentComponentId: id,
            questionType: t.questionType ?? null,
            difficultyMin: t.difficultyMin ?? null,
            difficultyMax: t.difficultyMax ?? null,
            commandTerm: t.commandTerm ?? null,
            // apply writes normalizeConstraints(target.constraints) into blueprint_objective_targets.constraints (20261102)
            ...(normalizeConstraints(t.constraints).length ? { constraints: normalizeConstraints(t.constraints) } : {}),
          });
        }
      }
    }
  });
  const cells = deriveBlueprintCells(targets, components).map((c) => ({ cellKey: c.cellKey, reducedPositions: c.reducedPositions }));
  return { components: shapeComponents, targetRows: targets.length, cells, commandTerms: cfg.commandTerms.map((t) => t.term) };
}

export interface ParityDiff {
  path: string;
  runtime: unknown;
  blueprint: unknown;
}

/** Compares a GENERAL (all-component) blueprint with the runtime shape of its configuration. */
export function checkParity(input: unknown, bp: BlueprintV2): ParityDiff[] {
  const rt = runtimeShapeOf(input);
  const diffs: ParityDiff[] = [];
  const d = (path: string, runtime: unknown, blueprint: unknown) => {
    if (JSON.stringify(runtime) !== JSON.stringify(blueprint)) diffs.push({ path, runtime, blueprint });
  };
  const val = <T>(f: { status: string; value?: T }) => (f.status === 'STATED' ? (f.value as T) : null);

  d('components.keys', rt.components.map((c) => c.sectionKey), bp.components.map((c) => c.key));
  for (const rc of rt.components) {
    const bc = bp.components.find((c) => c.key === rc.sectionKey);
    if (!bc) continue;
    d(`components.${rc.sectionKey}.order`, rc.order, bc.order);
    d(`components.${rc.sectionKey}.itemCount`, rc.itemCount, bc.plannedPositions);
    d(`components.${rc.sectionKey}.maxMarks`, rc.maxMarks, val(bc.official.maxMarks));
    d(`components.${rc.sectionKey}.weightingPercent`, rc.weightingPercent, val(bc.official.weightPercent));
    d(`components.${rc.sectionKey}.calculatorPolicy`, rc.calculatorPolicy, val(bc.official.calculatorPolicy));
    d(`components.${rc.sectionKey}.durationMinutes`, rc.durationMinutes, bc.delivery.durationMinutes?.value ?? null);
  }
  d('targetRows', rt.targetRows, bp.components.reduce((n, c) => n + c.plannedPositions, 0));
  const bpCells = bp.components.flatMap((c) => c.cells.map((x) => ({ cellKey: x.cellKey, reducedPositions: x.positions }))).sort((a, b) => a.cellKey.localeCompare(b.cellKey));
  d('cells', [...rt.cells].sort((a, b) => a.cellKey.localeCompare(b.cellKey)), bpCells);
  d('commandTerms', rt.commandTerms, bp.commandTerms.map((t) => t.term));
  return diffs;
}

/**
 * BP-4A: the legacy rows as the runtime reads them (blueprint_objective_targets
 * with their ids, components with section keys) -- for driving the real shadow
 * hooks without a database. Objective ids are `objective:<code>` and command
 * term ids are the term itself, so an in-memory store can map them back.
 */
export function runtimeTargetsOf(input: unknown): {
  targets: Array<{ id: string; learningObjectiveId: string; assessmentComponentId: string; questionType: string | null; difficultyMin: number | null; difficultyMax: number | null; commandTermId: string | null; constraints?: ReturnType<typeof normalizeConstraints> }>;
  components: Array<{ id: string; sectionKey: string }>;
} {
  const parsed = parseExamVerticalConfig(input);
  if (!parsed.ok) throw new Error(`invalid configuration: ${parsed.issues.join('; ')}`);
  const targets: ReturnType<typeof runtimeTargetsOf>['targets'] = [];
  const components = parsed.config.sections.map((s) => ({ id: `component:${s.key}`, sectionKey: s.key }));
  for (const s of parsed.config.sections) for (const o of s.objectives) for (const t of o.targets) for (let n = 0; n < t.count; n++) {
    targets.push({ id: `target:${s.key}:${o.code}:${targets.length}`, learningObjectiveId: `objective:${o.code}`, assessmentComponentId: `component:${s.key}`, questionType: t.questionType ?? null, difficultyMin: t.difficultyMin ?? null, difficultyMax: t.difficultyMax ?? null, commandTermId: t.commandTerm ?? null, ...(normalizeConstraints(t.constraints).length ? { constraints: normalizeConstraints(t.constraints) } : {}) });
  }
  return { targets, components };
}
