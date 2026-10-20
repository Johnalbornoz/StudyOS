/**
 * CAMBRIDGE PILOT -- governed school-subject mapping (pure data, no IO).
 *
 * Product decisions (FINAL PRODUCT-DECISION DELTA, §12-20, operator):
 *   - Pilot scope: Cambridge Primary, Lower Secondary, Checkpoint preparation, IGCSE school subjects.
 *   - English is ESL in Primary, Lower Secondary and IGCSE. IGCSE ESL = 0510 with the Speaking
 *     Endorsement route; it is NEVER converted to 0511.
 *   - 0580 Mathematics: Core AND Extended. 0610 Biology: Core AND Extended. The tier is chosen per preparation.
 *   - School subjects: Primary / Lower Secondary = ESL, Mathematics, Science, Global Perspectives;
 *     IGCSE = ESL (0510), Mathematics (0580), Biology (0610), Global Perspectives, Lengua Castellana / Spanish,
 *     Computer Science, Entrepreneurship.
 *
 * Provenance of every code and version (nothing here is invented):
 *   CATALOG              -- the code catalogue (catalog/structure.ts) with registered sources (0580: v3, 2025-2027).
 *   CHECKPOINT_CONTRACT  -- checkpoint/checkpoint-preparation.ts (public Checkpoint framework codes).
 *   OPERATOR_NAMED       -- a code the operator named in the decision (0510, 0610). Its syllabus VERSION is not
 *                           governed anywhere in StudyUs, so it carries no version: resolution returns an explicit
 *                           VERSION_NOT_GOVERNED blocker until a reviewed version entry (with a registered source)
 *                           is added here.
 * A school subject with no governed code is a MAPPING_GAP (NO_GOVERNED_CODE) -- never a guessed code.
 *
 * Every change here is a reviewed data change (bump CAMBRIDGE_SCHOOL_MAP_VERSION).
 */
import { ASSESSMENT_CATALOG, flattenCatalog, type CatalogNode } from '../catalog/structure';
import { CHECKPOINT_SUBJECT_OPTIONS, type CheckpointLevel, type CheckpointSubject } from '../checkpoint/checkpoint-preparation';

export const CAMBRIDGE_SCHOOL_MAP_VERSION = '2026-10-17.1';
export const CAMBRIDGE_SCHOOL_DECISION_IDS = ['FD-CAMBRIDGE-SCOPE-§12', 'FD-CAMBRIDGE-ESL-0510-§13', 'FD-CAMBRIDGE-TIERS-§14-15', 'FD-CAMBRIDGE-CREATION-FLOW-§16-18', 'FD-CAMBRIDGE-SCHOOL-SUBJECTS-§19', 'FD-CAMBRIDGE-CHECKPOINT-FIDELITY-§20'] as const;

export type CambridgeProgramme = 'PRIMARY_CHECKPOINT' | 'LOWER_SECONDARY_CHECKPOINT' | 'IGCSE';
export type SchoolSubject = 'ESL' | 'MATHEMATICS' | 'SCIENCE' | 'GLOBAL_PERSPECTIVES' | 'BIOLOGY' | 'SPANISH' | 'COMPUTER_SCIENCE' | 'ENTREPRENEURSHIP';
export type CambridgeTier = 'CORE' | 'EXTENDED';
export type CambridgeRoute = 'SPEAKING_ENDORSEMENT';
/** Declared supply (the runtime capability of a preparation is still computed from the persisted catalogue). */
export type SupplyStatus = 'READY' | 'STRUCTURE_ONLY' | 'CATALOGUE_ONLY' | 'NONE';
export type AssessmentKind = 'WRITTEN_EXAM' | 'TEAM_PROJECT' | 'INDIVIDUAL_REPORT';
export type CodeProvenance = 'CATALOG' | 'CHECKPOINT_CONTRACT' | 'OPERATOR_NAMED';

export interface GovernedSyllabusVersion {
  version: string;
  firstExamYear: number;
  lastExamYear: number;
  sourceKeys: readonly string[];
}

