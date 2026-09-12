# LX-8R2 — PROFESSIONAL MATH RESPONSE EXPERIENCE

**STATUS: PASS WITH CONDITIONS** (code-level certification only — see
CERTIFICATION at the end for why "LIVE PASS" is never claimed in this
environment, and see the explicit unresolved items called out below).

This report was delivered "as part of the SAME next repair cycle as
RET-R2" per the user's framing. RET-R2 (retention candidate-surplus
reliability) is a fully separate change with its own report,
[STUDYUS_PHASE_RET_R2_CANDIDATE_SURPLUS.md](STUDYUS_PHASE_RET_R2_CANDIDATE_SURPLUS.md),
already committed and delivered. This report covers LX-8R2 only.

## CURRENT UX ROOT CAUSE

`MathAnswerEditor` (`src/components/MathAnswerEditor.tsx`, pre-LX-8R2)
was, by its own doc comment, exactly the FAIL condition the LX-8R2
spec names: "click it, and its plain text/Unicode character drops into
the answer at the cursor — never LaTeX, never a popup, never a special
format." A category-tabbed toolbar inserted literal Unicode glyphs
(`²`, `√`, `/`, `^`, `_`) into a plain `<textarea>`. Typing `x^2` and
clicking the "exponent" button produced identical, un-typeset plain
text (`x^2`), never a real superscript. Voice input handed the raw
SpeechRecognition transcript straight into the same textarea with no
interpretation step — a spoken "two x squared plus five" would have
literally inserted the words "two x squared plus five," not a parsed
expression. This is precisely the FAIL bar named in R16: "not accepted
merely because a microphone button exists or symbols can be inserted."

## EDITOR TECHNOLOGY DECISION

**Chose MathLive** (`<math-field>` custom element) over building a
structured editor from scratch, per R4's explicit preference.

- **Package**: `mathlive`, pinned at `0.110.0` (published 2026-06-09,
  ~3 months before this work — actively maintained; five releases in
  the preceding six months per the npm registry's own version-time
  history).
- **License**: MIT. No peer dependencies.
- **Bundle impact**: `mathlive.min.mjs` is ~843 KB minified / ~227 KB
  gzipped, plus ~296 KB of self-hosted `.woff2` fonts (loaded on
  demand by the browser only when a glyph is actually needed, not all
  at once). This is loaded via `dynamic(..., { ssr: false })` and only
  on the quiz page path that actually renders a math answer — it never
  enters the initial app bundle. This is a meaningful, honestly-stated
  cost, accepted because MathLive is the de-facto standard for this
  exact problem (used by Khan Academy, Desmos, and others) and because
  R4 explicitly rules out building an equivalent structured-editing/
  cursor-navigation/accessibility engine from scratch.
- **SSR behavior**: MathLive ships a dedicated `node` export condition
  (`mathlive-ssr.min.mjs`) specifically so the package doesn't crash
  under server-side evaluation — confirmed via `npm view mathlive
  exports`. This codebase additionally loads it only inside a
  client-only `useEffect`, gated by `typeof window === 'undefined'`,
  and the component itself is wrapped in `dynamic(..., { ssr: false
  })` at the quiz-page call site — three independent layers of
  SSR-safety, any one of which would already prevent a server-side
  crash.
- **Accessibility**: MathLive documents built-in math-to-speech and
  ARIA support, and the mathfield is a real focusable, keyboard-
  navigable element (not a `contenteditable` hack). This component
  adds its own `aria-label` on the field and `title`/`aria-label` on
  every toolbar button, matching the pre-existing `MathAnswerEditor`
  accessibility pattern.
- **Maintenance status**: actively maintained, MIT-licensed, no known
  abandonment signals as of this audit (2026-09-12).
- **Fonts**: MathLive's default `fontsDirectory` (`./fonts`, resolved
  relative to its own bundled module) is unreliable once run through a
  bundler (Turbopack/webpack do not guarantee that relative path
  survives). Rather than accept MathLive's CDN fallback (an unreviewed
  runtime third-party dependency at every page load), the 20 required
  `.woff2` files were copied from `node_modules/mathlive/fonts` into
  `public/fonts/mathlive/` (committed to the repo) and
  `MathfieldElement.fontsDirectory` is set to `/fonts/mathlive`
  explicitly. This keeps every asset self-hosted and reviewable.

