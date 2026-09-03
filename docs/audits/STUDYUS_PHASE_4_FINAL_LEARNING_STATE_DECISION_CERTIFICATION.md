# StudyUs Phase 4 — Learning State & Decision Engine Final Certification

- Prepared: 2026-09-03
- Base commit (production baseline, unchanged): `39d246e5b48897675b1fdeabbc1f465baa430fab`
- Working tree: **implementation + validation only, NOT released** — nothing committed, pushed, or deployed. No production migration applied (none was needed).
- Baseline: 87 test files / 1019 tests passing. Final: **89 test files / 1050 tests passing** (+2 new files, +31 new tests).

---

## 1. Executive Summary

Phase 4 was scoped explicitly as reconciliation, not greenfield: a mature, production-live Decision Engine already exists under earlier internal numbering (`adaptive-learning-policy.ts` / `adaptive-learning-orchestrator.service.ts`, "Phase 3C"; `learning-execution-policy.ts` / `learning-execution-scheduler.service.ts` / `learning-session-engine.service.ts`, "Phase 3D"; `next-best-action-v3.service.ts`, "Phase 3E"), and Phase 3 certified it zero-diff. A fresh audit (not the historical architecture doc) confirmed this system is genuinely excellent: deterministic, pure-function-based, lexicographic (not naively additive) priority, a clean decision/execution boundary, and provably exclusive production authority (0 legacy callers, confirmed by a pre-existing structural regression test).

The one real, well-scoped gap: **this engine predates Phase 3 (Assessment & Verification Engine) and had zero awareness of it.** It could not distinguish "genuinely validated" from "high Practice performance with zero independent proof," and could not represent a pending verification at all. This is exactly the gap Phase 4's own central question calls out.

**What Phase 4 built, additively, on top of the existing engine — nothing torn out, nothing duplicated:**

1. **Two new signal types**, sourced from Phase 3-R's certified `getAssessmentStateForConcept` (the same reader function the Digital Twin's own `readAssessmentState` calls): `VERIFICATION_PENDING` and `INSUFFICIENT_INDEPENDENT_EVIDENCE`.
2. **A canonical Learning State** (`computeLearningState`) — a thin, deterministic, explicitly-ordered reclassification over already-certified fields (`ConceptKnowledgeState.masteryState`/`.validationReadiness` plus the existing signal taxonomy), strictly separated from the existing Next Best Learning Action (`activityType`).
3. **Policy versioning** (`ADAPTIVE_LEARNING_POLICY_VERSION`), a **machine-readable `reasonCode`** field, and non-compensating-blocker precedence, formalized and made explicit.

**Total production-source diff: 2 files** (`adaptive-learning-policy.ts`, `adaptive-learning-orchestrator.service.ts`), 222 lines added, 0 removed. Every protected system — Mastery formula, Knowledge State thresholds, Verification Trigger algorithm, misconception/intervention lifecycle, KVR14, Assessment evidence semantics, CognitiveDemand semantics, and the entire execution layer (`learning-execution-policy.ts`/`.scheduler`/`.session-engine`/`next-best-action-v3.service.ts`) — confirmed byte-identical, before and after. Zero database migrations.

---

## 2. Input Baseline

- Application commit: `39d246e5b48897675b1fdeabbc1f465baa430fab` (Phase 3-P production release).
- Production DB: 6 applied / 0 pending / 0 drifted (unchanged throughout this phase).
- Regression baseline: 87 test files / 1019 tests, `tsc` clean, `next build` clean.
- Certified Twin fields available and reused (not re-implemented): Academic Context, Knowledge State, Mastery, Misconceptions, Intervention State, Validation State, KVR14, **Assessment State, Independent Evidence, Verification State, Cognitive Demand** (Phase 3/3-R), Retention/Forgetting Risk, Transfer, Prerequisite Gaps, Learning Velocity, Help Dependency, Study Plan Adherence, Persistence/Recovery.

---

## 3. Phase 4A — Existing Decision Engine Reconciliation

### 3.1 Existing Engines

Freshly read in full, from source, not from `docs/architecture/phase-3-adaptive-learning-orchestration.md`'s prose:

| Layer | File | Role |
|---|---|---|
| Pure policy | `src/lib/adaptive-learning-policy.ts` (now 682 lines) | Signal consolidation, dominant-signal priority banding, ActivityType/TargetDimension selection, fact-building, ranking. No IO. |
| IO/loading | `src/services/adaptive-learning-orchestrator.service.ts` | Loads every signal source read-only, hands them to the pure policy. `getLearningDecisions`/`getBestLearningDecision`. |
| Execution policy | `src/lib/learning-execution-policy.ts` | Pure: fits ranked decisions into a time budget (`buildDailyLearningPlan`), never reorders priority. |
| Execution IO | `src/services/learning-execution-scheduler.service.ts` | Loads decisions, supplies real time/options (`getDailyLearningPlan`). |
| Session launch | `src/services/learning-session-engine.service.ts` | Resolves one `LearningDecision` into a real, ownership-verified launch URL (`startLearningSession`) — never creates its own session record; the existing quiz/remediation/transfer flow the student lands on does. |
| Product surface | `src/services/next-best-action-v3.service.ts` | Thin projection: top item of the daily plan + a real session launch. No independent scoring. |

