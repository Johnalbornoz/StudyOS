# F4 — QA Report

Branch: `f4/learning-architecture-2`, base `f3/subscription-entitlement-foundation` @
`e84846795ec59fc3114a3c559a2c30d4b70dd588`

## Automated test results

```
npx tsc --noEmit                                   -> exit 0
npx vitest run                                     -> 310 test files passed, 5173 tests passed, 0 failed
bash scripts/operations/f4-learning-architecture-migration-cert.sh
                                                    -> real-Postgres migration + adversarial cert: ALL CHECKS PASSED
npm run build                                       -> production build succeeded, 0 errors, all 5 new
                                                       /api/admin/catalog/* routes present in the route list
```

## F4-specific test coverage

| Test file | What it proves |
|---|---|
| `f4-prerequisite-cycle.test.ts` | Self-loop and transitive-cycle rejection before any DB write; a genuinely new edge succeeds; the INSERT never runs when a cycle would form. |
| `f4-mapping-service.test.ts` | `ensureCatalogMapping`'s full zero/one/many-candidate decision tree, transaction rollback on failure, and that a second call for an already-mapped concept is a 1-query no-op. |
| `f4-api-routes-security.test.ts` | All 5 `/api/admin/catalog/*` routes: 401 anonymous, 403 non-admin, 400 on invalid/missing input, all before the catalog service is ever called; one positive-path assertion that a valid confirm request reaches the service with the correct reviewer id. |
| `f4-canonical-v2-noninterference.test.ts` | No F4 file imports Canonical V2 internals; no F4 file writes to any of the 19 evidence/state tables or to concepts/subjects/topics/subtopics; `src/lib/catalog` never issues a DELETE; no cross-import with F2 authorization or F3 entitlements; `canonical_concepts` has no name-uniqueness constraint; the migration's own ambiguity handling never auto-picks. |
| `f4-learning-architecture-migration-cert.sh` + `f4-lifecycle-cert-runner.ts` | The full adversarial matrix (task §22 A–M) against real PostgreSQL — see the reconciliation report for exact counts. |

## Negative / adversarial coverage highlights

- **Same-name, different-scope concepts never silently merge** — two canonical concepts named
  "Derivative Rules" (SL/HL) produce an `AMBIGUOUS` mapping with both candidates recorded, never
  an automatic pick, both in the mocked unit test and against real Postgres.
- **Two learners, same concept name and definition, never compared to each other** — each
  independently resolves to `MATCHED` against the same pre-existing canonical concept; nothing in
  the algorithm or its SQL ever joins one learner's concept against another's.
- **Cross-learner private content isolation holds after mapping** — proven against real Postgres
  via the existing, unmodified `verifyContentSourceAccess` gate.
- **Prerequisite cycle rejection** — a 3-edge cycle (`A→B→C→A`) is rejected at the final edge, and
  the recursive-CTE reachability check runs and returns a definitive answer before any insert is
  attempted.
- **Idempotency at two levels**: the migration file itself (safe to re-run), and the backfill's
  own no-duplicate-mapping guarantee (`concept_catalog_mapping.learner_concept_id UNIQUE`), plus
  `ensureCatalogMapping`'s own existence check for concepts created after the initial migration.

## Live Preview smoke tests (anonymous, real HTTP, `https://study-ekw8q84mj-study-so.vercel.app`)

| Route | Method | Result | Expected |
|---|---|---|---|
| `/api/version` | GET | 200, `environment: "preview"` | confirms non-Production target |
| `/api/admin/catalog/subjects` | GET/POST | 401 | unauthenticated caller rejected before touching the catalog |
| `/api/admin/catalog/taxonomy` | GET | 401 | same |
| `/api/admin/catalog/mappings?status=UNRESOLVED` | GET | 401 | same |
| `/api/admin/catalog/mappings/confirm` | POST | 401 | same |
| `/api/content/search`, `/api/billing/subscription` | GET | 401 | F0-S/F3 regressions still hold |
| `/api/test` | GET | 404 | F0-S regression still holds |
| `/role-select` | GET | 200 | F1 UI still publicly reachable |

## Findings

No new findings. No authorization bypass, no data-integrity gap, and no Canonical V2 interference
was found in F4's own code. The pre-existing gaps discovered during inspection (`/api/concepts/extract`
missing subject-ownership check, `/api/content/extract-concepts`'s outstanding `// TODO: Verify
authorization`) are **not** F4 regressions — they predate this phase and are recorded in the
residual risk register rather than silently left for someone else to rediscover.

## Conclusion

All automated gates (typecheck, full unit suite, real-Postgres adversarial migration
certification, production build, live Preview smoke tests, and the full Canonical V2/F0-S/F1/F2/F3
regression suites) pass with zero failures and zero regressions.
