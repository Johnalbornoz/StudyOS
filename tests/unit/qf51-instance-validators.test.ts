/**
 * QF V5.1 -- the validators learned from the fifty reviewed items, the response evaluation policy, and their use on
 * rendered instances. Deterministic: no model, no network. The items below are written for these tests; none is
 * one of the fifty.
 */
import { describe, expect, it } from 'vitest';
import { IB_MATH_AA_HL_P1_COMPONENT, IB_SYSTEM_PROFILE, MATHEMATICS_ADAPTATION_POLICY, MATH_POC_APPLICABILITY, PAA_MATEMATICAS_COMPONENT, PAA_SYSTEM_PROFILE } from '@/lib/assessment-adaptation';
import { mathPocFamilyOf } from '@/lib/exam-core/question-bank/task-families';
import {
  DIFFICULTY_MECHANISMS, EXACT_NUMERIC_POLICY, OPTION_POLICY, QUADRATIC_FACTORISING_STRATEGY, VALIDATOR_NAMES, authenticityAgainstAdapter, certificationDecision, composeAssessmentSpecification, constructCoreOf, constructNecessity,
  coreSemantics, createAssessmentInstanceRenderer, deriveCoreApplicability, difficultyFromMinimumPath, distractorFindings, evaluateResponse, numbersIn, optionLeakageFindings, parseWrittenNumber, representationFindings, shapesIn,
  shortcutBypassFindings, symbolicallyEqual, templateCompositionStrategy, validatableOfRendered, validateInstance, verdictOf,
  type CertifiedTemplateSet, type ConstructContext, type ResponseEvaluationPolicy, type ValidatableItem,
} from '@/lib/assessment-instance';
import { certifiedProfile, fixtureRegistry } from './qf51-fixtures';

const item = (over: Partial<ValidatableItem> = {}): ValidatableItem => ({
  language: 'es', itemType: 'SELECTED_RESPONSE', stimulus: 'Una tienda vendió 40 camisas el lunes y 50 el martes.', prompt: 'Un vendedor afirma que las ventas aumentaron 10 %. ¿Cuál opción evalúa correctamente la afirmación?',
  options: [
    { label: 'A', text: 'Es válida, porque se vendieron 10 camisas más.' },
    { label: 'B', text: 'No es válida, porque el aumento se mide respecto del valor inicial.' },
    { label: 'C', text: 'Es válida, porque la diferencia entre los dos días es pequeña.' },
    { label: 'D', text: 'No es válida, porque las ventas de dos días no pueden compararse.' },
  ],
  correctOption: 'B',
  distractorLineage: { A: { misconceptionId: 'absolute-as-relative', reasoningError: 'Lee la diferencia absoluta como porcentaje.', derivedAnswer: null }, C: { misconceptionId: 'size-of-difference', reasoningError: 'Juzga por la magnitud aparente.', derivedAnswer: null }, D: { misconceptionId: 'incomparable', reasoningError: 'Cree que no hay base común.', derivedAnswer: null } },
  assets: [], ...over,
});
const ctx = (over: Partial<ConstructContext> = {}): ConstructContext => ({ intendedReasoningPath: ['IDENTIFY_THE_BASE', 'COMPUTE_THE_RELATIVE_CHANGE', 'JUDGE_THE_CLAIM'], difficultyMechanisms: ['MISCONCEPTION_RESISTANCE'], intendedTier: 'STANDARD', requiredRepresentations: [], verbalDecodingIntended: false, ...over });
const codes = (xs: { code: string }[]) => xs.map((x) => x.code).sort();
const withKey = (text: string, over: Partial<ValidatableItem> = {}) => item({ options: item().options.map((o) => (o.label === 'B' ? { ...o, text } : o)), ...over });

describe('helpers read what a learner reads', () => {
  it('numbers: thousands separators are not decimals', () => {
    expect(numbersIn('cuesta $90.000 y $78.000, un 1,25 % más; 3.5 kg')).toEqual(['90000', '78000', '1.25', '3.5']);
  });
  it('the verdict of an option, wherever it stands', () => {
    expect(verdictOf('No es válida, porque...')).toEqual({ polarity: 'NEGATIVE', leading: true });
    expect(verdictOf('Es válida: se suman.')).toEqual({ polarity: 'POSITIVE', leading: true });
    expect(verdictOf('Se refuta, porque la proporción bajó.')).toEqual({ polarity: 'NEGATIVE', leading: true });
    expect(verdictOf('El plan B: 520 estudiantes; sí alcanza el objetivo.')).toEqual({ polarity: 'POSITIVE', leading: false });
    expect(verdictOf('The claim is not valid because the base changed.')).toEqual({ polarity: 'NEGATIVE', leading: true });
    expect(verdictOf('20 GB')).toBe(null);
  });
});

