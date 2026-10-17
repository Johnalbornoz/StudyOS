import { describe, it, expect } from 'vitest';

/**
 * FD Cambridge (FINAL PRODUCT-DECISION DELTA §12-20) -- the creation flow, pure: step order, valid series only,
 * syllabus auto-resolution (single / several / none), the freeze, the audited series change, 0510 never 0511 and
 * Global Perspectives never a MCQ / written mock. No DB, fixed clock.
 */
import {
  CAMBRIDGE_CREATION_STEPS, describeFlow, validateCreation, resolveSyllabus, seriesFor, yearOptions, planSeriesChange, preparationCalendar,
  assertFreezeInvariants, seriesChangeOptions, type FlowContext, type CambridgePreparationFreeze,
} from '@/lib/exam-core/cambridge/creation-flow';
import { CAMBRIDGE_SCHOOL_SUBJECT_MAP, schoolSubjectEntry, allowedActivityKinds, cambridgeFlowObjectiveKeys, type SchoolSubjectEntry } from '@/lib/exam-core/cambridge/school-subject-map';
import { JOSE_MAX_LEON_CHECKPOINT_ROUTE, validateCheckpointPreparationSpec, type CheckpointSchoolRoute } from '@/lib/exam-core/checkpoint/checkpoint-preparation';
import { flattenCatalog } from '@/lib/exam-core/catalog/structure';
import { objectiveByKey } from '@/lib/exam-core/objectives/objective-catalog';
import { selectStep } from '@/app/dashboard/exam-prep/cambridge/CambridgeCreationFlow';

const NOW = new Date('2026-10-17T12:00:00Z');
const ctx = (extra: Partial<FlowContext> = {}): FlowContext => ({ now: NOW, country: 'CO', checkpointRoute: JOSE_MAX_LEON_CHECKPOINT_ROUTE, ...extra });
const CONFIRMED_ROUTE: CheckpointSchoolRoute = { ...JOSE_MAX_LEON_CHECKPOINT_ROUTE, primaryCheckpointGrade: 5, lowerCheckpointGrade: 8, subjectsTaken: ['ESL', 'MATHEMATICS', 'SCIENCE', 'GLOBAL_PERSPECTIVES'], frameworkCodesConfirmed: true };
const igcse = (subject: string) => schoolSubjectEntry('IGCSE', subject as never)!;

describe('flow ordering: programme -> subject -> tier -> exam year -> exam series -> create', () => {
  it('the steps are in the approved order', () => {
    expect(CAMBRIDGE_CREATION_STEPS).toEqual(['PROGRAMME', 'SUBJECT', 'TIER', 'EXAM_YEAR', 'EXAM_SERIES', 'CREATE']);
  });
  it('each step is reached only after the previous one', () => {
    expect(describeFlow({}, ctx()).step).toBe('PROGRAMME');
    expect(describeFlow({ programme: 'IGCSE' }, ctx()).step).toBe('SUBJECT');
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS' }, ctx()).step).toBe('TIER');
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE' }, ctx()).step).toBe('EXAM_YEAR');
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027 }, ctx()).step).toBe('EXAM_SERIES');
    const done = describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'JUNE' }, ctx());
    expect(done.errors).toEqual([]);
    expect(done.step).toBe('CREATE');
  });
  it('a later field without an earlier one is STEP_OUT_OF_ORDER (never silently accepted)', () => {
    expect(describeFlow({ subject: 'MATHEMATICS' }, ctx()).errors[0]).toMatchObject({ code: 'STEP_OUT_OF_ORDER', field: 'subject' });
    expect(describeFlow({ programme: 'IGCSE', examYear: 2027 }, ctx()).errors[0]).toMatchObject({ code: 'STEP_OUT_OF_ORDER', field: 'examYear' });
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', examYear: 2027, examSeries: 'JUNE' }, ctx()).errors[0]).toMatchObject({ code: 'STEP_OUT_OF_ORDER', field: 'examYear' });
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examSeries: 'JUNE' }, ctx()).errors[0]).toMatchObject({ code: 'STEP_OUT_OF_ORDER', field: 'examSeries' });
    expect(validateCreation({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027 }, ctx())).toMatchObject({ ok: false, code: 'STEP_OUT_OF_ORDER', field: 'examSeries' });
  });
  it('tiers: 0580 and 0610 offer Core AND Extended; a wrong tier is refused', () => {
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS' }, ctx()).tiers).toEqual(['CORE', 'EXTENDED']);
    expect(schoolSubjectEntry('IGCSE', 'BIOLOGY')!.mappings.map((m) => [m.syllabusCode, m.tier])).toEqual([['0610', 'CORE'], ['0610', 'EXTENDED']]);
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'HIGHER' }, ctx()).errors[0]).toMatchObject({ code: 'INVALID_TIER' });
  });
  it('the UI helper clears every later step when an earlier one changes', () => {
    const full = { programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'JUNE' };
    expect(selectStep(full, 'tier', 'EXTENDED')).toEqual({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'EXTENDED' });
    expect(selectStep(full, 'programme', 'PRIMARY_CHECKPOINT')).toEqual({ programme: 'PRIMARY_CHECKPOINT' });
  });
});

