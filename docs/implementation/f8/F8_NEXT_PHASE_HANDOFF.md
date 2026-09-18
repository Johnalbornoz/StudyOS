# F8 — Framework-Aware Teaching & Exam Skills — Next Phase Handoff

Date: 2026-09-18
Certified HEAD: see `F8_QA_REPORT.md`/final report for the exact commit SHA at certification time
Branch: `f8/framework-aware-teaching-exam-skills` (pushed to `origin`)

## What F8 delivered

A diagnostic gap-classification engine (`KNOWLEDGE_GAP|SKILL_GAP|EXAM_TECHNIQUE_GAP|SPEED_FLUENCY_GAP|MIXED|INSUFFICIENT_EVIDENCE`) that is evidence-based, versioned, deterministic, and fully explainable — never lets AI decide the diagnostic category. An intervention-selection layer mapping a diagnosis to a versioned chain of teaching interventions (`EXPLAIN|WORKED_EXAMPLE|GUIDED_PRACTICE|CONTEXTUAL_HELP|INDEPENDENT_PRACTICE|PROVE`). Framework-aware teaching infrastructure (framework identity resolution, frozen at session-creation time; `command_term_interpretations` additive to F7's `command_terms`). An AI teaching-generation contract with a two-pass validator (deterministic contract check + independent semantic verdict) mirroring the existing Quality Gate. A retry-preserving session/attempt model. A feedback contract extending `GradingErrorType` with exam-technique-specific categories. Evidence integration wrapping F5's unmodified `updateMastery()`. A minimal student-facing API surface. Zero direct writes to Canonical V2 anywhere.

## What the next phase should NOT re-litigate

- The four-dimension gap taxonomy and its pure classification algorithms — certified against the full adversarial matrix; extend via new policy versions, never new hardcoded thresholds.
- The `intervention_sessions`/`intervention_attempts` session pair — modeled deliberately on F7's `exam_attempts` precedent rather than `quiz_sessions`; don't try to unify them later without a strong reason.
- The PROVE-exclusion boundary in `recordInterventionAttempt` — F8 deliberately never writes PROVE evidence itself, to avoid duplicating Canonical V2's own PROVE launch/authorization machinery.
- The `LEARNER_INTERVENTION_CREATE`/`LEARNER_PROGRESS_VIEW` authorization split — already correctly scoped by F2, F8 is just its first real consumer.
- The four adjacent-but-distinct "why is the learner struggling" taxonomies now in the codebase (legacy `PrimaryBarrier`, root-cause `DiagnosisState`, remediation `RemediationPattern`, F8's gap classification) — this plurality is deliberate and documented (`F8_CURRENT_TEACHING_DIAGNOSTIC_ASSESSMENT.md` §4), not duplication to collapse.

## Recommended next-phase candidates (not a commitment — for the user's review)

1. **Real item generation/grading wired into the attempt-recording endpoint** (R2 in the risk register) — the natural completion of the "minimal flow" F8 deliberately left open, using the existing `quiz-generation.service.ts` graders, never new ones.
2. **F9 — Exam Readiness and Simulation**, per the original roadmap's own framing: F8's `learner_gap_diagnoses` and `intervention_sessions`/`intervention_attempts` give F9 a structured, versioned signal of "what's actually wrong" and a real intervention-effectiveness history, richer than raw evidence alone. F9 remains explicitly responsible for any readiness score, predicted grade, or Full Mock simulator — F8 introduces none of these (task §31/§32/§55).
3. **AI real-provider certification** (`IVG-F8-01`) — the highest-priority deferred item, since it gates any real pilot use of the teaching-generation flow.
4. **Command-term interpretation content authoring** (R3) — populate interpretations for the remaining 5 F7 fixture command terms across more than one programme, to further validate the "one engine, framework-neutral by default" design at greater breadth.

## Explicit constraints carried forward (per task §61 and this session's standing rules)

- Do not merge `f8/framework-aware-teaching-exam-skills` to `main` without the user's explicit instruction.
- Do not deploy to Production, and do not modify Production environment variables, under any future phase's certification process.
- Do not begin F9 or F10 automatically. This handoff exists so a future session can pick up context quickly, not to imply authorization to proceed.
- Any future phase must re-run the full non-interference test pattern (`f<N>-canonical-v2-noninterference.test.ts`) extended to cover its own new files, exactly as every phase from F1 through F8 has done.
- Any future phase must separate its test evidence into the same layered format F8 introduced (task §49/§59) — automated/real-Postgres/authenticated-E2E/remote-preview-smoke/AI-real-provider/IVG-deferred — never a generic "all tests pass" statement.
