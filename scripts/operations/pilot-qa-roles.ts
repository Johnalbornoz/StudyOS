/**
 * Pilot QA role identities on the PILOT CANDIDATE (Role E2E provisioning only -- no product behaviour).
 *
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-roles.ts plan
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-roles.ts provision --apply
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-roles.ts verify
 *
 * `provision` and `tokens` need the Clerk keys of the candidate's Clerk instance in the shell environment
 * (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY, sk_test_ only). They are never read from, or written to, the
 * repository. `plan` and `verify` are read-only and need only the database (plus the public publishable key).
 *
 * Guards (every command): the database fingerprint is the pilot candidate's (4baac799b9bd2a6a) AND the Clerk
 * instance is the candidate / preview lineage Development instance (ample-gannet-4634.clerk.accounts.dev, pk_test_),
 * which is NOT the Production instance (clerk.studyus.pro, pk_live_). Identified 2026-10-17 from the public
 * publishable key served by the candidate deployment and by preview.studyus.pro; Production serves pk_live_.
 *
 * Identities are synthetic: `studyus-qa-<tag>+clerk_test@example.com` (Clerk test mode), created WITHOUT a password
 * (sign-in by short-lived sign-in ticket / backend session token only), tagged `studyus_pilot_qa`.
 * No real Student is reused. Nothing is deleted by this script.
 *
 * Relationship model:
 *   QA Institución Piloto (timezone America/Mexico_City -- synthetic test data, needed by the 21:00 assignment window)
 *   └── QA Clase Piloto  <- student-a, student-b, student-c (ACTIVE enrollments)
 *   teacher  -> approved Teacher membership of the QA institution, assigned ONLY to QA Clase Piloto
 *   parent   -> accepted link ONLY to student-c
 *   inst     -> INSTITUTION_ADMIN membership ONLY of the QA institution
 *   admin    -> STUDYUS_ADMIN capability (audited)
 * Supply profiles (the entitlement model has no Learning-vs-ExamPrep commercial split: one LEARNING_FULL_ACCESS
 * license covers both, so the profile is the learner's own data):
 *   student-a Learning-only : a personal subject + concept (mapped to the catalog), NO exam preparation
 *   student-b ExamPrep-only : a PAA exam preparation, NO personal subject
 *   student-c Combined      : both
 * Every Student gets an administrative QA license (expiry 2026-11-30) granted by the QA admin.
 */
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { createClerkClient } from '@clerk/backend';
import { db } from '@/lib/db';

export const CANDIDATE_FP = '4baac799b9bd2a6a';
export const CANDIDATE_CLERK_INSTANCE = 'ample-gannet-4634.clerk.accounts.dev';
export const PRODUCTION_CLERK_INSTANCE = 'clerk.studyus.pro';
export const QA_TAG = 'studyus_pilot_qa';
export const QA_INSTITUTION = 'QA Institución Piloto';
export const QA_GRADE = 'QA Grado Piloto';
export const QA_CLASS = 'QA Clase Piloto';
export const QA_TIMEZONE = 'America/Mexico_City';
export const QA_LICENSE_EXPIRES = '2026-11-30T23:59:59Z';
export const QA_CONCEPT = 'Linear Equations';

export const QA_IDENTITIES = {
  'student-a': { first: 'QA Ana', last: 'Learning', role: 'STUDENT' },
  'student-b': { first: 'QA Beto', last: 'ExamPrep', role: 'STUDENT' },
  'student-c': { first: 'QA Caro', last: 'Combined', role: 'STUDENT' },
  parent: { first: 'QA Paula', last: 'Parent', role: 'PARENT' },
  teacher: { first: 'QA Tomás', last: 'Teacher', role: 'TEACHER' },
  inst: { first: 'QA Inés', last: 'Institution', role: null },
  admin: { first: 'QA Adán', last: 'Admin', role: null },
} as const;
export type QaTag = keyof typeof QA_IDENTITIES;
const TAGS = Object.keys(QA_IDENTITIES) as QaTag[];
export const qaEmail = (tag: QaTag) => `studyus-qa-${tag}+clerk_test@example.com`;

export function dbFingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}
export function clerkInstanceOf(pk: string): string {
  return Buffer.from(pk.split('_')[2] ?? '', 'base64').toString().replace(/\$$/, '');
}

