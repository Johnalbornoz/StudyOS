# STUDYUS — LX-6
## TODAY / NEXT BEST LEARNING ACTION

Branch: `tmp/lx1`
Implementation commit: `553125d`
Builds on: `ba58d08` (LX-4P-R3, last certified PASS phase).

LX-7 not started. Not pushed to `main`. Not deployed to production.
Performance certification remains deferred per this phase's own
instruction — LX-6 introduced no AI calls and no new hot-path queries.

---

### STATUS

**PASS**

---

### CURRENT TODAY AUDIT

`/dashboard/today` (`src/app/dashboard/today/page.tsx`) was already
**Today v3** — a mature, prior-certified (Step 6L-A / Closeout B / Phase
3E) implementation, not a legacy dashboard:

| Concern | Existing source |
|---|---|
| Cross-concept decision | `getLearningDecisions` (Phase 3C, `adaptive-learning-orchestrator.service.ts`) — read-only, documented as such |
| Priority ranking | `rankLearningDecisions` (Phase 3C, `adaptive-learning-policy.ts`) — deterministic band+modifier order |
| Execution fit / "what's next" | `buildDailyLearningPlan` / `selectExecutableNextAction` (Phase 3D, `learning-execution-policy.ts`) — pure, own docstring: *"NBA v3's sole source of 'what's next' -- no independent scoring"* |
| One-snapshot-per-render boundary | `getLearningOSSnapshot` (`learning-os-snapshot.service.ts`) |
| "Why this now" | `WhyThisV3` — `LearningFact[]` → learner sentence, no raw scores/risk numbers |
| CTA / badge copy | `activityLabel.ts` / `activityCta.ts` — pure `ActivityType → string` |
| Launch | `StartSessionButton` → `POST /api/learning/session/start` (server re-derives the decision, never trusts a client-held one) |
| Cold vs. consolidated | Step 6L-A's existing `learning_evidence` EXISTS check |
| Secondary "coming up" | `getLearningPlanHorizon` (8B/8F1, read-only 14-day glance, "Tu camino") |
| Retention framing | Closeout B's exact-2-site `activityType === 'RETENTION_CHECK'` eyebrow guard |

**What could remain:** all of the above — every one of them is already a
correct instance of "present, don't compute."

**What had to change:**
1. A snapshot **read failure** fell into the exact same branch as a
   genuinely caught-up student (`isEmpty`), and the (unguarded)
   cold-profile query could then throw a **second** time on top of an
   already-failing read — no real failure/UNRESOLVED state existed.
2. The hero's CTA had no `accessibleLabel` distinct from its badge text
   (every secondary `ItemRow` already had one).
3. The secondary "Today's Session" list re-rendered the hero's own item
   a second time (`dailyPlan.items[0] === nextExecutableItem`, by
   contract), duplicating it in the list below.
