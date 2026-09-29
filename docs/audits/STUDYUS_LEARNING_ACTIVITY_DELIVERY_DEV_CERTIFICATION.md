# LEARNING_ACTIVITY_DELIVERY_ARCHITECTURE_DEV — certification

**Verdict: `LEARNING_ACTIVITY_DELIVERY_ARCHITECTURE_DEV = PASS`**

- **Certified runtime:** `a44e2f6`, deployed on hosted DEV. The benchmark confirmed that the deployment served the same SHA as the checkout before any scenario ran.
- **Architecture design and protocol:** `docs/architecture/ACTIVITY_DELIVERY.md`.
- **Later commit:** the follow-up commit that adds this report changes only the benchmark report classifiers and this document. No runtime code changed after `a44e2f6`.

## Baseline

| | |
|---|---|
| `DEV_BASELINE_RESTORED` | **PASS**. B (quiz_sessions `timestamptz`) and A (activity delivery) are separate commits on `develop`. C (RETAIN novelty) lives on `fix/retain-novelty-transfer`, not merged. |
| `DEV_WORKER_ISOLATION` | **PASS** (see below) |
| Deployment | `a44e2f6` on hosted DEV (custom environment `dev`), functions in `iad1` |
| Database | DEV fingerprint `2a29b99ee14a22b4`, Neon `us-east-2`. It is **not in the same region as the functions**: every round trip crosses from us-east-1 to us-east-2. |
| Migrations | 40 applied, 0 pending, 0 drift (`20261016_1000_activity_delivery`, `20261017_1000_quiz_sessions_timestamptz`) |
| AI budget during certification | DEV limits temporarily set to 7000/day and 120/min (authorized), then restored to 500/day and 20/min and verified |

## Worker isolation (DEV_WORKER_ISOLATION = PASS)

| Check | Result |
|---|---|
| `POST /api/internal/generation-worker` with no secret, a wrong secret, and the right secret | 401 / 401 / 202 |
| `POST /api/internal/delivery-bench` without the secret | 401 |
| A learner-facing request that triggers replenishment (`sqbcb-…`) | only `[generation-queue] enqueued` and `[worker-dispatch] dispatched (202)` are logged, and **0 AI log lines** |
| The worker's own invocation (`n252g-…`) | `drain_started` / `drain_finished`, and **all AI executions happen here** |
| Static guard | Only the worker endpoint executes the queue (`tests/unit/activity-delivery-worker-isolation.test.ts`) |
| After restoring limits | The worker still answers 401 / 401 / 202, and 0 benchmark jobs are open |

## Certification gates

All latencies are **server-side**, measured inside the hosted DEV runtime from authorize through decision, inventory/bank, assembly and session. E2E (laptop → Vercel) is reported apart.

| Scenario | P50 | P95 | P99 | Emergency | Hot-path AI | Duplicates | Failures | Launches | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| STEADY (realistic) | 378 ms | 493 ms | 818 ms | **0** | **0** | **0** | **0** | 96 | **PASS** |
| COLD (recovery) | 357 ms | 986 ms | 986 ms | 8 = controlled misses, 1 per drain | **0** | **0** | **0** | 16 | **PASS** |
| HOT | 183 ms | 272 ms | 729 ms | **0** | **0** | **0** | **0** | 300 | **PASS** |

**STEADY:**
- **Start:** an empty bank. The deployed worker alone filled it in 91 s.
- **Cadence:** item count × 20 s (LEARN_CHECK 100 s, PRACTICE 60 s, PROVE 200 s, RETAIN 200 s).
- **Delivery:** inventory hit rate 0.92 for every type, and 0 launches found no READY activity.
- **Integrity:** 0 duplicate delivered items, 0 corrupt sessions, 0 evidence written by launches.
- **Replenishment:** automatic. The worker inserted 17 / 14 / 256 / 259 candidates. E2E p95 was about 1.1–2.5 s.

**COLD:** 4 types × 2 repetitions. Every repetition passed:
- the cold launch returned `EMERGENCY_REQUIRED` with 0 AI calls;
- a job was queued within about 110–145 ms;
- the worker recovered in 8.5–46.6 s (time to recovery);
- the next launch was served from INVENTORY with 0 AI calls.

A caveat: a reset closes jobs, but it cannot stop a worker invocation that is already running. One PRACTICE repetition therefore recovered from generation that was still in flight from the previous repetition (8.5 s, 0 new candidates).

