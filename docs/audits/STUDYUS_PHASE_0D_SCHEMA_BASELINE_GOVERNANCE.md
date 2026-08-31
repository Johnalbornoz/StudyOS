# StudyUs Phase 0D — Schema Baseline & Migration Governance

Date: 2026-08-26/31. No live Neon schema was mutated during the audit/design portion. One narrowly-scoped, additive, pre-authorized write (the migration ledger bootstrap) was performed under Step 10's explicit conditions — see §17.

---

## 1. Executive Summary

- **Captured a byte-accurate baseline** of the live production schema via `pg_dump --schema-only` — `database/baseline/STUDYUS_BASELINE_2026_08.sql`, 50 tables, verbatim from Neon.
- **Chosen strategy: SQL baseline snapshot (Option A)**, with `migrations/001-030` preserved untouched as historical artifacts, never deleted, never rewritten. Full reasoning in `docs/adr/0001-schema-baseline-strategy.md`.
- **Every one of migrations 001-030 classified** against live reality — see §4. Headline finding: migrations 001-003 could not have run as literally committed (invalid Postgres syntax, confirmed by migration 004's own admission and independently re-confirmed this phase); migration 030's "NOT EXECUTED" comment is proven false by the live database.
- **Reproducibility proven**: `scripts/db-reproducibility-test.sh` builds the full 50-table schema from nothing on an ephemeral, throwaway local Postgres instance (never Neon) — `REPRODUCIBILITY_TEST = PASS`, including every Step-12-mandated table and its PK/FK/critical-column contracts, and confirming zero legacy-dead tables get created.
- **26 schema contract tests added** (`tests/unit/schema-contract.test.ts`), parsing the baseline file statically — no database connection, no credentials required — encoding the identity, mastery, evidence, verification, and errors contracts as permanent regression tests against drift.
- **A minimal, real migration ledger was designed and implemented**: `schema_migrations` (version/name/checksum/applied_at). Per Step 10's explicit conditions (additive-only, zero effect on existing app behavior, reviewed against live schema, tested, no historic migration replayed), it was bootstrapped to production — a single `CREATE TABLE IF NOT EXISTS` plus one row recording the baseline itself as applied. **This is the only production write this phase performed.**
- **A working migration runner exists**: `npm run db:status` (read-only) and `npm run db:migrate` (`--dry-run` supported), reading from a brand-new, currently-empty `database/migrations/` directory — deliberately never the legacy `migrations/` folder. Neither script runs automatically; both require an explicit human invocation.
- **10 database governance rules documented** in `docs/architecture/database-governance.md`.
- **No historic migration (001-030) was executed or replayed** at any point in this phase.
- **No existing application table or row was altered.** Row counts for every checked table (`students`, `profiles`, `subjects`, `concepts`, `mastery_records`, `verification_attempts`) were re-verified identical to Phase 0B/0C readings, before and after the ledger bootstrap.
- **Application health preserved**: `tsc` clean, 655/655 tests passing (620 baseline + 35 new), `npm run build` exit 0, no lint configured.
- **Credential safety**: no secret was printed or committed this phase. `NEON_CREDENTIAL_ROTATION_STILL_REQUIRED` — the Phase 0B leak has not been confirmed rotated as of this phase.
- **Git diff is scoped exactly as expected**: 12 new files (baseline, ledger design, governance docs, runner scripts, tests) plus 3 new `package.json` script entries. Zero quiz/mastery/UI/Decision-Engine code touched.

---

## 2. Baseline Strategy Selected

**Option A: SQL baseline snapshot.** Full reasoning in `docs/adr/0001-schema-baseline-strategy.md`; summary:

- **B (consolidated baseline migration numbered to continue 001-030)** was rejected — numbering it into that sequence implies it belongs to the same trustworthy history, which is precisely the false impression this phase exists to eliminate.
- **C (schema dump + future incremental migrations)** is effectively what was chosen — the SQL dump *is* the practical form Option A takes, combined with the new `database/migrations/` directory for everything going forward.
- **D (hand-authored "ideal" schema)** was rejected — Phase 0D's mandate is to capture reality, not redesign it. The baseline still has no CHECK on `mastery_records.mastery_score`, still has the unlinked `students`/`profiles` split, still has whatever `errors` shape is actually live — none of that was "fixed" while baselining.

---

## 3. Live Schema Baseline

**Location:** `database/baseline/STUDYUS_BASELINE_2026_08.sql`

**How it was captured:** `pg_dump --schema-only --no-owner --no-privileges --no-tablespaces --no-comments --schema=public` against the live `DATABASE_URL` (read-only against the source — `pg_dump` never writes to the database it dumps), via a Node script that never printed the connection string. `pg_dump` version 18.3 (client) against PostgreSQL 18.6 (Neon server) — matching major version, full compatibility.

**Contents:** 50 `CREATE TABLE` statements, every PK/FK/UNIQUE/CHECK constraint, every index, in dependency order. Two client-only artifacts from the raw `pg_dump` output (`\restrict`/`\unrestrict` psql meta-commands) were stripped for portability — no schema content was altered. A descriptive header banner was added explaining what the file is, is not, and its one external prerequisite (the `vector` extension, used by `content_chunks.chunk_embedding`).

**Structure of `database/`:**
```
database/
  baseline/STUDYUS_BASELINE_2026_08.sql   -- the snapshot
  ledger/0000_baseline_ledger.sql         -- schema_migrations DDL (applied, see §17)
  migrations/.gitkeep                     -- empty; future governed migrations go here
  README.md                               -- practical usage guide
```
Placement decided after inspecting existing repo conventions (`migrations/` at the root for legacy SQL, `scripts/` for `tsx`-run TypeScript tooling, `docs/architecture/` and `docs/adr/` for documentation) rather than blindly following the task's suggested path — `database/` was chosen specifically because it sits parallel to, and visually distinct from, the legacy `migrations/` folder, satisfying the explicit "clear separation" requirement.

---

## 4. Historical Migration Classification

| Migration | Purpose | Status | Current Live Equivalent | Notes |
|---|---|---|---|---|
| 001_create_core_tables | students, subjects, concepts, mastery_records, learning_debt, errors, error_patterns | **INVALID_AS_WRITTEN** | students/subjects/concepts/mastery_records/learning_debt exist live with different column sets than written here; errors/error_patterns as written here never took effect | Uses invalid MySQL-style inline `INDEX name (cols)` syntax inside `CREATE TABLE` (confirmed present in `mastery_records`, `learning_debt`, `errors`, `error_patterns` blocks) — the same defect migration 004 admits broke 002/003. Could not have executed as literally committed. |
| 002_create_content_tables | content_sources, content_chunks, chunk_embeddings, chunk_concept_mappings | **INVALID_AS_WRITTEN** | content_sources/content_chunks exist live in a different shape; chunk_embeddings/chunk_concept_mappings do not exist live at all | Explicitly admitted broken by migration 004's own comment. |
| 003_create_quiz_and_planning_tables | quiz_sessions, quiz_responses, study_plans, study_sessions, study_session_progress, exam_readiness_history | **INVALID_AS_WRITTEN** | quiz_sessions/study_plans/study_sessions exist live (via 004+later ALTERs); quiz_responses/study_session_progress/exam_readiness_history do not exist live | Same invalid-syntax defect, explicitly admitted by migration 004. |
| 004_fix_content_chunks_and_quiz_sessions | corrects 002/003's content_chunks and quiz_sessions | **HISTORICALLY_VALID** | matches live `content_chunks`/`quiz_sessions` base shape | Its own comment is the primary evidence for 002/003's failure. |
| 005_add_subject_language_settings | subjects.target_language, quiz_language_mode | **HISTORICALLY_VALID** | matches live `subjects` columns | |
| 006_add_quiz_session_language | quiz_sessions.language | **HISTORICALLY_VALID** | matches live | |
| 007_add_learning_debt_events | learning_debt_events | **HISTORICALLY_VALID** | table exists live (0 rows) | |
| 008_add_recurring_interval | assessment_schedule_rules.interval_days | **UNKNOWN** | table confirmed to exist live; full column diff not performed this phase | Not deep-diffed column-by-column — flagged, not assumed. |
| 009_spaced_repetition_and_errors | mastery_records.next_review_date; a second `errors` definition | **PARTIALLY_VALID** | `next_review_date` matches live exactly; the live `errors` table matches THIS migration's shape (not 001's) | Refined understanding this phase: since 001's `errors` almost certainly never executed (its own invalid syntax), 009's `CREATE TABLE IF NOT EXISTS errors` was not blocked by a pre-existing table and simply created it fresh — not a case of "IF NOT EXISTS silently skipping a competitor," but of 001 never having created anything to skip. |
| 010_expand_quiz_types | quiz_sessions.concept_id nullable, concept_ids[], quiz_mode | **HISTORICALLY_VALID** | matches live | |
| 011_parent_identity | profiles.clerk_id | **HISTORICALLY_VALID** | matches live | Its own comment is one of the clearest historical acknowledgments of the dual-identity design. |
| 012_parent_invitations | parent_student_relationships.status | **HISTORICALLY_VALID** | table exists live (0 rows) | Base `CREATE TABLE parent_student_relationships` itself is untracked (see §5) — this migration only ALTERs it. |
| 013_ai_tutor | tutor_conversations, tutor_messages | **HISTORICALLY_VALID** | matches live, including the `profiles` FK target | |
| 014_concept_explanations | concept_explanations | **HISTORICALLY_VALID** | matches live | |
| 015_ib_alignment | subjects.ib_programme/ib_subject_group/ib_level | **HISTORICALLY_VALID** | matches live | |
| 016_topic_hierarchy | topics, subtopics, concepts.subtopic_id | **HISTORICALLY_VALID** | matches live | |
| 017_hierarchy_localizations | topic_localizations, subtopic_localizations | **HISTORICALLY_VALID** | matches live | |
| 018_subject_mastery_snapshots | subject_mastery_snapshots | **HISTORICALLY_VALID** | matches live | |
| 019_subscriptions | subscriptions | **HISTORICALLY_VALID** | matches live | |
| 020_student_academic_profile | student_academic_profile | **HISTORICALLY_VALID** | table confirmed to exist live | |
| 021_learning_evidence_telemetry | ALTERs learning_evidence (subject_id, activity_type, learning_mode, hints_used, ai_assistance_type, confidence_before_answer, metadata) | **PARTIALLY_VALID** | every added column matches live `learning_evidence` exactly | The ALTER's effects are confirmed live, but the base `learning_evidence` table it extends has no `CREATE TABLE` anywhere in tracked history (see §5) — this migration's own comment ("Extends the existing learning_evidence table") presumes a base table whose origin is untracked. |
| 022_learning_evidence_score_percent | learning_evidence.score_percent | **PARTIALLY_VALID** | matches live | Same base-table caveat as 021. |
| 023_cognitive_learning_engine | concept_relationships, cognitive_diagnoses, remediation_paths/steps, misconception_signatures, student_misconceptions | **HISTORICALLY_VALID** | all confirmed to exist live | |
| 024_analytics_events | analytics_events | **HISTORICALLY_VALID** | matches live | |
| 025_knowledge_state | mastery_policies, concept_knowledge_state | **HISTORICALLY_VALID** | exact column match confirmed live | |
| 026_validation_cycles | validation_cycles, validation_events | **HISTORICALLY_VALID** | confirmed to exist live (3/8 rows) | No "RECOVERY NOTE" in this file, unlike 028/029/030 — presumed to have run normally, not part of the post-incident reconstruction. |
| 027_external_validation | assessment_concept_coverage, calibration_conflicts | **HISTORICALLY_VALID** | confirmed to exist live | |
| 028_phase3_preflight | backfill_runs, assessment_concept_coverage.source_granularity | **HISTORICALLY_VALID** | confirmed to exist live | Carries its own "RECOVERY NOTE" (applied before an "accidental local deletion," file reconstructed afterward, not re-executed) — the note itself is corroborated, not contradicted, by live evidence. |
| 029_evidence_mode | quiz_sessions.activity_type, evidence_mode | **HISTORICALLY_VALID** | confirmed to exist live | Same "RECOVERY NOTE" pattern as 028, also corroborated by live evidence. |
| 030_assessment_verification | verification_attempts | **HISTORICALLY_VALID (comment is the only thing wrong)** | live `verification_attempts` matches this migration's design byte-for-byte, including every CHECK constraint | **The single most important correction of this whole four-phase effort.** The file's own header claims "NOT EXECUTED... design only" — this is proven false by the live database, which contains the table, fully correctly shaped, with 2 real processed records. The migration's SQL was valid and was in fact applied; only its own comment is stale/wrong. Per the "IMPORTANT HISTORICAL MIGRATION RULE," this file was **not edited** — the correction is recorded here and in the baseline documentation instead, not by rewriting history in place. |

