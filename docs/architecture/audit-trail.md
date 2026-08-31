# StudyUs AI Execution & Decision Audit Trail

Established Phase 0E2, on top of Phase 0E1's canonical AI gateway. This document describes the persistent auditability layer: two new tables, one gateway hook, and instrumentation of every deterministic decision StudyUs makes today. It introduces zero new learning intelligence -- see `docs/audits/STUDYUS_PHASE_0E2_AUDIT_TRAIL.md` for the full audit, risk/identity decisions, and evidence.

## The conceptual chain

```
USER INTERACTION
     |
     v
AIExecutionEvent (optional -- not every decision involves AI)
     |
     v
LearningEvidence  (domain source of truth -- unchanged)
     |
     v
DeterministicEngine  (mastery / knowledge-state / verification / debt / misconception)
     |
     v
DecisionEvent  (cross-engine audit trail -- new, this phase)
     |
     +--> MasteryRecord / mastery_events        (domain source of truth -- unchanged)
     +--> ConceptKnowledgeState                  (domain source of truth -- unchanged)
     +--> VerificationAttempt                    (domain source of truth -- unchanged)
     +--> LearningDebt / learning_debt_events     (domain source of truth -- unchanged)
     +--> StudentMisconception                    (domain source of truth -- unchanged)
```

**Domain source-of-truth tables** (`mastery_records`, `mastery_events`, `learning_evidence`, `concept_knowledge_state`, `verification_attempts`, `learning_debt`, `learning_debt_events`, `student_misconceptions`) are unchanged by this phase and remain fully authoritative -- the application reads and writes them exactly as before. **`decision_events`** is a cross-engine, uniformly-shaped audit twin layered on top, answering "why" across every engine with one query shape instead of five different ones. **`ai_execution_events`** is the persistent form of Phase 0E1's in-memory `AIExecutionMetadata`.

## Step 1: existing audit/history structures (before this phase)

| Table | What it represents | Kind |
|---|---|---|
| `mastery_events` | Every mastery score change (old/new/delta_reason) | Domain history |
| `learning_evidence` | Every graded attempt -- the canonical evidence record | Domain source of truth |
| `validation_events` | Timeline of events within one Validation Cycle | Domain history |
| `validation_cycles` | Open/closed Phase 2.2B validation lifecycle records | Domain state |
| `learning_debt_events` | Severity changes on a learning_debt row | Domain history |
| `backfill_runs` | One-off retroactive migration run bookkeeping | Operational telemetry |
| `concept_knowledge_state.state_reason` | The dimension-by-dimension reasoning for one projection | Derived state, embedded reason |
| `verification_attempts` | One verification question + its resolution | Domain transaction |
| `analytics_events` | Generic product analytics pings (`track()`) | Telemetry |

None of these provide a **uniform** shape across engines, and none link to **which AI execution** (if any) produced the evidence behind them. `ai_execution_events`/`decision_events` do not duplicate any of the above -- they sit alongside, cross-referencing via `source_event_type`/`source_event_id`.

## `ai_execution_events`

One row per `executeAI()` call (Phase 0E1's gateway). See `docs/architecture/ai-contract.md` for the execution-metadata shape this mirrors. Columns: `execution_id` (unique, joins to Phase 0E1's `AIProvenance.aiExecutionId`), `capability`/`risk`/`provider`/`model`/`prompt_id`/`prompt_version`, `status`/`validation_status`/`fallback_used`/`error_code`/`duration_ms`, optional `student_id`/`subject_id`/`concept_id`/`source_component`/`source_id` context, `created_at`.

**Privacy**: never stores a raw prompt, raw response, student answer text, student name/email, or any credential -- see `docs/audits/STUDYUS_PHASE_0E2_AUDIT_TRAIL.md` §15 for the full list and the tests that prove it (`tests/unit/audit-no-raw-content.test.ts`).

## `decision_events`

One row per important **existing** deterministic decision. `decision_type` is one of the 8 real decisions StudyUs makes today (see the Definition of Done in the audit report for the full taxonomy and which candidates were deliberately deferred). `engine`/`engine_version` identify which deterministic engine decided, `source_event_type`/`source_event_id` point at the domain row this decision was derived from, `previous_state`/`new_state`/`reason_code`/`reason_details` capture the "why" using only reasons the existing algorithm already exposes, and `ai_execution_id` links to `ai_execution_events.execution_id` **only** when the evidence came from one unambiguous AI call (never fabricated -- see the Identity section below).

## Identity: why `student_id` has no foreign key

StudyUs's student identity is split across two unlinked primary-key spaces kept in sync by application convention (Phase 0C's contract in `src/lib/auth.ts`): `learning_evidence`/`mastery_records` FK `student_id -> profiles(id)`; `concept_knowledge_state`/`validation_cycles`/`verification_attempts`/`analytics_events` FK `student_id -> students(id)`. `ai_execution_events`/`decision_events` aggregate decisions from **both** families (a `MASTERY_UPDATED` row's context comes from the profiles-linked side; a `VERIFICATION_REQUIRED` row's context comes from the students-linked side). A single FK target would be technically incorrect for whichever family it wasn't chosen for, while being a silent no-op join for the other (both spaces hold the same UUID for a real student, by the enforced sync guarantee -- 0 orphans confirmed in every Phase 0B/0C/0D check). Per the task's own instruction ("accuracy is more important than pretending the identity architecture is cleaner than it is"), `student_id` on both new tables is a plain, nullable, **unconstrained** `uuid` column. `concept_id`/`subject_id` have no such split and are real foreign keys (`ON DELETE SET NULL`, so a later concept/subject deletion never blocks or is blocked by audit history).

