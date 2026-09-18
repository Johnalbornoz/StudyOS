# F5 — QA Report

Branch: `f5/evidence-learner-state-2`, base `f4/learning-architecture-2` @
`9b7521caf2fe8ea65b4ac70eaabe06e2da3d6d96`

## Automated test results

```
npx tsc --noEmit                                    -> exit 0
npx vitest run                                       -> 315 test files passed, 5224 tests passed, 0 failed
bash scripts/operations/f5-learner-state-migration-cert.sh
                                                     -> real-Postgres migration + adversarial cert: ALL CHECKS PASSED
npm run build                                        -> production build succeeded, 0 errors, all 6 new
                                                        /api/admin/learner-state/* routes present
```

## Regression suites re-run explicitly

```
npx vitest run tests/unit/canon-*.test.ts tests/unit/audit-canon-v2-*.test.ts
  Test Files  36 passed (36)
       Tests  806 passed (806)

npx vitest run tests/unit/f0s-*.test.ts tests/unit/f1-*.test.ts tests/unit/f2-*.test.ts tests/unit/f3-*.test.ts tests/unit/f4-*.test.ts
  Test Files  26 passed (26)
       Tests  219 passed (219)
```

Zero Canonical V2/F0-S/F1/F2/F3/F4 test files were modified in this phase — every one of these
806 + 219 tests passed unmodified, which is the strongest available proof that F5 changed no
pre-existing pedagogical decision.

## F5-specific test coverage

| Test file | What it proves |
|---|---|
| `f5-state-classification.test.ts` | Pure `computeDimensionState`: all four state thresholds, determinism (identical input -> identical output), input never mutated. |
| `f5-skill-competency-transfer-service.test.ts` | Projectors against a mocked DB: knowledge-only evidence never fabricates Skill State, explicit evidence produces real state, Competency is never inferred via `skill_competencies`/`canonical_concept_competencies` joins, assisted-only evidence never counts as independent, context counting, AMBIGUOUS/UNRESOLVED mappings never leak a guessed canonical id. |
| `f5-mastery-wiring.test.ts` | `updateMastery` touches zero F5 tables for any caller that never sets the new metadata fields (the same property the full suite already proves empirically); activates only when explicitly tagged; a Skill State projection failure never aborts the transaction (COMMIT still runs, ROLLBACK never does). |
| `f5-api-routes-security.test.ts` | All 6 `/api/admin/learner-state/*` routes: 401 anonymous, 403 non-admin, 400 on invalid input, all before touching state/evidence. |
| `f5-canonical-v2-noninterference.test.ts` | No F5 file imports Canonical V2 internals or calls its qualification functions; no F5 file writes to a Canonical-V2-owned table or to `learning_evidence`/`mastery_records`/`concept_knowledge_state`/`concepts`/`subjects`; no F5 route exposes PRACTICE/PROVE/RETAIN/TRANSFER vocabulary; no F5 lib file's actual SQL (not doc comments) queries the F4 skill/competency graph tables. |
| `scripts/operations/f5-learner-state-migration-cert.sh` + `f5-lifecycle-cert-runner.ts` | The full adversarial matrix (task §28 A-L) against real PostgreSQL via the real `updateMastery()` function — see the reconciliation report for exact counts. |

## Negative / adversarial coverage highlights

- **Concept→Skill graph never fabricates evidence** (AC-F5-05): even with a real
  `canonical_concept_skills` edge present, evidence for that concept without an explicit
  `skillIds` tag produces zero Skill State rows — proven against real Postgres.
- **Competency never inferred from Skill evidence** (AC-F5-04): 4 real, qualifying Skill-evidence
  rows for a skill linked to a competency in the taxonomy graph still leave Competency State at
  zero rows — proven against real Postgres, the single most safety-critical assertion in this
  phase per task §10/§19.
- **Assisted ≠ independent** (AC-F5-06): 3 assisted-but-correct rows meet the evidence-count gate
  but never reach `CONSISTENT_INDEPENDENT` — `independentEvidenceCount` stays 0.
- **Cross-learner isolation holds even under a shared canonical concept** (AC-F5-16): proven
  against real Postgres with two real learners mapped to the same canonical concept.
- **AMBIGUOUS/UNRESOLVED mapping safety** (AC-F5-17/18): an AMBIGUOUS mapping's context counting
  still works but `canonical_concept_id` stays null; an UNRESOLVED concept's Skill/Knowledge
  State compute exactly as normal.
- **A new-dimension projection failure never touches the transaction** (task §26): simulated by
  forcing the Skill State policy lookup to throw — `updateMastery` still commits, evidence and
  mastery are still written, and no rollback occurs.

## Live Preview smoke tests

See `F5_PREVIEW_CERTIFICATION.md` for the deployment URL and live route-gating results.

## Findings

No new findings. No authorization bypass, no data-integrity gap, and no Canonical V2
interference was found in F5's own code.

## Conclusion

All automated gates (typecheck, full unit suite, explicit Canonical V2 and F0-S/F1/F2/F3/F4
regression re-runs, real-Postgres adversarial migration certification, production build) pass
with zero failures and zero regressions.
