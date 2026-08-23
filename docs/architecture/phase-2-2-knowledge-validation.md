# Phase 2.2 — Knowledge Validation Architecture (Technical Design)

**Status:** Design for 2.2A/B/C. 2.2A is implemented against this design; 2.2B/C are designed but not yet implemented (gated — see §0).
**Written before implementation**, per this phase's own rule ("do not start implementation before the technical design exists"). Section 2.2A describes what was actually built; 2.2B/C describe what is planned and will be revised if reality diverges when they're implemented.

## 0. Gate structure

Phase 2.2 ships in three internally-gated stages. Each requires the previous to pass before starting:

1. **2.2A — Knowledge Truth**: what does the evidence say right now? (implemented this pass)
2. **2.2B — Knowledge Validation Over Time**: does it still hold after time passes? (designed here, not yet built)
3. **2.2C — External Validation**: do school assessments agree? (designed here, not yet built)

## 1. Repository audit (real schema, not assumed)

Confirmed directly against the live database before any design decision below:

| Table | Relevant columns |
|---|---|
| `learning_evidence` | `student_id, concept_id, subject_id, source_type, result, difficulty, score_percent, timestamp, activity_type, learning_mode, hints_used, ai_assistance_type, confidence_before_answer, metadata (jsonb)` |
| `mastery_records` | `student_id, concept_id, subject_id, mastery_score, confidence_score, attempt_count, correct_count, incorrect_count, last_practiced, last_assessed, next_review_date` |
| `mastery_events` | `mastery_id, old_score, new_score, delta_reason, created_at` — existing mastery change log |
| `concepts` | `id, subject_id, canonical_id, subtopic_id` |
| `subjects` / `topics` / `subtopics` | the existing Subject → Topic → Subtopic → Concept hierarchy |
| `concept_relationships` | Phase 2's Knowledge Graph edges |
| `cognitive_diagnoses` | Phase 2's diagnosis state machine |
| `remediation_paths` / `remediation_steps` | Phase 2's remediation lifecycle |
| `misconception_signatures` / `student_misconceptions` | Phase 2's misconception tracking (no severity/criticality column yet — added in 2.2A, see §9) |
| `analytics_events` | Phase 2's product-analytics log (student_id, event_name, properties, created_at) — explicitly **not** Learning Evidence (§14) |
| `assessment_results` / `assessment_occurrences` | **already existing external-assessment infrastructure** (score, max_score, percentage, topics as `text[]`) — reused for 2.2C rather than a new table (§17) |

`EvidenceSourceType` (in `src/lib/algorithms/mastery.ts`): `REAL_SCHOOL_EXAM, SOLO_VERIFICATION, EXAM_SIMULATION, TOPIC_ASSESSMENT, DIAGNOSTIC, CUMULATIVE_ASSESSMENT, TRANSFER, EXPLANATION, PRACTICE_QUIZ, PRACTICE_QUESTION, REMEDIATION, GUIDED_EXERCISE`. Note: `SOLO_VERIFICATION` is defined but **no code path writes it today** — `SOLO_VERIFY` remediation steps write `CUMULATIVE_ASSESSMENT` instead (see the Phase 2 architecture doc). This is a known gap, not fixed here (out of scope for 2.2A; noted for Phase 2.2B where remediation-driven retention evidence needs a clean source-type signal).

Existing Phase 1 dimensions already computed on-demand from this evidence (`learner-model.service.ts`), reused rather than duplicated:

- `getIndependentMastery` — average result over the last 10 `ai_assistance_type = 'NONE'` evidence rows, null with <2 samples. **Reused directly as the Independence dimension.**
- `getRetention` — a *predicted* retention (inverse of spaced-repetition forgetting risk, from mastery/confidence/days-since-practice). This is a formula, not evidence of an actual delayed retrieval. Phase 2.2A's Retention dimension is evidence-based instead (§8.4) — a deliberate divergence, since Phase 2.2's whole point is not confusing a prediction with proof.
- `getEvidenceStrength`, `getConfidence`, `getConfidenceCalibration` — untouched, still Phase 1 concerns, not part of the Knowledge State projection.
- `transfer.service.ts`'s `computeTransferScore`/`getTransferScore` — **reused directly and exclusively** for the Transfer dimension. No second Transfer engine.

