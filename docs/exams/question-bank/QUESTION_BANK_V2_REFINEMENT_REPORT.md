# Question Bank V2 refinement: report (Preview only)

- **Branch:** `preview/qb-v2-refinement`, in the worktree `studyos-qb-v2`.
- **Base:** `5a6608e`, which is Track B 8004754 plus the d76cf71 runtime controls.
- **Commits:**
  - `62e18c3` adds the features;
  - `f3cd8e5` adds the certification and fixes;
  - the commit that adds this report contains documentation only.
- **What this is:** the V1 bank was evolved in place, not rebuilt. Nothing in this work touches Production or `main`.

## 1. What changed

### 1.1 Quality lifecycle

The existing governed states are unchanged. A question moves through them in this order:

1. **GENERATED.** The question is in the `VALIDATING` state.
2. **AUTOMATED_VALIDATION.** The validation pipeline sets the state to `VALIDATED` or `REVIEW_REQUIRED`.
3. **PILOT.** The question is practice-only and gets alignment `EXAM_STYLE`.
4. **HUMAN_REVIEW.** A row is written to `question_bank_reviews`.
5. **ACTIVE.**

A correction never overwrites a question. It creates a new version, which is validated again and must then be reviewed by someone other than its editor.

The DB trigger `question_bank_quality_guard` enforces two rules:

- A `STUDYUS_GENERATED` version cannot become ACTIVE or CALIBRATED unless it has an `APPROVED` review row.
- `OFFICIAL` alignment requires `OFFICIAL` or `LICENSED` provenance.

### 1.2 Automated validation

These stages run before AI validation:

| Stage | What it checks | Severity |
|---|---|---|
| Structure and answer key | Unchanged from V1 | Blocks |
| Duplicate detection | Unchanged from V1 | Blocks |
| Well-formedness | Template artifacts: `undefined`, `[object Object]`, `{{ }}`, HTML tags, lorem ipsum | Blocks |
| Explanation consistency | Whether the explanation is consistent with the answer | **WARN** (does not block) |

After a deterministic PASS, one independent validator call returns three things:

- `assessesRequirement`;
- `estimatedDifficulty`;
- the verdict.

If the budget does not allow that call, the item still passes, with the warning `ALIGNMENT_CHECK_NOT_RUN`. The soft budget only warns, and the hard caps are unchanged.

### 1.3 Human certification

**Routes:**

- `POST /api/admin/question-bank/questions/[versionId]/review`, with the decision `APPROVED`, `CORRECTION_REQUESTED` or `REJECTED`;
- `.../correct`, which creates a new version.

The old transition `to=ACTIVE` now returns `409 USE_REVIEW_TO_APPROVE`.

**Rules the review route enforces:**

- The reviewer cannot be the editor (`SELF_REVIEW`).
- Automated validation must already have passed.
- Notes are required for any decision other than approval.
- Mock usage requires `MOCK_READY`.
- `MOCK_READY` requires the question to sit in a blueprint cell.
- `OFFICIAL` requires official provenance.

Each review records `reviewed_by`, `reviewed_at`, the decision, the notes, the validated difficulty, the usage, the alignment, and a snapshot of the automated validation result.

### 1.4 Difficulty, usage and alignment

**Difficulty bands:** LOW is 1–2, MEDIUM is 3, HIGH is 4–5. Each question carries three difficulty values:

- **declared:** `content.difficulty`;
- **validated:** set by the reviewer;
- **observed:** `calibrated_difficulty`.

**Usage eligibility:** `PRACTICE`, `DIAGNOSTIC`, `QUIZ`, `REDUCED_MOCK`, `FULL_MOCK`, `FORMAL_ASSESSMENT`. A NULL value means a legacy row, which allows every use except `FORMAL_ASSESSMENT`.

**Exam alignment:** `PRACTICE` < `EXAM_STYLE` < `MOCK_READY` < `OFFICIAL`. This is independent of difficulty.

A CHECK constraint and the eligibility SQL (`lifecycleSqlFor(use)`) both enforce one rule: a mock can never draw a question below `MOCK_READY`.

**Backfill:**

- Fixture, official and licensed questions keep every use they had before, with alignment `MOCK_READY` (or `OFFICIAL` for official provenance).
- Generated questions are limited to practice, diagnostic and quiz, with alignment `EXAM_STYLE`.

As a result, mocks on DEV and Preview draw exactly what they drew before.

### 1.5 Exposure memory and collision control

Every delivery writes a row to `exam_item_usage`, including the new column `delivery_use`. Both forms and practice sourcing do this.