## STRUCTURED MATH MODEL

The mathfield's own internal model (not reimplemented here) is the
structure — fractions, roots, and exponents are real nested nodes with
their own cursor-navigable placeholders, not string concatenation. This
component never reads or writes that internal model directly; it only
ever reads the field's canonical `.value` (LaTeX) via the `input` event
and writes to `.value` imperatively when the answer changes from
outside (e.g. a voice acceptance) — see `MathExpressionEditor.tsx`.

## MATH SPEECH GRAMMAR

`src/lib/lx/math-speech-parser.ts` — a small, deterministic,
LLM-free recursive-descent parser with per-language vocabulary tables
(`GRAMMARS['es']`, `GRAMMARS['en']`). Covers every R2 category: numbers
(digits and spoken 0–20 word-numbers), variables (single ASCII letters
in English; `equis`/`ye`/`zeta`/`ene`/`eme` in Spanish), `+`/`-`/`×`/`÷`
(the last rendered as a proper `\frac{}{}`), fractions (both explicit
"divided by" and spoken fraction words like "one third"/"un tercio"),
parentheses, powers (`squared`/`cubed`/generic `to the Nth`/`elevado a
N`), square/cube/nth roots, `=`/`<`/`>`/`≤`/`≥`, `\pi`, and absolute
value. Diacritic-insensitive on the Spanish side (`más`/`mas`,
`raíz`/`raiz` both match) since real STT output varies.

**Non-solving guarantee (R3)**: verified by dedicated tests — "two x
plus two x" stays `2x+2x` (never `4x`); "two plus three times four"
groups as `2+3\times 4` (respecting spoken-word order via ordinary
grammar precedence, exactly as a human transcriber would group it —
never evaluated to `20`); "2x + 3 = 7" is never rearranged or solved.

**Fail-closed guarantee (R2/R7)**: an unrecognized word, an incomplete
expression (dangling operator, unmatched parenthesis), or trailing
unparsed tokens all return `{ ok: false, reason: ... }` — there is no
partial-confidence tier that approximates a guess.

## SPANISH VOICE

All five spec-exact Spanish examples pass verbatim: "dos equis al
cuadrado más cinco" → `2x^{2}+5`; "abre paréntesis dos equis al
cuadrado más cinco cierra paréntesis al cubo" → `(2x^{2}+5)^{3}`; "raíz
cuadrada de equis más tres" → `\sqrt{x+3}`; "un medio de equis" →
`\frac{x}{2}`; "equis elevado a cuatro" → `x^{4}`.

## ENGLISH VOICE

All four spec-exact English examples pass verbatim: "two x squared plus
five" → `2x^{2}+5`; "open parenthesis two x squared plus five close
parenthesis cubed" → `(2x^{2}+5)^{3}`; "square root of x plus three" →
`\sqrt{x+3}`; "x to the fourth" → `x^{4}`.

Cross-language agreement is explicitly tested: the Spanish and English
spoken forms of `(2x^2+5)^3` produce the byte-identical LaTeX string.

## VOICE → MATH PIPELINE

`src/app/dashboard/MathVoiceInput.tsx` wraps the existing
`VoiceInputButton` (STT, completely unchanged — it still only ever
hands back a transcript after the learner's own existing
review/edit/accept step) rather than duplicating it. Flow: mic →
transcript (learner reviews/edits via VoiceInputButton's own existing
UI, unchanged) → accept → `parseMathSpeech(transcript,
expectedResponseLanguage)` → on success, a SECOND review surface
("StudyUS understood: <rendered math>") with explicit Use/Discard
buttons; only clicking "Use" calls `onAccept` and updates the answer.
On parse failure, the raw transcript is shown with the neutral message
"We couldn't convert all of that into math. Review it before
continuing." and no answer-state mutation happens automatically. STT
locale is `expectedResponseLanguage` (R14), never `activityLanguage`,
matching the authority LX-8R1 already established.

## TOOLBAR REDESIGN

