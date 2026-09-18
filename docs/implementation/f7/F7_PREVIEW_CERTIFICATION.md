# F7 — Assessment Framework Engine — Preview Certification

Branch: `f7/assessment-framework-engine` (pushed to `origin`)
HEAD: `0b31e6021aa9e1099ea4a66bbc8459a2b10f379e`
Date: 2026-09-18

## 1. Deployment record

| Field | Value |
|---|---|
| Deployment URL | `https://study-r4mpb1tjq-study-so.vercel.app` |
| Deployment ID | `dpl_Emy8taZbRwQmCCnqdeXd4MWbZgZj` |
| `target` | `null` (**Preview**, never Production) |
| `readyState` | `READY` |
| Vercel project | `study-os` (`prj_1JQCY5njzWdkXBDXgV05NHVahfyS`), scope `study-so` |
| Deploy command | `vercel deploy --non-interactive --scope study-so` (no `--prod`) |

`GET /api/version` on the live deployment returned:
```json
{"commitSha":null,"environment":"preview","buildTime":null}
```
`environment: "preview"` confirms this is running against Preview configuration, not Production.

No Production environment variables were read, written, or referenced at any point in this phase. No `--prod` flag was ever passed to `vercel deploy`.

## 2. Live smoke test — new F7 routes (must all deny anonymous access)

| Route | Method | Result | Expected |
|---|---|---|---|
| `/api/admin/assessment/exam-definitions` | GET | 401 | 401 |
| `/api/admin/assessment/exam-definitions` | POST | 401 | 401 |
| `/api/admin/assessment/exam-versions` | GET | 401 | 401 |
| `/api/admin/assessment/full-mock-guard` | GET | 401 | 401 |
| `/api/admin/assessment/institution-policies` | GET | 401 | 401 |
| `/api/exam-profiles` | GET | 401 | 401 |

All 6 checks: **PASS**. No F7 route leaks data or accepts a write from an anonymous caller on the real deployed Preview environment.

## 3. Live smoke test — F0-S through F6 regression routes

| Route | Result | Interpretation |
|---|---|---|
| `/api/content/search` | 401 | Correct — F0-S auth gate intact |
| `/api/test` | 404 | Correct — F0-S containment: this diagnostic route deliberately 404s whenever `VERCEL_ENV` is set (true on any real Vercel deployment, Preview included); it only responds inside `next dev` |
| `/api/billing/subscription` | 400 `INVALID_INPUT` | Correct — F3 route validates the required `studentId` query param before touching auth; no `studentId` was supplied in this smoke probe |
| `/api/admin/catalog/subjects` | 401 | Correct — F4 admin gate intact |
| `/api/admin/learner-state/skill` | 401 | Correct — F5 admin gate intact |
| `/api/admin/curriculum/structures` | 401 | Correct — F6 admin gate intact |

All 6 checks: **PASS** (each result matches the route's own pre-existing, unmodified behavior — F7 introduced zero observable change to any prior-phase route on the live deployment).

## 4. Certification verdict

**PREVIEW CERTIFIED.** The F7 branch builds and deploys cleanly to a real Vercel Preview deployment, `target: null` throughout, `environment: "preview"` confirmed live, every new F7 route correctly rejects anonymous access, and every regression-checked route from F0-S through F6 behaves identically to its pre-F7 behavior on the live deployment.

This deployment is a Preview artifact only. It has not been, and per task §52 must not be, promoted to Production.
