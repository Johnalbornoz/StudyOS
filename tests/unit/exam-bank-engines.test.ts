import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { keyPositionCounts, optionIdOf, presentOptions, shuffledByIdentity, scoreSelectedResponse, selectedResponseBankFields, selectedResponseIssues, type SelectedResponseItem } from '@/lib/exam-bank/engines/selected-response';
import { frozenFormStimulusIssues, stimulusBankField, stimulusContentDigest, stimulusIssues, stimulusRefOf, type Stimulus } from '@/lib/exam-bank/engines/stimulus';
import { inheritedStrategyOf, isAssisted, officialSecondsPerItem, resolveStrategy, speedStrategyDigest, speedStrategyIssues, strategyCoverage, strategyVisibility, timeReview, type SpeedStrategy } from '@/lib/exam-bank/engines/speed-strategy';
import { ApprovedItemContentSchema } from '@/lib/exam-core/items';

const D = 'a'.repeat(64);
const opt = (itemId: string, text: string, role: 'KEY' | 'DISTRACTOR', misconceptionId: string | null) => ({ id: optionIdOf(itemId, text), text, role, misconceptionId, rationale: `Razón modelada de la opción ${text}.` });
const item = (over: Partial<SelectedResponseItem> = {}, itemId = 'it-1'): SelectedResponseItem => ({
  v: 1, itemId, language: 'es', stem: 'Según el texto, ¿qué explica mejor la decisión de la autora?', difficulty: 3, conceptStableId: 'paa.lectura.inferencia', blueprintBucketId: 'lectura.inferencia',
  options: [opt(itemId, 'Quería comparar dos épocas', 'KEY', null), opt(itemId, 'Quería criticar a su editor', 'DISTRACTOR', 'READS_TONE_AS_PURPOSE'), opt(itemId, 'Buscaba resumir un informe', 'DISTRACTOR', 'CONFUSES_DETAIL_WITH_PURPOSE'), opt(itemId, 'Pensaba corregir una fecha', 'DISTRACTOR', 'OVERGENERALISES_ONE_LINE')],
  stimulus: null, rights: { category: 'STUDYUS_ORIGINAL_DETERMINISTIC', basis: 'Autoría propia de StudyUs.' }, lineage: { source: 'test', generator: null, coverageGap: 'lectura.inferencia' }, speedStrategyDigest: null, ...over,
});