export interface SyllabusMapping {
  syllabusCode: string;
  tier: CambridgeTier | null;
  route: CambridgeRoute | null;
  assessmentKind: AssessmentKind;
  /** The catalogue preparation objective (null: no catalogue entry -- not creatable). */
  objectiveKey: string | null;
  /** Governed versions (empty = VERSION_NOT_GOVERNED for every year). */
  versions: readonly GovernedSyllabusVersion[];
  supply: SupplyStatus;
  codeProvenance: CodeProvenance;
  /** Codes this mapping must never be converted into (0510 is never 0511). */
  neverCodes?: readonly string[];
}

export type MappingGapCode = 'NO_GOVERNED_CODE' | 'VERSION_NOT_GOVERNED' | 'NOT_IN_CATALOGUE' | 'SCHOOL_CONFIRMATION_REQUIRED' | 'NO_SUPPLY';
export interface MappingGap { code: MappingGapCode; missing: string }

export interface SchoolSubjectEntry {
  programme: CambridgeProgramme;
  subject: SchoolSubject;
  label: { es: string; en: string };
  mappings: readonly SyllabusMapping[];
  /** Explicit gaps (what is missing for this programme x subject). */
  gaps: readonly MappingGap[];
}

export const PROGRAMME_LABELS: Record<CambridgeProgramme, { es: string; en: string }> = {
  PRIMARY_CHECKPOINT: { es: 'Cambridge Primary · preparación Checkpoint', en: 'Cambridge Primary · Checkpoint preparation' },
  LOWER_SECONDARY_CHECKPOINT: { es: 'Cambridge Lower Secondary · preparación Checkpoint', en: 'Cambridge Lower Secondary · Checkpoint preparation' },
  IGCSE: { es: 'Cambridge IGCSE', en: 'Cambridge IGCSE' },
};
export const CAMBRIDGE_PROGRAMMES: readonly CambridgeProgramme[] = ['PRIMARY_CHECKPOINT', 'LOWER_SECONDARY_CHECKPOINT', 'IGCSE'];

/** The checkpoint level of a Checkpoint programme (null for IGCSE). */
export const CHECKPOINT_LEVEL_OF: Record<CambridgeProgramme, CheckpointLevel | null> = { PRIMARY_CHECKPOINT: 'PRIMARY', LOWER_SECONDARY_CHECKPOINT: 'LOWER_SECONDARY', IGCSE: null };

const SUBJECT_LABELS: Record<SchoolSubject, { es: string; en: string }> = {
  ESL: { es: 'Inglés como segunda lengua (ESL)', en: 'English as a Second Language' },
  MATHEMATICS: { es: 'Matemáticas', en: 'Mathematics' },
  SCIENCE: { es: 'Ciencias', en: 'Science' },
  GLOBAL_PERSPECTIVES: { es: 'Global Perspectives', en: 'Global Perspectives' },
  BIOLOGY: { es: 'Biología', en: 'Biology' },
  SPANISH: { es: 'Lengua Castellana / Español', en: 'Lengua Castellana / Spanish' },
  COMPUTER_SCIENCE: { es: 'Ciencias de la Computación', en: 'Computer Science' },
  ENTREPRENEURSHIP: { es: 'Emprendimiento', en: 'Entrepreneurship' },
};

// ---------------------------------------------------------------- governed versions from the catalogue

const CATALOG_NODES: ReadonlyMap<string, CatalogNode> = new Map(flattenCatalog(ASSESSMENT_CATALOG).map((f) => [f.node.key, f.node]));

/** The version a catalogue SUBJECT node governs (frameworkVersion + first/last assessment + sources), or none. */
export function catalogGovernedVersions(subjectNodeKey: string, nodes: ReadonlyMap<string, CatalogNode> = CATALOG_NODES): GovernedSyllabusVersion[] {
  const n = nodes.get(subjectNodeKey);
  if (!n || !n.frameworkVersion || !n.firstAssessment || !n.lastAssessment || !(n.sourceKeys?.length)) return [];
  return [{ version: n.frameworkVersion, firstExamYear: n.firstAssessment, lastExamYear: n.lastAssessment, sourceKeys: [...n.sourceKeys] }];
}