**HOT:**
- **Bank:** synthetic, created once and never topped up.
- **Launches:** 3 runs × 5 types × 20 launches, plus 5 concurrent double-click pairs per type and run. Inventory hit rate was 0.98.
- **TRANSFER:** it used a synthetic contract, because the real engine cannot reach TRANSFER until RETAIN novelty (branch C) lands.

**TRANSFER** is `BLOCKED` in STEADY and COLD. It is not simulated, for the same reason.

## Stress / capacity observations (not a gate)

STRESS used the STEADY setup with a launch every 30 s per type, with the 4 types running concurrently: 96 launches.

| P50 | P95 | P99 | Emergency | Hot-path AI | Duplicate sessions | Duplicate items | Failures |
|---|---|---|---|---|---|---|---|
| 305 ms | 442 ms | 544 ms | 2 of 96 (2.1%) | 0 | 0 | 0 | 0 |

**Emergencies and invariants:**
- **The two emergencies:** both came from **one** PROVE double-click pair where **both clicks got `EMERGENCY_REQUIRED` and no session was opened**. The run's classifier counted that pair as a "mismatch", and its verdict line printed `invariants VIOLATED`. That was a classifier error, fixed in the follow-up commit that adds this report: the pair has no duplicate session (max active duplicate sessions = 0, duplicate items = 0).
- **The invariants all held:** 0 hot-path AI, 0 duplicate items, 0 duplicate sessions, 0 corruption, 0 evidence written.
- **In the product:** the route answers `EMERGENCY_REQUIRED` with the explicit EMERGENCY_GENERATION. At this stress rate, 2 of 96 learner launches would have waited for AI.

**Capacity metrics:**
- **Inventory depletion:** 0 launches without READY.
- **Replenishment throughput:** 42 validated candidates/min.
- **Generation throughput:** 49.7 candidates/min.
- **Queue depth:** at most 12 open jobs.
- **Peak AI calls/min:** 85 (limit 120). No `AI_RATE_LIMIT_PRESSURE` was recorded.
- **AI cost:** 543 calls, about 2830 provider-seconds, models `gpt-5.6-terra` / `gpt-5.6-luna`. No token or USD accounting is persisted.

**AI usage for the whole certification:**
- **Benchmark calls:** STEADY 552, COLD 250, HOT 0, STRESS 543, about 1350 in total.
- **Composition:** about half is generation and half is quality evaluation (696 QUESTION_GENERATION and 692 EXPLANATION_EVALUATION).
- **Rate limiting:** 0 rate-limited calls. The run never came near the 6000 day ceiling.

## DEV_AI_CAPACITY_500_20 = OBSERVATION

These numbers are measured on this run, in AI calls per activity type. Each validated candidate costs about 2 calls: one generation and one quality evaluation.

| Activity | One-time fill when a concept reaches that stage (1 READY + 2 spare sets) | Steady cost per launch |
|---|---|---|
| LEARN_CHECK | about 20 calls | about 0: assisted activities reuse the bank |
| PRACTICE | about 16 calls | about 0 |
| PROVE (10 independent items) | about 84 calls | **about 11 calls** (216 calls / about 20 launches) |
| RETAIN (10 independent items) | about 46 calls | **about 7 calls** (148 / about 20) |

What **500/day and 20/min** allow in practice, summed across every learner in DEV:
- **Per day:**
  - about **45 PROVE launches** or **70 RETAIN launches**;
  - or about **6 concepts entering PROVE**, where each fill costs 84 calls.
  - A learner who takes one concept from PRACTICE to PROVE in a day costs about 16 + 84 + 11 ≈ **110 calls**, so about **4–5 such learners per day**.
- **Per minute:** 20 calls is about **1–2 independent checks per minute** across the whole platform. One PROVE fill uses more than 4 minutes of the whole per-minute budget.
- **Simultaneous learners:**
  - **Practice-only learners** on concepts that are already filled cost about 0 AI per launch. They are limited by nothing here.
  - **Learners who reach PROVE or RETAIN at the same time** are the constraint. Two or three concurrent PROVE fills already saturate 20/min for several minutes, and the next independent launches would fall to `EMERGENCY_REQUIRED`. The emergency generation that follows draws from the same exhausted budget.

This is a property of DEV's configured budget, **not of the architecture**. The architecture was certified above with sufficient budget.

**Operational note:** today's global counter ended above 500 because of the certification. After the restore, DEV AI is rate-limited until the 00:00 UTC reset.

---

# RETAIN → TRANSFER integration (`fix/retain-novelty-transfer`)

