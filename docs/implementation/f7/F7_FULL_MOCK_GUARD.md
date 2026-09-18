# F7 — Full Mock Guard

## `canFullMockBeOffered(examVersionId)` (task §34)

A pure, read-only readiness check — never the simulator itself (task's own instruction: "do not
build the final simulator yet"). Prepares F9.

```ts
interface FullMockReadiness {
  ready: boolean;
  reasons: string[];       // empty when ready: true
  miniMockObjectiveIds: string[]; // the subset that WOULD pass, even when the full set doesn't
}
```

## Checks (task §9, in order, each with its own explicit reason string)

1. A `PUBLISHED` `assessment_blueprints` row exists for the exam version — else
   `"NO_PUBLISHED_BLUEPRINT"`.
2. `exam_versions.scoring_model_id` is not null — else `"NO_SCORING_MODEL_CONFIGURED"`.
3. Every `assessment_components` row referenced by the blueprint's component allocations has
   `support_status = 'SUPPORTED'` — else `"UNSUPPORTED_COMPONENT: <name>"` per offending
   component.
4. Every such component has `timing_status = 'CONFIGURED'` — else `"TIMING_NOT_CONFIGURED:
   <name>"`.
5. Every such component has `tool_rule_status = 'CONFIGURED'` — else `"TOOL_RULES_NOT_CONFIGURED:
   <name>"`.
6. Every `blueprint_objective_targets` row's `learning_objective_id` has at least one `PUBLISHED`
   `objective_concept_mapping` or `objective_skill_mapping` — else `"OBJECTIVE_NOT_MAPPED:
   <objectiveId>"` per offending objective.

`ready` is `true` only when **zero** reasons were collected. Otherwise `ready: false` with every
applicable reason listed — never just the first one found, so a caller (or a human debugging
configuration) sees the complete picture in one call.

## Mini Mock (task §9's second sentence)

`miniMockObjectiveIds` always reports the objectives that individually pass check 6 **and** whose
component passes checks 3-5, regardless of whether the overall blueprint passes — this is the
"scope is clear" partial simulation the task allows even when a Full Mock cannot be offered. It is
computed in the same function call, from the same underlying checks, so it can never silently
drift from the Full Mock verdict's own reasoning.

## Not implemented in F7 (explicitly deferred to F9)

- No actual timed session, no navigation engine, no score aggregation across components — this
  guard answers "could a mock be assembled," never assembles one.
- No readiness-score/prediction — that is a different, explicitly out-of-scope concept (task §47).
