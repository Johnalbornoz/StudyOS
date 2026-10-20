/**
 * Exam V2 -- DEV fixture reset (section 48).
 *
 * Lets a tester repeat a manual E2E from zero: removes ONE Student's exam
 * practice data on FIXTURE exam versions (instances, attempts, plans,
 * responses, results, assessments, submissions, media, item usage, concept
 * proposal requests). It never touches:
 *   - non-fixture exam versions or any other Student;
 *   - the Student's learning evidence / mastery (real learning history);
 *   - exam content (definitions, versions, items).
 *
 * Refuses unless ALL hold: the database fingerprint is the DEV one (or an
 * explicitly allowed ephemeral DB), the runtime is not production, and the
 * caller passes `confirm: 'RESET-DEV-FIXTURES'`. Runs in one transaction.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';

export const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';

export class FixtureResetRefusedError extends Error {
  constructor(reason: string) {
    super(`FIXTURE_RESET_REFUSED: ${reason}`);
    this.name = 'FixtureResetRefusedError';
  }
}

export function databaseFingerprint(url = process.env.DATABASE_URL ?? ''): string {
  const u = new URL(url);
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

export function assertResetAllowed(confirm: string, env: NodeJS.ProcessEnv = process.env): void {
  if (confirm !== 'RESET-DEV-FIXTURES') throw new FixtureResetRefusedError('confirmation phrase missing');
  if (env.VERCEL_ENV === 'production' || env.STUDYUS_ENV === 'production') throw new FixtureResetRefusedError('production runtime');
  let fp: string;
  try {
    fp = databaseFingerprint(env.DATABASE_URL ?? '');
  } catch {
    throw new FixtureResetRefusedError('no database url');
  }
  if (fp !== DEV_DB_FINGERPRINT && env.TRACK_B_ALLOW_EPHEMERAL !== fp) throw new FixtureResetRefusedError(`not the DEV database (${fp})`);
}

export interface FixtureResetReport {
  studentId: string;
  dryRun: boolean;
  deleted: Record<string, number>;
}

/** Exam versions whose content is fixture content (V1 dev-cert + V2 reference verticals). */
const FIXTURE_VERSIONS_SQL = `SELECT v.id FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id
  WHERE d.config_key LIKE 'dev-cert.%' OR d.config_key LIKE 'v2.%' OR v.navigation_rules->>'contentStatus' = 'DEV_CERT_FIXTURE'`;

export async function resetStudentExamFixtures(params: { studentId: string; confirm: string; dryRun?: boolean }): Promise<FixtureResetReport> {
  assertResetAllowed(params.confirm);
  const client = await db.connect();
  const deleted: Record<string, number> = {};
  const del = async (label: string, sql: string, args: unknown[]) => {
    const r = await client.query(sql, args);
    deleted[label] = (deleted[label] ?? 0) + (r.rowCount ?? 0);
  };
  try {
    await client.query('BEGIN');
    const sid = params.studentId;
    const versions = (await client.query(FIXTURE_VERSIONS_SQL)).rows.map((r: any) => r.id);
    const sims = (await client.query(`SELECT id, exam_attempt_id, simulation_plan_id FROM simulation_attempts WHERE student_id = $1 AND exam_version_id = ANY($2::uuid[])`, [sid, versions])).rows;
    const simIds = sims.map((s: any) => s.id);
    const examAttemptIds = sims.map((s: any) => s.exam_attempt_id);
    const planIds = [...new Set(sims.map((s: any) => s.simulation_plan_id))];
    const instanceIds = (await client.query(`SELECT id FROM exam_instances WHERE student_id = $1 AND exam_version_id = ANY($2::uuid[])`, [sid, versions])).rows.map((r: any) => r.id);
    const submissionIds = (await client.query(`SELECT id FROM exam_submissions WHERE exam_instance_id = ANY($1::uuid[])`, [instanceIds])).rows.map((r: any) => r.id);
    const responseIds = (await client.query(`SELECT id FROM exam_attempt_item_responses WHERE exam_attempt_id = ANY($1::uuid[])`, [examAttemptIds])).rows.map((r: any) => r.id);
    const mediaIds = (await client.query(`SELECT media_object_id AS id FROM exam_submission_artifacts WHERE submission_id = ANY($1::uuid[]) AND media_object_id IS NOT NULL`, [submissionIds])).rows.map((r: any) => r.id);

    await del('exam_response_assessments', `DELETE FROM exam_response_assessments WHERE response_id = ANY($1::uuid[]) OR submission_id = ANY($2::uuid[])`, [responseIds, submissionIds]);
    await del('exam_submission_artifacts', `DELETE FROM exam_submission_artifacts WHERE submission_id = ANY($1::uuid[])`, [submissionIds]);
    await del('exam_media_objects', `DELETE FROM exam_media_objects WHERE id = ANY($1::uuid[]) AND owner_student_id = $2`, [mediaIds, sid]);
    await del('exam_submissions', `DELETE FROM exam_submissions WHERE id = ANY($1::uuid[])`, [submissionIds]);
    await del('exam_item_usage', `DELETE FROM exam_item_usage WHERE student_id = $1 AND (exam_instance_id = ANY($2::uuid[]) OR exam_instance_id IS NULL)`, [sid, instanceIds]);
    await del('learning_concept_proposal_requests', `DELETE FROM learning_concept_proposal_requests WHERE student_id = $1 AND exam_attempt_id = ANY($2::uuid[])`, [sid, examAttemptIds]);
    await del('exam_instances', `DELETE FROM exam_instances WHERE id = ANY($1::uuid[])`, [instanceIds]);
    await del('exam_attempt_results', `DELETE FROM exam_attempt_results WHERE exam_attempt_id = ANY($1::uuid[])`, [examAttemptIds]);
    await del('exam_attempt_item_responses', `DELETE FROM exam_attempt_item_responses WHERE id = ANY($1::uuid[])`, [responseIds]);
    await del('simulation_attempts', `DELETE FROM simulation_attempts WHERE id = ANY($1::uuid[])`, [simIds]);
    await del('simulation_plans', `DELETE FROM simulation_plans WHERE id = ANY($1::uuid[]) AND student_id = $2 AND NOT EXISTS (SELECT 1 FROM simulation_attempts s WHERE s.simulation_plan_id = simulation_plans.id)`, [planIds, sid]);
    await del('exam_attempts', `DELETE FROM exam_attempts WHERE id = ANY($1::uuid[])`, [examAttemptIds]);

    await client.query(params.dryRun ? 'ROLLBACK' : 'COMMIT');
    console.log('[exam-core]', JSON.stringify({ at: 'dev_fixture_reset', studentId: sid, dryRun: !!params.dryRun, deleted }));
    return { studentId: sid, dryRun: !!params.dryRun, deleted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
