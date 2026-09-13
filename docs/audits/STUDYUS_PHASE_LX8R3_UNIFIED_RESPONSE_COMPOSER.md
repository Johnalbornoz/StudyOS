# LX-8R3 — UNIFIED RESPONSE COMPOSER

## STATUS

**PASS WITH CONDITIONS** (code-level certification only — see
CERTIFICATION at the end for why "LIVE PASS" is never claimed in this
environment, and the explicit unverified-interactivity items called
out below).

The fragmented two-system response UX Live QA identified is gone: one
`UnifiedResponseComposer` now renders for every learner-facing open
answer, mixing prose and structured math in a single document. The
live-failure speech phrase ("3/5 + 8/4 todo elevado al cuadrado") now
parses correctly end to end.

## LIVE UX ROOT CAUSE

LX-8R2-R1 built one canonical composer for *math* answers
(`MathResponseComposer`) but still rendered it **alongside** a
completely separate prose editor (the legacy `MathAnswerEditor`,
itself carrying its own Unicode-symbol toolbar) whenever a question
also required work or justification. A learner facing a SHOW_WORK
question therefore saw: a StudyUS-built symbol row, MathLive's own
keyboard chrome underneath it, the structured math answer field, and
then — visually and architecturally disconnected — a second box with
a different, older toolbar for "explain your reasoning." Two response
systems for one answer, exactly as Live QA described.

Separately, `MathSpeechParser`'s grammar (LX-8R2) covered single
fractions via explicit "divided by"/"half of X" phrasing and simple
exponent suffixes, but had no rule for compound fraction phrasing
("three fifths", "3 sobre 5"), raw symbolic STT output ("3/5", "x^2"
with no surrounding spaces), or a trailing "apply this exponent to
everything I just said" phrase — so the exact live phrase fell through
every existing rule and failed closed (correctly, per R2/R7 — but
unnecessarily often for a normal expression).

## UNIFIED RESPONSE MODEL

`src/lib/lx/response-document.ts` defines the minimal document model
requested:

```ts
type ResponseBlock = { type: 'paragraph'; text: string } | { type: 'math'; latex: string };
interface ResponseDocument { blocks: ResponseBlock[] }
```

`UnifiedResponseComposer` (`src/components/UnifiedResponseComposer.tsx`)
renders `blocks` as one vertical stack inside a single bordered
surface — never two separately-bordered boxes. `value`/`onChange` are
still a plain string (the document's JSON serialization), so every
call site's prop shape is unchanged from the prior composers.

## TEXT + MATH DOCUMENT

A paragraph block is a plain auto-growing `<textarea>` (`rows` scales
with line count, `resize: vertical` as a manual fallback); a math
block is a bare `MathExpressionEditor` (`showToolbar={false}`, R4).
Ordered mixed content — math, then paragraph, then math — is exactly
what the `blocks` array represents; nothing is inferred from
rendered DOM/HTML at serialization time (R2).

## ENTER / MULTILINE

- In a paragraph textarea, a bare Enter is intercepted
  (`preventDefault`) and **splits** the block's text at the caret into
  two paragraph blocks — the text before the caret stays in the
  current block, the text after becomes the new one, so the learner
  can continue writing in either direction.
- Shift+Enter is explicitly excluded from interception and falls
  through to the textarea's own default (a line break inside the
  *same* block).
- Enter inside a math block fires `MathExpressionEditor`'s new
  `onEnter` callback, which commits that block (already synced via its
  own `onChange`) and moves to — or creates — the next block, always a
  fresh **paragraph** ("next block can be prose," R6).
- Submission is untouched: the surrounding page's own explicit
  Submit/Next button is the only path that advances the question; no
  code path in the composer calls it.

## MATH KEYBOARD

`MathExpressionEditor` still exists unchanged in its structural
capabilities but gained a `showToolbar` prop (default `true`, so any
future direct caller keeps the old behavior verbatim); the unified
composer always passes `showToolbar={false}`. MathLive's own
`mathVirtualKeyboardPolicy: 'auto'` remains enabled (unchanged), and
the composer's one keyboard icon calls MathLive's own global
`window.mathVirtualKeyboard.show({ animate: true })` when the caret is
already inside a math block, or inserts a fresh math block (and
focuses it) when it isn't. Fractions, exponents, roots, parentheses,
equations/inequalities, Greek letters, integrals, and summations all
remain reachable exactly as they were under LX-8R2 — through MathLive's
keyboard, never a second, weaker StudyUS-built version.

