# Question Bank Factory V1 — DEV readiness report

Track B — Exam Core. Branch `track-b/exam-architecture-v2` (worktree `studyos-track-b`), local commits only. Scope: QB-1 + QB-2 + minimum QB-3 (PAA). **STOP FOR REVIEW.**

## 0. Status in one paragraph

The factory is implemented, unit-tested and **certified on a real, throwaway Postgres**:

- the migration applied twice, plus constraints, triggers and rollback;
- 58 end-to-end integration checks with a deterministic fake AI;
- a shadow-readiness comparison over all 80 governed configurations.

The production build passes. **Nothing was applied to the DEV database and nothing was deployed in this session.** Every attempt to read the DEV database from this session was refused by the session's permission classifier as a possible production read, and no workaround was attempted. Consequently:

- no immutable DEV URL exists yet;
- migration `20261026_1000` is **pending** on DEV;
- **0 real AI calls** were consumed.

The exact operator steps to finish are in §8. The hosted manual E2E package is prepared, not executed.

## 1. Delivery

| Item | Value |
|---|---|
| Code SHA | `1014205` (feat(exam-bank): Question Bank Factory V1) |
| Docs-only SHA | the commit that adds this report (on top of `1014205`) |
| Immutable DEV URL | **none — not deployed** (see §8) |
| Deployment ID | **none** |
| DEV DB fingerprint | expected `2a29b99ee14a22b4`; **not verified in this session** |
| Migration ledger | `20261026_1000_track_b_question_bank_factory` **pending on DEV**. Track A's `20261018_*` rows are untouched by this migration (no Track A table is read or altered) |
| Real AI calls consumed | **0** (all generation and validation in certification used a deterministic fake; no provider was called) |
| Shared AI cap | not changed |
| Shared DEV alias / Stage / Production / `main` | not touched |

## 2. Tests

| Suite | Result |
|---|---|
| Full unit suite (`vitest run`) | **427 files, 6 997 tests, all pass** (baseline before this work: 423 / 6 910) |
| New Question Bank tests | 87 (`question-bank-core` 27, `-readiness` 25, `-validation` 24, `-security` 11) |
| Exam-related unit suites (exam-*, track-b-*, aice-*, question-bank-*) | 23 files, 497 tests, pass |
| Migration certification `track-b-question-bank-migration-cert.sh` | **PASS** on ephemeral Postgres 18: idempotent ×2, 9 backfill checks, 12 constraint / trigger checks, rollback, **58 integration checks, 0 failed**, shadow over 80 configurations |
| Production build (`next build`) | **pass**; new routes and pages present |
| `tsc --noEmit` | clean |
| DEV scenario suites (objective-first 61, aice-pisa 45, v2 90, exam V1 203, delete 21, profile 24) | **not run** (they need the DEV DB, see §0) |

The DB integration run found one real defect, which is fixed and regression-tested: duplicate-option detection normalized away minus signs, so "2" and "−2" were treated as the same option.

## 3. Bank health metrics

The source is the bank-health engine over **all 80 governed configurations** applied to a fresh ephemeral database (`track-b-question-bank.ts report`). This is the governed bank DEV holds today; the numbers must be re-confirmed on DEV after the migration (§8 step 4).

| Metric | Value |
|---|---|
| TOTAL_BANK_ITEMS | 410 |
| ACTIVE_ITEMS | 410 (all legacy PUBLISHED → ACTIVE, uncalibrated) |
| PILOT_ITEMS | 0 |
| CALIBRATED_ITEMS | 0 |
| REVIEW_REQUIRED_ITEMS | 0 |
| RETIRED_ITEMS | 0 |
| BLUEPRINT_CELLS_TOTAL | 426 |
| BLUEPRINT_CELLS_EMPTY | 167 (mostly IB structure-only subjects) |
| BLUEPRINT_CELLS_FORM_BLOCKING | 374 (empty + below their full-length requirement) |
| GENERATION_QUEUE_PENDING | 0 |
| GENERATION_CANDIDATES_CREATED | 0 on DEV (6 + 3 repaired versions in certification, fake AI) |
| VALIDATION_PASS_RATE | n/a on DEV; certification batch: 4 of 6 candidates accepted (2 after one repair), 2 rejected (exact duplicate; ambiguous reading item) |
| PAA_FULL_MOCK_READY | **NO** |
| PAA_FULL_MOCK_CALIBRATED | **NO** |

