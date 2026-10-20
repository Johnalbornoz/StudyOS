/**
 * CAMBRIDGE CHECKPOINT PREPARATION -- governance contract (pure, no IO).
 *
 * Operator decisions (2026-10-16):
 *   - CAMBRIDGE_PRIMARY_CHECKPOINT = REQUIRED, CAMBRIDGE_LOWER_CHECKPOINT = REQUIRED: Primary and Lower Secondary get
 *     Exam Prep ONLY for the external Checkpoint the school actually sits -- never generic Exam Prep per year / subject.
 *   - The pilot capability is a StudyUs preparation, never an official Cambridge form:
 *       activity_type = CHECKPOINT_PREPARATION, content_origin = STUDYUS, official_cambridge_form = NO,
 *       official_blueprint_fidelity = UNKNOWN, official_mark_scheme_fidelity = NOT_CLAIMED.
 *   - Licensed specimen / past papers are NOT required; only public, source-backed facts are used: curriculum
 *     frameworks, strands, component codes, durations, the Checkpoint scale, series / administration rules.
 *     Never fabricated: paper titles, maximum marks, mark schemes, specimen content, examiner criteria, question
 *     distributions.
 *   - Global Perspectives (0838 / 1129) is project / report preparation, never a written mock.
 *   - CHECKPOINT_EXACT_VARIANT = SCHOOL_CONFIRMATION_REQUIRED: no variant-specific supply until the school confirms the
 *     grade / stage, English vs ESL, the subjects taken and the exact framework codes.
 *
 * Everything here is invariant across those school choices: every subject OPTION is described, none is chosen.
 */

export const CHECKPOINT_PREPARATION_CONTRACT = {
  activityType: 'CHECKPOINT_PREPARATION',
  contentOrigin: 'STUDYUS',
  officialCambridgeForm: false,
  officialBlueprintFidelity: 'UNKNOWN',
  officialMarkSchemeFidelity: 'NOT_CLAIMED',
  decisionIds: ['CAMBRIDGE-CHECKPOINT-REQUIRED-2026-10-16', 'CAMBRIDGE-CHECKPOINT-PILOT-GOVERNANCE-2026-10-16'],
  humanReviewer: null,
  humanReviewStatus: 'PENDING',
} as const;

export type CheckpointLevel = 'PRIMARY' | 'LOWER_SECONDARY';
export type CheckpointSubject = 'ENGLISH' | 'ESL' | 'MATHEMATICS' | 'SCIENCE' | 'GLOBAL_PERSPECTIVES';
export type CheckpointSeries = 'MARCH' | 'MAY' | 'OCTOBER';

/** A timetabled component, exactly as published: code and duration only (titles and marks are not public). */
export interface CheckpointComponent {
  code: string;
  durationMinutes: number;
  /** Cambridge supplies an audio listening file for this component. */
  listening?: true;
}

export interface CheckpointSubjectOption {
  level: CheckpointLevel;
  subject: CheckpointSubject;
  /** Cambridge curriculum framework code. */
  frameworkCode: string;
  /** End-of-stage the Checkpoint assesses (Cambridge stage, not a school grade). */
  assessesStage: 6 | 9;
  /** WRITTEN_TESTS: timetabled papers; PROJECT / REPORT: teacher-marked, Cambridge-moderated, untimed (GP). */
  assessmentKind: 'WRITTEN_TESTS' | 'TEAM_PROJECT' | 'INDIVIDUAL_REPORT';
  components: readonly CheckpointComponent[];
  series: readonly CheckpointSeries[];
  /** Public strand names, verbatim from the official curriculum page (empty: not captured from an official page). */
  strands: readonly string[];
  /** Mutually exclusive with another option (a learner cannot enter both English and ESL). */
  exclusiveWith?: CheckpointSubject;
  sourceKeys: readonly string[];
}

