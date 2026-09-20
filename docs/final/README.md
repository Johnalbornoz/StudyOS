# StudyUS — Final Documentation Package

**Purpose**: a self-sufficient reference for engineering, product, operations, security, and audit — readable without access to any AI assistant's chat history. Everything here describes the **real, currently-deployed system**, not an idealized target architecture. Where the target and the real state differ, both are stated explicitly.

**As of**: 2026-09-20, branch `f15-c1/pilot-gate-closure`, code SHA `754057f9…` (see [16_TRACEABILITY_MATRIX.md](16_TRACEABILITY_MATRIX.md) for the exact full SHA and deployment IDs), documentation SHA recorded at package close in [00_EXECUTIVE_SUMMARY.md](00_EXECUTIVE_SUMMARY.md).

## How to read this package

Start with **00_EXECUTIVE_SUMMARY.md** for the current GO/NO-GO snapshot, then go to whichever document matches your role:

| You are... | Start with |
|---|---|
| An engineer new to the codebase | 01, 02, 03, 04 |
| Building a new student/teacher/parent/institution feature | 05, 06 |
| Working on AI features | 07 |
| A security reviewer or auditor | 08, 15, 16 |
| Running or planning to run the pilot | 13, 10, 11 |
| Deciding on a Production release | 14, 15, 16 |
| Writing or reviewing tests | 12 |

## Status vocabulary used throughout this package

Every claim of "done" in this package is tagged with exactly one of the following. A claim with no tag has not been evaluated and should be treated as unknown, not as passing.

| Tag | Meaning |
|---|---|
| **IMPLEMENTED** | Real code exists and is merged/committed. Says nothing about whether it was tested. |
| **TESTED** | Covered by an automated unit/integration test, or a real-Postgres certification script, that actually runs in CI/locally. |
| **LIVE VERIFIED** | Directly observed working against real, deployed infrastructure (a live HTTP request, a live browser page load, a live database query) — not inferred from code or from a structural test alone. |
| **DEFERRED** | Deliberately not done yet, with a named owner and an explicit closure criterion (see [15_RESIDUAL_RISKS_AND_IVG.md](15_RESIDUAL_RISKS_AND_IVG.md) and [16_TRACEABILITY_MATRIX.md](16_TRACEABILITY_MATRIX.md)). Not a euphemism for "broken" or "forgotten."
| **BLOCKED** | Cannot proceed right now for a specific, named reason (a tooling boundary, a missing credential, a required human action). |
| **OPERATOR_ACTION_REQUIRED** | The blocking reason is specifically that a human with access this system doesn't have (a provider console, a dashboard) must act. Used exclusively for the credential-rotation gate in this package — see [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md). |

**This package never claims LIVE VERIFIED where only structural or unit-test evidence exists.** Where a document says "PASS (structural)" or "PASS (unit-tested)" without "LIVE VERIFIED," read it as exactly that — real, but not yet exercised against a live, deployed, authenticated system.

## Document index

| Doc | Contents |
|---|---|
| [00_EXECUTIVE_SUMMARY.md](00_EXECUTIVE_SUMMARY.md) | What StudyUS is, current state, GO/NO-GO |
| [01_SYSTEM_ARCHITECTURE.md](01_SYSTEM_ARCHITECTURE.md) | Real architecture, stack, directory structure, diagrams |
| [02_PHASES_F0S_TO_F15.md](02_PHASES_F0S_TO_F15.md) | All 16 phases (F0-S, F1–F15) plus F15-C1: scope, dependencies, results |
| [03_DATABASE_SCHEMA_AND_MIGRATIONS.md](03_DATABASE_SCHEMA_AND_MIGRATIONS.md) | Migration governance, the 32-migration history, current verified Preview DB state |
| [04_IDENTITY_ROLES_AND_AUTHORIZATION.md](04_IDENTITY_ROLES_AND_AUTHORIZATION.md) | Unified identity model, backfill, role/permission matrices |
| [05_STUDENT_TEACHER_PARENT_INSTITUTION_FLOWS.md](05_STUDENT_TEACHER_PARENT_INSTITUTION_FLOWS.md) | Real user-facing flows per workspace |
| [06_EXAM_READINESS_AND_INTERVENTIONS.md](06_EXAM_READINESS_AND_INTERVENTIONS.md) | Assessment framework, exam-taking, readiness, teacher interventions |
| [07_AI_ARCHITECTURE_AND_SAFETY.md](07_AI_ARCHITECTURE_AND_SAFETY.md) | AI gateway, providers, cost/timeout/allowlist controls, kill switch |
| [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md) | AuthN/AuthZ, rate limiting, dependency audit, the credential-rotation gate |
| [09_DEPLOYMENT_ENVIRONMENTS_AND_RELEASE.md](09_DEPLOYMENT_ENVIRONMENTS_AND_RELEASE.md) | Vercel project, environment separation, deploy procedure |
| [10_OPERATIONS_MONITORING_AND_INCIDENTS.md](10_OPERATIONS_MONITORING_AND_INCIDENTS.md) | `/api/health`, observability, incident severity model |
| [11_BACKUP_RESTORE_AND_ROLLBACK.md](11_BACKUP_RESTORE_AND_ROLLBACK.md) | What backup/rollback capability really exists today |
| [12_TESTING_AND_CERTIFICATION.md](12_TESTING_AND_CERTIFICATION.md) | Test suite, real-Postgres certifications, dependency audit |
| [13_PILOT_RUNBOOK.md](13_PILOT_RUNBOOK.md) | Step-by-step operator runbook to run the pilot |
| [14_PRODUCTION_RELEASE_CHECKLIST.md](14_PRODUCTION_RELEASE_CHECKLIST.md) | GO/NO-GO criteria distinct from Pilot |
| [15_RESIDUAL_RISKS_AND_IVG.md](15_RESIDUAL_RISKS_AND_IVG.md) | Consolidated, reconciled risk register and IVG — no item in two states |
| [16_TRACEABILITY_MATRIX.md](16_TRACEABILITY_MATRIX.md) | requirement → phase → implementation → migration → tests → certification → residual risk → final status |

## What this package deliberately excludes

No secret value, connection string, hostname, username, password, API token, or personal data (student/parent/teacher name, email, or other PII) appears anywhere in this package. Where a real credential or personal-data fact is relevant, it is described by shape and location only (e.g. "5 credentials in a local `.env.local` file, never committed to git") — never by value.