export function assertCandidate(needSecret: boolean): void {
  if (dbFingerprint() !== CANDIDATE_FP) throw new Error(`REFUSING: database is not the pilot candidate (${dbFingerprint()})`);
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  if (!pk.startsWith('pk_test_')) throw new Error('REFUSING: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a pk_test_ (Development) key');
  const instance = clerkInstanceOf(pk);
  if (instance === PRODUCTION_CLERK_INSTANCE || instance !== CANDIDATE_CLERK_INSTANCE) throw new Error(`REFUSING: Clerk instance is not the candidate instance (${instance})`);
  if (needSecret && !(process.env.CLERK_SECRET_KEY ?? '').startsWith('sk_test_')) throw new Error('REFUSING: CLERK_SECRET_KEY missing or not sk_test_');
}

const clerk = () => createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
async function findClerkUser(tag: QaTag) {
  return (await clerk().users.getUserList({ emailAddress: [qaEmail(tag)] })).data[0] ?? null;
}
async function ensureClerkUser(tag: QaTag): Promise<string> {
  const existing = await findClerkUser(tag);
  if (existing) return existing.id;
  const s = QA_IDENTITIES[tag];
  return (await clerk().users.createUser({ emailAddress: [qaEmail(tag)], firstName: s.first, lastName: s.last, skipPasswordRequirement: true, publicMetadata: { fixture: QA_TAG, tag } })).id;
}

async function paaObjectiveKey(): Promise<string> {
  const { examObjectives } = await import('@/lib/exam-core/objectives/objective-catalog');
  const { isObjectiveExposed } = await import('@/lib/exam-core/student-exposure');
  const o = examObjectives().find((x) => x.framework === 'PAA' && x.kind === 'EXAM' && isObjectiveExposed(x as any));
  if (!o) throw new Error('no exposed PAA exam objective in the catalog');
  return o.key;
}

async function existing() {
  const users = (await db.query(`SELECT id, email FROM users WHERE email = ANY($1::text[])`, [TAGS.map(qaEmail)])).rows;
  const inst = (await db.query(`SELECT id, timezone FROM institutions WHERE name = $1`, [QA_INSTITUTION])).rows[0] ?? null;
  return { users, inst };
}

async function plan() {
  assertCandidate(false);
  const e = await existing();
  const paa = await paaObjectiveKey();
  const concept = (await db.query(`SELECT count(*)::int n FROM canonical_concepts WHERE name = $1 AND status = 'ACTIVE'`, [QA_CONCEPT])).rows[0].n;
  console.log(JSON.stringify({
    target: { dbFingerprint: dbFingerprint(), clerkInstance: clerkInstanceOf(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '') },
    identities: TAGS.map((t) => ({ tag: t, email: qaEmail(t), role: QA_IDENTITIES[t].role, existsInDb: e.users.some((u: any) => u.email === qaEmail(t)) })),
    institution: e.inst ? { exists: true, timezone: e.inst.timezone } : { exists: false, willCreate: { name: QA_INSTITUTION, timezone: QA_TIMEZONE, grade: QA_GRADE, class: QA_CLASS } },
    examPrepObjective: paa,
    learningCatalogConcept: { name: QA_CONCEPT, present: concept > 0 },
    license: { expiresAt: QA_LICENSE_EXPIRES },
  }, null, 2));
}

