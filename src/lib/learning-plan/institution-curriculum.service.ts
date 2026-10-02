/**
 * Track A -- Institution Curriculum (governed by the institution's
 * coordinators). Built FROM the base curriculum (or the general catalog of
 * the subject), it classifies existing canonical concepts as REQUIRED /
 * RECOMMENDED / OPTIONAL / SUPPLEMENTAL and organizes them by grade /
 * academic year / period.
 *
 *  - It never creates, edits or deletes canonical concepts (catalog
 *    governance stays with StudyUS).
 *  - Removing a concept marks it REMOVED (audited); learner histories,
 *    class history and every learner state stay untouched.
 *  - REQUIRED concepts are institutional intent; they are NOT auto-enrolled
 *    into learners' plans (they surface as "required but not started").
 *
 * Callers MUST already have authorized the actor as an APPROVED coordinator
 * of `institutionId`; every query is scoped by institution_id anyway.
 */
import { db } from '@/lib/db';
import { canonicalConceptLabels } from './labels';
import { getBaseCurriculum, listCurriculumOptions, catalogKeyOf, canonicalSubjectIdsForCatalogKey } from './curriculum.service';

export const CURRICULUM_CLASSIFICATIONS = ['REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'SUPPLEMENTAL'] as const;
export type CurriculumClassification = (typeof CURRICULUM_CLASSIFICATIONS)[number];

export class CurriculumError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'SUBJECT_NOT_AVAILABLE' | 'GRADE_NOT_IN_INSTITUTION' | 'BASE_NOT_FOR_SUBJECT' | 'CONCEPT_NOT_IN_SUBJECT' | 'ALREADY_EXISTS') {
    super(code);
    this.name = 'CurriculumError';
  }
}

export interface InstitutionCurriculumSummary {
  id: string;
  title: string;
  canonicalSubjectId: string;
  subjectName: string;
  gradeId: string | null;
  gradeName: string | null;
  academicYear: string | null;
  programmeLabel: string | null;
  baseName: string | null;
  baseVersion: string | null;
  counts: Record<CurriculumClassification, number>;
}

