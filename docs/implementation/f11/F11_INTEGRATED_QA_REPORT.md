# F11 — Integrated QA Report

Branch: `f11/integrated-certification`
Certified parent: `f11c4/exam-reinforcement-execution@3d867202e3f80fcc1a82268b425d041ddbe4b58f`
Candidate SHA (this gate's starting point): `cf16bf989eb260e628ca9bf9de66627e9cef8be8`

## Test Layer Matrix (mandatory separate reporting, task §12)

```
INTEGRATED_FLOW:
  executed: 1 continuous flow -- Teacher assigns and a Student executes all
             four intervention types (Concept/Skill/Competency/Exam)
             through the SAME dispatcher, SAME Student read model, SAME
             Teacher read model
  passed:   yes (lifecycle ASSIGNED->IN_PROGRESS->COMPLETED for all four;
             one intervention (Skill) completed despite an INCORRECT
             response, proving completion != mastery/pass/ready)

AUTHORIZATION:
  executed: 8 (teacher-without-assignment, teacher-correct-assignment,
             teacher-wrong-class, cross-student, parent, teacher-via-
             student-route, multi-role, institution-admin-alone)
  passed:   8

EVIDENCE_SEMANTICS:
  executed: 6 (Concept no-inference x2, Skill no-inference, Competency
             no-reverse-fabrication, Exam legitimate-only, Competency
             state existence) -- jointly, in one session, so cross-type
             contamination could be observed if it existed
  passed:   6

SELF_SERVICE:
  executed: 6 (Topic/Domain/Mini positive, Full Mock negative, zero
             F11 dependency, routing-guard source check)
  passed:   6

CONCURRENCY:
  executed: 4 (Concept sequential, Skill sequential, Competency real
             concurrent, Exam real concurrent + orphan-attempt check)
  passed:   4 (plus 2 Exam-specific sub-assertions)

CANONICAL_BOUNDARY:
  executed: 7 (5 structural source-guard assertions across both
             orchestration files + 2 explicit "zero Canonical write"
             narrative checks)
  passed:   7

REGRESSIONS:
  F11-C4: f11c4-exam-execution-migration-cert.sh PASS, unchanged
  F11-C3: f11c3-competency-execution-migration-cert.sh PASS, unchanged
  F11-C2: f11c2-skill-execution-migration-cert.sh PASS, unchanged
  F11-C1: f11c1-execution-orchestration-migration-cert.sh PASS, unchanged
  F11-B:  f11b-teacher-intervention-migration-cert.sh PASS, unchanged
  F11-A:  f11-a-teacher-authorization-migration-cert.sh PASS, unchanged
  F10:    f10-parent-experience-migration-cert.sh PASS, unchanged
          f10-multi-role-authorization-check.sh PASS, unchanged
  F9:     f9-exam-readiness-simulation-migration-cert.sh PASS, unchanged
  F8:     f8-assessment-framework-migration-cert.sh PASS, unchanged
  F7:     f7-assessment-framework-migration-cert.sh PASS, unchanged
  F6:     f6-curriculum-mapping-migration-cert.sh PASS, unchanged (load-bearing
          for F9's own shared-canonical-concept fixture this gate reuses)
  F5:     f5-learner-state-migration-cert.sh PASS, unchanged
  F2:     f2-authorization-migration-cert.sh PASS, unchanged
  Canonical V2: included in the full suite below -- PASS, unchanged

REAL_POSTGRES:
  executed: 44 assertions (this gate's own integrated cert-runner, sections
            1-10) + 14 independently re-run prior-phase real-Postgres
            certification scripts (13 sub-phase/domain scripts + the F10
            multi-role check)
  passed:   44 + 14/14 scripts

FULL_SUITE:
  347 test files / 5589 tests -- PASS
  tsc --noEmit: clean
  next build: clean (resolves the "known tooling note" recorded in the
  pre-existing docs/implementation/f11/F11_INTEGRATED_CERTIFICATION.md --
  a fresh build in this worktree completed with no incomplete-artifact
  issue; treated as an environment-specific transient in that earlier run,
  not a real defect, since the exact same source tree now builds cleanly)
```

## Bugs Discovered and Fixed

Zero implementation bugs. Three fixture-authoring mistakes in this gate's OWN new integrated cert runner were caught and corrected before certification passed:
1. The Skill and Competency test contexts were initially matched to the SAME canonical concept via two different learner concepts, making `resolveStudentConceptForCanonicalConcept` ambiguous between them and silently collapsing both executions onto one concept — corrected by giving each its own dedicated canonical concept.
2. A "Competency intervention produces zero Skill Evidence" assertion incorrectly expected `null` Skill State, when in this SAME integrated flow the Skill intervention itself had already legitimately produced one Skill Evidence row — corrected to assert the Competency run added no ADDITIONAL Skill evidence (`evidenceCount` stays at 1, the Skill intervention's own legitimate count).
3. The integrated flow's Exam intervention needed its Student concept matched to F9's own real canonical concept behind `OBJ_MATH` for `recordSimulationItemResponse`'s real Evidence bridge to resolve a student concept — omitted initially, corrected by adding the mapping.

None of these corrections weakened any assertion's intent; each now measures precisely the joint property it was designed to measure.

## Overall QA Verdict

**PASS.** F11 certifies as one integrated system: 44 real-Postgres assertions across ten certification sections, zero regressions across 14 independently re-run prior-phase certifications and the full 5589-test suite, and the one previously-recorded environment tooling note (an incomplete `next build` in an earlier sandbox run) does not reproduce in this worktree's own fresh build.