describe('valid series only (programme-sessions governance, REM-03)', () => {
  const m0580 = igcse('MATHEMATICS').mappings[0];
  it('IGCSE in Colombia: June / November; March is never offered without a governed region + syllabus', () => {
    expect(seriesFor(igcse('MATHEMATICS'), m0580, 2027, ctx())).toEqual(['JUNE', 'NOVEMBER']);
    // India administers March, but 0580 has no governed March availability: not offered (safe fallback).
    expect(seriesFor(igcse('MATHEMATICS'), m0580, 2027, ctx({ country: 'IN' }))).toEqual(['JUNE', 'NOVEMBER']);
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'EXTENDED', examYear: 2027 }, ctx()).series!.map((s) => s.key)).toEqual(['JUNE', 'NOVEMBER']);
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'EXTENDED', examYear: 2027, examSeries: 'MARCH' }, ctx()).errors[0]).toMatchObject({ code: 'INVALID_EXAM_SERIES' });
  });
  it('finished sittings are never offered (October 2026: only November 2026 is left this year)', () => {
    expect(seriesFor(igcse('MATHEMATICS'), m0580, 2026, ctx())).toEqual(['NOVEMBER']);
    expect(seriesFor(igcse('MATHEMATICS'), m0580, 2025, ctx())).toEqual([]);
    expect(describeFlow({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2026, examSeries: 'JUNE' }, ctx()).errors[0]).toMatchObject({ code: 'INVALID_EXAM_SERIES' });
  });
  it('Checkpoint series come from the Checkpoint contract: Global Perspectives never in March', () => {
    const gp = schoolSubjectEntry('LOWER_SECONDARY_CHECKPOINT', 'GLOBAL_PERSPECTIVES')!;
    const esl = schoolSubjectEntry('PRIMARY_CHECKPOINT', 'ESL')!;
    expect(seriesFor(gp, gp.mappings[0], 2027, ctx())).toEqual(['MAY', 'OCTOBER']);
    expect(seriesFor(esl, esl.mappings[0], 2027, ctx())).toEqual(['MARCH', 'MAY', 'OCTOBER']);
  });
  it('years: each says whether a syllabus version is governed (0580 v3 covers 2025-2027 only)', () => {
    expect(yearOptions(igcse('MATHEMATICS'), 'CORE', ctx()).map((y) => [y.year, y.versionGoverned])).toEqual([[2026, true], [2027, true], [2028, false], [2029, false]]);
  });
});

