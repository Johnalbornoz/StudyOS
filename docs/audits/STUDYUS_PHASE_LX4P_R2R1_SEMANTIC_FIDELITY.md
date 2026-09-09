# STUDYUS — LX-4P-R2 REPAIR
## LX-4P-R2R1 — SEMANTIC FIDELITY GATE — REPORT & CERTIFICATION

Branch: `tmp/lx1`
Repair commit: `c58cfad`
Builds on: `e570800` (LX-4P-R2 doc) / `2dbcb82` (LX-4P-R2 impl).

Same-item localization architecture accepted. LX-6 not started. LX-8 not
implemented. Adaptive Teaching not redesigned.

---

## THE BLOCKER

`reconcileLocalization` proved *structural* preservation (number tokens,
formula tokens, option ids, immutable fields) but not *semantic*
equivalence. A structurally-valid translation could still:

- drop or add a negation ("Which is **NOT** correct?" → "Which is
  correct?");
- flip a comparison (greater ↔ less, increase ↔ decrease, at least ↔ at
  most, minimum ↔ maximum);
- invert a causal / directional / temporal relation (cause ↔
  consequence, clockwise ↔ counter-clockwise, before ↔ after);
- change a unit's scale while keeping the digits (`5 m` → `5 km`, `20 °C`
  → `20 °F`, `4 m/s` → `4 km/h`);
- keep the correct option **id** but change what that option **means**.

Any of these leaves the stored canonical `correctAnswer` semantically
wrong for the displayed question — corrupting evidence. R2R1 closes this
with a unit-integrity check plus an independent semantic-verification AI
call, fail-closed.

---

## R1 — STRUCTURAL VALIDATOR KEPT (not weakened)

Every LX-4P-R2 check still runs, unchanged and first:
exact option-id set · numeric-token multiset · formula/LaTeX-token
multiset · all immutable pedagogical fields copied verbatim from the
stored original · no partial mutation · restart fallback on any failure.
`tests/unit/lx4p-r2-same-item-localization.test.ts` (29) still passes;
`lx4p-r2r1-semantic-fidelity.test.ts` re-asserts each (NUMERIC_DRIFT,
FORMULA_DRIFT, OPTION_DRIFT, EMPTY_TEXT).

---

## R2 — UNIT INTEGRITY

`reconcileLocalization` now also compares, before/after, over **all**
localizable text combined:

| multiset | catches |
|---|---|
| `<number>::<unit>` adjacency pairs (`5::m`, `4::m/s`, `20::°c`) | `5 m → 5 km`, `4 m/s → 4 km/h`, `2.5 kg → 2.5 g` — the digits are unchanged so `numericTokens` passes; the pair does not |
| non-ambiguous **bare** units (`kg`, `m/s`, `°c`, `hz`, `km`, `pa`, `min`, `mol`, `rad`, …) | `20 °C → 20 °F` where the number also appears alone |

Recognised units: `km/h, m/s, m/s², rad/s, kg, mg, µg, cm, mm, nm, km,
Hz…GHz, Pa…GPa, J/kJ/MJ, W…MW, V/kV/mV, A/mA/µA/nA, Ω/kΩ/MΩ, °C, °F, °K,
°, K, mol, rad, min, ms/µs/ns, N, N·m, %, kg/m3, g/cm3`.

Typographic form is normalised away (`m/s` vs `m·s⁻¹` spacing, `²` vs
`^2`, `·` stripped, `°K`→`k`); **scale is not**. No unit conversion is
performed anywhere. Single-letter units (`A`, `N`, `K`, `J`, `W`, `V`)
and bare variables (`m`, `g`, `s`) are counted **only** when
number-adjacent — a bare English article "A" or a physics variable `m`
is never treated as a unit (regression test included).

Failure → `UNIT_DRIFT` → restart fallback.

---

## R3 — INDEPENDENT SEMANTIC EQUIVALENCE VERIFICATION

New registered prompt **`quiz.question_localization_verify`**
(`EXPLANATION_EVALUATION` capability, `HIGH_RISK`, v1). New function
`verifyLocalizationEquivalence({ original, candidate, sourceLanguage,
displayLanguage })`:

