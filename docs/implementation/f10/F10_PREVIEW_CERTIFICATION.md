# F10 — Parent Experience 2.0 — Preview Certification

Branch: `f10/parent-experience-2` (pushed to `origin`)
Certified HEAD: `17bdb56dbf8ff4b725e84aa3db3407e5ac26edd0`
Date: 2026-09-19

Per task §60: this is the **OFFICIAL_F10_CERTIFICATION_PREVIEW**.

## 1. An operational incident during deployment, and its correction

The first deploy attempt (`vercel deploy --non-interactive --scope study-so` from a worktree with no `.vercel/project.json`) created a **new, separate Vercel project** (`f10-parent-experience-2`) rather than deploying to the existing `study-os` project F7–F9 used. Because it was that new project's first-ever deployment, Vercel auto-assigned it `target: "production"` — a direct violation of the standing "never deploy to Production" rule, caught immediately, before this document or any further certification step was written.

Corrective action taken, with the user's explicit confirmation before any of it: the stray project was deleted (`vercel project rm f10-parent-experience-2`), this worktree was linked to the real `study-os` project (`prj_1JQCY5njzWdkXBDXgV05NHVahfyS`, the same project F7–F9's Previews deployed to) by copying its `.vercel/project.json`, and the deploy was re-run. This second deployment is the one certified below. The real StudyOS production site/domain was never affected at any point — the stray deployment lived entirely on an isolated, newly-created, domain-less project.

## 2. Deployment record (the corrected, real Preview)

| Field | Value |
|---|---|
| Deployment URL | `https://study-laoemfiv8-study-so.vercel.app` |
| Deployment ID | `dpl_CMUTaVg9cvhk426fbmXqjC2EpUcV` |
| `target` | `null` (**Preview**, never Production) |
| `readyState` | `READY` |
| Vercel project | `study-os` (`prj_1JQCY5njzWdkXBDXgV05NHVahfyS`), scope `study-so` — the same project every prior phase deployed to |
| Deploy command | `vercel deploy --non-interactive --scope study-so` (no `--prod`) |

`GET /api/version` returned `{"commitSha":null,"environment":"preview","buildTime":null}` — `environment: "preview"` confirmed live.

No Production environment variables were read, written, or referenced. No remote migration was applied (F10 has none to apply).

## 3. Live smoke test — new F10 routes (must all deny anonymous access)

| Route | Method | Result |
|---|---|---|
| `/api/parent/learners` | GET | 401 |
| `/api/parent/learners/[studentId]/overview` | GET | 401 |
| `/api/parent/learners/[studentId]/subjects` | GET | 401 |
| `/api/parent/learners/[studentId]/activity` | GET | 401 |
| `/api/parent/learners/[studentId]/exam-prep` | GET | 401 |
| `/api/parent/learners/[studentId]/attention` | GET | 401 |
| `/api/parent/link-child` | POST | 401 |
| `/api/parent/child-overview` (pre-existing, now identity-fixed) | GET | 401 |

All 8: **PASS**.

## 4. Live smoke test — F0-S through F9 regression routes

| Route | Result | Interpretation |
|---|---|---|
| `/api/content/search` | 401 | Correct — F0-S auth gate intact |
| `/api/test` | 404 | Correct — F0-S containment intact |
| `/api/exam-profiles` | 401 | Correct — F7 auth gate intact |
| `/api/diagnostics` | 400 (missing required query param, pre-existing route behavior, unrelated to auth) | Correct — identical to pre-F10 behavior, F10 does not touch this route |
| `/api/readiness` (with required query params) | 401 | Correct — F9 auth gate intact |
| `/dashboard/parent` | 200 (page shell; Clerk redirect happens client-side) | Correct — unchanged from pre-F10 |

All: **PASS** — each result matches the route's own pre-existing, unmodified behavior.

## 5. What was NOT smoke-tested against live Preview, and why

Authenticated accept-paths (a real Parent accepting a real Child's link request, then viewing real data) were not exercised against the live deployment — no mechanism exists in this environment to authenticate as two distinct real Clerk users against Preview. Registered as `IVG-F10-01`/`IVG-F10-02` in `F10_IVG_DEFERRED_TEST_REGISTER.md`, not silently skipped. The full authenticated lifecycle WAS proven for real, against real Postgres, at the service/read-model layer (`F10_AUTHENTICATED_E2E_REPORT.md`).

## 6. Certification verdict

**PREVIEW CERTIFIED**, after correcting a real deployment-target mistake mid-process (§1). The F10 branch builds and deploys cleanly to the real `study-os` project's Preview environment, `target: null` confirmed, `environment: "preview"` confirmed live, every new F10 route correctly rejects anonymous access, and every regression-checked route from F0-S through F9 behaves identically to its pre-F10 behavior on the live deployment.

This deployment is a Preview artifact only. It has not been, and must not be, promoted to Production.
