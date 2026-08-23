# Phase 2 — Cognitive Learning Engine (Architecture Freeze)

**Status:** Frozen — Phase 2 CLOSED
**Scope:** Extends Phase 1's Learner Model into cognitive intelligence. Does not replace, duplicate, or fork any Phase 1 system.

This document is the closed, stable record of what Phase 2 built. It exists so that Phase 2.2 (and anything after it) can extend this architecture instead of rebuilding parts of it.

## 1. The pipeline

Phase 2 adds one linear pipeline on top of Phase 1's existing Learner Model / Learning Evidence foundation:

```
Learner Model
    ↓
Learning Evidence
    ↓
Cognitive Issue Detection      (detectCognitiveIssue)
    ↓
Knowledge Graph                (concept_relationships, getPrerequisites)
    ↓
Root Cause Engine              (generateRootCauseHypotheses, computeRootCauseScore)
    ↓
Diagnostic Check               (diagnostic_check quiz mode, evaluateDiagnosticCheck)
    ↓
Misconception Intelligence     (misconception_signatures, classifyMisconception)
    ↓
Remediation                    (remediation_paths/steps, determineRemediationPattern)
    ↓
Explain & Defend                (generateExplainPrompt, evaluateExplanation)
    ↓
Transfer                       (generateTransferActivity, computeTransferScore)
    ↓
Tutor Strategy                 (selectTutorStrategy)
    ↓
NBA v2                         (nbaPriority)
```

Every box above either reuses a Phase 1 system directly or reads/writes into it as evidence. None of them created a second Learner Model, a second Mastery Engine, or a second Learning Evidence table.

## 2. What each stage actually is

| Stage | Service | Determinism |
|---|---|---|
| Cognitive Issue Detection | `cognitive-diagnosis.service.ts` → `detectCognitiveIssue` | Deterministic gate over recent error recurrence + Phase 1 learner state. |
| Knowledge Graph | `concept-graph.service.ts` | Edges (`PREREQUISITE_OF`, `DEPENDS_ON`, `RELATED_TO`, `EXTENSION_OF`, `APPLIES_TO`, `COMMONLY_CONFUSED_WITH`) seeded on demand per concept via LLM inference, never a curriculum-wide batch job (see §5). |
| Root Cause Engine | `cognitive-diagnosis.service.ts` → `computeRootCauseScore` | Deterministic, multiplicative: `dependencyStrength × learnerGap × errorRelevance × recurrenceFactor × evidenceConfidence × academicRelevance`. Any weak factor collapses the score — never averaged. |
| Diagnostic Check | Existing quiz engine, new `diagnostic_check` mode | Deterministic thresholds: ≤34% correct → CONFIRMED, ≥90% → REJECTED, else INCONCLUSIVE (stays open for re-check). |
| Misconception Intelligence | `misconception.service.ts` | Signatures are reusable and deduplicated per concept; LLM only classifies which existing (or new) signature an answer matches — recurrence counting itself is deterministic SQL. |
| Remediation | `remediation.service.ts` | Pattern selection (`determineRemediationPattern`) is a deterministic priority order over the *candidate* concept's own Phase 1 learner state. Steps reuse existing quiz modes (`LEARN`/`GUIDED_PRACTICE`→topic_practice, `RETRIEVAL`→quick_check, `SOLO_VERIFY`→cumulative_assessment) plus two new lightweight activities (`EXPLAIN`, `TRANSFER`). |
| Explain & Defend | `explain-defend.service.ts` | LLM generates the question and grades against a fixed 0–4 rubric (`conceptAccuracy`/`reasoning`/`completeness`) — never a free "understood/not" verdict. |
| Transfer | `transfer.service.ts` | Deterministic score: distance-weighted (NEAR/MID/FAR) × assistance-discounted, averaged over the last 10 attempts. `null` with no evidence — never a fabricated 0. |
| Tutor Strategy | `tutor-strategy.service.ts` | 9 strategies, selected by a fixed priority function over learner state (recurring misconception wins outright, then overconfident→SOCRATIC, low mastery→SCAFFOLD, etc). |
| NBA v2 | `today-plan.service.ts` → `nbaPriority` | Pure function, single priority scale across all 9 reasons (see table below). |

### NBA v2 priority scale (as closed)

| Reason | Score |
|---|---|
| Imminent exam (≤2 days) | 2100 |
| Active remediation | 2000 |
| Prerequisite gap (confirmed) | 1000 + Learning Unlock Value |
| Exam soon (>2 days) | 1000 − days×10 |
| Learning debt | 500 + severity×10 |
| Diagnosis required | 350 |
| Recurring misconception | 300 + occurrences×10 |
| Forgetting risk | 200 + risk |
| Independence gap | 150 + (100 − unassisted accuracy) |
| Low mastery | 100 + (threshold − mastery) |

