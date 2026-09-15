# CANON-R4R1A — PREEXISTING CONCEPT POPULATION FIX

## STATUS

**CODE_PASS** (not "LIVE PASS" — no live browser/DB/auth/AI-provider access
in this environment, confirmed absent again this phase). The corrected
population source, its dry-run reporting, and the required test matrix
are built, unit-tested against synthetic fixtures and direct schema/source
audits, and type/build clean. **No live Preview execution happened** —
no dry-run, no apply, no Radicación/zero-evidence/post-cutover
verification against real data — because no DB connection exists in
this session. Per this phase's own explicit closing instruction ("IF
PREVIEW DB ACCESS EXISTS: run DRY-RUN ONLY first and STOP for human
review"), nothing here claims otherwise.

Verification:
- `npx tsc --noEmit` — clean.
- `npx vitest run tests/unit/canon-r2-pedagogical-engine.test.ts
  tests/unit/canon-r2r1-engine-contract-closure.test.ts
  tests/unit/canon-r3-shadow-integration.test.ts
  tests/unit/canon-r4-legacy-compatibility.test.ts
  tests/unit/canon-r4r1-pre-v1-learn-baseline.test.ts
  tests/unit/canon-r4r1a-preexisting-concept-population-fix.test.ts` —
  **289 tests, all passing** (83 + 53 + 47 + 43 + 36 + 27).
- `npx vitest run` (full suite) — **240 test files, 4268 tests, all
  passing** (was 239 files / 4241 tests before this phase — +1 file, +27
  tests, zero regressions).
- `npm run build` — clean.

## FINAL PRODUCT RULE

Every concept already **loaded/assigned/available** to a specific
learner at v1 cutover receives `LEARN = SATISFIED, basis =
LEGACY_MIGRATION_BASELINE` — **even with zero `learning_evidence` rows,
zero quiz attempts, zero sessions.** Scoped strictly per exact
`(student_id, concept_id)`, never globally by catalog existence. A
learner-concept relationship created after cutover receives no automatic
recognition and must satisfy a real `LEARN_CHECK` scoring strictly above
80%.

## ROOT CAUSE

CANON-R4R1's own population rule —
`isPreexistingLearnerConcept(earliestEvidenceAt, cutoverAt)`, gated on
the pair's EARLIEST `learning_evidence` row — silently excluded every
concept a student had loaded but never yet attempted. Since `learning_evidence`
is written only on a graded attempt, a student who had a concept sitting
in their curriculum, unopened, at cutover would receive **no LEARN
recognition at all** and would be forced through a fresh `LEARN_CHECK`
for something Product considers already-available legacy content — the
exact over-restriction this phase corrects.

## OLD POPULATION RULE

```ts
// CANON-R4R1 (superseded)
function isPreexistingLearnerConcept(earliestEvidenceAt: string | null, cutoverAt: string): boolean {
  if (earliestEvidenceAt == null) return false;
  return new Date(earliestEvidenceAt).getTime() < new Date(cutoverAt).getTime();
}
// sourced from: MIN(learning_evidence.timestamp) GROUP BY student_id, concept_id
```

## NEW POPULATION RULE

```ts
// CANON-R4R1A (corrected) -- same pure comparison, a DIFFERENT real-world fact
function isPreexistingLearnerConcept(loadedAt: string | null, cutoverAt: string): boolean {
  if (loadedAt == null) return false;
  return new Date(loadedAt).getTime() < new Date(cutoverAt).getTime();
}
// sourced from: concepts.created_at, via concepts JOIN subjects ON subjects.id = concepts.subject_id
```

The pure comparison function's logic is **unchanged** — only what
timestamp is fed into it changed, from an evidence-derived fact to the
concept's own real loading/assignment timestamp. This is why the
existing CANON-R4R1 unit tests for this function's date-comparison logic
needed zero modification (confirmed: `tests/unit/canon-r4r1-pre-v1-learn-baseline.test.ts`
Test 3 still passes unmodified).

## AUTHORITATIVE LEARNER-CONCEPT SOURCE

Directly audited against `database/baseline/STUDYUS_BASELINE_2026_08.sql`
(the real schema, not guessed): **StudyUS has no global, shared concept
catalog and no separate enrollment/assignment junction table.**
`subjects.student_id` is a direct, `NOT NULL` foreign key — a subject
row is already owned by exactly one student (subjects are created
per-student, never shared across students). `concepts.subject_id` links
a concept to exactly one subject, and therefore — transitively, through
that one FK hop — to exactly one student. A `concepts` row **existing**
for a subject IS the authoritative "this concept is loaded for this
learner" fact. There is no separate assignment table to search for,
because a concept row cannot exist independently of its one owning
student.

## TABLES AND JOINS

