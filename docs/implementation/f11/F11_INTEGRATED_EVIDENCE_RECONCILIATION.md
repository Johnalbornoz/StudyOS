# F11 — Integrated Evidence Reconciliation

Task §3/§6 — proven JOINTLY, for one Student who received all four intervention types in the SAME session, so no type's Evidence can leak into another's.

## Evidence semantics matrix

| Intervention | Evidence produced | Cross-contamination checked | Result |
|---|---|---|---|
| CONCEPT | Legitimate Concept Evidence (no `skillIds`/`competencyIds` key) | Skill/Competency inference | **ZERO** — metadata carries neither key |
| SKILL | Explicit Skill Evidence (`metadata.skillIds` contains the targeted Skill) | Competency inference | **ZERO** — metadata carries no `competencyIds` key |
| COMPETENCY | Explicit Competency Evidence (`metadata.competencyIds` contains the targeted Competency) | Reverse Skill fabrication | **ZERO additional** `learner_skill_state` evidence for the mapped Skill beyond the ONE legitimate row the SKILL intervention itself produced in the same session — proving the Competency run added none of its own |
| EXAM | Real F7/F9 assessment attempt, one `learning_evidence` row with `source_type = 'EXAM_SIMULATION'` | Only legitimate F7/F9 pathway | **Confirmed** — the row exists only because `recordSimulationItemResponse` (F9's own, real, unmodified function) was called, never F11 |

## Why running all four together (not in isolation) matters

Each of F11-C1/C2/C3/C4's own certifications proved these properties for its own type in isolation. This gate additionally proves they hold when a Skill target (`skillS`) that is ALSO mapped to the SAME Competency being independently targeted (`competencyK`) both run in ONE session for ONE student — the Competency intervention's own submission does not increment the Skill's evidence count beyond what the Skill intervention itself legitimately produced (`evidenceCount === 1`, not 2), and vice versa. This is the actual joint-contamination risk the individual per-phase certifications could not, by construction, exercise.

## Zero direct F11 writes (task §6, reconfirmed jointly)

Source-guard proven across both `teacher-intervention-execution.service.ts` and `intervention.service.ts`: no `updateMastery(` call, no direct `learner_skill_state`/`learner_competency_state`/`readiness_snapshots` INSERT/UPDATE, no reference to any Canonical V2 stage table. Real-Postgres proven: every Evidence/State row produced across the entire integrated flow traces to a real, existing, unmodified F5/F7/F9 writer, never to F11 code itself.

## Cross-learner contamination

Every count in this reconciliation is scoped by `student_id`; the authorization matrix (`F11_INTEGRATED_AUTHORIZATION_CERTIFICATION.md`) independently proves no other actor can read or write this student's Evidence through the F11 surface.
