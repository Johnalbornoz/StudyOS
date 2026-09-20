# 10 — Operations, Monitoring, and Incidents

## `/api/health` (new, F15-C1)

```
GET /api/health
200 {"status":"ok","checks":{"database":"ok"}}         -- database reachable
503 {"status":"degraded","checks":{"database":"fail"}}  -- database unreachable
```

Reuses the existing, already-certified `testDB()` (`src/lib/db.ts`) — no second ad hoc connectivity check. Never exposes the underlying DB error detail (unit-tested explicitly for this). **IMPLEMENTED, TESTED (3 unit tests), LIVE VERIFIED** (`curl`'d against the live Preview deployment, returned `200 {"status":"ok"}`).

This closes `IVG-F15-13` and is the one standard uptime-monitoring target this system has ever had — point any external monitor (UptimeRobot, a Vercel-native check, etc.) at this path.

## Observability model (F15)

A minimal, real pilot-event model exists, matching the pre-existing AI logger's own style: 8 events wired across 6 routes (`ai_execution_events`, `decision_events`, `validation_events`, `analytics_events` and siblings). **IMPLEMENTED, TESTED.**

**Known gap, disclosed**: correlation-id threading is not yet end-to-end — a utility exists but isn't wired through every downstream log call. **DEFERRED** (`IVG-F15-05`), owner: Observability. Acceptable for a small pilot where logs are read manually; a real Production requirement beyond that.

## Monitoring/alerting/incident communication

**No paging/alerting/incident-communication tooling exists.** (`IVG-F15-11`, **DEFERRED**.) Acceptable for a pilot the operator watches directly; `/api/health` gives at least one cheap thing to point a future alert at. A genuine gap beyond a small, closely-watched pilot.

## Incident severity model (F15, real, documented — not yet exercised on a real incident)

A support/incident severity model was defined (see `docs/implementation/f15/F15_SUPPORT_AND_INCIDENT_MODEL.md`) covering Sev1–Sev3 classification and expected response posture for a small pilot. **IMPLEMENTED** as a documented process; **not yet exercised** against a real incident (no incident has occurred in this program's history).

## Kill switches

`AI_ENABLED=false` is a real, working partial containment — disables AI-generation-dependent paths. No dedicated flag exists yet for Exam Prep / Teacher assignments / Institution Intelligence specifically (`IVG-F15-12`, **DEFERRED**) — see [07_AI_ARCHITECTURE_AND_SAFETY.md](07_AI_ARCHITECTURE_AND_SAFETY.md).

## Rollback

App-level rollback (redeploying a prior Vercel deployment) is real and safe — Vercel's own deployment history makes this trivial and is the primary mechanism this program relies on. **Database rollback is honestly not guaranteed** — see [11_BACKUP_RESTORE_AND_ROLLBACK.md](11_BACKUP_RESTORE_AND_ROLLBACK.md).

## Status summary

| Capability | Status |
|---|---|
| `/api/health` | **LIVE VERIFIED** |
| Structured AI/decision/validation event logging | **IMPLEMENTED, TESTED** |
| Correlation-id end-to-end threading | **DEFERRED** |
| Paging/alerting | **DEFERRED** (no tooling exists) |
| Incident severity model (documented) | **IMPLEMENTED**, not yet exercised |
| App-level rollback | **IMPLEMENTED**, real and safe |
| Distributed/multi-instance-aware rate limiting | **DEFERRED** — see [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md) |