async function event(params: { institutionId: string; curriculumId?: string | null; classId?: string | null; canonicalConceptId?: string | null; eventType: string; actorUserId: string | null; detail?: Record<string, unknown> }) {
  await db.query(
    `INSERT INTO curriculum_events (institution_id, curriculum_id, class_id, canonical_concept_id, event_type, actor_user_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [params.institutionId, params.curriculumId ?? null, params.classId ?? null, params.canonicalConceptId ?? null, params.eventType, params.actorUserId, JSON.stringify(params.detail ?? {})]
  );
}

export async function listInstitutionCurricula(institutionId: string): Promise<InstitutionCurriculumSummary[]> {
  const r = await db.query(
    `SELECT ic.id, ic.title, ic.canonical_subject_id, cs.name AS subject_name, ic.grade_id, g.name AS grade_name, ic.academic_year, ic.programme_label,
       asub.name AS base_name, sv.version_label AS base_version,
       (SELECT json_object_agg(classification, n) FROM (SELECT classification, COUNT(*)::int AS n FROM institution_curriculum_concepts icc WHERE icc.curriculum_id = ic.id AND icc.status = 'ACTIVE' GROUP BY classification) x) AS counts
     FROM institution_curricula ic
     JOIN canonical_subjects cs ON cs.id = ic.canonical_subject_id
     LEFT JOIN grades g ON g.id = ic.grade_id
     LEFT JOIN academic_subjects asub ON asub.id = ic.base_academic_subject_id
     LEFT JOIN structure_versions sv ON sv.id = ic.base_structure_version_id
     WHERE ic.institution_id = $1 AND ic.status = 'ACTIVE'
     ORDER BY cs.name, g.name NULLS FIRST`,
    [institutionId]
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    canonicalSubjectId: row.canonical_subject_id,
    subjectName: row.subject_name,
    gradeId: row.grade_id,
    gradeName: row.grade_name,
    academicYear: row.academic_year,
    programmeLabel: row.programme_label,
    baseName: row.base_name,
    baseVersion: row.base_version,
    counts: { REQUIRED: 0, RECOMMENDED: 0, OPTIONAL: 0, SUPPLEMENTAL: 0, ...(row.counts ?? {}) },
  }));
}

/**
 * Adopt a curriculum for a subject (optionally per grade / academic year),
 * seeded from a published base curriculum or from the subject's general
 * catalog. Seeded concepts start as RECOMMENDED; the coordinator classifies.
 */
export async function adoptInstitutionCurriculum(params: {
  institutionId: string;
  canonicalSubjectId: string;
  baseAcademicSubjectId?: string | null;
  gradeId?: string | null;
  academicYear?: string | null;
  programmeLabel?: string | null;
  title: string;
  actorUserId: string;
  locale: string;
}): Promise<{ id: string; seeded: number }> {
  const subject = await db.query(`SELECT id, name FROM canonical_subjects WHERE id = $1 AND status = 'ACTIVE'`, [params.canonicalSubjectId]);
  if (!subject.rows[0]) throw new CurriculumError('SUBJECT_NOT_AVAILABLE');
  if (params.gradeId) {
    const grade = await db.query(`SELECT 1 FROM grades WHERE id = $1 AND institution_id = $2`, [params.gradeId, params.institutionId]);
    if (!grade.rows[0]) throw new CurriculumError('GRADE_NOT_IN_INSTITUTION');
  }
  const catalogKey = catalogKeyOf(subject.rows[0].name);
  let base = null as Awaited<ReturnType<typeof listCurriculumOptions>>[number] | null;
  if (params.baseAcademicSubjectId) {
    const options = catalogKey ? await listCurriculumOptions(catalogKey) : [];
    base = options.find((o) => o.academicSubjectId === params.baseAcademicSubjectId) ?? null;
    if (!base) throw new CurriculumError('BASE_NOT_FOR_SUBJECT');
  }
  let created;
  try {
    created = await db.query(
      `INSERT INTO institution_curricula (institution_id, canonical_subject_id, base_academic_subject_id, base_structure_version_id, grade_id, title, programme_label, academic_year, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [params.institutionId, params.canonicalSubjectId, base?.academicSubjectId ?? null, base?.structureVersionId ?? null, params.gradeId ?? null, params.title.trim(), params.programmeLabel ?? null, params.academicYear ?? null, params.actorUserId]
    );
  } catch (error: any) {
    if (error?.code === '23505') throw new CurriculumError('ALREADY_EXISTS');
    throw error;
  }
  const curriculumId: string = created.rows[0].id;
  // Seed: concepts of THIS canonical subject in curriculum order (the base context, else the general catalog of the subject).
  const proposal = catalogKey ? await getBaseCurriculum(catalogKey, base, params.locale) : null;
  const seedIds = (proposal?.concepts ?? []).map((c) => c.canonicalConceptId);
  const inSubject = seedIds.length
    ? (await db.query(`SELECT id FROM canonical_concepts WHERE id = ANY($1::uuid[]) AND canonical_subject_id = $2 AND status = 'ACTIVE'`, [seedIds, params.canonicalSubjectId])).rows.map((r: any) => r.id)
    : [];
  const ordered = seedIds.filter((id) => inSubject.includes(id));
  if (ordered.length > 0) {
    await db.query(
      `INSERT INTO institution_curriculum_concepts (curriculum_id, canonical_concept_id, classification, order_index, added_by_user_id)
       SELECT $1, id, 'RECOMMENDED', ord, $3 FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ord)
       ON CONFLICT (curriculum_id, canonical_concept_id) DO NOTHING`,
      [curriculumId, ordered, params.actorUserId]
    );
  }
  // No class is associated automatically: a class gets a curriculum only by an explicit coordinator choice
  // (assignClassCurriculum). Same subject / grade / translated name is never a reason to bind.
  await event({ institutionId: params.institutionId, curriculumId, eventType: 'CURRICULUM_ADOPTED', actorUserId: params.actorUserId, detail: { base: base?.name ?? 'GENERAL', version: base?.versionLabel ?? null, seeded: ordered.length } });
  return { id: curriculumId, seeded: ordered.length };
}

async function requireCurriculum(institutionId: string, curriculumId: string): Promise<{ id: string; canonical_subject_id: string }> {
  const r = await db.query(`SELECT id, canonical_subject_id FROM institution_curricula WHERE id = $1 AND institution_id = $2 AND status = 'ACTIVE'`, [curriculumId, institutionId]);
  if (!r.rows[0]) throw new CurriculumError('NOT_FOUND');
  return r.rows[0];
}

export interface CurriculumConceptRow {
  canonicalConceptId: string;
  label: string;
  classification: CurriculumClassification;
  period: string | null;
  orderIndex: number;
  status: 'ACTIVE' | 'REMOVED';
}