**Future relevance of all 30 files:** none of them are ever executed again. They remain in the repository purely as a historical record (including, in a few cases like 030, a record of what the team *believed* at a point in time, which has its own documentary value). All future schema work reads `database/baseline/` and `database/migrations/` instead.

---

## 5. Live-Only Objects Captured

Every object confirmed live but absent from `migrations/001-030`'s tracked history is present, accurately, in the new baseline (no object was left implicit):

`profiles`, `student_profiles`, `parent_student_relationships`, `learning_evidence`, `assessment_occurrences`, `assessment_results`, `subjects.student_id`, `subjects.status`, `user_language_preferences`, and (newly noted this phase, previously outside the Phase 0A/0B checklist but confirmed live and captured) `student_availability`, `study_session_items`.

---

## 6. Legacy Objects Excluded

Confirmed absent from the live database (Phase 0B) and **deliberately not included** in the baseline, despite being defined in `migrations/001-030`:

| Object | LEGACY_NOT_IN_BASELINE |
|---|---|
| `student_subjects` | yes |
| `quiz_responses` | yes |
| `error_patterns` | yes |
| `chunk_embeddings` | yes |
| `chunk_concept_mappings` | yes |
| `exam_readiness_history` | yes |
| `study_session_progress` | yes |

The reproducibility test (§14) explicitly asserts all seven remain absent after applying the baseline to a fresh database — a regression test against ever accidentally reintroducing them.

