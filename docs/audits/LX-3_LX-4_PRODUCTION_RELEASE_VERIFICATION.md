# STUDYUS — LX-3 + LX-4 PRODUCTION DEPLOY & VERIFICATION

> **Bottom line up front.** P0 (baseline audit) and P1 (pre-deploy
> validation) are **complete and clean**. **P2 (the actual deploy) and
> P3–P14 (authenticated end-to-end production verification) were NOT
> executed** — this environment cannot run the Vercel deploy, and cannot
> establish a real authenticated Clerk session / dedicated test learner
> to drive the flows against authenticated production (the same
> limitation documented in every LX phase since LX-2P). No change was
> pushed to `origin/main`. The release is a **validated candidate**, not
> a verified production release.

---

## 1. Release Baseline (P0)

| Item | Value |
|---|---|
| **Production baseline** | `origin/main` = **`5a2d0b7b0b6b14f928f3e5394cb12feccb205fd4`** ("feat(orchestration): measure 14-day learning progress") |
| **Deployment target** | Vercel project `study-os` (`prj_1JQCY5njzWdkXBDXgV05NHVahfyS`, team `team_VS9MsaoNNCt3zZc8PjPyTGga`), Git-integrated to `github.com/Johnalbornoz/StudyOS` branch `main` — production tracks `main`. No `vercel.json`/`vercel.ts`, no GitHub Actions workflow. |
| **Approved LX HEAD** | **`3b56ca6`** ("feat(lx): LX-4R teaching loop completion (R1-R9)") on worktree branch `tmp/lx1` |
| Worktree HEAD | `e4b6c4e` — one commit past `3b56ca6`, **docs-only** (`docs/audits/LX-4R_TEACHING_LOOP_COMPLETION.md`, +520 lines). `git diff --stat 3b56ca6 e4b6c4e` = that one file. Validation below was run at `e4b6c4e` and is byte-equivalent to `3b56ca6` for tsc/tests/build. |
| **Required release range** | **`5a2d0b7..3b56ca6` — 11 commits, a clean linear fast-forward** (`git merge-base 5a2d0b7 3b56ca6` == `5a2d0b7`). Optionally include `e4b6c4e` (the 12th, docs-only). |
| Not already in production | The **entire LX-1 → LX-4R stack.** Production is at the pre-LX Phase-8 orchestration HEAD; it contains **none** of LX-1/LX-1R, LX-2/LX-2P, LX-3/LX-3R, LX-4/LX-4R. |
| Cherry-pick risk | N/A — the range is contiguous and starts exactly at the production HEAD. LX-3/LX-4 cannot be released without LX-1 (contracts) and LX-2 (LearnerShell / focus-mode seam / first-destination) — the fast-forward carries all of it. |

### Release commit list (`5a2d0b7..3b56ca6`)
```
3b56ca6 feat(lx): LX-4R teaching loop completion (R1-R9)
5059cfa docs(lx): LX-4 teaching & active learning report + certification
e36dccb feat(lx): LX-4 teaching & active learning (Focus Mode, Response Contract runtime, evidence difficulty)
09cc450 docs(lx): LX-3R canonical state boundary repair report + certification
dc3f2ab fix(lx): LX-3R canonical state boundary repair
af93f60 docs(lx): LX-3 Concept Mission report + certification
e7f3816 feat(lx): LX-3 Concept Mission
c0d06cf docs(lx): LX-2P authenticated UX & responsive verification report
da9f9cf fix(lx): LX-2P authenticated shell focus trap + marketing header responsive
3ad94e6 feat(lx): LX-2 entry experience & responsive learner shell
95c6fe1 feat(lx): LX-1 + LX-1R canonical learning & evidence contracts (dormant)
```

### Working tree
- **`tmp/lx1` worktree: clean** (`git status --porcelain` empty at `e4b6c4e`).
- **Primary repo `/Users/jalbornoz/PROYECTOS/studyos`: DIRTY, but unrelated to this release.** Its local `main` is a stale pointer (`fb27dc4`, `[origin/main: behind 24]` — an old local branch, *not* what production runs). Its working tree carries pre-existing, pre-session local edits (`M src/app/dashboard/quiz/page.tsx`, `M src/lib/i18n/messages.ts`), an untracked `src/app/dashboard/quiz/quiz-answer-guards.ts` + test, and ~20 untracked `docs/audits/STUDYUS_PHASE_*.md` files. **None of these are on `tmp/lx1`; none would be released by a fast-forward of `main` to `3b56ca6`.** They belong to unrelated earlier workstreams ("Step 28" / prior phase docs) and are outside this release's scope — left untouched.

