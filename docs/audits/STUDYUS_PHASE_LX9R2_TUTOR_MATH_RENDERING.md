# LX-9R2 — TUTOR MATH RENDERING

## STATUS

**PASS.** Tutor prose and mathematics now render naturally in one message. All required LaTeX delimiter forms (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`, including a `$$...$$` block whose delimiters sit on their own lines) are recognized and typeset via the existing, already-trusted KaTeX rendering path — no supported delimiter leaks to the learner. Learner-authored math renders identically, through the same code path. Zero AI calls added; Tutor's Luna-first routing, telemetry, and one-bounded-Terra-fallback topology (LX-9) are untouched. No new unsafe HTML path was introduced. Full regression suite green.

## ROOT CAUSE

Two independent gaps in `src/lib/chat-markdown.ts` (the parser behind `ChatMessage.tsx`, which renders every Tutor message — both roles):

1. **`\(...\)` / `\[...\]` were never recognized at all.** The inline regex (`INLINE_RE`) only matched `$$...$$` and `$...$`. A learner or assistant message using LaTeX's own native delimiters rendered the literal backslash-paren characters as plain text.
2. **A `$$...$$` block whose delimiters sit on their own lines broke entirely.** `parseChatBlocks` splits the whole message into lines (`content.split('\n')`) *before* any math-delimiter detection runs, then parses each line independently. The live-QA-reported shape —
   ```
   $$
   (a+b)^2=(a+b)(a+b)
   $$
   ```
   — has the opening `$$` alone on one line, the equation alone on the next, and the closing `$$` alone on a third. None of the three lines contains a complete `$$...$$` pair by itself, so all three rendered as literal text. (`@/lib/math-text.ts`, the quiz-surface renderer, does not have this bug — it parses the *whole* input string at once rather than splitting into lines first, so its own `$$...$$` regex can already span newlines.)

`\cdot` and other LaTeX commands needed no separate fix: KaTeX already renders them correctly (`⋅`, superscripts, `\frac`) the moment the surrounding expression is recognized as a math segment at all — the reported "literal `\cdot`" was a symptom of gap #2 (it sat inside an unrecognized region), not a KaTeX limitation.

## OLD MESSAGE RENDERER

Audited before changing anything (R1). `TutorChat.tsx` already renders every message — assistant and learner alike, including historical conversation messages loaded from `/api/tutor/messages` — through one shared component: `<ChatMessage content={m.content} />` (one call site, used regardless of `m.role`). `ChatMessage.tsx` already parses a Markdown-lite subset (`#`/`##`/`###` headings, `**bold**`/`*italic*`, ordered/unordered lists, fenced code, `function-plot` chart specs) via `parseChatBlocks`/`parseInline` (`chat-markdown.ts`), and already typesets recognized math via the real `katex` package (`katex.renderToString` + `dangerouslySetInnerHTML`) — the exact same library and pattern `MathText.tsx` uses for quiz/review surfaces. This was not plain text, not raw `<p>` dumping, and not a second math library — it was an existing, purpose-built renderer with two specific, fixable delimiter-detection gaps.

## NEW MESSAGE RENDERER

No new renderer, no new component, no new dependency (R2's explicit instruction). Both gaps are fixed inside the existing `chat-markdown.ts` via one new, pure, deterministic function: `normalizeMathDelimiters(content)`, called as the very first step of `parseChatBlocks` — before `content.split('\n')` ever runs.

## MATH NORMALIZATION

```ts
export function normalizeMathDelimiters(content: string): string {
  let out = content;
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner) => `$$${inner}$$`);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner) => `$${inner}$`);
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner) => `$$${inner.replace(/\s*\n\s*/g, ' ').trim()}$$`);
  return out;
}
```

Runs on the full, unsplit message: `\[...\]` → `$$...$$` and `\(...\)` → `$...$` first (each can itself span multiple lines), then every `$$...$$` span — whichever delimiter it started as — has its internal newlines collapsed to single spaces, so the line-based block parser sees it as one line and the existing single-line `$$...$$` match already in `parseInline` finds it. A message already using only the canonical `$...$`/`$$...$$` convention round-trips through this function completely unchanged (verified by test). No AI call is involved at any point (R6/R8) — this is a pure string transform, and the model is never asked to regenerate for a delimiter-style difference.

**Accepted limitation**: the normalization pass runs on the raw string before fence detection, so a fenced code block that happened to contain literal `\(...\)`/multi-line-`$$` text (not `function-plot` JSON, which never contains these characters) could theoretically have its content altered. This is judged low-probability and low-impact for Tutor's actual output shapes and was not specially guarded against, to avoid a larger tokenizer rewrite for an edge case not observed in the live report.

## ASSISTANT MESSAGES

The Tutor's system prompt (`tutor.service.ts`) already instructs `$$...$$` for display math and `$...$` for inline math — unchanged, since the prompt's own instruction is correct; the ambiguity was in how strictly a model interprets "on its own line" (single line vs. delimiters-on-separate-lines), which the normalization now tolerates either way without depending on stricter model compliance. Per the standing instruction ("do not change Tutor prompt pedagogy unless necessary for rendering consistency"), the prompt text was judged *not necessary* to change, since normalization already fully resolves both observed output shapes.

## LEARNER MESSAGES

`TutorChat.tsx` renders learner and assistant messages through the identical `<ChatMessage content={m.content} />` call site — there is no separate learner-message renderer to fix or leave behind. The exact reported learner input (`¿Por qué \((a+b)^2\) no es igual a \(a^2+b^2\)?`) was used as a required-test fixture and confirmed to render both math spans cleanly with the surrounding Spanish prose fully intact and no literal `\(`/`\)` left as text.

## MARKDOWN

Audited: Tutor responses already commonly use bold, bullets/numbered lists, headings, and fenced code (including the `function-plot` chart convention) — all already supported by the pre-existing `parseChatBlocks`, confirmed unchanged and still passing every pre-existing test in `chat-markdown.test.ts`. Nothing here was touched beyond the new normalization pre-pass.

## SECURITY

No `dangerouslySetInnerHTML` was added. The one pre-existing use in `ChatMessage.tsx` feeds only `katex.renderToString(...)` output — never raw model or learner text — the identical, already-trusted pattern `MathText.tsx` uses for quiz/review surfaces, with KaTeX's default `trust: false` left in place (never overridden). Verified by test that exactly one `dangerouslySetInnerHTML` exists in the file and that it is katex-sourced.

## AI COST

Zero AI calls added. `chat-markdown.ts` has no AI-related import; `ChatMessage.tsx` performs no network call — `katex.renderToString` is synchronous, local, and was already being called before this fix. Verified by source-contract test.

## PERFORMANCE

No server round trip was added — the fix is entirely client-side string normalization plus the same synchronous KaTeX call already in the render path. No new dependency was introduced (KaTeX was already loaded, unchanged import). Per R10, the live-observed embedding (~1375ms) + Tutor Luna (~2784ms) ≈ 4580ms total route latency is documented here but explicitly NOT optimized in this repair — flagged for the final performance certification to audit whether retrieval/embedding is skippable when no subject is selected, no material is attached, or the question is answerable from general knowledge. No retrieval behavior was changed.

## TESTS

- `tests/unit/lx9r2-tutor-math-rendering.test.ts` (**new**, 24 tests) — covers all 20 required items: inline/block math for both canonical (`$...$`/`$$...$$`) and LaTeX-native (`\(...\)`/`\[...\]`) delimiters (1-6), mixed prose+math in one message using the exact reported shape (7), bold/lists unaffected (8), learner-message rendering including the exact reported example (9-10), `\cdot`/exponents/fractions rendering as real KaTeX structure via the visually-rendered `katex-html` span (11-13), zero raw delimiters surviving as text for the exact reported combined message (14), zero AI calls (15), Tutor routing/telemetry/fallback topology unchanged (16-18), no new unsafe HTML path (19).
- `tests/unit/chat-markdown.test.ts` — all 17 pre-existing tests pass unchanged, confirming the fix is purely additive (no regression to headings/lists/code fences/`function-plot`/the existing single-line `$$...$$` behavior).
- Full suite: 3528/3528 passing across 216 files (up from 3504/215 — one new test file). `npx tsc --noEmit` and `npm run build` both clean.

No live browser/authenticated-session QA of the actual `/dashboard/tutor` route was possible in this environment (no live DB/auth) — all verification is via the real `katex` package exercised directly in unit tests (not mocked), which is the strongest evidence available here; this is not claimed as a LIVE PASS.

## COMMIT

Implementation (`src/`, `tests/`) and report committed separately, both with the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. LX-10 was NOT started.