---

## 7. Critical Schema Contracts

Documented in full below (§8-§11) and encoded as permanent, static, credential-free tests in `tests/unit/schema-contract.test.ts` (26 tests, all passing).

---

## 8. Student Identity Schema Contract

```
students.id   uuid PRIMARY KEY  (gen_random_uuid())
profiles.id   uuid PRIMARY KEY  (caller-supplied, no default)
```
No foreign key exists between them in the live schema, and the baseline does not add one. For student-type users, both hold the exact same UUID by application convention only (`src/lib/auth.ts`, documented in Phase 0C). `subjects.student_id` is `uuid NOT NULL`, FK → `profiles.id`. This is the accurate, current architecture — not an aspiration, not a claimed FK that doesn't exist.

---

## 9. Mastery Schema Contract

```
mastery_records.mastery_score   numeric(5,2)   DEFAULT 0   NOT NULL
```
Semantic scale: **0-100** (not a 0-1 fraction), per this session's forensic mastery-contract audit and re-confirmed live this phase (`MIN=0.00, MAX=5.30`, values above 1 present, none above 100 or below 0). **No range CHECK constraint exists live**, and the baseline does not silently add one — that would be constraint hardening, a separate future migration decision explicitly out of scope here.

---

## 10. Learning Evidence Schema Contract

