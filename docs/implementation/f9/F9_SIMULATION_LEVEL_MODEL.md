# F9 — Simulation Level Model

Four explicit, separately-eligible levels (task §11), never conflated:

```ts
type SimulationType = 'TOPIC_EXAM' | 'DOMAIN_EXAM' | 'MINI_MOCK' | 'FULL_MOCK';
```

## Eligibility (`src/lib/simulation/eligibility.service.ts`)

```ts
interface SimulationEligibility {
  simulationType: SimulationType;
  eligible: boolean;
  reasons: string[];               // blocking reasons when eligible=false
  structuralReadiness?: FullMockReadiness;  // present only for FULL_MOCK/MINI_MOCK -- F7's own guard, passed through unmodified
}

async function getSimulationEligibility(params: {
  studentId: string; examVersionId: string; simulationType: SimulationType;
  learningObjectiveId?: string;      // required for TOPIC_EXAM
  academicSubjectId?: string;        // required for DOMAIN_EXAM
}): Promise<SimulationEligibility>
```

### TOPIC_EXAM (task §12)

Targets one canonical concept / learning objective / structure node / skill cluster, per framework configuration. Eligible iff: the named `learningObjectiveId` has at least one `blueprint_objective_target` whose component `supportStatus === 'SUPPORTED'` and whose mapping resolves (`classifyBlueprintTargetCoverage` result is `SUPPORTED_AND_EVIDENCED` or `SUPPORTED_BUT_UNEVIDENCED` — either way the platform can *offer* it; whether the learner *should* take it is a readiness question, not an eligibility one, per task §16's F7/F9 split). Never claims full exam simulation (task §12's own explicit boundary) — this is enforced by the Simulation Plan builder only ever selecting the one named target, never sampling a blueprint.

### DOMAIN_EXAM (task §13)

Evaluates one `academicSubjectId`'s slice of the blueprint. Eligible iff: at least one blueprint objective target under that subject is platform-supported and mapped (same per-target check as Topic Exam, applied to every target in the subject rather than one), using published mappings, supported question types, valid scoring, and — only if the caller requests a timed attempt — a `CONFIGURED` timing status on every component touched. Never claims whole-exam readiness (task §13) — enforced by the plan builder only ever selecting targets under the requested subject.

### MINI_MOCK (task §14)

A blueprint-sampled, reduced simulation. Eligibility reuses F7's `canFullMockBeOffered(examVersionId).miniMockObjectiveIds` directly — that array is *already* "every objective target that is fully supported+mapped," exactly what a reduced-but-honest sample needs. `eligible = miniMockObjectiveIds.length > 0`. **Full Mock unavailable never implies Mini Mock unavailable** (INV-F9-23) — this is structural: Mini Mock's eligibility check never inspects `canFullMockBeOffered.ready` (the all-or-nothing flag), only the non-empty objective-id list it computes regardless of `ready`.

### FULL_MOCK (task §15)

Eligible iff **all** of: `canFullMockBeOffered(examVersionId).ready === true` (F7's structural guard, called unmodified) **and** every mandatory domain/component the exam actually requires is covered by that guard's success (see `F9_FULL_MOCK_ELIGIBILITY.md` for how "mandatory domain" is determined without guessing). If any mandatory condition fails: `FULL_MOCK = BLOCKED`, with the guard's own `reasons` array surfaced verbatim plus any F9-added domain-completeness reasons — never a fabricated pass.

## The F7/F9 question split (task §16), restated as code

```ts
// F7 -- structural, exam-version-scoped, no student involved:
const platformCapability = await canFullMockBeOffered(examVersionId);

// F9 -- student-scoped, layered ON TOP, never replacing the above:
const learnerShouldTakeItNow = platformCapability.ready && readinessSnapshot.overallStatus === 'FULL_MOCK_ELIGIBLE';
```
`getSimulationEligibility` answers only the first question (can the platform offer it at all). Whether a specific learner is ready to take it now is answered separately by the Readiness Engine's `overallStatus`, and the two are never merged into one boolean — a route consuming both surfaces them as two distinct fields, never collapsed (INV-F9-08 applied to simulation eligibility, not just blueprint coverage).