async function provision() {
  assertCandidate(true);
  if (!process.argv.includes('--apply')) throw new Error('REFUSING: provision writes; run `plan` first, then `provision --apply`');
  const { getOrCreateCanonicalUser, assignSelfServiceRole } = await import('@/lib/identity');
  const inst = await import('@/services/institution.service');
  const { ensureCatalogMapping, confirmMapping } = await import('@/lib/catalog/mapping.service');
  const { upsertAcademicProfile } = await import('@/services/academic-profile.service');
  const { requestChildLink, respondToRequest } = await import('@/services/parent.service');
  const { grantAdminLicense } = await import('@/services/membership-admin.service');
  const { createObjectivePreparation } = await import('@/lib/exam-core/objectives/preparation.service');
  const { recordAdminAction } = await import('@/lib/admin/audit');

  const ids: Record<string, { clerkId: string; userId: string; studentId?: string }> = {};
  for (const tag of TAGS) {
    const clerkId = await ensureClerkUser(tag);
    const user = await getOrCreateCanonicalUser(clerkId, qaEmail(tag));
    const role = QA_IDENTITIES[tag].role;
    if (role) await assignSelfServiceRole(clerkId, user.id, role);
    if (role === 'PARENT' && (await db.query(`SELECT 1 FROM profiles WHERE clerk_id = $1`, [clerkId])).rows.length === 0) {
      await db.query(`INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', $1, $2, $3)`, [`${QA_IDENTITIES[tag].first} ${QA_IDENTITIES[tag].last}`, clerkId, user.id]);
    }
    const student = (await db.query(`SELECT id FROM students WHERE clerk_id = $1`, [clerkId])).rows[0]?.id;
    ids[tag] = { clerkId, userId: user.id, studentId: student };
  }

  // Admin capability (audited, like the allowlist bootstrap).
  const adminGrant = await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'STUDYUS_ADMIN', 'ACTIVE', 'BACKFILL') ON CONFLICT (user_id, role) DO NOTHING RETURNING id`, [ids.admin.userId]);
  if (adminGrant.rows.length > 0) await recordAdminAction({ actorUserId: ids.admin.userId, action: 'ROLE_ADDED', targetType: 'ROLE', targetId: ids.admin.userId, newState: { role: 'STUDYUS_ADMIN', status: 'ACTIVE', grantedVia: 'BACKFILL' }, reason: 'PILOT_QA_FIXTURE' } as any);

  // Institution, grade, class (timezone is required by the teacher assignment window).
  const institutionId = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [QA_INSTITUTION])).rows[0]?.id ?? (await inst.createInstitution(QA_INSTITUTION)).id;
  await db.query(`UPDATE institutions SET timezone = COALESCE(timezone, $2) WHERE id = $1`, [institutionId, QA_TIMEZONE]);
  await inst.inviteInstitutionAdmin(institutionId, ids.inst.userId);
  const gradeId = (await db.query(`SELECT id FROM grades WHERE institution_id = $1 AND name = $2`, [institutionId, QA_GRADE])).rows[0]?.id ?? (await inst.createGrade(institutionId, QA_GRADE)).id;
  const canonical = (await db.query(`SELECT id, canonical_subject_id FROM canonical_concepts WHERE name = $1 AND status = 'ACTIVE' LIMIT 1`, [QA_CONCEPT])).rows[0];
  if (!canonical) throw new Error(`catalog concept "${QA_CONCEPT}" missing on the candidate`);
  const classId = (await db.query(`SELECT id FROM classes WHERE institution_id = $1 AND name = $2`, [institutionId, QA_CLASS])).rows[0]?.id ?? (await inst.createClass(institutionId, gradeId, QA_CLASS, canonical.canonical_subject_id)).id;

  // Teacher: approved membership, assigned ONLY to the QA class.
  const tm = await inst.requestTeacherMembership(institutionId, ids.teacher.userId);
  if (tm.status === 'PENDING') await inst.decideMembership(tm.id, ids.inst.userId, 'APPROVED');
  if ((await db.query(`SELECT 1 FROM teacher_assignments WHERE institution_membership_id = $1 AND class_id = $2 AND status = 'ACTIVE'`, [tm.id, classId])).rows.length === 0) await inst.createTeacherAssignment(tm.id, { classId });

  // Students: first-run profile, license, class enrollment, supply profile.
  const paa = await paaObjectiveKey();
  for (const tag of ['student-a', 'student-b', 'student-c'] as const) {
    const studentId = ids[tag].studentId!;
    await upsertAcademicProfile(studentId, { countryOfStudy: 'MX', schoolYear: '11', curriculumType: 'national', academicYear: '2026', profileCompleted: true } as any);
    await grantAdminLicense(ids.admin.userId, { studentId, reason: 'PILOT_QA_FIXTURE', expiresAt: QA_LICENSE_EXPIRES, source: 'ADMIN_PROMOTION' });
    await db.query(`INSERT INTO class_enrollments (class_id, student_id, status, invited_by_user_id, responded_at) SELECT $1, $2, 'ACTIVE', $3, NOW() WHERE NOT EXISTS (SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE')`, [classId, studentId, ids.inst.userId]);
    if (tag !== 'student-b') {
      let subjectId = (await db.query(`SELECT id FROM subjects WHERE student_id = $1 AND name = 'Matemáticas'`, [studentId])).rows[0]?.id;
      if (!subjectId) subjectId = (await db.query(`INSERT INTO subjects (student_id, name, status) VALUES ($1, 'Matemáticas', 'active') RETURNING id`, [studentId])).rows[0].id;
      let conceptId = (await db.query(`SELECT id FROM concepts WHERE subject_id = $1 LIMIT 1`, [subjectId])).rows[0]?.id;
      if (!conceptId) {
        conceptId = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, 'ECUACIONES_LINEALES_QA') RETURNING id`, [subjectId])).rows[0].id;
        await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'es', 'Ecuaciones lineales'), ($1, 'en', 'Linear equations')`, [conceptId]);
      }
      const m = await ensureCatalogMapping(conceptId);
      if (m.status !== 'MATCHED') await confirmMapping(m.id, canonical.id, ids.admin.userId);
    }
    if (tag !== 'student-a') await createObjectivePreparation(studentId, { objectiveKey: paa, timezone: QA_TIMEZONE, source: 'STUDENT' } as any);
  }

  // Parent -> ONLY student-c.
  const parentProfile = (await db.query(`SELECT id FROM profiles WHERE user_id = $1 AND user_type = 'parent'`, [ids.parent.userId])).rows[0].id;
  const linked = await db.query(`SELECT status FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2`, [parentProfile, ids['student-c'].studentId]);
  if (linked.rows[0]?.status !== 'accepted') {
    if (linked.rows.length === 0) await requestChildLink(parentProfile, qaEmail('student-c'));
    await respondToRequest(ids['student-c'].studentId!, parentProfile, true);
  }
  console.log(JSON.stringify({ institutionId, gradeId, classId, paaObjective: paa, identities: Object.fromEntries(TAGS.map((t) => [t, { userId: ids[t].userId, studentId: ids[t].studentId ?? null }])) }, null, 2));
}