`learning_evidence` exists live with every column the application writes/reads (`student_id`, `concept_id`, `source_type`, `result`, `difficulty`, `timestamp`, `subject_id`, `activity_type`, `learning_mode`, `hints_used`, `ai_assistance_type`, `confidence_before_answer`, `score_percent`, `metadata`), captured accurately in the baseline despite having no tracked `CREATE TABLE` anywhere in `migrations/001-030`.

---

## 11. Verification Schema Contract

`verification_attempts` exists live, captured in full in the baseline: every column from migration 030's design, including `variant_equivalence_confidence numeric` with its `0-1` CHECK bound, `original_score_percent`/`assessment_confidence_before`/`assessment_confidence_after` with their `0-100` CHECK bounds, and the `outcome` enum CHECK (`CONFIRMED`/`CONTRADICTED`/`INCONCLUSIVE`).

---

## 12. Migration Ledger Design

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
- `version` — unique migration identifier (recommended: sortable UTC timestamp, e.g. `20260901_1200`), deliberately not reusing the legacy `001`-`030` numbering.
- `checksum` — sha256 of the migration file's exact content at apply time, enabling drift detection (an applied file that was edited afterward).
- `applied_at` — server-side `NOW()`, not client-supplied.
- Idempotent creation (`IF NOT EXISTS`); safe to run again.

