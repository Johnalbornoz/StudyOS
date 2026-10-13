import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { keyPositionCounts, optionIdOf, presentOptions, scoreSelectedResponse, selectedResponseBankFields, selectedResponseIssues, type SelectedResponseItem } from '@/lib/exam-bank/engines/selected-response';
import { frozenFormStimulusIssues, stimulusBankField, stimulusContentDigest, stimulusIssues, stimulusRefOf, type Stimulus } from '@/lib/exam-bank/engines/stimulus';
import { isAssisted, officialSecondsPerItem, resolveStrategy, speedStrategyDigest, speedStrategyIssues, strategyCoverage, strategyVisibility, timeReview, type SpeedStrategy } from '@/lib/exam-bank/engines/speed-strategy';
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
  const base = { v: 1 as const, strategyId: 'strat.paa.mat.algebra.estructura', version: 1, type: 'STRUCTURE_BEFORE_COMPUTING' as const, language: 'es', scope: { systemId: 'paa', componentId: 'matematicas', family: 'MATH' as const, blueprintBucketIds: ['matematicas.algebra'], conceptStableIds: [], itemIds: [] }, title: 'Mira la estructura primero', steps: ['Identifica qué se pide antes de operar.', 'Busca un factor común o una forma conocida.'], whenToUse: 'Cuando la expresión tiene una forma reconocible.', whenNotToUse: 'Cuando los números son pequeños y operar es directo.', commonTrap: 'Expandir todo y perder la forma que simplificaba.', targetTime: { seconds: 65, provenance: 'OFFICIAL_DERIVED' as const, basis: '60 minutos oficiales / 55 preguntas.', sampleSize: null }, skipThresholdSeconds: 110, certification: { state: 'CERTIFIED' as const, mode: 'AUTOMATED' as const, recordId: 'rec-1' }, lineage: { source: 'test', generator: null }, digest: D, ...over };
  return { ...base, digest: speedStrategyDigest(base) };
};
const ctx = { official, items: [{ itemId: 'it-1', hasOptions: false, keyTexts: ['\\frac{7}{2}', '3.5'] }] };
const target = { itemId: 'it-1', conceptStableId: 'c-1', blueprintBucketId: 'matematicas.algebra', componentId: 'matematicas', language: 'es' };

describe('speed strategy engine', () => {
  it('derives the official pace and certifies a strategy that states it', () => {
    expect(officialSecondsPerItem(official)).toBe(65);
    expect(officialSecondsPerItem({ minutes: 40, items: 50 })).toBe(48);
    expect(speedStrategyIssues(strat(), ctx)).toEqual([]);
  });
  it('names every reason a strategy may not be certified', () => {
    expect(speedStrategyIssues({ ...strat(), title: 'Otro título distinto' }, ctx)).toContain('DIGEST_IS_NOT_OF_THE_STRATEGY');
    expect(speedStrategyIssues(strat({ targetTime: { seconds: 50, provenance: 'OFFICIAL_DERIVED', basis: 'No es el ritmo oficial.', sampleSize: null } }), ctx)).toContain('OFFICIAL_DERIVED_TIME_IS_NOT_THE_OFFICIAL_PACE');
    expect(speedStrategyIssues(strat({ targetTime: { seconds: 50, provenance: 'STUDYUS_CALIBRATED', basis: 'Con muy pocas observaciones.', sampleSize: 4 } }), ctx)).toContain('CALIBRATED_TIME_WITHOUT_ENOUGH_OBSERVATIONS');
    expect(speedStrategyIssues(strat({ targetTime: { seconds: 400, provenance: 'STUDYUS_HEURISTIC', basis: 'Demasiado lejos del ritmo.', sampleSize: null }, skipThresholdSeconds: 500 }), ctx)).toContain('HEURISTIC_TIME_FAR_FROM_THE_OFFICIAL_PACE');
    expect(speedStrategyIssues(strat({ skipThresholdSeconds: 60 }), ctx)).toContain('SKIP_THRESHOLD_NOT_AFTER_THE_TARGET');
    expect(speedStrategyIssues(strat({ type: 'LOCATE_THE_EVIDENCE_LINE' }), ctx)).toContain('TYPE_NOT_FOR_THIS_COMPONENT');
    expect(speedStrategyIssues(strat({ type: 'BACK_SOLVE_FROM_OPTIONS' }), ctx)).toContain('TYPE_NEEDS_OPTIONS_THE_ITEMS_DO_NOT_HAVE');
    expect(speedStrategyIssues(strat({ scope: { ...strat().scope, blueprintBucketIds: [] } }), ctx)).toContain('SCOPE_IS_EMPTY');
    expect(speedStrategyIssues(strat({ scope: { ...strat().scope, itemIds: ['it-1'] }, steps: ['Simplifica y verás que la respuesta: 3.5 aparece.'] }), ctx)).toContain('STRATEGY_REVEALS_AN_ANSWER');
    expect(speedStrategyIssues(strat({ type: 'NO_RELIABLE_SHORTCUT', steps: ['Usa este truco para resolverla al instante.'] }), ctx)).toContain('NO_SHORTCUT_PROMISES_A_SHORTCUT');
    expect(speedStrategyIssues(strat({ type: 'NO_RELIABLE_SHORTCUT', title: 'Resuélvela directo', steps: ['No hay atajo fiable: plantea y resuelve con orden.'] }), ctx)).toEqual([]);
    expect(speedStrategyIssues(strat({ certification: { state: 'CERTIFIED', mode: null, recordId: null } }), ctx)).toContain('CERTIFIED_WITHOUT_A_RECORD');
  });
  it('resolves only a certified strategy, the most specific one', () => {
    const bucket = strat(); const concept = strat({ strategyId: 'strat.paa.mat.c1', scope: { ...strat().scope, blueprintBucketIds: [], conceptStableIds: ['c-1'] } });
    const candidate = strat({ strategyId: 'strat.paa.mat.item', scope: { ...strat().scope, itemIds: ['it-1'] }, certification: { state: 'CANDIDATE', mode: null, recordId: null } });
    expect(resolveStrategy(target, [bucket, concept, candidate])?.strategyId).toBe('strat.paa.mat.c1');
    expect(resolveStrategy(target, [candidate])).toBeNull();
    expect(resolveStrategy({ ...target, componentId: 'lectura' }, [bucket])).toBeNull();
    expect(strategyCoverage([target, { ...target, itemId: 'it-2', blueprintBucketId: 'matematicas.datos' }], [bucket])).toMatchObject({ items: 2, withStrategy: 1, fraction: 0.5 });
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
    const r = (itemId: string, seconds: number, correct: boolean, answered = true) => ({ itemId, seconds, answered, correct, assisted: false, targetSeconds: 65, skipThresholdSeconds: 110, provenance: 'OFFICIAL_DERIVED' as const });
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
