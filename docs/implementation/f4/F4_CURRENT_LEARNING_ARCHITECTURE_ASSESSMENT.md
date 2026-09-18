# F4 — Current Learning Architecture Assessment

Branch: `f4/learning-architecture-2`, baseline `f3/subscription-entitlement-foundation` @ `e84846795ec59fc3114a3c559a2c30d4b70dd588`

Written before any F4 source change, per task §3. Based on direct inspection of
`database/baseline/STUDYUS_BASELINE_2026_08.sql`, every `database/migrations/*.sql` file,
and a full-repo code trace (concept writers/readers, Canonical V2, content pipeline,
prerequisite graph, skills/competencies, transfer vocabulary, private-content authorization).

## A note on the word "canonical"

This codebase already uses "canonical" for at least three unrelated things, and F4 introduces
a fourth. To avoid ambiguity throughout this and all following F4 documents:

| Existing usage | Meaning |
|---|---|
| `concepts.canonical_id` (text column) | A free-text slug identifying a concept **within one subject** (which is itself one-student-owned). Not shared across students. |
| "Canonical V2" / `src/lib/pedagogical-engine`, `pedagogical-decision` | The single pedagogical-progression authority (PRACTICE/PROVE/RETAIN/TRANSFER state machine). Nothing to do with concept identity. |
| `canonical_prepared_activity`, `canonical_activity_contract` | Pre-generated quiz content cache tied to Canonical V2's activity contracts. |
| **F4's new usage** (this document onward) | A **shared academic-knowledge catalog entity** (`canonical_subjects`, `canonical_concepts`) that is genuinely cross-student. |

This document uses "canonical catalog" / "canonical concept" only in the F4 sense from here on,
and calls out the existing `concepts.canonical_id` column explicitly wherever confusion is possible.

## 1. CURRENT concept authority

There is **no shared concept catalog today**. The `concepts` table (`subject_id`, `canonical_id`
text, `subtopic_id`, `created_at`) is scoped entirely within one student's `subject_id`, and
concept identity is decided by exactly one mechanism: the schema constraint
`UNIQUE(subject_id, canonical_id)` (baseline line 1076). Two rows are "the same concept" only if
they share a `subject_id` (i.e. belong to the same student) and an exact-text `canonical_id`.

Two independent writer paths reach this constraint, with materially different reuse behavior:

- **AI extraction** (`src/services/concept-extraction.service.ts::extractConceptsFromSource`):
  `INSERT ... ON CONFLICT (subject_id, canonical_id) DO UPDATE ... RETURNING id, (xmax=0) AS inserted`
  — same subject + identical AI-generated `canonical_id` text ⇒ reuse; anything else ⇒ new row.
- **Manual entry** (`createConceptManually`): derives `canonicalId` via `slugifyCanonicalId(label)`,
  which **always appends a random 6-character suffix**. A manually-typed concept can therefore
  **never** collide with an AI-extracted one even given an identical label — every manual entry
  is guaranteed to create a brand-new row. This is a real, already-existing duplication source
  *within a single student's own subject*, independent of anything F4 changes.

No fuzzy/semantic/AI-assisted deduplication exists anywhere — reuse is 100% delegated to
exact-text matching scoped to one subject. There is a **second, parallel concept-extraction
endpoint** (`src/app/api/concepts/extract/route.ts`, calling a different, older
`ai.service.ts::extractConceptsFromText` prompt) that appears to be legacy/unused code sitting
alongside the primary pipeline — flagged below as a pre-existing authorization gap, not something
F4 introduces or needs to fix to meet its own acceptance criteria.

## 2. CURRENT subject/topic hierarchy

`subjects` (student-owned) → `topics` → `subtopics` → `concepts` (`subtopic_id` nullable).
Every level of this hierarchy is transitively **one-student-owned** — there is no institutional,
shared, or template subject/topic/subtopic anywhere in the schema. `topic_hierarchy.service.ts`
classifies concepts into topics/subtopics per subject via AI, constrained to that subject's own
existing subtopics (never inventing shared structure).

## 3. CURRENT ownership semantics