/** Read-only relationship + isolation verification. Exit code 1 on any failed check. */
async function verify() {
  assertCandidate(false);
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
  const users = await q(`SELECT u.id, u.email, s.id AS student_id FROM users u LEFT JOIN students s ON s.user_id = u.id WHERE u.email = ANY($1::text[])`, [TAGS.map(qaEmail)]);
  const by = (t: QaTag) => users.find((u: any) => u.email === qaEmail(t));
  const roles = async (t: QaTag) => (await q(`SELECT role FROM user_roles WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY role`, [by(t)?.id])).map((r: any) => r.role);
  const inst = (await q(`SELECT id, timezone FROM institutions WHERE name = $1`, [QA_INSTITUTION]))[0];
  const cls = inst ? (await q(`SELECT id FROM classes WHERE institution_id = $1 AND name = $2`, [inst.id, QA_CLASS]))[0] : null;
  const checks: Array<[string, boolean, unknown?]> = [];
  const check = (name: string, ok: boolean, detail?: unknown) => checks.push([name, ok, detail]);

  for (const t of TAGS) check(`IDENTITY_${t}`, !!by(t));
  for (const t of ['student-a', 'student-b', 'student-c'] as const) {
    const sid = by(t)?.student_id;
    check(`ROLE_${t}`, (await roles(t)).includes('STUDENT'));
    const lic = (await q(`SELECT status, grant_expires_at FROM subscriptions WHERE student_id = $1`, [sid]))[0];
    check(`LICENSE_${t}`, lic?.status === 'active', lic ? { status: lic.status } : null);
    const enr = await q(`SELECT ce.class_id FROM class_enrollments ce WHERE ce.student_id = $1 AND ce.status = 'ACTIVE'`, [sid]);
    check(`ENROLLED_ONLY_QA_CLASS_${t}`, enr.length === 1 && enr[0].class_id === cls?.id, { activeEnrollments: enr.length });
    const subjects = (await q(`SELECT count(*)::int n FROM subjects WHERE student_id = $1 AND name = 'Matemáticas'`, [sid]))[0].n;
    const preps = (await q(`SELECT count(*)::int n FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED'`, [sid]))[0].n;
    const wantLearning = t !== 'student-b', wantExam = t !== 'student-a';
    check(`SUPPLY_PROFILE_${t}`, (subjects > 0) === wantLearning && (preps > 0) === wantExam, { personalLearningSubject: subjects > 0, examPreparations: preps });
  }
  check('ROLE_parent', (await roles('parent')).includes('PARENT'));
  check('ROLE_teacher', (await roles('teacher')).includes('TEACHER'));
  check('ROLE_inst', (await roles('inst')).includes('INSTITUTION_ADMIN'));
  check('ROLE_admin', (await roles('admin')).includes('STUDYUS_ADMIN'));
  check('ADMIN_ONLY_ON_QA_ADMIN', (await q(`SELECT count(*)::int n FROM user_roles r JOIN users u ON u.id = r.user_id WHERE r.role = 'STUDYUS_ADMIN' AND r.status = 'ACTIVE' AND u.email LIKE 'studyus-qa-%' AND u.email <> $1`, [qaEmail('admin')]))[0].n === 0);
  check('QA_INSTITUTION', !!inst && inst.timezone === QA_TIMEZONE, inst ? { timezone: inst.timezone } : null);
  check('QA_CLASS', !!cls);
  const parentLinks = await q(`SELECT psr.student_id, psr.status FROM parent_student_relationships psr JOIN profiles p ON p.id = psr.parent_id WHERE p.user_id = $1`, [by('parent')?.id]);
  check('PARENT_LINKED_ONLY_STUDENT_C', parentLinks.length === 1 && parentLinks[0].student_id === by('student-c')?.student_id && parentLinks[0].status === 'accepted', { links: parentLinks.length });
  const tAssign = await q(`SELECT ta.class_id, ta.grade_id, im.institution_id, im.status FROM teacher_assignments ta JOIN institution_memberships im ON im.id = ta.institution_membership_id WHERE im.user_id = $1 AND ta.status = 'ACTIVE'`, [by('teacher')?.id]);
  check('TEACHER_ASSIGNED_ONLY_QA_CLASS', tAssign.length === 1 && tAssign[0].class_id === cls?.id && tAssign[0].status === 'APPROVED', { assignments: tAssign.length });
  const instMs = await q(`SELECT institution_id, membership_role, status FROM institution_memberships WHERE user_id = $1`, [by('inst')?.id]);
  check('INSTITUTION_SCOPED_ONLY_QA', instMs.length === 1 && instMs[0].institution_id === inst?.id, { memberships: instMs.map((m: any) => ({ role: m.membership_role, status: m.status })) });
  const classStudents = cls ? await q(`SELECT s.user_id FROM class_enrollments ce JOIN students s ON s.id = ce.student_id WHERE ce.class_id = $1 AND ce.status = 'ACTIVE'`, [cls.id]) : [];
  const qaStudentUsers = new Set(['student-a', 'student-b', 'student-c'].map((t) => by(t as QaTag)?.id));
  check('QA_CLASS_ONLY_QA_STUDENTS', classStudents.length === 3 && classStudents.every((r: any) => qaStudentUsers.has(r.user_id)), { activeStudents: classStudents.length });
  const nonQaInInst = inst ? (await q(`SELECT count(*)::int n FROM institution_memberships im JOIN users u ON u.id = im.user_id WHERE im.institution_id = $1 AND u.email NOT LIKE 'studyus-qa-%'`, [inst.id]))[0].n : 0;
  check('NO_REAL_USER_IN_QA_INSTITUTION', nonQaInInst === 0);

  for (const [n, ok, d] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d !== undefined ? ' ' + JSON.stringify(d) : ''}`);
  const failed = checks.filter((c) => !c[1]).length;
  console.log(`verify: ${checks.length - failed}/${checks.length} PASS`);
  if (failed) process.exitCode = 1;
}

/** Short-lived (10 min) backend session tokens -- written only to the given scratch file, never to the repository. */
async function tokens(outfile: string) {
  assertCandidate(true);
  const out: Record<string, string> = {};
  for (const tag of TAGS) {
    const u = await findClerkUser(tag);
    if (!u) throw new Error(`missing Clerk identity ${tag} -- run provision first`);
    const s = await clerk().sessions.createSession({ userId: u.id });
    out[tag] = (await clerk().sessions.getToken(s.id, undefined, 600)).jwt;
  }
  writeFileSync(outfile, JSON.stringify(out), { mode: 0o600 });
  console.log(`wrote ${Object.keys(out).length} session tokens to ${outfile}`);
}

if (process.argv[1]?.endsWith('pilot-qa-roles.ts')) {
  const [cmd, arg] = process.argv.slice(2).filter((a) => a !== '--apply');
  const run = cmd === 'plan' ? plan() : cmd === 'provision' ? provision() : cmd === 'verify' ? verify() : cmd === 'tokens' ? tokens(arg) : Promise.reject(new Error('usage: plan | provision --apply | verify | tokens <scratch-file>'));
  run.catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(async () => { await (db as any).end?.(); });
}
