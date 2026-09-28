# Learning Activity Delivery Architecture

Gate: `LEARNING_ACTIVITY_DELIVERY_ARCHITECTURE_DEV`. Migration: `20261016_1000_activity_delivery` (DEV only).

**Principle:** a learner never waits for AI to generate an activity. AI generation and validation run in the background. Launching an activity only retrieves or assembles validated content.

## Before / after

**Before:** `POST /api/quizzes/generate-and-take` ran the whole generation synchronously. It authorized the request, took the canonical decision, called the generator(s) (1–3 AI calls, 8–40 s), validated the output, applied novelty filtering, stored the session and returned. Only PROVE had a partial shortcut: a single AI-prepared set with a TTL.

**After:** the launch hot path makes 0 AI calls:

```
authorize → canonical decision (v1 marker) → launch lock (xact advisory)
  → resume an equivalent open session                         (RESUMED)
  → else consume a compatible READY prepared activity        (INVENTORY)
  → else assemble from the VALIDATED question bank           (BANK)
  → else EMERGENCY_REQUIRED: explicit, logged AI generation   (EMERGENCY_AI)
→ create session → respond → after(): schedule replenishment
```

Generation happens only in the background worker:
- The worker fills the **question bank**.
- The worker assembles bank content into **prepared inventory**.

Emergency generation is the only synchronous AI path. It is never the normal path:
- It logs `[activity-launch] EMERGENCY_GENERATION`.
- It is recorded in `quiz_sessions.delivery_source = 'EMERGENCY_AI'`.
- Its output is banked for reuse.

`generate-and-take` stays in place as the compatibility entry point. Canonical modes (`canonical_learn_check`, `topic_practice`, `canonical_prove`, `canonical_retain`, `canonical_transfer`) go through `deliverCanonicalActivity`. Non-canonical modes are unchanged.

## Components

| Module | Role |
|---|---|
| `src/lib/activity-delivery/contract.ts` | Pure: activity contract fingerprint, learner-state fingerprint, compatibility rules, replenishment targets |
| `src/lib/activity-delivery/assembly.ts` | Pure: builds a set from bank candidates. Diversity comes from the existing `selectDiverse` (not duplicated). TRANSFER takes one per depth. A set is never incomplete. |
| `src/services/question-bank.service.ts` | Bank I/O: add validated candidates, load pool, record deliveries |
| `src/services/activity-assembly.service.ts` | Loads pool + novelty exclusions (reuses the PROVE/RETAIN fingerprint loaders), then assembles |
| `src/services/activity-inventory.service.ts` | Prepared inventory: atomic consume, reconcile, retire, store READY |
| `src/services/activity-delivery.service.ts` | The hot path (`deliverCanonicalActivity`), the one `buildDeliveryInput`, emergency completion, launch log |
| `src/services/activity-launch-lock.service.ts` | The transaction-scoped launch lock, shared by launches and the worker |
| `src/services/worker-dispatch.service.ts` | Hands queued work to the worker endpoint in a separate invocation |
| `src/services/generation-queue.service.ts` | DB queue: enqueue (dedup), claim (SKIP LOCKED + stale lease), retry/backoff, worker loop |
| `src/services/activity-delivery-worker.service.ts` | `PREPARE_INVENTORY` and `BANK_REPLENISH` handlers, and `scheduleDeliveryReplenishment` (the single trigger) |
| `src/services/activity-candidate-generation.service.ts` | Calls the certified generators per activity type (background only) |
| `src/app/api/internal/generation-worker/route.ts` | `POST`, `Bearer CRON_SECRET` (fails closed). THE executor: answers 202 and drains the queue in its own invocation. |
| `src/app/api/internal/delivery-bench/route.ts` | DEVELOPMENT ONLY. Runs the route's launch path server-side for the synthetic benchmark learner (see Benchmark). |

## New tables / columns

- **`question_bank_candidates`:** one validated question per row, scoped per learner and concept. Each row stores:
  - the question JSON, answer and explanation;
  - activity_type, language, academic context and its fingerprint, and difficulty 1–5;
  - question_type, answer_format, reasoning_type, cognitive_level, intent, skill and misconception target, and transfer_depth;
  - content fingerprint and template signature;
  - `validation_status` (VALIDATED / REJECTED / RETIRED);
  - generator provider, model, prompt id and prompt version;
  - usage_count and last_used_at.

  `UNIQUE(concept_id, activity_type, language, content_fingerprint)` prevents exact duplicates.