4. No "why this **kind** of action, now" sentence existed — `WhyThisV3`
   explains signal-level urgency ("an exam is close," "retention is
   due"), not the activity-type framing R6/R12–R15 ask for ("You've got
   the idea. Now put it into practice.").
5. No observability marks existed on this page at all.
6. Visually, the hero (icon + row) did not visually dominate the page
   the way the product objective requires — the session list, deferred
   list, and 6-item "Tu camino" list were all rendered at comparable
   visual weight.

**Reclassified, not deleted** (R25): the session list, deferred list,
and "Tu camino" all remain — demoted to a clearly secondary/tertiary
visual tier (smaller type, muted color, list rows instead of bordered
cards for "Tu camino," a horizontal rule separating it from the
canonical session).

---

### CANONICAL AUTHORITY

LX-6 added **zero** new decision authority. It consumes exactly the
`LearningOSSnapshot` (`decisions`, `dailyPlan`, `nextExecutableItem`,
`conceptLabels`) the page already fetched, plus the pre-existing
`isCold` check. `src/lib/lx/today-view.ts` and
`src/app/dashboard/activityNarrative.ts` are the only two new modules;
both are pure functions with no DB/fetch/heuristic (enforced by a
comment-stripped source-contract test).

### CROSS-CONCEPT SELECTION

**Already canonically defined.** `rankLearningDecisions` (Phase 3C) +
`buildDailyLearningPlan`/`selectExecutableNextAction` (Phase 3D) is a
real, tested, deterministic cross-concept ranking + time-fit authority —
not something LX-6 needed to invent, defer, or work around. No gap to
report here. This is the one finding that most directly answers R3's
central worry: the answer is "no gap," verified by reading the actual
implementation (`learning-execution-policy.ts`, `learning-execution-policy.test.ts`),
not assumed.

---

### TODAY CONTRACT

`src/lib/lx/today-view.ts`:

```ts
type TodayState = 'NEXT_ACTION_AVAILABLE' | 'CONSOLIDATED' | 'NO_ACTIVE_LEARNING_PATH' | 'UNRESOLVED';

interface TodayStateInputs {
  snapshotReadFailed: boolean;   // getLearningOSSnapshot itself threw
  hasPrimaryAction: boolean;     // selectExecutableNextAction(dailyPlan) !== null
  isColdProfile: boolean;        // the existing learning_evidence EXISTS check
}

function deriveTodayState(inputs: TodayStateInputs): TodayState {
  if (inputs.snapshotReadFailed) return 'UNRESOLVED';        // checked FIRST, unconditionally
  if (inputs.hasPrimaryAction) return 'NEXT_ACTION_AVAILABLE';
  return inputs.isColdProfile ? 'NO_ACTIVE_LEARNING_PATH' : 'CONSOLIDATED';
}
```

`PrimaryAction` is intentionally **not** re-typed: it is the existing
`LearningPlanItem` (`{ decision: LearningDecision, sequence,
estimatedMinutes, executionReason }`) the page already had as `best` —
introducing a parallel shape would either duplicate fields or require a
lossy re-projection for no benefit, and several existing certified tests
assert literal `decision.activityType`/`best.decision.activityType`
source patterns that a renamed/reshaped type would have broken for no
functional gain.

---

### PRIMARY ACTION

One dominant card: eyebrow label (`bestNextAction.title`) → optional
retention eyebrow → `<h2>` concept title (26px/700, was a 17px `<div>`)
→ subject/activity/minutes meta line → **narrative sentence** (new) →
`WhyThisV3` facts (kept, demoted below the narrative) → one primary CTA.
The circular "★" badge icon is gone (SaaS-badge feel R16 explicitly
warns against); the CTA now carries an explicit `accessibleLabel` and a
safe `launchMark` for observability.

### WHY THIS NOW

Two layers, deliberately distinct:
- **`activityNarrative(activityType, t)`** (new) — the R6/R12–R15
  activity-type framing: *"You've got the idea. Now put it into
  practice."* (PRACTICE) / *"No hints -- show you can do it on your
  own."* (SOLO_VERIFY/Prove) / *"You've shown you understand it. Now use
  it in a new situation."* (TRANSFER) / *"One more supported round
  before you move on."* (REMEDIATION) / *"Let's see what's still
  sticking."* (RETENTION_CHECK). Pure `ActivityType → string`, 10 types
  × 5 locales, no numbers, no thresholds.
- **`WhyThisV3`** (unchanged) — the specific signal-level reason
  (exam approaching, learning debt, misconception, …), still rendered
  beneath the narrative as supporting detail.

Neither is free-form/AI-generated; both are fixed lookups over
already-canonical fields.

### LEARN

There is no distinct `LEARN` `ActivityType` in the canonical taxonomy —
a first-touch concept routes through `PRACTICE` with `TeachingExperience`
stages (EXPLAIN/MODEL/GUIDE) resolved *inside* the Practice activity
(LX-4). `activityNarrative('PRACTICE', …)` is written to read naturally
for both "first touch" and "ongoing practice," since Today has no
canonical signal to distinguish the two without inventing one.

### PRACTICE

`activityCta.PRACTICE` = "Practice" (unchanged); narrative: *"You've got
the idea. Now put it into practice."*

### PROVE

Canonical `ActivityType` is `SOLO_VERIFY`. CTA unchanged ("Verify you've
got it"); narrative: *"No hints -- show you can do it on your own."* —
tested to never promise assistance, in any locale.

### RETAIN

Canonical `ActivityType` is `RETENTION_CHECK`. The exact-2-site
`activityType === 'RETENTION_CHECK'` eyebrow guard (hero + `ItemRow`,
Closeout B) is untouched; narrative: *"Let's see what's still
sticking."*

### TRANSFER

Narrative: *"You've shown you understand it. Now use it in a new
situation."* — distinct wording from `PRACTICE` in every locale
(tested), never "just another quiz."

### REINFORCE

Canonical `ActivityType` is `REMEDIATION`. Narrative: *"One more
supported round before you move on."* — framed as temporary (never a
permanent stage); `activityCta.REMEDIATION` = "Reinforce now" is
unchanged. Canonical continuation (unmodified by this phase) is what
returns the learner to the original journey afterward.

### CONSOLIDATED / NO ACTION

`CONSOLIDATED` (no primary action, not cold) and `NO_ACTIVE_LEARNING_PATH`
(no primary action, cold profile) map 1:1 onto the pre-existing
`today3.emptyTitle/emptyBody` and `today3.coldStateTitle/coldStateBody/coldStateCta`
copy — unchanged wording (already audited for no alarming language in
Step 6L-A), now reached through the explicit `todayState` branch instead
of an implicit `isEmpty`/`isCold` pair.

### UNRESOLVED

**New.** A genuine snapshot read failure (now caught explicitly, was
previously swallowed by `.catch(() => null)` and risked a second,
unguarded crash on the cold-profile query) renders its own card:
`today3.unresolvedTitle` / `unresolvedBody`, with exactly two actions —
**Retry** (a plain reload link to `/dashboard/today`, which re-reads
canonical truth) and **View My Path** (`/dashboard/study-plan`). No
`StartSessionButton`, no concept, no invented activity anywhere in this
branch (verified by source contract).

---

### LAUNCH INTEGRATION

Unchanged: `StartSessionButton` → `POST /api/learning/session/start`
with only `{ studentId, actionConceptId }` — the server re-derives the
Phase 4 decision and validates ownership itself; the client never
constructs a URL or trusts a client-held decision. The ONLY addition is
an optional `launchMark` prop that logs one safe `[perf]` line
(`label`, `t`, `conceptId`) immediately before `router.push`, gated on
the server's own `launchStatus === 'READY'` response — never before,
never on failure. Launching the same canonical decision from Today or
from Concept Mission/continuation hits the identical endpoint, so it
produces the identical activity.

---

### LANGUAGE

Unchanged: `getInterfaceLanguage(studentId)` governs all Today chrome
(title, narrative, WhyThis, CTAs). Today never reads or references an
activity/quiz language — the activity's own language contract (LX-4P-R3,
certified) takes over only once `StartSessionButton` navigates into the
launched activity.

