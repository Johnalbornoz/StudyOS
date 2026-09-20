# F13 — UX Vocabulary

One consistent user-facing term per concept, defined once in `src/lib/i18n/messages.ts` and reused verbatim across every new Teacher/Institution surface (task section 24) — never a different label for the same underlying concept on two different pages.

| Concept | Canonical EN label | Message key(s) |
|---|---|---|
| Concept (F4) | "Concept" | `teacher.interventions.type.concept`, `teacher.assign.conceptIdLabel` |
| Skill (F4) | "Skill" | `teacher.interventions.type.skill`, `teacher.assign.skillIdLabel` |
| Competency (F4) | "Competency" | `teacher.interventions.type.competency`, `teacher.assign.competencyIdLabel` |
| Teacher Assignment (F11) | "Assignment" | `teacher.interventions.title`, `teacher.interventions.assignCta` (never "intervention" in user-facing copy — that word stays internal/code-only) |
| Exam (F9 simulation target) | "Exam" | `teacher.interventions.type.exam` |
| Evidence / more evidence needed | "evidence" / "Needs more evidence" | `institution.learners.withEvidence`/`noEvidence`, `status.needsMoreEvidence` |
| Readiness (F9) | "Exam readiness" | `teacher.student.readiness`, `institution.readiness.title` |
| Practice (Concept/Skill/Competency reinforcement) | "reinforcement" (internal), user-facing label is the concrete type name itself, never a generic "Practice" that could be confused with F9 Simulation | (see intervention type labels above) |
| Assessment / Simulation / Mini Mock / Full Mock | rendered as F9's own literal `simulationType` values in the Teacher assign form (`TOPIC_EXAM`/`DOMAIN_EXAM`/`MINI_MOCK`/`FULL_MOCK`) -- not yet given friendlier product labels in this phase's minimal form (see residuals) | n/a |
| Learning Gap (F8) | not yet exposed as a Teacher/Institution-facing label this phase (F12's `getInstitutionDiagnosticSummary` exists but is not wired into a page yet) | n/a |
| Exam Technique (F8) | same as above | n/a |
| Coverage (F6) | "Curriculum coverage" | `institution.coverage.title` (page not yet built, key reserved) |
| Institution roles | "Docente"/"Teacher", "Institución"/"Institution" (never "Admin" for INSTITUTION_ADMIN in user-facing copy — "Admin"/"Administración" is reserved for STUDYUS_ADMIN only) | `workspace.teacher`, `workspace.institution`, `workspace.admin` |

## Discipline enforced

Every new label lives in the SAME `MessageKey` union and per-locale objects the existing Student/Parent/Admin surfaces already use — no new, parallel string mechanism was introduced (task section 38's own requirement). All 5 existing locales (es/en/de/fr/pt) received real translations for every new key (verified: `tsc` fails if any locale object is missing a required key, and it currently passes).