### Per exam family

Count of published versions per readiness level, bank-calculated.

| Family | Versions | Structure | Practice | Reduced mock | Full mock | Full mock calibrated | Official content coverage |
|---|---|---|---|---|---|---|---|
| PAA | 1 | 1 | 1 | 1 | 0 | 0 | 0 |
| PISA | 1 | 1 | 1 | 1 | 0 | 0 | 0 |
| AICE / Cambridge AS & A | 14 | 14 | 14 | 14 | 4 | 0 | 0 |
| Cambridge IGCSE (0580) | 1 | 1 | 1 | 1 | 0 | 0 | 0 |
| IB DP | 62 | 62 | 12 | 12 | 2 | 0 | 0 |
| ICFES / Saber 11 | 1 | 1 | 1 | 1 | 0 | 0 | 0 |

- Official content coverage is 0 everywhere: `OFFICIAL_CONTENT_COVERAGE = 0` stands; nothing official or licensed was added.
- Full mock calibrated is 0 everywhere because no item has field evidence yet; nothing is fabricated.
- ICFES Learning Bridge coverage is reported separately by the capability service (`canUseLearningBridge` / mapping counts); the factory does not invent mappings.

### Readiness backward compatibility (§64, shadow mode)

Persisted catalogue readiness vs bank-calculated readiness for every bound catalogue node: **364 SAME, 0 UPGRADE, 0 DOWNGRADE.**

- `QUESTION_BANK_READINESS_MODE` defaults to **SHADOW**.
- ENFORCE is behaviour-neutral on today's bank. It only changes what a node offers when the bank itself changes (retirement, suspension, promotion).

## 4. PAA coverage

The governed blueprint (read from the stored configuration, not invented) has 4 sections, 20 cells, 36 reduced positions and 175 full-length positions (Lectura 45, Redacción 25, Matemáticas 55, Inglés 50). The full-length allocation per cell is the official item count apportioned by the governed blueprint weights: a **StudyUS policy, labelled as such**.

### Before (current governed bank)

| Cell | Full-form positions | Eligible | Missing for one full form | Target (3 forms) | Deficit | Priority |
|---|---|---|---|---|---|---|
| Lectura · vocabulario | 9 | 2 | 7 | 27 | 25 | P1 |
| Lectura · explícitas | 9 | 2 | 7 | 27 | 25 | P1 |
| Lectura · inferencia | 9 | 2 | 7 | 27 | 25 | P1 |
| Lectura · evidencia | 4 | 2 | 2 | 12 | 10 | P1 |
| Lectura · gráficos | 5 | 2 | 3 | 15 | 13 | P1 |
| Lectura · literario | 9 | 2 | 7 | 27 | 25 | P1 |
| Redacción · elisión | 5 | 2 | 3 | 15 | 13 | P1 |
| Redacción · adición | 4 | 1 | 3 | 12 | 11 | P1 |
| Redacción · generalización | 4 | 1 | 3 | 12 | 11 | P1 |
| Redacción · integración | 4 | 1 | 3 | 12 | 11 | P1 |
| Redacción · particularización | 4 | 1 | 3 | 12 | 11 | P1 |
| Redacción · cohesión | 4 | 2 | 2 | 12 | 10 | P1 |
| Matemáticas · aritmética | 14 | 4 | 10 | 42 | 38 | P1 |
| Matemáticas · álgebra | 14 | 4 | 10 | 42 | 38 | P1 |
| Matemáticas · geometría | 14 | 4 | 10 | 42 | 38 | P1 |
| Matemáticas · datos | 9 | 3 | 6 | 27 | 24 | P1 |
| Matemáticas · probabilidad | 4 | 2 | 2 | 12 | 10 | P1 |
| Inglés · lenguaje | 19 | 4 | 15 | 57 | 53 | P1 |
| Inglés · lectura | 19 | 4 | 15 | 57 | 53 | P1 |
| Inglés · redacción | 12 | 2 | 10 | 36 | 34 | P1 |
| **Total** | **175** | **47** | **128** | **525** | **478** | |