// ---------------------------------------------------------------- Checkpoint (Primary / Lower Secondary)

const CHECKPOINT_SUBJECT_OF: Partial<Record<SchoolSubject, CheckpointSubject>> = { ESL: 'ESL', MATHEMATICS: 'MATHEMATICS', SCIENCE: 'SCIENCE', GLOBAL_PERSPECTIVES: 'GLOBAL_PERSPECTIVES' };

function checkpointEntry(programme: 'PRIMARY_CHECKPOINT' | 'LOWER_SECONDARY_CHECKPOINT', subject: SchoolSubject): SchoolSubjectEntry {
  const level = CHECKPOINT_LEVEL_OF[programme]!;
  const option = CHECKPOINT_SUBJECT_OPTIONS.find((o) => o.level === level && o.subject === CHECKPOINT_SUBJECT_OF[subject]);
  if (!option) return { programme, subject, label: SUBJECT_LABELS[subject], mappings: [], gaps: [{ code: 'NO_GOVERNED_CODE', missing: `no Checkpoint framework for ${subject}` }] };
  return {
    programme,
    subject,
    label: SUBJECT_LABELS[subject],
    mappings: [{
      syllabusCode: option.frameworkCode,
      tier: null,
      route: null,
      assessmentKind: option.assessmentKind === 'WRITTEN_TESTS' ? 'WRITTEN_EXAM' : option.assessmentKind,
      objectiveKey: null,
      versions: [],
      supply: 'NONE',
      codeProvenance: 'CHECKPOINT_CONTRACT',
    }],
    gaps: [
      { code: 'VERSION_NOT_GOVERNED', missing: `framework ${option.frameworkCode}: no governed framework version string in StudyUs` },
      { code: 'NOT_IN_CATALOGUE', missing: `no catalogue objective for Checkpoint ${option.frameworkCode}` },
      { code: 'SCHOOL_CONFIRMATION_REQUIRED', missing: 'Checkpoint grade / stage and subjects taken are not confirmed by the school' },
      { code: 'NO_SUPPLY', missing: 'no Checkpoint preparation supply (blocked until the school route is confirmed)' },
    ],
  };
}

// ---------------------------------------------------------------- IGCSE

const noCode = (subject: SchoolSubject, missing: string): SchoolSubjectEntry => ({ programme: 'IGCSE', subject, label: SUBJECT_LABELS[subject], mappings: [], gaps: [{ code: 'NO_GOVERNED_CODE', missing }] });

