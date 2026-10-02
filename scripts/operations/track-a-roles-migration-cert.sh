#!/bin/bash
# Track A (Roles E2E) -- migration certification for
# database/migrations/20261018_1000_track_a_roles_e2e.sql against a REAL,
# EPHEMERAL, local-only Postgres instance (never Neon / Preview / Production).
# Proves: applies cleanly on top of the full history, is idempotent, the new
# constraints behave as designed, and the documented rollback restores the
# prior shape.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET_MIGRATION="$MIGRATIONS_DIR/20261018_1000_track_a_roles_e2e.sql"
WORKDIR="$(mktemp -d /tmp/studyus-track-a-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_track_a_cert"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Track A roles migration certification (ephemeral: $WORKDIR) ==="
mkdir -p "$SOCKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null
echo "unix_socket_directories = '$SOCKDIR'" >> "$PGDATA/postgresql.conf"
echo "listen_addresses = ''" >> "$PGDATA/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOGFILE" -o "-h ''" start >/dev/null
sleep 1
"$PG_BIN/createdb" -h "$SOCKDIR" -U postgres "$DBNAME"
"$PG_BIN/psql" -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE;' "$DBNAME"

TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$BASELINE_SQL" "$TEST_SQL"
if ! "$PG_BIN/psql" -h "$SOCKDIR" -U postgres -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$DBNAME" | grep -q 1; then
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1/m' "$TEST_SQL"
fi

PSQL="$PG_BIN/psql -h $SOCKDIR -U postgres -v ON_ERROR_STOP=1 -q $DBNAME"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  $PSQL -f "$f" >/dev/null
done
echo "  OK -- baseline + full history (incl. target) applied"

$PSQL -f "$TARGET_MIGRATION" >/dev/null
echo "  OK -- idempotent (second application is a no-op)"

fail() { echo "  FAIL -- $1"; exit 1; }
expect_reject() { if $PSQL -c "$1" >/dev/null 2>&1; then fail "$2"; fi; echo "  OK -- rejected: $2"; }

$PSQL -c "
  INSERT INTO users (id, clerk_id, email) VALUES ('11111111-1111-4111-8111-111111111111', 'clerk_ta_t', 't@test.local');
  INSERT INTO students (id, clerk_id, email, name) VALUES ('22222222-2222-4222-8222-222222222222', 'clerk_ta_s', 's@test.local', 'S');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('22222222-2222-4222-8222-222222222222', 'student', 'S');
  INSERT INTO institutions (id, name) VALUES ('33333333-3333-4333-8333-333333333333', 'Inst');
  INSERT INTO classes (id, institution_id, name) VALUES ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'C');
  INSERT INTO institution_memberships (id, institution_id, user_id, membership_role, status)
    VALUES ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'TEACHER', 'APPROVED');
" >/dev/null

# notifications: legacy student row still valid; user-addressed row valid; neither -> rejected
$PSQL -c "INSERT INTO notifications (student_id, notification_type, title, message) VALUES ('22222222-2222-4222-8222-222222222222', 'X', 't', 'm')" >/dev/null
$PSQL -c "INSERT INTO notifications (recipient_user_id, workspace, notification_type, title, message) VALUES ('11111111-1111-4111-8111-111111111111', 'TEACHER', 'X', 't', 'm')" >/dev/null
echo "  OK -- legacy student-addressed and user-addressed notifications accepted"
expect_reject "INSERT INTO notifications (notification_type, title, message) VALUES ('X', 't', 'm')" "notification with no recipient"
expect_reject "INSERT INTO notifications (recipient_user_id, notification_type, title, message) VALUES ('11111111-1111-4111-8111-111111111111', 'X', 't', 'm')" "user-addressed notification without workspace"
expect_reject "INSERT INTO notifications (recipient_user_id, workspace, notification_type, title, message) VALUES ('11111111-1111-4111-8111-111111111111', 'NOPE', 'X', 't', 'm')" "unknown workspace"