```sql
SELECT c.id AS concept_id, s.student_id AS student_id, c.created_at AS loaded_at
FROM concepts c
JOIN subjects s ON s.id = c.subject_id
WHERE c.created_at < $cutoverAt
  [AND s.student_id = $studentId]
```

- **`concepts`** (`id`, `subject_id NOT NULL`, `created_at`) — one row
  per concept, owned by exactly one subject.
- **`subjects`** (`id`, `student_id NOT NULL`, ...) — one row per
  student's own subject instance; subjects are never shared.
- **The join** (`concepts.subject_id = subjects.id`) is the ENTIRE
  mechanism — it is simultaneously the "which learner" answer (via
  `subjects.student_id`) and the "is it loaded" answer (the row simply
  exists). No third table, no enrollment/assignment flag, is needed or
  exists.
- **Why this means "already loaded for the learner":** a `concepts` row
  is created exactly when that concept enters the student's own subject
  (confirmed by the schema's ownership structure — there is no
  mechanism in this schema for a concept row to exist without a
  concrete, single owning student). Its mere existence, with a
  `created_at` before cutover, is the loading fact itself.

## ZERO-EVIDENCE CONCEPTS

Included automatically and by construction: the query above never joins
`learning_evidence` in its `WHERE` clause at all (Test 8: source-audited
directly — the eligibility query's own text contains no
`learning_evidence` reference). A concept the student has never opened
still has a real `concepts` row with a real `created_at`, so it
qualifies exactly like an attempted one (Tests 1, 7, 9).

## GLOBAL CATALOG EXCLUSION

There is no global catalog to exclude FROM in this schema — every
`concepts` row is already scoped to one subject and therefore one
student by construction (Test 4/5, confirmed by direct DDL audit of both
tables' `NOT NULL` foreign keys). A concept "existing in the catalog"
and "being loaded for a specific learner" are the same fact in this
schema, which is precisely why the corrected query needs no additional
exclusion logic — the JOIN itself is the exclusion.

## CUTOVER SEMANTICS

Unchanged from CANON-R4R1: `cutoverAt` and `migrationVersion` remain
explicit, human-supplied arguments with no default (Part 4/29 of that
phase, still honored — neither CLI script derives either implicitly).
`concepts.created_at` is a real, non-nullable, already-populated
`timestamp with time zone DEFAULT now()` column — **the fallback
"snapshot current Preview assignment set" mechanism this phase's own
spec asked to document if no real timestamp existed was not needed**: a
real, authoritative timestamp already exists on the one authoritative
table.

## LEARN MIGRATION BASELINE

`buildPedagogicalMigrationBaseline`'s own `isPreexistingLearnerConcept`
input is unchanged in shape (still a plain boolean, still a separate
input from `knowledgeState`) — only ITS OWN caller-side derivation
changed, from an evidence-based check to the corrected
`concepts.created_at`-based one. The function's internal logic (grant
exactly one `LEGACY_MIGRATION_BASELINE` LEARN recognition when true and
no stronger evidence-grounded LEARN recognition already exists) is
byte-for-byte unchanged.

## HIGHER-STAGE RECOGNITION

Completely unchanged (Part 10/23 — explicitly out of scope for this
fix). PRACTICE/PROVE/RETAIN/TRANSFER remain governed exclusively by
`evaluateLegacyRecognition`'s own old-model dimension ladder (CANON-R4,
untouched this phase). A preexisting-but-never-studied concept correctly
resolves to `LEARN` recognized, `PRACTICE` unsatisfied — stage
`PRACTICE` (Test 10, and the worked example below).

Worked example (Part 11 of the spec), verified structurally by the test
matrix's own fixtures:

| Concept | Recognized | Resulting stage |
|---|---|---|
| A — never opened | LEARN | PRACTICE |
| B — Practice legitimately completed | LEARN + PRACTICE | PROVE |
| C — Prove legitimately completed | LEARN + PRACTICE + PROVE | RETAIN |
| D — old validated/consolidated | LEARN + PRACTICE + PROVE + RETAIN + TRANSFER | CONSOLIDATED |

## DRY-RUN CHANGES

`scripts/canon-r4r1-pre-v1-learn-baseline.ts` now calls
`loadPreexistingLearnerConceptPairs(cutoverAt, studentId, true)` (the
third argument requests the optional, reporting-only evidence-existence
flag) and prints the full required breakdown (Test 16): `totalSnapshotPairs`,
`pairsWithEvidence`, `pairsWithZeroEvidence`, `distinctLearners`,
`distinctConcepts`, plus the already-existing `proposedLearnCount`,
`alreadyExistingCount`, `duplicatesSkipped` (apply mode), higher-stage
counts, and a bounded concept-id sample. `scripts/canon-r4-migration-dry-run.ts`'s
single-concept and `--all-concepts` paths were also corrected: the
latter previously enumerated `DISTINCT concept_id FROM learning_evidence`
(which would have silently skipped every zero-evidence concept) and now
enumerates `concepts JOIN subjects` instead.