describe('syllabus auto-resolution: single / several / none', () => {
  it('single: 0580 Extended 2027 -> 0580 v3 (from the catalogue, with its registered source)', () => {
    const r = resolveSyllabus(igcse('MATHEMATICS'), 'EXTENDED', 2027);
    expect(r.status).toBe('RESOLVED');
    if (r.status === 'RESOLVED') {
      expect([r.mapping.syllabusCode, r.mapping.tier, r.version.version]).toEqual(['0580', 'EXTENDED', 'v3']);
      expect(r.version.sourceKeys).toEqual(['cie-0580-syllabus-2025-2027']);
    }
  });
  it('several: the product asks the meaningful choice (never guesses), and the choice resolves', () => {
    const base = igcse('MATHEMATICS');
    const two: SchoolSubjectEntry = { ...base, mappings: base.mappings.map((m) => ({ ...m, versions: [...m.versions, { version: 'fixture-next', firstExamYear: 2027, lastExamYear: 2029, sourceKeys: ['fixture'] }] })) };
    const r = resolveSyllabus(two, 'CORE', 2027);
    expect(r).toEqual({ status: 'CHOICE_REQUIRED', choices: [{ key: '0580:v3', syllabusCode: '0580', version: 'v3', route: null }, { key: '0580:fixture-next', syllabusCode: '0580', version: 'fixture-next', route: null }] });
    const picked = resolveSyllabus(two, 'CORE', 2027, '0580:fixture-next');
    expect(picked.status === 'RESOLVED' && picked.version.version).toBe('fixture-next');
    // the flow refuses to create while the choice is pending
    const map = CAMBRIDGE_SCHOOL_SUBJECT_MAP.map((e) => (e.programme === 'IGCSE' && e.subject === 'MATHEMATICS' ? two : e));
    expect(validateCreation({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'JUNE' }, ctx({ map }))).toMatchObject({ ok: false, code: 'SYLLABUS_CHOICE_REQUIRED' });
    expect(validateCreation({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'JUNE', syllabusChoice: '0580:v3' }, ctx({ map })).ok).toBe(true);
  });
  it('none: a year without a governed version is an explicit VERSION_NOT_GOVERNED blocker', () => {
    expect(resolveSyllabus(igcse('MATHEMATICS'), 'CORE', 2028)).toMatchObject({ status: 'BLOCKED', blockers: [{ code: 'VERSION_NOT_GOVERNED' }] });
    expect(validateCreation({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2028, examSeries: 'JUNE' }, ctx())).toMatchObject({ ok: false, code: 'BLOCKED' });
  });
  it('none: 0610 / 0510 (operator-named codes, version not governed) are blocked at the subject step', () => {
    const subjects = describeFlow({ programme: 'IGCSE' }, ctx()).subjects!;
    for (const k of ['BIOLOGY', 'ESL']) expect(subjects.find((s) => s.key === k)).toMatchObject({ available: false, blockers: [{ code: 'VERSION_NOT_GOVERNED' }] });
    expect(subjects.find((s) => s.key === 'MATHEMATICS')!.available).toBe(true);
  });
  it('mapping gaps are explicit: no governed code for IGCSE GP, Spanish, Computer Science, Entrepreneurship', () => {
    const gaps = CAMBRIDGE_SCHOOL_SUBJECT_MAP.filter((e) => e.programme === 'IGCSE' && e.mappings.length === 0).map((e) => e.subject).sort();
    expect(gaps).toEqual(['COMPUTER_SCIENCE', 'ENTREPRENEURSHIP', 'GLOBAL_PERSPECTIVES', 'SPANISH']);
    for (const e of CAMBRIDGE_SCHOOL_SUBJECT_MAP.filter((x) => x.mappings.length === 0)) expect(e.gaps.map((g) => g.code)).toEqual(['NO_GOVERNED_CODE']);
    expect(describeFlow({ programme: 'IGCSE', subject: 'SPANISH' }, ctx()).resolution).toMatchObject({ status: 'BLOCKED', blockers: [{ code: 'NO_GOVERNED_CODE' }] });
  });
  it('Checkpoint subjects stay blocked until the school confirms (grades / subjects) -- never chosen by probability', () => {
    const subjects = describeFlow({ programme: 'PRIMARY_CHECKPOINT' }, ctx()).subjects!;
    expect(subjects.map((s) => s.key)).toEqual(['ESL', 'MATHEMATICS', 'SCIENCE', 'GLOBAL_PERSPECTIVES']);
    for (const s of subjects) expect(s.blockers.map((b) => b.code)).toContain('SCHOOL_CONFIRMATION_REQUIRED');
    expect(subjects.find((s) => s.key === 'ESL')!.codes).toEqual(['0057']);
    expect(describeFlow({ programme: 'LOWER_SECONDARY_CHECKPOINT' }, ctx()).subjects!.find((s) => s.key === 'ESL')!.codes).toEqual(['0876']);
  });
});