const ALL_SERIES: readonly CheckpointSeries[] = ['MARCH', 'MAY', 'OCTOBER'];
const GP_SERIES: readonly CheckpointSeries[] = ['MAY', 'OCTOBER'];
const T = ['cie-checkpoint-timetable-2026-10', 'cie-checkpoint-faq', 'cie-checkpoint-changes-2026'];

/** Every Checkpoint subject option (public facts only). None is selected: the school's route is not confirmed. */
export const CHECKPOINT_SUBJECT_OPTIONS: readonly CheckpointSubjectOption[] = [
  { level: 'PRIMARY', subject: 'ENGLISH', frameworkCode: '0058', assessesStage: 6, assessmentKind: 'WRITTEN_TESTS', components: [{ code: '0058/01', durationMinutes: 60 }, { code: '0058/02', durationMinutes: 60 }], series: ALL_SERIES, strands: [], exclusiveWith: 'ESL', sourceKeys: [...T, 'cie-primary-lower-changes'] },
  { level: 'PRIMARY', subject: 'ESL', frameworkCode: '0057', assessesStage: 6, assessmentKind: 'WRITTEN_TESTS', components: [{ code: '0057/01', durationMinutes: 35 }, { code: '0057/02', durationMinutes: 25, listening: true }, { code: '0057/03', durationMinutes: 35 }], series: ALL_SERIES, strands: [], exclusiveWith: 'ENGLISH', sourceKeys: [...T, 'cie-primary-lower-changes'] },
  { level: 'PRIMARY', subject: 'MATHEMATICS', frameworkCode: '0096', assessesStage: 6, assessmentKind: 'WRITTEN_TESTS', components: [{ code: '0096/01', durationMinutes: 45 }, { code: '0096/02', durationMinutes: 45 }], series: ALL_SERIES, strands: ['Number', 'Geometry and Measure', 'Statistics and Probability'], sourceKeys: [...T, 'cie-primary-maths-0096'] },
  { level: 'PRIMARY', subject: 'SCIENCE', frameworkCode: '0097', assessesStage: 6, assessmentKind: 'WRITTEN_TESTS', components: [{ code: '0097/01', durationMinutes: 35 }, { code: '0097/02', durationMinutes: 35 }], series: ALL_SERIES, strands: ['Biology', 'Chemistry', 'Physics', 'Earth and Space', 'Thinking and Working Scientifically', 'Science in Context'], sourceKeys: [...T, 'cie-primary-science-0097'] },
  { level: 'PRIMARY', subject: 'GLOBAL_PERSPECTIVES', frameworkCode: '0838', assessesStage: 6, assessmentKind: 'TEAM_PROJECT', components: [], series: GP_SERIES, strands: [], sourceKeys: ['cie-checkpoint-faq', 'cie-primary-lower-changes', 'cie-primary-gp-checkpoint'] },
  { level: 'LOWER_SECONDARY', subject: 'ENGLISH', frameworkCode: '0861', assessesStage: 9, assessmentKind: 'WRITTEN_TESTS', components: [{ code: '0861/01', durationMinutes: 70 }, { code: '0861/02', durationMinutes: 70 }], series: ALL_SERIES, strands: [], exclusiveWith: 'ESL', sourceKeys: [...T, 'cie-primary-lower-changes'] },
  { level: 'LOWER_SECONDARY', subject: 'ESL', frameworkCode: '0876', assessesStage: 9, assessmentKind: 'WRITTEN_TESTS', components: [{ code: '0876/01', durationMinutes: 45 }, { code: '0876/02', durationMinutes: 35, listening: true }, { code: '0876/03', durationMinutes: 40 }], series: ALL_SERIES, strands: [], exclusiveWith: 'ENGLISH', sourceKeys: [...T, 'cie-primary-lower-changes'] },
  // Strands verbatim from the official page: "three main areas called 'strands'".
  { level: 'LOWER_SECONDARY', subject: 'MATHEMATICS', frameworkCode: '0862', assessesStage: 9, assessmentKind: 'WRITTEN_TESTS', components: [{ code: '0862/01', durationMinutes: 60 }, { code: '0862/02', durationMinutes: 60 }], series: ALL_SERIES, strands: ['Number', 'Algebra, Geometry and Measure', 'Statistics and Probability'], sourceKeys: [...T, 'cie-lower-maths-0862'] },
  { level: 'LOWER_SECONDARY', subject: 'SCIENCE', frameworkCode: '0893', assessesStage: 9, assessmentKind: 'WRITTEN_TESTS', components: [{ code: '0893/01', durationMinutes: 45 }, { code: '0893/02', durationMinutes: 45 }], series: ALL_SERIES, strands: ['Biology', 'Chemistry', 'Physics', 'Earth and Space', 'Thinking and Working Scientifically', 'Science in Context'], sourceKeys: [...T, 'cie-lower-science-0893'] },
  { level: 'LOWER_SECONDARY', subject: 'GLOBAL_PERSPECTIVES', frameworkCode: '1129', assessesStage: 9, assessmentKind: 'INDIVIDUAL_REPORT', components: [], series: GP_SERIES, strands: [], sourceKeys: ['cie-checkpoint-faq', 'cie-primary-lower-changes', 'cie-lower-gp-checkpoint'] },
];

