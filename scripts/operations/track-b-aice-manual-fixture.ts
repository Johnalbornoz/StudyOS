/**
 * Cambridge AICE / PISA manual E2E -- operator fixture (DEV ONLY).
 *
 *   prepare   -- one +clerk_test Student for the AICE / PISA manual runs
 *                (first-run complete, country CO), with a clean baseline: no
 *                exams, no Diploma plan, no Cambridge results.
 *   results   -- records DEV_FIXTURE Cambridge results for that Student (the
 *                Student can never record results; in production a coordinator
 *                does it from the official statement).
 *   evidence  -- READ-ONLY snapshot for the manual steps.
 *   reset     -- removes that Student's exam data, Diploma plan and results.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-aice-manual-fixture.ts <prepare|results|evidence|reset>
 */
import { createHash } from 'crypto';
import { createClerkClient } from '@clerk/backend';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { upsertAcademicProfile } from '@/services/academic-profile.service';
import { resetStudentExamFixtures } from '@/lib/exam-core/dev-fixture-reset';
import { recordResult, getPlanView } from '@/lib/exam-core/aice/plan.service';

const DEV_FP = '2a29b99ee14a22b4';
const DEV_CLERK = 'shining-impala-8101.clerk.accounts.dev';
const EMAIL = 'studyus-tb-exams+clerk_test@example.com';

function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  const inst = Buffer.from(pk.split('_')[2] ?? '', 'base64').toString().replace(/\$$/, '');
  if (fp !== DEV_FP) throw new Error(`REFUSING: DB ${fp}`);
  if (inst !== DEV_CLERK || !(process.env.CLERK_SECRET_KEY ?? '').startsWith('sk_test_')) throw new Error(`REFUSING: Clerk ${inst}`);
}
const clerk = () => createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
async function studentId(): Promise<{ id: string; userId: string } | null> {
  const r = await db.query(`SELECT s.id, u.id AS user_id FROM students s JOIN users u ON u.clerk_id = s.clerk_id WHERE u.email = $1`, [EMAIL]);
  return r.rows[0] ? { id: r.rows[0].id, userId: r.rows[0].user_id } : null;
}
async function snapshot(sid: string) {
  const n = async (sql: string) => Number((await db.query(sql, [sid])).rows[0].n);
  const v = await getPlanView(sid);
  return {
    studentId: sid,
    examInstances: await n(`SELECT count(*) n FROM exam_instances WHERE student_id = $1 AND status <> 'DELETED'`),
    simulationAttempts: await n(`SELECT count(*) n FROM simulation_attempts WHERE student_id = $1`),
    examProfiles: await n(`SELECT count(*) n FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED'`),
    diplomaPlan: v.plan ? { entries: v.entries.map((e) => `${e.syllabusCode} ${e.level} ${e.countedGroup ?? 'choose'}`), credits: v.planEvaluation.totalCredits, complete: v.planEvaluation.complete } : null,
    results: v.diploma.results.map((r) => `${r.syllabusCode} ${r.level} ${r.grade} ${r.series.month}/${r.series.year} ${r.status}${r.counted ? ' COUNTED' : ''}`),
    diploma: { points: v.diploma.points, band: v.diploma.band, compositionValid: v.diploma.compositionValid },
    examGapLinks: await n(`SELECT count(*) n FROM exam_gap_concept_links WHERE student_id = $1`),
    concepts: (await db.query(`SELECT cl.label, s.name AS subject FROM concepts c JOIN subjects s ON s.id = c.subject_id LEFT JOIN concept_localizations cl ON cl.concept_id = c.id WHERE s.student_id = $1 ORDER BY c.created_at`, [sid])).rows.map((r: any) => `${r.subject}: ${r.label}`),
  };
}
async function reset(sid: string) {
  await resetStudentExamFixtures({ studentId: sid, confirm: 'RESET-DEV-FIXTURES' });
  await db.query(`DELETE FROM exam_gap_concept_links WHERE student_id = $1`, [sid]);
  await db.query(`DELETE FROM cambridge_results WHERE student_id = $1`, [sid]);
  await db.query(`DELETE FROM aice_plan_entries WHERE plan_id IN (SELECT id FROM aice_diploma_plans WHERE student_id = $1)`, [sid]);
  await db.query(`DELETE FROM aice_diploma_plans WHERE student_id = $1`, [sid]);
  await db.query(`UPDATE student_exam_profiles SET replaced_by_profile_id = NULL WHERE student_id = $1`, [sid]);
  await db.query(`DELETE FROM student_exam_profiles WHERE student_id = $1 AND NOT EXISTS (SELECT 1 FROM simulation_attempts sa WHERE sa.exam_profile_id = student_exam_profiles.id)`, [sid]);
}

async function main() {
  guard();
  const cmd = process.argv[2];
  if (cmd === 'prepare') {
    let u = (await clerk().users.getUserList({ emailAddress: [EMAIL] })).data[0];
    if (!u) u = await clerk().users.createUser({ emailAddress: [EMAIL], firstName: 'Ana', lastName: 'AICE PISA Manual', skipPasswordRequirement: true, publicMetadata: { fixture: 'TRACK_B_AICE_PISA_MANUAL' } });
    const user = await getOrCreateCanonicalUser(u.id, EMAIL);
    const sid = await upsertStudentFromWebhook(u.id, EMAIL, 'Ana AICE PISA Manual');
    await assignSelfServiceRole(u.id, user.id, 'STUDENT');
    await upsertAcademicProfile(sid, { countryOfStudy: 'CO', schoolYear: '11', curriculumType: 'other', academicYear: '2026', profileCompleted: true } as any);
    await reset(sid);
    console.log(JSON.stringify({ email: EMAIL, clerkUserId: u.id, baseline: await snapshot(sid) }, null, 2));
    return;
  }
  const s = await studentId();
  if (!s) throw new Error('run prepare first');
  if (cmd === 'results') {
    // A valid Diploma composition within 25 months + one result outside the window.
    const R = (syllabusCode: string, level: 'AS' | 'A', grade: string, year: number, month: 3 | 6 | 11) => recordResult({ studentId: s.id, syllabusCode, level, series: { year, month }, grade, source: 'DEV_FIXTURE', recordedByUserId: s.userId });
    await R('9239', 'AS', 'b', 2026, 6);
    await R('9709', 'A', 'A', 2027, 6);
    await R('9093', 'AS', 'c', 2026, 11);
    await R('9708', 'A', 'B', 2027, 6);
    await R('9702', 'AS', 'a', 2026, 11);
    await R('9701', 'AS', 'b', 2024, 6);
  } else if (cmd === 'reset') {
    await reset(s.id);
  } else if (cmd !== 'evidence') throw new Error('usage: prepare | results | evidence | reset');
  console.log(JSON.stringify(await snapshot(s.id), null, 2));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.end());
