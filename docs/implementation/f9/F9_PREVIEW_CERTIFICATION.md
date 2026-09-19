# F9 — Exam Readiness & Simulation — Preview Certification

Branch: `f9/exam-readiness-simulation` (pushed to `origin`)
Certified HEAD (pre-docs commit): `a7a1ad059974e78ce47475f3fd601a833862b1ce`
Date: 2026-09-19

Per task §56: this is the **OFFICIAL_F9_CERTIFICATION_PREVIEW** — the single, official certification deployment for the final F9 commit, corresponding to the certified commit above. No redundant intermediate Previews were created after each documentation commit.

## 1. Deployment record

| Field | Value |
|---|---|
| Deployment URL | `https://study-6vxgn67ep-study-so.vercel.app` |
| Deployment ID | `dpl_BSSkbJjmUZwz9tPFHFzdKSyLiuM5` |
| `target` | `null` (**Preview**, never Production) |
| `readyState` | `READY` |
| Vercel project | `study-os` (`prj_1JQCY5njzWdkXBDXgV05NHVahfyS`), scope `study-so` |
| Deploy command | `vercel deploy --non-interactive --scope study-so` (no `--prod`) |

`GET /api/version` returned `{"commitSha":null,"environment":"preview","buildTime":null}` — `environment: "preview"` confirmed live.

No Production environment variables were read, written, or referenced. No `--prod` flag was ever passed. No remote migration was ever applied (per task §57 — `REMOTE_MIGRATION: DEFERRED_TO_IVG`, `IVG-F9-02`).

## 2. Live smoke test — new F9 routes (must all deny anonymous access)

| Route | Method | Result |
|---|---|---|
| `/api/readiness/compute` | POST | 401 |
| `/api/readiness` | GET | 401 |
| `/api/readiness/[id]` | GET | 401 |
| `/api/simulation/eligibility` | GET | 401 |
| `/api/simulation/attempts` | POST | 401 |
| `/api/simulation/attempts/[id]` | GET | 401 |
| `/api/simulation/attempts/[id]/pause` | POST | 401 |
| `/api/simulation/attempts/[id]/resume` | POST | 401 |
| `/api/simulation/attempts/[id]/responses` | POST | 401 |
| `/api/simulation/attempts/[id]/complete` | POST | 401 |
| `/api/admin/readiness/policy` | GET | 401 |
| `/api/admin/readiness/score-conversion-models` | GET | 401 |

All 12: **PASS**.

## 3. Live smoke test — F0-S through F8 regression routes

| Route | Result | Interpretation |
|---|---|---|
| `/api/content/search` | 401 | Correct — F0-S auth gate intact |
| `/api/test` | 404 | Correct — F0-S containment (VERCEL_ENV set on any real deployment) |
| `/api/exam-profiles` | 401 | Correct — F7 auth gate intact |
| `/api/diagnostics` | 401 | Correct — F8 auth gate intact |
| `/api/teaching/interventions` | 401 | Correct — F8 auth gate intact |
| `/api/admin/assessment/exam-definitions` | 401 | Correct — F7 admin gate intact |
| `/api/admin/catalog/subjects` | 401 | Correct — F4/F6 admin gate intact |
| `/api/admin/learner-state/skill` | 401 | Correct — F5 admin gate intact |
| `/api/admin/curriculum/structures` | 401 | Correct — F6 admin gate intact |

All 9: **PASS** — each result matches the route's own pre-existing, unmodified behavior.

## 4. What was NOT smoke-tested against live Preview, and why

Authenticated accept-paths were not exercised against the live deployment — no mechanism exists in this environment to authenticate as a real Clerk user or admin against Preview. Registered as `IVG-F8-02`/`IVG-F8-03` (extended to cover F9's new routes) in `F9_IVG_DEFERRED_TEST_REGISTER.md`, not silently skipped.

## 5. Certification verdict

**PREVIEW CERTIFIED.** The F9 branch builds and deploys cleanly to a real Vercel Preview deployment, `target: null` throughout, `environment: "preview"` confirmed live, every new F9 route correctly rejects anonymous access, and every regression-checked route from F0-S through F8 behaves identically to its pre-F9 behavior on the live deployment.

This deployment is a Preview artifact only. It has not been, and per task §76 must not be, promoted to Production.