- Reduced mock: **ready** (the 36-position governed form assembles, unchanged).
- Full mock: **NO**, for two real reasons:
  1. every cell is below its full-length requirement (**128 eligible items missing**);
  2. the governed PAA blueprint is reduced, so even a full bank needs a **full-length blueprint version** before the engine can deliver a 175-item form.
- **Can the continuous factory fill these cells?** Yes, for all 20 cells with selected-response items:
  - all cells are P1, generation is supported for PAA, and the queue tops up ≤ 5 open requests per run within the daily budget;
  - at 3 items per request and the default budget (20 calls/day), roughly 6–9 accepted items per day is realistic, so about 3–4 weeks of daily runs for one full form (more for 3-form variety);
  - generated items enter **PILOT**: they raise practice coverage at once, but count for mocks only after admin promotion or calibration evidence;
  - Matemáticas student-produced responses are not generated in V1.

### After the controlled batch

The batch ran in certification with the fake AI. **No real batch has run on DEV.**

| Cell | Practice-eligible before → after | Pilot | Mock-eligible | Notes |
|---|---|---|---|---|
| Matemáticas · álgebra | 4 → 7 | +3 | 4 (unchanged) | 2 passed deterministically (key recomputed); 1 had a wrong key → REPAIR → v2 PILOT, v1 SUPERSEDED |
| Lectura · inferencia | 2 → 3 | +1 | 2 (unchanged) | independent validator agreed; a second item with two defensible answers was repaired once, still ambiguous → REJECTED |
| Matemáticas · geometría | 4 → 4 | 0 | 4 | exact copy of a bank item → REJECTED (duplicate) |
| every other cell | unchanged | — | — | |

Readiness after: reduced mock still ready (36/36, no PILOT item in the form), full mock still NO, official coverage 0.

## 5. Required verdicts

