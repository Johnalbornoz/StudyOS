-- Track A -- Roles E2E (Parent / Teacher / Institution / multi-role).
--
-- Minimal, additive schema support for the role experiences. No table is
-- created, no row is rewritten, no column is dropped. Every change below
-- keeps all existing rows valid.
--
-- 1. notifications: a recipient model for actors who are not Students.
--    Until now `notifications.student_id` (FK profiles) was the only
--    recipient key, so a Teacher or Institution admin (no profiles row)
--    could never receive a signal, and a Parent's notification (keyed by
--    the parent's profiles row) was never read anywhere. A notification
--    now carries the canonical `users.id` it is addressed to plus the
--    workspace it belongs to; `payload` carries the parameters the UI
--    needs to render the message in the reader's own locale; `action_href`
--    is the in-app destination. Legacy rows (student_id only) stay valid.
--
-- 2. teacher_interventions.assignment_group_id: a class-level assignment
--    is published as N per-learner interventions (the Foundation
--    assignment contract); this groups them so the Teacher can read one
--    class assignment's outcome. Nullable: single-learner assignments and
--    every existing row have no group.
--
-- 3. class_enrollments: an institution can only ENROLL a Student with the
--    Student's consent (enrollment is what grants a Teacher read access),
--    so an enrollment starts PENDING and becomes ACTIVE when the Student
--    accepts (DECLINED otherwise). Every authorization check already
--    requires status = 'ACTIVE', so PENDING/DECLINED grant nothing.
--    `ended_at` records removal.
--
-- 4. teacher_assignments: a Teacher scope must name a grade or a class.
--    A scope with neither silently granted nothing (the assignment form
--    used to create such rows). NOT VALID: enforced for every new row
--    without rewriting history.
--
-- Rollback (DEV only; run in one transaction):
--   ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS teacher_assignments_scope_present;
--   ALTER TABLE class_enrollments DROP CONSTRAINT IF EXISTS class_enrollments_status_check;
--   UPDATE class_enrollments SET status = 'ENDED' WHERE status IN ('PENDING', 'DECLINED');
--   ALTER TABLE class_enrollments ADD CONSTRAINT class_enrollments_status_check CHECK (status IN ('ACTIVE', 'ENDED'));
--   ALTER TABLE class_enrollments DROP COLUMN IF EXISTS ended_at, DROP COLUMN IF EXISTS invited_by_user_id, DROP COLUMN IF EXISTS responded_at;
--   DROP INDEX IF EXISTS idx_teacher_interventions_group;
--   ALTER TABLE teacher_interventions DROP COLUMN IF EXISTS assignment_group_id;
--   DROP INDEX IF EXISTS idx_notifications_recipient_unread;
--   DROP INDEX IF EXISTS idx_notifications_student_unread;
--   DELETE FROM notifications WHERE student_id IS NULL;
--   ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_recipient_present;
--   ALTER TABLE notifications ALTER COLUMN student_id SET NOT NULL;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS recipient_user_id, DROP COLUMN IF EXISTS workspace,
--     DROP COLUMN IF EXISTS payload, DROP COLUMN IF EXISTS action_href;
--   DELETE FROM schema_migrations WHERE version = '20261018_1000';

-- Every statement is idempotent (re-applying is a no-op).

-- 1. notifications ---------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS workspace text,
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS action_href text;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_workspace_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_workspace_check
  CHECK (workspace IS NULL OR workspace IN ('STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION', 'ADMIN'));

ALTER TABLE notifications ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_recipient_present;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_recipient_present
  CHECK (student_id IS NOT NULL OR (recipient_user_id IS NOT NULL AND workspace IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications (recipient_user_id, workspace, delivered_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_student_unread
  ON notifications (student_id, delivered_at DESC) WHERE read_at IS NULL;

-- 2. teacher_interventions -------------------------------------------------
ALTER TABLE teacher_interventions ADD COLUMN IF NOT EXISTS assignment_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_teacher_interventions_group
  ON teacher_interventions (assignment_group_id) WHERE assignment_group_id IS NOT NULL;

-- 3. class_enrollments -----------------------------------------------------
ALTER TABLE class_enrollments DROP CONSTRAINT IF EXISTS class_enrollments_status_check;
ALTER TABLE class_enrollments
  ADD CONSTRAINT class_enrollments_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'DECLINED', 'ENDED'));
ALTER TABLE class_enrollments
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- 4. teacher_assignments ---------------------------------------------------
ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS teacher_assignments_scope_present;
ALTER TABLE teacher_assignments
  ADD CONSTRAINT teacher_assignments_scope_present
  CHECK (grade_id IS NOT NULL OR class_id IS NOT NULL) NOT VALID;
