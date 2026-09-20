# F13 — Information Architecture

## Top-level IA per workspace (task section 5)

```
STUDENT (unchanged, already mature)
├── Today            /dashboard/today
├── My Path          /dashboard/path
├── Progress         /dashboard
├── Study Plan       /dashboard/study-plan
├── Debt             /dashboard/learning-debt
├── Tutor            /dashboard/tutor
└── Account: Notifications / Profile / Billing

PARENT (existing single page, not yet workspace-integrated -- see residuals)
└── Children overview /dashboard/parent

TEACHER (new)
├── My Classes        /dashboard/teacher
│   └── Class roster  /dashboard/teacher/classes/[classId]
│       └── Student detail + Assign  /dashboard/teacher/students/[studentId]?classId=...

INSTITUTION (new)
├── (picker if >1)    /dashboard/institution
└── Overview          /dashboard/institution/[institutionId]
    ├── Learners (learning intelligence + evidence sufficiency)  .../learners
    ├── Interventions (status/type distribution)                .../interventions
    └── Attention Areas                                          .../attention

ADMIN (unchanged -- existing email-gated console, not restructured this phase)
```

## Internal architecture names never exposed (task section 5's own requirement)

No page or label anywhere in the new surfaces says "Learner State," "Canonical V2," "Aggregation Policy," or "MetricEnvelope" — user-facing labels are plain nouns (`teacher.student.readiness`, `institution.overview.uniqueLearners`, etc.); internal names stay in code comments and this documentation only.

## Deliberately deferred from the IA (documented, not silently dropped)

- Institution **Grades**/**Classes**/**Teachers** roster pages (task's own suggested hierarchy) — `getInstitutionGrades`/`getInstitutionClasses`/`getInstitutionTeachers` all exist and are certified (F12), but this phase's own UI only wires Overview/Learners/Interventions/Attention Areas into pages, given time — the remaining three are a direct, low-risk follow-up (same pattern, same auth, same components) rather than new design work. See `F13_NEXT_PHASE_HANDOFF.md`.
- Institution **Coverage**/**Readiness** pages — the underlying F12 functions (`getInstitutionCoverage`/`getInstitutionReadiness`) require a `structureVersionId`/`examVersionId` that has no discoverable "pick one" UI yet (no "list structures/exam versions relevant to this institution" read model exists in F6/F7/F9 today) — building a selector against a nonexistent list would be decorative, not functional. Documented as a real, disclosed gap, not fabricated.
- Teacher **Exam Preparation** / **Recent Activity** sections (task's own suggested Teacher hierarchy) beyond what the Student Detail page already shows (readiness status badge, last activity) — a dedicated exam-prep sub-view is deferred.
