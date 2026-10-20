/**
 * Cambridge AICE Diploma -- credit, group, window, grade, points and award-band
 * rules (src/lib/exam-core/aice/policy.ts + diploma.ts), as sourced from
 * cambridgeinternational.org (docs/exams/v2/sources/aice-diploma.json).
 */
import { describe, it, expect } from 'vitest';
import { AICE_DIPLOMA_POLICY, creditsFor, pointsFor, bandFor, isValidGrade, availableSeries, expiresAfter, AS_GRADES, A_GRADES, type AiceGroup } from '@/lib/exam-core/aice/policy';
import { evaluateDiplomaPlan, evaluateDiplomaResults, countedGroupFor, type SubjectRule, type ResultInput } from '@/lib/exam-core/aice/diploma';
import { AICE_SUBJECTS } from '@/lib/exam-core/aice/aice-subjects.generated';

const catalog = new Map<string, SubjectRule>(AICE_SUBJECTS.map((s) => [s.code, s]));
const groups = (pairs: Array<[string, AiceGroup]> = []) => new Map<string, AiceGroup | null>(pairs);
let n = 0;
const R = (code: string, level: 'AS' | 'A', grade: string, year = 2027, month: 3 | 6 | 11 = 6): ResultInput => ({ id: `r${++n}`, syllabusCode: code, level, grade, series: { year, month } });

describe('catalogue (sourced)', () => {
  it('reference syllabus codes and groups are the official ones', () => {
    expect(catalog.get('9709')).toMatchObject({ name: 'Mathematics', groups: ['GROUP_1'] });
    expect(catalog.get('9702')?.groups).toEqual(['GROUP_1']);
    expect(catalog.get('9701')?.groups).toEqual(['GROUP_1']);
    expect(catalog.get('9700')?.groups).toEqual(['GROUP_1']);
    expect(catalog.get('9093')?.groups).toEqual(['GROUP_2']);
    expect(catalog.get('9708')?.groups).toEqual(['GROUP_3']);
    expect(catalog.get('9239')?.groups).toEqual(['CORE', 'GROUP_4']);
    expect(catalog.get('9990')?.groups).toEqual(['GROUP_1', 'GROUP_3']); // Psychology: Group 1 or 3
  });
  it('every code is numeric and unique; AS-only subjects are single credit', () => {
    expect(new Set(AICE_SUBJECTS.map((s) => s.code)).size).toBe(AICE_SUBJECTS.length);
    expect(AICE_SUBJECTS.every((s) => /^\d{4}$/.test(s.code) && s.levels.length > 0 && s.groups.length > 0)).toBe(true);
    expect(catalog.get('8021')?.levels).toEqual(['AS']);
  });
});

