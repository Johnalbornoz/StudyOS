# Question Factory V5 — calibration

Status: **ENGINE BUILT, CALIBRATION NOT RUN**. No provider call was made in this run: the operator supplied no
`QB_GENERATION_BUDGET_USD`, and the brief (section 28) forbids provider spend without it. Phases C1 and C2 need
freshly generated items, so neither has been run and nothing is frozen for scale.

Branch `feat/question-factory-v5`, worktree `studyos-qf-v5`, cut from the release candidate `1a214f0` with the
post-Canary line `a21f4c1` merged in.

## Versions

| | |
|---|---|
| `GENERATOR_PROFILE_VERSION` | `qf-v5-profiles-1.0.0-provisional` |
| `VALIDATOR_VERSION` | `qf-v5-validators-1.0.0` |
| Prompt policy | `qf-v5-prompts-1` |
| Readiness engine | `qf-v5-readiness-1` |

"Provisional" is literal. Every profile is StudyUs policy written from public specifications; none is human
calibrated. The versions are **not frozen**: freezing happens only after C2 passes.

## What the earlier findings changed

| Finding (brief section 2) | Where V5 answers it |
|---|---|
| Generic textbook items | 54 profiles, one per assessment context, each with its own required moves, context rule and forbidden patterns (`generation-profile.ts`). A test asserts that the requests of six families differ in substance. |
| PAA reduced to extraction | PAA profiles require relating information and forbid "substitute into a stated formula". Difficulty is judged against PAA candidates. |
| PISA context decorative | PISA context is `MATERIAL_REQUIRED`; the construct judge returns `contextMaterial`, and `false` is an automatic rejection (`CONTEXT_DECORATIVE`). |
| IB HL/SL, command terms, marks | Level-specific minimum reasoning transitions (HL higher than SL); the declared command term must be in the profile and actually asked in the prompt; rubric marks must sum to the item's marks; parts may depend only on earlier parts. |
| Inflated multiple-choice marks | A selected-response item is worth 1 mark in every profile; anything else is `SELECTED_RESPONSE_MARKS_INFLATED`. The planner never gives a CHALLENGE multiple-choice slot more marks. |
| Saber needs no story | Saber context is `WHEN_PEDAGOGICALLY_APPROPRIATE`; "an artificial story added to a bare computation" is a forbidden pattern. |
| Length / arithmetic taken as difficulty | The calibrator is blind to the intended tier and counts reasoning transitions; `NOT_DIFFICULTY` is given to both author and calibrator. `INTENDED`, `ACTUAL`, `TIER_FIT`, `DIRECTION` are stored separately. A correctly named tier with too few transitions is `BORDERLINE / TOO_EASY`. |
| Key mismatch, obvious key, weak distractors | Blind independent solver; deterministic comparison (option label, numeric, algebraic at sample points, normalised text); declared arithmetic must give the key and exactly one option; equivalent options, length, unit and verbatim clues are detected; key-position skew is tested per batch. |
| Specification leakage | The specification is a separate object. Learner-visible text is scanned for leakage patterns in Spanish and English; a hit is a rejection. |
| Malformed output | Strict parsing: a fenced, prefixed or mis-shaped reply is `MALFORMED_REPLY`. Template residue and truncation are rejected. A stage that did not complete is never a pass. |

## The eleven stages

`pipeline.ts` runs them in order for every candidate; none can be skipped.

1. Specification — immutable, hashed, never shown to a learner.
2. Authoring — request carries parts A–I of the generator policy.
3. Structure — schema, format, language, options, marks, parts, command terms, residue, truncation, leakage.
4. Independent solving — the solver receives the learner view only.
5. Construct / authenticity — `PASS/WEAK/FAIL`, `HIGH/MEDIUM/LOW`.
6. Difficulty — blind estimate, then compared with the intended tier.
7. Distractors — deterministic clues plus a judge for defensible options.
8. Originality — exact, normalised, near and re-numbered-template duplicates against bank, batch and earlier batches.
9. Blueprint fit — the slot, format, marks and command term of the governed bucket.
10. Risk — flags and review priority P0–P3.
11. Decision — `AUTO_APPROVE`, `HUMAN_REVIEW`, `AUTO_REJECT`.

A malformed item is rejected before any model is asked about it, and a key the solver contradicts ends the
candidate before the remaining judges are paid for.

## Calibration protocol (implemented, awaiting a budget)

`run.ts generate` enforces the order: a cluster needs a passing C1 on record before C2, and a passing C2 before
SCALE, under the same profile and validator versions.

| Phase | Size | Gate |
|---|---|---|
| C1 | 20 per cluster | first-attempt pass ≥ 80 %, schema 100 %, answer failures 0, construct FAIL 0, leakage 0, provenance issues 0, stage errors 0, human review ≤ 10 % |
| C2 | 50 per cluster | answer failures 0, construct FAIL 0, blueprint failures 0, leakage 0, human review ≤ 10 % |

A failed batch is discarded from certification (its items are removed from the promotable set) and is never
rescored. There are 21 clusters: PAA ×4, PISA ×3, IB ×5, Cambridge 0580, AICE ×7, Saber 11.

## What was verified without a provider

- 49 unit tests over the V5 modules and runner (`tests/unit/qf-v5-question-factory.test.ts`,
  `tests/unit/qf-v5-runner.test.ts`), including an end-to-end batch on a stub model.
- The stub proves the mechanics only. It says nothing about how a real model performs against these gates. The
  Canary 250 result (66 strict passes of 221 under validators r4) is the only live evidence, and it predates V5.

## What is NOT established

- No V5 item exists. First-attempt pass rate, human-review rate and judge reliability under V5 are unknown.
- The live transport (`scripts/operations/qf-v5/live.ts`) has never been exercised against a provider.
- The judges are models. Their agreement with human reviewers is unmeasured; the 37-item human calibration sample
  proposed after the Canary is still unanswered, and the post-Canary next-run gate (`next-run-gate.ts`) is closed
  on `HUMAN_CALIBRATION_COMPLETE`.
- Profiles cover mathematics and sciences in depth; reading, writing and essay components have profiles but no
  stimulus-set planning (a PAA reading text with five questions is planned as five independent slots here).
