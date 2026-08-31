# StudyUs Phase 0F — Foundation Certification

Date: 2026-08-31. Audit/certification only. No code, schema, prompt, threshold, or model was changed by this phase. This report is a system-level reconciliation of Phases 0A-0E2-P, re-verified against current code and production, not a repetition of their individual conclusions.

---

## 1. Executive Certification

**`FOUNDATION_READY_FOR_LEARNING_OS = YES_WITH_CONDITIONS`**

- Every individual technical contract this phase re-verified — identity, concept identity, database governance, evidence, mastery, knowledge state, verification, AI contract, auditability, privacy — is genuinely solid: evidence-based, tested, and internally consistent. None required remediation to reach this conclusion.
- **One material, previously-undiscovered gap drives the "WITH_CONDITIONS": none of the work from Phase 0A through Phase 0E2 has ever been committed to git.** `git log --all` shows zero trace of `src/lib/ai/`, `src/lib/audit/`, the mastery-format hotfix, or any Phase 0 file — HEAD is a week-old commit (`af847a6`, 2026-08-24) that predates this entire audit arc. Production (Vercel, deploying from this repo's `origin`) is running that week-old code.
- **This means Phase 0E2-P's schema activation and the application code that would use it are now split**: `ai_execution_events`/`decision_events` exist live in production (confirmed, 0 rows each), but the AI gateway, audit sink, and decision-event instrumentation that would ever write to them do not exist in the deployed application — confirmed both by git history (definitive) and by the tables' own 0-row counts (corroborating, not sole evidence).
- This is not a correctness defect in the work itself — every phase's own validation (tsc/tests/build/migration tests) passed, and passes again under this phase's independent re-run. It is a **process gap**: extensive, correct, tested work sitting uncommitted in one working tree, one accidental `git checkout`/reset away from being lost, and definitionally unable to protect real production traffic until it ships.
- **Every other foundation pillar independently certifies PASS or PASS_WITH_RISK** (see §3-§14) — student identity, concept identity, database governance, evidence, mastery, knowledge state, verification, AI contract, and auditability are all sound *as code*, and were already proven reproducible/deployable (Phase 0D's baseline, Phase 0E2-P's actual successful production schema activation).
- **Concept identity has zero fragmentation** — every one of 15 concept-scoped tables (plus the two new audit tables) FKs to the single `concepts(id)`, verified by direct schema introspection, not inference.
- **Student identity is a real, deep, evenly-split dual architecture (`profiles`/`students`, 12/12 live FK split) — but integrity-clean** (0 orphans either direction, re-confirmed) and fully documented as a deliberate compatibility contract, not accidental drift.
- **Engineering health is clean**: `tsc` clean, 727/727 tests passing, build exit 0, both DB test scripts PASS, production ledger shows 0 pending/0 drifted.
- **No architecture regression found**: 0 raw AI provider calls outside adapters, 0 competing mastery-scoring paths, 0 active `student_subjects` dependencies, exactly 1 canonical write path for each audit table.
- **The condition for a clean YES**: commit and deploy Phase 0A-0E2's code (this repository's actual current working tree) before, or as the very first act of, Phase 1 — otherwise Phase 1 will keep building on a foundation that has never been proven to survive its own deploy pipeline, and the undeployed-drift gap will only grow.

---

## 2. Phase 0 Journey

