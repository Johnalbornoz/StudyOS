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

export const PROMPT_POLICY_VERSION = 'qf-v5-prompts-6';
export interface Rendered { system: string; user: string }

const TIER_MEANING: Record<(typeof DIFFICULTY_TIERS)[number], string> = {
  FOUNDATIONAL: 'one idea applied directly; a prepared candidate of this population answers reliably',
  STANDARD: 'two or more ideas related, or one idea in a setting that must first be interpreted; typical of the middle of the paper',
  CHALLENGE: 'the method is not signposted; ideas must be integrated, transferred or justified; discriminates among the strongest candidates',
};
const lines = (xs: readonly string[]): string => xs.map((x) => `- ${x}`).join('\n');
const JSON_ONLY = 'Reply with one JSON object and nothing else: no prose before or after it, no code fence.';

export function authoringPrompt(spec: GenerationSpecification, p: QuestionGenerationProfile, previousFailure: string | null = null): Rendered {
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
    `H. LEARNER LANGUAGE\nWrite everything the learner reads in ${p.language === 'es' ? 'Spanish' : 'English'}. Nothing about this request may appear in it: no level, tier, objective code, marks rationale, answer or note to a marker.`,
    `I. PROHIBITED\n${lines(p.forbiddenPatterns)}`,
    `OUTPUT\n${JSON_ONLY}\nWrite mathematics as plain text with Unicode (x², √, ≤, π, fractions as 3/4). No LaTeX and no HTML; Markdown only for a data table.\nBEFORE YOU REPLY, CHECK YOUR OWN ITEM: solve it again from the learner's text alone; recompute every number and every comparison written inside every option, part and solution; confirm the keyed answer is entirely true and every other option is definitely wrong. If any check fails, rewrite the item.\nExactly these fields and no others:\n- v: 1\n- itemId: "${spec.slotKey}#${spec.attempt}"\n- slotKey: "${spec.slotKey}"\n- itemType: "${spec.itemFormat}"\n- language: "${p.language}"\n- stimulus: the passage, data table or situation the learner reads first, or null when the question needs none\n- fullLearnerPrompt: the question itself (for a multi-part item: the shared stem). The learner sees the stimulus and then this; do NOT repeat the stimulus in it. Without a stimulus it must be complete on its own.\n- parts: ${spec.itemFormat === 'MULTI_PART' ? 'array of {label ("(a)", "(b)", ...), prompt, marks, commandTerm (one of the terms above, and the word must appear in that part\'s prompt), canonicalAnswer, dependsOn (labels of earlier parts it uses, or [])}' : '[]'}\n- options: ${selected ? 'array of {label, text}' : '[]'}\n- proposedAnswer: a JSON string -- ${selected ? 'the label of the correct option, alone' : 'the final answer (for a multi-part item, the answers of all parts in order)'}\n- answerExpression: plain arithmetic (digits, + - * / ^, parentheses, sqrt()) whose value IS the final numeric answer, or null if the answer is not a single number\n- acceptedUnits: []\n- solution: the full worked solution\n- rubric: ${selected ? '[]' : `array of {marks, criterion}; the marks sum to ${spec.intendedMarks}`}\n- distractorRationales: ${selected ? 'object mapping each WRONG option label to the reasoning error that produces it' : '{}'}\n- marks: ${spec.intendedMarks}\n- commandTerm: ${spec.commandTerm && spec.itemFormat !== 'MULTI_PART' ? `"${spec.commandTerm}" (the word must appear in fullLearnerPrompt)` : spec.commandTerm ? `"${spec.commandTerm}"` : 'null'}\n- provenance: "ORIGINAL_STUDYUS"`,
    ...(previousFailure ? [`A PREVIOUS ATTEMPT AT THIS REQUIREMENT WAS REJECTED\n${previousFailure.slice(0, 300)}\nWrite a different item that does not have this fault.`] : []),
  ].join('\n\n');
  return { system, user };
}

