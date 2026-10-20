/**
 * B0-U -- ARCHITECTURAL fixtures: five curriculum systems and two teaching implementations expressed in the
 * ONE existing curriculum model (rows shaped exactly like academic_organizations / academic_programmes /
 * academic_subjects / structure_versions / structure_nodes / learning_objectives / objective_*_mappings).
 *
 * They prove shape, not content. Labels, codes and descriptions are short ILLUSTRATIVE paraphrases written
 * for these tests: they are not the official text of any syllabus and must never be loaded as seed data.
 * Framework vocabulary (the profiles below) lives here, in configuration -- not in src/lib/curriculum.
 */
import { buildCurriculumScope, type CurriculumScope, type ObjectiveConceptRelation } from '@/lib/curriculum/curriculum-scope';
import { ROOT, type FrameworkOwnership, type FrameworkProfile } from '@/lib/curriculum/curriculum-framework';
import type { ExpectationCapabilityMappings } from '@/lib/curriculum/cross-curriculum';

/* ------------------------------------------------------------------ */
/* The knowledge graph: ONE set of rows, shared by every curriculum     */
/* ------------------------------------------------------------------ */

export const CANONICAL_SUBJECTS = { physics: 'cs-physics', mathematics: 'cs-mathematics' } as const;

export const CONCEPTS = [
  { id: 'cc-force-acceleration', name: 'Force and acceleration', canonical_subject_id: CANONICAL_SUBJECTS.physics },
  { id: 'cc-gravitational-field', name: 'Gravitational field', canonical_subject_id: CANONICAL_SUBJECTS.physics },
  { id: 'cc-momentum', name: 'Momentum', canonical_subject_id: CANONICAL_SUBJECTS.physics },
  { id: 'cc-energy-conservation', name: 'Conservation of energy', canonical_subject_id: CANONICAL_SUBJECTS.physics },
  { id: 'cc-linear-function', name: 'Linear function', canonical_subject_id: CANONICAL_SUBJECTS.mathematics },
] as const;

export const FORCE = 'cc-force-acceleration';
export const GRAVITY = 'cc-gravitational-field';
export const MOMENTUM = 'cc-momentum';
export const ENERGY = 'cc-energy-conservation';
export const LINEAR = 'cc-linear-function';

/** `canonical_concept_prerequisites` rows: [prerequisite, concept]. */
export const PREREQUISITES: ReadonlyArray<readonly [string, string]> = [
  [LINEAR, FORCE],
  [FORCE, MOMENTUM],
  [FORCE, GRAVITY],
];

export const SKILLS = { modelling: 'sk-quantitative-modelling', experiment: 'sk-experimental-inquiry' } as const;
export const COMPETENCIES = { scientific: 'cp-scientific-explanation' } as const;

/* ------------------------------------------------------------------ */
/* Builder                                                              */
/* ------------------------------------------------------------------ */

type NodeRow = readonly [id: string, parent: string | null, type: string, code: string | null, label: string];
type ObjectiveRow = readonly [id: string, node: string, code: string | null, description: string];
type MappingRow = readonly [objective: string, concept: string, relation: ObjectiveConceptRelation];

export interface FrameworkFixture {
  key: string;
  scope: CurriculumScope;
  profile: FrameworkProfile;
  /** academic_organizations.source_type / authority_level / country */
  ownership: FrameworkOwnership;
  authorityLevel: 'NATIONAL' | 'TERRITORIAL' | 'INTERNATIONAL' | null;
  country: string | null;
  /** academic_programmes.grade_min / grade_max */
  gradeRange: { min: number; max: number } | null;
  capabilities: ExpectationCapabilityMappings;
}