export async function getInstitutionCurriculum(institutionId: string, curriculumId: string, locale: string): Promise<{ summary: InstitutionCurriculumSummary; concepts: CurriculumConceptRow[]; addable: Array<{ canonicalConceptId: string; label: string }> }> {
  const curriculum = await requireCurriculum(institutionId, curriculumId);
  const summary = (await listInstitutionCurricula(institutionId)).find((c) => c.id === curriculumId)!;
  const rows = await db.query(
    `SELECT canonical_concept_id, classification, period, order_index, status FROM institution_curriculum_concepts WHERE curriculum_id = $1 ORDER BY status, order_index, added_at`,
    [curriculumId]
  );
  const subjectConcepts = await db.query(`SELECT id FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE'`, [curriculum.canonical_subject_id]);
  const labels = await canonicalConceptLabels([...rows.rows.map((r: any) => r.canonical_concept_id), ...subjectConcepts.rows.map((r: any) => r.id)], locale);
  const present = new Set(rows.rows.map((r: any) => r.canonical_concept_id));
  return {
    summary,
    concepts: rows.rows.map((r: any) => ({
      canonicalConceptId: r.canonical_concept_id,
      label: labels.get(r.canonical_concept_id) ?? '',
      classification: r.classification,
      period: r.period,
      orderIndex: r.order_index,
      status: r.status,
    })),
    addable: subjectConcepts.rows
      .filter((r: any) => !present.has(r.id))
      .map((r: any) => ({ canonicalConceptId: r.id, label: labels.get(r.id) ?? '' }))
      .sort((a: any, b: any) => a.label.localeCompare(b.label)),
  };
}

/** Add (or restore / reclassify) an existing canonical concept of the curriculum's subject. */
export async function setCurriculumConcept(params: { institutionId: string; curriculumId: string; canonicalConceptId: string; classification?: CurriculumClassification; period?: string | null; actorUserId: string }): Promise<void> {
  const curriculum = await requireCurriculum(params.institutionId, params.curriculumId);
  const ok = await db.query(`SELECT 1 FROM canonical_concepts WHERE id = $1 AND canonical_subject_id = $2 AND status = 'ACTIVE'`, [params.canonicalConceptId, curriculum.canonical_subject_id]);
  if (!ok.rows[0]) throw new CurriculumError('CONCEPT_NOT_IN_SUBJECT');
  const before = await db.query(`SELECT classification, status FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND canonical_concept_id = $2`, [params.curriculumId, params.canonicalConceptId]);
  await db.query(
    `INSERT INTO institution_curriculum_concepts (curriculum_id, canonical_concept_id, classification, period, order_index, added_by_user_id)
     VALUES ($1, $2, COALESCE($3, 'RECOMMENDED'), $4, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM institution_curriculum_concepts WHERE curriculum_id = $1), $5)
     ON CONFLICT (curriculum_id, canonical_concept_id) DO UPDATE SET
       classification = COALESCE($3, institution_curriculum_concepts.classification),
       period = COALESCE($4, institution_curriculum_concepts.period),
       status = 'ACTIVE', removed_at = NULL, removed_by_user_id = NULL, updated_at = now()`,
    [params.curriculumId, params.canonicalConceptId, params.classification ?? null, params.period ?? null, params.actorUserId]
  );
  const prior = before.rows[0];
  const eventType = !prior ? 'CONCEPT_ADDED' : prior.status === 'REMOVED' ? 'CONCEPT_RESTORED' : 'CONCEPT_CLASSIFIED';
  await event({ institutionId: params.institutionId, curriculumId: params.curriculumId, canonicalConceptId: params.canonicalConceptId, eventType, actorUserId: params.actorUserId, detail: { from: prior?.classification ?? null, to: params.classification ?? prior?.classification ?? 'RECOMMENDED' } });
}

/** Retire a concept from the institutional curriculum (audited; nothing about learners changes). */
export async function removeCurriculumConcept(params: { institutionId: string; curriculumId: string; canonicalConceptId: string; actorUserId: string }): Promise<boolean> {
  await requireCurriculum(params.institutionId, params.curriculumId);
  const r = await db.query(
    `UPDATE institution_curriculum_concepts SET status = 'REMOVED', removed_at = now(), removed_by_user_id = $3, updated_at = now()
     WHERE curriculum_id = $1 AND canonical_concept_id = $2 AND status = 'ACTIVE' RETURNING id`,
    [params.curriculumId, params.canonicalConceptId, params.actorUserId]
  );
  if (r.rows.length === 0) return false;
  await event({ institutionId: params.institutionId, curriculumId: params.curriculumId, canonicalConceptId: params.canonicalConceptId, eventType: 'CONCEPT_REMOVED', actorUserId: params.actorUserId });
  return true;
}

