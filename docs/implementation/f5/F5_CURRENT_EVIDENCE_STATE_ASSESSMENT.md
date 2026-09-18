# F5 — Current Evidence & Learner State Assessment

Branch: `f5/evidence-learner-state-2`, baseline `f4/learning-architecture-2` @
`9b7521caf2fe8ea65b4ac70eaabe06e2da3d6d96`

Written before any F5 source change, per task §3. Based on direct inspection of the schema and a
full-repo code trace of every Evidence writer/reader, the Canonical V2 evidence-qualification
boundary, and every derived-state projector.

## 1. CURRENT Evidence authority

There is exactly **one** `INSERT INTO learning_evidence` in the entire codebase:
`updateMastery()` in `src/services/mastery.service.ts:394-419`. Six callers all funnel through
it — a single choke point, not N independent writers:

| Caller | `learningMode` | `hintsUsed` | `aiAssistanceType` |
|---|---|---|---|
| `api/cognitive/explain/submit` | hardcoded `'COACH'` | not set | not set |
| `api/cognitive/transfer/submit` | hardcoded `'SOLO'` | not set | not set |
| `api/learning/record-evidence` | **no telemetry object at all** | — | — |
| `api/quizzes/generate-and-take` | derived from `evidenceMode` | real count | not set |
| `assessment-verification.service.ts` | hardcoded `'SOLO'` | not set | not set |
| `exam-result.service.ts` | **no telemetry object at all** | — | — |

`ai_assistance_type` is *computed inside* `updateMastery` itself
(`telemetry?.aiAssistanceType ?? (hintsUsed ? (hintsUsed > 1 ? 'MULTIPLE_HINTS' : 'HINT') : 'NONE')`)
— reliably non-null, but only 3 of the type's 7 values (`NONE`, `HINT`, `MULTIPLE_HINTS`) are ever
actually produced; `TUTOR_GUIDANCE`/`TUTOR_EXPLANATION`/`WORKED_EXAMPLE`/`OTHER` are dead enum
members. `learning_mode` is left `NULL` by 2 of 6 writers. `AI_NATIVE` is never produced anywhere
(one route has an explicit comment: "AI_NATIVE has no quiz mode mapped to it yet").

**Implication for F5 (INV-F5-12/13)**: the independence/assistance signal is structurally
reliable (never silently absent for `ai_assistance_type`) but behaviorally thin — most writers
hardcode a mode rather than deriving it from what actually happened. F5 must not assume dense,
finely-differentiated assistance data; a binary independent/assisted signal is what the data
actually supports today.

**Four non-reconciled "independence" predicates already exist**, each answering a slightly
different question:
1. `pedagogical-shadow/evidence-adapter.ts`: `ai_assistance_type==='NONE' && hints_used===0` (stage progression)
2. `knowledge-state.service.ts`: `ai_assistance_type==='NONE'` only, ignores `hints_used` (Knowledge State's Independence dimension)
3. `memory-policy.ts`: adds `hasValidOperationKey` + a whitelisted `activityType`, reading `activityType` from `metadata`, not the column (Retention qualification)
4. `misconception.service.ts`: `ai_assistance_type !== 'NONE'` excluded, scoped to `EXPLANATION`/`SOLO_VERIFICATION` only (misconception-resolution eligibility)

F5 must not introduce a fifth, further-diverging definition — it should reuse the same ground
predicate (`ai_assistance_type`/`hints_used`) as its evidence for Skill/Competency independence,
documented explicitly as its own (5th, but consciously aligned) interpretation.

## 2. Canonical V2's evidence qualification boundary

`src/lib/pedagogical-engine/evidence-qualification.ts::qualifyEvidence` is the **sole** function
converting one evidence row into `QUALIFIES | DOES_NOT_QUALIFY | UNRESOLVED` for
LEARN→PRACTICE→PROVE→RETAIN→TRANSFER stage progression, with per-stage item-count/difficulty/
independence/novelty/reasoning rules from `pedagogical-engine/policy.ts`. It also hard-vetoes on
`hasCriticalMisconception` before any other check.

**This cannot be reused directly for F5's Knowledge/Skill/Competency dimensions.**
`qualifyEvidence` answers "does this one attempt satisfy the next stage-progression
requirement" — an inherently per-attempt, sequential, stage-shaped question (bakes in exact
item counts, prerequisite-satisfaction, stage ordering). F5's dimensions ask "across ALL
historical qualifying evidence, what does this aggregate look like" — a different shape
entirely. F5 must reuse the underlying **independence predicate** as ground truth, but must not
route its own aggregation through `qualifyEvidence` or duplicate its stage logic.

