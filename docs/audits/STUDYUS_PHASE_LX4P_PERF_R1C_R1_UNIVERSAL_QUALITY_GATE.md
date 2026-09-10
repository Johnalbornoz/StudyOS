# STUDYUS — LX-4P-PERF-R1C REPAIR
## R1C-R1 — UNIVERSAL QUESTION QUALITY GATE — REPORT & CERTIFICATION

Branch: `tmp/lx1`
Repair commit: `f5f5807`
Builds on: `d669c4c` / `c72736a` (R1C).

LX-6 not started. Not deployed. Nothing pushed to `origin/main`.
No `OPENAI_API_KEY` / auth / deploy in this environment — no live quality,
fallback-rate, latency or token/cost numbers are stated (R9).

---

## INVARIANT

> Every AI-generated question that can reach a learner passes the StudyUS
> Question Quality Gate.

The number of questions no longer determines whether quality validation
runs.

---

# R1 — AUDIT: LEARNER-FACING GENERATION PATHS

Every path that produces `GeneratedQuestion` objects reachable by a
learner, before and after this repair:

| # | Path | Generator | Count | Before | After |
|---|---|---|---|---|---|
| 1 | Canonical Practice (≤4) | `generatePracticeQuestions` → `generateGatedPracticeBatch` | evidence gap (~3) | **GATED** (R1C C7) | **GATED** (unchanged) |
| 2 | Practice / review (>4) | `generatePracticeQuestions` parallel chunks | 5–20 | **UNGATED** (LaTeX/JSON filter only) | **GATED** — per-chunk gate + per-chunk Terra |
| 3 | Quick Check | `generateQuickCheckQuestions` — 6 parallel slots | 6 | **UNGATED** | **GATED** — 6-slot gate + per-slot Terra, all-or-nothing |
| 4 | Retention | `generateRetentionCheckQuestions` — 2×3 + 1 recovery | 6 | **UNGATED** (structural fingerprint only) | **GATED** — merged-set gate feeding the single bounded recovery, exact-6-or-nothing |
| 5 | Cumulative assessment | route `Promise.all(conceptIds.map(…))` | per-concept cap | **UNGATED** (`generateQuestionsForConcept`) | **GATED** — `generateGatedQuestionBatch` |
| 6 | Exam simulation | same | per-concept cap | **UNGATED** | **GATED** — `generateGatedQuestionBatch` |
| 7 | Diagnostic check | same | 2–4 | **UNGATED** | **GATED** — `generateGatedQuestionBatch` |
| 8 | Retention with a non-6 `maxQuestions` override | same fallthrough | ≠6 | **UNGATED** | **GATED** — `generateGatedQuestionBatch` |
| 9 | Question Variant (verification / Prove replacement) | `generateQuestionVariant` → `generateQuestionsForConcept(count=1)` | 1 | equivalence contract only (metadata) | **GATED** — deterministic Question Quality Contract + semantic verdict, **on top of** the equivalence contract |
| — | `generateQuestionsForConcept` (raw) | — | — | the low-level generator; **never called directly by a learner-facing route any more** — only ever reached *through* a gated wrapper (`generateGatedQuestionBatch`, `generateQuestionVariant`) |

**Result: every learner-facing path is GATED.** Verified by
`tests/unit/lx4p-perf-r1c-r1-universal-gate.test.ts` (source-contract
audit) plus each mode's own suite.

---

# R2 — QUALITY GATE ON PARALLEL CHUNKS

`generatePracticeQuestions`, `count > 4`:

```
planChunks(count) -> Promise.all(chunk -> Luna)          // unchanged
  -> Promise.all(chunk -> gateUnitWithTerraFallback(     // NEW, still parallel
        lunaMapped,
        { targetCount: chunkSize, fallbackWhen: 'EMPTY' },
        () => requestChunk(chunkSize, TERRA)              // this chunk only
     ))
  -> flat -> AI-free cross-chunk dedup -> slice(count)   // unchanged
```

- Each chunk: deterministic Question Quality Contract → parallel semantic
  verdicts for the `NOT_DETERMINISTICALLY_VERIFIED` ones → survivors.
- The gate is **not** serialised — `applyQuestionQualityGate` now issues
  its semantic verdicts with `Promise.all` (was a serial `for` loop), and
  the chunks themselves are still gated inside the outer `Promise.all`.
- Failed content triggers the **existing bounded Terra strategy**, one
  Terra call per empty chunk, no loop, no unlimited regeneration.

---

# R3 — TERRA FALLBACK SCOPE

**Chosen granularity: chunk-level.**

