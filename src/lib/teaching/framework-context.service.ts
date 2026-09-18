/**
 * F8 -- framework identity resolution (task §14). No table stores
 * "framework identity" directly; both resolvers walk the existing
 * joins verbatim and fail to `null` rather than guessing, matching
 * resolveActivityMetadataForObjective's own discipline. See
 * F8_FRAMEWORK_AWARE_TEACHING_MODEL.md.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { FrameworkIdentity } from './types';

/** student_exam_profiles (ACTIVE) -> exam_versions -> exam_definitions -> academic_programmes -> academic_organizations. */
export async function resolveFrameworkForStudentExamProfile(studentId: string, client: DbExecutor = db): Promise<FrameworkIdentity | null> {
  const result = await client.query(
    `
    SELECT
      ed.id AS exam_definition_id,
      ed.exam_family,
      ev.id AS exam_version_id,
      ap.id AS academic_programme_id,
      ap.programme_type,
      ao.id AS academic_organization_id,
      ao.name AS academic_organization_name
    FROM student_exam_profiles sep
    JOIN exam_definitions ed ON ed.id = sep.exam_definition_id
    LEFT JOIN exam_versions ev ON ev.id = sep.exam_version_id
    LEFT JOIN academic_programmes ap ON ap.id = ed.academic_programme_id
    LEFT JOIN academic_organizations ao ON ao.id = ap.organization_id
    WHERE sep.student_id = $1 AND sep.status = 'ACTIVE'
    ORDER BY sep.created_at DESC
    LIMIT 1
    `,
    [studentId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!row.academic_programme_id || !row.academic_organization_id) return null;

  return {
    academicOrganizationId: row.academic_organization_id,
    academicOrganizationName: row.academic_organization_name,
    academicProgrammeId: row.academic_programme_id,
    programmeType: row.programme_type,
    examDefinitionId: row.exam_definition_id,
    examVersionId: row.exam_version_id ?? undefined,
    examFamily: row.exam_family,
  };
}

/** learning_objectives -> structure_nodes -> structure_versions -> academic_subjects -> academic_programmes -> academic_organizations. */
export async function resolveFrameworkForObjective(learningObjectiveId: string, client: DbExecutor = db): Promise<FrameworkIdentity | null> {
  const result = await client.query(
    `
    SELECT
      ap.id AS academic_programme_id,
      ap.programme_type,
      ao.id AS academic_organization_id,
      ao.name AS academic_organization_name
    FROM learning_objectives lo
    JOIN structure_nodes sn ON sn.id = lo.structure_node_id
    JOIN structure_versions sv ON sv.id = sn.structure_version_id
    JOIN academic_subjects asub ON asub.id = sv.academic_subject_id
    JOIN academic_programmes ap ON ap.id = asub.programme_id
    JOIN academic_organizations ao ON ao.id = ap.organization_id
    WHERE lo.id = $1
    LIMIT 1
    `,
    [learningObjectiveId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    academicOrganizationId: row.academic_organization_id,
    academicOrganizationName: row.academic_organization_name,
    academicProgrammeId: row.academic_programme_id,
    programmeType: row.programme_type,
  };
}
