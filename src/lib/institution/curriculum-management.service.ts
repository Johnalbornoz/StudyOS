/**
 * Track A -- Institution Curriculum Management V2 (CONFIGURATION).
 *
 *   Education Authority / Published Programme  (official, immutable, versioned)
 *     → Institution Curriculum Subject           (one per programme subject + level + version + grade + year)
 *       → included content: published objectives (INCLUDED / EXCLUDED + classification)
 *                           + catalog concepts   (AUTHORITY-mapped, INSTITUTION-added, TEACHER_SUPPLEMENTAL-incorporated)
 *     → Class association (classes.institution_curriculum_id)
 *       → Class Learning Plan (Teacher subset)  → Student Personal Plan (only what is assigned)
 *
 * The published structure is never modified: excluding content only changes
 * the institution's selection. Nothing here enrolls students or touches
 * learner state. Every mutation is scoped by institution (foreign ids are
 * NOT_FOUND) and audited in academic_governance_events.
 *
 * Coverage (ANALYTICS, separate): which curriculum content is in class plans /
 * students' plans. It is NOT mastery and NOT StudyUs content coverage.
 */
import { db } from '@/lib/db';
import { bindingDomainAllowed, curriculumContextLabel, rankCurriculumCandidates } from './curriculum-identity';
import { canonicalConceptLabels } from '@/lib/learning-plan/labels';
import { recordGovernanceEvent } from './academic-governance';
import { curriculumScope, type CurriculumScope } from '@/lib/curriculum/catalog-scope';

export const CLASSIFICATIONS = ['REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'SUPPLEMENTAL'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export class CurriculumManagementError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'SUBJECT_NOT_AVAILABLE'
      | 'GRADE_NOT_IN_INSTITUTION'
      | 'CLASS_NOT_IN_INSTITUTION'
      | 'CURRICULUM_NOT_ACTIVE'
      | 'INVALID_CHANGE'
      | 'CONTENT_NOT_IN_CURRICULUM'
      | 'CLASS_SUBJECT_IN_USE'
      | 'DOMAIN_MISMATCH'
      | 'IMPACT_CONFIRMATION_REQUIRED'
  ) {
    super(code);
    this.name = 'CurriculumManagementError';
  }
}

