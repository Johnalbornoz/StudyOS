/**
 * Track A (Roles E2E) -- deterministic DEV fixtures: real Clerk DEV test
 * identities + their StudyUS rows, provisioned through the REAL services.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts provision
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts tokens <outfile.json>
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts signin <tag>
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts cleanup
 *
 * DEV ONLY, enforced twice: the database fingerprint must be the official
 * DEV one AND the Clerk keys must belong to the DEV instance
 * (shining-impala-8101, sk_test_). Identities use `+clerk_test@example.com`
 * addresses (Clerk test mode), are created through the Clerk Backend API
 * with NO password (sign-in is by short-lived sign-in ticket / backend
 * session token only), and are tagged `studyus_track_a` in public metadata.
 * `cleanup` deletes the Clerk users and every StudyUS row they own.
 *
 * Fixture world (what the E2E then exercises):
 *   Institution A  -- admin inst-a; NOTHING else (the E2E builds it).
 *   Institution B  -- admin inst-b; grade + class B; teacher-b approved and
 *                     assigned; student-b enrolled (ACTIVE). The cross-tenant
 *                     target for every DENY case.
 *   student-a      -- STUDENT with one subject + concept ("Ecuaciones
 *                     lineales") MATCHED to the catalog concept "Linear
 *                     Equations", so a class assignment can target it.
 *   parent-a, parent-b, teacher-a -- role only (the E2E runs their flows).
 *   multi          -- STUDENT + PARENT + TEACHER on one account.
 */
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { createClerkClient } from '@clerk/backend';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { createInstitution, inviteInstitutionAdmin, requestTeacherMembership, decideMembership, createGrade, createClass, createTeacherAssignment } from '@/services/institution.service';
import { ensureCatalogMapping, confirmMapping } from '@/lib/catalog/mapping.service';

export const DEV_FP = '2a29b99ee14a22b4';
export const DEV_CLERK_INSTANCE = 'shining-impala-8101.clerk.accounts.dev';
export const FIXTURE_TAG = 'studyus_track_a';
export const INST_A_NAME = 'TA Institución A';
export const INST_B_NAME = 'TA Institución B';
export const CANONICAL_CONCEPT_NAME = 'Linear Equations';

export const IDENTITIES = {
  'inst-a': { first: 'Ana', last: 'Coordinadora A', roles: [] as const },
  'inst-b': { first: 'Bruno', last: 'Coordinador B', roles: [] as const },
  'teacher-a': { first: 'Teresa', last: 'Docente A', roles: ['TEACHER'] as const },
  'teacher-b': { first: 'Tomás', last: 'Docente B', roles: ['TEACHER'] as const },
  'parent-a': { first: 'Pilar', last: 'Madre A', roles: ['PARENT'] as const },
  'parent-b': { first: 'Pedro', last: 'Padre B', roles: ['PARENT'] as const },
  'student-a': { first: 'Sofía', last: 'Estudiante A', roles: ['STUDENT'] as const },
  'student-b': { first: 'Samuel', last: 'Estudiante B', roles: ['STUDENT'] as const },
  multi: { first: 'Marta', last: 'Multirol', roles: ['STUDENT', 'PARENT', 'TEACHER'] as const },
} as const;
export type Tag = keyof typeof IDENTITIES;
export const emailFor = (tag: Tag) => `studyus-ta-${tag}+clerk_test@example.com`;

export function dbFingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

export function clerkInstance(): string {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  return Buffer.from(pk.split('_')[2] ?? '', 'base64').toString().replace(/\$$/, '');
}

export function assertDev(): void {
  if (dbFingerprint() !== DEV_FP) throw new Error(`REFUSING: database is not DEV (${dbFingerprint()})`);
  if (clerkInstance() !== DEV_CLERK_INSTANCE || !(process.env.CLERK_SECRET_KEY ?? '').startsWith('sk_test_')) {
    throw new Error(`REFUSING: Clerk keys are not the DEV instance (${clerkInstance()})`);
  }
}

export const clerk = () => createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

export async function findClerkUser(tag: Tag) {
  const list = await clerk().users.getUserList({ emailAddress: [emailFor(tag)] });
  return list.data[0] ?? null;
}

