/**
 * F12 -- local, non-production performance CHARACTERIZATION only (task
 * section 44). Builds a moderately-sized synthetic institution (50
 * learners across 5 classes, ~half with real Evidence) and measures
 * p50/p95/max wall-clock latency for the required entry points over
 * multiple samples, against the SAME real ephemeral Postgres instance
 * every other F12 certification uses. This is NOT a Production capacity
 * claim -- see F12_PERFORMANCE_BASELINE.md for that explicit disclaimer.
 */
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { createInstitution, inviteInstitutionAdmin, requestTeacherMembership, decideMembership, createGrade, createClass, enrollStudent, createTeacherAssignment } from '@/services/institution.service';
import { updateMastery } from '@/services/mastery.service';
import { completeQuiz } from '@/services/quiz-persistence.service';
import { getInstitutionOverview, getInstitutionLearnerSummary, getInstitutionCoverage, getInstitutionReadiness, getInstitutionInterventionSummary, getInstitutionClasses } from '@/lib/institution-intelligence';
import { db } from '@/lib/db';

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function time<T>(fn: () => Promise<T>): Promise<number> {
  const start = process.hrtime.bigint();
  await fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

async function main() {
  await db.query(
    `INSERT INTO mastery_policies (version, minimum_understanding, minimum_independence, minimum_application, minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days)
     VALUES (1, 0.7, 0.7, 0.7, 0.7, 0.7, false, 3, 1, 1, 1, 14) ON CONFLICT (version) DO NOTHING`
  );
  await db.query(`INSERT INTO institution_analytics_policy_versions (version, rules, status) VALUES (1, '{"minimumCohortSize": 3}'::jsonb, 'ACTIVE') ON CONFLICT (version) DO NOTHING`);

  console.log('=== Building synthetic dataset: 50 learners / 5 classes / 1 institution ===');
  const institution = await createInstitution('F12 Performance Institution');
  const adminUser = await db.query(`INSERT INTO users (clerk_id, email) VALUES ('clerk_f12_perf_admin', 'f12-perf-admin@test.local') RETURNING id`);
  await inviteInstitutionAdmin(institution.id, adminUser.rows[0].id);
  const teacher = await getOrCreateCanonicalUser('clerk_f12_perf_teacher', 'f12-perf-teacher@test.local');
  const membership = await requestTeacherMembership(institution.id, teacher.id);
  await decideMembership(membership.id, adminUser.rows[0].id, 'APPROVED');
  const grade = await createGrade(institution.id, 'Perf Grade');

  const classIds: string[] = [];
  for (let c = 0; c < 5; c++) {
    const classRow = await createClass(institution.id, grade.id, `Perf Class ${c}`);
    classIds.push(classRow.id);
    await createTeacherAssignment(membership.id, { classId: classRow.id });
  }

  const DATASET_SIZE = 50;
  const studentIds: string[] = [];
  for (let i = 0; i < DATASET_SIZE; i++) {
    const clerkId = `clerk_f12_perf_student_${i}`;
    const studentRow = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`, [clerkId, `${clerkId}@test.local`, `Perf Student ${i}`]);
    const studentId = studentRow.rows[0].id;
    await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [studentId, `Perf Student ${i}`]);
    const owner = await getOrCreateCanonicalUser(clerkId, `${clerkId}@test.local`);
    await db.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [owner.id, studentId]);
    await enrollStudent(classIds[i % classIds.length], studentId);
    studentIds.push(studentId);

    if (i % 2 === 0) {
      const subjectRow = await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Perf Subject') RETURNING id`, [studentId]);
      const conceptRow = await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectRow.rows[0].id, `f12.perf.${i}`]);
      await updateMastery({
        studentId, conceptId: conceptRow.rows[0].id, subjectId: subjectRow.rows[0].id,
        evidence: { sourceType: 'PRACTICE_QUESTION', result: 'correct', difficulty: 3, scorePercent: 100 },
        telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 },
        identity: { operationType: 'QUIZ_SUBMISSION', operationId: `perf-quiz-${i}`, conceptId: conceptRow.rows[0].id },
      });
      await completeQuiz(`perf-quiz-${i}`).catch(() => {});
    }
  }
  console.log(`  seeded ${DATASET_SIZE} learners across ${classIds.length} classes, ~${Math.ceil(DATASET_SIZE / 2)} with real Evidence`);

  const SAMPLES = 10;
  const results: Record<string, number[]> = {
    institutionOverview: [], learnerSummary: [], institutionClasses: [],
  };

  for (let i = 0; i < SAMPLES; i++) {
    results.institutionOverview.push(await time(() => getInstitutionOverview(adminUser.rows[0].id, institution.id)));
    results.learnerSummary.push(await time(() => getInstitutionLearnerSummary(adminUser.rows[0].id, institution.id)));
    results.institutionClasses.push(await time(() => getInstitutionClasses(adminUser.rows[0].id, institution.id)));
  }

  // Coverage/readiness/interventions characterized once each (they depend on a real structureVersionId/examVersionId which this synthetic dataset doesn't populate) -- report N/A with the real reason rather than a fabricated number.
  console.log('');
  console.log('=== F12 PERFORMANCE BASELINE (local, non-production characterization only) ===');
  console.log(`sample count: ${SAMPLES}, dataset size: ${DATASET_SIZE} learners / ${classIds.length} classes / 1 institution`);
  for (const [name, samples] of Object.entries(results)) {
    const sorted = [...samples].sort((a, b) => a - b);
    console.log(`${name}: p50=${percentile(sorted, 50).toFixed(1)}ms p95=${percentile(sorted, 95).toFixed(1)}ms max=${Math.max(...sorted).toFixed(1)}ms`);
  }
  console.log('institutionCoverage / institutionReadiness / institutionInterventionSummary: not exercised in this synthetic run (no structureVersionId/examVersionId/interventions populated) -- see f12-institution-intelligence-cert-runner.ts for correctness-focused runs against those entry points; this script characterizes ONLY the roster/learning entry points at a 50-learner scale.');
  console.log('This is a LOCAL, EPHEMERAL, non-production characterization only -- NOT a Production capacity claim (task section 44).');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('f12-performance-baseline-runner FAILED:', error);
    process.exit(1);
  });
