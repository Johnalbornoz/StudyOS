# Phase 6+ Production Release Smoke Checklist

**Status:** MANDATORY for every Phase 6 and later change that reaches
`main` / production.

This is the canonical, repeatable release-verification protocol. It
exists because the Concept Detail HTTP 500 / React #441 incident
(`computeLearningVelocity` `Date` vs `string`) shipped to production
undetected: prior release steps recorded
`CONCEPT_DETAIL_VISUAL_SMOKE = NOT_RUN_AUTH`, and there was no certified
checklist requiring a safe authenticated read of that surface.

Every check below is **authenticated** where noted, strictly
**read-only**, and creates **no learner evidence**. Running it must not
change any student's state.

---

## Ground rules (do NOT do any of these while running this checklist)

- Do **NOT** click any learner evidence-producing CTA (Start / Practice /
  Verify / "Comprobar" / "Aplicarlo" / hint).
- Do **NOT** submit a quiz or any question.
- Do **NOT** record evidence via any API.
- Do **NOT** generate assessment attempts, remediation steps, or tutor
  turns that persist.
- Do **NOT** trigger `MissingConceptMemoryStateError` or deliberately
  break a dependency to exercise operational logging (that path is
  certified by unit tests, not in production).

---

## 1. Deployment provenance — `GET /api/version`

- Automatable **without** auth.
- Fetch `https://www.studyus.pro/api/version`.
- **Required:** `commitSha` == the exact SHA intended for this release.
- **Required:** `environment` == `"production"`.
- If `commitSha` has not caught up yet, wait and re-poll. Do not
  proceed to the authenticated checks until it matches.

## 2. Authenticated Today read — `/dashboard/today`

- Manual auth required (no safe shared read-only session is codified).
- Load `/dashboard/today` as an authenticated student with data.
- **Required:**
  - HTTP 200 and the page renders.
  - The "best next step" hero renders, and the prioritized plan list
    renders.
  - No server error and no browser console error.
  - No activity is started and no answer is submitted.

## 3. Authenticated Concept Detail read — `/dashboard/subjects/[subjectId]/concepts/[conceptId]`

- Manual auth required.
- Use a concept that **has evidence** where possible (so the full
  Digital Learning Twin panel is exercised, not the cold state).
- **Required:**
  - HTTP 200.
  - No React error #441 and no server 500.
  - The learner-twin panel renders (mastery, freshness / forgetting
    risk, independent mastery, dimensions, "why StudyUS thinks this").
  - The canonical next action renders where applicable.
  - No activity submission.

## 4. Authenticated Learning Debt read — `/dashboard/learning-debt`

- Manual auth required.
- Run where the student has debt / at-risk / error-pattern data.
- **Required:**
  - HTTP 200 and the page renders.
  - The "needs attention" / "at risk of forgetting" / "error patterns"
    sections render.
  - No evidence is created (the lazy debt re-resolution on this read is
    a pre-existing server-side side effect and is acceptable; do not
    add new ones).

## 5. Authenticated Subject read — `/dashboard/subjects/[subjectId]` (OPTIONAL)

- Manual auth required.
- **Check:** HTTP 200, the concept list renders.

## 6. Public shell health (OPTIONAL, automatable without auth)

- `GET /` and `GET /sign-in` return 200 / 307.
- `GET /dashboard/today` unauthenticated renders the "not
  authenticated" shell, **not** a 500.

---

## Cross-surface consistency

If Today and Concept Detail both surface a canonical next action **for
the same concept**, verify the two agree (same activity type / target).
They need not match when they refer to **different** concepts.

---

## Automation classification

| Check | Classification |
|---|---|
| `GET /api/version` exact SHA + environment | AUTOMATABLE WITHOUT AUTH |
| Public shell health (`/`, `/sign-in`, unauth `/dashboard/today`) | AUTOMATABLE WITHOUT AUTH |
| Today authenticated read | MANUAL AUTH REQUIRED |
| Concept Detail authenticated read | MANUAL AUTH REQUIRED |
| Learning Debt authenticated read | MANUAL AUTH REQUIRED |
| Subject authenticated read | MANUAL AUTH REQUIRED |

No test credentials are invented for CI. `tests/unit/release-smoke-checklist.test.ts`
only asserts that **this document exists and still names the mandatory
routes and rules** — it does not attempt authenticated smoke in CI.

---

## Sign-off record (fill in per release)

```
RELEASE_SHA          =
DATE (UTC)           =
/api/version         = PASS / FAIL
Today (auth)         = PASS / FAIL / NOT_RUN_AUTH
Concept Detail (auth)= PASS / FAIL / NOT_RUN_AUTH
Learning Debt (auth) = PASS / FAIL / NOT_RUN_AUTH
Subject (auth)       = PASS / FAIL / OPTIONAL_NOT_RUN
Public health        = PASS / FAIL
Operator             =
```
