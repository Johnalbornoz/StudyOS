# F9 — Current Readiness/Simulation Architecture Assessment

Baseline: `origin/f8/framework-aware-teaching-exam-skills` @ `547a0061373706e74fbee0ef823df03b9f762a68`
Date: 2026-09-19
Status: written before any F9 source change, per task §3.

## 1. Existing simulation concepts — none, at the F7/F8 exam-version/blueprint level

`grep`-level search for "mock"/"simulation"/"test session"/"practice test"/"timed exam" across `src/` found no product concept resembling Topic/Domain/Mini/Full Mock built on the F7 exam-version/blueprint architecture. The closest artifacts are:
- `src/lib/assessment/full-mock-guard.service.ts::canFullMockBeOffered` (F7) — a structural READINESS-OF-THE-PLATFORM check only (see §3 below), never a learner-facing simulation.
- `src/services/quiz-generation.service.ts`'s `quiz_mode`/`activity_type` values and `quiz_sessions` table — StudyUS's pre-existing, F4/F5-era "quiz" concept, entirely disconnected from `exam_versions`/`assessment_blueprints`. It has no timing/pause/navigation model beyond a session-level `expires_at` TTL and a `status` of `active|completed|expired`.

## 2. A pre-existing, LIVE, actively-used "exam readiness" system that F9 must never touch or extend

**`src/services/exam-readiness.service.ts`** (`calculateExamReadiness`, `getOverallExamReadiness`) is real, committed, and actively called from `src/app/api/exam-readiness/score/route.ts`, `src/app/dashboard/subjects/[id]/AssessmentPanel.tsx`, `src/services/notifications.service.ts`, and referenced by `assessment-verification.service.ts`. It:
- Computes a single opaque `overallScore` (0-100) via **hardcoded, unversioned weights**: `masteryScore*0.4 + retentionScore*0.3 + debtScore*0.2 + errorScore*0.1`.
- Computes a fabricated **`predictedExamScore`** via an ad-hoc non-linear adjustment (`if overallScore >= 85, +5; if <= 40, -10`) — exactly the kind of unsupported official-score prediction INV-F9-16/17/20 prohibit.
- Operates entirely on `mastery_records`/`concepts`/`learning_debt` at the **subject** level — it has no notion of an Exam Version, Assessment Blueprint, Student Exam Profile, or any F7 concept whatsoever. It predates F4's canonical architecture split as well (it joins `concepts`/`mastery_records` directly, the pre-F4 mastery model).

**F9 does not modify, delete, or extend this file.** It is genuinely live, load-bearing legacy behavior for the existing subject-level "exam date" feature (`assessment_occurrences`, referenced via `getNextOccurrence`/`cacheReadinessScore`), unrelated to F7's Exam Version/Blueprint model. F9's new Readiness Engine is deliberately named and scoped to avoid any collision: `ReadinessSnapshot`/`ReadinessDimension`/`readiness_snapshots` (new, F9-owned) rather than `ExamReadinessScore`/`calculateExamReadiness` (already taken, semantically incompatible — a single collapsed percentage with invented weights is precisely what task §5/§8/INV-F9-03 forbid). This is the clearest duplicate-authority risk in this phase and is called out explicitly so no future engineer conflates the two, or attempts to "unify" them — they answer genuinely different questions (a subject/date-driven legacy heuristic vs. an exam-version/blueprint-driven, evidence-explainable engine) and unifying them would require rearchitecting the legacy feature, which is out of F9's scope.

## 3. F7's Full Mock Guard — structural, not learner-facing

`canFullMockBeOffered(examVersionId): Promise<FullMockReadiness>` (`{ready, reasons, miniMockObjectiveIds}`) answers **"CAN THE PLATFORM OFFER THIS MOCK AT ALL"** — published blueprint, every objective target's component `SUPPORTED`/timing-`CONFIGURED`/tool-rule-`CONFIGURED`, and PUBLISHED concept-or-skill mapping. It has **no learner_id parameter at all** — it is exam-version-scoped, not student-scoped. Task §16 draws exactly this line ("F7: CAN THE PLATFORM OFFER THIS MOCK? F9: SHOULD THIS LEARNER TAKE THIS MOCK NOW?") — F9 must call this function as one input among several, never reimplement its logic, and must add a genuinely new, student-scoped question on top.