describe('SHORTCUT_BYPASS: routes to the key that skip the construct', () => {
  it('a clean evaluate-the-claim item has none', () => {
    expect(shortcutBypassFindings(item())).toEqual([]);
  });
  it('the correct verdict followed by the numbers that settle the claim', () => {
    const f = shortcutBypassFindings(withKey('No es válida, porque 10/40 = 25 %; el aumento fue de 25 %.'));
    expect(codes(f)).toEqual(['KEY_EXPOSES_THE_WORKING', 'KEY_STATES_THE_RESULT'].sort().filter((c) => codes(f).includes(c)));
    expect(codes(f)).toContain('KEY_STATES_THE_RESULT');
    expect(f.every((x) => x.severity === 'REVIEW' && x.option === 'B')).toBe(true);
    // the same numbers in a distractor do not hand the key over
    expect(shortcutBypassFindings(item({ options: item().options.map((o) => (o.label === 'D' ? { ...o, text: 'No es válida, porque 10/50 = 20 %; el aumento fue de 20 %.' } : o)) }))).toEqual([]);
  });
  it('a key that alone carries the computed values, in any kind of item', () => {
    const f = shortcutBypassFindings(item({ prompt: '¿Qué ocurre con el total?', options: [{ label: 'A', text: 'Sube.' }, { label: 'B', text: 'Pasa de 54/200 = 27 % a 75/250 = 30 %.' }, { label: 'C', text: 'Baja.' }, { label: 'D', text: 'No cambia.' }] }));
    expect(codes(f)).toEqual(['KEY_EXPOSES_THE_WORKING']);
    // when every option is a computation the key is not singled out
    const parallel = item({ prompt: '¿Cuál cálculo es correcto?', options: [{ label: 'A', text: '360 + 7 × 30 − 14 × 20 = 290' }, { label: 'B', text: '360 + 7 × 30 − 9 × 20 = 390' }, { label: 'C', text: '360 + 12 × 30 − 14 × 20 = 440' }, { label: 'D', text: '360 + 7 × 30 − 4 × 20 = 490' }] });
    expect(shortcutBypassFindings(parallel)).toEqual([]);
  });
  it('an option that states two costs and concludes the opposite can be discarded by reading', () => {
    const contradiction = 'Es válida, porque el plan A cuesta $90.000 y el plan B $78.000; por tanto, el plan A es más barato.';
    const f = shortcutBypassFindings(item({ options: item().options.map((o) => (o.label === 'A' ? { ...o, text: contradiction } : o)) }));
    expect(f).toEqual([expect.objectContaining({ code: 'OPTION_ELIMINATED_BY_ITS_OWN_CONTRADICTION', option: 'A', severity: 'REVIEW' })]);
    // consistent with its own numbers: nothing to discard by reading
    expect(shortcutBypassFindings(item({ options: item().options.map((o) => (o.label === 'A' ? { ...o, text: 'Es válida, porque el plan A cuesta $70.000 y el plan B $78.000; por tanto, el plan A es más barato.' } : o)) }))).toEqual([]);
    // the same flaw in the KEY makes the item wrong, not merely easy
    expect(shortcutBypassFindings(withKey(contradiction.replace('Es válida', 'No es válida')))).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'KEY_CONTRADICTS_ITSELF', severity: 'REJECT' })]));
  });
  it('is independent of the ideal solution: it reads the item only, and says nothing about a constructed response', () => {
    expect(shortcutBypassFindings.length).toBe(1);
    expect(shortcutBypassFindings(item({ itemType: 'NUMERIC_ENTRY', options: [], correctOption: null }))).toEqual([]);
  });
});

describe('OPTION_STRUCTURAL_LEAKAGE: the form of the options gives the key away', () => {
  it('one YES against three NO, or the reverse', () => {
    const lone = item({ options: [{ label: 'A', text: 'El plan A: 144; no alcanza el objetivo.' }, { label: 'B', text: 'El plan A: 376; no alcanza el objetivo.' }, { label: 'C', text: 'El plan B: 520; sí alcanza el objetivo.' }, { label: 'D', text: 'El plan B: 384; no alcanza el objetivo.' }], correctOption: 'C' });
    expect(codes(optionLeakageFindings(lone))).toEqual(['KEY_IS_THE_ONLY_OPTION_WITH_ITS_POLARITY']);
    expect(optionLeakageFindings(item())).toEqual([]); // two and two
    expect(optionLeakageFindings({ ...lone, correctOption: 'A' })).toEqual([]); // the odd one out is not the key
  });
  it('length, precision and unit that only the key has; and duplicated options', () => {
    expect(codes(optionLeakageFindings(item({ options: [{ label: 'A', text: 'Sube.' }, { label: 'B', text: 'Baja, porque la base del segundo día es mayor que la del primero.' }, { label: 'C', text: 'Igual.' }, { label: 'D', text: 'Nada.' }] })))).toContain('KEY_LENGTH_OUTLIER');
    expect(codes(optionLeakageFindings(item({ options: [{ label: 'A', text: '12' }, { label: 'B', text: '12,5' }, { label: 'C', text: '13' }, { label: 'D', text: '25' }] })))).toContain('KEY_HAS_UNIQUE_PRECISION');
    expect(codes(optionLeakageFindings(item({ options: [{ label: 'A', text: '12' }, { label: 'B', text: '12 km' }, { label: 'C', text: '13' }, { label: 'D', text: '25' }] })))).toContain('KEY_HAS_UNIQUE_UNIT');
    expect(optionLeakageFindings(item({ options: [{ label: 'A', text: '10 GB' }, { label: 'B', text: '20 GB' }, { label: 'C', text: '30 GB' }, { label: 'D', text: '40 GB' }] }))).toEqual([]);
    expect(optionLeakageFindings(item({ options: [{ label: 'A', text: '12 km' }, { label: 'B', text: '20 km' }, { label: 'C', text: '12 KM' }, { label: 'D', text: '40 km' }] }))).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATED_OPTIONS', severity: 'REJECT' })]));
  });
});

