/**
 * Exam preparation, objective first -- manual E2E operator fixture (DEV ONLY).
 *
 *   prepare   -- one +clerk_test Student (first-run complete, CO, no exam goal)
 *                who ALREADY knows things: three canonical concepts that PISA 2022
 *                requirements map to, in mixed learner states
 *                (demonstrated / in maintenance with a review due / in progress).
 *                No exam preparation, no exam attempts.
 *   evidence  -- READ-ONLY snapshot for the manual steps (preparations, concepts,
 *                learner states, provenance links, diagnostic instances).
 *   reset     -- removes that Student's preparations, exam data, provenance and
 *                learned concepts (back to "prepare" needs prepare again).
 *
 * The learner states are written as the Learning Engine would have left them
 * (DEV fixture rows, clearly scoped to this Student). Nothing else is touched.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-objective-first-manual-fixture.ts <prepare|evidence|reset>
 */
import { createHash } from 'crypto';
import { createClerkClient } from '@clerk/backend';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { upsertAcademicProfile } from '@/services/academic-profile.service';
import { resetStudentExamFixtures } from '@/lib/exam-core/dev-fixture-reset';
import { addConceptToStudentLearning } from '@/lib/exam-core/catalog/learning-links.service';

const DEV_FP = '2a29b99ee14a22b4';
const DEV_CLERK = 'shining-impala-8101.clerk.accounts.dev';
const EMAIL = 'studyus-tb-objective+clerk_test@example.com';

function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  const inst = Buffer.from(pk.split('_')[2] ?? '', 'base64').toString().replace(/\$$/, '');
  if (fp !== DEV_FP) throw new Error(`REFUSING: DB ${fp}`);
  if (inst !== DEV_CLERK || !(process.env.CLERK_SECRET_KEY ?? '').startsWith('sk_test_')) throw new Error(`REFUSING: Clerk ${inst}`);
}
const clerk = () => createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

async function studentId(): Promise<string | null> {
  const r = await db.query(`SELECT s.id FROM students s JOIN users u ON u.clerk_id = s.clerk_id WHERE u.email = $1`, [EMAIL]);
  return r.rows[0]?.id ?? null;
}

/** Three PISA 2022 requirement concepts (each the ONLY concept of its requirement), deterministic order. */
async function pisaMathConcepts(): Promise<Array<{ id: string; name: string }>> {
  return (
    await db.query(
      `SELECT m.canonical_concept_id AS id, cc.name FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED'
         JOIN assessment_blueprints b ON b.exam_version_id = v.id JOIN blueprint_objective_targets t ON t.blueprint_id = b.id
         JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
         JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
        WHERE d.config_key = 'v2.pisa.2022'
          AND (SELECT count(*) FROM objective_concept_mappings m2 WHERE m2.learning_objective_id = t.learning_objective_id AND m2.status = 'PUBLISHED') = 1
        GROUP BY m.canonical_concept_id, cc.name ORDER BY cc.name LIMIT 3`
    )
  ).rows;
}

async function setState(sid: string, conceptId: string, subjectId: string, kind: 'DEMONSTRATED' | 'MAINTENANCE' | 'IN_PROGRESS') {
  const policy = Number((await db.query(`SELECT COALESCE(max(version), 1) AS v FROM mastery_policies`)).rows[0].v) || 1;
  const s = kind === 'DEMONSTRATED'
    ? { mastery: 'VALIDATED_MASTERY', readiness: 'READY', memory: 'STABLE', next: 30 }
    : kind === 'MAINTENANCE'
      ? { mastery: 'VALIDATED_MASTERY', readiness: 'WAITING_FOR_RETENTION', memory: 'WAITING_FOR_RETENTION', next: -2 }
      : { mastery: 'DEVELOPING', readiness: 'INSUFFICIENT_EVIDENCE', memory: null, next: null };
  await db.query(
    `INSERT INTO concept_knowledge_state (student_id, concept_id, subject_id, mastery_state, validation_readiness, evidence_count, independent_evidence_count, transfer_score, mastery_policy_version)
     VALUES ($1, $2, $3, $4, $5, 6, 4, $6, $7)
     ON CONFLICT (student_id, concept_id) DO UPDATE SET mastery_state = EXCLUDED.mastery_state, validation_readiness = EXCLUDED.validation_readiness, evidence_count = 6, transfer_score = EXCLUDED.transfer_score, updated_at = now()`,
    [sid, conceptId, subjectId, s.mastery, s.readiness, kind === 'DEMONSTRATED' ? 0.9 : null, policy]
  );
  if (s.memory) {
    await db.query(
      `INSERT INTO concept_memory_state (student_id, concept_id, policy_version, memory_status, next_review_at) VALUES ($1, $2, 1, $3, now() + ($4 || ' days')::interval)
       ON CONFLICT (student_id, concept_id) DO UPDATE SET memory_status = EXCLUDED.memory_status, next_review_at = EXCLUDED.next_review_at`,
      [sid, conceptId, s.memory, String(s.next)]
    );
  }
}

