import { db } from '@/lib/db';
import { canAccessInstitution } from '@/lib/authorization';
import { hasRole } from '@/lib/identity';

export class InstitutionIntelligenceAccessDeniedError extends Error {
  constructor() { super('Institution intelligence access denied'); this.name = 'InstitutionIntelligenceAccessDeniedError'; }
}
export class InstitutionIntelligenceInputError extends Error {
  constructor() { super('Invalid institution intelligence scope'); this.name = 'InstitutionIntelligenceInputError'; }
}

export interface InstitutionIntelligenceOverview {
  institutionId: string;
  activeLearnerCount: number | null;
  minimumCohortSize: number;
  suppressed: boolean;
  grades: Array<{ gradeId: string; name: string; activeLearnerCount: number | null; suppressed: boolean }>;
  classes: Array<{ classId: string; gradeId: string | null; name: string; activeLearnerCount: number | null; suppressed: boolean }>;
}
const MINIMUM_COHORT_SIZE = 10;

async function canCoordinateInstitution(actorUserId: string, institutionId: string) {
  if (await hasRole(actorUserId, 'STUDYUS_ADMIN')) return true;
  if (await canAccessInstitution(actorUserId, institutionId, 'INSTITUTION_MEMBER_APPROVE')) return true;
  const result = await db.query(
    `SELECT 1 FROM institution_memberships
     WHERE user_id=$1 AND institution_id=$2 AND membership_role='ACADEMIC_COORDINATOR' AND status='APPROVED' LIMIT 1`,
    [actorUserId, institutionId]
  );
  return result.rows.length > 0;
}

export async function getInstitutionIntelligenceOverview(actorUserId: string, institutionId: string): Promise<InstitutionIntelligenceOverview> {
  if (!(await canCoordinateInstitution(actorUserId, institutionId))) throw new InstitutionIntelligenceAccessDeniedError();
  const institution = await db.query(`SELECT 1 FROM institutions WHERE id=$1 AND status='ACTIVE'`, [institutionId]);
  if (!institution.rows.length) throw new InstitutionIntelligenceInputError();
  const [total, grades, classes] = await Promise.all([
    db.query(`SELECT COUNT(DISTINCT ce.student_id)::int AS count FROM class_enrollments ce JOIN classes c ON c.id=ce.class_id WHERE c.institution_id=$1 AND ce.status='ACTIVE'`, [institutionId]),
    db.query(`SELECT g.id, g.name, COUNT(DISTINCT ce.student_id)::int AS count FROM grades g LEFT JOIN classes c ON c.grade_id=g.id LEFT JOIN class_enrollments ce ON ce.class_id=c.id AND ce.status='ACTIVE' WHERE g.institution_id=$1 GROUP BY g.id,g.name ORDER BY g.name`, [institutionId]),
    db.query(`SELECT c.id, c.grade_id, c.name, COUNT(DISTINCT ce.student_id)::int AS count FROM classes c LEFT JOIN class_enrollments ce ON ce.class_id=c.id AND ce.status='ACTIVE' WHERE c.institution_id=$1 GROUP BY c.id,c.grade_id,c.name ORDER BY c.name`, [institutionId]),
  ]);
  const count = Number(total.rows[0]?.count ?? 0);
  const segment = (r: any) => { const n = Number(r.count); return { activeLearnerCount: n < MINIMUM_COHORT_SIZE ? null : n, suppressed: n < MINIMUM_COHORT_SIZE }; };
  return {
    institutionId, activeLearnerCount: count < MINIMUM_COHORT_SIZE ? null : count, minimumCohortSize: MINIMUM_COHORT_SIZE, suppressed: count < MINIMUM_COHORT_SIZE,
    grades: grades.rows.map((r:any) => ({ gradeId:r.id, name:r.name, ...segment(r) })),
    classes: classes.rows.map((r:any) => ({ classId:r.id, gradeId:r.grade_id, name:r.name, ...segment(r) })),
  };
}

export async function getAccessibleInstitutionIntelligenceInstitutions(actorUserId: string) {
  if (await hasRole(actorUserId, 'STUDYUS_ADMIN')) {
    const result = await db.query(`SELECT id, name FROM institutions WHERE status='ACTIVE' ORDER BY name`);
    return result.rows.map((r:any) => ({ institutionId:r.id, name:r.name }));
  }
  const result = await db.query(`SELECT DISTINCT i.id, i.name FROM institutions i JOIN institution_memberships im ON im.institution_id=i.id WHERE i.status='ACTIVE' AND im.user_id=$1 AND im.status='APPROVED' AND im.membership_role IN ('INSTITUTION_ADMIN','ACADEMIC_COORDINATOR') ORDER BY i.name`, [actorUserId]);
  return result.rows.map((r:any) => ({ institutionId:r.id, name:r.name }));
}