- Practice `>4`: a Terra regeneration is issued **per chunk**, and only
  for a chunk whose gated Luna output is **empty**. A chunk that lost
  1 of 4 to the gate keeps its 3 (PRACTICE is partial-tolerant) — no
  Terra. A whole-batch Terra rerun never happens.
- Quick Check: Terra is issued **per failed slot** (the finest unit the
  6-slot architecture exposes), in parallel.
- Retention: the single bounded recovery regenerates **one 3-question
  chunk** (the gate-failing one; if both fail, keep A / regen B per the
  validated rule). Question-level replacement is unsafe here (the
  chunk-diversification and exclusion-note contract operates per chunk),
  so chunk-level is used — as the spec permits.
- `generateGatedQuestionBatch` (cumulative / exam): one Terra
  regeneration of the **batch** only when the gated Luna batch is
  completely empty — same contract as R1C's canonical Practice path.

Never: 20 Luna questions, one fails, regenerate all 20 on Terra.

---

# R4 — QUICK CHECK

- Still 6 parallel Luna slots, deterministic 4-type plan, `timeoutMs
  30000`, `quiz.question_generation` v3 — speed characteristics
  unchanged (no single large sequential call).
- After the existing all-or-nothing generation check, the 6 mapped
  questions pass `applyQuestionQualityGate`. A slot that fails the gate
  gets exactly one Terra regeneration (`requestSlot(i, TERRA)`), all
  failed slots in parallel. If any regenerated slot still fails → `[]`.
- `storeQuiz` still only ever sees 0 or 6.

---

# R5 — RETENTION

- Same 2×3 concurrent Luna chunks, same preventive Variant-B
  diversification, same single bounded recovery, same exact-6-or-nothing,
  same `RETENTION_REQUIRED_COUNT` (6) and evidence semantics /
  EvidenceMode / retention policy — **only generation acceptance
  changed.**
- The merged 6 now pass `applyQuestionQualityGate` (deterministic
  contract + parallel semantic verify). A gate failure feeds the **same
  single bounded recovery** a parse/dup/overlap failure feeds: regenerate
  the gate-failing chunk once (keep the other), then re-check dup /
  overlap **and** re-gate; anything still failing → `[]`.
- Generation-call budget unchanged: 2 initial + at most 1 recovery = 3.
  The recovery call is Terra. Semantic-verification calls (small
  `semantic_verification` budget, `low` effort, parallel, only for
  questions the deterministic contract cannot clear) are the price of the
  universal gate and sit outside the 3-call *generation* ceiling — the
  same treatment canonical Practice already gives them.

---

# R6 — ASSESSMENT / INDEPENDENT PATHS

Prove / independent / assessment / exam / cumulative generated questions
are held to **at least** the assisted-Practice standard:

- cumulative / exam / diagnostic → `generateGatedQuestionBatch` (same
  Luna → deterministic contract → semantic verify → one Terra-if-empty
  pipeline as canonical Practice).
- Retention (INDEPENDENT) → gated, fail-closed to `[]`.
- Question Variant (replaces the original in a verification attempt) →
  deterministic contract + semantic verdict on the raw AI output, before
  the source's semantic tags are copied in; any failure → `null` →
  caller reuses the source question (assessment is never blocked).

No change to `EvidenceMode` policy or any evidence authority.

---

# R7 — PARTIAL SUCCESS

Explicit, per existing mode semantics — no slot is ever filled with an
unvalidated question, nothing is fabricated:

| Mode | requested 12, accepted 10, rejected 2 |
|---|---|
| **Practice / review** (partial-tolerant) | returns the 10 accepted (after each empty chunk's one Terra attempt); only a fully-empty merged result → `[]` (unchanged `GENERATION_FAILED`) |
| **Quick Check** (all-or-nothing) | the 2 failing slots each get one Terra regeneration; if either still fails → `[]` |
| **Retention** (exact-6-or-nothing) | gate failure → one bounded chunk recovery → re-gate; still short → `[]` |
| **Cumulative / exam** (per-concept, partial-tolerant) | each concept's gated batch contributes its survivors; the route's existing `questions.length === 0` → `GENERATION_FAILED` is the only hard floor; counts and `slice(0, maxQuestions)` unchanged |

---

# R8 — OBSERVABILITY

`AIRuntimeEvent` gains optional `acceptedCount` / `rejectedCount`. Every
gate attempt emits one `[ai-runtime]` line via `buildRuntimeEvent` /
`recordRuntimeEvent` carrying:

`model`, `qualityGateResult` (`PASS` / `DETERMINISTIC_FAIL` /
`SEMANTIC_FAIL` / `REJECTED`), `fallbackUsed`, `fallbackReason`,
`acceptedCount`, `rejectedCount` (+ the existing token/cost fields, still
`null` with no live provider).

This is enough for the later live benchmark to derive Luna first-pass
acceptance rate, Terra fallback rate, accepted / generated ratio, and
cost per accepted question. No learner content is recorded.

---

# R9 — NO PROVIDER-CREDENTIAL EXCUSE

Feature/service tests mock the provider-neutral boundary (`callModel`,
the semantic verifier). Live provider access is still required only for:
actual quality comparison, fallback-rate measurement, latency, token
usage, cost. None of those numbers are claimed here.

---

# REQUIRED TESTS

`tsc --noEmit` clean · `next build` compiles · **188 files / 2767 tests
pass**.

| # | Requirement | Where |
|---|---|---|
| 1 | ≤4 canonical Practice still gated | `lx4p-perf-r1c-gated-practice.test.ts`; `quiz-generation-practice-chunking.test.ts` (count≤4 block) |
| 2 | >4 parallel generation — every chunk gated | `quiz-generation-practice-chunking.test.ts` (“UNIVERSAL … Gate on each parallel chunk”); `lx4p-perf-r1c-r1-universal-gate.test.ts` (audit) |
| 3 | valid Luna chunks → no Terra | `…practice-chunking` (“valid Luna chunks → NO Terra call at all”); `lx4p-perf-r1c-r1-gate-primitives.test.ts` |
| 4 | one failed chunk → only that chunk uses Terra | `…practice-chunking` (“ONE Terra regeneration of THAT chunk only”, “exactly one extra (Terra) call”) |
| 5 | Terra chunk still fails → invalid questions never reach the learner | `…practice-chunking` (“its invalid questions never reach the learner”); `lx4p-perf-r1c-gated-practice.test.ts` (“Terra also fails → []”) |
| 6 | Quick Check gated | `quiz-generation-quick-check.test.ts`; audit |
| 7 | Retention gated | `quiz-generation-retention.test.ts`; audit |
| 8 | cumulative / review gated | audit (“routed through generateGatedQuestionBatch”); `quiz-generation-timeout.test.ts` |
| 9 | Prove / independent learner-facing generation gated | audit (variant); `question-variant-equivalence.test.ts` |
| 10 | partial-tolerant mode never returns rejected questions | `lx4p-perf-r1c-r1-gate-primitives.test.ts` (EMPTY trigger); `…practice-chunking` |
| 11 | all-or-nothing mode respects existing semantics | `quiz-generation-quick-check.test.ts`; `quiz-generation-retention.test.ts` |
| 12 | no third model attempt | `lx4p-perf-r1c-r1-gate-primitives.test.ts`; `lx4p-perf-r1c-gated-practice.test.ts` |
| 13 | no Anthropic fallback | `lx4p-perf-r1c-openai-rewire.test.ts` (C16); `lx4p-perf-r1b-openai-runtime.test.ts` (B24) |
| 14 | parallelism preserved | `…practice-chunking`; `quiz-generation-retention.test.ts` (concurrency); `quiz-generation-quick-check.test.ts` |
| 15 | canonical counts unchanged | `…practice-chunking` (count=6/10/20 call counts); `quiz-generation-retention.test.ts` (RETENTION_REQUIRED_COUNT) |
| 16 | Response Contract unchanged | existing `response-*` suites (untouched, green) |
| 17 | EvidenceMode unchanged | existing activity-taxonomy / evidence suites (green) |
| 18 | `learning_evidence` writes unchanged | existing evidence-write suites (green) |
| 19 | language rule unchanged | `lx4p-perf-r1-parallel-runtime.test.ts` + language suites (green) |
| 20 | same-item localization unchanged | LX-4P-R2 / R2R1 suites (green) |
| 21 | runtime event records accepted/rejected/fallback metadata | `lx4p-perf-r1c-r1-gate-primitives.test.ts` (“R8 …”); `lx4p-perf-r1c-r1-universal-gate.test.ts` (schema) |

---

# LX-4P-PERF-R1C-R1 — UNIVERSAL QUALITY GATE CERTIFICATION

## STATUS

**PASS**

## LEARNER-FACING GENERATION PATHS

- Canonical Practice (≤4) — **GATED**
- Practice / review (>4), parallel chunks — **GATED**
- Quick Check (6 parallel slots) — **GATED**
- Retention (2×3 + bounded recovery) — **GATED**
- Cumulative assessment — **GATED**
- Exam simulation — **GATED**
- Diagnostic check — **GATED**
- Retention non-6 override — **GATED**
- Question Variant (verification / Prove) — **GATED**
- `generateQuestionsForConcept` (raw generator) — not learner-reachable
  except *through* a gated wrapper.

## CANONICAL PRACTICE

Unchanged from R1C: Luna → deterministic contract → semantic verify →
one Terra if empty → `[]`. Count still the canonical evidence gap.

## LARGE PARALLEL BATCH

`planChunks` fan-out preserved. Each chunk gated in parallel; one Terra
regeneration per empty chunk; AI-free cross-chunk dedup and
`slice(count)` unchanged; partial-tolerant.

## QUICK CHECK

6 parallel Luna slots; 6-question gate; one Terra per failed slot in
parallel; all-or-nothing (`[]` unless all 6 clear). Speed characteristics
unchanged.

## RETENTION

Merged-6 gate feeds the existing single bounded recovery (regenerate the
gate-failing 3-question chunk, keep the other; Terra). Final gate on the
recovered set. Still ≤3 generation calls, exact-6-or-nothing, evidence
semantics untouched.

## PROVE / ASSESSMENT

Cumulative / exam / diagnostic → `generateGatedQuestionBatch`. Variant →
deterministic contract + semantic verdict before acceptance. No weaker
standard than assisted Practice. `EvidenceMode` policy untouched.

## PARALLELISM

Preserved everywhere: chunk fan-out, quick-check slots, retention 2×3,
and now the per-chunk gate calls and the semantic verdicts within a gate
(`Promise.all`).

## TERRA FALLBACK GRANULARITY

**Chunk-level** (Practice >4, retention), **slot-level** (Quick Check),
**batch-level only when the whole batch is empty** (canonical Practice,
cumulative / exam). Never a whole-large-batch Terra rerun for a single
failed question. One Terra attempt per unit, never a second.

## PARTIAL FAILURE

Defined per mode (R7 table). Partial-tolerant modes return only accepted
items and never below their existing minimum; all-or-nothing modes fail
closed to `[]`. No slot is ever filled with an unvalidated question.

## QUALITY OBSERVABILITY

`[ai-runtime]` per gate attempt: `model`, `qualityGateResult`,
`fallbackUsed`, `fallbackReason`, `acceptedCount`, `rejectedCount`.
Sufficient for the live benchmark’s acceptance-rate / fallback-rate /
cost-per-accepted-question math.

## EVIDENCE INTEGRITY

Unchanged: Knowledge State / LearningState / LearningDecision authority /
TeachingIntent authority / SupportLevel / EvidenceMode / mastery
thresholds / ResponseEvidenceContract / Retention / Transfer /
`learning_evidence` write authority. Counts unchanged. The gate only
changes which generated questions are *accepted*, never how evidence is
scored or recorded.

## LANGUAGE INTEGRITY

Unchanged: R20 activity-language rule, LX-4P-R1 activity-language lock +
explicit restart, LX-4P-R2 / R2R1 same-item localization. `applyQuestionQualityGate`
passes the activity `language` into the deterministic contract and the
semantic verifier.

## TESTS

`tsc --noEmit` clean; `next build` compiles; 188 test files / 2767 tests
pass. 37 mode tests updated for the gated architecture; 2 new files
(`lx4p-perf-r1c-r1-universal-gate`, `lx4p-perf-r1c-r1-gate-primitives`).

## MIGRATION REQUIRED

**NO** — no schema, data, or config migration. Code-only.

## REPAIR COMMIT

`f5f5807` on `tmp/lx1` (after `d669c4c`).

## NEXT STEP

R1C is promoted to **PASS_WITH_CONDITIONS**. The remaining blockers are
now genuinely live-only:

- OpenAI real-provider schema compatibility (the 5 strict schemas, `usage`
  shape incl. cached tokens);
- Luna / Terra quality vs the Sonnet baseline (accepted quality ≥
  baseline before LX-6);
- Luna first-pass acceptance rate and Terra fallback rate under load
  (tune the deterministic + semantic gate thresholds against live
  signal);
- tokens / cost per accepted question, prompt-cache hit rate;
- TTFI p50/p95 (production p50 < 5 s / p95 ≤ 7 s), now with the added
  per-chunk gate + semantic-verify latency measured for real;
- authenticated browser regression matrix (language, localization
  fidelity, evidence integrity, LX-5 continuation, focus mode).

Then deploy to **Preview** with `OPENAI_API_KEY` and run the
quality / performance benchmark.

Do NOT start LX-6. Not deployed. Nothing pushed to `origin/main`.

STOP.
