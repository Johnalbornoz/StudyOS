# F6 — Current Curriculum & Standards Mapping Assessment

Branch: `f6/curriculum-standards-mapping`, baseline `f5/evidence-learner-state-2` @
`b463e055a81660578a710490c656d9b1fd4b1bf9`

Written before any F6 source change, per task §3. Based on direct inspection plus a full-repo
code trace of academic-profile fields, curriculum/framework references, content-to-concept
assumptions, editorial mechanisms, role/permission vocabulary, assessment-adjacent code, PAA
references, and prior-phase versioning/cycle-detection precedent.

## 1. Existing "academic profile" — flat tags, not structure

`student_academic_profile` (`country_of_study`, `curriculum_type` ∈ national/ib/other/not_sure,
`ib_programme` ∈ MYP/DP, `ib_year`) and `subjects.ib_programme`/`ib_subject_group`/`ib_level` are
**flat, free-text/enum columns with zero FKs to any modeled syllabus structure** — confirmed by
direct schema read and by a prior F0 audit already in this repo
(`docs/implementation/f0/F0_ARCHITECTURE_BASELINE_REPORT.md`: "`src/lib/ib.ts` is an IB-specific
module... explicitly not a general mapping layer... has no version, blueprint, or institutional
policy"). `src/lib/ib.ts` contains only a subject-group label list, a generic MYP-criteria label
map (explicitly disclaimed as not official rubric text), and rough grade estimators — consumed
purely for AI quiz-prompt phrasing (`quiz-generation.service.ts`) and read-only Digital Twin
display (`learner-twin/readers.ts`). **F6 does not migrate or reconcile these fields** — they
stay exactly as they are (out of scope, still just UX-adjacent labels), and F6 builds an entirely
new, parallel, versioned structure that these flat tags are not connected to.

## 2. No prior curriculum/framework modeling exists

Confirmed by exhaustive grep (already independently certified by
`docs/implementation/f0/F0_ARCHITECTURE_BASELINE_REPORT.md` and
`F0_DEPENDENCY_MAP.md`, which list this entire domain as "greenfield, reserved for F6+"): zero
hits for "syllabus", "qualification" (as an academic noun), "Cambridge", "IGCSE", "PISA", "Saber",
"PAA" anywhere in `src/`, `database/`, `docs/` outside of these very audits confirming the
absence. The word "curriculum" is reused loosely elsewhere for **per-student topic display
order** (`curriculum-eligibility-read.service.ts`: "Phase 8 does NOT invent curriculum order...
`topics.display_order → subtopics.display_order → concepts.canonical_id`") — not an authoritative
external syllabus. `concept_relationships.source` has an unused `'CURRICULUM'` enum value that no
production writer ever populates (confirmed by `docs/audits/STUDYUS_PHASE_7G2_...md`). **F6's
curriculum/framework layer is genuinely greenfield**, including the PAA pilot fixture.

## 3. No shared/published content concept exists

`content_sources`/`content_chunks` are 100% per-student-private (`student_id NOT NULL`, no
`is_public`/`shared` flag, deleted wholesale when a student deletes their subject). No
"resource," "textbook," or "approved content" concept exists anywhere as a shared entity — every
hit for these words is either free-form JSON in a per-student study plan or AI-prompt/doc prose
describing a student's own upload. **F6 needs a genuinely new, lightweight editorial "resource"
entity** (a citation/reference record, not file storage) to satisfy the content-vs-mapping
approval separation the task requires (§13) — this is new ground, not a reuse of
`content_sources`.

## 4. Editorial workflow precedent — reuse, don't reinvent

No combined DRAFT/PROPOSED/REVIEW/APPROVED/PUBLISHED/REJECTED/RETIRED vocabulary exists as one
enum anywhere, but strong partial precedents exist to build F6's own vocabulary consistently with:

- `canonical_subjects`/`canonical_concepts`/`skills`/`competencies.status` (F4): a simple
  DRAFT→ACTIVE→RETIRED/DEPRECATED lifecycle on taxonomy tables.
- `concept_catalog_mapping.status` (F4): a genuine human-review workflow
  (MATCHED/PROPOSED/AMBIGUOUS/UNRESOLVED) with `reviewed_by`/`reviewed_at` — the closest existing
  analogue to what F6's mapping review needs.
- `institution_memberships.status` (F2): PENDING/APPROVED/REJECTED/REVOKED with
  `requested_at`/`reviewed_at`/`reviewed_by_user_id` — the closest existing "invite pending →
  accepted" state machine.
- **`aggregation_policy_versions` (F5) is the single best literal precedent for F6's own
  versioning need**: exactly one `ACTIVE` row per dimension (partial unique index), a new version
  always retires the old one atomically in the same transaction, `rules` is never edited in
  place. F6's own version-retirement pattern (structure versions, mapping versions, coverage
  policy versions) reuses this exact transactional shape.

## 5. Role/permission vocabulary — do not inflate `Role`

F1's `Role` enum is closed: `STUDENT | PARENT | TEACHER | INSTITUTION_ADMIN | STUDYUS_ADMIN`, with
`SelfServiceRole` as a stricter TypeScript subset and a non-`default` switch in
`workspaceForRole` that the compiler forces to stay exhaustive. F2's own authorization model is
**deliberately small and relationship-based**, not a general RBAC table — its own permission
types (`LearnerPermission`, `InstitutionPermission`) are narrow, additive TypeScript unions
consumed by pure relationship-join functions (`isOwner`, `isActiveParentOf`,
`canTeacherAccessLearner`), never a grant table. Zero `EDITOR`/`REVIEWER`/`PUBLISHER` values exist
anywhere. **F6 must not add these to `Role`** — following F2's own established pattern, F6
introduces a **separate, narrowly-scoped grant table** (`curriculum_editorial_grants`) rather than
inflating the platform-wide role enum, exactly mirroring how F2 itself avoided growing `Role` for
its own new permissions.

## 6. Assessment-adjacent code — no collision risk, but a naming lesson

`assessment_concept_coverage` (per-occurrence, per-student weight/confidence attribution, written
by `external-assessment.service.ts`, read by `exam-result.service.ts`) is a **structurally
different, per-student, ad-hoc concept** from F6's canonical/framework-level coverage — no reuse,
no collision, as long as F6's new coverage tables/services are clearly scoped to the canonical
layer. Notably, `src/lib/lx/evidence-sufficiency-contract.ts` already states explicitly: *"No
canonical topic × weight assessment blueprint exists... an invented heuristic... has been
removed"* — independent confirmation that no assessment-blueprint modeling exists to duplicate,
and a caution against F6 inventing an unvalidated weighting formula of its own (INV-F6-05/§25
already forbid this).

## 7. PAA — confirmed greenfield

Zero references anywhere outside prior audits confirming its absence. The F6 PAA pilot fixture
introduces this vertical from scratch.

## 8. Cycle-detection precedent — reuse verbatim

F4's `src/lib/catalog/prerequisite.service.ts::wouldCreateCycle` (a recursive-CTE reachability
check run before every insert, throwing before any write) is the exact pattern F6's Structure
Node parent-child validation should port almost unchanged — swap the table/column names for the
structure-node tree. (F2's separate `concept_relationships` graph uses a looser
visited-set BFS that tolerates cycles for non-prerequisite edge types — not the right precedent
for a tree that must stay acyclic by construction.)