---

### VISUAL TRANSFORMATION

- Hero: icon+row card → editorial stack, `<h2>` at 26px/700 (was a 17px
  `<div>`), narrative sentence added, generous vertical rhythm
  (`--space-6` padding, `--space-9` bottom margin).
- "Today's Session" / "Didn't Fit Today": heading demoted to 15px muted
  `--text-secondary`, subtitle to 12.5px, badge chips desaturated to
  `--text-muted`/`--bg-subtle`; the list starts at `items[1]` (no longer
  repeats the hero).
- "Tu camino": demoted to a small-caps 14px muted label, rows turned
  into a plain divided list (no `card` chrome, no colored left border)
  behind a `border-top` separator — an unmistakable step down from the
  hero, matching R9's "no wall of equal-weight cards."
- No grid was introduced anywhere (verified by source contract) — the
  page stays single-column, so the mobile hierarchy (hero first, above
  the fold) was never at risk of an added multi-column layout.

---

### OBSERVABILITY / PROVENANCE

`[today]` (server, this page) + `[perf]` (client, `StartSessionButton`)
lines, all safe metadata only (`activityType`, `conceptId`, `subjectId`,
`reasonCode`, `latencyMs`) — never facts, prompts, or answers:

| Mark | Where | Fires |
|---|---|---|
| `TODAY_REQUEST_STARTED` | server | render start |
| `TODAY_DECISION_READY` | server | after the snapshot read settles (success or failure), with `latencyMs` |
| `TODAY_PRIMARY_ACTION_RENDERED` | server | `todayState === 'NEXT_ACTION_AVAILABLE'`, carries `activityType`/`conceptId`/`subjectId`/`reasonCode` |
| `TODAY_UNRESOLVED` + `TODAY_FAILED` | server | `todayState === 'UNRESOLVED'` |
| `TODAY_PRIMARY_ACTION_LAUNCHED` | client (`StartSessionButton`) | right before `router.push`, only on a confirmed `READY` launch |

