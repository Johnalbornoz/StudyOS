# STUDYUS — LX-5 LIVE REPAIR

## LX-5R1 — SAME-ROUTE CONTINUATION REPAIR

Continued on `tmp/lx1`. Builds on `bb75e0d` (LX-4P-PERF-R1G, PASS).
Implementation commit: `82376ac`.

### ROOT CAUSE

**Exact frontend function**: `onContinue()` in
[`src/app/dashboard/quiz/ContinuationPanel.tsx`](../../src/app/dashboard/quiz/ContinuationPanel.tsx),
specifically the line `router.push(c.launchTarget);` on the
`continuation.status === 'LAUNCH'` branch.

**Exact route-equivalence condition**: the live QA case launched
`/dashboard/quiz?subjectId=...&conceptId=...&mode=topic_practice` while
the learner was already on that identical pathname + query string
(canonical PRACTICE → PRACTICE for the same concept). `router.push()`
with a URL string identical to the current location is a **no-op** in
the Next.js App Router — no navigation event fires, nothing re-renders
for a route change, and no component unmounts.

Two things then compounded, both inside the SAME still-mounted
component tree:

1. `ContinuationPanel`'s own `busy` state was set `true` at the top of
   `onContinue()` and — on the success path — was **never reset**. With
   a real navigation this doesn't matter (the component unmounts before
   anyone notices); with a no-op push, it stays `true` forever, so the
   button shows a permanent spinner.
2. Even had `busy` been reset, `QuizPage` (`src/app/dashboard/quiz/
   page.tsx`) would still not have started a new activity: `quizId`,
   `questions`, `answers`, `results`, `phase`, and the `autoStartedRef`
   auto-start guard are all component-local `useState`/`useRef` values
   that React does **not** reset just because `searchParams` changes on
   a re-render — and a query-string-only "navigation" doesn't even
   produce that re-render here, since no navigation happened at all.

### LIVE FAILURE FLOW

```
Results screen (phase='quiz', results populated, ContinuationPanel busy=false)
  -> learner clicks Continue
  -> onContinue(): setBusy(true)
  -> POST /api/learning/continue  (200, real work happens server-side)
  -> continuation.status === 'LAUNCH'
  -> launchTarget === current pathname + query, verbatim
  -> router.push(launchTarget)          <-- NO-OP: identical URL
  -> ContinuationPanel never unmounts, busy never reset
  -> button spins forever; learner stranded on the old Results screen
```

### SAME-ROUTE DETECTION

New pure helpers in [`src/lib/lx/continuation.ts`](../../src/lib/lx/continuation.ts)
(no DOM, fully unit-testable):

- `isSameRoute(currentUrl, targetUrl)` — true iff both resolve to the
  same pathname and the same **set** of query parameters (order-
  independent), ignoring `RELAUNCH_NONCE_PARAM` on either side. Ignoring
  the nonce specifically means a learner's *second* consecutive
  same-route relaunch (whose *current* URL still carries the *previous*
  nonce) is still correctly recognized as the same route against a fresh
  server `launchTarget` that never carries one.
- Unparsable input never throws and never falsely claims same-route —
  it degrades to `false`, i.e. "treat as a normal navigation."

This directly encodes R2's invariant — same canonical activity does
**not** imply same activity instance, and same-route is a legitimate
outcome, never rewritten to a different activity to force navigation.

### RELAUNCH MECHANISM

`buildRelaunchTarget(currentUrl, launchTarget, nonce)`:

