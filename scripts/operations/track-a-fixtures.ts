/**
 * Track A (Roles E2E) -- deterministic DEV fixtures: real Clerk DEV test
 * identities + their StudyUS rows, provisioned through the REAL services.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts provision
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts tokens <outfile.json>
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts teacher-reset
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
 *   student-c      -- STUDENT persona + STUDYUS_ADMIN capability (a capability
 *                     is never a second persona); second child for parent-a.
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
export const INST_LP_NAME = 'TA Institución LP';
export const LP_CLASS_NAME = 'LP Matemáticas 11';
export const LP_EXAM_PURPOSE = 'TRACK_A_LP_E2E';
/** DB-only synthetic learners of the LP class (no Clerk account, never sign in). */
export const LP_SYNTHETIC_PREFIX = 'synthetic-ta-lp-';
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
  // One persona per account (product amendment); student-c also holds the
  // STUDYUS_ADMIN *capability* to prove a capability is not a second persona.
  'student-c': { first: 'Carla', last: 'Estudiante C', roles: ['STUDENT'] as const },
  // Institution / coordinator E2E. `platform-admin` holds ONLY the Platform
  // Admin capability (DEV-only allowlist, see admin.service). `coord-b` is a
  // Teacher who also becomes coordinator of Institution E2E B (existing
  // account path). `coord-a` and `coord-x` do NOT exist until the E2E
  // "signs them up" after their invitation (new-person path).
  'platform-admin': { first: 'Patricia', last: 'Plataforma', roles: [] as const },
  'coord-b': { first: 'Bernardo', last: 'Coordinador B', roles: ['TEACHER'] as const },
  'coord-a': { first: 'Andrea', last: 'Coordinadora A', roles: [] as const },
  'coord-x': { first: 'Ximena', last: 'Invitada X', roles: [] as const },
  // Learning Plan Orchestrator E2E: an independent Student (no institution),
  // the Teacher of "LP Matemáticas 11" and the coordinator of TA Institución LP.
  'lp-student': { first: 'Lucía', last: 'Independiente', roles: ['STUDENT'] as const },
  'lp-teacher': { first: 'Lorenzo', last: 'Docente LP', roles: ['TEACHER'] as const },
  'lp-coord': { first: 'Laura', last: 'Coordinadora LP', roles: [] as const },
  // Institution operational E2E (first-time setup over HTTP): the coordinator of
  // "Institution E2E Ops" and a Teacher account with no institution until invited.
  'ops-coord': { first: 'Olivia', last: 'Coordinadora Ops', roles: [] as const },
  'ops-teacher': { first: 'Óscar', last: 'Docente Ops', roles: ['TEACHER'] as const },
} as const;
/** Identities created by the invitation flow itself, never by `provision`. */
export const SIGN_UP_LATER: ReadonlySet<string> = new Set(['coord-a', 'coord-x']);
export const E2E_INSTITUTION_PREFIX = 'Institution E2E';
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
    if (SIGN_UP_LATER.has(tag)) continue;
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

  // Platform Admin capability for the fixture admin, through the same bootstrap the allowlist uses.
  {
    const { bootstrapStudyUSAdminIfEligible } = await import('@/lib/admin/authorization');
    const admin = await getOrCreateCanonicalUser(out['platform-admin'].clerkId, emailFor('platform-admin'));
    await bootstrapStudyUSAdminIfEligible(admin, emailFor('platform-admin'));
  }

  // Capability (not a persona) on student-c, as the admin bootstrap would grant it.
  await db.query(
    `INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'STUDYUS_ADMIN', 'ACTIVE', 'BACKFILL') ON CONFLICT (user_id, role) DO NOTHING`,
    [out['student-c'].userId]
  );

  // Institutions (StudyUS-admin path: createInstitution + inviteInstitutionAdmin).
  const instA = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).rows[0]?.id ?? (await createInstitution(INST_A_NAME)).id;
  const instB = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [INST_B_NAME])).rows[0]?.id ?? (await createInstitution(INST_B_NAME)).id;
  await inviteInstitutionAdmin(instA, out['inst-a'].userId);
  await inviteInstitutionAdmin(instB, out['inst-b'].userId);

  // Institution B: complete, so every cross-tenant case has a real target.
  let gradeB = (await db.query(`SELECT id FROM grades WHERE institution_id = $1 LIMIT 1`, [instB])).rows[0]?.id;
  if (!gradeB) gradeB = (await createGrade(instB, '9.º B')).id;
  let classB = (await db.query(`SELECT id FROM classes WHERE institution_id = $1 LIMIT 1`, [instB])).rows[0]?.id;
  const mathSubject = (await db.query(`SELECT canonical_subject_id FROM canonical_concepts WHERE name = $1 AND status = 'ACTIVE' LIMIT 1`, [CANONICAL_CONCEPT_NAME])).rows[0]?.canonical_subject_id ?? null;
  if (!classB) classB = (await createClass(instB, gradeB, 'Matemáticas 9B', mathSubject)).id;
  else await db.query(`UPDATE classes SET canonical_subject_id = COALESCE(canonical_subject_id, $2) WHERE id = $1`, [classB, mathSubject]);
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
    if (!u && SIGN_UP_LATER.has(tag)) continue;
    if (!u) throw new Error(`missing Clerk identity ${tag} -- run provision first`);
    const session = await clerk().sessions.createSession({ userId: u.id });
    const token = await clerk().sessions.getToken(session.id, undefined, 600);
    result[tag] = token.jwt;
  }
  writeFileSync(outfile, JSON.stringify(result));
  console.log(`wrote ${Object.keys(result).length} session tokens to ${outfile}`);
}

