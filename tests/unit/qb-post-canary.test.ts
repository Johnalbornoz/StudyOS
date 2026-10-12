/**
 * POST-CANARY REMEDIATION -- ENTIRELY OFFLINE. No network, no provider, no key.
 *
 * Fixtures are COPIES of items the Canary actually produced (`tests/fixtures/qb-v5/canary-items.json`, with
 * provenance). Validators revision 5 was written with those items in view: what is asserted about them here is
 * regression, in-sample -- not certification. NO HUMAN RESPONSE EXISTS: wherever a human label appears in this
 * file it is a SYNTHETIC label built in the test to exercise a rule, and it is written to no artifact.
 */
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { isOrdinaryWordSymbol, leakedVocabularyV4, renderSpecificationPromptV4, SPECIFICATION_GENERATION_HARNESS_V4, SPECIFICATION_TEMPLATE_REGISTRY_V4 } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v4';
import { constructIntegrityOf, constructVocabularyOf } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { validateSpecificationCandidateR4, type SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { agreementOf, calibrationSetIssues, emptyCalibrationSet } from '../../scripts/operations/qb-canary-250/calibration';
import { canaryManifest } from '../../scripts/operations/qb-canary-250/evidence';
import { canaryFrozenSourceFiles, readStoredCanaryFreeze } from '../../scripts/operations/qb-canary-250/freeze';
import { canaryPolicyFor } from '../../scripts/operations/qb-canary-250/pipeline';
import { CANARY_DIR } from '../../scripts/operations/qb-canary-250/report';
import { analyse, humanFinding, JUDGE_DEFINITIONS, NoHumanLabelsError, rate, type AnalyticsRow, type Call, type Dimension, type Judge } from '../../scripts/operations/qb-post-canary/calibration-analytics';
import { composeDemand, DEMAND_PROFILE_V2, demandCheck, PAPER_FIDELITY_PROFILES } from '../../scripts/operations/qb-post-canary/demand-profile-v2';
import { CAUSE_RULES, causeOf, ZERO_APPROVAL_FAMILIES, type FamilySlot } from '../../scripts/operations/qb-post-canary/family-analysis';
import { automatedContentIn, emptyForm, FORM_NO_AI, formIssues, HUMAN_REVIEW_FIELDS, HUMAN_REVIEW_VOCABULARIES, humanLabelOf, REVIEWER_INSTRUCTIONS, reviewerIssues, secondHumanReviewRequired, toCalibrationRowV1, type FrozenAiDecision, type HumanResponse } from '../../scripts/operations/qb-post-canary/human-review';
import { humanCalibrationComplete, nextRunGate } from '../../scripts/operations/qb-post-canary/next-run-gate';
import { cleanLine, cleanOptimum, cleanProportion, cleanRoots, pinnedRoleIssues, typedGuidance } from '../../scripts/operations/qb-post-canary/parameter-policy-v2';
import { CONFIRMED_WRONG_KEYS, DISCLOSED_AFTER_COMPUTING, KNOWN_FALSE_FAILURES, OFFLINE_REPLAY_CRITERIA } from '../../scripts/operations/qb-post-canary/replay';
import { buildPostCanaryArtifacts, gateFacts, pathOf, POST_CANARY_FILES } from '../../scripts/operations/qb-post-canary/run';
import { assertReconciled, authoritativeSpend, reconcile, SpendNotReconciledError, spendFiguresV2 } from '../../scripts/operations/qb-post-canary/spend-accounting-v2';
import {
  channelOfProfileIssue, compareKey, DECLARATION_QUALITY_CODES, isStrictPassR5, numbersOf, optionIssuesR5, originalityR5, parseLinearEquation, parseNumber, R5_CHANGE_LOG, R5_READERS, rejectedByValidatorR5, sameLinearEquation, stimulusTotalIssues, validateSpecificationCandidateR5, type SpecificationItemValidationR5,
} from '../../scripts/operations/qb-post-canary/validators-r5';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const FIX = JSON.parse(read('tests/fixtures/qb-v5/canary-items.json')) as { about: string; source: { runId: string; freezeCommitSha: string }; why: Record<string, string[]>; candidates: Record<string, { candidate: SpecificationCandidate; stimulus: CandidateStimulus | null }>; leakRefusalsRawText: Record<string, string> };
const slots = new Map(canaryManifest(ROOT).slots.map((s) => [s.slotId, s]));
const siblings = Object.values(FIX.candidates).map((c) => c.candidate);
const r4Of = (id: string): SpecificationItemValidationR4 => validateSpecificationCandidateR4({ candidate: FIX.candidates[id].candidate, specification: slots.get(id)!.specification, stimulus: FIX.candidates[id].stimulus, siblings });
const r5Of = (id: string, mutate?: (c: SpecificationCandidate) => void): SpecificationItemValidationR5 => {
  const candidate = JSON.parse(JSON.stringify(FIX.candidates[id].candidate)) as SpecificationCandidate;
  mutate?.(candidate);
  const stimulus = FIX.candidates[id].stimulus;
  return validateSpecificationCandidateR5({ candidate, specification: slots.get(id)!.specification, stimulus, revision4: validateSpecificationCandidateR4({ candidate, specification: slots.get(id)!.specification, stimulus, siblings }) });
};
const units = (v: SpecificationItemValidationR5) => v.answerKey.units.map((u) => `${u.label}:${u.class}${u.representation ? `/${u.representation}` : ''}`);
const artifacts = buildPostCanaryArtifacts(ROOT);
const json = async <T>(name: keyof typeof POST_CANARY_FILES): Promise<T> => JSON.parse((await artifacts)[name]) as T;

describe('fixtures: copies of what the Canary recorded', () => {
  it('every fixture candidate is byte-identical to the Canary\'s stored candidate, and every raw response to its run-log line', () => {
    const stored = new Map((JSON.parse(read(`${CANARY_DIR}/generated-candidates.json`)) as { slots: Array<{ slotId: string; candidate: unknown; stimulus: unknown }> }).slots.map((s) => [s.slotId, s]));
    for (const [id, f] of Object.entries(FIX.candidates)) { expect(JSON.stringify(f.candidate), id).toBe(JSON.stringify(stored.get(id)!.candidate)); expect(JSON.stringify(f.stimulus), id).toBe(JSON.stringify(stored.get(id)!.stimulus)); }
    const log = read(`${CANARY_DIR}/run-log.jsonl`).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; phase?: string; slotId?: string; rawText?: string });
    for (const [id, raw] of Object.entries(FIX.leakRefusalsRawText)) expect(log.find((l) => l.type === 'CALL_FINISHED' && l.phase === 'GENERATION' && l.slotId === id)!.rawText === raw, id).toBe(true);
    expect([Object.keys(FIX.candidates).length, Object.keys(FIX.leakRefusalsRawText).length, FIX.source.freezeCommitSha]).toEqual([25, 8, 'f445e7afa89cffd69865fd3f9dbf9d98bdddb1f9']);
    expect(FIX.about).toMatch(/DEV_TEST_CONTENT, RIGHTS_NOT_ESTABLISHED, not release content/);
  });
});

