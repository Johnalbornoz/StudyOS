/**
 * Student Exam Journey -- J1.1 INSTITUTIONAL ACADEMIC CONTEXT resolver (pure).
 *
 * Design: docs/journey/J1_INSTITUTIONAL_CONTEXT_DESIGN.md.
 *
 *   resolveInstitutionalAcademicContext(facts) -> institutions[] (programme,
 *     curricula, grade / year / stage, classes, subjects, levels), provenance,
 *     missingInformation, conflicts, confidence, status
 *
 * Rules:
 *   - Institutional facts and Student facts are two layers. A Student value never
 *     overwrites an institutional one (and vice versa): disagreement is an explicit
 *     CONFLICT_REQUIRES_RESOLUTION, never a silent preference.
 *   - Information the institution owns is never turned into a question for the
 *     Student: when it is missing it is reported (owner INSTITUTION), e.g. an
 *     institution curriculum with no catalogue programme -> PROGRAMME_UNMAPPED.
 *   - Free text (class names, teacher labels, institutions.curriculum) is never a
 *     source of truth. A grade number read from a grade NAME is SYSTEM_INFERRED.
 *   - Several institutions are kept apart (different scopes are not conflicts).
 * Pure and deterministic: no DB, no clock, inputs sorted before use.
 */
import { normaliseGradeLevel } from '@/lib/exam-core/eligibility/grade-level';

export const INSTITUTIONAL_CONTEXT_RESOLVER_VERSION = 'institutional-context-v1';

export type ContextProvenance = 'INSTITUTION_ASSIGNED' | 'CLASS_DERIVED' | 'CURRICULUM_DERIVED' | 'STUDENT_CONFIRMED' | 'STUDENT_ENTERED' | 'SYSTEM_INFERRED';
export type ContextConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type InstitutionContextStatus = 'NOT_AFFILIATED' | 'PENDING_ENROLLMENT' | 'COMPLETE' | 'INCOMPLETE' | 'CONFLICT';
export type ContextField = 'programme' | 'gradeLevel' | 'academicYear';

// ------------------------------------------------------------------ facts (input)

/** One enrollment row, as the read-only loader returns it (ids are internal UUIDs). */
export interface InstitutionalEnrollmentFact {
  enrollmentStatus: 'ACTIVE' | 'PENDING';
  institution: { id: string; name: string; country: string | null };
  class: { id: string; name: string; period: string | null };
  grade: { id: string; name: string; academicLevel: string | null; academicYear: string | null; programme: { id: string; label: string } | null } | null;
  /** classes.canonical_subject_id */
  classSubject: { canonicalSubjectId: string; label: string } | null;
  /** classes.institution_curriculum_id -> institution_curricula (+ catalogue). */
  curriculum: {
    id: string;
    sourceType: string | null;
    academicYear: string | null;
    structureVersionId: string | null;
    /** institution_curricula.academic_programme_id, else the base academic subject's programme. */
    programme: { id: string; label: string } | null;
    academicSubject: { id: string; label: string; level: string | null } | null;
    /** The catalogue programme offers levels (HL/SL, Core/Extended...) for this subject. */
    levelOptionsExist: boolean;
  } | null;
}

/** What the Student declared (Academic Profile). Never authoritative for institutional fields. */
export interface StudentDeclaredContext {
  programme: { id: string; label: string } | null;
  gradeLevel: number | null;
  academicYear: string | null;
}

export interface InstitutionalContextFacts {
  enrollments: InstitutionalEnrollmentFact[];
  student: StudentDeclaredContext | null;
}

// ------------------------------------------------------------------ resolution (output)

export interface ContextValue<T> {
  value: T | null;
  provenance: ContextProvenance | null;
  /** Object the value was read from (grade / class / curriculum id): traceability only. */
  sourceRef: string | null;
}
export interface LayeredField<T> {
  institutional: ContextValue<T>;
  student: ContextValue<T>;
  /** Single source, or null while in conflict. A Student value is effective only for Student-owned uses (state MISSING). */
  effective: ContextValue<T>;
  state: 'RESOLVED' | 'MISSING' | 'CONFLICT_REQUIRES_RESOLUTION';
}

