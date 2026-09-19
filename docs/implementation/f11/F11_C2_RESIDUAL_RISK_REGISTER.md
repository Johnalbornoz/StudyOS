# F11-C2 — Residual Risk Register

| # | Risk | Severity | Mitigated by | Residual exposure |
|---|---|---|---|---|
| 1 | C1's documented orphan-`quiz_sessions` race residual now also applies to Skill executions | Low (carried forward, not worsened) | Re-proven harmless under the Skill path in this run's real concurrency case (§ Evidence Reconciliation) | Same as F11-C1: an unreferenced orphan is ordinary, unattributed practice data — never returned, never submitted, never contributing evidence |
| 2 | `resolveDeterministicConceptForSkill`'s "exactly one candidate" rule means a Skill with genuinely multiple valid concept matches for a student is simply never executable via F11-C2, even though a human teacher might consider several candidates equally valid | Low-medium | Explicit, controlled failure (`StudentInterventionNotStartableError`), never a silent/arbitrary choice — matches the task's own explicit preference for fail-controlled over guessing | A future phase could add a Teacher-supplied concept-context override (an intervention-level field) if this proves too restrictive in practice; not built now, per "do not add multi-skill/heuristic semantics casually" |
| 3 | `skills.status='ACTIVE'` is checked only at F11-C2's execution-start time, not at F11-B's assignment time | Low | Documented, deliberate choice to avoid touching frozen F11-B code; a Teacher can still assign a RETIRED skill (a UX rough edge, not a security or data-integrity issue) — the Student simply cannot start it | A future phase could add the same check to F11-B's `assignTeacherIntervention` for earlier feedback, if F11-B is ever revisited for its own reasons |
| 4 | `getStudentActiveQuizzes` (a pre-existing, unrelated quiz-persistence function) was not extended with `target_skill_ids` | None — not on any F11-C2 code path | N/A | Purely informational; that function is unused by F11-C2 and remains exactly as it was |
| 5 | The one real regression found (positional-index test assertions) suggests other, not-yet-discovered tests elsewhere in the codebase could theoretically make the same assumption about `storeQuiz`'s params array shape | Low | The full named regression suite (88 files, 1532 tests) was re-run and is now 100% green; no other such assertion was found | If a future phase adds yet another trailing `storeQuiz` parameter, the same class of test should be checked again as a matter of course |

## Explicitly NOT a residual risk (proven, not assumed, in this run)

- Concept→Skill graph non-inference: proven with a real graph edge and a real Concept-only execution (Case D).
- Skill Evidence traceability to explicit Teacher intent: proven via the full metadata chain, not asserted by design alone.
- Competency non-fabrication: proven by a real zero-row count across every student in the run, not merely "no code path exists."
- Cross-role authorization (Student/Parent/Teacher/multi-role): proven identically to F11-A/F11-B/F11-C1's own already-certified boundary, with no new gap introduced for Skill specifically.