/** The published Checkpoint scale (context only: StudyUs never converts its own results onto it). */
export const CHECKPOINT_OFFICIAL_SCALE = {
  min: 0,
  max: 50,
  since: 'May 2023',
  bands: [
    { label: 'Unclassified', from: 0, to: 0 },
    { label: 'Basic', from: 1, to: 10 },
    { label: 'Aspiring', from: 11, to: 20 },
    { label: 'Good', from: 21, to: 30 },
    { label: 'High', from: 31, to: 40 },
    { label: 'Outstanding', from: 41, to: 50 },
  ],
  excludes: ['GLOBAL_PERSPECTIVES'] as readonly CheckpointSubject[],
  sourceKeys: ['cie-checkpoint-score-bands'],
} as const;

/**
 * How a StudyUs Checkpoint preparation is scored and reported: StudyUs marks and percentage, by public strand.
 * The official score is Rasch-derived from unpublished papers, so no StudyUs result is ever placed on the 0-50 scale,
 * given a band, or called a Checkpoint score.
 */
export const CHECKPOINT_PREPARATION_SCORING = {
  unit: 'STUDYUS_PERCENT',
  reportedBy: 'PUBLIC_STRAND',
  officialScaleConversion: 'NOT_CLAIMED',
  officialBandPrediction: 'NOT_CLAIMED',
  officialMarkScheme: 'NOT_CLAIMED',
} as const;

/** Global Perspectives: project / report preparation phases (formative StudyUs feedback; never a written mock). */
export const CHECKPOINT_GP_PREPARATION = {
  PRIMARY: { assessmentKind: 'TEAM_PROJECT', phases: ['PLANNING', 'RESEARCH_AND_EVIDENCE', 'COLLABORATION', 'WRITTEN_RESPONSE', 'FORMATIVE_FEEDBACK'], writtenMock: false, officialMarking: 'NOT_CLAIMED' },
  LOWER_SECONDARY: { assessmentKind: 'INDIVIDUAL_REPORT', phases: ['PLANNING', 'RESEARCH_AND_EVIDENCE', 'WRITTEN_REPORT', 'FORMATIVE_FEEDBACK'], writtenMock: false, officialMarking: 'NOT_CLAIMED', reportWords: { min: 800, max: 1000 } },
} as const;

// ---------------------------------------------------------------- the school's route (blocked until confirmed)

export type CheckpointBlocker = 'PRIMARY_CHECKPOINT_GRADE' | 'LOWER_CHECKPOINT_GRADE' | 'ENGLISH_FRAMEWORK' | 'SUBJECTS_TAKEN' | 'FRAMEWORK_CODES';

