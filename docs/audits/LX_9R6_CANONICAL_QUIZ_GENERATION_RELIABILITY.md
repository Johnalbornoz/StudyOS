# LX-9R6 — CANONICAL QUIZ GENERATION RELIABILITY

## STATUS

**PASS_WITH_CONDITIONS**

CODE PASS is met: one explicit activity-to-generation matrix already existed and is now
documented and tested; pre-AI contract validation is confirmed for every activity; the
question-count contract is confirmed reliable (SOLO_CHECK forced-6 is exact and cannot
silently shrink); schema consistency across every generator is confirmed (one shared
schema, no drift); the live SOLO_CHECK generation-reliability gap is root-caused and
fixed with a unified retry behavior; a precise internal error taxonomy was added to the
one path that lacked it; the full regression suite is green.

CONDITION (same condition every phase in this engagement has honestly reported): this
environment has no live browser, database, or AI-provider access. Part P (live
performance benchmark) and Part Q (live failure-rate sample) could not be run. No
number is fabricated for either — they are reported as NOT MEASURABLE HERE, with the
exact commands a Preview environment should run to obtain them.

---

# GENERATION MATRIX

## ACTIVITY → MODE → GENERATOR

| ActivityType | QuizMode | Generator | Route/Pipeline |
|---|---|---|---|
| `PRACTICE` | `topic_practice` | `generatePracticeQuestions` (chunked, ≤4/chunk, partial-tolerant) | `/api/quizzes/generate-and-take` |
| `REVIEW` | `review` | `generatePracticeQuestions` (same as PRACTICE — same cognitive shape, AI may assist) | `/api/quizzes/generate-and-take` |
| `SOLO_CHECK` | `quick_check` | `generateQuickCheckQuestions` (6 parallel single-question slots, all-or-nothing) | `/api/quizzes/generate-and-take` |
| `RETENTION_CHECK` | `retention_check` (count===6 only) | `generateRetentionCheckQuestions` (2×3-candidate chunks, per-question gate, deficit-recovery) | `/api/quizzes/generate-and-take` |
| `DIAGNOSTIC_CHECK` | `diagnostic_check` | `generateGatedQuestionBatch` → `generateQuestionsForConcept` | `/api/quizzes/generate-and-take` |
| `CUMULATIVE_ASSESSMENT` | `cumulative_assessment` | `generateGatedQuestionBatch` → `generateQuestionsForConcept` (once per selected concept) | `/api/quizzes/generate-and-take` |
| `MOCK_EXAM` | `exam_simulation` | `generateGatedQuestionBatch` → `generateQuestionsForConcept` (once per selected concept) | `/api/quizzes/generate-and-take` |
| `REMEDIATION` | *(none — composite)* | Reuses `topic_practice` (LEARN/GUIDED_PRACTICE step) or `quick_check` (RETRIEVAL step) generators verbatim | `remediationStepHref` → `/dashboard/quiz?mode=topic_practice\|quick_check` |
| `SOLO_VERIFY` | *(none — separate pipeline)* | `generateQuestionVariant` (resumes an **existing** pending verification attempt; never creates a new one) | `/api/quizzes/verify` (dedicated route, not generate-and-take) |
| `TRANSFER` | *(none — separate pipeline)* | Its own transfer-generation pipeline (out of this route entirely) | `/dashboard/cognitive/transfer` → `/api/transfer/generate` |

A remediation `SOLO_VERIFY` **step** (distinct from the top-level `SOLO_VERIFY`
ActivityType above) reuses `cumulative_assessment` scoped to one concept — see
`remediationStepHref`. REMEDIATION therefore has **no generator of its own**: every
step type is executed by an already-inventoried quizMode's generator, verbatim.

