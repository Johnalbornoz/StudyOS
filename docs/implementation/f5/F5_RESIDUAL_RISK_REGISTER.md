# F5 — Residual Risk Register

| ID | Risk | Severity | Status | Notes |
|---|---|---|---|---|
| RR-F5-01 | No production caller populates `metadata.skillIds`/`competencyIds`/`contextCode` yet | High (by design, disclosed) | Expected outcome of this phase | Skill State, Competency State, and Transfer analytics will read `NO_EVIDENCE`/empty for essentially every real learner immediately after this phase ships, because no quiz/transfer-generation prompt has been changed to tag evidence with these fields. Wiring that is explicitly out of F5's data-architecture scope (it would mean redesigning AI content-generation prompts) — see the target architecture doc. A future phase should decide which generation paths start tagging evidence, informed by the F4 skill/competency taxonomy already in place. |
| RR-F5-02 | Four non-reconciled "independence" predicates and five non-reconciled transfer vocabularies already existed before F5, and F5 adds its own (aligned, but still separate) definitions rather than unifying them | Medium | Pre-existing, not deepened irresponsibly | F5 deliberately reuses the same `ai_assistance_type==='NONE'` predicate Knowledge State's own Independence dimension already uses (documented explicitly, not a silent sixth divergent definition), and Transfer analytics is explicitly named and scoped apart from all five existing transfer vocabularies. Full reconciliation of these pre-existing definitions remains out of scope for any single phase seen so far. |
| RR-F5-03 | `concept_knowledge_state.projection_version` remains a vestigial, hardcoded-to-1 column (a pre-existing fact, not introduced by F5) | Low | Disclosed, not fixed | F5 did not touch Knowledge State's own versioning; noted here only because F5's own `aggregation_policy_versions` table demonstrates what a genuinely live version dial looks like, in case a future phase wants to apply the same pattern retroactively to Knowledge State. |
| RR-F5-04 | Remote (Preview database) migration application is deferred | Medium | Deferred, matches F1-F4's own precedent | See Preview certification doc — no proven Preview/Production database isolation exists from this environment. Schema-level certification instead ran against real, ephemeral, local-only PostgreSQL. |
| RR-F5-05 | No index exists on `learning_evidence.metadata` for the new `skillIds`/`competencyIds`/`contextCode` containment queries | Low | Accepted for this phase | `learning_evidence` is an existing, presumably large, heavily-used production table; adding a new index to it is a real operational decision (lock/build-time implications) beyond this phase's purely additive-schema commitment. Acceptable at F5's certification scale; worth revisiting once real tagged evidence volume exists. |
| RR-F5-06 | `learner_transfer_analytics.canonical_concept_id` is only refreshed when `projectTransferAnalytics` runs again | Low | Accepted, documented | If a concept's F4 mapping status changes (e.g. AMBIGUOUS -> MATCHED via manual review) after the last Transfer-analytics projection, the stale `NULL` persists until the next context-tagged evidence event re-triggers the projector. This is consistent with the full-replay pattern already used by Retention/Transfer (they also don't proactively re-run on unrelated state changes) and never produces an incorrect non-null value, only a possibly-stale null. |

## Explicitly NOT a risk (verified, not assumed)

- Historical Evidence loss/duplication — verified with real-row-count assertions.
- Fabricated Skill/Competency evidence from the F4 taxonomy graph — verified negative against
  real Postgres with a real graph edge present.
- Cross-learner state contamination — verified negative against real Postgres with two real
  learners sharing a canonical concept.
- A new-dimension projection failure aborting the evidence-write transaction — verified negative
  by forcing a real failure and confirming COMMIT still ran.
- Canonical V2 interference — verified structurally absent, and its full 806-test suite passes
  unmodified.

## Recommendation

None of the above blocks proceeding to F6. RR-F5-01 (no real tagging yet) is the most visible
consequence of this phase and should be explicitly communicated: F5 built the aggregation
capability the task asked for, not a claim that real skill/competency measurement exists in
production today.
