# 11 — Backup, Restore, and Rollback

**This document reports what really exists, which is less than a Production system needs — stated honestly rather than assumed adequate.**

## Backup/restore

**No backup/restore automation exists anywhere in this codebase.** Confirmed by direct inspection (grep for backup/restore/snapshot tooling — none found) across F15 and re-confirmed this package. No documented RPO (Recovery Point Objective) or RTO (Recovery Time Objective) exists.

**What actually protects the data today**: whatever automatic backup capability the database host (Neon) provides at the infrastructure level — this has **not been independently verified or rehearsed** by this program. It is real infrastructure the operator has access to that this agent-class tooling does not.

**Recommendation (`IVG-F15-10`/R6, DEFERRED, owner: Database operations)**: before real pilot user data accrues, the operator should identify Neon's own backup/point-in-time-recovery offering for this specific project, and rehearse one real restore (to a throwaway branch, not the live database) to confirm it actually works and to establish a real RTO number. This is an infrastructure/operator action, not a code change.

## Application-level rollback

**Real and safe.** Vercel retains every prior deployment; redeploying a previous one (or re-running `vercel deploy` from a prior commit) is a standard, low-risk operation this program has used repeatedly. This is the primary "something broke, revert" mechanism available today.

## Database rollback

**Not guaranteed.** The migration runner (`scripts/db-migrate.ts`) applies migrations forward only — there is no automated "undo the last migration" mechanism. A schema change that needs to be reversed would require either a new, hand-written forward migration that undoes the effect, or restoring from a database-level backup (see above, itself not yet rehearsed).

**What partially mitigates this**: every migration in this program's history has been additive (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) — no migration has ever dropped or destructively altered an existing column. This makes forward-only rollback-by-new-migration realistic in practice, even without a formal down-migration mechanism.

## Neon branch-based rehearsal (the one real "safe trial" mechanism used in this program)

F15-C1 demonstrated a real, working pattern: create a temporary Neon branch off the target database, apply the risky change there first, verify, then apply to the real target only after the rehearsal passes (`f15-migration-trial-20260919`, auto-delete scheduled). **This is a real, repeatable technique** — recommended as the standard procedure for any future schema change against Preview or Production, not a one-off improvisation.

## Status summary

| Capability | Status |
|---|---|
| Database backup automation | **Does not exist** — DEFERRED, operator/infra action |
| Documented RPO/RTO | **Does not exist** — DEFERRED |
| Rehearsed restore drill | **Not performed** — DEFERRED |
| App-level rollback | **IMPLEMENTED**, real, used repeatedly |
| Database rollback (forward-only via new migration) | **IMPLEMENTED as a pattern**, not automated |
| Branch-based migration rehearsal | **IMPLEMENTED and demonstrated** (F15-C1) — recommended standard practice going forward |

**Pilot-blocking?** No — acceptable for a small, closely-operator-watched pilot with modest, backfillable data. **Production-blocking?** Yes — a real backup/restore drill with a documented RPO/RTO is a genuine Production requirement this program has not yet met.