const iso = (v: any): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);
/** Syllabus code when the published version label carries one ("9709 A Level" → "9709"). */
export function syllabusCode(versionLabel: string | null | undefined): string | null {
  const m = (versionLabel ?? '').match(/^(\d{4})\b/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Governed source catalog (Country → Authority / Programme → Subject · Level → Version)
// ---------------------------------------------------------------------------

export interface CurriculumSourceOption {
  academicSubjectId: string;
  versionId: string;
  subject: string;
  level: string | null;
  qualification: string | null;
  code: string | null;
  versionLabel: string;
  programmeId: string;
  programme: string;
  stage: string | null;
  authorityId: string;
  authority: string;
  parentAuthority: string | null;
  jurisdiction: string | null;
  country: string | null;
  sourceType: string;
  authorityLevel: string | null;
  /** NATIONAL (a country's authority) or INTERNATIONAL (IB, Cambridge, ...), derived from catalogue metadata. */
  scope: CurriculumScope;
  structureImported: boolean;
  objectives: number;
  canonicalSubjectId: string;
  canonicalSubject: string;
}

export async function listCurriculumSourceOptions(): Promise<CurriculumSourceOption[]> {
  const r = await db.query(
    `SELECT a.id AS academic_subject_id, a.name AS subject, a.level, q.name AS qualification, p.id AS programme_id, p.name AS programme, p.stage,
            o.id AS authority_id, o.name AS authority, po.name AS parent_authority, o.jurisdiction, o.country, COALESCE(o.source_type, 'INTERNATIONAL_PROGRAMME') AS source_type, o.authority_level,
            sv.id AS version_id, sv.version_label, sv.source_locator, a.canonical_subject_id, cs.name AS canonical_subject,
            (SELECT COUNT(*) FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id WHERE sn.structure_version_id = sv.id AND lo.status = 'ACTIVE')::int AS objectives
     FROM academic_subjects a
     JOIN academic_programmes p ON p.id = a.programme_id AND p.status = 'ACTIVE' AND p.programme_type = 'CURRICULUM'
     JOIN academic_organizations o ON o.id = p.organization_id AND o.status = 'ACTIVE'
     LEFT JOIN academic_organizations po ON po.id = o.parent_organization_id
     LEFT JOIN academic_qualifications q ON q.id = a.qualification_id
     JOIN structure_versions sv ON sv.academic_subject_id = a.id AND sv.status = 'PUBLISHED'
     JOIN canonical_subjects cs ON cs.id = a.canonical_subject_id AND cs.status = 'ACTIVE'
     WHERE a.status = 'ACTIVE'
     ORDER BY o.country NULLS FIRST, o.name, p.name, a.name, a.level NULLS FIRST`
  );
  return r.rows.map((x: any) => ({
    academicSubjectId: x.academic_subject_id,
    versionId: x.version_id,
    subject: x.subject,
    level: x.level,
    qualification: x.qualification,
    code: syllabusCode(x.version_label),
    versionLabel: x.version_label,
    programmeId: x.programme_id,
    programme: x.programme,
    stage: x.stage,
    authorityId: x.authority_id,
    authority: x.authority,
    parentAuthority: x.parent_authority,
    jurisdiction: x.jurisdiction,
    country: x.country,
    sourceType: x.source_type,
    authorityLevel: x.authority_level,
    scope: curriculumScope({ country: x.country, sourceType: x.source_type }),
    structureImported: x.source_locator !== 'STRUCTURE_NOT_IMPORTED' && x.objectives > 0,
    objectives: x.objectives,
    canonicalSubjectId: x.canonical_subject_id,
    canonicalSubject: x.canonical_subject,
  }));
}

// ---------------------------------------------------------------------------
// Institution curriculum subjects (grouped by Programme → Grade)
// ---------------------------------------------------------------------------

export interface CurriculumSubjectRow {
  curriculumId: string;
  title: string;
  subject: string;
  code: string | null;
  level: string | null;
  versionLabel: string | null;
  academicYear: string | null;
  programme: string | null;
  programmeId: string | null;
  authority: string | null;
  country: string | null;
  sourceType: string;
  gradeId: string | null;
  gradeName: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: string | null;
  replacedBy: string | null;
  canonicalSubjectId: string;
  /** Canonical academic domain (e.g. MATHEMATICS) -- a grouping for suggestions, never an identity. */
  academicDomain: string | null;
  academicSubjectId: string | null;
  versionId: string | null;
  structureImported: boolean;
  classes: number;
  students: number;
  objectivesIncluded: number;
  objectivesTotal: number;
  conceptsIncluded: number;
  required: number;
}

export async function listInstitutionCurriculumSubjects(institutionId: string, opts: { includeArchived?: boolean } = {}): Promise<CurriculumSubjectRow[]> {
  const r = await db.query(
    `SELECT ic.id, ic.title, ic.academic_year, ic.status, ic.archived_at, ic.replaced_by_curriculum_id, ic.grade_id, g.name AS grade_name,
            ic.canonical_subject_id, cs.name AS canonical_subject, cs.academic_domain_code, ic.base_academic_subject_id, ic.base_structure_version_id,
            COALESCE(ic.source_type, 'INSTITUTION_DEFINED') AS source_type,
            a.name AS subject, a.level, sv.version_label, sv.source_locator, p.id AS programme_id, COALESCE(p.name, ic.programme_label) AS programme, o.name AS authority, o.country,
            (SELECT COUNT(*) FROM classes c WHERE c.institution_curriculum_id = ic.id)::int AS classes,
            (SELECT COUNT(DISTINCT ce.student_id) FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE c.institution_curriculum_id = ic.id AND ce.status = 'ACTIVE')::int AS students,
            (SELECT COUNT(*) FILTER (WHERE status = 'INCLUDED') FROM institution_curriculum_objectives WHERE curriculum_id = ic.id)::int AS objectives_included,
            (SELECT COUNT(*) FROM institution_curriculum_objectives WHERE curriculum_id = ic.id)::int AS objectives_total,
            (SELECT COUNT(*) FROM institution_curriculum_concepts WHERE curriculum_id = ic.id AND status = 'ACTIVE')::int AS concepts_included,
            ((SELECT COUNT(*) FROM institution_curriculum_concepts WHERE curriculum_id = ic.id AND status = 'ACTIVE' AND classification = 'REQUIRED')
             + (SELECT COUNT(*) FROM institution_curriculum_objectives WHERE curriculum_id = ic.id AND status = 'INCLUDED' AND classification = 'REQUIRED'))::int AS required
     FROM institution_curricula ic
     JOIN canonical_subjects cs ON cs.id = ic.canonical_subject_id
     LEFT JOIN grades g ON g.id = ic.grade_id
     LEFT JOIN academic_subjects a ON a.id = ic.base_academic_subject_id
     LEFT JOIN structure_versions sv ON sv.id = ic.base_structure_version_id
     LEFT JOIN academic_programmes p ON p.id = COALESCE(ic.academic_programme_id, a.programme_id)
     LEFT JOIN academic_organizations o ON o.id = p.organization_id
     WHERE ic.institution_id = $1 AND ($2::boolean OR ic.status = 'ACTIVE')
     ORDER BY ic.status, COALESCE(p.name, ic.programme_label) NULLS LAST, g.name NULLS FIRST, COALESCE(a.name, cs.name), a.level NULLS FIRST`,
    [institutionId, Boolean(opts.includeArchived)]
  );
  return r.rows.map((x: any) => ({
    curriculumId: x.id,
    title: x.title,
    subject: x.subject ?? x.canonical_subject,
    code: syllabusCode(x.version_label),
    level: x.level,
    versionLabel: x.version_label,
    academicYear: x.academic_year,
    programme: x.programme,
    programmeId: x.programme_id,
    authority: x.authority,
    country: x.country,
    sourceType: x.source_type,
    gradeId: x.grade_id,
    gradeName: x.grade_name,
    status: x.status,
    archivedAt: iso(x.archived_at),
    replacedBy: x.replaced_by_curriculum_id,
    canonicalSubjectId: x.canonical_subject_id,
    academicDomain: x.academic_domain_code ?? null,
    academicSubjectId: x.base_academic_subject_id,
    versionId: x.base_structure_version_id,
    structureImported: Boolean(x.base_structure_version_id) && x.source_locator !== 'STRUCTURE_NOT_IMPORTED' && x.objectives_total > 0,
    classes: x.classes,
    students: x.students,
    objectivesIncluded: x.objectives_included,
    objectivesTotal: x.objectives_total,
    conceptsIncluded: x.concepts_included,
    required: x.required,
  }));
}

async function requireGrade(institutionId: string, gradeId: string | null): Promise<void> {
  if (!gradeId) return;
  const g = await db.query(`SELECT 1 FROM grades WHERE id = $1 AND institution_id = $2`, [gradeId, institutionId]);
  if (!g.rows[0]) throw new CurriculumManagementError('GRADE_NOT_IN_INSTITUTION');
}

async function requireInstitutionCurriculum(institutionId: string, curriculumId: string, activeOnly = true) {
  const r = await db.query(`SELECT * FROM institution_curricula WHERE id = $1 AND institution_id = $2`, [curriculumId, institutionId]);
  const row = r.rows[0];
  if (!row) throw new CurriculumManagementError('NOT_FOUND');
  if (activeOnly && row.status !== 'ACTIVE') throw new CurriculumManagementError('CURRICULUM_NOT_ACTIVE');
  return row;
}

/** Seed the institution selection from the published structure: every objective INCLUDED, mapped concepts as AUTHORITY content. */
async function seedFromPublishedStructure(curriculumId: string, versionId: string, canonicalSubjectId: string, actorUserId: string): Promise<{ objectives: number; concepts: number }> {
  const objectives = await db.query(
    `INSERT INTO institution_curriculum_objectives (curriculum_id, learning_objective_id, updated_by_user_id)
     SELECT $1, lo.id, $3 FROM structure_nodes sn JOIN learning_objectives lo ON lo.structure_node_id = sn.id AND lo.status = 'ACTIVE'
     WHERE sn.structure_version_id = $2
     ON CONFLICT DO NOTHING`,
    [curriculumId, versionId, actorUserId]
  );
  const concepts = await db.query(
    `INSERT INTO institution_curriculum_concepts (curriculum_id, canonical_concept_id, classification, order_index, added_by_user_id, source)
     SELECT $1, x.canonical_concept_id, 'RECOMMENDED', ROW_NUMBER() OVER (ORDER BY x.first_order), $4, 'AUTHORITY'
     FROM (SELECT ocm.canonical_concept_id, MIN(sn.order_index) AS first_order
           FROM objective_concept_mappings ocm
           JOIN learning_objectives lo ON lo.id = ocm.learning_objective_id AND lo.status = 'ACTIVE'
           JOIN structure_nodes sn ON sn.id = lo.structure_node_id AND sn.structure_version_id = $2
           JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id AND cc.status = 'ACTIVE' AND cc.canonical_subject_id = $3
           WHERE ocm.status = 'PUBLISHED' AND ocm.relation_type IN ('FULL', 'PARTIAL')
           GROUP BY ocm.canonical_concept_id) x
     ON CONFLICT (curriculum_id, canonical_concept_id) DO NOTHING`,
    [curriculumId, versionId, canonicalSubjectId, actorUserId]
  );
  return { objectives: objectives.rowCount ?? 0, concepts: concepts.rowCount ?? 0 };
}

/**
 * Add one or more published subjects (each with its level / version) to the
 * institution curriculum of a grade. Idempotent: an ACTIVE relation with the
 * same institution + subject/level + version + grade + year is returned, never
 * duplicated (retry / double click).
 */
export async function addInstitutionCurriculumSubjects(params: {
  institutionId: string;
  actorUserId: string;
  gradeId: string | null;
  academicYear?: string | null;
  items: Array<{ academicSubjectId: string; versionId?: string | null }>;
}): Promise<Array<{ curriculumId: string; academicSubjectId: string; created: boolean }>> {
  await requireGrade(params.institutionId, params.gradeId);
  const options = await listCurriculumSourceOptions();
  const out: Array<{ curriculumId: string; academicSubjectId: string; created: boolean }> = [];
  for (const item of params.items) {
    const option = options.find((o) => o.academicSubjectId === item.academicSubjectId && (!item.versionId || o.versionId === item.versionId));
    if (!option) throw new CurriculumManagementError('SUBJECT_NOT_AVAILABLE');
    const existing = await db.query(
      `SELECT id FROM institution_curricula WHERE institution_id = $1 AND status = 'ACTIVE' AND base_academic_subject_id = $2 AND base_structure_version_id = $3
         AND grade_id IS NOT DISTINCT FROM $4 AND COALESCE(academic_year, '') = COALESCE($5, '')`,
      [params.institutionId, option.academicSubjectId, option.versionId, params.gradeId, params.academicYear ?? null]
    );
    if (existing.rows[0]) {
      out.push({ curriculumId: existing.rows[0].id, academicSubjectId: option.academicSubjectId, created: false });
      continue;
    }
    const title = [option.subject, option.code, option.level].filter(Boolean).join(' ');
    let id: string;
    try {
      id = (await db.query(
        `INSERT INTO institution_curricula (institution_id, canonical_subject_id, base_academic_subject_id, base_structure_version_id, grade_id, title, programme_label, academic_year,
                                            created_by_user_id, updated_by_user_id, academic_programme_id, source_type, provenance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12) RETURNING id`,
        [
          params.institutionId,
          option.canonicalSubjectId,
          option.academicSubjectId,
          option.versionId,
          params.gradeId,
          title.slice(0, 200),
          option.programme,
          params.academicYear ?? null,
          params.actorUserId,
          option.programmeId,
          option.sourceType,
          JSON.stringify({ authority: option.authority, parentAuthority: option.parentAuthority, country: option.country, programme: option.programme, version: option.versionLabel, structureImported: option.structureImported }),
        ]
      )).rows[0].id;
    } catch (error: any) {
      if (error?.code === '23505') {
        const again = await db.query(
          `SELECT id FROM institution_curricula WHERE institution_id = $1 AND status = 'ACTIVE' AND base_academic_subject_id = $2 AND base_structure_version_id = $3 AND grade_id IS NOT DISTINCT FROM $4`,
          [params.institutionId, option.academicSubjectId, option.versionId, params.gradeId]
        );
        if (again.rows[0]) {
          out.push({ curriculumId: again.rows[0].id, academicSubjectId: option.academicSubjectId, created: false });
          continue;
        }
      }
      throw error;
    }
    const seeded = await seedFromPublishedStructure(id, option.versionId, option.canonicalSubjectId, params.actorUserId);
    await recordGovernanceEvent({
      institutionId: params.institutionId,
      actorUserId: params.actorUserId,
      actorScope: 'INSTITUTION',
      objectType: 'INSTITUTION_CURRICULUM_SUBJECT',
      objectId: id,
      action: 'SUBJECT_ADDED',
      newValues: { subject: option.subject, level: option.level, version: option.versionLabel, programme: option.programme, authority: option.authority, gradeId: params.gradeId, academicYear: params.academicYear ?? null, ...seeded },
    });
    out.push({ curriculumId: id, academicSubjectId: option.academicSubjectId, created: true });
  }
  return out;
}

/** Classes and ACTIVE students using a curriculum (one query). */
export async function curriculumUsage(curriculumId: string): Promise<{ classes: Array<{ id: string; name: string }>; students: number }> {
  const r = await db.query(
    `SELECT c.id, c.name, (SELECT COUNT(DISTINCT ce.student_id) FROM class_enrollments ce JOIN classes k ON k.id = ce.class_id WHERE k.institution_curriculum_id = $1 AND ce.status = 'ACTIVE')::int AS students
     FROM classes c WHERE c.institution_curriculum_id = $1 ORDER BY c.name`,
    [curriculumId]
  );
  return { classes: r.rows.map((x: any) => ({ id: x.id, name: x.name })), students: r.rows[0]?.students ?? 0 };
}

/**
 * Impact of changing a curriculum subject to another level / version of the
 * same subject: objectives added / retired (matched by objective code, else
 * description), classes and students affected. Read-only.
 */
export async function previewCurriculumSubjectChange(institutionId: string, curriculumId: string, target: { academicSubjectId: string; versionId?: string | null }) {
  const current = await requireInstitutionCurriculum(institutionId, curriculumId);
  const options = await listCurriculumSourceOptions();
  const option = options.find((o) => o.academicSubjectId === target.academicSubjectId && (!target.versionId || o.versionId === target.versionId));
  if (!option || option.canonicalSubjectId !== current.canonical_subject_id) throw new CurriculumManagementError('INVALID_CHANGE');
  const objectives = await db.query(
    `SELECT sn.structure_version_id AS version_id, COALESCE(lo.code, lo.description) AS k FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id
     WHERE sn.structure_version_id = ANY($1::uuid[]) AND lo.status = 'ACTIVE'`,
    [[current.base_structure_version_id, option.versionId].filter(Boolean)]
  );
  const before = new Set(objectives.rows.filter((r: any) => r.version_id === current.base_structure_version_id).map((r: any) => r.k));
  const after = new Set(objectives.rows.filter((r: any) => r.version_id === option.versionId).map((r: any) => r.k));
  const usage = await curriculumUsage(curriculumId);
  return {
    target: { subject: option.subject, level: option.level, versionLabel: option.versionLabel, code: option.code },
    added: [...after].filter((k) => !before.has(k)).length,
    retired: [...before].filter((k) => !after.has(k)).length,
    kept: [...after].filter((k) => before.has(k)).length,
    classes: usage.classes.length,
    students: usage.students,
  };
}

/**
 * Edit a curriculum subject. Metadata (title, year, grade) change in place.
 * A level / version change creates the new institution relation, carries the
 * institution's decisions over (objective status by code; concepts as is),
 * archives the previous one (replaced_by) and re-points its classes --
 * history, class plans, assignments and learner state are untouched.
 */
export async function updateInstitutionCurriculumSubject(params: {
  institutionId: string;
  curriculumId: string;
  actorUserId: string;
  title?: string | null;
  academicYear?: string | null;
  gradeId?: string | null;
  academicSubjectId?: string | null;
  versionId?: string | null;
}): Promise<{ curriculumId: string; replaced: boolean }> {
  const current = await requireInstitutionCurriculum(params.institutionId, params.curriculumId);
  if (params.gradeId !== undefined) await requireGrade(params.institutionId, params.gradeId);
  const wantsVersion = Boolean(params.academicSubjectId) && (params.academicSubjectId !== current.base_academic_subject_id || (params.versionId && params.versionId !== current.base_structure_version_id));
  if (!wantsVersion) {
    const next = {
      title: params.title?.trim() || current.title,
      academic_year: params.academicYear !== undefined ? params.academicYear : current.academic_year,
      grade_id: params.gradeId !== undefined ? params.gradeId : current.grade_id,
    };
    try {
      await db.query(`UPDATE institution_curricula SET title = $2, academic_year = $3, grade_id = $4, updated_by_user_id = $5, updated_at = now() WHERE id = $1`, [
        current.id,
        next.title,
        next.academic_year,
        next.grade_id,
        params.actorUserId,
      ]);
    } catch (error: any) {
      if (error?.code === '23505') throw new CurriculumManagementError('INVALID_CHANGE');
      throw error;
    }
    const fields = (['title', 'academic_year', 'grade_id'] as const).filter((f) => next[f] !== current[f]);
    if (fields.length) {
      await recordGovernanceEvent({
        institutionId: params.institutionId,
        actorUserId: params.actorUserId,
        actorScope: 'INSTITUTION',
        objectType: 'INSTITUTION_CURRICULUM_SUBJECT',
        objectId: current.id,
        action: fields.includes('grade_id') ? 'GRADE_CHANGED' : 'METADATA_CHANGED',
        fields,
        oldValues: Object.fromEntries(fields.map((f) => [f, current[f]])),
        newValues: Object.fromEntries(fields.map((f) => [f, next[f]])),
      });
    }
    return { curriculumId: current.id, replaced: false };
  }

  const preview = await previewCurriculumSubjectChange(params.institutionId, current.id, { academicSubjectId: params.academicSubjectId!, versionId: params.versionId });
  const options = await listCurriculumSourceOptions();
  const option = options.find((o) => o.academicSubjectId === params.academicSubjectId && (!params.versionId || o.versionId === params.versionId))!;
  const client = await db.connect();
  let newId: string;
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE institution_curricula SET status = 'ARCHIVED', archived_at = now(), archived_by_user_id = $2, archive_reason = 'VERSION_CHANGED', updated_at = now() WHERE id = $1`, [current.id, params.actorUserId]);
    newId = (await client.query(
      `INSERT INTO institution_curricula (institution_id, canonical_subject_id, base_academic_subject_id, base_structure_version_id, grade_id, title, programme_label, academic_year,
                                          created_by_user_id, updated_by_user_id, academic_programme_id, source_type, provenance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12) RETURNING id`,
      [
        params.institutionId,
        current.canonical_subject_id,
        option.academicSubjectId,
        option.versionId,
        params.gradeId !== undefined ? params.gradeId : current.grade_id,
        [option.subject, option.code, option.level].filter(Boolean).join(' ').slice(0, 200),
        option.programme,
        params.academicYear !== undefined ? params.academicYear : current.academic_year,
        params.actorUserId,
        option.programmeId,
        option.sourceType,
        JSON.stringify({ authority: option.authority, programme: option.programme, version: option.versionLabel, previousCurriculumId: current.id }),
      ]
    )).rows[0].id;
    await client.query(`UPDATE institution_curricula SET replaced_by_curriculum_id = $2 WHERE id = $1`, [current.id, newId]);
    // carry concept decisions over as they are
    await client.query(
      `INSERT INTO institution_curriculum_concepts (curriculum_id, canonical_concept_id, classification, period, order_index, status, added_by_user_id, source, institution_target_date)
       SELECT $2, canonical_concept_id, classification, period, order_index, status, added_by_user_id, source, institution_target_date
       FROM institution_curriculum_concepts WHERE curriculum_id = $1`,
      [current.id, newId]
    );
    // objectives of the new version: carry status / classification of the same objective (code, else description)
    await client.query(
      `INSERT INTO institution_curriculum_objectives (curriculum_id, learning_objective_id, classification, status, updated_by_user_id)
       SELECT $2, lo.id, COALESCE(prev.classification, 'RECOMMENDED'), COALESCE(prev.status, 'INCLUDED'), $4
       FROM structure_nodes sn JOIN learning_objectives lo ON lo.structure_node_id = sn.id AND lo.status = 'ACTIVE'
       LEFT JOIN LATERAL (
         SELECT ico.classification, ico.status FROM institution_curriculum_objectives ico JOIN learning_objectives plo ON plo.id = ico.learning_objective_id
         WHERE ico.curriculum_id = $1 AND COALESCE(plo.code, plo.description) = COALESCE(lo.code, lo.description) LIMIT 1) prev ON true
       WHERE sn.structure_version_id = $3
       ON CONFLICT DO NOTHING`,
      [current.id, newId, option.versionId, params.actorUserId]
    );
    await client.query(`UPDATE classes SET institution_curriculum_id = $2 WHERE institution_curriculum_id = $1`, [current.id, newId]);
    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '23505') throw new CurriculumManagementError('INVALID_CHANGE');
    throw error;
  } finally {
    client.release();
  }
  await seedFromPublishedStructure(newId, option.versionId, current.canonical_subject_id, params.actorUserId);
  await recordGovernanceEvent({
    institutionId: params.institutionId,
    actorUserId: params.actorUserId,
    actorScope: 'INSTITUTION',
    objectType: 'INSTITUTION_CURRICULUM_SUBJECT',
    objectId: newId,
    action: option.academicSubjectId !== current.base_academic_subject_id ? 'LEVEL_CHANGED' : 'VERSION_CHANGED',
    fields: ['base_academic_subject_id', 'base_structure_version_id'],
    oldValues: { curriculumId: current.id, academicSubjectId: current.base_academic_subject_id, versionId: current.base_structure_version_id },
    newValues: { curriculumId: newId, academicSubjectId: option.academicSubjectId, versionId: option.versionId, level: option.level, version: option.versionLabel, impact: preview },
  });
  return { curriculumId: newId, replaced: true };
}

/** Archive (never delete): the relation stops being active for new classes; classes keep the historical reference; nothing learned is touched. */
export async function archiveInstitutionCurriculumSubject(params: { institutionId: string; curriculumId: string; actorUserId: string; reason?: string | null }) {
  const current = await requireInstitutionCurriculum(params.institutionId, params.curriculumId);
  const usage = await curriculumUsage(current.id);
  await db.query(`UPDATE institution_curricula SET status = 'ARCHIVED', archived_at = now(), archived_by_user_id = $2, archive_reason = $3, updated_at = now() WHERE id = $1`, [
    current.id,
    params.actorUserId,
    params.reason ?? 'ARCHIVED_BY_COORDINATOR',
  ]);
  await recordGovernanceEvent({
    institutionId: params.institutionId,
    actorUserId: params.actorUserId,
    actorScope: 'INSTITUTION',
    objectType: 'INSTITUTION_CURRICULUM_SUBJECT',
    objectId: current.id,
    action: 'SUBJECT_ARCHIVED',
    fields: ['status'],
    oldValues: { status: 'ACTIVE' },
    newValues: { status: 'ARCHIVED', reason: params.reason ?? null, classes: usage.classes.length, students: usage.students },
  });
  return { archived: true, classes: usage.classes.length, students: usage.students };
}

// ---------------------------------------------------------------------------
// Curriculum content (Topic / Structure node → Objective → Concept mapping)
// ---------------------------------------------------------------------------

/** A DATE column as YYYY-MM-DD (pg returns local midnight: local parts, never toISOString). */
const dateOnly = (v: any): string | null =>
  v ? (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10)) : null;

export interface CurriculumContent {
  curriculum: CurriculumSubjectRow;
  structureImported: boolean;
  topics: Array<{
    key: string;
    label: string;
    objectives: Array<{ id: string; code: string | null; description: string; node: string; status: 'INCLUDED' | 'EXCLUDED'; classification: Classification; concepts: Array<{ id: string; label: string }> }>;
  }>;
  concepts: Array<{ id: string; label: string; status: 'INCLUDED' | 'EXCLUDED'; classification: Classification; source: string; institutionTargetDate: string | null; period: string | null }>;
  addable: Array<{ id: string; label: string }>;
}

export async function listInstitutionCurriculumContent(institutionId: string, curriculumId: string, locale: string): Promise<CurriculumContent> {
  const row = await requireInstitutionCurriculum(institutionId, curriculumId, false);
  const curriculum = (await listInstitutionCurriculumSubjects(institutionId, { includeArchived: true })).find((c) => c.curriculumId === curriculumId)!;
  const [nodes, objectives, concepts, subjectConcepts] = await Promise.all([
    row.base_structure_version_id
      ? db.query(`SELECT id, parent_id, COALESCE(source_label, code, '') AS label, order_index FROM structure_nodes WHERE structure_version_id = $1 ORDER BY order_index`, [row.base_structure_version_id])
      : Promise.resolve({ rows: [] as any[] }),
    db.query(
      `SELECT lo.id, lo.code, lo.description, lo.structure_node_id, ico.status, ico.classification,
              COALESCE(array_agg(DISTINCT ocm.canonical_concept_id) FILTER (WHERE ocm.canonical_concept_id IS NOT NULL), '{}') AS concept_ids
       FROM institution_curriculum_objectives ico
       JOIN learning_objectives lo ON lo.id = ico.learning_objective_id
       LEFT JOIN objective_concept_mappings ocm ON ocm.learning_objective_id = lo.id AND ocm.status = 'PUBLISHED' AND ocm.relation_type IN ('FULL', 'PARTIAL')
       WHERE ico.curriculum_id = $1
       GROUP BY lo.id, lo.code, lo.description, lo.structure_node_id, ico.status, ico.classification
       ORDER BY lo.code NULLS LAST, lo.description`,
      [curriculumId]
    ),
    db.query(`SELECT canonical_concept_id, classification, status, source, institution_target_date, period, order_index FROM institution_curriculum_concepts WHERE curriculum_id = $1 ORDER BY order_index, added_at`, [curriculumId]),
    db.query(`SELECT id FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE'`, [row.canonical_subject_id]),
  ]);
  const ids = [...new Set([...concepts.rows.map((c: any) => c.canonical_concept_id), ...subjectConcepts.rows.map((c: any) => c.id), ...objectives.rows.flatMap((o: any) => o.concept_ids)])];
  const labels = await canonicalConceptLabels(ids, locale);
  const nodeBy = new Map<string, any>(nodes.rows.map((n: any) => [n.id, n]));
  const rootOf = (id: string): any => {
    let n = nodeBy.get(id);
    while (n?.parent_id && nodeBy.has(n.parent_id)) n = nodeBy.get(n.parent_id);
    return n;
  };
  const topics = new Map<string, CurriculumContent['topics'][number]>();
  for (const root of nodes.rows.filter((n: any) => !n.parent_id || !nodeBy.has(n.parent_id))) topics.set(root.id, { key: root.id, label: root.label, objectives: [] });
  for (const o of objectives.rows) {
    const root = rootOf(o.structure_node_id);
    const topic = root ? topics.get(root.id) : undefined;
    const item = {
      id: o.id,
      code: o.code,
      description: o.description,
      node: nodeBy.get(o.structure_node_id)?.label ?? '',
      status: o.status,
      classification: o.classification,
      concepts: (o.concept_ids as string[]).map((id) => ({ id, label: labels.get(id) ?? '' })),
    };
    if (topic) topic.objectives.push(item);
  }
  const present = new Set(concepts.rows.map((c: any) => c.canonical_concept_id));
  return {
    curriculum,
    structureImported: curriculum.structureImported,
    topics: [...topics.values()].filter((t) => t.objectives.length > 0),
    concepts: concepts.rows.map((c: any) => ({
      id: c.canonical_concept_id,
      label: labels.get(c.canonical_concept_id) ?? '',
      status: c.status === 'ACTIVE' ? 'INCLUDED' : 'EXCLUDED',
      classification: c.classification,
      source: c.source,
      institutionTargetDate: dateOnly(c.institution_target_date),
      period: c.period,
    })),
    addable: subjectConcepts.rows
      .filter((c: any) => !present.has(c.id))
      .map((c: any) => ({ id: c.id, label: labels.get(c.id) ?? '' }))
      .sort((a: any, b: any) => a.label.localeCompare(b.label)),
  };
}