## 2. Source of truth (fixed)

```
LEARNING EVIDENCE (learning_evidence table)
        canonical historical truth, append-only, never rewritten
              ↓
KNOWLEDGE STATE PROJECTOR (knowledge-state.service.ts)
        deterministic, idempotent, versioned
              ↓
CONCEPT KNOWLEDGE STATE (concept_knowledge_state table)
        operational projection, one row per (student, concept), overwritten on recalculation
              ↓
PRODUCT FEATURES (Concept Detail KPIs, Improve v2, NBA v2 decision context)
```

`concept_knowledge_state` is a cache of a pure function over `learning_evidence` (+ the existing Phase 2 tables it reads: `student_misconceptions`, `learning_evidence` rows with `source_type = 'TRANSFER'`). It is never hand-edited, never incremented (`mastery_score = mastery_score + 10` style logic does not exist and must not be introduced), and can always be rebuilt from scratch by re-running the projector (§13).

`mastery_records.mastery_score` (Phase 1's existing continuous 0-100 number, still driving spaced-repetition scheduling and Today/NBA v2's `low_mastery` reason) is **untouched** by this phase. Knowledge State is a new, separate, richer projection that coexists with it — Phase 2.2 does not redefine or migrate off Phase 1 Mastery, per the ADR's "extend, never rebuild."

## 3. Persisted vs. derived

**Persisted** (survives a server restart, queryable without recomputation):
- `concept_knowledge_state` — one row per (student, concept). This is the only new persisted table 2.2A introduces for Knowledge State itself.
- `mastery_policies` — versioned policy configuration.
- `misconception_signatures.is_critical` — a new column on an existing table (§9).

