# F9 — Simulation Plan & Attempt Model

## Table: `simulation_plans` (frozen, immutable once created)

```sql
CREATE TABLE simulation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id),
  exam_version_id uuid NOT NULL REFERENCES exam_versions(id),
  blueprint_id uuid REFERENCES assessment_blueprints(id),
  simulation_type text NOT NULL CHECK (simulation_type IN ('TOPIC_EXAM','DOMAIN_EXAM','MINI_MOCK','FULL_MOCK')),
  readiness_snapshot_id uuid REFERENCES readiness_snapshots(id),
  plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## `plan` shape (task §20's required fields, task §22's determinism boundary)

```ts
interface SimulationPlan {
  simulationType: SimulationType;
  frameworkVersion: { examVersionId: string; blueprintId: string | null };
  selectedTargets: Array<{
    blueprintObjectiveTargetId: string;
    assessmentComponentId: string;
    questionType: string | null;
    difficultyRange: { min: number; max: number } | null;
    reasoningRequirement: string | null;
    commandTermId: string | null;
    allocatedSeconds: number | null;    // null when UNTIMED
  }>;
  timingAllocation: { mode: 'UNTIMED' | 'TRAINING_TIMED' | 'OFFICIAL_SIMULATION_TIMED'; totalSeconds: number | null };
  toolRules: Record<string, Record<string, unknown> | null>;   // keyed by assessmentComponentId
  scoringConfiguration: { scoringModelId: string | null };
}
```

`selectedTargets`, `questionType`, `difficulty`, `commandTermId`, `toolRules`, and `scoringConfiguration` are the deterministic, plan-constrained facts (task §22). AI is never given freedom over any of these — it only fills in wording for whichever target the plan already named (task §21/47). The plan is built once, at the moment a simulation attempt starts, and never recomputed for that attempt afterward.

## Deterministic plan builder (`src/lib/simulation/plan.service.ts`)

```ts
async function buildSimulationPlan(params: {
  studentId: string; examVersionId: string; simulationType: SimulationType;
  learningObjectiveId?: string; academicSubjectId?: string;   // scoping for TOPIC_EXAM / DOMAIN_EXAM
  timingMode: TimingMode;
  readinessSnapshotId?: string;
}): Promise<SimulationPlan>
```

Target selection per level, always reading real blueprint data (F7's `listObjectiveTargets`/the new `listComponentAllocations`), never inventing a target:
- **TOPIC_EXAM**: exactly the one target(s) for the named `learningObjectiveId`.
- **DOMAIN_EXAM**: every target whose component's `academicSubjectId` matches the named subject.
- **MINI_MOCK**: every target whose id is in `canFullMockBeOffered(examVersionId).miniMockObjectiveIds` — the platform's own "safely offerable" list, reused verbatim, never re-derived.
- **FULL_MOCK**: every target in the published blueprint (only reachable once `getSimulationEligibility` already confirmed `eligible: true`).

`timingAllocation.totalSeconds` is `null` for `UNTIMED`; for `TRAINING_TIMED`/`OFFICIAL_SIMULATION_TIMED` it sums each touched component's `duration_minutes * 60` (only computable when every touched component's `timingStatus === 'CONFIGURED'` — otherwise the plan builder throws a typed error rather than silently defaulting to `UNTIMED`, since silently downgrading timing mode would misrepresent what was actually requested). `toolRules` is populated per component from `assessment_components.tool_rules`, `null` for any component left `NOT_CONFIGURED` (never fabricated — task §27, `MINI_MOCK`/`DOMAIN_EXAM` may legitimately proceed with a `null` entry for a component whose tool rules aren't required to be known, but `FULL_MOCK`'s own eligibility check already required every touched component to be `CONFIGURED`, so this can never happen for a Full Mock plan).

## Table: `simulation_attempts` (1:1 wrapper around a real F7 `exam_attempts` row)

```sql
CREATE TABLE simulation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_attempt_id uuid NOT NULL UNIQUE REFERENCES exam_attempts(id),
  student_id uuid NOT NULL REFERENCES students(id),
  exam_profile_id uuid NOT NULL REFERENCES student_exam_profiles(id),
  exam_version_id uuid NOT NULL REFERENCES exam_versions(id),
  simulation_type text NOT NULL CHECK (simulation_type IN ('TOPIC_EXAM','DOMAIN_EXAM','MINI_MOCK','FULL_MOCK')),
  simulation_plan_id uuid NOT NULL REFERENCES simulation_plans(id),
  readiness_snapshot_id uuid REFERENCES readiness_snapshots(id),
  timing_mode text NOT NULL CHECK (timing_mode IN ('UNTIMED','TRAINING_TIMED','OFFICIAL_SIMULATION_TIMED')),
  pause_allowed boolean NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','COMPLETED','ABANDONED')),
  paused_at timestamptz,
  resumed_at timestamptz,
  elapsed_seconds_at_pause integer,
  navigation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  language text NOT NULL,
  timezone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Why a wrapper table, not an F7 schema change (task §23/INV-F9-14):** F7's `exam_attempts.status` CHECK only allows `IN_PROGRESS|COMPLETED|ABANDONED` — no `PAUSED`. Rather than `ALTER`ing a certified F7 constraint (which would require re-certifying every existing F7 caller against a widened enum), F9 adds its own table carrying exactly the new facts (simulation type, plan, timing mode, pause state, navigation state) with a 1:1 FK to the real `exam_attempts` row F7's own `startExamAttempt` creates. `exam_attempts.frozen_configuration` remains F7's own immutability mechanism for exam-version/blueprint facts; `simulation_attempts` is F9's own immutability mechanism for simulation-specific facts, frozen at the same moment.

