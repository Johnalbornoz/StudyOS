# F11 — Next Phase Handoff

## What the F11 Integrated Certification Gate delivered

- Proof that F11-A/B/C1/C2/C3/C4 form ONE coherent Teacher Workspace execution layer, not four independently-passing but potentially-divergent adapters: one dispatcher, one Student read model, one Teacher read model, one authorization primitive per role, one idempotency mechanism, one Canonical V2 boundary discipline.
- Proof that F9 Student self-service is completely unaffected by F11's existence — zero dependency, zero required field, zero new gate.
- Proof that Teacher-assigned and Student-initiated exam simulation converge on the exact same F7/F9 eligibility authority, including the PAA Full Mock Guard.
- Joint (not merely per-type) proof of Evidence non-contamination, authorization matrix consistency, and concurrency safety across all four intervention types run together in one session.

## What F12 (or any future phase) should know

1. **The dispatcher pattern is the right place to add a fifth intervention type**, if one is ever needed — extend `startTeacherInterventionExecution`'s branch list and add one new `start*ReinforcementExecution` function; do not create a parallel registry, route, or read model.
2. **F9 self-service must remain independent.** Any future change to `POST /api/simulation/attempts` or its underlying service chain should be re-checked against the routing-guard proof in `F11_STUDENT_SELF_SERVICE_NON_REGRESSION.md` (no `teacher_intervention` reference) before being merged.
3. **The per-type concurrency model is deliberately NOT uniform** (Concept/Skill/Competency tolerate a harmless orphan; Exam eliminates the race structurally) — this is correct and intentional, driven by each type's own underlying engine's cost profile (AI-dependent vs pure-DB attempt creation). A future type should make the same case-by-case judgment, not default to either pattern.
4. **This gate found zero implementation bugs** — every correction was in the gate's own new test fixtures. That is a genuine signal that F11-A through F11-C4's own individual certifications were already thorough, not a reason to certify future integration gates more lightly.
5. **F12 begins as architecture discovery for institution-level intelligence and its aggregate-only privacy model** (per the pre-existing `F11_INTEGRATED_CERTIFICATION.md`'s own scope note) — out of scope for this gate, not begun here.

## What F12 should NOT do

- Do not make F11 (Teacher-assigned intervention) a prerequisite for any Student self-service exam flow.
- Do not introduce a type-specific authorization primitive that breaks the "one `isOwner`/`canAccessClass` check for all types" structural guarantee this gate certified.
- Do not build final Teacher/Institution UI, class-batch assignment, or automatic intervention generation as part of institution-level intelligence work without a separate, explicit scoping decision — this gate's STOP condition (no F12 substantive work, no main merge, no Production deploy) applies to this session's own output, and F12's own future phase should re-state its own scope boundary explicitly rather than inheriting this one by default.
