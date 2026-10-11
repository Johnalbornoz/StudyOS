# L10 migration preflight — contract for L5

**Who runs this:** `L5_RELEASE_PREFLIGHT`, against each shared database (DEV, Stage) **before** the L10 migration batch `20261120_1000` … `20261120_1500` is applied there.

**What it is:** read-only SQL. Every statement is a `SELECT`. Nothing here writes, locks or alters anything. L10 did not run any of it against a shared database; it was run only against a throwaway local Postgres (`scripts/l10-ephemeral-db-test.sh`).

**How to report:** for each check, return the number (and the rows where the check asks for them) and the verdict from the "Pass when" column. A check marked **BLOCKER** must pass before the batch is applied. A check marked **RECORD** never blocks; its number is needed to predict the effect of the batch.

Checks are grouped by the migration they protect. Run them all; they are independent.

---

## 0. Migration ledger — expected before and after

### 0.1 Ledger before (BLOCKER)

```sql
SELECT count(*)                                                    AS ledger_rows,
       count(*) FILTER (WHERE version ~ '^[0-9]{8}_[0-9]{4}$')     AS migration_rows,
       max(version) FILTER (WHERE version ~ '^[0-9]{8}_[0-9]{4}$') AS last_version,
       count(*) FILTER (WHERE version LIKE '20261120\_%')          AS l10_rows_already_present
FROM schema_migrations;
```

Pass when, for a database that is at the head of `fix/security-p1-remediation` (`4fb45b0`):

| Column | Expected |
|---|---|
| `ledger_rows` | 83 (the baseline row + 82 migrations) |
| `migration_rows` | 82 |
| `last_version` | `20261112_1000` |
| `l10_rows_already_present` | 0 |

If `last_version` is lower, the database is behind: apply the earlier migrations first and re-run this preflight. If it is `20261111_1000` with 82 ledger rows, the database is on the B5 line and lacks `20261112_1000`; that is an ORCH-1 question, not an L10 one. Any other shape: stop and report.

### 0.2 Pending set, from the governed tool (BLOCKER)

```bash
npm run db:status
npm run db:migrate -- --dry-run
```

Pass when both list exactly these six files as pending, in this order, and nothing else:

```
20261120_1000_sf7_parent_relationship_lifecycle.sql
20261120_1100_sf12_institution_student_memberships.sql
20261120_1200_en1_institution_licenses.sql
20261120_1300_sf8_role_onboarding_state.sql
20261120_1400_sf10_single_persona_constraint.sql
20261120_1500_cr_l9_02_enrollment_history.sql
```

and when neither command reports a checksum mismatch for an already-applied file.

### 0.3 Ledger after (run after the batch, by whoever applies it)

The same query as 0.1. Expected: `ledger_rows` 89, `migration_rows` 88, `last_version` `20261120_1500`, `l10_rows_already_present` 6. `npm run db:status` reports 0 pending.

The migration runner applies each file in its own transaction. If `20261120_1400` stops on its own pre-check (section 2), files `1000`–`1300` are already recorded and `1400`, `1500` remain pending: ledger 87, last `20261120_1300`. That state is safe (no file depends on a later one) but **the application code expects all six**; do not deploy the L10 code against it.

### 0.4 Names the batch creates do not exist yet (BLOCKER)

```sql
SELECT n AS object_name, to_regclass('public.' || n) IS NOT NULL AS already_exists
FROM unnest(ARRAY[
  'institution_student_memberships', 'institution_licenses', 'institution_license_seats', 'user_role_onboarding',
  'uq_user_roles_one_persona', 'uq_class_enrollments_one_open', 'idx_class_enrollments_class_student',
  'uq_institution_licenses_one_active', 'uq_institution_license_seats_one_per_student'
]) AS n;
```

Pass when every `already_exists` is `false`. A `true` means something outside the ledger created the object; report it and stop.

---

## 1. Accounts without an ACTIVE role row

