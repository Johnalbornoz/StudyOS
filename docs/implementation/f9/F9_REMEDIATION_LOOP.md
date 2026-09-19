# F9 — Remediation Loop (Next-Action Contract)

## Naming note (avoiding a real, confirmed collision)

Two other "what should happen next" concepts already exist and must not be confused with this one:
- `src/services/remediation.service.ts` (Phase 2) — `RemediationPattern`/`RemediationPathState`, a root-cause-concept-scoped repair path, unrelated to simulations.
- F8's `src/lib/teaching/intervention-selection.service.ts::selectIntervention` — recommends WHICH **teaching technique** (`EXPLAIN`/`WORKED_EXAMPLE`/etc.) to use inside one activity, given one diagnosed gap.

F9's own contract answers a third, higher-level question — "which **activity/simulation** should the student do next" — and lives in `src/lib/simulation/next-action.service.ts`, never a file named `remediation.service.ts` (which would collide in spirit, if not in path, with the Phase-2 system).

## The contract (task §32)

```ts
type NextAction =
  | 'REVIEW_KNOWLEDGE' | 'TRAIN_SKILL' | 'TRAIN_TECHNIQUE' | 'TRAIN_FLUENCY'
  | 'MORE_EVIDENCE_NEEDED' | 'RETRY_TOPIC_EXAM' | 'RETRY_DOMAIN_EXAM' | 'MINI_MOCK' | 'FULL_MOCK' | 'CONTINUE_LEARNING';

interface NextActionRecommendation {
  action: NextAction;
  rationale: string[];        // reason codes drawn from the post-exam diagnosis / readiness snapshot
  relatedGapDiagnosisIds: string[];
  relatedInterventionType?: InterventionType;  // F8's own type, only populated for REVIEW_KNOWLEDGE/TRAIN_*
}

function determineNextAction(params: {
  postExamDiagnosis: PostExamDiagnosisResult;   // from F9's own post-exam-diagnosis.service.ts
  readinessSnapshot: ReadinessSnapshot;
  simulationType: SimulationType;
}): NextActionRecommendation
```

Pure function, deterministic given its inputs — no AI call (task §47: AI may not decide readiness/eligibility-adjacent outcomes; this next-action contract is exactly such an outcome).

Decision order:
1. Any `knowledgeGaps`/`skillGaps`/`examTechniqueGaps`/`speedFluencyGaps` non-empty → `REVIEW_KNOWLEDGE`/`TRAIN_SKILL`/`TRAIN_TECHNIQUE`/`TRAIN_FLUENCY` respectively (priority order matches F8's own `mixedGapPriority` default, reused for consistency), with `relatedInterventionType` populated from F8's `intervention-policy.service.ts` active policy's chain for that gap type — **F9 never re-derives which teaching technique to use; it defers to F8's own versioned chain.**
2. All gap lists empty but `insufficientEvidenceAreas` non-empty → `MORE_EVIDENCE_NEEDED`.
3. No gaps, sufficient evidence, `simulationType === 'TOPIC_EXAM'` and readiness for the broader domain is still `EARLY_PREPARATION`/`DEVELOPING` → `RETRY_DOMAIN_EXAM` (encourage the next level up).
4. Analogous escalation for `DOMAIN_EXAM` → `MINI_MOCK` when `readinessSnapshot.overallStatus === 'SIMULATION_READY'`.
5. Analogous escalation for `MINI_MOCK` → `FULL_MOCK` only when `readinessSnapshot.overallStatus === 'FULL_MOCK_ELIGIBLE'`.
6. A prior attempt at the same level with unresolved gaps → `RETRY_TOPIC_EXAM`/`RETRY_DOMAIN_EXAM` (retry before escalating).
7. Otherwise → `CONTINUE_LEARNING` (no urgent gap, no obvious next simulation step — the safe default).

## Boundary (task §32's own closing line, INV-F9-27)

`determineNextAction` returns a **recommendation only**. Nothing in `src/lib/simulation/next-action.service.ts` calls `updateMastery`, writes to any Canonical-V2-owned table, or calls any Canonical V2 progression function — it reads two already-computed, already-persisted results (a post-exam diagnosis, a readiness snapshot) and applies a pure decision table. The caller (a future UI/API layer) decides whether and how to act on the recommendation.