## 9. Migration governance — unchanged

`<YYYYMMDD>_<HHMM>_<name>.sql`, `CREATE TABLE IF NOT EXISTS`-style idempotent DDL,
`scripts/db-migrate.ts` never auto-invoked, checksum-drift detection intact. F6 follows the same
convention with no governance changes needed.

## 10. i18n/label precedent — reuse the four-times-repeated shape

`concept_localizations`/`topic_localizations`/`subtopic_localizations`/`concept_explanations` all
share one shape: a separate table, `(parent_id, language, label-or-content-column, created_at)`,
no explicit "is source" flag — the canonical/default label simply lives on the parent entity's
own row. F6's Structure Node translated labels (task §8) reuse this exact shape
(`structure_node_localizations`), not a new convention.

## Migration risks

- The new curriculum/mapping tables have no dependency on and make no change to any F0-F5 table
  — purely additive, same discipline as F4/F5.
- `assessment_concept_coverage`'s existing "coverage" naming is a false-cognate risk only at the
  documentation level — F6's own coverage tables/services must be named and scoped distinctly
  (done: `coverage_policy_versions`, framework/structure-scoped) to avoid confusing the two in
  future phases.
- No existing data to backfill (greenfield domain) — F6's migration seeds only the small pilot
  fixture dataset needed for certification, exactly as F4 did for its skill/competency taxonomy.

## High-risk consumers (must be regression-tested after F6)

- The complete Canonical V2 suite — F6 must not introduce any read path from curriculum/coverage
  state into PRACTICE/PROVE/RETAIN/TRANSFER decisions.
- F5's `updateMastery` transaction and Learner State projectors — F6 must not hook into or alter
  this transaction at all (F6 is read-only with respect to evidence; it only *prepares* a
  contract for F7/F8 to consume later, per task §27).
- F4's `concept_catalog_mapping`/AMBIGUOUS/UNRESOLVED semantics — F6's own mapping-to-canonical-
  concept lookups must respect these states exactly as F5 already learned to (never guess on
  AMBIGUOUS/UNRESOLVED).
- F1/F2 identity, roles, and authorization — F6's new editorial grants must compose with, never
  replace or shortcut, `canAccessLearner`/institution scoping.

## Conclusion

F6 is a genuinely new, greenfield domain layered cleanly on top of F4's canonical catalog and
reusing three strong precedents already proven in this codebase: F4's cycle-checked prerequisite
graph (for structure nodes), F5's retire-and-insert version pattern (for structure/mapping/
coverage versioning), and F2's narrow-additive-permission-type pattern (for editorial roles,
avoiding `Role` enum inflation). No existing table needs to change; no existing academic-profile
data needs to move.