/**
 * Bulk include / exclude / restore / classify content. Objectives must
 * belong to the curriculum's published version; concepts must be ACTIVE
 * catalog concepts of its subject (adding one = INSTITUTION content).
 * The published structure is never modified.
 */
export async function updateInstitutionCurriculumContentStatus(params: {
  institutionId: string;
  curriculumId: string;
  actorUserId: string;
  objectives?: Array<{ learningObjectiveId: string; status?: 'INCLUDED' | 'EXCLUDED'; classification?: Classification }>;
  concepts?: Array<{ canonicalConceptId: string; status?: 'INCLUDED' | 'EXCLUDED'; classification?: Classification; institutionTargetDate?: string | null; period?: string | null }>;
}): Promise<{ objectives: number; concepts: number }> {
  const row = await requireInstitutionCurriculum(params.institutionId, params.curriculumId);
  let objectivesChanged = 0;
  let conceptsChanged = 0;
  if (params.objectives?.length) {
    const ids = params.objectives.map((o) => o.learningObjectiveId);
    const current = await db.query(`SELECT learning_objective_id, status, classification FROM institution_curriculum_objectives WHERE curriculum_id = $1 AND learning_objective_id = ANY($2::uuid[])`, [row.id, ids]);
    const by = new Map<string, any>(current.rows.map((r: any) => [r.learning_objective_id, r]));
    if (by.size !== new Set(ids).size) throw new CurriculumManagementError('CONTENT_NOT_IN_CURRICULUM');
    for (const o of params.objectives) {
      const before = by.get(o.learningObjectiveId);
      const next = { status: o.status ?? before.status, classification: o.classification ?? before.classification };
      if (next.status === before.status && next.classification === before.classification) continue;
      await db.query(`UPDATE institution_curriculum_objectives SET status = $3, classification = $4, updated_by_user_id = $5, updated_at = now() WHERE curriculum_id = $1 AND learning_objective_id = $2`, [
        row.id,
        o.learningObjectiveId,
        next.status,
        next.classification,
        params.actorUserId,
      ]);
      objectivesChanged += 1;
      // a batch may touch the same objective twice (e.g. restore + classify): later items see the earlier result
      by.set(o.learningObjectiveId, { ...before, ...next });
      await recordGovernanceEvent({
        institutionId: params.institutionId,
        actorUserId: params.actorUserId,
        actorScope: 'INSTITUTION',
        objectType: 'INSTITUTION_CURRICULUM_OBJECTIVE',
        objectId: o.learningObjectiveId,
        action: next.status !== before.status ? (next.status === 'EXCLUDED' ? 'CONTENT_EXCLUDED' : 'CONTENT_INCLUDED') : 'STATUS_CHANGED',
        fields: ['status', 'classification'].filter((f) => (next as any)[f] !== before[f]),
        oldValues: { curriculumId: row.id, status: before.status, classification: before.classification },
        newValues: { curriculumId: row.id, ...next },
      });
    }
  }
  if (params.concepts?.length) {
    const ids = params.concepts.map((c) => c.canonicalConceptId);
    // A concept of the curriculum's catalog subject, or -- governed equivalence -- of a catalog subject of the
    // SAME academic domain (e.g. a concept shared by SEP Matemáticas and Cambridge Mathematics). Never another domain.
    const valid = await db.query(
      `SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects s ON s.id = cc.canonical_subject_id
        JOIN canonical_subjects mine ON mine.id = $2
        WHERE cc.id = ANY($1::uuid[]) AND cc.status = 'ACTIVE'
          AND (cc.canonical_subject_id = $2 OR (mine.academic_domain_code IS NOT NULL AND s.academic_domain_code = mine.academic_domain_code))`,
      [ids, row.canonical_subject_id]
    );
    if (valid.rows.length !== new Set(ids).size) throw new CurriculumManagementError('CONTENT_NOT_IN_CURRICULUM');
    const current = await db.query(`SELECT canonical_concept_id, status, classification, institution_target_date, period FROM institution_curriculum_concepts WHERE curriculum_id = $1 AND canonical_concept_id = ANY($2::uuid[])`, [row.id, ids]);
    const by = new Map<string, any>(current.rows.map((r: any) => [r.canonical_concept_id, r]));
    for (const c of params.concepts) {
      const before = by.get(c.canonicalConceptId);
      const status = c.status === 'EXCLUDED' ? 'REMOVED' : c.status === 'INCLUDED' ? 'ACTIVE' : before?.status ?? 'ACTIVE';
      const next = {
        status,
        classification: c.classification ?? before?.classification ?? 'RECOMMENDED',
        institution_target_date: c.institutionTargetDate !== undefined ? c.institutionTargetDate : before?.institution_target_date ?? null,
        period: c.period !== undefined ? c.period : before?.period ?? null,
      };
      const comparable = (v: unknown) => (v instanceof Date ? dateOnly(v) : String(v ?? ''));
      const fields = (['status', 'classification', 'institution_target_date', 'period'] as const).filter((f) => comparable(before?.[f]) !== comparable((next as any)[f]));
      if (before && fields.length === 0) continue;
      await db.query(
        `INSERT INTO institution_curriculum_concepts (curriculum_id, canonical_concept_id, classification, status, institution_target_date, period, order_index, added_by_user_id, source)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM institution_curriculum_concepts WHERE curriculum_id = $1), $7, 'INSTITUTION')
         ON CONFLICT (curriculum_id, canonical_concept_id) DO UPDATE SET classification = EXCLUDED.classification, status = EXCLUDED.status,
           institution_target_date = EXCLUDED.institution_target_date, period = EXCLUDED.period, updated_at = now(),
           removed_at = CASE WHEN EXCLUDED.status = 'REMOVED' THEN now() ELSE NULL END,
           removed_by_user_id = CASE WHEN EXCLUDED.status = 'REMOVED' THEN $7 ELSE NULL END`,
        [row.id, c.canonicalConceptId, next.classification, next.status, next.institution_target_date, next.period, params.actorUserId]
      );
      conceptsChanged += 1;
      by.set(c.canonicalConceptId, { ...(before ?? {}), ...next });
      await recordGovernanceEvent({
        institutionId: params.institutionId,
        actorUserId: params.actorUserId,
        actorScope: 'INSTITUTION',
        objectType: 'INSTITUTION_CURRICULUM_CONCEPT',
        objectId: c.canonicalConceptId,
        action: !before ? 'CONTENT_ADDED' : next.status !== before.status ? (next.status === 'REMOVED' ? 'CONTENT_EXCLUDED' : 'CONTENT_INCLUDED') : 'STATUS_CHANGED',
        fields,
        oldValues: { curriculumId: row.id, ...(before ? Object.fromEntries(fields.map((f) => [f, before[f]])) : {}) },
        newValues: { curriculumId: row.id, ...Object.fromEntries(fields.map((f) => [f, (next as any)[f]])) },
      });
    }
  }
  return { objectives: objectivesChanged, concepts: conceptsChanged };
}