The critical-misconception veto pattern, however, **should** be respected by F5's own qualifying
logic — both `evidence-qualification.ts` and `knowledge-state.service.ts` treat an active
critical misconception as an override that outranks a raw score, and F5 should stay consistent
with that precedent rather than let a Skill/Competency verdict ignore it.

## 3. CURRENT mastery calculation

`mastery_records`/`mastery_events` are **fully live and authoritative, not legacy** — written
inside `updateMastery`'s single transaction: evidence insert → mastery_records upsert →
mastery_events audit row → conditional learning_debt → misconception resolution → Retention
projector → Transfer projector (TRANSFER source only) → `concept_knowledge_state` recalculation,
all before commit. The only other writer, `concept-extraction.service.ts`, creates a structural
zero-row stub at concept creation, never a real update.

Formula (`src/lib/algorithms/mastery.ts::calculateMasteryDelta`): signed base impact from score ×
per-source-type weight (0.1–1.0) × a diminishing-returns sample-size factor × a difficulty
modifier × a smoothing/confidence weight, capped. Read live by
`dashboard/subjects/[id]/page.tsx` and by the Digital Learning Twin's `readMasteryRow`.

## 4. CURRENT Knowledge State authority

`src/services/knowledge-state.service.ts::recalculateConceptKnowledgeState` is the sole writer of
`concept_knowledge_state`. Five dimensions, each independently thresholded (non-compensating —
no averaging across dimensions):