/**
 * The curriculum a class works from: ONLY its explicit association
 * (classes.institution_curriculum_id) -- kept even when that curriculum was
 * later archived, as the class's historical reference. No implicit fallback by
 * subject / grade: a class without an explicit binding has no curriculum.
 */
export async function curriculumForClass(classId: string): Promise<{
  curriculumId: string;
  classifications: Map<string, CurriculumClassification>;
  title?: string;
  programme?: string | null;
  versionLabel?: string | null;
  level?: string | null;
  archived?: boolean;
  required?: string[];
} | null> {
  const r = await db.query(
    `SELECT ic.id, ic.title, ic.status, COALESCE(p.name, ic.programme_label) AS programme, sv.version_label, a.level
     FROM classes c
     JOIN institution_curricula ic ON ic.id = c.institution_curriculum_id
     LEFT JOIN academic_subjects a ON a.id = ic.base_academic_subject_id
     LEFT JOIN structure_versions sv ON sv.id = ic.base_structure_version_id
     LEFT JOIN academic_programmes p ON p.id = COALESCE(ic.academic_programme_id, a.programme_id)
     WHERE c.id = $1 AND ic.institution_id = c.institution_id`,
    [classId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const concepts = await db.query(`SELECT canonical_concept_id, classification FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND status = 'ACTIVE'`, [row.id]);
  return {
    curriculumId: row.id,
    classifications: new Map(concepts.rows.map((x: any) => [x.canonical_concept_id, x.classification])),
    title: row.title,
    programme: row.programme,
    versionLabel: row.version_label,
    level: row.level,
    archived: row.status !== 'ACTIVE',
    required: concepts.rows.filter((x: any) => x.classification === 'REQUIRED').map((x: any) => x.canonical_concept_id),
  };
}

/** Supplemental concepts teachers added to class plans that are not (yet) in the institution's curriculum. */
export async function listSupplementalSuggestions(institutionId: string, locale: string): Promise<Array<{ classId: string; className: string; canonicalConceptId: string; label: string; curriculumId: string | null }>> {
  const r = await db.query(
    `SELECT c.id AS class_id, c.name AS class_name, cpc.canonical_concept_id,
       c.institution_curriculum_id AS curriculum_id
     FROM class_plan_concepts cpc JOIN classes c ON c.id = cpc.class_id
     WHERE c.institution_id = $1 AND cpc.status = 'ACTIVE' AND cpc.supplemental = true
     ORDER BY cpc.added_at DESC`,
    [institutionId]
  );
  const rows = [];
  for (const row of r.rows) {
    if (row.curriculum_id) {
      const inCurriculum = await db.query(`SELECT 1 FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND canonical_concept_id = $2 AND status = 'ACTIVE'`, [row.curriculum_id, row.canonical_concept_id]);
      if (inCurriculum.rows[0]) continue;
    }
    rows.push(row);
  }
  const labels = await canonicalConceptLabels(rows.map((x) => x.canonical_concept_id), locale);
  return rows.map((x) => ({ classId: x.class_id, className: x.class_name, canonicalConceptId: x.canonical_concept_id, label: labels.get(x.canonical_concept_id) ?? '', curriculumId: x.curriculum_id }));
}

/** Subjects a coordinator can build a curriculum for, with the published bases available for each. */
export async function listAdoptableSubjects(): Promise<Array<{ canonicalSubjectId: string; name: string; bases: Array<{ academicSubjectId: string; label: string }> }>> {
  const subjects = await db.query(`SELECT id, name FROM canonical_subjects WHERE status = 'ACTIVE' ORDER BY name`);
  const out = [];
  for (const s of subjects.rows) {
    const key = catalogKeyOf(s.name);
    const options = key ? await listCurriculumOptions(key) : [];
    const own = key ? await canonicalSubjectIdsForCatalogKey(key) : [];
    out.push({
      canonicalSubjectId: s.id,
      name: s.name,
      bases: own.includes(s.id) ? options.map((o) => ({ academicSubjectId: o.academicSubjectId, label: `${o.programme} · ${o.name} (${o.versionLabel})` })) : [],
    });
  }
  return out;
}

export { event as recordCurriculumEvent };