describe('credits and planning', () => {
  it('AS = 1 credit, A Level = 2 credits', () => {
    expect(creditsFor('AS')).toBe(1);
    expect(creditsFor('A')).toBe(2);
  });
  const full = [
    { syllabusCode: '9239', level: 'AS' as const, countedGroup: null },
    { syllabusCode: '9709', level: 'A' as const, countedGroup: null },
    { syllabusCode: '9093', level: 'AS' as const, countedGroup: null },
    { syllabusCode: '9708', level: 'A' as const, countedGroup: null },
    { syllabusCode: '9702', level: 'AS' as const, countedGroup: null },
  ];
  it('a 7-credit plan with core and Groups 1-3 is complete', () => {
    const e = evaluateDiplomaPlan(full, catalog);
    expect(e.totalCredits).toBe(7);
    expect(e.complete).toBe(true);
    expect(e.groups.find((g) => g.group === 'GROUP_1')).toMatchObject({ credits: 3, satisfied: true });
  });
  it('minimum 7 credits', () => {
    const e = evaluateDiplomaPlan(full.slice(0, 4), catalog);
    expect(e.totalCredits).toBe(6);
    expect(e.issues.map((i) => i.code)).toContain('CREDITS_SHORT');
  });
  it('compulsory core', () => {
    const e = evaluateDiplomaPlan([...full.slice(1), { syllabusCode: '9701', level: 'AS', countedGroup: null }], catalog);
    expect(e.coreIncluded).toBe(false);
    expect(e.issues.map((i) => i.code)).toContain('CORE_MISSING');
  });
  it.each([
    ['GROUP_1', ['9709', '9702']],
    ['GROUP_2', ['9093']],
    ['GROUP_3', ['9708']],
  ] as const)('at least one credit from %s', (group, codes) => {
    const e = evaluateDiplomaPlan(full.filter((x) => !(codes as readonly string[]).includes(x.syllabusCode)), catalog);
    expect(e.issues).toContainEqual({ code: 'GROUP_MISSING', group });
  });
  it('Group 4 counts at most 2 credits', () => {
    const e = evaluateDiplomaPlan([{ syllabusCode: '9239', level: 'AS', countedGroup: null }, { syllabusCode: '9694', level: 'A', countedGroup: null }, { syllabusCode: '8021', level: 'AS', countedGroup: null }, { syllabusCode: '9709', level: 'AS', countedGroup: null }, { syllabusCode: '9093', level: 'AS', countedGroup: null }, { syllabusCode: '9708', level: 'AS', countedGroup: null }], catalog);
    expect(e.groups.find((g) => g.group === 'GROUP_4')).toMatchObject({ credits: 3, max: 2, satisfied: false });
    expect(e.issues.map((i) => i.code)).toContain('GROUP_4_OVER_LIMIT');
    expect(e.totalCredits).toBe(6); // the over-limit credit does not count
  });
  it('multi-group subject: never resolved automatically; the Student chooses where it counts', () => {
    expect(countedGroupFor(catalog.get('9990')!, null)).toBeNull();
    expect(countedGroupFor(catalog.get('9990')!, 'GROUP_3')).toBe('GROUP_3');
    expect(countedGroupFor(catalog.get('9990')!, 'GROUP_2')).toBeNull(); // not an eligible group
    const plan = [{ syllabusCode: '9239', level: 'AS' as const, countedGroup: null }, { syllabusCode: '9709', level: 'A' as const, countedGroup: null }, { syllabusCode: '9093', level: 'AS' as const, countedGroup: null }, { syllabusCode: '9990', level: 'A' as const, countedGroup: null }, { syllabusCode: '9702', level: 'AS' as const, countedGroup: null }];
    expect(evaluateDiplomaPlan(plan, catalog).issues).toContainEqual({ code: 'GROUP_NOT_CHOSEN', syllabusCode: '9990' });
    const chosen = plan.map((p) => (p.syllabusCode === '9990' ? { ...p, countedGroup: 'GROUP_3' as const } : p));
    expect(evaluateDiplomaPlan(chosen, catalog).complete).toBe(true);
  });
  it('invalid combinations: level not offered, duplicate subject, unknown code', () => {
    const e = evaluateDiplomaPlan([{ syllabusCode: '8021', level: 'A', countedGroup: null }, { syllabusCode: '9709', level: 'AS', countedGroup: null }, { syllabusCode: '9709', level: 'A', countedGroup: null }, { syllabusCode: '1234', level: 'AS', countedGroup: null }], catalog);
    expect(e.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['LEVEL_NOT_OFFERED', 'DUPLICATE_SUBJECT', 'UNKNOWN_SUBJECT']));
  });
});

describe('grades', () => {
  it('AS Level has no A*; grades a-e + U', () => {
    expect([...AS_GRADES]).toEqual(['a', 'b', 'c', 'd', 'e', 'U']);
    expect(isValidGrade('AS', 'A*')).toBe(false);
    expect(isValidGrade('AS', 'A')).toBe(false); // AS grades are lower case
    expect(isValidGrade('AS', 'a')).toBe(true);
  });
  it('A Level has A*; grades A*-E + U', () => {
    expect([...A_GRADES]).toEqual(['A*', 'A', 'B', 'C', 'D', 'E', 'U']);
    expect(isValidGrade('A', 'A*')).toBe(true);
    expect(isValidGrade('A', 'a')).toBe(false);
  });
  it('U earns no points and is not a pass', () => {
    expect(pointsFor('A', 'U')).toBe(0);
    expect(pointsFor('AS', 'U')).toBe(0);
  });
  it('points conversion', () => {
    expect(['A*', 'A', 'B', 'C', 'D', 'E'].map((g) => pointsFor('A', g))).toEqual([140, 120, 100, 80, 60, 40]);
    expect(['a', 'b', 'c', 'd', 'e'].map((g) => pointsFor('AS', g))).toEqual([60, 50, 40, 30, 20]);
    expect(AICE_DIPLOMA_POLICY.maxScore.value).toBe(420);
  });
  it('award bands', () => {
    expect([bandFor(140), bandFor(249), bandFor(250), bandFor(359), bandFor(360), bandFor(420), bandFor(139)]).toEqual(['PASS', 'PASS', 'MERIT', 'MERIT', 'DISTINCTION', 'DISTINCTION', null]);
  });
});