export type MissingInformationCode =
  | 'PROGRAMME_UNMAPPED'
  | 'CLASS_WITHOUT_CURRICULUM'
  | 'CLASS_WITHOUT_SUBJECT'
  | 'GRADE_WITHOUT_PROGRAMME'
  | 'ACADEMIC_YEAR_MISSING'
  | 'GRADE_LEVEL_MISSING'
  | 'LEVEL_MISSING'
  | 'ENROLLMENT_PENDING';

export interface MissingInformation {
  code: MissingInformationCode;
  institutionId: string;
  scope: { classId?: string; gradeId?: string; institutionCurriculumId?: string };
  /** Who can fix it. The Student is never asked for INSTITUTION-owned information. */
  owner: 'INSTITUTION' | 'STUDENT';
  /** Informational items do not make the context INCOMPLETE. */
  severity: 'BLOCKING' | 'INFO';
  blocks: string[];
}

export interface ContextConflict {
  field: ContextField;
  kind: 'INSTITUTION_VS_STUDENT' | 'INSTITUTION_INTERNAL';
  institutionId: string;
  values: Array<{ value: string | number; provenance: ContextProvenance; sourceRef: string | null }>;
  resolution: 'CONFLICT_REQUIRES_RESOLUTION';
  resolvableBy: Array<'STUDENT' | 'INSTITUTION'>;
}

export interface InstitutionAcademicContext {
  institution: { id: string; name: string; country: string | null };
  programme: LayeredField<{ id: string; label: string }>;
  curricula: Array<{ institutionCurriculumId: string; classId: string; sourceType: string | null; structureVersionId: string | null; programmeId: string | null }>;
  gradeYearStage: {
    gradeLevel: LayeredField<number>;
    /** The institution's own label for the grade ("DP Year 1", "Grado 11"). */
    stage: ContextValue<string>;
    academicYear: LayeredField<string>;
  };
  classes: Array<{
    classId: string;
    name: string;
    gradeId: string | null;
    subject: ContextValue<{ canonicalSubjectId: string; label: string }>;
    academicSubject: ContextValue<{ academicSubjectId: string; label: string }>;
    level: ContextValue<string>;
    institutionCurriculumId: string | null;
  }>;
  subjects: Array<{ canonicalSubjectId: string; label: string; academicSubjectId: string | null; level: string | null; provenance: ContextProvenance; classIds: string[] }>;
  levels: Array<{ academicSubjectId: string; level: string; provenance: ContextProvenance }>;
}

export interface InstitutionalAcademicContext {
  resolverVersion: string;
  status: InstitutionContextStatus;
  confidence: ContextConfidence;
  institutions: InstitutionAcademicContext[];
  pendingInstitutions: Array<{ id: string; name: string }>;
  missingInformation: MissingInformation[];
  conflicts: ContextConflict[];
  /** How many resolved values came from each provenance (shadow summary; no values). */
  provenanceSummary: Partial<Record<ContextProvenance, number>>;
}

// ------------------------------------------------------------------ helpers

const none = <T>(): ContextValue<T> => ({ value: null, provenance: null, sourceRef: null });
const val = <T>(value: T, provenance: ContextProvenance, sourceRef: string | null): ContextValue<T> => ({ value, provenance, sourceRef });
const normText = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/**
 * Grade level of an institutional label. IB stages first (a label such as "DP Year 1"
 * must never read as grade 1), then the country-aware parser shared with eligibility.
 */
export function institutionGradeLevel(label: string | null, country: string | null): number | null {
  const raw = normText(label);
  if (!raw) return null;
  const ib = raw.match(/\b(DP|MYP)\s*(?:year\s*)?(\d)\b/i);
  if (ib) {
    const n = Number(ib[2]);
    if (ib[1].toUpperCase() === 'DP') return n >= 1 && n <= 2 ? 10 + n : null;
    return n >= 1 && n <= 5 ? 5 + n : null;
  }
  return normaliseGradeLevel({ countryOfStudy: country && COUNTRY_CODE.test(country) ? country.toUpperCase() : null, schoolYear: raw });
}

