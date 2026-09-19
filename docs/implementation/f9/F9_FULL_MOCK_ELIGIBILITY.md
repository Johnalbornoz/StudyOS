# F9 — Full Mock Eligibility

## Mandatory-domain determination (task §15/§17) — from configuration, never assumption

"Mandatory domain/component" is determined the only way that cannot be gamed or guessed: **every `assessment_component` row that actually exists for the exam version, cross-referenced with every `academic_subject` any `blueprint_objective_target` under that version actually touches.** F9 does **not** trust `exam_definitions.domains text[]` (confirmed in the current-state assessment to be free-text metadata nothing validates) as a source of truth for what's "required" — it is asserted intent, not modeled structure. The real, load-bearing question is: does the **published blueprint** (the actual sampling contract) reference this subject/component at all, and if so, is it fully supported?

```ts
async function getFullMockDomainCoverage(examVersionId: string): Promise<{
  requiredSubjects: Array<{ academicSubjectId: string; academicSubjectName: string }>;
  coverageBySubject: Array<{ academicSubjectId: string; fullyCovered: boolean; blockingReasons: string[] }>;
  allDomainsCovered: boolean;
}>
```

`requiredSubjects` = the distinct `academic_subject_id`s reachable from the published blueprint's own objective targets (via each target's component). This is real, reproducible, and never invented — a domain the blueprint doesn't even reference cannot be "required" by any honest reading of the configuration (INV-F9-21's own logic: PAA cannot be certified from Mathematics alone specifically *because* a real PAA blueprint would reference Reading/Writing/English subjects too, and F9 must actually check for their presence, not assume them away or assume them present).

## Full Mock eligibility (task §15/§21/§22, extending F7's guard)

```ts
async function getFullMockEligibility(examVersionId: string): Promise<SimulationEligibility>
```
1. Call F7's `canFullMockBeOffered(examVersionId)` verbatim — structural per-target checks (support/timing/tool-rules/mapping).
2. Call `getFullMockDomainCoverage(examVersionId)`.
3. `eligible = platformCapability.ready && domainCoverage.allDomainsCovered`.
4. `reasons` = the union of `platformCapability.reasons` and any subject with `fullyCovered: false`, each subject's own `blockingReasons` prefixed with `MANDATORY_DOMAIN_INCOMPLETE: <subjectName>`.

**If any mandatory condition fails: `FULL_MOCK = BLOCKED` with explicit reason codes** (task §15's own requirement) — never a partial pass, never a fabricated `ready: true`.

## PAA-specific gate (task §17, INV-F9-21/22)

No PAA-specific code branch exists anywhere (per the established "framework is data, never a hardcoded conditional" discipline carried from F7/F8) — `getFullMockDomainCoverage`/`getFullMockEligibility` are generic over any `examVersionId`. PAA's own eligibility result is simply whatever this generic function returns when given PAA's real `examVersionId`. Per the current-state assessment's confirmed finding, this means: **in this repository's actual configuration, PAA's real Full Mock eligibility is `BLOCKED`**, because no real PAA exam version currently has a published blueprint referencing more than one `academic_subject` (Mathematics). This is not a limitation of the eligibility function — it is the function correctly reporting the truth about what exists (INV-F9-21's own point: a Full Mock cannot be certified from Mathematics coverage alone, and it is not).

## Certification's own PAA fixture (task §18/§42/§43)

F9's certification seeds a **deliberately minimal, explicitly-labeled certification fixture** — never a claim of real PAA content — adding a **second** subject/component/blueprint-target set (e.g. a small "Reading" slice) alongside the existing Mathematics one, specifically to prove the eligibility function's own logic works correctly across ≥2 domains (task §42's "at least two blueprint areas/domains" requirement), not to claim PAA is fully modeled. Even with 2 domains present, the certification fixture explicitly does **not** claim `FULL_MOCK: PASS` for PAA — the fixture's second domain is deliberately left with one component `UNSUPPORTED`, so the guard is proven to correctly still report `NOT_READY`/`BLOCKED`, distinguishing "the guard works" from "PAA is fully modeled." See `F9_PAA_SIMULATION_CERTIFICATION.md` for the exact fixture shape and the resulting (truthful) certification outcome.

## Mini Mock independence (INV-F9-23, restated)

`getFullMockEligibility`'s `false` result never touches `getSimulationEligibility('MINI_MOCK', ...)`'s own check (`miniMockObjectiveIds.length > 0`, computed by F7's guard regardless of its own `ready` flag) — the two are computed by entirely separate function calls with no shared early-return, so a structural inability to offer Full Mock cannot accidentally cascade into blocking Mini Mock.