### Schema / config (verified, not assumed) — `git diff 5a2d0b7..3b56ca6`
| Check | Result |
|---|---|
| DB migration / `.sql` / schema file | **NONE** — `git diff --name-only` matched no `migration`/`.sql`/`schema` path |
| `package.json` / `package-lock.json` / dependency | **NONE changed** — no new npm dependency |
| `.env*` / new environment variable | **NONE** — no `.env*`, `next.config`, `tsconfig` change; no code path reads a new env var (the new AI calls reuse the existing `@/lib/ai` provider config, same as `concept-explanation.service` / `quiz-generation.service`) |
| New Vercel config | **NONE** |

The LX reports' "no schema change" claim is **verified**.

### Canonical boundaries — verified intact
`git diff --name-only 5a2d0b7..3b56ca6` matched **NONE** of:
`mastery.service.ts` · `adaptive-learning-policy.ts` · `adaptive-teaching-policy.ts`
· `knowledge-state.service.ts` · `activity-taxonomy.ts` · `active-evidence-guard.service.ts`
· `ai-permission-policy.ts` · `assessment-verification.service.ts` · `validation-cycle.service.ts`.

`ADAPTIVE_LEARNING_POLICY_VERSION` still 3 · `ADAPTIVE_TEACHING_POLICY_VERSION`
still 1 (asserted by `phase-5-r-release-checklist.test.ts`, in the pass set).

### Changed surfaces in the release
- **New API routes (3):** `POST /api/learning/contextual-help`, `POST /api/learning/guided-practice`, `GET /api/learning/teaching-intent` — all `verifyAuth` + `verifyStudentAccess` gated; the two AI ones additionally `canUseAI`-gated.
- **Modified API route (1):** `POST /api/quizzes/generate-and-take` — additive only (R5 send `expectedReasoningType`; R6 pass `errorType`/`reasoningValid`; R7 `proveSufficiency`; R8 `countAuthority` + canonical count; LX-4 `applyResponseContractGuard` + `aggregateEvidenceDifficulty`). The `updateMastery` call is unchanged.
- **Changed learner routes:** `/` , `/[locale]`, `/[locale]/how-it-works`, `/sign-up`, `/dashboard` (layout + Progress page), `/dashboard/onboarding` (new), `/dashboard/subjects/new`, `/dashboard/subjects/[id]/concepts/[conceptId]`, `/dashboard/quiz`.
- **AI prompt registry:** one new entry — `learning.guided_practice` v1 (`teaching-content.service.ts`). No existing prompt id/version changed.
- **Evidence-writing path:** `generate-and-take` now writes `learning_evidence.difficulty = aggregateEvidenceDifficulty(actual question difficulties)` instead of the hardcoded `3`; `mastery.service.ts` (the sole writer) is **not modified**.

### STOP CONDITIONS — status
| Condition | Status |
|---|---|
| tests fail | **clear** — 2545/2545 pass |
| build fails | **clear** — compiled OK, 94/94 pages |
| required production secrets/config clearly missing | **for deploy:** the Vercel deploy path itself (CLI / MCP token) is unavailable *to this session* — see P2. **for verification:** a dedicated test-learner credential and AI-provider confirmation access are missing — see P3–P14. |
| branch has unrelated unreviewed changes | **clear** — `5a2d0b7..3b56ca6` is LX-1→LX-4R only, every commit certified |
| merge/rebase introduces conflicts | **clear** — clean fast-forward, no rebase needed |
| production baseline cannot be determined safely | **clear** — baseline is `5a2d0b7`, unambiguous |

---

## 2. Pre-Deploy Validation (P1) — at `3b56ca6` (via `e4b6c4e`, docs-only delta)

| Gate | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | **clean** (exit 0) |
| Unit tests | `npx vitest run` | **175 files · 2545 tests · 2545 passed · 0 failed** (3.37s) |
| Build | `npm run build` | **compiled successfully in ~0.77s · 94/94 static pages generated · 0 errors · 0 warnings** |

Diff-vs-production review (§1) confirms: additive routes, additive
generation tag, additive evidence-difficulty accuracy fix, no engine /
policy-version / schema / dependency / env change, canonical boundaries
intact.

