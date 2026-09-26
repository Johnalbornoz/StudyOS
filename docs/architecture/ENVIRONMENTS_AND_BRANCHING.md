# Environments and Branching — Source of Truth

Established in INFRA-01B (2026-09-26). This is deliberately simple; it is not GitFlow.

## Branches

| Branch    | Meaning                                   | Deploys to                         |
|-----------|-------------------------------------------|------------------------------------|
| `main`    | Current Production / stable line          | Production (`www.studyus.pro`)     |
| `develop` | Current advanced Development line         | DEV (local worktree / hosted DEV)  |

- `develop` was created at `e89179d` (F15-C1 tip). It contains all of `main`
  plus the full F0-S → F15 line and the post-F15 admin/membership fixes.
- Feature work branches off `develop` and merges back into `develop`.
- `main` only moves by promoting an exact, certified SHA (below). Never commit
  feature work directly to `main`, never rewrite it.

## Promotion path

```
develop  →  DEV (certify)  →  certified SHA  →  Preview/Stage (certify)  →  same SHA  →  main  →  Production
```

- Preview/Stage is not a branch. It is a deployment target that receives an
  exact SHA from `develop` that has already passed DEV certification.
- Production receives the exact SHA that passed Preview/Stage, via `main`.
- Every certification report records the SHA it certified.

## Databases (one per environment, never shared)

Fingerprint = first 16 hex chars of `sha256("<hostname>|<database>")`, the
same algorithm as `src/app/api/diagnostics/preview-db/route.ts`. Always check
the fingerprint before any migration or write.

| Environment    | DB fingerprint     | Clerk instance                    |
|----------------|--------------------|-----------------------------------|
| Production     | `6671e7382d808d06` | Production (`pk_live_`)           |
| Preview/Stage  | `53d158d5811e7ee0` | Development (`pk_test_`)          |
| Development    | `2a29b99ee14a22b4` | Development (`pk_test_`)          |

- The DEV database is a Neon branch rebuilt from this repository
  (`database/baseline` + `database/ledger` + governed `db:migrate`) with
  synthetic seed data only. It must never hold copied real user data.
- Migrations are applied per environment with the governed runner only, in the
  same promotion order as code: DEV → Preview/Stage → Production.
- Secrets live only in untracked `.env*` files (gitignored) or the hosting
  provider's environment settings. Never commit them.
