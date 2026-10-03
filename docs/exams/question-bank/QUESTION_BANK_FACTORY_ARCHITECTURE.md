# StudyUS — Question Bank Factory V1: Architecture

Track B — Exam Core. Scope of this delivery: **QB-1 (bank core) + QB-2 (factory) + the minimum QB-3 needed to prove it with PAA**. QB-4 (calibration) has its data model, pure statistics and the aggregation job. QB-5 and QB-6 are prepared but not built out. Nothing here redesigns the Exam Engine.

## 1. What the factory is

The bank is a living asset. The platform itself decides where the bank is weak, what to generate next, whether generated content is valid, whether a form can actually be assembled, and what remains before the next readiness level.

```
Blueprint → Coverage analysis → Gap detection → Generation queue → AI candidate → Automated validation
  → Repair / Reject → PILOT → Student usage → Calibration → ACTIVE → Monitoring → Review / Retirement
```

Generation is **background only**. A Student's Start Practice or Start Mock never waits for AI and never computes coverage. It reads the validated bank (and, in ENFORCE mode, one precomputed snapshot row).

## 2. Data model: no parallel question system

| Concept | Where it lives | Why |
|---|---|---|
| **Item version** (immutable content an attempt saw) | `approved_items`, one row per version | Every existing delivery, grading, novelty and attempt reference (`exam_attempt_item_responses.approved_item_id` + `item_snapshot`) keeps working unchanged |
| **Stable item identity** | `question_bank_items` (new) | `current_version_id`, provenance, origin exam version / component / objective / cell, generation request, retirement |
| **Lifecycle** | `approved_items.bank_lifecycle_status` (new column) | Per version. A DB CHECK keeps it consistent with the existing `status`: **PUBLISHED ⇔ PILOT / CALIBRATED / ACTIVE** |
| **Audit history** | `question_bank_lifecycle_events` (append-only) | Every transition, with actor (SYSTEM / ADMIN / MIGRATION), reason, run |
| **Coverage targets** | `question_bank_cell_targets` | Per version default + per cell overrides. No global magic number |
| **Generation queue** | `question_bank_generation_requests` | Durable, leased, bounded attempts, one open request per cell |
| **Factory runs** | `question_bank_factory_runs` | Lock (one RUNNING), budget accounting, observability, coverage before / after |
| **Bank health** | `question_bank_health_snapshots` | Precomputed. Student paths only read the latest row |
| **Aggregated telemetry** | `question_bank_item_stats` | Anonymous per version / mode statistics (QB-4 groundwork) |

The learning-activity bank (`question_bank_candidates`, `src/services/question-bank.service.ts`) is a **different system**: it is Student- and concept-scoped practice for the learning loop, with no blueprint. Exam items cannot live there. The factory extends the exam bank (`approved_items`), which is the one the Exam Engine delivers from.

Semantic placement of every item:

```
Exam family → exam definition → exam version → component (paper / section / domain) → blueprint cell
  → learning objective (content / skill / AO / competency node) → canonical concept (via the Learning Bridge)
  → cognitive demand · difficulty (target) · response format · stimulus / unit → scoring strategy → item version
```

Item-level tags (skill, process, context, competency, assertion, evidence, AO, cognitive demand, response format), the scoring strategy, the math key, the rubric and the stimulus already live in the version content (`ApprovedItemContentSchema`). The factory adds `distractorMisconceptions` (server-side only, listed as answer-bearing).

### Versioning and historical integrity

- A bank version's `content`, objective, type, identity and `content_hash` **cannot be updated**. The trigger `question_bank_version_guard` raises `QUESTION_BANK_VERSION_IMMUTABLE`. A version **cannot be deleted** either (`QUESTION_BANK_VERSION_NOT_DELETABLE`): it is retired instead.
- A correction is `createNextVersion`. For a delivered item the old version stays current until the new one becomes deliverable; then the old one becomes `SUPERSEDED` (status RETIRED). A repair of a never-delivered candidate supersedes at once.
- Attempts keep `approved_item_id` (the exact version) and `item_snapshot` (exact content, key, scoring, rubric, stimulus as delivered). Old attempts resolve and score against v1; new attempts receive v2. This is certified on a real database.