- **Understanding**: average of `EXPLANATION`-sourced evidence with a general-quiz-source fallback.
- **Independence**: average of `ai_assistance_type==='NONE'` evidence (predicate #2 above).
- **Application**: average of `CUMULATIVE_ASSESSMENT`/`EXAM_SIMULATION`/`TOPIC_ASSESSMENT` evidence — an explicitly-documented proxy, not a purpose-built tag.
- **Retention**: direct passthrough from `concept_memory_state.demonstrated_retention_score` — "no transformation, no second weighting, no fallback."
- **Transfer**: from `transfer.service.ts::getTransferScore`, which reads raw `learning_evidence` metadata directly — **not** from `concept_transfer_state` (see §5 below, an existing unresolved seam).

`ValidationReadiness` follows a priority chain (misconception → evidence sufficiency → retention
→ transfer); AT_RISK/INTERVENTION_REQUIRED and validation-cycle lifecycle are delegated to
`validation-cycle.service.ts`. `projection_version` is hardcoded to `1` in every INSERT — a
vestigial column, never actually incremented. `mastery_policy_version` **is** live/dynamic.

**Reusable replay/backfill precedent**: `knowledge-state-backfill.service.ts` is a resumable,
cursor-based, idempotent reprojection service that calls the exact same production projector (or
a pure dry-run preview using the same exported classification functions) and records progress in
`backfill_runs`. This is the strongest existing pattern for F5's own replay/determinism
requirement (§25, AC-F5-13) — F5 should imitate this shape, not invent a new one.

## 5. CURRENT Transfer State

`concept_transfer_state` is written by `transfer-projector.service.ts::projectConceptTransferState`,
called from `updateMastery` only for `sourceType==='TRANSFER'` evidence, using a **full-replay**
pattern (re-derives the entire TRANSFER evidence history every call, writes only on structural
change — "a semantic no-op ... writes nothing" otherwise). Documented explicitly as an "advisory
mirror" — Knowledge State's own `transfer` dimension does **not** consult it.

**At least five non-reconciled transfer vocabularies coexist today**:
1. Evidence-level `TransferDistance` (`NEAR|MID|FAR`), per attempt, in `learning_evidence.metadata`.
2. Pedagogical-engine per-challenge `TransferChallengeDepth` (`NEAR|CONTEXTUAL|HIGHER`) — 3 challenges within one TRANSFER activity, used only by stage-progression qualification.
3. Phase 7 longitudinal `TransferDepth` (`NONE|NEAR_DEMONSTRATED|GENERALIZED|ROBUST`) — the `concept_transfer_state.transfer_depth` column.
4. Generator novelty dimensions (`CONTEXT|SURFACE|REPRESENTATION|STRATEGY|CONCEPT_COMBINATION|GOAL_FRAMING|DATA_PRESENTATION|CONSTRAINT`) — self-reported by the AI generator, server-certified.
5. F4's catalog `contexts` taxonomy (`FAMILIAR|ALTERED|REAL_WORLD|UNFAMILIAR|CROSS_DOMAIN`) — confirmed via full-repo grep to be **completely disconnected** from real transfer evidence; no evidence table or generation service references it.

**F5 must not attempt to reconcile these five into one** — that is a pre-existing, standing
architectural fact, out of this phase's named scope (task explicitly says "do not replace the
current Canonical V2 Transfer logic"). F5's Transfer analytical state must be clearly, separately
named from all five, must not silently conflate with any of them, and is the first thing to
actually wire F4's `contexts` taxonomy to real evidence (task §11) — additively, read-side only.

## 6. CURRENT Retention State

`concept_memory_state`, written by `memory-projector.service.ts::projectConceptMemoryState`
(same full-replay-then-compare pattern as Transfer), using its own qualification module
(`memory-policy.ts`, predicate #3 above) distinct from `evidence-qualification.ts`. Live — Knowledge
State's `retention` dimension sources it directly (no longer "shadow mode").

## 7. CURRENT Learner Model (Digital Learning Twin)

`src/lib/learner-twin/` (`LearnerModelService`) is a **statically-enforced, read-only**
aggregation layer (zero INSERT/UPDATE/DELETE anywhere in the module, proven by a source-scan
test) over `concept_knowledge_state`, `mastery_records`, `concept_memory_state`,
`concept_transfer_state`, misconceptions, and `decision_events`. It never computes its own state
and is explicitly documented as "aggregates, never replaces." `src/services/learner-model.service.ts`
is its earlier precursor (pure on-demand functions, re-exported not reimplemented by the Twin);
`getLearnerConceptState` there is `@deprecated` with zero live callers, superseded by
`getDecisionContext`.

**This is the strongest architectural precedent for F5.** The Mastery → Knowledge State →
Retention/Transfer pattern is consistently: a pure algorithm module + a DB-touching projector
called inside `updateMastery`'s transaction + a Twin-side read-only reader. F5's own Skill State
and Competency State should follow exactly this shape.

## 8. CURRENT duplicated/legacy logic

- Four non-reconciled independence predicates (§1).
- Five non-reconciled transfer vocabularies (§5).
- `concept_knowledge_state.projection_version` is a dead/vestigial column (hardcoded `1`).
- `getLearnerConceptState` in `learner-model.service.ts` is `@deprecated`, zero live callers.
- `study_sessions.completion_status` is written `'pending'` and never updated anywhere (dead
  data, documented in the Twin's own architecture doc) — noted for completeness, not F5's concern.

None of these require F5 to fix them; F5 must simply not add a sixth/fifth divergent definition
without explicitly documenting it as such (which this assessment and the target architecture doc
do).

## 9. CURRENT relationships to Canonical V2

Canonical V2 (`pedagogical-engine`/`pedagogical-decision`) consumes raw `learning_evidence` rows
(via `pedagogical-shadow/evidence-adapter.ts`) and its own qualification logic — it does **not**
read `concept_knowledge_state`, `mastery_records`, `concept_memory_state`, or
`concept_transfer_state` at all for its progression decisions (confirmed: these are Digital Twin/
dashboard-facing analytical projections, downstream of and parallel to, not inputs into, Canonical
V2's own stage-progression evaluation). This means F5's new Skill/Competency/Transfer-analytics
tables are automatically outside Canonical V2's decision path by construction — the risk is not
"F5 tables leak into Canonical V2's decision" but "F5 code paths read/write in a way that
computes a competing verdict a caller might mistake for one." F5's Canonical V2 boundary
document (a required deliverable) will make this explicit.

## 10. CURRENT gaps for skills/competencies

Confirmed, unchanged from F4's own finding: **zero** evidence anywhere is tagged with a
`skill_id` or `competency_id`. `learning_evidence` and `quiz_sessions` have no such columns; no
activity-generation service (`quiz-generation.service.ts`, `canonical-transfer-generation.service.ts`,
`canonical-prove-generation.service.ts`, `canonical-retain-generation.service.ts`) records which
skill(s)/competency a question measured, even informally. This confirms task §9/§18/§19's
instruction: Skill/Competency State must start from `NO_EVIDENCE`/`INSUFFICIENT_EVIDENCE` for
essentially all historical data, and F5 cannot retroactively assign skill evidence via the
F4 `canonical_concept_skills` graph alone.

## 11. Migration risks

- `concept_knowledge_state`, `mastery_records`, `concept_memory_state`, `concept_transfer_state`
  are **live-read in production** (dashboard concept/subject pages, quiz/transfer generation
  routes, and — via the Twin's `getDecisionContext` — remediation/cognitive-diagnosis/
  tutor-strategy services). Any F5 change here must be purely additive; nothing may be reshaped
  or reinterpreted in place.
- The five transfer vocabularies and four independence predicates are pre-existing fragmentation
  that F5 must not deepen — new F5-specific concepts must be clearly, separately named.
- Zero skill/competency evidence exists historically, so a backfill will correctly classify
  nearly 100% of history as `NO_EVIDENCE` — this is the expected, correct outcome (task §18/§19),
  not a defect to paper over.

## 12. High-risk consumers (must be regression-tested after F5)

- The complete Canonical V2 suite (~40 `canon-*`/`audit-canon-v2-*` files) — highest priority.
- `dashboard/subjects/[id]/page.tsx` and `dashboard/subjects/[id]/concepts/[conceptId]/page.tsx` —
  live dashboard consumers of Mastery/Knowledge State/the Twin.
- `getDecisionContext` and its three decision-adjacent callers (`remediation.service.ts`,
  `cognitive-diagnosis.service.ts`, `tutor-strategy.service.ts`).
- `updateMastery`'s single transaction (`mastery.service.ts`) — the one choke point every new F5
  projector must hook into the same way Retention/Transfer already do, without breaking the
  existing commit/rollback contract.
- F0-S/F1/F2/F3/F4 regression suites.

## Conclusion

Evidence has exactly one writer path, already instrumented with reusable (if imperfect)
independence/assistance/difficulty signals. Three prior phases (Mastery, Knowledge State,
Retention/Transfer) already establish the exact architectural pattern F5 should extend: a pure
algorithm + a transactional projector + a read-only Twin-side reader, never a competing
authority. F5's job is to add Skill State and Competency State following this same shape, extend
Transfer analytics to finally use F4's `contexts` taxonomy, and do all of it additively — zero
changes to `learning_evidence`'s existing columns' meaning, zero changes to Canonical V2, zero
retroactive fabrication of skill/competency evidence that was never actually measured.