| Verdict | Result | Evidence |
|---|---|---|
| QUESTION_BANK_CORE_MODEL | **PASS** | migration + `question_bank_items` / versions / events / targets / snapshots; cert §2–3 |
| QUESTION_BANK_ITEM_VERSIONING | **PASS** | immutability + no-delete triggers; v1 → v2 correction certified (old attempt resolves v1, new forms get v2) |
| QUESTION_BANK_PROVENANCE | **PASS** | AI ⇒ STUDYUS_GENERATED in code, validator and DB CHECK; "official" wording rejected; official coverage 0 |
| QUESTION_BANK_BLUEPRINT_COVERAGE | **PASS** | cells from the versioned blueprint; PAA 20 cells / 36 / 175; configurable targets |
| QUESTION_BANK_GENERATION_QUEUE | **PASS** | durable queue, leases, bounded attempts, backoff (integration) |
| QUESTION_BANK_GENERATION_IDEMPOTENCE | **PASS** | one open request per cell (DB), re-analysis creates nothing, manual idempotency key, SKIP LOCKED distinct claims, one RUNNING run |
| QUESTION_BANK_AI_BUDGET_CONTROL | **PASS** | disabled by default; daily / per-run / shared-cap reserve stops (integration STOPPED_RESERVE with 0 AI calls); rate limit → STOPPED_RATE_LIMIT + backoff; cap never raised |
| QUESTION_BANK_AUTOMATED_VALIDATION | **PASS** (fake AI) | deterministic stages + independent validator judgement + one repair as a new version; **a real-model smoke is still pending** (P1-1) |
| QUESTION_BANK_DUPLICATE_PROTECTION | **PASS** | exact / normalized / template / near / same-numbers / same stimulus + question; DB run rejected an exact copy |
| QUESTION_BANK_HISTORICAL_INTEGRITY | **PASS** | certified on the real schema (cert step 2 + HIST.* checks) |
| QUESTION_BANK_SECURITY | **PASS** | admin-only routes and pages, CRON-protected entry, no keys in admin read models, Students only get sanitized items |
| QUESTION_BANK_PRIVACY | **PASS** | `assertPromptPrivacy` on every call; aggregates only; no Student tables read by factory modules |
| QUESTION_BANK_DYNAMIC_READINESS | **PASS** | overlay in capabilities + instance API; readiness changes when valid content enters (tests); SHADOW default, 364/364 SAME |
| QUESTION_BANK_FULL_MOCK_ASSEMBLY_GATE | **PASS** | assembly-based gate; enough total but a missing cell → false; deliverability + diversity required |
| QUESTION_BANK_REDUCED_MOCK_NON_REGRESSION | **PASS** (local) | PAA reduced form 36/36 assembled through the real `createExamInstance` path; PILOT excluded |
| PAA_BANK_FACTORY_INTEGRATION | **PASS** (local, fake AI) | gap → queue → generate → validate → bank → coverage delta certified; DEV real-AI batch pending (§8) |
| PAA_FULL_MOCK_READY | **NO** | 128 eligible items missing + reduced governed blueprint |
| PAA_FULL_MOCK_CALIBRATED | **NO** | no calibrated items |
| EXAM_OBJECTIVE_FIRST_NON_REGRESSION | **PASS** (unit) | objective-first unit suites green; DEV scenario suite (61) not run |
| EXAM_LEARNING_BRIDGE_NON_REGRESSION | **PASS** (unit) | no Learning Bridge code changed; unit suites green; DEV suites not run |
| HOSTED_DEV_READY_FOR_QUESTION_BANK_MANUAL_E2E | **FAIL** | not deployed, migration not applied on DEV (permission, §0); becomes PASS after §8 |

## 6. Student-facing copy (§68–70)

- PAA no longer shows "Simulacro de formato reducido · Simulacro completo". A FULL_TEST entry shows only the capability name.
- The PAA full-test node is relabelled **"Las cuatro secciones"**. This needs the structure re-apply on DEV.
- The unavailable full mock reads **"Simulacro de longitud completa — StudyUS todavía está ampliando y validando el banco necesario para construir un simulacro de longitud completa."** It is translated into en / de / fr / pt.
- The full-mock note now says "Longitud equivalente a la estructura completa del examen".
- No factory internals reach Students.

## 7. Files

- **Migration:** `database/migrations/20261026_1000_track_b_question_bank_factory.sql`.
- **Core:** `src/lib/exam-core/question-bank/`:
  - `lifecycle`, `policy`, `cells`, `adapters`, `health`, `validation`, `prompts`, `calibration`, `readiness-overlay`, `config-health` (pure);
  - `bank`, `health`, `queue`, `factory`, `calibration`, `admin`, `capability-overlay` services, plus `ai-runner`.
- **Integration points:**
  - `exam-instance.service` (mock pool excludes PILOT);
  - `preparation.service` + `structure.service` (overlay);
  - `apply-vertical-config.service` (registers identities);
  - `item-bank.service` (F7 workflow keeps the lifecycle consistent);
  - `items.ts` (`distractorMisconceptions`);
  - `prompt-registry` (3 prompts);
  - `admin/sections` (nav entry).
- **API:** `src/app/api/admin/question-bank/**` (5 routes) and `src/app/api/internal/question-bank-factory`.
- **UI:** `src/app/dashboard/admin/question-bank/**`; PAA copy in `PreparationHome.tsx`, `messages.ts`, `catalog/structure.ts`.
- **Operations:** `scripts/operations/track-b-question-bank{,-integration}.ts` and `track-b-question-bank-migration-cert.sh`.

## 8. Operator steps to reach HOSTED_DEV_READY (need explicit authorization)

Run each step in `studyos-track-b` and verify the fingerprint `2a29b99ee14a22b4` before any write.

1. Certify locally again (optional):

   ```bash
   bash scripts/operations/track-b-question-bank-migration-cert.sh
   ```