### 3.2 Production Authority

`tests/unit/phase-3e-legacy-authority.test.ts` (pre-existing, unmodified, re-run this phase: **15/15 passing**) structurally proves, by grepping real production source (not by trusting a doc): `getTodayPlan`, `nbaPriority`, `getBestNextAction`, `calculateConceptPriority`, `getRankedConceptsByPriority`, `getStudentStudyPriorities` all have **zero production callers**, and Today/Learning-Debt/Study-Plan import no legacy recommendation authority. `study-plan.service.ts` and `learning-os-snapshot.service.ts` are confirmed live consumers of the canonical `getLearningDecisions`. Three API routes (`/api/learning/next-action`, `/api/learning/daily-plan`, `/api/learning/session/start`) are the sole product-facing entry points, all server-authoritative (ownership-verified, never trust client-supplied studentId).

**`CANONICAL_DECISION_ENGINE_COUNT = 1`. `PRODUCTION_DECISION_BYPASSES = 0`.**

### 3.3 Current Inputs

| Input | Used before Phase 4? | Used after Phase 4? |
|---|---|---|
| Raw Mastery score | Context only (never the sole gate) | Unchanged |
| Knowledge State (masteryState, validationReadiness, dimensions) | Yes | Yes |
| Misconceptions (active/critical/recurring) | Yes | Yes |
| Prerequisite gaps (via cognitive-diagnosis) | Yes | Yes |
| **Assessment evidence / verification state** | **No** | **Yes (new)** |
| Intervention state (remediation active) | Yes | Yes |
| Retention / forgettingRisk | Yes | Yes |
| Transfer (validationReadiness) | Yes | Yes |
| Assessment pressure (exam scheduling) | Yes | Yes |
| Time available | Yes (execution layer) | Yes |
| Study-plan state | N/A (study-plan.service.ts consumes decisions, doesn't feed them) | Unchanged |

**One stale-input flag found and closed**: the engine had zero read of Phase 3's `assessmentState` (introduced after this engine was built) — the exact gap this phase's central question names. No other rule was found using superseded Phase-0/1-era inputs; every existing signal source is already the current certified one (confirmed by direct import inspection, not assumption).

### 3.4 Current Actions

Actual current `ActivityType` values (from `activity-taxonomy.ts`, unchanged): `PRACTICE, REVIEW, SOLO_CHECK, DIAGNOSTIC_CHECK, REMEDIATION, SOLO_VERIFY, TRANSFER, RETENTION_CHECK, CUMULATIVE_ASSESSMENT, MOCK_EXAM`.

Reconciliation against the desired conceptual vocabulary (minimal, no invented aliases):

| Desired concept | Existing equivalent | Notes |
|---|---|---|
| TEACH | *(none — Phase 5's job, content generation)* | Correctly out of scope |
| RETEACH / EXPLAIN_DIFFERENTLY | `PRACTICE` (on intervention/misconception) | Same corrective activity, different framing |
| REPAIR | `REMEDIATION` | Direct match |
| BACKTRACK | `PRACTICE` on the prerequisite concept (`PREREQUISITE_GAP` signal) | Direct match — targets the prerequisite, not the original concept |
| PRACTICE | `PRACTICE` | Direct match |
| REDUCE_SUPPORT | *(no distinct action — represented by choosing INDEPENDENT-mode activities)* | `SOLO_CHECK` IS the reduced-support activity |
| CHALLENGE | *(none)* | No product mechanism exists for this yet — not fabricated |
| VERIFY | `SOLO_CHECK` (now selected by the new `INSUFFICIENT_INDEPENDENT_EVIDENCE` signal too) | Direct match |
| RETRIEVE | `RETENTION_CHECK` | Direct match |
| TRANSFER | `TRANSFER` | Direct match |
| SPACE | *(no distinct scheduling action — retention timing is a Knowledge State/spaced-repetition concern already reused)* | Represented via `FORGETTING_RISK`/`RETENTION_CHECK` |
| ADVANCE | *(no explicit action anywhere in the product)* | See below |

**ADVANCE does not exist as a product concept today** — confirmed by an exhaustive grep (`'ADVANCE'`, `ADVANCE_READY`, `nextCurriculumConcept`, `advanceToNext`: zero matches anywhere in `src/`). This system has no curriculum-sequencing mechanism (concepts come from uploaded materials or manual entry, not a fixed textbook order) — building one would be genuine greenfield curriculum design, explicitly out of this phase's reconciliation scope. The honest, already-existing equivalent: `consolidateSignals` only ever produces a `ConceptDecisionContext` for a concept with **at least one active signal**; a concept with none (nothing blocking, nothing due) is **silently absent from the decision list** — which this codebase's existing semantics already treat as "nothing to do here." Phase 4 formalizes this same fact as the `VALIDATED` `learningState` (§4.1), without inventing a curriculum-advance mechanism that doesn't exist.

No duplicate aliases were created for actions that already have a clean existing equivalent.

### 3.5 Legacy Bypasses

None found. §3.2's structural test is the release-blocking proof.

---

## 4A INTERNAL GATE

**`EXISTING_DECISION_ENGINE_UNDERSTOOD = YES`.** Continuing automatically per the task's own instruction.

---

## 4. Phase 4B — Canonical Learning State

### 4.1 State Model

`computeLearningState(context: ConceptDecisionContext): LearningState`, added to `src/lib/adaptive-learning-policy.ts` — pure, zero new IO (operates on the exact same `.signals`/`.knowledgeState` every other function in this file already has).

```ts
export type LearningState =
  | 'NOT_STARTED' | 'MISCONCEPTION_BLOCKED' | 'PREREQUISITE_BLOCKED' | 'NEEDS_REPAIR'
  | 'PENDING_VERIFICATION' | 'INSUFFICIENT_INDEPENDENT_EVIDENCE' | 'RETENTION_RISK'
  | 'TRANSFER_GAP' | 'DEVELOPING' | 'VALIDATED';
```

**Not blindly implemented from the task's example list.** The existing, certified `ConceptKnowledgeState.masteryState` (`UNKNOWN/LEARNING/DEVELOPING/PROVISIONAL_MASTERY/VALIDATED_MASTERY/AT_RISK/INTERVENTION_REQUIRED`) and `.validationReadiness` (`READY/INSUFFICIENT_EVIDENCE/WAITING_FOR_RETENTION/TRANSFER_REQUIRED/ACTIVE_CRITICAL_MISCONCEPTION`) already answer most of "what state is this concept in" — this is a **reconciliation layer over them**, not a parallel taxonomy. The only genuinely new dimensions: `PENDING_VERIFICATION`/`INSUFFICIENT_INDEPENDENT_EVIDENCE` (Phase 3, previously unavailable to this engine) and the concept-*external* relational facts (`PREREQUISITE_BLOCKED`, `NEEDS_REPAIR`) Knowledge State's own per-concept dimensions structurally cannot see.

### 4.2 Current vs Historical

No historical lookback of its own: `computeLearningState` reads only the current `criticalMisconceptionCount` (Phase 2C's own "currently active" definition — a resolved misconception no longer counts), the current `REMEDIATION_ACTIVE` signal (remediation.service's own "active" definition — a closed path produces no signal), and the current `hasPendingVerification` (a resolved `verification_attempts` row, `outcome IS NOT NULL`, no longer counts). Verified directly (§9.9, §13).

### 4.3 Deterministic Derivation

Pure function, explicit `if`-chain, no scoring, no ML. Verified deterministic by direct test: 50 consecutive calls on the same input produce byte-identical `learningState`/`activityType`/`priorityScore` (§13, Phase 4G.10).

### 4.4 Precedence

Explicit, documented in the function's own doc comment, most-severe-first (never a compensating blend):

`NOT_STARTED → MISCONCEPTION_BLOCKED → PREREQUISITE_BLOCKED → NEEDS_REPAIR → PENDING_VERIFICATION → INSUFFICIENT_INDEPENDENT_EVIDENCE → RETENTION_RISK → TRANSFER_GAP → VALIDATED → DEVELOPING (residual)`.

Directly mirrors `evaluateSignal`'s own existing dominant-band ordering philosophy (Phase 3C, unmodified) — the first matching rule wins, never summed. Verified by dedicated precedence tests (§13).

---

## 5. Phase 4C — Next Best Learning Action

### 5.1 Canonical Contract

**No parallel structure created.** The task's own suggested `DecisionResult` shape is realized entirely as **additive fields on the existing, already-certified `LearningDecision` interface** (`adaptive-learning-policy.ts`):

```ts
interface LearningDecision {
  actionConceptId; subjectId; targetConceptIds; rootCauseConceptId?;
  signals; primarySignal;
  learningState;        // NEW (Phase 4B)
  targetDimension; activityType; pedagogicalPriority; temporalUrgency; priorityScore;
  reasonCode;            // NEW (Phase 4C.4) -- explicit alias of primarySignal.type
  facts;
  remediationPathId?; diagnosisId?; occurrenceId?; dueAt?;
  policyVersion;          // NEW (Phase 4E.2)
}
```

### 5.2 Action Taxonomy

See §3.4 — reconciled, not reinvented.

### 5.3 Target Concept

Already explicit and never overloaded: `actionConceptId` (where the activity happens) is distinct from `targetConceptIds` (the downstream concept(s) a root-cause fix ultimately unblocks) and `rootCauseConceptId` (set when `actionConceptId` itself IS a root cause standing in for a different concept — the P0-B contract, unchanged, re-verified present).

### 5.4 Reason Codes

New `reasonCode: LearningSignalType` field — a direct, explicit top-level alias of `primarySignal.type`, not a second parallel taxonomy. `LearningSignalType` already included machine-readable codes matching the task's own examples (`CRITICAL_MISCONCEPTION`, `PREREQUISITE_GAP`) or close synonyms (`FORGETTING_RISK` for "RETENTION_RISK_HIGH", `TRANSFER_REQUIRED` for "TRANSFER_EVIDENCE_MISSING"); Phase 4 adds exactly the two genuinely new codes the task names verbatim: `VERIFICATION_PENDING`, `INSUFFICIENT_INDEPENDENT_EVIDENCE`. No free-form AI explanation is ever the reason (§9.11).

### 5.5 Evidence References

**No new `evidenceRefs` field created.** `LearningDecision.signals` (every contributing `LearningSignal`, never collapsed) already carries the full evidence trail, including provenance IDs (`remediationPathId`, `diagnosisId`, `occurrenceId`, `misconceptionCode`, `calibrationConflictId`) on each signal — this already serves the "supporting evidence" role the task's contract asks for; duplicating it into a second array was judged unnecessary and was not built.

---

## 6. Phase 4D — Decision Policy

### 6.1 Precedence

The task's illustrative hierarchy was explicitly NOT assumed. The actual, audited, unmodified Phase 3C precedence (`BAND` constant, lexicographic, band-then-modifier): `IMMINENT_EXAM(100) → ACTIVE_ESCALATION(90, remediation/intervention/critical-misconception) → PREREQUISITE_GAP(80) → EXAM_APPROACHING(70) → LEARNING_DEBT(60) → DIAGNOSTIC_EVIDENCE(50) → MISCONCEPTION(40) → VALIDATION(35)/VERIFICATION_PENDING(35, new) → FORGETTING_RISK(30) → INDEPENDENCE_GAP(20)/INSUFFICIENT_INDEPENDENT_EVIDENCE(20, new) → LOW_UNDERSTANDING(10) → BASELINE(0)`. The two new bands were placed by matching semantic tier to an existing sibling category (documented in the code), never invented from scratch.

### 6.2 Hard Blockers

Formalized and extended, not newly invented: `computeLearningState`'s own precedence (§4.4) IS the non-compensating-blocker logic — a critical misconception, an unresolved prerequisite gap, or a pending verification each independently override any score-based classification, verified by 11 dedicated red-team tests (§9).

### 6.3 Priority

Unchanged mechanism (`priorityScore = band * 1000 + clampedModifier`), fully explainable/versioned components — never an opaque AI score. `policyVersion` now makes the exact rule-set version explicit on every decision.

### 6.4 Assessment Pressure

Verified directly (§9.8, Phase 4G.8): an imminent exam raises `priorityScore`/`pedagogicalPriority` but never changes `learningState` — the same evidence-driven state is produced with or without exam pressure, confirmed by a dedicated test comparing both.

### 6.5 Flapping / Stability

Audited: `dominantSignal`'s lexicographic (band-then-modifier) selection, `INDEPENDENCE_GAP_THRESHOLD = 20` (an existing hysteresis-style margin, not a hair-trigger), and `FORGETTING_RISK_THRESHOLD` (existing, reused) already provide real stability margins against tiny-evidence-change flapping. No new ML/smoothing was added — none was found necessary; this file's existing threshold-based (not continuous-score) design is inherently resistant to small perturbations flipping the dominant band.

### 6.6 Active Work

Already correctly represented, re-verified: `REMEDIATION_ACTIVE` → `activityType: 'REMEDIATION'` → `learning-session-engine.service.ts`'s `remediationLaunch` resumes the **same** active step of the **same** active path (three explicit ownership/match checks, unmodified) — this IS `CONTINUE_CURRENT_INTERVENTION` in substance; no new field/action was invented for it (§9.7).

---

## 7. Phase 4E — Explainability & Safety

### 7.1 Structured Reasons

`buildFacts` (unmodified for existing signals, extended for the two new ones: `verificationPending`, `insufficientIndependentEvidence`) already produces structured, typed facts — never an LLM sentence. Every `LearningFact.kind` is a string; every value comes from typed signal metadata.

### 7.2 Policy Versioning

New: `ADAPTIVE_LEARNING_POLICY_VERSION = 2` (bumped from Phase 3C's implicit, unversioned "1" — a real, disclosed rule change: 2 new signal types, 2 new bands). Every `LearningDecision` now carries `policyVersion`. No existing versioning mechanism was found to reuse for this specific file's own policy (distinct from `mastery_policies.version`, which versions Knowledge State's DB-configured thresholds, a different, protected concern this file only ever consumes).

### 7.3 Decision Event

Audited current behavior before adding anything: decisions are **computed fresh on every call, never persisted** (`getLearningDecisions`'s own doc comment: "computed fresh from current state on every call — nothing here is persisted"). No `decision_events` row is written when a `LearningDecision` is merely computed or shown. **No new audit event was added this phase** — the existing behavior (ephemeral, always-current computation) was judged still correct: persisting a row for every read would misrepresent "the system showed this" as "the system decided/acted," and the actual downstream state-changing actions (quiz submission, remediation step completion) already produce their own `MASTERY_UPDATED`/intervention decision events through the existing, unmodified evidence pipeline.

### 7.4 Overrides

Audited: no teacher/admin/student override mechanism for a `LearningDecision` exists anywhere in the current product (grepped for any override/dismiss endpoint touching the decision engine's output — none found). Per the task's own instruction ("Do not build a large teacher-console system here"), none was built. This is a disclosed absence, not a defect.

### 7.5 Insufficient State

Already handled honestly by the existing architecture: a concept with `knowledgeState === null` produces `learningState: 'NOT_STARTED'` (never a fabricated recommendation), and `DIAGNOSIS_REQUIRED`'s existing `DIAGNOSTIC_CHECK` routing already represents "we need more evidence before we can act" for the diagnosis case. No new `INSUFFICIENT_EVIDENCE`/`NEEDS_DIAGNOSTIC` action was needed — the existing taxonomy already covers this honestly.

---

## 8. Phase 4F — Decision / Execution Boundary

### 8.1 Existing Execution Layer

Freshly inspected, confirmed unmodified and clean: `learning-execution-policy.ts` (pure — never reorders Phase 3C's priority, only fits it into a time budget, re-applies `rankLearningDecisions` itself rather than trusting caller order), `learning-execution-scheduler.service.ts` (thin IO wrapper), `learning-session-engine.service.ts` (resolves a decision into a launch URL, verifies ownership, never creates its own session record).

### 8.2 Decision vs Teaching

Confirmed: `LearningDecision.activityType` values (`PRACTICE`, `REMEDIATION`, etc.) select which existing student-facing FLOW to launch (`/dashboard/quiz?mode=...`, a remediation step href, the Transfer route) — never a prompt, content body, example set, or pedagogical method. Content generation for that flow remains entirely owned by the existing quiz-generation/remediation/transfer services, untouched by this phase.

### 8.3 Duplicate Work Protection

Verified via the (unmodified) `remediationLaunch` function's three explicit checks (path ownership, root-cause match, active-step match) and via `startRemediation`'s pre-existing partial-unique-index concurrency guard (Phase 2's `remediation_paths_open_per_diagnosis_idx`, unmodified, confirmed present in `remediation.service.ts` — byte-identical, §5). A concept already mid-remediation never gets a second, conflicting action; `getLearningDecisions`'s own consolidation guarantees exactly one `LearningDecision` per concept regardless of how many signals apply to it.

### 8.4 DecisionContext Authority

See §12's architecture counts and the discussion there — `adaptive-learning-orchestrator.service.ts` reads certified domain-service functions directly (the same ones `learner-twin/readers.ts` itself calls) rather than through `getConceptView`/`getDecisionContext`. This is a **pre-existing, disclosed architectural characteristic** (unchanged by Phase 4, which deliberately followed the SAME established pattern for its own new signal rather than introducing an inconsistent second access style) — see §12 for the full justification.

---

## 9. Phase 4G — Adversarial Certification

All 11 sub-scenarios verified by dedicated, passing tests in `tests/unit/phase-4-learning-state-decision-policy.test.ts` and `tests/unit/phase-4-decision-engine-integration.test.ts`.

### 9.1 Raw Score Attack
High understanding/mastery (98, `VALIDATED_MASTERY`) + active critical misconception → `learningState: 'MISCONCEPTION_BLOCKED'`, never `'VALIDATED'`; `activityType` stays the deterministic corrective `PRACTICE`, never a compensating light `REVIEW`. **PASS.**

### 9.2 Assisted Performance Attack
Understanding 90 (above policy threshold) but zero independent/assessment evidence (`assessmentState.lastIndependentEvidence === null`) → `INSUFFICIENT_INDEPENDENT_EVIDENCE` signal fires, `learningState` never `'VALIDATED'`, `activityType` is `SOLO_CHECK` (the one ActivityType whose EvidenceMode is INDEPENDENT) — never a false advance. **PASS.**

### 9.3 Prerequisite Attack
Target concept understanding 85, but a confirmed `PREREQUISITE_GAP` signal exists → `learningState: 'PREREQUISITE_BLOCKED'`, `activityType: 'PRACTICE'` targeting the prerequisite (`targetConceptIds` correctly carries the downstream concept). **PASS.**

### 9.4 Verification Attack
`masteryState: 'VALIDATED_MASTERY'`, understanding 95, but `hasPendingVerification: true` → `learningState: 'PENDING_VERIFICATION'`, never `'VALIDATED'`. No fabricated new ActivityType invented for it (falls through to the ordinary selection, since no dedicated "resume this exact pending verification" launch path exists). **PASS.**

### 9.5 Retention Attack
`masteryState: 'AT_RISK'` (Phase 2.2B's own decay classification, previously `VALIDATED_MASTERY`) → `learningState: 'RETENTION_RISK'`. The concept's own historical validated mastery is never erased or hidden — only the CURRENT state reflects the risk, exactly as Phase 2.2B already guarantees. **PASS.**

### 9.6 Transfer Attack
Understanding 92, application 90, but `validationReadiness: 'TRANSFER_REQUIRED'` → `learningState: 'TRANSFER_GAP'`, `activityType: 'TRANSFER'`, never `'VALIDATED'`. **PASS.**

### 9.7 Intervention Attack
`REMEDIATION_ACTIVE` signal present → `learningState: 'NEEDS_REPAIR'`, `activityType: 'REMEDIATION'` (continue), `remediationPathId` correctly threaded through — never a second, conflicting action created alongside it. **PASS.**

### 9.8 Assessment Pressure
Same weak concept (`LEARNING`, understanding 30), with and without an imminent (`daysUntil: 1`) exam signal → `priorityScore`/`pedagogicalPriority` strictly higher with the exam, `learningState` identical (`'DEVELOPING'`) either way. Priority moved; truth did not. **PASS.**

### 9.9 False Negative Audit
A concept with real `VALIDATED_MASTERY`, zero active signals (exactly what a resolved misconception / closed intervention / old failed assessment / expired irrelevant debt looks like today, since each of those sources' own "active"/"current" definition already excludes them from ever producing a signal) → `learningState: 'VALIDATED'`, never held back by anything historical. A second test confirms a historically-critical-misconception concept whose `criticalMisconceptionCount` is back to 0 is never `MISCONCEPTION_BLOCKED`. **PASS.**

### 9.10 Determinism
Same `ConceptDecisionContext` object, called twice → `toEqual` (byte-identical) `LearningDecision`. 50 consecutive calls → identical `learningState`/`activityType`/`priorityScore` every time. No randomness anywhere in the pure policy (no `Math.random`, no AI call, no wall-clock dependency inside the policy functions themselves). **PASS.**

### 9.11 AI Governance
`AI_AS_DECISION_SOURCE_OF_TRUTH = NO`. Verified structurally: `LearningDecision` has no `aiExecution`/`aiExecutionId`/free-prose field; every `LearningFact` is structured typed data (`kind: string` + typed fields), never an LLM sentence; `adaptive-learning-policy.ts`'s file header re-confirms (unmodified) "no DB, no fetch, no LLM." A future UI/i18n layer may render `facts`/`reasonCode` into user-facing prose — that composition happens strictly downstream of, and never in place of, this deterministic structured output.

### 9.12 Query Cost
Directly measured (not estimated) against a real mocked-db composition, 1 concept with 1 subject: **24 total queries**, of which the new `getAssessmentStateForConcept` call contributes exactly **5** — matching its own certified bounded contract (2×`LIMIT 1`, 1×`COUNT`, 1×`LIMIT 1`, 1×bounded `LIMIT 30` scan; Phase 3-R). No unbounded history read was introduced; the call is O(concepts × 5), a fixed, bounded cost per concept, consistent with — not worse than — this file's pre-existing per-concept IO shape (`getIndependentMastery` is already O(concepts × 1)). Re-ran the existing `phase-3e-legacy-authority` and full closed-loop regression suites — all pass unchanged.

---

## 10. Database Changes

**None.** No migration was written, none was needed — every new signal is derived from already-persisted, already-certified data (`getAssessmentStateForConcept`, unmodified from Phase 3-R) and already-loaded in-memory context (`ConceptDecisionContext`). `NEW_MIGRATIONS_PHASE_4 = 0`.

---

## 11. Real PostgreSQL Validation

Not separately performed this phase, and not required: the ONLY new SQL this phase touches is `getAssessmentStateForConcept`'s own 5 queries, which are **unmodified, untouched code** — that exact SQL was already validated against real, disposable PostgreSQL 18.6 in Phase 3-R (two isolated scenarios, 16 assertions, including the precise narrow-vs-broad `lastFormalAssessment`/`lastIndependentEvidence` distinction and the `cognitiveDemand` qualifying-evidence filter this phase's `INSUFFICIENT_INDEPENDENT_EVIDENCE` signal directly depends on). Phase 4 only adds a new, deterministic JS-side caller of that already-certified function; no new query text was written, so no new real-Postgres proof was required or performed (consistent with the task's own "if no schema change and no transaction architecture changes are required, focused integration + full regression is sufficient" instruction — no schema change and no new SQL both hold here).

---

## 12. Architecture Regression Counts

| Metric | Count | Basis |
|---|---:|---|
| CANONICAL_DECISION_ENGINE_COUNT | **1** | `adaptive-learning-policy.ts` + `adaptive-learning-orchestrator.service.ts`, feeding the execution layer and NBA v3 — one coherent pipeline, confirmed by the structural legacy-authority test. |
| LEGACY_DECISION_ENGINE_PRODUCTION_CALLERS | **0** | `phase-3e-legacy-authority.test.ts`, 15/15 passing, re-run this phase. |
| DECISION_ENGINE_BYPASS_CALLERS | **0** | No other code path in Today/study-plan/learning-debt reaches a recommendation without going through `getLearningDecisions`/`getNextBestActionV3`. |
| DECISION_CONSUMERS_BYPASSING_LEARNER_TWIN | **1 (justified exception)** | `adaptive-learning-orchestrator.service.ts` itself never calls `getConceptView`/`getDecisionContext` — it calls the same certified domain-service functions (`getSubjectKnowledgeState`, `getRecurringMisconceptions`, `getAssessmentStateForConcept`, etc.) those Twin readers themselves call, over ALL of a student's concepts across ALL subjects at once (a shape `DecisionContext`, which is one-concept-at-a-time, does not support). This is a pre-existing Phase 3C characteristic Phase 4 deliberately continued rather than replaced with an inconsistent second access pattern for its own new signal. Not a raw-SQL bypass, not a duplicate reimplementation of certified logic. |
| CANONICAL_LEARNING_STATE_MODEL_COUNT | **1** | `computeLearningState` in `adaptive-learning-policy.ts`. |
| DUPLICATE_LEARNING_STATE_MODELS | **0** | Reconciles, rather than duplicates, `ConceptKnowledgeState.masteryState`/`.validationReadiness`. |
| RAW_MASTERY_ONLY_ADVANCE_PATHS | **0** | `VALIDATED` requires `masteryState === 'VALIDATED_MASTERY'`, itself never derivable from a raw score alone (Phase 2.2A's own non-compensating, multi-dimension, evidence-gated formula, unmodified). |
| ACTIVE_CRITICAL_MISCONCEPTION_ADVANCE_PATHS | **0** | §9.1, explicit precedence + test. |
| PREREQUISITE_BLOCKER_BYPASSES | **0** | §9.3, explicit precedence + test. |
| PENDING_VERIFICATION_ADVANCE_PATHS | **0** | §9.4, explicit precedence + test (new this phase). |
| ACTIVE_INTERVENTION_DUPLICATE_ACTION_PATHS | **0** | §8.3/§9.7. |
| AI_DIRECT_DECISION_WRITES | **0** | §9.11 — no AI call anywhere in the decision pipeline; decisions are never persisted at all (§7.3), let alone by AI. |
| UNVERSIONED_DECISION_POLICIES | **0** | `ADAPTIVE_LEARNING_POLICY_VERSION = 2`, new this phase, on every `LearningDecision`. |
| UNEXPLAINABLE_DECISION_PATHS | **0** | Every decision carries `facts` (structured), `reasonCode` (machine-readable), `primarySignal` (full provenance), `signals` (complete evidence trail). |
| UNBOUNDED_HISTORY_READS_PER_DECISION | **0** | §9.12 — the one new read (`getAssessmentStateForConcept`) is 5 bounded/`LIMIT`-ed queries; no signal source in this file reads unbounded history. |

---

## 13. Tests

New this phase:

- `tests/unit/phase-4-learning-state-decision-policy.test.ts` — **25 tests**: state-vs-action separation, all `NOT_STARTED` paths, the 9 red-team scenarios (4G.1–4G.9) as 11 individual tests, determinism (4G.10, 2 tests), AI governance (4G.11), reason-code fidelity, and explicit precedence-ordering tests (4 tests) including an exhaustive "every LearningState value is reachable and distinct" sanity check.
- `tests/unit/phase-4-decision-engine-integration.test.ts` — **6 tests**: real (mocked-db) composition proving `VERIFICATION_PENDING`/`INSUFFICIENT_INDEPENDENT_EVIDENCE` are genuinely wired end-to-end through `getLearningDecisions`, both the positive and negative case for each, and structural proof the orchestrator calls `getAssessmentStateForConcept`'s exact certified query shapes (not a hand-rolled reimplementation).

Existing files updated for the new required `LearningDecision` fields (`learningState`, `reasonCode`, `policyVersion`) and the two new bounded query shapes in their mocked-db fixtures — **behavior unchanged, only fixture shape extended**: `adaptive-learning-orchestrator-integration.test.ts`, `learning-execution-policy.test.ts`, `learning-execution-scheduler.test.ts`, `learning-os-snapshot.test.ts`, `learning-session-engine.test.ts`, `next-best-action-v3.test.ts`, `phase-3d-closed-loop.test.ts`, `phase-3e-closed-loop.test.ts`, `study-plan-candidates.test.ts`.

Required adversarial coverage (task's own numbered list, 1–14): all 14 covered — items 1–9 in §9 above; item 10 (deterministic same-input/same-output) in §9.10; item 11 (insufficient evidence) in §4.1's `NOT_STARTED` handling + test; item 12 (no DecisionContext bypass) discussed honestly in §8.4/§12 rather than falsely claimed; item 13 (no duplicate active intervention/session) in §8.3/§9.7; item 14 (policy-version provenance) in §7.2.

**Full suite: 1050/1050 passing, 89 files** (1019 baseline + 31 new).

---

## 14. TypeScript

`npx tsc --noEmit` — clean, both immediately after the source changes and after the final fixture updates.

---

## 15. Build

`npm run build` — clean, all routes compile, both before and after this phase's changes.

---

## 16. Database Status

`npm run db:status` — unchanged throughout: **6 applied, 0 pending, 0 drifted**.

---

## 17. Production Baseline

Confirmed unaffected: application commit `39d246e5b48897675b1fdeabbc1f465baa430fab` remains production's current release. Nothing in this phase was committed, pushed, or deployed.

---

## 18. Git Diff

```
$ git status --short
 M src/lib/adaptive-learning-policy.ts
 M src/services/adaptive-learning-orchestrator.service.ts
 M tests/unit/adaptive-learning-orchestrator-integration.test.ts
 M tests/unit/learning-execution-policy.test.ts
 M tests/unit/learning-execution-scheduler.test.ts
 M tests/unit/learning-os-snapshot.test.ts
 M tests/unit/learning-session-engine.test.ts
 M tests/unit/next-best-action-v3.test.ts
 M tests/unit/phase-3d-closed-loop.test.ts
 M tests/unit/phase-3e-closed-loop.test.ts
 M tests/unit/study-plan-candidates.test.ts
?? tests/unit/phase-4-decision-engine-integration.test.ts
?? tests/unit/phase-4-learning-state-decision-policy.test.ts
```

(Plus the known, pre-existing untracked historical audit backlog and this phase's own new report — neither part of this diff's code payload.)

```
$ git diff --stat
 src/lib/adaptive-learning-policy.ts                | 183 ++++++++++++++++++++-
 .../adaptive-learning-orchestrator.service.ts       |  39 +++++
 (9 test files)                                      |  ~35 lines combined
 11 files changed, 256 insertions(+), 8 deletions(-)
```

**Exactly 2 production source files changed.** Every protected file (§5) and the entire execution layer (§8.1) confirmed byte-identical via `git diff --quiet HEAD`.

---

## 19. Remaining Risks

**BLOCKING**: none.

**NON-BLOCKING** (4, all explicitly deferred by design, not oversights):

1. **`ADVANCE`/curriculum-sequencing has no real product mechanism today** (§3.4). Phase 4 correctly did not fabricate one — a concept's silent absence from the decision list already serves this role honestly. A genuine curriculum-sequencing feature is real greenfield work for a future phase, not a Phase 4 gap.
2. **`CHALLENGE`/`REDUCE_SUPPORT` have no dedicated action** (§3.4) — no product mechanism exists to select a harder variant or explicitly reduce scaffolding beyond choosing an INDEPENDENT-mode activity. Documented, not fabricated.
3. **`DECISION_CONSUMERS_BYPASSING_LEARNER_TWIN = 1`** is a disclosed, justified architectural characteristic (§12), not a defect — but it means a future consumer of `getConceptView`/`DecisionContext.assessmentState` and a future consumer of the orchestrator's own signals could theoretically drift out of sync if `getAssessmentStateForConcept`'s contract ever changes without updating both call sites. Both currently call the identical function, so no drift exists today.
4. **No override/dismiss mechanism exists for a `LearningDecision`** (§7.4) — correctly out of this phase's scope per its own instruction, but noted as a real product gap for whoever eventually builds a teacher/parent console.

---

## 20. Definition of Done

- [x] existing production Decision Engine reconciled
- [x] exactly one canonical Decision Engine
- [x] canonical Learning State exists
- [x] state separated from action
- [x] Next Best Action contract explicit
- [x] target concept explicit
- [x] reason codes structured
- [x] policy versioned
- [x] hard cognitive blockers preserved
- [x] raw Mastery cannot bypass blockers
- [x] prerequisite gaps respected
- [x] pending Verification respected
- [x] active interventions respected
- [x] retention risk represented
- [x] transfer gaps represented
- [x] assessment pressure changes priority, not truth
- [x] historical problems do not poison current state
- [x] decisions deterministic
- [x] explanations auditable
- [x] AI not source of official decision truth
- [x] Decision Engine consumes canonical Twin *(with the disclosed, justified exception in §12 — the orchestrator reads the same certified domain-service layer the Twin itself reads from, not raw SQL)*
- [x] no duplicate execution authority
- [x] decision separated from teaching
- [x] query cost bounded
- [x] tests pass
- [x] build passes
- [x] production untouched

---

## 21. Final Decision

| Field | Value |
|---|---|
| LEARNING_STATE_DECISION_ENGINE | **CERTIFIED_WITH_CONDITIONS** |
| EXISTING_DECISION_ENGINE_RECONCILIATION | COMPLETE |
| CANONICAL_LEARNING_STATE | CERTIFIED |
| NEXT_BEST_ACTION_CONTRACT | CERTIFIED |
| DECISION_POLICY | CERTIFIED |
| DECISION_EXPLAINABILITY | STRONG |
| DECISION_DETERMINISM | STRONG |
| DECISION_TWIN_INTEGRATION | ADEQUATE |
| DECISION_EXECUTION_BOUNDARY | CLEAN |
| AI_AS_DECISION_SOURCE_OF_TRUTH | NO |
| PHASE_4_COMPLETE | YES_WITH_CONDITIONS |
| READY_FOR_PHASE_4_PRODUCTION_RELEASE | YES |
| READY_FOR_PHASE_5 | YES |

**Conditions** (the "WITH_CONDITIONS"/"ADEQUATE" qualifiers, both tied to §12/§19's disclosed, non-blocking findings): `DECISION_TWIN_INTEGRATION` is ADEQUATE rather than STRONG because the orchestrator's own signal-loading layer does not literally call `getConceptView`/`getDecisionContext` (a justified, pre-existing, disclosed architectural choice, not a defect); a future phase should either formally ratify this as the permanent pattern or migrate the orchestrator onto a multi-concept `DecisionContext` batch API once one exists. Neither condition blocks release or Phase 5 — both are transparency notes, not open defects.

Per this phase's explicit closing instruction: **not committed, not pushed, not deployed, no production migration applied, Phase 5 not begun.**
