/**
 * Question Factory V5 -- what each model is told, and how its answer is read.
 *
 * The authoring request carries the nine parts of the generator policy (A assessment profile, B blueprint
 * requirement, C scope, D cognitive demand, E difficulty definition, F format, G originality, H learner language,
 * I prohibited patterns). It asks for the pedagogical objective to be met, not for a schema to be filled.
 *
 * The solver and the difficulty calibrator are given requests built from the LEARNER VIEW only: the type of their
 * input makes it impossible to pass them the key, the solution or the intended tier.
 *
 * Every answer is parsed strictly. Anything that is not exactly the expected object is an error, never a guess.
 *
 * Pure.
 */
import { z } from 'zod';
import { DIFFICULTY_TIERS, NOT_DIFFICULTY, type QuestionGenerationProfile } from './generation-profile';
import type { GenerationSpecification, LearnerView } from './item';
import type { ConstructInput, ConstructResult, DifficultyInput, DifficultyResult, DistractorInput, DistractorResult, EquivalenceInput, EquivalenceResult, SolverInput, SolverResult } from './pipeline';

export const PROMPT_POLICY_VERSION = 'qf-v5-prompts-1';
export interface Rendered { system: string; user: string }

const TIER_MEANING: Record<(typeof DIFFICULTY_TIERS)[number], string> = {
  FOUNDATIONAL: 'one idea applied directly; a prepared candidate of this population answers reliably',
  STANDARD: 'two or more ideas related, or one idea in a setting that must first be interpreted; typical of the middle of the paper',
  CHALLENGE: 'the method is not signposted; ideas must be integrated, transferred or justified; discriminates among the strongest candidates',
};
const lines = (xs: readonly string[]): string => xs.map((x) => `- ${x}`).join('\n');
const JSON_ONLY = 'Reply with one JSON object and nothing else: no prose before or after it, no code fence.';

export function authoringPrompt(spec: GenerationSpecification, p: QuestionGenerationProfile): Rendered {
  const selected = spec.itemFormat === 'SELECTED_RESPONSE' || spec.itemFormat === 'MULTI_SELECT';
  const system = [
    'You write original assessment items for StudyUs. You are an experienced item writer for the assessment described below.',
    'Your task is to meet the pedagogical objective: an item a specialist of this assessment would recognise as native to it. Filling the output format correctly is necessary and nowhere near sufficient.',
    'A mathematically correct item that reads like a generic textbook exercise is a failure.',
  ].join('\n');
  const user = [
    `A. ASSESSMENT\n${p.qualification} -- ${p.subject}${p.level ? ` (${p.level})` : ''} -- ${p.component}\nA candidate must:\n${lines(p.cognitiveModel.requiredMoves)}\nCalculator: ${p.calculator}. Response: ${p.responseLength}.`,
    `B. REQUIREMENT\nFormat: ${spec.itemFormat}. Marks: ${spec.intendedMarks}.${spec.commandTerm ? ` Command term: "${spec.commandTerm}" -- the learner must actually be asked to ${spec.commandTerm}, and the expected response must be what that term demands.` : ''}`,
    `C. SCOPE\nObjective(s): ${spec.objectiveIds.join(', ')}${spec.conceptIds.length ? `\nConcept(s): ${spec.conceptIds.join(', ')}` : ''}${spec.competencyIds.length ? `\nCompetency: ${spec.competencyIds.join(', ')}` : ''}\nStay inside this scope.`,
    `D. COGNITIVE DEMAND\n${spec.cognitiveTarget}\nAt least ${p.cognitiveModel.minReasoningTransitions[spec.intendedDifficulty]} meaningful reasoning transition(s). An arithmetic step is not a reasoning transition.`,
    `E. DIFFICULTY\nRelative to: ${p.difficultyPolicy.referencePopulation}.\nRequired level: ${TIER_MEANING[spec.intendedDifficulty]}.\nDifficulty comes from: ${p.difficultyPolicy.drivers.join('; ')}.\nNever from: ${NOT_DIFFICULTY.join('; ')}.`,
    `F. FORMAT\n${selected ? `Exactly ${p.optionCount} options labelled ${'ABCDEF'.slice(0, p.optionCount ?? 4).split('').join(', ')}; exactly one defensible best answer; worth ${p.markPolicy.selectedResponseMarks} mark. Every distractor is the result of a specific, plausible reasoning error, which you name. Options are parallel in length, style, grammar and units. No "all/none of the above".` : spec.itemFormat === 'MULTI_PART' ? 'Two or more parts. Later parts may build on earlier ones; say which. Part marks sum to the total. The rubric awards each mark for work the part actually demands.' : 'A constructed response. The rubric awards each mark for work the question actually demands.'}\nContext: ${p.contextPolicy.rule} ${spec.contextRequirement}\nMagnitudes, units, prices, times and sample sizes must be realistic.`,
    'G. ORIGINALITY\nWrite a new item. Do not reproduce or paraphrase any published examination question, passage, option set or explanation. Any passage, data set or source is your own original text.',
    `H. LEARNER LANGUAGE\nWrite everything the learner reads in ${p.language === 'es' ? 'Spanish' : 'English'}. "fullLearnerPrompt" is the complete question exactly as the learner sees it. Nothing about this request may appear in it: no level, tier, objective code, marks rationale, answer or note to a marker.`,
    `I. PROHIBITED\n${lines(p.forbiddenPatterns)}`,
    `OUTPUT\n${JSON_ONLY}\nFields: v (1), itemId ("${spec.slotKey}#${spec.attempt}"), slotKey ("${spec.slotKey}"), itemType ("${spec.itemFormat}"), language ("${p.language}"), stimulus (string or null), fullLearnerPrompt, parts (array of {label, prompt, marks, commandTerm, canonicalAnswer, dependsOn}), options (array of {label, text}), proposedAnswer, answerExpression (plain arithmetic giving the numeric answer, or null), acceptedUnits (array), solution, rubric (array of {marks, criterion}), distractorRationales (object: label -> the reasoning error), marks, commandTerm (string or null), provenance ("ORIGINAL_STUDYUS").`,
  ].join('\n\n');
  return { system, user };
}

