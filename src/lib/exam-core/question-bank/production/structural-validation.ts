/**
 * Automated structural validation of a candidate against its requirement cell (pure, no IO).
 *
 * It answers "is this candidate well formed for the cell it was written for?". It does not judge whether the
 * question is correct, clear, fair or original, and a pass is NOT a human review: `isHumanReview` is false on
 * every result, and nothing downstream may read a structural pass as an approval.
 */
import type { CandidateStimulus, QuestionCandidate } from './generation-contract';
import { MOCK_POOLS, PRODUCTION_POOLS, type RequirementCell } from './requirement-cell';

export const STRUCTURAL_CHECKS = [
  'ONE_PRIMARY_CONCEPT', 'VALID_DOMAIN_TOPIC', 'VALID_RESPONSE_FORMAT', 'ANSWER_KEY_CONSISTENT', 'OPTIONS_UNIQUE', 'MARK_ALLOCATION', 'DIFFICULTY_RANGE',
  'STIMULUS_REQUIREMENT', 'SUPPORTED_BLUEPRINT_CELL', 'VALID_POOL_TARGET', 'PROVENANCE_PRESENT',
] as const;
export type StructuralCheck = (typeof STRUCTURAL_CHECKS)[number];

export interface StructuralIssue {
  check: StructuralCheck;
  code: string;
}

export interface StructuralValidation {
  outcome: 'PASS' | 'FAIL';
  issues: StructuralIssue[];
  checksRun: readonly StructuralCheck[];
  /** Always false. An automated check is never a review. */
  isHumanReview: false;
}

export interface StructuralContext {
  /** The stimuli of the candidate's batch. */
  stimuli?: readonly CandidateStimulus[];
  /** Is a variant published for the cell's blueprint (purpose, form)? Absent / false = none is. */
  blueprintVariantPublished?: boolean;
  /** When true, the missing variant is reported but does not fail a DRAFT: forms are assembled later. */
  draftStage?: boolean;
  marksRange?: { min: number; max: number };
  optionCount?: { min: number; max: number };
  /**
   * The exam's own check that the cell sits in its certified hierarchy (for PAA: `paaCellViolations`). Supplied by the
   * caller; when absent the Domain / Topic check cannot be made and the validation says so.
   */
  hierarchyViolations?: (cell: RequirementCell) => string[];
}

