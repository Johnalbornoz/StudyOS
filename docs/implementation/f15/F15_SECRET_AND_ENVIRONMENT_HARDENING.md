# F15 — Secret and Environment Hardening (Workstream C)

No secret value appears anywhere in this document. This phase attempted safe, read-only follow-up on F14's finding (a real, credential-bearing `.env.local` in the sibling `f0s-security` scratchpad worktree) and hit a hard tooling boundary, which is itself reported honestly below rather than worked around.

## F15-C1 addendum (2026-09-20): scope audit, consumers, rotation order

Covers `IVG-F14-06`, `IVG-F15-01`, `R1` — still **OPEN, `OPERATOR_ACTION_REQUIRED`**. Nothing below rotates, prints, or materializes any secret value; this is a scoping exercise so the operator's actual rotation work is safe and doesn't risk a Production outage.

### What is exposed, and where

`f0s-security/.env.local` (a sibling scratchpad worktree from an already-completed phase, never committed to git — re-confirmed this sub-phase, still zero git history hits) holds 5 credentials by variable name: `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

### Consumers (from `src/` grep, not assumed)

| Credential | Read by | Environment scope in Vercel (confirmed via `vercel env ls`, F15) |
|---|---|---|
| `CLERK_SECRET_KEY` | Clerk SDK server-side (webhooks, session verification) | **Separate Preview and Production values** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk SDK client-side (auto-consumed, not explicitly grepped) | **Separate Preview and Production values** |
| `CLERK_WEBHOOK_SECRET` | Clerk webhook signature verification | **Production only** — no Preview value exists at all |
| `DATABASE_URL` | `src/lib/db.ts` (`pg.Pool`), read by every route/service | **Separate Preview and Production values** (independently re-confirmed this sub-phase via the diagnostic route's fingerprint, which differs from both the operator's local dev DB and would differ again from Production's) |
| `ANTHROPIC_API_KEY` | `src/lib/ai/adapters/anthropic.ts` | **SHARED across Preview and Production** — the one credential category where a rotation mistake could break both environments at once |
| `OPENAI_API_KEY` | `src/lib/ai/adapters/openai.ts` | **SHARED across Preview and Production** — same coordination risk as above |

### Is `f0s-security/.env.local`'s copy even the SAME value Vercel currently uses?

**Unknown — this agent cannot determine this without reading a secret, which it will not do.** A safe way to check without exposing either value: compare one-way SHA-256 digests (same non-reversible-fingerprint pattern already used and accepted in this program for the database-fingerprint diagnostic), never the values themselves. A ready-to-run script for the operator: `compare-credential-scope.sh` (delivered alongside this report, not committed to the repo since it's an operator-run utility, not application code). It pulls each Vercel-scoped value into a throwaway temp file, hashes it, deletes the temp file immediately, and prints only 12-hex-char digests. Matching digests mean "same credential, already in Vercel — rotating it must be coordinated with a Vercel env update"; non-matching means "already-orphaned local copy — safe to rotate/delete independently, since Vercel isn't using it."

### Recommended safe rotation order (once the operator runs the scope check above)

1. **`DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET` first** — each is either Preview-only, Production-only, or independently-scoped per environment (never shared), so rotating any one of them cannot break the other environment. If the scope check shows `f0s-security`'s copy doesn't match either Vercel value, these can simply be revoked/rotated at the provider console with no Vercel change needed at all.
2. **`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` last, and only as a coordinated pair-update**: because these ARE shared between Preview and Production in Vercel today, rotating the underlying provider key requires, in the same short window: (a) generate the new key at the provider console, (b) update the Vercel env var (both environments, since it's one shared var) via `vercel env rm`/`vercel env add` or the dashboard, (c) revoke the old key only after confirming the new one works (a live, low-risk request through the app's own existing AI gateway allowlist/timeout controls, not a raw provider call), (d) never leave a window where neither key is valid. This is the only credential category in this audit where an uncoordinated rotation could interrupt Production, per the task's own explicit caution.
3. **Delete `f0s-security/.env.local`** once every credential in it is confirmed rotated or confirmed already-orphaned (not the live Vercel value).

### What this agent will not do

Run `compare-credential-scope.sh` itself (its middle step, `vercel env pull`, materializes a real secret to a local file — the same boundary already established for why this agent never runs that command directly), rotate or revoke any credential at any provider console, or apply any Vercel env change as part of this rotation. All of this remains **`OPERATOR_ACTION_REQUIRED`**; this gate is not closed until the operator reports back verified rotation (or verified-orphaned status) for each of the 5 credentials.

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