After L10, a relationship, ownership or membership row authorizes only while the account is ACTIVE **and** holds the ACTIVE role for that surface. These checks find accounts that work today and would be denied once the L10 **code** is deployed. They do not affect whether the migrations apply, but they decide whether the release is safe for real users, so each is a **BLOCKER for deploying the L10 code** (not for applying the batch).

### 1.1 Learners whose account does not hold an ACTIVE STUDENT role

```sql
SELECT count(*) AS learners_without_active_student_role
FROM students s
LEFT JOIN users u ON (u.id = s.user_id OR (s.user_id IS NULL AND u.clerk_id = s.clerk_id)) AND NOT u.is_system
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'STUDENT' AND r.status = 'ACTIVE'
);
```

Break it down, so each cause can be handled separately:

```sql
SELECT
  count(*) FILTER (WHERE u.id IS NULL)                                                    AS no_account_row_at_all,
  count(*) FILTER (WHERE u.id IS NOT NULL AND r_any.user_id IS NULL)                      AS account_but_never_a_student_role_row,
  count(*) FILTER (WHERE r_rev.user_id IS NOT NULL AND r_act.user_id IS NULL)             AS student_role_revoked,
  count(*) FILTER (WHERE u.id IS NOT NULL AND u.status <> 'ACTIVE')                       AS account_not_active,
  count(*) FILTER (WHERE s.user_id IS NULL)                                               AS students_user_id_null
FROM students s
LEFT JOIN users u ON (u.id = s.user_id OR (s.user_id IS NULL AND u.clerk_id = s.clerk_id)) AND NOT u.is_system
LEFT JOIN LATERAL (SELECT user_id FROM user_roles WHERE user_id = u.id AND role = 'STUDENT' LIMIT 1) r_any ON true
LEFT JOIN LATERAL (SELECT user_id FROM user_roles WHERE user_id = u.id AND role = 'STUDENT' AND status = 'ACTIVE' LIMIT 1) r_act ON true
LEFT JOIN LATERAL (SELECT user_id FROM user_roles WHERE user_id = u.id AND role = 'STUDENT' AND status = 'REVOKED' LIMIT 1) r_rev ON true;
```

Pass when `no_account_row_at_all` = 0 and `account_but_never_a_student_role_row` = 0. Those two are learners the identity backfill missed: they can use the product today and would be refused after the deploy. `student_role_revoked` and `account_not_active` are the intended effect (report the numbers). `students_user_id_null` is **RECORD**: the L10 resolver handles those rows through the Clerk identity; it is the SF-2 number L3R1 asked L5 for.

### 1.2 Parents with an accepted relationship but no ACTIVE PARENT role, or no account link

```sql
SELECT
  count(*)                                                        AS accepted_relationships,
  count(*) FILTER (WHERE p.user_id IS NULL)                       AS parent_profile_not_linked_to_an_account,
  count(*) FILTER (WHERE p.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
    WHERE r.user_id = p.user_id AND r.role = 'PARENT' AND r.status = 'ACTIVE' AND u.status = 'ACTIVE'))
                                                                  AS parent_without_active_parent_role_or_account
FROM parent_student_relationships psr
JOIN profiles p ON p.id = psr.parent_id
WHERE psr.status = 'accepted';
```

Pass when both filtered counts are 0. `parent_profile_not_linked_to_an_account` rows are repaired the next time that parent calls any Parent route (existing self-repair in `getOrCreateParentId`), but until then they read as denied; report the number.

### 1.3 Teachers with an APPROVED membership but no ACTIVE TEACHER role

```sql
SELECT count(*) AS approved_teacher_memberships_without_active_role
FROM institution_memberships im
WHERE im.membership_role = 'TEACHER' AND im.status = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
    WHERE r.user_id = im.user_id AND r.role = 'TEACHER' AND r.status = 'ACTIVE' AND u.status = 'ACTIVE');
```

Pass when 0.

### 1.4 Coordinators with an APPROVED membership but no ACTIVE INSTITUTION_ADMIN role

```sql
SELECT count(*) AS approved_coordinator_memberships_without_active_role
FROM institution_memberships im
WHERE im.membership_role = 'INSTITUTION_ADMIN' AND im.status = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
    WHERE r.user_id = im.user_id AND r.role = 'INSTITUTION_ADMIN' AND r.status = 'ACTIVE' AND u.status = 'ACTIVE');
```