- **`question_bank_deliveries`:** one row per (candidate, quiz_session). Independent checks (PROVE/RETAIN/TRANSFER) never re-deliver a candidate.
- **`generation_jobs`:** the queue. Columns: kind, dedup_key, payload, status (PENDING / RUNNING / SUCCEEDED / FAILED), attempts, max_attempts, run_after, lease, last_error, result. There is at most one open job per `dedup_key`.
- **`canonical_prepared_activity`** (generalized):
  - It now holds all stages LEARN/PRACTICE/PROVE/RETAIN/TRANSFER.
  - It gains status `EXPIRED`, plus `contract_fingerprint`, `learner_state_fingerprint`, `source` (AI | BANK), `slot` and `candidate_ids`.
  - At most one open row is allowed per (learner, concept, stage, policy, slot).
- **`quiz_sessions.delivery_source`:** INVENTORY / BANK / EMERGENCY_AI (NULL for legacy and non-canonical launches).

Delivery is kept separate from evidence. A launch writes only `quiz_sessions` and delivery metadata. Evidence (`learning_evidence`, `quiz_responses`, `quiz_response_grades`) is still written only at submit, by the certified grading and audit pipeline.

## Activity contract and invalidation

- **Contract fingerprint:** sha256 over:
  - concept, activityType and language;
  - academic context (curriculum, programme, year, IB group, HL/SL);
  - difficulty band (min / max / target) and item count;
  - independence and policy version;
  - generator version and grader version (from `PROMPT_REGISTRY`).
- **Learner-state fingerprint:** evidence count, last evidence id, ACTIVE critical misconceptions and hints used.

A prepared activity is deliverable only while **both** fingerprints still match. The TTL of 24 h is only a backstop. Reasons for retiring a row:

| Reason | Status |
|---|---|
| `LEGACY_PREPARATION` (no fingerprints; old AI-prepared PROVE rows) | INVALIDATED |
| `CONTRACT_CHANGED` | INVALIDATED |
| `LEARNER_STATE_CHANGED` | INVALIDATED |
| `STAGE_CHANGED` (canonical next action moved to another stage) | INVALIDATED |
| `NO_LAUNCHABLE_ACTIVITY` (waiting / consolidated / blocked) | INVALIDATED |
| `CANDIDATE_DELIVERED` (independent check: one of its candidates was delivered meanwhile; defense in depth, see Idempotency) | INVALIDATED |
| past `expires_at` | EXPIRED |

Consumption is one atomic statement:
1. It locks the READY rows with `FOR UPDATE SKIP LOCKED`.
2. It retires the incompatible rows, using the same rules as `preparedActivityCompatibility`.
3. It consumes the first compatible row.

Each READY activity is delivered at most once.

## Replenishment policy

- **Inventory targets:**
  - The canonical next action has at least 1 READY activity.
  - PRACTICE keeps 2.
  - PROVE keeps 1 full, validated set of 10.
  - TRANSFER keeps 1 set of 3 (NEAR / CONTEXTUAL / HIGHER).
- **Bank depth:** `SPARE_ASSEMBLABLE_SETS` (2) complete sets that the bank can still assemble beyond the READY inventory, per (learner, concept, activity type, language, academic context). Depth is measured by running the real assembly (`countAssemblableSets`: difficulty band, novelty exclusions, diversity), never by counting raw candidates. Leftovers of earlier assemblies are often near-duplicates of each other and cannot form a valid set.
- **Triggers:** all of them call `scheduleDeliveryReplenishment`, always from `after()` so they run after the response:
  - an activity is submitted;
  - Concept Mission is opened;
  - Today is opened (for its next action);
  - a READY activity is consumed;
  - a bank or emergency launch occurs;
  - learner state changes. This happens at submit, and it is also detected lazily through the fingerprint.
- **`PREPARE_INVENTORY` handler:**
  1. Resolves the fresh decision.
  2. Reconciles inventory.
  3. Assembles READY sets up to the target.
  4. Queues `BANK_REPLENISH` if the bank is shallow or short.
  5. Queues a delayed follow-up preparation if the bank was short.
- **Bank requests:** `PREPARE_INVENTORY` asks only for what is missing: (`SPARE_ASSEMBLABLE_SETS` − spare sets) × item count − generation already in flight (`openBankSupply`). It splits that need into generator-sized **chunks** (`bankChunks`). Each chunk is its own `BANK_REPLENISH` job, keyed `bank:…:c<i>`, and the chunks run in parallel. The in-flight subtraction means repeated triggers never over-generate.
- **`BANK_REPLENISH` handler:**
  1. Generates one chunk.
  2. Banks the validated candidates and keeps partial progress.
  3. Re-queues only the chunk's remainder, as `…:c<i>:r<n>` (at most 5 rounds).
  4. If a round produced nothing, it is retried with backoff (at most 3 attempts).

## Worker / queue