# class_enrollments: PENDING / DECLINED accepted; garbage rejected
$PSQL -c "INSERT INTO class_enrollments (class_id, student_id, status, invited_by_user_id) VALUES ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'PENDING', '11111111-1111-4111-8111-111111111111')" >/dev/null
$PSQL -c "UPDATE class_enrollments SET status = 'DECLINED', responded_at = now()" >/dev/null
$PSQL -c "UPDATE class_enrollments SET status = 'ACTIVE'" >/dev/null
$PSQL -c "UPDATE class_enrollments SET status = 'ENDED', ended_at = now()" >/dev/null
echo "  OK -- enrollment PENDING -> DECLINED / ACTIVE -> ENDED"
expect_reject "UPDATE class_enrollments SET status = 'BOGUS'" "unknown enrollment status"

# teacher_assignments: scope must name a grade or a class
$PSQL -c "INSERT INTO teacher_assignments (institution_membership_id, class_id) VALUES ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444')" >/dev/null
echo "  OK -- class-scoped teacher assignment accepted"
expect_reject "INSERT INTO teacher_assignments (institution_membership_id) VALUES ('55555555-5555-4555-8555-555555555555')" "scope-less teacher assignment"

# teacher_interventions.assignment_group_id exists
$PSQL -tAc "SELECT 1 FROM information_schema.columns WHERE table_name='teacher_interventions' AND column_name='assignment_group_id'" | grep -q 1 || fail "assignment_group_id missing"
echo "  OK -- teacher_interventions.assignment_group_id present"

# Rollback (as documented in the migration header) restores the prior shape
ROLLBACK_SQL="$WORKDIR/rollback.sql"
{
  echo "BEGIN;"
  sed -n '/^-- Rollback/,/^-- DELETE FROM schema_migrations/p' "$TARGET_MIGRATION" | grep -E '^--   ' | sed 's/^--   //' | grep -v schema_migrations
  echo "COMMIT;"
} > "$ROLLBACK_SQL"
$PSQL -f "$ROLLBACK_SQL" >/dev/null
$PSQL -tAc "SELECT is_nullable FROM information_schema.columns WHERE table_name='notifications' AND column_name='student_id'" | grep -q NO || fail "rollback did not restore NOT NULL"
$PSQL -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='notifications' AND column_name IN ('recipient_user_id','workspace','payload','action_href')" | grep -qx 0 || fail "rollback left notification columns"
echo "  OK -- documented rollback restores the prior schema"
$PSQL -f "$TARGET_MIGRATION" >/dev/null
echo "  OK -- re-apply after rollback succeeds"

# --- 20261018_1100_track_a_teacher_e2e -----------------------------------
TEACHER_MIGRATION="$MIGRATIONS_DIR/20261018_1100_track_a_teacher_e2e.sql"
$PSQL -f "$TEACHER_MIGRATION" >/dev/null
echo "  OK -- teacher-e2e migration idempotent"
$PSQL -c "INSERT INTO canonical_subjects (id, name) VALUES ('66666666-6666-4666-8666-666666666666', 'Mathematics') ON CONFLICT DO NOTHING" >/dev/null 2>&1 || true
$PSQL -c "UPDATE classes SET canonical_subject_id = (SELECT id FROM canonical_subjects LIMIT 1) WHERE id = '44444444-4444-4444-8444-444444444444'" >/dev/null
echo "  OK -- class linked to a canonical subject"
expect_reject "UPDATE classes SET canonical_subject_id = '99999999-9999-4999-8999-999999999999' WHERE id = '44444444-4444-4444-8444-444444444444'" "class linked to a non-existent subject"
$PSQL -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='teacher_interventions' AND column_name IN ('title','starts_at')" | grep -qx 2 || fail "assignment title/starts_at missing"
echo "  OK -- assignment title / starts_at present"
TROLLBACK="$WORKDIR/rollback2.sql"
{ echo "BEGIN;"; sed -n '/^-- Rollback/,/^--   DELETE FROM schema_migrations/p' "$TEACHER_MIGRATION" | grep -E '^--   ' | sed 's/^--   //' | grep -v schema_migrations; echo "COMMIT;"; } > "$TROLLBACK"
$PSQL -f "$TROLLBACK" >/dev/null
$PSQL -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='classes' AND column_name='canonical_subject_id'" | grep -qx 0 || fail "teacher rollback incomplete"
$PSQL -f "$TEACHER_MIGRATION" >/dev/null
echo "  OK -- teacher-e2e rollback + re-apply"

