# F9 — PAA Simulation Certification

## What the certification fixture builds (task §42)

A self-contained, explicitly-labeled certification fixture (never claimed as real PAA content), seeded fresh inside F9's own ephemeral Postgres cert run (mirroring F7/F8's own precedent — no fixture data from any prior phase's cert script persists into F9's run, per the current-state assessment §4):

- **PAA Mathematics** (supported domain): 1 academic subject, 1 structure/objective, 1 `SUPPORTED` component (timing + tool rules configured), 1 blueprint objective target — mirrors F7/F8's own Mathematics fixture shape.
- **PAA Reading** (unsupported domain, deliberately): 1 academic subject, 1 structure/objective, 1 component left genuinely `UNSUPPORTED` (nothing configured) — this is the fixture's second blueprint-referenced domain, present specifically so `getFullMockDomainCoverage` has two real subjects to compare, and specifically left broken so the certification proves the guard *correctly refuses* rather than *happens to pass* on a lucky single-domain configuration.
- A learner student with real, sufficient learning evidence against the Mathematics objective (for readiness-dimension certification) and zero evidence against Reading (for coverage-gap certification, case G).

## Expected, truthful certification outcome (task §43/§75)

```
PAA_FULL_MOCK: NOT_READY
Reasons:
  - MANDATORY_DOMAIN_INCOMPLETE: PAA Reading (component UNSUPPORTED)
```

This is a **PASS condition for F9**, not a failure (task §75's own explicit framing) — it demonstrates:
1. `getFullMockDomainCoverage` correctly identifies both blueprint-referenced subjects (Mathematics, Reading) rather than trusting the free-text `domains` metadata.
2. `getFullMockEligibility` correctly blocks on the Reading subject's incomplete component, with a specific, actionable reason naming the subject and the real blocking condition — never a generic "not ready."
3. The Mathematics-only slice remains fully usable for Topic Exam, Domain Exam, and (if its own objective target is in `miniMockObjectiveIds`) Mini Mock — proving INV-F9-23's independence in practice, not just in code review.

No fake completeness is ever seeded merely to force a `PASS` on the Full Mock guard (task §43's explicit prohibition) — the Reading component is left genuinely, deliberately unsupported.

## What IS demonstrated working end-to-end for PAA (task §18)

- **PAA Mathematics Topic Exam**: eligible and planned (one target, one objective).
- **PAA Mathematics Domain Exam**: eligible and planned (all Mathematics-subject targets).
- **PAA Mini Mock**: eligible if the Mathematics target lands in `canFullMockBeOffered`'s own `miniMockObjectiveIds` (it does, since the Mathematics component is fully `SUPPORTED`) — explicitly labeled `MINI MOCK` throughout its own plan/attempt records, never presented as Full Mock (task §14's own requirement).
- **PAA Full Mock guard**: correctly returns `BLOCKED`/`NOT_READY` with the exact reason above.
- **Post-exam diagnosis and readiness recomputation**: exercised against the Mathematics Topic/Domain/Mini Mock attempts, proving the full pipeline (attempt → evidence → F8 diagnosis → readiness snapshot) works end-to-end even while Full Mock itself remains correctly blocked.

## Contrast framework (task §19)

The Cambridge IGCSE fixture from F7/F8 (same canonical concept as PAA Mathematics, different `academic_programme`/`academic_organization`) is reused as architectural contrast: F9's certification confirms the SAME canonical knowledge produces genuinely different `FrameworkIdentity` and a genuinely different (and, in this fixture, equally incomplete) simulation configuration under Cambridge — never claiming full Cambridge mock support from a fixture this small, exactly as task §19 requires. No new concepts are duplicated to achieve this contrast; the existing shared canonical concept is reused verbatim.