- Not same-route → returns `launchTarget` **unchanged** (normal
  navigation, R3's explicit "acceptable" case).
- Same-route → appends a fresh one-shot `relaunch=<nonce>` query
  parameter to `launchTarget` and returns that. The nonce
  (`newRelaunchNonce()`) is a cheap `Date.now()` + `Math.random()`
  string — not a security token, just "different every call" — chosen
  over `window.location.reload()` per R3's explicit preference for the
  smallest mechanism consistent with the existing architecture (a query
  param is exactly how this app already threads state through
  navigation everywhere else).
- Any parse failure degrades to the raw `launchTarget` rather than
  throwing — R6/R13's "recoverable, not a crash" requirement.

`ContinuationPanel` computes `currentUrl` from
`window.location.pathname + window.location.search`, calls
`buildRelaunchTarget`, and pushes the result. The destination's own
`conceptId`/`mode`/`subjectId` query values are never touched — only an
additional, orthogonal param is added.

### FRESH SESSION GUARANTEE

`src/app/dashboard/quiz/page.tsx` now splits into:

```tsx
export default function QuizPage() {
  const searchParams = useSearchParams();
  const relaunchKey = searchParams.get(RELAUNCH_NONCE_PARAM) || '';
  return <QuizPageContent key={relaunchKey} />;
}

function QuizPageContent() { /* everything that was QuizPage before, unchanged */ }
```

A `key` change is React's own guaranteed "discard and recreate this
subtree" primitive — it resets **every** piece of `QuizPageContent`'s
local state in one operation: `quizId`, `quizLanguage`, `questions`,
`current`, `answers`, every per-question draft field, `results`,
`reviewing`, `teachingExperience`, `teachingStage`, `phase`, `genState`,
and the `autoStartedRef`/`questionPresentedAtRef` refs. This was chosen
over manually resetting each field individually specifically because R4
lists seven distinct pieces of state that must never survive a relaunch
(`quizId`, questions, answers, score, Results state, draft, teaching
stage progress) — a manual reset risks missing one (today or after a
future edit adds an eighth); a `key` change cannot miss any of them by
construction, because it doesn't selectively clear fields, it discards
the whole component instance.

A normal, different-route launch is unaffected: no `relaunch` param is
ever present, so `relaunchKey` is always the stable empty string and no
extra remount occurs — the existing behavior for every non-same-route
continuation (Prove → Retain, Practice → Transfer, etc.) is unchanged.

Because `autoStartedRef` is declared fresh inside the newly-mounted
`QuizPageContent`, the existing auto-start effect (`isCanonicalFlow &&
studentId && phase === 'setup' && !autoStartedRef.current`) fires again
exactly as it does for a brand-new page load — this is what satisfies
R7: one new `generate-and-take` call for the fresh instance, and the
existing guard (`autoStartedRef.current = true` before the call)
continues to prevent it from firing twice within that instance.

### TEACHING EXPERIENCE HANDOFF

Untouched logic, only reordered relative to the new same-route check
(the handoff decision happens first, exactly as before; same-route
detection is purely about *how* to navigate, computed afterward and
never consulted by the handoff). `consumeLaunchTeachingHandoff`
(`src/lib/lx/launch-teaching-handoff.ts`, not modified) still requires
same concept, same mode, freshness (`LAUNCH_TEACHING_MAX_AGE_MS`), and a
structurally intact view at the current contract version, and still
consumes (deletes) the sessionStorage key unconditionally once read. The
new `relaunch` query parameter cannot collide with or be mistaken for
`mode` — they are distinct, independently-read parameters — so a
same-route relaunch's mode-matching validation is identical to a
normal launch's.

### LOADING / ERROR BEHAVIOR

Two independent guarantees now hold, satisfying R6:

1. **Primary fix**: a same-route LAUNCH is now a genuine navigation
   (different URL → real `router.push` → remount), so
   `ContinuationPanel` unmounts along with the rest of the old
   `QuizPageContent` instance — the stuck spinner's root cause is gone.
2. **Backstop** (defense in depth, R13's explicit ask): both navigating
   branches (`LAUNCH` and `RETURN_TO_MISSION`) arm a 4-second
   `stuckTimerRef` timeout right before calling `router.push`. If this
   component is *still mounted* when it fires — meaning some future or
   unforeseen case slipped past the same-route fix and the "successful"
   navigation didn't actually go anywhere — it explicitly resolves to
   `busy=false, failed=true` (the same recoverable "back to concept"
   fallback the existing fetch/parse-failure path already used) and
   logs `CONTINUATION_FAILED` with `reason: 'navigation_did_not_unmount'`.
   The timer is cleared in a `useEffect` cleanup, so a real, successful
   navigation (the expected outcome) never lets it fire.

The pre-existing fetch/JSON-parse failure path (`catch { setBusy(false);
setFailed(true); }`) is unchanged.

### EVIDENCE INTEGRITY

Not touched by this repair. `ContinuationPanel.tsx` and
`continuation.ts` contain no evidence/mastery/knowledge-state writes
(verified by source-contract test, matching the existing convention from
`lx5-continuation.test.ts`). The relaunch mechanism only changes *how*
the client navigates to the already-decided `launchTarget` — it never
calls `/api/learning/record-evidence` or any grading endpoint itself, so
R8's invariants (no duplicate evidence, no evidence write on navigation
itself, no evidence erased) hold structurally: nothing new writes
anything.

### OBSERVABILITY (R9)

Added via a small `mark()` helper in `ContinuationPanel.tsx` (same
`console.log('[perf]', JSON.stringify({...}))` pattern `quiz/page.tsx`'s
existing `perfMark` already uses):

- `CONTINUATION_REQUEST_STARTED` — `{conceptId, from}`
- `CONTINUATION_DECISION_READY` — `{conceptId, activityType}`
- `CONTINUATION_SAME_ROUTE_RELAUNCH` / `CONTINUATION_NAVIGATED` —
  `{conceptId, mode, sameRoute}`
- `CONTINUATION_FAILED` — `{conceptId, reason?}`

No learner answer, question text, or explanation content appears in any
of these (verified by source-contract test against every `mark()` call
site).

### TESTS

New file: `tests/unit/lx5r1-same-route-relaunch.test.ts` — 30 tests.
Following this file's own established convention (see
`lx5-continuation.test.ts` / `lx5r-continuation-repair.test.ts`'s header
comments: "the repo has no live component/DB harness"), the new pure
functions (`isSameRoute`, `buildRelaunchTarget`, `newRelaunchNonce`) get
**real, executable** unit tests, and the React-component-level
guarantees (remount actually clearing state, the backstop actually
firing, the button visually un-sticking) get source-contract checks
against the actual `page.tsx`/`ContinuationPanel.tsx` source, with
runtime behavior HARNESS-verified in QA per this same convention.