# --- 20261018_1200_track_a_institution_coordinators ----------------------
COORD_MIGRATION="$MIGRATIONS_DIR/20261018_1200_track_a_institution_coordinators.sql"
$PSQL -f "$COORD_MIGRATION" >/dev/null
$PSQL -f "$COORD_MIGRATION" >/dev/null
echo "  OK -- coordinator migration applies and is idempotent"
$PSQL -tAc "SELECT slug FROM institutions WHERE id = '33333333-3333-4333-8333-333333333333'" | grep -qx 'inst-33333333' || fail "existing institution slug not backfilled"
echo "  OK -- existing institution got a collision-free slug"
$PSQL -c "INSERT INTO institutions (name, status, slug, country) VALUES ('Colegio Uno', 'ACTIVE', 'colegio-uno', 'CO')" >/dev/null
expect_reject "INSERT INTO institutions (name, status, slug) VALUES ('Colegio Uno', 'ACTIVE', 'colegio-uno')" "duplicate institution slug"
expect_reject "INSERT INTO institutions (name, status, slug, country) VALUES ('X', 'ACTIVE', 'x-1', 'Colombia')" "non ISO-2 country"
$PSQL -c "INSERT INTO institution_admin_invitations (institution_id, email, token_hash, invited_by_user_id, expires_at) VALUES ('33333333-3333-4333-8333-333333333333', 'c@test.local', 'h1', '11111111-1111-4111-8111-111111111111', now() + interval '7 days')" >/dev/null
expect_reject "INSERT INTO institution_admin_invitations (institution_id, email, token_hash, invited_by_user_id, expires_at) VALUES ('33333333-3333-4333-8333-333333333333', 'c@test.local', 'h2', '11111111-1111-4111-8111-111111111111', now() + interval '7 days')" "second PENDING invitation for the same institution + email"
expect_reject "INSERT INTO institution_admin_invitations (institution_id, email, token_hash, invited_by_user_id, expires_at) VALUES ('33333333-3333-4333-8333-333333333333', 'Upper@test.local', 'h3', '11111111-1111-4111-8111-111111111111', now() + interval '7 days')" "non-lowercase invitation email"
$PSQL -c "UPDATE institution_admin_invitations SET status = 'ACCEPTED' WHERE token_hash = 'h1'" >/dev/null
$PSQL -c "INSERT INTO institution_admin_invitations (institution_id, email, token_hash, invited_by_user_id, expires_at) VALUES ('33333333-3333-4333-8333-333333333333', 'c@test.local', 'h4', '11111111-1111-4111-8111-111111111111', now() + interval '7 days')" >/dev/null
echo "  OK -- a new invitation is allowed once the previous one is no longer PENDING"
CROLLBACK="$WORKDIR/rollback3.sql"
{ echo "BEGIN;"; sed -n '/^-- Rollback/,/^--   DELETE FROM schema_migrations/p' "$COORD_MIGRATION" | grep -E '^--   ' | sed 's/^--   //' | grep -v schema_migrations; echo "COMMIT;"; } > "$CROLLBACK"
$PSQL -c "DELETE FROM institutions WHERE slug = 'colegio-uno'" >/dev/null
$PSQL -f "$CROLLBACK" >/dev/null
$PSQL -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name='institution_admin_invitations'" | grep -qx 0 || fail "coordinator rollback left the invitations table"
$PSQL -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='institutions' AND column_name IN ('slug','country','timezone')" | grep -qx 0 || fail "coordinator rollback left institution columns"
$PSQL -f "$COORD_MIGRATION" >/dev/null
echo "  OK -- coordinator rollback + re-apply"