### Provenance

`OFFICIAL`, `LICENSED`, `STUDYUS_GENERATED`, `FIXTURE`. AI output is **always** `STUDYUS_GENERATED`, enforced three times:

1. `candidateToContent` forces `contentOrigin: GENERATED` and `contentStatus: ORIGINAL`.
2. The validator rejects anything else.
3. A DB CHECK ties `generation_request_id` to `STUDYUS_GENERATED`.

The validator also rejects any "official question / exam / score" wording. Official content coverage counts only OFFICIAL / LICENSED items. It is **0** today.

## 3. Lifecycle (server-authoritative, twice)

```
DRAFT_AI → VALIDATING → VALIDATED → PILOT → CALIBRATED → ACTIVE
exceptions: REPAIR_REQUIRED · REVIEW_REQUIRED · REJECTED · SUSPENDED · RETIRED · SUPERSEDED
```

- The same transition table is enforced in `lifecycle.ts` (`assertTransition`) and in the DB function `question_bank_transition_allowed`. A unit test asserts the two are identical.
- Generated content can never skip PILOT (`VALIDATED → ACTIVE` is refused for STUDYUS_GENERATED, in code and in the trigger).
- Promotions that rest on human judgement are **ADMIN-only**: PILOT → ACTIVE, REVIEW_REQUIRED → *, SUSPENDED → ACTIVE. The unattended factory cannot take them.
- Retirement keeps everything: the version, its events, its calibration and the attempts that used it.
- Legacy rows: PUBLISHED → ACTIVE (grandfathered, `calibration_confidence = INSUFFICIENT_DATA`), APPROVED → VALIDATED, IN_REVIEW → REVIEW_REQUIRED, REJECTED / RETIRED kept, DRAFT / PROPOSED unmanaged. Each managed row gets one `MIGRATION_BACKFILL` audit event.

### Content-use eligibility (explicit, `DEFAULT_ELIGIBILITY`)

| Use | Lifecycle states | Extra |
|---|---|---|
| Practice | PILOT, CALIBRATED, ACTIVE | — |
| Reduced mock | CALIBRATED, ACTIVE | — |
| Full mock | CALIBRATED, ACTIVE | full-length form must assemble and be deliverable |
| Full mock calibrated | CALIBRATED, ACTIVE | calibration confidence ≥ MODERATE |

The mock form query of the existing instance service applies this policy (`lifecycleSqlFor`). A mock is never filled with weaker content to reach its length: unfilled positions stay unfilled and the form says REDUCED, as before.

## 4. Blueprint cells, targets, health

**Cells** (`cells.ts`) are derived from the governed, versioned blueprint, never invented. Blueprint targets of one version that share component, learning objective, question type, difficulty band and command term form one cell. The cell key is semantic: `section|objective|type|band|term`. Different syllabus codes (AICE 9709 vs 9702), IB levels or exam versions have different objectives, so they never satisfy each other's cells.

**Full-length positions:**

- When the blueprint already reaches the component's published length, full = reduced (`BLUEPRINT_IS_FULL`).
- When it is shorter, the published item count is apportioned over the cells in proportion to the governed blueprint weights (largest remainder, deterministic: `ITEMS_PROPORTIONAL`). This is a **StudyUS assembly policy derived from the blueprint, not an official per-skill distribution**, and it is labelled so in the admin UI.
- With marks only: `MARKS_ESTIMATED`, using the same marks-per-objective basis as the catalogue readiness.
- With neither: `UNKNOWN`, and a full form is never claimed.

**Targets** (`cellTargets`): minUsable = full positions; desired = full positions × target forms (default 3); minActive / minCalibrated = full positions. All are overridable per version and per cell.

**Cell health** (bank health, not Student readiness):