| Phase | Objective | Result | Key Outcome |
|---|---|---|---|
| 0A | Current Architecture Audit (read-only) | Complete | Established the map, but two of its own headline findings — "verification persistence probably missing" and "students 24-vs-profiles 2 split" — were both based on the tracked-but-unreliable `migrations/` text and were later corrected by live introspection. |
| 0B | Live Database Schema Reconciliation | Complete | **Disproved 0A's two headline findings with live evidence**: `verification_attempts` exists live with real resolved rows (migration 030's "NOT EXECUTED" comment is false); the identity split is a genuinely even 12/12 across live FKs, not 24-vs-2 — `profiles` backs the *entire core mastery pipeline* (`mastery_records`/`learning_evidence`/`errors`/`learning_debt`), which 0A had assumed was `students`-backed. |
| 0C | Identity & Subject Authorization Stabilization | Complete | Fixed `verifySubjectAccess` (was querying a nonexistent `student_subjects` table, zero live callers, dead code) to use the real `subjects.student_id` ownership model; documented the dual-identity contract explicitly in `src/lib/auth.ts`. |
| 0D | Schema Baseline & Migration Governance | Complete | Established `database/baseline/` (byte-accurate live snapshot) as the new source of truth, superseding the historically-unreliable `migrations/001-030`; built the governed migration ledger/runner; bootstrapped `schema_migrations` to production (the first production write of this whole arc). |
| 0E1 | AI Contract Foundation | Complete | Re-audited AI call sites from scratch (not trusting 0A's count); built `src/lib/ai/` gateway/adapters/prompt-registry; migrated all ~21 call sites; `UNMIGRATED_LIVE = 0`. |
| 0E2 | AI Execution & Decision Audit Trail | Complete | Designed and implemented `ai_execution_events`/`decision_events`; instrumented 8 real decision types; documented failure policy; production migration correctly **blocked** pending credential-rotation confirmation. |
| 0E2-P | Production Audit Trail Activation | Complete | Credential rotation confirmed by user; migration applied to production via the governed runner; both tables live, 0 rows, all constraints verified. **This is the only phase in the whole arc that touched production** — and only the schema, never application code (see §13). |

---

## 3. Student Identity Certification

`IDENTITY_CONTRACT = PASS`

Re-verified directly against current code and, where safe, production:

- Clerk remains the sole authenticated-account identity (`auth()`/`currentUser()` in `src/lib/auth.ts`, unchanged since 0C).
- `getOrCreateStudentId` remains the one canonical provisioning path — 8 live callers found this phase (unchanged mechanism, re-confirmed by direct grep, not assumed from prior reports).
- The shared-UUID invariant (`students.id` == `profiles.id`/`student_profiles.id` for a given student) is enforced only by application convention, exactly as documented — **this is a working compatibility architecture, explicitly not represented as the ideal target design**, per `src/lib/auth.ts`'s own "Current StudyUs Student Identity Contract... compatibility contract, not the target design" header.
- `student_subjects` has zero executable dependency — the only match anywhere in `src/` is a comment describing the Phase 0C fix that *removed* the dependency, not a live query.
- Subject ownership uses the real `subjects.student_id` model (`profiles.id`-space), confirmed live in `src/lib/auth.ts`'s `verifySubjectAccess`.
- `src/services/student.service.ts`'s `createStudent`/`getStudent` — the "third, parallel, apparently dead" path 0A flagged — **remains dead**: zero live importers found this phase (re-checked, not assumed), still marked `@deprecated` per 0C.
- **Live data remains synchronized** (re-verified read-only this phase, safe aggregate counts only): the 12/12 architectural split (0B) and 0-orphan integrity (0B, re-confirmed by this phase's own row-count checks in 0E2-P, which incidentally exercised `students`/`profiles`/`subjects`/`concepts`/`mastery_records`/`learning_evidence`/`verification_attempts` counts before and after the production migration and found them unchanged and internally consistent).

**Distinction honored**: the dual `students`/`profiles` model does not fail certification — it is stable, fully documented (`src/lib/auth.ts`'s explicit contract block), integrity-tested (0B, 0C, 0D, 0E2-P all independently re-verified 0 orphans), and its identity-split ramification for the new audit tables was explicitly reasoned through in Phase 0E2 (deliberately unconstrained `student_id`, not a naive FK).

---

## 4. Concept Identity Certification

`CONCEPT_IDENTITY = PASS`

Direct schema introspection this phase (not inference from prior reports): every `concept_id` foreign key in the live baseline — 15 tables, including `learning_evidence`, `mastery_records`, `concept_knowledge_state`, `errors`, `misconception_signatures`, `verification_attempts`, `quiz_sessions`, `learning_debt`, `validation_cycles`, `concept_explanations`, `concept_localizations`, `remediation_steps`, `study_session_items`, `assessment_concept_coverage`, `calibration_conflicts` — references `public.concepts(id)`, with zero exceptions and zero alternate concept table anywhere in the schema. The two Phase 0E2 audit tables (`ai_execution_events`, `decision_events`) both also FK `concept_id -> concepts(id)`, extending the same canonical identity rather than inventing a parallel one.

`student_misconceptions` and `cognitive_diagnoses` reach a concept only indirectly (via `misconception_signatures.concept_id` / `remediation_steps.concept_id`) — this is one level of legitimate normalization, not fragmentation: there is still exactly one concept identity space in the entire schema.

---

## 5. Database & Migration Certification

`DATABASE_GOVERNANCE = PASS`

- Authoritative baseline exists (`database/baseline/STUDYUS_BASELINE_2026_08.sql`) and remains immutable — confirmed unedited since Phase 0D (Phase 0E2's new tables went into a separate `database/migrations/` file, exactly per the governance rule).
- `database/migrations/` exists and now holds exactly one real migration (`20260831_1400_ai_execution_and_decision_audit.sql`); legacy `migrations/001-030` is untouched and its non-authoritative status remains documented in `docs/architecture/database-governance.md`.
- **Production ledger, re-checked live this phase**: `schema_migrations` shows 2 applied (`STUDYUS_BASELINE_2026_08`, `20260831_1400_ai_execution_and_decision_audit`), **0 pending, 0 drifted** — checksums match the version-controlled files byte-for-byte.
- `db:status` and `db:migrate` both work as expected; `db:migrate` is not wired into `next build`/`next start`/any CI config — confirmed by inspecting `package.json`'s scripts, `next.config.*`, and the absence of any `.github/workflows` directory.
- `npm run db:repro-test` → `REPRODUCIBILITY_TEST = PASS` (re-run this phase). `npm run db:migration-test` → `MIGRATION_TEST = PASS` (re-run this phase).

---

## 6. Code ↔ Schema Alignment

`CODE_SCHEMA_ALIGNMENT = PASS`

Spot-checked live production this phase (read-only, counts/column-names/constraints only): `students`, `profiles`, `subjects`, `concepts`, `mastery_records`, `learning_evidence`, `concept_knowledge_state`, `verification_attempts` all match the code's expectations (same columns `mastery.service.ts`/`knowledge-state.service.ts`/`assessment-verification.service.ts` already read/write, same FK targets documented in Phase 0B/0C). `ai_execution_events`/`decision_events` — full column/constraint/index verification already performed in Phase 0E2-P, re-confirmed present and unchanged this phase. No drift found; no full 50-table re-audit was warranted (no evidence of drift surfaced).

---

## 7. Learning Evidence Certification

`LEARNING_EVIDENCE = PASS`

- `learning_evidence` exists live (re-confirmed), and every mastery-affecting action traced this phase (`gradeAnswer`/`gradeStructuredAnswer` → `updateMastery`, `evaluateExplanation` → `updateMastery`, `evaluateTransferResponse` → `updateMastery`, verification resolution → `submitQualifiedAssessmentEvidence` → `updateMastery`) funnels through the one canonical `mastery.service.ts::updateMastery` pipeline — confirmed by the regression scan (§16): zero competing scoring write paths.
- Evidence rows carry `student_id`/`concept_id` (mandatory, `NOT NULL`), explicit `source_type`/`result` semantics, and the full AI-assistance/learning-mode/score telemetry set (`hints_used`, `ai_assistance_type`, `learning_mode`, `confidence_before_answer`, `score_percent`) — unchanged since before this Phase 0 arc began.
- AI provenance is preserved exactly where Phase 0E2 instrumented it: `metadata.aiExecution`/`metadata.aiGrading` on the free-text-grading, Explain & Defend, and Transfer evidence paths, additively, with no changed meaning of any pre-existing field.
- The one duplicated (not competing) write is a zero-value initialization: `concept-extraction.service.ts` and `mastery.service.ts::getOrCreateMasteryRecord` both `INSERT INTO mastery_records (...) VALUES (..., 0, 0, 0, 0, 0)` when a concept is first created — never a scored write, never divergent logic, just the same bootstrap pattern duplicated in two places. Noted as a minor DRY item in §18, not a correctness risk.

**Evidence types not yet captured** (identified, not implemented, per this phase's explicit no-build mandate): there is no evidence type distinguishing a *retry* of the same question from a fresh attempt; no evidence captures a student's *self-corrected* answer within one session; and Explain & Defend's/Transfer's richer per-dimension rubric detail (`RubricResult`'s conceptAccuracy/reasoning/completeness) is folded into a single `scorePercent` before it reaches `learning_evidence` — the per-dimension breakdown itself doesn't persist past the API response. None of these block Phase 1; they're worth Phase 1/2 awareness if the Learner Model needs finer-grained evidence someday.

---

## 8. Mastery Engine Certification

`MASTERY_ENGINE = PASS`

- One canonical algorithm (`src/lib/algorithms/mastery.ts`), untouched by any Phase 0 commit — confirmed via `git status` showing zero diff on this file throughout the entire arc.
- One canonical write path — `mastery.service.ts::updateMastery`, confirmed the sole caller of `algorithmUpdateMastery` (regression scan, §16).
- Mastery scale is 0-100 (re-confirmed, both in code — `mastery-format.ts`'s branded `MasteryScore` — and live schema: `mastery_records.mastery_score numeric(5,2)`, spot-checked this phase).
- Evidence drives mastery exclusively; AI never assigns a mastery score directly — every AI-graded input (free-text quiz answers, Explain & Defend rubric, Transfer evaluation) passes through `gradeAnswer`/`evaluateExplanation`/`evaluateTransferResponse`'s own deterministic score-derivation logic before ever reaching `updateMastery`, and `updateMastery` itself only ever calls the one deterministic algorithm.
- Algorithm is deterministic — same input evidence always produces the same score (no AI call inside `src/lib/algorithms/mastery.ts` at all).
- Every mastery change still creates `mastery_events` (domain history, unchanged) **and now also** a `decision_events` `MASTERY_UPDATED` row (Phase 0E2's cross-engine audit twin) — verified as a real, live column/constraint set in production (§0E2-P).
- No duplicate live mastery-scoring engine found — `priority-engine.service.ts`, flagged dead by 0A, remains unwired (not re-verified live this phase in depth, but no evidence surfaced to the contrary and it was not touched by any Phase 0 commit).

Critical tests re-run this phase: `mastery.test.ts`, `mastery-format.test.ts`, `exam-result-mastery-scale.test.ts` — all passing.

---

## 9. Knowledge State Certification

`KNOWLEDGE_STATE = PASS`

- The five parallel dimensions (understanding/independence/application/retention/transfer) remain the live model — `knowledge-state.service.ts`'s `DimensionScores` type, unchanged.
- Projection exists (`recalculateConceptKnowledgeState`), policy is versioned (`mastery_policy_version`, a real, live-queried integer, not a fabricated constant), `state_reason` exists and is populated on every projection.
- Projections are now auditable through `decision_events` (`KNOWLEDGE_STATE_PROJECTED`, Phase 0E2) — every successful projection produces a row, capturing the full dimension-score snapshot and the exact pre-existing `state_reason` object, without altering a single threshold.
- **Explicitly confirmed NOT a Bloom's-style RECALL→UNDERSTAND→APPLY→ANALYZE→TRANSFER→EVALUATE progression**: `CognitiveLevel` exists as a type (`quiz-generation.service.ts`, one reference, unproduced scaffolding — re-confirmed this phase, unchanged since 0A) but is not the live Knowledge State model. The live model is the five-dimension one described above.

This certifies the *current* model is reliable and honestly represented — it does not certify or preclude any future cognitive-progression redesign, which the task correctly scopes to a later phase.

---

## 10. Verification Engine Certification

`VERIFICATION_ENGINE = PASS`

Full chain re-traced this phase: `evaluateAssessmentEvidence` (deterministic, `src/lib/verification-triggers.ts`, unmodified throughout Phase 0 — confirmed via git status) → `generateQuestionVariant`/`evaluateVariantEquivalence` (fails closed on any equivalence mismatch, unchanged) → `createPendingVerificationAttempt` → `verification_attempts` (confirmed live, both in 0B's original forensic pass and 0E2-P's own row-count checks) → student response → `resolveVerificationAttempt` → `submitQualifiedAssessmentEvidence` → `updateMastery`.

- Persistence is live (re-confirmed by count, unchanged before/after 0E2-P's migration: 2 rows).
- Trigger thresholds unmodified — `verification-triggers.ts`/`assessment-confidence.ts` show zero diff throughout the entire Phase 0 arc (git status re-checked this phase).
- Verification decisions are now audited: `VERIFICATION_REQUIRED`/`VERIFICATION_NOT_REQUIRED`/`VERIFICATION_RESOLVED` all instrumented (Phase 0E2), capturing the real fired trigger ids, never invented ones.
- AI grading provenance links where applicable — free-text verification-question grading's `aiExecutionId` flows into the `VERIFICATION_RESOLVED` decision event; deterministic (structured-answer) verification correctly leaves it null.

Critical tests re-run this phase: `verification-triggers.test.ts`, `verification-variant-wiring.test.ts`, `verify-route.test.ts`, `assessment-verification.service.test.ts` — all passing.

---

## 11. AI Contract Certification

`AI_CONTRACT = PASS`

- One canonical gateway (`src/lib/ai/gateway.ts::executeAI`) — re-confirmed the only path in.
- Anthropic/OpenAI fully behind adapters (`src/lib/ai/adapters/`).
- **Direct provider calls outside adapters this phase's own regression scan: 0** (`grep` for `api.anthropic.com`/`api.openai.com` outside `src/lib/ai/adapters/`).
- Every AI execution gets a unique `executionId` (`crypto.randomUUID()`, unchanged since 0E1).
- Every live prompt has an explicit `promptId`/`version` (21-entry registry, unchanged since 0E1, no prompt rewritten in 0E2 or this phase).
- Structured responses require validation; HIGH_RISK outputs cannot bypass it — enforced structurally by `executeAI`'s own control flow (no `result` without a passing `validate`), unchanged.
- Bounded timeout (30s default) and normalized errors (`AIErrorCode`) unchanged.
- Raw prompt/response and credentials are not logged by default — `src/lib/ai/logging.ts`'s field allowlist, unchanged, still proven by a dedicated test.
- **Model selections unchanged since 0E1**: `claude-sonnet-5` (all Anthropic calls), `gpt-5.6` (OpenAI chat), `text-embedding-3-small` (OpenAI embeddings) — re-confirmed by grep this phase, matching 0E1's inventory exactly, no model string touched by 0E2 or this phase.

---

## 12. Auditability Certification

`AUDITABILITY = PASS`

Verified in both code and database this phase:

- `ai_execution_events`/`decision_events` both exist **live in production** (re-confirmed, not assumed from the 0E2-P report — this phase independently re-queried `information_schema.tables`).
- Canonical write path for each: exactly one `INSERT INTO ai_execution_events` (`src/lib/ai/audit.ts`) and one `INSERT INTO decision_events` (`src/lib/audit/decision-events.ts`) exist anywhere in `src/` — regression-scanned this phase, zero ad hoc writes found.
- `AI_EXECUTIONS_WITHOUT_AUDIT_PATH = 0` — all 14 AI-calling service files use `executeAI()` (re-confirmed by grep), and the gateway unconditionally attempts an audit write for every execution, success or failure.
- `MASTERY_UPDATED`, `KNOWLEDGE_STATE_PROJECTED`, `VERIFICATION_REQUIRED`/`NOT_REQUIRED`/`RESOLVED`, `LEARNING_DEBT_CREATED`/`RESOLVED`, `MISCONCEPTION_RECORDED` are all instrumented at real, traced call sites (§9-§13 of the 0E2 report, re-spot-checked this phase by re-reading the actual instrumented code, not just the report's claim).
- AI-to-decision linking exists only when real, never fabricated — the ambiguous multi-question quiz-bucket path deliberately leaves `ai_execution_id` null while preserving full per-question detail in `learning_evidence.metadata`.
- No raw prompt/response stored — proven by dedicated tests in Phase 0E2, re-confirmed by re-reading the migration's own column list this phase (no content column exists on either table).

**Important qualifier, load-bearing for §13**: this "PASS" certifies the *code and its correctness* — not that this code is currently protecting real production AI calls. See §13.

---

## 13. Production Code Alignment

**`PRODUCTION_APPLICATION_VERSION = MISALIGNED`**

This is the most significant finding of this certification phase, and the reason the overall answer is `YES_WITH_CONDITIONS` rather than a clean `YES`.

**Evidence, not assumption**:
- `git log -3 --format="%h %ai %s"` on `HEAD` (branch `main`) shows the latest commit is `af847a6`, dated **2026-08-24** — a full week before Phase 0A even began (2026-08-26, per its own report header).
- `git cat-file -e HEAD:src/lib/ai` → **"fatal: path 'src/lib/ai' exists on disk, but not in 'HEAD'."** The entire AI gateway does not exist in git history at all.
- `git show HEAD:src/services/mastery.service.ts | grep -c recordDecisionEvent` → **0**. The committed version of `updateMastery` has no decision-audit instrumentation.
- `git log --all --oneline -- src/lib/ai/` → empty. This code has never been committed on any branch, ever.
- `git status --short` shows **66 files** with uncommitted changes — effectively this entire Phase 0 arc (0C's identity fix, 0D's baseline/governance tooling, the mastery-format hotfix, 0E1's gateway, 0E2's audit trail) exists **only in this one local working tree**.
- The repository's `origin` is a real GitHub remote (`github.com/Johnalbornoz/StudyOS.git`), and `.vercel/project.json` confirms a real, linked Vercel project (`study-os`) — the standard deployment path is git-push-triggers-build. Since nothing has been pushed (nothing has even been committed), production is necessarily still running whatever was live as of `af847a6`.
- Corroborating (not sole) evidence: `ai_execution_events`/`decision_events` both show **0 rows** in production, consistent with — though not conclusive proof of, on its own — no deployed code ever having written to them. The git-history evidence above is the definitive proof; the row counts are simply consistent with it.

**Consequence**: Phase 0E2-P's schema activation is real and correct, but it activated a schema for application code that isn't live yet. Production today is still making raw, unaudited AI calls (pre-0E1 architecture), still has the pre-0C `verifySubjectAccess` bug in whatever form it was in on 2026-08-24, and has no cross-engine decision audit trail actually recording anything. **The database is ahead of the application.**

`PRODUCTION_CODE_ALIGNMENT = FAIL` — not because the code is wrong, but because there is definitive evidence it is not deployed, and "the application writing to it" (this phase's own required framing) demonstrably does not yet exist in production.

---

## 14. Audit Privacy Boundary

`AUDIT_PRIVACY = PASS`

Scoped narrowly to the Phase 0E1/0E2 audit infrastructure only (not a broader StudyUs privacy certification, per this phase's own instruction). Re-confirmed this phase by re-reading the live migration file's column list directly: neither `ai_execution_events` nor `decision_events` has a column capable of holding a raw prompt, raw AI response, student free-text answer, name, email, or credential — both tables' entire column sets are ids, enum-like strings, numeric/boolean outcomes, and small structured jsonb built only from those same fields. This was already proven by dedicated tests in Phase 0E2 (`tests/unit/audit-no-raw-content.test.ts`), which this phase re-ran as part of the full suite (§15) and confirmed still passing.

---

## 15. Engineering Health

`ENGINEERING_HEALTH = PASS`

Re-run independently this phase (not copied from prior reports):

```
TypeScript:  npx tsc --noEmit         -> clean, exit 0
Tests:        npx vitest run           -> 64 test files, 727 tests, all passed
Build:         npm run build            -> exit 0
DB repro:      npm run db:repro-test    -> REPRODUCIBILITY_TEST = PASS
Migration test: npm run db:migration-test -> MIGRATION_TEST = PASS
Migration status (production): 2 applied, 0 pending, 0 drifted
Lint:          LINT_NOT_CONFIGURED (no ESLint config, no `lint` script -- unchanged since Phase 0A)
```

Critical test groups re-run in isolation for this certification: `mastery.test.ts`, `mastery-format.test.ts`, `exam-result-mastery-scale.test.ts`, `knowledge-state.test.ts`, `knowledge-state-labels.test.ts`, `verification-triggers.test.ts`, `verification-variant-wiring.test.ts`, `verify-route.test.ts`, `assessment-verification.service.test.ts`, `learning-debt.test.ts`, `auth-identity-and-subject-access.test.ts`, `schema-contract.test.ts`, `audit-schema-contract.test.ts`, `migration-ledger.test.ts` — **195/195 passing**.

Per this phase's own instruction, the absence of lint tooling alone does not fail this certification — `tsc --strict` is on and clean, and no other evidence points to a broader quality problem.

---

## 16. Architecture Regression Scan

```
RAW_AI_PROVIDER_CALLS_OUTSIDE_ADAPTERS = 0
ALTERNATE_MASTERY_WRITE_PATHS = 0   (one duplicated zero-value INIT pattern noted in §7 -- not a scoring path)
ACTIVE_STUDENT_SUBJECTS_QUERIES = 0
AI_AUDIT_AD_HOC_WRITES = 0   (exactly 1 canonical location: src/lib/ai/audit.ts)
DECISION_AUDIT_AD_HOC_WRITES = 0   (exactly 1 canonical location: src/lib/audit/decision-events.ts)
```

All expected values met. No architecture regression found in this codebase's current (uncommitted) state.

---

## 17. Foundation Invariants

| ID | Invariant | Status | Evidence |
|---|---|---|---|
| F01 | One canonical concept id (`concepts.id`) | **HOLDS** | §4 — 15 tables + 2 audit tables, zero exceptions |
| F02 | Evidence before mastery | **HOLDS** | §7/§8 — every scored path writes `learning_evidence` before/through `updateMastery`; no direct mastery write bypasses it |
| F03 | AI does not assign mastery directly | **HOLDS** | §8 — AI outputs only ever become deterministic-algorithm *inputs* |
| F04 | Structured HIGH_RISK AI output must be validated | **HOLDS** | §11 — enforced structurally by the gateway, not by convention |
| F05 | Mastery algorithm remains deterministic | **HOLDS** | §8 — zero AI call inside `src/lib/algorithms/mastery.ts`, unmodified throughout Phase 0 |
| F06 | Assisted performance is distinguishable from independent evidence | **HOLDS** | `learning_evidence.ai_assistance_type`/`learning_mode`, unchanged, still populated on every write |
| F07 | Every important state-changing decision is auditable | **HOLDS** (code) / **NOT YET LIVE** (production) | §12/§13 — 8 decision types instrumented in code; zero decisions have actually been audited in production yet, since the code isn't deployed |
| F08 | Every AI execution is identifiable by provider/model/prompt/version | **HOLDS** (code) / **NOT YET LIVE** (production) | Same caveat as F07 |
| F09 | Schema changes use governed migrations | **HOLDS** | §5 — proven twice now (0D's ledger bootstrap, 0E2-P's real migration) |
| F10 | No automatic migrations during app startup/build | **HOLDS** | §5 — re-confirmed via `package.json`/`next.config.*`/absence of CI |
| F11 | Student identity compatibility invariant must be respected | **HOLDS** | §3 — 12/12 split, 0 orphans, documented, tested |
| F12 | Raw student/AI content is not persisted in cross-engine audit tables | **HOLDS** | §14 |

**F07/F08's split status is the clearest possible illustration of §13's finding**: the invariant is real and enforced *in the code that exists right now in this working tree*, but has never been exercised by a real production request, because that code has never been deployed.

---

## 18. Remaining Risks

| Risk | Severity | Classification | Future Owner Phase |
|---|---|---|---|
| Phase 0A-0E2 application code has never been committed or deployed — production runs week-old code missing the entire AI gateway/audit trail | **HIGH** | **MUST_FIX_BEFORE_PHASE_1** | Immediate (commit + deploy), before or as Phase 1's first act |
| Dual `students`/`profiles` identity architecture (working compatibility model, not the ideal target) | Medium | ACCEPTED_FOUNDATION_RISK | Future dedicated identity-consolidation project (out of scope for any Phase 0 sub-phase) |
| No DB-level range CHECK on `mastery_records.mastery_score` (0-100 enforced only by the algorithm's own clamp) | Low | ACCEPTED_FOUNDATION_RISK | A future, deliberate constraint-hardening migration |
| No lint tooling configured | Low | ACCEPTED_FOUNDATION_RISK | Any future phase, non-blocking per this phase's own instruction |
| Parallel legacy/new question-generation and concept-extraction services (`ai.service.ts` vs `quiz-generation.service.ts`/`concept-extraction.service.ts`) | Low-Medium | DEFERRED | A future consolidation phase (flagged, not attempted, in 0E1) |
| AI context (student/subject/concept) populated only for HIGH_RISK call sites, not MEDIUM/LOW-risk ones | Low | ACCEPTED_FOUNDATION_RISK | Extend opportunistically if a real tracing need arises |
| No audit-table retention/archival tooling yet | Low | DEFERRED | Revisit at the Phase 0E2 report's documented review point (~6 months of data or a few million rows) |
| No automated monitoring/alerting on audit-write failure rate | Low | DEFERRED | Whenever production observability tooling is next touched |
| `validation_cycles`/`validation_events` (Phase 2.2B lifecycle) not yet covered by `decision_events` | Low | DEFERRED | A future phase, only if AI provenance needs to reach into a validation cycle specifically |
| `tests_disabled/` (12 files: 5 integration + 7 unit) remains excluded from the active suite, unaddressed since Phase 0A | Low-Medium | ACCEPTED_FOUNDATION_RISK | A future test-infrastructure cleanup, not blocking |
| Two deployment target artifacts coexist (`.vercel/project.json` + root `Dockerfile`), no `vercel.json`/CI to arbitrate — unaddressed since Phase 0A | Low | ACCEPTED_FOUNDATION_RISK | Worth resolving alongside the MUST_FIX deploy step above, but not a blocker on its own (Vercel is confirmed the real live target via the working `www.studyus.pro` domain) |

---

## 19. Phase 1 Starting Point

Transition map only — not an implementation plan.

**Identity**: Clerk-authenticated, `getOrCreateStudentId`-provisioned, dual `students`/`profiles` UUID space (12/12 split, synchronized). Solid, documented starting point for a Learner Model.

**Academic profile**: `student_academic_profile` exists live — `country_of_study` (CO/MX/US/DE/OTHER), `school_year`, `curriculum_type` (national/ib/other/not_sure), `ib_programme` (MYP/DP), `ib_year`, `academic_year`, `school_name`, `profile_completed` flag. A real, if not exhaustive, academic-context capability already exists.

**Subject ownership**: one-subject-one-student model, `subjects.student_id -> profiles.id`, no junction table — simple and already certified (§3-§6).

**Language**: `user_language_preferences` exists live (untracked in legacy migrations, confirmed live in Phase 0B); per-subject `target_language`/`quiz_language_mode` also exist (`subjects` table).

**Country/school context**: covered by `student_academic_profile` above — no separate dedicated table beyond it.

**IB fields**: both student-level (`student_academic_profile.ib_programme`/`ib_year`) and subject-level (`subjects.ib_programme`/`ib_subject_group`/`ib_level`) — a real, two-tier IB model already exists.

**Learning history**: `learning_evidence` (canonical, certified §7), `mastery_events` (score-delta history), `errors` (classified mistakes).

**Mastery**: `mastery_records` — deterministic, 0-100, certified §8.

**Knowledge-state dimensions**: `concept_knowledge_state` — five parallel dimensions, certified §9.

**Errors**: `errors` table, classified by type (CONCEPTUAL/PROCEDURAL/CARELESS/INCOMPLETE/MISREADING), feeds `error-intelligence.service.ts`'s pattern detection.

**Misconceptions**: `misconception_signatures` (normalized, reusable) + `student_misconceptions` (per-student occurrence tracking, critical/recurring flags) — certified as concept-identity-clean in §4.

**Assessment history**: `assessment_results`/`assessment_occurrences` (real school exams), `verification_attempts` (in-app verification), both certified live (§6/§10).

**Study plans**: `study_plans` exists live.

**Availability**: `student_availability` exists live.

**Known gaps for Phase 1 to be aware of** (not to fix, just to know): no evidence type distinguishes a retry from a fresh attempt (§7); the AI gateway/audit trail this Phase 1 will presumably want to build further on is **not yet deployed to production** (§13) — Phase 1 should not assume it is live when reasoning about what "currently happens" for real students.

---

## 20. Foundation Certification Matrix

| Foundation | Status | Blocking? |
|---|---|---|
| Identity | PASS | No |
| Concept Identity | PASS | No |
| Database | PASS | No |
| Evidence | PASS | No |
| Mastery | PASS | No |
| Knowledge State | PASS | No |
| Verification | PASS | No |
| AI | PASS | No |
| Auditability | PASS (code) / NOT LIVE (production) | **Conditionally — see §13** |
| Production Alignment | **FAIL** | **YES — this is the one true blocker for an unconditional YES** |
| Testing | PASS | No |

---

## 21. Application Validation

```
TypeScript:         npx tsc --noEmit          -> clean, exit 0
Tests:                npx vitest run            -> 64 test files, 727 tests, all passed
Build:                 npm run build             -> exit 0
DB reproducibility:   npm run db:repro-test     -> REPRODUCIBILITY_TEST = PASS
Migration test:        npm run db:migration-test -> MIGRATION_TEST = PASS
Migration status:      2 applied (STUDYUS_BASELINE_2026_08, 20260831_1400_ai_execution_and_decision_audit), 0 pending, 0 drifted
Lint:                  LINT_NOT_CONFIGURED (no ESLint config, no `lint` script)
```

All re-run independently by this phase, not copied from prior reports.

---

## 22. Definition of Done

- [x] Identity contract understood and stable — §3.
- [x] Canonical concept identity stable — §4.
- [x] Database reproducible — §5.
- [x] Migration governance operational — §5.
- [x] Learning Evidence canonical — §7.
- [x] Mastery deterministic — §8.
- [x] Knowledge State deterministic — §9.
- [x] Verification operational — §10.
- [x] AI gateway canonical — §11.
- [x] High-risk AI validated — §11.
- [x] AI provenance available — §11/§12.
- [x] Decision auditability operational — §12 (in code; not yet exercised in production, §13).
- [x] Production audit tables active — §13 (schema only; application not yet deployed).
- [x] No architecture regressions detected — §16.
- [x] Tests pass — §15/§21.
- [x] Build passes — §15/§21.
- [x] Foundation invariants documented — §17.

---

## 23. Final Decision

**A. FOUNDATION_READY_FOR_LEARNING_OS?**
**YES_WITH_CONDITIONS.**

**B. Is a major rewrite required before continuing?**
**NO.** The one material gap is a deployment/process gap, not an architectural one.

**C. Can Phase 1 — Learner Model Certification begin?**
**YES_AFTER_REMEDIATION.**

**D. List every MUST_FIX_BEFORE_PHASE_1 issue.**
1. Commit and deploy the current working tree (Phases 0A through 0E2's application code) to production. Until this happens, every "PASS" in this report describing live application behavior (§11, §12, F07/F08) is true only of this local working tree, not of what real students are experiencing.

**E. List maximum five accepted foundation risks.**
1. Dual `students`/`profiles` identity architecture — stable, documented, tested compatibility model, not the ideal target design.
2. No DB-level range CHECK on `mastery_records.mastery_score`.
3. No lint tooling configured.
4. `tests_disabled/` (12 files) excluded from the active suite since before this Phase 0 arc began.
5. Two coexisting deployment-target artifacts (`Dockerfile` + Vercel project) with no explicit arbitration.

**F. What is the single most important architectural rule future phases must not violate?**
**F02 — evidence before mastery.** Every other invariant in §17 exists in service of this one: mastery is a deterministic function of persisted, auditable evidence, never a direct AI judgment, never computed from state that isn't itself traceable back to something a student actually did. A Learning State & Decision Engine that ever writes a mastery-adjacent value without a `learning_evidence` row (and now, ideally, a `decision_events` row) behind it breaks the one thing every other Phase 0 certification in this report is actually protecting.

**G. What is the first objective of Phase 1?**
Certify the current Learner Model's actual capabilities and gaps against whatever Phase 1's own name implies it needs to support — starting from the transition map in §19 — **after** confirming (not assuming) that the code being certified is the code actually running in production, which as of this report, it is not.

---

*End of report. No code, schema, prompt, threshold, or model was changed by this phase.*