`src/lib/math-expression-toolbar-config.ts` defines two tiers: an
8-button primary row (fraction, exponent, square root, parentheses,
times, divide, equals, pi) always visible, and a "More" panel
(subscript, nth root, absolute value, ≠/≤/≥/±, Σ, ∫, ∞, five Greek
letters) that expands on demand — never six tabs of raw symbols.
**Every** button inserts a LaTeX **template** via MathLive's own
`insert()` placeholder syntax (`#0`/`#1` for a fresh editable slot,
`#@` for "apply to the selection or the atom just before the cursor" —
MathLive's own convention for how typing `^`/`_` behaves) — e.g.
fraction inserts `\frac{#0}{#1}` (cursor lands in the numerator first,
MathLive's default `selectionMode: 'placeholder'`), exponent inserts
`#@^{#0}` (applies to whatever was just typed, not a disconnected new
symbol). Verified by a dedicated test file that every structural button
carries a placeholder and that no button regresses to inserting a bare
Unicode glyph.

## CANONICAL SERIALIZATION

`src/lib/lx/math-response-contract.ts` defines
`MathResponse { latex: string; plainText?: string; accessibilityText?:
string }`. `latex` is the one authoritative field; `toGraderString`
always returns it, regardless of which of the four input paths (typed,
toolbar, Spanish voice, English voice) produced the expression —
verified directly by test (`(2x^{2}+5)^{3}` from all four sources
serializes to the identical string).

## GRADER COMPATIBILITY

**No change to `gradeAnswer`/`gradeStructuredAnswer`
(`src/services/quiz-generation.service.ts`)** — confirmed by re-reading
both functions: they already take a plain `studentAnswer: string`, and
`gradeAnswer`'s free-text path is an AI grader instructed to evaluate
"on their merits, not on matching exact wording," already comfortable
with LaTeX since AI-generated questions/model-answers already use the
same `$...$` convention (see `math-text.ts`'s own doc comment). The
quiz page's `textAnswer` state — the exact string every existing
consumer already reads (`encodeCurrentAnswer`, `canProceed`, the
grader, and Review's `<MathText text={r.studentAnswer} />`) — is
unchanged in type or shape; for a math answer it now holds the
canonical LaTeX wrapped in `$...$` (`wrapMathForStorage`), which
`MathText` already knows how to render, so **Review needed zero code
changes** to display a math answer typeset instead of as raw LaTeX
text.

## RESPONSE CONTRACT INTEGRATION

`isMathAnswerContext(subjectName, responseContract.kind)` gates the
final-answer box: true only when `inferMathToolbarSubject` (the
pre-existing, non-adaptive subject heuristic already used for toolbar
button prioritization — never a new classifier, never touching
SupportLevel/mastery/evidence) says `mathematics`/`physics`, **and**
the kind is `ANSWER_ONLY`/`SHOW_WORK`/`JUSTIFY` (never `EXPLAIN`). This
directly implements the spec's own R8 examples — ANSWER_ONLY/SHOW_WORK/
JUSTIFY get "[math answer]," EXPLAIN keeps "[text]." **The reasoning/
work/justification box is never switched** — it stays the existing
prose `MathAnswerEditor` unconditionally, since a math-only structured
field cannot hold flowing prose reasoning; only the single final-answer
box is ever the structured editor (verified: exactly one
`<MathExpressionEditor` reference exists in `quiz/page.tsx`).

**Explicitly noted scope boundary**: the two retention-verification
flows ("prove independence" resume/verification screens, ~line 1193
and ~line 1553 of `quiz/page.tsx`) still use the original
`MathAnswerEditor` unconditionally — they lack the
`responseContract`/`interactionContract` values in scope at that point
in the component, and upgrading them was judged out of scope for this
pass rather than rushing an unverified change into two more call sites.
They are unregressed (unchanged, still functioning exactly as before).
This is a deliberate, disclosed gap, not an oversight.

## MOBILE

MathLive's own `mathVirtualKeyboardPolicy: 'auto'` is enabled, showing
its dedicated touch-friendly virtual keyboard automatically on
mobile/touch focus — no separate mobile keyboard was built. This
component's own toolbar is a single horizontally-scrollable row
(`overflowX: 'auto'`) plus a collapsible "More" panel, never a full
desktop-sized grid. **Not independently verified on a physical device
or emulator** — this environment has no live mobile browser to test
against; this is a code-level design choice, not a measured result.

## ACCESSIBILITY

The mathfield carries `aria-label`; every toolbar button carries both
`title` and `aria-label` (matching `MathAnswerEditor`'s existing
pattern); MathLive documents its own built-in math-to-speech/ARIA
support for the field's internal structure, which this component does
not reimplement or override. The activity remains completable without
a microphone — voice is rendered only inside the pre-existing
`ic.inputModes.includes('VOICE')` gate, never required. **Not
independently verified with a live screen reader** — no such tooling
exists in this environment; this is a code-level design review, not a
measured accessibility audit.

## OBSERVABILITY

All six required event labels
(`MATH_EDITOR_READY`, `MATH_VOICE_PARSE_STARTED`,
`MATH_VOICE_PARSE_SUCCEEDED`, `MATH_VOICE_PARSE_PARTIAL`,
`MATH_VOICE_PARSE_FAILED`, `MATH_RESPONSE_ACCEPTED`) were added to
`InteractionEventLabel`, plus safe metadata fields `language` and
`parserResult` (a fixed reason-code string, never the transcript or
the parsed expression) added to `InteractionEventMeta`. **Honest gap**:
`MATH_VOICE_PARSE_PARTIAL` is defined in the type for architectural
completeness but is **never emitted** by the current implementation —
the parser is deliberately binary (full parse or `{ ok: false }`, per
R2/R7's "never silently guess" requirement), so there is no
intermediate "partial" state to report today. This is a conscious
design choice, not an unfinished feature; if a future revision adds a
genuine partial-confidence tier, the event already exists to carry it.

## TESTS

- `tests/unit/math-speech-parser.test.ts` — 49 tests: every exact
  spec example (Spanish + English), the R16 manual-QA-script phrases,
  cross-language/cross-modality agreement, the non-solving guarantee,
  every required grammar category, fail-closed behavior on
  unrecognized/incomplete/ambiguous input, the R14 language-isolation
  guarantee (German fails closed rather than falling back to another
  language's vocabulary), and accent-insensitive Spanish parsing.
- `tests/unit/math-response-contract.test.ts` — 6 tests: canonical
  serialization, cross-modality identical-answer guarantee,
  `toGraderString` never reads the optional presentational fields,
  empty-response detection.
- `tests/unit/math-expression-toolbar-config.test.ts` — 11 tests:
  primary-row/More-panel composition, every structural button carries
  a placeholder, exponent/subscript apply via `#@` (not a disconnected
  placeholder pair), fraction cursor-order, no button regresses to a
  bare Unicode glyph.
- `tests/unit/lx8r2-math-response-experience.test.ts` — 30 tests
  (source-contract style, matching this codebase's established
  no-jsdom testing pattern): the R16 quality bar itself, STT/math-
  interpretation separation (R1), SSR safety (R4), no raw-LaTeX
  exposure (R6), the voice pipeline's explicit-acceptance guarantee
  (R7), response-contract integration and the single-structured-box
  guarantee (R8), grader-compatibility wiring (R9/R10), mobile (R11),
  accessibility (R13), language architecture (R14), observability
  (R15), and contract-module purity.

`npx tsc --noEmit`: clean. `npx vitest run`: **3296 passed / 3296**
across 208 files (up from RET-R2's 3200/204 — 96 new tests, 4 new
files). `npm run build`: clean production build, `/dashboard/quiz`
compiles and prerenders with no SSR error from the new dependency.

## LIVE QA REQUIRED

The following R16 manual-QA-script items were verified at the
**parser/logic level** (automated tests above) but **not** in a live
browser, since this environment has no browser/DOM/microphone/speaker
to drive:

1. Typing `(2x^2 + 5)^3` directly into the mathfield and confirming it
   renders and serializes identically to the toolbar/voice paths.
2. Building the same expression via toolbar clicks only, confirming
   cursor placement inside each structure (fraction numerator, root
   radicand, exponent) feels natural.
3. Speaking it in Spanish and English and confirming the on-screen
   "StudyUS understood" review renders correctly before acceptance.
4. Visual/typographic quality of the rendered mathfield across
   browsers (Chrome/Safari/Firefox) and the mobile virtual keyboard's
   actual on-screen behavior.
5. A live screen-reader pass over the mathfield and toolbar.

Do NOT claim LIVE PASS until this QA is performed. Do NOT start LX-9.
STOP.
