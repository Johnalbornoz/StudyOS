# Roles E2E (Track A) — DEV Certification Report

## Scope and identifiers

| Item | Value |
|---|---|
| Common base (Foundation, frozen) | `2f94a1f2fba3bff10b04b933eacfde775be75672` |
| Branch | `track-a/roles-e2e` |
| Candidate | The commit that adds this report revision. It supersedes `f2cc895` (not certified: product amendment PA-01 and the manual-gate identity fix changed code). |

**Product model (PA-01):** ONE canonical user → ONE primary functional persona (STUDENT / PARENT / TEACHER). Institution and StudyUS administration are capabilities, not personas. There is no "Añadir otro rol".

**Untouched:** `main`, `develop`, Preview / Stage, Production and its DB, Track B (branch and candidate deployment).

## Environments

| Environment | Detail |
|---|---|
| DEV DB | Neon DEV, fingerprint `2a29b99ee14a22b4`. Every script refuses any other database. |
| DEV Clerk | `shining-impala-8101` (`sk_test_`). The fixture script refuses any other instance. |
| Hosted DEV | Vercel custom environment `dev`. |

**Hosted DEV deployments:**
- `dpl_D9rHGEsrEjjHpFkMo8SghUoBfsiN` serves `245f6c9`.
- `dpl_7SZXzgbfR9z8wV42XojbAyWPgTvH` serves `ab6e558`.

`/api/version` and `/api/diagnostics/preview-db` confirm, for each deployment: the exact `commitSha`, `deploymentTarget=dev`, and DB fingerprint `2a29b99ee14a22b4`.

**Shared DEV note.** During this run, a parallel session applied Track B's migration `20261019_1000` to the same DEV DB, and one non-fixture account signed in. Track A neither reads nor depends on either.
- The Track A ledger row and checksum are intact.
- Every Track A run after 16:55 UTC passed with Track B's schema present.

## Gates

| Gate | Result | Evidence |
|---|---|---|
| A1 Identity / single persona | PASS | Real HTTP, hosted DEV. 24 checks plus 2 page renders. PA-01 invariants 1–13 over real HTTP: no persona can self-add another (6 × 409, 0 rows written); persona stable across fresh sessions and is the active workspace; STUDYUS_ADMIN capability is not a persona and cannot unlock one; foreign-persona switch 403; privileged self-service 400; revoked persona never re-granted and blocks others; approved Teacher reaches the Teacher workspace with the specified empty state; pending Teacher sees no institution data; assigned Teacher sees only its scope. No "Añadir otro rol" in any rendered page or source (guard test). |
| A2 Parent | PASS | 26 checks. Consent-first request. No-oracle response, byte-identical. Pending sees nothing. Accept and decline, both notified. Multiple children. Student revokes. Read-only summaries. Local UI: request, accept, summary. |
| A3 Teacher | PASS | 11 checks. Request PENDING with explicit pending state. Approved without scope sees no class. Scoped class. Roster. Results. Revoke ends access. Can re-apply. Local UI: pending page, class, publish, results. |
| A4 Institution | PASS | 13 checks. Grade and class create. Foreign grade 422. Approve. Scope. Consent invite. Remove. Revoke. Local UI: approve, staff, invite, roster. |
| A5 Integrated role flow | PASS | 15 checks plus 14 page renders on hosted DEV: institution → teacher → enrollment → publish → student practice → `updateMastery` evidence → teacher COMPLETED + graded result → parent summary. Repeated as real clicks locally (UI result *3 de 20 correctas*). |
| PARENT_SECURITY | PASS | Security matrix D1–D3, D11, D13, D22, D27 |
| TEACHER_SECURITY | PASS | D4–D8, D10–D12, D19–D21, D25, D26 |
| INSTITUTION_SECURITY | PASS | D9, D15–D17, D20, D21 |
| SINGLE_PERSONA / ROLE_SECURITY | PASS | D23–D23d, D24, D28. No duplicate users or students. |
| ADMIN_CAPABILITY_SEPARATION | PASS | Capabilities reached by route; never selectable; never counted as a persona (unit + HTTP). |
| ADMIN_PENDING_REQUEST_IDENTITY | PASS | Requester *Nombre · email*, role, institution, date; server-side; tenant-scoped (unit + guard tests). |
| CLERK_STUDYUS_IDENTITY_UX | PASS | Inconsistency rows show name / email / state / roles + link to the user page. |
| ASSIGNMENT_SECURITY | PASS | D18, D11, D26. Type/target and own-concept unit checks. No empty activity stored (observed on hosted). |
| HOSTED_DEV_AUTHENTICATED | PASS_COND | `ab6e558`: 159/159 real HTTP checks as 9 real Clerk DEV identities, including 14 authenticated page renders covering the 12 journey screens. The condition is an operator browser click-through on hosted DEV; see the method limit below. |
| MOBILE | PASS | 390, 430, 768 and 1280 px across Parent, Teacher, Institution (overview, grades, classes, class, teachers, requests), account, notifications and the switcher. 0 horizontal overflow. Undersized actions found and fixed (Approve/Reject was 22 px, switcher was 34 px). |
| LOCALES | PASS | es, en and pt rendered. Every Track A key exists in es / en / de / fr / pt (unit test). Plurals added. The F12 intelligence sub-pages are a P2. |
| DARK_MODE | PASS | Tokens apply. 0 text elements below 4.5:1 contrast on the Parent, Institution (×4) and account pages. |
| STUDENT_NON_REGRESSION | PASS | 6,556 / 6,556 unit tests, including every Student suite. The Student cognitive-loop E2E on a throwaway DB gives a result identical to the base SHA (P3, pre-existing). Production build OK. Student paths changed only where listed in the implementation doc §3. |
| DATA_INTEGRITY | PASS | DEV after cleanup: duplicate users 0, duplicate emails 0, duplicate students per user 0, orphan parent relationships 0, orphan memberships 0, orphan enrollments 0, cross-institution scopes / classes / interventions 0, cross-student interventions 0, scope-less assignments 0, incoherent assignment owners 0, notifications without recipient 0, Track A fixtures left 0 (9 Clerk users deleted). |
| DEV PERSONA NORMALIZATION | DONE | 2 real DEV accounts held two personas; normalized by rule (keep persona with data, else earliest), soft-revoke, audited, nothing deleted. 0 accounts with >1 active persona. |
| MIGRATIONS | PASS | Applied: 1 (`20261018_1000`). Pending: 0. Drift: 0. Ephemeral cert covers idempotency and rollback. |

