# F11 — Student Self-Service Non-Regression

Proves F11 did NOT replace or restrict F9 Student self-service, per task §1. Every case is a real, direct call to F9's own service functions — exactly as `POST /api/simulation/attempts` itself calls them — with zero involvement of any `teacher_interventions`/`teacher_intervention_executions` row.

## Cases (real Postgres, this certification run)

| Case | Scenario | Result |
|---|---|---|
| A | TOPIC_EXAM self-service (PAA Math, fully supported+mapped) | **WORKS** — real `simulation_attempts` row, `status = 'ACTIVE'` |
| B | DOMAIN_EXAM self-service (PAA Math academic subject) | **WORKS** |
| C | MINI_MOCK self-service (Math is the only fully-supported+mapped objective) | **WORKS** |
| D | PAA FULL_MOCK self-service | **NOT_READY** — identical structural truth to the Teacher-assignment path (Reading genuinely unsupported) |
| E | Self-service attempt dependency check | **ZERO** `teacher_intervention_executions` rows reference any of the three successful self-service attempts |
| F | Source/routing guard | The real `POST /api/simulation/attempts` route file contains **zero** references to `teacher_intervention` anywhere |

## What this proves

A Student with their own valid Exam Profile can use TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK self-service exactly as before F11 existed — no new required field, no new required row, no new required authorization check beyond F9's own already-certified `canAccessLearner`/`canUseCapability` gate on that route. F11's entire footprint on the Student-self-service surface is **zero**: it adds an alternative orchestration origin (Teacher-assigned), never a replacement for, restriction on, or prerequisite to the Student's own direct path.

Full mock's NOT_READY result is identical in both directions (task §7) — see `F11_INTEGRATED_AUTHORIZATION_CERTIFICATION.md` §PAA Full Mock and the integrated architecture doc's "Two coexisting entry points" section for the joint proof that both entry points converge on the exact same `getSimulationEligibility`/`getFullMockEligibility` authority.