Full design rationale in `database/ledger/0000_baseline_ledger.sql`'s own comments.

---

## 13. Migration Execution Process

No prior migration execution mechanism existed in the repository (`grep` for `node-pg-migrate`/`umzug`/`knex migrate`/similar in `package.json` and `src/`: none found).

New, minimal mechanism, `src/lib/migration-ledger.ts` (pure, tested logic) + two scripts:

- **`npm run db:status`** — read-only. Reports the ledger's contents, which files in `database/migrations/` are pending, and detects checksum drift.
- **`npm run db:migrate`** (add `-- --dry-run` to preview without applying) — applies pending migrations from `database/migrations/` one at a time, each in its own transaction (`BEGIN`/apply SQL/`INSERT INTO schema_migrations`/`COMMIT`, or `ROLLBACK` on any failure, stopping before later migrations to preserve order), then exits.

Neither script is referenced by `npm run build`, `npm run start`, `next.config.js`, or any CI/deploy configuration — both require an explicit, separate, human-issued command.

---

## 14. Reproducibility Test

`scripts/db-reproducibility-test.sh` (`npm run db:repro-test`). Spins up a fresh, ephemeral local PostgreSQL 14.21 instance (Unix-socket only, no TCP, no network exposure, in a `mktemp -d` scratch directory), applies the baseline, verifies, and tears down unconditionally — **never touches Neon or any production resource.**

**Exact result, this phase:**
```
BASELINE_APPLY = OK
TABLES_CREATED = 50 (expected 50, or 49 if pgvector unavailable locally: actual pgvector available = 0)

Step 12 minimum critical tables:
  students: EXISTS=t   profiles: EXISTS=t   subjects: EXISTS=t   concepts: EXISTS=t
  mastery_records: EXISTS=t   learning_evidence: EXISTS=t   errors: EXISTS=t
  quiz_sessions: EXISTS=t   concept_knowledge_state: EXISTS=t   verification_attempts: EXISTS=t

PK/FK/critical column contracts:
  students.id PK: 1        profiles.id PK: 1
  subjects.student_id -> profiles FK: 1
  concepts.subject_id -> subjects FK: 1
  mastery_records.mastery_score type: numeric(5,2)
  verification_attempts.variant_equivalence_confidence exists: t

Legacy/dead objects (all correctly absent):
  student_subjects=f  quiz_responses=f  error_patterns=f  chunk_embeddings=f
  chunk_concept_mappings=f  exam_readiness_history=f  study_session_progress=f

REPRODUCIBILITY_TEST = PASS
```
**Known, documented compatibility notes** (test-environment only, not baseline-file changes): the local toolchain lacks the `pgvector` extension, so the test substitutes a throwaway copy with the two vector-dependent statements commented out (the `content_chunks` table itself still gets created, just without the `chunk_embedding` column/index in this local run); the dump's `SET transaction_timeout = 0;` preamble line (a Postgres 17+-only setting, since the source is 18.6) is similarly neutralized only in the throwaway test copy, since the local toolchain is PG14. **The real baseline file was never modified for either reason** — both are pure local-test-environment accommodations, disclosed here rather than hidden.

---

## 15. Schema Contract Tests

