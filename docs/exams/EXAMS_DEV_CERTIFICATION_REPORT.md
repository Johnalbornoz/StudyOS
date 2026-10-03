# Exams DEV certification report (Track B)

- **Base:** `2f94a1f2fba3bff10b04b933eacfde775be75672`. **Branch:** `track-b/exam-core-verticals`.
- **Implementation:** `fcc32eeb6335af271fd9037655de854999e92032`.
- **Certified SHA:** the commit that adds this report (documentation only on top of `fcc32ee`).
- **Hosted DEV candidate:** `https://study-5ia1gcokd-study-so.vercel.app`, `dpl_GnYqmZ63voUAhVbDuQwPfXGbCZp4`, target `dev`, `/api/version` reports `fcc32ee`, health OK.
  - The shared DEV alias was left on Track A's deployment. A `dev` deploy always moves it, so it was re-pointed to Track A's `245f6c9` about a second later.
- **Untouched:** main, develop, Preview, Production, Track A.

## Gates

| Gate | Result | Evidence |
|---|---|---|
| Migration | PASS | Final file `20261019_1000_track_b_exam_core_verticals.sql`; no `20261018` Track B file in the branch. DEV ledger: Track A `20261018_1000` ×1, Track B `20261019_1000` ×1, checksum equals the committed file; 42 applied, 0 pending, 0 drift. Ephemeral certification PASS. |
| Unit / typecheck / build | PASS | 6,602 / 6,602 unit tests (baseline 6,491); `tsc` clean; `next build` OK. |
| DEV functional + security harness | PASS | 203 / 203 on DEV (`track-b-exam-scenarios.ts`): each of the six verticals runs end to end; plus the security matrix, scoring, timing, integrity, evidence bridge, real-AI smoke and data-integrity checks. Fixtures were removed (0 left). |
| Real AI smoke | PASS | PAA pilot topic attempt: AI generation (9–13 s) → validated → delivered with no key → AI-graded (5–6 s) → one `EXAM_SIMULATION` evidence row on the owner's concept → result `NO_SCORING_POLICY` (the pilot has no policy). No provider failures and no fallbacks. |
| Hosted DEV, authenticated | PASS | Run as a signed-in DEV student in Chrome. Details below. |
| Mobile | PASS | 390 / 430 / 768 checked with same-origin iframes (Chrome's minimum window width is about 606 px); desktop at 1440. No horizontal overflow on Exam Prep, the attempt (timer, question strip, submit) or the result page. |
| Locales | PASS | es, en, de: exam strings render, no raw i18n keys. Language restored to es. |
| Dark mode | PASS | The stylesheet's dark tokens, applied to the live attempt: every exam element ≥ 4.5:1 (lowest 4.81). |
| Data integrity | PASS | No cross-student attempts, results or evidence. No orphan responses or results. No duplicate item responses or results. One open attempt per profile. No evidence from invalid responses. No open generation jobs. |

### Hosted DEV run

**PAA** (training timing):
- Profile created from the family-grouped catalog, showing year/session and the "no oficial" label.
- Started a full simulation: section 1/3, server timer, passage stimulus.
- Answered, autosaved ("Guardado"), reloaded: same attempt, same item, draft restored, clock continued.
- Tutor showed "Tienes una evaluación en curso" while the attempt was open.
- 10 items across 3 sections, including the configured break.
- Finalized: result 8.3% (section-weighted), raw 1/10, sections, strengths and gaps, the learning-state section kept separate, next step, item review.
- Tutor reopened after hand-in.

**ICFES** (official timing), as the configuration switch:
- No pause control; free order within a section (answered Q2 before Q1); break after Sociales.
- Result on the configured 0–100 fixture scale.

**Server-side checks:**
- Both attempts: 10/10 responses re-grade identically against the server-held keys; results reproducible from the frozen policy; items came from the approved bank; 0 evidence (fixture objectives are unmapped, by design).

**Security over real HTTP** (with a fixture Student B attempt):
- Every DENY held: 403 / 404 / 409 / 400.
- Student B's attempt was unchanged.
- Own result: 200.

All hosted fixtures were removed afterwards: 3 profiles, 3 attempts, their plans, results and snapshots, and Student B.

## Counters

- MIGRATIONS_REQUIRED = 1 (`20261019_1000`, additive). MIGRATIONS_PENDING = 0. CHECKSUM_DRIFT = 0.
- TESTS_PASSED = 6,805 / TESTS_TOTAL = 6,805: 6,602 unit + 203 DEV scenarios. The ephemeral migration certification also passed.

## Blockers, P2, P3

- **Blockers:** none.
- **P2:** none.
- **P3:**
  1. The exam-family DB CHECK is deferred until after merge (shared DEV with Track A). The taxonomy is enforced in the application.
  2. Starting two attempts at the same instant is guarded at the application layer only (an open attempt returns 409 `ATTEMPT_IN_PROGRESS`). A same-millisecond double start could still create two.
  3. Readiness "simulation performance" still averages raw response marks, not the policy-scored final value.
  4. A few shell controls measure 40 px, below the 44 px touch target. Light-mode `--text-muted` measures 4.48:1. Both are existing tokens.
  5. OFFICIAL_CONTENT_COVERAGE is NONE for all six verticals. Official specifications and items still need to be populated through configuration.
  6. A legacy, pre-Track-B ACTIVE attempt from 2026-09-29 exists on DEV. It is idle for more than 24 h, so it no longer restricts the Tutor.
  7. Admin pending-requests inbox does not show the requester's identity. This belongs to Track A / the shared base; a separate task was proposed.
