/**
 * QB-R2F -- OFFLINE REMEDIATION. NO NETWORK, NO PROVIDER.
 *
 * The heart of this file is the REGRESSION CORPUS: copies of the actual provider responses and candidates of QB-R2D
 * and QB-R2E that exhibited each known defect (`tests/fixtures/qb-r2f/known-defects.json`, with provenance). For
 * every defect there is a test that the NEW harness (generator version 3) refuses it or the NEW validators
 * (revision 4) catch it with the right gate and class -- and paired tests on sound items that must still pass.
 *
 * Nothing here rescores a run. QB-R2D and QB-R2E stand as scored by the revisions that scored them.
 */
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { ITEM_DEMAND_POLICY, itemDemandIssues } from '@/lib/assessment-adaptation/item-demand-policy';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { SPECIFICATION_PROVIDER_JSON_SCHEMA, SPECIFICATION_TEMPLATE_REGISTRY_V2 } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v2';
import {
  EVIDENCE_GUIDANCE_V3, generateFromSpecificationV3, ITEM_WRITING_RULES_V3, renderSpecificationPromptV3, SPECIFICATION_RESPONSE_RULES_V3, SPECIFICATION_TEMPLATE_REGISTRY_V3, SpecificationGenerationV3Error, TEMPLATE_V3_CONSTRUCTED, TEMPLATE_V3_NUMERIC, TEMPLATE_V3_SELECTED,
} from '@/lib/exam-core/question-bank/production/generator/specification-generation-v3';
import { constructIntegrityOf, constructVocabularyOf } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { validateSpecificationCandidateR3 } from '@/lib/exam-core/question-bank/production/specification-validators-r3';
import { BATCH_DIVERSITY_RULE, ITEM_WRITING_HEURISTIC_R4, itemWritingFlagsR4, optionsStatingTheSameNumber, quadraticEquationStatedIn, scenarioSimilarity, validateSpecificationCandidateR4, type SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { GUARD_PRICE_BASIS } from '../../scripts/operations/qb-r2d/budget';
import { storedR2dSelection } from '../../scripts/operations/qb-r2d/stored-selection';
import { computeFreezeManifest, readStoredManifest } from '../../scripts/operations/qb-r2e/freeze';
import { PRE_REGISTRATION } from '../../scripts/operations/qb-r2e/gates';
import { buildR2eSelection } from '../../scripts/operations/qb-r2e/selection';
import { PlanDoesNotFitTheCapError, planBudget, R2F_CUMULATIVE_CAP_USD, R2F_MAX_AVOID_GROWTH_CHARACTERS, R2F_MAX_CALLS, R2F_MAX_OUTPUT_TOKENS, r2fInputTokenUpperBound, r2fWorstCaseCallUsd } from '../../scripts/operations/qb-r2f/budget';
import { runDiagnostic } from '../../scripts/operations/qb-r2f/diagnostic';
import { loadR2fEvidence, priorSpendUsdGuardBasis } from '../../scripts/operations/qb-r2f/evidence';
import { computeR2fFreezeManifest, R2F_FREEZE_ENTRY_FILES, r2fFreezeVerdict, r2fFrozenSourceFiles, readStoredR2fManifest, verifyR2fFreeze, type R2fFreezeManifest } from '../../scripts/operations/qb-r2f/freeze';
import { evaluateR2fGates, R2F_DELTAS, R2F_PRE_REGISTRATION } from '../../scripts/operations/qb-r2f/gates';
import { AVOID_SCENARIO_MAX_CHARACTERS, avoidListsFor, nextUnitToCall, planR2fUnit, QB_R2F_BATCH_KEY, r2fMalformedCodeOf, r2fPolicyFor, runQbR2f, type R2fRecordingFile } from '../../scripts/operations/qb-r2f/pipeline';
import { r2fPlanBudget, transportBehindTheGates } from '../../scripts/operations/qb-r2f/run';
import { buildR2fSelection, R2F_APPROACH_FAMILY, R2F_APPROACH_PAIRS, R2F_SAME_FAMILY } from '../../scripts/operations/qb-r2f/selection';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const MODEL = 'fixture-model';
const NOW = '2026-10-13T09:00:00.000Z';
const FIX = JSON.parse(read('tests/fixtures/qb-r2f/known-defects.json')) as { about: string; source: Record<string, { file: string; runId: string }>; qbR2eRawResponses: Record<string, string>; qbR2dCandidates: Record<string, { candidate: SpecificationCandidate; stimulus: CandidateStimulus | null }>; qbR2dRawResponsesWithTheFixedInstruction: Record<string, string> };
const R2E = buildR2eSelection();
const R2D_SPECS = new Map(storedR2dSelection().map((s) => [s.specification.specificationId, s.specification]));
const r2eSpec = (unitKey: string): AdaptationSpecification => R2E.find((a) => unitKey.startsWith(`${a.selectionKey}#`))!.specification;
const NO_AVOID = { parameterSets: [], scenarios: [] };

type Wire = { stimulus: { text: string | null; tables: Array<{ rows: unknown[][] }> } | null; item: Record<string, unknown> & { stem: string; options: Array<{ id: string; text: string }>; answers: Array<Record<string, unknown>>; parameters: Array<{ symbol: string; value: number }> } };
/** A recorded QB-R2E provider response (optionally changed for a synthetic variant) put through the NEW harness. */
async function throughV3(unitKey: string, mutate?: (w: Wire) => void) {
  const specification = r2eSpec(unitKey);
  const construct = (specification.invariants.construct as { construct: string }).construct;
  const wire = JSON.parse(FIX.qbR2eRawResponses[unitKey]) as Wire;
  mutate?.(wire);
  const input = { unit: { unitKey, specification, attempt: 1, avoid: NO_AVOID }, constructVocabulary: constructVocabularyOf(construct), constructIntegrity: constructIntegrityOf(construct), policy: r2fPolicyFor(MODEL, specification.variable.language), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V3 };
  const hash = renderSpecificationPromptV3({ ...input, provider: new RecordedResponseProvider('recorded:fixture', MODEL, {}) }).promptHash;
  return generateFromSpecificationV3({ ...input, provider: new RecordedResponseProvider('recorded:fixture', MODEL, { [hash]: JSON.stringify(wire) }), runId: 'fixture-run', batchKey: QB_R2F_BATCH_KEY, now: NOW });
}
const refusalOf = async (unitKey: string, mutate?: (w: Wire) => void): Promise<string> => { try { await throughV3(unitKey, mutate); return 'NO_REFUSAL'; } catch (e) { return e instanceof SpecificationGenerationV3Error ? `${e.code}:${e.detail}` : `OTHER:${(e as Error).message}`; } };
/** Revision 4 on a recorded QB-R2E response; `peers` are other recorded units of the same batch. */
async function r4(unitKey: string, mutate?: (w: Wire) => void, peerKeys: string[] = []): Promise<SpecificationItemValidationR4> {
  const r = await throughV3(unitKey, mutate);
  const peers = await Promise.all(peerKeys.map((k) => throughV3(k)));
  return validateSpecificationCandidateR4({ candidate: r.candidate, specification: r2eSpec(unitKey), stimulus: r.stimulus, siblings: [r.candidate, ...peers.map((p) => p.candidate)] });
}
/** Revision 4 on a stored QB-R2D candidate, against the specification stored with that run. */
function r4OnR2d(unitKey: string, peerKeys: string[] = []): SpecificationItemValidationR4 {
  const f = FIX.qbR2dCandidates[unitKey];
  return validateSpecificationCandidateR4({ candidate: f.candidate, specification: R2D_SPECS.get(f.candidate.specificationId)!, stimulus: f.stimulus, siblings: [f.candidate, ...peerKeys.map((k) => FIX.qbR2dCandidates[k].candidate)] });
}

describe('the fixture corpus: copies of real recorded responses, with provenance', () => {
  it('every fixture is byte-identical to what the run it names recorded', () => {
    expect(FIX.about).toMatch(/COPIES of provider responses and candidates recorded in QB-R2D and QB-R2E/);
    const r2e = JSON.parse(read('docs/exams/question-bank/pilots/qb-r2e/recorded-live-responses.json')) as { run: { runId: string }; responses: Array<{ unitKey: string; rawText: string }> };
    expect(FIX.source.qbR2e.runId).toBe(r2e.run.runId);
    for (const [unitKey, raw] of Object.entries(FIX.qbR2eRawResponses)) expect(r2e.responses.find((r) => r.unitKey === unitKey)!.rawText === raw, unitKey).toBe(true);
    const r2d = JSON.parse(read('docs/exams/question-bank/pilots/qb-r2d/generated-batch.json')) as { run: { runId: string }; candidates: SpecificationCandidate[] };
    expect(FIX.source.qbR2d.runId).toBe(r2d.run.runId);
    for (const [unitKey, f] of Object.entries(FIX.qbR2dCandidates)) expect(JSON.stringify(r2d.candidates.find((c) => c.unitKey === unitKey)), unitKey).toBe(JSON.stringify(f.candidate));
    expect([Object.keys(FIX.qbR2eRawResponses).length, Object.keys(FIX.qbR2dCandidates).length, Object.keys(FIX.qbR2dRawResponsesWithTheFixedInstruction).length]).toEqual([22, 12, 2]);
  });
});

describe('1 -- V1: options that share only a label numeral are not "the same number"', () => {
  it('QB-R2E 18 a1 (the false positive): revision 3 fails it, revision 4 does not', async () => {
    const v = await r4('18.probability-compare.icfes#a1');
    expect(v.revision3.revision2.structural.issues).toEqual(['OPTIONS_STATE_THE_SAME_NUMBER:A,C', 'OPTIONS_STATE_THE_SAME_NUMBER:B,D']);
    expect([v.revision3.gates.structural, v.gates.structural, v.revision4.structuralIssues]).toEqual(['FAIL', 'PASS', []]);
    expect(v.revision4.changesFromRevision3.find((c) => c.gate === 'structural')).toMatchObject({ from: 'FAIL', to: 'PASS', why: 'V1: options that share only a label numeral are not the same answer' });
  });
  it('QB-R2D 12 a1 (the true positive, 1/3 and 3/9) is STILL caught; its sound regeneration still passes', () => {
    expect(r4OnR2d('12.probability-single-event.icfes#a1').revision4.structuralIssues).toEqual(['OPTIONS_STATE_THE_SAME_NUMBER:A,D']);
    expect(r4OnR2d('12.probability-single-event.icfes#a1').gates.structural).toBe('FAIL');
    expect(r4OnR2d('12.probability-single-event.icfes#a2').gates.structural).toBe('PASS');
  });
  it('the corrected rule, on minimal synthetic options', () => {
    const o = (...texts: string[]) => texts.map((text, i) => ({ id: 'ABCD'[i], text }));
    expect(optionsStatingTheSameNumber(o('1/3', '3/9', '3/4', '1/4'))).toEqual(['OPTIONS_STATE_THE_SAME_NUMBER:A,B']);
    expect(optionsStatingTheSameNumber(o('110 dólares', '110', '90 dólares', '35'))).toEqual(['OPTIONS_STATE_THE_SAME_NUMBER:A,B']);
    expect(optionsStatingTheSameNumber(o('0,5', '1/2', '2', '5'))).toEqual(['OPTIONS_STATE_THE_SAME_NUMBER:A,B']);
    expect(optionsStatingTheSameNumber(o('El juego 1 ofrece la mayor posibilidad; la afirmación es falsa.', 'El juego 1 ofrece la mayor posibilidad; la afirmación es verdadera.', 'El juego 2; falsa', 'El juego 2; verdadera'))).toEqual([]);
    expect(optionsStatingTheSameNumber(o('Option 1', 'Option 2', 'Both', 'Neither'))).toEqual([]);
    expect(optionsStatingTheSameNumber(o('3 metros', '3 segundos', '4 metros', '5 metros'))).toEqual([]);
  });
});

describe('2 -- V2: a key is judged against the equation the item STATES; unread means human review, never "rule-verified"', () => {
  it('QB-R2E 13 a1 (the wrong key classed DETERMINISTIC_RULE_VERIFIED): now FAILED, KEY_CONTRADICTED, and the construct fails too', async () => {
    const v = await r4('13.quadratic-factorising.cambridge-p1#a1');
    expect(v.revision3.revision2.answerKey.units.map((u) => `${u.label}:${u.class}`)).toEqual(['a:HUMAN_REVIEW_REQUIRED', 'b:DETERMINISTIC_RULE_VERIFIED', 'c:DETERMINISTIC_RULE_VERIFIED']);
    expect(v.revision4.answerUnits.map((u) => `${u.label}:${u.class}:${u.failureKind}`)).toEqual(['a:HUMAN_REVIEW_REQUIRED:null', 'b:FAILED:KEY_CONTRADICTED', 'c:FAILED:KEY_CONTRADICTED']);
    expect(v.revision4.answerUnits[2].issues).toEqual(['KEYED_ROOT_DOES_NOT_SATISFY_THE_STATED_EQUATION:-2.5,4.5 in 3x^2+-6x+-33=0']);
    expect([v.gates.answerKey, v.gates.constructPreservation, v.revision4.constructIssues]).toEqual(['FAILED', 'FAIL', ['STATED_EQUATION_DOES_NOT_HAVE_THE_DECLARED_ROOTS:3,-6,-33']]);
    // it is ALSO the fixture of "non-integer coefficients": revision 2's parameter constraint still catches it in profile compliance
    expect(v.revision3.revision2.profileCompliance.issues).toEqual(['PARAMETER_CONSTRAINT:COEFFICIENTS_NOT_INTEGERS']);
  });
  it('reads an equation whichever side its terms are on', () => {
    expect(quadraticEquationStatedIn('Consider the equation 3x^2 - 6x = 33.')).toEqual({ A: 3, B: -6, C: -33 });
    expect(quadraticEquationStatedIn('Solve x^2 = 5x - 6')).toEqual({ A: 1, B: -5, C: 6 });
    expect(quadraticEquationStatedIn('Resuelve 2x² − 7x + 3 = 0.')).toEqual({ A: 2, B: -7, C: 3 });
    expect(quadraticEquationStatedIn('Resuelve 4x^2 + 4x = 15 y escribe la raíz mayor.')).toEqual({ A: 4, B: 4, C: -15 });
    expect(quadraticEquationStatedIn('The product of two consecutive numbers is 12.')).toBeNull();
    expect(quadraticEquationStatedIn('y = 3x + 2')).toBeNull();
  });
  it('SOUND items still pass: a correct equation that is not in "= 0" form is verified; QB-R2E 13 a2 and 14 keep their classes', async () => {
    const moved = await r4('13.quadratic-factorising.cambridge-p1#a2', (w) => { w.item.stem = w.item.stem.replace('2x^2 + 2x - 12 = 0', '2x^2 + 2x = 12'); });
    const a2 = await r4('13.quadratic-factorising.cambridge-p1#a2');
    expect(moved.revision4.answerUnits.map((u) => u.class)).toEqual(['DETERMINISTIC_RULE_VERIFIED', 'DETERMINISTIC_RULE_VERIFIED', 'DETERMINISTIC_RULE_VERIFIED']);
    // revision 2 solves only the '= 0' form (MACHINE_VERIFIED); with a term moved, revision 4 checks the keyed roots IN the stated equation and leaves the class at rule-verified
    expect(a2.revision4.answerUnits.map((u) => u.class)).toEqual(['DETERMINISTIC_RULE_VERIFIED', 'MACHINE_VERIFIED', 'MACHINE_VERIFIED']);
    expect([moved.gates.answerKey, moved.gates.constructPreservation, moved.revision4.constructIssues]).toEqual(['DETERMINISTIC_RULE_VERIFIED', 'PASS', []]);
    expect([a2.gates.answerKey, a2.gates.constructPreservation, a2.revision4.changesFromRevision3]).toEqual(['DETERMINISTIC_RULE_VERIFIED', 'PASS', []]);
    const numeric = await r4('14.quadratic-factorising.paa#a1');
    expect([numeric.gates.answerKey, numeric.revision4.changesFromRevision3]).toEqual(['MACHINE_VERIFIED', []]);
  });
  it('an equation that cannot be read: the key is HUMAN_REVIEW_REQUIRED, whatever it agrees with', async () => {
    const unread = await r4('13.quadratic-factorising.cambridge-p1#a2', (w) => { w.item.stem = 'Consider the quadratic equation whose graph is described in the notes of the lesson.'; });
    expect(unread.revision3.revision2.answerKey.units.some((u) => u.class === 'DETERMINISTIC_RULE_VERIFIED' || u.class === 'MACHINE_VERIFIED')).toBe(true);
    expect(unread.revision4.answerUnits.map((u) => u.class)).toEqual(['HUMAN_REVIEW_REQUIRED', 'HUMAN_REVIEW_REQUIRED', 'HUMAN_REVIEW_REQUIRED']);
    expect(unread.revision4.answerUnits[1].revision4).toMatch(/^STATED_EQUATION_NOT_READ/);
    // a keyed root that is a root of the declaration but not of the stated equation, in a numeric item
    const wrong = await r4('14.quadratic-factorising.paa#a1', (w) => { w.item.stem = w.item.stem.replace('4x² - 8x - 21 = 0', '4x² - 8x = 20'); });
    expect(wrong.revision4.answerUnits[0]).toMatchObject({ class: 'FAILED', failureKind: 'KEY_CONTRADICTED' });
  });
});

describe('3 -- no fixed instruction in any template: nothing is shown and then forbidden', () => {
  it('version 3 has no fixed instruction, in the numeric-entry template or any other; version 2 still has the trap it was recorded with', () => {
    for (const t of SPECIFICATION_TEMPLATE_REGISTRY_V3) { expect(t.constraints.fixedInstruction).toBe('NONE'); expect('fixedInstruction' in t).toBe(false); }
    expect(SPECIFICATION_TEMPLATE_REGISTRY_V3.map((t) => `${t.id}@${t.version}`)).toEqual(['spec-selected-response@3', 'spec-numeric-entry@3', 'spec-constructed-response@3']);
    const prompt = renderSpecificationPromptV3({ unit: { unitKey: 'u', specification: r2eSpec('16.quadratic-optimum.pisa#a1'), attempt: 1, avoid: NO_AVOID }, constructVocabulary: constructVocabularyOf('QUADRATIC_MODEL_VERTEX_OPTIMUM'), constructIntegrity: [], policy: r2fPolicyFor(MODEL, 'es'), provider: new RecordedResponseProvider('r', MODEL, {}), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V3 });
    expect(JSON.stringify(prompt.prompt)).not.toMatch(/Escribe tu respuesta como un número|Write your answer as a number|Selecciona la única opción|Show your working/);
    expect(SPECIFICATION_RESPONSE_RULES_V3.join(' ')).not.toMatch(/fixed instruction/);
    expect(SPECIFICATION_TEMPLATE_REGISTRY_V2[1].fixedInstruction.es).toBe('Escribe tu respuesta como un número.');
  });
  it('QB-R2E 16 a1 and a2 (refused twice for the sentence) are no longer refused for it; the item is judged on its content instead', async () => {
    for (const k of ['16.quadratic-optimum.pisa#a1', '16.quadratic-optimum.pisa#a2']) {
      expect(JSON.parse(FIX.qbR2eRawResponses[k]).item.stem).toMatch(/Escribe tu respuesta como un número\.$/);
      const r = await throughV3(k);
      expect(r.candidate.instruction).toBeNull();
      expect(r.candidate.lineage.generationRequest).toMatchObject({ template: { id: 'spec-numeric-entry', version: '3' }, harness: { version: '3' } });
    }
    // a1 wrote both linear factors out: with the trap gone, THAT is what fails it (handed-over factors)
    const v = await r4('16.quadratic-optimum.pisa#a1');
    expect(v.revision4.constructIssues).toEqual(['BOTH_LINEAR_FACTORS_ARE_WRITTEN_OUT_FOR_THE_LEARNER']);
    expect(v.gates.constructPreservation).toBe('FAIL');
  });
  it('the QB-R2D refusals for "Show your working." cannot recur: no constructed template of this path has had the sentence since version 2', () => {
    for (const raw of Object.values(FIX.qbR2dRawResponsesWithTheFixedInstruction)) expect(raw).toMatch(/Show your working\./);
    expect(TEMPLATE_V3_CONSTRUCTED.task).not.toMatch(/Show your working/);
  });
});

describe('4 -- duplicate part labels are refused by name', () => {
  it('QB-R2E 02 a1 and a2 (two entries labelled a): RESPONSE_DUPLICATE_PART_LABEL', async () => {
    expect(await refusalOf('02.rate-comparison.ib-p1#a1')).toBe('RESPONSE_DUPLICATE_PART_LABEL:a');
    expect(await refusalOf('02.rate-comparison.ib-p1#a2')).toBe('RESPONSE_DUPLICATE_PART_LABEL:a');
  });
  it('labels out of order and a part with no marks or no prompt are refused too; a sound constructed response is not', async () => {
    const K = '13.quadratic-factorising.cambridge-p1#a2';
    expect(await refusalOf(K)).toBe('NO_REFUSAL');
    expect(await refusalOf(K, (w) => { w.item.answers[1].label = 'c'; w.item.answers[2].label = 'b'; })).toBe('RESPONSE_PART_LABELS_NOT_IN_ORDER:a,c,b');
    expect(await refusalOf(K, (w) => { w.item.answers[1].marks = 0; w.item.answers[1].markPoints = []; })).toBe('RESPONSE_PART_WITHOUT_MARKS_OR_PROMPT:b');
    expect(await refusalOf(K, (w) => { w.item.answers[2].prompt = null; })).toBe('RESPONSE_PART_WITHOUT_MARKS_OR_PROMPT:c');
    expect(TEMPLATE_V3_CONSTRUCTED.task).toMatch(/ONE ENTRY PER PART, labelled a, b, c in order, each label used once/);
    expect(TEMPLATE_V3_CONSTRUCTED.task).toMatch(/two numbers are two parts, never one part with two answers and never two entries with one label/);
  });
  it('the provider schema is version 2\'s, unchanged: a strict schema cannot say "each label once", so the rule is in the template and the harness', () => {
    expect(SPECIFICATION_PROVIDER_JSON_SCHEMA.name).toBe('studyus_specification_item_v2');
    expect(r2fMalformedCodeOf(FIX.qbR2eRawResponses['02.rate-comparison.ib-p1#a1'])).toBeNull();
  });
});

describe('5 -- give-away stems and keys: the QB-R2E misses are fixtures', () => {
  it('QB-R2E 01 a1, 01 a2, 05, 08 and 12 (which revision 3 did not flag) are flagged', async () => {
    for (const k of ['01.rate-comparison.paa#a1', '01.rate-comparison.paa#a2', '05.rate-comparison.icfes#a1', '08.approach.paa.stem-plus#a1', '12.linear-model.pisa#a1']) {
      const v = await r4(k);
      expect(v.revision3.additions.itemWritingFlags, k).toEqual([]);
      expect(v.revision4.itemWritingFlags, k).toEqual(['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED']);
      expect(v.gates.itemWriting, k).toBe('FLAGGED');
    }
  });
  it('QB-R2D 19 a1: the key is the only option with an equation; QB-R2E 04 and 09 (real questions, parallel options) are NOT flagged', async () => {
    expect(itemWritingFlagsR4(FIX.qbR2dCandidates['19.approach.paa.stem-plus#a1'].candidate)).toEqual(['KEY_IS_THE_ONLY_OPTION_WITH_AN_EQUATION', 'KEY_UNIQUELY_OBVIOUS', 'OPTIONS_NOT_PARALLEL']);
    expect((await r4('04.rate-comparison.pisa#a1')).revision4.itemWritingFlags).toEqual([]);
    expect((await r4('09.approach.pisa.stem-plus#a1')).revision4.itemWritingFlags).toEqual([]);
    expect((await r4('10.line-two-points.paa#a1')).revision4.itemWritingFlags).toEqual([]);
  });
  it('the widened heuristic on minimal stems, in both languages -- and the questions it must leave alone', async () => {
    const base = (await throughV3('04.rate-comparison.pisa#a1')).candidate;
    const stem = (text: string, options?: string[]): SpecificationCandidate => ({ ...base, content: { ...base.content, stem: text, selected: { ...base.content.selected!, options: options ? options.map((t, i) => ({ id: 'ABCD'[i], text: t })) : base.content.selected!.options } } });
    for (const meta of ['¿Qué opción presenta correctamente la comparación?', '¿Cuál opción indica correctamente cuál centro atiende a más personas?', '¿Qué opción describe correctamente el saldo de Elena?', '¿Cuál opción presenta la decisión correcta sobre esta afirmación?', '¿Cuál opción califica correctamente la afirmación?', 'Which option correctly formulates the relation?', 'Which of the following statements correctly describes the model?', 'Which option is correct?']) expect(itemWritingFlagsR4(stem(meta)), meta).toContain('STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED');
    for (const real of ['¿Qué opción ofrece más datos por euro?', '¿Cuál juego ofrece una mayor probabilidad de ganar?', '¿Cuál es la ecuación de esa recta?', 'How much does the trip cost?', '¿Cuánto pagará en total?']) expect(itemWritingFlagsR4(stem(real)), real).not.toContain('STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED');
    expect(itemWritingFlagsR4(stem('¿Cuánto cuesta?', ['y = 3x + 2', 'El doble', 'La mitad', 'El triple']))).toContain('KEY_IS_THE_ONLY_OPTION_WITH_AN_EQUATION');
    expect(itemWritingFlagsR4(stem('¿Cuánto cuesta?', ['12', 'Veinticuatro euros en total', 'Treinta y seis euros en total', 'Cuarenta y ocho euros en total']))).toContain('KEY_IS_ALONE_IN_ITS_LENGTH_CLASS');
    expect(ITEM_WRITING_HEURISTIC_R4.rule).toMatch(/A flag is a reason for a person to look, not a verdict/);
    expect(ITEM_WRITING_RULES_V3[1]).toMatch(/A REAL QUESTION/);
    expect(TEMPLATE_V3_SELECTED.task).toMatch(/The key must not be the only option of its form or length/);
  });
});

describe('6 -- a stimulus must not state what it is there to be read for', () => {
  it('QB-R2E 12 (the stimulus text stated the start and the rate): construct FAIL', async () => {
    const v = await r4('12.linear-model.pisa#a1');
    expect([v.revision3.gates.constructPreservation, v.gates.constructPreservation, v.revision4.constructIssues]).toEqual(['PASS', 'FAIL', ['STIMULUS_TEXT_STATES_THE_MODEL_TO_BE_READ_FROM_THE_DATA']]);
  });
  it('the same item with a text that only introduces the table passes; QB-R2D 05 (rate left to the table) is not flagged', async () => {
    const sound = await r4('12.linear-model.pisa#a1', (w) => { w.stimulus!.text = 'La tabla muestra el saldo de ahorro de Elena al final de cada semana.'; });
    expect(sound.revision4.constructIssues).toEqual([]);
    expect(r4OnR2d('05.linear-model.pisa#a1').revision4.constructIssues).toEqual([]);
    // a result stated in the text of a data stimulus
    const stated = await r4('20.data-relative-change.cambridge-p1#a1', (w) => { w.stimulus!.text = 'The count at site C is 50 % higher than at site A.'; });
    expect(stated.revision4.constructIssues).toEqual(['STIMULUS_TEXT_STATES_THE_RESULT_TO_BE_COMPUTED_FROM_THE_DATA']);
    expect((await r4('20.data-relative-change.cambridge-p1#a1')).revision4.constructIssues).toEqual([]);
    expect(ITEM_WRITING_RULES_V3[4]).toMatch(/A STIMULUS IS THERE TO BE READ/);
  });
});

describe('7 -- diversity within a batch: reused numbers and near-duplicate scenarios', () => {
  it('QB-R2E 06 a2 and 07 (nearly the same item): a shared (amount, return) pair AND a near-duplicate scenario, each naming the other', async () => {
    const a = await r4('06.approach.school.standard#a2', undefined, ['07.approach.school.stem-plus#a1']);
    const b = await r4('07.approach.school.stem-plus#a1', undefined, ['06.approach.school.standard#a2']);
    expect(a.revision4.batchDiversity).toEqual(['SHARES_PARAMETER_VALUES:cand|07.approach.school.stem-plus#a1:p1+q1', 'NEAR_DUPLICATE_SCENARIO:cand|07.approach.school.stem-plus#a1:0.478']);
    expect(b.revision4.batchDiversity).toEqual(['SHARES_PARAMETER_VALUES:cand|06.approach.school.standard#a2:p1+q1', 'NEAR_DUPLICATE_SCENARIO:cand|06.approach.school.standard#a2:0.478']);
    expect([a.revision3.gates.originality, a.gates.originality]).toEqual(['PASS_LOW_SIMILARITY', 'REVIEW_STRUCTURAL_SIMILARITY']);
  });
  it('the reused 24 and 84 (QB-R2E 01 a1, 06 a1, 07) and the whole set reused in QB-R2D 16 / 19 are caught; unrelated items of one family are not', async () => {
    const one = await r4('01.rate-comparison.paa#a1', undefined, ['06.approach.school.standard#a1', '07.approach.school.stem-plus#a1']);
    expect(one.revision4.batchDiversity).toEqual(['SHARES_PARAMETER_VALUES:cand|06.approach.school.standard#a1:WHOLE_SET', 'SHARES_PARAMETER_VALUES:cand|07.approach.school.stem-plus#a1:p1+q1']);
    expect(r4OnR2d('16.approach.school.standard#a1', ['19.approach.paa.stem-plus#a1']).revision4.batchDiversity).toEqual(['SHARES_PARAMETER_VALUES:cand|19.approach.paa.stem-plus#a1:WHOLE_SET']);
    const apart = await r4('04.rate-comparison.pisa#a1', undefined, ['09.approach.pisa.stem-plus#a1', '05.rate-comparison.icfes#a1', '08.approach.paa.stem-plus#a1']);
    expect([apart.revision4.batchDiversity, apart.gates.originality]).toEqual([[], 'PASS_LOW_SIMILARITY']);
    expect(BATCH_DIVERSITY_RULE.scenarioSimilarityThreshold).toBe(0.4);
    expect(scenarioSimilarity('Un ayuntamiento ofrece dos abonos mensuales de transporte público.', 'Un ayuntamiento ofrece dos abonos mensuales de transporte público.')).toBe(1);
    expect(scenarioSimilarity('Una tienda vende paquetes de arroz.', 'A laboratory measures the temperature of a solution.')).toBe(0);
  });
  it('each unit is told what the batch and the earlier runs already used, deterministically and in order', async () => {
    const evidence = loadR2fEvidence(ROOT);
    const selection = buildR2fSelection();
    const linear = selection[0];
    const none = avoidListsFor(linear, evidence, []);
    // QB-R2D and QB-R2E parameter sets of the same construct, and their scenarios of the same family
    expect(none.parameterSets).toContainEqual({ b: 120, m: 8, x: 5 });
    expect(none.parameterSets).toContainEqual({ b: 75, m: 6, x: 8 });
    expect(none.scenarios.length).toBeGreaterThan(5);
    expect(none.scenarios.every((s) => s.length <= AVOID_SCENARIO_MAX_CHARACTERS)).toBe(true);
    const fresh = (await throughV3('12.linear-model.pisa#a1')).candidate;
    const after = avoidListsFor(linear, evidence, [{ ...fresh, content: { ...fresh.content, declaredModel: { ...fresh.content.declaredModel, parameters: { b: 31, m: 4, x: 9 } }, context: { kind: 'PERSONAL', description: 'A scenario nobody has used before in this batch.' } } }]);
    expect(after.parameterSets[after.parameterSets.length - 1]).toEqual({ b: 31, m: 4, x: 9 });
    expect(after.scenarios[after.scenarios.length - 1]).toBe('A scenario nobody has used before in this batch.');
    // the lists are part of the prompt: another list, another hash
    expect(planR2fUnit(linear, 1, MODEL, none).promptHash).not.toBe(planR2fUnit(linear, 1, MODEL, after).promptHash);
    expect(planR2fUnit(linear, 1, MODEL, none).promptHash).toBe(planR2fUnit(linear, 1, MODEL, avoidListsFor(linear, evidence, [])).promptHash);
    expect(ITEM_WRITING_RULES_V3.slice(5, 7).map((r) => r.split('.')[0])).toEqual(['NEW NUMBERS', 'A NEW SCENARIO']);
  });
});

describe('8 -- task fidelity: the item demand policy (StudyUs policy; no fact of any examination)', () => {
  it('the policy is labelled StudyUs policy, provisional, and says what it cannot check', () => {
    expect([ITEM_DEMAND_POLICY.authority, ITEM_DEMAND_POLICY.status, ITEM_DEMAND_POLICY.maximumMarksPerMarkPoint]).toEqual(['STUDYUS_POLICY', 'PROVISIONAL', 1]);
    expect(ITEM_DEMAND_POLICY.notCheckable).toHaveLength(3);
    expect(read('src/lib/assessment-adaptation/item-demand-policy.ts')).toMatch(/It states NOTHING about any examination/);
    // no official fact was added: the profiles are untouched, and the policy names no board
    expect(JSON.stringify(ITEM_DEMAND_POLICY)).not.toMatch(/IB\b|Cambridge|PISA|Icfes|PAA|9709/);
  });
  it('QB-R2E 07 and 15 (one mark point worth two marks) and 06 a2 fail profile compliance under the policy', async () => {
    const seven = await r4('07.approach.school.stem-plus#a1');
    expect([seven.revision3.gates.profileCompliance, seven.gates.profileCompliance, seven.revision4.demandPolicy.issues]).toEqual(['PASS', 'FAIL', ['MARK_POINT_CARRIES_MORE_THAN_ONE_MARK:c']]);
    expect((await r4('15.quadratic-optimum.ib-p1#a1')).revision4.demandPolicy.issues).toEqual(['MARK_POINT_CARRIES_MORE_THAN_ONE_MARK:a']);
    expect((await r4('06.approach.school.standard#a2')).revision4.demandPolicy.issues).toEqual(['MARK_POINT_CARRIES_MORE_THAN_ONE_MARK:c']);
  });
  it('sound constructed items satisfy it (QB-R2E 13 a2, 17, 20); a closed item is not its business', async () => {
    for (const k of ['13.quadratic-factorising.cambridge-p1#a2', '17.probability-single-event.ib-p1#a1', '20.data-relative-change.cambridge-p1#a1']) expect((await r4(k)).revision4.demandPolicy.issues, k).toEqual([]);
    expect((await r4('04.rate-comparison.pisa#a1')).revision4.demandPolicy.issues).toEqual([]);
  });
  it('each rule, on minimal parts', () => {
    const part = (label: string, marks: number, ...points: Array<[string, number]>) => ({ label, marks, markPoints: points.map(([kind, m]) => ({ kind, marks: m })) });
    expect(itemDemandIssues({ parts: [part('a', 2, ['METHOD', 1], ['ACCURACY', 1]), part('b', 1, ['ACCURACY', 1])], workingOutlineLines: 1, evidenceActions: 2 })).toEqual([]);
    expect(itemDemandIssues({ parts: [part('a', 2, ['METHOD', 2])], workingOutlineLines: 1, evidenceActions: 1 })).toEqual(['MARK_POINT_CARRIES_MORE_THAN_ONE_MARK:a']);
    expect(itemDemandIssues({ parts: [part('a', 2, ['ACCURACY', 1], ['ACCURACY', 1])], workingOutlineLines: 0, evidenceActions: 1 })).toEqual(['MULTI_MARK_PART_WITHOUT_A_METHOD_OR_REASONING_POINT:a']);
    expect(itemDemandIssues({ parts: [part('a', 2, ['METHOD', 1], ['REASONING', 1])], workingOutlineLines: 1, evidenceActions: 1 })).toEqual(['WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS:1/2']);
    expect(itemDemandIssues({ parts: [part('a', 2, ['METHOD', 1], ['ACCURACY', 1])], workingOutlineLines: 1, evidenceActions: 3 })).toEqual(['TOTAL_MARKS_BELOW_ONE_PER_EVIDENCE_ACTION_PLUS_ONE:2/4']);
    expect(itemDemandIssues({ parts: [], workingOutlineLines: 0, evidenceActions: 3 })).toEqual([]);
  });
  it('the policy is in every prompt, with the demand of the specification\'s reasoning depth', () => {
    const p = planR2fUnit(buildR2fSelection()[1], 1, MODEL, NO_AVOID);
    const instruction = JSON.parse(p.user) as { demandPolicy: { id: string; version: string; authority: string; maximumMarksPerMarkPoint: number; minimumTotalMarks: number; demand: string } };
    expect(instruction.demandPolicy).toMatchObject({ id: 'studyus.item-demand.mathematics', version: '0.1.0-provisional', authority: 'STUDYUS_POLICY', maximumMarksPerMarkPoint: 1, minimumTotalMarks: 3 });
    expect(instruction.demandPolicy.demand).toMatch(/at least two distinct steps of working/);
    expect(TEMPLATE_V3_CONSTRUCTED.task).toMatch(/every mark point carries exactly one mark, so a part of k marks has k mark points/);
  });
});

describe('9 -- weak construct preservation: evidence that was in the item and revision 2 could not read', () => {
  it('each of the five WEAK cases of QB-R2E, with the evidence revision 4 finds', async () => {
    const evidenceOf = async (k: string) => { const v = await r4(k); return { from: v.revision3.gates.constructPreservation, to: v.gates.constructPreservation, weakLeft: v.revision4.constructWeak, found: v.revision4.weakResolvedByEvidence.map((x) => x.note.split(':')[0]) }; };
    expect(await evidenceOf('05.rate-comparison.icfes#a1')).toEqual({ from: 'WEAK', to: 'PASS', weakLeft: [], found: ['HEURISTIC SOLVE', 'HEURISTIC INTERPRET'] });
    expect(await evidenceOf('01.rate-comparison.paa#a2')).toEqual({ from: 'WEAK', to: 'PASS', weakLeft: [], found: ['HEURISTIC SOLVE', 'HEURISTIC INTERPRET'] });
    expect(await evidenceOf('10.line-two-points.paa#a1')).toEqual({ from: 'WEAK', to: 'PASS', weakLeft: [], found: ['HEURISTIC COMPUTE'] });
    expect(await evidenceOf('20.data-relative-change.cambridge-p1#a1')).toEqual({ from: 'WEAK', to: 'PASS', weakLeft: [], found: ['HEURISTIC INTERPRET'] });
    expect(await evidenceOf('06.approach.school.standard#a2')).toEqual({ from: 'WEAK', to: 'PASS', weakLeft: [], found: ['HEURISTIC FORMULATE'] });
  });
  it('the evidence is a verification, not a lowered bar: QB-R2E 10\'s keyed equation is checked against the line through the stated points', async () => {
    const ok = await r4('10.line-two-points.paa#a1');
    expect(ok.revision4.answerUnits[0]).toMatchObject({ class: 'DETERMINISTIC_RULE_VERIFIED', basis: 'KEYED_TEXT_STRUCTURE', revision4: 'KEYED_EQUATION_IS_THE_LINE_THROUGH_THE_STATED_POINTS' });
    const wrongKey = await r4('10.line-two-points.paa#a1', (w) => { w.item.answerKey = 'D'; (w.item as unknown as { distractors: Array<{ optionId: string }> }).distractors[2].optionId = 'A'; w.item.answers[0].finalAnswer = 'y = -2x + 7'; });
    expect(wrongKey.revision4.answerUnits[0]).toMatchObject({ class: 'FAILED', failureKind: 'KEY_CONTRADICTED' });
    expect(wrongKey.revision4.answerUnits[0].issues[0]).toMatch(/KEYED_EQUATION_IS_NOT_THE_LINE_THROUGH_THE_STATED_POINTS/);
  });
  it('where there is no evidence the WEAK stays: a keyed option whose numbers are not the construct\'s', async () => {
    const none = await r4('05.rate-comparison.icfes#a1', (w) => { w.item.options[0].text = 'El plan 1 ofrece 7 puntos por dólar y supera al plan 2 por 6 puntos por dólar.'; w.item.answers[0].finalAnswer = w.item.options[0].text; });
    expect([none.gates.constructPreservation, none.revision4.weakResolvedByEvidence, none.revision4.answerUnits[0].class]).toEqual(['WEAK', [], 'HUMAN_REVIEW_REQUIRED']);
    // and found evidence never removes a FAIL
    const failed = await r4('12.linear-model.pisa#a1');
    expect(failed.gates.constructPreservation).toBe('FAIL');
  });
  it('the template asks for each action of the evidence target explicitly', () => {
    const p = JSON.parse(planR2fUnit(buildR2fSelection()[12], 1, MODEL, NO_AVOID).user) as { evidenceGuidance: Record<string, string>; itemWritingRules: string[] };
    expect(Object.keys(p.evidenceGuidance)).toEqual(['FORMULATE', 'SOLVE', 'INTERPRET']);
    expect(p.evidenceGuidance.INTERPRET).toBe(EVIDENCE_GUIDANCE_V3.INTERPRET);
    expect(p.itemWritingRules[7]).toMatch(/EVERY ACTION OF THE EVIDENCE TARGET IS ASKED FOR/);
    expect(TEMPLATE_V3_NUMERIC.task).toMatch(/a QUANTITY target/);
  });
});

describe('the defects of earlier phases are still caught by the new harness and validators', () => {
  it('specification vocabulary in learner text: QB-R2D 10 a2, 11 a2, 15 a1, 17 a1 -> leakage FAIL', () => {
    expect(r4OnR2d('10.quadratic-factorising.ib-p1#a2').revision3.additions.leakage).toEqual(['generated with parameters', 'r1', 'r2']);
    expect(r4OnR2d('11.quadratic-optimum.ib-p2#a2').revision3.additions.leakage).toEqual(['free measure']);
    expect(r4OnR2d('15.data-relative-change.ib-p2#a1').revision3.additions.leakage).toEqual(['vi', 'vj']);
    expect(r4OnR2d('17.approach.school.stem-plus#a1').revision3.additions.leakage).toEqual(['INTERPRET', 'SOLVE']);
    for (const k of ['10.quadratic-factorising.ib-p1#a2', '11.quadratic-optimum.ib-p2#a2', '15.data-relative-change.ib-p2#a1', '17.approach.school.stem-plus#a1']) expect(r4OnR2d(k).gates.learnerTextLeakage, k).toBe('FAIL');
  });
  it('the same leak in a fresh response is refused by the harness, by name', async () => {
    expect(await refusalOf('13.quadratic-factorising.cambridge-p1#a2', (w) => { w.item.stem = 'Consider the equation generated with r1 = -3 and r2 = 2: 2x^2 + 2x - 12 = 0.'; })).toBe('RESPONSE_LEAKS_SPECIFICATION_VOCABULARY:r1,r2');
    expect(await refusalOf('20.data-relative-change.cambridge-p1#a1', (w) => { w.item.answers[0].prompt = 'Write down the values of vi and vj.'; })).toBe('RESPONSE_LEAKS_SPECIFICATION_VOCABULARY:vi,vj');
  });
  it('handed over: a root (QB-R2D 10 a2), a factorised equation (QB-R2D 09 a1), both linear factors (QB-R2E 16 a1) -> construct FAIL; the sound regenerations pass', async () => {
    expect(r4OnR2d('10.quadratic-factorising.ib-p1#a2').revision4.constructIssues).toEqual(['A_ROOT_IS_STATED_TO_THE_LEARNER']);
    expect(r4OnR2d('09.quadratic-factorising.paa#a1').revision4.constructIssues).toEqual(['EQUATION_IS_GIVEN_ALREADY_FACTORISED']);
    expect(r4OnR2d('09.quadratic-factorising.paa#a2').gates.constructPreservation).toBe('PASS');
    expect((await r4('15.quadratic-optimum.ib-p1#a1')).revision4.constructIssues).toEqual([]);
  });
  it('decimals on a no-calculator item (QB-R2E 01 a2) -> profile FAIL; a written fraction on one (QB-R2D 07) is not a decimal', async () => {
    expect((await r4('01.rate-comparison.paa#a2')).revision3.revision2.profileCompliance.issues).toEqual(['NO_CALCULATOR_RULE_STATED_NUMBER:0.444,0.044']);
    expect((await r4('01.rate-comparison.paa#a2')).gates.profileCompliance).toBe('FAIL');
    expect(r4OnR2d('07.proportion-missing-value.paa#a1').revision3.revision2.profileCompliance.issues.filter((i) => i.startsWith('NO_CALCULATOR'))).toEqual([]);
  });
  it('a quantity declared without its number and marks or command terms outside the specification are still refused', async () => {
    const K = '13.quadratic-factorising.cambridge-p1#a2';
    expect(await refusalOf(K, (w) => { w.item.answers[1].numericValue = null; })).toBe('RESPONSE_QUANTITY_TARGET_WITHOUT_A_NUMERIC_VALUE:b');
    expect(await refusalOf(K, (w) => { w.item.answers[0].commandTerm = 'state'; })).toBe('RESPONSE_COMMAND_TERM_NOT_IN_SPECIFICATION:a: state');
    expect((await refusalOf(K, (w) => { w.item.answers = [w.item.answers[0], ...'bcde'.split('').map((l) => ({ ...w.item.answers[1], label: l }))]; })).split(':')[0]).toBe('RESPONSE_MARKS_OUTSIDE_SPECIFICATION');
  });
});

describe('revision 4 never makes an outcome better except through the two corrected bugs and evidence it names', () => {
  it('on every fixture: each gate is revision 3\'s or worse, unless the change is V1, V2 or evidence listed with the item', async () => {
    const rank: Record<string, number> = { PASS: 0, NOT_APPLICABLE: 0, PASS_LOW_SIMILARITY: 0, MACHINE_VERIFIED: 0, DETERMINISTIC_RULE_VERIFIED: 1, WEAK: 1, FLAGGED: 1, HUMAN_REVIEW_REQUIRED: 2, REVIEW_STRUCTURAL_SIMILARITY: 2, FAIL: 3, FAILED: 3, REJECT_TEXTUAL_SIMILARITY: 3 };
    const all: SpecificationItemValidationR4[] = [];
    for (const k of Object.keys(FIX.qbR2eRawResponses)) { try { all.push(await r4(k)); } catch (e) { if (!(e instanceof SpecificationGenerationV3Error)) throw e; } }
    for (const k of Object.keys(FIX.qbR2dCandidates)) all.push(r4OnR2d(k));
    expect(all.length).toBe(32);
    const better = all.flatMap((v) => v.revision4.changesFromRevision3.filter((c) => rank[c.to] < rank[c.from]).map((c) => `${v.candidateKey}|${c.gate}`));
    for (const v of all) for (const c of v.revision4.changesFromRevision3) {
      if (rank[c.to] >= rank[c.from]) continue;
      // the only ways an outcome may improve
      if (c.gate === 'structural') expect(c.why, v.candidateKey).toMatch(/^V1:/);
      else if (c.gate === 'constructPreservation') { expect(v.revision4.weakResolvedByEvidence.length, v.candidateKey).toBeGreaterThan(0); expect(v.revision4.constructIssues, v.candidateKey).toEqual([]); }
      else if (c.gate === 'answerKey') expect(v.revision4.answerUnits.some((u) => u.revision4 !== null && /^KEYED_EQUATION_IS_THE_LINE/.test(u.revision4)), v.candidateKey).toBe(true);
      else throw new Error(`an outcome improved on a gate that revision 4 may not improve: ${v.candidateKey} ${c.gate}`);
    }
    expect(better.filter((b) => b.endsWith('|structural'))).toEqual(['cand|18.probability-compare.icfes#a1|structural']);
    // revision 3's own result is carried inside, untouched
    const one = await throughV3('04.rate-comparison.pisa#a1');
    const four = validateSpecificationCandidateR4({ candidate: one.candidate, specification: r2eSpec('04.rate-comparison.pisa#a1'), stimulus: null, siblings: [one.candidate] });
    expect(JSON.stringify(four.revision3)).toBe(JSON.stringify(validateSpecificationCandidateR3({ candidate: one.candidate, specification: r2eSpec('04.rate-comparison.pisa#a1'), stimulus: null, siblings: [one.candidate] })));
    expect([four.validatorsRevision, four.kind, four.isHumanReview, four.reviewStatus]).toEqual([4, 'AUTOMATED_VALIDATION', false, 'BLOCKED_NO_QUALIFIED_REVIEWER']);
  });
});

describe('DIAGNOSTIC ONLY: revision 4 over the stored QB-R2D and QB-R2E candidates (not evidence, not a rescore)', () => {
  const d = runDiagnostic(ROOT);
  const changed = Object.fromEntries(d.rows.filter((r) => r.changes.length > 0).map((r) => [`${r.run} ${r.unitKey}`, r.changes.map((c) => `${c.gate}: ${c.from} -> ${c.to}`)]));
  it('is labelled as what it is, covers all 48 stored candidates, and writes nothing', () => {
    expect(d.label).toBe('DIAGNOSTIC ONLY -- validators revision 4 over stored QB-R2D and QB-R2E candidates -- NOT certification evidence, NOT a rescore');
    expect([d.rows.filter((r) => r.run === 'QB-R2D').length, d.rows.filter((r) => r.run === 'QB-R2E').length]).toEqual([26, 22]);
    expect(execFileSync('git', ['status', '--porcelain', '--', 'docs/exams/question-bank/pilots/qb-r2d', 'docs/exams/question-bank/pilots/qb-r2e'], { cwd: ROOT }).toString()).toBe('');
  });
  it('every changed outcome, pinned -- the known defects that are now flagged, and the WEAKs now answered with evidence', () => {
    expect(changed).toEqual({
      'QB-R2D 15.data-relative-change.ib-p2#a1': ['constructPreservation: WEAK -> PASS'],
      'QB-R2D 15.data-relative-change.ib-p2#a2': ['constructPreservation: WEAK -> PASS'],
      'QB-R2D 20.approach.pisa.stem-plus#a1': ['itemWriting: PASS -> FLAGGED'],
      'QB-R2E 01.rate-comparison.paa#a1': ['itemWriting: PASS -> FLAGGED'],
      'QB-R2E 01.rate-comparison.paa#a2': ['constructPreservation: WEAK -> PASS', 'itemWriting: PASS -> FLAGGED'],
      'QB-R2E 05.rate-comparison.icfes#a1': ['constructPreservation: WEAK -> PASS', 'itemWriting: PASS -> FLAGGED'],
      'QB-R2E 06.approach.school.standard#a1': ['constructPreservation: WEAK -> PASS'],
      'QB-R2E 06.approach.school.standard#a2': ['profileCompliance: PASS -> FAIL', 'constructPreservation: WEAK -> PASS'],
      'QB-R2E 07.approach.school.stem-plus#a1': ['profileCompliance: PASS -> FAIL', 'originality: PASS_LOW_SIMILARITY -> REVIEW_STRUCTURAL_SIMILARITY'],
      'QB-R2E 08.approach.paa.stem-plus#a1': ['itemWriting: PASS -> FLAGGED'],
      'QB-R2E 10.line-two-points.paa#a1': ['constructPreservation: WEAK -> PASS', 'answerKey: HUMAN_REVIEW_REQUIRED -> DETERMINISTIC_RULE_VERIFIED'],
      'QB-R2E 12.linear-model.pisa#a1': ['constructPreservation: PASS -> FAIL', 'itemWriting: PASS -> FLAGGED'],
      'QB-R2E 13.quadratic-factorising.cambridge-p1#a1': ['constructPreservation: WEAK -> FAIL', 'answerKey: HUMAN_REVIEW_REQUIRED -> FAILED'],
      'QB-R2E 15.quadratic-optimum.ib-p1#a1': ['profileCompliance: PASS -> FAIL'],
      'QB-R2E 18.probability-compare.icfes#a1': ['structural: FAIL -> PASS', 'itemWriting: PASS -> FLAGGED'],
      'QB-R2E 19.data-judge-claim.icfes#a1': ['itemWriting: PASS -> FLAGGED'],
      'QB-R2E 20.data-relative-change.cambridge-p1#a1': ['constructPreservation: WEAK -> PASS'],
    });
    // the ONLY answer class that improves anywhere is a keyed equation fully checked against the line through the stated points
    expect(d.rows.flatMap((r) => r.changes.filter((c) => c.gate === 'answerKey' && c.to !== 'FAILED').map((c) => `${r.unitKey}|${c.why}`))).toEqual(['10.line-two-points.paa#a1|item: KEYED_EQUATION_IS_THE_LINE_THROUGH_THE_STATED_POINTS']);
  });
  it('no sound item regresses to a failure for a wrong reason: every new FAIL is one of the known defects or the new demand policy', () => {
    const newFails = d.rows.flatMap((r) => r.changes.filter((c) => c.to === 'FAIL' || c.to === 'FAILED').map((c) => `${r.unitKey}|${c.gate}|${c.why.split(':')[0].split(';')[0]}`));
    expect(newFails).toEqual([
      '07.approach.school.stem-plus#a1|profileCompliance|MARK_POINT_CARRIES_MORE_THAN_ONE_MARK',
      '12.linear-model.pisa#a1|constructPreservation|STIMULUS_TEXT_STATES_THE_MODEL_TO_BE_READ_FROM_THE_DATA',
      '13.quadratic-factorising.cambridge-p1#a1|constructPreservation|STATED_EQUATION_DOES_NOT_HAVE_THE_DECLARED_ROOTS',
      '13.quadratic-factorising.cambridge-p1#a1|answerKey|b',
      '15.quadratic-optimum.ib-p1#a1|profileCompliance|MARK_POINT_CARRIES_MORE_THAN_ONE_MARK',
      '06.approach.school.standard#a2|profileCompliance|MARK_POINT_CARRIES_MORE_THAN_ONE_MARK',
    ]);
  });
});

describe('the new selection, pre-registration, budget and freeze of the next run (prepared, not run)', () => {
  const selection = buildR2fSelection();
  it('twenty fresh adaptations: none was generated from in QB-R2D or QB-R2E; the same breadth', () => {
    expect(selection).toHaveLength(20);
    const used = new Set([...storedR2dSelection().map((s) => s.specification.specificationId), ...R2E.map((s) => s.specification.specificationId)]);
    expect(selection.filter((a) => used.has(a.specification.specificationId))).toEqual([]);
    expect(new Set(selection.map((a) => a.specification.specificationId)).size).toBe(20);
    expect([...new Set(selection.map((a) => a.specification.primaryConcept.stableId))].sort()).toEqual(['math.alg.quadratics', 'math.fun.linear-functions-lines', 'math.num.ratio-proportion', 'math.prob.probability', 'math.stat.data-representation']);
    expect([...new Set(selection.map((a) => a.specification.systemProfile.profileId))].sort()).toEqual(['CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA', 'SCHOOL_STEM_PERFORMANCE']);
    expect([...new Set(selection.map((a) => a.specification.variable.responseFormat.format))].sort()).toEqual(['EXTENDED_RESPONSE', 'NUMERIC_ENTRY', 'SELECTED_RESPONSE', 'SHORT_RESPONSE']);
    expect([...new Set(selection.filter((a) => a.targetId.startsWith('IB.')).map((a) => a.specification.variable.toolPolicy.calculator))].sort()).toEqual(['GDC_REQUIRED', 'NONE']);
    expect(selection.filter((a) => a.specification.variable.stimulus.mode !== 'NONE').length).toBe(8);
    const same = selection.filter((a) => a.group === 'SAME_FAMILY_ALL_SYSTEMS');
    expect([same.length, new Set(same.map((a) => a.specification.systemProfile.profileId)).size, new Set(same.map((a) => a.specification.invariantHash)).size, same[0].familyId]).toEqual([5, 5, 1, R2F_SAME_FAMILY]);
    for (const [base, stem] of R2F_APPROACH_PAIRS) { const a = selection.find((x) => x.selectionKey === base)!, b = selection.find((x) => x.selectionKey === stem)!; expect([a.familyId, b.familyId, a.specification.invariantHash === b.specification.invariantHash, a.specification.learningApproach, b.specification.learningApproach?.approachId]).toEqual([R2F_APPROACH_FAMILY, R2F_APPROACH_FAMILY, true, undefined, 'STEM_PLUS']); }
    expect(selection.find((a) => a.selectionKey === '09.approach.paa.stem-plus')!.specification.learningApproach!.unmetPreferences.some((u) => u.overriddenBy.authority === 'OFFICIAL')).toBe(true);
    expect([selection[5].specification.variable.responseFormat.format, selection[6].specification.variable.responseFormat.format]).toEqual(['SHORT_RESPONSE', 'EXTENDED_RESPONSE']);
  });
  it('the pre-registration: QB-R2E\'s criteria and thresholds, the same object; QB-R2E\'s evaluator; every delta listed', () => {
    expect(R2F_PRE_REGISTRATION.criteria).toBe(PRE_REGISTRATION.criteria);
    expect(R2F_PRE_REGISTRATION.verdict).toBe(PRE_REGISTRATION.verdict);
    expect(R2F_PRE_REGISTRATION.choices).toBe(PRE_REGISTRATION.choices);
    expect(Object.fromEntries(Object.entries(R2F_PRE_REGISTRATION.criteria).map(([k, v]) => [k, `${v.comparator} ${v.threshold}`]))).toMatchObject({ FIRST_ATTEMPT_STRICT_PASS: '>= 16', STRUCTURAL_COMPLIANCE: '= 20', PROFILE_COMPLIANCE: '= 20', ANSWER_VALIDATION_FAILURES: '= 0', CONSTRUCT_PRESERVATION_FAIL: '= 0', CONSTRUCT_PRESERVATION_WEAK: '<= 2', LINEAGE_COMPLETENESS: '= 20', ORIGINALITY_MATERIAL_FAILURES: '= 0', MULTI_PROFILE_SAME_FAMILY_PROOF: '= PASS', STANDARD_VS_STEM_PLUS_PROOF: '= PASS', LEARNER_TEXT_SPECIFICATION_LEAKAGE: '= 0', MAX_REGENERATIONS_PER_ADAPTATION: '<= 1' });
    // which definitions differ from QB-R2E's, and no other
    const differing = Object.keys(R2F_PRE_REGISTRATION.definitions).filter((k) => (R2F_PRE_REGISTRATION.definitions as Record<string, string>)[k] !== (PRE_REGISTRATION.definitions as Record<string, string>)[k]).sort();
    expect(differing).toEqual(['ADAPTATION', 'APPROACH_PROOF', 'ATTEMPT_1', 'ATTEMPT_2', 'GATE_FAIL', 'MATERIAL_ORIGINALITY_FAILURE', 'PLAN_FITS_THE_CAP', 'SIBLINGS_FOR_ORIGINALITY']);
    for (const k of ['STRICT_PASS', 'REGENERABLE', 'FINAL_ATTEMPT', 'NO_CANDIDATE', 'PER_ITEM_CRITERIA', 'SAME_FAMILY_PROOF', 'LEAKAGE_COUNT', 'ANSWER_FAILURE_COUNT', 'REQUEST_REJECTED', 'NO_MANUAL_REPAIR', 'CLEAN_ITEM_FOR_A_PROOF']) expect((R2F_PRE_REGISTRATION.definitions as Record<string, string>)[k], k).toBe((PRE_REGISTRATION.definitions as Record<string, string>)[k]);
    expect(R2F_DELTAS).toHaveLength(7);
    expect(R2F_PRE_REGISTRATION.definitions.MATERIAL_ORIGINALITY_FAILURE).toMatch(/QB-R2D or of QB-R2E/);
    const e = evaluateR2fGates({ adaptations: [], sameFamilyProof: 'PASS', approachProof: 'PASS', maxAttemptsObserved: 0, artifactsAreAReplay: true, runVoid: false });
    expect([e.preRegistration, e.GENERATOR_READY_FOR_DEV_SCALE]).toEqual([{ id: 'qb-r2f-pre-registration', version: '1' }, 'NO']);
  });
  it('BUDGET: the cap is still USD 5.00; the worst case of the plan does NOT fit; the minimum required cap is computed, not guessed', () => {
    const prior = priorSpendUsdGuardBasis(ROOT);
    expect([Number(prior.r2d.toFixed(6)), Number(prior.r2e.toFixed(6)), Number(prior.total.toFixed(6))]).toEqual([1.550575, 1.45456, 3.005135]);
    expect([R2F_CUMULATIVE_CAP_USD, R2F_MAX_CALLS, R2F_MAX_OUTPUT_TOKENS]).toEqual([5, 40, 2150]);
    const plan = r2fPlanBudget(ROOT);
    expect(plan.calls).toBe(40);
    expect(plan.fits).toBe(false);
    expect(plan.remainingUsd).toBeCloseTo(1.994865, 6);
    expect(plan.worstCasePlanUsd).toBeGreaterThan(plan.remainingUsd);
    expect(plan.minimumRequiredCapUsd).toBe(Math.ceil(plan.cumulativeWorstCaseUsd * 4) / 4);
    expect(planBudget(prior.total, [10000], plan.minimumRequiredCapUsd).fits).toBe(true);
    expect(r2fPlanBudget(ROOT, loadR2fEvidence(ROOT), plan.minimumRequiredCapUsd).fits).toBe(true);
    // the bound: output at the cap, input at one token per 2.5 characters of the prompt at its largest
    expect(r2fInputTokenUpperBound(10000)).toBe(Math.ceil((10000 + R2F_MAX_AVOID_GROWTH_CHARACTERS) / 2.5));
    expect(r2fWorstCaseCallUsd(10000)).toBeCloseTo((r2fInputTokenUpperBound(10000) * GUARD_PRICE_BASIS.inputPerMillionUsd + 2150 * GUARD_PRICE_BASIS.outputPerMillionUsd) / 1e6, 9);
    // QB-R2E's largest answer is under the output cap; no adaptation shares a construct with more than five others
    const r2e = (JSON.parse(read('docs/exams/question-bank/pilots/qb-r2e/spend-ledger.json')) as { entries: Array<{ usage: { outputTokens: number } }> }).entries;
    expect(Math.max(...r2e.map((x) => x.usage.outputTokens))).toBe(1675);
    const perConstruct = new Map<string, number>();
    for (const a of selection) { const c = (a.specification.invariants.construct as { construct: string }).construct; perConstruct.set(c, (perConstruct.get(c) ?? 0) + 1); }
    expect(Math.max(...perConstruct.values())).toBeLessThanOrEqual(6);
  });
  it('a run whose plan does not fit, or whose freeze does not verify, NEVER builds a transport', () => {
    let built = 0;
    const factory = () => { built += 1; return { providerId: 'x', model: 'm', complete: async () => { throw new Error('must never be called'); } }; };
    const ok = { ok: true, reasons: [], manifestHash: 'f'.repeat(64) };
    const plan = r2fPlanBudget(ROOT);
    expect(() => transportBehindTheGates(ok, plan, factory)).toThrow(PlanDoesNotFitTheCapError);
    expect(() => transportBehindTheGates(ok, plan, factory)).toThrow(/PLAN_DOES_NOT_FIT_THE_CAP: prior 3\.005135 \+ worst case of 40 calls/);
    expect(() => transportBehindTheGates({ ok: false, reasons: ['FROZEN_FILE_CHANGED:x'], manifestHash: null }, { ...plan, fits: true }, factory)).toThrow(/FREEZE_NOT_VERIFIED: FROZEN_FILE_CHANGED:x/);
    expect(built).toBe(0);
    expect(transportBehindTheGates(ok, { ...plan, fits: true }, factory).providerId).toBe('x');
    const run = read('scripts/operations/qb-r2f/run.ts');
    expect(run.indexOf('const verdict = verifyR2fFreeze(ROOT, freezeSha);')).toBeLessThan(run.indexOf('requireLiveKey()'));
    expect(run.match(/createR2eLiveTransport\(/g)!.length).toBe(1);
  });
  it('the pipeline plans one call at a time from the recording, and an empty recording asks for adaptation 01 first', async () => {
    const evidence = loadR2fEvidence(ROOT);
    const recording: R2fRecordingFile = { kind: 'QB_R2F_RECORDED_LIVE_RESPONSES', label: 'LIVE PROVIDER RESPONSES -- raw model text as returned -- EPHEMERAL, NOT INGESTED, DEV_TEST_CONTENT', freeze: { freezeCommitSha: 'abc1234', manifestHash: 'f'.repeat(64) }, run: { runId: 'synthetic', startedAt: NOW, provider: 'recorded:synthetic', requestedModel: MODEL, requestedBy: 'test', reasoningEffort: 'low', maxOutputTokens: 2150, responseMode: 'STRICT_JSON_SCHEMA', gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' }, responses: [] };
    const first = await nextUnitToCall(recording, evidence);
    expect(first!.unitKey).toBe('01.linear-model.paa#a1');
    // a malformed answer for 01: the next call is 02 (first attempts in order), and its prompt does not depend on 01's failed answer
    recording.responses.push({ promptHash: first!.promptHash, unitKey: first!.unitKey, status: 'MALFORMED', malformedCode: 'PROVIDER_RESPONSE_NOT_JSON', provider: 'recorded:synthetic', requestedModel: MODEL, servedModel: MODEL, responseId: 'r', finishReason: 'stop', recordedAt: NOW, usage: null, rawText: 'not json' });
    const second = await nextUnitToCall(recording, evidence);
    expect(second!.unitKey).toBe('02.linear-model.ib-p1#a1');
    const out = await runQbR2f(recording, evidence);
    const rows = (out.report as { rows: Array<{ firstAttempt: { status: string; regenerable: boolean }; regeneration: { status: string } | null }> }).rows;
    expect([rows[0].firstAttempt.status, rows[0].firstAttempt.regenerable, rows[0].regeneration?.status, rows[1].firstAttempt.status]).toEqual(['MALFORMED', true, 'NOT_RUN', 'NOT_RUN']);
    expect([out.gates.evaluation.GENERATOR_READY_FOR_DEV_SCALE, out.gates.evaluation.preRegistration.id]).toEqual(['NO', 'qb-r2f-pre-registration']);
    for (const artifact of [out.selection, out.specifications, out.batch, out.report, out.gates, out.sameFamilyProof, out.approachProof, out.rights]) expect((artifact as { freeze: unknown }).freeze).toEqual(recording.freeze);
    expect(JSON.stringify(await runQbR2f(recording, evidence))).toBe(JSON.stringify(out));
  });

  const current = computeR2fFreezeManifest(ROOT);
  const clean = { commitExists: true, diffIsClean: true, untracked: [] };
  it('the QB-R2F freeze: the computed closure, with revision 4, generator version 3, the demand policy and the earlier revisions they run', () => {
    const files = r2fFrozenSourceFiles(ROOT);
    expect(current.files.map((f) => f.path)).toEqual(files);
    for (const f of [
      'src/lib/exam-core/question-bank/production/specification-validators-r4.ts', 'src/lib/exam-core/question-bank/production/specification-validators-r3.ts', 'src/lib/exam-core/question-bank/production/specification-validators.ts',
      'src/lib/exam-core/question-bank/production/generator/specification-generation-v3.ts', 'src/lib/exam-core/question-bank/production/generator/specification-generation-v2.ts', 'src/lib/assessment-adaptation/item-demand-policy.ts',
      'src/lib/exam-core/question-bank/production/expression-evaluator.ts', 'src/lib/exam-core/question-bank/production/answer-normalization.ts', 'src/lib/exam-core/question-bank/production/originality-gate.ts', 'src/lib/exam-core/question-bank/production/math-construct-registry.ts',
      'src/lib/assessment-adaptation/adapt.ts', 'scripts/operations/qb-r2e/gates.ts', 'scripts/operations/qb-r2e/budget.ts', 'scripts/operations/qb-r2e/live-provider.ts',
      'scripts/operations/qb-r2f/gates.ts', 'scripts/operations/qb-r2f/pipeline.ts', 'scripts/operations/qb-r2f/selection.ts', 'scripts/operations/qb-r2f/budget.ts', 'scripts/operations/qb-r2f/evidence.ts', 'scripts/operations/qb-r2f/freeze.ts', 'scripts/operations/qb-r2f/run.ts',
    ]) expect(files, f).toContain(f);
    expect([...R2F_FREEZE_ENTRY_FILES].every((f) => files.includes(f))).toBe(true);
    expect(current.dataFiles.map((f) => f.path)).toEqual(['docs/exams/question-bank/pilots/qb-r2d/generated-batch.json', 'docs/exams/question-bank/pilots/qb-r2d/spend-ledger.json', 'docs/exams/question-bank/pilots/qb-r2e/generated-batch.json', 'docs/exams/question-bank/pilots/qb-r2e/spend-ledger.json', 'docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json', 'docs/exams/question-bank/pilots/qb-r2c/pilot-v2-batch.json']);
    expect([current.preRegistration, current.deltasFromQbR2e]).toEqual([R2F_PRE_REGISTRATION, R2F_DELTAS]);
    expect(current.runParameters).toEqual({ provider: 'openai', endpoint: 'chat completions', model: 'gpt-5.6-luna', responseMode: 'STRICT_JSON_SCHEMA', reasoningEffort: 'low', maxOutputTokens: 2150, maxCalls: 40, retries: 0, cumulativeCapUsdGuardBasis: 5 });
  });
  it('the stored QB-R2F manifest is the working tree, and the verdict refuses on any mismatch', () => {
    const stored = readStoredR2fManifest(ROOT);
    expect(stored, 'docs/exams/question-bank/pilots/qb-r2f/validator-freeze.json must exist').not.toBeNull();
    expect(stored).toEqual(current);
    expect(r2fFreezeVerdict(stored, current, clean, 'abc1234')).toEqual({ ok: true, reasons: [], manifestHash: current.manifestHash });
    const tampered: R2fFreezeManifest = { ...current, files: current.files.map((f, i) => (i === 0 ? { ...f, sha256: '0'.repeat(64) } : f)) };
    expect(r2fFreezeVerdict(tampered, current, clean, 'abc1234').reasons).toEqual(['MANIFEST_HASH_DOES_NOT_MATCH_ITS_CONTENT', `FROZEN_FILE_CHANGED:${current.files[0].path}`]);
    expect(r2fFreezeVerdict(null, current, clean, 'abc1234').reasons).toEqual(['FREEZE_MANIFEST_MISSING']);
    expect(r2fFreezeVerdict(current, current, clean, null).reasons).toEqual(['FREEZE_COMMIT_SHA_NOT_GIVEN']);
    expect(r2fFreezeVerdict(current, current, { commitExists: true, diffIsClean: false, untracked: ['x'] }, 'abc1234').reasons).toEqual(['WORKING_TREE_DIFFERS_FROM_THE_FREEZE_COMMIT', 'FROZEN_FILE_NOT_TRACKED:x']);
    expect(verifyR2fFreeze(ROOT, '0000000000000000000000000000000000000000').ok).toBe(false);
  });
});

describe('QB-R2D and QB-R2E stay reproducible: nothing they were recorded or scored with was edited', () => {
  it('NO file of the QB-R2E freeze changed: the stored QB-R2E manifest is still the working tree, and git agrees with the freeze commit', () => {
    // QB-R2F adds NEW versioned files (validators revision 4, generator version 3, the demand policy) and edits none
    // of the 64 source files and 4 data files QB-R2E was frozen with. So QB-R2E's own manifest test keeps passing
    // unchanged, and this is the stronger statement of the same fact, against the committed blobs.
    const manifest = readStoredManifest(ROOT)!;
    expect(computeFreezeManifest(ROOT)).toEqual(manifest);
    const paths = [...manifest.files, ...manifest.dataFiles].map((f) => f.path);
    expect(paths).toHaveLength(68);
    expect(() => execFileSync('git', ['diff', '--quiet', '9fe68d01d8649548f453873acec633f4a3dead5e', '--', ...paths, 'docs/exams/question-bank/pilots/qb-r2e/validator-freeze.json'], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
  });
  it('the artifacts of both runs are untouched, and the new files are additive and pure', () => {
    expect(execFileSync('git', ['status', '--porcelain', '--', 'docs/exams/question-bank/pilots/qb-r2d', 'docs/exams/question-bank/pilots/qb-r2e', 'tests/unit/qb-r2d-live-replay.test.ts', 'tests/unit/qb-r2e-live-replay.test.ts'], { cwd: ROOT }).toString()).toBe('');
    const strip = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    const PROD = 'src/lib/exam-core/question-bank/production';
    for (const f of [`${PROD}/generator/specification-generation-v3.ts`, `${PROD}/specification-validators-r4.ts`, 'src/lib/assessment-adaptation/item-demand-policy.ts']) {
      expect(strip(f), f).not.toMatch(/fetch\(|process\.env|https?:\/\/|Date\.now\(|new Date\(|Math\.random\(|@\/lib\/db|@\/lib\/ai\/|from 'fs'|from 'pg'/);
      expect(strip(f), f).not.toMatch(/anthropic|openai|claude|gpt-|gemini/i);
    }
    expect(strip(`${PROD}/specification-validators-r4.ts`)).not.toMatch(/from '\.\/generator\//);
    expect(strip(`${PROD}/generator/specification-generation-v3.ts`)).not.toMatch(/specification-validators|independent-validators|originality-gate|structural-validation|validated-candidate/);
    expect(readdirSync(join(ROOT, 'scripts/operations/qb-r2f')).sort()).toEqual(['budget.ts', 'diagnostic.ts', 'evidence.ts', 'freeze.ts', 'gates.ts', 'pipeline.ts', 'run.ts', 'selection.ts']);
    for (const f of readdirSync(join(ROOT, 'scripts/operations/qb-r2f'))) expect(strip(`scripts/operations/qb-r2f/${f}`), f).not.toMatch(/fetch\(|https?:\/\//);
    for (const f of r2fFrozenSourceFiles(ROOT)) {
      expect(f, f).not.toMatch(/^src\/lib\/db|\/db\/|\/gateway\.ts$|\/adapters\/|\.service\.ts$/);
      expect(strip(f), f).not.toMatch(/DATABASE_URL|from 'pg'|from 'postgres'|drizzle|@neondatabase|new Pool\(|@\/lib\/db/);
    }
  });
});
