/**
 * Track B -- exam items (grading, answer-key isolation, structural
 * validation), the configuration layer (all eight DEV certification
 * configurations), the delivery policy and the exam-family taxonomy.
 */
import { describe, it, expect, vi } from 'vitest';

const gradeAnswerMock = vi.fn();
vi.mock('@/services/quiz-generation.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-generation.service')>('@/services/quiz-generation.service');
  return { ...actual, gradeAnswer: (...a: any[]) => gradeAnswerMock(...a) };
});

import { gradeExamItem, matchesAcceptable, normalizeTextAnswer, structuredAnswerProblem } from '@/lib/exam-core/item-grading';
import { examItemFromApproved, examItemFromGenerated, examItemMarks, findAnswerKeyLeak, toExamClientItem, validateExamItemStructure, type ExamItem } from '@/lib/exam-core/items';
import { parseExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { DEV_CERT_VERTICALS, PRIMARY_DEV_CERT_BY_FAMILY } from '@/lib/exam-core/verticals';
import { parseDeliveryPolicy, resolveDeliveryPolicy, isModeAllowed } from '@/lib/exam-core/delivery-policy';
import { EXAM_FAMILIES, EXAM_FAMILY_DESCRIPTORS, isExamFamily, toExamFamily } from '@/lib/exam-core/taxonomy';
import { choice, structured, partChoice, partText } from '@/lib/exam-core/verticals/fixture-builders';

function bank(content: any): ExamItem {
  const it = examItemFromApproved({ id: 'ai-1', learning_objective_id: 'lo-1', content });
  if (!it) throw new Error('invalid fixture');
  return it;
}

const SINGLE = bank(choice({ key: 'k1', language: 'es', question: '¿2+2?', options: ['3', '4', '5'], correct: 1, explanation: '4', marks: 2 }));
const PARTS = bank(
  structured({
    key: 'k2',
    language: 'en',
    question: 'f(x) = 2x^2 - 8',
    parts: [partText('a', 'y-intercept?', ['-8'], 1, 'knowledge', 0), partChoice('b', 'roots?', ['±4', '±2'], 1, 2, 'application'), partText('c', 'name', ['Parabola'], 1, 'communication')],
    explanation: 'x',
  })
);

describe('grading against the server-held item', () => {
  it('single choice: correct earns the item marks; another option earns 0', async () => {
    expect(await gradeExamItem(SINGLE, 'B', 'es')).toMatchObject({ status: 'ANSWERED', fraction: 1, maxMarks: 2, evaluation: { score: 2, maxScore: 2 } });
    expect(await gradeExamItem(SINGLE, 'A', 'es')).toMatchObject({ status: 'ANSWERED', fraction: 0, evaluation: { score: 0 } });
  });
  it('an answer the controls could never produce is INVALID (never graded as a guess)', async () => {
    expect(await gradeExamItem(SINGLE, 'Z', 'es')).toMatchObject({ status: 'INVALID', fraction: 0, invalidReason: 'UNKNOWN_OPTION' });
    expect(await gradeExamItem(SINGLE, '', 'es')).toMatchObject({ status: 'INVALID', invalidReason: 'EMPTY_ANSWER' });
    expect(await gradeExamItem(SINGLE, 'x'.repeat(20001), 'es')).toMatchObject({ status: 'INVALID', invalidReason: 'ANSWER_TOO_LONG' });
  });
  it('mark-scheme parts: deterministic per part, marks attributed to criteria', async () => {
    const g = await gradeExamItem(PARTS, JSON.stringify({ a: ' -8 ', b: 'B', c: 'parabola.' }), 'en');
    expect(g).toMatchObject({ status: 'ANSWERED', fraction: 1, maxMarks: 4 });
    expect(g.criteria).toEqual([
      { criterionId: 'knowledge', awarded: 1, max: 1 },
      { criterionId: 'application', awarded: 2, max: 2 },
      { criterionId: 'communication', awarded: 1, max: 1 },
    ]);
    const partial = await gradeExamItem(PARTS, JSON.stringify({ a: '-8', b: 'A' }), 'en');
    expect(partial.fraction).toBe(0.25); // a correct (1), b wrong (0), c blank (0) of 4
  });
  it('parts: unknown part / malformed JSON / bad option are INVALID', async () => {
    expect((await gradeExamItem(PARTS, JSON.stringify({ z: '1' }), 'en')).status).toBe('INVALID');
    expect((await gradeExamItem(PARTS, '{not json', 'en')).status).toBe('INVALID');
    expect((await gradeExamItem(PARTS, JSON.stringify({ b: 'Q' }), 'en')).status).toBe('INVALID');
    expect((await gradeExamItem(PARTS, JSON.stringify(['a']), 'en')).status).toBe('INVALID');
  });
  it('keyed text items never call the AI grader; unkeyed (AI-generated) text items do', async () => {
    gradeAnswerMock.mockReset().mockResolvedValue({ score: 0.5, feedback: 'ok', errorType: null, reasoningValid: true, confidence: 0.9 });
    const keyed = bank({ key: 'n', contentStatus: 'DEV_CERT_FIXTURE', language: 'es', type: 'numeric_problem', answerFormat: 'text', question: 'área', correctAnswer: '28', acceptableAnswers: ['28'], numericTolerance: 0.5, explanation: 'x', difficulty: 2 });
    expect((await gradeExamItem(keyed, '28,2', 'es')).fraction).toBe(1);
    expect((await gradeExamItem(keyed, '29', 'es')).fraction).toBe(0);
    expect(gradeAnswerMock).not.toHaveBeenCalled();
    const ai = examItemFromGenerated({ id: 'g', conceptId: 'c', type: 'short_answer', answerFormat: 'text', question: 'q', correctAnswer: 'model', explanation: 'e', difficulty: 3 } as any, 'lo-1');
    const g = await gradeExamItem(ai, 'my answer', 'es');
    expect(gradeAnswerMock).toHaveBeenCalledTimes(1);
    expect(g).toMatchObject({ status: 'ANSWERED', fraction: 0.5, maxMarks: 1 });
  });
  it('normalization is accent / case / spacing / trailing-punctuation insensitive', () => {
    expect(normalizeTextAnswer('  Fotosíntesis.  ')).toBe('fotosintesis');
    expect(matchesAcceptable('2A  +  7b', ['2a + 7b'], null)).toBe(true);
    expect(matchesAcceptable('1359.4', ['1359'], 1)).toBe(true);
    expect(matchesAcceptable('1361', ['1359'], 1)).toBe(false);
  });
  it('structured shape checks for every format', () => {
    const matching = { answerFormat: 'matching' as const, matchingPairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }] };
    expect(structuredAnswerProblem(matching, JSON.stringify({ a: '1' }))).toBeNull();
    expect(structuredAnswerProblem(matching, JSON.stringify({ c: '1' }))).toBe('UNKNOWN_KEY');
    expect(structuredAnswerProblem(matching, JSON.stringify({ a: '9' }))).toBe('UNKNOWN_VALUE');
    const ordering = { answerFormat: 'ordering' as const, orderingItems: ['x', 'y'] };
    expect(structuredAnswerProblem(ordering, JSON.stringify(['y', 'x']))).toBeNull();
    expect(structuredAnswerProblem(ordering, JSON.stringify(['y', 'y']))).toBe('NOT_A_PERMUTATION');
    const multi = { answerFormat: 'multi_choice' as const, options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }] };
    expect(structuredAnswerProblem(multi, 'A,B')).toBeNull();
    expect(structuredAnswerProblem(multi, 'A,A')).toBe('DUPLICATE_OPTION');
    expect(structuredAnswerProblem(multi, '')).toBe('EMPTY_SELECTION');
  });
});

