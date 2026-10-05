/**
 * J1.1 / J1.2 / J3.1 / J3.2 -- institutional academic context, exam target contract, session /
 * date model and their shadow integration. T1-T15 of the phase brief + the deterministic shadow
 * scenarios + the migration contract.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  institutionGradeLevel,
  resolveInstitutionalAcademicContext,
  summariseInstitutionalContext,
  type InstitutionalEnrollmentFact,
  type InstitutionalContextFacts,
} from '@/lib/exam-journey/institutional-context';
import {
  describeExamResult,
  resolveTargetSchedule,
  scheduleFactsFromRow,
  targetResultCapability,
  toExamTarget,
  validateTargetSchedule,
  type TargetScheduleFacts,
} from '@/lib/exam-journey/exam-target';
import { resolveStudentExamJourney } from '@/lib/exam-journey/resolver';
import { buildInstitutionContextShadowRecord, buildJourneyShadowRecord } from '@/lib/exam-journey/shadow-record';
import type { LearnerFacts, StudentExamJourneyFacts } from '@/lib/exam-journey/types';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf-8');
const IB = { id: 'prog-ib-dp', label: 'IB Diploma Programme' };
const NATIONAL = { id: 'prog-co-men', label: 'MEN Colombia' };

const enrollment = (over: Partial<InstitutionalEnrollmentFact> & { classId?: string; gradeLevel?: string | null } = {}): InstitutionalEnrollmentFact => {
  const classId = over.classId ?? 'class-math';
  return {
    enrollmentStatus: 'ACTIVE',
    institution: { id: 'inst-1', name: 'Colegio', country: 'CO' },
    class: { id: classId, name: 'Math AA HL', period: null },
    grade: { id: 'grade-dp1', name: 'DP Year 1', academicLevel: over.gradeLevel === undefined ? 'DP1' : over.gradeLevel, academicYear: '2026-2027', programme: IB },
    classSubject: { canonicalSubjectId: 'cs-math', label: 'Matemáticas' },
    curriculum: { id: `cur-${classId}`, sourceType: 'INTERNATIONAL_PROGRAMME', academicYear: '2026-2027', structureVersionId: 'sv-1', programme: IB, academicSubject: { id: 'as-math-aa-hl', label: 'Mathematics AA', level: 'HL' }, levelOptionsExist: true },
    ...over,
  };
};
const facts = (enrollments: InstitutionalEnrollmentFact[], student: InstitutionalContextFacts['student'] = null): InstitutionalContextFacts => ({ enrollments, student });

// ------------------------------------------------------------------ J1
describe('J1.1 -- institutional academic context resolver', () => {
  it('T1 institution + mapped canonical programme -> resolved, HIGH confidence, institutional provenance', () => {
    const ctx = resolveInstitutionalAcademicContext(facts([enrollment()]));
    expect(ctx.status).toBe('COMPLETE');
    expect(ctx.confidence).toBe('HIGH');
    const i = ctx.institutions[0];
    expect(i.programme.state).toBe('RESOLVED');
    expect(i.programme.effective).toMatchObject({ value: IB, provenance: 'CURRICULUM_DERIVED' });
    expect(i.gradeYearStage.gradeLevel.effective).toMatchObject({ value: 11, provenance: 'INSTITUTION_ASSIGNED' });
    expect(i.gradeYearStage.academicYear.effective).toMatchObject({ value: '2026-2027', provenance: 'INSTITUTION_ASSIGNED' });
    expect(i.subjects).toEqual([{ canonicalSubjectId: 'cs-math', label: 'Matemáticas', academicSubjectId: 'as-math-aa-hl', level: 'HL', provenance: 'CURRICULUM_DERIVED', classIds: ['class-math'] }]);
    expect(i.levels).toEqual([{ academicSubjectId: 'as-math-aa-hl', level: 'HL', provenance: 'CURRICULUM_DERIVED' }]);
    expect(ctx.missingInformation).toEqual([]);
  });

  it('T2 institution curriculum without a canonical programme -> INCOMPLETE, owner INSTITUTION, the Student is never asked', () => {
    const unmapped = enrollment({ grade: { id: 'grade-11', name: 'Grado 11', academicLevel: null, academicYear: null, programme: null }, curriculum: { id: 'cur-lp', sourceType: 'INSTITUTION_DEFINED', academicYear: null, structureVersionId: null, programme: null, academicSubject: null, levelOptionsExist: false } });
    const ctx = resolveInstitutionalAcademicContext(facts([unmapped]));
    expect(ctx.status).toBe('INCOMPLETE');
    expect(ctx.confidence).toBe('LOW');
    const codes = ctx.missingInformation.map((m) => `${m.code}:${m.owner}`);
    expect(codes).toContain('PROGRAMME_UNMAPPED:INSTITUTION');
    expect(ctx.missingInformation.every((m) => m.owner === 'INSTITUTION')).toBe(true);
    // the grade number read from the NAME is shown for confirmation only, never as the institution's fact
    expect(ctx.institutions[0].gradeYearStage.gradeLevel).toMatchObject({ state: 'MISSING', effective: { value: 11, provenance: 'SYSTEM_INFERRED' } });
    // the journey learner: academic path defined by the institution, no academic input asked
    const summary = summariseInstitutionalContext(ctx);
    const r = resolveStudentExamJourney(journeyFacts({ institution: { activeEnrollments: 1, classProgrammes: [], assignedObjectiveKeys: [], context: summary } }));
    expect(r.learner).toEqual({ state: 'ACADEMIC_PATH_DEFINED', contextSource: 'INSTITUTION', requiresAcademicInput: false });
    expect(r.resolutionReasons.find((x) => x.code === 'INSTITUTION_CONTEXT_INCOMPLETE')?.detail?.missing).toMatch(/PROGRAMME_UNMAPPED/);
    expect(r.academicContext).toMatchObject({ status: 'INCOMPLETE', completeness: 'PARTIAL' });
  });

  it('T3 institution DP Year 1 vs Student DP Year 2 -> explicit conflict, neither value chosen', () => {
    const ctx = resolveInstitutionalAcademicContext(facts([enrollment()], { programme: IB, gradeLevel: 12, academicYear: null }));
    expect(ctx.status).toBe('CONFLICT');
    const g = ctx.institutions[0].gradeYearStage.gradeLevel;
    expect(g.state).toBe('CONFLICT_REQUIRES_RESOLUTION');
    expect(g.effective.value).toBeNull();
    expect(g.institutional.value).toBe(11);
    expect(g.student.value).toBe(12);
    expect(ctx.conflicts).toEqual([{ field: 'gradeLevel', kind: 'INSTITUTION_VS_STUDENT', institutionId: 'inst-1', values: [{ value: 11, provenance: 'INSTITUTION_ASSIGNED', sourceRef: 'grade-dp1' }, { value: 12, provenance: 'STUDENT_ENTERED', sourceRef: null }], resolution: 'CONFLICT_REQUIRES_RESOLUTION', resolvableBy: ['STUDENT', 'INSTITUTION'] }]);
    // a matching Student value is a confirmation, the value stays the institution's
    const same = resolveInstitutionalAcademicContext(facts([enrollment()], { programme: IB, gradeLevel: 11, academicYear: null }));
    expect(same.institutions[0].gradeYearStage.gradeLevel.effective).toMatchObject({ value: 11, provenance: 'STUDENT_CONFIRMED' });
    expect(same.institutions[0].programme.effective).toMatchObject({ value: IB, provenance: 'STUDENT_CONFIRMED' });
  });

  it('T4 multiple consistent classes -> deterministic (input order irrelevant), subjects merged per class', () => {
    const a = enrollment({ classId: 'class-a' });
    const b = enrollment({ classId: 'class-b', classSubject: { canonicalSubjectId: 'cs-phys', label: 'Física' }, curriculum: { ...enrollment().curriculum!, id: 'cur-b', academicSubject: { id: 'as-phys-sl', label: 'Physics', level: 'SL' } } });
    const one = resolveInstitutionalAcademicContext(facts([a, b]));
    const two = resolveInstitutionalAcademicContext(facts([b, a]));
    expect(one).toEqual(two);
    expect(one.status).toBe('COMPLETE');
    expect(one.institutions[0].subjects.map((s) => s.canonicalSubjectId)).toEqual(['cs-math', 'cs-phys']);
  });

  it('T5 multiple inconsistent classes (different programmes / grades) -> INSTITUTION_INTERNAL conflict', () => {
    const a = enrollment({ classId: 'class-a' });
    const b = enrollment({ classId: 'class-b', grade: { id: 'grade-10', name: 'Grado 10', academicLevel: '10', academicYear: '2026-2027', programme: NATIONAL }, curriculum: { ...enrollment().curriculum!, id: 'cur-b', programme: NATIONAL } });
    const ctx = resolveInstitutionalAcademicContext(facts([a, b]));
    expect(ctx.status).toBe('CONFLICT');
    expect(ctx.conflicts.map((c) => `${c.field}:${c.kind}`).sort()).toEqual(['gradeLevel:INSTITUTION_INTERNAL', 'programme:INSTITUTION_INTERNAL']);
    expect(ctx.conflicts.every((c) => c.resolvableBy.join() === 'INSTITUTION')).toBe(true);
    expect(ctx.institutions[0].programme.effective.value).toBeNull();
  });

  it('T6 no institution -> NOT_AFFILIATED cleanly; a pending invitation is PENDING_ENROLLMENT', () => {
    const none = resolveInstitutionalAcademicContext(facts([], { programme: null, gradeLevel: 9, academicYear: '2026' }));
    expect(none).toMatchObject({ status: 'NOT_AFFILIATED', confidence: 'NONE', institutions: [], missingInformation: [], conflicts: [] });
    const pending = resolveInstitutionalAcademicContext(facts([enrollment({ enrollmentStatus: 'PENDING' })]));
    expect(pending.status).toBe('PENDING_ENROLLMENT');
    expect(pending.missingInformation.map((m) => `${m.code}:${m.owner}`)).toEqual(['ENROLLMENT_PENDING:STUDENT']);
    // the journey keeps its pre-J1 learner behaviour for a non-affiliated Student
    const r = resolveStudentExamJourney(journeyFacts({ institution: { activeEnrollments: 0, classProgrammes: [], assignedObjectiveKeys: [], context: summariseInstitutionalContext(none) } }));
    expect(r.learner.contextSource).not.toBe('INSTITUTION');
  });

  it('two institutions are separate scopes: different programmes are not a conflict; the Student is not compared', () => {
    const school = enrollment();
    const academy = enrollment({ classId: 'class-x', institution: { id: 'inst-2', name: 'Academia', country: 'CO' }, grade: { id: 'grade-x', name: 'Saber 11', academicLevel: '11', academicYear: null, programme: NATIONAL }, curriculum: { ...enrollment().curriculum!, id: 'cur-x', programme: NATIONAL } });
    const ctx = resolveInstitutionalAcademicContext(facts([school, academy], { programme: IB, gradeLevel: 12, academicYear: null }));
    expect(ctx.conflicts).toEqual([]);
    expect(ctx.institutions.map((i) => i.programme.effective.value?.id)).toEqual(['prog-ib-dp', 'prog-co-men']);
  });

  it('institutional grade labels: IB stages are read as IB, never as "grade 1"', () => {
    expect(institutionGradeLevel('DP Year 1', null)).toBe(11);
    expect(institutionGradeLevel('DP2', 'CO')).toBe(12);
    expect(institutionGradeLevel('MYP 3', null)).toBe(8);
    expect(institutionGradeLevel('11', 'CO')).toBe(11);
    expect(institutionGradeLevel('2° Secundaria', 'mx')).toBe(8);
    expect(institutionGradeLevel('Los Pumas', 'CO')).toBeNull();
  });

  it('free text is never a source: class names and teacher labels do not create levels or subjects', () => {
    const noCurriculum = enrollment({ class: { id: 'c-free', name: 'Math HL (advanced)', period: '2026' }, curriculum: null, classSubject: null });
    const ctx = resolveInstitutionalAcademicContext(facts([noCurriculum]));
    expect(ctx.institutions[0].levels).toEqual([]);
    expect(ctx.institutions[0].subjects).toEqual([]);
    expect(ctx.missingInformation.map((m) => m.code).sort()).toEqual(expect.arrayContaining(['CLASS_WITHOUT_CURRICULUM', 'CLASS_WITHOUT_SUBJECT']));
  });
});

// ------------------------------------------------------------------ J3
const emptySchedule: TargetScheduleFacts = { officialSession: null, authoritativeExamDate: null, studentReportedExamDate: null, personalTargetDate: null, estimatedMonth: null };

describe('J3.1 / J3.2 -- exam target contract and schedule', () => {
  it('T7 independent PAA target with no subjects is valid and resolves', () => {
    const r = resolveStudentExamJourney(journeyFacts({ subjectCount: 0, examTargetCount: 1 }, { schedule: { ...emptySchedule, studentReportedExamDate: '2026-12-05' } }));
    expect(r.learner.state).toBe('EXAM_ONLY_PROFILE');
    expect(r.state).toBe('DIAGNOSTIC_DUE');
    expect(r.schedule).toMatchObject({ targetDateSource: 'STUDENT_REPORTED_EXAM_DATE', officialSession: 'UNKNOWN' });
  });

  it('T8 target with an official session -> officialSession populated (its dates stay UNKNOWN while no session data is loaded)', () => {
    const s = resolveTargetSchedule({ ...emptySchedule, officialSession: { sessionKey: 'ib.m27', label: null, source: 'STUDENT_SELECTED', startDate: null, authoritative: false } });
    expect(s.officialSession).toMatchObject({ sessionKey: 'ib.m27', source: 'STUDENT_SELECTED' });
    expect(s.targetDate).toBeNull();
    const withDate = resolveTargetSchedule({ ...emptySchedule, officialSession: { sessionKey: 'ib.m27', label: 'May 2027', source: 'INSTITUTION_ASSIGNED', startDate: '2027-05-03', authoritative: true }, personalTargetDate: '2027-04-15' });
    expect(withDate.targetDate).toEqual({ value: '2027-05-03', precision: 'DAY', source: 'INSTITUTION_ASSIGNED_SESSION', official: true });
    expect(withDate.sittingDate?.source).toBe('INSTITUTION_ASSIGNED_SESSION');
    // pacing follows the earlier personal date; the sitting stays the official one
    expect(withDate.planningDate).toMatchObject({ value: '2027-04-15', source: 'PERSONAL_TARGET_DATE', official: false });
  });

  it('T9 only a personal target date -> officialSession stays UNKNOWN and the date is never official nor a sitting', () => {
    const s = resolveTargetSchedule({ ...emptySchedule, personalTargetDate: '2027-04-15' });
    expect(s.officialSession).toBe('UNKNOWN');
    expect(s.sittingDate).toBeNull();
    expect(s.targetDate).toEqual({ value: '2027-04-15', precision: 'DAY', source: 'PERSONAL_TARGET_DATE', official: false });
    // the journey paces against it but can never declare the exam sat from it
    const r = resolveStudentExamJourney(journeyFacts({}, { schedule: { ...emptySchedule, personalTargetDate: '2026-09-01' } }));
    expect(r.state).not.toBe('EXAM_COMPLETED');
    expect(r.resolutionReasons.map((x) => x.code)).toContain('DATE_NOT_OFFICIAL');
  });

  it('an estimated month stays a month: never a day, never official, never a sitting', () => {
    const s = resolveTargetSchedule({ ...emptySchedule, estimatedMonth: '2027-05' });
    expect(s.targetDate).toEqual({ value: '2027-05', precision: 'MONTH', source: 'ESTIMATED_MONTH', official: false });
    expect(s.sittingDate).toBeNull();
    const r = resolveStudentExamJourney(journeyFacts({}, { schedule: { ...emptySchedule, estimatedMonth: '2026-11' } }));
    expect(r.schedule).toMatchObject({ planningPrecision: 'MONTH', targetDateSource: 'ESTIMATED_MONTH' });
    expect(r.resolutionReasons.map((x) => x.code)).toEqual(expect.arrayContaining(['DATE_PRECISION_MONTH', 'DATE_NOT_OFFICIAL']));
    expect(['EXAM_READY', 'EXAM_COMPLETED']).not.toContain(resolveStudentExamJourney(journeyFacts({}, { schedule: { ...emptySchedule, estimatedMonth: '2026-09' } })).state);
  });

  it('priority 1..6 is honoured and every value keeps its source', () => {
    const all: TargetScheduleFacts = {
      officialSession: { sessionKey: 'k', label: null, source: 'STUDENT_SELECTED', startDate: '2027-05-04', authoritative: true },
      authoritativeExamDate: { date: '2027-05-05', provenance: 'OFFICIAL_PUBLIC' },
      studentReportedExamDate: '2027-05-06',
      personalTargetDate: '2027-04-15',
      estimatedMonth: null,
    };
    expect(resolveTargetSchedule(all).targetDateSource).toBe('STUDENT_SELECTED_OFFICIAL_SESSION');
    expect(resolveTargetSchedule({ ...all, officialSession: null }).targetDateSource).toBe('AUTHORITATIVE_EXAM_DATE');
    expect(resolveTargetSchedule({ ...all, officialSession: null, authoritativeExamDate: null }).targetDate).toMatchObject({ source: 'STUDENT_REPORTED_EXAM_DATE', official: false });
    expect(resolveTargetSchedule({ ...emptySchedule, personalTargetDate: '2027-04-15' }).targetDateSource).toBe('PERSONAL_TARGET_DATE');
    expect(resolveTargetSchedule(emptySchedule).targetDateSource).toBe('UNKNOWN');
  });

  it('T10 neither session nor date -> the target stays valid and the journey asks only for the date', () => {
    const r = resolveStudentExamJourney(journeyFacts({}, { schedule: emptySchedule }));
    expect(r.recommendedNextAction.kind).toBe('SET_EXAM_DATE');
    expect(r.blockers.map((b) => b.code)).toContain('EXAM_DATE_UNKNOWN');
    expect(r.examTargetId).toBe('t-1');
    expect(r.schedule).toMatchObject({ targetDateSource: 'UNKNOWN', officialSession: 'UNKNOWN' });
  });

  it('T11 a Student-reported previous result is not verified, not official, not usable for prediction', () => {
    const d = describeExamResult({ kind: 'PREVIOUS', outcomeKind: 'UNSTRUCTURED', value: '285 global', scaleKey: null, sessionLabel: null, provenance: 'STUDENT_REPORTED' });
    expect(d).toMatchObject({ verified: false, label: 'STUDENT_REPORTED_RESULT', usableForPrediction: false, provenance: 'STUDENT_REPORTED' });
    expect(describeExamResult({ ...d, provenance: 'INSTITUTION_REPORTED' })).toMatchObject({ verified: false, label: 'INSTITUTION_REPORTED_RESULT' });
  });

  it('T12 an official-integration result is verified (still not used for prediction without an approved contract)', () => {
    expect(describeExamResult({ kind: 'ACTUAL', outcomeKind: 'COMPOSITE_SCORE', value: '320', scaleKey: 'saber11.global', sessionLabel: '2026-2', provenance: 'OFFICIAL_INTEGRATION' })).toMatchObject({ verified: true, label: 'VERIFIED_RESULT', usableForPrediction: false });
    expect(describeExamResult({ kind: 'ACTUAL', outcomeKind: 'GRADE', value: '6', scaleKey: 'ib.1-7', sessionLabel: null, provenance: 'VERIFIED_DOCUMENT' }).verified).toBe(true);
  });

  it('T13 target result: unavailable unless the Outcome Specification declares the final outcome and its scale -- never defaulted', () => {
    expect(targetResultCapability(null)).toEqual({ available: false, reason: 'OUTCOME_SPECIFICATION_UNAVAILABLE' });
    expect(targetResultCapability({ finalOutcome: { status: 'UNKNOWN', reason: 'no authority' }, reported: [] })).toEqual({ available: false, reason: 'FINAL_OUTCOME_UNKNOWN' });
    expect(targetResultCapability({ finalOutcome: { status: 'DECLARED', layer: 'SUBJECT', kind: 'GRADE' }, reported: [{ kind: 'GRADE', scaleKey: null, status: 'DECLARED', final: true }] })).toEqual({ available: false, reason: 'OUTCOME_SCALE_UNKNOWN' });
    expect(targetResultCapability({ finalOutcome: { status: 'DECLARED', layer: 'SUBJECT', kind: 'GRADE' }, reported: [{ kind: 'GRADE', scaleKey: 'ib.1-7', status: 'DECLARED', final: true }] })).toEqual({ available: true, outcomeKind: 'GRADE', scaleKey: 'ib.1-7' });
    const t = toExamTarget({ id: 't-1', objective_key: 'paa' }, { objective: null, assignedClassId: null, previousResults: [], outcome: null, storedTargetResult: { value: '700' } });
    expect(t.targetResult).toEqual({ status: 'UNAVAILABLE', reason: 'OUTCOME_SPECIFICATION_UNAVAILABLE' });
  });

  it('T14 multiple targets keep dates and results isolated', () => {
    const paa = toExamTarget({ id: 't-paa', objective_key: 'paa', exam_date: '2026-12-05' }, { objective: null, assignedClassId: null, previousResults: [{ kind: 'PREVIOUS', outcomeKind: 'UNSTRUCTURED', value: '520', scaleKey: null, sessionLabel: null, provenance: 'STUDENT_REPORTED' }], outcome: null, storedTargetResult: null });
    const ib = toExamTarget({ id: 't-ib', objective_key: 'ib.dp.math-aa.sl', official_session_key: 'ib.m27', official_session_source: 'INSTITUTION_ASSIGNED', personal_target_date: '2027-04-15' }, { objective: null, assignedClassId: 'class-math', previousResults: [], outcome: null, storedTargetResult: null });
    expect(paa.schedule.targetDateSource).toBe('STUDENT_REPORTED_EXAM_DATE');
    expect(ib.schedule.targetDateSource).toBe('PERSONAL_TARGET_DATE');
    expect(ib.schedule.officialSession).toMatchObject({ sessionKey: 'ib.m27', source: 'INSTITUTION_ASSIGNED' });
    expect(paa.previousResults).toHaveLength(1);
    expect(ib.previousResults).toHaveLength(0);
    expect(ib.institutionalRelationship).toEqual({ kind: 'CLASS_ASSIGNED', classId: 'class-math' });
    const rPaa = resolveStudentExamJourney(journeyFacts({}, { examTargetId: 't-paa', schedule: scheduleFactsFromRow({ id: 't-paa', exam_date: '2026-12-05' }) }));
    const rIb = resolveStudentExamJourney(journeyFacts({}, { examTargetId: 't-ib', schedule: scheduleFactsFromRow({ id: 't-ib', personal_target_date: '2027-04-15' }) }));
    expect(rPaa.schedule?.targetDateSource).toBe('STUDENT_REPORTED_EXAM_DATE');
    expect(rIb.schedule?.targetDateSource).toBe('PERSONAL_TARGET_DATE');
  });

  it('T15 no exam-derived Student Subject is created anywhere in the journey / target code', () => {
    for (const f of ['exam-target.ts', 'institutional-context.ts', 'institutional-context.server.ts', 'facts.server.ts', 'resolver.ts', 'shadow.server.ts']) {
      expect(read(`src/lib/exam-journey/${f}`)).not.toMatch(/INSERT\s+INTO\s+(subjects|concepts)\b/i);
      expect(read(`src/lib/exam-journey/${f}`)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO\s+)?\w/);
    }
  });

  it('legacy rows: exam_date is read as the Student-reported exam date (STUDENT_ENTERED), never re-labelled official', () => {
    const t = toExamTarget({ id: 'legacy', exam_date: '2026-12-05', source: 'STUDENT' }, { objective: null, assignedClassId: null, previousResults: [], outcome: null, storedTargetResult: null });
    expect(t.provenance).toEqual({ exam: 'STUDENT_ENTERED', examDate: 'STUDENT_ENTERED' });
    expect(t.schedule.targetDate).toMatchObject({ official: false });
  });

  it('validation refuses (never fixes): a personal date after the sitting, an estimate next to an exact date, malformed values', () => {
    expect(validateTargetSchedule({ ...emptySchedule, studentReportedExamDate: '2027-05-03', personalTargetDate: '2027-05-20' }).map((i) => i.code)).toContain('PERSONAL_DATE_AFTER_SITTING');
    expect(validateTargetSchedule({ ...emptySchedule, personalTargetDate: '2027-04-15', estimatedMonth: '2027-05' }).map((i) => i.code)).toContain('ESTIMATE_WITH_EXACT_DATE');
    expect(validateTargetSchedule({ ...emptySchedule, estimatedMonth: '2027-13' }).map((i) => i.code)).toContain('MALFORMED_MONTH');
    expect(validateTargetSchedule({ ...emptySchedule, personalTargetDate: '2027-04-15' })).toEqual([]);
  });

  it('a target exists whatever the Question Bank can run (CONTENT_UNAVAILABLE is reported, not a reason to refuse)', () => {
    const r = resolveStudentExamJourney(journeyFacts({}, { schedule: { ...emptySchedule, studentReportedExamDate: '2026-12-05' } }, { content: { practice: false, diagnostic: false, reducedMock: false, fullMock: false, learningBridge: false, unavailable: [], reducedMockLengthCoveragePercent: null } }));
    expect(r.examTargetId).toBe('t-1');
    expect(r.blockers.map((b) => b.code)).toContain('CONTENT_UNAVAILABLE');
  });
});

// ------------------------------------------------------------------ J1.2 target dependencies
describe('J1.2 -- context blockers only on targets that need the missing / conflicted field', () => {
  it('raises INSTITUTION_CONTEXT_INCOMPLETE / ACADEMIC_CONTEXT_CONFLICT on dependent targets only', () => {
    const unmapped = summariseInstitutionalContext(resolveInstitutionalAcademicContext(facts([enrollment({ grade: null, curriculum: { id: 'c', sourceType: 'INSTITUTION_DEFINED', academicYear: null, structureVersionId: null, programme: null, academicSubject: null, levelOptionsExist: false } })])));
    const inst = { activeEnrollments: 1, classProgrammes: [], assignedObjectiveKeys: [], context: unmapped };
    const dependent = resolveStudentExamJourney(journeyFacts({ institution: inst }, { contextDependencies: ['programme'] }));
    expect(dependent.blockers).toContainEqual({ code: 'INSTITUTION_CONTEXT_INCOMPLETE', scope: 'TARGET', detail: { field: 'programme' } });
    const independent = resolveStudentExamJourney(journeyFacts({ institution: inst }, { contextDependencies: [] }));
    expect(independent.blockers.map((b) => b.code)).not.toContain('INSTITUTION_CONTEXT_INCOMPLETE');
    const conflicted = summariseInstitutionalContext(resolveInstitutionalAcademicContext(facts([enrollment()], { programme: IB, gradeLevel: 12, academicYear: null })));
    const c = resolveStudentExamJourney(journeyFacts({ institution: { ...inst, context: conflicted } }, { contextDependencies: ['gradeLevel'] }));
    expect(c.blockers).toContainEqual({ code: 'ACADEMIC_CONTEXT_CONFLICT', scope: 'TARGET', detail: { field: 'gradeLevel' } });
  });
});

// ------------------------------------------------------------------ deterministic shadow scenarios
describe('shadow coverage (local, deterministic; NOT hosted)', () => {
  const ctxOf = (e: InstitutionalEnrollmentFact[], s: InstitutionalContextFacts['student'] = null) => summariseInstitutionalContext(resolveInstitutionalAcademicContext(facts(e, s)));
  const scenarios: Array<{ name: string; learner: Partial<LearnerFacts>; targets: Array<Partial<NonNullable<StudentExamJourneyFacts['target']>> | null>; expect: (rs: ReturnType<typeof resolveStudentExamJourney>[]) => void }> = [
    {
      name: 'institution complete',
      learner: { institution: { activeEnrollments: 1, classProgrammes: [], assignedObjectiveKeys: [], context: ctxOf([enrollment()]) }, examTargetCount: 0 },
      targets: [null],
      expect: ([r]) => expect([r.learner.contextSource, r.academicContext?.status, r.state]).toEqual(['INSTITUTION', 'COMPLETE', 'NO_EXAM_TARGET']),
    },
    {
      name: 'institution curriculum not mapped to a canonical programme',
      learner: { institution: { activeEnrollments: 1, classProgrammes: [], assignedObjectiveKeys: [], context: ctxOf([enrollment({ grade: null, curriculum: { id: 'c', sourceType: 'INSTITUTION_DEFINED', academicYear: null, structureVersionId: null, programme: null, academicSubject: null, levelOptionsExist: false } })]) }, examTargetCount: 0 },
      targets: [null],
      expect: ([r]) => {
        expect(r.learner).toMatchObject({ contextSource: 'INSTITUTION', requiresAcademicInput: false });
        expect(r.academicContext?.missing).toContain('PROGRAMME_UNMAPPED');
      },
    },
    {
      name: 'independent target without subjects',
      learner: { subjectCount: 0 },
      targets: [{ schedule: { ...emptySchedule, studentReportedExamDate: '2026-12-05' } }],
      expect: ([r]) => expect([r.learner.state, r.state]).toEqual(['EXAM_ONLY_PROFILE', 'DIAGNOSTIC_DUE']),
    },
    {
      name: 'independent target without date',
      learner: {},
      targets: [{ schedule: emptySchedule }],
      expect: ([r]) => expect(r.recommendedNextAction.kind).toBe('SET_EXAM_DATE'),
    },
    {
      name: 'independent target with a personal date only',
      learner: {},
      targets: [{ schedule: { ...emptySchedule, personalTargetDate: '2026-12-01' } }],
      expect: ([r]) => {
        expect(r.schedule).toMatchObject({ targetDateSource: 'PERSONAL_TARGET_DATE', officialSession: 'UNKNOWN', sittingDateSource: null });
        expect(r.state).toBe('DIAGNOSTIC_DUE');
      },
    },
    {
      name: 'multiple targets',
      learner: { examTargetCount: 2 },
      targets: [{ examTargetId: 't-a', schedule: { ...emptySchedule, studentReportedExamDate: '2026-12-05' } }, { examTargetId: 't-b', schedule: emptySchedule }],
      expect: ([a, b]) => {
        expect([a.examTargetId, a.schedule?.targetDateSource, a.recommendedNextAction.kind]).toEqual(['t-a', 'STUDENT_REPORTED_EXAM_DATE', 'START_DIAGNOSTIC']);
        expect([b.examTargetId, b.schedule?.targetDateSource, b.recommendedNextAction.kind]).toEqual(['t-b', 'UNKNOWN', 'SET_EXAM_DATE']);
      },
    },
  ];
  for (const sc of scenarios) {
    it(sc.name, () => {
      const rs = sc.targets.map((t) => resolveStudentExamJourney(t === null ? { ...journeyFacts(sc.learner), target: null } : journeyFacts(sc.learner, t)));
      sc.expect(rs);
      // every shadow line stays PII-free and carries the agreed target fields
      for (const r of rs) expect(Object.keys(buildJourneyShadowRecord(r, 'cert'))).toContain('exam_target_id');
    });
  }

  it('the institutional context shadow line carries status, missing links, conflicts and provenance counts only', () => {
    const conflicted = ctxOf([enrollment()], { programme: IB, gradeLevel: 12, academicYear: null });
    const rec = buildInstitutionContextShadowRecord(conflicted, 'cert', '2026-10-05');
    expect(rec).toMatchObject({ event: 'student_institution_context_shadow', institution_context_status: 'CONFLICT', conflicts: ['gradeLevel:INSTITUTION_VS_STUDENT'] });
    const line = JSON.stringify(rec);
    for (const forbidden of ['Colegio', 'Math AA HL', 'inst-1', 'class-math', 'grade-dp1', 'IB Diploma Programme', 'prog-ib-dp']) expect(line).not.toContain(forbidden);
    expect(Object.keys(rec).sort()).toEqual(['as_of', 'confidence', 'conflicts', 'defines_academic_path', 'event', 'institution_context_status', 'missing_links', 'provenance_summary', 'resolver_version', 'route']);
  });
});

// ------------------------------------------------------------------ migration contract
describe('migration 20261101_1000 -- additive only', () => {
  const sql = read('database/migrations/20261101_1000_student_exam_target_schedule.sql');
  const code = sql.replace(/--.*$/gm, '');
  it('adds nullable / defaulted columns and constraints on the new columns only; drops, renames and backfills nothing', () => {
    expect(code).not.toMatch(/\bDROP\b|\bRENAME\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
    for (const col of ['official_session_key', 'official_session_source', 'authoritative_exam_date', 'authoritative_exam_date_provenance', 'personal_target_date', 'estimated_exam_month']) {
      expect(code).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col} (text|date),?\\n`));
    }
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
    expect(code).not.toMatch(/exam_date\s*=|ALTER COLUMN exam_date/);
    expect(sql).toMatch(/-- Rollback/);
  });
});

// ------------------------------------------------------------------ helper
function journeyFacts(learner: Partial<LearnerFacts> = {}, target: Partial<NonNullable<StudentExamJourneyFacts['target']>> = {}, over: Partial<StudentExamJourneyFacts> = {}): StudentExamJourneyFacts {
  return {
    asOf: '2026-10-05',
    learner: { academicProfile: null, institution: { activeEnrollments: 0, classProgrammes: [], assignedObjectiveKeys: [] }, subjectCount: 0, examTargetCount: 1, ...learner },
    target: { examTargetId: 't-1', objectiveKey: 'paa', framework: 'PAA', objectiveKind: 'EXAM', examDefinitionId: null, level: null, examDate: null, sessionCode: null, status: 'ACTIVE', source: 'STUDENT', confirmation: 'CONFIRMED', satConfirmed: false, optedInEarly: false, previousResult: null, actualResult: null, ...target },
    blueprint: { readiness: 'REDUCED_MOCK_READY', structureVisible: true, publishedVersion: true, versionValidity: 'UNVERIFIED', programmePlan: false, institutionalRelease: 'NOT_APPLICABLE' },
    content: { practice: true, diagnostic: true, reducedMock: true, fullMock: false, learningBridge: true, unavailable: [], reducedMockLengthCoveragePercent: 21 },
    learning: null,
    exam: { instances: [], openAttempt: false },
    prediction: { modelClass: 'NO_MODEL', components: [], estimates: [] },
    ...over,
  };
}