// ---------------------------------------------------------------------------
// Class association
// ---------------------------------------------------------------------------

/** The canonical academic domains with their label in a language (e.g. MATHEMATICS -> Matemáticas). */
export async function listAcademicDomains(locale: string): Promise<Array<{ code: string; label: string }>> {
  const r = await db.query(`SELECT code, labels FROM canonical_academic_domains WHERE status = 'ACTIVE' ORDER BY code`);
  return r.rows.map((x: any) => ({ code: x.code, label: x.labels?.[locale] ?? x.labels?.en ?? x.code }));
}

/** A class's academic domain: its own (set by a coordinator), else its catalog subject's. */
export async function classAcademicDomain(classId: string): Promise<string | null> {
  const r = await db.query(`SELECT COALESCE(c.academic_domain_code, cs.academic_domain_code) AS d FROM classes c LEFT JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id WHERE c.id = $1`, [classId]);
  return r.rows[0]?.d ?? null;
}

/**
 * Candidates for a class's "Currículo asociado": EVERY active curriculum of the
 * institution, the compatible ones (same academic domain, usable for the grade)
 * first. A suggestion only -- nothing is bound here.
 */
export async function compatibleCurriculaForClass(institutionId: string, gradeId: string | null, academicDomain: string | null = null) {
  const all = await listInstitutionCurriculumSubjects(institutionId);
  return rankCurriculumCandidates(all, { academicDomain, gradeId }).map((r) => ({ ...r.curriculum, compatible: r.compatible, compatibility: r.reason }));
}

