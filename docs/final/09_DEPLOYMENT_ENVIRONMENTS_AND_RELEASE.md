# 09 — Deployment, Environments, and Release

## Vercel project

Team `study-so` (Pro plan), project `study-os`. Real Production URL: `https://www.studyus.pro`. `.vercel/project.json` (gitignored) links any local checkout to this project — it must be manually copied into any `git worktree add` checkout, since it's untracked (this specific gap caused F5-through-F12 to incorrectly report "no Preview access available" — rediscovered and fixed in F15).

## Environment separation (confirmed via `vercel env ls`, values never read)

| Variable | Preview | Production |
|---|---|---|
| `DATABASE_URL` | Separate value | Separate value |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Separate value | Separate value |
| `CLERK_WEBHOOK_SECRET` | Not configured | Configured |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | **Shared** | **Shared** |

## Deploy procedure (real, exactly what this program uses)

```bash
npx vercel deploy --yes      # ALWAYS creates a Preview deployment (target: null in JSON, "preview" via vercel inspect)
npx vercel deploy --prod     # Creates a Production deployment -- NEVER used for routine iteration in this program
```

Every deployment referenced in this package's history was made via the first form. `vercel inspect <deployment>` is the standard verification step before trusting any deployment's environment — this program treats "I ran `vercel deploy`" as insufficient on its own; the `target` field is always independently checked.

**Important CLI quirk**: `VERCEL_GIT_COMMIT_SHA` is **not** auto-populated for CLI-triggered (`vercel deploy`) deployments in this project (only for Git-integration-triggered ones) — `/api/version`'s `deploymentSha` field will read `null` for every deployment made this way. The actual deployed SHA must be tracked separately via `git rev-parse HEAD` at deploy time — see [16_TRACEABILITY_MATRIX.md](16_TRACEABILITY_MATRIX.md) for the current one.

## Current deployed state (as of this package)

| | Value |
|---|---|
| Branch | `f15-c1/pilot-gate-closure` |
| Latest code commit deploying `/api/health` | `754057f9…` (full SHA in [16_TRACEABILITY_MATRIX.md](16_TRACEABILITY_MATRIX.md)) |
| Latest Preview deployment | `dpl_Ets57qwU4z1MLtwzYrbLeFBYd1Uj`, `study-dbmvv2hh9-study-so.vercel.app` |
| `target` | `preview` (confirmed via `vercel inspect`) |
| Production | Untouched throughout F15 and F15-C1 |

## Migration is never part of deploy

`npm run db:migrate` is a separate, explicit, human-run step — never invoked by `next build`, app startup, or any Vercel deploy hook. This is why a Preview deployment can boot successfully while its database is out of migration sync with the code it's running (exactly what happened and was resolved in F15-C1 — see [03_DATABASE_SCHEMA_AND_MIGRATIONS.md](03_DATABASE_SCHEMA_AND_MIGRATIONS.md)). **Operational implication for any future release**: always confirm migration state independently after a deploy, never assume it from the deploy succeeding.

## Release process (real, as practiced across 16 phases)

1. Isolated `git worktree` cut from an exact, verified base SHA (`git rev-parse HEAD` cross-checked).
2. Full implementation + typecheck + full test suite + real-Postgres certification, all re-run before any commit.
3. Commit on the phase's own branch (never `main` directly).
4. Preview deploy (`vercel deploy`, never `--prod`) + `vercel inspect` confirmation.
5. QA report + phase-specific certification docs written.
6. Push to remote; **no merge to `main` and no Production deploy without explicit, separate authorization** — this has been a standing, unbroken rule across all 16 phases plus F15-C1.

## Status

- Preview pipeline: **LIVE VERIFIED** (booting, authenticating correctly, database migrated and integrity-verified).
- Production: **LIVE VERIFIED as untouched** (every deploy command used, and the resulting `target` field, checked).
- A formal CI/CD pipeline (automatic Preview-on-PR, automated gate checks before Production promotion): **does not exist** — every deploy in this program's history has been a manually-run `vercel deploy` from a human-verified worktree. **DEFERRED**, real Production requirement, not a Pilot blocker at current scale.
