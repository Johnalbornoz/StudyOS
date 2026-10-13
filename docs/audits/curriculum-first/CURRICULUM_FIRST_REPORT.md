# Curriculum-first learning — implementation report (2026-10-13)

Branch `feat/curriculum-first-learning` (worktree `studyos-curriculum-first`), cut from the certified curriculum
convergence line (`9007a0a`, Preview `8739353`) and merging the ad hoc assessment line (`557707f`).
Code SHA `f1436f7`. Architecture: `docs/architecture/CURRICULUM_FIRST_LEARNING_AND_EXAM_SUPPLY.md`.

## Why Learn practice was unavailable

Learn never read the global Exam Bank. It read the per-Student item store (`question_bank_candidates`), and commit
`a8ce32d` (OE-014) removed everything that filled it: the generation gate in the legacy quiz route and the
background replenishment. A concept with no stored items could never get any, so every new concept answered
"Esta práctica todavía no está disponible / Aún no tenemos suficientes preguntas".

## What changed

| Area | Change |
|---|---|
| Supply boundary | `src/lib/assessment-supply/supply-boundary.ts`: three families, explicit intents, one source each, no fallback |
| OE-014 | revised: Learning generates on an explicit command, an internal assessment before the attempt, an exam never; GETs never |
| Learning AI Engine | `ensureGeneratedSupply`: on `POST /api/assessments/learning/start`, generates what the request is short of through the existing quality gate, stores the Student's own items, then the start authority freezes the selection |
| Legacy quiz route | the gate now depends on the launch's quiz mode: Learning modes generate, `exam_simulation` (and unknown modes) stay NOT_READY |
| AD_HOC | Internal Assessment: no Exam Bank read; generated in full before it starts; exact concepts and difficulty; `ASSESSMENT_GENERATION_INCOMPLETE` (retryable) otherwise; scheduling and 409 `ASSESSMENT_NOT_DUE` unchanged |
| Exam sourcing | `sourceExamItem` no longer falls back to runtime generation for any exam attempt |
| Setup UI | new availability `ON_DEMAND` ("Prepararemos tus preguntas cuando empieces"): startable with zero items |
| Copy | Learning failure vs exam content not ready are different messages, 5 locales |
| Evidence | `metadata.assessment.supply` = family, intent, item category, source, evidence class |

Not changed: generators, quality gate, graders, evidence writer, Exam Bank / Question Factory code.

## Validation

| Gate | Result |
|---|---|
| Full unit suite | 567 files / 10358 tests PASS |
| Typecheck, build, `git diff --check` | PASS |
| Ephemeral (full chain, 89 ledger rows, curriculum cert) | PASS |
| DEV, real provider (`curriculum-first-learning-scenarios.ts`) | 22/22 PASS |
| Preview migration | `20261121_1000` applied; ledger 89, 0 pending, 0 drift |
| Preview deployment | `https://study-93bbo8o25-study-so.vercel.app`, `dpl_3gQLLoMfY3joxE3ETd7XfiZM6Kg4`, `/api/version` = `f1436f7` |
| Preview authenticated E2E | NOT RUN — no Student session on the new host |

DEV run: practice of a concept with zero items generated 3 validated items in one round and started; evidence
class `LEARNING`; an own exam over two concepts generated 4 items before the attempt, evidence class
`INTERNAL_ASSESSMENT`, zero generation during the attempt; schedule `SCHEDULED → STARTED → COMPLETED`;
`approved_items`, `question_bank_items` and `generation_jobs` unchanged; 14 provider calls, 0 failed.

## Acceptance tests

| # | Test | Where proven |
|---|---|---|
| 1 | concept + zero Exam Bank items → Learning Practice works | unit; DEV L1–L9 |
| 2 | concept + zero Exam Bank items → AD_HOC works | unit; DEV A1–A6 |
| 3 | PAA mock + insufficient certified supply → NOT_READY | unit (exam sourcing, quiz gate) |
| 4 | Learning works while the PAA bank is NOT_READY | unit (no Learning intent reads the bank) |
| 5 | Student with no active exam → Learn works | DEV "MODE A" |
| 6 | exam flow needs no Learn history | unit (bank selection reads no Learn tables) |
| 7 | GETs create no generation | unit (no page / layout / GET reaches the service) |
| 8 | explicit Learning POST may generate | unit; DEV L2 |
| 9, 10 | generation never writes Exam Bank inventory | unit; DEV X1 |
| 11 | live exam attempt: zero supply provider calls | unit |

## Open / not done

- Preview E2E (35 PAA Mathematics concepts, AD_HOC, scheduled AD_HOC, PAA exam prep) waits for a sign-in.
- AD_HOC size is still the existing depth (QUICK / BALANCED / DEEP), not a free question count.
- A concept the Student typed that has no canonical link still cannot be assessed in the canonical runtime
  ("Algunos temas todavía no están listos"); generation needs the canonical identity.
- `quiz_sessions.delivery_source` still says `BANK` for sessions built from the Student's own items (historical name).
- Step 4B / V5.2 re-scope is classified, not applied (`STEP4B_V52_SCOPE_CLASSIFICATION.md`).
- Learning and the Question Factory still share the platform limiter `ai_global_limits`; budgets are separate only in logging.
- Home / navigation (Phase 19) was not redesigned.