2. Apply the migration to DEV with the governed runner, then confirm 0 pending / 0 drift for this branch:

   ```bash
   npx tsx --env-file=.env.local scripts/db-migrate.ts
   ```

3. Re-apply the structure, for the "Las cuatro secciones" label only (no item change):

   ```bash
   npx tsx --env-file=.env.local scripts/operations/track-b-v2-apply.ts --write --structure-only
   ```

4. Register identities and store snapshots, then compare and report:

   ```bash
   npx tsx --env-file=.env.local scripts/operations/track-b-question-bank.ts health --write
   ```

   ```bash
   npx tsx --env-file=.env.local scripts/operations/track-b-question-bank.ts shadow
   ```

   Expect `shadow` to report all SAME.

   ```bash
   npx tsx --env-file=.env.local scripts/operations/track-b-question-bank.ts report
   ```

5. Run the DEV regression suites (objective-first, aice-pisa, v2, exam V1, delete, profile) with `--env-file=.env.local`.
6. Run ONE real-AI smoke batch for PAA, bounded to 6 calls. This needs ≥ 506 calls left on the shared cap: the 500-call reserve plus 6.

   ```bash
   npx tsx --env-file=.env.local scripts/operations/track-b-question-bank.ts run --exam v2.paa --max-calls 6 --batch 3 --confirm-ai
   ```

   Then run `report` again to record AI calls, tokens, cost, pass rate and the PAA coverage delta.

7. Deploy an immutable DEV build of SHA `1014205`. Use `git archive` into a scratch dir, copy `.vercel/project.json`, and run `vercel deploy --target dev`, without moving the shared DEV alias. Set these env vars on that deployment only:
   - `QUESTION_BANK_FACTORY_ENABLED=true`
   - `QUESTION_BANK_DAILY_BUDGET=10`
   - `QUESTION_BANK_MAX_PER_RUN=6`
   - `QUESTION_BANK_MAX_BATCH=3`
   - `QUESTION_BANK_MIN_REMAINING_AI_RESERVE=500`
   - `QUESTION_BANK_FACTORY_EXAMS` unset (no unattended runs)
   - `QUESTION_BANK_READINESS_MODE=SHADOW`, or ENFORCE if step 4 reported all SAME

   Record the URL, deployment ID and `/api/version`.

8. Hand over `QUESTION_BANK_FACTORY_MANUAL_E2E.md` (not executed by the agent).

## 9. Open items

**P0** — none in code.

- P0-OPS: hosted DEV steps (§8) are not done; the manual E2E is blocked until then.

**P1**

- **P1-1** Real-model smoke of the generator and validator prompts has not run. Prompt quality, pass rate and cost per accepted item are unmeasured.
- **P1-2** PAA full-length delivery needs a governed **full-length blueprint version** (175 positions) alongside the reduced one. The engine delivers the governed blueprint; the factory already proves bank readiness for it.
- **P1-3** The full-length per-cell allocation (official item count apportioned by the reduced blueprint's weights) is a StudyUS policy; it needs content / product review, or a governed per-cell distribution.

**P2**

- **P2-1** The V1 generator is selected-response only: PAA Matemáticas student-produced responses, PISA open responses and IB / AICE markscheme items are not generated.
- **P2-2** Decide SHADOW → ENFORCE on DEV after step 4.
- **P2-3** `src/lib/admin/sections.ts` (shared admin nav) gained one entry; watch for a merge with Track A.
- **P2-4** No per-item response-time telemetry exists in the attempt engine, so monitoring V1 uses scores and options.
- **P2-5** PAA fixture source content keys every item as option "A". It is shuffled at delivery, so Students are not affected; generated items are shuffled at authoring.

**P3**

- QB-4 completion: calibration has no evidence yet, and its thresholds need a review once data exists.
- QB-5: PISA unit generation is untested with a real model, and AICE / IB generation is off.
- QB-6: misconception-driven requests, alerts and a regeneration UI.
- IRT / Rasch: deliberately not claimed.