## 4. Actual PAA framework coverage in the repository — Mathematics only, confirmed from configuration, not assumption

Per task §17's explicit instruction to verify from repository configuration rather than prior documentation: neither `scripts/operations/f7-seed-pilot-dataset.ts` nor `f8-seed-pilot-dataset.ts` — the only places any PAA exam structure is ever defined — create a Reading, Writing, or English `academic_subject`, `structure_version`, `learning_objective`, or `assessment_component`. Only Mathematics exists (1 subject, 1 structure node, up to 4 objectives across the two scripts, 3 components). The `exam_definitions.domains text[]` column asserts `['Reading','Writing','Mathematics','English']` in F7's own fixture, but this is free-text metadata — no query, guard, or validator anywhere cross-checks it against actual modeled components. **Conclusion, stated plainly for the PAA Full Mock gate (task §17/§43): the real, current configuration does not model 3 of 4 conventionally-required PAA domains. A truthful Full Mock guard must report `NOT_READY` for PAA unless F9's own certification fixture explicitly adds at least a second domain (see `F9_PAA_SIMULATION_CERTIFICATION.md`) — and even then, a 2-of-4-domain fixture remains a certification fixture, not a claim of real PAA coverage.**

Additionally: all F7/F8 pilot fixtures are seeded only inside each phase's own ephemeral, local-only Postgres certification run (`mktemp` workdir, torn down at script exit) — **none of this data exists in any real Preview or Production database.** A fresh Preview database contains only the bare schema plus the seed rows migrations themselves insert (6 `command_terms`, 1 `ACTIVE` `coverage_policy_versions` row, F8's 1 `ACTIVE` diagnostic/intervention policy row each) — zero PAA/Cambridge fixture rows, zero fixture students. F9's own certification must seed its own fixture data the same way, and must not assume any prior phase's fixture rows persist into F9's run.

## 5. Available item-bank/family coverage