const norm = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function validateCandidateStructure(candidate: QuestionCandidate, cell: RequirementCell, ctx: StructuralContext = {}): StructuralValidation {
  const issues: StructuralIssue[] = [];
  const add = (check: StructuralCheck, code: string) => issues.push({ check, code });
  const marks = ctx.marksRange ?? { min: 1, max: 1 };
  const optionCount = ctx.optionCount ?? { min: 4, max: 5 };

  // the candidate is written for the cell's ONE primary concept; proposed supporting concepts never repeat it
  if (candidate.primaryConceptStableId !== cell.primaryConcept.stableId) add('ONE_PRIMARY_CONCEPT', 'PRIMARY_IS_NOT_THE_CELLS');
  if (candidate.proposedSupportingConceptStableIds.includes(candidate.primaryConceptStableId) || new Set(candidate.proposedSupportingConceptStableIds).size !== candidate.proposedSupportingConceptStableIds.length) add('ONE_PRIMARY_CONCEPT', 'CONCEPT_LISTED_TWICE');

  if (candidate.cellKey !== cell.cellKey) add('VALID_DOMAIN_TOPIC', 'CANDIDATE_FOR_ANOTHER_CELL');
  if (!ctx.hierarchyViolations) add('VALID_DOMAIN_TOPIC', 'HIERARCHY_CHECK_NOT_SUPPLIED');
  else for (const v of ctx.hierarchyViolations(cell)) add('VALID_DOMAIN_TOPIC', v);

  if (candidate.responseFormat !== cell.responseFormat) add('VALID_RESPONSE_FORMAT', 'FORMAT_IS_NOT_THE_CELLS');
  if (candidate.responseFormat === 'MULTIPLE_CHOICE') {
    if (candidate.options.length < optionCount.min || candidate.options.length > optionCount.max) add('VALID_RESPONSE_FORMAT', 'OPTION_COUNT_OUT_OF_RANGE');
    if (!candidate.options.some((o) => o.id === candidate.answerKey)) add('ANSWER_KEY_CONSISTENT', 'KEY_IS_NOT_AN_OPTION');
    if (new Set(candidate.options.map((o) => o.id)).size !== candidate.options.length) add('OPTIONS_UNIQUE', 'DUPLICATE_OPTION_ID');
    if (new Set(candidate.options.map((o) => norm(o.text))).size !== candidate.options.length) add('OPTIONS_UNIQUE', 'DUPLICATE_OPTION_TEXT');
    const wrong = candidate.options.filter((o) => o.id !== candidate.answerKey).map((o) => o.id);
    if (wrong.some((id) => !candidate.distractorRationales[id]) || Object.keys(candidate.distractorRationales).some((id) => !wrong.includes(id))) add('ANSWER_KEY_CONSISTENT', 'DISTRACTOR_RATIONALES_INCOMPLETE');
  } else {
    if (candidate.options.length > 0) add('VALID_RESPONSE_FORMAT', 'STUDENT_PRODUCED_HAS_OPTIONS');
    if (norm(candidate.answerKey).length === 0) add('ANSWER_KEY_CONSISTENT', 'EXPECTED_RESPONSE_MISSING');
  }
  if (norm(candidate.rationale).length < 10) add('ANSWER_KEY_CONSISTENT', 'RATIONALE_MISSING');

  if (!Number.isInteger(candidate.marks) || candidate.marks < marks.min || candidate.marks > marks.max) add('MARK_ALLOCATION', 'MARKS_OUT_OF_RANGE');
  if (candidate.difficultyBand !== cell.difficultyBand) add('DIFFICULTY_RANGE', 'BAND_IS_NOT_THE_CELLS');

  const stimulus = candidate.stimulusKey === null ? null : (ctx.stimuli ?? []).find((s) => s.stimulusKey === candidate.stimulusKey) ?? null;
  if (cell.stimulus.class === 'STANDALONE' && candidate.stimulusKey !== null) add('STIMULUS_REQUIREMENT', 'UNREQUESTED_STIMULUS');
  if (cell.stimulus.class === 'STIMULUS_REQUIRED' && candidate.stimulusKey === null) add('STIMULUS_REQUIREMENT', 'STIMULUS_MISSING');
  if (candidate.stimulusKey !== null && !stimulus) add('STIMULUS_REQUIREMENT', 'STIMULUS_NOT_IN_BATCH');
  if (stimulus && cell.stimulus.class !== 'STANDALONE' && stimulus.kind !== cell.stimulus.kind) add('STIMULUS_REQUIREMENT', 'STIMULUS_KIND_IS_NOT_THE_CELLS');
  for (const need of cell.assets) if (!candidate.assets.some((a) => a.kind === need.kind)) add('STIMULUS_REQUIREMENT', `ASSET_MISSING:${need.kind}`);

  // a mock cell serves a blueprint variant; until one is published the cell is unsupported for assembly
  if (MOCK_POOLS.has(cell.intendedPool)) {
    if (!cell.blueprint) add('SUPPORTED_BLUEPRINT_CELL', 'NO_BLUEPRINT');
    else if (!ctx.blueprintVariantPublished && !ctx.draftStage) add('SUPPORTED_BLUEPRINT_CELL', 'BLUEPRINT_VARIANT_NOT_PUBLISHED');
  }
  if (!(PRODUCTION_POOLS as readonly string[]).includes(cell.intendedPool)) add('VALID_POOL_TARGET', 'UNKNOWN_POOL');

  if (!candidate.provenance) add('PROVENANCE_PRESENT', 'PROVENANCE_MISSING');
  if ((candidate.lineage.kind === 'MODEL') !== (candidate.provenance === 'STUDYUS_GENERATED')) add('PROVENANCE_PRESENT', 'PROVENANCE_DOES_NOT_MATCH_LINEAGE');

  return { outcome: issues.length === 0 ? 'PASS' : 'FAIL', issues, checksRun: STRUCTURAL_CHECKS, isHumanReview: false };
}