function fixture(p: {
  key: string;
  organization: string;
  ownership: FrameworkOwnership;
  authorityLevel: FrameworkFixture['authorityLevel'];
  country: string | null;
  programme: string;
  programmeType?: string;
  gradeRange: FrameworkFixture['gradeRange'];
  qualification: string | null;
  subject: string;
  level?: string | null;
  canonicalSubjectId: string;
  version: string;
  profile: FrameworkProfile;
  nodes: readonly NodeRow[];
  objectives: readonly ObjectiveRow[];
  mappings: readonly MappingRow[];
  skills?: ReadonlyArray<readonly [objective: string, skill: string, relation: ObjectiveConceptRelation]>;
  competencies?: ReadonlyArray<readonly [objective: string, competency: string, relation: ObjectiveConceptRelation]>;
}): FrameworkFixture {
  const scope = buildCurriculumScope(
    {
      organization: { id: `org-${p.key}`, name: p.organization },
      programme: { id: `prog-${p.key}`, name: p.programme, type: p.programmeType ?? 'CURRICULUM' },
      qualification: p.qualification ? { id: `qual-${p.key}`, name: p.qualification } : null,
      subject: { academicSubjectId: `subj-${p.key}`, name: p.subject, level: p.level ?? null, canonicalSubjectId: p.canonicalSubjectId },
      structureVersion: { id: `sv-${p.key}`, label: p.version, status: 'PUBLISHED' },
    },
    {
      nodes: p.nodes.map(([id, parent_id, node_type, code, label], order_index) => ({ id, parent_id, node_type, code, label, order_index })),
      objectives: p.objectives.map(([id, structure_node_id, code, description]) => ({ id, structure_node_id, code, description })),
      mappings: p.mappings.map(([learning_objective_id, canonical_concept_id, relation_type]) => ({ learning_objective_id, canonical_concept_id, relation_type })),
      concepts: CONCEPTS.map((c) => ({ ...c })),
    }
  );
  return {
    key: p.key,
    scope,
    profile: p.profile,
    ownership: p.ownership,
    authorityLevel: p.authorityLevel,
    country: p.country,
    gradeRange: p.gradeRange,
    capabilities: {
      objectiveSkills: (p.skills ?? []).map(([learningObjectiveId, skillId, relationType]) => ({ learningObjectiveId, skillId, relationType })),
      objectiveCompetencies: (p.competencies ?? []).map(([learningObjectiveId, competencyId, relationType]) => ({ learningObjectiveId, competencyId, relationType })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Framework profiles: vocabulary and shape, as configuration           */
/* ------------------------------------------------------------------ */

export const PROFILE_IB_DP: FrameworkProfile = {
  key: 'IB_DP',
  hierarchy: { [ROOT]: ['THEME'], THEME: ['TOPIC'] },
  expectationHosts: ['TOPIC'],
  expectationKinds: [{ nodeType: 'TOPIC', kind: 'IB_UNDERSTANDING' }],
  gradeNodeTypes: [],
  facetNodeTypes: [],
};

export const PROFILE_CAMBRIDGE: FrameworkProfile = {
  key: 'CAMBRIDGE_SYLLABUS',
  hierarchy: { [ROOT]: ['TOPIC'], TOPIC: ['SUBTOPIC'], SUBTOPIC: ['TIER'] },
  expectationHosts: ['TIER'],
  expectationKinds: [{ nodeType: 'TIER', kind: 'CAMBRIDGE_SYLLABUS_STATEMENT' }],
  gradeNodeTypes: [],
  facetNodeTypes: ['TIER'],
};

export const PROFILE_SEP_BASICA: FrameworkProfile = {
  key: 'MX_SEP_BASICA',
  hierarchy: { [ROOT]: ['PHASE'], PHASE: ['GRADE'], GRADE: ['FIELD'], FIELD: ['DISCIPLINE'], DISCIPLINE: ['CONTENT'] },
  expectationHosts: ['CONTENT'],
  expectationKinds: [{ nodeType: 'CONTENT', kind: 'SEP_PDA' }],
  gradeNodeTypes: ['GRADE'],
  facetNodeTypes: ['PHASE'],
};

export const PROFILE_SEP_EMS: FrameworkProfile = {
  key: 'MX_SEP_EMS',
  hierarchy: { [ROOT]: ['SEMESTER'], SEMESTER: ['UAC'] },
  expectationHosts: ['UAC'],
  expectationKinds: [{ nodeType: 'UAC', kind: 'SEP_EMS_PROGRESSION' }],
  gradeNodeTypes: [],
  facetNodeTypes: ['SEMESTER'],
};

export const PROFILE_MEN: FrameworkProfile = {
  key: 'CO_MEN',
  hierarchy: { [ROOT]: ['REFERENT'], REFERENT: ['GRADE_BAND', 'GRADE'], GRADE_BAND: ['STRAND'] },
  expectationHosts: ['STRAND', 'GRADE'],
  expectationKinds: [
    { nodeType: 'REFERENT', code: 'EBC', kind: 'COLOMBIA_EBC' },
    { nodeType: 'REFERENT', code: 'DBA', kind: 'COLOMBIA_DBA' },
  ],
  gradeNodeTypes: ['GRADE_BAND', 'GRADE'],
  facetNodeTypes: ['REFERENT'],
};

/** A school's or provider's own teaching structure. The same model, a different owner. */
export const PROFILE_TEACHING: FrameworkProfile = {
  key: 'TEACHING_IMPLEMENTATION',
  hierarchy: { [ROOT]: ['PERIOD', 'UNIT'], PERIOD: ['UNIT'], UNIT: ['SECTION', 'SESSION', 'PROJECT'], SECTION: ['SESSION'] },
  expectationHosts: ['SESSION', 'PROJECT'],
  expectationKinds: [
    { nodeType: 'SESSION', kind: 'INSTITUTION_OBJECTIVE' },
    { nodeType: 'PROJECT', kind: 'INSTITUTION_OBJECTIVE' },
  ],
  gradeNodeTypes: [],
  facetNodeTypes: ['PERIOD'],
};

/* ------------------------------------------------------------------ */
/* A. IB Diploma Programme -- Physics                                   */
/* ------------------------------------------------------------------ */

export const IB = fixture({
  key: 'ib',
  organization: 'International Baccalaureate',
  ownership: 'INTERNATIONAL_PROGRAMME',
  authorityLevel: 'INTERNATIONAL',
  country: null,
  programme: 'Diploma Programme',
  gradeRange: { min: 11, max: 12 },
  qualification: 'IB Diploma',
  subject: 'Physics',
  level: 'HL',
  canonicalSubjectId: CANONICAL_SUBJECTS.physics,
  version: 'First assessment 2025',
  profile: PROFILE_IB_DP,
  nodes: [
    ['ib-A', null, 'THEME', 'A', 'Space, time and motion'],
    ['ib-A2', 'ib-A', 'TOPIC', 'A.2', 'Forces and momentum'],
    ['ib-D', null, 'THEME', 'D', 'Fields'],
    ['ib-D1', 'ib-D', 'TOPIC', 'D.1', 'Gravitational fields'],
  ],
  objectives: [
    ['ib-lo-force', 'ib-A2', 'A.2-1', 'Relate resultant force to the acceleration of a body'],
    ['ib-lo-momentum', 'ib-A2', 'A.2-2', 'Apply conservation of momentum to interactions'],
    ['ib-lo-gravity', 'ib-D1', 'D.1-1', 'Describe the gravitational field of a point mass'],
  ],
  mappings: [
    ['ib-lo-force', FORCE, 'FULL'],
    ['ib-lo-force', LINEAR, 'PREREQUISITE'],
    ['ib-lo-momentum', MOMENTUM, 'FULL'],
    ['ib-lo-momentum', FORCE, 'SUPPORTING'],
    ['ib-lo-gravity', GRAVITY, 'FULL'],
    ['ib-lo-gravity', FORCE, 'PARTIAL'],
  ],
  skills: [['ib-lo-force', SKILLS.modelling, 'PARTIAL']],
});

/* ------------------------------------------------------------------ */
/* B. Cambridge IGCSE -- Physics                                        */
/* ------------------------------------------------------------------ */

export const CAMBRIDGE = fixture({
  key: 'cam',
  organization: 'Cambridge International',
  ownership: 'INTERNATIONAL_PROGRAMME',
  authorityLevel: 'INTERNATIONAL',
  country: null,
  programme: 'Cambridge Upper Secondary',
  gradeRange: { min: 9, max: 10 },
  qualification: 'IGCSE',
  subject: 'Physics (0625)',
  canonicalSubjectId: CANONICAL_SUBJECTS.physics,
  version: 'Syllabus 2026-2028',
  profile: PROFILE_CAMBRIDGE,
  nodes: [
    ['cam-1', null, 'TOPIC', '1', 'Motion, forces and energy'],
    ['cam-1.5', 'cam-1', 'SUBTOPIC', '1.5', 'Forces'],
    ['cam-1.5-core', 'cam-1.5', 'TIER', 'CORE', 'Core'],
    ['cam-1.5-supp', 'cam-1.5', 'TIER', 'SUPPLEMENT', 'Supplement'],
  ],
  objectives: [
    ['cam-lo-force-core', 'cam-1.5-core', '1.5.1-C', 'State that a resultant force may change the velocity of an object'],
    ['cam-lo-force-supp', 'cam-1.5-supp', '1.5.1-S', 'Use the relation between force, mass and acceleration'],
  ],
  mappings: [
    ['cam-lo-force-core', FORCE, 'PARTIAL'],
    ['cam-lo-force-supp', FORCE, 'FULL'],
    ['cam-lo-force-supp', LINEAR, 'SUPPORTING'],
  ],
  skills: [['cam-lo-force-supp', SKILLS.modelling, 'PARTIAL']],
});

/* ------------------------------------------------------------------ */
/* C. SEP Mexico -- Secundaria                                          */
/* ------------------------------------------------------------------ */

export const SEP_SECUNDARIA = fixture({
  key: 'sep-sec',
  organization: 'Secretaría de Educación Pública (SEP)',
  ownership: 'GOVERNMENT_AUTHORITY',
  authorityLevel: 'NATIONAL',
  country: 'MX',
  programme: 'Educación Secundaria — Plan de Estudio 2022',
  gradeRange: { min: 7, max: 9 },
  qualification: 'Educación Secundaria (1.º–3.º)',
  subject: 'Física',
  canonicalSubjectId: CANONICAL_SUBJECTS.physics,
  version: 'Programa sintético 2022',
  profile: PROFILE_SEP_BASICA,
  nodes: [
    ['sep-f6', null, 'PHASE', '6', 'Fase 6'],
    ['sep-g8', 'sep-f6', 'GRADE', '8', 'Segundo grado'],
    ['sep-campo', 'sep-g8', 'FIELD', 'SPC', 'Saberes y Pensamiento Científico'],
    ['sep-fis', 'sep-campo', 'DISCIPLINE', 'FIS', 'Física'],
    ['sep-cont', 'sep-fis', 'CONTENT', null, 'Interacciones y fuerzas'],
  ],
  objectives: [['sep-pda-force', 'sep-cont', null, 'Explica cambios en el movimiento a partir de las fuerzas que actúan']],
  mappings: [['sep-pda-force', FORCE, 'FULL']],
  skills: [['sep-pda-force', SKILLS.experiment, 'PARTIAL']],
  competencies: [['sep-pda-force', COMPETENCIES.scientific, 'PARTIAL']],
});

/* ------------------------------------------------------------------ */
/* D. SEP Mexico -- Educación Media Superior                            */
/* ------------------------------------------------------------------ */

export const SEP_EMS = fixture({
  key: 'sep-ems',
  organization: 'Secretaría de Educación Pública (SEP)',
  ownership: 'GOVERNMENT_AUTHORITY',
  authorityLevel: 'NATIONAL',
  country: 'MX',
  programme: 'Educación Media Superior — Marco Curricular Común (MCCEMS)',
  gradeRange: { min: 10, max: 12 },
  qualification: 'Bachillerato general',
  subject: 'Ciencias naturales, experimentales y tecnología',
  canonicalSubjectId: CANONICAL_SUBJECTS.physics,
  version: 'MCCEMS 2023',
  profile: PROFILE_SEP_EMS,
  nodes: [
    ['ems-s3', null, 'SEMESTER', '3', 'Tercer semestre'],
    ['ems-uac', 'ems-s3', 'UAC', 'UAC-3', 'La energía en los procesos de la vida diaria'],
  ],
  objectives: [
    ['ems-prog-1', 'ems-uac', 'P1', 'Reconoce que las fuerzas modifican el estado de movimiento'],
    ['ems-prog-2', 'ems-uac', 'P2', 'Explica transformaciones usando la conservación de la energía'],
  ],
  mappings: [
    ['ems-prog-1', FORCE, 'FULL'],
    ['ems-prog-2', ENERGY, 'FULL'],
    ['ems-prog-2', FORCE, 'PREREQUISITE'],
  ],
  competencies: [['ems-prog-2', COMPETENCIES.scientific, 'PARTIAL']],
});

/* ------------------------------------------------------------------ */
/* E. MEN Colombia -- two referents, a grade band and a grade           */
/* ------------------------------------------------------------------ */

export const MEN = fixture({
  key: 'men',
  organization: 'Ministerio de Educación Nacional (MEN)',
  ownership: 'GOVERNMENT_AUTHORITY',
  authorityLevel: 'NATIONAL',
  country: 'CO',
  programme: 'Educación Básica Secundaria (6.º–9.º)',
  gradeRange: { min: 6, max: 9 },
  qualification: null,
  subject: 'Ciencias Naturales',
  canonicalSubjectId: CANONICAL_SUBJECTS.physics,
  version: 'EBC 2006 · DBA v1 2016',
  profile: PROFILE_MEN,
  nodes: [
    ['men-ebc', null, 'REFERENT', 'EBC', 'Estándares Básicos de Competencias'],
    ['men-ebc-89', 'men-ebc', 'GRADE_BAND', '8-9', 'Octavo a noveno'],
    ['men-ebc-fis', 'men-ebc-89', 'STRAND', 'EF', 'Entorno físico'],
    ['men-dba', null, 'REFERENT', 'DBA', 'Derechos Básicos de Aprendizaje'],
    ['men-dba-8', 'men-dba', 'GRADE', '8', 'Grado octavo'],
  ],
  objectives: [
    ['men-ebc-force', 'men-ebc-fis', null, 'Relaciono fuerzas con cambios en el movimiento de los cuerpos'],
    ['men-dba-force', 'men-dba-8', 'DBA-8.1', 'Comprende que una fuerza neta produce aceleración'],
  ],
  mappings: [
    ['men-ebc-force', FORCE, 'PARTIAL'],
    ['men-dba-force', FORCE, 'FULL'],
  ],
  competencies: [['men-ebc-force', COMPETENCIES.scientific, 'PARTIAL']],
});

export const OFFICIAL_FRAMEWORKS = [IB, CAMBRIDGE, SEP_SECUNDARIA, SEP_EMS, MEN] as const;

/* ------------------------------------------------------------------ */
/* Teaching implementations (not official curricula)                    */
/* ------------------------------------------------------------------ */

/** A content provider's IB Physics course: its own sections and sessions. */
export const PROVIDER_IB_COURSE = fixture({
  key: 'provider-ib',
  organization: 'Demo Content Provider',
  ownership: 'INSTITUTION_DEFINED',
  authorityLevel: null,
  country: null,
  programme: 'Provider course catalogue',
  gradeRange: null,
  qualification: null,
  subject: 'IB Physics course',
  canonicalSubjectId: CANONICAL_SUBJECTS.physics,
  version: '2026 edition',
  profile: PROFILE_TEACHING,
  nodes: [
    ['prov-unit-D', null, 'UNIT', 'D', 'Fields'],
    ['prov-sec-D1', 'prov-unit-D', 'SECTION', 'D1', 'Gravitational fields'],
    ['prov-D1.1', 'prov-sec-D1', 'SESSION', 'D1.1', "Newton's law of gravitation"],
    ['prov-D1.2', 'prov-sec-D1', 'SESSION', 'D1.2', 'Field strength and orbits'],
  ],
  objectives: [
    ['prov-lo-D1.1', 'prov-D1.1', 'D1.1', 'Session D1.1 outcomes'],
    ['prov-lo-D1.2', 'prov-D1.2', 'D1.2', 'Session D1.2 outcomes'],
  ],
  mappings: [
    ['prov-lo-D1.1', GRAVITY, 'PARTIAL'],
    ['prov-lo-D1.1', FORCE, 'PREREQUISITE'],
    ['prov-lo-D1.2', GRAVITY, 'FULL'],
    ['prov-lo-D1.2', FORCE, 'PARTIAL'],
    ['prov-lo-D1.2', MOMENTUM, 'PARTIAL'],
  ],
  skills: [['prov-lo-D1.2', SKILLS.modelling, 'PARTIAL']],
});

/** A Colombian school's own plan (its PEI study plan): period, unit, session. */
export const SCHOOL_PLAN = fixture({
  key: 'school-co',
  organization: 'Colegio Demo',
  ownership: 'INSTITUTION_DEFINED',
  authorityLevel: null,
  country: 'CO',
  programme: 'Plan de estudios institucional',
  gradeRange: { min: 8, max: 8 },
  qualification: null,
  subject: 'Ciencias Naturales 8.º',
  canonicalSubjectId: CANONICAL_SUBJECTS.physics,
  version: 'Año lectivo 2026',
  profile: PROFILE_TEACHING,
  nodes: [
    ['sch-p2', null, 'PERIOD', 'P2', 'Segundo periodo'],
    ['sch-u3', 'sch-p2', 'UNIT', 'U3', 'Fuerza y movimiento'],
    ['sch-s1', 'sch-u3', 'SESSION', 'S1', 'Fuerza neta'],
    ['sch-s2', 'sch-u3', 'SESSION', 'S2', 'Laboratorio: carrito y masas'],
  ],
  objectives: [
    ['sch-lo-s1', 'sch-s1', null, 'Identifica la fuerza neta sobre un cuerpo'],
    ['sch-lo-s2', 'sch-s2', null, 'Mide aceleración al variar la fuerza'],
  ],
  mappings: [
    ['sch-lo-s1', FORCE, 'PARTIAL'],
    ['sch-lo-s2', FORCE, 'FULL'],
    ['sch-lo-s2', LINEAR, 'SUPPORTING'],
  ],
  skills: [['sch-lo-s2', SKILLS.experiment, 'FULL']],
});

/**
 * The institution's adoption of the official reference, shaped like the existing rows:
 * `institution_curricula` (base_structure_version_id) + `institution_curriculum_objectives`.
 */
export const SCHOOL_ADOPTION = {
  institutionCurriculum: { id: 'ic-1', institutionId: 'inst-colegio-demo', canonicalSubjectId: CANONICAL_SUBJECTS.physics, baseAcademicSubjectId: MEN.scope.subject.academicSubjectId, baseStructureVersionId: MEN.scope.structureVersion.id, sourceType: 'GOVERNMENT_AUTHORITY', ownerScope: 'INSTITUTION', academicYear: '2026' },
  objectives: [
    { curriculumId: 'ic-1', learningObjectiveId: 'men-dba-force', classification: 'REQUIRED', status: 'INCLUDED' },
    { curriculumId: 'ic-1', learningObjectiveId: 'men-ebc-force', classification: 'RECOMMENDED', status: 'INCLUDED' },
  ],
} as const;