`approved_item_families`/`approved_items` (F7) remain structurally complete but unpopulated (confirmed already in F7's own `F7_NEXT_PHASE_HANDOFF.md` R3, and unchanged since). F9's Simulation Plan must therefore fall back to dynamic AI generation (via F7's `resolveGenerationContext`/`validateItemForExamContext`) as the only real item source in this environment — "prefer an approved item where available" (task §21) will, in practice, always fall through to generation until content is authored.

## 6. Scoring capabilities

`evaluation.service.ts::recordExamAttemptItemResponse` is a **pure persistence layer** — it takes an already-computed `EvaluationResult` (`{rawResponse, score, maxScore, criteriaBreakdown, feedback, evaluationModelVersion, provenance}`) plus a separate `reasoningTrace`, and never calls any grader itself. F9's own scoring step must call one of the four existing graders (`gradeStructuredAnswer`/`gradeAnswer`/`evaluateExplanation`/`evaluateTransferResponse`, chosen by item shape — exactly as F8's `recordInterventionAttempt` already does) and hand the result to this exact function. No new grading logic, no new persistence shape.

`scoring_models.scoring_type` (`BINARY|PARTIAL_CREDIT|RUBRIC|MARK_SCHEME|MULTI_PART`) exists as configuration but nothing currently reads it to select a grading strategy — another point where F9 is the first real consumer, not a duplication.

## 7. Timing/tool support — configuration exists, enforcement does not

`assessment_components.timing_status`/`duration_minutes`/`tool_rule_status`/`tool_rules` are real, populated, CHECK-constrained columns (F7). Nothing in F7 or F8 ever *enforces* a timing budget or tool rule against a live attempt — they are read-only configuration facts consumed by `canFullMockBeOffered`'s readiness check, never by an actual timer or tool-availability gate. `exam_versions.navigation_rules jsonb` exists in the schema and is round-tripped by `exam-definition.service.ts` but is **never read or enforced anywhere** — a completely inert column today. F9 is the first real consumer of all three for actual enforcement (task §24-27), not a duplication of anything.

## 8. Readiness-like calculations already present

Besides the legacy `exam-readiness.service.ts` (§2), F5's `computeDimensionState` (`NO_EVIDENCE|INSUFFICIENT_EVIDENCE|EMERGING|CONSISTENT_INDEPENDENT`) and F8's `DimensionResult`/`GapDiagnosis` are the two real, versioned, explainable precedents F9's own Readiness dimensions should structurally resemble (same "never a single opaque number, always a policy-versioned classification with reason codes" discipline) — F9 extends this discipline into new dimensions (`KNOWLEDGE_READINESS`, `SKILL_READINESS`, etc.), it does not reuse F5/F8's own stored tables or write to them.

## 9. Score projection logic — none exists, correctly

No calibrated official-score conversion model exists anywhere in the repository (confirmed by exhaustive search — the only "predicted" score anywhere is the legacy heuristic in §2, which is explicitly not a calibrated model, just an ad-hoc adjustment). This means task §29's `CAN_PROJECT_OFFICIAL_SCORE` gate has exactly one correct answer in this environment: `NOT_AVAILABLE_NO_CALIBRATION`, always. F9 must implement this gate as a real, callable capability check — not a hardcoded constant — but the environment genuinely has no calibration data to ever return `AVAILABLE`.

## 10. Risks of duplicate authority — summary

| Risk | Mitigation |
|---|---|
| A second "exam readiness" concept colliding with `exam-readiness.service.ts`'s existing name/route | New, distinctly-named types (`ReadinessSnapshot` not `ExamReadinessScore`), new route namespace (`/api/readiness/*`, never `/api/exam-readiness/*`), legacy file untouched |
| Reimplementing `canFullMockBeOffered`'s structural logic | F9 calls it directly; only composes a new, student-scoped layer on top |
| A second F6-style "coverage" concept colliding with `coverage_policy_versions`/`computeMappingCoverage` | Confirmed genuinely different (curriculum-mapping-completeness vs. student-evidence-against-blueprint) in the research pass; F9's own doc names it distinctly ("Blueprint Evidence Coverage") throughout |
| A second post-exam diagnostic classifier competing with F8's gap taxonomy | F9 invokes F8's real `runDiagnosis` after writing simulation Evidence — never a new classifier (task §31) |
| A second grading/evaluation implementation | F9 calls the same four existing graders F8 already uses, then F7's existing `recordExamAttemptItemResponse` — never new grading logic |
| A new Capability enum sprawl for per-simulation-type entitlement | Task §39 permits per-type distinctions only "if existing product model supports them" — it does not today (`Capability` has 4 values, no per-feature granularity anywhere else). F9 reuses `LEARNING_FULL_ACCESS` uniformly for all four simulation types, exactly as F8 did for AI content generation, rather than inventing new capability values unprompted by an existing pattern |

## 11. Blockers to true Full Mock — confirmed, not assumed

1. No pause/resume/navigation-enforcement lifecycle exists on `exam_attempts` — genuine new schema/service work (task §24-26).
2. No `listComponentAllocations` getter exists on `blueprint.service.ts` (write-only today) — F9 needs read access to build a Simulation Plan from allocations; this is a small additive gap, not a redesign.
3. No real multi-domain PAA configuration exists — confirmed truthfully via §4 above. F9's PAA Full Mock gate is expected, and per task §75 explicitly acceptable, to report `NOT_READY` unless F9's own certification fixture deliberately models at least 2 domains (still short of the conventional 4, so even a 2-domain fixture cannot certify a true "PASS" — only demonstrate the guard correctly blocking on 3 missing domains rather than being fooled by a single well-modeled one).
4. No calibrated score-conversion model exists — `CAN_PROJECT_OFFICIAL_SCORE` will correctly and permanently report `NOT_AVAILABLE_NO_CALIBRATION` in this environment (§9).

## 12. Conclusion

No blocking collision found. F9 has a clear, additive path: new tables (readiness policy/snapshots, simulation plans/attempts extensions, timing/navigation state), new services composing F7's `canFullMockBeOffered`/`resolveGenerationContext`/`recordExamAttemptItemResponse` and F8's `runDiagnosis` rather than reimplementing any of them, and one small additive read-only getter needed on F7's `blueprint.service.ts`. The legacy `exam-readiness.service.ts` is explicitly left untouched and unreferenced. Implementation may proceed.