## Gateway integration: the persistence boundary

```
executeAI()
     |
     +--> provider adapter (Anthropic/OpenAI)
     |
     +--> validator
     |
     +--> AIExecutionAuditSink.record()   <- the ONLY new dependency the gateway gained
```

`src/lib/ai/audit.ts`'s `AIExecutionAuditSink` interface is the entire persistence boundary -- `src/lib/ai/gateway.ts` has zero knowledge of SQL, table names, or any domain-specific student/mastery logic. It calls `getAIExecutionAuditSink().record({execution, context})` after every execution (success or failure), and remains a clean, storage-agnostic AI transport layer. Swappable in tests (`setAIExecutionAuditSink`); defaults to `noopAIExecutionAuditSink` when `process.env.VITEST === 'true'` (so the 700+ pre-existing tests never need to know this phase exists), and to the real Postgres-backed sink otherwise.

## Context propagation

`AIExecutionContext` (`{studentId?, subjectId?, conceptId?, sourceComponent?, sourceId?}`) is an optional field on every `executeAI()` call. Wired for every HIGH_RISK call site (`gradeAnswer`, `generateQuestionsForConcept`, `extractConceptsFromChunk`, `classifyMisconception`, `evaluateTransferResponse`, `evaluateExplanation`) via a new optional trailing parameter each service function gained -- purely additive, no existing caller broke. MEDIUM/LOW-risk call sites are still fully audited (Step 12's `AI_EXECUTIONS_WITHOUT_AUDIT_PATH = 0` doesn't depend on context), just without student/concept linkage where the calling code doesn't naturally have it.

## Failure policy (Step 10)

Both audit paths share one policy: **a failed audit write never breaks, blocks, or rolls back the primary learning operation.**

- `postgresAIExecutionAuditSink.record()` and `recordDecisionEvent()` both catch every error internally and log it (`console.error`) -- they never throw.
- The gateway additionally wraps its own call to `getAIExecutionAuditSink().record()` in a try/catch (defense in depth, in case a future custom sink violates the "never throws" contract) -- proven by `tests/unit/ai-execution-audit.test.ts`'s "AI success + audit persistence failure" case.
- Both paths are **awaited** (not fire-and-forget) -- a deliberate choice favoring simplicity, testability, and complete data (the audit write is attempted, or is caught and logged, before the caller's request returns) over shaving the small latency of one cheap single-row insert. There is no scenario where a successful AI execution or a successful mastery/verification/debt/misconception decision is lost because the audit database was unavailable -- the primary write already committed before the corresponding `recordDecisionEvent`/audit-sink call runs.

## AI-to-evidence-to-decision traceability -- worked example

```
Student submits a free-text quiz answer
     |
     v
gradeAnswer() -> executeAI() -> ai_execution_events row
     execution_id = 7f3a...  capability=GRADING  provider=anthropic
     model=claude-sonnet-5  prompt_id=quiz.free_text_grading  status=SUCCESS
     |
     v
updateMastery() writes learning_evidence row (id = e91b...)
     |
     v
decision_events row: decision_type=MASTERY_UPDATED
     source_event_type=learning_evidence  source_event_id=e91b...
     previous_state={masteryScore:40}  new_state={masteryScore:62}
     reason_code=PRACTICE_QUIZ:correct
     ai_execution_id=7f3a...   <-- links back to the AI execution above
     |
     v
recalculateConceptKnowledgeState() writes concept_knowledge_state row
     |
     v
decision_events row: decision_type=KNOWLEDGE_STATE_PROJECTED
     source_event_type=concept_knowledge_state
     new_state={masteryState:"PROVISIONAL_MASTERY", ...dimension scores}
     reason_code=STATE_TRANSITION
```

An engineer starting from the `KNOWLEDGE_STATE_PROJECTED` row can trace backward: which decision, which evidence, which (if any) AI execution, and that execution's provider/model/prompt/version -- without ever seeing the student's actual answer text, which was never stored in either audit table.

## Observability access (Step 28)

`src/lib/audit/query.ts` -- server-side-only read functions (`getAIExecution`, `getDecisionEvent`, `getDecisionsForStudentConcept`, `getDecisionTrace`). No API route, no UI. Deferred per the task's own instruction; exists for tests, debugging, and a future admin surface to build on.

## What remains deferred

- A user-facing or admin-facing UI/API surface over these tables.
- Automated retention/deletion tooling (see the audit report §23 for retention considerations -- documented, not built).
- Cross-linking `ai_execution_events`/`decision_events` into a Learning Decision Engine's own decision log -- no such engine exists yet.
- Consolidating `students`/`profiles` identity (unrelated to this phase, tracked since Phase 0C).