async function ensureClerkUser(tag: Tag): Promise<string> {
  const existing = await findClerkUser(tag);
  if (existing) return existing.id;
  const spec = IDENTITIES[tag];
  const created = await clerk().users.createUser({
    emailAddress: [emailFor(tag)],
    firstName: spec.first,
    lastName: spec.last,
    skipPasswordRequirement: true,
    publicMetadata: { fixture: FIXTURE_TAG, tag },
  });
  return created.id;
}

/** The parent profile row exactly as getOrCreateParentId creates it (it reads Clerk's request-scoped currentUser otherwise). */
async function ensureParentProfile(clerkId: string, userId: string, name: string) {
  const existing = await db.query(`SELECT id FROM profiles WHERE clerk_id = $1`, [clerkId]);
  if (existing.rows.length > 0) return existing.rows[0].id as string;
  const r = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', $1, $2, $3) RETURNING id`,
    [name, clerkId, userId]
  );
  return r.rows[0].id as string;
}

async function provision() {
  assertDev();
  const out: Record<string, { clerkId: string; userId: string; studentId?: string }> = {};
  for (const tag of Object.keys(IDENTITIES) as Tag[]) {
    const spec = IDENTITIES[tag];
    const clerkId = await ensureClerkUser(tag);
    const user = await getOrCreateCanonicalUser(clerkId, emailFor(tag));
    for (const role of spec.roles) {
      // Real self-service grant (audited). STUDENT provisions the students
      // row through getOrCreateStudentId -> Backend API identity lookup.
      await assignSelfServiceRole(clerkId, user.id, role);
    }
    if ((spec.roles as readonly string[]).includes('PARENT')) await ensureParentProfile(clerkId, user.id, `${spec.first} ${spec.last}`);
    const student = await db.query(`SELECT id FROM students WHERE clerk_id = $1`, [clerkId]);
    out[tag] = { clerkId, userId: user.id, studentId: student.rows[0]?.id };
    console.log(`identity ${tag}: user ${user.id}${out[tag].studentId ? ` student ${out[tag].studentId}` : ''}`);
  }

  // Institutions (StudyUS-admin path: createInstitution + inviteInstitutionAdmin).
  const instA = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).rows[0]?.id ?? (await createInstitution(INST_A_NAME)).id;
  const instB = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [INST_B_NAME])).rows[0]?.id ?? (await createInstitution(INST_B_NAME)).id;
  await inviteInstitutionAdmin(instA, out['inst-a'].userId);
  await inviteInstitutionAdmin(instB, out['inst-b'].userId);

  // Institution B: complete, so every cross-tenant case has a real target.
  let gradeB = (await db.query(`SELECT id FROM grades WHERE institution_id = $1 LIMIT 1`, [instB])).rows[0]?.id;
  if (!gradeB) gradeB = (await createGrade(instB, '9.º B')).id;
  let classB = (await db.query(`SELECT id FROM classes WHERE institution_id = $1 LIMIT 1`, [instB])).rows[0]?.id;
  if (!classB) classB = (await createClass(instB, gradeB, 'Matemáticas 9B')).id;
  const tb = await requestTeacherMembership(instB, out['teacher-b'].userId);
  if (tb.status === 'PENDING') await decideMembership(tb.id, out['inst-b'].userId, 'APPROVED');
  const hasScope = await db.query(`SELECT 1 FROM teacher_assignments WHERE institution_membership_id = $1 AND status = 'ACTIVE'`, [tb.id]);
  if (hasScope.rows.length === 0) await createTeacherAssignment(tb.id, { classId: classB });
  await db.query(
    `INSERT INTO class_enrollments (class_id, student_id, status, invited_by_user_id, responded_at) VALUES ($1, $2, 'ACTIVE', $3, NOW())
     ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'ACTIVE', ended_at = NULL`,
    [classB, out['student-b'].studentId, out['inst-b'].userId]
  );

  // student-a: one subject + concept, MATCHED to the catalog concept.
  const studentA = out['student-a'].studentId!;
  let subjectA = (await db.query(`SELECT id FROM subjects WHERE student_id = $1 LIMIT 1`, [studentA])).rows[0]?.id;
  if (!subjectA) {
    subjectA = (await db.query(`INSERT INTO subjects (student_id, name, status) VALUES ($1, 'Matemáticas', 'active') RETURNING id`, [studentA])).rows[0].id;
  }
  let conceptA = (await db.query(`SELECT id FROM concepts WHERE subject_id = $1 LIMIT 1`, [subjectA])).rows[0]?.id;
  if (!conceptA) {
    conceptA = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, 'ECUACIONES_LINEALES_TA') RETURNING id`, [subjectA])).rows[0].id;
    await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'es', 'Ecuaciones lineales'), ($1, 'en', 'Linear equations')`, [conceptA]);
  }
  const canonical = await db.query(`SELECT id FROM canonical_concepts WHERE name = $1 AND status = 'ACTIVE' LIMIT 1`, [CANONICAL_CONCEPT_NAME]);
  if (canonical.rows.length === 0) throw new Error(`catalog concept "${CANONICAL_CONCEPT_NAME}" missing in DEV`);
  const mapping = await ensureCatalogMapping(conceptA);
  if (mapping.status !== 'MATCHED') await confirmMapping(mapping.id, canonical.rows[0].id, out['inst-a'].userId);

  console.log(JSON.stringify({ instA, instB, gradeB, classB, studentA, subjectA, conceptA, canonicalConceptId: canonical.rows[0].id }, null, 2));
}

