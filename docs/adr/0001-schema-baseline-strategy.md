# ADR 0001: Schema Baseline Strategy

**Status:** Accepted
**Date:** 2026-08-26 (Phase 0D)

## Context

Phase 0A (architecture audit) and Phase 0B (live-database forensics) established that the tracked `migrations/001-030` folder does not reliably reproduce the live StudyUs production database:

- Migration 004's own comment admits migrations 002/003 "never actually ran" (invalid MySQL-style inline `INDEX` syntax, invalid in Postgres). Migration 001 contains the identical syntax pattern and shows the same symptom.
- `errors` has two historically-conflicting `CREATE TABLE IF NOT EXISTS` definitions (001, 009) with different columns and different FK targets.
- Several live tables (`profiles`, `student_profiles`, `learning_evidence`, `assessment_occurrences`, `assessment_results`, `parent_student_relationships`) have no `CREATE TABLE` anywhere in the tracked history.
- Migration 030's header claims `verification_attempts` was "NOT EXECUTED... design only" — Phase 0D's live `pg_dump` proves the table exists, byte-for-byte matching the migration's design, with real data already in it.
- No migration ledger exists in the live database at all — there was never a way to know, from the database alone, which files had actually run.

We need a way for future schema work (Learning OS engines and beyond) to start from a known-accurate foundation, without either (a) continuing to trust a proven-unreliable history, or (b) destructively rewriting that history to pretend it was always accurate.

## Decision

**Option A: SQL baseline snapshot** — a version-controlled, `pg_dump --schema-only` capture of the live database at a point in time, checked in as the new source of truth, with the legacy `migrations/001-030` preserved untouched as historical artifacts.

We chose this over the alternatives:

- **B. Consolidated baseline migration** (a single new migration file, numbered to continue the `migrations/001-030` sequence, that `CREATE TABLE`s everything from scratch) — rejected because numbering it as e.g. `031_baseline.sql` implies it belongs to the same trustworthy sequence as 001-030, which is exactly the false impression we're trying to eliminate. It would also invite confusion about whether it's meant to be *executed* (it must never be, against a database that already has all these tables).
- **C. Schema dump + purely incremental migrations from here** — this is actually what we're doing, just combined with A rather than instead of it. A schema-only dump *is* the practical form this takes.
- **D. Hand-authored "ideal" schema** — rejected outright. A hand-written schema (fixing the mastery scale, adding the missing identity FK, deduplicating `errors`) would stop being an accurate *baseline* the moment it diverges from what's actually live, and Phase 0D's explicit mandate is to "capture reality," not redesign it. Any hardening (constraints, FKs, consolidation) is real future migration work, deliberately out of scope here.

A pure SQL dump satisfies every requirement: it reflects current live reality exactly (it *is* a copy of it); it makes no claim that `migrations/001-030` reconstructs it; a fresh Postgres instance can build a working schema from it (proven by `scripts/db-reproducibility-test.sh`); it gives future migrations a known, checksummed starting point (via the new `schema_migrations` ledger, bootstrapped to record this baseline as "applied"); and capturing it required zero writes to production.

## Consequences

- `migrations/001-030` remain in the repository, unmodified, explicitly marked historical/legacy (see the classification matrix in `docs/audits/STUDYUS_PHASE_0D_SCHEMA_BASELINE_GOVERNANCE.md`). They are not deleted — they retain real historical/forensic value (e.g. showing what the team believed was true at the time migration 030 was written) — but they are never executed again and are no longer treated as authoritative.
- New schema changes are governed migrations under `database/migrations/`, tracked in the `schema_migrations` ledger, applied only via `npm run db:migrate` (never automatically).
- The baseline will itself go stale over time as real migrations are applied on top of it. It is a snapshot of "now" (`STUDYUS_BASELINE_2026_08`), not a living document that updates itself — a future re-snapshot is a legitimate future action if the gap between baseline and reality grows large, but is not needed as long as every schema change from this point forward goes through a tracked, ledger-recorded migration.
- The baseline intentionally still contains every documented inconsistency (dual identity tables, no mastery range constraint, etc.) — fixing any of them is a deliberate, separate, future migration decision, not something this phase silently did while "just capturing a baseline."
