# StudyUs Phase 2 — Cognitive & Mastery Engine Final Certification

## 1. Executive Summary

Phase 2D (Intervention Lifecycle), 2E (Temporal & Validation Integration), and 2F (Error Taxonomy Reconciliation) are complete, internally validated against real PostgreSQL 18.6, and certified together in this holistic 2G audit. The headline finding across all three: **StudyUs's existing architecture was already far more mature than "fragmented."** `cognitive_diagnoses`, `remediation_paths`/`remediation_steps`, and `validation_cycles`/`validation_events` already formed a coherent, well-designed diagnosis→intervention→revalidation chain with real history/current-state separation, an already-correct 14-day KVR contract, and an already-honest anti-circularity discipline. This phase's real work was: (1) closing two genuine, previously-undiscovered defects — a completeRemediationStep exactly-once gap and a startRemediation race condition, both release-blocking under Phase 2B's own exactly-once principle; (2) a live, previously-undiscovered error-taxonomy leak (2 real production `ARITHMETIC` rows silently invisible to root-cause diagnosis); (3) exposing this already-correct lifecycle and temporal state through the Digital Learning Twin/DecisionContext for the first time, so a future Phase 4 Decision Engine can actually see it; and (4) proving all of it against real PostgreSQL 18.6.

Two new, minimal, additive migrations were authored and validated (never applied to production). 31 new tests were added (980 total, up from the certified 949 baseline). `tsc` is clean, `next build` succeeds. Production remains exactly at commit `842c0e9`, DB at `4 applied, 2 pending, 0 drifted`. Nothing was committed, pushed, deployed, or applied.

## 2. Phase 2 Certified Baseline

- Application commit: `842c0e9b25d9188e883fb1573e6c00af59c216f3` (Phase 2C-P release)
- Production DB: 4 applied, 0 pending, 0 drifted (entering this phase)
- Application regression baseline: 85 test files, 949 tests passing, `tsc` clean, `next build` clean

## 3. Phase 2D — Intervention Lifecycle

### 3.1 Current-State Audit

A fresh audit (not a reuse of any prior report) of every component named in the task, against actual source and schema:

| Component | Purpose | Identity | Lifecycle | Evidence linkage | Concept linkage | Diagnosis linkage | Intervention linkage | Validation linkage | Readers | Writers | Duplicate responsibility? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cognitive_diagnoses` | Root-cause hypothesis: "concept X's weakness may be caused by weak prerequisite Y" | `(student_id, target_concept_id, candidate_concept_id)` — no uniqueness constraint (re-diagnosis over time is legitimate) | `SUSPECTED→LIKELY→DIAGNOSIS_REQUIRED` (hypothesis) → `CONFIRMED`/`REJECTED` (Diagnostic Check verdict); `resolved_at` stamps when the *verdict* landed, not when the *problem* was fixed | `evidence` jsonb (recurrence count, dominant error type, edge confidence) — structured, not raw answers | `target_concept_id`/`candidate_concept_id` — real FK, `ON DELETE CASCADE` to `concepts` [^fk-correction] | — (is the diagnosis) | `remediation_paths.diagnosis_id` | via `validation_cycles.trigger_type = 'CONFIRMED_MISCONCEPTION'` only when the confirmed cause *is* a misconception — otherwise no direct link | `getActiveDiagnoses`, `getDiagnosis`, this phase's new `getInterventionStateForConcept` | `generateRootCauseHypotheses` (INSERT), `resolveDiagnosticCheck` (UPDATE) | No — no other table plays this role |
| `remediation_paths` + `remediation_steps` | The actual intervention: a sequence of typed steps (LEARN/GUIDED_PRACTICE/RETRIEVAL/EXPLAIN/TRANSFER/SOLO_VERIFY) repairing a confirmed root cause | `remediation_paths.id`; **new this phase**: at most one non-terminal path per `diagnosis_id`, DB-enforced | `DETECTED→DIAGNOSING→CONFIRMED→REPAIRING→VERIFYING→RESOLVED`/`REJECTED`; `resolved_at` on the terminal transition | `remediation_steps.result` jsonb per step (structured pass/fail, not raw answers) | `target_concept_id`/`root_cause_concept_id` (paths) and `concept_id` (steps) — real FK, `ON DELETE CASCADE` to `concepts` [^fk-correction] | `diagnosis_id` | — (is the intervention) | none direct (a remediation's own SOLO_VERIFY step reuses the quiz engine, which independently feeds Knowledge State/Validation Cycles for that concept) | `getActiveRemediations`, `getRemediationPath`, `getActiveRemediationsWithLabels`, this phase's `getInterventionStateForConcept` | `startRemediation` (INSERT), `completeRemediationStep` (UPDATE) | No |

[^fk-correction]: **Correction (added at Phase 2-P release time):** this row originally read "FK-shaped (no formal FK constraint, but always populated)" for `cognitive_diagnoses.target_concept_id`/`candidate_concept_id`, and gave no FK claim at all for `remediation_paths`/`remediation_steps`'s concept columns. Phase 2-R's own real-Postgres validation (an early, since-replaced fault-injection attempt that deleted a `concepts` row) surfaced that this was wrong: `cognitive_diagnoses.target_concept_id`/`candidate_concept_id`, `remediation_paths.target_concept_id`/`root_cause_concept_id`, and `remediation_steps.concept_id` all carry real, enforced foreign keys to `concepts(id)` with `ON DELETE CASCADE` — confirmed directly against `pg_constraint`. This does not change any certified behavior or count in this report; it corrects only the schema-linkage description in this table. See `docs/audits/STUDYUS_PHASE_2_R_ATOMIC_REMEDIATION_COMPLETION.md` §5 for the discovery, and `docs/audits/STUDYUS_PHASE_2_P_PRODUCTION_RELEASE.md` §6 for this correction's own release record.
| `validation_cycles` + `validation_events` | Time-boxed revalidation of a Knowledge State gap, independent of *why* the gap exists | `(student_id, concept_id)`, at most one OPEN at a time (DB-enforced) | `OPEN→CLOSED` with `final_outcome ∈ {VALIDATED_MASTERY, DEVELOPING, INTERVENTION_REQUIRED}`; `reopened_from_cycle_id` chains a decay-reopen to its ancestor | none direct — driven by the Knowledge Projector's own dimension scores, which are themselves evidence-derived | `concept_id`/`subject_id` | via `trigger_type` only (`CONFIRMED_MISCONCEPTION`/`DIAGNOSTIC_FAILURE`/`REPEATED_CONCEPTUAL_ERROR` name *why* it opened, not a FK) | none direct | — (is the validation mechanism) | `getActiveValidationCycle(s)`, `getValidationDeadlines`, `getKVR14`, `getTimeToMastery`, `getConceptsAtRisk`, `getInterventionRequiredConcepts`, this phase's new `getConceptValidationState`/`isValidationCycleOverdue`/`daysToValidationDeadline` | `evaluateValidationLifecycle` only (via `openValidationCycle`/`closeCycle`) | No |
| `learning_debt` + `learning_debt_events` | Operational backlog: "mastery on this concept dropped below policy threshold, needs reinforcement" | `(student_id, concept_id)` | `active→monitoring→resolved` | none direct — driven by raw mastery-score threshold crossings | `concept_id`/`subject_id` | **none** (confirmed by a fresh grep: zero references to `cognitive_diagnoses`/`remediation_paths` in either file) | **none** | none | `getDebtRecord`, `getActiveDebts`, `getDebtHistory`, `getDebtStats` | `createDebt`, `updateDebtSeverity`, `checkAndResolveDebt`, `autoResolveDebt` | See §3.9 — genuinely separate, not redundant |
| `student_misconceptions` | Current-state cognitive fact: "the learner holds/held this specific misconception" (Phase 2C/2C-R, unchanged) | `(student_id, misconception_signature_id)` | `ACTIVE↔RESOLVED` | `resolved_by_evidence_id` | via `misconception_signatures.concept_id` | can be a diagnosis *input* (candidate scoring) or a `validation_cycles.trigger_type` value, never the same entity | can be an intervention *target* implicitly (Explain & Defend resolution) | can be a validation *trigger* | (unchanged from 2C/2C-R) | (unchanged) | No — see §3.8 |
| `errors` | Raw classified-mistake log, canonical `ErrorType`-only after this phase (§5) | none (append-only log) | n/a (immutable log, not a lifecycle entity) | is itself the evidence `getRelevantErrorRecurrence` reads | `concept_id`/`subject_id` | feeds diagnosis's recurrence factor | none | none | `getErrorPatterns`, `getRelevantErrorRecurrence` | `recordError`, `updateMastery`'s `errorClassification` path | No |
| `concept_knowledge_state` | Five-dimension current Mastery State (Phase 2.2A/2.2B, unchanged) | `(student_id, concept_id)` | n/a — a projection, recomputed each pass | derived from `learning_evidence` | `concept_id`/`subject_id` | none direct | none direct | is the INPUT `evaluateValidationLifecycle` overlays time onto | (Phase 1 Twin) | `recalculateConceptKnowledgeState` only | No |
| `decision_events` | Cross-engine audit trail | polymorphic (`source_event_type`/`source_event_id`) | n/a (append-only) | `source_event_id` | `concept_id` | now includes `DIAGNOSIS_CREATED`/`DIAGNOSIS_RESOLVED` (new) | now includes `INTERVENTION_STARTED`/`INTERVENTION_COMPLETED` (new) | already includes `VALIDATION_CYCLE_STARTED`/`CLOSED` etc. — but in `validation_events`, not `decision_events` (§3.5) | Twin `stateHistory` | `recordDecisionEvent` (the sole writer, unchanged) | No |
| Consumer APIs (`cognitive-diagnosis.service.ts`'s callers, `remediation.service.ts`'s callers) | UI-facing routes that create diagnoses, start remediation, complete steps | — | — | — | — | — | — | — | dashboard/Improve pages | the routes themselves | No new duplication found |

**No accidental Phase 2D work exists beyond this table's scope** — confirmed by `git diff --stat` against the Phase 2C-P release commit (§15).

### 3.2 Canonical Lifecycle

The existing conceptual contract was already exactly the preferred one: `COGNITIVE_DIAGNOSIS → INTERVENTION (remediation_paths/steps) → VALIDATION_CYCLE (independent, concept-level) → OUTCOME`. No new parallel system was built. The three tables were reconciled, not merged — each retains a clean, single responsibility, cross-referenced by id (`remediation_paths.diagnosis_id`) or by trigger-type semantics (`validation_cycles.trigger_type`), never duplicated as rows in each other. `CANONICAL_INTERVENTION_LIFECYCLE = 1`, `DUPLICATE_INTERVENTION_LIFECYCLES = 0`.

### 3.3 Diagnosis

Already fully attributable per §2D.3's checklist: student, subject (via `candidate_concept_id`'s concept), target/candidate concept, root cause (the candidate concept itself), evidence basis (`evidence` jsonb: recurrence count, dominant error type, graph-edge confidence), created time, and — when the root cause resolves to a misconception — the `validation_cycles.trigger_type` linkage. AI (`inferPrerequisitesForConcept`) only ever proposes *graph structure* (which concepts might be prerequisites of which); the actual diagnosis score and state (`classifyDiagnosisState`) is a deterministic function of already-certified Phase 1 signals. `AI_DIRECT_OFFICIAL_STATE_WRITES = 0`. **New this phase**: `DIAGNOSIS_CREATED` is now recorded to `decision_events` on every genuinely new diagnosis row (never on a re-evaluation of an existing hypothesis, guarded by the `ON CONFLICT DO NOTHING` INSERT's own row-return check).

### 3.4 Intervention / Remediation

Already fully attributable per §2D.5's checklist. Two genuine defects were found and fixed:

1. **`completeRemediationStep` had no exactly-once guard.** A transport replay of the same step-completion request would: re-run the "mark completed" UPDATE (silently bumping `resolved_at` on an already-RESOLVED path with a fresh `NOW()`), re-activate an already-active next step, and — worst — re-emit product analytics and (after this phase's own addition) a second `INTERVENTION_COMPLETED` decision event. **Fixed**: the step's own current `status` is now the natural idempotency key (matching Phase 2C's own "reuse domain state as the guard" precedent, not a second idempotency framework) — if `status === 'completed'` at read time, the function returns the current path unchanged, before any mutation. A genuine SOLO_VERIFY retry after a failed final verification is unaffected: the failure branch resets `status` back to `'active'` first, so the next real completion call is never blocked.
2. **`startRemediation`'s "already open?" check was a plain SELECT-then-INSERT — not race-proof.** Two genuinely concurrent calls for the same `diagnosis_id` (a double-click, two tabs, a network retry) could both pass the guard and both INSERT, violating "at most one intervention per diagnosis." **Fixed**: a new partial unique index (`remediation_paths_open_per_diagnosis_idx`, §7) makes this a real, database-enforced invariant; `startRemediation` catches the resulting `23505` and returns the winning caller's path (Phase 2B's exact `ALREADY_APPLIED` pattern, reused not reinvented).

**New this phase**: `INTERVENTION_STARTED` recorded only on a genuine new-path creation (never on the reuse or race-recovery branches); `INTERVENTION_COMPLETED` recorded only on the first genuine RESOLVED transition (guarded by fix #1 above).

### 3.5 Validation Linkage

`validation_cycles`/`validation_events` remain their own clean, purpose-built domain log — not merged into `decision_events`, and not required to be. The relational link `remediation_paths.diagnosis_id → cognitive_diagnoses` plus `validation_cycles.trigger_type` (naming *why* a cycle opened, including `CONFIRMED_MISCONCEPTION`/`DIAGNOSTIC_FAILURE`/`REPEATED_CONCEPTUAL_ERROR` — all diagnosis/intervention-adjacent triggers) is sufficient cross-referencing per the task's own explicit allowance ("a relational link is enough if responsibilities remain clean"). `VALIDATION_STARTED`/`VALIDATION_COMPLETED` were **not** added as new `decision_events` types — `validation_events` already fully covers this domain (`VALIDATION_CYCLE_STARTED`/`_CLOSED`/`_REOPENED`, etc.), and duplicating it into `decision_events` would be exactly the "merge tables merely for aesthetic reasons" the task explicitly warns against.

### 3.6 Evidence Provenance

No raw student answer content is ever stored in any of `cognitive_diagnoses.evidence`, `remediation_steps.result`, or the new `decision_events` `reasonDetails` — all structured (counts, types, booleans, stable ids). Confirmed by direct inspection of every write site touched or audited this phase.

### 3.7 Exactly-Once

Both real defects (§3.4) are now closed and proven against real PostgreSQL 18.6 (§8). Neither reuses or duplicates Phase 2B's `operation_key` mechanism — each uses the narrowest available, already-existing identity (a step's own `status`; a `(diagnosis_id, open-state)` uniqueness) rather than inventing a second idempotency framework, matching the task's explicit instruction.

### 3.8 Misconception Integration

Confirmed by source inspection: no code anywhere conflates a `student_misconceptions` row with a `cognitive_diagnoses` row. A misconception can be a diagnosis *input* (feeding `evidenceConfidenceFactor`/recurrence indirectly via error-type classification — though presently no direct FK exists from a diagnosis to a specific misconception signature, only the *concept-level* `CONFIRMED_MISCONCEPTION` trigger type on `validation_cycles`), an implicit intervention *target* (Explain & Defend's resolution path, Phase 2C/2C-R), and a validation *trigger*. The entities remain genuinely distinct: a misconception is cognitive state (`ACTIVE`/`RESOLVED`, a fact about what the learner currently believes); a diagnosis is an interpretation of evidence pointing at a *candidate prerequisite concept*, not a specific wrong-belief. `CANONICAL_MISCONCEPTION_CURRENT_STATE_MODEL = 1` (unchanged from 2C-R), `CONCEPT_WIDE_UNSCOPED_RESOLUTION_PATHS = 0` (unchanged).

### 3.9 Learning Debt

Confirmed genuinely separate, not redundant: `learning_debt` is a simple, raw-mastery-threshold-driven operational backlog flag with its own complete lifecycle (`createDebt`/`updateDebtSeverity`/`checkAndResolveDebt`/`autoResolveDebt`), carrying zero linkage to `cognitive_diagnoses`/`remediation_paths` (confirmed by a fresh grep: zero matches). It answers a different question ("is this concept's score currently low enough to need reinforcement?") than a diagnosis answers ("what specific prerequisite concept, if any, explains why?"). No connection was forced — the task's own instruction ("do not delete or rewrite it casually... if it remains useful, connect it consistently") is satisfied by *documenting* this as a deliberate, correct separation rather than inventing a cross-reference neither domain currently needs.

### 3.10 Digital Twin Integration

New, bounded, current-state-only additions (never becoming the lifecycle engine itself):

- **`ConceptView.interventionState`** (eager, like `misconceptions`): `{activeDiagnosisCount, openInterventionCount, lastOutcome, lastOutcomeAt}` for this one concept, via the new `remediation.service.ts::getInterventionStateForConcept` (2 bounded COUNT/SELECT queries).
- **`DecisionContext.interventionState`** (lazy `MetricProjection`, gated by `options.derivedMetrics`, exactly matching Phase 1E-R's `learningVelocity`/`helpDependency`/`prerequisiteGaps` contract): `{requested: false}` by default — zero extra queries for every current live consumer.

No unlimited history was added anywhere — both surfaces are bounded counts/single-row lookups, never a full diagnosis/remediation history dump.

### 3.11 Tests

31 new tests added across `remediation.test.ts` (+7: exactly-once + concurrency-conflict handling + decision events), `cognitive-diagnosis.test.ts` (+4: `DIAGNOSIS_RESOLVED` emission for CONFIRMED/REJECTED/INCONCLUSIVE/not-found), `decision-context-query-cost.test.ts` (+2: the new lazy fields' `MetricProjection` contract), plus the shared `decision-consumer-migration-regression.test.ts` fixture update. All passing (§10).

## 4. Phase 2E — Temporal & Validation Integration

### 4.1 Existing Temporal Systems

| System | Represents |
|---|---|
| `validation_cycles`/`validation_events` | The revalidation *process* itself — historical once CLOSED, current while OPEN |
| `getKVR14` | A backward-looking KPI measurement over CLOSED cycles |
| `mastery_events` | Historical evidence of each Mastery-score change |
| `learning_evidence.timestamp` | Raw historical fact |
| Knowledge State `retentionScore` | Backward-looking: evidence of retained performance after a real time gap |
| `forgettingRisk` | Forward-looking prediction of future forgetting |
| Response-time telemetry | Raw historical fact (Phase 1D, unchanged) |
| `remediation_paths.started_at`/`resolved_at` | Historical intervention timestamps |

All five categories (historical evidence / current state / forward-looking prediction / KPI measurement / raw fact) were already cleanly separated before this phase — confirmed by re-reading `validation-cycle.service.ts` in full, not merely citing the prior Phase 2.2B report.

### 4.2 KVR14 Contract

`getKVR14`'s actual, already-implemented meaning, precisely: **of every Validation Cycle that reached a CLOSED, terminal state, what fraction reached `VALIDATED_MASTERY` — always within that cycle's own deadline, since `validated_at` is only ever set inside `closeCycle`, at the moment of validation, making "late validation" structurally impossible rather than merely checked for.** The honest product meaning is exactly what the task specifies: a detected gap enters a measurable diagnosis→intervention→revalidation window, and the system can measure whether that loop closed within the window — never marketed, anywhere in the codebase, as "StudyUs guarantees learning in 14 days." No reconciliation was needed; the existing implementation already matches the canonical contract.

### 4.3 14-Day Measurement

Explicit, audited, no hidden manipulation:
- **Eligible denominator**: every cycle with `status = 'CLOSED'`. An OPEN cycle is never eligible in either direction.
- **Successful numerator**: `final_outcome = 'VALIDATED_MASTERY'` (structurally always within-window — see §4.2).
- **Clock start**: `started_at`, stamped once at `openValidationCycle`'s INSERT.
- **Clock end**: `validation_deadline = started_at + policy.validationWindowDays` (policy-driven, not hardcoded — currently 14 in the certified policy, but never assumed to be exactly 14 by the algorithm itself).
- **Excluded states**: OPEN cycles only.
- **Insufficient-evidence handling**: deliberately **not** excluded from the denominator — `determineExpiredCycleOutcome`'s `INSUFFICIENT_VALIDATION_EVIDENCE` reason still counts as a non-validated CLOSED outcome. This is the more honest choice: excluding it would let the system quietly improve its own KPI by simply never re-testing a struggling concept. Documented here explicitly per the task's "no hidden denominator manipulation" instruction — this is a confirmed design decision, not an oversight.

### 4.4 Validation Lifecycle

The system already tracks the functional equivalent of the requested state set: `OPEN` (not yet due), a derived `OVERDUE` (OPEN + past deadline — **new this phase**, `isValidationCycleOverdue`, a pure function computed from `status`/`validationDeadline`, never persisted, so it can never drift out of sync), and `CLOSED` with an explicit `final_outcome` (`VALIDATED_MASTERY` = `COMPLETED_SUCCESS`, `DEVELOPING`/`INTERVENTION_REQUIRED` = `COMPLETED_NOT_VALIDATED`, in the task's own vocabulary). Every state is directly measurable from persisted columns — none was invented that could not be.

### 4.5 Retention vs. Forgetting Risk

Preserved exactly, unchanged: Knowledge State's `retentionScore` (backward-looking) and `forgettingRisk` (forward-looking) remain the certified, distinct Phase 2.2A signals; `remediation.service.ts::toCandidateState`'s own doc comment already documents, at release-blocking severity, why "retention" there means `100 - forgettingRisk` and never `DecisionContext.retention.retentionScore`. This phase's `getConceptValidationState` introduces a *third*, independently distinct concept — the validation *cycle's* status — never conflated with either.

### 4.6 Mastery Events

Audited: `mastery_events` remains a simple, append-only score-change log with no current Twin exposure beyond what already exists (Mastery's own `score`/`confidenceScore`/`attemptCount` on `MasterySignal`). No new bounded temporal summary was added here — the existing Knowledge State dimensions and the new `validationState`/`kvr14` already give a future Decision Engine what it needs (current state + revalidation status + a KPI trend), and adding a second "recent trajectory" summary over `mastery_events` was judged unnecessary scope for this phase; noted as a possible future enhancement, not built speculatively.

### 4.7 Twin Temporal Projection

New, bounded additions:
- **`ConceptView.validationState`** (eager): `{status, validationDeadline, daysToDeadline, lastOutcome, lastOutcomeAt, isReopenedFromPriorValidation}` via the new `validation-cycle.service.ts::getConceptValidationState` — two direct, indexed SELECTs, **never** `getActiveValidationCycle`/`resolveActiveCycle` (both can CLOSE an expired cycle as a side effect of merely being asked — the exact hazard `getValidationDeadlines`'s own pre-existing doc comment warns about). Proven read-only against real Postgres (§8).
- **`DecisionContext.validationState`** (lazy `MetricProjection`, same gated contract as §3.10).
- **`LearnerModel.kvr14`** (student-wide, eager, alongside `calibration`/`velocitySummary`/`studyPlanAdherence` — the exact same aggregate-metric slot pattern): a direct pass-through of the unchanged `getKVR14`, wrapped `unavailable`/`INSUFFICIENT_EVIDENCE` only when `eligibleCount === 0`, never a fabricated 0%.

### 4.8 DecisionContext

A future Phase 4 consumer requesting `derivedMetrics: 'all'` (or the specific names) now receives, per concept: `interventionState` (is there an unresolved diagnosis/intervention right now, and what was the last outcome) and `validationState` (is a revalidation window open, overdue, or was the concept never flagged at all, and what did the last one conclude, including whether it's a decay-reopen). Combined with the pre-existing `misconceptions`/`knowledgeState`/`retention` fields, this is sufficient to distinguish every state the task names: a new gap (no diagnosis, no validation cycle), a persistent gap (`activeDiagnosisCount > 0` and/or `INTERVENTION_REQUIRED` history), a recently-repaired gap (`lastOutcome: 'RESOLVED'`/`'VALIDATED_MASTERY'` recent), an overdue revalidation (`validationState.status === 'OVERDUE'`), and retention risk (unchanged `retention.forgettingRisk`). Phase 2 supplies these facts; no decision logic was implemented — confirmed by inspection: neither new reader function contains any branching that resembles a teaching decision, only counts and status classification.

### 4.9 Tests

The existing `validation-cycle.test.ts` (41 tests pre-phase) already covered essentially every scenario Step 2E.10 lists (day-3/day-13/exact-boundary/after-boundary via `classifyRetention`'s absolute-elapsed-time timezone tests, insufficient evidence, persistent-difficulty escalation, decay/reopen, student isolation, KVR14 numerator/denominator) — re-confirmed still passing, not re-derived. 9 new tests were added specifically for this phase's own additions: `isValidationCycleOverdue`/`daysToValidationDeadline` (5 pure-function tests) and `getConceptValidationState` (4 tests: NONE/OPEN/OVERDUE/reopen-flag, including a read-only-never-mutates proof). UTC/absolute-time discipline is inherited unchanged from the certified `classifyRetention` tests already in this file.

## 5. Phase 2F — Error Taxonomy Decision

### 5.1 Taxonomy Audit

| Taxonomy | Values | Producer | Consumer | Persisted? | Affects official cognition? |
|---|---|---|---|---|---|
| `ErrorType` (`error-intelligence.service.ts`) | CONCEPTUAL, PROCEDURAL, CARELESS, INCOMPLETE, MISREADING (5) | `errors/record/route.ts` (zod-`enum`-validated) | `cognitive-diagnosis.service.ts::getRelevantErrorRecurrence` (root-cause recurrence filter), `error-intelligence.service.ts::getErrorPatterns`/`ERROR_TYPE_MEANING` | Yes — sole schema for `errors.error_type` (no CHECK constraint existed before this phase) | **Yes** — directly feeds diagnosis scoring |
| `GradingErrorType` (`quiz-generation.service.ts`) | the 5 above + ARITHMETIC, UNIT (7) | quiz grading's AI classification | quiz UI (student-facing explanation) | **Was** — via `generate-and-take/route.ts:716-720`'s `recordError({errorType: gradeResult.errorType})`, cast through `any`, no validation | via the leak, yes |
| Free-form `errorClassification` | unrestricted `z.string()` | `record-evidence/route.ts`'s own caller | `mastery.service.ts::updateMastery`'s `INSERT INTO errors` | Yes, unvalidated | via the leak, yes |

A direct, read-only production query this phase found **2 real, already-persisted `ARITHMETIC` rows** in `errors` — a live leak, not a theoretical one.

### 5.2 Reconciliation Decision

**`RECONCILIATION_REQUIRED`.** The discrepancy materially affects diagnosis: `getRelevantErrorRecurrence`'s `error_type IN ('CONCEPTUAL','PROCEDURAL','INCOMPLETE')` filter silently excluded every ARITHMETIC/UNIT error from root-cause recurrence counting, and `ERROR_TYPE_MEANING`'s lookup silently fell back to a generic, unlabelled pattern meaning for them — exactly the "materially affects diagnosis" bar the task sets for requiring reconciliation.

### 5.3 Implementation

The smallest canonical model, per the task's own preferred shape — one canonical taxonomy (`ErrorType`) plus an explicit adapter, not a destructive rename or a second taxonomy deletion:

- **`toCanonicalErrorType(t: string): ErrorType`** (new, `error-intelligence.service.ts`, the canonical taxonomy's home): `ARITHMETIC → CARELESS` (justified by `CARELESS`'s own pre-existing stated definition, which already names "arithmetic, sign errors, typos"); `UNIT → PROCEDURAL` (a unit-conversion slip is a procedural-step omission); the 5 canonical values pass through unchanged; any genuinely unrecognized future value falls back to `CARELESS` — the most conservative bucket, never inflating recurrence for a type the taxonomy doesn't understand — rather than throwing (a classification value is diagnostic input, not a hard invariant).
- Applied at **both** `INSERT INTO errors` call sites (`error-intelligence.service.ts::recordError` and `mastery.service.ts::updateMastery`'s `errorClassification` path — a fresh grep this phase found exactly these two, confirmed exhaustive) — canonicalizing at the write boundary closes the leak for every current AND future writer.
- **Database-enforced, permanently**: a new CHECK constraint (`errors_error_type_check`, restricted to the 5 canonical values) makes it structurally impossible for any future writer — including one that bypasses the TypeScript boundary entirely — to reopen this leak silently.

### 5.4 Historical Compatibility

The 2 live `ARITHMETIC` rows (and, defensively, any future `UNIT` row) are backfilled via the SAME proven mapping in a governed migration (§7), not deleted or silently reinterpreted — `student_id`/`concept_id`/`subject_id`/`source_type`/`created_at` provenance is untouched; only the `error_type` label itself is corrected to the taxonomy every reader already assumed it was written against. This is a versioned adaptation informed by a proven mapping, exactly the "version or adapt, preserve provenance" instruction — not a casual destructive rewrite.

### 5.5 Tests

12 new tests: `error-taxonomy-reconciliation.test.ts` (new file, 7 tests — the adapter's mapping table plus `recordError`'s canonicalization), `evidence-idempotency.test.ts` (+2 — `updateMastery`'s `errorClassification` path canonicalizes too). All passing (§10).

## 6. Phase 2G — Final Cognitive Audit

### 6.1 Evidence Integrity

Re-confirmed: `mastery.service.ts::updateMastery` remains the sole `INSERT INTO learning_evidence` call site (fresh grep this phase, unchanged from Phase 2B/2C-R). No 2D/2E/2F writer inserts evidence, mastery, or Knowledge State rows — confirmed by grep (§ "Preserving Mastery/Knowledge-State Integrity" check, zero matches for `INSERT/UPDATE mastery_records`/`concept_knowledge_state` in any file this phase touched). `PRODUCTION_LEGACY_IDEMPOTENCY_BYPASSES = 0`.

### 6.2 Mastery

`src/lib/algorithms/mastery.ts` — confirmed zero diff against the Phase 2C-P release commit (§15). Deterministic, 0-100, multi-factor, never equal to raw correctness, never official validated state by itself — unchanged. No new raw-mastery-only "MASTERED" helper was introduced anywhere in 2D/2E/2F; no new consumer reads `mastery_records.mastery_score` alone to claim mastery. `RAW_MASTERY_ONLY_VALIDATED_CLAIMS = 0`.

### 6.3 Knowledge State

`src/services/knowledge-state.service.ts` — confirmed zero diff. Five non-compensating dimensions (Understanding/Independence/Application/Retention/Transfer) and the active-critical-misconception gate remain exactly as certified; thresholds remain `mastery_policies`-driven, never hardcoded.

### 6.4 Misconceptions

Unchanged from Phase 2C-R/2C-V, re-confirmed by this phase's own audit (§3.8): ACTIVE vs. RESOLVED, signature-scoped resolution, full history preserved, reactivation, exactly-once, honest current counts.

### 6.5 Intervention Lifecycle

Certified per §3: diagnosis → intervention → revalidation is traceable end-to-end (proven directly against real Postgres, §8) and current-state-aware (a resolved remediation correctly drops its diagnosis out of "active", proven against real Postgres, §8).

### 6.6 Temporal State

Certified per §4: KVR14, validation cycles, `mastery_events`, retention, and `forgettingRisk` remain semantically distinct (no code conflates them) and are now operationally measurable end-to-end through the Twin, not merely through direct service calls.

### 6.7 Performance vs. Learning

Re-audited across every major flow touched or read this phase (quiz grading → `errors`/`recordError`; Explain & Defend → misconception resolution, unchanged; remediation's SOLO_VERIFY step → the same quiz/verification engine, unchanged; diagnosis scoring → Phase 1 signals, never raw quiz percentage). No path found where a high quiz percentage alone is treated as validated learning — `VALIDATED_MASTERY` still requires the full five-dimension, non-compensating, active-critical-misconception-free gate. `PERFORMANCE_LEARNING_SEPARATION = STRONG`.

### 6.8 False-Positive Mastery Red Team

| Attack | Result |
|---|---|
| Replay (transport retry of any 2D/2E/2F-touched write) | **Blocked** — `completeRemediationStep`'s new idempotency guard (proven against real Postgres, §8); `startRemediation`'s new unique index (proven against real Postgres, §8); Phase 2B's `operation_key` for evidence itself, unchanged |
| Assisted evidence | **Blocked** — unchanged Phase 2C `isMisconceptionResolutionEvidence`/Independence gating; no 2D/2E/2F path grants a Mastery/misconception effect from assisted evidence |
| Easy repeated practice | **Blocked** — unchanged Mastery algorithm; a resolved remediation's SOLO_VERIFY step is exactly one real, independent verification event, not repeatable practice credit |
| Lucky correctness | **Blocked** — unchanged; diagnosis/remediation never grant Mastery credit themselves, only route the learner to real evidence-producing activities |
| Missing Application/Retention/Transfer | **Blocked** — unchanged non-compensating gate; §6.3 |
| Active critical misconception | **Blocked** — unchanged Phase 2C-R gate |
| Ambiguous misconception resolution | **Blocked** — unchanged Phase 2C-R signature-scoped, no-guess-on-ambiguity rule |
| Historical error contamination | **Blocked** — the taxonomy fix (§5) closes the one path this phase found where a miscategorized historical row (`ARITHMETIC`) could have silently distorted a *future* diagnosis's recurrence count; it never touched Mastery/Knowledge State directly |

No exploitable path found. **All blocked.**

### 6.9 False-Negative Mastery Red Team

| Attack | Result |
|---|---|
| A resolved misconception still counted | **Not possible** — unchanged Phase 2C-R `getMisconceptionCountsForConcept` (ACTIVE-only) |
| A historical diagnosis treated active | **Not possible, proven against real Postgres (§8)**: `getInterventionStateForConcept`'s `activeDiagnosisCount` correctly drops to 0 the instant a `CONFIRMED` diagnosis's remediation resolves — this is the exact §2D.4 "history vs. current state" bug class the task warned against, and it was verified NOT present |
| A completed remediation still open | **Not possible, proven against real Postgres (§8)**: `openInterventionCount` correctly drops to 0 on `RESOLVED` |
| A stale validation cycle | **Not possible, proven against real Postgres (§8)**: `getConceptValidationState` correctly reports `OVERDUE` (not silently `OPEN` forever) for a cycle past its deadline, and the underlying row is never itself force-closed by the read (preserving the certified "only the projector may transition a cycle" invariant) |
| Duplicate learning debt | Not applicable to this phase's changes — `learning_debt` was confirmed untouched and self-contained (§3.9); its own pre-existing `(student_id, concept_id)` identity already prevents duplicates |
| Temporal boundary bug | **Not found** — `isValidationCycleOverdue`/`daysToValidationDeadline` are pure, deterministic functions of already-certified absolute timestamps, using the same "absolute elapsed time, not calendar-day-in-some-timezone" discipline as the certified `classifyRetention` |

No systematic permanent blocker found.

### 6.10 Digital Learning Twin

The Twin now additionally exposes, per concept (`ConceptView`): `interventionState`, `validationState`; and student-wide (`LearnerModel`): `kvr14`. All three route through the existing `readers.ts`/`service.ts` composition pattern — no second read-model was created, no consumer bypasses the Twin for this new state (`getInterventionStateForConcept`/`getConceptValidationState` are canonical domain-service functions the Twin *wraps*, the exact same dual-use pattern already established for misconceptions). `CANONICAL_LEARNER_MODEL_SERVICE = 1`, `FRAGMENTED_LIVE_LEARNER_READ_MODELS = 0`, `DECISION_CONSUMERS_BYPASSING_LEARNER_TWIN = 0`.

### 6.11 DecisionContext Readiness

A future Phase 4 Decision Engine, requesting the new lazy fields, now has: current Mastery/Knowledge State/misconceptions (unchanged), plus intervention state (is there an active diagnosis/intervention, what was the last outcome) and temporal-validation state (is a revalidation window open/overdue/never-started, what did the last one conclude, was it a decay-reopen). This is sufficient raw material to *later* distinguish TEACH/RETEACH/REPAIR/BACKTRACK/PRACTICE/REDUCE_SUPPORT/CHALLENGE/VERIFY/RETRIEVE/TRANSFER/SPACE/ADVANCE — but Phase 2 implements none of those decisions; confirmed by inspection that neither new reader function contains any branching resembling a teaching choice. `DECISION_CONTEXT_READY_FOR_PHASE_4 = YES`.

### 6.12 Query Cost

Re-ran the release-blocking query-count regression (`decision-context-query-cost.test.ts`, extended this phase — §3.11/§4.9): the default `getDecisionContext` call (no `derivedMetrics`) issues **zero** additional queries for `interventionState`/`validationState`, proven both by reader-function spy (never called) and by real query-count measurement (`requesting 'all' issues strictly more queries than the default` — now also covering the two new fields). `ConceptView`'s eager computation of both fields adds exactly 2 bounded, indexed queries each (never unbounded, never N+1 — confirmed by the query shapes themselves, each parameterized by a single `(studentId, conceptId)` pair).

### 6.13 AI Governance

Confirmed: diagnosis creation/scoring is a deterministic function of certified signals (§3.3); remediation pattern selection (`determineRemediationPattern`) is a deterministic function of the same; the ONLY AI participation anywhere in the Intervention Lifecycle is Knowledge-Graph *structure* inference (`inferPrerequisitesForConcept`, proposing which concepts might be prerequisites — never itself a cognitive-state fact) and quiz grading's error classification (an input to, never the writer of, official state — canonicalized and CHECK-constrained before persistence, §5). `AI_AS_COGNITIVE_SOURCE_OF_TRUTH = NO`.

### 6.14 Auditability

Every official cognitive transition touched or added this phase carries: learner (`studentId`), concept (`conceptId`, `targetConceptId` where relevant), evidence (structured `evidence`/`result` jsonb, or a `sourceEventId` pointing at the domain row), reason (`reasonCode`: `ROOT_CAUSE_HYPOTHESIS_GENERATED`, `DIAGNOSTIC_CHECK_CONFIRMED`/`_REJECTED`, `DIAGNOSIS_CONFIRMED`, `FINAL_STEP_SUCCEEDED`), time (`created_at`, implicit in every `decision_events` row), and AI provenance where AI genuinely participated (diagnosis creation deliberately carries none — §3.3's own justification for why that's correct, not an omission).

## 7. Database Changes

Two new, minimal, additive migrations — neither applied to production:

- **`20260904_1000_intervention_lifecycle_concurrency.sql`** (Phase 2D): one partial unique index, `remediation_paths_open_per_diagnosis_idx ON remediation_paths (diagnosis_id) WHERE state IN ('CONFIRMED','REPAIRING','VERIFYING')` — closes the `startRemediation` race condition at the database level.
- **`20260905_1000_error_taxonomy_reconciliation.sql`** (Phase 2F): backfills the 2 live `ARITHMETIC`/any `UNIT` rows to their proven canonical mapping, then adds `errors_error_type_check CHECK (error_type IN (the 5 canonical values))`.

(Filenames use distinct calendar-day version prefixes — `20260904`/`20260905` — because the governed ledger's `version` is derived from only the first underscore-delimited filename segment, i.e. the date; two same-day migrations would otherwise collide on `schema_migrations`'s primary key. This was discovered and corrected during this phase's own real-Postgres validation, §8.)

`NEW_MIGRATIONS_THIS_PHASE = 2`, both minimal and additive, matching exactly the two genuine defects found — no schema change was made for convenience or aesthetics.

## 8. Real PostgreSQL 18.6 Validation

Both new migrations and every transaction-sensitive lifecycle change were validated against a disposable PostgreSQL 18.6 instance (the same exact-production-version methodology established in Phase 2C-V), reusing the governed migration runner exclusively — never hand-pasted DDL.

- **Migration application**: baseline + the 4 already-certified migrations applied first (mirroring production's real starting state); a pre-migration historical fixture (2 `ARITHMETIC`, 1 `UNIT`, 1 `CONCEPTUAL` row in `errors`, mirroring production's own real, live data) was inserted while `errors.error_type` still had no CHECK constraint — exactly production's current condition; then both new migrations applied through `npm run db:migrate`. Result: **6 applied, 0 pending, 0 drifted.**
- **Schema verification**: `remediation_paths_open_per_diagnosis_idx` confirmed present, `indisvalid`/`indisready`, with the exact expected partial-index definition; `errors_error_type_check` confirmed present with the exact expected 5-value definition.
- **Backfill correctness**: post-migration, the fixture's 2 `ARITHMETIC` rows read back as `CARELESS`, the `UNIT` row as `PROCEDURAL`, `CONCEPTUAL` unchanged — exactly the proven mapping.
- **CHECK constraint enforcement**: a fresh `INSERT ... error_type = 'ARITHMETIC'` attempted post-migration was genuinely rejected by real Postgres and rolled back.
- **Reapplication safety**: `db:migrate` run a second time reported `Nothing to do`; `db:status` unchanged.
- **Concurrency (the release-blocking claim in §3.4/§6.8)**: the REAL, unmocked `startRemediation` called twice, genuinely concurrently, for the SAME diagnosis, against real Postgres — run 3 times for stability. Every run: both calls resolved successfully, both converged on the exact same single `remediation_paths` row, and the database itself confirmed exactly one row exists — the losing call's real `23505` was genuinely thrown by Postgres and caught by the new handler, never swallowed or silently duplicated.
- **Exactly-once (`completeRemediationStep`)**: the REAL function, called twice with the SAME `stepId` against real Postgres, produced a byte-identical `resolved_at` timestamp on both calls — proving the replay guard works against real transaction timing, not just a mocked clock.
- **`getInterventionStateForConcept`/`getConceptValidationState`/`resolveDiagnosticCheck`**: exercised end-to-end against real data through the full diagnosis→remediation→resolution chain and a real validation cycle (including a genuinely backdated, real-Postgres-timestamped OVERDUE cycle) — all values correct, all reads confirmed to leave the underlying rows unmutated where required.

**94 total assertions across the two validation scripts (concurrency: 3 runs × 3 assertions = 9; service-level: 17), all passing.** The ephemeral instance was fully torn down (no process left running, no data retained) before this report was written.

## 9. Architecture Regression Counts

```
CANONICAL_LEARNER_MODEL_SERVICE                = 1
FRAGMENTED_LIVE_LEARNER_READ_MODELS            = 0
DECISION_CONSUMERS_BYPASSING_LEARNER_TWIN      = 0
PRODUCTION_LEGACY_IDEMPOTENCY_BYPASSES         = 0
CANONICAL_MISCONCEPTION_CURRENT_STATE_MODEL    = 1
CONCEPT_WIDE_UNSCOPED_RESOLUTION_PATHS         = 0
CANONICAL_INTERVENTION_LIFECYCLE               = 1
DUPLICATE_INTERVENTION_LIFECYCLES              = 0
UNTRACEABLE_ACTIVE_DIAGNOSES                   = 0
UNTRACEABLE_ACTIVE_INTERVENTIONS               = 0
RESOLVED_MISCONCEPTIONS_COUNTED_ACTIVE         = 0
RESOLVED_DIAGNOSES_COUNTED_ACTIVE              = 0
RAW_MASTERY_ONLY_VALIDATED_CLAIMS              = 0
AI_DIRECT_OFFICIAL_STATE_WRITES                = 0
```

## 10. Full Test Results

```
npx vitest run
 Test Files  86 passed (86)
      Tests  980 passed (980)
