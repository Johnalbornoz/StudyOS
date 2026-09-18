# F8 — Target Teaching Architecture

## Data flow (task §2, restated as implemented)

```
learning_evidence (F5, immutable)
        |
        v
diagnostics evidence-gate  (src/lib/diagnostics/evidence-gate.service.ts)
        |
        v
classification algorithms  (src/lib/diagnostics/classification.algorithms.ts, pure)
        |
        v
learner_gap_diagnoses row  (append-only; new table)
        |
        v
intervention selection      (src/lib/teaching/intervention-selection.service.ts, pure)
        |
        v
intervention_sessions row   (frozen recommendation + frozen framework context)
        |
        v
AI teaching contract        (src/lib/teaching/ai-teaching-contract.service.ts)
        |
        v
intervention_attempts row + new learning_evidence row (via updateMastery)
        |
        v
Canonical V2 (unchanged, reads learning_evidence under its own existing rules)
        |
        v
Progression decision (Canonical V2's exclusive authority)
```

F8 owns everything above the "Canonical V2" line. It reads `getCanonicalPedagogicalDecision` only for explanatory context on a diagnosis (e.g. "learner is currently WAITING on PROVE") — never to compute or influence its own classification, and never as a write target.

## New modules

| Module | Responsibility |
|---|---|
| `src/lib/diagnostics/types.ts` | Gap taxonomy, diagnosis record shape, policy rule shape |
| `src/lib/diagnostics/policy.service.ts` | Versioned diagnostic policy CRUD (mirrors F5 `policy.service.ts`) |
| `src/lib/diagnostics/evidence-gate.service.ts` | All evidence-fetching queries (concept-scoped, skill-scoped, timing-scoped) |
| `src/lib/diagnostics/classification.algorithms.ts` | Pure, deterministic gap classifiers + combiner |
| `src/lib/diagnostics/diagnosis.service.ts` | Orchestrates fetch → classify → persist; read-only Canonical V2 enrichment |
| `src/lib/diagnostics/explain.service.ts` | Read-back explainability (task §11) |
| `src/lib/teaching/types.ts` | Intervention type vocabulary, session/attempt shapes |
| `src/lib/teaching/intervention-policy.service.ts` | Versioned gap→intervention rules |
| `src/lib/teaching/intervention-selection.service.ts` | Pure selection algorithm |
| `src/lib/teaching/framework-context.service.ts` | Resolves + freezes "active framework" for a student/objective |
| `src/lib/teaching/command-term-teaching.service.ts` | CRUD for `command_term_interpretations` |
| `src/lib/teaching/session.service.ts` | `intervention_sessions`/`intervention_attempts` CRUD, retry logic |
| `src/lib/teaching/feedback.service.ts` | Feedback contract (task §19) |
| `src/lib/teaching/evidence-integration.service.ts` | Wraps `updateMastery()` for intervention attempts |
| `src/lib/teaching/ai-teaching-contract.service.ts` | Generation + two-pass validation |

## Non-negotiable boundaries restated as implementation rules

1. No F8 file imports `pedagogical-engine`/`pedagogical-decision` internals except `getCanonicalPedagogicalDecision` itself (read-only).
2. No F8 file writes to any Canonical-V2-owned table.
3. No F8 file writes to `learning_evidence` directly — only via `updateMastery()`.
4. No F8 file re-queries F6 mapping tables directly — only via `resolveActivityMetadataForObjective`.
5. No F8 file adds a hardcoded per-framework conditional — framework flavor is always data (`command_term_interpretations`, `student_exam_profiles` chain).
6. Every diagnosis and every intervention recommendation is persisted append-only, versioned, and reproducible from its inputs alone.

## Compatibility with F9 (task §20 / INV-F8-20)

F8 produces exactly the inputs F9 (Exam Readiness and Simulation) will need without building any of F9's scope itself:
- `learner_gap_diagnoses` gives F9 a structured, versioned signal of "what's actually wrong" per concept, richer than raw evidence.
- `intervention_sessions`/`intervention_attempts` give F9 a real intervention-effectiveness history to factor into readiness modeling.
- The Full Mock Guard (F7) remains untouched and advisory; F8 does not read or write it.
- No readiness score, predicted grade, or passing probability is computed anywhere in F8 (task §31/§55).