describe('DISTRACTOR_DIAGNOSTICITY and DISTRACTOR_COMPETITIVENESS', () => {
  it('every distractor names an error; a core-derived one names a misconception of the core', () => {
    expect(distractorFindings(item(), { lineageRequired: true })).toEqual([]);
    const { C: _dropped, ...rest } = item().distractorLineage;
    expect(codes(distractorFindings(item({ distractorLineage: rest }), { lineageRequired: true }))).toEqual(['DISTRACTOR_HAS_NO_REASONING_ERROR']);
    const legacy = item({ distractorLineage: Object.fromEntries(Object.entries(item().distractorLineage).map(([k, v]) => [k, { ...v, misconceptionId: null }])) });
    expect(distractorFindings(legacy, { lineageRequired: false })).toEqual([]);
    expect(codes(distractorFindings(legacy, { lineageRequired: true }))).toEqual(['DISTRACTOR_NOT_FROM_A_MISCONCEPTION_MODEL', 'DISTRACTOR_NOT_FROM_A_MISCONCEPTION_MODEL', 'DISTRACTOR_NOT_FROM_A_MISCONCEPTION_MODEL']);
    const same = item({ distractorLineage: { ...item().distractorLineage, D: { misconceptionId: 'x', reasoningError: 'Juzga por la magnitud aparente.', derivedAnswer: null } } });
    expect(codes(distractorFindings(same, { lineageRequired: true }))).toEqual(['TWO_DISTRACTORS_DIAGNOSE_THE_SAME_ERROR']);
  });
  it('a distractor is the answer its error produces', () => {
    const numeric = item({ options: [{ label: 'A', text: '10' }, { label: 'B', text: '25' }, { label: 'C', text: '20' }, { label: 'D', text: '125' }], distractorLineage: { A: { misconceptionId: 'm1', reasoningError: 'Toma la diferencia.', derivedAnswer: '10' }, C: { misconceptionId: 'm2', reasoningError: 'Divide entre el valor final.', derivedAnswer: '20' }, D: { misconceptionId: 'm3', reasoningError: 'Toma el cociente como aumento.', derivedAnswer: '125' } } });
    expect(distractorFindings(numeric, { lineageRequired: true })).toEqual([]);
    const off = { ...numeric, distractorLineage: { ...numeric.distractorLineage, C: { ...numeric.distractorLineage.C, derivedAnswer: '22' } } };
    expect(distractorFindings(off, { lineageRequired: true })).toEqual([expect.objectContaining({ code: 'DISTRACTOR_IS_NOT_WHAT_THE_ERROR_PRODUCES', severity: 'REJECT', option: 'C' })]);
  });
  it('rejects by name what nobody would choose: self-refuting, out of proportion, impossible sign, twins', () => {
    const lineage = (labels: string[]) => Object.fromEntries(labels.map((l, i) => [l, { misconceptionId: `m${i}`, reasoningError: `error ${i}`, derivedAnswer: null }]));
    expect(codes(distractorFindings(item({ options: [{ label: 'A', text: '0,02' }, { label: 'B', text: '25' }, { label: 'C', text: '20' }, { label: 'D', text: '25000' }], distractorLineage: lineage(['A', 'C', 'D']) }), { lineageRequired: true }))).toEqual(['DISTRACTOR_OUT_OF_ALL_PROPORTION', 'DISTRACTOR_OUT_OF_ALL_PROPORTION']);
    expect(codes(distractorFindings(item({ options: [{ label: 'A', text: '-5' }, { label: 'B', text: '25' }, { label: 'C', text: '20' }, { label: 'D', text: '30' }], distractorLineage: lineage(['A', 'C', 'D']) }), { lineageRequired: true }))).toEqual(['DISTRACTOR_HAS_AN_IMPOSSIBLE_SIGN']);
    const twins = item({ prompt: '¿Cuál opción evalúa la afirmación sobre el área?', options: [{ label: 'A', text: 'Es válida: el área aumenta 30 %, porque se suman los porcentajes.' }, { label: 'B', text: 'No es válida: se multiplican los factores de cada dimensión.' }, { label: 'C', text: 'No es válida: el área aumenta 20 %, porque solo el cambio del largo determina el área.' }, { label: 'D', text: 'No es válida: el área aumenta 10 %, porque solo el cambio del ancho determina el área.' }], distractorLineage: lineage(['A', 'C', 'D']) });
    expect(codes(distractorFindings(twins, { lineageRequired: true }))).toEqual(['TWIN_DISTRACTORS']);
    // four options built on one frame are a parallel set, not twins
    const parallel = item({ options: [{ label: 'A', text: 'La media y la mediana bajaron 3 minutos, y el rango no cambió.' }, { label: 'B', text: 'La media bajó 3 minutos, la mediana no cambió y el rango no cambió.' }, { label: 'C', text: 'La media no cambió, la mediana bajó 3 minutos y el rango no cambió.' }, { label: 'D', text: 'La media y la mediana bajaron 3 minutos, y el rango bajó 3 minutos.' }], correctOption: 'A', distractorLineage: lineage(['B', 'C', 'D']) });
    expect(distractorFindings(parallel, { lineageRequired: true })).toEqual([]);
  });
});