- **Never translates, rewrites, improves or fixes** — the system prompt
  says so explicitly and asks only for a verdict.
- Receives the canonical **source** question, the **candidate** localized
  question, the stored **`correctAnswer`**, the **question type**, and
  the **option ids**.
- Is told to check, one by one — any difference ⇒ not equivalent: same
  question / scenario / requested task; negations preserved; comparisons
  preserved; quantities + units preserved; causal & directional
  relations preserved; temporal relations preserved;
  superlatives/quantifiers preserved; each option's meaning preserved;
  **and whether the stored `correctAnswer` is still correct for the
  candidate**.
- Returns strict JSON:
  `{ equivalent: boolean, correctAnswerStillValid: boolean,
     semanticDifferences: string[], confidence: number }`.
- A provider/parse failure resolves to `null`.

Pure interpreter `evaluateVerdict(v)`:

```
!v | wrong shape | confidence NaN            -> { pass:false, SEMANTIC_VERIFY_ERROR }
!v.equivalent | !v.correctAnswerStillValid   -> { pass:false, SEMANTIC_MISMATCH }
v.confidence < 0.75                           -> { pass:false, SEMANTIC_LOW_CONFIDENCE }
otherwise                                     -> { pass:true }
```

---

## R4 — FAIL CLOSED

`localizeGeneratedQuestion` returns `{ ok: true }` only when **all** hold,
in order:

1. `LOCALIZABLE_ANSWER_FORMATS` (single_choice / multi_choice / text) —
   else `UNSUPPORTED_FORMAT`;
2. translation call succeeds and parses — else `PROVIDER_ERROR` /
   `PARSE_ERROR`;
3. `reconcileLocalization` passes — structural + numeric + formula +
   **unit** — else `*_DRIFT`;
4. `verifyLocalizationEquivalence` returns a verdict — else (via
   `evaluateVerdict(null)`) `SEMANTIC_VERIFY_ERROR`;
5. `evaluateVerdict` = `{ pass: true }` — i.e. `equivalent === true` AND
   `correctAnswerStillValid === true` AND `confidence ≥ 0.75` — else
   `SEMANTIC_MISMATCH` / `SEMANTIC_LOW_CONFIDENCE`.

Any failure, error, or ambiguity → the LX-4P-R1 explicit-restart dialog
(R15 copy). The current question is **never** mutated on a failure path.
Safety > convenience.

---

## R5 — SOURCE LANGUAGE vs DISPLAY LANGUAGE

| name | meaning | mutability |
|---|---|---|
| **sourceLanguage** | the language the canonical item was generated in — `quiz_sessions.language` | **never changed** by localization; the grading + verification reference |
| **displayLanguage** | the language of the representation currently shown to the learner | the only thing same-item localization changes |

- `localizeGeneratedQuestion({ question, displayLanguage, sourceLanguage, context })`.
- `localize-question/route.ts` passes `displayLanguage: v.targetLanguage`,
  `sourceLanguage: session.language`; it never writes `quiz_sessions`.
- `verifyLocalizationEquivalence` is told both languages and compares the
  candidate against the canonical **source** item.
- Client mapping (already so since R2): `quizLanguage` = displayLanguage,
  `sessionOriginalLanguage` = sourceLanguage. `ContextualHelp` is passed
  `locale={quizLanguage}` → its help content is in the **display**
  language; its chrome uses `uiLocale` = `interface_language` (R2 R13).
- Canonical grading (`generate-and-take` submit) still reads
  `quizSession.questions` + `quizSession.language` = the source item.

Not implemented (LX-8, and not blocked by this): `instructionLanguage`,
`targetLanguage`, `expectedResponseLanguage`, `targetLocale`/accent.

---

## R6 — REFRESH BEHAVIOUR

**Display localization is EPHEMERAL — page-session React state
(`quizLanguage`, the swapped `questions[current]`), not persisted.**

Trace for `Q2 source Español → localized to English → browser refresh`:
the quiz page remounts with `quizLanguage` at its default and `quizId`
null; the canonical `topic_practice` autostart effect calls
`generateQuiz(studentId)`, which mints a **brand-new quiz** generated
fresh in the subject/account-resolved language. The prior `quizId`, the
localized display, the draft and the teaching progress are all gone.

