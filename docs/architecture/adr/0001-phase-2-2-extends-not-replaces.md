# ADR 0001: Phase 2.2 extends Phase 2 — it does not replace it

**Status:** Accepted
**Date:** 2026-08-23

## Context

Phase 2 (Cognitive Learning Engine) is now closed (see `docs/architecture/phase-2-cognitive-learning-engine.md`). The next planned body of work, Phase 2.2, introduces long-term retention/validation concepts — informally referenced as a "14-day Knowledge Validation" architecture, Time to Mastery, Knowledge Decay, and related ideas.

Every phase of this product so far (Phase 1 → Phase 2) has followed the same discipline: **extend the existing Learner Model, never build a second one.** Phase 2 itself is the proof this works — Cognitive Diagnosis, Remediation, Transfer, and Tutor Strategy all read and write through Phase 1's `learner-model.service.ts`, the Mastery Engine, and the Quiz Engine, rather than standing up parallel systems. Nothing about Phase 2.2's subject matter (validation over time, decay, retention) changes that discipline — if anything, it depends on it, since decay and retention are properties *of* the existing Learner Model's evidence history, not a new source of truth about what a student knows.

## Decision

**Phase 2.2 will extend Phase 2, never rebuild or duplicate it.**

Phase 2.2 must build on top of, and never fork or replace:

- Learner Model (`learner-model.service.ts`)
- Learning Evidence (`learning_evidence` table and its source-type/weight system)
- Mastery Engine (`mastery.service.ts`, `lib/algorithms/mastery.ts`)
- Quiz Engine (`generate-and-take` route and its quiz modes)
- Knowledge Graph (`concept-graph.service.ts`, `concept_relationships`)
- Cognitive Issue Detection (`detectCognitiveIssue`)
- Root Cause Engine (`computeRootCauseScore`, diagnosis state machine)
- Misconception Intelligence (`misconception.service.ts`)
- Transfer Evidence (`transfer.service.ts`, the `TRANSFER` evidence source type)
- Tutor Strategy (`tutor-strategy.service.ts`)
- NBA architecture (`nbaPriority` and the unified `TodayItem`/reason model)

Concretely, this means:

- Any new "is this concept still retained" or "time since last independent proof" logic is a new *read* over existing `learning_evidence`/`mastery_records` rows (or, at most, an additive column/table keyed off them) — not a second evidence ledger.
- Any new validation/decay state is a new *reason* added to the existing `TodayReason`/NBA v2 priority scale — not a parallel recommendation engine competing with NBA v2.
- Any new UI surface for validation reuses the existing quiz engine and activity pages where the underlying task fits (a check-in quiz, a retrieval prompt) before inventing a new activity type.
- Any new diagnostic reasoning about *why* retention dropped reuses Cognitive Issue Detection / Root Cause Engine rather than inventing a second "why" system.

**Phase 2.2 must never create a second, competing source of cognitive truth about a student.** If Phase 2.2's design ever needs a fact Phase 2 doesn't already track, the default move is to extend an existing table/service additively, not to start a parallel one.

## Consequences

- Phase 2.2's design work starts from an audit of what Phase 2 already exposes (this ADR + the architecture-freeze doc), not from a blank page.
- Migrations for Phase 2.2 are additive, same as Phase 2's (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`), never destructive to Phase 1/2 schema.
- If a Phase 2.2 design proposal would require duplicating Learner Model state, that proposal needs to be rejected or redesigned before implementation begins — not built and reconciled after the fact.
- This ADR does not itself define what Phase 2.2 *does* (its actual scope, the 14-day validation mechanics, decay formulas, etc.) — only the architectural boundary it must respect. Phase 2.2 implementation is explicitly out of scope for this ADR and has not been started.