export interface ClassBindingImpact {
  classId: string;
  current: { curriculumId: string; label: string } | null;
  next: { curriculumId: string; label: string } | null;
  activeStudents: number;
  planConcepts: number;
  /** Class plan concepts the new curriculum does not include (kept in the plan, shown as outside the curriculum). */
  planConceptsOutsideNext: number;
  requiresConfirmation: boolean;
}

/** What changing a class's curriculum touches. Learner history is never touched. */
export async function classBindingImpact(institutionId: string, classId: string, nextCurriculumId: string | null): Promise<ClassBindingImpact> {
  const klass = (await db.query(`SELECT id, institution_id, institution_curriculum_id FROM classes WHERE id = $1`, [classId])).rows[0];
  if (!klass || klass.institution_id !== institutionId) throw new CurriculumManagementError('CLASS_NOT_IN_INSTITUTION');
  const all = await listInstitutionCurriculumSubjects(institutionId, { includeArchived: true });
  const cur = all.find((c) => c.curriculumId === klass.institution_curriculum_id) ?? null;
  const next = nextCurriculumId ? all.find((c) => c.curriculumId === nextCurriculumId && c.status === 'ACTIVE') ?? null : null;
  if (nextCurriculumId && !next) throw new CurriculumManagementError('NOT_FOUND');
  const [students, plan] = await Promise.all([
    db.query(`SELECT COUNT(DISTINCT student_id)::int AS n FROM class_enrollments WHERE class_id = $1 AND status = 'ACTIVE'`, [classId]),
    db.query(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE $2::uuid IS NULL OR NOT EXISTS (SELECT 1 FROM institution_curriculum_concepts icc WHERE icc.curriculum_id = $2 AND icc.canonical_concept_id = cpc.canonical_concept_id AND icc.status = 'ACTIVE'))::int AS outside
         FROM class_plan_concepts cpc WHERE cpc.class_id = $1 AND cpc.status = 'ACTIVE'`,
      [classId, next?.curriculumId ?? null]
    ),
  ]);
  const changing = (cur?.curriculumId ?? null) !== (next?.curriculumId ?? null);
  return {
    classId,
    current: cur ? { curriculumId: cur.curriculumId, label: curriculumContextLabel(cur) } : null,
    next: next ? { curriculumId: next.curriculumId, label: curriculumContextLabel(next) } : null,
    activeStudents: students.rows[0].n,
    planConcepts: plan.rows[0].n,
    planConceptsOutsideNext: plan.rows[0].outside,
    // Re-binding (or unbinding) a class that already has a curriculum or a plan needs an explicit "yes".
    requiresConfirmation: changing && (!!cur || plan.rows[0].n > 0),
  };
}

/**
 * EXPLICIT class <-> curriculum binding (the only way a class gets a curriculum).
 *   - the curriculum must be an ACTIVE curriculum of THIS institution (foreign -> NOT_FOUND);
 *   - it must share the class's academic domain (a translation of the name is never enough,
 *     a different domain is refused: DOMAIN_MISMATCH);
 *   - changing / removing an existing binding (or binding a class with a plan) needs confirmImpact;
 *   - enrollments, class plan concepts, learner state and evidence are NEVER modified; what the
 *     class plan derives from the curriculum (classifications, required concepts) follows the new one.
 * `curriculumId: null` removes the binding (explicit).
 */
export async function assignClassCurriculum(params: { institutionId: string; classId: string; curriculumId: string | null; actorUserId: string; confirmImpact?: boolean }) {
  const klass = (await db.query(`SELECT id, institution_id, grade_id, canonical_subject_id, institution_curriculum_id, academic_domain_code FROM classes WHERE id = $1`, [params.classId])).rows[0];
  if (!klass || klass.institution_id !== params.institutionId) throw new CurriculumManagementError('CLASS_NOT_IN_INSTITUTION');
  const curriculum = params.curriculumId ? await requireInstitutionCurriculum(params.institutionId, params.curriculumId) : null; // cross-tenant → NOT_FOUND
  if (curriculum && curriculum.id === klass.institution_curriculum_id) return { classId: params.classId, curriculumId: curriculum.id, changed: false };
  const classDomain = await classAcademicDomain(params.classId);
  const curriculumDomain = curriculum ? ((await db.query(`SELECT academic_domain_code FROM canonical_subjects WHERE id = $1`, [curriculum.canonical_subject_id])).rows[0]?.academic_domain_code ?? null) : null;
  if (curriculum && !bindingDomainAllowed(classDomain, curriculumDomain)) throw new CurriculumManagementError('DOMAIN_MISMATCH');
  const impact = await classBindingImpact(params.institutionId, params.classId, curriculum?.id ?? null);
  if (impact.requiresConfirmation && !params.confirmImpact) throw new CurriculumManagementError('IMPACT_CONFIRMATION_REQUIRED');
  if (curriculum) {
    // The class keeps its name and its domain; its concept catalogue follows the chosen curriculum.
    await db.query(`UPDATE classes SET institution_curriculum_id = $2, canonical_subject_id = $3, academic_domain_code = COALESCE(academic_domain_code, $4), grade_id = COALESCE(grade_id, $5) WHERE id = $1`, [
      params.classId,
      curriculum.id,
      curriculum.canonical_subject_id,
      curriculumDomain,
      curriculum.grade_id,
    ]);
  } else {
    await db.query(`UPDATE classes SET institution_curriculum_id = NULL WHERE id = $1`, [params.classId]);
  }
  await recordGovernanceEvent({
    institutionId: params.institutionId,
    actorUserId: params.actorUserId,
    actorScope: 'INSTITUTION',
    objectType: 'CLASS',
    objectId: params.classId,
    action: curriculum ? (klass.institution_curriculum_id ? 'CLASS_CURRICULUM_CHANGED' : 'CLASS_CURRICULUM_ASSIGNED') : 'CLASS_CURRICULUM_REMOVED',
    fields: ['institution_curriculum_id'],
    oldValues: { curriculumId: klass.institution_curriculum_id, label: impact.current?.label ?? null },
    newValues: { curriculumId: curriculum?.id ?? null, label: impact.next?.label ?? null, planConceptsOutside: impact.planConceptsOutsideNext, activeStudents: impact.activeStudents },
  });
  return { classId: params.classId, curriculumId: curriculum?.id ?? null, changed: true };
}

// ---------------------------------------------------------------------------
// Coverage (ANALYTICS) -- batched aggregates, never mastery
// ---------------------------------------------------------------------------

export interface CurriculumCoverageRow {
  curriculumId: string;
  subject: string;
  code: string | null;
  level: string | null;
  versionLabel: string | null;
  programme: string | null;
  gradeName: string | null;
  sourceType: string;
  classes: number;
  students: number;
  total: number;
  inClassPlans: number;
  inStudentPlans: number;
  pending: number;
  bySource: { AUTHORITY: number; INSTITUTION: number; TEACHER_SUPPLEMENTAL: number };
  teacherSupplemental: number;
  objectivesIncluded: number;
  objectivesWithConcept: number;
}

export async function getInstitutionCurriculumCoverage(institutionId: string, filter: { programmeId?: string | null; gradeId?: string | null } = {}): Promise<CurriculumCoverageRow[]> {
  const subjects = (await listInstitutionCurriculumSubjects(institutionId)).filter((s) => (!filter.programmeId || s.programmeId === filter.programmeId) && (!filter.gradeId || s.gradeId === filter.gradeId));
  if (subjects.length === 0) return [];
  const r = await db.query(
    `WITH cur AS (SELECT unnest($1::uuid[]) AS id),
          k AS (SELECT c.id AS class_id, c.institution_curriculum_id AS cid FROM classes c JOIN cur ON cur.id = c.institution_curriculum_id WHERE c.institution_id = $2),
          learners AS (SELECT DISTINCT k.cid, ce.student_id FROM class_enrollments ce JOIN k ON k.class_id = ce.class_id WHERE ce.status = 'ACTIVE'),
          content AS (SELECT icc.curriculum_id AS cid, icc.canonical_concept_id, icc.source FROM institution_curriculum_concepts icc JOIN cur ON cur.id = icc.curriculum_id WHERE icc.status = 'ACTIVE'),
          in_class AS (SELECT DISTINCT k.cid, cpc.canonical_concept_id FROM class_plan_concepts cpc JOIN k ON k.class_id = cpc.class_id WHERE cpc.status = 'ACTIVE'),
          in_student AS (SELECT DISTINCT l.cid, e.canonical_concept_id FROM student_plan_entries e JOIN learners l ON l.student_id = e.student_id WHERE e.plan_status = 'IN_PLAN')
     SELECT cur.id,
       (SELECT COUNT(*) FROM content x WHERE x.cid = cur.id)::int AS total,
       (SELECT COUNT(*) FROM content x WHERE x.cid = cur.id AND EXISTS (SELECT 1 FROM in_class p WHERE p.cid = cur.id AND p.canonical_concept_id = x.canonical_concept_id))::int AS in_class,
       (SELECT COUNT(*) FROM content x WHERE x.cid = cur.id AND EXISTS (SELECT 1 FROM in_student s WHERE s.cid = cur.id AND s.canonical_concept_id = x.canonical_concept_id))::int AS in_student,
       (SELECT COUNT(*) FROM content x WHERE x.cid = cur.id AND NOT EXISTS (SELECT 1 FROM in_class p WHERE p.cid = cur.id AND p.canonical_concept_id = x.canonical_concept_id)
                                                          AND NOT EXISTS (SELECT 1 FROM in_student s WHERE s.cid = cur.id AND s.canonical_concept_id = x.canonical_concept_id))::int AS pending,
       (SELECT COUNT(*) FROM content x WHERE x.cid = cur.id AND x.source = 'AUTHORITY')::int AS src_authority,
       (SELECT COUNT(*) FROM content x WHERE x.cid = cur.id AND x.source = 'INSTITUTION')::int AS src_institution,
       (SELECT COUNT(*) FROM content x WHERE x.cid = cur.id AND x.source = 'TEACHER_SUPPLEMENTAL')::int AS src_teacher,
       (SELECT COUNT(*) FROM in_class p WHERE p.cid = cur.id AND NOT EXISTS (SELECT 1 FROM content x WHERE x.cid = cur.id AND x.canonical_concept_id = p.canonical_concept_id))::int AS teacher_supplemental,
       (SELECT COUNT(*) FROM institution_curriculum_objectives o WHERE o.curriculum_id = cur.id AND o.status = 'INCLUDED')::int AS objectives_included,
       (SELECT COUNT(*) FROM institution_curriculum_objectives o WHERE o.curriculum_id = cur.id AND o.status = 'INCLUDED' AND EXISTS (
          SELECT 1 FROM objective_concept_mappings ocm WHERE ocm.learning_objective_id = o.learning_objective_id AND ocm.status = 'PUBLISHED'))::int AS objectives_with_concept
     FROM cur`,
    [subjects.map((s) => s.curriculumId), institutionId]
  );
  const by = new Map<string, any>(r.rows.map((x: any) => [x.id, x]));
  return subjects.map((s) => {
    const x = by.get(s.curriculumId) ?? {};
    return {
      curriculumId: s.curriculumId,
      subject: s.subject,
      code: s.code,
      level: s.level,
      versionLabel: s.versionLabel,
      programme: s.programme,
      gradeName: s.gradeName,
      sourceType: s.sourceType,
      classes: s.classes,
      students: s.students,
      total: x.total ?? 0,
      inClassPlans: x.in_class ?? 0,
      inStudentPlans: x.in_student ?? 0,
      pending: x.pending ?? 0,
      bySource: { AUTHORITY: x.src_authority ?? 0, INSTITUTION: x.src_institution ?? 0, TEACHER_SUPPLEMENTAL: x.src_teacher ?? 0 },
      teacherSupplemental: x.teacher_supplemental ?? 0,
      objectivesIncluded: x.objectives_included ?? 0,
      objectivesWithConcept: x.objectives_with_concept ?? 0,
    };
  });
}

/** Subject drill-down: topics / objectives / concepts with class-plan and student-plan coverage (counts). */
export async function getCurriculumSubjectCoverage(institutionId: string, curriculumId: string, locale: string) {
  const content = await listInstitutionCurriculumContent(institutionId, curriculumId, locale);
  const conceptIds = [...new Set([...content.concepts.map((c) => c.id), ...content.topics.flatMap((t) => t.objectives.flatMap((o) => o.concepts.map((c) => c.id)))])];
  const r = await db.query(
    `WITH k AS (SELECT id FROM classes WHERE institution_curriculum_id = $1 AND institution_id = $2),
          learners AS (SELECT DISTINCT ce.student_id FROM class_enrollments ce WHERE ce.class_id IN (SELECT id FROM k) AND ce.status = 'ACTIVE')
     SELECT x.id,
       (SELECT COUNT(DISTINCT cpc.class_id) FROM class_plan_concepts cpc WHERE cpc.class_id IN (SELECT id FROM k) AND cpc.canonical_concept_id = x.id AND cpc.status = 'ACTIVE')::int AS classes,
       (SELECT COUNT(*) FROM student_plan_entries e WHERE e.student_id IN (SELECT student_id FROM learners) AND e.canonical_concept_id = x.id AND e.plan_status = 'IN_PLAN')::int AS students
     FROM unnest($3::uuid[]) AS x(id)`,
    [curriculumId, institutionId, conceptIds]
  );
  const cov = new Map<string, { classes: number; students: number }>(r.rows.map((x: any) => [x.id, { classes: x.classes, students: x.students }]));
  return {
    ...content,
    coverage: Object.fromEntries(conceptIds.map((id) => [id, cov.get(id) ?? { classes: 0, students: 0 }])) as Record<string, { classes: number; students: number }>,
  };
}