describe('REPRESENTATION_FIT: the representation matches the construct', () => {
  it('a composite figure given only in words also measures decoding the description', () => {
    expect(shapesIn('un triángulo rectángulo ABC')).toEqual(['triangle']);
    const figure = item({ itemType: 'SHORT_RESPONSE', options: [], correctOption: null, stimulus: 'El contorno está formado por un rectángulo de 6 cm por 4 cm con un semicírculo exterior sobre uno de sus lados.', prompt: '¿Cuántos metros de borde se necesitan?' });
    expect(codes(representationFindings(figure, ctx()))).toEqual(['FIGURE_DESCRIBED_WITHOUT_A_DIAGRAM']);
    expect(representationFindings({ ...figure, assets: ['DIAGRAM'] }, ctx())).toEqual([]);
    expect(representationFindings(figure, ctx({ verbalDecodingIntended: true }))).toEqual([]);
    expect(representationFindings(item({ stimulus: 'Un triángulo rectángulo tiene catetos 3 y 4.' }), ctx())).toEqual([]);
  });
  it('a construct that reads data needs the table or graph it reads', () => {
    expect(codes(representationFindings(item(), ctx({ requiredRepresentations: ['TABLE'] })))).toEqual(['REQUIRED_TABLE_IS_MISSING']);
    expect(representationFindings(item({ stimulus: '| Día | Ventas |\n|---|---:|\n| Lunes | 40 |\n| Martes | 50 |' }), ctx({ requiredRepresentations: ['TABLE'] }))).toEqual([]);
    expect(codes(representationFindings(item(), ctx({ requiredRepresentations: ['GRAPH'] })))).toEqual(['REQUIRED_GRAPH_IS_MISSING']);
  });
});

