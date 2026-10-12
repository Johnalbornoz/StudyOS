/**
 * Question Factory V5 -- the eleven stages, in order, for one specification.
 *
 *   1 specification   2 authoring   3 structure   4 independent solving   5 construct / authenticity
 *   6 difficulty      7 distractors 8 originality 9 blueprint fit         10 risk   11 decision
 *
 * Three rules shape the contracts below.
 *   - The solver is BLIND: it receives the learner view and nothing else. It never sees the generator's key or
 *     solution, so it cannot anchor on them. Only after it has answered are the two compared.
 *   - The difficulty calibrator is BLIND to the intended tier. It estimates; the pipeline compares.
 *   - A stage that did not complete is not a pass. A candidate missing any stage cannot be approved.
 *
 * The model-backed stages are injected (`StageProviders`): this module makes no call and holds no key.
 *
 * Pure.
 */
import { DIFFICULTY_TIERS, type DifficultyTier, type QuestionGenerationProfile } from './generation-profile';
import { learnerView, specificationHash, type CandidateItem, type GenerationSpecification, type LearnerView } from './item';
import { VALIDATOR_VERSION, compareAnswers, declaredArithmeticFindings, duplicateOf, optionFindings, plausibilityFindings, structuralFindings, type AnswerComparisonResult, type CorpusEntry, type DuplicateResult, type Finding } from './deterministic-stages';