async function snapshot(sid: string) {
  const q = async (sql: string) => (await db.query(sql, [sid])).rows;
  return {
    studentId: sid,
    preparations: await q(`SELECT id, objective_key, status, exam_date FROM student_exam_profiles WHERE student_id = $1 ORDER BY created_at`),
    concepts: await q(
      `SELECT cl.label, s.name AS subject, ks.mastery_state, ks.validation_readiness, ms.memory_status, (ms.next_review_at <= now()) AS review_due
         FROM concepts c JOIN subjects s ON s.id = c.subject_id LEFT JOIN concept_localizations cl ON cl.concept_id = c.id
         LEFT JOIN concept_knowledge_state ks ON ks.concept_id = c.id AND ks.student_id = $1 LEFT JOIN concept_memory_state ms ON ms.concept_id = c.id AND ms.student_id = $1
        WHERE s.student_id = $1 ORDER BY c.created_at`
    ),
    provenance: await q(`SELECT source, (SELECT name FROM canonical_concepts WHERE id = canonical_concept_id) AS concept FROM exam_gap_concept_links WHERE student_id = $1 ORDER BY created_at`),
    examInstances: await q(`SELECT mode, purpose, status FROM exam_instances WHERE student_id = $1 AND status <> 'DELETED' ORDER BY created_at`),
  };
}

async function reset(sid: string) {
  await resetStudentExamFixtures({ studentId: sid, confirm: 'RESET-DEV-FIXTURES' });
  await db.query(`DELETE FROM exam_gap_concept_links WHERE student_id = $1`, [sid]);
  await db.query(`UPDATE student_exam_profiles SET replaced_by_profile_id = NULL WHERE student_id = $1`, [sid]);
  await db.query(`DELETE FROM student_exam_profiles WHERE student_id = $1 AND NOT EXISTS (SELECT 1 FROM simulation_attempts sa WHERE sa.exam_profile_id = student_exam_profiles.id)`, [sid]);
  await db.query(`UPDATE student_exam_profiles SET status = 'ARCHIVED', archived_at = COALESCE(archived_at, now()), archive_reason = COALESCE(archive_reason, 'STUDENT_REMOVED') WHERE student_id = $1`, [sid]);
  await db.query(`DELETE FROM concept_memory_state WHERE student_id = $1`, [sid]);
  await db.query(`DELETE FROM concept_knowledge_state WHERE student_id = $1`, [sid]);
  await db.query(`DELETE FROM concept_catalog_mapping WHERE learner_concept_id IN (SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1)`, [sid]);
  await db.query(`DELETE FROM concept_localizations WHERE concept_id IN (SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1)`, [sid]);
  await db.query(`DELETE FROM concepts WHERE subject_id IN (SELECT id FROM subjects WHERE student_id = $1)`, [sid]);
  await db.query(`DELETE FROM subjects WHERE student_id = $1`, [sid]);
}

async function main() {
  guard();
  const cmd = process.argv[2];
  if (cmd === 'prepare') {
    let u = (await clerk().users.getUserList({ emailAddress: [EMAIL] })).data[0];
    if (!u) u = await clerk().users.createUser({ emailAddress: [EMAIL], firstName: 'Olga', lastName: 'Objetivo Manual', skipPasswordRequirement: true, publicMetadata: { fixture: 'TRACK_B_OBJECTIVE_FIRST_MANUAL' } });
    const user = await getOrCreateCanonicalUser(u.id, EMAIL);
    const sid = await upsertStudentFromWebhook(u.id, EMAIL, 'Olga Objetivo Manual');
    await assignSelfServiceRole(u.id, user.id, 'STUDENT');
    await upsertAcademicProfile(sid, { countryOfStudy: 'CO', schoolYear: '11', curriculumType: 'other', academicYear: '2026', profileCompleted: true } as any);
    await reset(sid);
    const concepts = await pisaMathConcepts();
    const kinds = ['DEMONSTRATED', 'MAINTENANCE', 'IN_PROGRESS'] as const;
    for (let i = 0; i < concepts.length; i++) {
      const a = await addConceptToStudentLearning(sid, concepts[i].id, 'es');
      await setState(sid, a.studentConceptId, a.subjectId, kinds[i]);
    }
    console.log(JSON.stringify({ email: EMAIL, clerkUserId: u.id, existingKnowledge: concepts.map((c, i) => `${c.name}: ${kinds[i]}`), baseline: await snapshot(sid) }, null, 2));
    return;
  }
  const sid = await studentId();
  if (!sid) throw new Error('run prepare first');
  if (cmd === 'reset') await reset(sid);
  else if (cmd !== 'evidence') throw new Error('usage: prepare | evidence | reset');
  console.log(JSON.stringify(await snapshot(sid), null, 2));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.end());