const show = (v: LearnerView): string =>
  [v.stimulus ? `MATERIAL\n${v.stimulus}` : '', `QUESTION (${v.marks} mark${v.marks === 1 ? '' : 's'})\n${v.prompt}`, ...v.parts.map((p) => `${p.label} [${p.marks}] ${p.prompt}`), ...v.options.map((o) => `${o.label}. ${o.text}`)].filter(Boolean).join('\n');

export const solverPrompt = (i: SolverInput): Rendered => ({
  system: 'You are a candidate with full command of the subject. Answer the question exactly as set. You are not told the intended answer; nobody has checked this question. If it has no single defensible answer, or can reasonably be read in more than one way, say so.',
  user: `${show(i.view)}\n\n${JSON_ONLY}\n{"independentAnswer": the option label for a multiple-choice question, otherwise the final value, expression or answer, "solution": your working in brief, "confidence": "HIGH" | "MEDIUM" | "LOW", "ambiguityFlag": true | false, "ambiguityNote": string or null}`,
});

export const difficultyPrompt = (i: DifficultyInput): Rendered => ({
  system: 'You calibrate the difficulty of assessment items. You are not told what difficulty was intended. Judge only what the item demands of the stated population.',
  user: `POPULATION\n${i.population}\n\nWHAT MAKES AN ITEM HARD HERE\n${lines(i.drivers)}\nNOT DIFFICULTY\n${lines(NOT_DIFFICULTY)}\n\nLEVELS\n${DIFFICULTY_TIERS.map((t) => `${t}: ${TIER_MEANING[t]}`).join('\n')}\n\n${show(i.view)}\n\n${JSON_ONLY}\n{"actualDifficulty": one of the three levels, "alsoPlausible": a neighbouring level it could equally be read as, or null, "reasoningTransitions": the number of meaningful reasoning transitions (arithmetic steps do not count), "note": one sentence}`,
});

export const constructPrompt = (i: ConstructInput): Rendered => ({
  system: 'You are a senior examiner auditing whether an item genuinely belongs to a named assessment. Being correct and on-topic is not enough: the item must measure what this assessment measures, in the way it measures it.',
  user: `ASSESSMENT\n${i.brief.qualification} -- ${i.brief.subject}${i.brief.level ? ` (${i.brief.level})` : ''} -- ${i.brief.component}\nA candidate must:\n${lines(i.brief.requiredMoves)}\nContext rule: ${i.brief.contextRule}\n${i.brief.commandTerms.length ? `Command terms in use: ${i.brief.commandTerms.join(', ')}\n` : ''}Patterns that disqualify an item:\n${lines(i.brief.forbiddenPatterns)}\n\nWHAT THIS ITEM CLAIMS TO ELICIT\n${i.cognitiveTarget}${i.commandTerm ? `\nCommand term: ${i.commandTerm}` : ''}\n\n${show(i.view)}\n\n${JSON_ONLY}\n{"constructFit": "PASS" | "WEAK" | "FAIL", "authenticity": "HIGH" | "MEDIUM" | "LOW", "contextMaterial": true if removing or changing the situation would change the reasoning (true also when the item is properly abstract), "languageQuality": "PASS" | "FAIL", "plausibility": "PASS" | "WEAK" | "FAIL" for magnitudes, units and conclusions, "provenanceConcern": true if it closely resembles a published examination item or passage you recognise, "note": one sentence naming the decisive reason}`,
});