const IGCSE_ENTRIES: SchoolSubjectEntry[] = [
  {
    programme: 'IGCSE',
    subject: 'ESL',
    label: SUBJECT_LABELS.ESL,
    mappings: [{ syllabusCode: '0510', tier: null, route: 'SPEAKING_ENDORSEMENT', assessmentKind: 'WRITTEN_EXAM', objectiveKey: 'cie.igcse.0510.speaking-endorsement', versions: [], supply: 'NONE', codeProvenance: 'OPERATOR_NAMED', neverCodes: ['0511'] }],
    gaps: [
      { code: 'VERSION_NOT_GOVERNED', missing: '0510: no governed syllabus version (needs a registered syllabus source + version window)' },
      { code: 'NO_SUPPLY', missing: '0510: no Exam Bank supply, no blueprint' },
    ],
  },
  {
    programme: 'IGCSE',
    subject: 'MATHEMATICS',
    label: SUBJECT_LABELS.MATHEMATICS,
    mappings: [
      { syllabusCode: '0580', tier: 'CORE', route: null, assessmentKind: 'WRITTEN_EXAM', objectiveKey: 'cie.igcse.0580.core', versions: catalogGovernedVersions('cie.igcse.0580'), supply: 'CATALOGUE_ONLY', codeProvenance: 'CATALOG' },
      { syllabusCode: '0580', tier: 'EXTENDED', route: null, assessmentKind: 'WRITTEN_EXAM', objectiveKey: 'cie.igcse.0580.extended', versions: catalogGovernedVersions('cie.igcse.0580'), supply: 'STRUCTURE_ONLY', codeProvenance: 'CATALOG' },
    ],
    gaps: [
      { code: 'NO_SUPPLY', missing: '0580 Core: no configured vertical / Exam Bank supply (catalogue only)' },
      { code: 'NO_SUPPLY', missing: '0580 Extended: DEV fixtures only, Readiness Engine NOT_READY (P2, P4); 0 concept mappings' },
    ],
  },
  {
    programme: 'IGCSE',
    subject: 'BIOLOGY',
    label: SUBJECT_LABELS.BIOLOGY,
    mappings: [
      { syllabusCode: '0610', tier: 'CORE', route: null, assessmentKind: 'WRITTEN_EXAM', objectiveKey: 'cie.igcse.0610.core', versions: [], supply: 'NONE', codeProvenance: 'OPERATOR_NAMED' },
      { syllabusCode: '0610', tier: 'EXTENDED', route: null, assessmentKind: 'WRITTEN_EXAM', objectiveKey: 'cie.igcse.0610.extended', versions: [], supply: 'NONE', codeProvenance: 'OPERATOR_NAMED' },
    ],
    gaps: [
      { code: 'VERSION_NOT_GOVERNED', missing: '0610: no governed syllabus version (needs a registered syllabus source + version window)' },
      { code: 'NO_SUPPLY', missing: '0610: no papers in the catalogue, no blueprint, no Exam Bank supply' },
    ],
  },
  noCode('GLOBAL_PERSPECTIVES', 'IGCSE Global Perspectives: no governed syllabus code in StudyUs (school does not state one; not named by the operator)'),
  noCode('SPANISH', 'IGCSE Lengua Castellana / Spanish: no governed syllabus code (school variant unresolved; not named by the operator)'),
  noCode('COMPUTER_SCIENCE', 'IGCSE Computer Science: no governed syllabus code (school variant unresolved; not named by the operator)'),
  noCode('ENTREPRENEURSHIP', 'IGCSE Entrepreneurship: no governed syllabus code (Cambridge equivalent unresolved; not named by the operator)'),
];

const CHECKPOINT_SCHOOL_SUBJECTS: readonly SchoolSubject[] = ['ESL', 'MATHEMATICS', 'SCIENCE', 'GLOBAL_PERSPECTIVES'];

/** The governed mapping table: programme x school subject -> syllabus mappings + explicit gaps. */
export const CAMBRIDGE_SCHOOL_SUBJECT_MAP: readonly SchoolSubjectEntry[] = [
  ...CHECKPOINT_SCHOOL_SUBJECTS.map((s) => checkpointEntry('PRIMARY_CHECKPOINT', s)),
  ...CHECKPOINT_SCHOOL_SUBJECTS.map((s) => checkpointEntry('LOWER_SECONDARY_CHECKPOINT', s)),
  ...IGCSE_ENTRIES,
];

export function schoolSubjectEntry(programme: CambridgeProgramme, subject: SchoolSubject, map: readonly SchoolSubjectEntry[] = CAMBRIDGE_SCHOOL_SUBJECT_MAP): SchoolSubjectEntry | null {
  return map.find((e) => e.programme === programme && e.subject === subject) ?? null;
}

/** Every catalogue objective that belongs to the Cambridge school flow (created only through it). */
export function cambridgeFlowObjectiveKeys(map: readonly SchoolSubjectEntry[] = CAMBRIDGE_SCHOOL_SUBJECT_MAP): string[] {
  return [...new Set(map.flatMap((e) => e.mappings.map((m) => m.objectiveKey)).filter((k): k is string => !!k))];
}

/** Which activities a mapping may ever offer: a project / report subject (Global Perspectives) is never a written / MCQ mock. */
export function allowedActivityKinds(m: Pick<SyllabusMapping, 'assessmentKind'>): Array<'PRACTICE' | 'MOCK' | 'PROJECT_PREPARATION' | 'REPORT_PREPARATION'> {
  if (m.assessmentKind === 'TEAM_PROJECT') return ['PROJECT_PREPARATION'];
  if (m.assessmentKind === 'INDIVIDUAL_REPORT') return ['REPORT_PREPARATION'];
  return ['PRACTICE', 'MOCK'];
}
