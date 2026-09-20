# F15 — Backup / Recovery Model

## What was found (real, not assumed)

No backup or restore automation of any kind exists in this repository. `scripts/` and `scripts/operations/` contain migration, certification, seeding, and AI-limit test utilities only — grepped explicitly for "backup"/"neon"/"restore" across the entire `scripts/` tree this phase; zero matches. This corrects an inaccurate claim from an earlier, unreliable research pass in this same session (which cited specific backup/restore script filenames that do not actually exist — flagged and independently verified, matching this whole program's own repeated discipline of never trusting an automated research pass without direct confirmation).

## What IS known

`DATABASE_URL` is a generic Postgres connection string (variable name only — the actual provider was not identified, since reading the value is the exact "credential materialization" action this environment's own safety controls block, per F15_SECRET_AND_ENVIRONMENT_HARDENING.md). Whatever managed Postgres provider Vercel's `study-so/study-os` project points at almost certainly offers its OWN backup mechanism (point-in-time recovery is standard for most managed Postgres providers, e.g. Neon, Supabase, RDS) — but this agent has no access to that provider's own dashboard to confirm which one, what its retention window is, or what its actual RPO/RTO guarantees are.

## Honest answers to the task's own explicit questions

| Question | Answer |
|---|---|
| What is backed up? | **Unknown to this agent.** Whatever the database provider backs up by default — not independently configured by this codebase (no backup script exists here). |
| How often? | **Unknown.** Provider-dependent, not configured in this repository. |
| How to restore Preview/Pilot? | **Unknown/undocumented.** No restore script or runbook exists in this repository. |
| Who operates restore? | **The human operator**, via whatever console the actual database provider offers — this agent cannot perform a restore itself (no destructive/write access should ever be exercised against a real database by this agent regardless). |
| What data may be lost? | **Unknown** without knowing the provider's actual backup frequency/retention. |
| RPO? | **Not established.** No documented target exists anywhere in this codebase. |
| RTO? | **Not established.** No documented target exists anywhere in this codebase. |

This is reported honestly per the task's own explicit instruction ("Do not invent guarantees the provider does not offer... this can be a documented operational model if no restore exercise is safe yet") — no restore exercise was performed (would require real, destructive-adjacent access this agent does not have and should not exercise unilaterally), and no number is fabricated.

## Recommendation before Pilot (operator action required)

1. Identify the actual managed Postgres provider behind `DATABASE_URL` (Preview and Production may differ, per F15_PREVIEW_CERTIFICATION.md's own finding that they are already separate credentials).
2. Confirm that provider's own backup/point-in-time-recovery offering and its real retention window.
3. Perform at least one real, deliberate restore drill against a throwaway/Preview-class database (never Production) to establish real RTO evidence, then document it here.
4. Set explicit RPO/RTO targets appropriate for a controlled pilot (e.g., "RPO: whatever the provider's point-in-time recovery grants, typically minutes; RTO: time-to-operator-availability plus provider restore time") once the provider's real capability is known.

This gate is not closed — `IVG-F15-10`.