describe('answer-key isolation (client payload)', () => {
  it('toExamClientItem never carries a key, explanation, accepted answers, criteria or the bank id', () => {
    for (const it of [SINGLE, PARTS]) {
      const client = toExamClientItem(it, 3);
      expect(findAnswerKeyLeak(client)).toBeNull();
      const json = JSON.stringify(client);
      expect(json).not.toContain('correctAnswer');
      expect(json).not.toContain('acceptableAnswers');
      expect(json).not.toContain('explanation');
      expect(json).not.toContain('"criterion"');
      expect(json).not.toContain('ai-1');
      expect(client.marks).toBe(examItemMarks(it));
    }
    expect(toExamClientItem(PARTS, 0).parts?.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('the leak detector finds a key anywhere in a payload', () => {
    expect(findAnswerKeyLeak({ a: [{ b: { correctAnswer: 'x' } }] })).toBe('$.a[0].b.correctAnswer');
    expect(findAnswerKeyLeak({ ok: true, question: { options: [] } })).toBeNull();
  });
});

describe('structural validation (answer validity before delivery)', () => {
  it('rejects items whose key is not answerable', () => {
    const bad = { ...SINGLE, correctAnswer: 'Q' };
    expect(validateExamItemStructure(bad).reasons).toContain('ANSWER_KEY_NOT_AN_OPTION');
    const dup = { ...SINGLE, options: [{ id: 'A', text: '1' }, { id: 'A', text: '2' }] };
    expect(validateExamItemStructure(dup).reasons).toContain('DUPLICATE_OPTION_IDS');
    const noKeyPart = { ...PARTS, exam: { ...PARTS.exam, parts: [{ id: 'a', prompt: 'p', answerFormat: 'text' as const, correctAnswer: '1', marks: 1, criterion: 'k' }] } };
    expect(validateExamItemStructure(noKeyPart).reasons).toContain('PART_a_NO_DETERMINISTIC_KEY');
  });
  it('a bank row with invalid content is never turned into a deliverable item', () => {
    expect(examItemFromApproved({ id: 'x', learning_objective_id: 'lo', content: { key: 'x' } })).toBeNull();
    expect(examItemFromApproved({ id: 'x', learning_objective_id: 'lo', content: { ...choice({ key: 'x', language: 'en', question: 'q', options: ['a', 'b'], correct: 0, explanation: 'e' }), correctAnswer: 'Z' } })).toBeNull();
  });
});

describe('configuration layer: the eight DEV certification configurations', () => {
  it('cover exactly the six families, IB and AICE with two subjects each', () => {
    const families = DEV_CERT_VERTICALS.map((v) => v.family);
    expect(new Set(families)).toEqual(new Set(EXAM_FAMILIES));
    expect(families.filter((f) => f === 'IB')).toHaveLength(2);
    expect(families.filter((f) => f === 'AICE')).toHaveLength(2);
    expect(Object.keys(PRIMARY_DEV_CERT_BY_FAMILY).sort()).toEqual([...EXAM_FAMILIES].sort());
  });

  it.each(DEV_CERT_VERTICALS.map((v) => [v.key, v] as const))('%s parses, is labelled a fixture, unofficial, and every bank item is deliverable', (_key, v) => {
    const parsed = parseExamVerticalConfig(v);
    expect(parsed.ok, parsed.ok ? '' : parsed.issues.join('\n')).toBe(true);
    if (!parsed.ok) return;
    const cfg = parsed.config;
    expect(cfg.contentStatus).toBe('DEV_CERT_FIXTURE');
    expect(cfg.scoring.policy.provenance.official).toBe(false);
    expect(cfg.definition.purpose).toMatch(/fixture/i);
    for (const it of cfg.items) {
      const item = examItemFromApproved({ id: it.content.key, learning_objective_id: it.objectiveCode, content: it.content });
      expect(item, it.content.key).not.toBeNull();
      expect(toExamClientItem(item!, 0)).toBeTruthy();
    }
    expect(parseDeliveryPolicy(cfg.version.delivery).ok).toBe(true);
  });

  it('every fixture answer key actually grades as correct (no broken keys)', async () => {
    for (const v of DEV_CERT_VERTICALS) {
      const cfg = parseExamVerticalConfig(v);
      if (!cfg.ok) throw new Error(v.key);
      for (const it of cfg.config.items) {
        const item = examItemFromApproved({ id: it.content.key, learning_objective_id: 'lo', content: it.content })!;
        const answer = item.exam.parts
          ? JSON.stringify(Object.fromEntries(item.exam.parts.map((p) => [p.id, p.answerFormat === 'text' ? p.acceptableAnswers![0] : p.correctAnswer])))
          : item.answerFormat === 'text'
            ? item.exam.acceptableAnswers![0]
            : item.correctAnswer;
        const g = await gradeExamItem(item, answer, cfg.config.items[0].content.language);
        expect(g.fraction, it.content.key).toBe(1);
      }
    }
  });

  it('refuses an unsafe or inconsistent configuration', () => {
    const base = structuredClone(PRIMARY_DEV_CERT_BY_FAMILY.PAA) as any;
    const officialFixture = structuredClone(base);
    officialFixture.scoring.policy.provenance = { official: true, source: 'College Board conversion table' };
    expect(parseExamVerticalConfig(officialFixture).ok).toBe(false);

    const unknownFamily = { ...structuredClone(base), family: 'SAT' };
    expect(parseExamVerticalConfig(unknownFamily).ok).toBe(false);

    const badWeights = structuredClone(base);
    badWeights.scoring.policy.sectionWeights = { nope: 1 };
    expect(parseExamVerticalConfig(badWeights).ok).toBe(false);

    const tooFewItems = structuredClone(base);
    tooFewItems.items = tooFewItems.items.filter((i: any) => i.objectiveCode !== 'paa.mat.algebra'); // needs 1, has 1
    expect(parseExamVerticalConfig(tooFewItems).ok).toBe(false);

    const badBreak = structuredClone(base);
    badBreak.version.delivery.breaks = [{ afterSectionKey: 'ghost', minutes: 5 }];
    expect(parseExamVerticalConfig(badBreak).ok).toBe(false);

    const mixedStatus = structuredClone(base);
    mixedStatus.items[0].content.contentStatus = 'OFFICIAL_LICENSED';
    expect(parseExamVerticalConfig(mixedStatus).ok).toBe(false);
  });
});

describe('delivery policy', () => {
  it('NULL navigation_rules = all defaults; integrity can never be loosened', () => {
    const p = parseDeliveryPolicy(null);
    expect(p.ok && p.policy.navigation).toBe('LINEAR');
    expect(parseDeliveryPolicy({ integrity: { tutorAssistance: 'ALLOWED' } }).ok).toBe(false);
  });
  it('official timing: HARD limit, no pause, no item feedback whatever the config says', () => {
    const p = parseDeliveryPolicy({ itemFeedback: 'AFTER_EACH_ITEM' });
    if (!p.ok) throw new Error();
    expect(resolveDeliveryPolicy(p.policy, 'FULL_MOCK', 'OFFICIAL_SIMULATION_TIMED')).toMatchObject({ timeLimit: 'HARD', pauseAllowed: false, itemFeedback: 'NEVER', tutorAssistance: 'BLOCKED' });
  });
  it('AUTO feedback only for untimed topic / domain practice; training timing is SOFT', () => {
    const p = parseDeliveryPolicy({});
    if (!p.ok) throw new Error();
    expect(resolveDeliveryPolicy(p.policy, 'TOPIC_EXAM', 'UNTIMED').itemFeedback).toBe('AFTER_EACH_ITEM');
    expect(resolveDeliveryPolicy(p.policy, 'MINI_MOCK', 'UNTIMED').itemFeedback).toBe('NEVER');
    expect(resolveDeliveryPolicy(p.policy, 'MINI_MOCK', 'TRAINING_TIMED')).toMatchObject({ timeLimit: 'SOFT', pauseAllowed: true });
  });
  it('allowed modes come from configuration', () => {
    const p = parseDeliveryPolicy({ allowedSimulationTypes: ['MINI_MOCK'], allowedTimingModes: ['UNTIMED'] });
    if (!p.ok) throw new Error();
    expect(isModeAllowed(p.policy, 'MINI_MOCK', 'UNTIMED')).toEqual({ allowed: true });
    expect(isModeAllowed(p.policy, 'TOPIC_EXAM', 'UNTIMED')).toEqual({ allowed: false, reason: 'SIMULATION_TYPE_NOT_ALLOWED' });
    expect(isModeAllowed(p.policy, 'MINI_MOCK', 'OFFICIAL_SIMULATION_TIMED')).toEqual({ allowed: false, reason: 'TIMING_MODE_NOT_ALLOWED' });
  });
});

describe('exam-family taxonomy', () => {
  it('exactly six families; AICE reuses the Cambridge ecosystem; legacy labels are never guessed', () => {
    expect(EXAM_FAMILIES).toEqual(['PAA', 'PISA', 'IB', 'CAMBRIDGE', 'AICE', 'ICFES']);
    expect(EXAM_FAMILY_DESCRIPTORS.AICE.ecosystem).toBe('CAMBRIDGE');
    expect(isExamFamily('SAT')).toBe(false);
    expect(toExamFamily('ADMISSION_EXAM')).toBeNull();
    expect(toExamFamily('ICFES')).toBe('ICFES');
  });
});
