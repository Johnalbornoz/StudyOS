# F5 — Replay & Explainability Report

## Replay (task §25, AC-F5-13)

`computeDimensionState` (`src/lib/learner-state/algorithms/state-classification.ts`) is a pure,
zero-IO function: same evidence array + same policy rules → same result, every time. Proven two
ways:

1. **Unit-level determinism test** (`f5-state-classification.test.ts`): calling the function
   twice with an identical evidence array asserts byte-identical output, and a separate test
   asserts the input array is never mutated.
2. **Real-Postgres replay surface**: `POST /api/admin/learner-state/replay` recomputes a Skill/
   Competency/Transfer-analytics state from scratch (re-reading all qualifying evidence, calling
   the same pure classifier, re-upserting) and returns both the pre- and post-recompute value —
   a caller can verify recomputation reproduces the same state given unchanged evidence and an
   unchanged policy version.

Given the same evidence set and the same `policy_version_id`, recomputation is guaranteed
identical because: (a) the classifier is pure, (b) the SQL query that selects "qualifying
evidence" is deterministic (exact `metadata` containment match, ordered by timestamp), and
(c) the policy row referenced by `policy_version_id` is immutable once created (§ aggregation
policy versioning — a new rule set is always a new row, never an edit).

## Explainability (task §16)

Four explanation functions, one per dimension, each a **read-only re-derivation** of the exact
query/classification the projector itself uses — never a separately-maintained explanation
store that could drift from what actually produced the state:

| Function | Reports |
|---|---|
| `explainSkillState` | Current state, every qualifying evidence row (id, timestamp, difficulty), and — for each — whether it was inside the "most recent N" consistency window, whether it was independent, whether it was correct, and the resulting inclusion/exclusion reason. Reports `insufficientBecause` when below the minimum count. |
| `explainCompetencyState` | Identical shape, scoped to `metadata.competencyIds` evidence only. |
| `getTransferAnalytics` | No separate explain function was built for this dimension — its counters (`contextFamiliarCount`, etc.) are inherently self-explanatory, a tally rather than a threshold decision, so the state itself already answers "why": each count is exactly the number of qualifying evidence rows tagged with that context code, nothing more to derive. |
| `explainKnowledgeState` | A read-only wrapper around the **existing, unchanged** `concept_knowledge_state` authority — re-derives Understanding/Independence/Application inclusion using the exact same classification functions (`classifyUnderstanding`/`classifyIndependence`/`classifyApplication`) the live projector calls, so this can never report a different answer than what's actually stored. Retention/Transfer dimensions are reported verbatim from the stored row (their own authorities — Phase 6/Phase 7 — are unchanged). |

Verified live in the real-Postgres certification: `explainSkillState` for the mixed-difficulty
fixture (task 28-F) correctly reported all three difficulty values (2, 3, 4) actually submitted,
proving difficulty is preserved end-to-end from evidence write through to explanation, not lost
or averaged away silently.

## What is NOT explainable by design

Canonical V2's own PRACTICE/PROVE/RETAIN/TRANSFER progression decisions remain exclusively
explained by Canonical V2's own `stateReason`/`decision_events` machinery — F5 introduces no
competing explanation for those decisions (see `F5_CANONICAL_V2_BOUNDARY.md`).
