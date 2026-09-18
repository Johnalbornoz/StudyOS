/**
 * F6 -- Organization / Programme / Qualification / Subject (task 6/7).
 * Shared, canonical, framework-scoped catalog data -- no student_id
 * anywhere, no F2 authorization dependency (read access is not
 * learner-scoped; only editorial WRITE actions require a grant, enforced
 * in mapping/resource/editorial services, not here).
 */
import { db } from '@/lib/db';
import type { AcademicOrganization, AcademicProgramme, AcademicQualification, AcademicSubject, ProgrammeType } from './types';

export async function createOrganization(name: string): Promise<AcademicOrganization> {
  const result = await db.query(`INSERT INTO academic_organizations (name) VALUES ($1) RETURNING id, name, status`, [name]);
  return result.rows[0];
}

export async function listOrganizations(): Promise<AcademicOrganization[]> {
  const result = await db.query(`SELECT id, name, status FROM academic_organizations ORDER BY name`);
  return result.rows;
}

export async function createProgramme(params: { organizationId: string; name: string; programmeType: ProgrammeType; stage?: string }): Promise<AcademicProgramme> {
  const result = await db.query(
    `INSERT INTO academic_programmes (organization_id, name, programme_type, stage) VALUES ($1, $2, $3, $4)
     RETURNING id, organization_id, name, programme_type, stage, status`,
    [params.organizationId, params.name, params.programmeType, params.stage ?? null]
  );
  return toProgramme(result.rows[0]);
}

function toProgramme(r: any): AcademicProgramme {
  return { id: r.id, organizationId: r.organization_id, name: r.name, programmeType: r.programme_type, stage: r.stage, status: r.status };
}

export async function listProgrammes(organizationId: string): Promise<AcademicProgramme[]> {
  const result = await db.query(`SELECT id, organization_id, name, programme_type, stage, status FROM academic_programmes WHERE organization_id = $1 ORDER BY name`, [organizationId]);
  return result.rows.map(toProgramme);
}

export async function createQualification(params: { programmeId: string; name: string }): Promise<AcademicQualification> {
  const result = await db.query(
    `INSERT INTO academic_qualifications (programme_id, name) VALUES ($1, $2) RETURNING id, programme_id, name, status`,
    [params.programmeId, params.name]
  );
  const r = result.rows[0];
  return { id: r.id, programmeId: r.programme_id, name: r.name, status: r.status };
}

export async function createSubject(params: { programmeId: string; qualificationId?: string; name: string; level?: string }): Promise<AcademicSubject> {
  const result = await db.query(
    `INSERT INTO academic_subjects (programme_id, qualification_id, name, level) VALUES ($1, $2, $3, $4)
     RETURNING id, programme_id, qualification_id, name, level, status`,
    [params.programmeId, params.qualificationId ?? null, params.name, params.level ?? null]
  );
  const r = result.rows[0];
  return { id: r.id, programmeId: r.programme_id, qualificationId: r.qualification_id, name: r.name, level: r.level, status: r.status };
}

export async function getSubject(subjectId: string): Promise<AcademicSubject | null> {
  const result = await db.query(`SELECT id, programme_id, qualification_id, name, level, status FROM academic_subjects WHERE id = $1`, [subjectId]);
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return { id: r.id, programmeId: r.programme_id, qualificationId: r.qualification_id, name: r.name, level: r.level, status: r.status };
}
