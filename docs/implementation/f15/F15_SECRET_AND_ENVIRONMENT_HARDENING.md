# F15 — Secret and Environment Hardening (Workstream C)

No secret value appears anywhere in this document. This phase attempted safe, read-only follow-up on F14's finding (a real, credential-bearing `.env.local` in the sibling `f0s-security` scratchpad worktree) and hit a hard tooling boundary, which is itself reported honestly below rather than worked around.

## What was attempted

A safe, prefix-only characterization of the credential values (first ~12 characters of each, e.g. to distinguish a Clerk `sk_test_`/`sk_live_` prefix without exposing the secret) was attempted via a read-only shell command. **This was refused by this environment's own safety controls** ("Credential Materialization" classifier), before any value was displayed. This is a genuine, reportable finding about the boundary of what this agent can safely do here — not a workaround target.

## What is now known, without ever reading a value

- **Providers** (from variable names alone, already established by F14): Clerk (`CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`), a Postgres database (`DATABASE_URL`), Anthropic (`ANTHROPIC_API_KEY`), OpenAI (`OPENAI_API_KEY`).
- **Whether still live**: **cannot be determined by this agent** — that would require either reading the value (blocked) or making a live API call with it (this agent will not do this without explicit authorization, and doing so would itself be a use of a credential this agent has not been asked to use).
- **Whether reused elsewhere**: no other worktree in the same scratchpad parent carries these specific application secrets (F14 already confirmed every sibling worktree besides `f0s-security` carries only a bare `VERCEL_OIDC_TOKEN`). The real Vercel project's own Preview/Production environment variables (confirmed via `vercel env ls`, see F15_PREVIEW_CERTIFICATION.md) are managed separately, inside Vercel's own secret store — this agent has no evidence either way about whether the SAME underlying provider credentials are shared between `f0s-security/.env.local` and the Vercel project's own configured secrets, since neither was read.
- **Never committed to git**: re-confirmed this phase — `git log --all --oneline --source -- .env.local` and the `**/.env.local` pattern both still return zero results; `.env*` remains gitignored (`.gitignore:34` in the main repo).

## Rotation — the hard gate

**Rotation was NOT performed.** This agent has no access to the Clerk dashboard, the Anthropic console, the OpenAI console, or the database provider's own console — rotation is only possible through those providers' own authenticated workflows, which are outside any tool available in this session. Per the task's own explicit fallback:

```
OPERATOR_ACTION_REQUIRED
```

This is marked a **hard Pilot gate** (task's own §11 instruction: "make it a hard Pilot gate if appropriate" — appropriate here, since an un-rotated, potentially-live credential sitting in a local scratchpad directory is a real, unresolved exposure surface regardless of how low-probability actual misuse is).

## What was deliberately NOT done

- The `f0s-security/.env.local` file itself was **not deleted**. It sits in a sibling worktree from a different, already-completed phase, outside this phase's own scope (`f15-pilot-readiness`), and deleting another phase's file without being asked crosses a reversibility line this agent does not cross unilaterally — the file's provenance is now documented (here and in F14's own report) so the human operator can make an informed decision (rotate the credentials, then delete the file, or confirm they are already inert and delete it directly).
- No live API call was made to any of the four providers to test credential validity.

## Recommendation to the human operator

1. Open each provider's own console (Clerk, Anthropic, OpenAI, the database host) and check whether the specific keys in `f0s-security/.env.local` are still active.
2. If active: rotate/revoke them through that provider's own workflow, then update any place that legitimately still needs a working credential (e.g., the real Vercel project's own Preview/Production environment variables, if they are in fact the same values — verify this independently, since this agent could not).
3. Delete `f0s-security/.env.local` once no longer needed for that phase's own historical purpose.
4. This gate (`IVG-F14-06`/`IVG-F15-01`) is not closed until the operator confirms rotation or removal — this agent cannot close it on the operator's behalf.
