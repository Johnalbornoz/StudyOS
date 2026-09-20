/**
 * F1 -- Unified Identity backfill.
 *
 * Populates `users`/`user_roles` from the two pre-existing identity
 * spaces (`students`, `profiles`) and sets `students.user_id`/
 * `profiles.user_id`. See F1_IDENTITY_MIGRATION_SPEC.md for the exact
 * per-table rules this implements.
 *
 * NEVER deletes or rewrites `students`/`profiles`/any learning table.
 * NEVER infers identity from name/email similarity (INV-F1-11/12) --
 * every mapping here uses only an already-existing, exact, documented
 * identity fact (`clerk_id` equality, or `profiles.id = students.id`
 * for the student-profile share the codebase already depends on).
 * Every operation is `ON CONFLICT ... DO NOTHING`, so re-running this
 * to completion is always safe (idempotent) -- there is no cursor to
 * resume because each pass is a full, cheap table scan, not a
 * per-row heavy computation like the Transfer State backfill.
 *
 * Ambiguous rows (a `profiles(user_type='student')` row with no
 * matching `students` row) are counted and listed, never assigned a
 * `user_id` and never merged into anything.
 */
import { db } from '@/lib/db';

export interface IdentityBackfillCounts {
  studentsTotal: number;
  profilesTotal: number;
  profilesParentTotal: number;
  profilesStudentTotal: number;
  usersTotal: number;
  userRolesTotal: number;
  studentsWithUserId: number;
  profilesWithUserId: number;
  orphanedStudentProfiles: number;
}

export interface IdentityBackfillResult {
  dryRun: boolean;
  before: IdentityBackfillCounts;
  after: IdentityBackfillCounts;
  usersCreated: number;
  userRolesCreated: number;
  studentsMapped: number;
  profilesMapped: number;
  orphanedProfileIds: string[];
}