**Derived at projection time, not separately persisted:**
- Understanding, Independence, Application, Retention, Transfer component scores are recomputed from `learning_evidence` every time `recalculateConceptKnowledgeState` runs; they are *stored* on the resulting `concept_knowledge_state` row (so reads don't recompute), but that row is a cache, not an independent source of truth. Re-running the projector against the same evidence always reproduces the same stored values (§13, idempotency).

## 4. `concept_knowledge_state` schema

Migration `025_knowledge_state.sql`, fully additive:

```sql
CREATE TABLE IF NOT EXISTS concept_knowledge_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),

  mastery_state TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (mastery_state IN ('UNKNOWN','LEARNING','DEVELOPING','PROVISIONAL_MASTERY','VALIDATED_MASTERY','AT_RISK','INTERVENTION_REQUIRED')),

  understanding_score NUMERIC,
  independence_score NUMERIC,
  application_score NUMERIC,
  retention_score NUMERIC,
  transfer_score NUMERIC,

  active_misconception_count INT NOT NULL DEFAULT 0,
  critical_misconception_count INT NOT NULL DEFAULT 0,
  recurring_misconception_count INT NOT NULL DEFAULT 0,

  evidence_count INT NOT NULL DEFAULT 0,
  independent_evidence_count INT NOT NULL DEFAULT 0,

  first_evidence_at TIMESTAMPTZ,
  last_evidence_at TIMESTAMPTZ,
  last_practiced_at TIMESTAMPTZ,
  last_retrieved_at TIMESTAMPTZ,     -- most recent evidence that counted toward Retention (2.2B populates meaningfully; 2.2A leaves it alongside the retention calc)
  last_transfer_at TIMESTAMPTZ,
  last_validated_at TIMESTAMPTZ,     -- set only in 2.2B, when a Validation Cycle reaches VALIDATED_MASTERY

  next_review_at TIMESTAMPTZ,        -- reserved for 2.2B; null in 2.2A
  next_validation_at TIMESTAMPTZ,    -- reserved for 2.2B; null in 2.2A
  active_validation_cycle_id UUID,   -- reserved for 2.2B; null in 2.2A, FK added when validation_cycles exists

  validation_readiness TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE'
    CHECK (validation_readiness IN ('READY','INSUFFICIENT_EVIDENCE','WAITING_FOR_RETENTION','TRANSFER_REQUIRED','ACTIVE_CRITICAL_MISCONCEPTION')),

  state_reason JSONB,                -- explainability (§12): which thresholds passed/failed

  projection_version INT NOT NULL DEFAULT 1,
  mastery_policy_version INT NOT NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_cks_student ON concept_knowledge_state(student_id);
CREATE INDEX IF NOT EXISTS idx_cks_concept ON concept_knowledge_state(concept_id);
CREATE INDEX IF NOT EXISTS idx_cks_mastery_state ON concept_knowledge_state(mastery_state);
```

Notes:
- `subjectId`/`topicId` per the prompt's suggested shape: `topic_id` is omitted because `concepts` links to `subtopics`, not `topics`, directly (`concepts.subtopic_id → subtopics.topic_id → topics`) — reusing the existing hierarchy rather than inventing a `topic_id` shortcut column. Callers needing topic can join through `subtopics`.
- All five score columns are nullable `NUMERIC` — UNKNOWN ≠ 0 is enforced at the type level, not by convention.
- `next_review_at`/`next_validation_at`/`active_validation_cycle_id` are reserved columns, added now (additive, nullable) so 2.2B doesn't need a second migration touching this same row shape — but 2.2A never writes anything into them beyond `NULL`.

## 5. Mastery Policy

Migration `025` also creates:

```sql
CREATE TABLE IF NOT EXISTS mastery_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL UNIQUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  minimum_understanding NUMERIC NOT NULL,
  minimum_independence NUMERIC NOT NULL,
  minimum_application NUMERIC NOT NULL,
  minimum_retention NUMERIC NOT NULL,
  minimum_transfer NUMERIC NOT NULL,
  requires_transfer BOOLEAN NOT NULL DEFAULT true,
  maximum_critical_misconceptions INT NOT NULL DEFAULT 0,

  minimum_evidence_count INT NOT NULL,
  minimum_independent_evidence_count INT NOT NULL,
  retention_min_gap_days INT NOT NULL,

  validation_window_days INT NOT NULL DEFAULT 14,  -- 2.2B

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Policy v1** (seeded by the migration, matches the prompt's thresholds exactly):

| Field | Value |
|---|---|
| minimumUnderstanding | 80 |
| minimumIndependence | 80 |
| minimumApplication | 75 |
| minimumRetention | 75 |
| minimumTransfer | 70 |
| requiresTransfer | true |
| maximumCriticalMisconceptions | 0 |
| minimumEvidenceCount | 3 |
| minimumIndependentEvidenceCount | 2 |
| retentionMinGapDays | 3 |
| validationWindowDays | 14 (2.2B) |

`retentionMinGapDays = 3`: the prompt doesn't fix an exact number, only "meaningful time separation." 3 days is chosen as the smallest gap that isn't plausibly same-session or next-day drilling, while staying reachable within a 14-day validation window with room for a retry. Configurable, versioned, revisit if real usage data suggests otherwise.

Policy is read once per projection run and its `version` is stamped onto the resulting `concept_knowledge_state.mastery_policy_version` — never re-read mid-calculation, never hardcoded inline in the projector.

## 6. Evidence Sufficiency Policy

Distinct from the score thresholds above — this asks "do we have *enough* evidence to trust a score at all," independent of what the score says.

A dimension's score is only computed (non-null) when its underlying evidence pool has data; separately, **Validated Mastery** additionally requires, from policy:
- `evidenceCount >= minimumEvidenceCount` (3)
- `independentEvidenceCount >= minimumIndependentEvidenceCount` (2)

This mirrors the existing `getIndependentMastery`/confidence-calibration pattern of "returns null under N samples" but adds it as an explicit, policy-level gate on the *mastery decision*, not just on whether a number displays.

## 7. Validation Readiness

A field on `concept_knowledge_state`, orthogonal to `mastery_state` (§11.2 explains why they're separate):

| Value | Meaning |
|---|---|
| `READY` | Enough evidence exists to make a mastery decision under current policy. |
| `INSUFFICIENT_EVIDENCE` | Not enough evidence yet (below evidence-sufficiency policy). |
| `WAITING_FOR_RETENTION` | Everything else passes, but no evidence-based Retention exists yet (reserved meaning fully activated in 2.2B once Validation Cycles create an explicit deadline; 2.2A sets this whenever `retention_score IS NULL` and everything else would otherwise pass). |
| `TRANSFER_REQUIRED` | Policy requires Transfer and none exists yet, otherwise everything else passes. |
| `ACTIVE_CRITICAL_MISCONCEPTION` | A critical misconception blocks validation regardless of scores. |

Computed deterministically, checked in this priority order (first match wins): `ACTIVE_CRITICAL_MISCONCEPTION` → `INSUFFICIENT_EVIDENCE` → `TRANSFER_REQUIRED` → `WAITING_FOR_RETENTION` → `READY`.

## 8. Dimension classification (evidence → score)

Each function lives in `knowledge-state.service.ts`, pure given a list of evidence rows (testable without a DB), called by the projector after it loads evidence.

### 8.1 Understanding
Pool, in priority order: `EXPLANATION` evidence if any exists (rubric-graded reasoning — the strongest "real understanding" signal available); otherwise `PRACTICE_QUIZ, PRACTICE_QUESTION, CUMULATIVE_ASSESSMENT, EXAM_SIMULATION, GUIDED_EXERCISE, TOPIC_ASSESSMENT, REAL_SCHOOL_EXAM` evidence (excludes `DIAGNOSTIC` — a diagnostic check is deliberately adversarial, not a fair understanding sample; excludes `TRANSFER`/`REMEDIATION` — separate dimensions/not-yet-proven practice). Average of `score_percent` (falling back to the result→{100,50,0} mapping when `score_percent` is null), most recent 10. Null with an empty pool.

**Known limitation**, documented rather than hidden: the general-quiz fallback is a proxy, not a purpose-built "did they understand" measurement — the schema has no persisted per-question type distinguishing conceptual from procedural questions. Revisit if/when question type gets persisted to `learning_evidence`.

### 8.2 Independence
**Direct reuse** of `getIndependentMastery(studentId, conceptId)` — no new logic.

### 8.3 Application
Pool: `CUMULATIVE_ASSESSMENT, EXAM_SIMULATION, TOPIC_ASSESSMENT` evidence only — the quiz modes whose own design intent (per their existing guidance strings in `generate-and-take/route.ts`) is testing connections/application across ideas, not single-concept drilling. Explicitly excludes `PRACTICE_QUIZ`/`PRACTICE_QUESTION` (recall/understanding territory) and `DIAGNOSTIC`/`TRANSFER`/`EXPLANATION`/`REMEDIATION`. Average `score_percent`, most recent 10. Null with an empty pool.

**Known limitation**: same as Understanding — proxied via quiz mode rather than a persisted per-question application tag.

### 8.4 Retention (evidence-based, not predicted)
Pool: evidence for this concept whose `timestamp` is `>= retentionMinGapDays` after the concept's **first** evidence row (`first_evidence_at`) — i.e., genuinely separated from the initial exposure, not same-session or next-day drilling immediately after diagnosis. Average `score_percent`/result, most recent 10, from this gapped pool. **Null if no evidence exists at that separation yet** — immediate strong performance never counts as Retention, per the mandatory invariant in §39/§40 of the governing spec.

This deliberately differs from Phase 1's `getRetention` (a forgetting-curve *prediction*): Phase 2.2's Retention is *proof*, Phase 1's stays a scheduling heuristic. Both coexist; nothing in Phase 1 is changed.

### 8.5 Transfer
**Direct reuse** of `getTransferScore(studentId, conceptId)` from `transfer.service.ts` — no new Transfer engine, no re-derivation of distance/assistance weighting.

### 8.6 Misconceptions
`activeMisconceptionCount`/`recurringMisconceptionCount` from `student_misconceptions` joined to `misconception_signatures` (reuses `getRecurringMisconceptions`'s query shape, generalized to all active ones, not just recurring). `criticalMisconceptionCount` counts rows where `misconception_signatures.is_critical = true` (§9).

## 9. Misconception criticality (additive schema extension)

`misconception_signatures` has no severity concept today. Migration `025` adds:

```sql
ALTER TABLE misconception_signatures ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false;
```

`classifyMisconception`'s structured-output prompt gains one more field: the LLM is asked whether the misconception is foundational/critical (would systematically block correct reasoning elsewhere) vs. a minor/surface slip, using the same structured-JSON discipline Phase 2 already uses everywhere else (never a free-form verdict). `getOrCreateSignature` gains an optional `isCritical` parameter, defaulted `false` for any caller that doesn't pass one (backward compatible with every existing call site).

## 10. Mastery state machine

Core linear progression plus two exceptional states, exactly as specified — no combinatorial explosion of states for retention/transfer/misconception, those stay as separate fields already covered above:

```
UNKNOWN → LEARNING → DEVELOPING → PROVISIONAL_MASTERY → VALIDATED_MASTERY
                                                              ↑
                                                    (2.2B: can regress to)
                                                         AT_RISK
                                                              ↓
                                              (2.2B: persistent difficulty)
                                                  INTERVENTION_REQUIRED
```

`AT_RISK`/`INTERVENTION_REQUIRED` are **not set by 2.2A's projector** — they require the time-based knowledge-decay/persistent-difficulty signals that are 2.2B's job (§16 of the governing spec: decay is *evidence-informed*, requiring delayed-retrieval history that only exists once Validation Cycles are running). 2.2A's projector only ever produces `UNKNOWN`/`LEARNING`/`DEVELOPING`/`PROVISIONAL_MASTERY`/`VALIDATED_MASTERY`.

**2.2A state determination** (deterministic, in this order):
1. `evidenceCount === 0` → `UNKNOWN`.
2. Else, if Understanding and Independence both pass their thresholds AND Application passes AND Retention passes (or is not yet required — see below) AND Transfer passes (when required) AND `criticalMisconceptionCount === 0` AND evidence-sufficiency passes → `VALIDATED_MASTERY`.
3. Else, if Understanding and Independence both pass their thresholds (the "can do it now" bar) → `PROVISIONAL_MASTERY` (this is exactly what "strong immediate evidence produces Provisional, not Validated" means — Retention/Transfer not yet proven is what keeps it Provisional, per §7's `WAITING_FOR_RETENTION`/`TRANSFER_REQUIRED`).
4. Else, if Understanding passes but Independence does not → `DEVELOPING`.
5. Else → `LEARNING`.

This is **not a compensating average** — each required dimension is checked independently against its own threshold; a high Understanding cannot substitute for a failing Application, matching §13's non-negotiable rule exactly (unit-tested directly, §2.2A test #11).

## 11. Why Validation Readiness and Mastery State are separate

```
masteryState: PROVISIONAL_MASTERY      -- "the student can currently do it"
validationReadiness: WAITING_FOR_RETENTION   -- "we haven't yet proven it sticks"
```

vs.

```
masteryState: LEARNING                  -- "the student doesn't do it yet"
validationReadiness: INSUFFICIENT_EVIDENCE   -- "we don't have enough data to say more"
```

These answer different questions ("what does the evidence show" vs. "do we trust that evidence enough / what's still missing") and must never be collapsed into one enum, per §16 of the governing spec.

## 12. Explainability

Every projection persists `state_reason` (jsonb), a plain deterministic record — never an LLM call:

```json
{
  "policyVersion": 1,
  "dimensions": {
    "understanding": { "score": 88, "threshold": 80, "passed": true },
    "independence": { "score": 86, "threshold": 80, "passed": true },
    "application": { "score": 72, "threshold": 75, "passed": false },
    "retention": { "score": null, "threshold": 75, "passed": false, "reason": "no evidence" },
    "transfer": { "score": null, "threshold": 70, "passed": false, "reason": "no evidence", "required": true }
  },
  "criticalMisconceptions": 0,
  "evidenceSufficiency": { "evidenceCount": 6, "required": 3, "independentEvidenceCount": 3, "required": 2, "passed": true },
  "resultingState": "DEVELOPING",
  "validationReadiness": "TRANSFER_REQUIRED"
}
```

The Tutor (or any future UI) may later phrase this conversationally; the underlying record is always this deterministic structure, queryable and testable without touching an LLM.

## 13. Knowledge Projector

`recalculateConceptKnowledgeState(studentId, conceptId): Promise<ConceptKnowledgeState>` in `knowledge-state.service.ts`:

```
load learning_evidence for (student, concept)         -- one query
load student_misconceptions + signatures               -- reuses existing query shape
load transfer score                                     -- getTransferScore (reused)
load active mastery_policy (highest version)
      ↓
classify evidence into dimension pools (§8, pure functions)
      ↓
compute understanding / independence / application / retention scores
      ↓
compute misconception counts
      ↓
compute evidence sufficiency
      ↓
determine validation readiness (§7)
      ↓
determine mastery state (§10)
      ↓
build state_reason (§12)
      ↓
UPSERT concept_knowledge_state (unique on student_id, concept_id)
```

**Determinism & idempotency**: every step above is a pure function of the evidence loaded at the start (no `Date.now()`-sensitive branching beyond the retention gap check, which is itself a pure function of stored timestamps) — running it twice against the same underlying evidence produces byte-identical scores, state, and reason. This is directly unit-tested (§2.2A tests #12/#13) by calling the pure classification functions twice with the same input array and asserting equal output, and at the service level by mocking two identical `db.query` sequences and asserting two identical results.

**When it runs**: called synchronously right after any `updateMastery` call (mirroring how `mastery_records` itself updates synchronously today) — added as one line in `mastery.service.ts`'s `updateMastery`, not a new background job or queue. This keeps 2.2A's guarantee simple: after any evidence-writing action, Knowledge State is immediately current. A batch/scheduled recompute is not needed for 2.2A and is not built.

## 14. Product Analytics vs. Learning Evidence

`analytics_events` (event_name/properties) answers "what did the user do" and is never read by the projector and never treated as evidence. `learning_evidence` answers "what does the student know" and is the only input to Knowledge State. This boundary is enforced by construction: `knowledge-state.service.ts` never imports `@/lib/analytics` for reads (it may `track()` a `KNOWLEDGE_STATE_UPDATED`-equivalent event as a side effect, same as every other Phase 2 service does, but that's output, not input).

## 15. Domain semantics (event names, no new infrastructure)

No event bus is introduced. Where Phase 2.2A's projector completes, it calls the existing `track()` helper with `knowledge_state_updated` (mirroring the naming style of Phase 2's 13 existing events), carrying `{ conceptId, previousState, newState, policyVersion }`. The full event vocabulary from the governing spec's §68 (`LEARNING_GAP_DETECTED`, `VALIDATION_CYCLE_STARTED`, `RETENTION_DUE`, etc.) is **2.2B's responsibility** once Validation Cycles exist to attach them to — 2.2A only ever fires `knowledge_state_updated`.

## 16. Service contracts (2.2A)

```ts
// knowledge-state.service.ts
recalculateConceptKnowledgeState(studentId, conceptId): Promise<ConceptKnowledgeState>
getConceptKnowledgeState(studentId, conceptId): Promise<ConceptKnowledgeState | null>
getSubjectKnowledgeState(studentId, subjectId): Promise<ConceptKnowledgeState[]>   // aggregation, reads persisted rows, no recompute
```

`getStudentKnowledgeState`, `getValidationReadiness` (as a standalone call — 2.2A exposes it as a field on `ConceptKnowledgeState` rather than a separate endpoint, since it's always computed alongside mastery state in the same pass), and everything validation-cycle/KVR/TTM/external-assessment-shaped (§70 of the governing spec) are **2.2B/2.2C service contracts**, specified in §18-19 below for forward reference but not implemented yet.

## 17. 2.2B design (for when 2.2A gates pass — not implemented this pass)

- `validation_cycles` table, one row per (student, concept) learning-gap episode, `status IN ('OPEN','VALIDATED','DEVELOPING','INTERVENTION_REQUIRED')`, unique **partial** index enforcing at most one row with `status = 'OPEN'` per (student, concept) — the DB-level idempotency guard the spec requires (§35), mirroring the pattern already used for `startRemediation`'s application-level guard (Phase 2 closure gate) but enforced at the schema level too since cycles are the KVR-14 unit of record.
- Triggers (`triggerType`) reuse existing Phase 2 signals directly: `CONFIRMED_MISCONCEPTION` (a `cognitive_diagnoses` row reaching `CONFIRMED`), `REPEATED_CONCEPTUAL_ERROR` (existing `errors` table recurrence), `APPLICATION_FAILURE`/`TRANSFER_FAILURE` (2.2A's own Application/Transfer scores falling below policy), `KNOWLEDGE_DECAY` (2.2B-only, once decay detection exists). No new trigger-detection engine — these are reads over data 2.2A/Phase 2 already produce.
- `validation_events` table logs every state transition inside a cycle (mirrors `mastery_events`' existing append-only pattern).
- KVR-14: `COUNT(cycles WHERE finalOutcome='VALIDATED_MASTERY' AND validatedAt <= validationDeadline) / COUNT(eligible cycles) * 100`. "Eligible" excludes cycles created by scratch/test data (the same `__SCRATCH_*` convention already used for E2E isolation) and requires the cycle to have reached a terminal outcome or its deadline to have passed (an OPEN cycle mid-window is not yet countable in either direction).
- TTM: `validatedAt - startedAt`, only for cycles with `finalOutcome = 'VALIDATED_MASTERY'`; stored as an interval on the cycle row, aggregable by student/subject/concept via a view, not a separate materialized table initially.
- Knowledge Decay: evidence-informed only (failed delayed retrieval, rising assistance, returning misconception, failed transfer) — never a scheduled percentage decrement. Detected as part of the projector's regular recalculation once a `VALIDATED_MASTERY` concept's newest evidence would otherwise recompute it below policy.

## 18. 2.2C design (for when 2.2B gates pass — not implemented this pass)

Reuses **existing** `assessment_results`/`assessment_occurrences` rather than a new `external_assessments` table (§1) — `assessment_occurrences.topics` (`text[]`) is today's only "coverage" signal and has no weight/confidence. 2.2C adds:

```sql
CREATE TABLE IF NOT EXISTS assessment_concept_coverage (
  assessment_occurrence_id UUID NOT NULL REFERENCES assessment_occurrences(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  weight NUMERIC NOT NULL DEFAULT 1.0,
  mapping_confidence NUMERIC NOT NULL DEFAULT 0.5,
  PRIMARY KEY (assessment_occurrence_id, concept_id)
);
```

External evidence never overwrites `concept_knowledge_state` directly. A significant gap between internal Knowledge State and a high-confidence, well-covered external result produces a `calibration_conflicts` row (student, concept, internal score, external score, mapping confidence, possible-interpretation tags) — Phase 2.2C records the conflict; deciding what to do about it is explicitly Phase 3's job (§77 of the governing spec).

## 19. Migration / backfill strategy

`025_knowledge_state.sql` creates `concept_knowledge_state`/`mastery_policies` and seeds Policy v1 — no backfill runs inside the migration itself (migrations stay schema-only, per existing project convention). A separate backfill pass (script, not a migration) calls `recalculateConceptKnowledgeState` for every existing (student, concept) pair that has at least one `learning_evidence` row — reusing the same projector real students will hit going forward, so backfilled and freshly-computed rows are indistinguishable. Concepts with evidence insufficient for any dimension naturally backfill to `UNKNOWN`/null scores — never a fabricated historical Understanding/Retention. Concepts with zero evidence get no row at all (a row is only created the first time real evidence justifies one).

## 20. Replay

`recalculateConceptKnowledgeState` **is** the replay mechanism — there is no separate "rebuild" code path to keep in sync. Bumping `projectionVersion` or `mastery_policies.version` and re-running it for affected students is how a future algorithm change gets applied retroactively. No separate replay infrastructure is built in 2.2A beyond this.

## 21. Phase 3 boundary

Phase 2.2 (once 2.2A/B/C all land) exposes a normalized decision context — `mastery_state`, the five dimension scores, misconception counts, `validation_readiness`, `next_review_at`/`next_validation_at` — via `getConceptKnowledgeState`. Phase 3 (not started, not designed here) is what turns that into a schedule, a priority, a daily plan. 2.2A/B/C never orchestrate the student's calendar, never balance workload across subjects, never promise a grade.