# --- 20261018_1300_track_a_teacher_plan_assignment -----------------------
PLAN_MIGRATION="$MIGRATIONS_DIR/20261018_1300_track_a_teacher_plan_assignment.sql"
$PSQL -f "$PLAN_MIGRATION" >/dev/null
echo "  OK -- plan-assignment migration idempotent"
$PSQL -c "INSERT INTO subjects (id, student_id, name) VALUES ('77777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', 'Matemáticas')" >/dev/null
$PSQL -c "INSERT INTO concepts (id, subject_id, canonical_id, origin, origin_class_id) VALUES ('88888888-8888-4888-8888-888888888888', '77777777-7777-4777-8777-777777777777', 'CANON_X', 'TEACHER_ASSIGNMENT', '44444444-4444-4444-8444-444444444444')" >/dev/null
expect_reject "INSERT INTO concepts (subject_id, canonical_id, origin) VALUES ('77777777-7777-4777-8777-777777777777', 'CANON_Y', 'SOMETHING_ELSE')" "unknown concept origin"
$PSQL -c "INSERT INTO canonical_concepts (id, canonical_subject_id, name) VALUES ('99999999-9999-4999-8999-999999999990', (SELECT id FROM canonical_subjects LIMIT 1), 'Linear Equations')" >/dev/null
$PSQL -c "INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999990', 'MATCHED', 'TEACHER_ASSIGNMENT')" >/dev/null
echo "  OK -- TEACHER_ASSIGNMENT mapping accepted"
expect_reject "INSERT INTO concepts (subject_id, canonical_id) VALUES ('77777777-7777-4777-8777-777777777777', 'CANON_X')" "duplicate learner concept for the same canonical key"
$PSQL -tAc "SELECT column_default FROM information_schema.columns WHERE table_name='teacher_interventions' AND column_name='concept_added_to_plan'" | grep -q false || fail "concept_added_to_plan default"
$PSQL -tAc "SELECT 1 FROM pg_indexes WHERE indexname='uq_teacher_interventions_group_student'" | grep -q 1 || fail "group/student unique index missing"
echo "  OK -- concept_added_to_plan + one recipient per assignment group"
PROLLBACK="$WORKDIR/rollback4.sql"
{ echo "BEGIN;"; sed -n '/^-- Rollback/,/^--   DELETE FROM schema_migrations/p' "$PLAN_MIGRATION" | grep -E '^--   ' | sed 's/^--   //' | grep -v schema_migrations; echo "COMMIT;"; } > "$PROLLBACK"
$PSQL -c "DELETE FROM concept_catalog_mapping WHERE mapping_method = 'TEACHER_ASSIGNMENT'" >/dev/null
$PSQL -f "$PROLLBACK" >/dev/null
$PSQL -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='concepts' AND column_name IN ('origin','origin_class_id')" | grep -qx 0 || fail "plan rollback incomplete"
$PSQL -f "$PLAN_MIGRATION" >/dev/null
echo "  OK -- plan-assignment rollback + re-apply"