describe('A -- the answer key is judged against what the learner can see', () => {
  it('the eight false key failures of revision 4 (and the ninth the replay found) are NOT contradicted; five are independently verified', () => {
    for (const id of ['c250-004', 'c250-079', 'c250-090', 'c250-241']) {
      // the stem asks for y at a stated x; revision 4 compared the key with the declared target, the intercept
      expect(r4Of(id).gates.answerKey, id).toBe('FAILED');
      const v = r5Of(id);
      expect([v.gates.answerKey, v.answerKey.units[0].asked?.startsWith('VALUE_AT_X='), v.answerKey.units[0].flags], id).toEqual(['INDEPENDENTLY_VERIFIED', true, ['DECLARED_TARGET_OR_ARITHMETIC_DISAGREES_WITH_THE_KEY']]);
    }
    // 048: the key 13254 is right, the generator's declared arithmetic is not
    const o = r5Of('c250-048');
    expect([o.gates.answerKey, o.answerKey.units[0].asked, o.answerKey.units[0].expected, o.answerKey.reading!.given]).toEqual(['INDEPENDENTLY_VERIFIED', 'OPTIMAL_VALUE', 13254, { p: 12, q: 6, r: 180, s: 4 }]);
    // 146 (a sign), 153 (percentage points), 194 (a rounding form): consistent with the stem, never contradicted
    expect(units(r5Of('c250-146'))).toEqual(['a:UNVERIFIED', 'b:STEM_CONSISTENT', 'c:UNVERIFIED']);
    expect(units(r5Of('c250-153'))).toEqual(['item:STEM_CONSISTENT']);
    expect(units(r5Of('c250-194'))).toEqual(['a:UNVERIFIED', 'b:STEM_CONSISTENT', 'c:STEM_CONSISTENT', 'd:INDEPENDENTLY_VERIFIED']);
    for (const id of ['c250-146', 'c250-153', 'c250-194']) { expect(r4Of(id).gates.answerKey, id).toBe('FAILED'); expect(r5Of(id).gates.answerKey, id).not.toBe('KEY_CONTRADICTED'); expect(rejectedByValidatorR5(r5Of(id).gates), id).toBe(false); }
  });
  it('the confirmed wrong keys: five are contradicted from the stem; 070 is NOT caught and is NOT verified', () => {
    expect(units(r5Of('c250-016'))).toEqual(['a:UNVERIFIED', 'b:UNVERIFIED', 'c:INDEPENDENTLY_VERIFIED', 'd:KEY_CONTRADICTED']);
    expect(r5Of('c250-016').answerKey.units[3]).toMatchObject({ asked: 'OPTIMAL_VALUE', expected: 9830.4, keyed: expect.stringContaining('9820.8') });
    expect(units(r5Of('c250-085'))).toEqual(['a:UNVERIFIED', 'b:INDEPENDENTLY_VERIFIED', 'c:KEY_CONTRADICTED']);
    // a slope of the wrong sign is an error, not a representation; the keyed equation is another line
    expect(units(r5Of('c250-135'))).toEqual(['a:KEY_CONTRADICTED', 'b:KEY_CONTRADICTED']);
    expect(units(r5Of('c250-177'))).toEqual(['item:KEY_CONTRADICTED']);
    // 226: the vertex is 49/3; a whole number is not a rounding of it unless the text asks for rounding
    expect(units(r5Of('c250-226'))).toEqual(['a:UNVERIFIED', 'b:KEY_CONTRADICTED', 'c:KEY_CONTRADICTED', 'd:UNVERIFIED']);
    // 070: revision 4 MACHINE_VERIFIED the wrong key from the declared parameters. Revision 5 does not verify it -- and cannot contradict it
    expect(r4Of('c250-070').revision4.answerUnits.map((u) => u.class)).toEqual(['HUMAN_REVIEW_REQUIRED', 'MACHINE_VERIFIED']);
    const v = r5Of('c250-070');
    expect(units(v)).toEqual(['a:UNVERIFIED', 'b:STEM_CONSISTENT']);
    expect(v.answerKey.units[1]).toMatchObject({ asked: 'not read; the key is n2*n3/n1', flags: ['REVISION_4_VERIFIED_FROM_DECLARATIONS_ONLY'] });
    expect(v.answerKey.reading!.determined).toEqual({ 'n2*n3/n1': 120, 'n1*n3/n2': 16.875, 'n1*n2/n3': 4.8 });
    expect(R5_READERS.DIRECT_PROPORTION_MISSING_VALUE).toMatch(/which correspond is NOT read/);
  });
  it('the generator\'s declarations never raise or lower a class: change them, the class is the same', () => {
    const lie = (c: SpecificationCandidate) => { c.content.declaredModel.parameters = { x1: 1, y1: 1, x2: 2, y2: 2 }; };
    expect(r5Of('c250-004', lie).answerKey.units[0]).toMatchObject({ class: 'INDEPENDENTLY_VERIFIED', flags: expect.arrayContaining(['STEM_GIVENS_DIFFER_FROM_THE_DECLARED_PARAMETERS']) });
    // a key that is wrong against the stem is contradicted whatever is declared; a right one is verified whatever is declared
    const wrong = r5Of('c250-004', (c) => { c.content.selected!.answerKey = 'C'; });
    expect([wrong.gates.answerKey, wrong.answerKey.units[0].expected]).toEqual(['KEY_CONTRADICTED', 13]);
    expect(r5Of('c250-177', (c) => { (c.content.numeric!.numericKey as { value: string }).value = '16820'; }).gates.answerKey).toBe('INDEPENDENTLY_VERIFIED');
    // no reader: UNVERIFIED, never verified
    expect(r5Of('c250-211').gates.answerKey).toBe('UNVERIFIED');
    expect(R5_READERS.CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY).toMatch(/NO READER/);
    // sound items of several constructs
    expect([r5Of('c250-089').gates.answerKey, r5Of('c250-071').gates.answerKey, r5Of('c250-233').answerKey.units[0].class, r5Of('c250-008').gates.answerKey, r5Of('c250-026').gates.answerKey]).toEqual(['INDEPENDENTLY_VERIFIED', 'INDEPENDENTLY_VERIFIED', 'INDEPENDENTLY_VERIFIED', 'STEM_CONSISTENT', 'STEM_CONSISTENT']);
  });
  it('sign, unit and rounding are representations with a subtype -- and only where they can be', () => {
    expect([compareKey(13, 13, ''), compareKey(40.2, 40.1785, 'Redondea a una décima'), compareKey(0.321, 9 / 28, 'Calculate the probability'), compareKey(81, 80.603, 'to the nearest whole percent'), compareKey(16, 49 / 3, 'Calculate the spacing'), compareKey(14600, 14602.67, 'Work out the maximum')]).toEqual(['EQUAL', 'EQUAL', 'ROUNDING', 'EQUAL', 'DIFFERENT', 'DIFFERENT']);
    expect([compareKey(-0.5, 0.5, '', true), compareKey(-4 / 3, 4 / 3, ''), compareKey(2.5, 0.025, 'puntos porcentuales'), compareKey(2.5, 0.025, 'how much larger'), compareKey(9820.8, 9830.4, '')]).toEqual(['SIGN', 'DIFFERENT', 'EQUAL', 'UNIT_PERCENT', 'DIFFERENT']);
    expect([parseNumber('4/9'), parseNumber('12,5'), parseNumber('-4/3'), parseNumber('161 pesos'), numbersOf('P(-8,-9) y 12,5 € y 3/4')]).toEqual([4 / 9, 12.5, -4 / 3, null, [-8, -9, 12.5, 0.75]]);
  });
});

describe('B -- options and equations', () => {
  it('019: y = x - 4 and y = -x + 4 are different options; the item is no longer structurally failed, and its key is verified as an equation', () => {
    expect(r4Of('c250-019').revision4.structuralIssues).toEqual(['OPTIONS_STATE_THE_SAME_NUMBER:C,D']);
    const v = r5Of('c250-019');
    expect([v.structuralIssues, v.gates.structural, v.answerKey.units[0].class, v.answerKey.units[0].asked]).toEqual([[], 'PASS', 'INDEPENDENTLY_VERIFIED', 'EQUATION']);
    // a true structural failure stays: 032 has the same option text twice
    expect(r5Of('c250-032').structuralIssues).toEqual(['OPTION_TEXTS_NOT_DISTINCT', 'OPTIONS_STATE_THE_SAME_NUMBER:A,D', 'OPTIONS_STATE_THE_SAME_NUMBER:B,C']);
    expect(rejectedByValidatorR5(r5Of('c250-032').gates)).toBe(true);
  });
  it('equivalent forms are the same equation; different lines are not', () => {
    const same = (a: string, b: string) => sameLinearEquation(parseLinearEquation(a)!, parseLinearEquation(b)!);
    expect([same('2x + 4 = 0', 'x = -2'), same('y = x/2 + 1', '2y - x = 2'), same('y = 0,5x + 1', 'y = 1/2x + 1'), same('y = 3 + 2x', 'y = 2x + 3'), same('y = -4/3x + 12', '4x + 3y = 36'), same('y = x - 4', 'y = -x + 4'), same('y = 2x + 7', 'y = 2x - 7')]).toEqual([true, true, true, true, true, false, false]);
    expect([parseLinearEquation('La biblioteca 1'), parseLinearEquation('x^2 = 4'), parseLinearEquation('13')]).toEqual([null, null, null]);
    // two options that are the same line in two forms are one option (the counterpart of 019)
    const c = JSON.parse(JSON.stringify(FIX.candidates['c250-019'].candidate)) as SpecificationCandidate;
    c.content.selected!.options[2].text = 'x - y + 3 = 0';
    expect(optionIssuesR5(c, [])).toEqual(['OPTIONS_ARE_EQUIVALENT_EQUATIONS:A,C']);
  });
});

describe('C -- originality: three notions, one of which fails', () => {
  const fake = (batchDiversity: string[], textual: string, kind: string): [SpecificationCandidate, SpecificationItemValidationR4] => [{ content: { context: { kind } } } as unknown as SpecificationCandidate, { revision3: { revision2: { originality: { outcome: textual } } }, revision4: { batchDiversity } } as unknown as SpecificationItemValidationR4];
  it('scenario similarity is not applied to an abstract item; a signal alone is not a material duplicate; the QB-R2E pair still is', () => {
    expect(originalityR5(...fake(['NEAR_DUPLICATE_SCENARIO:cand|b:1', 'NEAR_DUPLICATE_SCENARIO:cand|c:0.75'], 'PASS_LOW_SIMILARITY', 'ABSTRACT'))).toEqual({ materialDuplicate: [], mathematicalTemplateSimilarity: [], structuralSimilarity: [], scenarioRuleApplied: false });
    expect(originalityR5(...fake(['NEAR_DUPLICATE_SCENARIO:cand|b:0.5'], 'PASS_LOW_SIMILARITY', 'PERSONAL'))).toMatchObject({ materialDuplicate: [], structuralSimilarity: ['NEAR_DUPLICATE_SCENARIO:cand|b'] });
    expect(originalityR5(...fake(['SHARES_PARAMETER_VALUES:cand|b:p1+q1'], 'REVIEW_STRUCTURAL_SIMILARITY', 'PERSONAL'))).toMatchObject({ materialDuplicate: [], mathematicalTemplateSimilarity: ['SHARED_PARAMETER_PAIR:cand|b:p1+q1'], structuralSimilarity: ['TEXTUAL_SIMILARITY_IN_THE_REVIEW_BAND'] });
    // QB-R2E 06 a2 / 07: a near-duplicate scenario AND a shared pair with the same item
    expect(originalityR5(...fake(['SHARES_PARAMETER_VALUES:cand|07:p1+q1', 'NEAR_DUPLICATE_SCENARIO:cand|07:0.478'], 'PASS_LOW_SIMILARITY', 'PERSONAL')).materialDuplicate).toEqual(['NEAR_DUPLICATE_SCENARIO_AND_SHARED_PAIR:cand|07:p1+q1']);
    expect(originalityR5(...fake(['SHARES_PARAMETER_VALUES:cand|b:WHOLE_SET'], 'PASS_LOW_SIMILARITY', 'ABSTRACT')).materialDuplicate).toEqual(['WHOLE_PARAMETER_SET:cand|b']);
    expect(originalityR5(...fake([], 'REJECT_TEXTUAL_SIMILARITY', 'ABSTRACT')).materialDuplicate).toEqual(['TEXTUAL_SIMILARITY_AT_THE_REJECT_THRESHOLD']);
  });
  it('on the Canary item: 135 (framing sentence identical to its siblings) is not a duplicate of anything', () => {
    expect(FIX.candidates['c250-135'].candidate.content.context.kind).toBe('ABSTRACT');
    expect(r5Of('c250-135').gates.originality).toBe('PASS');
  });
});

describe('D -- profile: declarations and the working outline do not fail a learner-facing item', () => {
  it('the channel of every code: three go to DECLARATION_QUALITY, every other stays HARD', () => {
    expect([...DECLARATION_QUALITY_CODES]).toEqual(['PARAMETER_NOT_OF_THE_CONSTRUCT', 'WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS', 'ITEM_DOES_NOT_SAY_WHICH_STIMULUS_VALUES_IT_USES']);
    for (const code of ['COMMAND_TERM_ABSENT:find', 'DISPLAY_VALUE_OUT_OF_RANGE', 'NO_CALCULATOR_RULE_KEYED_NUMBER:0.4', 'NO_CALCULATOR_RULE_STATED_NUMBER', 'PARAMETER_CONSTRAINT:COEFFICIENTS_NOT_INTEGERS', 'PARAMETER_OUT_OF_RANGE', 'RUBRIC_HAS_NO_ACCURACY_POINT', 'WORKING_SHOWN_BUT_NO_METHOD_POINT', 'MARK_POINT_CARRIES_MORE_THAN_ONE_MARK:a', 'A_CODE_NOBODY_HAS_SEEN_YET']) expect(channelOfProfileIssue(code), code).toBe('HARD');
    expect([channelOfProfileIssue('PARAMETER_NOT_OF_THE_CONSTRUCT:m'), channelOfProfileIssue('WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS:2/4')]).toEqual(['DECLARATION_QUALITY', 'DECLARATION_QUALITY']);
  });
  it('090 and 146 failed revision 4 on declarations only; 194 keeps its hard failure (a command term is missing)', () => {
    expect(r5Of('c250-090')).toMatchObject({ profile: { hard: [], declarationQuality: ['PARAMETER_NOT_OF_THE_CONSTRUCT:m', 'PARAMETER_NOT_OF_THE_CONSTRUCT:b'] }, gates: { profileCompliance: 'PASS', declarationQuality: 'ISSUES' } });
    expect(r5Of('c250-146').profile).toEqual({ hard: [], declarationQuality: ['WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS:2/4'] });
    expect(r5Of('c250-194')).toMatchObject({ profile: { hard: ['COMMAND_TERM_ABSENT:find'], declarationQuality: ['WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS:2/3'] }, gates: { profileCompliance: 'FAIL' } });
  });
});