`tests/unit/schema-contract.test.ts` — 26 tests, all passing, no database connection required (parses `database/baseline/STUDYUS_BASELINE_2026_08.sql` as text). Covers: baseline well-formedness; student identity (both PKs, absence of any cross-FK); subject ownership (`student_id`/`status` existence and FK target); concept identity; the mastery scale contract (type + absence of a range CHECK); every `learning_evidence` column the app depends on; verification persistence (table + `variant_equivalence_confidence` + its CHECK + the `outcome` enum CHECK); the `errors` table's confirmed live shape vs. the superseded one; and all seven legacy/dead tables' continued absence.

```
Test Files  1 passed (1)
     Tests  26 passed (26)
```

---

## 16. Database Governance Rules

Full text in `docs/architecture/database-governance.md` (10 numbered rules). Summary: tracked migrations required for every schema change; no manual production DDL without a corresponding file; immutability once applied; corrective migrations are new files, never edits; the baseline documents current reality, not aspiration; application code must not silently depend on undocumented objects; schema contract tests gate merges; new migrations are tested against an empty/ephemeral database first; production execution is always explicit; secrets never appear in logs/reports.

---

## 17. Production Changes

**Not NONE.** One narrowly-scoped, pre-authorized, purely additive change was made, per Step 10's explicit five conditions (all independently verified before proceeding: additive-only; zero effect on existing application behavior, since nothing in `src/` references `schema_migrations`; reviewed against the live schema, confirming no pre-existing table of that name; covered by tests; no historic migration replayed):

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations (version, name, checksum)
  VALUES ('STUDYUS_BASELINE_2026_08', 'Live schema baseline (pg_dump snapshot, Phase 0D)', '<sha256 of the baseline file>');
```
Applied in a single transaction. Verified immediately afterward, read-only:
- `TOTAL_TABLES_NOW = 51` (exactly 50 pre-existing application tables + 1 new ledger table).
- Row counts for `students` (6), `profiles` (9), `subjects` (5), `concepts` (7), `mastery_records` (7), `verification_attempts` (2) all re-checked **identical** to Phase 0B/0C readings, both immediately after the bootstrap and again at the end of this phase.
- `npm run db:status` correctly reads the new ledger: 1 applied, 0 pending, 0 drifted.

**No other production table, column, constraint, index, or row was created, altered, or deleted.** No historical migration (001-030) was executed.

---

## 18. Credential Safety Status

No `DATABASE_URL`, password, token, or connection string appears anywhere in this report, in any file created this phase, or in any tool-output line intentionally left in this transcript. All database access this phase went through the existing `.env.local` (git-ignored, unchanged) via scripts that read it internally and printed only derived, non-secret results (booleans, counts, table/column names, checksums).

`NEON_CREDENTIAL_ROTATION_STILL_REQUIRED` — the Phase 0B incident (a diagnostic command's regex bug printed the live `DATABASE_URL` including its password into a tool-output log) has not been confirmed rotated as of this phase. This phase did not attempt to rotate it (not authorized to).

---

## 19. Application Validation

```
TypeScript:  npx tsc --noEmit     → clean, exit 0
Tests:       npx vitest run       → 56 test files, 655 tests, all passed (655 = 620 baseline + 35 new: 26 schema-contract + 9 migration-ledger), ~1.0s
Build:       npm run build        → exit 0, clean route manifest, no errors
Lint:        LINT_NOT_CONFIGURED  → no ESLint config file, no `lint` script in package.json
```

---

## 20. Git Diff Summary

```
 package.json | 5 ++++-
 1 file changed, 4 insertions(+), 1 deletion(-)   (3 new npm scripts: db:status, db:migrate, db:repro-test)
