/**
 * F1 -- invoked by f1-identity-migration-cert.sh against a real,
 * ephemeral, local-only Postgres instance. Never run this against any
 * other DATABASE_URL.
 */
import { runIdentityBackfill } from '@/services/identity-backfill.service';

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function main() {
  const mode = process.argv[2];

  if (mode === 'dry-run') {
    const result = await runIdentityBackfill(true);
    assert(result.dryRun === true, 'dry run flag is true');
    assert(result.usersCreated === 0, 'dry run creates zero users');
    assert(result.userRolesCreated === 0, 'dry run creates zero user_roles');
    assert(result.before.studentsTotal === 2, 'sees 2 seeded students (case 1 + case 3)');
    assert(result.before.profilesParentTotal === 2, 'sees 2 seeded parent profiles (case 2 + case 3)');
    assert(result.orphanedProfileIds.includes('44444444-4444-4444-8444-444444444444'), 'detects the seeded orphaned profile (case 4)');
    assert(result.after.usersTotal === result.before.usersTotal, 'dry run does not change users count');
    return;
  }

  if (mode === 'write') {
    const result = await runIdentityBackfill(false);
    assert(result.dryRun === false, 'write mode flag is false');
    // 2 distinct clerk_ids from students (clerk_student_1, clerk_multi_1)
    // + 1 distinct clerk_id from the parent-only profile (clerk_parent_1)
    // -- clerk_multi_1 is shared between a student and a parent profile,
    // so it must NOT produce a second users row.
    assert(result.after.usersTotal === 3, 'exactly 3 distinct users created (no duplicate for the shared multi-role clerk_id)');
    assert(result.after.studentsWithUserId === 2, 'both seeded students got user_id');
    // 2 parent-type profiles (case 2, case 3's parent role) + 2 student-type
    // profiles sharing an id with a mapped student (case 1, case 3's student
    // role) = 4. The orphaned student-type profile (case 4) is excluded.
    assert(result.after.profilesWithUserId === 4, '2 parent profiles + 2 student-type profiles (sharing ids with mapped students) got user_id');
    assert(result.orphanedProfileIds.length === 1, 'exactly 1 orphan reported, never assigned a user_id');
    assert(result.userRolesCreated === 4, '4 role grants created: STUDENT x2 (case1, case3) + PARENT x2 (case2, case3)');

    // The multi-role case (case 3) must have received BOTH roles under
    // the SAME user_id -- this is the actual multi-role assertion, not
    // just a count.
    const { db } = await import('@/lib/db');
    const multiUser = await db.query(`SELECT id FROM users WHERE clerk_id = 'clerk_multi_1'`);
    assert(multiUser.rows.length === 1, 'exactly one users row for the shared multi-role clerk_id');
    const multiRoles = await db.query(`SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`, [multiUser.rows[0].id]);
    assert(
      JSON.stringify(multiRoles.rows.map((r: any) => r.role)) === JSON.stringify(['PARENT', 'STUDENT']),
      'the multi-role user holds BOTH STUDENT and PARENT roles simultaneously under one canonical identity'
    );
    return;
  }

  if (mode === 'write-second-pass') {
    const result = await runIdentityBackfill(false);
    assert(result.usersCreated === 0, 'second WRITE pass creates zero additional users (idempotent)');
    assert(result.userRolesCreated === 0, 'second WRITE pass creates zero additional role grants (idempotent)');
    assert(result.studentsMapped === 0, 'second WRITE pass maps zero additional students (already mapped)');
    assert(result.profilesMapped === 0, 'second WRITE pass maps zero additional profiles (already mapped)');
    assert(result.orphanedProfileIds.length === 1, 'the orphan remains unresolved and unmerged after a second pass');
    return;
  }

  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Cert runner failed:', err);
    process.exit(1);
  });