- **Dedup:** partial unique index on `dedup_key` over open jobs.
- **Concurrency:** claims use `FOR UPDATE SKIP LOCKED`. A worker runs N independent **slots**, and each slot claims its next job as soon as it is free. There is no batch barrier, so a slow AI bank chunk never holds back the quick `PREPARE_INVENTORY` jobs behind it.
- **Draining:** a slot that finds nothing waits while any other slot is still working, because that job may queue follow-ups. The run ends when every slot is idle, or at `maxJobs` or the deadline.
- **Leases:** a stale `RUNNING` job is reclaimed after 10 minutes.
- **Retries:** exponential backoff from 20 s, then `FAILED` at `max_attempts`.
- **Logging:** one `[generation-queue]` log line per state change.
- **Execution (worker isolation):**
  - A learner-facing request, and its `after()`, **only enqueues and dispatches**. It never runs AI generation or validation in the instance that serves the learner.
  - `dispatchDeliveryWorker` calls `POST /api/internal/generation-worker` on this deployment. It authenticates with `Bearer CRON_SECRET` and, behind Deployment Protection, with the automation bypass.
  - The worker endpoint answers **202** immediately and drains the queue in `after()` of its **own** invocation (`maxDuration` 300 s). That endpoint is the only place in the app that executes the queue, and a guard test enforces it.
  - Without `CRON_SECRET` or a deployment URL (local scripts), dispatch is a no-op, and jobs stay queued for the next dispatch or the scheduler.
  - Vercel Cron runs only for Production deployments. A cron for the worker endpoint is a Production rollout step. On DEV, draining relies on dispatch.
- **Cost instrumentation:** background generation runs under `runWithAiMetrics`. All AI routes are wrapped with `withAiRequestMetrics`, and an import-graph guard test enforces this.

## Idempotency

- **Launch lock:** each launch takes a transaction-scoped `pg_advisory_xact_lock` on `activity-launch:{student}:{concept}:{quizMode}`, in one round trip.
  - The lock is released by COMMIT (or by ROLLBACK on error).
  - Session-level advisory locks are unsafe behind the PgBouncer transaction pooler. They were found to orphan during the benchmark.
- **Worker under the same lock:** the worker assembles and stores READY activities while holding the SAME launch lock. It therefore never reads the bank in the middle of a launch that is delivering from it, because a launch records its deliveries before releasing the lock. Without this, the STEADY benchmark found a READY built from candidates that a concurrent BANK launch had just delivered. Consumption and reconciliation also retire such a row (`CANDIDATE_DELIVERED`), so an independent check can never repeat an item.
- **Session identity:** under the lock, an equivalent open session is looked up (`findResumableCanonicalSession`). An equivalent session has the same mode, policy, contract and item count, and is not expired or submitted.
  - A double click gives 1 session.
  - A refresh, or returning to the concept, resumes that session.
- **Identity key:** the session id (the quiz id) identifies the launch. Difficulty is part of the contract, not of navigation identity.

## Observability

Each launch logs one `[activity-launch]` line with these fields:
- source (RESUMED / INVENTORY / BANK / EMERGENCY_AI);
- aiCalls;
- timings (lock / resume / inventory / bank / session).

`HOT_PATH_AI_VIOLATION` is logged as an error if any AI call happens on a non-emergency launch.

## Benchmark (certification protocol)

Script: `scripts/bench-activity-delivery.ts`. **Hosted DEV only.**

```bash
BENCH_SECRET_FILE=<0600 file holding the DEV CRON_SECRET> BENCH_OUT_DIR=<dir> \
  npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/bench-activity-delivery.ts --scenarios=steady,cold,hot,stress
```

### Where latency is measured

- **Server-side, in the hosted runtime.** Every launch runs inside hosted DEV through the DEV-only endpoint `POST /api/internal/delivery-bench`. That endpoint runs the route's own launch path, measured from authorize through decision, inventory/bank, assembly and session. It shares the route's `buildDeliveryInput` and `deliverCanonicalActivity`.
  - **Gates:** P50/P95/P99 use this **server-side** time.
  - **E2E:** laptop → Vercel round trips are reported apart as E2E, and are never a gate.
- **Endpoint safeguards.** The endpoint fails closed on three gates:
  - it answers 404 outside Development;
  - it requires `Bearer CRON_SECRET`;
  - it only touches the synthetic learner `bench:activity-delivery`.
  Clerk session verification is not part of the delivery backend and is not reproduced. Authorization runs the route's same reads, read-only.
- **Alignment check.** Before anything runs, the benchmark refuses to start unless the deployment serves exactly the checkout's SHA. It records the function region, the database region, the database fingerprint and the migration ledger.

### How the benchmark runs