/** What the school has CONFIRMED (null = not confirmed). Evidence that conflicts is not a confirmation. */
export interface CheckpointSchoolRoute {
  schoolKey: string;
  primaryCheckpointGrade: number | null;
  lowerCheckpointGrade: number | null;
  englishFramework: 'ENGLISH' | 'ESL' | null;
  subjectsTaken: readonly CheckpointSubject[] | null;
  frameworkCodesConfirmed: boolean;
  /** What the school's own documents say, kept for the record (never used to decide). */
  evidence: readonly { claim: string; source: string }[];
}

/**
 * José Max León. 2026-10-16: nothing confirmed; its documents conflict on the Checkpoint grades.
 * 2026-10-17 (FINAL PRODUCT-DECISION DELTA §13, operator): English is ESL in Primary and Lower Secondary
 * (0057 / 0876) -- the ENGLISH_FRAMEWORK blocker is resolved by that decision. Grades, subjects taken and the
 * exact framework codes stay SCHOOL_CONFIRMATION_REQUIRED.
 */
export const JOSE_MAX_LEON_CHECKPOINT_ROUTE: CheckpointSchoolRoute = {
  schoolKey: 'co.cota.colegio-bilingue-jose-max-leon',
  primaryCheckpointGrade: null,
  lowerCheckpointGrade: null,
  englishFramework: 'ESL',
  subjectsTaken: null,
  frameworkCodesConfirmed: false,
  evidence: [
    { claim: 'Cronograma 2026-27: "CHECK POINTS 5° Y 8°"', source: 'school PDF Cronograma 26-27 CBJML' },
    { claim: 'Manual 2025-26 table: Checkpoint in 6° and 9° (listed among English certifications)', source: 'school PDF Manual de Convivencia 2025-2026' },
    { claim: 'Primary / Lower Secondary CORE: Science, Mathematics, English, Global Perspectives', source: 'school PDF Manual de Convivencia 2025-2026, art. 57' },
    { claim: 'Booklists use Cambridge Global English (suggests ESL; inference only)', source: 'school booklists 2026-27' },
    { claim: 'English is ESL in Primary, Lower Secondary and IGCSE', source: 'operator decision FD-CAMBRIDGE-ESL-0510-§13 (2026-10-17)' },
  ],
};

export type CheckpointVariantResolution =
  | { status: 'CONFIRMED'; options: readonly CheckpointSubjectOption[] }
  | { status: 'SCHOOL_CONFIRMATION_REQUIRED'; blockers: readonly CheckpointBlocker[] };

/**
 * The exact Checkpoint variant of a school, or the blockers that keep it unresolved. Pure; never chooses by
 * probability: every unconfirmed fact is a blocker.
 */
export function resolveCheckpointVariant(route: CheckpointSchoolRoute): CheckpointVariantResolution {
  const blockers: CheckpointBlocker[] = [];
  if (route.primaryCheckpointGrade === null) blockers.push('PRIMARY_CHECKPOINT_GRADE');
  if (route.lowerCheckpointGrade === null) blockers.push('LOWER_CHECKPOINT_GRADE');
  if (route.englishFramework === null) blockers.push('ENGLISH_FRAMEWORK');
  if (route.subjectsTaken === null || route.subjectsTaken.length === 0) blockers.push('SUBJECTS_TAKEN');
  if (!route.frameworkCodesConfirmed) blockers.push('FRAMEWORK_CODES');
  if (blockers.length) return { status: 'SCHOOL_CONFIRMATION_REQUIRED', blockers };
  const taken = new Set(route.subjectsTaken);
  if (taken.has('ENGLISH') && taken.has('ESL')) return { status: 'SCHOOL_CONFIRMATION_REQUIRED', blockers: ['ENGLISH_FRAMEWORK'] };
  return { status: 'CONFIRMED', options: CHECKPOINT_SUBJECT_OPTIONS.filter((o) => taken.has(o.subject) && (o.subject !== 'ENGLISH' && o.subject !== 'ESL' ? true : o.subject === route.englishFramework)) };
}