/**
 * Starting state for the operator's manual 12-step browser gate, through the
 * real services: Student A has completed first-run; Teacher A has a PENDING
 * request at Institution A (admin notified); Parent A is accepted by
 * Student A. Institution A has no grade/class yet (the operator creates them).
 */
async function manualPrep() {
  assertDev();
  const { upsertAcademicProfile } = await import('@/services/academic-profile.service');
  const { requestChildLink, respondToRequest } = await import('@/services/parent.service');
  const { onTeacherMembershipRequested } = await import('@/lib/institution/membership-events');
  const user = async (tag: Tag) => (await db.query(`SELECT id FROM users WHERE email = $1`, [emailFor(tag)])).rows[0]?.id as string;
  const studentA = (await db.query(`SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, [emailFor('student-a')])).rows[0].id;
  await upsertAcademicProfile(studentA, { countryOfStudy: 'CO', schoolYear: '10', curriculumType: 'national', academicYear: '2026', profileCompleted: true } as any);
  const instA = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).rows[0].id;
  const m = await requestTeacherMembership(instA, await user('teacher-a'));
  if (m.newlyPending) await onTeacherMembershipRequested(instA, emailFor('teacher-a'));
  const parentProfile = (await db.query(`SELECT id FROM profiles WHERE user_id = $1 AND user_type = 'parent'`, [await user('parent-a')])).rows[0].id;
  await requestChildLink(parentProfile, emailFor('student-a'));
  await respondToRequest(studentA, parentProfile, true);
  console.log('manual-prep done: teacher-a PENDING at Institution A; parent-a accepted by student-a; student-a first-run complete');
}

/**
 * Starting state of the Teacher E2E (automated and manual), DEV fixtures
 * only: Teresa (teacher-a) has NO persona yet (she chooses Teacher in step
 * 1); Institution A has no grade, class, teacher or enrollment; Ana (inst-a)
 * is its admin; Sofía (student-a) has completed first-run and is outside
 * every class of Institution A -- her own learning history is kept (it is
 * produced only through the governed engine path, see
 * track-a-teacher-e2e-http.ts --learner-data-only). Institution B (Tomás,
 * Samuel, Matemáticas 9B) stays complete for the negative cases.
 */
async function teacherReset() {
  assertDev();
  await institutionReset();
  await learningPlanTeardown();
  const { upsertAcademicProfile } = await import('@/services/academic-profile.service');
  const user = async (tag: Tag) => (await db.query(`SELECT id FROM users WHERE email = $1`, [emailFor(tag)])).rows[0]?.id as string;
  const instA = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).rows[0]?.id as string;
  if (!instA) throw new Error('run provision first');
  const fixtureUsers = (await db.query(`SELECT id FROM users WHERE email LIKE 'studyus-ta-%+clerk_test@example.com'`)).rows.map((r: any) => r.id);
  const fixtureStudents = (await db.query(`SELECT s.id FROM students s WHERE s.user_id = ANY($1::uuid[])`, [fixtureUsers])).rows.map((r: any) => r.id);
  const interventions = (await db.query(`SELECT id FROM teacher_interventions WHERE institution_id = $1`, [instA])).rows.map((r: any) => r.id);
  await db.query(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[])`, [interventions]);
  await db.query(`DELETE FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [interventions]);
  await db.query(`DELETE FROM teacher_assignments WHERE institution_membership_id IN (SELECT id FROM institution_memberships WHERE institution_id = $1)`, [instA]);
  await db.query(`DELETE FROM class_enrollments WHERE class_id IN (SELECT id FROM classes WHERE institution_id = $1)`, [instA]);
  await detachTeacherAddedConcepts((await db.query(`SELECT id FROM classes WHERE institution_id = $1`, [instA])).rows.map((r: any) => r.id));
  await db.query(`DELETE FROM classes WHERE institution_id = $1`, [instA]);
  await db.query(`DELETE FROM grades WHERE institution_id = $1`, [instA]);
  await db.query(`DELETE FROM institution_memberships WHERE institution_id = $1 AND membership_role = 'TEACHER'`, [instA]);
  await db.query(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [fixtureUsers, fixtureStudents]);
  // Teresa: no persona at all (fixture identity reset -- she chooses Teacher herself in step 1).
  const teresa = await user('teacher-a');
  await db.query(`DELETE FROM user_roles WHERE user_id = $1 AND role IN ('STUDENT', 'PARENT', 'TEACHER')`, [teresa]);
  await db.query(`UPDATE users SET active_workspace = NULL WHERE id = ANY($1::uuid[])`, [fixtureUsers]);
  const sofia = (await db.query(`SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, [emailFor('student-a')])).rows[0].id;
  await upsertAcademicProfile(sofia, { countryOfStudy: 'CO', schoolYear: '10', curriculumType: 'national', academicYear: '2026', profileCompleted: true } as any);
  // Sofía practises on her own (a licensed Student capability): a 30-day,
  // audited grant through the admin licensing service, attributed to the
  // fixture holder of the STUDYUS_ADMIN capability (student-c), never to a
  // real person.
  const licensed = await db.query(
    `SELECT 1 FROM subscriptions WHERE student_id = $1 AND status IN ('active', 'past_due', 'reactivated') AND (grant_expires_at IS NULL OR grant_expires_at > NOW())`,
    [sofia]
  );
  if (licensed.rows.length === 0) {
    const { grantAdminLicense } = await import('@/services/membership-admin.service');
    await grantAdminLicense(await user('student-c'), {
      studentId: sofia,
      reason: 'TRACK_A_TEACHER_E2E_DEV_FIXTURE',
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      source: 'TRIAL',
    });
  }
  console.log('teacher-reset done: Teresa without persona; Institution A empty; Sofía first-run complete, licensed (fixture grant) and outside every class');
}