- **No local worker.** DEV replenishes itself: `after()` dispatches, and the worker endpoint drains the queue in its own invocation.
- **Administration from the laptop.** Through the fingerprint-guarded DEV database, the laptop only administers the synthetic learner:
  - idempotent setup;
  - resets, which close that learner's open jobs and expire its sessions;
  - controlled drains;
  - read-only verification.

### Scenarios

| Scenario | Role | Setup | Gates |
|---|---|---|---|
| STEADY | certification | Real subject starting from an **empty** bank. The worker alone fills it to the policy targets. One learner per type launches at a **realistic cadence**: item count × 20 s (PRACTICE 3 → 60 s, PROVE/RETAIN 10 → 200 s). It ends with double-click pairs. | `EMERGENCY_REQUIRED = 0`, `HOT_PATH_AI_CALLS = 0`, `DUPLICATE_ACTIVE_SESSIONS = 0`, `DUPLICATE_DELIVERED_ITEMS = 0`, `FAILED_LAUNCHES = 0`, P95 < 2 s, P99 < 5 s, replenishment automatic (candidates inserted by the worker), 0 corrupt sessions, 0 evidence written by launches |
| COLD | certification (recovery) | For each type, the contract is drained: READY invalidated, bank retired. The sequence is launch → `EMERGENCY_REQUIRED` with 0 AI → job queued → worker → READY → the next launch is served from INVENTORY or BANK with 0 AI. | All steps; `time_to_recovery` is measured |
| HOT | certification | A deep **synthetic** bank, created once and never topped up. 3 runs × 5 types × 20 launches, plus 5 concurrent double-click pairs per type and run. | As STEADY |
| STRESS | capacity (no SLO gate) | STEADY at a launch every 30 s. | Only the invariants: 0 hot-path AI, 0 duplicate items, 0 duplicate sessions, 0 corruption, 0 evidence writes |

STRESS reports these capacity metrics:
- emergency rate;
- inventory depletion;
- replenishment and generation throughput;
- queue depth;
- AI calls;
- time to recovery;
- latency.

A type the real engine cannot launch is reported as `BLOCKED`. It is never simulated in STEADY, STRESS or COLD.

### AI quota guard

DEV's AI limit is global (`ai_global_limits`) and shared with manual E2E testing.
- **Before each scenario:** the scenario starts only if `remaining_daily ≥ estimate + 1000`.
- **During the scenario:**
  - the per-minute counter is sampled, and any minute at 90% or more of the limit is recorded as `AI_RATE_LIMIT_PRESSURE`;
  - the scenario stops if fewer than 1000 daily calls would remain.
  - the run also stops when the day's global calls reach `--dayCallCeiling` (default 6000), or when more than `--openJobsAnomaly` jobs (default 150) are open at once, which signals a replenishment loop rather than load.
- **After each scenario:** the benchmark learner's open jobs are closed, so no benchmark AI keeps running.
- **Attribution:** AI usage is attributed to the benchmark learner through `ai_execution_events.student_id`. No token or USD accounting is persisted, so cost is reported in calls.

## Runtime caveats

- Vercel functions run in `iad1` (us-east-1) and the DEV Neon database is in `us-east-2`. They are **not in the same region**, and every database round trip crosses regions.
- `quiz_sessions.created_at`, `completed_at` and `expires_at` are `timestamptz` (migration `20261017_1000`), and `storeQuiz` sets them with the database `now()`. Scripts no longer need `TZ=UTC`. On a database that has not yet run this migration, the columns still hold UTC wall time.
- RETAIN evidence is never marked `novel` by the evidence adapter (a pre-existing gap, fixed separately on `fix/retain-novelty-transfer`). Until that lands, TRANSFER is not reachable from real evidence. HOT exercises TRANSFER delivery with a synthetic contract, and STEADY STATE / COLD MISS report TRANSFER as `BLOCKED`.

## Rollback strategy

1. **Code:** revert the delivery commit(s) on `develop` and redeploy.
   - `generate-and-take` goes back to synchronous generation.
   - The new columns are nullable or defaulted, so old code ignores them.
2. **Data:** no data rollback is needed. The migration is additive: new tables, nullable or defaulted columns, and widened CHECK constraints. As part of a code rollback, retire the open inventory so the restored legacy PROVE preparation starts clean:

   ```sql
   UPDATE canonical_prepared_activity SET status='INVALIDATED', failure_reason='ROLLBACK' WHERE status IN ('PREPARING','READY')
   ```

3. **Schema (only if required):** drop `generation_jobs`, `question_bank_deliveries` and `question_bank_candidates`, and the new columns. This runs only with explicit authorization, and always as a dry run (ROLLBACK) first.