/** Short-lived (10 min) Clerk session tokens for every identity -- written to a scratch file, never to the repository. */
async function tokens(outfile: string) {
  assertDev();
  const result: Record<string, string> = {};
  for (const tag of Object.keys(IDENTITIES) as Tag[]) {
    const u = await findClerkUser(tag);
    if (!u) throw new Error(`missing Clerk identity ${tag} -- run provision first`);
    const session = await clerk().sessions.createSession({ userId: u.id });
    const token = await clerk().sessions.getToken(session.id, undefined, 600);
    result[tag] = token.jwt;
  }
  writeFileSync(outfile, JSON.stringify(result));
  console.log(`wrote ${Object.keys(result).length} session tokens to ${outfile}`);
}

/** A one-time sign-in ticket URL path for the browser (no password is ever used). */
async function signin(tag: Tag) {
  assertDev();
  const u = await findClerkUser(tag);
  if (!u) throw new Error(`missing Clerk identity ${tag}`);
  const t = await clerk().signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 });
  console.log(t.token);
}

async function cleanup() {
  assertDev();
  const clerkIds: string[] = [];
  for (const tag of Object.keys(IDENTITIES) as Tag[]) {
    const u = await findClerkUser(tag);
    if (u) clerkIds.push(u.id);
  }
  const userIds = (await db.query(`SELECT id FROM users WHERE clerk_id = ANY($1::text[]) OR email LIKE 'studyus-ta-%+clerk_test@example.com'`, [clerkIds])).rows.map((r: any) => r.id);
  const institutions = (await db.query(`SELECT id FROM institutions WHERE name = ANY($1::text[])`, [[INST_A_NAME, INST_B_NAME]])).rows.map((r: any) => r.id);
  const studentIds = (await db.query(`SELECT id FROM students WHERE user_id = ANY($1::uuid[]) OR clerk_id = ANY($2::text[])`, [userIds, clerkIds])).rows.map((r: any) => r.id);
  const profileIds = (await db.query(`SELECT id FROM profiles WHERE id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[]) OR clerk_id = ANY($3::text[])`, [studentIds, userIds, clerkIds])).rows.map((r: any) => r.id);
  const q = (sql: string, p: unknown[]) => db.query(sql, p);

  // Learning data a fixture student produced during the E2E (practice through
  // the canonical engine) -- removed with the fixture student, nothing else.
  const interventions = (await db.query(`SELECT id FROM teacher_interventions WHERE institution_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [institutions, studentIds])).rows.map((r: any) => r.id);
  await q(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [userIds, profileIds]);
  await q(`DELETE FROM teacher_assignments WHERE institution_membership_id IN (SELECT id FROM institution_memberships WHERE institution_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[]))`, [institutions, userIds]);
  await q(`DELETE FROM class_enrollments WHERE class_id IN (SELECT id FROM classes WHERE institution_id = ANY($1::uuid[])) OR student_id = ANY($2::uuid[])`, [institutions, studentIds]);
  await q(`DELETE FROM classes WHERE institution_id = ANY($1::uuid[])`, [institutions]);
  await q(`DELETE FROM grades WHERE institution_id = ANY($1::uuid[])`, [institutions]);
  await q(`DELETE FROM institution_memberships WHERE institution_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])`, [institutions, userIds]);
  await q(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [institutions]);
  await q(`DELETE FROM parent_student_relationships WHERE student_id = ANY($1::uuid[]) OR parent_id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM parent_invitations WHERE student_id = ANY($1::uuid[]) OR lower(invited_email) LIKE 'studyus-ta-%+clerk_test@example.com'`, [profileIds]);
  await q(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [userIds, userIds]);
  await q(`DELETE FROM concept_catalog_mapping WHERE learner_concept_id IN (SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = ANY($1::uuid[]))`, [studentIds]);

  // Every remaining row that references a fixture student/profile/user, resolved from the FK graph (incl. learning tables).
  for (let pass = 0; pass < 4; pass++) {
    const refs = (await db.query(
      `SELECT conrelid::regclass::text AS t, a.attname AS c, confrelid::regclass::text AS parent
       FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
       WHERE con.contype = 'f' AND confrelid::regclass::text IN ('profiles', 'students', 'subjects', 'concepts') AND array_length(con.conkey, 1) = 1
         AND conrelid::regclass::text NOT IN ('profiles', 'students', 'users')`
    )).rows as { t: string; c: string; parent: string }[];
    const subjectIds = (await db.query(`SELECT id FROM subjects WHERE student_id = ANY($1::uuid[])`, [studentIds])).rows.map((r: any) => r.id);
    const conceptIds = (await db.query(`SELECT id FROM concepts WHERE subject_id = ANY($1::uuid[])`, [subjectIds])).rows.map((r: any) => r.id);
    const idsFor: Record<string, string[]> = { students: studentIds, profiles: profileIds, subjects: subjectIds, concepts: conceptIds };
    for (const r of refs) {
      if (r.t === 'subjects' || r.t === 'concepts') continue;
      await q(`DELETE FROM ${r.t} WHERE ${r.c} = ANY($1::uuid[])`, [idsFor[r.parent]]).catch(() => {});
    }
    await q(`DELETE FROM concepts WHERE id = ANY($1::uuid[])`, [conceptIds]).catch(() => {});
    await q(`DELETE FROM subjects WHERE id = ANY($1::uuid[])`, [subjectIds]).catch(() => {});
  }
  // Tables keyed by student id without an FK (learning engine projections, preferences).
  const studentKeyed = (await db.query(
    `SELECT table_name FROM information_schema.columns WHERE column_name = 'student_id' AND table_schema = 'public'
       AND table_name NOT IN ('students') AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema = 'public')`
  )).rows.map((r: any) => r.table_name);
  for (const t of studentKeyed) await q(`DELETE FROM ${t} WHERE student_id = ANY($1::uuid[])`, [studentIds]).catch(() => {});
  await q(`DELETE FROM user_language_preferences WHERE user_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])`, [profileIds, userIds]);
  await q(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await q(`DELETE FROM student_profiles WHERE id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [studentIds]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);

  for (const id of clerkIds) await clerk().users.deleteUser(id);

  const left =
    Number((await db.query(`SELECT COUNT(*) n FROM users WHERE id = ANY($1::uuid[])`, [userIds])).rows[0].n) +
    Number((await db.query(`SELECT COUNT(*) n FROM students WHERE id = ANY($1::uuid[])`, [studentIds])).rows[0].n) +
    Number((await db.query(`SELECT COUNT(*) n FROM institutions WHERE name = ANY($1::text[])`, [[INST_A_NAME, INST_B_NAME]])).rows[0].n);
  const clerkLeft = (await Promise.all((Object.keys(IDENTITIES) as Tag[]).map(findClerkUser))).filter(Boolean).length;
  console.log(`cleanup: ${userIds.length} users, ${studentIds.length} students, ${institutions.length} institutions, ${clerkIds.length} Clerk users removed; remaining db=${left} clerk=${clerkLeft}`);
  if (left !== 0 || clerkLeft !== 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('track-a-fixtures.ts')) {
  const [cmd, arg] = process.argv.slice(2);
  const run = cmd === 'provision' ? provision() : cmd === 'tokens' ? tokens(arg) : cmd === 'signin' ? signin(arg as Tag) : cmd === 'cleanup' ? cleanup() : Promise.reject(new Error('usage: provision | tokens <file> | signin <tag> | cleanup'));
  run
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await (db as any).end?.();
    });
}