/**
 * Learning Plan Orchestrator rows filed under fixture students / classes /
 * institutions / users (plan entries + sources + events, recommendations,
 * class plans, institution curricula, proposals). Children before parents;
 * scoped strictly to the ids given (fixtures only).
 */
export async function purgeLearningPlanRows(scope: { studentIds?: string[]; classIds?: string[]; institutionIds?: string[]; userIds?: string[]; learnerConceptIds?: string[] }): Promise<void> {
  const students = scope.studentIds ?? [];
  const classes = scope.classIds ?? [];
  const insts = scope.institutionIds ?? [];
  const users = scope.userIds ?? [];
  const concepts = scope.learnerConceptIds ?? [];
  const q = (sql: string, p: unknown[]) => db.query(sql, p);
  // Plan entries of the given learner concepts (and their sources) go with the concepts.
  await q(
    `DELETE FROM student_concept_sources s USING student_plan_entries e
     WHERE s.student_id = e.student_id AND s.canonical_concept_id = e.canonical_concept_id AND e.learner_concept_id = ANY($1::uuid[])`,
    [concepts]
  );
  await q(`DELETE FROM student_plan_entries WHERE learner_concept_id = ANY($1::uuid[])`, [concepts]);
  await q(`DELETE FROM student_concept_sources WHERE student_id = ANY($1::uuid[]) OR class_id = ANY($2::uuid[]) OR institution_id = ANY($3::uuid[]) OR added_by_user_id = ANY($4::uuid[])`, [students, classes, insts, users]);
  await q(`DELETE FROM student_plan_events WHERE student_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])`, [students, users]);
  await q(`DELETE FROM learning_recommendations WHERE student_id = ANY($1::uuid[])`, [students]);
  await q(`DELETE FROM student_plan_entries WHERE student_id = ANY($1::uuid[])`, [students]);
  await q(`DELETE FROM curriculum_events WHERE class_id = ANY($1::uuid[]) OR institution_id = ANY($2::uuid[]) OR actor_user_id = ANY($3::uuid[])`, [classes, insts, users]);
  await q(`DELETE FROM concept_proposals WHERE class_id = ANY($1::uuid[]) OR institution_id = ANY($2::uuid[]) OR requested_by_user_id = ANY($3::uuid[])`, [classes, insts, users]);
  await q(`DELETE FROM class_plan_concepts WHERE class_id = ANY($1::uuid[]) OR added_by_user_id = ANY($2::uuid[])`, [classes, users]);
  // Curriculum V2 / governance rows (institution tasks, objective selection, class associations, version chains, audit).
  await q(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id IN (SELECT id FROM teacher_interventions WHERE institution_assignment_id IN (SELECT id FROM institution_assignments WHERE institution_id = ANY($1::uuid[])))`, [insts]);
  await q(`DELETE FROM teacher_interventions WHERE institution_assignment_id IN (SELECT id FROM institution_assignments WHERE institution_id = ANY($1::uuid[]))`, [insts]);
  await q(`DELETE FROM institution_assignment_targets WHERE assignment_id IN (SELECT id FROM institution_assignments WHERE institution_id = ANY($1::uuid[])) OR class_id = ANY($2::uuid[])`, [insts, classes]);
  await q(`DELETE FROM institution_assignments WHERE institution_id = ANY($1::uuid[])`, [insts]);
  await q(`DELETE FROM academic_governance_events WHERE institution_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])`, [insts, users]);
  await q(`UPDATE classes SET institution_curriculum_id = NULL WHERE institution_curriculum_id IN (SELECT id FROM institution_curricula WHERE institution_id = ANY($1::uuid[]))`, [insts]);
  await q(`UPDATE institution_curricula SET replaced_by_curriculum_id = NULL WHERE institution_id = ANY($1::uuid[])`, [insts]);
  await q(`DELETE FROM institution_curriculum_objectives WHERE curriculum_id IN (SELECT id FROM institution_curricula WHERE institution_id = ANY($1::uuid[]))`, [insts]);
  await q(`DELETE FROM institution_curriculum_concepts WHERE curriculum_id IN (SELECT id FROM institution_curricula WHERE institution_id = ANY($1::uuid[])) OR added_by_user_id = ANY($2::uuid[])`, [insts, users]);
  await q(`DELETE FROM institution_curricula WHERE institution_id = ANY($1::uuid[])`, [insts]);
}

/**
 * Learning Plan Orchestrator E2E teardown (DEV fixtures only): TA Institución
 * LP with everything filed under it, the DB-only synthetic learners with all
 * their rows, the independent Student's (lp-student) learning data, the LP
 * exam attempts and what the LP class added to Sofía's plan. Every other
 * fixture and every real account is untouched.
 */
export async function learningPlanTeardown(): Promise<void> {
  assertDev();
  const q = (sql: string, p: unknown[]) => db.query(sql, p);
  const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows.map((r: any) => r.id as string);
  const insts = await rows(`SELECT id FROM institutions WHERE name = $1`, [INST_LP_NAME]);
  const classIds = await rows(`SELECT id FROM classes WHERE institution_id = ANY($1::uuid[])`, [insts]);
  const synthetic = await rows(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`${LP_SYNTHETIC_PREFIX}%`]);
  const lpStudent = await rows(`SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, [emailFor('lp-student')]);
  const sofia = await rows(`SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, [emailFor('student-a')]);
  const lpUsers = await rows(`SELECT id FROM users WHERE email = ANY($1::text[])`, [[emailFor('lp-teacher'), emailFor('lp-coord')]]);
  const learners = [...synthetic, ...lpStudent];

  // Exam data of the LP scenarios.
  const profiles = await rows(
    `SELECT id FROM student_exam_profiles WHERE student_id = ANY($1::uuid[]) OR (student_id = ANY($2::uuid[]) AND purpose = $3)`,
    [learners, sofia, LP_EXAM_PURPOSE]
  );
  const attempts = await rows(`SELECT id FROM exam_attempts WHERE student_exam_profile_id = ANY($1::uuid[])`, [profiles]);
  await q(`DELETE FROM learning_recommendations WHERE exam_attempt_id = ANY($1::uuid[])`, [attempts]);
  await q(`DELETE FROM exam_attempt_item_responses WHERE exam_attempt_id = ANY($1::uuid[])`, [attempts]);
  if ((await db.query(`SELECT to_regclass('public.exam_attempt_results') IS NOT NULL AS p`)).rows[0].p) {
    await q(`DELETE FROM exam_attempt_results WHERE exam_attempt_id = ANY($1::uuid[])`, [attempts]);
  }
  await q(`DELETE FROM exam_attempts WHERE id = ANY($1::uuid[])`, [attempts]);
  await q(`DELETE FROM student_exam_profiles WHERE id = ANY($1::uuid[])`, [profiles]);

  const interventions = await rows(`SELECT id FROM teacher_interventions WHERE institution_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [insts, learners]);
  await q(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [interventions]);

  // What the LP class added to Sofía (and any fixture learner), then every LP plan / curriculum row.
  await detachTeacherAddedConcepts(classIds);
  await purgeLearningPlanRows({ studentIds: learners, classIds, institutionIds: insts, userIds: lpUsers });

  // Learner concepts of the synthetic learners and of the independent Student (fixtures only).
  const subjects = await rows(`SELECT id FROM subjects WHERE student_id = ANY($1::uuid[])`, [learners]);
  const concepts = await rows(`SELECT id FROM concepts WHERE subject_id = ANY($1::uuid[])`, [subjects]);
  await q(`DELETE FROM concept_catalog_mapping WHERE learner_concept_id = ANY($1::uuid[])`, [concepts]);
  await q(`DELETE FROM mastery_records WHERE concept_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [concepts, learners]);
  await q(`DELETE FROM concept_localizations WHERE concept_id = ANY($1::uuid[])`, [concepts]);
  await q(`DELETE FROM concepts WHERE id = ANY($1::uuid[])`, [concepts]);
  await q(`DELETE FROM subjects WHERE id = ANY($1::uuid[])`, [subjects]);

  await q(`DELETE FROM teacher_assignments WHERE institution_membership_id IN (SELECT id FROM institution_memberships WHERE institution_id = ANY($1::uuid[]))`, [insts]);
  await q(`DELETE FROM class_enrollments WHERE class_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [classIds, synthetic]);
  await q(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [classIds]);
  await q(`DELETE FROM grades WHERE institution_id = ANY($1::uuid[])`, [insts]);
  await q(`DELETE FROM institution_memberships WHERE institution_id = ANY($1::uuid[])`, [insts]);
  await q(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[])`, [lpUsers]);
  // UX E2E residue: the independent Student's inbox and parent request, and LP-institution notices sent to other fixtures.
  const lpStudentUser = await rows(`SELECT id FROM users WHERE email = $1`, [emailFor('lp-student')]);
  await q(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [lpStudentUser, lpStudent]);
  await q(
    `DELETE FROM notifications WHERE recipient_user_id IN (SELECT id FROM users WHERE email LIKE 'studyus-ta-%+clerk_test@example.com')
       AND (payload->>'institutionName' = $1 OR notification_type = 'PARENT_LINK_DECLINED')`,
    [INST_LP_NAME]
  );
  await q(`DELETE FROM parent_student_relationships WHERE student_id = ANY($1::uuid[])`, [lpStudent]);
  await q(`DELETE FROM admin_audit_log WHERE target_id = ANY($1::text[])`, [insts]);
  await q(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [insts]);
  await q(`DELETE FROM user_language_preferences WHERE user_id = ANY($1::uuid[])`, [synthetic]);
  await q(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [synthetic]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[]) OR clerk_id LIKE $2`, [synthetic, `${LP_SYNTHETIC_PREFIX}%`]);
  console.log(`learning-plan teardown: ${insts.length} LP institution, ${synthetic.length} synthetic learners, ${attempts.length} exam attempts removed`);
}