This is **pre-existing** behaviour — the canonical practice flow has
always regenerated on refresh; there is no "resume" for `topic_practice`.
Same-item localization being lost on refresh is therefore consistent with
the surrounding behaviour, not a new regression.

**No persistence added.** A stored `displayLanguage` (or per-question
localized text) keyed to a `quizId` is meaningless once that `quizId` no
longer exists after the refresh regenerates the quiz; persisting it would
add a stale-state hazard for no benefit. Documented limitation; revisit
with LX-8 if a genuine resume-on-refresh flow is introduced.

---

## R7 — ADVERSARIAL TESTS (`lx4p-r2r1-semantic-fidelity.test.ts`)

| # | Case | Mechanism | Result |
|---|---|---|---|
| 1 | "Which is **NOT** correct?" loses NOT | verifier `equivalent:false` → `evaluateVerdict` | REJECT (`SEMANTIC_MISMATCH`) |
| 2 | "increases" → "decreases" | verifier `equivalent:false` | REJECT |
| 3 | "greater than" → "less than" | verifier `equivalent:false` | REJECT |
| 4 | `5 m` → `5 km` | `reconcileLocalization` unit pairs | REJECT (`UNIT_DRIFT`) |
| 5 | `20 °C` → `20 °F` | `reconcileLocalization` unit pairs + bare | REJECT (`UNIT_DRIFT`) |
| 5b | `4 m/s` → `4 km/h` | unit pairs | REJECT (`UNIT_DRIFT`) |
| 6 | correct option id kept, meaning changed | verifier `correctAnswerStillValid:false` | REJECT (`SEMANTIC_MISMATCH`) |
| 7 | faithful ES→EN, same semantics | `equivalent:true, valid:true, confidence≥0.75` | PASS |
| 8 | EN→ES back to canonical source | route fast-path (`session.language === target`), no AI, no verifier | PASS |
| — | low confidence verdict | `evaluateVerdict` | REJECT (`SEMANTIC_LOW_CONFIDENCE`) |
| — | null / malformed verdict | `evaluateVerdict` | REJECT (`SEMANTIC_VERIFY_ERROR`) |
| — | bare article "A" / variable "m" | unit tokens number-adjacent only | not flagged (PASS structurally) |

Live AI cases (1–3, 6, 7) are exercised through `evaluateVerdict` with
representative verdicts; the AI call itself needs provider keys (human
step).

---

## R8 — EVIDENCE INTEGRITY

The gate that protects evidence is exactly
`verdict.correctAnswerStillValid` (AND `verdict.equivalent`, AND
confidence): `evaluateVerdict` **cannot** return `{ pass: true }` while
`correctAnswerStillValid` is `false`, and `localizeGeneratedQuestion`
returns `{ ok: true }` only when `evaluateVerdict` passes. So a localized
presentation can stand in for the canonical graded item only when an
independent verifier has confirmed the stored `correctAnswer` is still
correct for it.

Everything else is unchanged from R2: `question-localization.service.ts`
and the route write no `learning_evidence`, call no `updateMastery`,
touch no `quiz_sessions` row; the submit/grading path still reads the
stored original questions + `quizSession.language`. One `quizId` ⇒ one
batch ⇒ one `operationId`. No mastery-policy change. No migration.

---

## TESTS

```
npx tsc --noEmit    clean
npx vitest run      181 files / 2656 passed
                    (+ tests/unit/lx4p-r2r1-semantic-fidelity.test.ts, 26 cases;
                     lx4p-r2 29 cases still green)
npm run build       ✓ compiled; 96/96 static pages;
                    ƒ /api/quizzes/localize-question present
```

Not executed here (human — needs a real Clerk session + AI provider
keys): the live translation + semantic-verifier round trip, and the
authenticated production run in NEXT STEP.

---

# LX-4P-R2R1 — SEMANTIC FIDELITY CERTIFICATION

## STATUS