## Attempt lifecycle (`src/lib/simulation/attempt.service.ts`)

```ts
async function startSimulationAttempt(params: { ...buildSimulationPlan params..., institutionExamPolicyId?: string }): Promise<{ examAttempt: ExamAttempt; simulationAttempt: SimulationAttempt; plan: SimulationPlan }>
async function pauseSimulationAttempt(id: string): Promise<SimulationAttempt>
async function resumeSimulationAttempt(id: string): Promise<SimulationAttempt>
async function abandonSimulationAttempt(id: string): Promise<SimulationAttempt>
async function completeSimulationAttempt(id: string): Promise<SimulationAttempt>
```

- `startSimulationAttempt`: builds the plan (frozen), calls F7's real `startExamAttempt` (frozen configuration), inserts the `simulation_attempts` row referencing both — all in one transaction.
- `pauseSimulationAttempt` (task §25): only permitted when `pause_allowed = true` on the attempt (set at creation from `timingMode !== 'OFFICIAL_SIMULATION_TIMED'` — official simulation timing never permits pause; Training and Mini Mock may, per their own policy, never hard-coded globally). Records `paused_at`, and `elapsed_seconds_at_pause` (computed from `started_at`/prior pause cycles) so a resumed attempt's remaining time is exact, not reset.
- `resumeSimulationAttempt`: only from `PAUSED`; clears `paused_at`, stamps `resumed_at`.
- `completeSimulationAttempt`/`abandonSimulationAttempt`: transition `simulation_attempts.status`, then call F7's real `completeExamAttempt` to keep the underlying `exam_attempts.status` in sync — F9 never leaves the two tables' status out of sync.
- The underlying `exam_attempts` row is never touched by `pause`/`resume` — F7's own status stays `IN_PROGRESS` throughout a pause cycle, since F7's schema has no pause concept and F9 does not force one into it (see rationale above).

## Navigation (task §26)

`navigation_state` stores `{currentTargetIndex, visitedTargetIds, mode}` where `mode` is copied verbatim from `exam_versions.navigation_rules` (an existing, previously-inert F7 column — F9 is its first real reader) when present, or `'UNKNOWN'` when absent. **Unknown navigation rules are never invented** (task §26's explicit prohibition) — an `'UNKNOWN'` mode defaults to the most permissive real behavior (free navigation) rather than guessing a restrictive one, and this default is itself recorded as a `limitations` entry on the attempt so it's never silently indistinguishable from a genuinely-configured free-navigation mode.
