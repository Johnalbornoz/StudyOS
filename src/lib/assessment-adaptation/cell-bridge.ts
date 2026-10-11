/**
 * EA-1 -- from a requirement cell to an adaptation specification (pure, no IO).
 *
 *   RequirementCell -> EvidenceTarget -> TaskFamilySelection -> AssessmentSystemProfile -> AdaptationSpecification
 *     -> GenerationRequest -> QuestionCandidate -> Validation -> HumanReviewPackage
 *
 * The Production OS plans by cell and generates from the concept profile. This bridge inserts the three steps
 * the cell does not have, without touching the cell: it reads a cell's own fields and returns a specification
 * that the generation harness may be given (it is then part of the prompt, hence of the prompt hash, and its
 * identity is recorded on the candidate). A cell with no family is generated exactly as before.
 *
 * It takes a STRUCTURAL view of a cell, so that this directory does not import the Production OS: the
 * dependency runs from production to adaptation, never back. A `RequirementCell` satisfies the view as it is.
 *
 * Production is strict where the proof of concept is not: a specification for a cell requires the family's
 * concept to be CERTIFIED for the cell's exam family. A behaviour fit is not enough to produce for an exam.
 */
import type { ElicitationFormat, TaskFamily, TaskFamilyRegistry } from '@/lib/exam-core/question-bank/task-families/task-family';
import { adapt, type AdaptationResult } from './adapt';
import type { AdaptationRefusalCode, AdaptationRequest, KnowledgeRequirement } from './adaptation-specification';
import type { AssessmentSystemProfile } from './assessment-system-profile';
import { INSTANCE_PURPOSES, type InstancePurpose } from './instance-lineage';

/** The fields of a requirement cell the bridge reads. */
export interface AdaptationCellView {
  cellKey: string;
  examFamily: string;
  primaryConcept: { stableId: string; canonicalSubject: string; canonicalName: string };
  intendedPool: string;
  responseFormat: string;
  difficultyBand: 'FOUNDATIONAL' | 'STANDARD' | 'CHALLENGE';
  stimulus: { class: 'STANDALONE' } | { class: 'STIMULUS_REQUIRED' | 'STIMULUS_OPTIONAL'; kind: string };
}

/** The elicitation format of each response format the Production OS plans. */
export const ELICITATION_FORMAT_OF_PRODUCTION: Readonly<Record<string, ElicitationFormat>> = { MULTIPLE_CHOICE: 'SELECTED_RESPONSE', STUDENT_PRODUCED: 'NUMERIC_ENTRY' };

/** What a cell asks evidence OF: its one PRIMARY concept, for its pool. The cell already says it; this only names the step. */
export interface CellEvidenceTarget { primaryConcept: AdaptationCellView['primaryConcept']; examFamily: string; pool: string }
export const evidenceTargetOfCell = (cell: AdaptationCellView): CellEvidenceTarget => ({ primaryConcept: { ...cell.primaryConcept }, examFamily: cell.examFamily, pool: cell.intendedPool });

export type FamilyExclusion = 'RETIRED' | 'STIMULUS_DOES_NOT_FIT_THE_CELL' | 'RESPONSE_FORMAT_NOT_OF_THE_FAMILY';
export interface TaskFamilySelection { cellKey: string; candidates: TaskFamily[]; excluded: Array<{ familyId: string; reason: FamilyExclusion }> }

const stimulusFits = (cell: AdaptationCellView, family: TaskFamily): boolean => {
  const need = family.responseConstraints.stimulusNeed;
  if (cell.stimulus.class === 'STANDALONE') return need !== 'REQUIRED';
  if (cell.stimulus.class === 'STIMULUS_REQUIRED') return need !== 'NONE' && family.responseConstraints.stimulusKinds.includes(cell.stimulus.kind);
  return need === 'NONE' || family.responseConstraints.stimulusKinds.includes(cell.stimulus.kind);
};

/**
 * The families that can supply a cell: those whose PRIMARY concept IS the cell's -- the same stable id AND the
 * same canonical subject. A concept of the same name under another subject is another concept and is not matched.
 * Selection is a list of what fits; choosing among it (and how many instances each may give) is not decided here.
 */