const show = (v: LearnerView): string =>
  [v.stimulus ? `MATERIAL\n${v.stimulus}` : '', `QUESTION (${v.marks} mark${v.marks === 1 ? '' : 's'})\n${v.prompt}`, ...v.parts.map((p) => `${p.label} [${p.marks}] ${p.prompt}`), ...v.options.map((o) => `${o.label}. ${o.text}`)].filter(Boolean).join('\n');

export const solverPrompt = (i: SolverInput): Rendered => ({
  system: 'You are a subject specialist checking a newly written practice question for an educational question bank. Solve it yourself, exactly as set. You are not shown the author\'s answer. If the question has no single defensible answer, or can reasonably be read in more than one way, say so.',
  user: `${show(i.view)}\n\n${JSON_ONLY}\n{"solution": a worked solution a student could follow, with each calculation written out and the result checked against every condition of the question, "independentAnswer": the option label alone for a multiple-choice question, otherwise the final value, expression or answer, "confidence": "HIGH" | "MEDIUM" | "LOW", "ambiguityFlag": true | false, "ambiguityNote": string or null}`,
});

export const difficultyPrompt = (i: DifficultyInput): Rendered => ({
  system: 'You calibrate the difficulty of assessment items. You are not told what difficulty was intended. Judge only what the item demands of the stated population.',
  user: `POPULATION\n${i.population}\n\nWHAT MAKES AN ITEM HARD HERE\n${lines(i.drivers)}\nNOT DIFFICULTY\n${lines(NOT_DIFFICULTY)}\n\nLEVELS\n${DIFFICULTY_TIERS.map((t) => `${t}: ${TIER_MEANING[t]}`).join('\n')}\n\n${show(i.view)}\n\n${JSON_ONLY}\n{"note": the reasoning transitions a candidate must make, listed briefly, "reasoningTransitions": how many there are (arithmetic steps do not count), "actualDifficulty": one of the three levels, "alsoPlausible": a neighbouring level it could equally be read as, or null}`,
});

export const constructPrompt = (i: ConstructInput): Rendered => ({
  system: 'You are a senior examiner auditing whether an item genuinely belongs to a named assessment. Being correct and on-topic is not enough: the item must measure what this assessment measures, in the way it measures it.',
  user: `ASSESSMENT\n${i.brief.qualification} -- ${i.brief.subject}${i.brief.level ? ` (${i.brief.level})` : ''} -- ${i.brief.component}\nA candidate must:\n${lines(i.brief.requiredMoves)}\nContext rule: ${i.brief.contextRule}\n${i.brief.commandTerms.length ? `Command terms in use: ${i.brief.commandTerms.join(', ')}\n` : ''}Patterns that disqualify an item:\n${lines(i.brief.forbiddenPatterns)}\n\nWHAT THIS ITEM CLAIMS TO ELICIT\n${i.cognitiveTarget}${i.commandTerm ? `\nCommand term: ${i.commandTerm}` : ''}\n\n${show(i.view)}\n\n${JSON_ONLY}\n{"note": two or three sentences weighing the item against the assessment, naming the decisive reason, "constructFit": "PASS" | "WEAK" | "FAIL", "authenticity": "HIGH" | "MEDIUM" | "LOW", "contextMaterial": true if removing or changing the situation would change the reasoning (true also when the item is properly abstract), "languageQuality": "PASS" | "FAIL", "plausibility": "PASS" | "WEAK" | "FAIL" for magnitudes, units and conclusions (FAIL only for something impossible or absurd, which you name in the note), "provenanceConcern": true if it closely resembles a published examination item or passage you recognise}`,
});

