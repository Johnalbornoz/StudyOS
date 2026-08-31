# StudyUs Phase 0B — Live Database Schema Reconciliation

Read-only database forensics. No schema, data, or application code was modified. No migration was run. No secrets were retained or committed. Date: 2026-08-26.

---

## 1. Executive Summary

- **DATABASE_CONNECTION = CONNECTED.** Read-only connection established using the same `DATABASE_URL` the application uses (`src/lib/db.ts`'s `pg.Pool`), sourced from the developer's local `.env.local`. PostgreSQL 18.6, database `neondb`, user `neondb_owner`, schema `public`. Host string contains `neon.tech` → **Provider: Neon**, confirmed.
- **NO_DATABASE_MIGRATION_LEDGER_FOUND.** No `schema_migrations`/`migrations`/`knex_migrations`/`prisma_migrations`/drizzle-style table exists — there is no live record of which of the 30 tracked migration files were ever actually executed.
- **The live database has 50 tables in `public`.** Several tables Phase 0A flagged as "untracked" genuinely exist live (`profiles`, `student_profiles`, `learning_evidence`, `subjects.student_id`, `subjects.status`, `assessment_occurrences`, `assessment_results`) — Phase 0A was right that they're undocumented in `migrations/`, but they are real, well-formed, and in active use.
- **MAJOR CORRECTION to Phase 0A: student identity is architecturally split roughly evenly, not narrowly.** Live FK inspection across all 50 tables shows **12 tables reference `profiles.id`** (`mastery_records`, `learning_evidence`, `errors`, `learning_debt`, `subjects`, `tutor_conversations`, `assessment_results`, `content_sources`, `notifications`, `parent_student_relationships`, `study_plans`, `student_availability`) and **12 reference `students.id`** (`quiz_sessions`, `concept_knowledge_state`, `verification_attempts`, `validation_cycles`, `cognitive_diagnoses`, `remediation_paths`, `student_misconceptions`, `subscriptions`, `analytics_events`, `calibration_conflicts`, `subject_mastery_snapshots`, `student_academic_profile`). Phase 0A's migration-based reading (24 `students` refs vs. 2 `profiles` refs) undercounted the live `profiles` side by a factor of 6 — including missing that the *entire core mastery pipeline* (`mastery_records`, `learning_evidence`, `errors`, `learning_debt`) targets `profiles`, not `students`.
- **Despite that architectural split, live data is perfectly synchronized**: 6/6 students have a matching profile row, 0 profiles-without-students, 0 students-without-profiles. **CANONICAL_IDENTITY_STATUS = DUAL_BUT_SYNCHRONIZED** — a real dual-identity architecture, but currently integrity-clean in practice.
- **MAJOR CORRECTION to Phase 0A: `verification_attempts` EXISTS live, is fully and correctly shaped exactly per migration 030's design (every CHECK constraint present, including `variant_equivalence_confidence` 0–1), and contains 2 real rows with 0 pending.** Phase 0A's CRITICAL-severity conclusion ("almost certainly never executed... fails silently in production") is **DISPROVEN** by the live database. This is the single biggest reversal in this pass — direct evidence that migration-comment claims of "NOT EXECUTED" can be stale.
- **`mastery_records.mastery_score` is confirmed live as `NUMERIC(5,2)`, NOT NULL, DEFAULT 0, with no range CHECK constraint of any kind.** Live aggregate: MIN 0.00, MAX 5.30, 0 rows below 0, 0 rows above 100, **2 of 7 rows above 1**. This directly and conclusively reconfirms this session's own earlier forensic finding: **LIVE_MASTERY_SCALE = 0_TO_100**, and the tracked migration's `DECIMAL(5,4) CHECK 0..1` text does not match live reality at all.
- **`errors` table live shape unambiguously MATCHES_009** (the second, later `CREATE TABLE IF NOT EXISTS` from migration 009): columns are exactly `id, student_id, concept_id, subject_id, error_type, source_type, created_at`, no `context`/no `timestamp` (migration 001's columns) — and `student_id → profiles.id`, exactly as 009 specifies.
- **`learning_evidence` live schema is fully ALIGNED with application code.** Every column the app inserts/selects (`student_id, concept_id, source_type, result, difficulty, timestamp, subject_id, activity_type, learning_mode, hints_used, ai_assistance_type, confidence_before_answer, score_percent, metadata`) exists live with a compatible type.
- **Referential integrity is clean across every table checked**: zero orphaned rows in `mastery_records`, `learning_evidence`, `concept_knowledge_state`, `verification_attempts`, and `errors` (each checked against both `students`/`concepts` as appropriate).
- **Three Phase 0A "dead/duplicate" candidates are confirmed to not even exist live**: `error_patterns`, `quiz_responses`, `chunk_embeddings`, `chunk_concept_mappings`, `exam_readiness_history`, `study_session_progress` — all six are simply absent from the live database (not just unused, genuinely never created there). `student_subjects` (referenced by `verifySubjectAccess` in `src/lib/auth.ts`) is **also absent live** — a previously-unflagged, real, live-confirmed risk.
- **Two tables exist live that neither Phase 0A nor this task's checklist anticipated**: `student_availability` and `study_session_items` — worth a follow-up look, not investigated deeply in this pass.
- **Application health**: `npx tsc --noEmit` clean, `npx vitest run` 610/610 passing, `npm run build` exit 0. `LINT_NOT_CONFIGURED` (confirmed again, no ESLint config or script exists).
- **A credential-handling mistake occurred during this task** (disclosed to the user immediately when it happened): an early diagnostic command's redaction regex failed and printed the full `DATABASE_URL`, including the plaintext password, into a tool-output log. No secret appears anywhere in this report or was sent anywhere external; the user was advised to rotate that Neon password as a precaution.

---

## 2. Database Connection & Environment

```
DATABASE_CONNECTION = CONNECTED
Provider: Neon (host contains "neon.tech")
PostgreSQL version: PostgreSQL 18.6 (aarch64-unknown-linux-gnu)
Current database: neondb
Current user: neondb_owner
Current schema (search_path default): public
SSL: connection string specifies sslmode=require&channel_binding=require (client-enforced);
     server-side `SHOW ssl` reported "off" (a server-level GUC, not per-connection proof either way —
     inconclusive on its own, but Neon's pooler endpoint enforces TLS at the network layer regardless)
```
Connection mechanism: identical to the application's own (`src/lib/db.ts`'s `new Pool({ connectionString: process.env.DATABASE_URL })`), using the value already present in the developer's local `.env.local` (not modified, not printed in this report).

No credentials, connection strings, hostnames beyond the provider-identifying substring, or tokens are reproduced anywhere in this document.

---

## 3. Live Schema Inventory

**50 tables in `public`** (exact `COUNT(*)` for the Learning-OS-relevant subset; `pg_class.reltuples` estimates shown as `~` are stale/unreliable for never-ANALYZEd small tables and are not used for any conclusion below):

```
analytics_events, assessment_concept_coverage, assessment_occurrences, assessment_results,
assessment_schedule_rules, backfill_runs, calibration_conflicts, cognitive_diagnoses,
concept_explanations, concept_knowledge_state, concept_localizations, concept_relationships,
concepts, content_chunks, content_sources, errors, learning_debt, learning_debt_events,
learning_evidence, mastery_events, mastery_policies, mastery_records, misconception_signatures,
notifications, parent_student_relationships, profiles, quiz_sessions, remediation_paths,
remediation_steps, student_academic_profile, student_availability, student_misconceptions,
student_profiles, students, study_plans, study_session_items, study_sessions,
subject_mastery_snapshots, subjects, subscriptions, subtopic_localizations, subtopics,
topic_localizations, topics, tutor_conversations, tutor_messages, user_language_preferences,
validation_cycles, validation_events, verification_attempts
```

**Exact row counts** (relevant tables):

| Table | Rows | Table | Rows |
|---|---|---|---|
| students | 6 | learning_debt | 4 |
| profiles | 9 | learning_debt_events | 0 |
| student_profiles | 5 | learning_evidence | 10 |
| parent_student_relationships | 0 | errors | 9 |
| subjects | 5 | misconception_signatures | 0 |
| topics/subtopics | 5 / 5 | student_misconceptions | 0 |
| concepts | 7 | concept_knowledge_state | 3 |
| concept_localizations | 11 | concept_relationships | 0 |
| quiz_sessions | 22 | cognitive_diagnoses | 0 |
| mastery_records | 7 | remediation_paths/steps | 0 / 0 |
| mastery_events | 10 | validation_cycles / events | 3 / 8 |
| mastery_policies | 1 | assessment_occurrences/results | 0 / 0 |
| verification_attempts | 2 | assessment_concept_coverage | 0 |
| tutor_conversations/messages | 2 / 4 | subject_mastery_snapshots | 13 |
| user_language_preferences | 2 | analytics_events | 14 |
| content_sources/chunks | 0 / 0 | study_plans / study_sessions | 2 / 14 |
| subscriptions | 2 | concept_explanations | 7 |

Six Phase-0A-relevant tables confirmed **absent** from the live database entirely: `error_patterns`, `quiz_responses`, `chunk_embeddings`, `chunk_concept_mappings`, `exam_readiness_history`, `study_session_progress`. `student_subjects` (checklist item) is also absent.

Full per-table columns, PKs, FKs, unique constraints, check constraints, and indexes were captured for every table in `public` (418 columns, 52 PK entries, 82 FK entries, 17 unique constraints, 331 check-constraint-catalog rows [mostly Postgres's internal NOT-NULL representations, not value-range checks — see §6], 117 indexes) — the sections below extract everything relevant to the Learning OS domain; the full raw capture is not reproduced in full here for length, but every specific claim below is sourced directly from it.

---

## 4. Student Identity Analysis (counts only, no PII)

**A. Does `students` exist?** YES. Columns: `id uuid PK (gen_random_uuid())`, `clerk_id text NOT NULL`, `email text NOT NULL`, `name text`, `language text DEFAULT 'en'`, `timezone text DEFAULT 'UTC'`, `created_at`, `updated_at`.

**B. Does `profiles` exist?** YES. Columns: `id uuid PK`, `user_type varchar NOT NULL`, `full_name text`, `created_at timestamptz`, `clerk_id varchar`. No `email` column (lives only on `students`).

**C. Does `student_profiles` exist?** YES (5 rows).

**D. Are `students.id` and `profiles.id` linked by an FK?** **NO.** No foreign key constraint exists between them anywhere in the live schema. They are two structurally independent primary-key spaces, related only by application-level convention (the same UUID is written to both on every login, per `src/lib/auth.ts`'s `ensureProfileRows`/`upsertStudentRecord`).

**E. Do they normally contain matching UUIDs?** YES, currently perfectly:
```
studentsCount = 6
profilesCount = 9  (profilesByUserType: student=6, parent=3)
studentProfilesCount = 5
studentsWithMatchingProfile = 6   (all 6 of 6)
studentsWithoutProfile = 0
profilesWithoutStudent (user_type='student') = 0
```
Every student-type profile has a matching `students` row and vice versa. (`profiles` also legitimately holds 3 parent-type rows that have no `students` counterpart by design — parents were never meant to have one.)

**F. What does `subjects.student_id` reference?** `profiles.id`. (Not `students`, contrary to what Phase 0A's migration-based reading implied for the "core" tables.)

**G. What does `errors.student_id` reference?** `profiles.id`.

**H. What does `tutor_conversations.student_id` reference?** `profiles.id`.

**I. What does `parent_student_relationships` reference?** Both `parent_id` and `student_id` columns reference `profiles.id` (0 rows currently).

**Full live FK census for every `student_id` column found (38 tables carry one):**

| → `profiles.id` (12 tables) | → `students.id` (12 tables) |
|---|---|
| assessment_results, content_sources, errors, learning_debt, learning_evidence, mastery_records, notifications, parent_student_relationships, study_plans, subjects, tutor_conversations, student_availability | analytics_events, calibration_conflicts, cognitive_diagnoses, concept_knowledge_state, quiz_sessions, remediation_paths, student_academic_profile, student_misconceptions, subject_mastery_snapshots, subscriptions, validation_cycles, verification_attempts |

**`CANONICAL_IDENTITY_STATUS = DUAL_BUT_SYNCHRONIZED`** — this is a real, deep, evenly-split (12/12) dual-identity architecture at the schema level (not a narrow 2-table exception as Phase 0A's tracked-migration reading suggested), but it is currently fully integrity-clean in the live data: zero drift in either direction. Notably, a single quiz submission's own write path spans both spaces in one transaction (`quiz_sessions → students`, then `mastery_records`/`learning_evidence`/`errors`/`learning_debt` → `profiles`), which only stays safe because the app never lets the two UUIDs diverge.

---

## 5. Concept Identity Validation

Every concept-scoped FK checked resolves to `concepts.id` — **no fragmentation found**, confirming Phase 0A's conclusion:

```
mastery_records.concept_id            -> concepts.id
learning_evidence.concept_id          -> concepts.id
errors.concept_id                     -> concepts.id
concept_knowledge_state.concept_id    -> concepts.id
misconception_signatures.concept_id   -> concepts.id
concept_relationships.{source,target}_concept_id -> concepts.id
cognitive_diagnoses.{target,candidate}_concept_id -> concepts.id
remediation_paths.{target,root_cause}_concept_id  -> concepts.id
validation_cycles.concept_id          -> concepts.id
assessment_concept_coverage.concept_id -> concepts.id
verification_attempts.concept_id      -> concepts.id
quiz_sessions.concept_id / concept_explanations.concept_id / remediation_steps.concept_id / study_session_items.concept_id / concept_localizations.concept_id -> concepts.id
```
`concepts` itself: 7 live rows, `id uuid PK`, `subject_id uuid FK → subjects`. **Concept identity is unified and clean.**

---

## 6. Mastery Contract Validation

Live `mastery_records.mastery_score` definition:
```
type: numeric
precision: 5
scale: 2
default: 0
nullable: NO
CHECK constraints on value range: NONE
  (the only "check_clause" rows Postgres reports for this column are its
   auto-generated NOT NULL representations, e.g. "mastery_score IS NOT NULL" —
   not a value-range constraint)
```
Live aggregate query (read-only, whole-table, no individual rows returned):
```
MIN(mastery_score)               = 0.00
MAX(mastery_score)                = 5.30
COUNT(mastery_score < 0)          = 0
COUNT(mastery_score > 100)        = 0
COUNT(mastery_score > 1)          = 2   (of 7 total rows)
```
Two of seven live rows have a value greater than 1 — under a genuine `CHECK (mastery_score <= 1)` these rows could not exist. **`LIVE_MASTERY_SCALE = 0_TO_100`.**

Comparison: `src/lib/algorithms/mastery.ts`'s `updateMastery` clamps `Math.max(0, Math.min(100, newMastery))` — matches live reality exactly. The tracked migration text (`migrations/001_create_core_tables.sql`: `DECIMAL(5,4) DEFAULT 0.0 CHECK (mastery_score >= 0 AND mastery_score <= 1)`) matches **neither** the live type (`NUMERIC(5,2)`, not `(5,4)`) **nor** the live constraint (none exists) **nor** the live data (values >1 present). This independently and conclusively reconfirms this session's own earlier forensic mastery-scale finding, now from the live catalog and live data directly rather than from code inference.

Referential integrity: `mastery_records` orphan-concept = 0, orphan-student (checked against `profiles.id`, its real FK target) = 0.

---

## 7. Learning Evidence Contract

`learning_evidence` **exists live** (10 rows). Full column list:
```
id uuid NOT NULL
student_id uuid NOT NULL          -> FK profiles.id
concept_id uuid NOT NULL          -> FK concepts.id
source_type varchar NOT NULL
result varchar NOT NULL
difficulty numeric NOT NULL
timestamp timestamptz (nullable)
subject_id uuid (nullable)
activity_type text (nullable)
learning_mode text (nullable)
hints_used integer NOT NULL
ai_assistance_type text NOT NULL
confidence_before_answer text (nullable)
metadata jsonb (nullable)
score_percent numeric (nullable)
```
Every column `src/services/mastery.service.ts`'s `INSERT INTO learning_evidence (student_id, concept_id, source_type, result, difficulty, timestamp, subject_id, activity_type, learning_mode, hints_used, ai_assistance_type, confidence_before_answer, score_percent, metadata)` writes exists live with a compatible type. Referential integrity: 0 orphan students, 0 orphan concepts (of 10 rows).

**`LEARNING_EVIDENCE_CONTRACT = ALIGNED.`**

---

## 8. Verification Persistence Validation

**`verification_attempts` EXISTS live** (2 rows). Full column list, cross-checked against `migrations/030_assessment_verification.sql`:

```
id uuid PK (gen_random_uuid())
quiz_session_id text NOT NULL
student_id uuid NOT NULL              -> FK students.id
concept_id uuid NOT NULL              -> FK concepts.id
original_question_index integer
original_question jsonb NOT NULL
original_score_percent numeric NOT NULL   CHECK 0-100
verification_question jsonb NOT NULL
trigger_ids jsonb NOT NULL                CHECK jsonb_typeof = 'array'
original_response text
verification_response text
grading_confidence numeric                CHECK 0-1
verification_grading_confidence numeric   CHECK 0-1
variant_equivalence_confidence numeric    CHECK 0-1
assessment_confidence_before numeric NOT NULL  CHECK 0-100
assessment_confidence_after numeric            CHECK 0-100
outcome text                              CHECK IN ('CONFIRMED','CONTRADICTED','INCONCLUSIVE')
created_at timestamptz NOT NULL
resolved_at timestamptz
```
This is a **byte-for-byte structural match** to migration 030's design — every column, every CHECK constraint (including the exact `variant_equivalence_confidence` 0–1 bound) is present and correctly typed.

Live aggregate:
```
COUNT(*) = 2
COUNT(*) WHERE outcome IS NULL = 0   (zero pending -- both existing attempts were fully resolved)
orphan_student = 0, orphan_concept = 0
```

**`VERIFICATION_PERSISTENCE = READY.`**

This is a direct, evidence-based **reversal** of Phase 0A's CRITICAL-severity finding, which concluded (from the migration file's own "NOT EXECUTED... design only" header comment and the matching service-code comment) that this table almost certainly did not exist live and that the verification flow was likely failing silently in production. The live database proves otherwise: the table exists, is fully and correctly shaped, and has already processed two real verification attempts to completion. The migration file's header comment is simply stale — it was evidently applied at some point after that comment was written, without the comment being updated to reflect it.

---

## 9. Errors Schema Validation

Live `errors` table (9 rows):
```
id uuid NOT NULL
student_id uuid NOT NULL     -> FK profiles.id
concept_id uuid NOT NULL     -> FK concepts.id
subject_id uuid NOT NULL     -> FK subjects.id
error_type varchar NOT NULL
source_type varchar NOT NULL
created_at timestamptz NOT NULL
```
No `context jsonb` column, no bare `timestamp` column (both present in migration 001's competing definition) — the live shape has `subject_id`/`source_type` and no `context`, matching migration 009's `CREATE TABLE IF NOT EXISTS errors` exactly, including its `REFERENCES profiles(id)` FK target.

**`ERRORS_SCHEMA = MATCHES_009.`** Application code's actual `INSERT INTO errors (student_id, concept_id, subject_id, error_type, source_type)` (`mastery.service.ts`, `error-intelligence.service.ts`) matches the live structure exactly — this write path is healthy. Orphan-concept check: 0 of 9 rows.

---

## 10. Untracked Schema Objects

| Object | Classification | Evidence |
|---|---|---|
| `profiles` | **LIVE_AND_UNTRACKED** | exists live (9 rows), no `CREATE TABLE profiles` in `migrations/` |
| `student_profiles` | **LIVE_AND_UNTRACKED** | exists live (5 rows), no `CREATE TABLE` in `migrations/` |
| `student_subjects` | **NOT_LIVE** | does not exist in the live database at all — yet `src/lib/auth.ts`'s `verifySubjectAccess` queries `FROM student_subjects` (see §13) |
| `parent_student_relationships` | **LIVE_AND_UNTRACKED** | exists live (0 rows), only ever `ALTER TABLE`'d in `migrations/012`, never `CREATE TABLE`'d |
| `learning_evidence` | **LIVE_AND_UNTRACKED** | exists live (10 rows), only ever `ALTER TABLE`'d (021, 022), never `CREATE TABLE`'d |
| `assessment_occurrences` | **LIVE_AND_UNTRACKED** | exists live (0 rows), columns: `id, rule_id, subject_id, scheduled_date, status, topics[], exam_readiness, created_at` — no `CREATE TABLE` in `migrations/` |
| `assessment_results` | **LIVE_AND_UNTRACKED** | exists live (0 rows), columns: `id, occurrence_id, student_id(→profiles), score, max_score, percentage, analyzed_at, analysis_result, created_at` — no `CREATE TABLE` in `migrations/` |
| `user_language_preferences` | **LIVE_AND_TRACKED** — correction to Phase 0A, which marked this NOT FOUND in migrations; it exists live (2 rows) and turned out to simply not have been searched for in the migration text carefully enough in Phase 0A. **UNVERIFIED which migration created it** — not resolved in this pass. |
| `subjects.student_id` | **LIVE_AND_UNTRACKED** | `uuid NOT NULL`, FK → `profiles.id`, live and required — no migration adds it |
| `subjects.status` | **LIVE_AND_UNTRACKED** | `varchar NOT NULL DEFAULT 'active'`, live and required — no migration adds it |

Two additional tables exist live that were outside this checklist's scope and are flagged here for awareness, not investigated further: `student_availability` (FK → `profiles.id`) and `study_session_items` (FK → `concepts.id`) — possibly the live successor to the never-created `study_session_progress`, but this is **UNVERIFIED**, not confirmed.

---

## 11. Migration History / Ledger

```
NO_DATABASE_MIGRATION_LEDGER_FOUND
```
No table matching `%migration%`, `%schema_version%`, `knex%`, or `%drizzle%` exists anywhere in `public`. There is no live record of which of the 30 files in `migrations/` were actually executed, in what order, or when. This means the "RECOVERY NOTE" claims in migrations 028/029/030 (and the silence on 001-027) cannot be cross-checked against any ledger — they are the only textual record of intent, and per §8, at least one of them (030) is now known to be stale/incorrect.

---

## 12. Migration vs. Live Schema Matrix

| Object | Live Status | Migration Status | Classification | Difference | Risk |
|---|---|---|---|---|---|
| `students` | EXISTS | Tracked (001) | MATCH | none found | — |
| `profiles` | EXISTS | Untracked | LIVE_ONLY | no `CREATE TABLE` anywhere | Medium — real, working, undocumented |
| `student_profiles` | EXISTS | Untracked | LIVE_ONLY | no `CREATE TABLE` anywhere | Medium |
| `subjects` | EXISTS | Tracked, but missing `student_id`/`status` | DEFINITION_MISMATCH | live has 2 required columns migrations never add | Medium |
| `topics`/`subtopics` | EXISTS | Tracked (016) | MATCH | none found | — |
| `concepts` | EXISTS | Tracked (001) | MATCH | none found | — |
| `mastery_records` | EXISTS | Tracked (001), but type/constraint differ | DEFINITION_MISMATCH | live `NUMERIC(5,2)` no CHECK vs. tracked `DECIMAL(5,4) CHECK 0-1`; live FK → `profiles`, tracked text says `students` | **High** — this exact mismatch was independently reconfirmed twice this session |
| `mastery_events` | EXISTS | Tracked (001) | MATCH (not deep-diffed column-by-column this pass) | — | Low |
| `learning_debt` | EXISTS | Tracked (001), FK differs | DEFINITION_MISMATCH | live FK → `profiles`, tracked text implies `students` | Medium |
| `learning_evidence` | EXISTS | Untracked | LIVE_ONLY | fully aligned with app code regardless (§7) | Medium (undocumented, not broken) |
| `errors` | EXISTS | Tracked TWICE, conflicting (001 vs 009) | DEFINITION_MISMATCH | live matches 009 exactly, 001 never took effect | **High** — resolved this pass, but the repo still contains a contradictory 001 definition |
| `quiz_sessions` | EXISTS | Tracked (003/004 + 5 later ALTERs) | MATCH | none found this pass | — |
| `quiz_responses` | **NOT LIVE** | Tracked (003) | MIGRATION_ONLY | table was never created live at all | Low (confirms dead) |
| `concept_knowledge_state` | EXISTS | Tracked (025) | MATCH | exact column match confirmed | — |
| `misconception_signatures` | EXISTS | Tracked (023, +025) | MATCH (not deep-diffed) | — | Low |
| `verification_attempts` | EXISTS | Tracked (030), header says "NOT EXECUTED" | **DEFINITION_MISMATCH (comment is wrong)** | live is a byte-for-byte match to the migration text — the *comment*, not the schema, is what's wrong | **High** — stale documentation, not a real schema gap |
| `assessment_occurrences` | EXISTS | Untracked | LIVE_ONLY | — | Medium |
| `assessment_results` | EXISTS | Untracked | LIVE_ONLY | — | Medium |
| `error_patterns` | **NOT LIVE** | Tracked (001) | MIGRATION_ONLY | table never created live | Low (confirms dead, stronger than Phase 0A's "effectively dead" wording) |
| `student_subjects` | **NOT LIVE** | Untracked (not in `migrations/` either) | UNKNOWN/MISSING | referenced by live application code (`auth.ts`) with no backing table anywhere | **High — new finding, see §16** |

---

## 13. Code vs. Database Contract Matrix

| Component | File | DB dependency | Status | Evidence |
|---|---|---|---|---|
| Mastery write | `mastery.service.ts` `updateMastery` | `UPDATE mastery_records SET mastery_score=...` | **PASS** | column/type live-confirmed, no CHECK to violate |
| Mastery read | `mastery.service.ts` `getMasteryRecord`/`getStudentMastery` | `SELECT mastery_score, confidence_score, attempt_count... FROM mastery_records` | **PASS** | all columns present live |
| Learning evidence write | `mastery.service.ts` (`INSERT INTO learning_evidence`) | 14-column insert | **PASS** | every column present live (§7) |
| Verification persistence | `assessment-verification.service.ts` `createPendingVerificationAttempt`/`getPendingVerificationAttempt`/`resolveVerificationAttempt` | `INSERT/SELECT/UPDATE verification_attempts` | **PASS** (reversal of Phase 0A's BROKEN assumption) | table live, fully matches (§8), 2 real rows processed |
| Quiz persistence | `quiz-persistence.service.ts` `storeQuiz`/`completeQuiz` | `INSERT/UPDATE quiz_sessions` | **PASS** | 22 live rows, columns match |
| Knowledge State projection | `knowledge-state.service.ts` `recalculateConceptKnowledgeState` | `INSERT/UPDATE concept_knowledge_state` | **PASS** | 3 live rows, all columns match exactly |
| Misconception classification | `misconception.service.ts` `getOrCreateSignature`/`recordStudentMisconception` | `misconception_signatures`/`student_misconceptions` | **PASS** (structurally) — 0 rows in either table live, so write path is unexercised, not verified in practice | tables exist with expected shape |
| Error recording | `error-intelligence.service.ts` `recordError` | `INSERT INTO errors` | **PASS** | matches live 009-shaped table exactly (§9) |
| Subject ownership check | `src/lib/auth.ts` `verifySubjectAccess` | `SELECT 1 FROM student_subjects WHERE student_id=$1 AND subject_id=$2` | **BROKEN** | `student_subjects` **does not exist live at all** — every call to this function will throw `relation "student_subjects" does not exist` |
| Concept ownership check | `mastery.service.ts:507` (`WHERE ... s.student_id = $2` on `subjects`) | reads `subjects.student_id` | **PASS** | column live-confirmed, and its FK target (`profiles.id`) is the same UUID space the caller always passes |
| Exam result recording | `exam-result.service.ts` `recordExamResult` | `INSERT INTO assessment_results` / `SELECT ... FROM assessment_occurrences` | **PASS** | both tables live, columns match (§10); currently 0 rows so unexercised in this environment |

---

## 14. Referential Integrity Checks (counts only)

```
Identity
  students without profiles           = 0
  profiles (student-type) without students = 0

Mastery
  mastery_records with score <0 or >100 = 0
  mastery_records with score >1         = 2   (of 7 -- expected/valid under the confirmed 0-100 scale)
  mastery_records orphaned (no concept) = 0
  mastery_records orphaned (no student, checked against profiles.id) = 0

Evidence
  learning_evidence orphaned (no student, checked against profiles.id) = 0
  learning_evidence orphaned (no concept) = 0

Knowledge State
  concept_knowledge_state orphaned (no student) = 0
  concept_knowledge_state orphaned (no concept) = 0

Verification
  verification_attempts total    = 2
  verification_attempts pending (outcome IS NULL) = 0
  verification_attempts orphaned (no student/concept) = 0 / 0

Errors
  errors orphaned (no concept) = 0
```
**No integrity violations found anywhere checked.** The live data is clean despite the schema-level dual-identity architecture and undocumented-migration issues.

---

## 15. Application Validation

```
TypeScript:  npx tsc --noEmit          → clean, exit 0
Tests:       npx vitest run            → 53 test files, 610 tests, all passed (~0.98s)
Build:       npm run build             → exit 0, clean route manifest, no errors
Lint:        LINT_NOT_CONFIGURED       → no ESLint config file, no `lint` script in package.json
```
None of this pass's read-only database work touched application code, so these results are unchanged from the state confirmed earlier this session — re-run fresh for this task's own record.

---

## 16. Confirmed Blockers (proven against the live database)

1. **`src/lib/auth.ts`'s `verifySubjectAccess` queries a table (`student_subjects`) that does not exist in the live database.** Every call to this function will throw a Postgres "relation does not exist" error. This is a genuinely new, live-confirmed finding — Phase 0A listed `student_subjects` only as an identifier name, not as a live-broken query target. **Needs an immediate follow-up** (not fixed in this read-only pass) to determine whether this function is actually called anywhere reachable in production, and if so, whether it's silently failing (wrapped in try/catch, per the pattern seen elsewhere in this codebase) or actively breaking a feature.
2. **The tracked `migrations/001_create_core_tables.sql` definition of `mastery_records` (type, constraint, and implied FK target) does not match live reality on three separate points** (type `DECIMAL(5,4)` vs. live `NUMERIC(5,2)`; a `CHECK 0-1` that doesn't exist live; an implied `students` FK when live is `profiles`). Any future migration authored by reading `migrations/001` alone, without checking live schema first, would be wrong.
3. **The tracked `errors` table has two live-contradictory definitions in the same migrations folder** (001 vs 009) — a future contributor reading only `migrations/001` would build against the wrong shape.

---

## 17. Phase 0A Findings Reclassified

| Phase 0A finding | Reclassification | Live evidence |
|---|---|---|
| 1. `migrations/` does not reliably describe the live database | **CONFIRMED** | Multiple independent mismatches found (§12); no migration ledger exists to even check against |
| 2. `students`/`profiles` may be two separate identity spaces | **CONFIRMED, and more severe than Phase 0A stated** | 12/12 even split across live FKs (§4), not the ~24-vs-2 split the tracked migrations implied |
| 3. `learning_evidence` heavily used, no tracked base CREATE TABLE | **CONFIRMED** | table exists live, fully functional, genuinely absent from `migrations/` |
| 4. `verification_attempts` may never have been executed | **DISPROVEN** | table exists live, fully matches migration 030's design, has processed 2 real records to completion |
| 5. `errors` has conflicting migration definitions | **CONFIRMED, and resolved** | live matches migration 009 exactly; migration 001's version never took effect |
| 6. `subjects.student_id`/`subjects.status` used but not tracked | **CONFIRMED** | both columns live, `NOT NULL`, required; absent from every tracked migration |
| 7. `assessment_occurrences`/`assessment_results` used but no tracked CREATE TABLE | **CONFIRMED** | both exist live, well-formed, genuinely untracked |
| 8. `mastery_records.mastery_score` migration says 0–1, code uses 0–100 | **CONFIRMED** | live type/constraint/data all independently confirm 0–100, zero constraint enforcing 0–1 |
| 9. Several other tables exist outside tracked migration history | **CONFIRMED** | `profiles`, `student_profiles`, `parent_student_relationships`, `learning_evidence`, `assessment_occurrences`, `assessment_results` all confirmed untracked-but-live |

**Net result**: 8 of 9 Phase 0A findings are CONFIRMED (several more severely than originally stated), and 1 (verification persistence) is DISPROVEN outright — Phase 0A's single CRITICAL-severity risk turns out to be the one place the tracked documentation was simply out of date, not the live system.

---

## 18. Unknowns

- **UNVERIFIED**: exactly when/how migration 030 was actually applied to Neon, given its own header comment says otherwise — no migration ledger exists to establish this.
- **UNVERIFIED**: whether migrations 026/027 (`validation_cycles`/`external_validation`, no "RECOVERY NOTE") are in the same "actually-applied-but-undocumented" state as 030, or genuinely reflect what's live — not deep-diffed column-by-column this pass (row counts and top-level existence were confirmed; full column parity was not checked for every single table).
- **UNVERIFIED**: the exact origin/purpose of `student_availability` and `study_session_items` — both exist live, neither was in this task's checklist, neither was investigated in depth.
- **UNVERIFIED**: whether `student_subjects`'s absence (§16 blocker) is currently causing a live production failure, a silently-swallowed error, or simply a code path that's never actually reached — determining this needs an application-level trace, out of scope for this DB-only pass.
- **UNVERIFIED**: full column-by-column diffs for `mastery_events`, `misconception_signatures`, `student_misconceptions`, `cognitive_diagnoses`, `remediation_paths`/`steps`, `validation_cycles`/`events`, `subscriptions`, `content_sources`/`content_chunks` — existence, row counts, and top-level shape were captured for all of these, but a full per-column diff against their respective migrations was not performed for every one given the scope of this pass.
- **UNVERIFIED**: `SSL` state for this specific connection (`SHOW ssl` reported "off" as a server GUC; the connection string itself specified `sslmode=require`, and Neon's pooler endpoint is understood to enforce TLS at the network layer regardless of this particular reported value — not independently confirmed via `pg_stat_ssl`).

---

## 19. Commands Executed

```
node <read-only script using pg.Pool, DATABASE_URL loaded via dotenv from .env.local>
  → SELECT version(), current_database(), current_user, current_schema()
  → SELECT ... FROM pg_class/pg_namespace (table inventory)
  → SELECT ... FROM information_schema.columns (all columns, public schema)
  → SELECT ... FROM information_schema.table_constraints/key_column_usage (PKs, FKs, unique constraints)
  → SELECT ... FROM information_schema.check_constraints
  → SELECT ... FROM pg_indexes
  → SELECT ... FROM information_schema.tables WHERE table_name ILIKE '%migration%' (etc.) -- ledger search
  → COUNT(*) per relevant table (exact row counts)
  → Targeted aggregate/EXISTS queries for identity, mastery-range, and orphan checks (§4, §6, §14)
  All statements were SELECT-only; no INSERT/UPDATE/DELETE/ALTER/CREATE/DROP was executed.

npx tsc --noEmit        → clean, exit 0
npx vitest run           → 53 files, 610 tests passed
npm run build            → exit 0
(no lint script exists to run)
```
No credentials were printed in any command shown above or reproduced in this report. (One earlier diagnostic command, since removed from this account, did leak the connection string into a tool-output log during this session — disclosed to the user directly when it happened; not reproduced here.)

---

## 20. Final Decision

**A. Is the live database safe to use as the current source of truth?**
**YES, WITH CONDITIONS.** It is internally consistent and integrity-clean today (§14), and it is unambiguously more accurate than `migrations/` for every point of disagreement found. The condition: treat it as the source of truth going forward, but first resolve the `student_subjects` blocker (§16) and decide what to do about the dual identity architecture (§4) before building new tables on top of it.

**B. Do migrations accurately reproduce the live database?**
**NO.** Confirmed mismatches on type/constraint/FK-target for `mastery_records`, a fully contradictory duplicate definition for `errors`, and at least 6 live tables/columns entirely absent from `migrations/` (`profiles`, `student_profiles`, `learning_evidence`, `assessment_occurrences`, `assessment_results`, `subjects.student_id`/`status`).

**C. Is student identity currently safe and consistent?**
**YES, WITH CONDITIONS.** Live data shows perfect synchronization (§4) — currently safe in practice. The condition: this safety depends entirely on the application never writing to one table without the other, which is convention-enforced, not database-enforced (no FK ties them together) — one bug in `ensureProfileRows` could silently desynchronize them with nothing in the schema to catch it.

**D. Is mastery schema aligned with application logic?**
**YES.** Live `NUMERIC(5,2)`, no constraint, matches `lib/algorithms/mastery.ts`'s 0–100 clamp exactly. The tracked migration text is what's misaligned, not the live schema vs. the app.

**E. Is `learning_evidence` schema aligned with application code?**
**YES.** Full column-level match confirmed (§7).

**F. Is Verification persistence operational?**
**YES.** Reversing Phase 0A's conclusion — the table exists, is correctly shaped, and has successfully processed real records.

**G. Is the `errors` schema aligned with application code?**
**YES.** Live shape matches the application's actual INSERT statements exactly (migration 009's shape).

**H. Can we safely design reconciliation migrations now?**
**YES, for the schema mismatches captured in §12 — with the caveat that a handful of tables (§18) were not diffed column-by-column and should be spot-checked before writing a migration against them specifically.**

**I. Maximum five remediation actions required next, in priority order** (not implemented in this pass):
1. **Fix or confirm-and-document the `student_subjects` gap** (§16) — determine whether `verifySubjectAccess` is reachable in production and, if so, what it's actually doing today (throwing? silently swallowed?).
2. **Author a corrected baseline migration reflecting live reality** for `mastery_records` (`NUMERIC(5,2)`, no CHECK, FK → `profiles`), `errors` (drop/reconcile migration 001's dead definition, keep 009's), and every table confirmed `LIVE_ONLY` in §12/§10 — so the tracked history stops contradicting the database.
3. **Decide, explicitly, the fate of the dual `students`/`profiles` identity architecture** — formally document the "same-UUID convention" as the intended design (and consider adding the FK constraint that's currently missing to make the database itself enforce it), or plan a real consolidation. Either is defensible; staying silent is not.
4. **Update migration 030's stale "NOT EXECUTED" comment** (and audit 026/027 for the same possible staleness, per §18) so future readers don't repeat Phase 0A's reasonable-but-wrong conclusion.
5. **Stand up a real migration ledger** (even a minimal `schema_migrations(version, applied_at)` table) so this entire class of "did this actually run?" uncertainty stops being something that requires a live forensic pass to answer.

---

*End of report. No schema, data, or application code was modified. No migration was applied. No credentials are reproduced above.*