describe('results -> Diploma', () => {
  it('Pass / Merit / Distinction from a valid composition', () => {
    const minimum = evaluateDiplomaResults([R('9239', 'AS', 'e'), R('9709', 'A', 'E'), R('9093', 'AS', 'e'), R('9708', 'A', 'E'), R('9702', 'AS', 'e')], catalog, groups());
    expect(minimum).toMatchObject({ compositionValid: true, credits: 7, points: 140, band: 'PASS' }); // 20+40+20+40+20
    const pass = evaluateDiplomaResults([R('9239', 'AS', 'd'), R('9709', 'A', 'D'), R('9093', 'AS', 'd'), R('9708', 'A', 'D'), R('9702', 'AS', 'd')], catalog, groups());
    expect(pass).toMatchObject({ points: 210, band: 'PASS' }); // 30+60+30+60+30
    const merit = evaluateDiplomaResults([R('9239', 'AS', 'c'), R('9709', 'A', 'C'), R('9093', 'AS', 'c'), R('9708', 'A', 'D'), R('9702', 'AS', 'd')], catalog, groups());
    expect(merit).toMatchObject({ points: 250, band: 'MERIT' }); // 40+80+40+60+30
    const dist = evaluateDiplomaResults([R('9239', 'AS', 'a'), R('9709', 'A', 'A*'), R('9093', 'AS', 'a'), R('9708', 'A', 'A'), R('9702', 'AS', 'a')], catalog, groups());
    expect(dist).toMatchObject({ points: 420, band: 'DISTINCTION' }); // 440, capped at 420
  });
  it('points high enough but a group missing -> NO Diploma', () => {
    const e = evaluateDiplomaResults([R('9239', 'AS', 'a'), R('9709', 'A', 'A*'), R('9702', 'A', 'A*'), R('9701', 'A', 'A*')], catalog, groups());
    expect(e.compositionValid).toBe(false);
    expect(e.band).toBeNull();
    expect(e.points).toBe(0);
    expect(e.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['GROUP_MISSING']));
  });
  it('no core -> no Diploma', () => {
    const e = evaluateDiplomaResults([R('9709', 'A', 'A*'), R('9093', 'A', 'A*'), R('9708', 'A', 'A*'), R('9702', 'AS', 'a')], catalog, groups());
    expect(e.compositionValid).toBe(false);
    expect(e.issues).toContainEqual({ code: 'CORE_MISSING' });
  });
  it('25-month window: a result older than 25 months is outside, never deleted', () => {
    const old = R('9702', 'AS', 'a', 2024, 6);
    const e = evaluateDiplomaResults([old, R('9239', 'AS', 'a', 2026, 6), R('9709', 'A', 'A', 2026, 11), R('9093', 'AS', 'a', 2026, 11), R('9708', 'A', 'A', 2027, 6), R('9701', 'AS', 'b', 2027, 6)], catalog, groups());
    const v = e.results.find((r) => r.id === old.id)!;
    expect(v.status).toBe('OUTSIDE_WINDOW');
    expect(v.counted).toBe(false);
    expect(e.results).toHaveLength(6);
    expect(e.compositionValid).toBe(true);
    expect(e.counted).not.toContain(old.id);
  });
  it('expires after 24 months (25-month period) and June 2025 counts with June 2027', () => {
    expect(expiresAfter({ year: 2025, month: 6 })).toEqual({ year: 2027, month: 6 });
    const e = evaluateDiplomaResults([R('9239', 'AS', 'a', 2025, 6), R('9709', 'A', 'A', 2027, 6), R('9093', 'AS', 'a', 2026, 6), R('9708', 'A', 'A', 2026, 11), R('9702', 'AS', 'a', 2027, 6)], catalog, groups());
    expect(e.compositionValid).toBe(true);
  });
  it('at most 5 exam series', () => {
    const six = [R('9239', 'AS', 'a', 2025, 6), R('9709', 'AS', 'a', 2025, 11), R('9093', 'AS', 'a', 2026, 3), R('9708', 'AS', 'a', 2026, 6), R('9702', 'AS', 'a', 2026, 11), R('9701', 'AS', 'a', 2027, 3), R('9700', 'AS', 'a', 2027, 6)];
    const e = evaluateDiplomaResults(six, catalog, groups());
    expect(e.compositionValid).toBe(false); // needs 7 results across 7 series
  });
  it('one counted instance per syllabus (AS and A Level of the same subject never both; best retake)', () => {
    const as = R('9709', 'AS', 'a', 2026, 6);
    const a = R('9709', 'A', 'B', 2027, 6);
    const retake = R('9093', 'AS', 'c', 2026, 6);
    const retakeBest = R('9093', 'AS', 'a', 2026, 11);
    const e = evaluateDiplomaResults([R('9239', 'AS', 'a', 2027, 6), as, a, retake, retakeBest, R('9708', 'A', 'A', 2027, 6), R('9702', 'AS', 'a', 2027, 6)], catalog, groups());
    expect(e.counted.filter((id) => id === as.id || id === a.id)).toHaveLength(1);
    expect(e.results.find((r) => r.id === as.id)!.status).toBe('SUPERSEDED');
    expect(e.results.find((r) => r.id === retake.id)!.status).toBe('SUPERSEDED');
    expect(e.counted).toContain(retakeBest.id);
    expect(e.assumptions.length).toBe(3); // the unconfirmed rules are disclosed
  });
  it('archived / U results never count', () => {
    const e = evaluateDiplomaResults([R('9239', 'AS', 'U'), R('9709', 'A', 'A')], catalog, groups());
    expect(e.results.find((r) => r.grade === 'U')!.status).toBe('NOT_A_PASS');
    expect(e.issues).toContainEqual({ code: 'CORE_MISSING' });
  });
  it('multi-group result counts only where the Student placed it', () => {
    const res = [R('9239', 'AS', 'a'), R('9709', 'A', 'A'), R('9093', 'AS', 'a'), R('9990', 'A', 'A'), R('9702', 'AS', 'a')];
    expect(evaluateDiplomaResults(res, catalog, groups()).compositionValid).toBe(false);
    expect(evaluateDiplomaResults(res, catalog, groups([['9990', 'GROUP_3']])).compositionValid).toBe(true);
  });
  it('A Level GP&R: meets the core and adds a Group 4 credit; with three A Levels (8 credits) allowed', () => {
    // core A (core + 1 Group 4 credit) + 9709 A + 9093 AS + 9708 AS + 9702 AS = 7 credits
    const gprA = evaluateDiplomaResults([R('9239', 'A', 'A'), R('9709', 'A', 'A'), R('9093', 'AS', 'a'), R('9708', 'AS', 'a'), R('9702', 'AS', 'a')], catalog, groups());
    expect(gprA).toMatchObject({ compositionValid: true, credits: 7 });
    const six = evaluateDiplomaResults([R('9239', 'A', 'A'), R('9709', 'A', 'A'), R('9093', 'AS', 'a'), R('9708', 'AS', 'a')], catalog, groups());
    expect(six.compositionValid).toBe(false);
    const eight = evaluateDiplomaResults([R('9239', 'A', 'A'), R('9709', 'A', 'A'), R('9093', 'A', 'A'), R('9708', 'A', 'A')], catalog, groups());
    expect(eight).toMatchObject({ compositionValid: true, credits: 8 });
    const eightAS = evaluateDiplomaResults([R('9239', 'AS', 'a'), R('9709', 'A', 'A'), R('9093', 'A', 'A'), R('9708', 'A', 'A'), R('9702', 'AS', 'a')], catalog, groups());
    expect(eightAS.credits).toBe(7); // without A Level GP&R the 8-credit exception does not apply: the best 7 count
  });
  it('thresholds are never assumed: series availability is policy (March only where offered)', () => {
    expect(availableSeries(2027, 1, 'CO').map((s) => s.month)).toEqual([6, 11]);
    expect(availableSeries(2027, 1, 'IN').map((s) => s.month)).toEqual([3, 6, 11]);
  });
});
