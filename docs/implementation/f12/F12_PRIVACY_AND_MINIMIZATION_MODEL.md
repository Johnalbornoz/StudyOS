# F12 — Privacy and Minimization Model

## Classification (task section 26)

| Class | Meaning | Examples in F12 |
|---|---|---|
| `AGGREGATE_SAFE` | Institution-level counts/distributions with no per-learner identifiability, subject to cohort suppression | Overview counts, learning/coverage/readiness/diagnostic/intervention distributions |
| `AUTHORIZED_LEARNER_SUMMARY` | Minimized per-learner data, released ONLY after learner-scope authorization | `getLearnerDrillDown`'s output (state distributions + evidence count only) |
| `TEACHER_OPERATIONAL` | Operational counts about a Teacher's own assignments/interventions, never a quality judgment | `getTeacherOperationalSummary`, `getInstitutionTeachers` |
| `SYSTEM_INTERNAL` | Never exposed to any F12 caller | AI prompts/provenance, raw grading internals (`criteriaBreakdown`, `rawResponse`), policy-version internal ids beyond the version NUMBER |
| `NOT_INSTITUTION_VISIBLE` | Data that exists in the platform but F12 never surfaces at institution scope | Parent-relationship records, another institution's data, another learner's raw evidence rows, Clerk/session tokens |

## What is minimized in the learner drill-down (AUTHORIZED_LEARNER_SUMMARY)

`getLearnerDrillDown` returns: `studentId`, a bare evidence COUNT, and three state-distribution maps (Concept/Skill/Competency). It never returns: raw `learning_evidence` rows, response text, AI evaluation internals, other learners' data, or any field not already covered by one of these five. Verified by real-Postgres payload inspection (`f12-institution-intelligence-cert-runner.ts`): the serialized JSON contains no `aiExecution`/`promptId`/`provider`/`rawResponse`/`criteriaBreakdown` substring, and contains no reference to an unrelated learner's id.

## What every route/service withholds structurally

- No route ever returns another institution's data (enforced by `requireInstitutionAccess`/`requireClassInInstitution`/`requireLearnerInInstitution` throwing BEFORE any query runs).
- No AI prompt, model name, or provider identifier appears anywhere in the institution-intelligence module (confirmed: none of these fields exist in any of this module's own types; the underlying F5/F8/F9 data F12 reads already strips them at ITS OWN read boundary in every function F12 calls).
- No parent-relationship record is read or exposed by any F12 function.
- No token/secret is ever read from application tables into a response (none of this module's queries touch any credential-bearing table).

## Aggregate-safe does not mean unconditionally safe (task section 27)

An `AGGREGATE_SAFE` metric can still be individually identifying at a small enough cohort size — this is why `applyCohortSuppression` exists as a mandatory final step for every learner-population-derived aggregate (learning summary, readiness summary). See `F12_SMALL_COHORT_POLICY_DECISION.md`.
