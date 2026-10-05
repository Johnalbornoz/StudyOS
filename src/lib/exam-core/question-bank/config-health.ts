/**
 * Question Bank Factory -- bank-health inputs from a governed vertical
 * configuration (pure). Used by tests, the shadow comparison and the readiness
 * report to reason about a configuration's own bank exactly as the DB-backed
 * health does (same cells, same assembly), with synthetic stable ids.
 */
import { itemDimensionValues } from '../slot-constraints';
import { createHash } from 'crypto';
import { examItemFromApproved, examItemMarks } from '../items';
import { itemFingerprints } from '../fingerprints';
import { parseExamVerticalConfig, type ExamVerticalConfigInput } from '../vertical-config';
import { deriveBlueprintCells, type BlueprintTargetInput, type ComponentInput, type BlueprintCell } from './cells';
import type { BankItemFact } from './health';
import { provenanceFromOrigin } from './policy';
import type { LifecycleState } from './lifecycle';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export interface ConfigHealthInput {
  family: string;
  components: ComponentInput[];
  cells: BlueprintCell[];
  items: BankItemFact[];
  objectiveIdByCode: Record<string, string>;
}

export function configHealthInput(input: ExamVerticalConfigInput, lifecycle: LifecycleState = 'ACTIVE'): ConfigHealthInput {
  const parsed = parseExamVerticalConfig(input);
  if (!parsed.ok) throw new Error(`invalid config: ${parsed.issues.join('; ')}`);
  const cfg = parsed.config;
  const objectiveIdByCode: Record<string, string> = {};
  const components: ComponentInput[] = cfg.sections.map((s, i) => ({
    id: uuidFrom(`${cfg.key}:component:${s.key}`),
    sectionKey: s.key,
    name: s.definition?.officialName ?? s.name,
    order: i,
    officialItemCount: s.definition?.officialItemCount ?? null,
    maxMarks: s.definition?.maxMarks ?? null,
    simulationCapable: s.simulationCapable,
  }));
  const targets: BlueprintTargetInput[] = [];
  cfg.sections.forEach((s, i) => {
    for (const o of s.objectives) {
      objectiveIdByCode[o.code] = uuidFrom(`${cfg.key}:objective:${o.code}`);
      for (const t of o.targets) {
        for (let n = 0; n < t.count; n++) {
          targets.push({
            id: uuidFrom(`${cfg.key}:target:${o.code}:${targets.length}`),
            learningObjectiveId: objectiveIdByCode[o.code],
            objectiveCode: o.code,
            objectiveDescription: o.description,
            assessmentComponentId: components[i].id,
            questionType: t.questionType ?? null,
            difficultyMin: t.difficultyMin ?? null,
            difficultyMax: t.difficultyMax ?? null,
            commandTerm: t.commandTerm ?? null,
            ...(t.constraints?.length ? { constraints: t.constraints } : {}),
          });
        }
      }
    }
  });
  const items: BankItemFact[] = [];
  const maxMarks: Record<string, number> = {};
  for (const it of cfg.items) {
    const id = uuidFrom(`${cfg.key}:item:${it.content.key}`);
    const loId = objectiveIdByCode[it.objectiveCode];
    const ex = examItemFromApproved({ id, learning_objective_id: loId, content: it.content });
    if (!ex) continue;
    const fp = itemFingerprints(it.content);
    const marks = examItemMarks(ex);
    maxMarks[loId] = Math.max(maxMarks[loId] ?? 0, marks);
    items.push({
      versionId: id,
      bankItemId: id,
      learningObjectiveId: loId,
      questionType: it.content.type,
      dimensions: itemDimensionValues(it.content, marks),
      difficulty: ex.difficulty,
      difficultyIndex: it.content.difficultyIndex ?? null,
      marks,
      templateFingerprint: fp.template,
      semanticFingerprint: fp.semantic,
      stimulusKey: ex.exam.stimulus?.key ?? null,
      provenance: provenanceFromOrigin(ex.exam.contentOrigin),
      lifecycle,
      status: ['PILOT', 'CALIBRATED', 'ACTIVE'].includes(lifecycle) ? 'PUBLISHED' : 'APPROVED',
      isCurrentVersion: true,
      retired: false,
      calibrationConfidence: 'INSUFFICIENT_DATA',
    });
  }
  const provisional = deriveBlueprintCells(targets, components);
  const cells = deriveBlueprintCells(targets, components, Object.fromEntries(provisional.map((c) => [c.cellKey, maxMarks[c.learningObjectiveId] ?? 1])));
  return { family: cfg.family, components, cells, items, objectiveIdByCode };
}