export const PIPELINE_STAGES = ['SPECIFICATION', 'AUTHORING', 'STRUCTURE', 'INDEPENDENT_SOLVING', 'CONSTRUCT_AUTHENTICITY', 'DIFFICULTY', 'DISTRACTORS', 'ORIGINALITY', 'BLUEPRINT_FIT', 'RISK', 'DECISION'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export interface SolverResult { independentAnswer: string; solution: string; confidence: Confidence; ambiguityFlag: boolean; ambiguityNote: string | null }
export interface ConstructResult { constructFit: 'PASS' | 'WEAK' | 'FAIL'; authenticity: 'HIGH' | 'MEDIUM' | 'LOW'; contextMaterial: boolean; languageQuality: 'PASS' | 'FAIL'; plausibility: 'PASS' | 'WEAK' | 'FAIL'; provenanceConcern: boolean; note: string }
export interface DifficultyResult { actualDifficulty: DifficultyTier; /** The neighbouring tier the item could also be read as, if any. */ alsoPlausible: DifficultyTier | null; reasoningTransitions: number; note: string }
export interface DistractorResult { quality: 'PASS' | 'WEAK' | 'AMBIGUOUS'; defensibleOptions: string[]; note: string }
export interface EquivalenceResult { verdict: 'EQUIVALENT' | 'DIFFERENT' | 'UNSURE' }

/** What the construct judge is told about the assessment: the profile's public description, never a prompt. */
export interface AssessmentBrief { profileId: string; family: string; qualification: string; subject: string; level: string | null; component: string; requiredMoves: readonly string[]; contextRule: string; commandTerms: readonly string[]; forbiddenPatterns: readonly string[] }
export const assessmentBrief = (p: QuestionGenerationProfile): AssessmentBrief => ({ profileId: p.profileId, family: p.family, qualification: p.qualification, subject: p.subject, level: p.level, component: p.component, requiredMoves: p.cognitiveModel.requiredMoves, contextRule: p.contextPolicy.rule, commandTerms: p.commandTermPolicy.allowed, forbiddenPatterns: p.forbiddenPatterns });

export interface SolverInput { view: LearnerView }
export interface DifficultyInput { view: LearnerView; population: string; drivers: readonly string[] }
export interface ConstructInput { view: LearnerView; brief: AssessmentBrief; commandTerm: string | null; cognitiveTarget: string }
export interface DistractorInput { view: LearnerView; key: string }
export interface EquivalenceInput { view: LearnerView; first: string; second: string }

export const solverInput = (item: CandidateItem): SolverInput => ({ view: learnerView(item) });
export const difficultyInput = (item: CandidateItem, p: QuestionGenerationProfile): DifficultyInput => ({ view: learnerView(item), population: p.difficultyPolicy.referencePopulation, drivers: p.difficultyPolicy.drivers });

export interface StageProviders {
  solve(input: SolverInput): Promise<SolverResult>;
  judgeConstruct(input: ConstructInput): Promise<ConstructResult>;
  calibrateDifficulty(input: DifficultyInput): Promise<DifficultyResult>;
  judgeDistractors(input: DistractorInput): Promise<DistractorResult>;
  adjudicateEquivalence(input: EquivalenceInput): Promise<EquivalenceResult>;
}

export const REVIEW_DECISIONS = ['AUTO_APPROVE', 'HUMAN_REVIEW', 'AUTO_REJECT'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type ReviewPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TierFit = 'YES' | 'BORDERLINE' | 'NO';
export type Direction = 'MATCH' | 'TOO_EASY' | 'TOO_HARD';
export type AnswerMatch = 'CONFIRMED' | 'JUDGED_EQUIVALENT' | 'MISMATCH' | 'UNCONFIRMED';

export function tierFit(intended: DifficultyTier, d: DifficultyResult, profile: QuestionGenerationProfile): { tierFit: TierFit; direction: Direction } {
  const delta = DIFFICULTY_TIERS.indexOf(d.actualDifficulty) - DIFFICULTY_TIERS.indexOf(intended);
  if (delta !== 0) return { tierFit: d.alsoPlausible === intended ? 'BORDERLINE' : 'NO', direction: delta < 0 ? 'TOO_EASY' : 'TOO_HARD' };
  // the tier is named correctly, but the item does not contain the reasoning the profile asks of that tier
  if (d.reasoningTransitions < profile.cognitiveModel.minReasoningTransitions[intended]) return { tierFit: 'BORDERLINE', direction: 'TOO_EASY' };
  return { tierFit: 'YES', direction: 'MATCH' };
}

/** The compact record of section 30: enough to adjudicate an item without rerunning anything. */
export interface ValidationRecord {
  itemId: string;
  slotKey: string;
  specificationHash: string;
  attempt: number;
  family: string;
  subject: string;
  component: string;
  profileId: string;
  itemType: string;
  intendedDifficulty: DifficultyTier;
  actualDifficulty: DifficultyTier | null;
  tierFit: TierFit | null;
  direction: Direction | null;
  answerMatch: AnswerMatch;
  answerMethod: AnswerComparisonResult['method'] | 'NOT_RUN';
  answerConfidence: Confidence | null;
  independentAnswer: string | null;
  ambiguity: boolean;
  constructFit: ConstructResult['constructFit'] | null;
  authenticity: ConstructResult['authenticity'] | null;
  distractorQuality: DistractorResult['quality'] | 'NOT_APPLICABLE' | null;
  plausibility: 'PASS' | 'WEAK' | 'FAIL' | null;
  blueprintFit: 'PASS' | 'FAIL';
  originality: 'PASS' | 'FAIL';
  duplicateScore: number;
  duplicateOf: string | null;
  provenance: 'ORIGINAL_STUDYUS' | 'UNCLEAR';
  flags: string[];
  stagesCompleted: PipelineStage[];
  reviewDecision: ReviewDecision;
  reviewPriority: ReviewPriority | null;
  reviewReason: string;
  /** True when the rejection is a generation fault a second attempt may fix. */
  regenerable: boolean;
  profileVersion: string;
  validatorVersion: string;
}

interface Evidence {
  findings: Finding[];
  answer: AnswerComparisonResult | null;
  solver: SolverResult | null;
  equivalence: EquivalenceResult | null;
  construct: ConstructResult | null;
  difficulty: DifficultyResult | null;
  distractors: DistractorResult | null;
  duplicate: DuplicateResult;
  stageErrors: string[];
}

const BLUEPRINT_CODES = ['SLOT_MISMATCH', 'FORMAT_NOT_REQUESTED', 'FORMAT_NOT_IN_PROFILE', 'LANGUAGE_MISMATCH', 'MARKS_OUT_OF_PROFILE', 'MULTI_PART_NOT_IN_PROFILE', 'COMMAND_TERM_NOT_IN_PROFILE'];

/** Stages 10 and 11. Hard gates first; a rejection is never softened into a review. */
export function decide(spec: GenerationSpecification, profile: QuestionGenerationProfile, item: CandidateItem | null, e: Evidence): Pick<ValidationRecord, 'reviewDecision' | 'reviewPriority' | 'reviewReason' | 'regenerable' | 'answerMatch' | 'tierFit' | 'direction' | 'flags'> {
  const flags = [...new Set(e.findings.map((x) => x.code))];
  const fit = e.difficulty ? tierFit(spec.intendedDifficulty, e.difficulty, profile) : null;
  const answerMatch: AnswerMatch = !e.answer ? 'UNCONFIRMED' : e.answer.verdict === 'MATCH' ? 'CONFIRMED' : e.answer.verdict === 'MISMATCH' ? 'MISMATCH' : e.equivalence?.verdict === 'EQUIVALENT' ? 'JUDGED_EQUIVALENT' : e.equivalence?.verdict === 'DIFFERENT' ? 'MISMATCH' : 'UNCONFIRMED';
  const out = (reviewDecision: ReviewDecision, reviewPriority: ReviewPriority | null, reviewReason: string, regenerable = false) => ({ reviewDecision, reviewPriority, reviewReason, regenerable, answerMatch, tierFit: fit?.tierFit ?? null, direction: fit?.direction ?? null, flags });

  const hard = e.findings.filter((x) => x.severity === 'FAIL');
  if (hard.length) return out('AUTO_REJECT', null, `${hard[0].code}: ${hard[0].detail}`, true);
  if (e.stageErrors.length) return out('AUTO_REJECT', null, `STAGE_NOT_COMPLETED: ${e.stageErrors.join('; ')}`, false);
  // a contradicted key ends the candidate before the other judges run, so it is decided before their results are required
  if (item && e.solver && answerMatch === 'MISMATCH') return out('AUTO_REJECT', null, `ANSWER_MISMATCH: key "${item.proposedAnswer}" vs independent "${e.solver.independentAnswer}" (${e.answer?.method})`, true);
  if (!item || !e.solver || !e.construct || !e.difficulty) return out('AUTO_REJECT', null, 'STAGE_NOT_COMPLETED: a mandatory stage has no result', false);
  if (e.construct.provenanceConcern) return out('AUTO_REJECT', null, 'PROVENANCE_UNCLEAR: the item resembles published material', false);
  if (e.duplicate.verdict !== 'UNIQUE') return out('AUTO_REJECT', null, `DUPLICATE_${e.duplicate.verdict} of ${e.duplicate.closestId} (${e.duplicate.score})`, true);
  if (e.distractors?.quality === 'AMBIGUOUS') return out('AUTO_REJECT', null, `MULTIPLE_DEFENSIBLE_ANSWERS: ${e.distractors.defensibleOptions.join(', ')}`, true);
  if (e.construct.constructFit === 'FAIL') return out('AUTO_REJECT', null, `CONSTRUCT_FAIL: ${e.construct.note}`, true);
  if (e.construct.authenticity === 'LOW') return out('AUTO_REJECT', null, `AUTHENTICITY_LOW: ${e.construct.note}`, true);
  if (profile.contextPolicy.requirement === 'MATERIAL_REQUIRED' && !e.construct.contextMaterial) return out('AUTO_REJECT', null, 'CONTEXT_DECORATIVE: the situation can be removed without changing the reasoning', true);
  if (e.construct.languageQuality === 'FAIL') return out('AUTO_REJECT', null, 'LANGUAGE_QUALITY_FAIL', true);
  if (e.construct.plausibility === 'FAIL') return out('AUTO_REJECT', null, 'PLAUSIBILITY_FAIL', true);
  if (fit?.tierFit === 'NO') return out('AUTO_REJECT', null, `TIER_MISMATCH: intended ${spec.intendedDifficulty}, actual ${e.difficulty.actualDifficulty} (${fit.direction})`, true);

  // genuine grey zone, highest risk first
  if (e.solver.ambiguityFlag) return out('HUMAN_REVIEW', 'P0', `AMBIGUITY_FLAGGED: ${e.solver.ambiguityNote ?? 'the solver found the question open to more than one reading'}`);
  if (answerMatch === 'UNCONFIRMED') return out('HUMAN_REVIEW', 'P0', 'ANSWER_UNCONFIRMED: no deterministic normaliser applies and equivalence was not established');
  if (e.solver.confidence === 'LOW') return out('HUMAN_REVIEW', 'P0', 'SOLVER_LOW_CONFIDENCE');
  if (answerMatch === 'JUDGED_EQUIVALENT' && e.solver.confidence !== 'HIGH') return out('HUMAN_REVIEW', 'P0', 'ANSWER_EQUIVALENCE_JUDGED_NOT_PROVED');
  if (e.construct.constructFit === 'WEAK') return out('HUMAN_REVIEW', 'P1', `CONSTRUCT_WEAK: ${e.construct.note}`);
  if (!(profile.acceptableAuthenticity as readonly string[]).includes(e.construct.authenticity)) return out('HUMAN_REVIEW', 'P1', `AUTHENTICITY_${e.construct.authenticity}: ${e.construct.note}`);
  if (profile.automation === 'HUMAN_REVIEW_ALWAYS') return out('HUMAN_REVIEW', 'P1', 'FREE_RESPONSE_RUBRIC: this component has no deterministic key; a person certifies the rubric');
  if (fit?.tierFit === 'BORDERLINE') return out('HUMAN_REVIEW', 'P2', `TIER_BORDERLINE: intended ${spec.intendedDifficulty}, read as ${e.difficulty.actualDifficulty} (${fit.direction})`);
  if (e.distractors?.quality === 'WEAK') return out('HUMAN_REVIEW', 'P3', `DISTRACTORS_WEAK: ${e.distractors.note}`);
  if (e.construct.plausibility === 'WEAK') return out('HUMAN_REVIEW', 'P3', 'PLAUSIBILITY_WEAK');
  const soft = e.findings.filter((x) => x.severity === 'REVIEW');
  if (soft.length) return out('HUMAN_REVIEW', 'P3', `${soft[0].code}: ${soft[0].detail}`);
  return out('AUTO_APPROVE', null, 'ALL_GATES_PASS');
}

export interface PipelineDeps { stages: StageProviders; corpus: readonly CorpusEntry[] }
export interface CandidateOutcome { item: CandidateItem | null; record: ValidationRecord }

const attempt = async <T>(stage: string, errors: string[], run: () => Promise<T>): Promise<T | null> => {
  try { return await run(); } catch (err) { errors.push(`${stage}: ${err instanceof Error ? err.message : 'error'}`); return null; }
};

/** Stages 3 to 11 for one authored candidate. `raw` is whatever the generator returned, untrusted. */
export async function validateCandidate(raw: unknown, spec: GenerationSpecification, profile: QuestionGenerationProfile, deps: PipelineDeps): Promise<CandidateOutcome> {
  const done: PipelineStage[] = ['SPECIFICATION', 'AUTHORING'];
  const structure = structuralFindings(raw, spec, profile);
  done.push('STRUCTURE');
  const item = structure.item;
  const findings = [...structure.findings];
  const ev: Evidence = { findings, answer: null, solver: null, equivalence: null, construct: null, difficulty: null, distractors: null, duplicate: { verdict: 'UNIQUE', score: 0, closestId: null }, stageErrors: [] };
  const structurallySound = item !== null && !findings.some((f) => f.severity === 'FAIL');

  // a malformed item is rejected before any model is asked about it: no call is spent on it
  if (item && structurallySound) {
    findings.push(...declaredArithmeticFindings(item), ...optionFindings(item), ...plausibilityFindings(item));
    ev.solver = await attempt('INDEPENDENT_SOLVING', ev.stageErrors, () => deps.stages.solve(solverInput(item)));
    if (ev.solver) {
      ev.answer = compareAnswers(item, ev.solver.independentAnswer);
      if (ev.answer.verdict === 'UNDETERMINED') ev.equivalence = await attempt('INDEPENDENT_SOLVING', ev.stageErrors, () => deps.stages.adjudicateEquivalence({ view: learnerView(item), first: item.proposedAnswer, second: ev.solver!.independentAnswer }));
      done.push('INDEPENDENT_SOLVING');
    }
    // an answer the solver contradicts ends the candidate: the remaining judges are not paid to look at it
    if (ev.solver && ev.answer?.verdict !== 'MISMATCH' && !findings.some((f) => f.severity === 'FAIL')) {
      ev.construct = await attempt('CONSTRUCT_AUTHENTICITY', ev.stageErrors, () => deps.stages.judgeConstruct({ view: learnerView(item), brief: assessmentBrief(profile), commandTerm: item.commandTerm, cognitiveTarget: spec.cognitiveTarget }));
      if (ev.construct) done.push('CONSTRUCT_AUTHENTICITY');
      ev.difficulty = await attempt('DIFFICULTY', ev.stageErrors, () => deps.stages.calibrateDifficulty(difficultyInput(item, profile)));
      if (ev.difficulty) done.push('DIFFICULTY');
      if (item.itemType === 'SELECTED_RESPONSE' || item.itemType === 'MULTI_SELECT') {
        ev.distractors = await attempt('DISTRACTORS', ev.stageErrors, () => deps.stages.judgeDistractors({ view: learnerView(item), key: item.proposedAnswer }));
        if (ev.distractors) done.push('DISTRACTORS');
      } else done.push('DISTRACTORS');
    }
    ev.duplicate = duplicateOf(item, deps.corpus);
    done.push('ORIGINALITY', 'BLUEPRINT_FIT');
  }
  const decision = decide(spec, profile, item, ev);
  done.push('RISK', 'DECISION');
  const selected = item?.itemType === 'SELECTED_RESPONSE' || item?.itemType === 'MULTI_SELECT';
  return {
    item,
    record: {
      itemId: item?.itemId ?? `${spec.slotKey}#${spec.attempt}`, slotKey: spec.slotKey, specificationHash: specificationHash(spec), attempt: spec.attempt,
      family: profile.family, subject: profile.subject, component: profile.component, profileId: profile.profileId, itemType: item?.itemType ?? spec.itemFormat,
      intendedDifficulty: spec.intendedDifficulty, actualDifficulty: ev.difficulty?.actualDifficulty ?? null, tierFit: decision.tierFit, direction: decision.direction,
      answerMatch: decision.answerMatch, answerMethod: ev.answer?.method ?? 'NOT_RUN', answerConfidence: ev.solver?.confidence ?? null, independentAnswer: ev.solver?.independentAnswer ?? null, ambiguity: ev.solver?.ambiguityFlag ?? false,
      constructFit: ev.construct?.constructFit ?? null, authenticity: ev.construct?.authenticity ?? null,
      distractorQuality: !item ? null : selected ? ev.distractors?.quality ?? null : 'NOT_APPLICABLE', plausibility: ev.construct?.plausibility ?? null,
      blueprintFit: findings.some((f) => BLUEPRINT_CODES.includes(f.code)) ? 'FAIL' : 'PASS',
      originality: ev.duplicate.verdict === 'UNIQUE' && !ev.construct?.provenanceConcern ? 'PASS' : 'FAIL', duplicateScore: ev.duplicate.score, duplicateOf: ev.duplicate.verdict === 'UNIQUE' ? null : ev.duplicate.closestId,
      provenance: ev.construct?.provenanceConcern ? 'UNCLEAR' : 'ORIGINAL_STUDYUS',
      flags: decision.flags, stagesCompleted: done, reviewDecision: decision.reviewDecision, reviewPriority: decision.reviewPriority, reviewReason: decision.reviewReason, regenerable: decision.regenerable,
      profileVersion: spec.profileVersion, validatorVersion: VALIDATOR_VERSION,
    },
  };
}

export interface SpecificationOutcome { slotKey: string; attempts: CandidateOutcome[]; final: CandidateOutcome; firstAttemptPass: boolean; regenerated: boolean; specificationIssue: boolean }

/** One specification: a first attempt and, for a fixable generation fault, exactly one regeneration. Never more. */
export async function runSpecification(spec: GenerationSpecification, profile: QuestionGenerationProfile, author: (s: GenerationSpecification) => Promise<unknown>, deps: PipelineDeps): Promise<SpecificationOutcome> {
  const attempts: CandidateOutcome[] = [];
  for (const n of [0, 1] as const) {
    const s = { ...spec, attempt: n };
    let raw: unknown = null;
    let authoringError: string | null = null;
    try { raw = await author(s); } catch (err) { authoringError = err instanceof Error ? err.message : 'error'; }
    const outcome = await validateCandidate(raw, s, profile, deps);
    if (authoringError) { outcome.record.reviewReason = `AUTHORING_FAILED: ${authoringError}`; outcome.record.regenerable = true; }
    attempts.push(outcome);
    if (outcome.record.reviewDecision !== 'AUTO_REJECT' || !outcome.record.regenerable) break;
  }
  const final = attempts[attempts.length - 1];
  return { slotKey: spec.slotKey, attempts, final, firstAttemptPass: attempts[0].record.reviewDecision === 'AUTO_APPROVE', regenerated: attempts.length > 1, specificationIssue: attempts.length > 1 && final.record.reviewDecision === 'AUTO_REJECT' };
}
