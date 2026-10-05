/**
 * Track A -- base curriculum and curriculum context (read-only).
 *
 * "Curriculum defines what exists and what is advisable to learn." It is
 * DERIVED from the governed, versioned catalog -- never authored here:
 *
 *   academic_subjects → structure_versions (PUBLISHED, versioned)
 *     → structure_nodes (areas) → learning_objectives
 *     → objective_concept_mappings (PUBLISHED) → canonical_concepts
 *
 * A curriculum CONTEXT is one academic subject (e.g. IB DP Mathematics:
 * analysis and approaches, PAA Matemáticas) in its published version. When
 * the learner has no specific programme, the GENERAL StudyUs curriculum is
 * every ACTIVE canonical concept of the subject (catalog-equivalent subjects
 * merged: "Mathematics" = "Matemáticas"), so nobody starts from an empty page.
 *
 * Available curriculum ≠ active plan: nothing here enrolls anything.
 */
import { db } from '@/lib/db';
import { catalogSubjectByName } from '@/lib/experience/subject-catalog';
import { canonicalConceptLabels } from './labels';
import { learnerExamProfiles, resolveExamProfiles } from './exam-profile-resolution';

export interface CurriculumOption {
  academicSubjectId: string;
  structureVersionId: string;
  name: string;
  programme: string;
  /** Catalogue programme of the academic subject (matches the Academic Profile selection). */
  programmeId?: string;
  qualification: string | null;
  level: string | null;
  versionLabel: string;
  conceptCount: number;
}

export interface CurriculumConcept {
  canonicalConceptId: string;
  label: string;
  prerequisiteIds: string[];
  /** position in the curriculum sequence (0-based) */
  order: number;
}

export interface CurriculumArea {
  key: string;
  label: string;
  concepts: CurriculumConcept[];
}

export interface BaseCurriculum {
  catalogKey: string;
  context: CurriculumOption | null;
  areas: CurriculumArea[];
  /** flat, ordered, de-duplicated */
  concepts: CurriculumConcept[];
}

export type ContextReason = 'REQUESTED' | 'EXAM_PROFILE' | 'ACADEMIC_PROFILE' | 'INSTITUTION' | 'GENERAL';

/** The catalog subject key ("mathematics") of a subject / canonical subject name, in any language. */
export function catalogKeyOf(name: string): string | null {
  return catalogSubjectByName(name)?.key ?? null;
}

/** ACTIVE canonical subjects equivalent to a catalog subject key (e.g. Mathematics + Matemáticas). */
export async function canonicalSubjectIdsForCatalogKey(catalogKey: string): Promise<string[]> {
  const r = await db.query(`SELECT id, name FROM canonical_subjects WHERE status = 'ACTIVE'`);
  return r.rows.filter((row: any) => catalogKeyOf(row.name) === catalogKey).map((row: any) => row.id);
}

/** Published curricula (academic subjects) that cover this catalog subject. */
export async function listCurriculumOptions(catalogKey: string): Promise<CurriculumOption[]> {
  const subjectIds = await canonicalSubjectIdsForCatalogKey(catalogKey);
  if (subjectIds.length === 0) return [];
  const r = await db.query(
    `SELECT asub.id AS academic_subject_id, sv.id AS structure_version_id, asub.name, asub.level, ap.name AS programme, aq.name AS qualification, sv.version_label, ap.id AS programme_id,
       COUNT(DISTINCT ocm.canonical_concept_id)::int AS concept_count
     FROM objective_concept_mappings ocm
     JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id AND cc.status = 'ACTIVE'
     JOIN learning_objectives lo ON lo.id = ocm.learning_objective_id AND lo.status = 'ACTIVE'
     JOIN structure_nodes sn ON sn.id = lo.structure_node_id
     JOIN structure_versions sv ON sv.id = sn.structure_version_id AND sv.status = 'PUBLISHED'
     JOIN academic_subjects asub ON asub.id = sv.academic_subject_id
     JOIN academic_programmes ap ON ap.id = asub.programme_id
     LEFT JOIN academic_qualifications aq ON aq.id = asub.qualification_id
     WHERE ocm.status = 'PUBLISHED' AND cc.canonical_subject_id = ANY($1::uuid[])
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
     ORDER BY concept_count DESC, ap.name, asub.name`,
    [subjectIds]
  );
  return r.rows.map((row: any) => ({
    academicSubjectId: row.academic_subject_id,
    structureVersionId: row.structure_version_id,
    name: row.name,
    programme: row.programme,
    programmeId: row.programme_id,
    qualification: row.qualification,
    level: row.level,
    versionLabel: row.version_label,
    conceptCount: row.concept_count,
  }));
}

/**
 * Which curriculum fits this learner for this subject, most specific first:
 * an explicitly chosen one, an exam they prepare (student_exam_profiles), their
 * academic profile (the catalogue programme / subjects they selected; legacy:
 * IB Diploma), else the general StudyUs curriculum.
 */
