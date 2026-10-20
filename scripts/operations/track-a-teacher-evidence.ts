/**
 * Track A -- Teacher E2E evidence queries (READ ONLY). One query set per
 * manual step, run inside a `BEGIN READ ONLY` transaction on the DEV
 * database (refuses any other database). Prints what the database holds
 * for the fixture world, so each manual step can be confirmed without
 * touching the data.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-teacher-evidence.ts <step|all>
 *
 * Steps: 1 persona · 2 request · 3 pending · 4 identity · 5 approval ·
 * 6 empty-state · 7 structure · 8 teacher-assignment · 9 teacher-classes ·
 * 10 invitation · 11 acceptance · 12 roster+learning · 13 assignment ·
 * 14 student-side · 15 results+evidence · integrity
 */
import { db } from '@/lib/db';
import { assertDev, emailFor, INST_A_NAME, type Tag } from './track-a-fixtures';

const EMAIL = (t: Tag) => emailFor(t);

const STEPS: Record<string, { title: string; sql: string; params: () => unknown[] }[]> = {
  '1': [{ title: 'Teresa: personas (exactly one: TEACHER after step 1)', sql: `SELECT r.role, r.status, r.granted_via, r.created_at FROM user_roles r JOIN users u ON u.id = r.user_id WHERE u.email = $1 ORDER BY r.created_at`, params: () => [EMAIL('teacher-a')] }],
  '2': [{ title: 'Teresa: membership request at Institution A', sql: `SELECT im.membership_role, im.status, im.requested_at, im.reviewed_at FROM institution_memberships im JOIN users u ON u.id = im.user_id JOIN institutions i ON i.id = im.institution_id WHERE u.email = $1 AND i.name = $2`, params: () => [EMAIL('teacher-a'), INST_A_NAME] }],
  '3': [
    { title: 'Teresa class scopes (0 while PENDING)', sql: `SELECT COUNT(*) AS scopes FROM teacher_assignments ta JOIN institution_memberships im ON im.id = ta.institution_membership_id JOIN users u ON u.id = im.user_id WHERE u.email = $1 AND ta.status = 'ACTIVE'`, params: () => [EMAIL('teacher-a')] },
  ],
  '4': [{ title: 'Ana notified of the request', sql: `SELECT n.notification_type AS type, n.workspace, n.delivered_at, n.read_at FROM notifications n JOIN users u ON u.id = n.recipient_user_id WHERE u.email = $1 AND n.notification_type = 'TEACHER_MEMBERSHIP_REQUESTED' ORDER BY n.delivered_at DESC LIMIT 3`, params: () => [EMAIL('inst-a')] }],
  '5': [
    { title: 'Approval recorded (reviewer = Ana)', sql: `SELECT im.status, im.reviewed_at, (SELECT email FROM users WHERE id = im.reviewed_by_user_id) AS reviewed_by FROM institution_memberships im JOIN users u ON u.id = im.user_id WHERE u.email = $1 AND im.membership_role = 'TEACHER'`, params: () => [EMAIL('teacher-a')] },
    { title: 'Audit trail', sql: `SELECT action, reason, occurred_at FROM admin_audit_log WHERE target_id IN (SELECT im.id::text FROM institution_memberships im JOIN users u ON u.id = im.user_id WHERE u.email = $1) ORDER BY occurred_at DESC LIMIT 5`, params: () => [EMAIL('teacher-a')] },
  ],
  '6': [{ title: 'Approved Teresa, classes she teaches (0 before step 8)', sql: `SELECT COUNT(*) AS classes FROM teacher_assignments ta JOIN institution_memberships im ON im.id = ta.institution_membership_id JOIN users u ON u.id = im.user_id WHERE u.email = $1 AND ta.status = 'ACTIVE' AND im.status = 'APPROVED'`, params: () => [EMAIL('teacher-a')] }],
  '7': [{ title: 'Institution A structure (grade → class → subject)', sql: `SELECT g.name AS grade, c.name AS class, cs.name AS subject, c.created_at FROM classes c JOIN institutions i ON i.id = c.institution_id LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id WHERE i.name = $1`, params: () => [INST_A_NAME] }],
  '8': [{ title: 'Teresa assigned to the class', sql: `SELECT c.name AS class, ta.status, ta.created_at FROM teacher_assignments ta JOIN institution_memberships im ON im.id = ta.institution_membership_id JOIN users u ON u.id = im.user_id LEFT JOIN classes c ON c.id = ta.class_id WHERE u.email = $1`, params: () => [EMAIL('teacher-a')] }],
  '9': [{ title: 'Teresa notified of the class', sql: `SELECT n.notification_type AS type, n.workspace, n.delivered_at FROM notifications n JOIN users u ON u.id = n.recipient_user_id WHERE u.email = $1 ORDER BY n.delivered_at DESC LIMIT 5`, params: () => [EMAIL('teacher-a')] }],
  '10': [{ title: 'Sofía enrollment (PENDING after invite; invited by Teresa)', sql: `SELECT c.name AS class, ce.status, (SELECT email FROM users WHERE id = ce.invited_by_user_id) AS invited_by, ce.created_at, ce.responded_at FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN students s ON s.id = ce.student_id JOIN users u ON u.id = s.user_id WHERE u.email = $1`, params: () => [EMAIL('student-a')] }],
  '11': [
    { title: 'Sofía enrollment (ACTIVE after accept)', sql: `SELECT c.name AS class, ce.status, ce.responded_at FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN students s ON s.id = ce.student_id JOIN users u ON u.id = s.user_id WHERE u.email = $1`, params: () => [EMAIL('student-a')] },
    { title: 'Teresa notified of the acceptance (Teacher inbox)', sql: `SELECT n.notification_type AS type, n.workspace, n.action_href, n.delivered_at FROM notifications n JOIN users u ON u.id = n.recipient_user_id WHERE u.email = $1 AND n.notification_type LIKE 'CLASS_ENROLLMENT_%' ORDER BY n.delivered_at DESC LIMIT 3`, params: () => [EMAIL('teacher-a')] },
  ],
  '12': [
    { title: 'Sofía learning evidence (all from her own practice)', sql: `SELECT le.timestamp, le.source_type, le.result, le.score_percent, le.learning_mode, le.metadata->>'activityType' AS activity FROM learning_evidence le JOIN students s ON s.id = le.student_id JOIN users u ON u.id = s.user_id WHERE u.email = $1 ORDER BY le.timestamp DESC LIMIT 10`, params: () => [EMAIL('student-a')] },
    { title: 'Sofía activities', sql: `SELECT qs.created_at, qs.quiz_mode, qs.activity_type, qs.status, qs.canonical_stage FROM quiz_sessions qs JOIN students s ON s.id = qs.student_id JOIN users u ON u.id = s.user_id WHERE u.email = $1 ORDER BY qs.created_at DESC LIMIT 10`, params: () => [EMAIL('student-a')] },
    { title: 'Sofía misconceptions', sql: `SELECT ms.misconception_code, ms.description, sm.occurrence_count, sm.status FROM student_misconceptions sm JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id JOIN students s ON s.id = sm.student_id JOIN users u ON u.id = s.user_id WHERE u.email = $1`, params: () => [EMAIL('student-a')] },
  ],
  '13': [{ title: 'Assignment rows (one per recipient; assigned by Teresa)', sql: `SELECT ti.title, ti.status, ti.starts_at, ti.due_at, ti.assignment_group_id, (SELECT email FROM users WHERE id = ti.assigned_by_user_id) AS assigned_by, c.name AS class, (SELECT u2.email FROM students s2 JOIN users u2 ON u2.id = s2.user_id WHERE s2.id = ti.student_id) AS learner FROM teacher_interventions ti JOIN classes c ON c.id = ti.class_id JOIN institutions i ON i.id = c.institution_id WHERE i.name = $1 ORDER BY ti.assigned_at DESC`, params: () => [INST_A_NAME] }],
  '14': [
    { title: 'Sofía notified of the assignment', sql: `SELECT n.notification_type AS type, n.workspace, n.action_href, n.delivered_at, n.read_at FROM notifications n JOIN users u ON u.id = n.recipient_user_id WHERE u.email = $1 AND n.notification_type = 'ASSIGNMENT_PUBLISHED' ORDER BY n.delivered_at DESC LIMIT 3`, params: () => [EMAIL('student-a')] },
    { title: 'Execution started/completed by Sofía', sql: `SELECT tie.execution_type, tie.status, tie.created_at, tie.completed_at FROM teacher_intervention_executions tie JOIN teacher_interventions ti ON ti.id = tie.teacher_intervention_id JOIN classes c ON c.id = ti.class_id JOIN institutions i ON i.id = c.institution_id WHERE i.name = $1 ORDER BY tie.created_at DESC`, params: () => [INST_A_NAME] },
  ],
  '15': [
    { title: 'Assignment result (activity grades)', sql: `SELECT ti.title, ti.status, COUNT(g.*) FILTER (WHERE g.is_correct) AS correct, COUNT(g.*) AS total FROM teacher_interventions ti JOIN classes c ON c.id = ti.class_id JOIN institutions i ON i.id = c.institution_id LEFT JOIN teacher_intervention_executions tie ON tie.teacher_intervention_id = ti.id AND tie.status = 'COMPLETED' LEFT JOIN quiz_responses qr ON qr.quiz_session_id = tie.execution_reference LEFT JOIN LATERAL (SELECT is_correct FROM quiz_response_grades WHERE response_id = qr.id ORDER BY graded_at DESC LIMIT 1) g ON true WHERE i.name = $1 GROUP BY ti.id, ti.title, ti.status`, params: () => [INST_A_NAME] },
    { title: 'Mastery record (written only by the engine from Sofía\'s submissions)', sql: `SELECT mr.updated_at, mr.mastery_score, mr.attempt_count, mr.correct_count FROM mastery_records mr JOIN students s ON s.id = mr.student_id JOIN users u ON u.id = s.user_id WHERE u.email = $1`, params: () => [EMAIL('student-a')] },
  ],
  integrity: [
    { title: 'Accounts with more than one active persona (expect 0)', sql: `SELECT COUNT(*) AS n FROM (SELECT user_id FROM user_roles WHERE role IN ('STUDENT','PARENT','TEACHER') AND status = 'ACTIVE' GROUP BY user_id HAVING COUNT(*) > 1) d`, params: () => [] },
    { title: 'Duplicate enrollments (expect 0)', sql: `SELECT COUNT(*) AS n FROM (SELECT class_id, student_id FROM class_enrollments GROUP BY 1, 2 HAVING COUNT(*) > 1) d`, params: () => [] },
    { title: 'Interventions outside their class institution (expect 0)', sql: `SELECT COUNT(*) AS n FROM teacher_interventions ti JOIN classes c ON c.id = ti.class_id WHERE ti.institution_id <> c.institution_id`, params: () => [] },
    { title: 'Interventions for a learner never enrolled in that class (expect 0)', sql: `SELECT COUNT(*) AS n FROM teacher_interventions ti WHERE NOT EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.class_id = ti.class_id AND ce.student_id = ti.student_id)`, params: () => [] },
    { title: 'Learning evidence of Student B (expect unchanged by the Teacher journey)', sql: `SELECT COUNT(*) AS n FROM learning_evidence le JOIN students s ON s.id = le.student_id JOIN users u ON u.id = s.user_id WHERE u.email = $1`, params: () => [EMAIL('student-b')] },
    { title: 'Migration ledger', sql: `SELECT COUNT(*) AS applied, MAX(version) AS latest FROM schema_migrations`, params: () => [] },
  ],
};

async function main() {
  assertDev();
  const which = process.argv[2] ?? 'all';
  const keys = which === 'all' ? Object.keys(STEPS) : [which];
  const client = await (db as any).connect();
  try {
    await client.query('BEGIN READ ONLY');
    for (const key of keys) {
      const set = STEPS[key];
      if (!set) throw new Error(`unknown step ${key}`);
      for (const q of set) {
        const r = await client.query(q.sql, q.params());
        console.log(`\n[step ${key}] ${q.title}`);
        console.table(r.rows);
      }
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (db as any).end?.();
  });