describe('two defects the AI reviewer caught and revision 4 passed', () => {
  it('122: the asked value is a cell of the table, in the row the question names -> construct FAIL; other table items are not touched', () => {
    expect(r4Of('c250-122').gates.constructPreservation).not.toBe('FAIL');
    const v = r5Of('c250-122');
    expect([v.constructIssues, v.gates.constructPreservation, isStrictPassR5(v.gates)]).toEqual([['KEYED_VALUE_IS_A_CELL_OF_THE_STIMULUS_ROW_THE_QUESTION_NAMES:item:7->161'], 'FAIL', false]);
    for (const id of ['c250-089', 'c250-071']) expect(r5Of(id).constructIssues, id).toEqual([]);
  });
  it('211: the text says 6 guests, the column adds up to 13 -> stimulus FAIL; consistent stimuli are not touched', () => {
    expect(stimulusTotalIssues(FIX.candidates['c250-211'].stimulus)).toEqual(['STIMULUS_TEXT_COUNT_DISAGREES_WITH_THE_TABLE_TOTAL:6 invitados/13']);
    expect(r5Of('c250-211').gates.stimulusIntegrity).toBe('FAIL');
    for (const id of ['c250-089', 'c250-071', 'c250-122']) expect(stimulusTotalIssues(FIX.candidates[id].stimulus), id).toEqual([]);
    expect(stimulusTotalIssues(null)).toEqual([]);
  });
  it('the change log says of every change whether it relaxes, tightens or reclassifies, with its evidence', () => {
    expect(R5_CHANGE_LOG.map((c) => `${c.id} ${c.kind}`)).toEqual(['A1 TIGHTENS', 'A2 RELAXES', 'A3 RECLASSIFIES', 'A4 RECLASSIFIES', 'B1 RELAXES', 'B2 TIGHTENS', 'C1 RELAXES', 'C2 RECLASSIFIES', 'D1 RECLASSIFIES', 'T1 TIGHTENS', 'T2 TIGHTENS']);
    expect(R5_CHANGE_LOG.every((c) => c.evidence.length > 30 && !/improves? the score/i.test(c.evidence))).toBe(true);
    expect(r5Of('c250-004').inSample).toMatch(/IN-SAMPLE DIAGNOSTICS, not certification evidence/);
  });
});

