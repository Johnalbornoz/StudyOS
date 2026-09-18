# F5 — Target Learner State Architecture

## Design principle

Follow the exact pattern the assessment found already working for Mastery/Knowledge
State/Retention/Transfer: **pure algorithm module → transactional projector → read-only Twin-side
reader.** Never a competing authority. Canonical V2 is untouched; `updateMastery`'s existing
transaction gains two more projector calls (Skill, Competency), the same way it already gained
Retention (Phase 6) and Transfer (Phase 7) without becoming a second engine.

```
learning_evidence (unchanged; gains OPTIONAL metadata.skillIds/competencyIds/contextCode)
        │
        ├─ existing: mastery_records, concept_knowledge_state, concept_memory_state,
        │            concept_transfer_state  (ALL UNCHANGED, ALL REUSED AS-IS)
        │
        └─ NEW, F5:
             ├─ learner_skill_state        (student_id, skill_id)
             ├─ learner_competency_state   (student_id, competency_id)
             └─ learner_transfer_analytics (student_id, concept_id, canonical_concept_id?)
                        │
             each keyed to  aggregation_policy_versions (dimension, version, rules, status)
                        │
             audit trail:  decision_events (new decision_type values only — no schema change)
```

## Why Knowledge State needs no new table

`concept_knowledge_state` already satisfies AC-F5-01 (derives from observable Evidence),
INV-F5-15 (versioned via `mastery_policy_version`, live/dynamic), and is fully live/authoritative.
F5 adds nothing new to storage here — only a read-only **explainability wrapper**
(`explainKnowledgeState`, §16) that re-runs the same dimension classification the projector
already uses and reports which evidence rows were included/excluded and why, without persisting
anything new. This is intentional: reusing existing, working, already-versioned infrastructure
is safer than parallel-tracking it.

## Why Skill/Competency/Transfer-analytics need new, small tables