Pass when 0.

### 1.5 Accounts with no role row of any kind (RECORD)

```sql
SELECT count(*) AS accounts_without_any_active_role
FROM users u
WHERE NOT u.is_system AND u.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.status = 'ACTIVE');
```

These accounts are sent to role selection, before and after L10. The number is context for 1.1–1.4, not a blocker.

### 1.6 Teacher access that depends on a non-ACTIVE institution or an archived class (RECORD)

```sql
SELECT
  count(*) FILTER (WHERE i.status <> 'ACTIVE') AS active_teacher_assignments_in_non_active_institutions,
  count(*) FILTER (WHERE c.status <> 'ACTIVE') AS active_teacher_assignments_on_archived_classes
FROM teacher_assignments ta
JOIN institution_memberships im ON im.id = ta.institution_membership_id AND im.status = 'APPROVED' AND im.membership_role = 'TEACHER'
JOIN institutions i ON i.id = im.institution_id
LEFT JOIN classes c ON c.id = ta.class_id
WHERE ta.status = 'ACTIVE';
```

These teachers lose access after the deploy (SF-3, intended). Report the numbers.

---

## 2. Accounts with more than one ACTIVE persona — protects `20261120_1400`

### 2.1 Count (BLOCKER for the batch)

```sql
SELECT count(*) AS accounts_with_more_than_one_active_persona
FROM (
  SELECT user_id FROM user_roles
  WHERE role IN ('STUDENT', 'PARENT', 'TEACHER') AND status = 'ACTIVE'
  GROUP BY user_id HAVING count(*) > 1
) t;
```

Pass when 0. If it is not 0, `20261120_1400` refuses to apply (`SF10_MULTI_PERSONA_ACCOUNTS_EXIST`) and changes nothing. Do not edit roles to make it pass: return the list below to the Orchestrator, who decides per account which persona stays.

### 2.2 The accounts (only when 2.1 > 0)

```sql
SELECT r.user_id, array_agg(r.role ORDER BY r.role) AS active_personas, min(r.created_at) AS first_granted
FROM user_roles r
WHERE r.role IN ('STUDENT', 'PARENT', 'TEACHER') AND r.status = 'ACTIVE'
GROUP BY r.user_id HAVING count(*) > 1
ORDER BY first_granted;
```

No email or name is selected on purpose. `ADMIN` (`STUDYUS_ADMIN`) and `INSTITUTION_ADMIN` are privileges, not personas; they are not counted and the index does not cover them.

---

## 3. Pending parent invitations older than 30 days — protects `20261120_1000`

`20261120_1000` gives every existing invitation `expires_at = created_at + 30 days`. A pending invitation older than that is refused from then on (accepted ruling). This check says how many.

### 3.1 Count (RECORD)

```sql
SELECT
  count(*) FILTER (WHERE status = 'pending')                                                AS pending_invitations,
  count(*) FILTER (WHERE status = 'pending' AND created_at <= now() - interval '30 days')   AS pending_that_will_be_expired_on_apply,
  min(created_at) FILTER (WHERE status = 'pending')                                         AS oldest_pending
FROM parent_invitations;
```

Never a blocker. Report all three values. If `pending_that_will_be_expired_on_apply` is large, the Orchestrator may want those Students told to re-send.

### 3.2 Shape the migration assumes (BLOCKER)

```sql
SELECT
  count(*) FILTER (WHERE created_at IS NULL)                                                 AS invitations_without_created_at,
  count(*) FILTER (WHERE status NOT IN ('pending', 'accepted', 'declined', 'revoked'))       AS invitations_with_unknown_status,
  (SELECT count(*) FROM parent_student_relationships
    WHERE status NOT IN ('pending', 'accepted', 'declined', 'revoked'))                      AS relationships_with_unknown_status
FROM parent_invitations;
```

Pass when all three are 0. (`created_at` NULL would make `expires_at` NULL and the `SET NOT NULL` fail.)