```
New (untracked) files, 12 total:
```
database/README.md
database/baseline/STUDYUS_BASELINE_2026_08.sql
database/ledger/0000_baseline_ledger.sql
database/migrations/.gitkeep
docs/adr/0001-schema-baseline-strategy.md
docs/architecture/database-governance.md
scripts/db-migrate.ts
scripts/db-reproducibility-test.sh
scripts/db-status.ts
src/lib/migration-ledger.ts
tests/unit/migration-ledger.test.ts
tests/unit/schema-contract.test.ts
```
No file outside this list was modified by this phase. No quiz, mastery-algorithm, Learning Decision Engine, teaching-engine, or UI code was touched — confirmed by inspecting `git status --short` against every change made since this phase began.

---

## 21. Remaining Risks

1. The `students.id` ↔ `profiles.id` invariant is still enforced only by application convention, not a database constraint (unchanged from Phase 0C — explicitly out of scope for baselining, which captures reality rather than hardening it).
2. `mastery_records.mastery_score` still has no range CHECK constraint live — the baseline accurately reflects this rather than silently adding one, per Step 7's explicit instruction, but it remains a real gap for a future migration to decide on.
3. Migrations 008, 021, and 022 remain `UNKNOWN`/`PARTIALLY_VALID` rather than fully confirmed — no full column-by-column diff was performed for `assessment_schedule_rules`, and `learning_evidence`'s own base-table origin remains untracked even though its columns are confirmed correct.
4. The Neon credential exposed in Phase 0B has not been confirmed rotated (`NEON_CREDENTIAL_ROTATION_STILL_REQUIRED`).
5. `database/migrations/` is currently empty — the governance process is proven and ready, but has not yet been exercised end-to-end with a real, non-bootstrap migration.

---

## 22. Phase 0D Definition of Done

- [x] Current live schema has an authoritative baseline — `database/baseline/STUDYUS_BASELINE_2026_08.sql`, §3.
- [x] Baseline represents live reality, not broken historical migrations — confirmed via `pg_dump` direct capture, §3/§4.
- [x] Live-only objects are included — §5, all 11 confirmed present in the baseline.
- [x] Dead historical objects are excluded — §6, confirmed absent both in the baseline and via the reproducibility test.
- [x] Mastery contract is correct — §9, `numeric(5,2)`, no invented CHECK.
- [x] Identity contract is correct — §8, no invented FK.
- [x] Learning Evidence contract is correct — §10, every application column present.
- [x] Verification contract is correct — §11, byte-for-byte match to migration 030's design.
- [x] Migration governance process exists — §12/§13/§16.
- [x] Reproducibility was tested — §14, `REPRODUCIBILITY_TEST = PASS`.
- [x] Schema contract tests pass — §15, 26/26.
- [x] Existing application tests pass — §19, 620/620 baseline tests still passing.
- [x] Build passes — §19, exit 0.
- [x] No unintended production DB changes occurred — §17, exactly one pre-authorized additive change, fully documented, zero existing data touched.
- [x] No secrets appear in report/output — §18.

---

## 23. Final Decision

**A. Can a clean StudyUs database now be reconstructed from version-controlled artifacts?**
**YES.** Proven directly by the reproducibility test, §14.

**B. Does version control now accurately represent the current database contract?**
**YES**, for everything captured in `database/baseline/`. `migrations/001-030` still exists in version control but is now explicitly, documentedly non-authoritative rather than silently trusted.

**C. Is there a safe migration governance process?**
**YES.** Ledger + runner + immutability/drift detection + reproducibility testing + explicit-only execution, all implemented and verified this phase.

**D. Were historic migrations replayed against production?**
**NO.**

**E. Were any existing production application tables altered?**
**NO.** Only one new table was added; every pre-existing table, column, constraint, and row is unchanged (row counts re-verified identical, §17).

**F. Is Phase 0D ready to certify?**
**YES.**

**G. Maximum five remaining issues before Phase 0E** — see §21 in full; summarized: (1) no DB-level identity FK, (2) no mastery range constraint, (3) three migrations left `UNKNOWN`/`PARTIALLY_VALID` pending a deeper column diff, (4) Neon credential rotation still unconfirmed, (5) the new migration process is designed and proven but not yet exercised with a real non-bootstrap migration.

---

*End of report. No historical migration was executed. No existing production table or row was altered. The single production write performed (the migration ledger bootstrap) is fully documented in §17.*