function layered<T>(
  field: ContextField,
  institutionId: string,
  candidates: Array<ContextValue<T> & { value: T }>,
  student: ContextValue<T>,
  key: (v: T) => string | number,
  conflicts: ContextConflict[],
  compareStudent: boolean
): LayeredField<T> {
  const distinct = new Map<string | number, ContextValue<T> & { value: T }>();
  for (const c of candidates) if (!distinct.has(key(c.value))) distinct.set(key(c.value), c);
  if (distinct.size > 1) {
    conflicts.push({
      field,
      kind: 'INSTITUTION_INTERNAL',
      institutionId,
      values: [...distinct.values()].map((c) => ({ value: key(c.value), provenance: c.provenance!, sourceRef: c.sourceRef })),
      resolution: 'CONFLICT_REQUIRES_RESOLUTION',
      resolvableBy: ['INSTITUTION'],
    });
    return { institutional: none(), student, effective: none(), state: 'CONFLICT_REQUIRES_RESOLUTION' };
  }
  const institutional: ContextValue<T> = distinct.size === 1 ? [...distinct.values()][0] : none();
  if (institutional.value === null) {
    // The institution does not know: a Student value serves Student-owned uses only.
    return { institutional, student, effective: student.value !== null ? student : none(), state: 'MISSING' };
  }
  if (compareStudent && student.value !== null) {
    if (key(student.value) !== key(institutional.value)) {
      conflicts.push({
        field,
        kind: 'INSTITUTION_VS_STUDENT',
        institutionId,
        values: [
          { value: key(institutional.value), provenance: institutional.provenance!, sourceRef: institutional.sourceRef },
          { value: key(student.value), provenance: student.provenance!, sourceRef: null },
        ],
        resolution: 'CONFLICT_REQUIRES_RESOLUTION',
        resolvableBy: ['STUDENT', 'INSTITUTION'],
      });
      return { institutional, student, effective: none(), state: 'CONFLICT_REQUIRES_RESOLUTION' };
    }
    // Same value: the Student confirms the institutional fact; the value stays the institution's.
    return { institutional, student, effective: { ...institutional, provenance: 'STUDENT_CONFIRMED' }, state: 'RESOLVED' };
  }
  return { institutional, student, effective: institutional, state: 'RESOLVED' };
}

// ------------------------------------------------------------------ resolver