describe('E -- the leak rule of generator version 4 (for future runs)', () => {
  it('an ordinary word is not a leak; an identifier is', () => {
    const symbols = ['result', 'verdict', 'categories', 'r1', 'r2', 'vi', 'vj', 'a'];
    expect(leakedVocabularyV4('Give the result to 1 decimal place. State the verdict that follows. Compare it with the other categories.', symbols)).toEqual([]);
    expect(leakedVocabularyV4('construida a partir de los valores a = 5, r1 = -5 y r2 = 4', symbols)).toEqual(['r1', 'r2']);
    expect(leakedVocabularyV4('The display has categories: 6 and verdict = SUPPORTED', symbols)).toEqual(['SUPPORTED', 'verdict', 'categories']);
    expect(leakedVocabularyV4('Write down the values of vi and vj.', symbols)).toEqual(['vi', 'vj']);
    expect(leakedVocabularyV4('State the OPTION_WITH_HIGHER_UNIT_RATE.', symbols)).toEqual(['OPTION_WITH_HIGHER_UNIT_RATE']);
    expect([isOrdinaryWordSymbol('result'), isOrdinaryWordSymbol('r1'), isOrdinaryWordSymbol('xv'), isOrdinaryWordSymbol('categories')]).toEqual([true, false, false, true]);
  });
  it('of the Canary\'s eight leak refusals six were of ordinary words; the slots stay "no candidate" in the Canary', async () => {
    const d = await json<{ refusals: number; falseUnderVersion4: number; stillRefusedAsALeak: number; label: string; slots: Array<{ slotId: string; version3Refusal: string; version4: string; falseUnderVersion4: boolean }> }>('harnessLeakDiagnostic');
    expect([d.refusals, d.falseUnderVersion4, d.stillRefusedAsALeak]).toEqual([8, 6, 2]);
    expect(d.slots.map((s) => `${s.slotId} ${s.version3Refusal.split(':')[1]} -> ${s.version4.split(':')[0]}`)).toEqual(['c250-002 result -> ACCEPTED', 'c250-028 r1,r2 -> RESPONSE_LEAKS_SPECIFICATION_VOCABULARY', 'c250-081 result -> ACCEPTED', 'c250-083 verdict -> RESPONSE_STRUCTURED_STIMULUS_INVALID', 'c250-123 verdict -> ACCEPTED', 'c250-152 categories -> ACCEPTED', 'c250-192 result -> ACCEPTED', 'c250-202 r1,r2 -> RESPONSE_LEAKS_SPECIFICATION_VOCABULARY']);
    expect(d.label).toMatch(/stay "no candidate" in the Canary/);
    // the frozen Canary still says: no candidate
    const stored = (JSON.parse(read(`${CANARY_DIR}/generated-candidates.json`)) as { slots: Array<{ slotId: string; state: string; candidate: unknown }> }).slots;
    for (const s of d.slots) expect(stored.find((x) => x.slotId === s.slotId)).toMatchObject({ state: 'REFUSED_BY_HARNESS', candidate: null });
  });
  it('version 4 is a new file beside version 3; a prompt carries demand and typed guidance only when they are given', () => {
    expect(() => execFileSync('git', ['diff', '--quiet', 'caed21c', '--', 'src/lib/exam-core/question-bank/production/generator/specification-generation-v3.ts', 'src/lib/exam-core/question-bank/production/generator/specification-generation-v2.ts', 'src/lib/exam-core/question-bank/production/specification-validators-r4.ts'], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
    const slot = slots.get('c250-226')!;
    const base = { constructVocabulary: constructVocabularyOf(slot.construct), constructIntegrity: constructIntegrityOf(slot.construct), policy: { ...canaryPolicyFor('m', slot.specification.variable.language), author: { kind: 'MODEL' as const, model: 'm', promptVersion: 'specification-prompt@4', requestedBy: 't' } }, templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V4, provider: new RecordedResponseProvider('r', 'm', {}) };
    const plain = renderSpecificationPromptV4({ ...base, unit: { unitKey: 'u#a1', specification: slot.specification, attempt: 1, avoid: { parameterSets: [], scenarios: [] } } });
    const full = renderSpecificationPromptV4({ ...base, unit: { unitKey: 'u#a1', specification: slot.specification, attempt: 1, avoid: { parameterSets: [], scenarios: [] }, demand: composeDemand(slot.specification) as unknown as Record<string, unknown>, slotGuidance: typedGuidance(slot.construct, 3, 'a materials test') as unknown as Record<string, unknown> } });
    expect(['demand' in plain.prompt.instruction, 'slotGuidance' in plain.prompt.instruction, plain.prompt.instruction.itemWritingRules.length]).toEqual([false, false, 8]);
    expect([full.prompt.instruction.demand!.minimumReasoningSteps, (full.prompt.instruction.slotGuidance as { pinned: unknown[] }).pinned.length, full.prompt.instruction.itemWritingRules.length, full.prompt.instruction.harness]).toEqual([4, 4, 10, SPECIFICATION_GENERATION_HARNESS_V4]);
    expect(full.promptHash).not.toBe(plain.promptHash);
  });
});

describe('F -- spend: one authoritative total, and the Canary reconciled', () => {
  const lines = read(`${CANARY_DIR}/run-log.jsonl`).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  it('recomputed from the frozen run log: 29.973085, every phase, the pre-flight included', async () => {
    const a = authoritativeSpend(lines as never, 3.005135);
    expect(a).toEqual({ earlierRunsUsd: 3.005135, byPhase: { PREFLIGHT: { calls: 1, usd: 0.059895 }, GENERATION: { calls: 250, usd: 13.912345 }, REVIEW: { calls: 210, usd: 12.99571 } }, runUsd: 26.96795, cumulativeUsd: 29.973085 });
    const s = await json<{ AUTHORITATIVE_CUMULATIVE_SPEND_USD: number; reconciled: boolean; CANARY_FIGURES_RECONCILE_AS_WRITTEN: string; EVERY_DIFFERENCE_EXPLAINED: string; sources: Array<{ source: string; cumulativeUsd: number; differenceFromAuthoritativeUsd: number; reconciles: boolean; explanation: string | null }> }>('spendReconciliation');
    expect([s.AUTHORITATIVE_CUMULATIVE_SPEND_USD, s.reconciled, s.CANARY_FIGURES_RECONCILE_AS_WRITTEN, s.EVERY_DIFFERENCE_EXPLAINED]).toEqual([29.973085, false, 'NO', 'YES']);
    expect(s.sources.map((x) => [x.cumulativeUsd, x.differenceFromAuthoritativeUsd, x.reconciles])).toEqual([[29.973085, 0, true], [29.973085, 0, true], [29.973085, 0, true], [29.91319, -0.059895, false], [29.91319, -0.059895, false]]);
    expect(s.sources[3].explanation).toMatch(/left out the one PREFLIGHT call \(0\.059895\)/);
    expect(a.cumulativeUsd).toBeLessThanOrEqual(30);
  });
  it('version 2 states one figure everywhere, and a report that does not reconcile is refused', () => {
    const a = authoritativeSpend(lines as never, 3.005135);
    const f = spendFiguresV2(a);
    const good = reconcile(a, [{ source: 'metrics', cumulativeUsd: f.ASSUMED_CUMULATIVE_SPEND_USD }, { source: 'ledger header', cumulativeUsd: f.ledgerHeaderCumulativeUsd }]);
    expect([good.reconciled, assertReconciled(good).sources.every((x) => x.reconciles)]).toEqual([true, true]);
    expect(() => assertReconciled(reconcile(a, [{ source: 'metrics', cumulativeUsd: 29.91319 }]))).toThrow(SpendNotReconciledError);
    expect(() => assertReconciled(reconcile(a, [{ source: 'metrics', cumulativeUsd: 29.91319 }]))).toThrow(/SPEND_NOT_RECONCILED: metrics -0\.059895/);
    // a call started and never finished is charged at its worst case
    expect(authoritativeSpend([{ type: 'CALL_STARTED', phase: 'REVIEW', slotId: 'a', worstCaseCostUsdAssumed: 0.07 }, { type: 'CALL_STARTED', phase: 'REVIEW', slotId: 'b', worstCaseCostUsdAssumed: 0.07 }, { type: 'CALL_FINISHED', phase: 'REVIEW', slotId: 'b', costUsdAssumed: 0.05 }], 1).cumulativeUsd).toBe(1.12);
  });
});

describe('1 -- the human review: the packet audited, the form, the second review', () => {
  // SYNTHETIC: no person wrote this. It exists to exercise the rules and is written to no artifact.
  const synthetic = (over: Partial<HumanResponse> = {}, reviewer: Partial<HumanResponse['reviewer']> = {}): HumanResponse => ({ academic_correctness: 'CORRECT', answer_key_correctness: 'CORRECT', construct_fit: 'FITS', assessment_system_fidelity: 'FAITHFUL', paper_level_fidelity: 'AT_LEVEL', difficulty_achieved: 'MATCHES_STATED_BAND', originality_material_duplicate: 'NO_CONCERN', wording_clarity: 'CLEAR', final_human_decision: 'APPROVED', reviewer_notes: '', ...over, reviewer: { reviewer_id: 'synthetic-person-01', reviewer_kind: 'HUMAN', qualification: 'synthetic qualification for a test', reviewed_at: '2026-10-20T10:00:00.000Z', minutes_spent: 7, reviewed_blind: true, consulted_ai: false, ...reviewer } });
  const AI_PASS: FrozenAiDecision = { classification: 'APPROVED', academicCorrectness: 'PASS', agreesWithKey: 'AGREES' };
  it('AUDIT: the ten blind items of the frozen packet expose no AI verdict, no validator verdict and nothing of the key file; the other 27 do show them', async () => {
    const audit = await json<{ items: number; blindItems: number; blindItemIds: string[]; BLIND_ITEMS_EXPOSE_NO_AUTOMATED_RESULT: boolean; whatTheOtherItemsShow: { items: number; automatedContentShown: string[] }; perItem: Array<{ ITEM_ID: string; designatedBlind: boolean; automatedContent: string[]; presentation: string }> }>('packetAudit');
    expect([audit.items, audit.blindItems, audit.BLIND_ITEMS_EXPOSE_NO_AUTOMATED_RESULT, audit.whatTheOtherItemsShow.items]).toEqual([37, 10, true, 27]);
    expect(audit.blindItemIds).toEqual(['c250-016', 'c250-032', 'c250-037', 'c250-093', 'c250-128', 'c250-138', 'c250-147', 'c250-187', 'c250-226', 'c250-233']);
    expect(audit.whatTheOtherItemsShow.automatedContentShown).toEqual(['aiReview', 'classification', 'dimensions', 'independentSolution', 'reviewerQuestion', 'validatorGates']);
    // independently of the audit's own code: the frozen packet, read here
    const packet = JSON.parse(read(`${CANARY_DIR}/human-calibration-packet.json`)) as { items: Array<Record<string, unknown> & { ITEM_ID: string }> };
    const key = JSON.parse(read(`${CANARY_DIR}/human-calibration-key.json`)) as { items: Array<{ ITEM_ID: string; blind: boolean; reasons: Array<{ reason: string }> }> };
    for (const k of key.items.filter((x) => x.blind)) {
      const text = JSON.stringify(packet.items.find((i) => i.ITEM_ID === k.ITEM_ID));
      expect(text, k.ITEM_ID).not.toMatch(/aiReview|validatorGates|classification|APPROVED|REJECTED|NEEDS_HUMAN_REVIEW|BLIND_AUDIT|OVER_REJECTION|uncertaintyScore|MACHINE_VERIFIED|"rule"|reviewerQuestion/);
      expect(automatedContentIn(packet.items.find((i) => i.ITEM_ID === k.ITEM_ID))).toEqual([]);
    }
    expect(() => execFileSync('git', ['diff', '--quiet', 'caed21c', '--', `${CANARY_DIR}/human-calibration-packet.json`, `${CANARY_DIR}/human-calibration-key.json`, `${CANARY_DIR}/human-calibration-sample.json`, `${CANARY_DIR}/human-calibration-set.json`], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
  });
  it('the response template: 37 items, the ten fields with their vocabularies, and NOT ONE response', async () => {
    const t = await json<{ items: Array<{ ITEM_ID: string; first_review: unknown; second_review: unknown }>; noAi: string }>('responseTemplate');
    expect([t.items.length, t.items.every((i) => i.first_review === null && i.second_review === null), t.noAi]).toEqual([37, true, FORM_NO_AI]);
    expect(formIssues(t)).toEqual([]);
    expect([...HUMAN_REVIEW_FIELDS]).toEqual(['academic_correctness', 'answer_key_correctness', 'construct_fit', 'assessment_system_fidelity', 'paper_level_fidelity', 'difficulty_achieved', 'originality_material_duplicate', 'wording_clarity', 'final_human_decision', 'reviewer_notes']);
    expect(Object.keys(HUMAN_REVIEW_VOCABULARIES)).toEqual(HUMAN_REVIEW_FIELDS.slice(0, 9));
    expect([HUMAN_REVIEW_VOCABULARIES.paper_level_fidelity, HUMAN_REVIEW_VOCABULARIES.final_human_decision]).toEqual([['AT_LEVEL', 'BELOW_LEVEL', 'ABOVE_LEVEL', 'NOT_APPLICABLE', 'NOT_ASSESSABLE'], ['APPROVED', 'NEEDS_REVISION', 'REJECTED']]);
    // nothing written by this lane holds a human judgement
    for (const name of Object.keys(POST_CANARY_FILES) as Array<keyof typeof POST_CANARY_FILES>) expect((await artifacts)[name], name).not.toMatch(/"final_human_decision":\s*"(APPROVED|NEEDS_REVISION|REJECTED)"|"HUMAN_DECISION":\s*"/);
  });
  it('a reviewer that is an AI, or used one, is refused for either slot; the second reviewer is another person', () => {
    expect(reviewerIssues(synthetic().reviewer)).toEqual([]);
    for (const id of ['claude-sonnet-5-5', 'GPT reviewer', 'studyus AI reviewer', 'review bot', 'an LLM', 'the model']) expect(reviewerIssues({ ...synthetic().reviewer, reviewer_id: id }), id).toEqual(['REVIEWER_IDENTITY_NAMES_AN_AI_SYSTEM']);
    expect(reviewerIssues({ ...synthetic().reviewer, consulted_ai: true })).toEqual(['REVIEW_WAS_AI_ASSISTED_OR_DOES_NOT_SAY']);
    expect(reviewerIssues({ ...synthetic().reviewer, reviewer_kind: 'AI' })).toEqual(['REVIEWER_IS_NOT_DECLARED_HUMAN']);
    const form = emptyForm({ itemIds: ['c250-001', 'c250-002'], runId: 'r', freezeCommitSha: 'abc', packet: 'p' });
    form.items[0].first_review = synthetic({}, { reviewer_id: 'claude' });
    expect(formIssues(form)).toEqual(['c250-001:first_review:REVIEWER_IDENTITY_NAMES_AN_AI_SYSTEM']);
    form.items[0].first_review = synthetic();
    form.items[0].second_review = synthetic({}, { reviewer_kind: 'MODEL' as never });
    expect(formIssues(form)[0]).toBe('c250-001:second_review:REVIEWER_IS_NOT_DECLARED_HUMAN');
    form.items[0].second_review = synthetic();
    expect(formIssues(form)).toEqual(['c250-001:SECOND_REVIEW_BY_THE_SAME_PERSON']);
    form.items[0].second_review = synthetic({}, { reviewer_id: 'synthetic-person-02' });
    expect(formIssues(form)).toEqual([]);
    form.items[1].second_review = synthetic();
    expect(formIssues(form)).toEqual(['c250-002:SECOND_REVIEW_WITHOUT_A_FIRST']);
    form.items[1].second_review = null;
    form.items[1].first_review = synthetic({ wording_clarity: 'UNCLEAR', final_human_decision: 'NEEDS_REVISION' });
    expect(formIssues(form)).toEqual(['c250-002:first_review:REVIEWER_NOTES_REQUIRED_WHEN_ANY_JUDGEMENT_IS_NOT_CLEAN']);
    form.items[1].first_review = synthetic({ answer_key_correctness: 'INCORRECT', reviewer_notes: 'The key is the complement.' });
    expect(formIssues(form)).toEqual(['c250-002:first_review:APPROVED_WITH_AN_INCORRECT_ITEM_OR_KEY']);
    expect(formIssues({ ...form, items: [{ ...form.items[0], extra: 1 }] })[0]).toMatch(/^SCHEMA:/);
  });
  it('SECOND_HUMAN_REVIEW_REQUIRED: computed from the recorded response and the frozen AI decision, by four stated rules', () => {
    const need = (h: Partial<HumanResponse>, ai: FrozenAiDecision) => { const d = secondHumanReviewRequired(synthetic(h), ai); return `${d.SECOND_HUMAN_REVIEW_REQUIRED}:${d.reasons.join('+')}`; };
    const AI_REJECT: FrozenAiDecision = { classification: 'REJECTED', academicCorrectness: 'FAIL', agreesWithKey: 'DISAGREES' }, AI_DEFER: FrozenAiDecision = { classification: 'NEEDS_HUMAN_REVIEW', academicCorrectness: 'PASS', agreesWithKey: 'AGREES' };
    expect(need({}, AI_PASS)).toBe('NO:');
    expect(need({ final_human_decision: 'REJECTED', construct_fit: 'DOES_NOT_FIT' }, AI_PASS)).toBe('YES:FINAL_DECISION_DISAGREES_WITH_THE_AI');
    expect(need({ final_human_decision: 'NEEDS_REVISION', wording_clarity: 'UNCLEAR' }, AI_PASS)).toBe('YES:FINAL_DECISION_DISAGREES_WITH_THE_AI');
    expect(need({}, AI_REJECT)).toBe('YES:FINAL_DECISION_DISAGREES_WITH_THE_AI+AI_FOUND_AN_ERROR_THE_PERSON_PASSED');
    expect(need({ final_human_decision: 'REJECTED', answer_key_correctness: 'INCORRECT' }, AI_REJECT)).toBe('NO:');
    expect(need({ final_human_decision: 'REJECTED', answer_key_correctness: 'INCORRECT' }, AI_PASS)).toBe('YES:FINAL_DECISION_DISAGREES_WITH_THE_AI+PERSON_FOUND_AN_ERROR_THE_AI_PASSED');
    expect(need({ answer_key_correctness: 'AMBIGUOUS' }, AI_PASS)).toBe('YES:CORRECTNESS_OR_KEY_NOT_SETTLED');
    expect(need({ academic_correctness: 'NOT_ASSESSABLE' }, AI_DEFER)).toBe('YES:CORRECTNESS_OR_KEY_NOT_SETTLED');
    // an item the AI sent to a person has no AI decision to disagree with
    expect(need({ final_human_decision: 'REJECTED', construct_fit: 'DOES_NOT_FIT' }, AI_DEFER)).toBe('NO:');
    expect(need({ final_human_decision: 'REJECTED', academic_correctness: 'INCORRECT' }, AI_DEFER)).toBe('YES:PERSON_FOUND_AN_ERROR_THE_AI_PASSED');
    // the determination is not a field of the form a reviewer fills, nor of the packet
    expect(JSON.stringify(emptyForm({ itemIds: ['c250-001'], runId: null, freezeCommitSha: null, packet: 'p' }))).not.toMatch(/SECOND_HUMAN_REVIEW_REQUIRED/);
  });
  it('which label is THE human label: settled by one review, by two that agree, or not settled -- and never by an AI', () => {
    const first = synthetic({ final_human_decision: 'REJECTED', construct_fit: 'DOES_NOT_FIT' });
    expect(humanLabelOf({ first_review: null, second_review: null }, AI_PASS)).toEqual({ state: 'NO_REVIEW' });
    expect(humanLabelOf({ first_review: synthetic(), second_review: null }, AI_PASS)).toMatchObject({ state: 'SETTLED', by: 'FIRST_REVIEW' });
    expect(humanLabelOf({ first_review: first, second_review: null }, AI_PASS)).toEqual({ state: 'AWAITING_SECOND_REVIEW', reasons: ['FINAL_DECISION_DISAGREES_WITH_THE_AI'] });
    expect(humanLabelOf({ first_review: first, second_review: synthetic({ final_human_decision: 'REJECTED', construct_fit: 'PARTIALLY_FITS' }, { reviewer_id: 'synthetic-person-02' }) }, AI_PASS)).toMatchObject({ state: 'SETTLED', by: 'TWO_REVIEWS_AGREE', differingFields: ['construct_fit'] });
    expect(humanLabelOf({ first_review: first, second_review: synthetic({}, { reviewer_id: 'synthetic-person-02' }) }, AI_PASS).state).toBe('UNSETTLED');
  });
  it('a version-2 label maps into a valid row of the version-1 calibration set, which is untouched', () => {
    const set = emptyCalibrationSet({ items: [], runId: 'r', freezeCommitSha: 'abc', freezeManifestHash: 'f'.repeat(64), sampleProcedure: { id: 'p', version: '1' }, reviewerVersion: 'x@1' });
    set.rows = [toCalibrationRowV1('c250-001', 'APPROVED', synthetic(), agreementOf), toCalibrationRowV1('c250-002', 'APPROVED', synthetic({ final_human_decision: 'REJECTED', answer_key_correctness: 'INCORRECT', reviewer_notes: 'Key is wrong.' }), agreementOf), toCalibrationRowV1('c250-003', 'REJECTED', synthetic({ final_human_decision: 'NEEDS_REVISION', wording_clarity: 'UNCLEAR', reviewer_notes: 'Reword.' }), agreementOf), toCalibrationRowV1('c250-004', 'NEEDS_HUMAN_REVIEW', synthetic({ paper_level_fidelity: 'BELOW_LEVEL', reviewer_notes: 'Too easy for the paper.' }), agreementOf)];
    expect(calibrationSetIssues(set)).toEqual([]);
    expect(set.rows.map((r) => `${r.HUMAN_DECISION}/${r.AGREEMENT}/${r.DEFECT_CLASS}/${r.SEVERITY}`)).toEqual(['APPROVED/AGREE/NONE/NONE', 'REJECTED/AI_TOO_LENIENT/WRONG_KEY/CRITICAL', 'REJECTED/AGREE/LANGUAGE_OR_CLARITY/MAJOR', 'APPROVED/AI_DEFERRED/PROFILE_MISMATCH/MINOR']);
    expect(() => execFileSync('git', ['diff', '--quiet', 'caed21c', '--', 'scripts/operations/qb-canary-250/calibration.ts'], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
  });
  it('the printable packets: every item, its key, its band and the ten questions; a blind item with no automated result; the fully blind rendering with none at all', async () => {
    const a = await artifacts;
    const sections = a.packetHtml.split('<section>').slice(1);
    expect(sections).toHaveLength(37);
    const blindIds = ['c250-016', 'c250-032', 'c250-037', 'c250-093', 'c250-128', 'c250-138', 'c250-147', 'c250-187', 'c250-226', 'c250-233'];
    for (const s of sections) {
      const id = /c250-\d{3}/.exec(s)![0];
      expect(s.includes('Automated results'), id).toBe(!blindIds.includes(id));
      if (blindIds.includes(id)) expect(s, id).not.toMatch(/NEEDS_HUMAN_REVIEW|validatorGates|aiReview|MACHINE_VERIFIED|independentSolution|Automated results/);
      for (const field of HUMAN_REVIEW_FIELDS) expect(s.includes(`<th>${field}</th>`), `${id} ${field}`).toBe(true);
      expect(s).toMatch(/Stated band:<\/b> (FOUNDATIONAL|STANDARD|CHALLENGE)/);
      expect(s).toMatch(/Key:|Numeric key:|Answer:/);
    }
    expect(a.packetFullyBlindHtml.split('<section>').slice(1)).toHaveLength(37);
    expect(a.packetFullyBlindHtml).not.toMatch(/Automated results|validatorGates|aiReview|independentSolution/);
    expect(a.packetHtml.match(/<svg/g)!.length).toBe(1);
    const blindJson = JSON.parse(a.packetFullyBlindJson) as { items: Array<Record<string, unknown>> };
    expect([blindJson.items.length, blindJson.items.every((i) => automatedContentIn(i).length === 0 && i.presentation === 'BLIND')]).toEqual([37, true]);
    expect(REVIEWER_INSTRUCTIONS).toMatch(/Do not consult any AI system/);
    expect(REVIEWER_INSTRUCTIONS).toMatch(/no profile in this project is the board's standard/);
    expect(a.instructions).toBe(REVIEWER_INSTRUCTIONS);
  });
});

describe('3 -- the demand profile, version 2: a structure, provisional, no board\'s standard', () => {
  it('everything is labelled StudyUs policy, provisional, awaiting subject-matter-expert confirmation; nothing claims to be official', () => {
    expect([DEMAND_PROFILE_V2.authority, DEMAND_PROFILE_V2.status, DEMAND_PROFILE_V2.requiresSubjectMatterExpertConfirmation]).toEqual(['STUDYUS_POLICY', 'PROVISIONAL', true]);
    expect(PAPER_FIDELITY_PROFILES.map((p) => p.componentId)).toEqual(['IB.MATH_AA_HL.P1', 'IB.MATH_AA_HL.P2', 'CAMBRIDGE.9709.P1', 'PAA.MATEMATICAS', 'ICFES.SABER11_MATEMATICAS', 'PISA.MATHEMATICS', 'SCHOOL_STEM_PERFORMANCE']);
    for (const p of PAPER_FIDELITY_PROFILES) { expect([p.authority, p.status, p.requiresSubjectMatterExpertConfirmation], p.componentId).toEqual(['STUDYUS_POLICY', 'PROVISIONAL', true]); expect(p.notOfficial).toMatch(/not the board's standard/); expect(p.provisionalFloor.syllabusLevelExpectation).toMatch(/^PROVISIONAL/); }
    expect(JSON.stringify([DEMAND_PROFILE_V2, PAPER_FIDELITY_PROFILES])).not.toMatch(/"authority":"OFFICIAL"|official standard|as required by (the )?(IB|Cambridge)|the board requires/);
    expect(Object.fromEntries(Object.entries(DEMAND_PROFILE_V2.bands).map(([k, b]) => [k, [b.reasoningSteps.min, b.nonRoutineElementRequired]]))).toEqual({ FOUNDATIONAL: [1, false], STANDARD: [2, false], CHALLENGE: [4, true] });
  });
  it('composing a demand block changes no specification: ids, hashes and every accepted artifact are what they were', () => {
    for (const s of [...slots.values()].slice(0, 60)) { const before = JSON.stringify(s.specification); const d = composeDemand(s.specification); expect(JSON.stringify(s.specification)).toBe(before); expect(d.specificationId).toBe(s.specification.specificationId); }
    expect(() => execFileSync('git', ['diff', '--quiet', 'caed21c', '--', 'src/lib/assessment-adaptation', 'src/lib/exam-core/question-bank/task-families', 'docs/exams/assessment-adaptation', `${CANARY_DIR}/manifest.json`], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
    expect(execFileSync('git', ['status', '--porcelain', '--', 'src/lib/assessment-adaptation', 'src/lib/exam-core/question-bank/task-families'], { cwd: ROOT }).toString()).toBe('');
    const ib = composeDemand(slots.get('c250-045')!.specification), paa = composeDemand(slots.get('c250-008')!.specification), challenge = composeDemand(slots.get('c250-226')!.specification);
    expect([ib.band, ib.paper!.componentId, ib.minimumReasoningSteps, ib.paper!.minimumTotalMarksConstructed, ib.paper!.status]).toEqual(['STANDARD', 'IB.MATH_AA_HL.P2', 3, 5, 'PROVISIONAL']);
    expect([paa.responseType, paa.minimumReasoningSteps, paa.nonRoutineElementRequired, paa.distractorSophistication]).toEqual(['NUMERIC_ENTRY', 1, false, null]);
    expect([challenge.band, challenge.minimumReasoningSteps, challenge.nonRoutineElementRequired, challenge.nonRoutineElement.length, challenge.evidenceClass]).toEqual(['CHALLENGE', 4, true, 3, 'MODELLING']);
    expect(ib.officialFactsOfTheSpecification.calculator).toMatchObject({ value: 'GDC_REQUIRED' });
  });
  it('what is checked, and what is not: a constructed item\'s rewarded steps; a closed item is UNVERIFIED', () => {
    const check = (id: string) => demandCheck(FIX.candidates[id].candidate, composeDemand(slots.get(id)!.specification));
    // an approved Cambridge item of two marks and one method point: below its band and below the provisional paper floor
    expect(check('c250-026')).toMatchObject({ difficultyAchieved: 'BELOW_DEMAND', paperLevelFidelity: 'BELOW_PROVISIONAL_FLOOR', evidencedReasoningSteps: 1, totalMarks: 2, issues: ['REASONING_STEPS_BELOW_THE_BAND:1/2', 'REASONING_STEPS_BELOW_THE_PAPER_FLOOR:1/3', 'TOTAL_MARKS_BELOW_THE_PAPER_FLOOR:2/4'] });
    expect(check('c250-233')).toMatchObject({ difficultyAchieved: 'MEETS_DEMAND', paperLevelFidelity: 'MEETS_PROVISIONAL_FLOOR', evidencedReasoningSteps: 3 });
    // CHALLENGE needs four rewarded steps and a REASONING point
    expect(check('c250-238')).toMatchObject({ difficultyAchieved: 'BELOW_DEMAND', issues: expect.arrayContaining(['REASONING_STEPS_BELOW_THE_BAND:2/4', 'NON_ROUTINE_ELEMENT_NOT_EVIDENCED_BY_A_REASONING_POINT']) });
    expect(check('c250-008')).toMatchObject({ difficultyAchieved: 'UNVERIFIED', paperLevelFidelity: 'UNVERIFIED', evidencedReasoningSteps: null });
    expect(check('c250-008').notCheckable[0]).toMatch(/a closed item shows no working/);
    expect(check('c250-026').notCheckable).toContain('whether the level is the level of the paper: the floor is StudyUs policy, not the board\'s standard');
  });
  it('DIAGNOSTIC: the 76 CHALLENGE candidates and the approved IB / Cambridge items under the new checks', async () => {
    const d = await json<{ label: string; challengeBand: { candidates: number; constructed: number; constructedBelowDemand: number; difficultyAchieved: Record<string, number> }; approvedIbAndCambridge: Array<{ slotId: string; paperLevelFidelity: string }>; ibAndCambridgeCandidates: { candidates: number; paperLevelFidelity: Record<string, number> } }>('demandDiagnostic');
    expect(d.challengeBand).toMatchObject({ candidates: 76, constructed: 36, constructedBelowDemand: 28, difficultyAchieved: { BELOW_DEMAND: 28, MEETS_DEMAND: 8, UNVERIFIED: 40 } });
    expect(d.approvedIbAndCambridge.map((x) => `${x.slotId}:${x.paperLevelFidelity}`)).toEqual(['c250-026:BELOW_PROVISIONAL_FLOOR', 'c250-045:BELOW_PROVISIONAL_FLOOR', 'c250-138:BELOW_PROVISIONAL_FLOOR', 'c250-170:BELOW_PROVISIONAL_FLOOR', 'c250-173:BELOW_PROVISIONAL_FLOOR', 'c250-216:BELOW_PROVISIONAL_FLOOR', 'c250-233:MEETS_PROVISIONAL_FLOOR']);
    expect(d.ibAndCambridgeCandidates).toEqual({ candidates: 82, paperLevelFidelity: { BELOW_PROVISIONAL_FLOOR: 55, MEETS_PROVISIONAL_FLOOR: 27 } });
    expect(d.label).toMatch(/PROVISIONAL, requires subject-matter-expert confirmation\. Not the standard of any board/);
  });
});

describe('4 -- parameter policy and typed guidance, version 2; the four families', () => {
  it('pinned values are derived from the construct\'s solvability constraint: over 250 slots every optimum is whole and inside its factors', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 250; n += 1) {
      const o = cleanOptimum(n);
      const xv = (o.q * o.r - o.p * o.s) / (2 * o.q * o.s);
      expect([Number.isInteger(xv), xv === o.xv, o.p + o.q * xv > 0, o.r - o.s * xv > 0, (o.p + o.q * xv) * (o.r - o.s * xv) === o.Qv, Number.isInteger(o.Qv)], `n=${n}`).toEqual([true, true, true, true, true, true]);
      seen.add(`${o.p}|${o.q}|${o.r}|${o.s}`);
      const l = cleanLine(n);
      expect([Number.isInteger(l.x2) && Number.isInteger(l.y2), l.x2 !== l.x1, Number.isInteger(l.slope * 2), Number.isInteger(l.intercept * 2), (l.y2 - l.y1) / (l.x2 - l.x1) === l.slope], `line n=${n}`).toEqual([true, true, true, true, true]);
      const p = cleanProportion(n);
      expect([(p.b * p.c) / p.a === p.x, Number.isInteger(p.x), p.c !== p.a]).toEqual([true, true, true]);
    }
    expect(seen.size).toBe(250);
    expect(new Set(Array.from({ length: 150 }, (_, n) => { const r = cleanRoots(n); return `${r.r1}|${r.r2}`; })).size).toBe(150);
    // the Canary's case: p = 50 pinned alone gave a vertex of 49/3
    expect((6 * 164 - 50 * 4) / (2 * 6 * 4)).toBeCloseTo(49 / 3, 12);
  });
  it('guidance is typed: every pinned value has a role, and the display is described apart from the situation', () => {
    const g = typedGuidance('QUADRATIC_MODEL_VERTEX_OPTIMUM', 7, 'a bakery');
    expect(g.pinned.map((p) => `${p.parameter}: ${p.role}`)).toEqual(['p: the starting value of the factor that increases', 'q: the increase of that factor per unit of x', 'r: the starting value of the factor that decreases', 's: the decrease of that factor per unit of x']);
    expect(g.guarantees[0]).toMatch(/^the optimum is at x = \d+, a whole number$/);
    const claim = typedGuidance('CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY', 9, 'home cooking for guests');
    expect(claim).toMatchObject({ pinned: [], display: { numberOfCategories: 6, verdictTheDisplayMustGive: 'SUPPORTED' } });
    expect(claim.display!.categoriesMeans).toMatch(/number of ROWS \(categories\) of the display\. It is not a count of people or things/);
    expect(() => typedGuidance('UNKNOWN', 0, null)).toThrow(/NO_PARAMETER_POLICY_FOR_CONSTRUCT/);
    for (const c of Object.keys(R5_READERS)) expect(typedGuidance(c, 4, null).policy.version, c).toBe('2');
  });
  it('a pinned value must be used in the role intended: the Canary\'s "6 guests" is caught', () => {
    const g = typedGuidance('CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY', 9, null);
    expect(pinnedRoleIssues(FIX.candidates['c250-211'].candidate, FIX.candidates['c250-211'].stimulus, g)).toEqual(['DISPLAY_CATEGORY_COUNT_WRITTEN_AS_A_QUANTITY_OF_THE_SITUATION:6']);
    const fine = JSON.parse(JSON.stringify(FIX.candidates['c250-211'].stimulus)) as CandidateStimulus;
    fine.parts = fine.parts.map((p) => (p.partKind === 'TEXT' ? { ...p, text: 'Una familia preguntó a sus invitados qué acompañamiento preferían.' } : p));
    expect(pinnedRoleIssues(FIX.candidates['c250-211'].candidate, fine, g)).toEqual([]);
    expect(pinnedRoleIssues(FIX.candidates['c250-211'].candidate, fine, { ...g, display: { ...g.display!, numberOfCategories: 4 } })).toEqual(['DISPLAY_CATEGORIES_NOT_AS_PINNED:6/4']);
    const line = { policy: g.policy, scenarioDomain: null, guarantees: [], display: null, pinned: [{ parameter: 'x1', value: -8, role: 'the x-coordinate of the first point' }, { parameter: 'y1', value: -9, role: 'the y-coordinate of the first point' }] };
    expect(pinnedRoleIssues(FIX.candidates['c250-004'].candidate, null, line)).toEqual([]);
    expect(pinnedRoleIssues(FIX.candidates['c250-004'].candidate, null, { ...line, pinned: [{ parameter: 'x1', value: 5, role: 'the x-coordinate of the first point' }] })).toEqual(['PINNED_VALUE_NOT_DECLARED_IN_ITS_ROLE:x1=5', 'PINNED_VALUE_NOT_VISIBLE_IN_THE_ITEM:x1=5']);
  });
  it('the four families with no approved item: one primary cause per slot, by stated rules', async () => {
    const f = await json<{ families: Array<{ familyId: string; slots: number; candidates: number; primaryCause: string; byCause: Record<string, number>; whatRevision5AloneChanges: { v4StrictPass: number; v5StrictPass: number } }> }>('families');
    expect(f.families.map((x) => x.familyId)).toEqual([...ZERO_APPROVAL_FAMILIES]);
    expect(f.families.map((x) => [x.slots, x.candidates, x.primaryCause, x.byCause, x.whatRevision5AloneChanges.v4StrictPass, x.whatRevision5AloneChanges.v5StrictPass])).toEqual([
      [26, 25, 'GENERATOR_PROMPT', { GENERATOR_PROMPT: 21, OTHER: 3, DIFFICULTY_PROFILE: 2 }, 2, 10],
      [25, 24, 'VALIDATOR', { VALIDATOR: 9, DIFFICULTY_PROFILE: 8, TASK_FAMILY_SPEC: 4, GENERATOR_PROMPT: 2, OTHER: 2 }, 0, 7],
      [24, 21, 'GENERATOR_PROMPT', { GENERATOR_PROMPT: 10, DIFFICULTY_PROFILE: 6, VALIDATOR: 6, OTHER: 2 }, 1, 17],
      [25, 23, 'GENERATOR_PROMPT', { GENERATOR_PROMPT: 20, OTHER: 3, PARAMETER_POLICY: 2 }, 1, 2],
    ]);
    for (const x of f.families) expect(Object.values(x.byCause).reduce((a, b) => a + b, 0), x.familyId).toBe(x.slots);
    expect(CAUSE_RULES).toHaveLength(10);
    const slot = (over: Partial<FamilySlot>): FamilySlot => ({ slotId: 's', familyId: ZERO_APPROVAL_FAMILIES[3], generationState: 'CANDIDATE', generationCode: null, v4StrictPass: false, v5: null, v5Gates: null, ai: { classification: 'NEEDS_HUMAN_REVIEW', agreesWithKey: 'AGREES', verdicts: {} }, nonCleanVertex: false, asksValueAtX: false, ...over });
    expect([causeOf(slot({ generationState: 'NO_CONTENT' })).code, causeOf(slot({ generationState: 'REFUSED_BY_HARNESS' })).code, causeOf(slot({ ai: { classification: 'REJECTED', agreesWithKey: 'DISAGREES', verdicts: {} }, nonCleanVertex: true })).cause, causeOf(slot({ ai: { classification: 'REJECTED', agreesWithKey: 'DISAGREES', verdicts: {} } })).code, causeOf(slot({ asksValueAtX: true })).cause, causeOf(slot({ ai: { classification: 'NEEDS_HUMAN_REVIEW', agreesWithKey: 'AGREES', verdicts: { DIFFICULTY: 'CONCERN' } } })).cause, causeOf(slot({})).cause, causeOf(slot({ ai: null })).code]).toEqual(['PROVIDER_TIMEOUT', 'HARNESS_REFUSAL', 'PARAMETER_POLICY', 'WRONG_KEY', 'TASK_FAMILY_SPEC', 'DIFFICULTY_PROFILE', 'VALIDATOR', 'NOT_REVIEWED']);
  });
});

describe('5 -- the offline replay: revision 5 over the Canary\'s 221 candidates (in-sample; the Canary is not rescored)', () => {
  type Replay = { label: string; inSample: string; OFFLINE_REPLAY: string; criteriaMet: string; criteria: Array<{ id: string; pass: boolean; observed: string[] }>; disclosedAfterComputing: Array<{ slotId: string }>; comparison: Record<string, Record<string, unknown>> & { candidates: number }; namedCases: { confirmedWrongKeys: Array<{ slotId: string; v5: { answerKey: string } }>; knownFalseFailures: Array<{ slotId: string; v5: { answerKey: string; structural: string } }>; others: Array<{ slotId: string; v5: Record<string, unknown> }> }; items: Array<{ slotId: string; v4: { strictPass: boolean; rejectedByValidator: boolean }; v5: { strictPass: boolean; rejectedByValidator: boolean; gates: { answerKey: string } } }>; profileIssueChannels: Record<string, { channel: string; items: number }> };
  it('every stored artifact is, byte for byte, what the code derives from the frozen Canary', async () => {
    const a = await artifacts;
    for (const name of Object.keys(POST_CANARY_FILES) as Array<keyof typeof POST_CANARY_FILES>) expect(readFileSync(pathOf(ROOT, name), 'utf8') === a[name], name).toBe(true);
    expect(readdirSync(join(ROOT, CANARY_DIR, 'v5-offline-replay')).sort()).toEqual(['changed-outcomes.json', 'counterfactual-ai-policy.json', 'demand-diagnostic.json', 'demand-profile-v2.json', 'family-analysis.json', 'harness-leak-diagnostic.json', 'replay.json']);
    expect(readdirSync(join(ROOT, CANARY_DIR, 'human-review')).sort()).toEqual(['REVIEWER_INSTRUCTIONS.md', 'packet-audit.json', 'response-template.json', 'reviewer-packet-fully-blind.html', 'reviewer-packet-fully-blind.json', 'reviewer-packet.html']);
    const again = await buildPostCanaryArtifacts(ROOT);
    for (const name of Object.keys(POST_CANARY_FILES) as Array<keyof typeof POST_CANARY_FILES>) expect(again[name] === a[name], name).toBe(true);
  }, 240_000);
  it('old against new, with the same definitions for both', async () => {
    const r = await json<Replay>('replay');
    expect(r.comparison.candidates).toBe(221);
    expect(r.comparison.STRICT_PASS).toEqual({ V4: 66, V5: 132, V5_ALSO_NOT_BELOW_DEMAND: 87 });
    expect(r.comparison.KEY_FAILURES).toEqual({ V4: 13, V5: 5 });
    expect(r.comparison.KEY_VERIFIED).toEqual({ V4_FROM_DECLARATIONS: 139, V5_INDEPENDENTLY: 55 });
    expect(r.comparison.V5_KEY_CLASSES_BY_ITEM).toEqual({ INDEPENDENTLY_VERIFIED: 55, KEY_CONTRADICTED: 5, STEM_CONSISTENT: 61, UNVERIFIED: 100 });
    expect(r.comparison.MATERIAL_DUPLICATES).toEqual({ V4: 93, V5: 0, V5_SIGNALS: { mathematicalTemplateSimilarity: 33, structuralSimilarity: 12, abstractItemsWithScenarioRuleNotApplied: 67 } });
    expect(r.comparison.PROFILE_FAILURES).toEqual({ V4: 55, V5: 19, V5_DECLARATION_QUALITY_ONLY: 36 });
    expect(r.comparison.REJECTED_BY_VALIDATOR).toMatchObject({ V4: 16, V5: 7 });
    expect(r.comparison.CONSTRUCT_FAILURES).toEqual({ V4: 12, V5: 13 });
    expect(r.comparison.STIMULUS_FAILURES).toEqual({ V4: 2, V5: 3 });
    expect(Object.fromEntries(Object.entries(r.profileIssueChannels).map(([k, v]) => [k, v.channel]))).toEqual({ COMMAND_TERM_ABSENT: 'HARD', DISPLAY_VALUE_OUT_OF_RANGE: 'HARD', NO_CALCULATOR_RULE_KEYED_NUMBER: 'HARD', NO_CALCULATOR_RULE_STATED_NUMBER: 'HARD', PARAMETER_CONSTRAINT: 'HARD', PARAMETER_NOT_OF_THE_CONSTRUCT: 'DECLARATION_QUALITY', PARAMETER_OUT_OF_RANGE: 'HARD', RUBRIC_HAS_NO_ACCURACY_POINT: 'HARD', WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS: 'DECLARATION_QUALITY', WORKING_SHOWN_BUT_NO_METHOD_POINT: 'HARD' });
    expect(r.label).toMatch(/IN-SAMPLE -- NOT certification evidence, NOT a rescore of the Canary/);
  });
  it('the named cases, and the criteria as they were written before the replay -- including the one that is not met as written', async () => {
    const r = await json<Replay>('replay');
    expect(r.namedCases.confirmedWrongKeys.map((x) => `${x.slotId}:${x.v5.answerKey}`)).toEqual(['c250-016:KEY_CONTRADICTED', 'c250-070:UNVERIFIED', 'c250-085:KEY_CONTRADICTED', 'c250-135:KEY_CONTRADICTED', 'c250-177:KEY_CONTRADICTED', 'c250-226:KEY_CONTRADICTED']);
    expect(r.namedCases.knownFalseFailures.map((x) => `${x.slotId}:${x.v5.answerKey}:${x.v5.structural}`)).toEqual(['c250-004:INDEPENDENTLY_VERIFIED:PASS', 'c250-019:INDEPENDENTLY_VERIFIED:PASS', 'c250-048:INDEPENDENTLY_VERIFIED:PASS', 'c250-079:INDEPENDENTLY_VERIFIED:PASS', 'c250-090:INDEPENDENTLY_VERIFIED:PASS', 'c250-146:UNVERIFIED:PASS', 'c250-153:STEM_CONSISTENT:PASS', 'c250-194:UNVERIFIED:PASS']);
    expect(r.namedCases.others.map((x) => [x.slotId, x.v5.constructPreservation, x.v5.stimulusIntegrity, x.v5.structural, x.v5.strictPass])).toEqual([['c250-122', 'FAIL', 'PASS', 'PASS', false], ['c250-211', 'PASS', 'FAIL', 'PASS', false], ['c250-032', 'PASS', 'NOT_APPLICABLE', 'FAIL', false]]);
    expect(r.criteria.map((c) => `${c.id}:${c.pass}`)).toEqual(['C1:true', 'C2:true', 'C3:true', 'C4:false', 'C5:true', 'C6:true']);
    expect([r.OFFLINE_REPLAY, r.criteriaMet, OFFLINE_REPLAY_CRITERIA.length, CONFIRMED_WRONG_KEYS.length, KNOWN_FALSE_FAILURES.length]).toEqual(['FAIL', '5 of 6', 6, 6, 8]);
    // C4 is not met AS WRITTEN: one more false failure was found by the replay. It is disclosed, not added to the list.
    expect(r.criteria[3].observed[1]).toBe('not among the known false failures: c250-241');
    expect(r.disclosedAfterComputing.map((d) => d.slotId)).toEqual(['c250-241']);
    expect(DISCLOSED_AFTER_COMPUTING[0].what).toMatch(/Confirmed by the lane's own working only/);
    // every contradiction of revision 5 is one the frozen AI reviewer also found
    expect(r.items.filter((i) => i.v5.gates.answerKey === 'KEY_CONTRADICTED').map((i) => i.slotId)).toEqual(['c250-016', 'c250-085', 'c250-135', 'c250-177', 'c250-226']);
    expect(r.items.filter((i) => i.v4.strictPass && !i.v5.strictPass).map((i) => i.slotId)).toEqual(['c250-211']);
  });
  it('the frozen AI decisions are not recomputed: the counterfactual is labelled as one, and the Canary\'s files have not moved', async () => {
    const c = await json<{ label: string; reviewed: number; canaryAsRecorded: Record<string, number>; withRevision5Gates: Record<string, number> }>('counterfactual');
    expect(c.label).toMatch(/^COUNTERFACTUAL -- IN-SAMPLE -- NOT EVIDENCE/);
    expect([c.reviewed, c.canaryAsRecorded, c.withRevision5Gates]).toEqual([210, { APPROVED: 25, NEEDS_HUMAN_REVIEW: 157, REJECTED: 28 }, { APPROVED: 40, NEEDS_HUMAN_REVIEW: 150, REJECTED: 20 }]);
    const frozen = [...canaryFrozenSourceFiles(ROOT), ...readStoredCanaryFreeze(ROOT)!.dataFiles.map((f) => f.path)];
    expect(() => execFileSync('git', ['diff', '--quiet', 'f445e7a', '--', ...frozen], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
    expect(() => execFileSync('git', ['diff', '--quiet', 'caed21c', '--', ...['ai-review.json', 'automated-validation-report.json', 'generated-candidates.json', 'metrics.json', 'spend-ledger.json', 'run-log.jsonl', 'rights-record.json', 'freeze.json', 'manifest.json'].map((f) => `${CANARY_DIR}/${f}`), 'docs/exams/question-bank/pilots/qb-r2d', 'docs/exams/question-bank/pilots/qb-r2e', 'docs/exams/question-bank/pilots/qb-r2f', 'tests/fixtures/qb-r2f'], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
  });
});

describe('6 -- calibration analytics: code now, labels later; nothing is invented', () => {
  // SYNTHETIC labels, in this test only.
  const person = (over: Partial<HumanResponse> = {}): HumanResponse => ({ academic_correctness: 'CORRECT', answer_key_correctness: 'CORRECT', construct_fit: 'FITS', assessment_system_fidelity: 'FAITHFUL', paper_level_fidelity: 'AT_LEVEL', difficulty_achieved: 'MATCHES_STATED_BAND', originality_material_duplicate: 'NO_CONCERN', wording_clarity: 'CLEAR', final_human_decision: 'APPROVED', reviewer_notes: 'synthetic', reviewer: { reviewer_id: 'synthetic-person', reviewer_kind: 'HUMAN', qualification: 'synthetic', reviewed_at: '2026-10-20T10:00:00.000Z', minutes_spent: 5, reviewed_blind: true, consulted_ai: false }, ...over });
  const calls = (k: Call): Record<Dimension, Call> => ({ CORRECTNESS: k, ANSWER_KEY: k, CONSTRUCT: k, DIFFICULTY: k, ASSESSMENT_SYSTEM_FIDELITY: k, OVERALL_DECISION: k });
  const row = (itemId: string, blind: boolean, human: AnalyticsRow['human'], v4: Call, v5: Call, ai: Call): AnalyticsRow => ({ itemId, blind, human, calls: { VALIDATOR_V4: calls(v4), VALIDATOR_V5: calls(v5), AI_REVIEWER: calls(ai) } });
  const settled = (label: HumanResponse): AnalyticsRow['human'] => ({ state: 'SETTLED', label, by: 'FIRST_REVIEW', differingFields: [] });
  const wrongKey = person({ answer_key_correctness: 'INCORRECT', academic_correctness: 'INCORRECT', final_human_decision: 'REJECTED' });
  it('refuses to run without a settled human label', () => {
    expect(() => analyse([])).toThrow(NoHumanLabelsError);
    expect(() => analyse([row('a', true, { state: 'NO_REVIEW' }, 'DEFECT', 'DEFECT', 'DEFECT'), row('b', false, { state: 'AWAITING_SECOND_REVIEW', reasons: ['x'] }, 'DEFECT', 'DEFECT', 'DEFECT')])).toThrow(/NO_SETTLED_HUMAN_LABEL.*No label is invented or simulated/);
    const script = read('scripts/operations/qb-post-canary/run.ts');
    expect(script).toMatch(/NO_RESPONSE_FILE: give the path of a FILLED human review form\. No label is invented\./);
  });
  it('confusion, precision, recall, false-positive and false-negative rates -- each with its counts and an interval; disagreements by item; unsettled items by name', () => {
    const rows = [
      row('i1', true, settled(wrongKey), 'DEFECT', 'DEFECT', 'DEFECT'), row('i2', true, settled(person()), 'DEFECT', 'NO_DEFECT', 'NO_DEFECT'), row('i3', false, settled(person()), 'NO_DEFECT', 'NO_DEFECT', 'NO_OPINION'),
      row('i4', false, settled(wrongKey), 'NO_DEFECT', 'DEFECT', 'DEFECT'), row('i5', false, settled(person({ answer_key_correctness: 'AMBIGUOUS' })), 'NO_DEFECT', 'NO_DEFECT', 'NO_DEFECT'),
      row('i6', true, { state: 'UNSETTLED', first: person(), second: wrongKey }, 'DEFECT', 'DEFECT', 'DEFECT'), row('i7', false, { state: 'AWAITING_SECOND_REVIEW', reasons: ['x'] }, 'DEFECT', 'DEFECT', 'DEFECT'),
    ];
    const a = analyse(rows);
    expect(a.items).toEqual({ total: 7, settled: 5, awaitingSecondReview: ['i7'], unsettled: ['i6'], notReviewed: [] });
    const of = (judge: Judge, dimension: Dimension, subset = 'ALL') => a.comparisons.find((c) => c.judge === judge && c.dimension === dimension && c.subset === subset)!;
    const v4 = of('VALIDATOR_V4', 'ANSWER_KEY');
    expect([v4.n, v4.confusion, v4.precision.numerator, v4.precision.denominator, v4.recall.value, v4.falsePositiveRate.value, v4.falseNegativeRate.value, v4.agreementRate.value]).toEqual([4, { truePositive: 1, falsePositive: 1, trueNegative: 1, falseNegative: 1 }, 1, 2, 0.5, 0.5, 0.5, 0.5]);
    expect(v4.disagreements).toEqual([{ itemId: 'i2', judge: 'DEFECT', human: 'NO_DEFECT' }, { itemId: 'i4', judge: 'NO_DEFECT', human: 'DEFECT' }]);
    expect(v4.excluded).toEqual([{ itemId: 'i5', why: 'HUMAN_AMBIGUOUS_OR_NOT_ASSESSABLE_ON_THIS_DIMENSION' }, { itemId: 'i6', why: 'HUMAN_LABEL_UNSETTLED' }, { itemId: 'i7', why: 'HUMAN_LABEL_AWAITING_SECOND_REVIEW' }]);
    expect([of('VALIDATOR_V5', 'ANSWER_KEY').agreementRate.value, of('VALIDATOR_V5', 'ANSWER_KEY').confusion.truePositive]).toEqual([1, 2]);
    // the AI has no opinion on one item: it is out of the AI's rate, by name
    expect(of('AI_REVIEWER', 'OVERALL_DECISION').excluded.map((e) => e.itemId)).toEqual(['i3', 'i6', 'i7']);
    expect([of('VALIDATOR_V4', 'ANSWER_KEY', 'BLIND').n, of('VALIDATOR_V4', 'ANSWER_KEY', 'NOT_BLIND').n]).toEqual([2, 2]);
    expect(a.comparisons).toHaveLength(3 * 6 * 3);
    expect(a.smallSampleCaveat).toMatch(/5 settled items.*wide.*chosen for uncertainty, not at random/);
    const r = rate(1, 2);
    expect([r.value, r.numerator, r.denominator, r.wilson95![0] < 0.1, r.wilson95![1] > 0.9, rate(0, 0)]).toEqual([0.5, 1, 2, true, true, { value: null, numerator: 0, denominator: 0, wilson95: null }]);
    expect([humanFinding(wrongKey, 'ANSWER_KEY'), humanFinding(person({ difficulty_achieved: 'EASIER_THAN_STATED_BAND' }), 'DIFFICULTY'), humanFinding(person({ construct_fit: 'NOT_ASSESSABLE' }), 'CONSTRUCT'), humanFinding(person({ final_human_decision: 'NEEDS_REVISION' }), 'OVERALL_DECISION')]).toEqual(['DEFECT', 'DEFECT', 'EXCLUDED', 'DEFECT']);
    expect(JUDGE_DEFINITIONS.VALIDATOR_V4.DIFFICULTY).toMatch(/^NO_OPINION/);
  });
});

describe('7 -- the gate in front of the next live run', () => {
  it('closed today: human calibration is not complete and the replay does not meet every criterion as written', async () => {
    const g = await gateFacts(ROOT);
    expect(g.facts).toEqual({ HUMAN_CALIBRATION_COMPLETE: 'NO', VALIDATOR_V5_OFFLINE_REPLAY: 'FAIL', ANSWER_KEY_INDEPENDENT_RECOMPUTATION: 'PASS', SPEND_ACCOUNTING_RECONCILED: 'PASS', DIFFICULTY_PROFILE_V2: 'READY' });
    expect(nextRunGate(g.facts)).toMatchObject({ NEXT_LIVE_RUN_MAY_BE_REQUESTED: 'NO', unmet: ['HUMAN_CALIBRATION_COMPLETE = NO (required YES)', 'VALIDATOR_V5_OFFLINE_REPLAY = FAIL (required PASS)'] });
  }, 240_000);
  it('opens only when every fact is as required, and even then authorises nothing', () => {
    const all = { HUMAN_CALIBRATION_COMPLETE: 'YES', VALIDATOR_V5_OFFLINE_REPLAY: 'PASS', ANSWER_KEY_INDEPENDENT_RECOMPUTATION: 'PASS', SPEND_ACCOUNTING_RECONCILED: 'PASS', DIFFICULTY_PROFILE_V2: 'READY' } as const;
    expect(nextRunGate(all)).toEqual({ NEXT_LIVE_RUN_MAY_BE_REQUESTED: 'YES', unmet: [], note: 'An open gate permits a REQUEST to the orchestrator. It authorises no provider call and no spend.' });
    for (const k of Object.keys(all) as Array<keyof typeof all>) expect(nextRunGate({ ...all, [k]: k === 'HUMAN_CALIBRATION_COMPLETE' ? 'NO' : k === 'DIFFICULTY_PROFILE_V2' ? 'NOT_READY' : 'NOT_RUN' } as never).NEXT_LIVE_RUN_MAY_BE_REQUESTED, k).toBe('NO');
    expect([humanCalibrationComplete({ sampled: 37, settled: 37, awaitingSecondReview: 0, unsettled: 0 }), humanCalibrationComplete({ sampled: 37, settled: 36, awaitingSecondReview: 1, unsettled: 0 }), humanCalibrationComplete({ sampled: 37, settled: 36, awaitingSecondReview: 0, unsettled: 1 }), humanCalibrationComplete({ sampled: 0, settled: 0, awaitingSecondReview: 0, unsettled: 0 })]).toEqual(['YES', 'NO', 'NO', 'NO']);
  });
});

describe('this lane cannot make a provider call', () => {
  it('no transport, no key, no network, no database in any post-canary file; nothing in src imports a script', () => {
    const files = readdirSync(join(ROOT, 'scripts/operations/qb-post-canary')).sort();
    expect(files).toEqual(['calibration-analytics.ts', 'canary-evidence.ts', 'demand-profile-v2.ts', 'family-analysis.ts', 'human-review.ts', 'next-run-gate.ts', 'parameter-policy-v2.ts', 'replay.ts', 'run.ts', 'spend-accounting-v2.ts', 'validators-r5.ts']);
    const strip = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    for (const f of [...files.map((x) => `scripts/operations/qb-post-canary/${x}`), 'src/lib/exam-core/question-bank/production/generator/specification-generation-v4.ts']) {
      const source = strip(f);
      expect(source, f).not.toMatch(/fetch\(|https?:\/\/|process\.env|API_KEY|createR2eLiveTransport|createReviewerLiveTransport|requireLiveKey|requireReviewerKey|live-provider|reviewer-transport|DATABASE_URL|from 'pg'|@\/lib\/db|dotenv|--env-file/);
      if (!f.endsWith('run.ts')) expect(source, f).not.toMatch(/Date\.now\(|new Date\(|Math\.random\(|writeFileSync/);
    }
    // the remediation added exactly one file to src; it is committed now, so this is checked against history rather than the working tree
    expect(execFileSync('git', ['log', '--diff-filter=A', '--format=', '--name-only', '-1', 'a21f4c1', '--', 'src'], { cwd: ROOT }).toString().trim().split('\n')).toEqual(['src/lib/exam-core/question-bank/production/generator/specification-generation-v4.ts']);
    for (const f of readdirSync(join(ROOT, CANARY_DIR, 'v5-offline-replay')).concat(['../spend-reconciliation.json'])) expect(/sk-[A-Za-z0-9_-]{20,}/.test(read(`${CANARY_DIR}/v5-offline-replay/${f}`)), f).toBe(false);
  });
});