export const distractorPrompt = (i: DistractorInput): Rendered => ({
  system: 'You audit multiple-choice options. Decide which options a well-prepared candidate could defend as correct, and whether the wrong options are the product of plausible reasoning errors.',
  user: `${show(i.view)}\n\nKEYED OPTION: ${i.key}\n\n${JSON_ONLY}\n{"quality": "PASS" (one defensible answer, plausible distractors, no clue from length, grammar, units or order) | "WEAK" (one defensible answer, but a distractor is implausible or an option gives a clue) | "AMBIGUOUS" (more than one option, or none, is defensible), "defensibleOptions": array of labels, "note": one sentence}`,
});

export const equivalencePrompt = (i: EquivalenceInput): Rendered => ({
  system: 'You decide whether two answers to the same question say the same thing. Do not judge which is right.',
  user: `${show(i.view)}\n\nFIRST ANSWER\n${i.first}\n\nSECOND ANSWER\n${i.second}\n\n${JSON_ONLY}\n{"verdict": "EQUIVALENT" | "DIFFERENT" | "UNSURE"}`,
});

const TIER = z.enum(DIFFICULTY_TIERS);
const SolverSchema = z.object({ independentAnswer: z.string().min(1).max(4000), solution: z.string().max(8000), confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']), ambiguityFlag: z.boolean(), ambiguityNote: z.string().max(1000).nullable() }).strict();
const DifficultySchema = z.object({ actualDifficulty: TIER, alsoPlausible: TIER.nullable(), reasoningTransitions: z.number().int().min(0).max(12), note: z.string().max(1000) }).strict();
const ConstructSchema = z.object({ constructFit: z.enum(['PASS', 'WEAK', 'FAIL']), authenticity: z.enum(['HIGH', 'MEDIUM', 'LOW']), contextMaterial: z.boolean(), languageQuality: z.enum(['PASS', 'FAIL']), plausibility: z.enum(['PASS', 'WEAK', 'FAIL']), provenanceConcern: z.boolean(), note: z.string().max(1000) }).strict();
const DistractorSchema = z.object({ quality: z.enum(['PASS', 'WEAK', 'AMBIGUOUS']), defensibleOptions: z.array(z.string().regex(/^[A-F]$/)).max(6), note: z.string().max(1000) }).strict();
const EquivalenceSchema = z.object({ verdict: z.enum(['EQUIVALENT', 'DIFFERENT', 'UNSURE']) }).strict();

/** Strict: the whole reply must be one JSON object of the expected shape. A fenced or prefixed reply is malformed. */
export function parseReply<T>(schema: z.ZodType<T>, text: string): T {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) throw new Error('MALFORMED_REPLY: not a bare JSON object');
  let value: unknown;
  try { value = JSON.parse(t); } catch { throw new Error('MALFORMED_REPLY: invalid JSON'); }
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`MALFORMED_REPLY: ${r.error.issues.slice(0, 3).map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
  return r.data;
}
export const parseAuthored = (text: string): unknown => { const t = text.trim(); if (!t.startsWith('{') || !t.endsWith('}')) throw new Error('MALFORMED_REPLY: not a bare JSON object'); try { return JSON.parse(t); } catch { throw new Error('MALFORMED_REPLY: invalid JSON'); } };
export const parseSolver = (t: string): SolverResult => parseReply(SolverSchema, t);
export const parseDifficulty = (t: string): DifficultyResult => parseReply(DifficultySchema, t);
export const parseConstruct = (t: string): ConstructResult => parseReply(ConstructSchema, t);
export const parseDistractors = (t: string): DistractorResult => parseReply(DistractorSchema, t);
export const parseEquivalence = (t: string): EquivalenceResult => parseReply(EquivalenceSchema, t);