export function resolveInstitutionalAcademicContext(facts: InstitutionalContextFacts): InstitutionalAcademicContext {
  const sorted = [...facts.enrollments].sort((a, b) => a.institution.id.localeCompare(b.institution.id) || a.class.id.localeCompare(b.class.id));
  const active = sorted.filter((e) => e.enrollmentStatus === 'ACTIVE');
  const pending = sorted.filter((e) => e.enrollmentStatus === 'PENDING');
  const missingInformation: MissingInformation[] = [];
  const conflicts: ContextConflict[] = [];
  const pendingInstitutions = [...new Map(pending.filter((p) => !active.some((a) => a.institution.id === p.institution.id)).map((p) => [p.institution.id, { id: p.institution.id, name: p.institution.name }])).values()];
  for (const p of pending) missingInformation.push({ code: 'ENROLLMENT_PENDING', institutionId: p.institution.id, scope: { classId: p.class.id }, owner: 'STUDENT', severity: 'INFO', blocks: [] });

  const s = facts.student;
  const studentProgramme: ContextValue<{ id: string; label: string }> = s?.programme ? val(s.programme, 'STUDENT_ENTERED', null) : none();
  const studentGrade: ContextValue<number> = s?.gradeLevel != null ? val(s.gradeLevel, 'STUDENT_ENTERED', null) : none();
  const studentYear: ContextValue<string> = s?.academicYear ? val(normText(s.academicYear), 'STUDENT_ENTERED', null) : none();

  const byInstitution = new Map<string, InstitutionalEnrollmentFact[]>();
  for (const e of active) {
    if (!byInstitution.has(e.institution.id)) byInstitution.set(e.institution.id, []);
    byInstitution.get(e.institution.id)!.push(e);
  }
  // The Student's own declaration is compared with the institution only when exactly one institution
  // defines the Student's programme / grade (two institutions may legitimately differ in scope).
  const compareStudent = byInstitution.size === 1;

  const institutions: InstitutionAcademicContext[] = [];
  for (const [institutionId, rows] of byInstitution) {
    const inst = rows[0].institution;
    const miss = (code: MissingInformationCode, scope: MissingInformation['scope'], blocks: string[], severity: MissingInformation['severity'] = 'BLOCKING') =>
      missingInformation.push({ code, institutionId, scope, owner: 'INSTITUTION', severity, blocks });

    // programme: class curriculum (CURRICULUM_DERIVED) and grade (INSTITUTION_ASSIGNED) -- both institutional.
    const programmeCandidates: Array<ContextValue<{ id: string; label: string }> & { value: { id: string; label: string } }> = [];
    const grades = new Map<string, NonNullable<InstitutionalEnrollmentFact['grade']>>();
    for (const r of rows) {
      if (r.curriculum?.programme) programmeCandidates.push({ value: r.curriculum.programme, provenance: 'CURRICULUM_DERIVED', sourceRef: r.curriculum.id });
      if (r.grade) grades.set(r.grade.id, r.grade);
    }
    for (const g of grades.values()) if (g.programme) programmeCandidates.push({ value: g.programme, provenance: 'INSTITUTION_ASSIGNED', sourceRef: g.id });
    const programme = layered('programme', institutionId, programmeCandidates, studentProgramme, (p) => p.id, conflicts, compareStudent);

    // grade level: grade.academic_level (INSTITUTION_ASSIGNED); else the grade name (SYSTEM_INFERRED, never authoritative).
    const gradeCandidates: Array<ContextValue<number> & { value: number }> = [];
    let inferredGrade: ContextValue<number> = none();
    let stage: ContextValue<string> = none();
    for (const g of [...grades.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const assigned = institutionGradeLevel(g.academicLevel, inst.country);
      if (assigned !== null) gradeCandidates.push({ value: assigned, provenance: 'INSTITUTION_ASSIGNED', sourceRef: g.id });
      else if (inferredGrade.value === null) {
        const inferred = institutionGradeLevel(g.name, inst.country);
        if (inferred !== null) inferredGrade = val(inferred, 'SYSTEM_INFERRED', g.id);
      }
      if (stage.value === null && normText(g.academicLevel || g.name)) stage = val(normText(g.academicLevel || g.name), 'INSTITUTION_ASSIGNED', g.id);
    }
    const gradeLevel = layered('gradeLevel', institutionId, gradeCandidates, studentGrade, (n) => n, conflicts, compareStudent);
    if (gradeLevel.state === 'MISSING' && inferredGrade.value !== null && gradeLevel.student.value === null) {
      // Shown for confirmation only: an inferred number is never the institution's fact.
      gradeLevel.effective = inferredGrade;
    }

    // academic year: grade (INSTITUTION_ASSIGNED), curriculum (CURRICULUM_DERIVED), class period (CLASS_DERIVED) -- first institutional source by precedence.
    const yearByPrecedence = [
      ...[...grades.values()].filter((g) => normText(g.academicYear)).map((g) => val(normText(g.academicYear), 'INSTITUTION_ASSIGNED', g.id)),
      ...rows.filter((r) => normText(r.curriculum?.academicYear)).map((r) => val(normText(r.curriculum!.academicYear), 'CURRICULUM_DERIVED', r.curriculum!.id)),
      ...rows.filter((r) => normText(r.class.period)).map((r) => val(normText(r.class.period), 'CLASS_DERIVED', r.class.id)),
    ] as Array<ContextValue<string> & { value: string }>;
    const topYearProvenance = yearByPrecedence[0]?.provenance ?? null;
    // Academic-year text is free-form on both sides ("2026" vs "2026-2027"): it is never compared with the Student's.
    const academicYear = layered('academicYear', institutionId, yearByPrecedence.filter((y) => y.provenance === topYearProvenance), studentYear, (y) => y.toLowerCase(), conflicts, false);

    // classes / subjects / levels
    const classes: InstitutionAcademicContext['classes'] = [];
    const subjects = new Map<string, InstitutionAcademicContext['subjects'][number]>();
    const levels: InstitutionAcademicContext['levels'] = [];
    const curricula: InstitutionAcademicContext['curricula'] = [];
    for (const r of rows) {
      const c = r.curriculum;
      if (c) curricula.push({ institutionCurriculumId: c.id, classId: r.class.id, sourceType: c.sourceType, structureVersionId: c.structureVersionId, programmeId: c.programme?.id ?? null });
      const subject = r.classSubject ? val(r.classSubject, 'CLASS_DERIVED', r.class.id) : none<{ canonicalSubjectId: string; label: string }>();
      const academicSubject = c?.academicSubject ? val({ academicSubjectId: c.academicSubject.id, label: c.academicSubject.label }, 'CURRICULUM_DERIVED', c.id) : none<{ academicSubjectId: string; label: string }>();
      const level = c?.academicSubject?.level ? val(c.academicSubject.level, 'CURRICULUM_DERIVED', c.id) : none<string>();
      classes.push({ classId: r.class.id, name: r.class.name, gradeId: r.grade?.id ?? null, subject, academicSubject, level, institutionCurriculumId: c?.id ?? null });
      if (!r.classSubject) miss('CLASS_WITHOUT_SUBJECT', { classId: r.class.id }, ['SUBJECT']);
      if (!c) miss('CLASS_WITHOUT_CURRICULUM', { classId: r.class.id }, ['PROGRAMME', 'CURRICULUM_STRUCTURE']);
      else if (!c.programme && !grades.get(r.grade?.id ?? '')?.programme) miss('PROGRAMME_UNMAPPED', { classId: r.class.id, institutionCurriculumId: c.id }, ['ELIGIBILITY_BY_CURRICULUM', 'PROGRAMME_SPECIFIC_EXAMS']);
      if (c && c.levelOptionsExist && !c.academicSubject?.level) miss('LEVEL_MISSING', { classId: r.class.id, institutionCurriculumId: c.id }, ['LEVEL_SPECIFIC_EXAMS']);
      if (r.classSubject) {
        const key = r.classSubject.canonicalSubjectId;
        const existing = subjects.get(key);
        if (existing) existing.classIds.push(r.class.id);
        else subjects.set(key, { canonicalSubjectId: key, label: r.classSubject.label, academicSubjectId: c?.academicSubject?.id ?? null, level: c?.academicSubject?.level ?? null, provenance: c?.academicSubject ? 'CURRICULUM_DERIVED' : 'CLASS_DERIVED', classIds: [r.class.id] });
      }
      if (c?.academicSubject?.level && !levels.some((l) => l.academicSubjectId === c.academicSubject!.id)) levels.push({ academicSubjectId: c.academicSubject.id, level: c.academicSubject.level, provenance: 'CURRICULUM_DERIVED' });
    }
    for (const g of grades.values()) {
      if (!g.programme && programme.state === 'RESOLVED') miss('GRADE_WITHOUT_PROGRAMME', { gradeId: g.id }, [], 'INFO');
    }
    if (gradeLevel.state === 'MISSING') miss('GRADE_LEVEL_MISSING', grades.size ? { gradeId: [...grades.keys()].sort()[0] } : {}, ['ELIGIBILITY_BY_GRADE', 'SESSION_YEAR']);
    if (academicYear.state === 'MISSING') miss('ACADEMIC_YEAR_MISSING', grades.size ? { gradeId: [...grades.keys()].sort()[0] } : {}, ['SESSION_YEAR']);

    institutions.push({
      institution: inst,
      programme,
      curricula,
      gradeYearStage: { gradeLevel, stage, academicYear },
      classes,
      subjects: [...subjects.values()].sort((a, b) => a.canonicalSubjectId.localeCompare(b.canonicalSubjectId)),
      levels: levels.sort((a, b) => a.academicSubjectId.localeCompare(b.academicSubjectId)),
    });
  }

  // status
  const blocking = missingInformation.filter((m) => m.severity === 'BLOCKING');
  const status: InstitutionContextStatus =
    institutions.length === 0 ? (pending.length ? 'PENDING_ENROLLMENT' : 'NOT_AFFILIATED') : conflicts.length ? 'CONFLICT' : blocking.length ? 'INCOMPLETE' : 'COMPLETE';

  // confidence (design J1 §3.1)
  let confidence: ContextConfidence = 'NONE';
  if (institutions.length) {
    const programmeKnown = institutions.every((i) => i.programme.state === 'RESOLVED');
    const gradeAssigned = institutions.every((i) => i.gradeYearStage.gradeLevel.state === 'RESOLVED');
    const allAcademicSubjects = institutions.every((i) => i.classes.every((c) => c.academicSubject.value !== null));
    if (conflicts.length) confidence = 'LOW';
    else if (programmeKnown && gradeAssigned && allAcademicSubjects) confidence = 'HIGH';
    else if (programmeKnown) confidence = 'MEDIUM';
    else confidence = 'LOW';
  }

  // provenance summary over resolved (effective) values
  const provenanceSummary: Partial<Record<ContextProvenance, number>> = {};
  const count = (p: ContextProvenance | null) => {
    if (p) provenanceSummary[p] = (provenanceSummary[p] ?? 0) + 1;
  };
  for (const i of institutions) {
    count(i.programme.effective.provenance);
    count(i.gradeYearStage.gradeLevel.effective.provenance);
    count(i.gradeYearStage.academicYear.effective.provenance);
    for (const c of i.classes) {
      count(c.subject.provenance);
      count(c.academicSubject.provenance);
      count(c.level.provenance);
    }
  }

  return {
    resolverVersion: INSTITUTIONAL_CONTEXT_RESOLVER_VERSION,
    status,
    confidence,
    institutions,
    pendingInstitutions,
    missingInformation,
    conflicts,
    provenanceSummary,
  };
}

/** The short form the journey consumes (no names, no values): what is known, what is missing, what conflicts. */
export interface InstitutionalContextSummary {
  status: InstitutionContextStatus;
  confidence: ContextConfidence;
  /** At least one active class with a known subject: the institution defines the Student's academic path. */
  definesAcademicPath: boolean;
  missing: Array<{ code: MissingInformationCode; owner: 'INSTITUTION' | 'STUDENT'; severity: 'BLOCKING' | 'INFO' }>;
  /** Fields whose institutional value is missing (blocking) -- a target depending on them cannot derive them. */
  missingFields: ContextField[];
  conflicts: Array<{ field: ContextField; kind: ContextConflict['kind'] }>;
  provenanceSummary: Partial<Record<ContextProvenance, number>>;
}

export function summariseInstitutionalContext(ctx: InstitutionalAcademicContext): InstitutionalContextSummary {
  const missingFields = new Set<ContextField>();
  for (const i of ctx.institutions) {
    if (i.programme.state === 'MISSING') missingFields.add('programme');
    if (i.gradeYearStage.gradeLevel.state === 'MISSING') missingFields.add('gradeLevel');
    if (i.gradeYearStage.academicYear.state === 'MISSING') missingFields.add('academicYear');
  }
  return {
    status: ctx.status,
    confidence: ctx.confidence,
    definesAcademicPath: ctx.institutions.some((i) => i.classes.some((c) => c.subject.value !== null)),
    missing: ctx.missingInformation.map((m) => ({ code: m.code, owner: m.owner, severity: m.severity })),
    missingFields: [...missingFields].sort(),
    conflicts: ctx.conflicts.map((c) => ({ field: c.field, kind: c.kind })),
    provenanceSummary: ctx.provenanceSummary,
  };
}