export async function resolveCurriculumContext(
  studentId: string,
  catalogKey: string,
  requestedAcademicSubjectId?: string | null
): Promise<{ context: CurriculumOption | null; options: CurriculumOption[]; reason: ContextReason }> {
  const options = await listCurriculumOptions(catalogKey);
  if (requestedAcademicSubjectId) {
    const requested = options.find((o) => o.academicSubjectId === requestedAcademicSubjectId);
    if (requested) return { context: requested, options, reason: 'REQUESTED' };
  }
  // R1: definition-based and objective-first profiles (newest first); objective-first resolves through the governed objective.
  const profiles = await learnerExamProfiles([studentId], 'ACTIVE').catch(() => []);
  const resolved = await resolveExamProfiles(profiles).catch(() => new Map());
  for (const p of profiles) {
    for (const subjectId of resolved.get(p.id)?.academicSubjectIds ?? []) {
      const match = options.find((o) => o.academicSubjectId === subjectId);
      if (match) return { context: match, options, reason: 'EXAM_PROFILE' };
    }
  }
  const profile = await db.query(`SELECT curriculum_type, ib_programme, academic_programme_id FROM student_academic_profile WHERE student_id = $1`, [studentId]).catch(() => ({ rows: [] as any[] }));
  const programmeId: string | null = profile.rows[0]?.academic_programme_id ?? null;
  if (programmeId) {
    // Phase A: the selected subject of that programme first, else any published subject of the programme.
    const selected = await db.query(`SELECT academic_subject_id FROM student_academic_subjects WHERE student_id = $1 AND ended_at IS NULL`, [studentId]).catch(() => ({ rows: [] as any[] }));
    const ids = new Set(selected.rows.map((r: any) => r.academic_subject_id as string));
    const inProgramme = options.filter((o) => o.programmeId === programmeId);
    const match = inProgramme.find((o) => ids.has(o.academicSubjectId)) ?? inProgramme[0];
    if (match) return { context: match, options, reason: 'ACADEMIC_PROFILE' };
  }
  if (!programmeId && profile.rows[0]?.curriculum_type === 'ib' && profile.rows[0]?.ib_programme === 'DP') {
    const ib = options.find((o) => /IB/i.test(o.programme));
    if (ib) return { context: ib, options, reason: 'ACADEMIC_PROFILE' };
  }
  return { context: null, options, reason: 'GENERAL' };
}

async function prerequisitesFor(conceptIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (conceptIds.length === 0) return out;
  const r = await db.query(`SELECT concept_id, prerequisite_concept_id FROM canonical_concept_prerequisites WHERE concept_id = ANY($1::uuid[])`, [conceptIds]);
  for (const row of r.rows) out.set(row.concept_id, [...(out.get(row.concept_id) ?? []), row.prerequisite_concept_id]);
  return out;
}

/** The base curriculum (areas → concepts → prerequisites) of a context, or the general one. */
export async function getBaseCurriculum(catalogKey: string, context: CurriculumOption | null, locale: string): Promise<BaseCurriculum> {
  let rows: Array<{ area_key: string; area_label: string; canonical_concept_id: string }>;
  if (context) {
    const r = await db.query(
      `SELECT sn.id AS area_key, COALESCE(snl.label, sn.source_label, sn.code, '') AS area_label, ocm.canonical_concept_id,
         MIN(sn.order_index) AS node_order, MIN(lo.code) AS lo_code
       FROM objective_concept_mappings ocm
       JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id AND cc.status = 'ACTIVE'
       JOIN learning_objectives lo ON lo.id = ocm.learning_objective_id AND lo.status = 'ACTIVE'
       JOIN structure_nodes sn ON sn.id = lo.structure_node_id AND sn.structure_version_id = $1
       LEFT JOIN LATERAL (SELECT label FROM structure_node_localizations l WHERE l.structure_node_id = sn.id AND l.language = $2 LIMIT 1) snl ON true
       WHERE ocm.status = 'PUBLISHED' AND ocm.relation_type IN ('FULL', 'PARTIAL')
       GROUP BY sn.id, snl.label, sn.source_label, sn.code, ocm.canonical_concept_id
       ORDER BY node_order, lo_code, ocm.canonical_concept_id`,
      [context.structureVersionId, locale]
    );
    rows = r.rows;
  } else {
    const subjectIds = await canonicalSubjectIdsForCatalogKey(catalogKey);
    const r = await db.query(
      `SELECT cs.id AS area_key, cs.name AS area_label, cc.id AS canonical_concept_id
       FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
       WHERE cc.canonical_subject_id = ANY($1::uuid[]) AND cc.status = 'ACTIVE'
       ORDER BY cs.name, cc.name`,
      [subjectIds]
    );
    rows = r.rows;
  }
  const ids = [...new Set(rows.map((r) => r.canonical_concept_id))];
  const [labels, prereqs] = await Promise.all([canonicalConceptLabels(ids, locale), prerequisitesFor(ids)]);
  const seen = new Set<string>();
  const areas: CurriculumArea[] = [];
  const flat: CurriculumConcept[] = [];
  for (const row of rows) {
    if (seen.has(row.canonical_concept_id)) continue;
    seen.add(row.canonical_concept_id);
    let area = areas.find((a) => a.key === row.area_key);
    if (!area) {
      area = { key: row.area_key, label: row.area_label, concepts: [] };
      areas.push(area);
    }
    const concept: CurriculumConcept = {
      canonicalConceptId: row.canonical_concept_id,
      label: labels.get(row.canonical_concept_id) ?? '',
      prerequisiteIds: prereqs.get(row.canonical_concept_id) ?? [],
      order: flat.length,
    };
    area.concepts.push(concept);
    flat.push(concept);
  }
  return { catalogKey, context, areas, concepts: flat };
}

/** The learner's subjects that map to a catalog subject (their own "Matemáticas" for "mathematics"). */
export async function studentCatalogSubjects(studentId: string): Promise<Array<{ subjectId: string; name: string; catalogKey: string | null }>> {
  const r = await db.query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY created_at`, [studentId]);
  return r.rows.map((row: any) => ({ subjectId: row.id, name: row.name, catalogKey: catalogKeyOf(row.name) }));
}