`LearningDecision.reasonCode`/`activityType`/`actionConceptId`/`subjectId`
are already carried on the canonical decision object, so the Today →
Learning Decision → Learning State → Knowledge State → Evidence trace
provenance is intact and available to a later Decision Trace UI without
any additional plumbing.

---

### EVIDENCE INTEGRITY

No write was added anywhere. `today/page.tsx` performs exactly the same
one `SELECT EXISTS (... learning_evidence ...)` it did before (now
correctly skipped when the primary read already failed, and wrapped so
it can never crash the page); `getLearningOSSnapshot`/`getLearningDecisions`
remain documented read-only authorities; `StartSessionButton` only ever
`POST`s to `session/start` (never `generate-and-take`, never a grade/
submit endpoint). Opening Today or clicking the CTA writes nothing;
evidence begins only once the launched activity is actually performed.

---

### TESTS

`npx tsc --noEmit` clean · `npx vitest run` **197 files / 2998 tests
pass** · `npm run build` compiles (`/dashboard/today` registered,
dynamic).

New: `tests/unit/lx6-today-next-best-action.test.ts` (32 cases). All
pre-existing today-adjacent suites remain green and unmodified:
`6l-a-learning-experience`, `closeout-b-retention-action`,
`phase-3e-legacy-authority`, `phase-3e-closed-loop`,
`learning-os-snapshot`, `learning-execution-policy` (86 cases).

| # | Requirement | Covered by |
|---|---|---|
| 1–5 | LEARN/PRACTICE/PROVE/RETAIN/TRANSFER render the right action | `activityNarrative` per-type tests; existing `activityCta`/`activityLabel` tests (untouched, still green) |
| 6 | REINFORCE temporary framing | `todayNarrative.REMEDIATION` wording test |
| 7 | CONSOLIDATED, no fake work | unchanged `today3.emptyTitle/emptyBody`, Step 6L-A "no alarming language" test still green |
| 8 | UNRESOLVED, no invented recommendation | "UNRESOLVED never invents a fallback action" (no `StartSessionButton`/`actionConceptId` in that branch) |
| 9–10 | canonical `launchTarget`, same activity from Today/Concept Mission | `StartSessionButton` body/endpoint assertions (both callers, unchanged) |
| 11–12 | no evidence write on load or launch | R21 describe block |
| 13–15 | no client mastery/SupportLevel/ActivityType logic | R22 describe block + pre-existing 6l-a assertions (still green) |
| 16–17 | reasonCode → explanation, unknown degrades safely | `WhyThisV3`'s existing `default: ''` fallback (untouched); `activityNarrative` always returns a string for every canonical type |
| 18–19 | interface language governs Today; activity language unaffected | R8 describe block |
| 20–22 | Prove/Retention/Transfer framing distinctness | R6/R12–R15 describe block |
| 23 | failure → Retry/My Path | R23 describe block |
| 24–25 | mobile hierarchy / accessibility | R16-18 describe block (no grid; real `<h2>`; `accessibleLabel`) |
| 26 | no learner content in observability | R19 describe block |
| 27–30 | LX-5 continuation / R1F / R1G / evidence contracts unchanged | regression-guard describe block + full suite green |

---

### COMMIT

`553125d` on `tmp/lx1` (after `ba58d08`).

---

### SCREENSHOTS / VISUAL NOTES

No live screenshot in this environment — `/dashboard/today` requires an
authenticated Clerk session and a populated Postgres database, neither
of which is available here (the same constraint every prior live-only
phase in this project has stated). Visual verification is source-level
only (tsc/vitest/build green, exact JSX/style review above). The next
step before considering the redesign itself verified is a real render in
Preview with a logged-in student.

---

Do NOT push to `main`. Do NOT start LX-7.

STOP.
