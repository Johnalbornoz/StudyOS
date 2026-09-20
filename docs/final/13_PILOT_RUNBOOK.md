# 13 — Pilot Runbook

Step-by-step operator runbook to actually run the pilot, once the remaining gate below is closed.

## Pre-flight checklist (must all be true before inviting real pilot users)

- [ ] Credential rotation complete and verified (see [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md)) — **currently OPEN, the sole remaining hard gate**.
- [x] Preview Clerk correctly resolves to StudyOS_App — **LIVE VERIFIED**.
- [x] Preview database fully migrated (32/32) and identity-integrity-verified — **LIVE VERIFIED**.
- [x] `/api/health` live — **LIVE VERIFIED**.
- [ ] Full authenticated E2E matrix executed — **in progress, blocked on operator-assisted login** (this section documents the exact protocol).
- [ ] Pilot cohort restricted to `UNTIMED` exam attempts only (timed modes not yet built).
- [ ] Institution admins onboarded with operator assistance (no curriculum/exam-version picker UI yet).

## Data and user strategy

Reuse the existing, already-certified test-fixture functions used throughout this program's own certification scripts — no new tooling is needed to seed a small pilot cohort. Test identities established for this closure phase:

| Identity | Role | Notes |
|---|---|---|
| Student A | STUDENT | A disposable test identity provisioned by the operator for this closure (email withheld from this document per its own no-personal-data rule; the operator has the credential) |

Additional identities (Teacher, Parent, Institution, multi-role) should be provisioned the same way — through the existing, certified provisioning architecture (`src/services/identity-backfill.service.ts` plus normal Clerk sign-up), never by inserting ad hoc rows directly into `users`/`students`/`profiles`.

## Operator-assisted authenticated E2E protocol (the exact procedure this program uses)

This tooling **cannot** enter a password, OTP, or any other credential on anyone's behalf, and will not create accounts. Every login is performed by a human operator. The exact handoff:

1. This tooling navigates to the target URL and stops the moment Clerk requires sign-in.
2. It reports in this exact format:
   ```
   OPERATOR LOGIN REQUIRED
   Identity: <name/email>
   Expected role/workspace: <role>
   URL: <exact URL>
   Please sign in manually and reply READY.
   ```
3. The operator signs in manually in the same browser session and replies the literal word `READY`.
4. This tooling then drives everything else itself for that identity — navigation, executing the specific test scenario, checking API responses, checking the database read-model, checking negative-authorization boundaries, capturing evidence — without asking the operator to perform the test manually.
5. When the scenario requires a **different** identity (a role switch, a second concurrent session for isolation testing), the tooling stops again and repeats steps 2–4 for the new identity.
6. **Never asked of the operator**: passwords, magic links, verification codes, session tokens, cookies, Clerk tokens, secret keys. No credential is ever printed, inspected, stored, or reported by this tooling.

## The full E2E matrix (to be executed and documented, one identity at a time)

1. Student — self-service navigation, exam start/answer/finish, readiness update.
2. Student — negative authorization (attempt to access another student's session by ID manipulation).
3. Teacher — class/student view, create an intervention.
4. Teacher → Student assignment — full lifecycle including reconciliation.
5. Teacher — negative authorization (attempt access outside an active assignment).
6. Parent — read-model over an accepted relationship; negative case for a non-accepted relationship.
7. Institution — aggregate views, cohort-suppression behavior at the real cohort size.
8. Institution — negative authorization (cross-institution access attempt).
9. Multi-role — a single user with more than one role, confirming each workspace only ever grants its own role's access.
10. Cache/context isolation — two real, concurrent authenticated sessions, confirming no cross-session data leakage.
11. Responsive — authenticated pages at 3 widths (mobile/tablet/desktop), same methodology as the unauthenticated check.
12. Latency — real authenticated-flow response times, at least single-run samples per key route (not a full load test — see [14_PRODUCTION_RELEASE_CHECKLIST.md](14_PRODUCTION_RELEASE_CHECKLIST.md) for that).
13. Session navigation and sign-out — confirms a clean session end, no stale authenticated state.

**MIN_COHORT_POLICY live validation**: if Preview does not currently contain both a suppressed-cohort case and an unsuppressed-cohort case, this is reported as `PARTIAL`/`DEFERRED` — never fabricated as a full PASS.

Each executed case is documented with: what was done, what was observed, and whether it passed, failed, or was partial — in the same evidence style as every other real-Postgres certification in this program.

## Support and incident model during the pilot

See `docs/implementation/f15/F15_SUPPORT_AND_INCIDENT_MODEL.md` for the full Sev1–Sev3 model. Summary: for a small, operator-watched pilot, `/api/health` plus manual log review is the monitoring posture; `AI_ENABLED=false` is the primary partial kill switch; app-level rollback (redeploy a prior Vercel deployment) is the primary containment action for a code-level defect.

## Rollback triggers (when to stop the pilot and roll back)

- A confirmed authorization bypass (any negative-authorization case above fails live).
- A confirmed data-integrity issue (identity backfill counts change unexpectedly, or a broken-link count that was 0 becomes nonzero).
- `/api/health` reporting `degraded` for a sustained period with no operator-initiated cause.
