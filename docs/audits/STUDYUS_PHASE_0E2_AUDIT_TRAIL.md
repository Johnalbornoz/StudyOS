# StudyUs Phase 0E2 — AI Execution & Decision Audit Trail

Date: 2026-08-31. Introduces persistent auditability only. No mastery formula, grading threshold, verification trigger, or knowledge-state threshold was changed.

---

## 1. Executive Summary

- **Re-audited existing history/telemetry structures** before designing anything new (Step 1): `mastery_events`, `learning_evidence`, `validation_events`/`validation_cycles`, `learning_debt_events`, `backfill_runs`, `concept_knowledge_state.state_reason`, `verification_attempts`, `analytics_events` — none duplicated; the new tables sit alongside as a uniform, cross-engine layer.
- **Two new tables, additive only**: `ai_execution_events` (one row per Phase 0E1 `executeAI()` call) and `decision_events` (one row per real, existing deterministic decision). Migration: `database/migrations/20260831_1400_ai_execution_and_decision_audit.sql`.
- **8 real decision types instrumented** (Step 6): `MASTERY_UPDATED`, `KNOWLEDGE_STATE_PROJECTED`, `VERIFICATION_REQUIRED`, `VERIFICATION_NOT_REQUIRED`, `VERIFICATION_RESOLVED`, `LEARNING_DEBT_CREATED`, `LEARNING_DEBT_RESOLVED`, `MISCONCEPTION_RECORDED` — every candidate from the task's own list, all confirmed against real code paths, none invented.
- **Identity decision, explicitly documented** (Step 4/7): `student_id` on both new tables is a plain, nullable, **unconstrained** uuid column — StudyUs's real student identity split (`profiles` vs `students`, Phase 0C) means a single FK target would be technically wrong for whichever domain family it wasn't chosen for. `concept_id`/`subject_id` have no such split and are real FKs.
- **Gateway persistence hook** (Step 9): `AIExecutionAuditSink` is the sole new dependency `src/lib/ai/gateway.ts` gained — zero domain-specific (student/mastery) knowledge leaked into the gateway.
- **Documented, tested failure policy** (Step 10): a failed audit write never breaks, blocks, or rolls back the primary AI/domain operation — proven for 5 distinct scenarios (Step 26).
- **`AI_EXECUTIONS_WITHOUT_AUDIT_PATH = 0`**: confirmed by code search — every one of the 14 AI-calling service files uses `executeAI()`, and the gateway unconditionally attempts an audit write for every execution.
- **One canonical write path each**: exactly one `INSERT INTO ai_execution_events` (`src/lib/ai/audit.ts`) and one `INSERT INTO decision_events` (`src/lib/audit/decision-events.ts`) exist anywhere in `src/` — confirmed by grep, no ad hoc inserts.
- **Mastery/verification/debt/misconception decisions instrumented** at their real, existing call sites — `mastery.service.ts::updateMastery`, `knowledge-state.service.ts::recalculateConceptKnowledgeState`, the verification decision points in `/api/quizzes/generate-and-take` and `/api/quizzes/verify`, `learning-debt.service.ts::checkAndResolveDebt`, and the misconception-recording path in `/api/cognitive/explain/submit`.
- **AI-to-decision linking is never fabricated** (Step 15): `ai_execution_id` is set only when a decision's evidence came from one unambiguous AI call (single-question grading/evaluation paths); the multi-question quiz-bucket path, which can mix AI-graded and structured answers, deliberately leaves it null while preserving the full per-question list in `learning_evidence.metadata.aiGrading`.
- **No raw content in either table** (Step 25) — proven by dedicated tests feeding secret-shaped content through the real gateway/audit paths and asserting it never appears in the persisted params, plus a static schema-contract check that neither table declares a content column at all.
- **Migration tested end-to-end through the real governed process** (Step 21) against an ephemeral local Postgres instance: baseline → ledger bootstrap → `db:status` → `db:migrate --dry-run` → `db:migrate` → `db:status` — `MIGRATION_TEST = PASS`, all 10 checks green.
- **Production migration is BLOCKED**: the Phase 0B Neon credential exposure has not been confirmed rotated in this session. Per the task's explicit safety condition, production was NOT touched — `PRODUCTION_MIGRATION_BLOCKED_CREDENTIAL_ROTATION_REQUIRED`.
- **Validated clean**: `tsc` clean, 727/727 tests passing (655 pre-Phase-0E1 + 41 Phase 0E1 + 31 new this phase), `npm run build` exit 0, `npm run db:repro-test` still PASS (baseline untouched).
- **Phase 0F is not started.**

