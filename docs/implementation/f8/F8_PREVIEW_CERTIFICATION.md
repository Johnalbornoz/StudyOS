# F8 — Framework-Aware Teaching & Exam Skills — Preview Certification

Branch: `f8/framework-aware-teaching-exam-skills` (pushed to `origin`)
Certified HEAD (pre-docs commit): `09a74628d08dfb5e29e6a568a9a459c170f20879`
Date: 2026-09-18

Per task §53: this is the single, official certification deployment for the final F8 commit — no redundant intermediate Previews were created after each documentation commit.

## 1. Deployment record

| Field | Value |
|---|---|
| Deployment URL | `https://study-1nc26e3es-study-so.vercel.app` |
| Deployment ID | `dpl_6ttoAMyJRz8T9jJF7q24MsiYy2HT` |
| `target` | `null` (**Preview**, never Production) |
| `readyState` | `READY` |
| Vercel project | `study-os` (`prj_1JQCY5njzWdkXBDXgV05NHVahfyS`), scope `study-so` |
| Deploy command | `vercel deploy --non-interactive --scope study-so` (no `--prod`) |

`GET /api/version` returned `{"commitSha":null,"environment":"preview","buildTime":null}` — `environment: "preview"` confirmed live.

No Production environment variables were read, written, or referenced. No `--prod` flag was ever passed.

## 2. Live smoke test — new F8 routes (must all deny anonymous access)

| Route | Method | Result |
|---|---|---|
| `/api/diagnostics/run` | POST | 401 |
| `/api/diagnostics` | GET | 401 |
| `/api/diagnostics/[id]/explain` | GET | 401 |
| `/api/teaching/interventions` | POST | 401 |
| `/api/teaching/interventions/[id]` | GET | 401 |
| `/api/teaching/interventions/[id]/attempts` | POST | 401 |
| `/api/admin/diagnostics/policy` | GET | 401 |
| `/api/admin/teaching/intervention-policy` | GET | 401 |
| `/api/admin/teaching/command-term-interpretations` | GET | 401 |
| `/api/admin/teaching/command-term-interpretations/activate` | POST | 401 |

All 10: **PASS**.

## 3. Live smoke test — F0-S through F7 regression routes

| Route | Result | Interpretation |
|---|---|---|
| `/api/content/search` | 401 | Correct — F0-S auth gate intact |
| `/api/test` | 404 | Correct — F0-S containment (VERCEL_ENV set on any real deployment) |
| `/api/exam-profiles` | 401 | Correct — F7 auth gate intact |
| `/api/admin/assessment/exam-definitions` | 401 | Correct — F7 admin gate intact |
| `/api/admin/catalog/subjects` | 401 | Correct — F4/F6 admin gate intact |
| `/api/admin/learner-state/skill` | 401 | Correct — F5 admin gate intact |
| `/api/admin/curriculum/structures` | 401 | Correct — F6 admin gate intact |

All 7: **PASS** — each result matches the route's own pre-existing, unmodified behavior.

## 4. What was NOT smoke-tested against live Preview, and why

Authenticated accept-paths (a real diagnosis run, a real intervention session, a real admin policy creation) were not exercised against the live deployment — no mechanism exists in this environment to authenticate as a real Clerk user or admin against Preview. This is registered as `IVG-F8-02`/`IVG-F8-03` in `F8_IVG_DEFERRED_TEST_REGISTER.md`, not silently skipped.

## 5. Certification verdict

**PREVIEW CERTIFIED.** The F8 branch builds and deploys cleanly to a real Vercel Preview deployment, `target: null` throughout, `environment: "preview"` confirmed live, every new F8 route correctly rejects anonymous access, and every regression-checked route from F0-S through F7 behaves identically to its pre-F8 behavior on the live deployment.

This deployment is a Preview artifact only. It has not been, and per task §61 must not be, promoted to Production.
