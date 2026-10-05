/**
 * Preview integration (R1) -- one resolution of a learner's exam preparation
 * profile into the governed exam structure, for both profile kinds:
 *
 *   definition-based  exam_definition_id (and optionally exam_version_id):
 *                     the existing path -- the pinned version, else the latest
 *                     PUBLISHED version of the definition.
 *   objective-first   exam_definition_id IS NULL, objective_key set (Track B
 *                     20261025): governed objective (objective catalogue) ->
 *                     its configured verticals (config keys) -> their exam
 *                     definitions -> latest PUBLISHED version of each.
 *
 * Downstream, versions lead to blueprint targets -> learning objectives ->
 * PUBLISHED objective_concept_mappings -> canonical concepts (unchanged).
 * Nothing is invented: when no definition / version can be resolved the
 * profile is MAPPING_NOT_AVAILABLE -- reported, never silently dropped.
 */
import { examAudienceOf } from '@/lib/exam-core/audience';
import { db } from '@/lib/db';
import { objectiveByKey } from '@/lib/exam-core/objectives/objective-catalog';

export type ExamMappingStatus = 'MAPPED' | 'MAPPING_NOT_AVAILABLE';

export interface ProfileForResolution {
  id: string;
  examDefinitionId: string | null;
  examVersionId: string | null;
  objectiveKey: string | null;
  objectiveContext: unknown;
}

export interface ResolvedExamProfile {
  profileId: string;
  /** Display name: definition name -> objective label -> objective key. */
  name: string;
  definitionIds: string[];
  versionIds: string[];
  academicSubjectIds: string[];
  source: 'DEFINITION' | 'OBJECTIVE' | 'NONE';
  mappingStatus: ExamMappingStatus;
}

const contextLabel = (ctx: unknown): string | null => {
  const label = ctx && typeof ctx === 'object' ? (ctx as { label?: unknown }).label : null;
  return typeof label === 'string' && label.trim() ? label : null;
};

/** Batched: one query for definitions + latest published versions, whatever the number of profiles. */
export async function resolveExamProfiles(profiles: ProfileForResolution[]): Promise<Map<string, ResolvedExamProfile>> {
  const out = new Map<string, ResolvedExamProfile>();
  if (profiles.length === 0) return out;
  const objectiveOf = new Map(profiles.map((p) => [p.id, !p.examDefinitionId && p.objectiveKey ? objectiveByKey(p.objectiveKey) : null]));
  const definitionIds = [...new Set(profiles.map((p) => p.examDefinitionId).filter(Boolean))] as string[];
  const configKeys = [...new Set([...objectiveOf.values()].flatMap((o) => o?.configKeys ?? []))];
  const rows = (await db.query(
    `SELECT d.id, d.name, d.config_key, d.academic_subject_id,
            (SELECT v.id FROM exam_versions v WHERE v.exam_definition_id = d.id AND v.status = 'PUBLISHED' ORDER BY v.created_at DESC LIMIT 1) AS latest_version_id
       FROM exam_definitions d
      WHERE d.id = ANY($1::uuid[]) OR (d.config_key = ANY($2::text[]) AND d.status IN ('ACTIVE', 'DRAFT'))`,
    [definitionIds, configKeys]
  )).rows as Array<{ id: string; name: string; config_key: string | null; academic_subject_id: string | null; latest_version_id: string | null }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const p of profiles) {
    if (p.examDefinitionId) {
      const d = byId.get(p.examDefinitionId);
      // QB-0: a technical / internal exam (dev-cert.*, legacy pilot) never resolves into a Student plan.
      if (d && examAudienceOf(d.config_key) !== 'STUDENT') continue;
      const versionId = p.examVersionId ?? d?.latest_version_id ?? null;
      out.set(p.id, {
        profileId: p.id,
        name: d?.name ?? contextLabel(p.objectiveContext) ?? p.objectiveKey ?? '',
        definitionIds: d ? [d.id] : [],
        versionIds: versionId ? [versionId] : [],
        academicSubjectIds: d?.academic_subject_id ? [d.academic_subject_id] : [],
        source: 'DEFINITION',
        mappingStatus: versionId ? 'MAPPED' : 'MAPPING_NOT_AVAILABLE',
      });
      continue;
    }
    const o = objectiveOf.get(p.id);
    const defs = o ? rows.filter((r) => r.config_key && o.configKeys.includes(r.config_key)) : [];
    const versionIds = [...new Set([p.examVersionId, ...defs.map((d) => d.latest_version_id)].filter(Boolean))] as string[];
    out.set(p.id, {
      profileId: p.id,
      name: o?.label ?? contextLabel(p.objectiveContext) ?? p.objectiveKey ?? '',
      definitionIds: defs.map((d) => d.id),
      versionIds,
      academicSubjectIds: [...new Set(defs.map((d) => d.academic_subject_id).filter(Boolean))] as string[],
      source: o ? 'OBJECTIVE' : 'NONE',
      mappingStatus: versionIds.length ? 'MAPPED' : 'MAPPING_NOT_AVAILABLE',
    });
  }
  return out;
}

/** Profiles of these learners (any kind), as the resolver needs them. */
export async function learnerExamProfiles(studentIds: string[], where: 'ACTIVE' | 'NOT_ARCHIVED' = 'NOT_ARCHIVED') {
  if (studentIds.length === 0) return [];
  const r = await db.query(
    `SELECT id, student_id, exam_definition_id, exam_version_id, objective_key, objective_context, exam_date, created_at
       FROM student_exam_profiles
      WHERE student_id = ANY($1::uuid[]) AND ${where === 'ACTIVE' ? "status = 'ACTIVE'" : "status <> 'ARCHIVED'"}
      ORDER BY created_at DESC`,
    [studentIds]
  );
  return r.rows.map((x: any) => ({
    id: x.id as string,
    studentId: x.student_id as string,
    examDefinitionId: (x.exam_definition_id as string | null) ?? null,
    examVersionId: (x.exam_version_id as string | null) ?? null,
    objectiveKey: (x.objective_key as string | null) ?? null,
    objectiveContext: x.objective_context,
    examDate: x.exam_date as string | Date | null,
  }));
}