Mapping of the 20 requested scenarios onto the suite:

1–2, R2/R3 — `isSameRoute`/`buildRelaunchTarget` unit tests (different
route unchanged; identical route gets a fresh nonce; param order and a
stale nonce on the current URL don't confuse detection).
3 — source check: `page.tsx` wraps `QuizPageContent` with `key=
{relaunchKey}`.
4–5 — source check: `quizId`/`questions`/`answers`/`results` are all
`QuizPageContent`-local `useState`, reset for free by the keyed remount.
6 — source check: `autoStartedRef` is declared inside `QuizPageContent`.
7 — source check: the auto-start guard sets `autoStartedRef.current =
true` before calling `startCanonicalActivity`, and that function issues
exactly one `generate-and-take` fetch.
8–9 — source check: no evidence-writing call anywhere in the changed
files.
10–11 — source check: the handoff write is unconditional and unchanged;
`launch-teaching-handoff.ts`'s validation (concept/mode/freshness/shape/
consume-once) is asserted intact.
12–13 — source check: both navigating branches arm the stuck-backstop
before `router.push`; the backstop resolves to an explicit recoverable
state; the timer is cleared on unmount.
14–15 — source check: the resolver (`learning-continuation.service.ts`)
still sources only canonical authority, with no `relaunch`-specific
branching anywhere in it; `RETURN_TO_MISSION` still navigates to the
concept mission unconditionally.
16–20 (R1D/R1E/R1F/R1G/activity-language unaffected) — satisfied by the
**full existing suite remaining green**; none of those phases' files
were touched here.

```
npx tsc --noEmit        # clean, 0 errors
npx vitest run          # 195 files, 2928 tests, all passed
npm run build           # succeeded, Turbopack production build, /dashboard/quiz unchanged (ƒ dynamic)
```

(2928 = 2898 pre-existing + 30 new; every pre-existing test file's
outcome is unchanged.)

### COMMIT

`82376ac` — `fix(lx): LX-5R1 -- same-route continuation must relaunch the activity`

---

## LX-5R1 — SAME-ROUTE CONTINUATION REPAIR

**STATUS: PASS**

A canonical PRACTICE → PRACTICE continuation for the same concept now
produces a genuinely new navigation (the identical-URL no-op is
replaced by a one-shot nonce-bearing URL) and, on arrival, a fully fresh
`QuizPageContent` instance via a React `key` change — new `quizId`, new
question batch, empty answers/results, the teaching-stage/auto-start
guards reset, one new `generate-and-take` call. `LearningDecision`,
`TeachingExperience` derivation, mastery/evidence logic, and
`/api/learning/continue`'s decision semantics were not modified.
`ContinuationPanel`'s Continue button can no longer spin indefinitely:
the primary fix removes the no-op navigation that caused it, and an
independent timeout backstop guarantees an explicit recoverable state
even in an unforeseen future case.

Do NOT claim LIVE PASS until pushed to QA and reproduced — this is a
code-level PASS backed by unit tests, source-contract checks, and a
clean build, not a live QA run.

Do NOT start LX-6.