/**
 * Concepts a Teacher assignment added to FIXTURE learners' plans for these
 * (fixture) classes are removed with them, so every run starts with the
 * same plans; any other concept only loses its provenance link.
 */
export async function detachTeacherAddedConcepts(classIds: string[]): Promise<void> {
  if (classIds.length === 0) return;
  const fixtureConcepts = (await db.query(
    `SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id JOIN students st ON st.id = s.student_id JOIN users u ON u.id = st.user_id
     WHERE c.origin IN ('TEACHER_ASSIGNMENT', 'CLASS_PLAN', 'INSTITUTION_ASSIGNMENT') AND c.origin_class_id = ANY($1::uuid[]) AND u.email LIKE 'studyus-ta-%+clerk_test@example.com'`,
    [classIds]
  )).rows.map((r: any) => r.id);
  await purgeLearningPlanRows({ classIds, learnerConceptIds: fixtureConcepts });
  if (fixtureConcepts.length > 0) {
    await db.query(`DELETE FROM concept_catalog_mapping WHERE learner_concept_id = ANY($1::uuid[])`, [fixtureConcepts]);
    await db.query(`DELETE FROM mastery_records WHERE concept_id = ANY($1::uuid[])`, [fixtureConcepts]);
    await db.query(`DELETE FROM concept_localizations WHERE concept_id = ANY($1::uuid[])`, [fixtureConcepts]);
    await db.query(`DELETE FROM concepts WHERE id = ANY($1::uuid[])`, [fixtureConcepts]);
  }
  await db.query(`UPDATE concepts SET origin_class_id = NULL WHERE origin_class_id = ANY($1::uuid[])`, [classIds]);
}