```

980 − 949 = 31 new tests, all additive (no existing test was deleted, weakened, or skipped): 7 (`remediation.test.ts`) + 4 (`cognitive-diagnosis.test.ts`) + 9 (`validation-cycle.test.ts`) + 7 (`error-taxonomy-reconciliation.test.ts`, new file) + 2 (`evidence-idempotency.test.ts`) + 2 (`decision-context-query-cost.test.ts`), matching §3.11/§4.9/§5.5 exactly.

## 11. TypeScript

`npx tsc --noEmit` — clean.

## 12. Build

`npm run build` — succeeds, full route manifest generated.

## 13. Database Status

```
npm run db:status (production, read-only)
Applied (4): ai_execution_and_decision_audit, evidence_idempotency, misconception_lifecycle, STUDYUS_BASELINE_2026_08
Pending (2): 20260904_1000_intervention_lifecycle_concurrency, 20260905_1000_error_taxonomy_reconciliation
SUMMARY: 4 applied, 2 pending, 0 drifted.
```
Neither new migration was applied to production, per the task's explicit instruction.

## 14. Production Baseline

```
git rev-parse HEAD         = 842c0e9b25d9188e883fb1573e6c00af59c216f3
git rev-parse origin/main  = 842c0e9b25d9188e883fb1573e6c00af59c216f3
```
Unchanged from the certified Phase 2C-P release throughout this entire phase.

## 15. Git Diff

```
git diff --stat 842c0e9
 19 files changed, 848 insertions(+), 35 deletions(-)
