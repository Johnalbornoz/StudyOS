import { describe, expect, it } from 'vitest';
import { examEntryHrefs } from '@/lib/exam-core/objectives/capabilities';

const e = (nodeKey: string, purpose: 'FULL_TEST' | 'AREA_PRACTICE' | null = 'AREA_PRACTICE') => ({ nodeKey, label: nodeKey, purpose, lengthCoveragePercent: null });

describe('F5: a preparation\'s "Comenzar" opens its own governed activity', () => {
  it('PAA: practice opens the whole-test practice entry and the mock opens the reduced mock -- never the generic node "paa"', () => {
    const h = examEntryHrefs('paa', { practiceModes: [e('paa.practice.lectura'), e('paa.practice', 'FULL_TEST')], reducedMocks: [e('paa.mock.reduced', 'FULL_TEST')], fullMocks: [] });
    expect(h.EXAM_PRACTICE).toBe('/dashboard/exams?node=paa.practice');
    expect(h.EXAM_CHALLENGE).toBe('/dashboard/exams?node=paa.practice');
    expect(h.REDUCED_MOCK).toBe('/dashboard/exams?node=paa.mock.reduced');
    expect(h.FULL_MOCK).toBe('/dashboard/exams?node=paa');
  });
  it('without a whole-test entry the first launchable entry is used; nothing launchable falls back to the objective, then the catalogue', () => {
    expect(examEntryHrefs('paa', { practiceModes: [e('paa.practice.ingles')], reducedMocks: [], fullMocks: [] }).EXAM_PRACTICE).toBe('/dashboard/exams?node=paa.practice.ingles');
    expect(examEntryHrefs('cie.9709', null).EXAM_PRACTICE).toBe('/dashboard/exams?node=cie.9709');
    expect(examEntryHrefs(null, null).REDUCED_MOCK).toBe('/dashboard/exams');
    expect(examEntryHrefs('bad key!', { practiceModes: [e('Bad Node')], reducedMocks: [], fullMocks: [] }).EXAM_PRACTICE).toBe('/dashboard/exams');
  });
});

describe('F5: practice follows the plan focus', () => {
  it('the area the plan most recommends is opened when it is launchable; an unknown focus falls back', () => {
    const c = { practiceModes: [e('paa.practice.lectura'), e('paa.practice.ingles')].map((x, i) => ({ ...x, label: ['Lectura', 'Inglés'][i] })), reducedMocks: [e('paa.full', 'FULL_TEST')], fullMocks: [] };
    expect(examEntryHrefs('paa', c, 'Inglés').EXAM_PRACTICE).toBe('/dashboard/exams?node=paa.practice.ingles');
    expect(examEntryHrefs('paa', c, 'Física').EXAM_PRACTICE).toBe('/dashboard/exams?node=paa.practice.lectura');
    expect(examEntryHrefs('paa', c, 'Inglés').REDUCED_MOCK).toBe('/dashboard/exams?node=paa.full');
  });
});
