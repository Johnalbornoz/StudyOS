# RELEASE-R1 — ZERO-GAP FRONTEND ACTION INTEGRITY

## STATUS

**PASS.** The exact client-side entry path that let a learner reach an already-known-non-executable Practice request was traced (not guessed) to two ungated links, and fixed by routing them through the same canonical, actionState-gated mechanism every other surface already uses — no new gating logic was duplicated client-side. Separately, the server's zero-gap rejection now carries a machine-readable reason, and the client shows the correct recovery UX for it instead of a generic failure screen. `npx tsc --noEmit`, `npx vitest run` (234 files / 3979 tests), and `npm run build` are all clean on the implementation commit.

---

## LIVE BLOCKER

```
POST /api/quizzes/generate-and-take
activityType: PRACTICE, quizMode: topic_practice, targetDifficulty: 2

Server result: INVALID_GENERATION_CONTRACT / ZERO_GAP_PRACTICE_MISMATCH
sessionCreated: false, provider calls: 0, duration: 94ms
```

The backend canonical backstop (LX-9R8) worked exactly as designed. The defect: a learner-facing surface still let the learner *navigate into* a Practice activity canonical authority had already determined was not executable, and the learner saw a generic "couldn't prepare this activity" failure for what is actually a well-understood, machine-classified state.

---

## ROOT CAUSE

Traced via an exhaustive audit of every file in `src/app` that constructs a `/dashboard/quiz?...` URL (`grep -rn "dashboard/quiz?"`), cross-referenced against `quiz/page.tsx`'s own mode-resolution:

```ts
const modeParam = (searchParams.get('mode') as QuizMode | null) || (conceptId ? 'topic_practice' : 'cumulative_assessment');
```

Exactly two files hand-built a `/dashboard/quiz?subjectId=...&conceptId=...` URL with **no `mode` parameter**, rendered **unconditionally** (no `actionState` check of any kind) for every concept:

1. **`src/app/dashboard/subjects/[id]/ConceptList.tsx`** — the "Practicar" button on every row of Subject Detail's flat concept list.
2. **`src/app/dashboard/learning-debt/ErrorPatternList.tsx`** — the "practiceOptional" link under an expanded error-pattern guidance panel (the "Improve/Reinforce" surface named in Part A's own audit list).

Combined with `quiz/page.tsx`'s default (`conceptId` present, `mode` absent → `'topic_practice'`), either link reproduces the exact live request shape for **any** concept, including one whose canonical evidence gap is already 0 — matching the live evidence precisely.

**Every other named surface was audited and confirmed clean**, all launching exclusively through the ONE canonical mechanism (`StartSessionButton` → `POST /api/learning/session/start`, which re-derives the decision fresh from `getLearningDecisions` by `actionConceptId` and returns `404 NOT_FOUND` — never a guessed URL — when no current decision exists):

- Today (`dashboard/page.tsx`) — no hand-built quiz URL.
- My Path (`path/page.tsx`, `path/[subjectId]/page.tsx`, `JourneyStrip.tsx`) — no hand-built quiz URL.
- Concept Mission (`ConceptMission.tsx`) — `StartSessionButton` only.
- Results/continuation (`ContinuationPanel.tsx`) — `router.push(target)` where `target` is the server's own `resolveContinuation().launchTarget`, never client-constructed.
- Subject Detail's own **top-level** CTA (the same file as the defect) already used `StartSessionButton` correctly, per its own LX-7R1-era comment: *"the canonical decision for this subject, launched through the same authority Today/My Path use — never a hand-built /dashboard/quiz?... URL."* The per-row shortcut buttons simply never received that same treatment.

**`quick_check` was deliberately excluded from this fix.** Subject Detail's `quick_check` button is ALSO a bare, ungated link — but `isZeroGapPracticeMismatch` (`evidence-sufficiency-contract.ts`) structurally excludes `SOLO_CHECK` from the zero-gap rejection class entirely (`if (activityType !== 'PRACTICE' && activityType !== 'REVIEW') return false;`). The canonical backend never rejects a quick_check request for this reason, so this button cannot reproduce the live defect. Changing it would have gone beyond the proven defect into a broader redesign ("every activity-launch CTA must pre-authorize through the decision engine, even ones with no rejection risk") — explicitly out of scope for a bug-fix phase ("DO NOT start a new feature phase").

`subjects/[id]/page.tsx`'s `cumulative_assessment`/`exam_simulation` links were also audited and left unchanged: both carry an explicit mode and represent a **learner-chosen** assessment tool, never a claimed "canonical recommendation" — a different action category from a per-concept Practice CTA.

---

## ENTRY PATH

```
Subject Detail page
  → ConceptList row's "Practicar" button
    → <Link href="/dashboard/quiz?subjectId=X&conceptId=Y">  (no mode, no actionState check)
      → quiz/page.tsx: modeParam defaults to 'topic_practice' (conceptId present, mode absent)
        → isCanonicalFlow = true (conceptId present, mode not cumulative/exam)
          → startCanonicalActivity() auto-fires (LX-4K auto-start)
            → POST /api/quizzes/generate-and-take { quizMode: 'topic_practice', ... }
              → server: canonical evidence gap = 0, no REINFORCE signal
                → 500 GENERATION_FAILED (now: 409 INVALID_GENERATION_CONTRACT)
                  → learner sees "Couldn't prepare this activity" (genState==='error', practice.prepareFailedTitle)
```

This is also, independently, **the exact live incident's OWN entry path**, not a hypothetical alternate one: `startCanonicalActivity`'s background generation wave (`genState`) is what auto-fires for any canonical single-concept launch (`isCanonicalFlow`), and its own failure copy (`practice.prepareFailedTitle`/`practice.prepareFailedBody`) is what the live evidence's "Couldn't prepare this activity" corresponds to.

---

## CANONICAL ACTION AUTHORITY

No new authority was introduced. `StartSessionButton` already IS the correct, complete implementation of Part B's mandate:

```ts
// StartSessionButton.tsx
const res = await fetch('/api/learning/session/start', {
  method: 'POST',
  body: JSON.stringify({ studentId, actionConceptId }),  // never a client-guessed mode/URL
});
// launchStatus === 'READY' -> router.push(session.launchTarget)
// otherwise -> "unavailable", never a fabricated URL
```

`/api/learning/session/start` re-derives the decision **fresh, per concept**, from `getLearningDecisions` (the same canonical engine Today/My Path/Concept Mission all read) and returns `404` when no current decision exists for that concept — the server, never the client, decides executability. Both fixed call sites (`ConceptList.tsx`, `ErrorPatternList.tsx`) now route to Concept Mission, where this exact mechanism already renders the correct CTA (or the correct `NO_CANONICAL_ACTION`/`WAITING` copy) for that specific concept.

---

## REMOVED FALLBACKS

| File | Before | After |
|---|---|---|
| `ConceptList.tsx` | `<Link href="/dashboard/quiz?subjectId=${subjectId}&conceptId=${c.conceptId}">{t['subjectDetail.practice']}</Link>` — no mode, unconditional | `<Link href="/dashboard/subjects/${subjectId}/concepts/${c.conceptId}">{t['subjectDetail.practice']}</Link>` — routes to Concept Mission's own gated CTA |
| `ErrorPatternList.tsx` | `<Link href="/dashboard/quiz?subjectId=${p.subjectId}&conceptId=${p.topConceptId}">{t['debt.practiceOptional']}</Link>` — no mode, unconditional | `<Link href="/dashboard/subjects/${p.subjectId}/concepts/${p.topConceptId}">{t['debt.practiceOptional']}</Link>` |

**`quiz/page.tsx`'s own `modeParam` default (line 242) was deliberately left unchanged.** With both exploiting call sites fixed, no remaining reachable UI path constructs a `conceptId`-present, `mode`-absent URL (confirmed by required test 8, which asserts every remaining `/dashboard/quiz?...conceptId=...` link in the app carries an explicit `mode`). The default is therefore now dead code from any normal navigation path. It was not removed outright because: (a) it is load-bearing for `isCanonicalFlow`/`continuationKind`/type-narrowing throughout a large, multi-branch client component, and touching it risks a blast radius well beyond this proven defect; (b) even if reached via a stale bookmark or hand-edited URL, the server backstop still rejects it before any AI call, and the client's new PART D handling (below) now shows the correct recovery UX rather than a raw error — so the residual risk is fully covered by defense in depth, not left open. This is a disclosed, deliberate scoping decision, not an oversight.

---

## STALE STATE HANDLING

Audited (PART E) against every listed candidate cause:

- **Stale cached canonical state**: not applicable here — the defect was never about a stale value going stale; it was about a code path (the bare link) that never fetched or checked canonical state at all.
- **Old CTA after completing another activity**: not the cause — `ConceptList`'s row is server-rendered fresh from each page load's own `journeyStage` prop; the button itself simply never consulted it.
- **Hardcoded mode query**: yes, in effect — the ABSENCE of a mode query, combined with `quiz/page.tsx`'s own hardcoded default, is functionally equivalent to a hardcoded `mode=topic_practice`.
- **Generic practice fallback**: **yes — this is the confirmed root cause.**
- **Missing canonical refresh after Results**: not implicated — the defect occurs on a fresh Subject Detail page load, not a post-Results transition.
- **Race between state persistence and navigation**: not the cause of the traced defect, but genuinely possible in principle for the canonical `StartSessionButton` path (a decision computed slightly before a concurrent evidence write commits) — `session/start`'s own fresh-per-request re-derivation already revalidates immediately before returning a launch target, so this class of race is already handled without any new code. PART D's error-UX fix additionally covers the case where such a race slips through anyway (the 409 response is now handled gracefully, not shown as a generic failure).

No pedagogical logic was duplicated client-side to "fix" this — the fix is entirely a matter of routing (which mechanism a button calls), never a new client-side eligibility computation.

---

## ERROR UX

The server's zero-gap rejection previously returned a **generic, non-distinguishable** response:

```ts
// BEFORE
return NextResponse.json({ error: 'GENERATION_FAILED', message: 'Failed to generate quiz questions' }, { status: 500 });
```

Now:

```ts
// AFTER
return NextResponse.json(
  { error: 'INVALID_GENERATION_CONTRACT', reason: 'ZERO_GAP_PRACTICE_MISMATCH', message: 'This activity is no longer your next canonical step.' },
  { status: 409 },
);
```

409 (not 500): the request is well-formed; canonical **state**, not the provider, is what makes it inexecutable — this is a state conflict, not a server error, matching the same convention already established for the analogous Transfer precondition (UX/CANON-R1's `RETENTION_REQUIRED_BEFORE_TRANSFER`).

The client (`quiz/page.tsx`) now detects this exact `{error, reason}` pair in **both** places a generation request can fail:

1. `generateQuiz` (the top-level `phase==='error'` path, used by the manual/legacy setup flow and explicit retries).
2. `startCanonicalActivity`'s own background generation wave (`genState`) — **the actual path the live incident went through**, since canonical single-concept activities auto-start via this wave (LX-4K).

In both cases, detecting the reason shows:

> **"Tu siguiente paso cambió con tu progreso. StudyUS actualizó tu recorrido."**
> [Volver al concepto] → Concept Mission

— never "Try again" (the identical request would fail again identically; canonical state, not the provider, rejected it) and never the raw generic copy (`quiz.loadError` / `practice.prepareFailedTitle`). A **genuine** generation/provider failure is completely unaffected: same copy, same in-place retry, same code path, confirmed by required tests 12-13.

---

## SERVER BACKSTOP

Unchanged in *logic* — still positioned strictly before every generation call site, still gated by the same `hasReinforceSignal` exception, still fails before any AI call (required tests 10-11). Only the **response shape** of the rejection changed (409 + machine-readable `reason`, instead of a bare 500). The server-side check itself (which knowledge-state fields it reads, its position relative to `generateQuickCheckQuestions`/`generatePracticeQuestions`/`generateRetentionCheckQuestions`/`generateGatedQuestionBatch`) is byte-for-byte the same as LX-9R8 left it.

---

## TESTS

20 required tests, all passing, in `tests/unit/release-r1-zero-gap-frontend-action-integrity.test.ts` (30 assertions across the describe blocks):

| # | Requirement | Result |
|---|---|---|
| 1-2 | ZERO_GAP Practice/Review never render an executable CTA (unless REINFORCE) | PASS |
| 3-7 | Today/My Path/Subject Detail/Concept Mission/Results-continuation cannot launch invalid Practice | PASS |
| 8 | Generic fallback cannot default to topic_practice on any reachable path | PASS |
| 9 | Stale canonical action is refreshed before launch | PASS |
| 10 | Server backstop unchanged | PASS |
| 11 | Invalid direct request makes zero provider calls | PASS |
| 12 | Canonical mismatch never shows a generic AI-generation error | PASS |
| 13-17 | Valid Practice/Review/Prove/Retention/Transfer still launch exactly as before | PASS |
| 18 | UX/CANON-R1 difficulty visibility unchanged | PASS |
| 19 | LX-10R1 performance work unchanged | PASS |
| 20 | All existing tests green | PASS (234 files / 3979 tests) |

Two pre-existing tests (`lx9-final-transfer-recovery-canonical-progress.test.ts`, tests 15 and 17) needed updating — not because their underlying invariant changed, but because their literal source-text anchors (an exact `if (!r.ok) throw new Error` string, and a fixed 2200-char search window) no longer matched after the new canonical-mismatch branch was inserted ahead of the code they were locating. Both were updated to assert the same real invariant (a failed generation response never reaches `applyGenResult`; the generic-failure retry still calls `generateQuiz`) against the new, wider/restructured source shape.

**Verification, run on the implementation commit:**
```
npx tsc --noEmit   -> clean, 0 errors
npx vitest run     -> 234 test files, 3979 tests, all passed
npm run build       -> clean production build
```

---

## COMMITS

Implementation: `5f72a2e` — `fix(release-r1): remove ungated Practice fallback links; distinguish canonical-mismatch from generation failure`

This report: separate docs commit, immediately following.

Branch: `tmp/lx1` (git worktree only — never `origin/main`, nothing deployed, nothing pushed).