Ownership is enforced by join chains rooted at `students.id`, gated through small, consistently
reused helpers in `src/lib/auth.ts`: `verifySubjectAccess`, `verifyContentSourceAccess`,
`getOrCreateStudentId` (session → internal id, never trusts a client-supplied id) — all fail
closed. The Canonical V2 boundary uses its own equivalent,
`resolveConceptSubjectForStudent` (`src/lib/pedagogical-decision/resolve-concept-subject.ts`):
`SELECT s.id FROM concepts c JOIN subjects s ON s.id=c.subject_id WHERE c.id=$1 AND s.student_id=$2`.
A prior audit (`STUDYUS_PHASE_0A_CURRENT_ARCHITECTURE_AUDIT.md`) already documented the load-bearing
invariant that **a `concepts` row existing for a subject IS the authoritative "this concept is
loaded for this learner" fact** — i.e. today, concept *identity* and concept *enrollment* are the
same row. F4 must split these without breaking either meaning.

Two gaps in this otherwise-consistent pattern, both **pre-existing, not introduced by F4**:

- `src/app/api/content/extract-concepts/route.ts` has a literal `// TODO: Verify authorization`
  and performs no ownership check on `sourceId`/`subjectId` before creating concepts from it.
- `src/app/api/concepts/extract/route.ts` (the legacy parallel endpoint above) checks only that
  the caller is *authenticated*, never that they own the `subjectId` in the request body.

These are recorded in the residual risk register; fixing them is outside F4's scope (data
architecture, not a security-remediation phase), but they are disclosed here per F0-S's own
transparency standard rather than silently left for someone else to rediscover.

## 4. CURRENT concept reference graph

`concept_relationships` (`source_concept_id`, `target_concept_id`, `relationship_type` ∈
`PREREQUISITE_OF | DEPENDS_ON | RELATED_TO | EXTENSION_OF | APPLIES_TO | COMMONLY_CONFUSED_WITH`)
exists, is well-built (`src/services/concept-graph.service.ts`), validates against self-edges and
out-of-subject targets, and supports prerequisite-chain traversal — but is **AI-inferred only, and
empty in production** (0 rows), a fact already documented by
`src/services/curriculum-eligibility-read.service.ts`'s own code comment, which falls back to
`topics.display_order → subtopics.display_order → canonical_id` for ordering instead. There is
**no shared/global prerequisite table** — everything here is per-student-concept, same as
`concepts` itself.

## 5. CURRENT evidence dependencies

Confirmed by direct schema read: **19 tables** carry a `concept_id`-family foreign key, and every
one of them FKs straight to the per-student `concepts.id`: `learning_evidence`, `mastery_records`,
`mastery_events` (via `mastery_id`), `concept_knowledge_state`, `concept_memory_state`,
`concept_transfer_state`, `misconception_signatures`, `student_misconceptions` (via
`misconception_signature_id`), `validation_cycles`, `validation_events` (via
`validation_cycle_id`), `calibration_conflicts`, `cognitive_diagnoses`, `remediation_paths`,
`remediation_steps`, `errors`, `learning_debt`, `assessment_concept_coverage`,
`study_session_items`, `quiz_sessions`, `verification_attempts`,
`pedagogical_requirement_recognition`, `canonical_prepared_activity`. This list is the
single most important migration-safety surface in F4: **none of these tables need to change**
if the migration only adds new, purely additive catalog tables and leaves `concepts.id` as the
one identity these 19 tables continue to key off.

## 6. CURRENT private-content dependencies

`content_sources` (student-owned uploads) and `content_chunks` (`concept_mappings uuid[]`
referencing per-student `concepts.id`) are gated correctly at the two properly-built call sites
(`content/process`, `content/upload`, `content/[id]`, `content/search`, all via
`verifyContentSourceAccess`/`verifySubjectAccess`), but **not** at `content/extract-concepts`
(see §3). `embedding.service.ts::getChunksByConceptId` itself performs no student/subject filter
and relies entirely on callers already holding a student-scoped `conceptId` — this is a real,
if currently low-risk, trust boundary to be aware of when any new canonical-identity lookup is
introduced near this code path.

## 7. CURRENT learner-state dependencies

Canonical V2 (`src/lib/pedagogical-engine`) treats `conceptId`/`studentId` as **wholly opaque
strings**, always required as a pair, never independently, never compared across students, never
used to look up a name/label internally. This means Canonical V2 is architecturally unaffected by
introducing a canonical catalog, *provided* the DB-layer ownership check
(`resolveConceptSubjectForStudent`) keeps resolving the same `(conceptId, studentId) → subjectId`
fact it does today — which it will, since F4 does not change `concepts` or `subjects`.