/** Variant-specific supply (items, forms, blueprints) is allowed only for a CONFIRMED option of the school's route. */
export function checkpointSupplyAllowed(route: CheckpointSchoolRoute, level: CheckpointLevel, subject: CheckpointSubject): { allowed: boolean; reason: string | null } {
  const r = resolveCheckpointVariant(route);
  if (r.status !== 'CONFIRMED') return { allowed: false, reason: `SCHOOL_CONFIRMATION_REQUIRED:${r.blockers.join(',')}` };
  return r.options.some((o) => o.level === level && o.subject === subject) ? { allowed: true, reason: null } : { allowed: false, reason: 'NOT_IN_SCHOOL_ROUTE' };
}

// ---------------------------------------------------------------- what a preparation spec may NOT contain

/** Fields a Checkpoint preparation spec must never carry (they are not public; inventing them is fabrication). */
export const FORBIDDEN_CHECKPOINT_FIELDS = ['paperTitle', 'maxMarks', 'markScheme', 'specimenContent', 'examinerCriteria', 'officialQuestionDistribution', 'officialScore', 'officialBand'] as const;

export type CheckpointSpecIssue = 'FABRICATED_FIELD' | 'GP_AS_WRITTEN_MOCK' | 'UNKNOWN_COMPONENT' | 'DURATION_MISMATCH' | 'OFFICIAL_FORM_CLAIMED' | 'OFFICIAL_FIDELITY_CLAIMED';

/**
 * Validates a proposed Checkpoint preparation spec against the governance contract (pure). Returns every issue.
 */
export function validateCheckpointPreparationSpec(spec: Record<string, unknown> & { level: CheckpointLevel; subject: CheckpointSubject; mode?: string; components?: readonly { code: string; durationMinutes: number }[] }): CheckpointSpecIssue[] {
  const issues: CheckpointSpecIssue[] = [];
  const walk = (x: unknown): void => {
    if (!x || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if ((FORBIDDEN_CHECKPOINT_FIELDS as readonly string[]).includes(k) && v !== undefined && v !== null) issues.push('FABRICATED_FIELD');
      walk(v);
    }
  };
  walk(spec);
  if (spec.officialCambridgeForm === true) issues.push('OFFICIAL_FORM_CLAIMED');
  if (spec.officialBlueprintFidelity !== undefined && spec.officialBlueprintFidelity !== 'UNKNOWN') issues.push('OFFICIAL_FIDELITY_CLAIMED');
  if (spec.officialMarkSchemeFidelity !== undefined && spec.officialMarkSchemeFidelity !== 'NOT_CLAIMED') issues.push('OFFICIAL_FIDELITY_CLAIMED');
  const option = CHECKPOINT_SUBJECT_OPTIONS.find((o) => o.level === spec.level && o.subject === spec.subject);
  if (spec.subject === 'GLOBAL_PERSPECTIVES' && (spec.mode === 'MOCK' || (spec.components?.length ?? 0) > 0)) issues.push('GP_AS_WRITTEN_MOCK');
  for (const c of spec.components ?? []) {
    const pub = option?.components.find((p) => p.code === c.code);
    if (!pub) issues.push('UNKNOWN_COMPONENT');
    else if (pub.durationMinutes !== c.durationMinutes) issues.push('DURATION_MISMATCH');
  }
  return [...new Set(issues)];
}

// ---------------------------------------------------------------- curriculum mapping invariant across school choices

/**
 * Public strand -> existing StudyUs canonical identity PREFIX (domain level). Only prefixes that already exist in
 * governed StudyUs identities are used; nothing is created. Objective-level mapping needs the framework's learning
 * objectives (the framework documents are not linked publicly on the curriculum pages) and stays a gap. Review PENDING.
 * English / ESL: not mapped (the school's framework is unconfirmed). Science / Global Perspectives: StudyUs has no
 * canonical domain for them -- a gap, never an invented taxonomy.
 */