## PREVIEW DRY-RUN RESULT

**Not executed.** No DB access in this environment. See PREVIEW COMMANDS
in the CANON-R4R1 report (unchanged) for the exact invocation; this
phase changes only what the tool computes, not how it is invoked.

## PREVIEW APPLY RESULT

**Not executed**, and per this phase's own explicit closing instruction,
not attempted: "run DRY-RUN ONLY first and STOP for human review. DO NOT
APPLY until dry-run counts are explicitly reviewed." No recognition rows
exist anywhere.

## ZERO-EVIDENCE REAL CASE

**Not executed** — no live Preview data. The engine-level mechanics this
case depends on ARE directly verified with synthetic fixtures (Tests 7,
9, 10: a `knowledgeState: null` concept with `isPreexistingLearnerConcept:
true` recognizes LEARN alone and reaches stage `PRACTICE` through the
real, unmodified engine). Confirming this against an actual real
Preview concept with zero `learning_evidence` rows is documented as
mandatory (Part 21) but not performed here.

## RADICACIÓN RESULT

**Not executed** — no live Preview data, and per Part 20's own
instruction ("Do not hardcode PRACTICE"), no result is asserted here.
What changed structurally: Radicación's LEARN status now depends on
whether it was loaded for the learner before cutover (very likely true,
given it appears in the student's reported history) rather than on
whether any `learning_evidence` row happens to predate cutover — its
higher-stage outcome (Practice/Prove/Retention/Transfer) is untouched by
this fix and still depends entirely on `evaluateLegacyRecognition`'s
real read of that student's actual `ConceptKnowledgeState`.

## POST-CUTOVER RESULT

**Not executed** — no live Preview data. Engine-level mechanics verified
directly (Test 11: `isPreexistingLearnerConcept: false` yields zero
recognitions; the CANON-R4R1 suite's own Tests 25–27 confirm the engine
then requires a real `LEARN_CHECK` above 80%, unchanged this phase).

## SAFETY

- No pedagogical engine file is touched this phase — `git diff --stat
  -- src/lib/pedagogical-engine/` is empty, confirmed directly, and Test
  27 additionally confirms no engine file even references the
  population module.
- No shadow-comparison file is touched — `git diff --stat -- src/lib/pedagogical-shadow/`
  is empty.
- The `pedagogical_requirement_recognition` schema is unchanged (Part
  16) — no new migration file was added this phase; Test 15 confirms
  exactly one CANON-R4R1 migration file exists with its `UNIQUE`
  constraint intact.
- No write path changed — `applyRecognitions`'s own Preview-only guard
  is untouched (Test 18).
- No AI, cache, Quality Gate, UI, or routing code is referenced anywhere
  in the touched files (Tests 22–26).

## PERFORMANCE FIREWALL

Unaffected — the population query change only alters which offline,
out-of-band migration tooling script issues which read-only SQL; no
learner-critical-path code references either changed file.

## REGRESSION

`npx vitest run` (whole repository): **240 test files, 4268 tests, 0
failures** — up from 239/4241 before this phase (net +1 file, +27
tests). `npx tsc --noEmit` and `npm run build` both clean. All five
prior CANON-R2/R2R1/R3/R4/R4R1 test files pass **completely unmodified**
(262 tests, zero changes needed) — this phase's correction is fully
contained within the population layer.

## FILES CHANGED

```
 M scripts/canon-r4-migration-dry-run.ts
 M scripts/canon-r4r1-pre-v1-learn-baseline.ts
 M src/lib/pedagogical-migration/migration-baseline.ts
 M src/lib/pedagogical-migration/preexisting-learner-concept.ts
?? tests/unit/canon-r4r1a-preexisting-concept-population-fix.test.ts
?? docs/CANON_R4R1A_PREEXISTING_CONCEPT_POPULATION_FIX.md
```

`src/lib/pedagogical-engine/**` and `src/lib/pedagogical-shadow/**` —
untouched (confirmed above). No new database migration file — the
existing `pedagogical_requirement_recognition` schema (from CANON-R4R1)
required no changes.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `fix(canon-r4r1a): correct preexisting learner-concept population
   source` — the corrected population query, migration-baseline doc
   update, both CLI script updates, and the new test file.
2. `docs(canon-r4r1a): preexisting concept population fix report` — this
   document.

No file inside `src/lib/pedagogical-engine/` or `src/lib/pedagogical-shadow/`
is touched by either commit.
