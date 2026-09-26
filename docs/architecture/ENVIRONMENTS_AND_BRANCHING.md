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
- Each environment has its own `neondb_owner` password (rotated 2026-09-26).
  Neon copies role passwords into child branches, so every new branch must get
  its own password reset before use.

## Hosted environments (Vercel project `study-so/study-os`, INFRA-01C)

| Environment   | Vercel target                      | Stable URL                                        | Deploys from |
|---------------|------------------------------------|---------------------------------------------------|--------------|
| Development   | custom environment `dev`           | `https://study-os-env-dev-study-so.vercel.app`    | every push to `develop` (Git integration) |
| Preview/Stage | `preview`                          | per deployment (`study-<hash>-study-so.vercel.app`) | an exact certified SHA, deployed deliberately |
| Production    | `production`                       | `https://www.studyus.pro`                         | `main` |

- `dev` has its own variable set (DEV database, Clerk Development keys,
  `STUDYUS_ENV=development`, conservative `AI_MAX_CALLS_PER_MINUTE`/`AI_MAX_CALLS_PER_DAY`).
  It never inherits Preview or Production values.
- Non-production deployments are behind Vercel Authentication (Standard
  Protection); `www.studyus.pro` stays public. Automated checks use
  `vercel curl <url>`. Vercel also sends `X-Robots-Tag: noindex` on every
  non-production URL.

## Traceability

`GET /api/version` reports `commitSha`, `environment`, `commitRef`,
`deploymentTarget` and `deploymentId`. A certified environment must never
report `commitSha: null`.

- Git-integration deployments get the SHA automatically.
- CLI deployments carry no git metadata. Deploy from a clean checkout of the
  exact SHA and pass it explicitly:
  `vercel deploy --env STUDYUS_COMMIT_SHA=$(git rev-parse HEAD)`.
- Environment identity comes from `STUDYUS_ENV`, then `VERCEL_TARGET_ENV`
  (`dev` → `development`), then `VERCEL_ENV`. Vercel's own platform logs label
  the `dev` target as `preview`; use the log's `domain`/`branch`/`deploymentId`
  or the application's structured logs to tell them apart.

## Local development

Use only the `develop` worktree `/Users/jalbornoz/PROYECTOS/studyos-dev`
(local `.env.local` → DEV database). Other historical checkouts have no
working database configuration and must not be given one.

## Open items

- `PROD_DB_AUDIT_01`: the Production database ledger appears to contain
  F-series migrations beyond the 14 that Production code (`main`) ships.
  Audit read-only before any Production promotion.