---

## 2. Existing Audit Architecture Before 0E2

| Table | Represents | Kind | Key identifiers | Timestamps |
|---|---|---|---|---|
| `mastery_events` | Old/new mastery score + delta_reason per update | Domain history | `mastery_id` | `created_at` |
| `learning_evidence` | Canonical graded-attempt record | Domain source of truth | `student_id`(→profiles), `concept_id` | `timestamp` |
| `validation_events` | Timeline within one Validation Cycle | Domain history | `validation_cycle_id` | `occurred_at` |
| `validation_cycles` | Open/closed Phase 2.2B lifecycle record | Domain state | `student_id`(→students), `concept_id` | `started_at`/`closed_at` |
| `learning_debt_events` | Severity changes on a debt row | Domain history | `debt_id` | `created_at` |
| `backfill_runs` | One-off retroactive migration bookkeeping | Operational telemetry | `student_filter` | `started_at`/`completed_at` |
| `concept_knowledge_state.state_reason` | Dimension-by-dimension projection reasoning (jsonb, embedded) | Derived state | `student_id`(→students), `concept_id` | `updated_at` |
| `verification_attempts` | One verification question + resolution | Domain transaction | `student_id`(→students), `concept_id` | `created_at`/`resolved_at` |
| `analytics_events` | Generic `track()` pings | Telemetry | `student_id`(→students, nullable) | `created_at` |

**What was missing**: no uniform, cross-engine-queryable "why did this decision happen" shape (each table has its own reason mechanism, or none); no link from any decision back to the specific AI execution (provider/model/prompt/version) that produced its evidence, even though Phase 0E1 already tracked that metadata in memory per-call. Nothing here is duplicated by the new tables — they're layered on top, cross-referenced via `source_event_type`/`source_event_id`.

---

## 3. Event Taxonomy

**A. AI Execution Event** (`ai_execution_events`) — one invocation of an AI model, success or failure, with or without any resulting state change.