export async function getCounts(): Promise<IdentityBackfillCounts> {
  const [
    studentsTotal,
    profilesTotal,
    profilesParentTotal,
    profilesStudentTotal,
    usersTotal,
    userRolesTotal,
    studentsWithUserId,
    profilesWithUserId,
    orphanedStudentProfiles,
  ] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM students`),
    db.query(`SELECT COUNT(*)::int AS c FROM profiles`),
    db.query(`SELECT COUNT(*)::int AS c FROM profiles WHERE user_type = 'parent'`),
    db.query(`SELECT COUNT(*)::int AS c FROM profiles WHERE user_type = 'student'`),
    db.query(`SELECT COUNT(*)::int AS c FROM users`),
    db.query(`SELECT COUNT(*)::int AS c FROM user_roles`),
    db.query(`SELECT COUNT(*)::int AS c FROM students WHERE user_id IS NOT NULL`),
    db.query(`SELECT COUNT(*)::int AS c FROM profiles WHERE user_id IS NOT NULL`),
    db.query(
      `SELECT COUNT(*)::int AS c FROM profiles p
       WHERE p.user_type = 'student' AND NOT EXISTS (SELECT 1 FROM students s WHERE s.id = p.id)`
    ),
  ]);

  return {
    studentsTotal: studentsTotal.rows[0].c,
    profilesTotal: profilesTotal.rows[0].c,
    profilesParentTotal: profilesParentTotal.rows[0].c,
    profilesStudentTotal: profilesStudentTotal.rows[0].c,
    usersTotal: usersTotal.rows[0].c,
    userRolesTotal: userRolesTotal.rows[0].c,
    studentsWithUserId: studentsWithUserId.rows[0].c,
    profilesWithUserId: profilesWithUserId.rows[0].c,
    orphanedStudentProfiles: orphanedStudentProfiles.rows[0].c,
  };
}

export async function runIdentityBackfill(dryRun: boolean = true): Promise<IdentityBackfillResult> {
  const before = await getCounts();

  const orphaned = await db.query(
    `SELECT p.id FROM profiles p
     WHERE p.user_type = 'student' AND NOT EXISTS (SELECT 1 FROM students s WHERE s.id = p.id)`
  );
  const orphanedProfileIds: string[] = orphaned.rows.map((r: any) => r.id);

  if (dryRun) {
    return {
      dryRun: true,
      before,
      after: before,
      usersCreated: 0,
      userRolesCreated: 0,
      studentsMapped: 0,
      profilesMapped: 0,
      orphanedProfileIds,
    };
  }

  const client = await db.connect();
  let usersCreated = 0;
  let userRolesCreated = 0;
  let studentsMapped = 0;
  let profilesMapped = 0;

  try {
    await client.query('BEGIN');

    // Step 1 -- one users row per students.clerk_id (exact identity fact).
    const usersFromStudents = await client.query(
      `INSERT INTO users (clerk_id, email)
       SELECT s.clerk_id, s.email FROM students s
       ON CONFLICT (clerk_id) DO NOTHING
       RETURNING id`
    );
    usersCreated += usersFromStudents.rowCount ?? 0;

    // Step 2 -- one users row per profiles(user_type='parent').clerk_id
    // not already covered by step 1 (a parent who is ALSO a student
    // shares the same clerk_id -- ON CONFLICT DO NOTHING correctly
    // reuses the row step 1 already created, never a duplicate).
    const usersFromParents = await client.query(
      `INSERT INTO users (clerk_id, email)
       SELECT p.clerk_id, NULL FROM profiles p
       WHERE p.user_type = 'parent' AND p.clerk_id IS NOT NULL
       ON CONFLICT (clerk_id) DO NOTHING
       RETURNING id`
    );
    usersCreated += usersFromParents.rowCount ?? 0;

    // Step 3 -- students.user_id backfill (exact clerk_id match).
    const studentsUpdate = await client.query(
      `UPDATE students s SET user_id = u.id
       FROM users u WHERE u.clerk_id = s.clerk_id AND s.user_id IS NULL`
    );
    studentsMapped = studentsUpdate.rowCount ?? 0;

    // Step 4 -- profiles(user_type='parent').user_id backfill.
    const parentProfilesUpdate = await client.query(
      `UPDATE profiles p SET user_id = u.id
       FROM users u WHERE u.clerk_id = p.clerk_id AND p.user_type = 'parent' AND p.user_id IS NULL`
    );

    // Step 5 -- profiles(user_type='student').user_id backfill via the
    // documented shared-id contract (profiles.id = students.id for the
    // SAME student), never via clerk_id (student profiles never carry
    // one) and never via name/email similarity.
    const studentProfilesUpdate = await client.query(
      `UPDATE profiles p SET user_id = s.user_id
       FROM students s WHERE p.id = s.id AND p.user_type = 'student' AND p.user_id IS NULL AND s.user_id IS NOT NULL`
    );
    profilesMapped = (parentProfilesUpdate.rowCount ?? 0) + (studentProfilesUpdate.rowCount ?? 0);

    // Step 6 -- STUDENT role for every user resolved from a students row.
    const studentRoles = await client.query(
      `INSERT INTO user_roles (user_id, role, status, granted_via)
       SELECT DISTINCT s.user_id, 'STUDENT', 'ACTIVE', 'BACKFILL'
       FROM students s WHERE s.user_id IS NOT NULL
       ON CONFLICT (user_id, role) DO NOTHING
       RETURNING id`
    );
    userRolesCreated += studentRoles.rowCount ?? 0;

    // Step 7 -- PARENT role for every user resolved from a parent profile.
    const parentRoles = await client.query(
      `INSERT INTO user_roles (user_id, role, status, granted_via)
       SELECT DISTINCT p.user_id, 'PARENT', 'ACTIVE', 'BACKFILL'
       FROM profiles p WHERE p.user_type = 'parent' AND p.user_id IS NOT NULL
       ON CONFLICT (user_id, role) DO NOTHING
       RETURNING id`
    );
    userRolesCreated += parentRoles.rowCount ?? 0;

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const after = await getCounts();

  return {
    dryRun: false,
    before,
    after,
    usersCreated,
    userRolesCreated,
    studentsMapped,
    profilesMapped,
    orphanedProfileIds,
  };
}