**`RETAIN_TRANSFER_INTEGRATION_DEV = PASS` · `TRANSFER_DELIVERY_REAL_ENGINE_DEV = PASS` · `DEV_AI_LIMITS_RESTORED = PASS`**

## Integration

- **Commits on `develop`:**
  - `7f18f98` is the RETAIN novelty fix (branch C), rebased onto `c6fe5cf`. The only conflict was a pair of import lines, and it kept both sides.
  - `736410b` adds benchmark options only (`--types`, `--quotaReserve`, `--estimates`).
- **Nothing else mixed in.** The Activity Delivery core (resume, consume, assembly, queue, worker) is unchanged. The only delivery change is that a RETAIN session now carries the same novelty marker as PROVE. For that reason the full Activity Delivery certification was **not** repeated.
- **Checks:**
  - full suite: 396 files and 6210 tests pass;
  - typecheck and build pass;
  - DEV: 40 migrations applied, 0 pending, 0 drift;
  - deployment `736410b` matched the checkout.

## RETAIN novelty and RETAIN → TRANSFER (real engine)

- **Unit tests:** `tests/unit/canon-retain-novelty-unlocks-transfer.test.ts` runs the real fetch, adapter and engine.
  - A novel, independent, 10-item RETAIN at 80% or above, taken 3 or more days after PROVE, moves the concept to **TRANSFER**.
  - An unstamped (legacy) RETAIN does not qualify, and nothing is regraded retroactively.
- **Real engine on DEV data:** the concept with a certified RETAIN resolves **TRANSFER**, with 3 items, difficulty 4–5 and independent. A concept without one stays at RETAIN.
- **Hosted DEV:**
  - A RETAIN session delivered from INVENTORY, with 0 AI, carries the novelty marker `EXACT_DUPLICATE_EXCLUSION_V1` with 10/10 accepted items.
  - The real engine authorizes `canonical_transfer`.
- **Not exercised live:** the submission-time `metadata.novel` stamp needs a Clerk session and AI grading. It is covered by the certification helper and write-path tests, and the Student E2E will exercise it on the next real RETAIN.

## TRANSFER delivery with the real engine (hosted DEV, server-side latency)

| Scenario | P50 | P95 | P99 | Emergency | Hot-path AI | Duplicates | Failures | Launches | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| TRANSFER STEADY (60 s cadence = 3 items × 20 s) | 382 ms | 442 ms | 442 ms | **0** | **0** | **0** | **0** | 24 | **PASS** |
| TRANSFER COLD (2 repetitions) | 172 ms | 175 ms | 175 ms | 2 controlled misses | **0** | **0** | **0** | 4 | **PASS** |

**STEADY:**
- **Setup:** the concept started from an empty bank. The deployed worker filled it (1 READY and 2 spare sets) in 21 s.
- **Delivery:** inventory hit rate 0.92, and 0 launches found no READY activity.
- **Replenishment:** the worker inserted 75 candidates. E2E p95 was 1.07 s.
- **Session integrity:**
  - All 24 TRANSFER sessions hold exactly one **NEAR, one CONTEXTUAL and one HIGHER** challenge.
  - 0 duplicate delivered items and 0 duplicate sessions (0 double-click mismatches).
- **Learner state:**
  - 0 evidence written by launches.
  - The learner state still resolves TRANSFER afterwards.
  - The concept's evidence is unchanged (5 rows, the latest one from the seed).

**COLD:** each repetition went launch → `EMERGENCY_REQUIRED` with 0 AI (152–309 ms) → job queued within about 110 ms → the worker recovered in 4.3–8.6 s → the next launch was served from INVENTORY with 0 AI. The second repetition reused generation still in flight from the first, the same caveat as in the main COLD run.

**AI usage:** 93 benchmark calls (75 in STEADY, 18 in COLD), against an estimate of about 380. The peak was 15 calls/min, with no rate-limit pressure.

## DEV AI limits

- **Raised:** limits were set to 7000/day and 120/min for the run, with the day ceiling guard at 2500.
- **Restored:** 500/day and 20/min, **verified on hosted DEV**.
- **Counter:** the global day counter was never touched manually. It ended at 1315 for UTC 2026-09-29, so DEV AI is rate-limited until the next 00:00 UTC reset.
- **After the restore:**
  - the worker answers 401 without a secret and 401 with a wrong one;
  - 0 benchmark jobs and 0 active benchmark sessions are open;
  - Stage and Production were not touched.