export const distractorPrompt = (i: DistractorInput): Rendered => ({
  system: 'You audit multiple-choice options. Decide which options a well-prepared candidate could defend as correct, and whether the wrong options are the product of plausible reasoning errors.',
  user: `${show(i.view)}\n\nKEYED OPTION: ${i.key}\n\n${JSON_ONLY}\n{"note": for each option, one clause on whether it can be defended, "defensibleOptions": array of labels, "quality": "PASS" (one defensible answer, plausible distractors, no clue from length, grammar, units or order) | "WEAK" (one defensible answer, but a distractor is implausible or an option gives a clue) | "AMBIGUOUS" (more than one option, or none, is defensible)}`,
});

export const equivalencePrompt = (i: EquivalenceInput): Rendered => ({
  system: 'You decide whether two answers to the same question say the same thing. Do not solve the question and do not judge which is right: compare the two answers only. Different final values, or a different conclusion, are DIFFERENT; the same values in another form or wording are EQUIVALENT.',
  user: `${show(i.view)}\n\nFIRST ANSWER\n${i.first}\n\nSECOND ANSWER\n${i.second}\n\n${JSON_ONLY}\n{"verdict": "EQUIVALENT" | "DIFFERENT" | "UNSURE"}`,
});

const TIER = z.enum(DIFFICULTY_TIERS);
const SolverSchema = z.object({ independentAnswer: z.string().min(1).max(4000), solution: z.string().max(20000), confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']), ambiguityFlag: z.boolean(), ambiguityNote: z.string().max(1000).nullable() }).strict();
const DifficultySchema = z.object({ actualDifficulty: TIER, alsoPlausible: TIER.nullable(), reasoningTransitions: z.number().int().min(0).max(12), note: z.string().max(4000) }).strict();
const ConstructSchema = z.object({ constructFit: z.enum(['PASS', 'WEAK', 'FAIL']), authenticity: z.enum(['HIGH', 'MEDIUM', 'LOW']), contextMaterial: z.boolean(), languageQuality: z.enum(['PASS', 'FAIL']), plausibility: z.enum(['PASS', 'WEAK', 'FAIL']), provenanceConcern: z.boolean(), note: z.string().max(4000) }).strict();
const DistractorSchema = z.object({ quality: z.enum(['PASS', 'WEAK', 'AMBIGUOUS']), defensibleOptions: z.array(z.string().regex(/^[A-F]$/)).max(6), note: z.string().max(4000) }).strict();
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

/** Reply shapes for a provider's structured-output mode. The strict parsers above remain the authority. */
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const oneOf = (...values: string[]) => ({ type: 'string', enum: values });
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
export const REPLY_SCHEMAS = {
  SOLVER: obj({ solution: { type: 'string' }, independentAnswer: { type: 'string' }, confidence: oneOf('HIGH', 'MEDIUM', 'LOW'), ambiguityFlag: { type: 'boolean' }, ambiguityNote: nullable({ type: 'string' }) }),
  DIFFICULTY: obj({ note: { type: 'string' }, reasoningTransitions: { type: 'integer' }, actualDifficulty: oneOf(...DIFFICULTY_TIERS), alsoPlausible: nullable(oneOf(...DIFFICULTY_TIERS)) }),
  CONSTRUCT: obj({ note: { type: 'string' }, constructFit: oneOf('PASS', 'WEAK', 'FAIL'), authenticity: oneOf('HIGH', 'MEDIUM', 'LOW'), contextMaterial: { type: 'boolean' }, languageQuality: oneOf('PASS', 'FAIL'), plausibility: oneOf('PASS', 'WEAK', 'FAIL'), provenanceConcern: { type: 'boolean' } }),
  DISTRACTORS: obj({ note: { type: 'string' }, defensibleOptions: { type: 'array', items: oneOf('A', 'B', 'C', 'D', 'E', 'F') }, quality: oneOf('PASS', 'WEAK', 'AMBIGUOUS') }),
  EQUIVALENCE: obj({ verdict: oneOf('EQUIVALENT', 'DIFFERENT', 'UNSURE') }),
} as const;
export type ReplyKind = keyof typeof REPLY_SCHEMAS;