describe('CONSTRUCT_NECESSITY: intended path against the minimum successful path', () => {
  it('with no bypass the learner needs the declared reasoning', () => {
    expect(constructNecessity(ctx(), [])).toEqual({ verdict: 'NECESSARY', intendedReasoningPath: ctx().intendedReasoningPath, minimumSuccessfulReasoningPath: ctx().intendedReasoningPath, via: [] });
  });
  it('a bypass replaces the path with the shortest route that succeeds', () => {
    const servile = withKey('No es válida, porque 10/40 = 25 %; el aumento fue de 25 %.');
    const v = validateInstance({ item: servile, construct: ctx(), adapter: null, shortcutExcludedFormats: [], lineageRequired: true, judgeAuthenticity: null, calibratedTier: 'STANDARD' });
    expect(v.necessity).toMatchObject({ verdict: 'BYPASSABLE', minimumSuccessfulReasoningPath: ['VERIFY_GIVEN_ARITHMETIC'], via: expect.arrayContaining(['KEY_STATES_THE_RESULT']) });
    expect(v.necessity.intendedReasoningPath).toEqual(ctx().intendedReasoningPath);
    expect(codes(v.findings)).toContain('CONSTRUCT_NOT_NECESSARY');
    expect(v.verdict).toBe('REVIEW');
    // a figure in words adds an unintended step; it does not shorten the path
    expect(constructNecessity(ctx(), [{ validator: 'REPRESENTATION_FIT', code: 'FIGURE_DESCRIBED_WITHOUT_A_DIAGRAM', severity: 'REVIEW', option: null, detail: '' }]).verdict).toBe('NECESSARY');
  });
  it('a format the core excludes because options can be substituted is rejected, not reviewed', () => {
    const v = validateInstance({ item: item(), construct: ctx(), adapter: null, shortcutExcludedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT'], lineageRequired: true, judgeAuthenticity: null, calibratedTier: null });
    expect(v.verdict).toBe('REJECT');
    expect(v.necessity).toMatchObject({ verdict: 'BYPASSABLE', minimumSuccessfulReasoningPath: ['SUBSTITUTE_EACH_OPTION'] });
  });
});

describe('DIFFICULTY from the minimum successful reasoning path', () => {
  const necessary = constructNecessity(ctx(), []);
  it('names the mechanisms, and the tier follows the path a learner actually needs', () => {
    expect(DIFFICULTY_MECHANISMS).toEqual(['CONCEPT_INTEGRATION', 'DOMAIN_CONSTRAINT', 'NON_OBVIOUS_STRATEGY', 'MULTI_STAGE_DEPENDENCY', 'TRANSFER', 'COUNTERINTUITIVE_RESULT', 'DATA_DISCRIMINATION', 'EPISTEMIC_JUDGMENT', 'REPRESENTATION_TRANSFORMATION', 'MISCONCEPTION_RESISTANCE']);
    expect(difficultyFromMinimumPath(item(), ctx({ intendedTier: 'CHALLENGE' }), necessary, null)).toMatchObject({ tierFromMinimumPath: 'CHALLENGE', tierFit: 'YES', direction: 'MATCH', findings: [] });
    // three steps with no mechanism are a long STANDARD item, not a CHALLENGE
    const none = difficultyFromMinimumPath(item(), ctx({ intendedTier: 'CHALLENGE', difficultyMechanisms: [] }), necessary, null);
    expect(none).toMatchObject({ tierFromMinimumPath: 'STANDARD', direction: 'TOO_EASY' });
    expect(codes(none.findings)).toEqual(['CHALLENGE_WITHOUT_A_MECHANISM']);
    expect(difficultyFromMinimumPath(item(), ctx({ intendedReasoningPath: ['APPLY_ONE_IDEA'], intendedTier: 'FOUNDATIONAL' }), constructNecessity({ intendedReasoningPath: ['APPLY_ONE_IDEA'] }, []), null).tierFromMinimumPath).toBe('FOUNDATIONAL');
  });
  it('a bypassed item is FOUNDATIONAL whatever its ideal solution or a calibrator says', () => {
    const bypassed = constructNecessity(ctx(), [{ validator: 'SHORTCUT_BYPASS', code: 'KEY_STATES_THE_RESULT', severity: 'REVIEW', option: 'B', detail: '' }]);
    const d = difficultyFromMinimumPath(item(), ctx({ intendedTier: 'CHALLENGE' }), bypassed, 'CHALLENGE');
    expect(d).toMatchObject({ tierFromMinimumPath: 'FOUNDATIONAL', tierFit: 'NO', direction: 'TOO_EASY' });
    expect(codes(d.findings)).toEqual(['DIFFICULTY_IS_OF_THE_IDEAL_SOLUTION_ONLY']);
    // a calibrator can lower the tier the path supports, never raise it
    expect(difficultyFromMinimumPath(item(), ctx({ intendedTier: 'CHALLENGE' }), necessary, 'STANDARD').tierFromMinimumPath).toBe('STANDARD');
    expect(difficultyFromMinimumPath(item(), ctx({ intendedReasoningPath: ['ONE', 'TWO'], intendedTier: 'STANDARD' }), constructNecessity({ intendedReasoningPath: ['ONE', 'TWO'] }, []), 'CHALLENGE').tierFromMinimumPath).toBe('STANDARD');
  });
  it('load is not difficulty: long numbers and long texts are named, never counted', () => {
    const loaded = difficultyFromMinimumPath(item({ stimulus: 'La empresa facturó 123456789 pesos.' }), ctx(), necessary, null);
    expect(loaded.findings).toEqual([expect.objectContaining({ code: 'ARTIFICIAL_LOAD', severity: 'INFO' })]);
    expect(loaded.tierFromMinimumPath).toBe('CHALLENGE');
  });
});

describe('AUTHENTICITY is conformance to the adapter, checked as facts', () => {
  const registry = fixtureRegistry([{ system: certifiedProfile(IB_SYSTEM_PROFILE), component: certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT) }, { system: certifiedProfile(PAA_SYSTEM_PROFILE), component: certifiedProfile(PAA_MATEMATICAS_COMPONENT) }]);
  const ib = registry.adapter('IB.MATH_AA_HL.P1')!;
  const paa = registry.adapter('PAA.MATEMATICAS')!;
  const constructed = { ...item({ itemType: 'SHORT_RESPONSE', options: [], correctOption: null, prompt: 'Solve the equation x² − 5x + 6 = 0.' }), commandTerm: 'solve' };
  it('a judge\'s "medium" on an item that conforms is not a defect; "low" still rejects', () => {
    expect(authenticityAgainstAdapter(constructed, ib, 'MEDIUM')).toMatchObject({ conformance: 'CONFORMS', recalibrated: 'ACCEPTABLE', deviations: [] });
    expect(authenticityAgainstAdapter(constructed, ib, 'HIGH').recalibrated).toBe('ACCEPTABLE');
    expect(authenticityAgainstAdapter(constructed, ib, 'LOW').recalibrated).toBe('REJECT');
  });
  it('is adapter-specific: the same item deviates from another adapter\'s format and command terms', () => {
    expect(codes(authenticityAgainstAdapter(constructed, paa, 'HIGH').deviations)).toEqual(['FORMAT_NOT_OF_THE_ADAPTER']);
    expect(authenticityAgainstAdapter({ ...item(), commandTerm: null }, paa, 'MEDIUM').conformance).toBe('CONFORMS');
    expect(codes(authenticityAgainstAdapter({ ...constructed, commandTerm: 'ponder' }, ib, 'HIGH').deviations)).toEqual(['COMMAND_TERM_NOT_OF_THE_ADAPTER']);
    expect(codes(authenticityAgainstAdapter({ ...constructed, commandTerm: null }, ib, 'HIGH').deviations)).toEqual(['NO_COMMAND_TERM']);
    expect(authenticityAgainstAdapter({ ...constructed, commandTerm: 'ponder' }, ib, 'HIGH').recalibrated).toBe('REVIEW');
  });
});

describe('the certification decision', () => {
  const machine = { answerConfirmed: true, ambiguity: false, constructFit: 'PASS' as const, tierFit: 'YES' as const, provenanceClear: true };
  const validate = (i: ValidatableItem) => validateInstance({ item: i, construct: ctx(), adapter: null, shortcutExcludedFormats: [], lineageRequired: true, judgeAuthenticity: 'MEDIUM', calibratedTier: 'STANDARD' });
  it('covers the eight validators and certifies only an item none of them stops', () => {
    expect([...VALIDATOR_NAMES]).toEqual(['CONSTRUCT_NECESSITY', 'SHORTCUT_BYPASS', 'OPTION_STRUCTURAL_LEAKAGE', 'DISTRACTOR_DIAGNOSTICITY', 'DISTRACTOR_COMPETITIVENESS', 'REPRESENTATION_FIT', 'DIFFICULTY_MECHANISM', 'AUTHENTICITY']);
    expect(certificationDecision(machine, validate(item()))).toEqual({ decision: 'MACHINE_CERTIFIED', reasons: [] });
  });
  it('a bypassable item is never certified, however sound its key and construct', () => {
    const d = certificationDecision(machine, validate(withKey('No es válida, porque 10/40 = 25 %; el aumento fue de 25 %.')));
    expect(d.decision).toBe('REVIEW_REQUIRED');
    expect(d.reasons).toEqual(expect.arrayContaining(['KEY_STATES_THE_RESULT', 'CONSTRUCT_NOT_NECESSARY']));
  });
  it('what stopped an item before still does', () => {
    expect(certificationDecision({ ...machine, constructFit: 'WEAK' }, validate(item())).reasons).toEqual(['CONSTRUCT_WEAK']);
    expect(certificationDecision({ ...machine, tierFit: 'BORDERLINE' }, validate(item())).reasons).toEqual(['TIER_BORDERLINE']);
    expect(certificationDecision({ ...machine, answerConfirmed: false }, validate(item())).decision).toBe('REVIEW_REQUIRED');
    expect(certificationDecision({ ...machine, constructFit: 'FAIL' }, validate(item()))).toEqual({ decision: 'REJECTED', reasons: ['CONSTRUCT_FAIL'] });
    expect(certificationDecision({ ...machine, provenanceClear: false }, validate(item())).decision).toBe('REJECTED');
    expect(certificationDecision({ ...machine, tierFit: 'NO' }, validate(item())).decision).toBe('REJECTED');
  });
});

describe('RESPONSE EVALUATION POLICY belongs to the rendered item', () => {
  const numeric = (over: Partial<ResponseEvaluationPolicy> = {}): ResponseEvaluationPolicy => ({ ...EXACT_NUMERIC_POLICY, ...over });
  it('exact answer and equivalent forms: a fraction, a decimal with a point, a decimal with a comma', () => {
    for (const r of ['3/4', '0.75', '0,75', ' 0.750 ']) expect(evaluateResponse(numeric(), '3/4', r).code, r).toBe('CORRECT');
    expect(evaluateResponse(numeric(), '3/4', '0.7').code).toBe('INCORRECT');
    expect(evaluateResponse(numeric(), '3/4', '').code).toBe('EMPTY');
    expect(evaluateResponse(numeric(), '3/4', 'tres cuartos').code).toBe('NOT_A_NUMBER');
    expect(evaluateResponse(OPTION_POLICY, 'B', '(b)').code).toBe('CORRECT');
    expect(evaluateResponse({ ...OPTION_POLICY, kind: 'EXACT_TEXT' }, 'La media aumenta.', 'la  media aumenta').code).toBe('CORRECT');
  });
  it('decimal separator, accepted representations and ambiguous writing are policy, not guesses', () => {
    expect(evaluateResponse(numeric({ decimalSeparators: ['.'] }), '12.5', '12,5').code).toBe('DECIMAL_SEPARATOR_NOT_ACCEPTED');
    expect(evaluateResponse(numeric({ acceptedRepresentations: ['FRACTION'] }), '3/4', '0.75').code).toBe('NOT_IN_AN_ACCEPTED_FORM');
    // canonical contract: no grouping separator unless the policy governs one -- "1.250" is one point two five, never guessed
    expect(evaluateResponse(numeric(), '1250', '1.250').code).toBe('INCORRECT');
    expect(evaluateResponse(numeric(), '1.25', '1.250').code).toBe('CORRECT');
    expect(evaluateResponse(numeric({ decimalSeparators: [','], groupingSeparators: ['.'] }), '1250', '1.250').code).toBe('CORRECT');
    expect(evaluateResponse(numeric({ decimalSeparators: ['.'], groupingSeparators: [','] }), '1250.5', '1,250.5').code).toBe('CORRECT');
    expect(evaluateResponse(numeric({ decimalSeparators: ['.'], groupingSeparators: [','] }), '1250', '12,50').code).toBe('GROUPING_NOT_ACCEPTED');
    expect(parseWrittenNumber('−2,5')).toMatchObject({ ok: true, n: { value: -2.5, representation: 'DECIMAL', separator: ',', decimals: 1 } });
  });
  it('units: accepted, required, or refused', () => {
    const km = numeric({ units: { accepted: ['km'], required: false } });
    expect(evaluateResponse(km, '12.5', '12,5 km').code).toBe('CORRECT');
    expect(evaluateResponse(km, '12.5', '12,5').code).toBe('CORRECT');
    expect(evaluateResponse(km, '12.5', '12,5 m').code).toBe('UNIT_NOT_ACCEPTED');
    expect(evaluateResponse(numeric({ units: { accepted: ['km'], required: true } }), '12.5', '12,5').code).toBe('UNIT_REQUIRED');
  });
  it('rounding and tolerance', () => {
    const sf3 = numeric({ rounding: { kind: 'SIGNIFICANT_FIGURES', digits: 3 } });
    expect(evaluateResponse(sf3, '36.8699', '36.9').code).toBe('CORRECT');
    expect(evaluateResponse(sf3, '36.8699', '36.87').code).toBe('WRONG_PRECISION');
    expect(evaluateResponse(sf3, '36.8699', '37.4').code).toBe('INCORRECT');
    const dp2 = numeric({ rounding: { kind: 'DECIMAL_PLACES', digits: 2 } });
    expect([evaluateResponse(dp2, '41.0515', '41.05').code, evaluateResponse(dp2, '41.0515', '41,05').code, evaluateResponse(dp2, '41.0515', '41.1').code]).toEqual(['CORRECT', 'CORRECT', 'WRONG_PRECISION']);
    const tol = numeric({ tolerance: { kind: 'ABSOLUTE', value: 0.05 } });
    expect([evaluateResponse(tol, '41.05', '41.09').code, evaluateResponse(tol, '41.05', '41.2').code]).toEqual(['CORRECT', 'INCORRECT']);
    expect(evaluateResponse(numeric({ tolerance: { kind: 'RELATIVE', value: 0.01 } }), '200', '201').code).toBe('CORRECT');
  });
  it('symbolic equivalence: the same expression in another form', () => {
    const symbolic: ResponseEvaluationPolicy = { ...EXACT_NUMERIC_POLICY, kind: 'SYMBOLIC', symbolicEquivalence: true, acceptedRepresentations: ['EXPRESSION'] };
    expect(evaluateResponse(symbolic, '3(x+8)(x+4)', '3x²+36x+96').code).toBe('CORRECT');
    expect(evaluateResponse(symbolic, '3(x+8)(x+4)', '3x^2+36x+69').code).toBe('INCORRECT');
    expect(evaluateResponse(symbolic, '3(x+8)(x+4)', 'the same thing').code).toBe('NOT_COMPARABLE');
    expect([symbolicallyEqual('2ab+a', 'a(2b+1)'), symbolicallyEqual('1/2', '0,5'), symbolicallyEqual('x', 'y')]).toEqual([true, true, false]);
    expect(evaluateResponse({ ...symbolic, symbolicEquivalence: false }, 'x+1', '1+x').code).toBe('INCORRECT');
  });
  it('partial credit: final answers are scored, method marks are a marker\'s', () => {
    const rubric: ResponseEvaluationPolicy = { ...EXACT_NUMERIC_POLICY, kind: 'RUBRIC', partialCredit: [{ code: 'M1', kind: 'METHOD', marks: 1, answer: null }, { code: 'A1', kind: 'ACCURACY', marks: 1, answer: '-3' }, { code: 'A1', kind: 'ACCURACY', marks: 1, answer: '5/2' }] };
    expect(evaluateResponse(rubric, ['-3', '5/2'], ['2,5', '−3'])).toMatchObject({ code: 'NEEDS_A_MARKER', marks: 2, correct: false });
    expect(evaluateResponse(rubric, ['-3', '5/2'], ['2,5', '3']).marks).toBe(1);
    expect(evaluateResponse(rubric, ['-3', '5/2'], ['2,5', '2.5']).marks).toBe(1); // one answer earns one point, once
  });
});

describe('rendered instances carry the policy, the distractor lineage, and pass the validators', () => {
  const SHORTCUTS = [{ id: 'substitute-the-options', bypass: 'With options to choose from, each one can be substituted into the equation instead of factorising it.', excludedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT'], instanceRule: 'A numeric response asks for one stated root, so the response has one value.' }];
  const core = (() => { const r = constructCoreOf({ family: { ...mathPocFamilyOf('tf.math.quadratic.solve-by-factorising')!, version: '1.0.0-test-certified', lifecycle: 'CERTIFIED', reviewStatus: 'REVIEWED' }, shortcutConstraints: SHORTCUTS, certification: { certificationVersion: 'test-cert-1', certifiedBy: 'test-fixture', certifiedAt: '2026-10-12T00:00:00Z' } }); if (!r.ok) throw new Error(r.issue); return r.core; })();
  const targets = { PAA: { system: certifiedProfile(PAA_SYSTEM_PROFILE), component: certifiedProfile(PAA_MATEMATICAS_COMPONENT), language: 'es', objective: 'paa.topic.040' }, IB: { system: certifiedProfile(IB_SYSTEM_PROFILE), component: certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT), language: 'en', objective: 'aahl.p1.functions' } } as const;
  const registry = fixtureRegistry(Object.values(targets));
  const render = (k: keyof typeof targets, strategy = { ...QUADRATIC_FACTORISING_STRATEGY, status: 'CERTIFIED' as const }) => {
    const t = targets[k]; const adapter = registry.adapter(t.component.componentId)!;
    const applicability = deriveCoreApplicability(core, { systemProfileId: t.system.profileId, componentId: t.component.componentId }, MATH_POC_APPLICABILITY);
    const bucket = { bucketId: `test/${t.component.componentId}/${t.objective}#0`, configKey: 'test', sectionKey: t.component.componentId, adapterId: t.component.componentId, objectiveCode: t.objective, primaryConceptStableIds: ['math.alg.quadratics'], responseFormat: null, blueprintClass: 'FULL' as const };
    const spec = composeAssessmentSpecification({ registry, use: 'STUDENT_DELIVERY', core, adapter, system: t.system, component: t.component, coreApplicability: [applicability], applicabilityRegister: MATH_POC_APPLICABILITY, bucket, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', language: t.language, contentUseClass: 'EVIDENCE_BEARING' } });
    if (!spec.ok) throw new Error(`${spec.code} ${spec.detail}`);
    const r = createAssessmentInstanceRenderer([strategy]).render({ registry, use: 'STUDENT_DELIVERY', core, adapter, applicability: spec.applicability, specification: spec.specification, bucket: spec.bucket, seed: 'v-001' });
    if (!r.ok) throw new Error(`${r.code} ${r.detail}`);
    return { instance: r.instance, adapter, specification: spec.specification };
  };
  const construct = (): ConstructContext => ({ intendedReasoningPath: coreSemantics(core).requiredActions, difficultyMechanisms: ['REPRESENTATION_TRANSFORMATION'], intendedTier: 'STANDARD', requiredRepresentations: [], verbalDecodingIntended: false });

  it('the numeric instance accepts its key in every equivalent form its policy names', () => {
    const { instance } = render('PAA');
    expect(instance.responsePolicy).toMatchObject({ kind: 'NUMERIC', decimalSeparators: ['.', ','], acceptedRepresentations: ['INTEGER', 'DECIMAL', 'FRACTION'], tolerance: null });
    const key = instance.key.answers[0];
    const value = Number(key.includes('/') ? Number(key.split('/')[0]) / Number(key.split('/')[1]) : key);
    for (const r of [key, String(value), String(value).replace('.', ',')]) expect(evaluateResponse(instance.responsePolicy, key, r).correct, r).toBe(true);
    expect(evaluateResponse(instance.responsePolicy, key, String(value + 1)).correct).toBe(false);
  });
  it('the constructed instance scores its final answers and leaves method marks to a marker', () => {
    const { instance } = render('IB');
    expect(instance.responsePolicy.kind).toBe('RUBRIC');
    expect(instance.responsePolicy.partialCredit.reduce((n, p) => n + p.marks, 0)).toBe(instance.learner.marks);
    const full = evaluateResponse(instance.responsePolicy, instance.key.answers, instance.key.answers);
    expect(full).toMatchObject({ code: 'NEEDS_A_MARKER', marks: instance.responsePolicy.partialCredit.filter((p) => p.answer !== null).reduce((n, p) => n + p.marks, 0) });
  });
  it('the policy is the instance\'s: the construct core holds none', () => {
    expect(JSON.stringify(core)).not.toMatch(/responsePolicy|decimalSeparators|acceptedRepresentations/);
  });
  it('both parametric instances pass every validator: the construct is necessary, the adapter is conformed to', () => {
    for (const k of ['PAA', 'IB'] as const) {
      const { instance, adapter, specification } = render(k);
      const v = validateInstance({ item: { ...validatableOfRendered(instance), commandTerm: specification.variable.commandTerm }, construct: construct(), adapter, shortcutExcludedFormats: core.shortcutConstraints.flatMap((s) => s.excludedFormats), lineageRequired: true, judgeAuthenticity: null, calibratedTier: null });
      expect(v.findings.filter((f) => f.severity !== 'INFO'), k).toEqual([]);
      expect(v).toMatchObject({ verdict: 'PASS', necessity: { verdict: 'NECESSARY' }, authenticity: { conformance: 'CONFORMS' } });
      expect(certificationDecision({ answerConfirmed: true, ambiguity: false, constructFit: 'PASS', tierFit: 'YES', provenanceClear: true }, v).decision).toBe('MACHINE_CERTIFIED');
    }
  });
  it('a template instance carries its response policy; with no options to offer it has no distractors to trace', () => {
    const set: CertifiedTemplateSet = { construct: 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING', setVersion: '0.0.1-test', components: [
      { kind: 'STEM', componentId: 'stem.en.1', version: '1', lifecycle: 'CERTIFIED', language: 'en', adapterIds: ['IB.MATH_AA_HL.P1'], text: 'Solve {{equation}}.' },
      { kind: 'DATA_BLOCK', componentId: 'data.1', version: '1', lifecycle: 'CERTIFIED', values: { equation: 'x² − 5x + 6 = 0' }, answer: '2, 3' },
      { kind: 'ERROR_MODEL', componentId: 'err.sign', version: '1', lifecycle: 'CERTIFIED', misconceptionId: 'sign-of-roots', wrongAnswerByDataBlock: { 'data.1': '−2, −3' }, rationale: 'Reads the factor constants as roots.' },
    ] };
    const { instance } = render('IB', templateCompositionStrategy(set, 'CERTIFIED') as never);
    expect(instance.strategy).toBe('CERTIFIED_TEMPLATE_COMPOSITION');
    // this core excludes selected response (its options could be substituted), so the composed item is constructed:
    // the lineage of distractors (misconception -> reasoning error -> derived answer) is exercised on option items above
    expect(instance.learner.options).toEqual([]);
    expect(instance.key.distractorLineage).toEqual({});
    expect(instance.responsePolicy.kind).toBe('NUMERIC');
  });
});