### 3.3 Stale invitations that today could still re-grant access (RECORD)

```sql
SELECT count(*) AS pending_invitations_to_a_parent_whose_relationship_was_ended
FROM parent_invitations pi
JOIN parent_student_relationships psr ON psr.student_id = pi.student_id AND psr.status IN ('revoked', 'declined')
JOIN profiles p ON p.id = psr.parent_id
JOIN users u ON u.id = p.user_id
WHERE pi.status = 'pending' AND lower(btrim(pi.invited_email)) = lower(btrim(u.email));
```

This is the L4-07 exposure as it stands. After the L10 code is deployed these invitations are refused on acceptance. Report the number.

---

## 4. Enrolment data against the new constraints — protects `20261120_1500` and `20261120_1100`

`20261120_1500` replaces "one row per learner per class" by "one OPEN row (PENDING or ACTIVE) per learner per class".

### 4.1 More than one OPEN row for a pair (BLOCKER)

```sql
SELECT count(*) AS pairs_with_more_than_one_open_row
FROM (
  SELECT class_id, student_id FROM class_enrollments
  WHERE status IN ('PENDING', 'ACTIVE')
  GROUP BY class_id, student_id HAVING count(*) > 1
) t;
```

Pass when 0. The current unique constraint makes any other value impossible; a non-zero result means the constraint is not the one the ledger says, and the new unique index would fail to build.

### 4.2 The constraint being replaced is the expected one (BLOCKER)

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.class_enrollments'::regclass AND contype = 'u';
```

Pass when exactly one row: `class_enrollments_unique`, `UNIQUE (class_id, student_id)`.

### 4.3 Status values (BLOCKER)

```sql
SELECT status, count(*) FROM class_enrollments GROUP BY status ORDER BY status;
```

Pass when every status is one of `PENDING`, `ACTIVE`, `DECLINED`, `ENDED`. Report the four counts.

### 4.4 Enrolments that point at nothing (BLOCKER)

```sql
SELECT
  count(*) FILTER (WHERE c.id IS NULL)  AS enrolments_without_a_class,
  count(*) FILTER (WHERE s.id IS NULL)  AS enrolments_without_a_student,
  count(*) FILTER (WHERE c.id IS NOT NULL AND c.institution_id IS NULL) AS enrolments_in_a_class_without_institution
FROM class_enrollments ce
LEFT JOIN classes c ON c.id = ce.class_id
LEFT JOIN students s ON s.id = ce.student_id;
```

Pass when all three are 0 (`20261120_1100` backfills one membership per institution and learner from these joins).

### 4.5 What the membership backfill will create (RECORD)

```sql
SELECT count(*) AS memberships_the_backfill_will_create
FROM (
  SELECT c.institution_id, ce.student_id
  FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id
  WHERE ce.status = 'ACTIVE'
  GROUP BY c.institution_id, ce.student_id
) t;
```

After the batch, `SELECT count(*) FROM institution_student_memberships WHERE status = 'ACTIVE'` must equal this number. That equality is the post-apply check for `20261120_1100`.

### 4.6 Closed rows that a later re-add will now leave in place (RECORD)

```sql
SELECT status, count(*) FROM class_enrollments WHERE status IN ('ENDED', 'DECLINED') GROUP BY status;
```

Context only: these rows become immutable history. Before L10 a coordinator's re-add overwrote them.

### 4.7 SQL outside the application that names the dropped constraint (BLOCKER for the batch)

Not a database query. In the code that will run against this database after the batch — every branch being converged, plus any operator or CI script kept outside the repository — search for:

```
ON CONFLICT (class_id, student_id)
```

Pass when there is no occurrence. After `20261120_1500`, Postgres rejects that clause ("there is no unique or exclusion constraint matching the ON CONFLICT specification"). On `feat/l10-shared-foundation` there is none in `src/` or `scripts/` (a unit test enforces it). Every other lane branch still carries the six occurrences it inherited from `4fb45b0`, all in five files that L10 rewrote; they disappear when L10 is merged, and that must be re-checked on the merged line.

---

## 5. After the batch — post-apply checks (whoever applies it)

All read-only.

```sql
-- 5.1 ledger: see 0.3