Skills and competencies are canonical-catalog-only concepts (F4) — there is no existing
per-student table shaped to hold state for them. Transfer analytics genuinely needs a new table
because it measures something none of the five existing transfer vocabularies measure: **context
diversity** (F4's `contexts` taxonomy, task §11), which today is completely unwired from real
evidence.

## The evidence-tagging problem, and how F5 solves it honestly

The assessment found **zero** historical evidence tagged with a skill, competency, or F4 context
code — no activity-generation path records this today. Per task §9/§18/§19, F5 must not
fabricate this from the F4 concept→skill graph. F5's answer: extend `learning_evidence.metadata`
(already the established pattern — response-time telemetry lives here too, per the Digital
Twin's own precedent) with three **optional** fields a caller may set at evidence-recording time:

```ts
metadata.skillIds?: string[];       // canonical skill ids this activity explicitly measured
metadata.competencyIds?: string[];  // canonical competency ids this activity explicitly measured
metadata.contextCode?: 'FAMILIAR' | 'ALTERED' | 'REAL_WORLD' | 'UNFAMILIAR' | 'CROSS_DOMAIN';
```

No column, no migration to `learning_evidence` itself. `updateMastery`'s telemetry parameter
gains three new optional fields threaded straight into this metadata, mirroring exactly how
`hintsUsed`/`aiAssistanceType` already flow through. **No existing caller is modified to start
setting these** — that would mean redesigning quiz/transfer generation's AI prompts and content
selection, which is out of F5's scope (a data-architecture and aggregation-capability phase, not
a content-generation phase) and risks exactly the "second engine" and UX-redesign scope creep the
task explicitly forbids. F5 proves the full pipeline end-to-end (real Postgres certification) by
having a caller explicitly pass these fields — the same contract a future content-generation
change could adopt — without touching any current generation service.

**Consequence, stated plainly and expected**: immediately after this phase ships, Skill State and
Competency State will read `NO_EVIDENCE` for essentially every real learner, because no production
code populates the new metadata fields yet. This is the correct, honest outcome (task's own
"establish aggregation capability, not claim universal scientific thresholds"), not a defect.

## State vocabulary (conservative, explicit — task §6/§14)

Both `learner_skill_state.state` and `learner_competency_state.state` use the same four-value,
deliberately coarse vocabulary — no invented percentage, no fabricated precision:

| State | Meaning |
|---|---|
| `NO_EVIDENCE` | Zero qualifying evidence rows ever recorded for this (student, skill/competency) pair. |
| `INSUFFICIENT_EVIDENCE` | At least one qualifying row exists, but below the minimum-count gate (reuses the existing `minimumEvidenceCount` convention already established by `mastery_policies`/Help Dependency — never a newly-invented threshold). |
| `EMERGING` | Meets the minimum count, but not all recent qualifying evidence is independent, or evidence is too sparse/inconsistent to call it stable. |
| `CONSISTENT_INDEPENDENT` | Meets the minimum count AND the most recent qualifying evidence is consistently independent and correct. |

"Qualifying evidence" for Skill State = a `learning_evidence` row whose `metadata.skillIds`
contains that skill's id. For Competency State = a row whose `metadata.competencyIds` contains
that competency's id — **never** inferred by joining through `skill_competencies`/
`canonical_concept_competencies` from skill evidence (INV-F5-10/AC-F5-04: a competency must be
measured directly by its own explicitly-tagged evidence, never synthesized from underlying skill
performance without a validated policy, which does not exist).

## Transfer analytics vocabulary

`learner_transfer_analytics` is explicitly and separately named from all five existing transfer
vocabularies (see assessment §5) — it measures **context diversity**, nothing else:
`context_familiar_count`, `context_altered_count`, `context_real_world_count`,
`context_unfamiliar_count`, `context_cross_domain_count`, `distinct_context_count`. It never
computes a "transfer depth," never feeds Canonical V2, and never touches `concept_transfer_state`.

## Canonical concept association (task §23, INV-F5-17)

Skills and competencies are inherently canonical-only, so `learner_skill_state`/
`learner_competency_state` need no personal/canonical distinction. `learner_transfer_analytics`
is keyed at the **learner concept** level (`concept_id`, matching every other evidence-adjacent
table), with an optional `canonical_concept_id` populated **only** when
`concept_catalog_mapping.status = 'MATCHED'` at computation time — never guessed for AMBIGUOUS/
UNRESOLVED (AC-F5-17/18). Learner-specific state always computes regardless of mapping status.

## Cross-learner isolation (task §24)

Every new table is keyed by `(student_id, skill_id|competency_id|concept_id)` with a UNIQUE
constraint — structurally identical to `concept_knowledge_state`'s own isolation guarantee.
Two learners mapped to the same canonical concept/skill/competency get two independent rows,
proven in the adversarial certification the same way F4 proved it for catalog mappings.

## Aggregation policy versioning (task §15, INV-F5-15/16)

`aggregation_policy_versions` (dimension, version, rules jsonb, status). Every
`learner_skill_state`/`learner_competency_state`/`learner_transfer_analytics` row stores the
`policy_version_id` that computed it. A future rule change creates a new version row (status
`ACTIVE`) and retires the old one (`RETIRED`) — never edits a version's `rules` in place, mirroring
the migration-ledger's own immutability convention. Recomputing under an old, retired version id
is still possible (replay uses the stored id, not "whatever is currently ACTIVE") — this is what
makes a historical snapshot reproducible (INV-F5-16).

## Audit trail — reusing `decision_events`, not a new snapshots table

`decision_events.decision_type` is unconstrained free text (no CHECK, confirmed in schema). F5
adds three new values (`SKILL_STATE_PROJECTED`, `COMPETENCY_STATE_PROJECTED`,
`TRANSFER_ANALYTICS_PROJECTED`) with `previous_state`/`new_state` populated exactly like
`KNOWLEDGE_STATE_PROJECTED` already does — zero schema change, reusing certified infrastructure
instead of inventing `learner_state_snapshots` (task §21 explicitly warns against creating every
possible table automatically).

## Explainability contract (task §16)

One read function per dimension (`explainSkillState`, `explainCompetencyState`,
`explainTransferAnalytics`, `explainKnowledgeState`), each returning: the current state, the
exact qualifying evidence rows that were included, a description of why any evidence was
excluded (e.g. "assisted, not independent" / "no matching skill tag"), the policy version used,
and what remains insufficient. These are pure re-derivations of the same query the projector
uses — never a separately-maintained explanation store.

## Replay (task §25, AC-F5-13)

Mirrors `knowledge-state-backfill.service.ts`'s exact shape: a pure function
(`computeSkillState(evidence[], policy)`) with zero IO, and a thin service wrapper that fetches
evidence + the stored policy version and calls it. Given the same evidence set and policy
version, the pure function always returns the same result — proven in the real-Postgres
certification by recomputing twice and asserting byte-identical output.

## Failure handling (task §26)

Each new projector runs inside `updateMastery`'s existing transaction, in the same place
Retention/Transfer already run, but every call is wrapped in its own try/catch so an exception
inside Skill/Competency/Transfer-analytics projection is logged and swallowed **locally** —
it never propagates up to abort the surrounding transaction, so the evidence write, mastery
update, and Knowledge State recalculation always succeed regardless of a new-dimension
projection failure. A failed projection leaves the prior state row untouched (or absent), never
partially written. Canonical V2 never sees any of this — it does not read these tables at all
(assessment §9), so a projection failure has zero pedagogical consequence by construction, not
merely by convention.