| State | Meaning | Priority | Generates? |
|---|---|---|---|
| EMPTY | no usable item | P0 | yes |
| INSUFFICIENT | cannot fill its full-form positions | P1 (form blocker) | yes |
| FORM_READY | one form, no second disjoint one (or a single unit) | P2 | yes |
| VARIETY_LOW | below the variety target | P2 | yes |
| HEALTHY | variety met, too little field evidence | P3 | no (needs calibration) |
| CALIBRATED | variety met with calibrated items | P4 | no |

- **Deficit** = target − eligible.
- **Generation need** = deficit − (pilot + validating + validated + queued), and 0 for P3 / P4.
- **Prioritization** is deterministic: priority, then reduced-form blockers, then largest deficit, then cell key.

## 5. Readiness = real form assembly

`computeBankHealth` proves readiness with the **existing engine** (`assembleForm`), per component, from the eligible pool of each use. It never counts a total: 200 mathematics items cannot compensate for zero reading items. Template fingerprints are respected (two variants of one template never fill one form). Retired and PILOT items never enter a mock.

| Gate | Requires |
|---|---|
| PRACTICE | every cell of every simulable component has ≥ 1 practice-eligible item |
| REDUCED_MOCK_READY | the governed (reduced) blueprint assembles completely from mock-eligible items |
| **FULL_MOCK_READY** | (1) structure; (2) every full-length slot filled; (3) enough eligible items per slot; (4) scoring supported (only engine-valid items are counted); (5) timing / sections (the engine's own blueprint); (6) unit / stimulus constraints (family adapter); (7) **deliverable**: the governed blueprint is itself full length, so the form can be frozen before the attempt; (8) minimum diversity (≥ `minDistinctFullForms` distinct forms under the reuse policy) |
| FULL_MOCK_CALIBRATED | the full form assembles from items with calibration confidence ≥ MODERATE |

Admin explainability: every gate carries its reasons, for example `Matemáticas · paa.mat.algebra: 4/14 (faltan 10)` or `el blueprint gobernado es reducido: falta una versión de blueprint de longitud completa`.

The **diversity / reuse policy** (`DEFAULT_REUSE_POLICY`) allows at most 20 % overlap between full forms and probes up to 5 forms. Exposure cooldown stays enforced at assembly by the existing usage penalties.

### Dynamic capability integration (`getExamPreparationCapabilities`)

`applyBankReadinessOverlay` is applied server-side in **both** the capability service (`preparation.service`) and the instance API's level resolution (`resolveExamLevel`), so the UI and the launch gate read the same result.

| Mode | Behaviour |
|---|---|
| `SHADOW` (default) | No change and no extra query. The calculated readiness is compared offline (`track-b-question-bank.ts shadow`) |
| `ENFORCE` | The node's state comes from the latest snapshot: retired or suspended content downgrades it, validated content upgrades it. Filtered by the modes the catalogue node *declares* (an area-practice node never becomes a mock). A catalogue-only node is never upgraded. No snapshot means the persisted readiness stands |

Shadow comparison on all 80 governed configurations (364 bound nodes, local certification): **364 SAME, 0 upgrades, 0 downgrades**. ENFORCE is therefore behaviour-neutral on today's bank and only changes what a node offers when the bank actually changes.

## 6. The factory

- **Queue** (`queue.service.ts`)
  - `enqueueGaps` turns P0–P2 gaps into bounded requests (≤ `maxBatch` items each, ≤ 5 open per version).
  - One open request per cell (partial unique index, `ON CONFLICT DO NOTHING`).
  - Claiming uses `FOR UPDATE SKIP LOCKED` and a lease; expired leases go back to PENDING.
  - Attempts are bounded (≤ 5, DB CHECK) with exponential backoff (5, 20, 80 … min, cap 24 h).
- **Run** (`factory.service.ts`)
  - One RUNNING run at a time (partial unique index; a stale lease expires).
  - Steps: register identities → aggregate telemetry → health → gaps → resume interrupted validations → claim and process within budget → health again → coverage delta.
  - Stops cleanly at `STOPPED_BUDGET`, `STOPPED_MAX_PER_RUN`, `STOPPED_RESERVE`, `STOPPED_RATE_LIMIT` or `STOPPED_DEADLINE`, and resumes next run.
  - Each step is its own transaction: a failure never corrupts the bank or promotes a candidate.
- **AI budget** (`factoryConfig`): disabled by default.

  | Variable | Default |
  |---|---|
  | `QUESTION_BANK_FACTORY_ENABLED` | false |
  | `QUESTION_BANK_DAILY_BUDGET` | 20 calls / UTC day |
  | `QUESTION_BANK_MAX_PER_RUN` | 6 |
  | `QUESTION_BANK_MIN_REMAINING_AI_RESERVE` | 500 calls left on the shared platform cap |
  | `QUESTION_BANK_MAX_BATCH` | 3 |
  | `QUESTION_BANK_FACTORY_EXAMS` | none (exam config keys the unattended run may fill) |
  | `QUESTION_BANK_READINESS_MODE` | SHADOW |

  The shared cap (`AI_MAX_CALLS_PER_DAY`, `ai_global_limits`) is read, **never raised**. An unreadable remainder stops the factory (fails closed). Every call still goes through `executeAI`, so the global per-minute / per-day reservation applies on top.
- **Entry points**
  - `POST /api/internal/question-bank-factory` is CRON_SECRET-protected and a no-op when disabled. It is **not registered as a cron**, so a deployment never starts a run.
  - The admin "Generar lote pequeño" action is bounded, audited and runs in the background.
  - CLI: `track-b-question-bank.ts run --max-calls N --confirm-ai`.

## 7. Validation pipeline (generator ≠ validator; deterministic first)

1. **Schema**: the stored item contract + `validateExamItemStructure`. A failure is REJECTED; a structural problem goes to REPAIR.
2. **Blueprint**: format, option count (from the cell's own items / the family adapter), question type, difficulty band, cognitive demand, skill tag, language (declared and observed), required stimulus, provenance.
3. **Answer**
   - Mathematics: the generator must give a `verificationExpression`. The key is **recomputed with the exam math engine** (`gradeMath`, the same one that scores Students). A key that is not equivalent goes to REPAIR, as does a distractor equivalent to the key. A verbal key falls through to the independent validator.
   - Reading: a verbatim `evidenceQuote` must be **found in the passage**.
4. **Distractors**: distinct (signs kept: "2" ≠ "−2"), non-empty, no "all / none of the above", no length clue, no stem-echo clue, a rationale per distractor; optional misconception code per distractor.
5. **Novelty**: exact / normalized duplicate, the same template with other numbers, near duplicates (Jaccard, configurable reject / repair thresholds), the same numbers with cosmetic rewording, and the same stimulus + question. Checked against the bank and against earlier candidates of the same batch.
6. **Independent AI validator**, only where determinism cannot decide (reading / verbal). A separate call and prompt **solves the item without the key** and reports other defensible options, information outside the passage and implausible distractors. It is judged deterministically:

   | Verdict | Result |
   |---|---|
   | agrees, unambiguous | PASS |
   | confident disagreement / two defensible answers / outside information | REPAIR |
   | not confident | one escalation to the stronger model, then REVIEW_REQUIRED |

7. **Repair**: at most one bounded AI repair. It creates a **new version** that goes through the whole pipeline again. If it still fails, the item is REJECTED.

Accepted candidates land in **PILOT**: practice-eligible, never mock-eligible, never ACTIVE without an admin or field evidence.

**Cost:** deterministic → routed primary model (Luna) → stronger model (Terra) only for unconfident validations. Mathematics items normally need **one** generation call and **no** validator call.

## 8. Calibration V1 (QB-4 groundwork) and monitoring

`calibration.ts` / `calibration.service.ts` use transparent classical statistics only, with no IRT claim:

- empirical difficulty (mean score fraction);
- upper − lower discrimination proxy (attempts ranked by their other items);
- option shares, sample size, and a confidence level (INSUFFICIENT_DATA < 30 ≤ EARLY_SIGNAL < 100 ≤ MODERATE < 300 ≤ HIGH);
- monitoring flags: EXTREME_EASE, EXTREME_DIFFICULTY, POOR_DISCRIMINATION, DEAD_DISTRACTOR, MULTIPLE_ANSWER_SIGNAL;
- misconception signals (a distractor chosen ≥ 25 % with ≥ MODERATE evidence, carrying its misconception code).

Nothing fires below EARLY_SIGNAL, and promotion PILOT → CALIBRATED needs MODERATE and no flag. Flags with strong evidence move an item to REVIEW_REQUIRED. Statistics are per item version, which belongs to one exam's blueprint, so calibration is exam- and format-specific. The `MISCONCEPTION_COVERAGE` request reason and the anonymous `aggregate` prompt field are ready for QB-6.

## 9. Privacy and terminology

- Prompts are built only from exam structure, the cell requirement, bank exemplars (StudyUS content) and **aggregate** signals ("27 % de las respuestas (n=140) eligen …").
- `assertPromptPrivacy` refuses any payload with an email, an identifier or a personal / Student / institution / tutor field **before** a provider is called. It runs on all three factory calls.
- Factory modules never read Student identity tables.
- StudyUS uses aggregated analytics to choose what to generate, improve prompts, identify misconceptions and calibrate the bank. **It does not train or fine-tune a model.**

## 10. Exam-family adapters (`adapters.ts`)

The core has no `if exam === PAA`. Adapters are data:

| Family | Unit policy | V1 generation |
|---|---|---|
| PAA | item | selected response, 4 options |
| PISA | **UNIT** (stimulus + ≥ 2 items; variety in units) | units of selected response; open partial-credit responses never generated unattended |
| IB | item | off (markschemes, constructed responses); coverage measured |
| Cambridge / AICE | item, per syllabus code → level → route → component | off |
| ICFES / Saber | item; competency → assertion → evidence as dimensions | selected response; Learning Bridge gaps reported, never invented |

## 11. Security

- Admin API (`/api/admin/question-bank/**`) and pages (`/dashboard/admin/question-bank/**`) are STUDYUS_ADMIN only, rate limited, with strict bodies.
- No Student, Teacher or Institution route imports bank management.
- Students only ever receive items through the existing sanitized `toExamClientItem`. `distractorMisconceptions` is in the answer-bearing key list.
- Admin read models list coverage and lifecycle, never stems, keys, rubrics or Student identities.

## 12. Operator surface

- **Admin UI**
  - `Banco de preguntas` health table with the columns of §47.
  - Exam drill-down: capabilities with reasons, components (length basis, reduced / full positions, distinct full forms), and a per-section gap view (requirement · required · target · eligible · calibrated · pilot · queued · validating · rejected · deficit · priority · state · confidence) with the bounded generate action.
  - Operations: budget, queue, runs (AI calls, tokens, cost, accepted / rejected / repaired, rate-limit events) and the latest candidates with lifecycle and validation findings.
- **CLI** (`scripts/operations/track-b-question-bank.ts`): `health [--write]`, `shadow`, `report`, `run --exam v2.paa --max-calls N --confirm-ai`. It refuses any database but DEV or an allowed ephemeral one.
- **Certification**: `scripts/operations/track-b-question-bank-migration-cert.sh` runs the migration twice on an ephemeral Postgres, checks constraints, triggers and rollback, then 58 integration checks with a fake AI, then the shadow comparison over all 80 configurations.

## 13. Known limits (by design in V1)

- The V1 generator writes **selected-response** items only (PAA math student-produced responses, PISA open responses and IB / AICE markscheme items are not generated unattended).
- **Full-length delivery** for an exam whose governed blueprint is reduced (PAA: 36 of 175 positions) needs a governed **full-length blueprint version**. The factory proves bank readiness for it, but the Exam Engine delivers the governed blueprint. FULL_MOCK_READY therefore also requires `deliverable`.
- Response-time telemetry is not captured per item by the existing attempt engine. Monitoring V1 uses scores and options only.