-- 5.2 no invitation lost its expiry; no pending invitation is past it
SELECT count(*) FILTER (WHERE expires_at IS NULL) AS without_expiry FROM parent_invitations;                  -- expect 0

-- 5.3 the permissive default is gone
SELECT column_default FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'parent_student_relationships' AND column_name = 'status';      -- expect 'pending'

-- 5.4 membership backfill matches 4.5
SELECT count(*) FROM institution_student_memberships WHERE status = 'ACTIVE';                                   -- expect the 4.5 number

-- 5.5 the licence tables are empty: the batch licenses nobody
SELECT (SELECT count(*) FROM institution_licenses) AS licences, (SELECT count(*) FROM institution_license_seats) AS seats;  -- expect 0, 0

-- 5.6 the onboarding carrier is empty
SELECT count(*) FROM user_role_onboarding;                                                                      -- expect 0

-- 5.7 the two indexes and the three triggers exist
SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  AND indexname IN ('uq_user_roles_one_persona', 'uq_class_enrollments_one_open');                              -- expect 2 rows
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
  'trg_class_enrollments_sync_institution_membership', 'trg_class_enrollments_closed_row_guard',
  'trg_institution_license_seats_guard', 'trg_institution_membership_release_seats');                           -- expect 4 rows

-- 5.8 the old one-row-per-pair constraint is gone
SELECT count(*) FROM pg_constraint WHERE conname = 'class_enrollments_unique';                                  -- expect 0
```

---

## 6. Summary sheet for L5 to return

| # | Check | Kind | Value | Verdict |
|---|---|---|---|---|
| 0.1 | Ledger before = 83 rows, last `20261112_1000`, no L10 row | BLOCKER | | |
| 0.2 | Pending set = the six L10 files, no checksum mismatch | BLOCKER | | |
| 0.4 | No new object name already exists | BLOCKER | | |
| 1.1 | Learners with no account row / never a STUDENT role row | BLOCKER (deploy) | | |
| 1.1 | `students.user_id IS NULL` | RECORD | | |
| 1.2 | Accepted parents without link or ACTIVE PARENT role | BLOCKER (deploy) | | |
| 1.3 | APPROVED teachers without ACTIVE TEACHER role | BLOCKER (deploy) | | |
| 1.4 | APPROVED coordinators without ACTIVE INSTITUTION_ADMIN role | BLOCKER (deploy) | | |
| 1.5 | ACTIVE accounts with no active role | RECORD | | |
| 1.6 | Teacher assignments in non-ACTIVE institutions / archived classes | RECORD | | |
| 2.1 | Accounts with more than one ACTIVE persona | BLOCKER | | |
| 3.1 | Pending invitations that will expire on apply | RECORD | | |
| 3.2 | Invitation / relationship shape | BLOCKER | | |
| 3.3 | Stale invitations to an ended relationship | RECORD | | |
| 4.1 | Pairs with more than one OPEN enrolment | BLOCKER | | |
| 4.2 | `class_enrollments_unique` is the only unique constraint | BLOCKER | | |
| 4.3 | Enrolment status values | BLOCKER | | |
| 4.4 | Orphan enrolments | BLOCKER | | |
| 4.5 | Memberships the backfill will create | RECORD | | |
| 4.6 | ENDED / DECLINED rows | RECORD | | |
| 4.7 | `ON CONFLICT (class_id, student_id)` in code that will run | BLOCKER | | |

"BLOCKER" stops the batch. "BLOCKER (deploy)" does not stop the batch but stops the L10 application code from being deployed against that database until resolved or accepted by the Orchestrator.

## Not in this contract

- The licence tables (`20261120_1200`) are structure only and still await L11's review; nothing reads them. No preflight is needed for them beyond 0.4.
- Nothing here checks Clerk. Whether verify-at-sign-up is on, and whether sessions are revoked on suspension, belong to L5's own preflight.