`assembleForm` keeps the academic constraints as hard filters. Within those filters, it chooses questions by a cost that combines:

- difficulty distance;
- whether this Student has seen the question: +2, plus +1 more if seen in the last 30 days;
- whether this Student has seen the question's template: +1;
- global exposure in the last 14 days, scaled against a ceiling: +0.5;
- overlap with peers: +0.75;
- stimulus continuity.

It returns two extra outputs:

- `shortages`, for each position the pool could not fill without a repeat;
- `repeatedForStudent`.

Practice sourcing (`selectApprovedBankItem`) orders its choices by unseen first, then lower exposure.

### 1.6 Demand-driven inventory

`demand.ts` is pure logic and `demand.service.ts` reads the inputs from the DB. The policy is stored in `platform_settings`, under the key `question_bank.demand`. For each cell, the model computes:

- **Expected exposures over 14 days:** in-process Students × per-Student exposures, plus Students with retention due × 3, plus assigned interventions × 5.
- **Required unique questions:** the largest of expected exposures ÷ 8 (rounded up), the per-Student exposures, and the reduced-mock positions.
- **Approved questions by band.**
- **Deficit, expected repeat rate and days of coverage.**
- **Status:** GREEN, YELLOW or RED.
- **A recommended generation batch** with a difficulty mix of 30% LOW, 50% MEDIUM and 20% HIGH.

The admin action **Generate demand** queues a `DEMAND_SHORTAGE` request with that mix, up to 25 questions. Generation runs in chunks of 5, with the budget checked before each chunk.

Student activity launch never generates synchronously. It reads only the bank.

### 1.7 Admin UX

These pages are under `/dashboard/admin/question-bank`:

- **Bank health:** includes the demand section for each exam.
- **Review queue:** filters by exam, objective, difficulty, alignment, validation result and review status.
- **Question detail:** shows content, the three difficulty values, usage, alignment, automated validation, the human review record, exposure, the version history and the audit trail.
- **Operations:** exposure metrics (generated, approved, rejected, pending review, active inventory, reused, repeat rate, collision rate).

## 2. Migration

**Migration:** `database/migrations/20261028_1000_question_bank_quality_exposure_demand.sql`.

It is strictly additive:

- 3 nullable columns;
- 1 table;
- 1 trigger;
- 4 CHECK constraints;
- 2 widened CHECK constraints: the request reason allows `DEMAND_SHORTAGE`, and the request count may be 1–25;
- an idempotent backfill.

No content is rewritten and no attempt is touched. A rollback recipe is in the file header.

| Environment | Status |
|---|---|
| Ephemeral Postgres | Applied twice. Rollback tested. Constraint rejections verified. |
| DEV (`2a29b99ee14a22b4`) | **Applied.** The ledger went from 57 to 58 migrations, with 0 pending and 0 drift. The content hash and attempt snapshots were unchanged. |
| Preview (`53d158d5811e7ee0`) | **Pending.** It is handed off to the Preview integration owner or the user, and was not run from this session. |
| Production | **Never.** |

## 3. Certification evidence

| Suite | Result |
|---|---|
| Unit tests (`vitest run`) | **448 files, 7,419 tests, all pass.** This includes 35 new tests in `question-bank-v2-refinement`. |
| `next build` | Passes. |
| Ephemeral bank cert (`track-b-question-bank-migration-cert.sh`) | **PASS.** 58 V1 integration checks and 33 V2 integration checks pass. Shadow readiness: 364 of 364 SAME. The V2 constraint rejections behave as expected. |
| DEV regression (after the migration) | See §3.1. |

### 3.1 DEV regression suites (`20261028_1000` applied)

These suites ran against the DEV database `2a29b99ee14a22b4`, with `--skip-ai` where the suite supports it. **0 real AI calls.**

| Suite | Result |
|---|---|
| `track-b-question-bank-dev-verify` | 25 / 25 |
| `track-b-question-bank health --write` | Refreshed |
| `track-b-question-bank shadow` | 364 / 364 SAME, 0 differences |
| `track-b-v2-scenarios --skip-ai` | 88 / 88 |
| `track-b-objective-first-scenarios` | 61 / 61 |
| `track-b-aice-pisa-scenarios` | 45 / 45 |
| `track-b-exam-profile-scenarios` | 24 / 24 |
| `track-b-exam-delete-scenarios` | 21 / 21 |
| `track-b-exam-scenarios --skip-ai` | 197 / 197 |

**Total: 461 scenario checks pass and 0 fail.**

### 3.2 Demand example (ephemeral cert, PAA `paa.mat.algebra`)

**Inputs:** 3 Students preparing.

