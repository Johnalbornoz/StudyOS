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
| `src/services/activity-delivery.service.ts` | The hot path (`deliverCanonicalActivity`), launch lock, emergency completion, launch log |
| `src/services/generation-queue.service.ts` | DB queue: enqueue (dedup), claim (SKIP LOCKED + stale lease), retry/backoff, worker loop |
| `src/services/activity-delivery-worker.service.ts` | `PREPARE_INVENTORY` and `BANK_REPLENISH` handlers, and `scheduleDeliveryReplenishment` (the single trigger) |
| `src/services/activity-candidate-generation.service.ts` | Calls the certified generators per activity type (background only) |
| `src/app/api/internal/generation-worker/route.ts` | `POST`, `Bearer CRON_SECRET` (fails closed). Drains the queue. |

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
- **Execution:**
  - In-request triggers run the worker inside `after()` (Vercel `waitUntil`).
  - `POST /api/internal/generation-worker` is the scheduled drain.
  - The Vercel cron for that endpoint is **not configured yet**. It is a production rollout step.
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

## Benchmark

Script: `scripts/bench-activity-delivery.ts`. It is guarded to the DEV fingerprint and uses one idempotent synthetic learner, `bench:activity-delivery`. It never touches a real learner.

```bash
npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/bench-activity-delivery.ts --scenario=all --runs=3 --launches=20
```

Every launch runs the route's hot path in-process: canonical authorization, then `deliverCanonicalActivity`. AI calls are counted per launch.

There are three scenarios.

### HOT (`--scenario=hot`)

- **Setup:** a SYNTHETIC validated bank is created once, before all runs. It is never topped up between launches.
- **Runs:** each run launches every type 20 times.
  - Odd launches first run the worker (`PREPARE_INVENTORY` only), so both the INVENTORY and BANK paths are exercised.
  - Each run also fires 5 concurrent double-click pairs per type.
- **TRANSFER:** uses a synthetic contract, because the real engine cannot reach TRANSFER yet (see Runtime caveats).

### STEADY STATE (`--scenario=steady`)

- **Setup:** a real subject that starts **from zero**, with an empty bank and no inventory. Its bank is filled only by the REAL worker. `BANK_REPLENISH` runs the certified generators with real AI calls in the background. The benchmark inserts nothing.
- **Warm-up:** the real triggers queue the jobs. The warm-up waits until each type reaches its **policy targets**: READY inventory at `inventoryTarget`, and `SPARE_ASSEMBLABLE_SETS` complete sets still assemblable from the bank beyond it.
- **Tracks:** one learner track per type runs concurrently, launching every `--think` seconds (default 30 s, deliberately faster than a real learner).
- **Worker:** the worker loop runs in a **separate process**, with its own pool and event loop, the way the protected worker endpoint runs in its own invocation. In production, `after()` replenishment runs in the instance that served the request, so it can share that instance's pool with concurrent requests. The worker endpoint (cron) does not.
- **Measured per type:**
  - latency;
  - inventory hit rate and bank assembly rate;
  - replenishment jobs, by kind and status;
  - READY count before each launch;
  - emergencies;
  - background AI calls, counted apart from the hot path.
- **Integrity checks:**
  - duplicate open queue jobs;
  - duplicate bank content;
  - independent-check candidates delivered twice.

### TRUE COLD MISS (`--scenario=cold`)

For each type, the benchmark does the following:
1. It drains the controlled contract: READY rows become INVALIDATED, and the whole VALIDATED bank becomes RETIRED. This applies to the benchmark learner only.
2. It launches. The expected result is `EMERGENCY_REQUIRED` with 0 AI calls, and a replenishment job queued.
3. It runs the worker until a READY activity exists.
4. It launches again. The expected result is INVENTORY or BANK with 0 AI calls.

In the product, the route answers `EMERGENCY_REQUIRED` with the explicit, logged EMERGENCY_GENERATION. The benchmark measures the delivery layer, which never calls AI.

### Gates

These gates apply to HOT and STEADY STATE:
- `HOT_PATH_AI_CALLS = 0`
- `P95 < 2 s`
- `P99 < 5 s`
- `DUPLICATE_ACTIVE_SESSIONS = 0`
- `FAILED_LAUNCHES = 0`

STEADY STATE also requires no `EMERGENCY_REQUIRED` in normal operation and no duplicate open queue jobs.

COLD MISS requires the launch to be controlled, the miss to be recoverable, and no synchronous AI call.

Each scenario first closes queue jobs that an interrupted earlier run left open for the benchmark learner. Their leases would otherwise read as generation in flight.

A type the real engine cannot launch is reported as `BLOCKED`. It is never simulated in STEADY STATE or COLD MISS.

The benchmark runs from a laptop, so every figure includes the laptop-to-Neon round trips (about 100 ms each). An in-region Vercel function pays only a small fraction of that.

## Runtime caveats

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
