# F6 — QA Report

Branch: `f6/curriculum-standards-mapping`, base `f5/evidence-learner-state-2` @
`b463e055a81660578a710490c656d9b1fd4b1bf9`

## Automated test results

```
npx tsc --noEmit                                    -> exit 0
npx vitest run                                       -> 320 test files passed, 5278 tests passed, 0 failed
bash scripts/operations/f6-curriculum-mapping-migration-cert.sh
                                                     -> real-Postgres migration + adversarial cert: ALL CHECKS PASSED
npm run build                                        -> production build succeeded, 0 errors, all 6 new
                                                        /api/admin/curriculum/* routes present
```

## Regression suites re-run explicitly

```
npx vitest run tests/unit/canon-*.test.ts tests/unit/audit-canon-v2-*.test.ts
  Test Files  36 passed (36)
       Tests  806 passed (806)

npx vitest run tests/unit/f0s-*.test.ts tests/unit/f1-*.test.ts tests/unit/f2-*.test.ts tests/unit/f3-*.test.ts tests/unit/f4-*.test.ts tests/unit/f5-*.test.ts
  Test Files  31 passed (31)
       Tests  270 passed (270)
```

Zero Canonical V2/F0-S/F1/F2/F3/F4/F5 test files were modified in this phase — all 806 + 270
tests passed unmodified.

## F6-specific test coverage

| Test file | What it proves |
|---|---|
| `f6-structure-cycle.test.ts` | Self-parent and transitive-cycle rejection, cross-structure-version parent rejection, root-node creation with zero extra queries. |
| `f6-mapping-workflow.test.ts` | AI-suggested mappings are created DRAFT (never auto-published), creator cannot self-approve (rejected before any UPDATE), a different reviewer succeeds, publishing atomically retires the previous PUBLISHED sibling in the same mapping group, direct retirement works, every action fails closed without its required grant. |
| `f6-coverage.test.ts` | FULL and PARTIAL are always reported separately, never summed; PREREQUISITE/SUPPORTING count toward neither; only PUBLISHED-status rows are queried; duplicate PUBLISHED resources on one objective still count as exactly one. |
| `f6-api-routes-security.test.ts` | All 6 `/api/admin/curriculum/*` routes: 401 anonymous, 403 non-admin, 400 on invalid input, correct HTTP status mapping for self-approval (403) and invalid-transition (409) service errors. |
| `f6-canonical-v2-noninterference.test.ts` | No F6 file imports Canonical V2 internals, writes to any Canonical-V2-owned or F5 Learner State table, or exposes progression vocabulary; no cross-import with F2/F3/F5; editorial grants never touch `user_roles`; every mapping table references F4's existing catalog by id; no F6 table has a `student_id` column. |
| `f6-curriculum-mapping-migration-cert.sh` + seed/runner scripts | The full adversarial matrix (task §30 A-L, plus §12/§27) against real PostgreSQL. |

## Negative / adversarial coverage highlights

- **No canonical concept duplication across frameworks** (AC-F6-01): PAA and Cambridge objectives
  both resolve to the identical `canonical_concept_id`, verified by direct equality against real
  Postgres.
- **PARTIAL never claims full coverage** (AC-F6-08): verified both in mocked unit tests and
  against real Postgres with an actual PARTIAL mapping in the pilot dataset.
- **Self-approval denied without side effects** (AC-F6-10): the mapping's status remains
  unchanged after a denied self-approval attempt, proven against real Postgres.
- **AI cannot auto-publish, and ambiguity is never silently resolved** (AC-F6-11, task 30-H): two
  AI-suggested candidate mappings for the same objective both start DRAFT; only an explicit human
  publish action moves one to PUBLISHED, and the other remains invisible to the activity metadata
  bridge — proven end to end against real Postgres.
- **Retired resources/mappings are preserved, never deleted** (AC-F6-13): a retired resource's row
  and links remain queryable after retirement.
- **Duplicate resources never inflate coverage** (AC-F6-14): 3 published resources on one
  objective, plus a retired 4th, still counts as exactly one covered objective.
- **Private content stays private after alignment** (AC-F6-16): a different learner is denied
  access to content whose underlying concept resolves to a publicly-mapped objective.
- **Version changes preserve history** (AC-F6-20): both structure-version supersession and
  mapping-version replacement leave the prior PUBLISHED row's data fully intact, only its status
  changes (to SUPERSEDED/RETIRED respectively).
- **Activity metadata bridge never guesses** (AC-F6-21): resolves published mappings correctly,
  returns `null` for an objective with none.

## Live Preview smoke tests

See `F6_PREVIEW_CERTIFICATION.md` for the deployment URL and live route-gating results.

## Findings

No new findings. No authorization bypass, no data-integrity gap, and no Canonical V2
interference was found in F6's own code.

## Conclusion

All automated gates (typecheck, full unit suite, explicit Canonical V2 and F0-S/F1/F2/F3/F4/F5
regression re-runs, real-Postgres adversarial migration certification, production build) pass
with zero failures and zero regressions.