**P1: PASS.**

---

## 3. Deployment (P2) — NOT EXECUTED

**Established process:** Vercel Git integration — a push/merge to
`github.com/Johnalbornoz/StudyOS` `main` triggers a Vercel **production**
build+deploy of project `study-os`.

**Why not executed here:**
1. **No deploy tooling in this session.** `vercel` CLI is not installed;
   the Vercel MCP and Neon MCP require OAuth that cannot be completed in
   a non-interactive session (system-confirmed). I cannot trigger,
   monitor, roll back, or read the logs of a Vercel deploy.
2. **Pushing to `origin/main` is a production-affecting, hard-to-reverse
   action against real learners.** Doing it while unable to perform
   *any* of the mandated post-deploy verification (P3–P14) would
   directly violate this phase's core rule — *"Do not call the release
   successful solely because the hosting platform reports green.
   Proceed to application verification."* — and leave a regression
   undetectable and un-rollback-able from here.

**The release is ready.** For a maintainer with repo push access and the
Vercel project, the deploy is:

```bash
# from a clean checkout of github.com/Johnalbornoz/StudyOS
git fetch origin
git checkout main                       # currently at 5a2d0b7
git merge --ff-only 3b56ca6             # fast-forward; add e4b6c4e too for the LX-4R report doc
git push origin main                    # Vercel builds + deploys production
```

(Or open a PR `5a2d0b7…3b56ca6` → `main`, review, merge — Vercel builds a
preview per commit and production on merge.)

**Released commit: — (none).  Deployment identifier: — .  Status: NOT DEPLOYED.**

---

## 4–18. Authenticated Production Verification (P3–P14) — NOT EXECUTED

Every one of P3–P14 requires **real authentication as a dedicated test
learner** and **real browser interaction against the authenticated
deployed app**, plus (P5–P9) **real configured-AI-provider execution**
and (P14) **production log access**.

This environment cannot do any of that:
- The Clerk browser SDK hangs in the hidden Browser pane; a
  server-minted `__session` JWT is rejected by Clerk's Next middleware
  (documented in LX-2P, LX-3, LX-3R, LX-4, LX-4R). There is no way to
  obtain a usable authenticated session here.
- No dedicated test-learner credentials were provided.
- No AI provider keys / no way to confirm the configured provider
  executes in production.
- No Vercel/Neon access for production logs, deploy status, or DB
  inspection of the resulting canonical evidence.

Consequently **P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14 were
not performed.** Nothing about the *deployed* application — entry
routing, Concept Mission hierarchy in prod, the teach-first flow with a
live `TeachingIntent`, real Concept-Explanation retrieval, real
`POST /api/learning/guided-practice` AI execution + the "writes NO
evidence" check, contextual-help + the INDEPENDENT-mode server-rejection
check, the generator→contract→UI→grader `expectedReasoningType`
round-trip, the ANSWER-ONLY-without-work regression **in production**,
error→teaching→retry with a fresh session identity, Prove independence +
canonical sufficiency re-read, `countAuthority` on a real PRACTICE
session, evidence integrity (assisted vs guided-none vs additive-retry
vs independent, difficulty ≠ constant `3`), 375/768/1440 production
screenshots, the visual release gate, keyboard/AT checks, or the
production log review — **could be verified.**

### What IS verified (from LX-1…LX-4R, not from deployed production)
- Full unit certification of every contract and flow (2545 tests).
- HARNESS verification at 375/768/1440 of the Concept Mission,
  Focus Mode chrome, and the teach-first surfaces (faithful markup +
  real CSS + real i18n).
- The new routes SSR / mount correctly (`200` for `/dashboard/quiz` in
  Focus Mode; `401`/`405` for the API routes on the wrong method) in the
  local worktree dev server.
- The ANSWER-ONLY-without-work regression: UNIT
  (`lx4-response-contract-grading.test.ts`).

---

## 19. Fixes Made During Release
**None.** No production defect was found (none could be looked for —
P3–P14 not run). No release fix commit was needed. Nothing was pushed.

---

## 20. Remaining Production Conditions

1. **The deploy itself** — a maintainer must fast-forward `main` to
   `3b56ca6` (+`e4b6c4e`) and push, or merge the PR. §3 has the exact
   commands.