**B. Decision Event** (`decision_events`) — one important, *existing* deterministic system decision. Kept deliberately separate from A: an AI call can happen with no state change (e.g. a failed grading fallback that doesn't move mastery); a deterministic decision can happen with no AI involved at all (e.g. `LEARNING_DEBT_RESOLVED`, which is a pure mastery/retention threshold check). Conflating them into one blob would make both concepts unable to answer their own question cleanly.

**8 decision types instrumented** (Step 6), all confirmed against real code:

| Type | Engine | Real code path |
|---|---|---|
| `MASTERY_UPDATED` | mastery-engine | `mastery.service.ts::updateMastery` |
| `KNOWLEDGE_STATE_PROJECTED` | knowledge-state-projector | `knowledge-state.service.ts::recalculateConceptKnowledgeState` |
| `VERIFICATION_REQUIRED` | verification-engine | `/api/quizzes/generate-and-take` after `evaluateAssessmentEvidence` |
| `VERIFICATION_NOT_REQUIRED` | verification-engine | same call site, `!decision.required` branch |
| `VERIFICATION_RESOLVED` | verification-engine | `/api/quizzes/verify` after `resolveVerificationAttempt` |
| `LEARNING_DEBT_CREATED` | debt-resolution-engine | `mastery.service.ts::updateMastery`'s existing debt-creation step |
| `LEARNING_DEBT_RESOLVED` | debt-resolution-engine | `learning-debt.service.ts::checkAndResolveDebt` |
| `MISCONCEPTION_RECORDED` | misconception-engine | `/api/cognitive/explain/submit`, only when `recordStudentMisconception` actually persisted an occurrence |

**Deliberately deferred** (Step 19 also applies here): `VALIDATION_CYCLE_STARTED`/`VALIDATION_CYCLE_RESOLVED` from the task's candidate list were **not** instrumented this phase — `validation_cycles`/`validation_events` (Phase 2.2B) already provide a dedicated, purpose-built history mechanism for the validation lifecycle (trigger type, deadline, outcome, reopened-from-cycle linkage) that a generic `decision_events` row would only flatten and duplicate without adding traceability value beyond what's already there. Revisiting this is reasonable future work if AI provenance ever needs to reach into a validation cycle specifically, but nothing in the current codebase's AI call sites feeds one directly.

---

## 4. AI Execution Event Contract

```sql
CREATE TABLE ai_execution_events (
  id, execution_id (unique), capability, risk, provider, model,
  prompt_id, prompt_version, status, validation_status, fallback_used,
  error_code, duration_ms, student_id (unconstrained), subject_id (FK),
  concept_id (FK), source_component, source_id, metadata, created_at
);
```

Every field maps directly to Phase 0E1's `AIExecutionMetadata` (Step 13) — no duplicated prompt-registry logic; `prompt_id`/`prompt_version` are copied as-is from the already-versioned registry. **Privacy** (Step 3): never stores a raw prompt, raw AI response, student answer text, student name/email, or credential — see §15.

---

## 5. Decision Event Contract

```sql
CREATE TABLE decision_events (
  id, decision_id (unique), decision_type, engine, engine_version,
  student_id (unconstrained), subject_id (FK), concept_id (FK),
  source_event_type, source_event_id (polymorphic, no FK),
  previous_state jsonb, new_state jsonb, reason_code, reason_details jsonb,
  ai_execution_id (FK -> ai_execution_events.execution_id), metadata, created_at
);
```

`ai_execution_id` FKs to `ai_execution_events.execution_id` (not the internal `id`) so the executionId minted by Phase 0E1's gateway remains the one canonical join key across `learning_evidence.metadata`, `ai_execution_events`, and `decision_events`.

---

## 6. Database Migration

**Name/version**: `database/migrations/20260831_1400_ai_execution_and_decision_audit.sql` (Phase 0D naming convention — sortable UTC-timestamp version, separate namespace from legacy `migrations/001-030`, which remains untouched). Additive only — two new `CREATE TABLE IF NOT EXISTS` plus their indexes/constraints/comments; zero `ALTER`/`DROP` against any existing table (confirmed by `tests/unit/audit-schema-contract.test.ts`).

---

## 7. Identity / FK Decisions

Full reasoning in `docs/architecture/audit-trail.md`'s Identity section, and in the migration file's own header comment. Summary: `learning_evidence`/`mastery_records` FK `student_id -> profiles(id)`; `concept_knowledge_state`/`validation_cycles`/`verification_attempts`/`analytics_events` FK `student_id -> students(id)` (both confirmed directly from the live schema baseline's DDL, not inferred). Since `ai_execution_events`/`decision_events` aggregate decisions from **both** families, and the two identity spaces are kept in perfect sync only by application convention (never a DB constraint), a single FK target would misrepresent the architecture for whichever family it wasn't chosen for. `student_id` on both new tables is therefore a plain, nullable, unconstrained `uuid` column — explicitly documented in the migration file, `docs/architecture/audit-trail.md`, and asserted by a dedicated schema-contract test. `concept_id`/`subject_id` have no such split and are real `ON DELETE SET NULL` foreign keys.

---

## 8. AI Gateway Audit Integration

`src/lib/ai/audit.ts`'s `AIExecutionAuditSink` interface is the sole new dependency `executeAI()` gained (Step 9) — the gateway calls `getAIExecutionAuditSink().record({execution, context})` once per call (success or failure) and has zero knowledge of SQL, table names, or domain logic. `postgresAIExecutionAuditSink` is the real, Postgres-backed implementation; `noopAIExecutionAuditSink` is the test-environment default (see §18); either is swappable via `setAIExecutionAuditSink`.

---

## 9. AI Context Propagation

`AIExecutionContext` (`{studentId?, subjectId?, conceptId?, sourceComponent?, sourceId?}`, Step 11) is an optional field on every `ExecuteAIOptions`. Wired for every HIGH_RISK call site via a new optional trailing parameter each function gained (purely additive — no existing caller's signature broke): `gradeAnswer`, `generateQuestionsForConcept` (already had the ids as direct params), `extractConceptsFromChunk`, `classifyMisconception`, `evaluateTransferResponse`, `evaluateExplanation`. MEDIUM/LOW-risk call sites remain fully audited regardless (context is enrichment, not a precondition for the audit path existing at all).

---

## 10. Mastery Decision Audit

`mastery.service.ts::updateMastery` now calls `recordDecisionEvent({decisionType:'MASTERY_UPDATED', ...})` right after the `learning_evidence` row it just wrote (captured via a new `RETURNING id`, used as `sourceEventId`). `reasonCode` reuses the **exact** string already computed for `mastery_events.delta_reason` (`${sourceType}:${result}`) — no invented reason. `previousState`/`newState` capture `oldMastery`/`newMastery`/`confidenceScore`. `mastery_events` remains the authoritative domain history; this is its cross-engine-queryable twin, added without touching `algorithmUpdateMastery`, `calculateConfidence`, or any threshold. `LEARNING_DEBT_CREATED` is instrumented at the same call site's existing debt-creation branch, with `reasonCode='LOW_MASTERY_WITH_RECENT_ATTEMPT'` describing `shouldCreateLearningDebt`'s actual boolean condition (mastery < 60 AND recently attempted / recurring / exam-blocking) — the algorithm itself only returns a boolean, so this is the most accurate machine-readable label available without inventing precision the algorithm doesn't expose.

---

## 11. Knowledge State Decision Audit

`knowledge-state.service.ts::recalculateConceptKnowledgeState` calls `recordDecisionEvent({decisionType:'KNOWLEDGE_STATE_PROJECTED', ...})` right after the `concept_knowledge_state` upsert, on every successful projection (not gated on an actual state transition — "recomputed and unchanged" is itself part of the auditable record, `reasonCode='STATE_UNCHANGED'` vs `'STATE_TRANSITION'`). Captures the previous `mastery_state` (when one existed), the new state plus all five dimension scores, and the full `stateReason` object (already computed by the existing `buildStateReason`) as `reasonDetails` — no new threshold, no changed calculation. `engineVersion` uses the real, existing `mastery_policy_version`, not a fabricated constant.

---

## 12. Verification Decision Audit

Traced the real Verification Engine (`assessment-verification.service.ts::evaluateAssessmentEvidence`, called from `/api/quizzes/generate-and-take`). `VERIFICATION_REQUIRED` is recorded right after `createPendingVerificationAttempt` returns its id (used as `sourceEventId`), with `reasonCode` = the actual fired trigger ids (e.g. `LOW_GRADING_CONFIDENCE,LARGE_CONFIDENCE_DISAGREEMENT`, real ids from `src/lib/verification-triggers.ts`, never invented) and the full trigger array in `reasonDetails`. `VERIFICATION_NOT_REQUIRED` is recorded on the `!decision.required` branch with `reasonCode='NO_TRIGGER_FIRED'`. `VERIFICATION_RESOLVED` is recorded in `/api/quizzes/verify` right after `resolveVerificationAttempt`, capturing the real `outcome`/`assessmentConfidenceAfter`/`verificationScorePercent`, and links `ai_execution_id` to the verification-question grading call when it was free-text. `verification_attempts` remains the domain transaction; `decision_events` answers why the system chose that action, without duplicating a single field of it verbatim.

---

## 13. Misconception / Learning Debt Audit

**Misconception**: `MISCONCEPTION_RECORDED` is recorded in `/api/cognitive/explain/submit`'s existing `classifyMisconception` → `recordStudentMisconception` flow, **only** inside the `if (classified)` branch — never for a null/no-misconception classification (Step 18's explicit requirement). Links `ai_execution_id` to the classification call (always unambiguous — one call per submission).

**Learning debt**: `LEARNING_DEBT_CREATED` at `mastery.service.ts`'s existing creation branch (§10); `LEARNING_DEBT_RESOLVED` at `learning-debt.service.ts::checkAndResolveDebt`'s existing resolution branch, reusing `computeDebtResolutionCriteria`'s own `allMet` check (`reasonCode='DEBT_RESOLUTION_CRITERIA_MET'`) and the exact human-readable resolution string already computed for `learning_debt_events.reason`, carried into `reasonDetails` rather than duplicated as a separate column. Not every field of `learning_debt_events` is mirrored — only enough to answer "why", via `sourceEventId` linking back to the real `learning_debt` row for the rest.

---

## 14. AI-to-Evidence-to-Decision Traceability

```
Student submits a free-text quiz answer
     |
     v
gradeAnswer() -> executeAI() -> ai_execution_events row
     execution_id=7f3a...  capability=GRADING  provider=anthropic
     model=claude-sonnet-5  prompt_id=quiz.free_text_grading  status=SUCCESS
     |
     v
updateMastery() writes learning_evidence row (id=e91b...)
     |
     v
decision_events row: decision_type=MASTERY_UPDATED
     source_event_type=learning_evidence  source_event_id=e91b...
     previous_state={masteryScore:40}  new_state={masteryScore:62}
     reason_code=PRACTICE_QUIZ:correct
     ai_execution_id=7f3a...   <-- links back to the AI execution above
     |
     v
decision_events row: decision_type=KNOWLEDGE_STATE_PROJECTED
     source_event_type=concept_knowledge_state
     new_state={masteryState:"PROVISIONAL_MASTERY", ...dimension scores}
```

Verified directly against test fixtures in `tests/unit/decision-events.test.ts` (Step 24's five questions — see §17).

---

## 15. Privacy & Stored Data

**Stored**: opaque ids (execution/decision/student/subject/concept/source-event), enum-like strings (capability/risk/provider/model/status/decision_type/engine/reason_code), numeric/boolean outcomes (duration_ms, fallback_used, scores, confidences), and small structured jsonb objects built entirely from the fields above (previous_state/new_state/reason_details/metadata) — never a caller-supplied arbitrary blob containing free text.

**Explicitly NOT stored** (Step 3/25): raw AI prompts, raw AI responses, student free-text answer content, student name, student email, API keys/tokens, `DATABASE_URL`, or any provider request payload. Neither table has a column for any of these (`tests/unit/audit-schema-contract.test.ts`), and no instrumented call site passes such content into `reasonDetails`/`metadata` (`tests/unit/audit-no-raw-content.test.ts`, including a live gateway execution carrying secret-shaped marker text through `call`/`validate` and asserting it never reaches the persisted insert params).

**Is any PII stored?** `student_id` is a UUID, not directly identifying on its own (matching every other table in the schema); no name/email/free-text is stored. This is the same privacy posture every other domain table in StudyUs already has for its own `student_id` column — this phase introduces no new PII surface.

**Expected storage growth**: `ai_execution_events` grows at roughly the same rate as total AI calls (dozens per active quiz/tutor/cognitive-activity session); `decision_events` grows at roughly the same rate as `learning_evidence` writes (one `MASTERY_UPDATED` + one `KNOWLEDGE_STATE_PROJECTED` per evidence event, plus occasional verification/debt/misconception rows). Both are small, fixed-width-ish rows (no large text/blob columns) — growth is linear in usage, not accelerating.

**Recommended retention review point**: revisit once the tables have accumulated roughly 6 months of production data, or when they first exceed a few million rows, whichever comes first — enough to make an informed call on whether cold-storage archival or row expiry is actually needed, rather than guessing now. No deletion automation was built this phase (not required by any existing product policy, and Step 23 explicitly says not to invent one).

---

## 16. Audit Failure Policy

**Decision (Step 10)**: a failed audit write (either table) never breaks, blocks, or rolls back the primary AI/domain operation. Both `postgresAIExecutionAuditSink` and `recordDecisionEvent` catch and log every error internally, never throwing; the gateway additionally wraps its own sink call in a try/catch as defense in depth (a real gap this phase's own test-writing caught and fixed — see §18). Both are `await`ed rather than fire-and-forget, a deliberate tradeoff favoring complete, immediately-queryable data and deterministic tests over shaving the latency of one cheap single-row insert — documented explicitly rather than left implicit.

---

## 17. Queryability Demonstration

Against test fixtures only (`tests/unit/decision-events.test.ts`), all 5 required questions answered:

- **A.** Given an AI execution id → `getAIExecution(executionId)` returns provider/model/promptId/promptVersion/capability. ✅
- **B.** Given a mastery decision → `decision.sourceEventType`/`sourceEventId` names the `learning_evidence` row that caused it. ✅
- **C.** If AI grading caused that evidence → `getDecisionTrace(decisionId)` resolves `decision.aiExecutionId` into the full `ai_execution_events` row. ✅
- **D.** Given a verification decision → `decision.reasonCode`/`reasonDetails.triggers` names the real fired trigger ids. ✅
- **E.** Given a student+concept → `getDecisionsForStudentConcept(studentId, conceptId)` returns the full sequence, oldest first. ✅

A sixth case is also proven: a decision with **no** AI involvement (deterministic verification) correctly resolves `aiExecution` to `null` rather than fabricating a link.

---

## 18. Tests Added / Modified

**Added (31 new tests, 4 files):**
- `tests/unit/ai-execution-audit.test.ts` (6) — default no-op sink in tests, sink swapping + context passthrough, the Step 26 "AI success + audit failure" and "AI timeout + audit success" scenarios, the real Postgres sink's exact insert shape (mocked db), and the sink's own "never throws" contract.
- `tests/unit/decision-events.test.ts` (8) — no-op-by-default in tests, exact insert shape when enabled, the Step 26 decision-audit-failure scenario, and all 5 Step 24 queryability questions plus the "no fabricated AI link" case.
- `tests/unit/audit-no-raw-content.test.ts` (4) — Step 25: a live gateway execution carrying secret-shaped content never leaks into the persisted params; structural column-name checks on both insert statements; a static source check on `mastery.service.ts`'s `reasonDetails` block.
- `tests/unit/audit-schema-contract.test.ts` (13) — static, DB-free contract tests against the new migration file: table/column shapes, the documented CHECK constraints, the deliberate absence of a `student_id` FK on both tables, the real FKs on `concept_id`/`subject_id`/`ai_execution_id`, and additive-only verification (no `ALTER`/`DROP` against any pre-existing table).

**Modified (1 file, pre-existing):** none required changes this phase (Phase 0E1's one test fix already covered the only pre-existing assumption this kind of change could break).

**A real bug this phase's own tests caught**: the initial gateway implementation awaited the audit sink without a surrounding try/catch, meaning a misbehaving sink could have broken `executeAI()` despite the documented "never blocks the primary operation" policy. `tests/unit/ai-execution-audit.test.ts`'s failure-scenario test caught this immediately; fixed with a defense-in-depth try/catch in `src/lib/ai/gateway.ts`'s `emit()` helper before this report was written.

---

## 19. Migration Validation

**Ephemeral**: `npm run db:migration-test` (new script, `scripts/db-migration-test.sh`) — full governed process against a throwaway local Postgres instance: baseline apply → ledger bootstrap → `db:status` (1 pending) → `db:migrate --dry-run` (preview only, tables still absent) → `db:migrate` (real apply) → `db:status` (0 pending, 2 applied) → PK/FK/index verification (all present, `student_id` confirmed to have no FK) → ledger checksum verification. **`MIGRATION_TEST = PASS`**, all 10 steps green. (One real bug was found and fixed during this phase: the verification script's `psql` invocations initially omitted the target database name, causing false-negative constraint counts against the wrong default database — caught immediately by comparing against a manual debug run, fixed before this report.)

**Production**: NOT migrated — see §21.

**Ledger**: `20260831_1400_ai_execution_and_decision_audit` recorded with its real sha256 checksum, verified via `db:status` showing `2 applied, 0 pending, 0 drifted`.

---

## 20. Application Validation

```
TypeScript:        npx tsc --noEmit         -> clean, exit 0
Tests:              npx vitest run           -> 64 test files, 727 tests, all passed
                                                  (696 pre-Phase-0E2 + 31 new)
Build:               npm run build            -> exit 0, full route manifest, no errors
DB reproducibility: npm run db:repro-test     -> REPRODUCIBILITY_TEST = PASS (baseline untouched)
Migration test:      npm run db:migration-test -> MIGRATION_TEST = PASS
Schema contract:    tests/unit/schema-contract.test.ts (26) + audit-schema-contract.test.ts (13) -> all pass
Migration ledger:    tests/unit/migration-ledger.test.ts (9) -> all pass
Lint:                LINT_NOT_CONFIGURED      -> no ESLint config, no `lint` script
```

---

## 21. Production Changes

**NONE.** Production Neon was not touched by this phase.

The Phase 0B incident (a diagnostic command's regex bug printed the live `DATABASE_URL` including its password into a tool-output log, disclosed immediately at the time) has **not been confirmed rotated** in this session — no message in this conversation states the credential was rotated, and this session has no way to verify rotation status itself (no Neon dashboard/API access, and reconstructing or testing the old leaked value is exactly the kind of credential-handling this session must never do). Per the task's explicit, non-negotiable safety condition:

**`PRODUCTION_MIGRATION_BLOCKED_CREDENTIAL_ROTATION_REQUIRED`**

All implementation and isolated database testing (§19) is complete and passing. The migration is additive-only, fully reviewed, and ready to apply the moment credential rotation is confirmed — at that point, running `npm run db:migrate` (after `npm run db:status` confirms exactly one pending migration) is the entire remaining step, via the same governed process exercised in §19.

---

## 22. Git Diff Summary

Scoped to Phase 0E2's own changes (the working tree also carries separately-authorized, still-uncommitted Phase 0E1/0D/0C/mastery-hotfix work, none of which this phase touched further):

**New (11 files/dirs):**
```
database/migrations/20260831_1400_ai_execution_and_decision_audit.sql
scripts/db-migration-test.sh
src/lib/ai/audit.ts
src/lib/audit/                          (types.ts, decision-events.ts, query.ts, index.ts)
docs/architecture/audit-trail.md
tests/unit/ai-execution-audit.test.ts
tests/unit/decision-events.test.ts
tests/unit/audit-no-raw-content.test.ts
tests/unit/audit-schema-contract.test.ts
```

**Modified (14 files):**
```
package.json                                        (+1 script: db:migration-test)
src/lib/ai/types.ts                                  (+AIExecutionContext)
src/lib/ai/gateway.ts                                (+context param, +audit hook, +defense-in-depth try/catch)
src/lib/ai/index.ts                                  (+audit.ts barrel exports)
src/services/mastery.service.ts                       (+MASTERY_UPDATED, +LEARNING_DEBT_CREATED, +aiExecutionId input field)
src/services/knowledge-state.service.ts                (+KNOWLEDGE_STATE_PROJECTED)
src/services/learning-debt.service.ts                  (+LEARNING_DEBT_RESOLVED)
src/services/assessment-verification.service.ts        (+aiExecutionId threading to updateMastery)
src/services/quiz-generation.service.ts                 (+context param on gradeAnswer/generateQuestionsForConcept)
src/services/misconception.service.ts                   (+context param on classifyMisconception)
src/services/transfer.service.ts                        (+context param on evaluateTransferResponse)
src/services/explain-defend.service.ts                  (+context param on evaluateExplanation)
src/services/concept-extraction.service.ts               (+context param on extractConceptsFromChunk)
src/app/api/cognitive/explain/submit/route.ts             (+MISCONCEPTION_RECORDED, +context/aiExecutionId wiring)
src/app/api/cognitive/transfer/submit/route.ts             (+aiExecutionId wiring)
src/app/api/quizzes/generate-and-take/route.ts              (+VERIFICATION_REQUIRED/NOT_REQUIRED, +gradeAnswer context)
src/app/api/quizzes/verify/route.ts                          (+VERIFICATION_RESOLVED, +gradeAnswer context)
```

No mastery algorithm, quiz-scoring threshold, verification-trigger threshold, database ALTER against any pre-existing table, Learning Decision Engine, Adaptive Teaching implementation, or UI file was touched by this phase. Nothing needed reverting.

---

## 23. Remaining Risks

1. Production has not received this migration (blocked on credential rotation, §21) — `ai_execution_events`/`decision_events` exist only locally/in-test until that's resolved.
2. `VALIDATION_CYCLE_STARTED`/`VALIDATION_CYCLE_RESOLVED` were deliberately deferred (§3) — `validation_cycles`/`validation_events` remain the only auditable record of the Phase 2.2B lifecycle; a future phase could add `decision_events` coverage if AI provenance ever needs to reach into it.
3. AI context (student/subject/concept) is populated for HIGH_RISK call sites only — MEDIUM/LOW-risk executions are still fully audited but without that linkage, by design (Step 11 explicitly allows this), but it does mean e.g. a `tutor.chat_reply` execution can't currently be traced to a specific student via `ai_execution_events` alone.
4. No retention/archival tooling exists yet (§15) — both tables will grow indefinitely until a future phase addresses this, per the documented review point.
5. `decision_events`/`ai_execution_events` have no automated production monitoring/alerting on audit-write failure rate yet — failures are logged (`console.error`) but not aggregated or surfaced anywhere beyond application logs.

---

## 24. Phase 0E2 Definition of Done

- [x] AI execution table exists — `ai_execution_events`, §4/§6.
- [x] Decision event table exists — `decision_events`, §5/§6.
- [x] Every AI execution has a persistent audit path — `AI_EXECUTIONS_WITHOUT_AUDIT_PATH = 0`, confirmed by code search (§ Executive Summary), the gateway attempts an audit write unconditionally.
- [x] Provider/model/prompt/version persisted — `ai_execution_events` columns, §4.
- [x] Raw prompt/response not persisted — §15, proven by test.
- [x] Mastery decisions audited — §10.
- [x] Knowledge-state decisions audited — §11.
- [x] Verification decisions audited — §12.
- [x] AI execution can link to resulting deterministic decision when applicable — §14, never fabricated (§ Executive Summary).
- [x] Existing domain history tables remain authoritative — §2/§10-13, nothing duplicated or replaced.
- [x] No mastery formula changed — confirmed by git diff (§22): `src/lib/algorithms/mastery.ts` untouched.
- [x] No verification threshold changed — `src/lib/verification-triggers.ts`/`assessment-confidence.ts` untouched.
- [x] Migration follows Phase 0D governance — `database/migrations/`, sortable-timestamp naming, additive-only, §6.
- [x] Ephemeral migration test passes — §19, `MIGRATION_TEST = PASS`.
- [x] Schema contract tests pass — §19/§20, 39 total (26 existing + 13 new).
- [x] Application tests pass — 727/727, §20.
- [x] Build passes — §20.

---

## 25. Final Decision

**A. Can StudyUs persistently reconstruct an AI execution?**
**YES** (once migrated to production — implementation and local testing are complete; the table doesn't exist in production yet, see H).

**B. Can StudyUs reconstruct why a mastery change occurred?**
**YES.** `MASTERY_UPDATED` decision events capture previous/new mastery, delta, source type/result, and reason code, linked to the causing `learning_evidence` row.

**C. Can StudyUs link AI-generated evidence to the resulting deterministic mastery decision?**
**YES**, when the evidence came from one unambiguous AI execution (§9/§14) — never fabricated when it didn't (§ Executive Summary).

**D. Can StudyUs reconstruct why Verification was required?**
**YES.** `VERIFICATION_REQUIRED` events capture the real fired trigger ids and severity.

**E. Is raw prompt/response content excluded from the new audit tables?**
**YES.** §15/§18, proven by test.

**F. Did any pedagogical threshold or mastery formula change?**
**NO.**

**G. Did the migration follow the new governed migration process?**
**YES.** §6/§19 — `database/migrations/`, tested via `db:status`/`db:migrate`, never manually pasted DDL.

**H. Was production migrated?**
**BLOCKED.** `PRODUCTION_MIGRATION_BLOCKED_CREDENTIAL_ROTATION_REQUIRED` — see §21.

**I. Is Phase 0E2 ready to certify?**
**YES_WITH_CONDITIONS** — all implementation, local testing, and application validation are complete and passing; certification of the *production* audit trail specifically is conditional on (1) confirming Neon credential rotation and (2) then running the already-tested, already-reviewed migration via `npm run db:migrate`.

**J. Maximum five issues remaining before Phase 0F** — see §23 in full; summarized: (1) production migration still blocked on credential rotation, (2) Validation Cycle lifecycle deliberately not yet covered by `decision_events`, (3) AI context linkage is HIGH_RISK-only by design, (4) no retention/archival tooling yet, (5) no automated monitoring on audit-write failure rate.

---

*End of report. No mastery formula, grading threshold, verification trigger, or knowledge-state calculation changed. Production Neon was not touched — see §21 for why.*