describe('selected response engine', () => {
  it('certifies a well-formed item and scores by option identity, whatever the order', () => {
    const i = item();
    expect(selectedResponseIssues(i)).toEqual([]);
    const key = i.options[0].id;
    for (const seed of ['a', 'b', 'c']) { const shown = presentOptions(i, seed); expect(shown.map((o) => o.id).sort()).toEqual(i.options.map((o) => o.id).sort()); expect(Object.keys(shown[0])).toEqual(['id', 'text']); }
    expect(scoreSelectedResponse(i, key)).toMatchObject({ correct: true, fraction: 1 });
    expect(scoreSelectedResponse(i, i.options[1].id)).toMatchObject({ correct: false, misconceptionId: 'READS_TONE_AS_PURPOSE' });
    expect(scoreSelectedResponse(i, 'o-00000000').answered).toBe(false);
    expect(scoreSelectedResponse(i, null).answered).toBe(false);
  });
  it('shuffles any identified options deterministically, as a permutation', () => {
    const opts = [{ id: 'a', text: '1' }, { id: 'b', text: '2' }, { id: 'c', text: '3' }, { id: 'd', text: '4' }];
    expect(shuffledByIdentity(opts, 'att:3')).toEqual(shuffledByIdentity(opts, 'att:3'));
    expect(shuffledByIdentity(opts, 'att:3').map((o) => o.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(Array.from({ length: 30 }, (_, n) => shuffledByIdentity(opts, `att:${n}`).map((o) => o.id).join(''))).size).toBeGreaterThan(5);
  });
  it('spreads the key over the positions', () => {
    const items = Array.from({ length: 200 }, (_, n) => item({}, `it-${n}`));
    const counts = keyPositionCounts(items, (i) => `attempt:${i.itemId}`);
    expect(counts).toHaveLength(4);
    for (const c of counts) expect(c).toBeGreaterThan(25);
  });
  it('names every reason an item may not be certified', () => {
    const i = item();
    const two = { ...i, options: i.options.map((o, n) => (n === 1 ? { ...o, role: 'KEY' as const, misconceptionId: null } : o)) };
    expect(selectedResponseIssues(two)).toContain('NOT_EXACTLY_ONE_KEY');
    expect(selectedResponseIssues({ ...i, options: i.options.slice(0, 3) })).toContain('TOO_FEW_OPTIONS');
    expect(selectedResponseIssues({ ...i, options: i.options.map((o, n) => (n === 2 ? { ...o, misconceptionId: null } : o)) })).toContain('DISTRACTOR_WITHOUT_A_MISCONCEPTION');
    expect(selectedResponseIssues({ ...i, options: i.options.map((o) => (o.role === 'DISTRACTOR' ? { ...o, misconceptionId: 'SAME_ONE' } : o)) })).toContain('TOO_FEW_DISTINCT_MISCONCEPTIONS');
    expect(selectedResponseIssues({ ...i, options: i.options.map((o, n) => (n === 0 ? { ...o, id: 'o-aaaaaaaa' } : o)) })).toContain('OPTION_ID_IS_NOT_OF_ITS_TEXT');
    const all = [...i.options.slice(0, 3), opt('it-1', 'Todas las anteriores', 'DISTRACTOR', 'X_Y_Z')];
    expect(selectedResponseIssues({ ...i, options: all })).toContain('CATCH_ALL_OPTION');
    const long = [opt('it-1', 'Quería comparar con cuidado dos épocas muy distintas de la historia local', 'KEY', null), ...i.options.slice(1)];
    expect(selectedResponseIssues({ ...i, options: long })).toContain('KEY_STANDS_OUT_BY_LENGTH');
    const abs = [i.options[0], opt('it-1', 'Siempre criticaba a su editor', 'DISTRACTOR', 'M_ONE'), ...i.options.slice(2)];
    expect(selectedResponseIssues({ ...i, options: abs })).toContain('ABSOLUTE_WORDING_SINGLES_OUT_AN_OPTION');
    const num = (t: string, r: 'KEY' | 'DISTRACTOR', m: string | null) => opt('it-1', t, r, m);
    expect(selectedResponseIssues({ ...i, options: [num('12', 'KEY', null), num('14', 'DISTRACTOR', 'M_ONE'), num('10', 'DISTRACTOR', 'M_TWO'), num('9000', 'DISTRACTOR', 'M_THREE')] })).toContain('NUMERIC_DISTRACTOR_NOT_COMPETITIVE');
    expect(selectedResponseIssues({ ...i, options: [num('12', 'KEY', null), num('14', 'DISTRACTOR', 'M_ONE'), num('10', 'DISTRACTOR', 'M_TWO'), num('doce', 'DISTRACTOR', 'M_THREE')] })).toContain('OPTION_FORMATS_DIFFER');
    expect(selectedResponseIssues({ nope: true })).toEqual(['SCHEMA_INVALID']);
  });
  it('projects to bank fields the Exam Core accepts, key by id and never first by construction', () => {
    const f = selectedResponseBankFields(item());
    expect(f.options.map((o) => o.id)).toEqual([...f.options.map((o) => o.id)].sort());
    expect(f.options.some((o) => o.id === f.correctAnswer)).toBe(true);
    expect(Object.keys(f.distractorRationale)).toHaveLength(3);
    expect(() => selectedResponseBankFields(item({ options: item().options.slice(0, 3) }))).toThrow(/SELECTED_RESPONSE_NOT_CERTIFIABLE/);
    const parsed = ApprovedItemContentSchema.safeParse({ key: 'k-1', contentStatus: 'ORIGINAL', contentOrigin: 'AUTHORED', language: 'es', explanation: '', explanationStatus: 'NONE', difficulty: 3, marks: 1, ...f });
    expect(parsed.success ? [] : parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`)).toEqual([]);
  });
});

const passage = Array.from({ length: 150 }, (_, n) => `palabra${n}`).join(' ');
const stim = (over: Partial<Stimulus> = {}): Stimulus => {
  const base = { v: 1 as const, stimulusId: 'stim.paa.lectura.p1', version: 1, kind: 'READING_PASSAGE' as const, language: 'es', title: 'El río', text: passage, table: null, origin: { category: 'STUDYUS_ORIGINAL_GENERATED' as const, basis: 'Texto original de StudyUs.', originality: 'CHECKED_ORIGINAL' as const, sourceReferences: [] }, system: { systemId: 'paa', systemVersionId: 'v2.paa', componentId: 'lectura' }, blueprintBucketIds: ['lectura.inferencia', 'lectura.vocabulario'], linkedItemIds: ['it-1', 'it-2'], lineage: { source: 'test', generator: null, coverageGap: 'lectura' }, contentDigest: D, ...over };
  return over.contentDigest ? base : { ...base, contentDigest: stimulusContentDigest(base) };
};
const linked = (s: Stimulus) => [{ itemId: 'it-1', language: 'es', blueprintBucketId: 'lectura.inferencia', stimulus: stimulusRefOf(s) }, { itemId: 'it-2', language: 'es', blueprintBucketId: 'lectura.vocabulario', stimulus: stimulusRefOf(s) }];

describe('stimulus engine', () => {
  it('certifies a passage linked by identity, version and digest', () => {
    const s = stim();
    expect(stimulusIssues(s, linked(s))).toEqual([]);
    expect(stimulusBankField(s)).toMatchObject({ key: 'stim.paa.lectura.p1@1', title: 'El río' });
  });
  it('names every reason a stimulus may not be certified', () => {
    const s = stim();
    expect(stimulusIssues({ ...s, text: `${s.text} más` }, linked(s))).toContain('DIGEST_IS_NOT_OF_THE_CONTENT');
    expect(stimulusIssues(stim({ text: 'muy corto' }), [])).toContain('LENGTH_OUTSIDE_THE_KIND');
    const unknown = stim({ origin: { category: 'UNKNOWN', basis: 'No se conoce el origen.', originality: 'NOT_CHECKED', sourceReferences: [] } });
    expect(stimulusIssues(unknown, linked(unknown))).toContain('RIGHTS_NOT_ESTABLISHED');
    const unchecked = stim({ origin: { category: 'STUDYUS_ORIGINAL_GENERATED', basis: 'Texto generado por StudyUs.', originality: 'NOT_CHECKED', sourceReferences: [] } });
    expect(stimulusIssues(unchecked, linked(unchecked))).toContain('ORIGINALITY_NOT_CHECKED');
    expect(stimulusIssues(s, linked(s).slice(0, 1))).toContain('LINKED_ITEM_MISSING');
    expect(stimulusIssues(s, linked(s).map((i) => ({ ...i, stimulus: { ...i.stimulus, version: 2 } })))).toContain('ITEM_LINKS_ANOTHER_VERSION_OR_CONTENT');
    expect(stimulusIssues(s, linked(s).map((i) => ({ ...i, language: 'en' })))).toContain('ITEM_LANGUAGE_DIFFERS');
    expect(stimulusIssues(s, [...linked(s), { itemId: 'it-9', language: 'es', blueprintBucketId: 'lectura.inferencia', stimulus: stimulusRefOf(s) }])).toContain('UNLINKED_ITEM_CLAIMS_THE_STIMULUS');
    const t = stim({ kind: 'DATA_TABLE', text: null, table: { caption: null, headers: ['a', 'b'], rows: [['1', '2'], ['3']] } });
    expect(stimulusIssues(t, linked(t))).toContain('TABLE_ROWS_DO_NOT_MATCH_THE_HEADERS');
  });
  it('a frozen form holds the exact stimulus version, with its items together', () => {
    const s = stim(); const ref = stimulusRefOf(s);
    expect(frozenFormStimulusIssues([{ itemId: 'it-1', stimulus: ref }, { itemId: 'it-2', stimulus: ref }, { itemId: 'x', stimulus: null }], [s])).toEqual([]);
    expect(frozenFormStimulusIssues([{ itemId: 'it-1', stimulus: ref }], [])[0]).toMatch(/STIMULUS_NOT_FROZEN_WITH_THE_FORM/);
    expect(frozenFormStimulusIssues([{ itemId: 'it-1', stimulus: { ...ref, digest: D } }], [s])[0]).toMatch(/FROZEN_STIMULUS_CONTENT_CHANGED/);
    expect(frozenFormStimulusIssues([{ itemId: 'it-1', stimulus: ref }, { itemId: 'x', stimulus: null }, { itemId: 'it-2', stimulus: ref }], [s])[0]).toMatch(/STIMULUS_ITEMS_NOT_CONTIGUOUS/);
    expect(frozenFormStimulusIssues([{ itemId: 'it-7', stimulus: ref }], [s])[0]).toMatch(/ITEM_IS_NOT_OF_ITS_FROZEN_STIMULUS/);
  });
});

const official = { minutes: 60, items: 55 };
const strat = (over: Partial<SpeedStrategy> = {}): SpeedStrategy => {
  const base: SpeedStrategy = { v: 2, strategyId: 'strat.x.algebra.structure', strategyVersion: 1, strategyType: 'ALGEBRAIC_STRUCTURE', strategyFamily: 'x.algebra.structure', language: 'es', strategyTitle: 'Mira la estructura primero',
    applicabilityRules: { systemId: 'SYS', componentId: 'SYS.MATH', constructFamilyId: 'tf.linear', constructFamilyVersion: '1.0.0', stemPattern: '^Si ' },
    targetTimeSeconds: 65, skipThresholdSeconds: 130, timingProvenance: { target: 'OFFICIAL_DERIVED', skipThreshold: 'STUDYUS_HEURISTIC', basis: '60 minutos oficiales / 55 preguntas.', sampleSize: null },
    fastPath: ['Identifica qué se pide antes de operar.', 'Busca una forma conocida.'], directPath: ['Despeja la incógnita paso a paso.'], whyFastPathWorks: 'La forma de la expresión acorta el cálculo.', eliminationRules: [], mentalMathOpportunity: null,
    commonTimeTrap: 'Expandir todo y perder la forma que simplificaba.', whenNotToUse: 'Cuando operar directamente es igual de corto.', answerChoiceDependency: 'NONE',
    strategyCertificationState: 'AUTOMATED_CERTIFIED_PILOT', certification: { decidedBy: 'policy:TEST_POLICY_V1', policyId: 'TEST_POLICY_V1', humanDecisionId: null }, strategyDigest: D, ...over };
  return { ...base, strategyDigest: speedStrategyDigest(base) };
};
const ctx = { official, items: [{ itemId: 'it-1', hasOptions: false, keyTexts: ['7/2'] }] };
const target = { systemId: 'SYS', componentId: 'SYS.MATH', constructFamilyId: 'tf.linear', constructFamilyVersion: '1.0.0', language: 'es', stem: 'Si 3x + 12 = 48, ¿cuál es el valor de x?', hasOptions: false };

describe('speed strategy engine', () => {
  it('derives the official pace and certifies a strategy that states it', () => {
    expect(officialSecondsPerItem(official)).toBe(65);
    expect(officialSecondsPerItem({ minutes: 40, items: 50 })).toBe(48);
    expect(speedStrategyIssues(strat(), ctx)).toEqual([]);
  });
  it('names every reason a strategy may not be certified', () => {
    expect(speedStrategyIssues({ ...strat(), strategyTitle: 'Otro título distinto' }, ctx)).toContain('DIGEST_IS_NOT_OF_THE_STRATEGY');
    expect(speedStrategyIssues(strat({ targetTimeSeconds: 50 }), ctx)).toContain('OFFICIAL_DERIVED_TIME_IS_NOT_THE_OFFICIAL_PACE');
    expect(speedStrategyIssues(strat({ targetTimeSeconds: 50, timingProvenance: { target: 'STUDYUS_CALIBRATED', skipThreshold: 'STUDYUS_HEURISTIC', basis: 'Con muy pocas observaciones.', sampleSize: 4 } }), ctx)).toContain('CALIBRATED_TIME_WITHOUT_ENOUGH_OBSERVATIONS');
    expect(speedStrategyIssues(strat({ skipThresholdSeconds: 400 }), ctx)).toContain('HEURISTIC_TIME_FAR_FROM_THE_OFFICIAL_PACE');
    expect(speedStrategyIssues(strat({ skipThresholdSeconds: 60 }), ctx)).toContain('SKIP_THRESHOLD_NOT_AFTER_THE_TARGET');
    expect(speedStrategyIssues(strat({ strategyType: 'BACKSOLVE_FROM_OPTIONS', answerChoiceDependency: 'REQUIRED' }), ctx)).toContain('TYPE_NEEDS_OPTIONS_THE_ITEMS_DO_NOT_HAVE');
    expect(speedStrategyIssues(strat({ answerChoiceDependency: 'REQUIRED' }), ctx)).toContain('OPTION_DEPENDENCY_DISAGREES_WITH_THE_TYPE');
    expect(speedStrategyIssues(strat({ eliminationRules: ['Descarta las opciones negativas.'] }), ctx)).toContain('ELIMINATION_RULES_WITHOUT_OPTIONS');
    expect(speedStrategyIssues(strat({ applicabilityRules: { ...strat().applicabilityRules, stemPattern: '(' } }), ctx)).toContain('STEM_PATTERN_IS_NOT_A_REGULAR_EXPRESSION');
    expect(speedStrategyIssues(strat({ fastPath: ['Simplifica y verás que la respuesta es 12 siempre.'] }), ctx)).toContain('STRATEGY_REVEALS_AN_ANSWER');
    expect(speedStrategyIssues(strat({ strategyType: 'NO_RELIABLE_SHORTCUT', fastPath: ['Usa este truco para resolverla al instante.'] }), ctx)).toContain('NO_SHORTCUT_PROMISES_A_SHORTCUT');
    expect(speedStrategyIssues(strat({ strategyType: 'NO_RELIABLE_SHORTCUT', strategyTitle: 'Sin atajo fiable: resuelve con orden', fastPath: ['No hay atajo fiable: plantea y resuelve con orden.'] }), ctx)).toEqual([]);
    expect(speedStrategyIssues(strat({ certification: { decidedBy: 'john', policyId: null, humanDecisionId: null } }), ctx)).toContain('AUTOMATED_DECISION_ATTRIBUTED_TO_A_PERSON');
    expect(speedStrategyIssues(strat({ strategyCertificationState: 'HUMAN_CERTIFIED' }), ctx)).toContain('HUMAN_STATE_WITHOUT_A_RECORDED_DECISION');
  });
  it('resolves only a deliverable strategy, and only when exactly one applies', () => {
    const one = strat();
    expect(resolveStrategy(target, [one])?.strategyId).toBe(one.strategyId);
    expect(inheritedStrategyOf(one)).toMatchObject({ itemCertificationState: 'INHERITED_DETERMINISTIC', familyCertificationState: 'AUTOMATED_CERTIFIED_PILOT', strategyDigest: one.strategyDigest });
    for (const state of ['CANDIDATE', 'REVIEW_REQUIRED', 'REJECTED'] as const) expect(resolveStrategy(target, [strat({ strategyCertificationState: state })])).toBeNull();
    expect(resolveStrategy({ ...target, constructFamilyVersion: '2.0.0' }, [one])).toBeNull();
    expect(resolveStrategy({ ...target, stem: 'Calcula x.' }, [one])).toBeNull();
    // two families claim the item: it gets neither
    expect(resolveStrategy(target, [one, strat({ strategyId: 'strat.x.other' })])).toBeNull();
    // a newer version of the same family replaces the older one
    expect(resolveStrategy(target, [one, strat({ strategyVersion: 2 })])?.strategyVersion).toBe(2);
    expect(strategyCoverage([target, { ...target, stem: 'Otra forma' }], [one])).toMatchObject({ items: 2, withStrategy: 1, fraction: 0.5 });
  });
  it('never shows a strategy during a simulation; a coach reveal before answering is ASSISTED', () => {
    expect(strategyVisibility('EXAM_SIMULATION', 'BEFORE_ANSWER').visible).toBe(false);
    expect(strategyVisibility('EXAM_SIMULATION', 'AFTER_ANSWER').visible).toBe(false);
    expect(strategyVisibility('EXAM_SIMULATION', 'REVIEW').visible).toBe(true);
    expect(strategyVisibility('PRACTICE_COACH', 'BEFORE_ANSWER')).toEqual({ visible: true, onRequest: true, marksAssisted: true });
    expect(isAssisted({ strategyRevealedAtMs: 10, answeredAtMs: 20 })).toBe(true);
    expect(isAssisted({ strategyRevealedAtMs: 30, answeredAtMs: 20 })).toBe(false);
    expect(isAssisted({ strategyRevealedAtMs: null, answeredAtMs: 20 })).toBe(false);
  });
  it('reviews the time of an attempt', () => {
    const r = (itemId: string, seconds: number, correct: boolean, answered = true) => ({ itemId, seconds, answered, correct, assisted: false, targetSeconds: 65, skipThresholdSeconds: 110 });
    const review = timeReview([r('a', 30, true), r('b', 60, true), r('c', 90, true), r('d', 20, false), r('e', 150, false), r('f', 40, false, false)]);
    expect(review.perItem.map((p) => p.verdict)).toEqual(['FAST_AND_RIGHT', 'ON_PACE_AND_RIGHT', 'RIGHT_BUT_SLOW', 'RUSHED_AND_WRONG', 'STUCK_PAST_THE_SKIP_POINT', 'NOT_ANSWERED']);
    expect(review).toMatchObject({ totalSeconds: 390, targetSeconds: 390, secondsOverTarget: 110, secondsPastSkipPoint: 40, onPace: true });
  });
  it('the engines name no exam system, call no provider and generate nothing', () => {
    for (const f of ['selected-response', 'stimulus', 'speed-strategy']) {
      const code = readFileSync(join(process.cwd(), 'src/lib/exam-bank/engines', `${f}.ts`), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code).not.toMatch(/\bPAA\b|College Board|\bIB\b|Cambridge|ICFES|openai|anthropic|generateText|fetch\(/i);
      expect(code).not.toMatch(/from '@\/lib\/(db|ai|llm)/);
    }
  });
});