/**
 * Institution / coordinator E2E starting state (DEV fixtures only):
 * removes every `Institution E2E …` institution with everything filed under
 * it, the coordinator invitations, and the sign-up-later identities
 * (`coord-a`, `coord-x`: Clerk user + StudyUS rows), and takes coordinator
 * memberships away from `coord-b` (it stays a Teacher). TA Institución A / B
 * and every other identity are untouched.
 */
export async function institutionReset() {
  assertDev();
  const insts = (await db.query(`SELECT id FROM institutions WHERE name LIKE $1`, [`${E2E_INSTITUTION_PREFIX}%`])).rows.map((r: any) => r.id);
  const q = (sql: string, p: unknown[]) => db.query(sql, p);
  const interventions = (await db.query(`SELECT id FROM teacher_interventions WHERE institution_id = ANY($1::uuid[])`, [insts])).rows.map((r: any) => r.id);
  await q(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM teacher_assignments WHERE institution_membership_id IN (SELECT id FROM institution_memberships WHERE institution_id = ANY($1::uuid[]))`, [insts]);
  await q(`DELETE FROM class_enrollments WHERE class_id IN (SELECT id FROM classes WHERE institution_id = ANY($1::uuid[]))`, [insts]);
  await detachTeacherAddedConcepts((await db.query(`SELECT id FROM classes WHERE institution_id = ANY($1::uuid[])`, [insts])).rows.map((r: any) => r.id));
  // curricula / institution tasks reference classes and grades: purge them first
  await purgeLearningPlanRows({ institutionIds: insts });
  await q(`DELETE FROM classes WHERE institution_id = ANY($1::uuid[])`, [insts]);
  await q(`DELETE FROM grades WHERE institution_id = ANY($1::uuid[])`, [insts]);
  await q(`DELETE FROM institution_admin_invitations WHERE institution_id = ANY($1::uuid[]) OR email LIKE 'studyus-ta-%+clerk_test@example.com'`, [insts]);
  await q(`DELETE FROM institution_memberships WHERE institution_id = ANY($1::uuid[])`, [insts]);
  await q(`DELETE FROM admin_audit_log WHERE target_id = ANY($1::text[])`, [insts]);
  await q(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [insts]);
  for (const tag of SIGN_UP_LATER as Set<Tag>) {
    const u = await findClerkUser(tag);
    const rows = (await db.query(`SELECT id FROM users WHERE email = $1 OR clerk_id = $2`, [emailFor(tag), u?.id ?? '-'])).rows.map((r: any) => r.id);
    await q(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[])`, [rows]);
    await q(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [rows, rows]);
    await purgeLearningPlanRows({ userIds: rows });
    await q(`DELETE FROM institution_memberships WHERE user_id = ANY($1::uuid[])`, [rows]);
    await q(`DELETE FROM user_language_preferences WHERE user_id = ANY($1::uuid[])`, [rows]);
    await q(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [rows]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [rows]);
    if (u) await clerk().users.deleteUser(u.id);
  }
  await q(`DELETE FROM notifications WHERE recipient_user_id IN (SELECT id FROM users WHERE email = $1)`, [emailFor('platform-admin')]);
  const coordB = (await db.query(`SELECT id FROM users WHERE email = $1`, [emailFor('coord-b')])).rows[0]?.id;
  if (coordB) {
    await q(`DELETE FROM institution_memberships WHERE user_id = $1 AND membership_role = 'INSTITUTION_ADMIN'`, [coordB]);
    await q(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'INSTITUTION_ADMIN'`, [coordB]);
    await q(`DELETE FROM notifications WHERE recipient_user_id = $1`, [coordB]);
  }
  console.log(`institution-reset done: ${insts.length} E2E institutions removed; coord-a / coord-x not signed up; coord-b is a Teacher without coordination`);
}

/** The person "signs up" after their invitation: a Clerk DEV test user with the invited email (no password). Returns a 10-minute session token. */
export async function signUpLater(tag: Tag): Promise<string> {
  assertDev();
  if (!SIGN_UP_LATER.has(tag)) throw new Error(`${tag} is provisioned, not signed up later`);
  const clerkId = await ensureClerkUser(tag);
  const session = await clerk().sessions.createSession({ userId: clerkId });
  return (await clerk().sessions.getToken(session.id, undefined, 600)).jwt;
}

/** A one-time sign-in ticket URL path for the browser (no password is ever used). */
async function signin(tag: Tag) {
  assertDev();
  const u = await findClerkUser(tag);
  if (!u) throw new Error(`missing Clerk identity ${tag}`);
  const t = await clerk().signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: Number(process.env.TICKET_TTL_SECONDS ?? 600) });
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
  await institutionReset();
  await learningPlanTeardown();
  const institutions = (await db.query(`SELECT id FROM institutions WHERE name = ANY($1::text[])`, [[INST_A_NAME, INST_B_NAME]])).rows.map((r: any) => r.id);
  const studentIds = (await db.query(`SELECT id FROM students WHERE user_id = ANY($1::uuid[]) OR clerk_id = ANY($2::text[])`, [userIds, clerkIds])).rows.map((r: any) => r.id);
  const profileIds = (await db.query(`SELECT id FROM profiles WHERE id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[]) OR clerk_id = ANY($3::text[])`, [studentIds, userIds, clerkIds])).rows.map((r: any) => r.id);
  const q = (sql: string, p: unknown[]) => db.query(sql, p);

  await purgeLearningPlanRows({ studentIds, institutionIds: institutions, userIds, classIds: (await db.query(`SELECT id FROM classes WHERE institution_id = ANY($1::uuid[])`, [institutions])).rows.map((r: any) => r.id) });

  // Learning data a fixture student produced during the E2E (practice through
  // the canonical engine) -- removed with the fixture student, nothing else.
  const interventions = (await db.query(`SELECT id FROM teacher_interventions WHERE institution_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [institutions, studentIds])).rows.map((r: any) => r.id);
  await q(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [interventions]);
  await q(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [userIds, profileIds]);
  await q(`DELETE FROM teacher_assignments WHERE institution_membership_id IN (SELECT id FROM institution_memberships WHERE institution_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[]))`, [institutions, userIds]);
  await q(`DELETE FROM class_enrollments WHERE class_id IN (SELECT id FROM classes WHERE institution_id = ANY($1::uuid[])) OR student_id = ANY($2::uuid[])`, [institutions, studentIds]);
  await detachTeacherAddedConcepts((await db.query(`SELECT id FROM classes WHERE institution_id = ANY($1::uuid[])`, [institutions])).rows.map((r: any) => r.id));
  await q(`DELETE FROM classes WHERE institution_id = ANY($1::uuid[])`, [institutions]);
  await q(`DELETE FROM grades WHERE institution_id = ANY($1::uuid[])`, [institutions]);
  await q(`DELETE FROM institution_memberships WHERE institution_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])`, [institutions, userIds]);
  await q(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [institutions]);
  await q(`DELETE FROM parent_student_relationships WHERE student_id = ANY($1::uuid[]) OR parent_id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM parent_invitations WHERE student_id = ANY($1::uuid[]) OR lower(invited_email) LIKE 'studyus-ta-%+clerk_test@example.com'`, [profileIds]);
  await q(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [userIds, userIds]);
  await q(`DELETE FROM concept_catalog_mapping WHERE learner_concept_id IN (SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = ANY($1::uuid[]))`, [studentIds]);

  // Every remaining row that references a fixture student/profile/subject/concept, removed
  // depth-first along the FK graph (children before parents), scoped strictly to fixture ids.
  const fkRows = (await db.query(
    `SELECT conrelid::regclass::text AS t, a.attname AS c, confrelid::regclass::text AS parent, pa.attname AS pc
     FROM pg_constraint con
     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
     WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1`
  )).rows as { t: string; c: string; parent: string; pc: string }[];
  const hasId = new Set((await db.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id'`)).rows.map((r: any) => r.table_name));
  const visiting = new Set<string>();
  async function purge(table: string, keyColumn: string, keys: unknown[]): Promise<void> {
    if (keys.length === 0) return;
    const marker = `${table}.${keyColumn}`;
    if (visiting.has(marker)) return;
    visiting.add(marker);
    // Rows of `table` being removed, as values of each column children may reference.
    for (const fk of fkRows.filter((f) => f.parent === table && f.t !== table)) {
      const parentKeys = fk.pc === keyColumn ? keys : (await db.query(`SELECT ${fk.pc} AS k FROM ${table} WHERE ${keyColumn} = ANY($1)`, [keys])).rows.map((r: any) => r.k);
      if (parentKeys.length === 0) continue;
      if (hasId.has(fk.t)) {
        const childIds = (await db.query(`SELECT id FROM ${fk.t} WHERE ${fk.c} = ANY($1)`, [parentKeys])).rows.map((r: any) => r.id);
        await purge(fk.t, 'id', childIds);
      } else {
        await purge(fk.t, fk.c, parentKeys);
      }
    }
    await db.query(`DELETE FROM ${table} WHERE ${keyColumn} = ANY($1)`, [keys]);
    visiting.delete(marker);
  }
  const subjectIds = (await db.query(`SELECT id FROM subjects WHERE student_id = ANY($1::uuid[])`, [studentIds])).rows.map((r: any) => r.id);
  await purge('subjects', 'id', subjectIds);
  // Tables keyed by student id without an FK (learning engine projections).
  const studentKeyed = (await db.query(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.column_name = 'student_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.table_name NOT IN ('students')`
  )).rows.map((r: any) => r.table_name);
  for (const t of studentKeyed) {
    if (hasId.has(t)) {
      const rowIds = (await db.query(`SELECT id FROM ${t} WHERE student_id = ANY($1::uuid[])`, [studentIds])).rows.map((r: any) => r.id);
      await purge(t, 'id', rowIds);
    } else {
      await purge(t, 'student_id', studentIds);
    }
  }
  await q(`DELETE FROM user_language_preferences WHERE user_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])`, [profileIds, userIds]);
  await q(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await purge('student_profiles', 'id', profileIds);
  await purge('students', 'id', studentIds);
  await purge('profiles', 'id', profileIds);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);

  for (const id of clerkIds) await clerk().users.deleteUser(id).catch(() => {});

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
  const run = cmd === 'learning-plan-teardown' ? learningPlanTeardown() : cmd === 'institution-reset' ? institutionReset() : cmd === 'teacher-reset' ? teacherReset() : cmd === 'manual-prep' ? manualPrep() : cmd === 'provision' ? provision() : cmd === 'tokens' ? tokens(arg) : cmd === 'signin' ? signin(arg as Tag) : cmd === 'cleanup' ? cleanup() : Promise.reject(new Error('usage: provision | teacher-reset | institution-reset | learning-plan-teardown | manual-prep | tokens <file> | signin <tag> | cleanup'));
  run
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await (db as any).end?.();
    });
}