describe('the freeze', () => {
  it('freezes qualification, subject, tier, examYear, examSeries, syllabusCode, syllabusVersion, preparationStartDate', () => {
    const v = validateCreation({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'JUNE' }, ctx());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.freeze).toMatchObject({
      schema: 'cambridge-preparation-freeze/v1', qualification: 'Cambridge IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'JUNE',
      syllabusCode: '0580', syllabusVersion: 'v3', preparationStartDate: '2026-10-17', objectiveKey: 'cie.igcse.0580.core', seriesChanges: [],
    });
    expect(objectiveByKey(v.freeze.objectiveKey)).not.toBeNull();
    expect(() => assertFreezeInvariants({ ...v.freeze, syllabusVersion: '' })).toThrow(/syllabusVersion/);
  });
  it('a pilot-hidden objective is not created', () => {
    expect(validateCreation({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'JUNE' }, ctx({ isObjectiveExposed: () => false }))).toMatchObject({ ok: false, code: 'BLOCKED' });
  });
  it('every flow objective exists in the catalogue (no broken route) and only creatable ones resolve', () => {
    for (const k of cambridgeFlowObjectiveKeys()) expect(objectiveByKey(k), k).not.toBeNull();
  });
});

describe('series change: explicit, audited, preserves progress and evidence, recomputes the calendar', () => {
  const frozen = (): CambridgePreparationFreeze => {
    const v = validateCreation({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'EXTENDED', examYear: 2027, examSeries: 'JUNE' }, ctx());
    if (!v.ok) throw new Error('fixture');
    return v.freeze;
  };
  it('requires explicit confirmation; the same series is NO_CHANGE', () => {
    expect(planSeriesChange(frozen(), { examSeries: 'NOVEMBER', examYear: 2027, confirmed: false, actor: 'STUDENT' }, ctx())).toEqual({ ok: false, code: 'CONFIRMATION_REQUIRED' });
    expect(planSeriesChange(frozen(), { examSeries: 'JUNE', examYear: 2027, confirmed: true, actor: 'STUDENT' }, ctx())).toEqual({ ok: false, code: 'NO_CHANGE' });
  });
  it('June 2027 -> November 2027: target updated, everything else kept, audit appended, calendar recomputed', () => {
    const f = frozen();
    const p = planSeriesChange(f, { examSeries: 'NOVEMBER', examYear: 2027, confirmed: true, actor: 'STUDENT', actorId: 's1', reason: 'school entry' }, ctx({ now: new Date('2026-11-02T09:00:00Z') }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const k of ['qualification', 'programme', 'subject', 'tier', 'syllabusCode', 'preparationStartDate', 'objectiveKey'] as const) expect(p.freeze[k]).toEqual(f[k]);
    expect([p.freeze.examSeries, p.freeze.examYear, p.freeze.syllabusVersion]).toEqual(['NOVEMBER', 2027, 'v3']);
    expect(p.freeze.seriesChanges).toHaveLength(1);
    expect(p.record).toMatchObject({ actor: 'STUDENT', actorId: 's1', from: { examSeries: 'JUNE', examYear: 2027 }, to: { examSeries: 'NOVEMBER', examYear: 2027 }, evidencePreserved: true, reason: 'school entry' });
    expect(p.record.calendarRecomputed.before).toEqual(preparationCalendar(f));
    expect(p.record.calendarRecomputed.after).toMatchObject({ startDate: '2026-10-17', targetMonth: '2027-11', precision: 'MONTH', official: false });
    expect(p.record.calendarRecomputed.after.weeksAvailable).toBeGreaterThan(p.record.calendarRecomputed.before.weeksAvailable);
    expect(preparationCalendar(f)).toMatchObject({ targetMonth: '2027-06', weeksAvailable: 32 });
  });
  it('refuses a series not offered, and a year whose version is not governed', () => {
    expect(planSeriesChange(frozen(), { examSeries: 'MARCH', examYear: 2027, confirmed: true, actor: 'STUDENT' }, ctx())).toMatchObject({ ok: false, code: 'INVALID_EXAM_SERIES' });
    expect(planSeriesChange(frozen(), { examSeries: 'JUNE', examYear: 2028, confirmed: true, actor: 'STUDENT' }, ctx())).toMatchObject({ ok: false, code: 'VERSION_NOT_GOVERNED' });
    expect(seriesChangeOptions(frozen(), ctx()).filter((o) => o.versionGoverned).map((o) => `${o.examSeries}:${o.examYear}`)).toEqual(['NOVEMBER:2026', 'JUNE:2027', 'NOVEMBER:2027']);
  });
});

describe('ESL 0510 Speaking Endorsement: never 0511', () => {
  it('IGCSE ESL maps to 0510 Speaking Endorsement only; 0511 exists nowhere (map, catalogue)', () => {
    const esl = igcse('ESL');
    expect(esl.mappings.map((m) => [m.syllabusCode, m.route, m.neverCodes])).toEqual([['0510', 'SPEAKING_ENDORSEMENT', ['0511']]]);
    expect(CAMBRIDGE_SCHOOL_SUBJECT_MAP.flatMap((e) => e.mappings).some((m) => m.syllabusCode === '0511')).toBe(false);
    expect(flattenCatalog().some((f) => f.node.syllabusCode === '0511' || f.node.key.includes('0511'))).toBe(false);
    expect(flattenCatalog().find((f) => f.node.key === 'cie.igcse.0510.speaking-endorsement')?.parentKey).toBe('cie.igcse.0510');
  });
  it('once a version is governed, the freeze is 0510 Speaking Endorsement; a 0511 freeze is a governance defect', () => {
    const esl = igcse('ESL');
    const governed = { ...esl, mappings: esl.mappings.map((m) => ({ ...m, versions: [{ version: 'fixture', firstExamYear: 2027, lastExamYear: 2029, sourceKeys: ['fixture'] }] })) };
    const map = CAMBRIDGE_SCHOOL_SUBJECT_MAP.map((e) => (e === esl ? governed : e));
    const v = validateCreation({ programme: 'IGCSE', subject: 'ESL', examYear: 2027, examSeries: 'JUNE' }, ctx({ map }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect([v.freeze.syllabusCode, v.freeze.route, v.freeze.tier]).toEqual(['0510', 'SPEAKING_ENDORSEMENT', null]);
    expect(() => assertFreezeInvariants({ ...v.freeze, syllabusCode: '0511' })).toThrow(/0510/);
    expect(() => assertFreezeInvariants({ ...v.freeze, route: null })).toThrow(/0510/);
  });
  it('Checkpoint English is ESL (0057 / 0876): the ENGLISH_FRAMEWORK blocker is resolved by the decision', () => {
    expect(JOSE_MAX_LEON_CHECKPOINT_ROUTE.englishFramework).toBe('ESL');
    expect(CAMBRIDGE_SCHOOL_SUBJECT_MAP.some((e) => (e.subject as string) === 'ENGLISH')).toBe(false);
  });
});

describe('format fidelity: Global Perspectives is project / report, never a MCQ / written mock', () => {
  it('GP mappings never offer PRACTICE or MOCK', () => {
    const gp = CAMBRIDGE_SCHOOL_SUBJECT_MAP.filter((e) => e.subject === 'GLOBAL_PERSPECTIVES').flatMap((e) => e.mappings);
    expect(gp.map((m) => [m.syllabusCode, m.assessmentKind])).toEqual([['0838', 'TEAM_PROJECT'], ['1129', 'INDIVIDUAL_REPORT']]);
    for (const m of gp) {
      expect(allowedActivityKinds(m)).not.toContain('MOCK');
      expect(allowedActivityKinds(m)).not.toContain('PRACTICE');
    }
    expect(allowedActivityKinds(igcse('MATHEMATICS').mappings[0])).toEqual(['PRACTICE', 'MOCK']);
    expect(validateCheckpointPreparationSpec({ level: 'PRIMARY', subject: 'GLOBAL_PERSPECTIVES', mode: 'MOCK' })).toContain('GP_AS_WRITTEN_MOCK');
  });
  it('even with a confirmed school route, Checkpoint GP stays blocked (no version, no catalogue entry) -- no mock route exists', () => {
    const s = describeFlow({ programme: 'PRIMARY_CHECKPOINT', subject: 'GLOBAL_PERSPECTIVES' }, ctx({ checkpointRoute: CONFIRMED_ROUTE }));
    expect(s.resolution).toMatchObject({ status: 'BLOCKED' });
    expect((s.resolution as { blockers: Array<{ code: string }> }).blockers.map((b) => b.code)).toEqual(['NOT_IN_CATALOGUE', 'VERSION_NOT_GOVERNED']);
  });
});
