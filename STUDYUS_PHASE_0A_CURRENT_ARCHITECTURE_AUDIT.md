# StudyUs Phase 0A — Current Architecture Audit

Audit type: read-only, evidence-based. No code, schema, or data was modified. No commit, push, deploy, or migration was performed. Repository: `/Users/jalbornoz/PROYECTOS/studyos`. Date: 2026-08-26.

---

## 1. Executive Summary

- **Framework**: Next.js 16.3.1 (App Router) + React 19.2.8 + TypeScript (strict), on raw `pg` (node-postgres) against a Postgres database (very likely Neon, unconfirmed from source alone), no ORM.
- **Auth**: Clerk (`@clerk/nextjs`), resolved to an internal student UUID via `getOrCreateStudentId`.
- **AI**: Two providers (Anthropic `claude-sonnet-5` dominant, OpenAI for embeddings + one formula-widget feature), **16 independent raw-`fetch` Anthropic call sites across 11 files plus a 12th SDK-based file — no shared/central AI-calling helper exists anywhere.**
- **CRITICAL — the `migrations/` folder does not reliably describe the live database.** Directly confirmed: migration `004`'s own comment states migrations 002/003 "never actually ran" (invalid MySQL-style syntax); migrations `028`/`029` carry explicit "RECOVERY NOTE" admissions of "the accidental local deletion" with files "reconstructed as a repository artifact only." Two independent passes (this session's own direct read, and a dedicated audit sub-agent working separately) both found migration `001` has the identical invalid inline-`INDEX` syntax inside `mastery_records`, `learning_debt`, `errors`, and `error_patterns` — meaning it too could not have run as literally written, yet no later migration ever "fixes" 001 the way 004 fixes 002/003. Several tables/columns the live application depends on heavily have **zero `CREATE TABLE`/`ALTER TABLE` anywhere in `migrations/`**: `profiles`, `student_profiles`, `student_subjects`, `parent_student_relationships`, `learning_evidence`, `assessment_occurrences`, `assessment_results`, `subjects.student_id`, `subjects.status`, `user_language_preferences`. A second, independent audit pass also flagged, unprompted, that migration 001's own text (`mastery_score` `0-1 CHECK`) directly contradicts how the application code treats that same column (0-100) — corroborating this session's own earlier forensic finding on the identical question.
- **Student identity is fragmented across two tables that are not FK-linked, only kept equal by application convention.** `students` (UUID, `clerk_id` unique) is the dominant identifier (24 FK references across the mastery/quiz/debt/knowledge-state domain). `profiles`/`student_profiles` is a second, older identity space that `errors` (one of its two conflicting definitions) and `tutor_conversations` reference directly. `src/lib/auth.ts`'s own comment names this explicitly: "two subsystems that share this database... Both rows are written with the SAME uuid so either FK resolves."
- **Concept identity is genuinely canonical.** Every concept-scoped table found (19+) consistently uses `concepts.id`. No aliasing/duplication mechanism exists, and none is needed — no fragmentation found here.
- **A generic Learning Evidence layer exists in application code (`learning_evidence`, "the canonical source of truth" per its own service comments) and is the single write target for every mastery-affecting action** — but its base table has no tracked `CREATE TABLE` (see above), so its actual live shape cannot be independently verified from this repo.
- **Mastery is centrally computed** by one deterministic algorithm (`src/lib/algorithms/mastery.ts`), invoked only through `mastery.service.ts`'s `updateMastery`, called from 6 route/service call sites. No competing mastery-calculation logic was found live (one duplicate, `priority-engine.service.ts`, is confirmed unwired/dead).
- **The Verification Engine (Phase 3B) is wired end-to-end into a real, reachable user flow, but its persistence table (`verification_attempts`, migration 030) is explicitly documented in-code as never executed against Neon** — meaning, as shipped, the verification follow-up question path likely fails silently (caught by a `try/catch`) every time it would otherwise fire.
- **A genuine Bloom's-style cognitive-level progression (RECALL→...→EVALUATE) does NOT exist.** A `CognitiveLevel` type exists but is documented in-code as intentionally unproduced scaffolding, never populated by the generator. What does exist and is fully live is a *different*, non-sequential model: five parallel Knowledge State dimensions (understanding/independence/application/retention/transfer).
- **Quiz/assessment lifecycle is a single, coherent, well-instrumented pipeline** (`generate-and-take/route.ts` + `quiz-generation.service.ts` + `quiz-persistence.service.ts` + `mastery.service.ts`), but carries three dead/legacy artifacts: an orphaned `generate/route.ts`, an unused `quiz_responses` table, and a dead `ai.service.ts` (SDK-based, zero validation, still reachable from two unreferenced routes).
- **AI output becomes system state without a deterministic check in at least 3 confirmed places**: `errors.error_type` (free-text grading), `misconception_signatures.is_critical`, and the correctness signal itself for free-text quiz questions (`gradeAnswer`'s own `score >= 0.5` judgment). Mastery itself is never written directly by AI — always through the deterministic algorithm — but its input evidence can be AI-judged for free-text items.
- **No lint tooling is configured** (no ESLint config, no `lint` script). TypeScript strict mode is on and `tsc --noEmit` passes clean. **Two deployment targets appear simultaneously in-repo** (`.vercel/project.json` and a Render-oriented `Dockerfile`), with no `vercel.json` or CI config to arbitrate.
- **Test suite is healthy in isolation**: 53 active files, 610 tests, all passing, ~1s runtime — but 12 additional files sit in an excluded `tests_disabled/` directory, and zero tests exercise a real (non-mocked) database, meaning the schema-drift risk above is entirely untested.

---

## 2. Current Technology Stack

| Layer | Technology | Evidence |
|---|---|---|
| Framework | Next.js `16.3.1`, App Router | `package.json` |
| UI | React `19.2.8` / React DOM `19.2.8` | `package.json` |
| Language | TypeScript `^5`, `strict: true` | `tsconfig.json` |
| Package manager | npm (`package-lock.json` present; no pnpm/yarn/bun lockfiles) | repo root |
| Auth | Clerk `@clerk/nextjs ^7.7.9`; `clerkMiddleware()` in `src/middleware.ts`; `auth()`/`currentUser()` in `src/lib/auth.ts` | `src/middleware.ts`, `src/lib/auth.ts` |
| Database client | Raw `pg ^8.23.0` (`node-postgres`) via a single `Pool` in `src/lib/db.ts`. **No ORM** (Prisma/Drizzle: NOT FOUND) | `src/lib/db.ts` |
| DB host | Very likely Neon (referenced by name in code comments, e.g. `assessment-verification.service.ts:315`), but no `@neondatabase/serverless` package and no connection string inspected — **UNVERIFIED** | grep across `src`, `package.json` |
| Schema management | Plain SQL files, `migrations/001`–`030` (30 files), no migration runner found in `package.json` scripts | `migrations/` |
| AI (primary) | Anthropic, model `claude-sonnet-5`, via raw `fetch` (16 call sites, 11 files) + one `@anthropic-ai/sdk` file | see §11 |
| AI (secondary) | OpenAI `^7.5.0` — `text-embedding-3-small` (RAG embeddings) and `gpt-5.6` (interactive formula widget) | `src/services/embedding.service.ts`, `src/services/interactive-formula.service.ts` |
| Payments | Mercado Pago — fully scaffolded, explicitly inert (`MERCADOPAGO_ACCESS_TOKEN` not set, degrades to `PAYMENT_NOT_CONFIGURED`) | `src/services/payment.service.ts` |
| Other services | Cloudinary referenced only as a TODO/unused build arg; no email/SMS provider wired (in-app notifications only); Clerk webhooks via `svix` | `src/app/api/content/upload/route.ts`, `Dockerfile`, `src/services/notifications.service.ts` |
| Testing | Vitest `^4.1.11`, `vitest.config.mts` (`environment: 'node'`, `include: ['tests/**/*.test.ts']`) | `vitest.config.mts` |
| Linting | **NOT CONFIGURED** — no ESLint config file, no `lint` script | `package.json`, repo root |
| Deployment | Ambiguous — `.vercel/project.json` present (Vercel-linked) **and** a `Dockerfile` with Render-specific comments, no `vercel.json`, no `.github/workflows` (CI: NOT FOUND) | `.vercel/project.json`, `Dockerfile` |
| Unused dependency | `@supabase/supabase-js` declared, zero usage found in `src/` | `package.json` |

---

## 3. Current Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (Next.js App Router, React 19)                              │
│  src/app/dashboard/**  — Today, Subjects, Quiz, Progress, Tutor, ...  │
└───────────────────────────────┬────────────────────────────────────-─┘
                                 │ fetch (same-origin)
┌────────────────────────────────▼───────────────────────────────────-─┐
│  Next.js Route Handlers  src/app/api/**/route.ts  (74 route dirs)    │
│  auth via verifyAuth()/verifyStudentAccess() (src/lib/auth.ts)       │
└───┬─────────────┬─────────────┬─────────────┬─────────────┬──────-──┘
    │              │             │             │             │
    ▼              ▼             ▼             ▼             ▼
┌────────┐   ┌───────────┐  ┌─────────┐  ┌───────────┐  ┌───────────┐
│ Quiz/  │   │ Mastery / │  │ Verifi- │  │ Curriculum│  │ Orchestr- │
│ Assess-│   │ Knowledge │  │ cation  │  │ / Concept │  │ ation     │
│ ment   │──▶│ State     │◀─│ Engine  │  │ services  │  │ (3C/3D)   │
│ services│  │ (mastery. │  │(Phase3B)│  │           │  │           │
└───┬────┘   │ service.ts│  └────┬────┘  └───────────┘  └───────────┘
    │        │ + know-   │       │
    │        │ ledge-    │       │            47 service files total
    │        │ state.svc)│       │            (src/services/*.service.ts)
    │        └─────┬─────┘       │
    │              │             │
    ▼              ▼             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  14 files independently call an AI provider (16 Anthropic fetch      │
│  sites in 11 files + 1 SDK file + 2 OpenAI fetch sites) — NO shared  │
│  central AI helper. Only shared piece: parseAIJson() (fence-strip)   │
└──────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Postgres (raw pg.Pool, src/lib/db.ts) -- likely Neon, unverified    │
│  30 tracked migration files -- CONFIRMED not fully reliable          │
│  (002/003 admittedly never ran as committed; 028/029 explicitly      │
│  "reconstructed after an accidental local deletion"; 001 contains    │
│  the same invalid syntax as 002/003; several live tables/columns     │
│  have NO CREATE/ALTER TABLE anywhere in migrations/ at all)          │
└──────────────────────────────────────────────────────────────────────┘

External:  Clerk (auth+webhook) · Anthropic API · OpenAI API · Mercado Pago (inert)
```

---

## 4. Codebase Domain Map

| Responsibility | Primary files |
|---|---|
| Student/profile | `src/lib/auth.ts` (identity resolution), `src/services/student.service.ts` (orphaned parallel path), `src/services/academic-profile.service.ts`, `src/app/dashboard/profile/` |
| Subjects | `src/app/api/subjects/**`, `src/app/dashboard/subjects/**`, `src/lib/subject-color.ts` |
| Curriculum/topics/concepts | `src/services/concept-graph.service.ts`, `topic-hierarchy.service.ts`, `concept-extraction.service.ts`, `concept-explanation.service.ts`, `src/lib/ib.ts` |
| Quizzes | `src/services/quiz-generation.service.ts`, `quiz-persistence.service.ts`, `src/app/api/quizzes/**` |
| Question generation | `quiz-generation.service.ts` (`generateQuestionsForConcept`, `generateQuestionVariant`) |
| Attempts/answers/scoring | `quiz-persistence.service.ts`, `assessment.service.ts`, `exam-result.service.ts`, `src/app/api/assessments/**` |
| Mastery | `src/services/mastery.service.ts`, `src/lib/algorithms/mastery.ts`, `src/lib/mastery-format.ts` |
| Cognitive levels | `src/services/cognitive-diagnosis.service.ts`, `src/app/api/cognitive/**` (an inert `CognitiveLevel` type lives in `quiz-generation.service.ts`) |
| Misconceptions/errors | `src/services/misconception.service.ts`, `error-intelligence.service.ts` |
| Verification | `src/services/assessment-verification.service.ts`, `validation-cycle.service.ts`, `external-assessment.service.ts`, `src/lib/verification-triggers.ts` |
| Question variants | `quiz-generation.service.ts` (`generateQuestionVariant`, `evaluateVariantEquivalence`) |
| Learning evidence/history | `src/services/knowledge-state.service.ts` + `knowledge-state-backfill.service.ts`, `learning-os-snapshot.service.ts` |
| Plans/scheduling | `study-plan.service.ts`, `today-plan.service.ts`, `learning-scheduler.service.ts`, `learning-execution-scheduler.service.ts`, `adaptive-learning-orchestrator.service.ts`, `next-best-action-v3.service.ts`, `priority-engine.service.ts` (dead) |
| AI services | 13 files under `src/services/` calling Anthropic or OpenAI directly (full inventory in §11) |
| Admin | `src/services/admin.service.ts`, `src/app/api/admin/**`, `src/app/dashboard/admin/**` |
| Analytics | `src/lib/analytics.ts`, `client-analytics.ts`, `src/app/api/analytics/track/route.ts` |
| Tests | `tests/unit/*.test.ts` — 53 active files; `tests_disabled/` — 12 excluded files |

47 `.service.ts` files total in `src/services/`; 74 API route directories under `src/app/api/`.

---

## 5. Learner Model

**Canonical table**: `students` (`migrations/001_create_core_tables.sql:5-14`) — `id UUID PK`, `clerk_id TEXT UNIQUE NOT NULL`, `email`, `name`, `language`, `timezone`.

**Resolution**: `getOrCreateStudentId(clerkUserId)` (`src/lib/auth.ts:152-171`) — looks up `students.clerk_id`, creates on first use via `upsertStudentRecord`.

**Confirmed identity fragmentation** — this is the single most important Learner Model finding:

`src/lib/auth.ts:87-93`'s own doc comment states verbatim: *"the student identity across both subsystems that share this database: the original StudyOS profiles/student_profiles tables (subjects.student_id references profiles.id) and IC-Engine's students table (mastery/learning-debt/quizzes/content reference students.id). Both rows are written with the SAME uuid so either FK resolves."*

- `students` is the dominant identifier: **24** `REFERENCES students(id)` lines across `migrations/`, backing `mastery_records`, `learning_debt`, `quiz_sessions`, `concept_knowledge_state`, `subscriptions`, `analytics_events`, and more.
- `profiles`/`student_profiles` is a second, older identity space: only **2** `REFERENCES profiles(id)` lines exist (`errors`, one of two conflicting definitions — see §12; and `tutor_conversations`/`tutor_messages`, migration 013). Neither `profiles` nor `student_profiles` has a `CREATE TABLE` anywhere in `migrations/` — both exist live but are untracked in version control.
- The two spaces are reconciled only by convention: `ensureProfileRows`/`upsertStudentRecord` writes the *same* UUID into both `students` and `profiles`/`student_profiles` on every login — there is no FK constraint tying them together.
- A **third, parallel, apparently dead** identity-creation path exists: `src/services/student.service.ts`'s `createStudent`/`getStudent` writes directly into `profiles`/`student_profiles` using the raw Clerk `userId` as the UUID, with **no `students` row created at all** and no caller found anywhere in the codebase.
- `subjects.student_id` (referenced by `profiles.id` per the comment above, and queried directly in `mastery.service.ts:507`) has **no `ALTER TABLE subjects ADD COLUMN student_id`** anywhere in `migrations/` — its origin is entirely untracked.

**Parent identity**: layered on `profiles` (`user_type='parent'`), resolved via `profiles.clerk_id` (added by `migrations/011_parent_identity.sql`) — `getOrCreateParentId` in `src/lib/auth.ts:192-206`. `parent_student_relationships` (junction table, status workflow added by `migrations/012`) joins `profiles`-space parent IDs to `students`-space student IDs — itself has no `CREATE TABLE` anywhere in `migrations/`.

**Identifier inventory**: `student_id` (86 files), `clerk_id`/`clerkUserId` (4 + 23 files), `user_id` (1 file, `user_language_preferences` — table also untracked). `profile_id`, `learner_id`, literal `clerk_user_id`: **NOT FOUND**.

---

## 6. Curriculum / Concept Architecture

**Hierarchy, confirmed**: `subjects` → `topics` → `subtopics` → `concepts` (`migrations/001`, extended by `migrations/016_topic_hierarchy.sql`). `concepts` carries `subject_id` (required, direct) and `subtopic_id` (optional, added later).

```sql
-- migrations/001
concepts (id UUID PK, subject_id UUID NOT NULL REFERENCES subjects(id),
          canonical_id TEXT UNIQUE NOT NULL, difficulty INT CHECK 1-5,
          UNIQUE(subject_id, canonical_id))
-- migrations/016
topics (id, subject_id → subjects, name, display_order)
subtopics (id, topic_id → topics, name, display_order)
ALTER TABLE concepts ADD subtopic_id → subtopics
```

**Yes — `concepts.id` is a genuine, consistently-used canonical concept identifier.** 19+ tables carry a `concept_id`-family FK, and every one traces to `concepts(id)`: `concept_localizations`, `mastery_records`, `learning_debt`, `errors` (both definitions), `error_patterns`, `chunk_concept_mappings`, `quiz_sessions` (+ `concept_ids[]`), `study_session_progress`, `concept_explanations`, `concept_relationships` (source+target), `cognitive_diagnoses` (target+candidate), `remediation_paths`/`remediation_steps`, `misconception_signatures`, `concept_knowledge_state`, `validation_cycles`, `assessment_concept_coverage`, `calibration_conflicts`, `verification_attempts` (migration not executed). `learning_evidence` (no tracked `CREATE TABLE`) is written with `concept_id` positionally by application code — consistent by convention, unverifiable against a real table definition.

**No fragmentation found in concept identity** — this is the one identity axis that is genuinely unified.

**No concept-aliasing/equivalence table exists.** `concept_relationships` (migration 023) is a prerequisite/dependency graph (`PREREQUISITE_OF | DEPENDS_ON | RELATED_TO | EXTENSION_OF | APPLIES_TO | COMMONLY_CONFUSED_WITH`) — no `ALIAS_OF`/`EQUIVALENT_TO` value exists. Concepts are strictly single-subject (`subject_id NOT NULL`, no sharing mechanism) — a concept taught in two subjects requires two separate rows/UUIDs.

---

## 7. Quiz & Assessment Engine

**Primary route**: `src/app/api/quizzes/generate-and-take/route.ts` — one `POST` handler dispatching on presence of `quizId` (generate vs. submit).

**Full lifecycle** (all evidence-cited, condensed from the detailed agent trace):

1. **Request** — `GenerateQuizSchema`: studentId, subjectId, conceptId/conceptIds, `quizMode` (default `topic_practice`), maxQuestions, difficulty, language.
2. **Generation** — `generateQuestionsForConcept` (`quiz-generation.service.ts:234`), Anthropic `claude-sonnet-5`, RAG-grounded (falls back to general knowledge if no chunks). Validation is **minimal** (shallow truthy/type checks, no schema library); a genuine truncation-recovery mechanism (`salvageJsonArray`) trims a cut-off response back to its last complete object rather than discarding it.
3. **Storage** — `storeQuiz` (`quiz-persistence.service.ts:74`) → `quiz_sessions` (TEXT PK, app-generated `quiz-${timestamp}-${random}`, 45-min expiry, `activityType`/`evidenceMode` stamped once and never rewritten). **File is `// @ts-nocheck`.**
4. **Submission/grading** — same route, `handleSubmitQuiz`. Structured question types (`single_choice`/`multi_choice`/`matching`/`ordering`/`classification`) graded deterministically (`gradeStructuredAnswer`); free-text types AI-graded (`gradeAnswer`, second Anthropic call) with a naive string-match fallback on parse failure.
5. **Scoring** — per-question `score ≥ 0.5` counts correct; per-concept `Math.round(correct/total*100)`; overall the same pattern.
6. **Persistence of attempt** — `quiz_sessions.status` completed via `completeQuiz`. A sibling `quiz_responses` table (migration 003) is **defined but never written to anywhere** in the submission flow — evidence lives in `learning_evidence` instead.
7. **Mastery trigger** — one `updateMastery` call per concept bucket (`route.ts:703`), feeding `mastery.service.ts` → the deterministic algorithm → `mastery_records` + `mastery_events` + `learning_debt` (conditional) + `learning_evidence` + `errors` (conditional) + `recalculateConceptKnowledgeState` (best-effort, never fails the request).
8. **Verification trigger** — for `CUMULATIVE_ASSESSMENT`/`MOCK_EXAM` only, calls into the Phase 3B Verification Engine (§9).

**Quiz modes** (`ActivityType` × `EvidenceMode`, from `src/lib/activity-taxonomy.ts` + route's `QUIZ_MODE_CONFIG`):

| quizMode | ActivityType | EvidenceMode | Notes |
|---|---|---|---|
| `topic_practice` | PRACTICE | PRACTICE | default, AI hints allowed |
| `review` | REVIEW | PRACTICE | same shape as practice |
| `quick_check` | SOLO_CHECK | INDEPENDENT | ≤6 Qs, fast confidence check |
| `retention_check` | RETENTION_CHECK | INDEPENDENT | unassisted retention proof |
| `cumulative_assessment` | CUMULATIVE_ASSESSMENT | ASSESSMENT | multi-concept, triggers verification |
| `exam_simulation` | MOCK_EXAM | ASSESSMENT | tied to `assessment_occurrences`, triggers verification + exam-readiness calibration |
| `diagnostic_check` | DIAGNOSTIC_CHECK | ASSESSMENT | forced 2-4 Qs, never asks confidence |

Plus `REMEDIATION`, `SOLO_VERIFY`, `TRANSFER` ActivityTypes reachable only from non-quiz routes.

**18 question types** (`quiz-generation.service.ts:37-55`): multiple_choice, multi_select, true_false, yes_no, short_answer, open_ended, fill_blank, matching, ordering, classification, numeric_problem, step_by_step, case_study, scenario, error_detection, justification, comparison, prediction — mapped to 6 `AnswerFormat`s.

**Dead/legacy code confirmed in this domain**:
- `src/app/api/quizzes/generate/route.ts` — different auth pattern (raw Clerk, not `verifyAuth`), never persists to DB, no frontend caller found.
- `quiz_responses` table — defined, never written.
- `src/services/ai.service.ts` (`extractConceptsFromText`, `generateQuestion`) — SDK-based, zero output validation, reachable only from two routes (`/api/concepts/extract`, `/api/quizzes/generate`) with no confirmed caller in the live UI.

---

## 8. Cognitive & Mastery Engine

**Single deterministic write path.** `src/lib/algorithms/mastery.ts`'s `calculateMasteryDelta`/`updateMastery` — pure functions, no DB access, no AI call. Delta = signed base impact (from `scorePercent`) × source-type weight (0.1–1.0) × sample-size factor (1–5, log-scaled) × difficulty modifier (0.4–2.0) × smoothing (0.85) × confidence, boundary-dampened near 0/100, capped at ±(3×sampleSizeFactor). **Output is explicitly clamped `Math.max(0, Math.min(100, newMastery))` — confirmed present unchanged since the file's very first commit.**

`src/services/mastery.service.ts`'s `updateMastery` is the **sole IO wrapper**: reads/creates `mastery_records` → calls the algorithm → `UPDATE mastery_records` → `INSERT mastery_events` (audit trail) → conditional `learning_debt` upsert → `INSERT learning_evidence` → conditional `errors` insert → `recalculateConceptKnowledgeState` (best-effort). Called from exactly 6 route/service sites (`generate-and-take/route.ts`, `exam-result.service.ts`, `assessment-verification.service.ts`, `cognitive/explain/submit`, `cognitive/transfer/submit`, `learning/record-evidence`) — **no other code writes `mastery_records.mastery_score`.**

**Mastery cannot currently be changed directly from an answer submission without going through this pipeline** — every route that grades an answer packages it as `LearningEvidence` and calls `updateMastery`; none writes `mastery_records` directly.

**Duplicated logic found, confirmed dead**: `src/services/priority-engine.service.ts` reimplements a parallel mastery-weighted scoring formula (`scorePriority`, `calculateConceptPriority`) — grep confirms **zero importers** anywhere in `src/app` or other services. `@deprecated` JSDoc already present on it (from a prior session's work, per file inspection).

**Cognitive-level progression (RECALL→UNDERSTAND→APPLY→ANALYZE→TRANSFER→EVALUATE): NOT FOUND as a live mechanism.** A `CognitiveLevel` type exists (`quiz-generation.service.ts:97`: `'RECALL' | 'COMPREHENSION' | 'APPLICATION' | 'ANALYSIS' | 'SYNTHESIS' | 'EVALUATION'` — a genuine Bloom's set, but not the exact wording asked about, and with no `TRANSFER` member) as an **optional field that is never populated by the generator** — its own doc comment states: *"None of these are produced by generation yet... they exist now so the schema/plumbing can carry them end-to-end."* Its only live consumer is the variant-equivalence check, which treats an always-`undefined` value as "nothing to violate."

What genuinely IS live: the Knowledge State's five **parallel, non-sequential** dimensions — `understandingScore`, `independenceScore`, `applicationScore`, `retentionScore`, `transferScore` (`src/services/knowledge-state.service.ts`) — each derived from its own evidence pool, checked simultaneously (not gated in sequence) against independent policy thresholds to produce a `MasteryState`. The file's own header calls them "five KPI dimensions," explicitly not a taxonomy ladder. `TRANSFER` additionally exists as its own `EvidenceSourceType` and its own service (`src/services/transfer.service.ts`) generating/grading application-to-new-context questions — a real, live "Transfer Engine," but an independent evidence stream, not a progression stage.

`difficulty` (1–5, numeric, drives the mastery-impact multiplier) is a wholly separate field from `cognitiveLevel` — confirmed no shared meaning.

---

## 9. Verification Engine

**Trigger conditions** — `evaluateVerificationTriggers` (`src/lib/verification-triggers.ts`), ten independent deterministic checks, exact thresholds: grading confidence < 0.6; confidence spread ≥ 0.4; `|current − prior| score disagreement` ≥ 40 points; weak concept attribution < 0.5; coverage ambiguity < 0.3; variant equivalence < 0.7; behavioral anomaly ≥ 0.6; reasoning/answer inconsistency; profile-mandated (`ADAPTIVE` strictness + confidence < 55). No LLM call in the decision itself.

**When triggered**: `generateQuestionVariant` (`quiz-generation.service.ts:545`) reuses the **same** question-generation Anthropic call (count:1) to produce a variant, then `evaluateVariantEquivalence` checks 6 dimensions and **fails closed** — any mismatch discards the AI output entirely and falls back to reusing the original question with `variantEquivalenceConfidence: null`.

**`variantEquivalenceConfidence` — is it persisted? Column exists in `migrations/030_assessment_verification.sql`, but that migration's own header states verbatim: "NOT EXECUTED as part of this implementation pass — design only, pending explicit review/approval before running against Neon."** Corroborated by `assessment-verification.service.ts:313-318`'s own comment. **In practice, today, this value is an in-memory/response value only — not durably persisted in production**, and the entire `verification_attempts` INSERT would fail against the real database (relation does not exist) if executed.

**Is it reachable from a real user action?** Yes — fully wired end-to-end: quiz submission → `evaluateAssessmentEvidence` → (if required) `generateQuestionVariant` → `createPendingVerificationAttempt` → `verificationNeeded` in the API response → `dashboard/quiz/page.tsx` renders the follow-up → student answers → separate `POST /api/quizzes/verify` → grades, resolves, and calls `updateMastery` again (`sourceType: 'SOLO_VERIFICATION'`, weight 0.9) via `submitQualifiedAssessmentEvidence`. **But** because the persistence table doesn't exist live (per above), the DB insert throws and is silently swallowed by a `try/catch` around the whole per-concept block — meaning, as currently deployed, a legitimately-triggered verification question most likely never reaches a student.

**Pending-state design**: genuinely a two-request, DB-persisted cross-request state (not synchronous-in-one-request) — `getPendingVerificationAttempt` explicitly queries `WHERE outcome IS NULL`. This is correct architecture, just resting on an unexecuted table.

**Tests**: 4 files — `verification-triggers.test.ts`, `verification-variant-wiring.test.ts`, `verify-route.test.ts`, `assessment-verification.service.test.ts` — comprehensive at the unit level, but **all mock `@/lib/db`**, so none would have caught the missing-table problem.

---

## 10. Current Learning Evidence Architecture

**A generic evidence layer exists in application intent** — `learning_evidence`, described in `mastery.service.ts`'s own header as the pipeline's canonical write target ("LearningEvidence → MasteryEngine → MasteryRecord → MasteryEvent"), written to by `updateMastery` on every scored action across quiz, exam, explain, transfer, and verification flows. Its columns (from the application's own INSERT statements, since no CREATE TABLE exists) include: `student_id`, `concept_id`, `source_type`, `result`, `difficulty`, `subject_id`, `activity_type`, `learning_mode`, `hints_used`, `ai_assistance_type`, `confidence_before_answer`, `score_percent`, `metadata JSONB`.

**Critical caveat: this table's `CREATE TABLE` statement does not exist anywhere in `migrations/`.** Only two `ALTER TABLE learning_evidence` statements exist (021, 022), both assuming the table already exists. This is the same undocumented-origin pattern found for `profiles`/`student_profiles`/`student_subjects`/`subjects.student_id` (§5) — a real table the application depends on heavily, invisible to the tracked migration history.

**Fragmentation elsewhere**: some signal remains genuinely split across specialized tables rather than flowing through `learning_evidence` — `errors` (classified wrong answers, its own table since migration 001/009), `mastery_events` (an audit trail of score deltas, not itself "evidence"), `student_misconceptions` (occurrence counts on misconception signatures). These are best read as *derived/specialized* records fed by evidence-producing actions, not competitors to `learning_evidence` as the source of truth — but they are separate tables a future Learning Evidence Layer redesign would need to reconcile or explicitly keep as satellites.

---

## 11. AI Architecture

**No shared/central AI-calling helper exists.** 16 independent raw-`fetch('https://api.anthropic.com/v1/messages', ...)` call sites across 11 files, plus a 12th file (`ai.service.ts`) using the `@anthropic-ai/sdk` client instead — three different calling conventions for the same provider. 2 more files call OpenAI directly. The only shared code is `parseAIJson` (markdown-fence stripping, **not** a schema validator).

| # | File:function | Category | Model | Validation | Retry | Flag |
|---|---|---|---|---|---|---|
| 1 | quiz-generation.service.ts `generateQuestionsForConcept` | QUESTION GENERATION | claude-sonnet-5 | Minimal | `salvageJsonArray` (real) | |
| 2 | quiz-generation.service.ts `gradeAnswer` | EVALUATION | claude-sonnet-5 | Minimal (`correct` unchecked) | String-match fallback | **AI → `errors.error_type` directly; AI's own score≥0.5 is the correctness signal for free-text items** |
| 3 | quiz-generation.service.ts `generateQuestionHint` | CONTENT GEN | claude-sonnet-5 | Minimal | none | |
| 4 | concept-extraction.service.ts `extractConceptsFromChunk` | CLASSIFICATION | claude-sonnet-5 | Minimal (truthy filter) | Empty-array | AI labels → `concepts` table directly |
| 5 | concept-extraction.service.ts `suggestConceptNames` | CONTENT GEN | claude-sonnet-5 | Minimal | Empty-array | not persisted |
| 6 | topic-hierarchy.service.ts `classifySubjectHierarchy` | CLASSIFICATION | claude-sonnet-5 | Minimal + ID-existence filter | none (txn rollback) | |
| 7 | topic-hierarchy.service.ts `classifySingleConcept` | CLASSIFICATION | claude-sonnet-5 | Minimal + existence check | leave unassigned | |
| 8 | localization.service.ts `translateBatch` | OTHER | claude-sonnet-5 | Minimal | none | display text only |
| 9 | concept-graph.service.ts `inferPrerequisitesForConcept` | CLASSIFICATION | claude-sonnet-5 | **Real deterministic gate** (`validateRelationship`) | Empty-array | Best-designed: explicit `AI_INFERRED` tag + confidence tier |
| 10 | tutor.service.ts `sendMessage` | CONTENT GEN | claude-sonnet-5 | N/A (free text) | none | chat transcript only |
| 11 | concept-explanation.service.ts `getConceptExplanation` | CONTENT GEN | claude-sonnet-5 | **Real** (`tryParseExplanation`) | cache-evict & regenerate | |
| 12 | misconception.service.ts `classifyMisconception` | CLASSIFICATION | claude-sonnet-5 | Minimal | returns null | **`isCritical` boolean → DB directly, no corroboration** |
| 13 | error-intelligence.service.ts `getErrorPatternGuidance` | COGNITIVE ANALYSIS | claude-sonnet-5 | Real-ish (`coerceGuidance`) | degrade to raw text | underlying pattern is deterministic SQL |
| 14 | interactive-formula.service.ts `generateInteractiveFormula` | CONTENT GEN | **gpt-5.6 (OpenAI)** | **Strongest found** (`validateFormula`) | returns null | |
| 15 | embedding.service.ts `generateEmbedding` | OTHER | text-embedding-3-small (OpenAI) | Dimension check | none | |
| 16 | transfer.service.ts `generateTransferActivity` | QUESTION GEN | claude-sonnet-5 | Minimal | none | |
| 17 | transfer.service.ts `evaluateTransferResponse` | EVALUATION | claude-sonnet-5 | Partial (enum check) | none | score recomputed deterministically downstream |
| 18 | explain-defend.service.ts `generateExplainPrompt` | QUESTION GEN | claude-sonnet-5 | Minimal | none | |
| 19 | explain-defend.service.ts `evaluateExplanation` | EVALUATION | claude-sonnet-5 | Partial (numeric clamp) | none | |
| 20 | ai.service.ts (3 fns) | CONTENT/QUESTION GEN | claude-sonnet-5 (SDK) | **None** | none | **Worst case: unvalidated DB writes; routes appear dead** |

**Confirmed "AI output becomes state directly" without a deterministic check**: `errors.error_type` (#2), `misconception_signatures.is_critical` (#12), free-text correctness signal feeding mastery evidence (#2). **Mastery itself is never written by AI** — always via the deterministic algorithm — but its input can be unaudited AI judgment for free-text items.

---

## 12. Database / Data Model

**Simplified ER (learning-relevant domain; `*` = table has no `CREATE TABLE` anywhere in `migrations/` — live-only / undocumented origin):**

```
 students ─────────────┐            profiles*/student_profiles* ─── parent_student_relationships*
 (clerk_id UNIQUE)      \                    ▲  (kept UUID-equal by convention, no FK)
                         \                   /
       ┌──────────────┬───┴──────┬─────────/────┬───────────────┐
       ▼              ▼          ▼              ▼               ▼
 mastery_records  learning_debt  quiz_sessions  errors(×2 defs) tutor_conversations*
   │(0-100 score)      │           │  (TEXT PK)    ambiguous FK
   │                   │           │
   ▼                   ▼           ▼
 mastery_events   (concept_id)  concept_id / concept_ids[]
                                       │
 learning_evidence* ◀──────────────────┘ (written by every scoring path; no CREATE TABLE found)

 subjects* (student_id col undocumented) ──▶ topics ──▶ subtopics ──▶ concepts (canonical, id = universal concept key)
                                                                        │
                              ┌─────────────────────────────────────────┼──────────────────────┐
                              ▼                                        ▼                       ▼
                     concept_knowledge_state              misconception_signatures     concept_relationships
                     (5 parallel dims, 0-100)                     │                    (prereq/dependency graph)
                                                          student_misconceptions

 assessment_occurrences* ─▶ assessment_results*           validation_cycles ─▶ validation_events
        │                                                        (Phase 2.2B, executed per own header)
        ▼
 assessment_concept_coverage (external validation, migration 027)

 verification_attempts (migration 030 — NOT executed against Neon, per its own header)
```

**Table-by-table** (primary/foreign keys, notable constraints):

| Table | PK | Key FKs | Notable |
|---|---|---|---|
| `students` | `id` UUID | — | `clerk_id UNIQUE NOT NULL` |
| `subjects` | `id` UUID | — | `code UNIQUE`; `student_id`/`status` columns used pervasively by app code but **untracked** in migrations |
| `concepts` | `id` UUID | `subject_id → subjects` | `canonical_id UNIQUE NOT NULL`; `difficulty CHECK 1-5` |
| `topics`/`subtopics` | `id` UUID | `subject_id`/`topic_id` | added migration 016 |
| `mastery_records` | `id` UUID | `student_id → students`, `concept_id → concepts` | `mastery_score NUMERIC(5,2)` **live**, no CHECK constraint (see standing forensic finding this session — the repo's migration 001 claims `DECIMAL(5,4) CHECK 0..1`, which does not match live reality) |
| `mastery_events` | `id` UUID | `mastery_id → mastery_records` | audit trail |
| `learning_debt` | `id` UUID | `student_id`, `concept_id` | `severity CHECK 1-5`, `status CHECK ('active','resolved')` |
| `learning_evidence`* | — | (by convention) `student_id`, `concept_id` | **no tracked CREATE TABLE** |
| `errors` | `id` UUID | **ambiguous** — two conflicting `CREATE TABLE IF NOT EXISTS` (001: `→students`, context JSONB; 009: `→profiles`, source_type col) | live shape not determinable from migrations alone; app code's INSERT shape (`subject_id`, `source_type`) matches 009 |
| `quiz_sessions` | `id` TEXT | `student_id`, `concept_id`, `subject_id` | `questions JSONB`; `status CHECK`; extended 5 times across migrations 006/010/021/029 |
| `quiz_responses` | `id` UUID | `quiz_session_id → quiz_sessions` | **defined, never written** |
| `concept_knowledge_state` | — | `student_id`, `concept_id` | migration 025; 5 dimension columns, `mastery_state CHECK` 7 values |
| `misconception_signatures` | `id` UUID | `concept_id → concepts` | `is_critical BOOLEAN`, AI-set with no corroboration |
| `student_misconceptions` | — | `student_id`, `misconception_signature_id` | `occurrence_count` |
| `concept_relationships` | — | `source_concept_id`, `target_concept_id → concepts` | `relationship_type CHECK` 6 values, tagged `source='AI_INFERRED'` |
| `cognitive_diagnoses`/`remediation_paths`/`remediation_steps` | — | `→concepts` | migration 023 |
| `validation_cycles`/`validation_events` | — | `student_id`, `concept_id`, `subject_id` | migration 026, `trigger_type CHECK` 9 values |
| `assessment_occurrences`/`assessment_results`/`assessment_concept_coverage` | — | `subject_id`, `concept_id` | real-exam tracking |
| `verification_attempts` | — | `student_id`, `concept_id`, `quiz_session_id` | **migration 030, confirmed NOT executed against Neon** — yet actively read/written by live code (`assessment-verification.service.ts`), the single highest-risk item in this audit |
| `assessment_occurrences`/`assessment_results`* | — | `subject_id` | **no `CREATE TABLE` anywhere in `migrations/`** — treated as pre-existing by migration 027's own comment ("reuses the existing... tables") |
| `subject_mastery_snapshots` | — | `subject_id` | `avg_mastery_score INT CHECK 0-100` |
| `backfill_runs` | `id` UUID | — | migration 028, "RECOVERY NOTE" — reconstructed post-incident |
| `learning_debt_events` | `id` UUID | `learning_debt_id → learning_debt` | migration 007 — created because the app was **already writing to it before the table existed** |

**Obsolete/duplicated/legacy candidates found** (cross-verified: table exists in `migrations/`, grepped for zero readers/writers in `src/`):
- `chunk_embeddings` (migration 002) — **dead**; migration 004's own comment says the app was rewritten to use `content_chunks.chunk_embedding` instead.
- `chunk_concept_mappings` (migration 002) — **dead**, same reason; superseded by `content_chunks.concept_mappings UUID[]`.
- `error_patterns` (migration 001) — **effectively dead**: zero writers anywhere in `src/` (migration 009's own comment says patterns are meant to be a `GROUP BY` over `errors` instead, confirmed implemented that way in `error-intelligence.service.ts`); one lone reader (`exam-readiness.service.ts:263`, a `COUNT(*)`) that will always return 0.
- `exam_readiness_history` (migration 003) and `study_session_progress` (migration 003) — **fully dead**, zero references anywhere in `src/`.
- `quiz_responses` (migration 003) — defined, never written (§7).
- One of the two `errors` definitions (001 vs 009 — mutually exclusive, different FK targets).
- `priority-engine.service.ts`'s underlying scoring (dead, already `@deprecated`-tagged).
- `ai.service.ts`'s three functions + their two routes (dead).
- `src/services/student.service.ts`'s `createStudent`/`getStudent` (dead, second identity path).
- **`learning_debt_events`** (migration 007) exists specifically because `learning-debt.service.ts` was already writing to it before the table existed — a real audit-trail table, not dead, but its origin story is itself evidence of the same "code precedes/outruns migrations" pattern seen elsewhere.

**Independent corroboration of this session's standing mastery-scale forensic finding**: this audit's own DB-focused agent, working from migration text alone with no access to this session's earlier forensic investigation, independently flagged: *"`mastery_score 0-1 CHECK` (note: code/comments elsewhere... treat `mastery_score` as 0-100, not 0-1 — a documented contract mismatch)"* — an unprompted, fully independent confirmation of the same schema/code contract mismatch this session traced and fixed earlier.

---

## 13. Service Boundaries

Business logic is **predominantly organized into `src/services/*.service.ts`** (47 files) — this is a real, working boundary, not just naming convention. `progress-overview.service.ts`/`learning-os-snapshot.service.ts` are confirmed genuine read-model services (0 write statements each, both docstrings explicitly disclaim scoring/ranking/deciding), distinct from write-path services (`mastery.service.ts`: 13 writes vs 6 reads; `knowledge-state.service.ts`: 2 writes vs 6 reads) — a real, consistently-followed convention, not just this session's own framing of it.

**Confirmed coupling / architecture smells**:
- `generate-and-take/route.ts` (956 lines) keeps real decision logic as local functions rather than promoting it to a service: `computeAskConfidenceFlags` (own raw SQL + confidence-gating logic) and `selectConceptsForQuizMode` (the "weakest-mastery-first" concept-selection algorithm) both live directly in the route file. Of ~716 lines of route logic, an estimated 500+ are orchestration/aggregation/decision code rather than thin delegation — the route is the de facto orchestrator for the whole quiz lifecycle, a legitimate but heavy design choice.
- **Five Server Component page files issue raw SQL directly, bypassing `src/services/` entirely**: `dashboard/page.tsx`, `dashboard/subjects/page.tsx`, `dashboard/subjects/[id]/page.tsx`, `dashboard/subjects/[id]/concepts/[conceptId]/page.tsx` (4 separate queries), `dashboard/tutor/page.tsx`. These are Next.js Server Components (no `'use client'`), so this isn't a client-side security issue — but it is a real, confirmed service-boundary bypass: several of these queries duplicate lookups (e.g. subject/concept ownership checks) that equivalent API routes already perform through a service function. No AI-provider call was found in any `.tsx` file (that boundary holds cleanly) — only the raw-DB-query boundary is crossed.
- **A real, previously-unflagged logic duplication**: `learning-debt.service.ts`'s `checkAndResolveDebt` calls the shared `computeDebtResolutionCriteria` (the function its own code comment calls "the shared, testable version of this logic"), but `debt-resolution.service.ts`'s `autoResolveDebt` does **not** call that shared function — it independently reimplements the identical four-criteria threshold check inline (`mastery > 85`, `recentScoresAbove80`, `retentionProof`, `lowForgettingRisk`), with its own separately-written `forgettingRisk` formula, and its own `UPDATE learning_debt`/`INSERT learning_debt_events` write path. Both are live, reachable from different API routes (`/api/learning-debt/auto-resolve` vs `/api/learning-debt/check-and-resolve`), and currently produce identical behavior only because their hardcoded thresholds (85/80/14/20) still happen to match — a silent-drift risk, not yet a bug.
- Two independently-authored `errors` table definitions (001 vs 009) — a genuine schema-level duplication, not just code.
- `priority-engine.service.ts` (mastery-weighted scoring) and `ai.service.ts` (question generation) are dead parallel implementations of logic that has a live counterpart elsewhere (`adaptive-learning-orchestrator.service.ts`'s Phase 3C ranking; `quiz-generation.service.ts`) — confirmed via zero-importer grep for the former, no-live-caller for the latter's routes.

---

## 14. Testing & Quality Status

**Commands executed** (exact, this session):
```
npx tsc --noEmit                 → clean, exit 0
npx vitest run                   → 53 test files, 610 tests, all passed, ~0.9-1.0s
```
No `lint` script exists in `package.json` (§2) — lint could not be run.

`npm run build` was run earlier in this same session (for the mastery-contract hotfix validation) and succeeded, exit 0, full route manifest generated with no errors — not re-run fresh for this specific audit turn to avoid redundant multi-minute builds, but the codebase has not changed since that clean build.

**53 active test files** in `tests/unit/`, spanning: `mastery.test.ts`, `mastery-format.test.ts`, `knowledge-state.test.ts`, `knowledge-state-backfill.test.ts`, `learning-debt.test.ts`, `adaptive-learning-orchestrator.test.ts` (+ `-integration`), `assessment-verification.service.test.ts`, `verification-triggers.test.ts`, `verification-variant-wiring.test.ts`, `verify-route.test.ts`, `cognitive-diagnosis.test.ts`, `transfer.test.ts`, `remediation.test.ts`, `exam-result-attribution.test.ts`, `exam-result-mastery-scale.test.ts`, `learning-session-engine.test.ts`, `next-best-action-v3.test.ts`, `learning-execution-*`, `phase-3d-*`, `phase-3e-*`, `study-plan-*`, `today-plan.test.ts`, `progress-overview.test.ts`, `quiz-persistence-evidence-mode.test.ts`, `question-variant-equivalence.test.ts`, and more.

**12 additional files sit in `tests_disabled/`**, excluded from `vitest.config.mts`'s `include` glob: `unit/{content-chunking,mastery,learning-debt,error-patterns,study-plan,priority-engine,exam-readiness}.test.ts`, `integration/{content-pipeline,phase-4-debt-resolution,sofia-quiz-flow}.test.ts` — **not run, not counted above**.

**Domain → test mapping**:
- Learner: no dedicated identity test found (auth.ts's dual-write behavior is untested).
- Quiz: `quiz-persistence-evidence-mode.test.ts`, `question-evidence-semantics.test.ts`.
- Mastery: `mastery.test.ts`, `mastery-format.test.ts`, `mastery-metadata.test.ts`, `learner-model.test.ts`.
- Cognitive: `cognitive-diagnosis.test.ts`, `remediation.test.ts`, `transfer.test.ts`.
- Verification: 4 files (§9).
- Database: **none** — every test mocks `@/lib/db`; zero tests run against a real/ephemeral Postgres instance.
- API: `learning-api-routes.test.ts`, `verify-route.test.ts`, `hint-route-permission.test.ts`, `study-plan-route.test.ts`.
- AI: no test directly exercises a live AI call (expected/appropriate — all mock the AI boundary).

**Critical behavior with no test coverage found**: the `students`/`profiles` dual-identity write (`ensureProfileRows`); the `errors` table's actual live shape (untestable without a real DB); `subjects.student_id`'s existence; the `verification_attempts` table's actual presence in Neon.

---

## 15. Source of Truth Matrix

| Domain | Authoritative source | Conflict? |
|---|---|---|
| Student identity | `students` table (by volume/usage) | **YES** — `profiles`/`student_profiles` is a second, FK-disconnected space still targeted by `errors` (ambiguously) and `tutor_conversations` |
| Academic context | `student_academic_profile` (migration 020) | None found |
| Concept definition | `concepts.id` | None — clean |
| Question | `quiz_sessions.questions` JSONB (cached at generation time, never regenerated on submit) | None — single source per attempt |
| Attempt | `quiz_sessions` | None |
| Mastery | `mastery_records.mastery_score`, written exclusively via `mastery.service.ts`'s `updateMastery` | None — single write path confirmed |
| Verification | `verification_attempts` (migration 030) | **YES** — table not executed against Neon; in practice no durable source of truth exists today |
| Errors/misconceptions | `errors` + `misconception_signatures`/`student_misconceptions` | **YES** on `errors`' FK target (two conflicting definitions) |

---

## 16. Learning OS Capability Matrix

| Capability | Status | Evidence | Main Gap |
|---|---|---|---|
| Learner Model | EXISTS_BUT_NEEDS_REFACTOR | `students` table, `getOrCreateStudentId` | Dual identity space (`profiles`) not reconciled by FK |
| Canonical Student ID | PARTIAL | 24 FKs → `students`, 2 → `profiles` | Not truly singular; convention-only sync |
| Curriculum Model | EXISTS | `subjects→topics→subtopics→concepts`, migrations 001/016 | `subjects.student_id`/`status` origin untracked |
| Canonical Concept ID | EXISTS | 19+ tables consistently FK to `concepts.id` | None significant |
| Quiz Engine | EXISTS | `generate-and-take/route.ts` full lifecycle | Dead `generate/route.ts`, unused `quiz_responses` |
| Assessment Modes | EXISTS | 7 quizModes × ActivityType/EvidenceMode | None significant |
| Cognitive Progression (Bloom's) | MISSING | `CognitiveLevel` type present but never populated | No sequential level model exists at all |
| Mastery Engine | EXISTS | `lib/algorithms/mastery.ts`, single write path | Live schema (`NUMERIC(5,2)`, no CHECK) undocumented vs. repo's stated `DECIMAL(5,4) CHECK 0..1` |
| Misconception/Error Model | EXISTS_BUT_NEEDS_REFACTOR | `misconception_signatures`, `errors` | `errors` has two conflicting table definitions |
| Verification Engine | PARTIAL | Full logic + route wiring exists | Persistence table not executed against Neon — effectively non-functional in production today |
| Variant Equivalence | EXISTS_BUT_NEEDS_REFACTOR | `evaluateVariantEquivalence`, 6-dimension fail-closed check | Confidence value not durably persisted (same root cause as above) |
| Learning Evidence Layer | PARTIAL | `learning_evidence` is the de facto canonical write target, used broadly | Base table has no tracked `CREATE TABLE`; live shape unverifiable from repo |
| Engine Versioning | PARTIAL | `mastery_policy_version`, `projection_version` columns exist on `concept_knowledge_state` | No equivalent versioning found for the mastery algorithm itself or the AI-prompt layer |
| Decision Audit Trail | PARTIAL | `mastery_events` (score deltas), `backfill_runs`, `state_reason JSONB` on Knowledge State | No unified cross-engine decision log; each engine keeps its own partial trail |
| Adaptive Teaching | EXISTS_BUT_NEEDS_REFACTOR | `adaptive-learning-orchestrator.service.ts` (Phase 3C), `next-best-action-v3.service.ts` (Phase 3D) — both live per this session's own recent work | Not itself audited in depth this pass; existence confirmed, quality unassessed |
| Retention | EXISTS | `src/lib/algorithms/spaced-repetition.ts`, `getRetention` | Confirmed live/correct in this session's own recent forensic work |
| Transfer | EXISTS | `transfer.service.ts`, dedicated evidence source + dimension | Deliberately independent from mastery — by design, not a gap |
| Learning Orchestration | EXISTS_BUT_NEEDS_REFACTOR | `adaptive-learning-orchestrator.service.ts`, `learning-execution-scheduler.service.ts` | Not itself audited in depth this pass |

---

## 17. Architecture Risks

1. **[CRITICAL] The `migrations/` folder does not reliably describe the live database schema.** Evidence: migration 004's own comment admits 002/003 never ran as committed (invalid inline `INDEX` syntax); migrations 028/029 explicitly document "the accidental local deletion" and state they are "reconstructed... NOT re-executed"; I independently confirmed migration 001 contains the identical invalid syntax inside `mastery_records`/`learning_debt`/`errors`/`error_patterns`; `learning_evidence`, `profiles`, `student_profiles`, `student_subjects`, `parent_student_relationships`, `subjects.student_id`, `subjects.status`, `user_language_preferences` have **zero** tracked `CREATE`/`ALTER` statements despite heavy live usage. **Why it matters**: any future schema work for the Learning OS (new engines needing new tables/columns) cannot safely assume `migrations/` reflects reality — a live schema dump/reconciliation must happen first. **Affects**: every future phase.

2. **[CRITICAL] Student identity is split across two FK-disconnected tables (`students` vs `profiles`/`student_profiles`), reconciled only by convention.** Evidence: `src/lib/auth.ts:87-93`'s own comment; `errors` and `tutor_conversations` FK to `profiles`, everything else to `students`. **Why it matters**: a future canonical Learner Model (or any cross-cutting identity change) must handle two spaces, and a currently-silent assumption (both rows always get written) could break invisibly. **Affects**: Learner Model, any future identity-scoped engine.

3. **[CRITICAL] The Verification Engine's persistence table was almost certainly never executed against the live database, yet live code actively reads/writes it on every Cumulative Assessment/Mock Exam submission.** Evidence: `migrations/030_assessment_verification.sql`'s own header ("NOT EXECUTED... design only, pending explicit review/approval"); `assessment-verification.service.ts:313-318`'s matching comment. Two independent audit passes (the verification-focused trace and the DB-focused trace) each flagged this as the single highest-risk finding in their respective areas. **Why it matters**: this Learning OS capability is fully coded and tested-against-mocks, wired into a real reachable user flow, but is very likely throwing `relation "verification_attempts" does not exist` in production on every trigger — silently swallowed by a `try/catch`, so nothing surfaces the failure. A false sense of "it works" from passing unit tests alone. **Affects**: Verification Engine, Learning Evidence Layer trustworthiness.

4. **[HIGH] The `errors` table has two mutually-exclusive `CREATE TABLE IF NOT EXISTS` definitions (migrations 001 and 009) with different FK targets and columns.** **Why it matters**: which one is actually live cannot be determined from the repo; the app code's INSERT shape matches migration 009, meaning migration 001's version (if it's what's actually live) would be failing every error-classification write. **Affects**: Misconception/Error Model.

5. **[HIGH] No shared AI-calling infrastructure — 14 files independently implement HTTP calls to two providers, with wildly inconsistent output-schema validation (from real per-field validators to zero validation at all).** **Why it matters**: the Learning OS's Adaptive Teaching/Cognitive Analysis engines will add more AI call sites; without consolidation, validation quality will keep varying ad hoc, and 3 confirmed cases already let AI output become system state (`errors.error_type`, `misconception_signatures.is_critical`, free-text correctness) with no deterministic check. **Affects**: AI Architecture, all future AI-driven engines.

6. **[MEDIUM] No lint tooling configured at all.** **Why it matters**: TypeScript strict mode catches type errors but not code-quality/consistency issues across a 47-service, 74-route codebase about to grow substantially. **Affects**: general code health during rapid Learning OS expansion.

7. **[MEDIUM] Two deployment targets present simultaneously with no arbiter.** `.vercel/project.json` vs. a Render-oriented `Dockerfile`, no `vercel.json`, no CI config. **Why it matters**: unclear which environment is actually authoritative for production; risk of divergent env-var/build configuration between the two. **Affects**: deployment reliability for any future release.

8. **[MEDIUM] A genuine cognitive-level progression (Bloom's-style) does not exist, despite scaffolding (`CognitiveLevel` type) suggesting it might.** **Why it matters**: building the Learning State & Decision Engine around an assumed RECALL→...→EVALUATE progression would require this from scratch — it is not a refactor of existing code, it is new capability. **Affects**: Cognitive Progression, Adaptive Teaching Engine, Learning State & Decision Engine.

9. **[MEDIUM] Dead/orphaned code sits live in the repo and remains reachable**: `src/app/api/quizzes/generate/route.ts`, `src/services/ai.service.ts` (zero-validation AI writes to `concepts`), `src/services/student.service.ts`'s `createStudent` (a third identity path), `priority-engine.service.ts`. **Why it matters**: none currently has a caller, but all are live, uncaught-by-tests code paths that could be accidentally re-wired or hit directly, each carrying weaker guarantees than their live counterparts. **Affects**: general system integrity.

10. **[MEDIUM] `learning-debt.service.ts`'s `checkAndResolveDebt` and `debt-resolution.service.ts`'s `autoResolveDebt` independently reimplement the same four-criteria debt-resolution logic, reachable from two different live API routes, with no shared function between them despite one file's own comment claiming consolidation.** **Why it matters**: identical behavior today only because hardcoded thresholds happen to match; any future tuning of debt-resolution criteria (a near-certainty once the Decision Engine exists) would need to be applied in two places or silently diverge. **Affects**: Misconception/Error Model, Decision Audit Trail.
11. **[LOW] 12 test files are excluded (`tests_disabled/`) and not run as part of the standard suite**, and the entire active suite mocks the database — zero tests would catch any of the schema-drift findings above. **Why it matters**: the test suite's "610/610 passing" is a real, meaningful signal for logic correctness, but gives no signal at all about live-schema alignment. **Affects**: confidence in any DB-adjacent audit finding going forward; recommend a schema-introspection check as a new test category.

---

## 18. Critical Findings

**BLOCKERS** (must be resolved/acknowledged before Learning State & Decision Engine work begins):
- Migrations folder does not reliably describe live schema (#1 above) — a live schema dump is needed before any new engine adds tables/columns.
- Verification Engine's persistence table almost certainly does not exist live, despite active production code paths reading/writing it every assessment submission (#3) — the capability is not actually production-ready despite full code+test coverage, and currently fails silently.
- Student identity fragmentation (#2) — must be explicitly decided (unify onto `students`, or formally adopt the dual-write convention with FK enforcement) before a Learner Model consolidation.

**HIGH PRIORITY**:
- `errors` table's ambiguous live definition (#4).
- No shared AI-calling/validation infrastructure (#5).

**MEDIUM PRIORITY**:
- Deployment-target ambiguity (#7).
- No lint tooling (#6).
- Duplicated debt-resolution logic across two services (#10).
- Dead code cleanup (#9).
- Cognitive-progression capability gap is a new-build item, not a blocker, but should be scoped explicitly (#8).

---

## 19. Unknowns / Unable to Verify

- **UNVERIFIED**: whether the database is actually hosted on Neon (referenced only in code comments, no driver-level confirmation, `DATABASE_URL` value not inspected).
- **UNVERIFIED**: the true live definition of `errors` (migration 001 vs 009) — cannot be resolved without a live schema query, which was out of scope (no Neon access permitted this audit).
- **UNVERIFIED**: whether `migrations/030_assessment_verification.sql` has been executed against Neon since its header comment was written — the comment could be stale.
- **UNVERIFIED**: whether `migrations/026_validation_cycles.sql`/`027_external_validation.sql` (no "RECOVERY NOTE," unlike 028/029) predate the data-loss incident and are trustworthy, or are in the same unexecuted state as 030 — no explicit marker either way.
- **UNVERIFIED**: exact current row counts / data volumes in any table (no DB access).
- **NOT ASSESSED THIS PASS**: internal quality/correctness of `adaptive-learning-orchestrator.service.ts` (Phase 3C) and `learning-execution-scheduler.service.ts` (Phase 3D) beyond confirming their existence and role — these were extensively built/audited earlier in this same session's history but not re-verified line-by-line for this Phase 0A pass.
- **NOT ASSESSED THIS PASS**: `docs/architecture/*.md` design documents were referenced by several migration/service comments but not read in full for this audit — they may contain additional authoritative context not captured here.

---

## 20. Commands Executed

```
npx tsc --noEmit
  → clean, no errors, exit 0

npx vitest run
  → Test Files  53 passed (53)
  → Tests       610 passed (610)
  → Duration    ~0.9-1.0s

git log --follow --oneline -- migrations/001_create_core_tables.sql
git log --follow --oneline -- src/lib/algorithms/mastery.ts
git show 8656452:src/lib/algorithms/mastery.ts
  → (used to independently verify the mastery-scale/schema-history findings this session)

grep/find/cat/sed/wc across migrations/*.sql and src/**/*.ts (read-only, no writes)
  → extensive, used throughout this document as inline evidence citations

npm run build  (run earlier this same session for the mastery-contract hotfix, not re-run fresh for this audit turn)
  → exit 0, clean route manifest
```
No `lint` script exists to run (§2). No database was queried, altered, or migrated as part of this audit.

---

## 21. Final Audit Conclusion

**A. Is the current architecture stable enough to evolve without a major rewrite?**
**YES, WITH CONDITIONS.** The service-layer organization, the single deterministic mastery write path, the canonical concept identity, and the quiz/evidence pipeline are all genuinely solid foundations. The conditions are: (1) resolve the migrations-vs-live-schema trust gap before adding new tables, (2) make an explicit decision about the `students`/`profiles` identity split, (3) either execute or formally abandon the Verification Engine's persistence migration.

**B. Is there a canonical student identity?**
**PARTIAL.** `students` is dominant and well-used, but `profiles`/`student_profiles` is a second, FK-disconnected space still actively targeted by at least two tables.

**C. Is there a canonical concept identity?**
**YES.** `concepts.id` is consistently used as the sole concept identifier across every table checked (19+), with no fragmentation found.

**D. Is mastery centrally controlled?**
**YES.** One deterministic algorithm, one IO wrapper (`mastery.service.ts`'s `updateMastery`), six call sites, no competing live implementation (one dead duplicate confirmed and already flagged `@deprecated`).

**E. Does a generic Learning Evidence layer exist?**
**PARTIAL.** It exists as a real, broadly-used application-level concept (`learning_evidence`, written from every scoring path) — but its base table has no tracked schema definition anywhere in the repository, so its actual live structure and constraints cannot be independently confirmed.

**F. Is verification production-wired end-to-end?**
**PARTIAL.** The trigger logic, variant generation, client display, and response-grading are all genuinely wired to a real, reachable user flow — but the persistence table it depends on is explicitly documented as never executed against the live database, meaning the feature most likely fails silently in production today.

**G. Maximum five architecture gaps to address before building the Learning State & Decision Engine** (not to be implemented now):
1. Reconcile `migrations/` with actual live schema (dump + diff) before trusting either as ground truth.
2. Decide and enforce a single canonical student identity (unify or formally FK-link `students` ↔ `profiles`).
3. Execute (or explicitly redesign) the Verification Engine's persistence migration — a Decision Engine cannot trust a signal that isn't durably stored.
4. Resolve the `errors` table's dual-definition ambiguity — the Decision Engine will likely consume error/misconception signals directly.
5. Establish a shared AI-calling contract (one helper, consistent schema validation, explicit AI-output-vs-deterministic-state boundary) before the Decision Engine adds its own AI-driven reasoning — the current inconsistency (some sites fully validated, some not at all) is the wrong foundation to build a trust-sensitive decision layer on.

---

*End of audit. No implementation was performed. No refactoring plan is included per instruction.*