An imminent exam is the one thing that outranks an active remediation — this was a real bug at closure time (both scored so that active remediation always won) and is now fixed and unit-tested (`tests/unit/nba-priority.test.ts`).

## 3. Remediation lifecycle (as closed)

States: `DETECTED → DIAGNOSING → CONFIRMED → REPAIRING → VERIFYING → RESOLVED` (or `REJECTED` at the diagnosis stage, before a path ever starts).

**Abandonment is an intentional Phase 2 semantic, not a bug:** a path left in `REPAIRING`/`VERIFYING` with no further activity stays there indefinitely. There is no time-based expiry, auto-resolution, or decay in Phase 2 — that is explicitly Phase 2.2's Knowledge Validation territory (§4). What Phase 2 *does* guarantee about this case, tested directly:

- `startRemediation` is idempotent per diagnosis — an already-open path (including an abandoned one) is returned as-is; a second call never creates a duplicate `remediation_paths` row.
- A new path can only be created once the diagnosis's previous path reached a terminal state (`RESOLVED`/`REJECTED`).
- `getActiveRemediations` has no time-based cutoff — an abandoned path never silently drops off Today/Improve.
- NBA v2's `active_remediation` priority (2000) has no time term — it does not decay or change based on how long the repair has been open.
- Once a remediation path resolves, its `cognitive_diagnoses` row is excluded from `getActiveDiagnoses` (a real bug, fixed at closure — it previously stayed visible forever, so a fully-repaired concept would reappear as a fresh "foundational gap").

## 4. Explicit non-goals of Phase 2

The following are **not** Phase 2 responsibilities. They belong to Phase 2.2 (see the ADR, `docs/architecture/adr/0001-phase-2-2-extends-not-replaces.md`):

- Long-term retention scheduling
- Knowledge Validation Cycle
- 7-day validation
- 14-day validation
- KVR-14
- Time to Mastery
- Knowledge Decay lifecycle
- Validation deadlines
- Retained mastery
- External assessment calibration lifecycle

## 5. Deferred performance optimization (not incomplete work)

The Knowledge Graph is seeded **on demand**, per concept, the first time `generateRootCauseHypotheses` needs prerequisites for a concept that has none yet (one LLM call, deduplicated and persisted with `source='AI_INFERRED'`). There is no curriculum-wide batch seed job.

This is a deliberate Phase 2 choice, not a gap: it keeps AI cost proportional to actual diagnostic usage instead of paying for edges nobody ever needs. The tradeoff is that the very first diagnosis on any given concept pays a one-time inference latency cost. **This is filed as a deferred performance optimization, to revisit only if that first-diagnosis latency becomes a real, reported problem** — not as unfinished Phase 2 scope.

## 6. UI surfaces

- **Today**: 4 new reason types (`active_remediation`, `prerequisite_gap`, `diagnosis_required`, `recurring_misconception`), each with a real mastery value (never a hardcoded 0) and its own badge/detail-line rendering.
- **Improve v2**: three new sections — Foundational gaps (with "Affects: X, Y" and a "Fix this foundation" action), Active repairs (with a "Continue" action into the correct step), Recurring misconceptions.
- **Progress v2 (Concept Detail)**: a Transfer metric card alongside the Phase 1 dimensions.
- **Explain & Transfer**: two new lightweight activity pages (`/dashboard/cognitive/explain`, `/dashboard/cognitive/transfer`), not new nav items — reached only from a remediation step or the Tutor.
- No surface exposes internal architecture names ("Knowledge Graph", "Root Cause Engine", "diagnosis") — user-facing copy stays in plain language ("Foundational gaps", "Fix this foundation", "let's check this first").
- Navigation is unchanged: Today / Subjects / Improve / Progress / Plan / AI Tutor.

## 7. Product Analytics

A minimal internal `analytics_events` table (student_id, event_name, properties, created_at) — not tied to any specific external provider. 13 named events fire at their natural call sites: `cognitive_issue_detected`, `diagnostic_check_started`/`completed`, `root_cause_confirmed`/`rejected`, `remediation_started`/`step_completed`/`completed`, `solo_verification_completed`, `misconception_detected`, `explain_defend_started`/`completed`, `transfer_started`/`completed`. Where these events eventually ship (a warehouse, a vendor) is a separate, later decision.

## 8. Verification

- 134 unit tests (Vitest), all pure/deterministic logic covered directly.
- A permanent, re-runnable end-to-end scenario against the real database: `npm run test:e2e` (`scripts/e2e-cognitive-loop.ts`) — the full confirm flow plus the mandatory rejection variant, 39 assertions, self-verifying zero scratch-data residue on every run.
- `tsc --noEmit`, `next build` clean.
