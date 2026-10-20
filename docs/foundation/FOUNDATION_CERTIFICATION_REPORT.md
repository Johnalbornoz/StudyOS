# Foundation Certification Report — Roles E2E + Exam Core shared base

- **Baseline:** `92e3509256804d261796da11e27c649aaffa3b39`. At the start, `origin/main`, `origin/develop` and HEAD were all on this SHA.
- **Branch:** `foundation/roles-exams-shared`.
- **Implementation commit:** `0f5993e5c8a352b2b4020acabd5e157b94ecf653`. The certified SHA is the commit that adds this report, which changes documentation only.
- **What stayed untouched:** Preview, Production, Production DB, Production migrations, `main`, and `develop`.

## Gates

| Gate | Result | Evidence |
|---|---|---|
| BASELINE_VERIFIED | PASS | main = develop = HEAD = `92e3509`. Branch created from that exact SHA. |
| DISCOVERY_COMPLETE | PASS | Four audits: identity / entitlements, parent / teacher / institution / authorization, exam core, learning-engine interfaces. Each component is classified KEEP / EXTEND / DEPRECATE_LATER / NOT_RELEVANT (foundation doc §2). |
| REUSE_ANALYSIS | PASS | No new architecture and no duplicated structure. Every contract maps to an existing function (doc §13). |
| IDENTITY_ROLE_MODEL | PASS | Doc §3. One `users` row with additive roles. Auth / role / workspace / authorization / entitlement are kept separate. |
| MULTIROLE_MODEL | PASS | REAL S1, S2 (14 checks). Roles coexist, with no duplicate user or student. An admin can add Student. A revoked role is not re-granted. The workspace switcher offers "add another role". |
| TENANCY_MODEL | PASS | Doc §10 plus the security matrix. Default-deny. F2 and F3 close two holes. |
| PARENT_ACCESS_MODEL | PASS | REAL S3 (8 checks). Pending gets no access. Accept requires the verified email. A parent can read only their accepted child and can never write. |
| TEACHER_INSTITUTION_MODEL | PASS | REAL S4 (16 checks). Pending gets no access. Approval without an assignment gets no access. Access is class-scoped. Cross-tenant scope is refused. Institution A cannot reach Institution B. |
| ASSIGNMENT_MODEL | PASS | Doc §7. `teacher_interventions` is the generic assignment, and it never writes cognition (source guards plus UNIT 14). |
| EXAM_CORE_MODEL | PASS | Doc §8. One core (F6 / F7 / F9). Attempts are bound to a PUBLISHED version of the profile's exam (F5, REAL S5). |
| EXAM_LEARNING_BOUNDARY | PASS | Doc §9 traces the actual pathway in code. A forgeable grade path was retired (F1). Spoofed evidence writers are refused (REAL S6). |
| ENTITLEMENT_MODEL | PASS | Doc §11. Role ≠ subscription ≠ permission. The parent read model takes no entitlement (UNIT 20 / 21). |
| SECURITY_MATRIX | PASS | 28 attempts; every expected DENY was denied and every expected ALLOW was allowed (FOUNDATION_SECURITY_MATRIX.md). 0 unauthorized writes. |
| FOUNDATION_TESTS | PASS | `tests/unit/foundation-shared-invariants.test.ts`: 22 tests covering invariants 1–21, plus updated F2 / F9 / auth tests. |
| STUDENT_NON_REGRESSION | PASS | Full suite 6,493 / 6,493 (baseline 6,469 plus 24 new). Typecheck clean. Production build compiles. Student code paths change only in the owner-only learning guard (students were always owners) and the role-gated *creation* branch (existing students are unaffected). |
| HOSTED_DEV_SMOKE | PASS (signed-out + deployed bundle) | See the hosted DEV smoke section below. |
| DATA_INTEGRITY | PASS | Fixtures are removed (`CLEANUP.no-fixtures-left`). DEV is back to its baseline: 4 students, 6 users, 0 `fdn-` rows, 0 orphan notifications or audit rows. No migration, no drift. |

**HOSTED_DEV_SMOKE detail:**
- Hosted DEV serves `0f5993e` (`dpl_7tktetY12MEpeRoH9wJEhqVGbdax`, target `dev`).
- Health OK.
- 8 changed or affected routes return 401 signed out.
- The landing page renders.
- The new "Añadir otro rol" link rendered in the workspace switcher.
- Interactive authenticated flows were **not** run on hosted DEV, because no DEV Clerk session was available. The same code was exercised against the same DEV database through the real services (S1–S6).

## Counters

- MIGRATIONS_REQUIRED = 0, MIGRATIONS_PENDING = 0 (DEV ledger 40), CHECKSUM_DRIFT = 0.
- TESTS_PASSED = 6,493 / TESTS_TOTAL = 6,493 (unit). DEV functional scenarios: 54 / 54.

## Blockers, risks, open decisions

- **Blockers:** none.
- **Risks:** foundation doc §19, six items, all assigned to a track.
- **Open decisions:** foundation doc §16.
  - Blocking only specific work packages: A4 needs product to name who creates classes; B2 needs the exam-family taxonomy and a session or year column; B1 needs scoring-model execution.
  - None of them blocks the start of either track.