Two **separate, non-reconciled transfer vocabularies** already exist and must not be confused
with F4's new Context/Transfer-Level metadata (§11 of the target architecture):
- Phase 7's `TransferDistance` (`NEAR|MID|FAR`) and `TransferDepth`
  (`NONE|NEAR_DEMONSTRATED|GENERALIZED|ROBUST`), persisted in `concept_transfer_state`.
- The pedagogical-engine's own `TransferChallengeDepth` (`NEAR|CONTEXTUAL|HIGHER`), used only in
  `ActivityContract.transferDepth`.

Neither matches the task's requested `FAMILIAR|ALTERED|REAL_WORLD|UNFAMILIAR|CROSS_DOMAIN`
vocabulary, and F4 must not attempt to unify or replace either existing one (INV-F4-11, §11 of
the task). The new `contexts` taxonomy is introduced as a third, independent, currently-unwired
semantic layer for future (F5+) evidence/activity classification only.

## 8. CURRENT duplication patterns

- Manual vs. AI-extracted concept creation can silently duplicate the same real-world concept
  within one student's one subject (§1) — pre-existing, not caused by F4, but directly relevant
  to why a canonical catalog is needed at all.
- `misconception_signatures` is architecturally the same gap at smaller scale: it is documented
  in its own service file as "normalized, reusable," but FKs to the per-student `concepts.id`, so
  in practice the same real misconception gets a separate row per student. Considered explicitly
  out of scope for F4 (not named in the task's target domain) and recorded in the residual risk
  register as a candidate for the same treatment in a later phase.

## 9. Migration constraints

- **Zero prior art for skills/competencies** — confirmed by exhaustive grep and by two prior-phase
  documents that already named this exact gap and explicitly deferred it
  (`F2_RESIDUAL_RISK_REGISTER.md` R-F2-04: *"building a canonical concept catalog is explicitly
  out of scope for F2"*; `LX-3_CONCEPT_MISSION.md`: *"no learning_objective / competency-statement
  table"*). F4 is building wholly new ground here, not refactoring something that exists.
- **The 19-table evidence/state surface (§5) must not move.** The only safe migration shape is
  additive: new tables for the canonical catalog, plus an explicit, auditable correspondence
  table from existing `concepts.id` rows to the new canonical catalog — never a rewrite of
  `concepts.id` itself or any of its 19 dependents.
- **`concept_relationships` being empty in production** means F4's canonical-level prerequisite
  graph starts from zero real data too — this is expected, not a regression, and should not be
  used as a reason to auto-populate canonical prerequisites from the (empty) existing table.
- **No UNIQUE(name) constraint may exist on the new `canonical_concepts` table.** The task's own
  adversarial cases (§8: same name/different definition, same name/different level, same
  name/different scope) require that multiple canonical concepts be allowed to share a display
  name — uniqueness must never be enforced on name, only used as an advisory lookup index.

## 10. High-risk consumers (must be regression-tested after F4)

- Canonical V2's full test suite (~40 `canon-*`/`audit-canon-v2-*` files in `tests/unit/`) —
  highest priority per task §31.
- `src/lib/pedagogical-decision/resolve-concept-subject.ts` and
  `src/services/learning-session-engine.service.ts::verifyConceptOwnership` — the two ownership
  gates that must keep working unchanged.
- `src/services/transfer-task-instance.service.ts::resolveKnownConceptIds` — already a genuinely
  unscoped existence-only query (no student filter); worth being aware of if F4's mapping tables
  are ever joined into this path later, so as not to compound an existing gap.
- `src/services/concept-graph.service.ts`, `src/services/curriculum-eligibility-read.service.ts` —
  read the (empty) prerequisite graph; must not be affected by a new, separate canonical
  prerequisite graph.
- F0-S/F1/F2/F3 regression suites (`f0s-*`, `f1-*`, `f2-*`, `f3-*` in `tests/unit/`) — 22 files.

## Conclusion

The architecture is consistent, well-understood, and — critically — already structured so that
a purely additive canonical catalog can be introduced without touching `concepts.id` or any of
its 19 dependent tables. The central design decision for F4's target architecture (next document)
is therefore: **add new canonical-catalog tables and one explicit, auditable correspondence table;
change nothing about `concepts`, `subjects`, `topics`, `subtopics`, or any evidence/state table.**
