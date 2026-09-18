# F8 — Framework-Aware Teaching Model

## Framework identity resolution

No table stores "framework identity" directly (confirmed gap, §7/§8 of the current-state assessment). Two resolvers, both read-only, both reusing existing joins verbatim:

```ts
// src/lib/teaching/framework-context.service.ts

interface FrameworkIdentity {
  academicOrganizationId: string;
  academicOrganizationName: string;
  academicProgrammeId: string;
  programmeType: 'CURRICULUM' | 'ASSESSMENT_FRAMEWORK' | 'ADMISSION_EXAM';
  examDefinitionId?: string;
  examVersionId?: string;
  examFamily?: string;
}

async function resolveFrameworkForStudentExamProfile(studentId: string): Promise<FrameworkIdentity | null>
// student_exam_profiles (status='ACTIVE') -> exam_versions -> exam_definitions -> academic_programmes -> academic_organizations
// Returns null if the student has no ACTIVE exam profile -- F8 then falls back to framework-neutral teaching.

async function resolveFrameworkForObjective(learningObjectiveId: string): Promise<FrameworkIdentity | null>
// learning_objectives -> structure_nodes -> structure_versions -> academic_subjects -> academic_programmes -> academic_organizations
```

Both are pure reads, both fail to `null` rather than guessing (matching `resolveActivityMetadataForObjective`'s own discipline). A `null` result means "teach the concept without framework flavoring," never a fabricated default framework.

## Freezing (task §14, adversarial case N)

`intervention_sessions.framework_context` stores the **resolved snapshot** (ids + display names) at session-creation time. If a mapping is later retired (e.g. the PAA↔canonical-concept mapping is retired after the session was created), the historical session's `framework_context` is untouched — re-resolving is never performed for a past session. This is the same discipline as F7's `exam_attempts.frozen_configuration`.

## Knowledge vs. exam strategy separation (task §15)

- **Knowledge content** (what the learner needs to know) is generated referencing only `canonicalConceptIds` — the same canonical concept regardless of framework. This content is framework-*agnostic* and is cached/reusable across frameworks sharing the concept (e.g. PAA and Cambridge Mathematics, per the confirmed shared-concept fixture from F7's pilot dataset).
- **Exam strategy content** (how the learner must demonstrate it) is generated referencing `frameworkContext` + `commandTerm` + `questionType` + `toolContext` — this is framework-*specific* and is never cached across frameworks.
- The AI teaching contract (see `F8_AI_TEACHING_CONTRACT.md`) keeps these as two distinct payload sections rather than one blended block, so a validator can independently check "does the knowledge section avoid framework-specific assumptions" and "does the strategy section correctly match the requested framework."

## Command-term training (task §16)

New table `command_term_interpretations` — additive to F7's `command_terms`, never replacing it:

```sql
CREATE TABLE command_term_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_term_id uuid NOT NULL REFERENCES command_terms(id),
  academic_programme_id uuid REFERENCES academic_programmes(id),  -- NULL = generic/default fallback
  expected_structure text NOT NULL,
  rubric_notes text,
  common_failure_patterns jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','RETIRED')) DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_cti_one_active_per_term_programme ON command_term_interpretations (command_term_id, academic_programme_id) WHERE status = 'ACTIVE' AND academic_programme_id IS NOT NULL;
CREATE UNIQUE INDEX idx_cti_one_active_default ON command_term_interpretations (command_term_id) WHERE status = 'ACTIVE' AND academic_programme_id IS NULL;
```

A command term's meaning is never assumed identical across frameworks (task §16's own explicit requirement): `resolveCommandTermInterpretation(commandTermId, academicProgrammeId?)` looks up the programme-specific `ACTIVE` row first, falls back to the `academic_programme_id IS NULL` default row, and returns `null` (never an invented interpretation) if neither exists — the AI teaching contract then omits structure/rubric guidance for that term rather than fabricating it.

## Question-format training (task §17)

Reuses `QuestionType` from `quiz-generation.service.ts` verbatim — no new concept type is created per question format. The AI teaching contract's `questionType` field is one of the existing 18 values; format-specific teaching guidance is a prompt-construction concern inside `ai-teaching-contract.service.ts`, not a new schema concept.

## Procedure training (task §18)

`assessment_components.procedure_required` (F7 column, previously unread by any code) is now read by `resolveTeachingContentGenerationContext` (see `F8_AI_TEACHING_CONTRACT.md`) and threaded into the generation contract as `proceduresRequired: boolean`. When `true`, the generated content must include a `workedExample.steps: string[]` (method/steps/intermediate reasoning), validated deterministically (non-empty steps array) before presentation. When `false`, F8 never fabricates a procedure requirement that the component doesn't actually have (task §18's explicit prohibition).

## Non-duplication guarantee (INV-F8-10/11, AC-F8-11)

Every teaching/technique table introduced by F8 (`command_term_interpretations`, `intervention_sessions.framework_context`) references `canonical_concept_ids`/`command_term_id`/`academic_programme_id` — never a copy of the Canonical Concept's own name, description, or definition. The AI teaching contract's deterministic validator explicitly checks that the "knowledge" section of generated content references the requested `canonicalConceptIds` by id (via the prompt) and that the framework-specific section is additive framing, not a restated definition — enforced by requiring the knowledge section and the strategy section to be structurally distinct fields in the output schema (never one merged blob), so a semantic duplication is directly checkable by the second validation pass.