PASS  *(code complete; tsc clean, vitest 2656 green, build 96/96)*

## STRUCTURAL INTEGRITY

Unchanged from LX-4P-R2 and still first in the pipeline: exact option-id
set, numeric-token multiset, formula/LaTeX-token multiset, all immutable
pedagogical fields copied from the stored original, no partial mutation.
Not weakened.

## UNIT INTEGRITY

`reconcileLocalization` now also requires equal multisets of
`<number><unit>` adjacency pairs and non-ambiguous bare units across all
localizable text. Catches `5 m→5 km`, `20 °C→20 °F`, `4 m/s→4 km/h`. No
unit conversion performed. Bare single-letter units / variables are not
mistaken for units. Failure → `UNIT_DRIFT` → restart fallback.

## SEMANTIC EQUIVALENCE

An independent verification call (`quiz.question_localization_verify`,
verify-only, HIGH_RISK) compares the candidate against the canonical
source item + stored `correctAnswer` and returns
`{equivalent, correctAnswerStillValid, semanticDifferences, confidence}`.
`evaluateVerdict` accepts only `equivalent && correctAnswerStillValid &&
confidence ≥ 0.75`; every other outcome, and any verifier error, is a
rejection.

## CORRECT ANSWER VALIDITY

Enforced by `verdict.correctAnswerStillValid`, which is a hard gate:
`evaluateVerdict` cannot pass without it and `localizeGeneratedQuestion`
cannot return `{ ok: true }` without `evaluateVerdict` passing. A
localized presentation is used only when the stored canonical answer is
verified still correct for it.

## SOURCE QUESTION LANGUAGE

`quiz_sessions.language`, passed to the service as `sourceLanguage`.
Never written by localization. The grading and verification reference.

## DISPLAY QUESTION LANGUAGE

The representation shown to the learner (`displayLanguage` in the
service, `quizLanguage` on the client). The only thing same-item
localization changes. Drives question content, Contextual Help content,
and `TeachingIntro` content fetches; UI chrome stays on
`interface_language`.

## REFRESH BEHAVIOR

Ephemeral (page-session React state). A refresh regenerates the whole
`topic_practice` quiz (pre-existing behaviour), so the visible question
returns to the source language along with everything else. No persistence
added — a persisted display language keyed to a post-refresh-defunct
`quizId` would be a stale-state hazard for no benefit. Documented
limitation.

## FAILURE FALLBACK

Unchanged and now covers more cases: `UNSUPPORTED_FORMAT`,
`PROVIDER_ERROR`, `PARSE_ERROR`, `NUMERIC_DRIFT`, `FORMULA_DRIFT`,
`UNIT_DRIFT`, `SEMANTIC_VERIFY_ERROR`, `SEMANTIC_MISMATCH`,
`SEMANTIC_LOW_CONFIDENCE` → the LX-4P-R1 explicit-restart dialog (R15
copy). The current question is never partially localized.

## EVIDENCE INTEGRITY

Protected by the correct-answer-validity gate above. No `learning_evidence`
write, no `updateMastery`, no `quiz_sessions` mutation; submit/grading
still runs on the stored original + `sourceLanguage`; one `quizId` ⇒ one
batch ⇒ one `operationId`. Mastery policy untouched.

## TESTS

tsc clean · vitest 181 files / 2656 passed
(`lx4p-r2r1-semantic-fidelity.test.ts` 26; `lx4p-r2` 29) · build 96/96.

## REPAIR COMMIT

`c58cfad`

## MIGRATION REQUIRED

NO.

## NEXT STEP

Deploy LX-4P-R2 + R2R1 (`tmp/lx1` HEAD) and perform the authenticated
production same-Q2 language-switch test on **Fuerza centrípeta**:
MODEL → GUIDE → PRACTICE → Q2 Español → switch to English →
expect the **same Q2** in English with identical numbers/units, same
`quizId`, no teaching re-entry; switch back to Español → same Q2. Then
force a rejection: verify a stem whose translation would flip a
comparison or change a unit falls to the R15 restart dialog rather than
swapping in place.

Nothing has been pushed to `origin/main`. Do NOT start LX-6.

STOP.