**Model output:**

| Measure | Value |
|---|---|
| Expected exposures over 14 days | 24 |
| Required unique questions | 8 |
| Approved questions | 4 (1 LOW, 2 MEDIUM, 1 HIGH) |
| Deficit | 4 |
| Status | **YELLOW** |
| Recommended batch | 4 questions: 1 LOW, 2 MEDIUM, 1 HIGH |

### 3.3 Exposure example (ephemeral cert)

The example is a 36-position form, assembled in this order: Student A's first attempt, then Student B, then Student A's second attempt.

- Student A's second attempt repeated 24 questions. That is the minimum possible with this pool.
- Student B overlapped with Student A on 25 questions, against a floor of 24. The one extra overlap comes from stimulus units, which keep a passage's questions together.

### 3.4 Generated, approved and rejected

- **Ephemeral cert, with a deterministic fake AI:** the generation, approval, correction (as a new version) and rejection paths are all exercised. Self-review, OFFICIAL without official provenance, and mock usage without MOCK_READY are each refused by both the service and the DB.
- **Real AI on DEV:** 0 calls in this phase. A scripted real-AI demo was drafted and then **dropped**. It would have had to approve generated questions with a non-human identity, which undercuts the human-certification requirement.

On Preview, generation and approval should be shown live by a person, from the Admin UI. The checklist is in §5.

## 4. Runtime controls for Preview (existing d76cf71 settings, unchanged code)

The target settings for Preview are:

- `factory_enabled=true`
- `on_demand=true`
- `demo_mode=true`
- `scheduled=false`

These are set by the **user** in the Admin panel (Question Bank → Operations), or by the Preview owner. They are not set from this session.

Demo Mode is forced OFF in Production by code. The Demo Mode batch limit is now 25.

## 5. Preview demo checklist (to run after the Preview migration and deploy)

1. **Confirm the fingerprint.** Operations shows the Preview DB fingerprint `53d158d5811e7ee0`. The ledger includes `20261028_1000`.
2. **Bank health.** The PAA demand section shows Students preparing, expected exposures, required, approved by band, deficit, repeat rate, coverage days and GREEN/YELLOW/RED.
3. **Generate demand.** Click **Generate demand** on a YELLOW or RED cell. A `DEMAND_SHORTAGE` request appears with the recommended mix, and runs on demand.
4. **Check the generated questions.** They arrive as PILOT, with alignment EXAM_STYLE and usage limited to practice, diagnostic and quiz. Their validation stage is `DETERMINISTIC+ALIGNMENT`.
5. **Review queue.** Filter the queue. Open a question detail and check the three difficulty values and the audit trail.
6. **Reject self-review.** Approving as the same user who edited the question must be rejected (`SELF_REVIEW`).
7. **Approve.** A second admin approves with a validated difficulty and a usage choice. The question becomes ACTIVE and the demand deficit drops.
8. **Request a correction, then correct.** A new version (v+1) is created and returns to PILOT. The old version stays current until the correction is certified.
9. **Reject.** The question becomes REJECTED and is excluded from every use.
10. **Exposure.** A Student practices twice. The second attempt prefers unseen questions, and the operations exposure metrics update.

## 6. Risks and open items

| Priority | Item |
|---|---|
| P0 | None. |
| P1 | None open on DEV. The Preview DB migration and the Preview deploy are pending, by design: they are handed off. |
| P2 | Demand uses learner-state counts from `concept_knowledge_state` / `concept_memory_state`. With few real Students on Preview, most cells will show the per-Student minimum rather than true demand. |
| P2 | Observed difficulty needs response volume, so it will be mostly empty on Preview. |
| P3 | The review queue is paginated by limit only, with no cursor. |
| P3 | The exposure ceiling and peer weights are policy defaults, not yet tuned on real data. |

## 7. Verdicts

| Verdict | Value |
|---|---|
| QUESTION_BANK_V2_REFINEMENT | **PASS** (DEV) |
| QUALITY_LIFECYCLE / HUMAN_CERTIFICATION | **PASS** |
| USAGE_ELIGIBILITY / EXAM_ALIGNMENT | **PASS** |
| EXPOSURE_MEMORY / COLLISION_CONTROL | **PASS** |
| DEMAND_DRIVEN_INVENTORY | **PASS** |
| PREVIEW_DEMO_READY | **PENDING.** This needs the Preview DB migration, the Preview deploy, and the user setting Demo Mode. |
| PAA_FULL_MOCK_READY / PAA_FULL_MOCK_CALIBRATED | **NO / NO** (unchanged) |
| Production | **Not touched.** |