2. **P3–P14 authenticated end-to-end verification on the deployed app**
   with a dedicated test learner — the substantive purpose of this
   phase — remains **entirely outstanding**. It must be run by a human
   (or a session with real Clerk auth + a test learner + AI keys +
   Vercel log access) before the release can be certified.
3. **P5/P7 real-AI checks** — Concept Explanation generation,
   `guided-practice` generation, and `expectedReasoningType` in a real
   generated batch — must be confirmed against the configured provider,
   not cache/harness.
4. **P14 log review** — after the test flow, inspect Vercel/Neon logs
   for 5xx, AI-provider failures, malformed `guided-practice` payloads,
   unauthorized help leaks, evidence-write failures, duplicate
   `operation_key`, failed KS recalculation, missing i18n keys, client
   exceptions.

---

# LX-3 + LX-4 — PRODUCTION RELEASE & VERIFICATION CERTIFICATION

## RELEASED COMMIT
**None.** Nothing was deployed. Approved release candidate: `3b56ca6`
(clean fast-forward from the production baseline `5a2d0b7`; +`e4b6c4e`
docs-only).

## STATUS
**FAIL**

Not a failure of the code or the release range — P0 and P1 are clean and
the fast-forward is safe — but this phase's mandate (deploy the LX stack
and verify the real learner experience end-to-end with authentication, a
test learner, real AI, and real browser interaction) **was not
carried out**: this environment cannot execute the Vercel deploy and
cannot authenticate against the deployed application. A production
release cannot be certified without that verification.

## LEARNING EXPERIENCE
**Did `Concept Mission → Teaching → Worked Example → Guided Practice →
Practice → Error Teaching → Retry → Prove` work in the deployed
application?**  —  **Not tested.** No authenticated access to a deployed
build. The flow is unit-certified and HARNESS-verified (LX-3…LX-4R); it
has **not** been run end-to-end in production.

## AI TEACHING PATHS
**Verified with the real configured provider: none.** Concept
Explanation retrieval/generation, `POST /api/learning/guided-practice`,
and `expectedReasoningType` generation were exercised only via unit
tests and a faithful harness. No production AI execution was observed.

## RESPONSE CONTRACT
**Final-answer-without-work regression:** UNIT PASS
(`applyResponseContractGuard` — a correct `ANSWER_ONLY` final answer is
never docked for absent work; `SHOW_WORK`/`EXPLAIN`/`JUSTIFY`
untouched). **Not run end-to-end in production** — the generator→
contract→UI→grader round trip with a real generated `expectedReasoningType`
was not observed.

## EVIDENCE INTEGRITY
**Not inspected in production.** By construction (code + unit review):
Practice writes assisted evidence (`learningMode: COACH`); Guided
Practice writes **no** evidence (`teaching-content.service` takes no
evidence inputs and the route calls no evidence function); Retry mints a
new `quizId` so evidence is additive and idempotency-safe
(`operation_key = (QUIZ_SUBMISSION, quizId, conceptId)`); Prove writes
independent evidence (`SOLO`); `learning_evidence.difficulty` =
`aggregateEvidenceDifficulty(actual question difficulties)`, not `3`.
**None of this was verified against real rows for a test learner.**

## VISUAL TRANSFORMATION
**Does deployed StudyUS now visibly feel like a teaching environment
rather than primarily a quiz/dashboard product?**  —  **Cannot answer
from production.** No deployed build, no production screenshots. From
HARNESS evidence (LX-3…LX-4R) the answer would be **YES**, but this gate
requires actual production screenshots and is therefore **not passed**.

## PRODUCTION DEFECTS
**None found — and none could be looked for.** P3–P14 were not executed.

## CONDITIONS
1. Deploy `main` → `3b56ca6` (+`e4b6c4e`) via the Vercel Git integration
   (§3 commands) — requires repo push access + the Vercel project.
2. Execute P3–P14 authenticated end-to-end verification on the deployed
   app with a dedicated test learner, real AI provider, and Vercel/Neon
   log access.
3. Re-certify this phase on the basis of that verification before any
   `LX-5` work begins.

## NEXT PHASE
**Blocked.** The production release is **not** safe-and-verified. Do
**not** proceed to `LX-5 — Learning Continuation`. The immediate next
step is a human-run **deploy of `3b56ca6` + P3–P14 verification on the
deployed application**, then re-certification of this phase.

STOP.