export function selectTaskFamilies(cell: AdaptationCellView, families: readonly TaskFamily[]): TaskFamilySelection {
  const out: TaskFamilySelection = { cellKey: cell.cellKey, candidates: [], excluded: [] };
  const format = ELICITATION_FORMAT_OF_PRODUCTION[cell.responseFormat];
  for (const f of [...families].sort((a, b) => (a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0))) {
    if (!f.primaryConcepts.some((c) => c.stableId === cell.primaryConcept.stableId && c.canonicalSubject === cell.primaryConcept.canonicalSubject)) continue;
    if (f.lifecycle === 'RETIRED') out.excluded.push({ familyId: f.familyId, reason: 'RETIRED' });
    else if (!stimulusFits(cell, f)) out.excluded.push({ familyId: f.familyId, reason: 'STIMULUS_DOES_NOT_FIT_THE_CELL' });
    else if (!format || !f.responseConstraints.allowedFormats.includes(format)) out.excluded.push({ familyId: f.familyId, reason: 'RESPONSE_FORMAT_NOT_OF_THE_FAMILY' });
    else out.candidates.push(f);
  }
  return out;
}

export type CellBridgeRefusalCode = 'NO_PROFILE_FOR_EXAM_FAMILY' | 'FAMILY_DOES_NOT_TARGET_THE_CELLS_CONCEPT' | 'CELL_FORMAT_HAS_NO_ELICITATION_FORMAT' | 'CELL_POOL_IS_NOT_A_KNOWN_PURPOSE' | 'CELL_STIMULUS_DOES_NOT_FIT_THE_FAMILY';
export type CellAdaptationResult = Extract<AdaptationResult, { ok: true }> | { ok: false; refusal: { code: AdaptationRefusalCode | CellBridgeRefusalCode; detail: string } };

export interface AdaptForCellInput {
  cell: AdaptationCellView;
  family: TaskFamily;
  /** The profiles to resolve the cell's exam family in. One profile per exam family; none = refusal, never a neighbour's. */
  profiles: readonly AssessmentSystemProfile[];
  disciplinePolicy: unknown;
  /** The language items of the cell are written in (the exam's own module knows it; the cell does not). */
  language: string;
  registry?: TaskFamilyRegistry;
  adaptedAt?: string | null;
  /** Defaults to CERTIFIED. Loosening it is a decision, so it is a parameter and never a default. */
  knowledgeRequirement?: KnowledgeRequirement;
}

/** The specification for ONE cell from ONE family. Everything the cell fixes is asked for explicitly; the engine refuses what does not fit. */
export function adaptForCell(input: AdaptForCellInput): CellAdaptationResult {
  const { cell, family } = input;
  const no = (code: CellBridgeRefusalCode, detail: string): CellAdaptationResult => ({ ok: false, refusal: { code, detail } });
  const profile = input.profiles.find((p) => p.examFamilyCode === cell.examFamily);
  if (!profile) return no('NO_PROFILE_FOR_EXAM_FAMILY', cell.examFamily);
  if (!family.primaryConcepts.some((c) => c.stableId === cell.primaryConcept.stableId && c.canonicalSubject === cell.primaryConcept.canonicalSubject)) return no('FAMILY_DOES_NOT_TARGET_THE_CELLS_CONCEPT', `${family.familyId} / ${cell.primaryConcept.stableId} (${cell.primaryConcept.canonicalSubject})`);
  const responseFormat = ELICITATION_FORMAT_OF_PRODUCTION[cell.responseFormat];
  if (!responseFormat) return no('CELL_FORMAT_HAS_NO_ELICITATION_FORMAT', cell.responseFormat);
  if (!(INSTANCE_PURPOSES as readonly string[]).includes(cell.intendedPool)) return no('CELL_POOL_IS_NOT_A_KNOWN_PURPOSE', cell.intendedPool);
  if (!stimulusFits(cell, family)) return no('CELL_STIMULUS_DOES_NOT_FIT_THE_FAMILY', `${cell.stimulus.class} / ${family.responseConstraints.stimulusNeed}`);
  const request: AdaptationRequest = {
    purpose: cell.intendedPool as InstancePurpose, difficultyBand: cell.difficultyBand, language: input.language, targetPrimaryConceptStableId: cell.primaryConcept.stableId, responseFormat,
    requirementCellKey: cell.cellKey, knowledgeRequirement: input.knowledgeRequirement ?? 'CERTIFIED',
  };
  return adapt({ family, profile, disciplinePolicy: input.disciplinePolicy, request, registry: input.registry, adaptedAt: input.adaptedAt });
}