The launch-side registry (`learning-session-engine.service.ts`'s `resolveLaunch`) is an
**exhaustive switch over `ActivityType`**, closed by `decision.activityType satisfies
never` in its `default` branch — a future `ActivityType` added to the taxonomy without a
launch case **fails to compile**, not silently at runtime. This is already the Part E
"explicit registry," pre-existing from an earlier phase; this phase documents and tests
it rather than rebuilding it.

## EVIDENCE MODE

Fixed, total mapping (`activity-taxonomy.ts`, one table, no per-call override):

| ActivityType | EvidenceMode |
|---|---|
| PRACTICE, REVIEW, REMEDIATION | PRACTICE |
| SOLO_CHECK, SOLO_VERIFY, TRANSFER, RETENTION_CHECK | INDEPENDENT |
| DIAGNOSTIC_CHECK, CUMULATIVE_ASSESSMENT, MOCK_EXAM | ASSESSMENT |

## QUESTION COUNT

| Activity | Requested | Notes |
|---|---|---|
| PRACTICE/REVIEW | canonical evidence gap, clamped `[1,20]` | `deriveEvidenceRequirement`/`resolveQuestionCount`; tolerates fewer-than-requested |
| SOLO_CHECK | **exactly 6**, forced | `CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY.SOLO_CHECK = {min:6,max:6}`; all-or-nothing |
| RETENTION_CHECK | **exactly 6**, forced | same shape as SOLO_CHECK; deficit-recovery, not slot-recovery |
| DIAGNOSTIC_CHECK | `[2,4]`, execution shape only (canonically UNRESOLVED — cognitive-diagnosis owns resolution, not a count) | |
| CUMULATIVE_ASSESSMENT / MOCK_EXAM | up to 20, UNRESOLVED canonically (no assessment blueprint authority exists yet) | per-concept cap, gated batch, partial-tolerant |

## DIFFICULTY

One authority for every single-concept canonical activity: `resolveTargetDifficulty`
(`difficulty-contract.ts`), fed by `knowledge-state.service`'s `masteryState`/
`criticalMisconceptionCount`. Multi-concept modes (cumulative/exam) resolve their own
per-concept target the same way. **Finding, not fixed this phase:** `difficulty-
contract.ts` declares an explicit `REMEDIATION` branch (`level: 1, reasonCode:
REMEDIATION_REBUILD`), but no live call site ever passes `activityType: 'REMEDIATION'`
literally — remediation steps launch as `topic_practice`/`quick_check`, so
`resolveTargetDifficulty` always receives `PRACTICE`/`SOLO_CHECK` for them, never
`REMEDIATION`. The REMEDIATION_REBUILD floor is currently unreachable dead code. This is
a difficulty-*policy* question (should a remediation Guided Practice step always floor
to difficulty 1, or adapt normally?), not a generation-reliability defect, so it was
**not** changed under Part R's "do not change canonical progression/difficulty rules
unless a real bug is found" — flagged here for a future phase to decide.

## QUALITY POLICY

One universal gate (`gated-question-generation.service.ts`'s `applyQuestionQualityGate`)
used, directly or via `generateGatedQuestionBatch`, by every generator:
deterministic contract (`checkQuestionQualityDeterministic`) → PASS/FAIL immediately, or
`NOT_DETERMINISTICALLY_VERIFIED` queued for **mandatory** semantic verification (batched
via `verifyQuestionQualityBatch` when >1 candidate needs it, single-call otherwise) → one
Terra regeneration of exactly the units that didn't clear → accept survivors. A missing/
malformed verdict for one candidate rejects only that candidate (fail-closed, isolated).

---

# LIVE SOLO_CHECK FAILURE

## FUERZA CENTRÍPETA TRACE

```
Concept Mission ("Comprobación individual" / "Comprobar")
  → LearningDecision { learningState: INSUFFICIENT_INDEPENDENT_EVIDENCE,
                        activityType: SOLO_CHECK }        [adaptive-learning-policy.ts:621]
  → resolveLaunch → quizLaunch('quick_check', decision)   [learning-session-engine.service.ts:269-270]
  → /dashboard/quiz?subjectId=…&conceptId=…&mode=quick_check
  → startCanonicalActivity(studentId)                     [quiz/page.tsx:577]
  → POST /api/quizzes/generate-and-take { quizMode: 'quick_check' }
  → generateQuickCheckQuestions(conceptId, studentId, subjectId, { difficulty, language })
  → 6 parallel single-question AI calls (requestSlot(0..5))
  → *** ANY ONE of the 6 calls returning null (timeout / refusal / malformed JSON /
      LaTeX-corruption rejection) → `slots.some(q => q === null)` → immediate `return []`
      *** — no retry attempted at all for this failure class ***
  → route.ts: `questions.length === 0` → 500 { error: 'GENERATION_FAILED' }
  → quiz/page.tsx: genState → 'error' → "Couldn't prepare your practice"
```

## FIRST BROKEN CONTRACT

The **initial slot generation call** inside `generateQuickCheckQuestions`. Concretely:

```ts
const slots = await Promise.all(Array.from({ length: QUICK_CHECK_SLOT_COUNT }, (_, i) => requestSlot(i)));
if (slots.some((q) => q === null)) {
  console.error('quick_check fast path: at least one of 6 slots failed …');
  return [];        // <-- no recovery attempted
}
```

The Terra regeneration path several lines below **only ever ran for a slot that
generated successfully but then failed the QUALITY GATE** (`g1.accepted.length !==
QUICK_CHECK_SLOT_COUNT`). A slot whose *generation call itself* failed never reached
that machinery.

## ERROR CODE

Before this fix: none — a bare `console.error` string, no correlatable operationId, no
distinguishable reason code, indistinguishable in the logs from every other quick_check
failure mode. After this fix: `QUICK_CHECK_GENERATION_INSUFFICIENT` with
`reason: 'INITIAL_SLOT_FAILURE_UNRECOVERED'` (plus `MAPPING_MISMATCH`,
`GATE_RECOVERY_SLOT_FAILURE`, `GATE_RECOVERY_MAPPING_MISMATCH`,
`GATE_RECOVERY_QUALITY_GATE_FAILED`, `CONCEPT_NOT_FOUND`, `UNEXPECTED_EXCEPTION`) —
distinguishing exactly which stage failed, correlated by one `operationId` per
generation call, mirroring the `[retention]` observability pattern.

`quizMode`: `quick_check` · `activityType`: `SOLO_CHECK` · `difficulty`: whatever
`resolveTargetDifficulty('SOLO_CHECK', knowledgeState)` resolved (3–4 typically, per
`difficulty-contract.ts`'s own `masteryState`-keyed table) · `questionCount`: 6 (forced)
· `evidence requirement`: UNRESOLVED-by-canonical-policy/PROVE purpose, execution shape
`{min:6,max:6}` · `prompt id/version`: `quiz.question_generation` / `v3` · `model`:
`QGEN_ROUTE.primary` (Luna) initial, `TERRA` on any retry · `schema`:
`GENERATED_QUESTION_BATCH_SCHEMA` (same as every other generator) · `candidate count`:
1 per slot, 6 slots · `gate result`: N/A for this specific failure class (it never
reached the gate) · `errorCode`: `GENERATION_FAILED` (route-level, unchanged — the fix
is upstream of this).

## ROOT CAUSE

**Architectural asymmetry, not AI flakiness.** `generateRetentionCheckQuestions`
(RETENTION_CHECK) already recovers from a chunk's *initial* AI-call failure (its own
Rule 6B/6C, from a prior phase's RET-R1/R2/R3 hardening) — but that same reliability
pattern was never extended to `generateQuickCheckQuestions` (SOLO_CHECK) when it was
built. SOLO_CHECK's 6 independent, single-question, all-or-nothing parallel calls made
it *structurally* far more exposed to this gap than PRACTICE (which tolerates
fewer-than-requested) or RETENTION_CHECK (which already had chunk-failure recovery): the
probability of at least one of 6 independent calls failing compounds quickly even at a
low per-call failure rate, and — before this fix — **any single one of those 6 failures
failed the entire activity outright, with zero retry**. This is fully reproducible from
the code alone; no live trace was needed to confirm it, and no unproven "AI hiccup" is
asserted.

## FIX

`generateQuickCheckQuestions` (`src/services/quiz-generation.service.ts`) now recovers
an initial slot failure exactly the way a gate rejection already was recovered: the
failed slot indices are collected, and each gets **one** Terra retry of the **same**
`slotIndex` (same `assignedType`/difficulty/context/prompt — Part K's retry-identity
requirement). Only if that retry *also* fails does the function give up and return `[]`
(the ROOT INVARIANT's option B — precise, recoverable-attempted failure, never silently
degrading count). The final contract is unchanged: strictly 0 or 6, never partial.
Added `operationId`-correlated structured `[quick_check]` logging (Part O) mirroring the
existing `[retention]` pattern, so every terminal outcome (STARTED / SLOT_RECOVERY_* /
GENERATION_SUCCEEDED / GENERATION_INSUFFICIENT with a specific `reason`) is now visible
and correlatable in the logs, where before there was only an unstructured
`console.error`.

Separately (Parts M/N): the canonical "couldn't prepare" card (`quiz/page.tsx`'s
`genState==='error'` block) said **"Couldn't prepare your practice"** / **"Your
teaching progress is safe"** for every activity type reaching it — wrong for SOLO_CHECK
("Prove," not "practice"), and, on inspection, also wrong for RETENTION_CHECK and any
other non-Practice canonical action that reaches this same shared card (this card is
mode-agnostic by construction; only the *copy* was Practice-flavored). The copy — and
the sibling "preparing…" loading copy — was made activity-neutral in all 5 locales
(en/es/de/fr/pt), e.g. "Couldn't prepare this activity" / "Your progress is safe."

---

# CONTRACT VALIDATION

## PRE-AI VALIDATION

Confirmed already in place, before any generator or provider call:

- `quizMode` restricted to a closed Zod enum (unsupported value → `400 INVALID_INPUT`
  before any DB/AI work).
- `maxQuestions` clamped `[1,20]`, `difficulty` clamped `[1,5]` by Zod, before use.
- Single-concept modes require `conceptId` (`400 INVALID_INPUT` otherwise).
- Every canonical launch (the path the live blocker exercises) is gated by
  `resolveLaunch`'s **universal ownership check** — concept genuinely belongs to
  subject/student — *before* any `ActivityType`-specific branch runs, for all 10
  ActivityTypes uniformly.
- An `ActivityType` with no generator mapping cannot compile (`ACTIVITY_TYPE_BY_QUIZ_MODE:
  Record<QuizMode, ActivityType>`; `resolveLaunch`'s `satisfies never` default).

**Not hardened this phase (documented, not fixed):** a **direct** call to
`/api/quizzes/generate-and-take` (bypassing the canonical launch UI) does not itself
re-verify concept/subject ownership — that check today lives only in
`learning-session-engine.service.ts`, which the live-blocker path always goes through.
This is pre-existing behavior unrelated to the SOLO_CHECK reliability defect and was
left untouched per this phase's scope (generation *reliability*, not a new authorization
surface).

## SCHEMA CONSISTENCY

One shared `GENERATED_QUESTION_BATCH_SCHEMA` (`@/lib/ai/schemas`) used by **every**
generator that talks to a provider for question generation: the base
`generateQuestionsForConcept` (which the gated batch path for cumulative/exam/diagnostic
calls), `generateQuickCheckQuestions`, `generatePracticeQuestions`'s chunk path, and
`generateRetentionCheckQuestions`'s chunk path. One shared `promptId`
(`quiz.question_generation`) and `promptVersion` (`v3`) across all of them — confirmed,
no drift found.

---

# QUESTION COUNTS

## REQUIRED / GENERATED / ACCEPTED / PUBLISHED

| Activity | Required | Generated (candidates) | Accepted (post-gate) | Published |
|---|---|---|---|---|
| PRACTICE/REVIEW | evidence-gap, `[1,20]` | up to `MAX_QUESTIONS_PER_CHUNK`(4)-sized chunks | partial-tolerant — a bad chunk doesn't sink the others | ≤ required, never more, `[]` only if every chunk failed |
| SOLO_CHECK | 6, forced | 6 (+ up to 1 retry per failed slot, now including initial-call failures) | all-or-nothing | exactly 6, or `[]` |
| RETENTION_CHECK | 6, forced | 2×3-4 candidate surplus, deficit-recovery | per-question gate + dedupe | exactly 6, or `[]` (`RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS`) |
| DIAGNOSTIC/CUMULATIVE/MOCK | `[2,4]` / up to 20 | per-concept gated batch | partial-tolerant per concept | ≤ required |

No mode publishes fewer than its required count silently — every path either meets the
count exactly (all-or-nothing modes) or documents/logs the exact shortfall reason
(partial-tolerant modes never fabricate to fill a gap).

---

# QUALITY

## DETERMINISTIC GATE

Runs first, unconditionally, over every candidate. A `FAIL` verdict is discarded before
any semantic call is even considered — confirmed by direct code inspection of
`applyQuestionQualityGate`'s loop (`if (det.status === 'FAIL') { …continue; }`).

## DEDUPE

Retention's dedupe (`dedupeAgainstAccepted`, same-batch then cross-attempt-novelty)
happens **before** the gate — a duplicate never reaches (and never costs) a semantic
call.

## SEMANTIC VERIFICATION

Mandatory for every `NOT_DETERMINISTICALLY_VERIFIED` candidate — no skip/bypass branch
exists in `applyQuestionQualityGate`. Batched (`verifyQuestionQualityBatch`) when more
than one candidate needs it in the same unit, to avoid N serial Terra round-trips; a
single candidate still uses the unbatched call. A missing/malformed/foreign-id verdict,
or the batch call throwing entirely, rejects only the specific candidate(s) affected —
verified fail-closed, never approve-by-default.

## RECOVERY

Bounded, never unbounded: at most one Terra retry per failed unit (slot/chunk),
regardless of *why* it failed (generation-call failure or gate rejection) — this phase
added the missing generation-call-failure branch to quick_check without introducing any
new unbounded loop.

---

# SESSION SAFETY

## PERSISTENCE

`storeQuiz` is called from exactly **one** call site in `generate-and-take/route.ts`,
strictly after `if (questions.length === 0) { …return 500…; }` — confirmed by static
count (`storeQuiz(` appears exactly once) and ordering. No mode can reach persistence
with zero questions; the all-or-nothing modes (SOLO_CHECK/RETENTION_CHECK) additionally
guarantee 0-or-exact-count before that gate is even reached.

## ATOMICITY

Unchanged from prior phases: no partial `quiz_sessions` row is ever written — the row is
built with the complete, already-gated question array in one `INSERT`.

## RETRY

Client: the canonical "couldn't prepare" card's retry button calls
`startCanonicalActivity(studentId)` — the *same* function/request that failed
(established in LX-9 FINAL; unchanged this phase) — never a different code path that
could drift mode, difficulty, or count. Generator-internal: quick_check's new recovery
reruns the *same* `slotIndex` (hence the same `assignedType`) on Terra; a fresh
`operationId` is minted per top-level generation call for correlation, while the
canonical request identity (conceptId/studentId/subjectId/difficulty/count) never
changes across a retry.

---

# CLIENT STATE MACHINE

## GENERATION ERROR

`genState === 'error'` (background canonical generation failed) — stays on
`phase === 'quiz'`, renders the shared, now activity-neutral "couldn't prepare this
activity" card for **every** ActivityType reaching it (SOLO_CHECK, PRACTICE,
RETENTION_CHECK all share this one component/copy — no per-mode branch inside it).

## LOAD ERROR

`phase === 'error'` (the legacy/manual setup-form's `generateQuiz` failing) — a distinct
top-level state with its own (already mode-aware, from LX-9 FINAL) copy. Confirmed
structurally distinct from `genState === 'error'` — the two never overlap.

## RETRY

Both states' retry buttons re-invoke exactly the function that failed
(`startCanonicalActivity` / `generateQuiz` respectively) — never cross into the other's
code path (this exact cross-contamination — retry landing in the *other*, more
severe-looking state — was the LX-9 FINAL live bug, and remains fixed/tested).

## COPY

Fixed this phase (Parts M/N): `practice.preparing` / `practice.prepareFailedTitle` /
`practice.prepareFailedBody` no longer say "practice" or "teaching" in any of the 5
locales — they now read as an activity-neutral "this activity"/"your progress," correct
for SOLO_CHECK, RETENTION_CHECK, or any other canonical activity that can land on this
one shared card.

---

# OBSERVABILITY

`generateQuickCheckQuestions` now emits one `[quick_check]` line per stage
(`QUICK_CHECK_GENERATION_STARTED`, `QUICK_CHECK_SLOT_RECOVERY_STARTED/SUCCEEDED`,
`QUICK_CHECK_GENERATION_SUCCEEDED`, `QUICK_CHECK_GENERATION_INSUFFICIENT` with a specific
`reason`), all correlated by one `operationId` per call and carrying only aggregate,
learner-content-free metadata (slot counts/indices, duration, reason codes) — mirroring
`generateRetentionCheckQuestions`'s pre-existing `[retention]` pattern exactly.

**Not extended this phase (documented remaining debt):** `generatePracticeQuestions`
and the gated-batch path (`generateGatedQuestionBatch` → `generateQuestionsForConcept`,
used by DIAGNOSTIC/CUMULATIVE/MOCK_EXAM) still rely on ad-hoc `console.error`/`console.warn`
rather than an `operationId`-correlated structured log. Retrofitting all of them was out
of scope for the reliability fix this phase's live evidence actually required (SOLO_CHECK
specifically); flagged for a follow-up observability pass rather than expanded
speculatively here.

---

# PERFORMANCE

## PRACTICE / SOLO_CHECK / RETENTION_CHECK / SUCCESS RATE / P50 / P95 / COST / RECOVERY RATE

**NOT MEASURABLE IN THIS ENVIRONMENT.** This session has no live database, AI-provider,
or browser access — there is no Preview deployment reachable from here to launch real
generation attempts against. No number is fabricated. Once deployed to Preview, run:

```
# 5–10x each, capturing the [quick_check]/[retention]/[perf] log lines added by this
# and prior phases (operationId, totalDurationMs, errorCode/reason, success):
for i in $(seq 1 10); do curl -s -X POST https://<preview>/api/quizzes/generate-and-take \
  -H 'Content-Type: application/json' \
  -d '{"studentId":"<id>","subjectId":"<id>","conceptId":"<id>","quizMode":"quick_check"}'; done
# repeat with quizMode: topic_practice, retention_check
```

and report success rate, p50/p95/mean/min/max latency, AI/Terra call counts per run, and
cost per run from the resulting `[quick_check]`/`[retention]`/`[perf]` log lines —
exactly the fields this phase's new observability now emits.

---

## TESTS

56 tests in `tests/unit/lx9r6-canonical-quiz-generation-reliability.test.ts`, covering
all 45 required items (Matrix 1–10, Contract 11–16, Counts 17–20, Quality 21–25,
Session/Retry 26–32, Client 33–37, Regression 38–45), plus supporting tests for Parts
B, M/N, and O. Two pre-existing tests in `tests/unit/quiz-generation-quick-check.test.ts`
that certified the OLD no-recovery behavior were rewritten (never silently deleted) to
certify the new, provably-more-reliable behavior, each with an explanatory comment
citing this phase.

Full verification:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **3748/3748 passing** (224 files; up from the pre-phase 3691 +
  57 new/changed tests in this phase's two touched files).
- `npm run build` — clean.

## COMMITS

1. `0621d99` — `fix: recover quick_check slot generation failures and neutralize activity error copy (LX-9R6)` — the implementation: `src/services/quiz-generation.service.ts` (slot-failure recovery + observability), `src/lib/i18n/messages.ts` (activity-neutral copy, 5 locales), plus the updated/new test files.
2. (this report) — docs commit, delivered via SendUserFile.

---

# CERTIFICATION

**CODE PASS.** One explicit activity-to-generation matrix already existed
(`resolveLaunch`'s exhaustive, compile-enforced switch) and is now documented and
tested; pre-AI contract validation is confirmed for every activity; the question-count
contract is confirmed reliable (SOLO_CHECK cannot silently publish fewer than 6); schema
consistency is confirmed across every generator (one schema, no drift); unified retry
behavior is confirmed (same canonical request, same slot identity, bounded to one retry
per failure); a precise internal error taxonomy was added exactly where the live
evidence proved one was missing (quick_check); the full regression suite is green
(3748/3748); no canonical progression/difficulty/WAITING/novelty/assistance rule was
touched.

**LIVE PASS is NOT claimed** — this environment cannot deploy to Preview, run a real
generation call, or measure latency/success rate. Once deployed, this phase's own new
observability (`[quick_check]` operationId-correlated logs) is exactly what the required
Preview validation sample (Part P/Q) should read from.

DO NOT start LX-10.

STOP.
