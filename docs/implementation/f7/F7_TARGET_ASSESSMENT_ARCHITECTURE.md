# F7 — Target Assessment Architecture

## Design principle (task §2)

One configurable engine, versioned framework rules — never a bespoke engine per exam family. PAA,
IB, Cambridge, Saber all become **data** (rows) in the same schema, distinguished by
`exam_definitions`/`exam_versions` configuration, never by a `switch(examFamily)` in code.

```
exam_definitions (family/category, org link to F6 academic_programmes, purpose, domains)
        │ 1:N
exam_versions (DRAFT→PUBLISHED→SUPERSEDED→RETIRED, frozen at attempt time)
        │ 1:1                    │ 1:N                       │ 0/1
assessment_blueprints    assessment_components      scoring_models (referenced, nullable)
        │ 1:N              (modality, timing_status/
        │                   duration, tool_rule_status/
blueprint_objective_targets   rules, support_status)
   (→ F6 learning_objectives,
    →  command_terms, difficulty
    range, reasoning_requirement)

command_terms (small reference table, mirrors F4's skills/competencies)

approved_item_families / approved_items (own DRAFT..PUBLISHED workflow,
  independent of F6 mapping approval -- INV-F7-14)

student_exam_profiles ──1:N── preparation_goals
institution_exam_policies (POLICY_PENDING | VERIFIED, versioned like F6 mappings)

exam_attempts (freezes exam_version/blueprint/policy/scoring_model + a full config snapshot)
        │ 1:N
exam_attempt_item_responses (item snapshot, raw response, score, criteria, evidence bridge)
```

## Why this shape

- **AC-F7-01/02** (one engine, no bespoke engine per exam): every table above is exam-family-
  agnostic. PAA and a Cambridge/IB fixture are two rows in `exam_definitions`, never two code
  paths. The existing IB `ibContext` prompt-phrasing pattern generalizes into
  `blueprint_objective_targets.command_term_id` — data, not a branch.
- **AC-F7-03** (Exam Definition ≠ Exam Version): identity vs. frozen configuration are different
  tables; version-specific timing/scoring never lives on `exam_definitions`.
- **AC-F7-04/INV-F7-05** (Blueprint ≠ Curriculum Structure): `blueprint_objective_targets`
  references F6's `learning_objectives` by id — it never reads or reorders `structure_nodes`.
  Presentation order in the curriculum tree has zero influence on blueprint sampling (task's
  adversarial case K).
- **INV-F7-06/AC-F7-12** (published mappings only): every read from
  `objective_concept_mappings`/`_skill_mappings` for generation purposes filters
  `status = 'PUBLISHED'` — reusing F6's own discipline verbatim, never a new filter invented.
- **INV-F7-08/09** (unsupported/missing config fails explicitly, never invented): `timing_status`/
  `tool_rule_status` are explicit `NOT_CONFIGURED | CONFIGURED` markers, never inferred from a
  null being silently treated as "no rules apply." `exam_versions.scoring_model_id` is nullable —
  absence is a real, checkable state, not a default formula.
- **INV-F7-10** (Institution Policy ≠ Exam Definition): `institution_exam_policies` is a separate
  table referencing `exam_definitions`/`exam_versions` by id, with its own
  `POLICY_PENDING/VERIFIED` status — never a column on the exam itself.
- **INV-F7-14** (approved item status not inherited from mapping approval):
  `approved_items`/`approved_item_families` carry their own independent workflow status column —
  nothing derives it from `objective_concept_mappings.status`.
- **INV-F7-04/30** (historical immutability): `exam_attempts` stores explicit FK references to
  the exact version rows used **plus** a `frozen_configuration` snapshot — belt-and-suspenders
  against any future change to how those versioned rows are interpreted.
- **INV-F7-15/28** (Evidence never rewritten, Canonical V2 untouched): F7 never writes to
  `learning_evidence` directly — it only *calls* F5's existing, unmodified `updateMastery()`,
  exactly the calling contract F5 was designed for.

## Reused vocabulary (never duplicated)

`QuestionType`, `AnswerFormat`, `CognitiveLevel` (reasoning requirement), `ExpectedReasoningType`,
the 1-5 difficulty scale, and `EXAM_SIMULATION` (evidence source type) are all **existing**
TypeScript/DB vocabulary from `quiz-generation.service.ts` and `src/lib/algorithms/mastery.ts`.
F7's schema stores these as free text (never a new competing enum) and documents the shared
source of truth in code comments, so a future reader is never tempted to diverge.

## What F7 explicitly does NOT build (task §47, carried into residual risk register)

- No changes to `quiz-generation.service.ts`, the Quality Gate, or the semantic verifier — F7
  adds a new, additive compatibility-validation layer alongside them.
- No final mock simulator, no readiness/score-projection UI — only the `CAN_FULL_MOCK_BE_OFFERED`
  guard function (a yes/no + reasons check), preparing F9.
- No AICE/Parent/Teacher/Institution dashboards.
- No actual AI generation call wired to this new configuration yet — F7 defines the contract
  (resolvable inputs, validators) that a future phase's generation call site would use.