# --- 20261018_1400_track_a_learning_plan_orchestrator --------------------
ORCH_MIGRATION="$MIGRATIONS_DIR/20261018_1400_track_a_learning_plan_orchestrator.sql"
$PSQL -c "INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999990', 'MATCHED', 'TEACHER_ASSIGNMENT') ON CONFLICT (learner_concept_id) DO NOTHING" >/dev/null
$PSQL -c "UPDATE concepts SET origin = 'TEACHER_ASSIGNMENT', origin_class_id = '44444444-4444-4444-8444-444444444444' WHERE id = '88888888-8888-4888-8888-888888888888'" >/dev/null
$PSQL -f "$ORCH_MIGRATION" >/dev/null
echo "  OK -- orchestrator migration idempotent"
$PSQL -tAc "SELECT count(*) FROM student_plan_entries WHERE learner_concept_id = '88888888-8888-4888-8888-888888888888'" | grep -qx 1 || fail "existing MATCHED concept not backfilled into the plan"
$PSQL -tAc "SELECT source_type FROM student_concept_sources WHERE student_id = '22222222-2222-4222-8222-222222222222'" | grep -qx TEACHER_ASSIGNMENT || fail "teacher-assignment provenance not backfilled"
echo "  OK -- backfill: plan entry + TEACHER_ASSIGNMENT source"
$PSQL -c "INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('88888888-8888-4888-8888-888888888889', '77777777-7777-4777-8777-777777777777', 'CANON_DUP')" >/dev/null
expect_reject "INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ('88888888-8888-4888-8888-888888888889', '99999999-9999-4999-8999-999999999990', 'MATCHED', 'MANUAL_REVIEW')" "second learner concept MATCHED to the same canonical concept for one student"
$PSQL -c "INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status) VALUES ('88888888-8888-4888-8888-888888888889', NULL, 'UNRESOLVED')" >/dev/null
echo "  OK -- an unmatched duplicate stays allowed (UNRESOLVED)"
expect_reject "INSERT INTO student_plan_entries (student_id, canonical_concept_id, learner_concept_id) VALUES ('22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999990', '88888888-8888-4888-8888-888888888889')" "second plan entry for the same student + canonical concept"
expect_reject "INSERT INTO student_concept_sources (student_id, canonical_concept_id, source_type) VALUES ('22222222-2222-4222-8222-222222222222', '66666666-6666-4666-8666-666666666666', 'SELF_SELECTED')" "source without a plan entry"
expect_reject "INSERT INTO student_concept_sources (student_id, canonical_concept_id, source_type, source_key) VALUES ('22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999990', 'TEACHER_ASSIGNMENT', '44444444-4444-4444-8444-444444444444')" "duplicate source"
$PSQL -c "INSERT INTO institution_curricula (id, institution_id, canonical_subject_id, title) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', (SELECT id FROM canonical_subjects LIMIT 1), 'Math')" >/dev/null
expect_reject "INSERT INTO institution_curricula (institution_id, canonical_subject_id, title) VALUES ('33333333-3333-4333-8333-333333333333', (SELECT id FROM canonical_subjects LIMIT 1), 'Math 2')" "second ACTIVE curriculum for the same institution + subject + grade + year"
$PSQL -c "INSERT INTO institution_curriculum_concepts (curriculum_id, canonical_concept_id, classification) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999990', 'REQUIRED')" >/dev/null
expect_reject "INSERT INTO institution_curriculum_concepts (curriculum_id, canonical_concept_id, classification) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999990', 'MANDATORY')" "unknown curriculum classification"
$PSQL -c "INSERT INTO class_plan_concepts (class_id, canonical_concept_id, supplemental) VALUES ('44444444-4444-4444-8444-444444444444', '99999999-9999-4999-8999-999999999990', true)" >/dev/null
expect_reject "INSERT INTO class_plan_concepts (class_id, canonical_concept_id) VALUES ('44444444-4444-4444-8444-444444444444', '99999999-9999-4999-8999-999999999990')" "duplicate class plan concept"
expect_reject "INSERT INTO learning_recommendations (student_id, canonical_concept_id, recommendation_type) VALUES ('22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999990', 'WHATEVER')" "unknown recommendation type"
echo "  OK -- curriculum / class plan / recommendation constraints"
OROLLBACK="$WORKDIR/rollback5.sql"
{ echo "BEGIN;"; sed -n '/^-- Rollback/,/^--   DELETE FROM schema_migrations/p' "$ORCH_MIGRATION" | grep -E '^--   ' | sed 's/^--   //' | grep -v schema_migrations; echo "COMMIT;"; } > "$OROLLBACK"
$PSQL -c "DELETE FROM concept_catalog_mapping WHERE learner_concept_id = '88888888-8888-4888-8888-888888888889'; DELETE FROM concepts WHERE id = '88888888-8888-4888-8888-888888888889'" >/dev/null
V2_MIGRATION="$MIGRATIONS_DIR/20261018_1500_track_a_institution_curriculum_v2.sql"
V2ROLLBACK="$WORKDIR/rollback6.sql"
{ echo "BEGIN;"; sed -n '/^-- Rollback/,/^--   DELETE FROM schema_migrations/p' "$V2_MIGRATION" | grep -E '^--   ' | sed 's/^--   //' | grep -v schema_migrations; echo "COMMIT;"; } > "$V2ROLLBACK"
$PSQL -f "$V2ROLLBACK" >/dev/null  # 1500 depends on 1400: roll it back first
$PSQL -f "$OROLLBACK" >/dev/null
$PSQL -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('student_plan_entries','class_plan_concepts','institution_curricula')" | grep -qx 0 || fail "orchestrator rollback incomplete"
$PSQL -f "$ORCH_MIGRATION" >/dev/null
echo "  OK -- orchestrator rollback + re-apply"