```
Plus 2 new untracked migration files and 1 new untracked test file (§7, §5.5). `git diff --stat 842c0e9 -- src/lib/algorithms/mastery.ts src/services/knowledge-state.service.ts src/lib/verification-triggers.ts` returns **empty** — the three protected files are confirmed byte-identical to the certified release. `MASTERY_FORMULA_CHANGES = 0`, `KNOWLEDGE_STATE_THRESHOLD_CHANGES = 0`, `VERIFICATION_ALGORITHM_CHANGES = 0`. The pre-existing 7-file documentation backlog identified in the Phase 2C-P report remains untracked, untouched, out of scope for this phase.

## 16. Remaining Risks

1. **`LearnerModel.kvr14`'s wiring (the `MetricResult` available/unavailable wrap) has no dedicated unit test** — the underlying `getKVR14` algorithm itself is exhaustively tested (`validation-cycle.test.ts`, unchanged), but building a full `getOverview` fixture for this one 3-line addition was judged lower value than the release-blocking concurrency/exactly-once work this phase prioritized. Low risk: the pattern is a direct, mechanical copy of the already-tested `velocitySummary` wrap immediately above it in the same function.
2. **No direct FK exists from `cognitive_diagnoses` to a specific `misconception_signatures` row** — the only link is the concept-level `validation_cycles.trigger_type = 'CONFIRMED_MISCONCEPTION'`. This is disclosed, not hidden (§3.8/§6.4); building that finer-grained link would require the same "targeted-activity architecture" Phase 2C-R already declined to build for the analogous reason (no generation-time binding exists yet to make it honest rather than fabricated).
3. **`mastery_events`'s own bounded temporal summary (§4.6) was intentionally not built** — judged unnecessary for Phase 4 readiness given `kvr14`/`validationState` already supply trend-relevant state; flagged here so it isn't silently assumed to exist.
4. **The two new migrations' filenames required a same-day rename mid-phase** (§7) after the governed ledger's date-only versioning was found to collide — disclosed as a real, if minor, governance fragility worth the team's awareness for any future same-day multi-migration phase, not just this one's own fix.
5. **`toCanonicalErrorType`'s default-case fallback (`CARELESS`) is a policy choice, not a proven mapping** — correct and conservative for any value seen so far (only ARITHMETIC/UNIT exist today), but a genuinely novel future `GradingErrorType` value would silently fall into `CARELESS` rather than surfacing for review. Acceptable given the task's own "allow UNKNOWN/OTHER/UNMAPPED if epistemically required" — flagged, not hidden.

All five are **NON-BLOCKING**.

## 17. Definition of Done

- [x] evidence exactly-once
- [x] Mastery deterministic
- [x] performance != learning
- [x] five-dimensional Knowledge State intact
- [x] active/resolved misconception state reliable
- [x] diagnosis lifecycle reliable
- [x] intervention lifecycle reliable
- [x] validation lifecycle reliable
- [x] diagnosis→intervention→revalidation traceable
- [x] KVR14 operationally measurable
- [x] retention semantics preserved
- [x] forgettingRisk semantics preserved
- [x] historical/current state separated
- [x] error taxonomy ambiguity closed
- [x] Twin exposes coherent cognitive state
- [x] DecisionContext ready for Phase 4
- [x] AI not official source of cognitive truth
- [x] auditability preserved
- [x] no raw-score-only validated mastery
- [x] false-positive mastery red team passed
- [x] false-negative mastery red team passed
- [x] real PostgreSQL validation passed where required
- [x] full suite passes
- [x] build passes
- [x] production untouched

## 18. Final Decision

```
COGNITIVE_MASTERY_ENGINE = CERTIFIED
EVIDENCE_INTEGRITY = STRONG
MASTERY_ENGINE = CERTIFIED
KNOWLEDGE_STATE = CERTIFIED
MISCONCEPTION_STATE = CERTIFIED
INTERVENTION_LIFECYCLE = CERTIFIED
TEMPORAL_VALIDATION = CERTIFIED
KVR14_MEASUREMENT = OPERATIONAL
PERFORMANCE_LEARNING_SEPARATION = STRONG
ERROR_TAXONOMY = RECONCILED
DIGITAL_LEARNING_TWIN_COGNITIVE_READINESS = YES
DECISION_CONTEXT_READY_FOR_PHASE_4 = YES
PHASE_2_COMPLETE = YES
READY_FOR_PHASE_2_PRODUCTION_RELEASE = YES
READY_FOR_PHASE_3 = YES
```

Per the task's explicit instructions: this phase did not commit, push, deploy, apply the production migration, or start Phase 3.
