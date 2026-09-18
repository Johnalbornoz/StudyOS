# F6 — Residual Risk Register

| ID | Risk | Severity | Status | Notes |
|---|---|---|---|---|
| RR-F6-01 | No real PAA/Cambridge/IB syllabus content exists — only a small, reviewed architecture-certification fixture | High (by design, disclosed) | Expected outcome of this phase | F6 proves the model works, not that real content has been populated. Populating a real, editorially-reviewed catalog for any framework is a content-operations effort separate from this data-architecture phase. |
| RR-F6-02 | The flat IB tags on `subjects`/`student_academic_profile` (from before F6) remain completely disconnected from the new versioned structure | Medium | Accepted, disclosed in the assessment | F6 deliberately does not migrate or reconcile these — they continue to serve their existing purpose (AI-prompt phrasing, rough Twin display) unchanged. A future phase could connect a student's IB tag to a real `academic_subjects`/`structure_versions` row, but that is a product decision (does the platform want to claim official IB alignment for real students yet?) outside F6's own scope. |
| RR-F6-03 | No content-generation path populates F5's `metadata.skillIds`/`competencyIds`/`contextCode` from F6's mappings yet | Medium | Expected, matches F5's own RR-F5-01 | The activity metadata bridge (`resolveActivityMetadataForObjective`) is proven correct against real published mappings, but nothing calls it from a live quiz/transfer-generation path — task §27 explicitly reserves that wiring for F7/F8. |
| RR-F6-04 | `curriculum_editorial_grants` has no UI for granting/revoking — only service functions and a cert-script seed | Low | Accepted for this phase | Task §41 scopes F6's admin surface to structure/mapping/coverage inspection and review actions, not a full editorial-user-management UX. Granting roles today requires a direct service call or database operation by an engineer. |
| RR-F6-05 | Remote (Preview database) migration application is deferred | Medium | Deferred, matches F1-F5's own precedent | See Preview certification doc — no proven Preview/Production database isolation exists from this environment. |
| RR-F6-06 | No index exists on `objective_concept_mappings`/`objective_skill_mappings` beyond the ones defined (objective, status, group, one-published) | Low | Accepted for this phase | Adequate for this phase's certification scale; worth revisiting once real mapping volume exists across many frameworks. |
| RR-F6-07 | `academic_resources` is a citation/reference model only — no actual file storage or delivery mechanism | Low | Intentional, task's own scope boundary | Task §41 explicitly forbids building a final content-management UX in F6; `source_locator` is a citation field, not a file upload pipeline. |

## Explicitly NOT a risk (verified, not assumed)

- Canonical concept duplication across frameworks — verified negative against real Postgres with
  two real frameworks (PAA, Cambridge) sharing one canonical concept.
- Self-approval — verified denied against real Postgres without any status side effect.
- Silent promotion of ambiguous AI-suggested mappings — verified negative: two candidates, only
  one explicitly published by a human, the other stays DRAFT indefinitely.
- Historical mapping/structure rewriting on version change — verified: both structure-version
  supersession and mapping-version replacement leave prior data fully intact.
- Private content exposure via objective alignment — verified negative against real Postgres.
- Coverage inflation from duplicate or unpublished resources — verified negative against real
  Postgres.
- Canonical V2 interference — verified structurally absent, and its full 806-test suite passes
  unmodified.

## Recommendation

None of the above blocks proceeding to F7. RR-F6-01 (no real content yet) and RR-F6-03 (activity
metadata bridge not yet wired into any generation path) are the most visible consequences of this
phase and should be communicated plainly: F6 built the versioned mapping/coverage architecture
the task asked for, not a claim that real curriculum alignment exists in production today.