## Method limit (stated, not hidden)

**What the agent did on hosted DEV.** It signed real Clerk DEV test identities into requests with backend-issued session tokens (in request headers). It reached the protected deployment with the project's existing automation-bypass secret.

**What the agent did not do.** It did not sign a *browser* into the hosted deployment. That would mean placing sign-in tokens or the bypass secret into a browser on a non-local host, which the agent's operating rules do not allow.

**How the gap is covered:**
- The interactive, clicked UI journey was executed locally on the same code and the same DEV DB.
- Hosted DEV was verified through authenticated page renders and the full API flow.

**How to close it fully.** An operator signed in to Vercel can click the same 12 steps on hosted DEV in about five minutes. The fixture script issues one-time sign-in links.

## Verdict

The automated gates are PASS on the candidate. Certification additionally requires the operator's manual 12-step browser click-through on hosted DEV at this exact candidate (prepared with one-time sign-in links for the DEV test identities). The operator's result and the final verdict are recorded in the release message for this SHA; the branch is pushed only after that gate passes.

## Counters

- **TESTS:** 6,576 / 6,576 unit (baseline 6,491 + 85 Track A).
- **Track A real HTTP (PA-01 candidate):** local 170 / 170 (hosted run recorded in the release message).
- **Earlier pre-amendment runs (history):**
  - local: 158 / 158;
  - hosted DEV `245f6c9`: 143 / 143 and 158 / 158;
  - hosted DEV `ab6e558`: 159 / 159.
- **Migration cert:** all checks pass.

## Blockers, P2, P3

**Blockers:** none.

**P2:**
1. The F12 institution intelligence sub-pages (learners, coverage, readiness, interventions, attention) still show engineering-English explainability text and raw-UUID inputs. These are certified F12 surfaces that Track A did not change. The institution home was localized.
2. Hosted *browser* click-through: performed by the operator (manual gate).

**P3:**
2. Publishing an assignment is one step; there is no DRAFT state.
3. No institution seat / licence model.
4. `scripts/e2e-cognitive-loop.ts` drift (pre-existing).
5. Membership history keeps only the latest decision.
6. Exam assignment is deferred to the cross-track integration.