export interface CheckpointStrandMapping { level: CheckpointLevel; subject: CheckpointSubject; strand: string; canonicalPrefixes: readonly string[]; granularity: 'STRAND_TO_EXISTING_DOMAIN'; review: 'PENDING' }
export interface CheckpointMappingGap { level: CheckpointLevel; subject: CheckpointSubject; strand: string | null; gap: 'NO_CANONICAL_DOMAIN' | 'FRAMEWORK_UNCONFIRMED' | 'OBJECTIVES_NOT_CAPTURED' | 'NOT_A_CONTENT_STRAND' }

const MATH_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  Number: ['math.num'],
  'Geometry and Measure': ['math.geo'],
  'Algebra, Geometry and Measure': ['math.alg', 'math.fun', 'math.geo'],
  'Statistics and Probability': ['math.stat', 'math.prob'],
};

export const CHECKPOINT_STRAND_MAPPINGS: readonly CheckpointStrandMapping[] = CHECKPOINT_SUBJECT_OPTIONS.filter((o) => o.subject === 'MATHEMATICS').flatMap((o) =>
  o.strands.map((strand) => ({ level: o.level, subject: o.subject, strand, canonicalPrefixes: MATH_PREFIXES[strand] ?? [], granularity: 'STRAND_TO_EXISTING_DOMAIN' as const, review: 'PENDING' as const }))
);

export const CHECKPOINT_MAPPING_GAPS: readonly CheckpointMappingGap[] = [
  ...CHECKPOINT_SUBJECT_OPTIONS.filter((o) => o.subject === 'MATHEMATICS').map((o) => ({ level: o.level, subject: o.subject, strand: null, gap: 'OBJECTIVES_NOT_CAPTURED' as const })),
  ...CHECKPOINT_SUBJECT_OPTIONS.filter((o) => o.subject === 'MATHEMATICS').map((o) => ({ level: o.level, subject: o.subject, strand: 'Thinking and Working Mathematically', gap: 'NOT_A_CONTENT_STRAND' as const })),
  ...CHECKPOINT_SUBJECT_OPTIONS.filter((o) => o.subject === 'SCIENCE').flatMap((o) => o.strands.map((strand) => ({ level: o.level, subject: o.subject, strand, gap: 'NO_CANONICAL_DOMAIN' as const }))),
  ...CHECKPOINT_SUBJECT_OPTIONS.filter((o) => o.subject === 'ENGLISH' || o.subject === 'ESL').map((o) => ({ level: o.level, subject: o.subject, strand: null, gap: 'FRAMEWORK_UNCONFIRMED' as const })),
  ...CHECKPOINT_SUBJECT_OPTIONS.filter((o) => o.subject === 'GLOBAL_PERSPECTIVES').map((o) => ({ level: o.level, subject: o.subject, strand: null, gap: 'NO_CANONICAL_DOMAIN' as const })),
];

/** Capability readiness for the school, given the contract (curriculum alignment, structure, scoring, disclosure, supply). */
export type CheckpointCapabilityState = 'CATALOGUE_ONLY' | 'STRUCTURE_ONLY' | 'PARTIAL' | 'READY';
export function checkpointCapabilityState(route: CheckpointSchoolRoute): { primary: CheckpointCapabilityState; lower: CheckpointCapabilityState; blockedBy: readonly CheckpointBlocker[] } {
  const r = resolveCheckpointVariant(route);
  // public structure + scoring + disclosure are governed here; supply cannot exist before the route is confirmed
  const state: CheckpointCapabilityState = 'STRUCTURE_ONLY';
  return { primary: state, lower: state, blockedBy: r.status === 'CONFIRMED' ? [] : r.blockers };
}