# --- 20261018_1500_track_a_institution_curriculum_v2 ---------------------
$PSQL -f "$V2_MIGRATION" >/dev/null
$PSQL -f "$V2_MIGRATION" >/dev/null
echo "  OK -- curriculum v2 migration applies on top of 1400 and is idempotent"
CS=$($PSQL -tAc "SELECT id FROM canonical_subjects ORDER BY name LIMIT 1")
$PSQL -c "INSERT INTO academic_organizations (id, name, status, country, source_type, authority_level) VALUES ('a1000000-0000-4000-8000-000000000001', 'SEP test', 'ACTIVE', 'MX', 'GOVERNMENT_AUTHORITY', 'NATIONAL')" >/dev/null
expect_reject "INSERT INTO academic_organizations (name, status, source_type) VALUES ('X', 'ACTIVE', 'MINISTRY')" "unknown curriculum source type"
$PSQL -c "INSERT INTO institution_curricula (id, institution_id, canonical_subject_id, title, grade_id) VALUES ('a2000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', '$CS', 'A', NULL)" >/dev/null 2>&1 || true
expect_reject "INSERT INTO institution_curricula (institution_id, canonical_subject_id, title) VALUES ('33333333-3333-4333-8333-333333333333', '$CS', 'dup')" "second ACTIVE curriculum for the same subject/level + version + grade + year"
$PSQL -c "UPDATE institution_curricula SET status = 'ARCHIVED' WHERE institution_id = '33333333-3333-4333-8333-333333333333'" >/dev/null
$PSQL -c "INSERT INTO institution_curricula (institution_id, canonical_subject_id, title) VALUES ('33333333-3333-4333-8333-333333333333', '$CS', 'after archive')" >/dev/null
echo "  OK -- archived curriculum frees the slot (history kept)"
expect_reject "INSERT INTO class_plan_concepts (class_id, canonical_concept_id, owner_scope) VALUES ('44444444-4444-4444-8444-444444444444', '99999999-9999-4999-8999-999999999990', 'STUDENT')" "class plan owner scope outside INSTITUTION/TEACHER"
expect_reject "INSERT INTO academic_governance_events (actor_scope, object_type, action) VALUES ('ROBOT', 'x', 'y')" "unknown governance actor scope"
$PSQL -c "INSERT INTO academic_governance_events (actor_scope, object_type, action, fields) VALUES ('INSTITUTION', 'INSTITUTION_ASSIGNMENT', 'CREATED', ARRAY['due_at'])" >/dev/null
echo "  OK -- governance constraints"
$PSQL -c "DELETE FROM academic_governance_events; DELETE FROM institution_curricula WHERE institution_id = '33333333-3333-4333-8333-333333333333'; DELETE FROM academic_organizations WHERE id = 'a1000000-0000-4000-8000-000000000001'" >/dev/null
$PSQL -f "$V2ROLLBACK" >/dev/null
$PSQL -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('institution_assignments','institution_curriculum_objectives','academic_governance_events')" | grep -qx 0 || fail "curriculum v2 rollback incomplete"
$PSQL -f "$V2_MIGRATION" >/dev/null
echo "  OK -- curriculum v2 rollback + re-apply"

echo "=== Track A roles migration certification: ALL CHECKS PASSED ==="