## REMOVED LEGACY TOOLBAR

The StudyUS button row (`a/b`, `xⁿ`, `√`, `()`, `×`, `÷`, `=`, `π`,
"More") no longer renders anywhere in the live learner surface — it
exists only as `MathExpressionEditor`'s dormant `showToolbar={true}`
code path, which nothing currently calls with that value. The legacy
Unicode-symbol `MathAnswerEditor` — which had its own, separate,
category-tabbed toolbar (Basic/Structures/Greek/Physics/More) — is no
longer used anywhere in the codebase and was **deleted** (zero
remaining callers after the reasoning box it served was folded into
the unified document). This is a genuine deletion, not a hidden
rename: `git status`/the commit diff shows the file removed.

## RESPONSE CONTRACT MAPPING

`responseInstructionKey(kind)` (added to
`src/lib/lx/response-evidence-contract.ts`) maps `ANSWER_ONLY` /
`SHOW_WORK` / `JUSTIFY` / `EXPLAIN` to exactly the four instruction
lines specified ("Enter your answer." / "Show your work and final
answer." / "Give your answer and explain why." / "Explain your
reasoning.") across all 5 locales. `UnifiedResponseComposer` renders
this ONE line above the block list; `ResponseEvidenceContract` itself
is completely unchanged (same fields, same derivation, same grader
guard) — this mapping is presentation-only, added *alongside* the
contract, never inside it. No code path renders two visible editors
for any kind.

## SPEECH CONTEXT

The mic control's behavior depends on `blocks[activeIndex].type`,
updated by each block's own `onFocus` handler: a paragraph active ⇒
`VoiceInputButton` (plain transcript, appended to that block); a math
block active (and `mathEnabled`) ⇒ `MathVoiceInput` (the existing
deterministic parse → review → accept pipeline, unchanged). Exactly
one mic renders at a time — never two buttons, never a mode toggle the
learner has to manage themselves.

## SPEECH NORMALIZATION

`normalizeRawSymbols` (math-speech-parser.ts) re-spaces bare
`+ - * / ^ =` characters before word-splitting, so `"3/5"`, `"3 / 5"`,
and `"x^2"` all tokenize identically to their spoken-word forms.
Combined with the new `SYMBOL_WORDS` table (mapping each of those
literal characters to its token type in both languages), `"3/5"`,
`"3 divided by 5"`, `"3 sobre 5"`, and `"three fifths"` all now produce
the byte-identical `\frac{3}{5}` — verified directly by test.

## MATH GRAMMAR EXPANSION

Three additions, all table-driven (no parser-algorithm change, no
LLM):

1. **`over`/`sobre`** join the existing `DIVIDE` vocabulary, reusing
   the pre-existing "divided by" → `\frac{}{}` transform verbatim.
2. **Plural fraction words** (`thirds`/`fourths`/`fifths`.../`tercios`/
   `cuartos`/`quintos`...) are a new, narrower grammar rule:
   `<cardinal> <plural-fraction-word>` is a *self-contained* fraction
   ("three fifths" = 3/5), distinct from the existing singular
   `FRACTION_WORD` rule ("half **of** x" = x/2, which still requires
   the following "of" and is unaffected).
3. **Whole-group exponent phrases** (`all squared`/`all cubed`/`the
   whole thing squared`/`todo elevado al cuadrado`/`todo al cuadrado`/
   `todo eso al cubo`, plus a generic `all to the <N>`/`todo elevado a
   <N>`) wrap the *entire* top-level expression parsed so far in an
   implicit group before applying the power — see GROUP-SCOPE PARSING
   below for the exact scope rule.

The live-failure phrase now resolves exactly as specified:

| Input | Output |
|---|---|
| `"3/5 + 8/4 todo elevado al cuadrado"` | `(\frac{3}{5}+\frac{8}{4})^{2}` |
| `"3 sobre 5 más 8 sobre 4 todo elevado al cuadrado"` | `(\frac{3}{5}+\frac{8}{4})^{2}` |
| `"abre paréntesis tres quintos más ocho cuartos cierra paréntesis al cuadrado"` | `(\frac{3}{5}+\frac{8}{4})^{2}` |
| `"three fifths plus eight fourths all squared"` | `(\frac{3}{5}+\frac{8}{4})^{2}` |
| `"three over five plus eight over four all squared"` | `(\frac{3}{5}+\frac{8}{4})^{2}` |

All five are identical strings — cross-modality/cross-phrasing
convergence holds, verified by test.

## GROUP-SCOPE PARSING

The whole-group phrase is recognized **only** as a trailing modifier
on the fully-parsed top-level additive expression (checked once in
`parseTop`, before any relational operator) — this is the one position
where its scope is structurally unambiguous: everything parsed *before*
the phrase, and nothing after it (there is nothing after it, by
construction of this grammar position). A trivial single-atom
expression ("x all squared") needs no extra grouping and serializes as
plain `x^{2}`, never a redundant `(x)^{2}` — the grouping paren is only
added when the accumulated expression is an actual sum/difference
(`bin` node). Any other placement (a whole-group phrase appearing
mid-expression, e.g. "two plus three all squared plus one") is not a
recognized grammar position, so the leftover tokens surface as the
ordinary `INCOMPLETE_EXPRESSION` fail-closed path — **no attempt is
made to guess** what a mid-sentence "all squared" would scope over.
Verified directly by test.

## FAILED-PARSE UX

Unchanged from LX-8R2 at the `MathVoiceInput` level (the "StudyUS
understood: ..." review card and the neutral "We couldn't convert all
of that into math" fallback both still exist, still require explicit
acceptance, still preserve the raw transcript for manual correction).
What's new in LX-8R3: `handleMathVoiceAccept`/`handleProseVoiceAccept`
inside the composer only ever call `updateMath`/`updateParagraph`
(replacing exactly the one active block) or `insertBlockAfter` (adding
one new block) — never a full-document reset — so a failed or
re-recorded parse can never erase any *other* block the learner already
wrote, verified directly by test. **Not verified in this pass**: the
spec's UX polish note "do not leave a large persistent error card after
the learner moves on" — `MathVoiceInput`'s own dismiss/lifecycle
behavior on this point is unchanged from LX-8R2 and was not
re-audited here; see LIVE QA REQUIRED.

## SERIALIZATION

Two deliberately separate transforms, per R8's own distinction between
"internal machine markers" and "never expose markers to the learner":

- **Storage** (`serializeResponseDocument`/`deserializeResponseDocument`):
  plain `JSON.stringify`/`JSON.parse` of `{ blocks }`. JSON's own key
  names (`"type":"math"`) are the stable machine markers R8 asks for —
  never a bracket-style in-band scheme a learner's own typed text
  ("I wrote [MATH] on purpose") could collide with, which was
  considered and rejected. This string is never rendered raw to the
  learner; the UI always reconstructs from `blocks`.
- **Grader-facing** (`toGraderText`): a *different*, one-way transform
  — math blocks wrapped in the existing `$...$` convention
  (`wrapMathForStorage`, math-response-contract.ts), paragraphs
  verbatim, blocks joined by a blank line, blank blocks skipped. This
  is what `encodeCurrentAnswer`'s `'text'` case now returns, replacing
  the old fixed `"---"` string marker. Both transforms are exhaustively
  tested for round-trip losslessness and grader-string determinism in
  `tests/unit/response-document.test.ts`.

## GRADER COMPATIBILITY

`gradeAnswer`/`gradeStructuredAnswer` (quiz-generation.service.ts) are
completely unchanged — confirmed by re-reading both. `toGraderText`'s
output is plain text with `$...$`-delimited math, exactly the same
shape AI-generated questions/model-answers already use, so the
existing free-text AI grader (already instructed to evaluate "on their
merits, not exact wording") receives a natural, readable answer
regardless of whether the learner typed, spoke, or built it via
MathLive's keyboard.

## PRACTICE

The main quiz's `q.answerFormat === 'text'` block now renders exactly
one `UnifiedResponseComposer`, unconditionally (not gated by
`quizMode`/`PRACTICE_EVIDENCE_MODES`), with `mathEnabled` set by the
same `isMathAnswerContext` classifier used since LX-8R2-R1 and
`responseKind` set to the same `responseContract.kind` already
computed. No new logic was needed for Prove — it is the same code
path, differing only in which `EvidenceMode` the already-existing
`coarseEvidenceModeForQuizMode` resolves.

## RETENTION

"Retention" in this codebase's own vocabulary is the `retention_check`
quiz mode, which flows through the identical main-quiz code path above
— already covered. The two surfaces this repair's ROOT ISSUE named
("Retention/verification response surfaces") are the Assessment
verification resume/inline flows, migrated below.

## VERIFICATION

Both the standalone resume-verification screen and the inline
post-quiz Assessment verification list now render the SAME
`UnifiedResponseComposer`, each deriving its own
`ResponseEvidenceContract`/`InteractionContract` inline via the exact
canonical `deriveResponseEvidenceContract`/`buildInteractionContract`
functions the main flow uses (unchanged from LX-8R2-R1) — no
route-specific composer, no duplicated eligibility logic.

## MOBILE

Unchanged from LX-8R2: MathLive's own `mathVirtualKeyboardPolicy:
'auto'` remains the mobile math-entry mechanism; the composer's own
chrome (instruction line, block list, one mic, one keyboard icon) is a
single narrow column with no fixed-width toolbar row to overflow.
**Not independently verified on a physical device or emulator** — no
such tooling exists in this environment.

## ACCESSIBILITY

The keyboard-icon button carries `aria-label`/`title`
(`response.mathKeyboardLabel`, added across all 5 locales); the mic
buttons reuse the existing, already-accessible `VoiceInputButton`/
`MathVoiceInput` chrome unchanged. Paragraph textareas are plain,
natively-accessible `<textarea>` elements — no custom keyboard
trapping was introduced. **Not independently verified with a live
screen reader** — no such tooling exists in this environment.

## TESTS

- `tests/unit/response-document.test.ts` (19 tests, new) — construction,
  lossless round-trip serialization (including a mixed math/paragraph/
  math document, embedded newlines, and learner-typed text that
  *looks* like a storage marker), fail-soft deserialization (empty
  string, pre-LX-8R3 plain prose, the old LX-8R2-R1 `$...$`-wrapped
  string, malformed/non-document JSON), `isEmptyResponseDocument`, and
  `toGraderText`'s exact output shape.
- `tests/unit/math-speech-parser.test.ts` (73 tests, 22 added) — the
  exact live-failure phrase in five phrasing variants across two
  languages, raw-symbol normalization convergence, plural-fraction-word
  coverage in both languages, and whole-group exponent scope
  (including the deliberate fail-closed case for a non-trailing
  placement).
- `tests/unit/lx8r3-unified-response-composer.test.ts` (25 tests, new)
  — Enter/Shift+Enter behavior, the removed toolbar, MathLive-as-the-
  one-keyboard, default-text/on-demand-math switching, speech-context
  routing, failed-parse content preservation, visual cleanup, and the
  mathEnabled=false universal-surface guarantee.
- `tests/unit/lx1-response-evidence-contract.test.ts` (+3 tests) —
  `responseInstructionKey`'s four-way mapping and its i18n-only
  contract.
- Four pre-existing suites were updated **in place** (not deleted) to
  describe the current architecture instead of the retired one:
  `lx4p-r3-active-learning-language.test.ts`,
  `lx8-multimodal-interaction.test.ts`,
  `lx8r1-multimodal-authority-repair.test.ts`,
  `lx8r2-math-response-experience.test.ts`, and
  `lx8r2-r1-universal-math-surface.test.ts` was substantially rewritten
  for the same reason — every replaced assertion's underlying invariant
  was re-verified against the new code, never simply deleted.

`npx tsc --noEmit`: clean. `npx vitest run`: **3404 passed / 3404**
across 211 files (up from LX-8R2-R1's 3335/209). `npm run build`: clean
production build, exit code 0.

## COMMIT

Implementation and all test files (new and updated) committed together
in one focused commit on `tmp/lx1`: `feat: unify math+reasoning
response into one composer, expand speech-to-math grammar (LX-8R3)`.
This report is committed separately per the standing workflow.

---

**PASS WITH CONDITIONS**: one response surface replaces the two-box
UX; Enter creates natural multiline/multi-block responses without ever
submitting; text and structured math coexist in one document; MathLive's
own keyboard is the one professional math-entry mechanism (the
redundant StudyUS symbol toolbar and the legacy `MathAnswerEditor` are
both gone, not merely hidden); speech inserts prose or deterministic
mathematics according to which block has focus; the exact live-failure
phrase and its raw-symbol/plural-fraction/cross-language variants all
now parse correctly; a learner can always review/edit before
submitting; no solving, simplification, completion, or pedagogical
assistance was introduced anywhere in this repair. Conditions: Enter-
key splitting, focus transitions between blocks, MathLive keyboard
open/close timing, and the "no persistent error card" polish note are
all real interactive behaviors this environment cannot exercise in a
live browser — they are verified here at the source-contract level
only. Do NOT claim LIVE PASS until browser QA. Do NOT start LX-9. STOP.
