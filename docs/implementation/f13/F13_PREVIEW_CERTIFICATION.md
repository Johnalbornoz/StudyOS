# F13 — Preview Certification

## Status: DEFERRED (safety + tooling), not falsely reported as PASS

## Remote Vercel Preview deployment: not attempted

Identical situation to F12: no Vercel CLI or `.vercel` project linkage is available in this session. Per task section 43's own safety requirement ("Before deployment: verify canonical Vercel project linkage... Do not create a stray project"), a deployment cannot be safely attempted without that verification succeeding first. No remote deployment was attempted. Registered as `IVG-F13-01`.

## Local dev server boot check — performed, with an important safety finding

Unlike F12 (no `.env.local` at all), this worktree's `npm run dev` DID find a working `.env.local` and successfully connected to a real Clerk development instance (`shining-impala-8101.clerk.accounts.dev`) and — presumably — a real, unidentified database. **This was not expected** (an earlier file-existence check in this same session returned no `.env.local`/`.env*` file via `ls`/`find`, yet the dev server's own log stated `Environments: .env.local` and Clerk loaded real keys) — the discrepancy was not fully root-caused (possibly a working-directory or Turbopack root-resolution quirk specific to this git-worktree setup).

**Safety decision made**: given the inability to confirm with confidence what database/environment this dev server was actually connected to, no authenticated action, sign-in, or write of any kind was performed against it. The ONLY action taken was loading the public, unauthenticated marketing page (`http://localhost:3000` → redirected to `/es`) and taking one screenshot to confirm the build artifact renders correctly — a genuine, safe, read-only sanity check, not a full visual acceptance pass. The server was stopped immediately afterward.

## What this DOES prove

The production build this phase produced (including every new Teacher/Institution page, the modified layout/shell, and the extended i18n dictionary) boots without a server-side crash and renders its first real page correctly, in the correct default locale (`es`).

## What this does NOT prove, and is not claimed to prove

Any authenticated page (Student/Parent/Teacher/Institution dashboards) was NOT visually verified in a live browser this phase. This is a genuine, disclosed limitation — not a shortcut dressed up as a pass. See `F13_JOURNEY_CERTIFICATION.md` and `F13_IVG_DEFERRED_TEST_REGISTER.md` (`IVG-F13-02/03`).

## Why this does not block PASS_TO_F14 (task section 66's own explicit allowance, carried forward from F12's identical precedent)

Local/ephemeral real-Postgres authorization and domain-logic regression are fully proven (16 certification scripts, all passing, unchanged). Remote Preview and live authenticated visual/accessibility verification remain unproven and are explicitly registered, never claimed as PASS.
