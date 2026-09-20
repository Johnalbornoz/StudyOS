# F15 — Preview Certification (Workstream D)

## Status: A REAL PREVIEW WAS ESTABLISHED — a genuine change from F12/F13/F14's own DEFERRED status

## What was found (corrects F12/F13/F14's own repeated claim of "no Vercel CLI/.vercel linkage available")

- `.vercel/project.json` exists on disk in the original repository checkout (`/Users/jalbornoz/PROYECTOS/studyos/.vercel/project.json`, gitignored — never copied into any of this program's many `git worktree add` checkouts, which is why every prior phase's own worktree found it "missing"). Content (no secrets): `{"projectId":"prj_1JQCY5njzWdkXBDXgV05NHVahfyS","orgId":"team_VS9MsaoNNCt3zZc8PjPyTGga","projectName":"study-os"}`.
- `npx vercel --version` succeeds (auto-installs `vercel@59.23.2`). `npx vercel whoami` returns an authenticated account (`john-4834`).
- `npx vercel teams ls` shows a real team, `study-so` (Pro plan). `npx vercel project ls --scope study-so` shows the real project, `study-os`, with a live Production URL (`https://www.studyus.pro`).
- `npx vercel env ls` (after copying `.vercel/project.json` into this worktree — a link/identifier file, not a secret) confirms **real environment separation already exists at the platform level**: `DATABASE_URL` and `CLERK_SECRET_KEY` each have SEPARATE Preview and Production values (values shown as `Hidden`, never read). `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` also has separate Preview/Production values. `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` are shared across both environments (a real, disclosed choice — not fixed this phase, since rotating/splitting a shared AI provider key was outside this phase's authorized scope and not proven necessary). `CLERK_WEBHOOK_SECRET` exists only for Production — Preview has no webhook secret configured at all.

## Deployment performed

```
npx vercel deploy --yes   (default target: Preview -- NEVER --prod)
```

Result:
```
Preview URL:     https://study-eyk5bqcsj-study-so.vercel.app
Deployment ID:   dpl_B2xeHtPKgeMcZyfPoDQGDFxnqax3
target:          null            <-- confirms Preview, never Production
readyState:      READY
Branch/commit:   f15/pilot-readiness-production-hardening (this phase's own worktree state at deploy time)
```

No `--prod` flag was ever passed. No Production environment variable was read, written, or referenced.

## What this proves

The build (including every F14 and F15 change: Exam Prep, Assignments, Institution pages, the new item-by-item exam-taking flow, MIN_COHORT_POLICY) compiles and boots successfully on real Vercel infrastructure. The public, unauthenticated marketing page was verified rendering correctly (Spanish locale, matching F13's own prior local-only check, this time on real infrastructure).

## A real, new, Preview-blocking defect found by actually loading the Preview

Navigating to `/sign-in` on the real Preview URL renders: **"Sign in to PMO OWN"** — not StudyUS. This is a strong signal that the Preview environment's `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (and/or `CLERK_SECRET_KEY`) is misconfigured to point at a **different Clerk application** entirely (a separate, unrelated project visible in the same Vercel account under the personal `jalbornoz` scope, `own-pmo`). This was found by direct observation (opening the real URL and reading the rendered page), not assumed.

**No further interaction was performed on this authentication surface** once this was observed — no sign-in attempt, no credential entry, nothing that could touch an unrelated tenant's real user base. This is reported as a hard blocker, not worked around.

This is a genuinely new, actionable, Preview-specific finding this phase's own real-infrastructure testing surfaced that no prior phase could have found (they never had a working Preview to load at all).

## Why this does not enable full authenticated E2E this phase

Even setting the Clerk misconfiguration aside, this agent is categorically prohibited from creating accounts or entering credentials/passwords on the user's behalf (a fixed tool-use boundary, not an environment-safety judgment call). So authenticated E2E on Preview requires BOTH: (1) the operator fixing the Clerk publishable/secret key for the Preview environment, AND (2) either operator-supplied test credentials this agent can use, or the operator executing the authenticated journeys themselves (optionally narrated/guided by this agent).

## Recommendation

1. **Operator action required**: in the Vercel dashboard, under `study-so/study-os` → Settings → Environment Variables, verify `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (and `CLERK_SECRET_KEY`) for the **Preview** environment actually point at StudyUS's own Clerk application, not `own-pmo`'s.
2. Once corrected, re-run this same `vercel deploy` command (or push this branch, if a Git integration triggers Preview builds automatically) and re-verify `/sign-in` renders "Sign in to StudyUS."
3. Only then should real authenticated E2E (Workstream E) be attempted, ideally with the operator either supplying disposable test credentials or executing the flows directly.

## IVG registration

`IVG-F15-02`: Preview Clerk misconfiguration must be fixed and re-verified before authenticated E2E can be attempted. `IVG-F13-01` (no Preview) is now **RESOLVED** (a real Preview deployment exists) but superseded in practice by this new, more specific blocker.
