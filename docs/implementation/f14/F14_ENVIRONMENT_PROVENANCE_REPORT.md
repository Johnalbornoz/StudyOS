# F14 — Environment Provenance Report (Workstream H)

No secret values appear anywhere in this document — only file locations, variable names, and precedence/risk analysis. No dev server was started in this F14 worktree to test env resolution live; doing so would repeat exactly the unverified-connection risk this document investigates, and this phase does not have a safer way to bound that risk than F13 did.

## What was checked, safely, read-only

```
This worktree (f14-experience-completion): find -maxdepth 1 -iname ".env*" -> NO MATCH
git status --short --ignored (this worktree)                      -> no .env* entry at all (not even ignored-but-present)
```

Confirmed: this F14 worktree has zero env file of any kind, tracked, untracked, or ignored.

## What was found in sibling directories (the actual, concrete evidence)

All of this session's phase worktrees live as siblings under one shared scratchpad parent directory (`.../scratchpad/f0s-security`, `.../f1-identity`, `.../f2-relationships`, ..., `.../f14-experience-completion`). A directory-name-only listing (`find .. -maxdepth 2 -iname ".env*"`) found **real, credential-bearing `.env.local` files still present** in several of these sibling worktrees:

| Worktree | Variable names present (values never read) |
|---|---|
| `f0s-security` | `ANTHROPIC_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_AI_PROVIDER`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `OPENAI_API_KEY`, `VERCEL_OIDC_TOKEN` |
| `f1-identity`, `f2-relationships`, `f3-entitlements`, `f4-learning-architecture`, `f5-evidence-learner-state`, `f6-curriculum-standards-mapping` | `VERCEL_OIDC_TOKEN` only |
| `f14-experience-completion` (this worktree) | none |

`f0s-security` is the very first worktree created in this multi-phase program (session history) and is the only one carrying real Clerk/database/AI provider credentials — almost certainly placed there manually, early in this session, for legitimate live testing during that very first phase, and never cleaned up afterward. Every other worktree, including this one, only ever picked up a bare `VERCEL_OIDC_TOKEN` (a Vercel CLI artifact, not an application secret) or nothing at all.

## Precedence / plausible resolution path (disclosed as analysis, not a proven mechanism)

No shared lockfile or Turbopack workspace-root marker exists at the scratchpad parent level (`find .. -maxdepth 1 -iname "*.lock" -o -iname "package.json"` → no match), which rules out the specific "Turbopack infers a shared monorepo root and loads a sibling's env" theory F13 speculated about. `node_modules` is independently installed per worktree (different inode numbers confirmed — not shared/symlinked). This phase did not reproduce F13's exact incident (no dev server was started here), so the precise resolution mechanism inside F13's own worktree at the time it ran `npm run dev` remains **not conclusively proven** — but a real, live, credential-bearing file sitting in a sibling directory under the same parent is sufficient explanation on its own, however the exact lookup happened (a stray `--env-file` flag in a shell history, an inherited shell environment variable from an earlier `source`d session, or a genuine Next.js/Turbopack path-resolution quirk specific to nested git worktrees).

## Security check performed (real, not merely asserted)

```
$ grep -n "^\.env" .gitignore
34:.env*
$ git log --all --oneline --source -- .env.local        -> no results
$ git log --all --oneline --source -- '**/.env.local'   -> no results
$ (in f0s-security worktree) git status --short --ignored .env.local
!! .env.local
```

Confirmed: `.env*` is gitignored repository-wide, `.env.local` has never been committed anywhere in this repository's history, and the one real, secret-bearing file (`f0s-security/.env.local`) is correctly recognized by git as ignored, never staged, never tracked. **No secret has ever entered git history.**

## Risk and recommendation

- **Category**: WORKING_DIRECTORY / TOOLING (a real credential file left over in a sibling scratchpad directory from earlier session work), not a codebase or migration defect.
- **Risk**: Low-to-medium, contained to this local development host. The credentials were never committed, and no destructive or authenticated action was taken against whatever they connect to, in F13 or in this phase.
- **Recommendation to the human operator** (cannot be verified or acted on by this agent without risking exactly the live-connection uncertainty this document is about): confirm whether `f0s-security/.env.local`'s Clerk/database/AI-provider credentials are still live; if so, rotate them and delete the file; if they were already a disposable dev-only project, delete the file regardless to remove the residual exposure surface.
- **No authenticated or destructive action was performed to investigate this**, per the task's own explicit instruction.
