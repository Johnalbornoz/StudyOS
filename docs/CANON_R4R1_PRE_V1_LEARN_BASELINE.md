# CANON-R4R1 — PRE-v1 LEARN BASELINE + RECOGNIZED REQUIREMENTS ENGINE INTERFACE

## STATUS

**CODE_PASS** (not "LIVE PASS" — no live browser/DB/auth/AI-provider access
in this environment, confirmed absent again this phase). The minimal
engine input extension, the schema, the persistence adapter, the
preexisting-learner-concept classifier, and the dry-run/apply CLI are
built, unit-tested against synthetic fixtures, and type/build clean.
**No live Preview execution — schema apply, baseline apply, Radicación,
consolidated/partial/post-cutover cases — happened**, because no DB
connection exists in this session. Steps 1–3 of the mandatory Preview
Execution Order (Part 29) are complete (code complete, tests green,
migration file reviewed); steps 4–12 (dry-run through post-cutover
verification) are documented, not executed. See PREVIEW APPLY RESULT
below.

Verification:
- `npx tsc --noEmit` — clean.
- `npx vitest run tests/unit/canon-r2-pedagogical-engine.test.ts
  tests/unit/canon-r2r1-engine-contract-closure.test.ts
  tests/unit/canon-r3-shadow-integration.test.ts
  tests/unit/canon-r4-legacy-compatibility.test.ts
  tests/unit/canon-r4r1-pre-v1-learn-baseline.test.ts` — **262 tests, all
  passing** (83 + 53 + 47 + 43 + 36).
- `npx vitest run` (full suite) — **239 test files, 4241 tests, all
  passing** (was 238 files / 4205 tests before this phase — +1 file, +36
  tests, zero regressions).
- `npm run build` — clean.

## FINAL MIGRATION POLICY

Per this phase's own Part 0: only learner-concept relationships that
**already existed at v1 cutover** receive automatic LEARN satisfaction
through migration recognition (`basis: 'LEGACY_MIGRATION_BASELINE'`,
`reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1'`). This is not a
`LEARN_CHECK`, not v1 evidence, not a fabricated score — it is a
persisted recognition record. A learner-concept pair created after
cutover receives no such recognition and must satisfy LEARN through a
real `LEARN_CHECK` scoring strictly above 80%, exactly like any other v1
requirement. The exception is granted **once**, at migration time — it
never re-applies to a later, different concept a student encounters
post-cutover.

## CUTOVER POPULATION DEFINITION

`isPreexistingLearnerConcept(earliestEvidenceAt, cutoverAt)`
(`src/lib/pedagogical-migration/preexisting-learner-concept.ts`) — the
one classification rule: this EXACT (student, concept) pair's own
earliest `learning_evidence` timestamp exists and is strictly before
`cutoverAt`. Never "the concept exists in the content catalog" (Part 5's
own explicit warning) — a pair with zero evidence is never preexisting,
regardless of any enrollment/assignment record. The real Preview query
(`loadPreexistingLearnerConceptPairs`) is a single, read-only
`GROUP BY (student_id, concept_id)` aggregate over `learning_evidence`,
scoped to rows before the cutover.

## DB SCHEMA

`database/migrations/20260915_1000_canon_r4r1_pedagogical_requirement_recognition.sql`
— one new, fully additive table, `pedagogical_requirement_recognition`:
`id` (a deterministic string, never a random UUID — see MIGRATION
RECOGNITION AUTHORITY below), `student_id`, `concept_id`, `requirement`
(checked against the five real stage names), `recognition_basis`
(checked against exactly `LEGACY_MIGRATION_BASELINE` /
`LEGACY_POLICY_RECOGNITION`), `legacy_policy_version`,
`source_evidence_ids` (`UUID[]`), `reason_code`, `recognized_at`,
`migration_version`, `cutover_at`, `created_at`, plus the recommended
`UNIQUE (student_id, concept_id, requirement, migration_version)`
constraint — the mechanical basis of idempotent apply. **Not applied**
in this environment; see MIGRATION SAFETY.

## ENGINE INPUT EXTENSION

The **minimum possible** extension to `PedagogicalEngineInput`
(`src/lib/pedagogical-engine/types.ts`), resolving CANON-R4's own
documented `ENGINE_INTERFACE_EXTENSION_REQUIRED` finding:

```ts
recognizedRequirements?: RecognizedRequirement[];
// RecognizedRequirement { requirement, basis, recognitionId, reasonCode, recognizedAt }
// basis: 'LEGACY_MIGRATION_BASELINE' | 'LEGACY_POLICY_RECOGNITION'
```

Omitting this field — every pre-existing caller and all 226 previously-passing
CANON-R2/R2R1/R3/R4 tests — produces **byte-identical** behavior to
before this extension existed (verified directly: none of those tests
were modified for this reason, and all still pass unmodified). No
`RawEvidenceItem` is ever constructed from a recognition (Test 6/7 —
source-audited directly against `types.ts` and `engine.ts`). No policy
threshold, stage-ordering rule, or difficulty rule was touched — `git
diff --stat -- src/lib/pedagogical-engine/` shows **only additive**
changes (+201/−8 lines across `types.ts`, `engine.ts`, `index.ts`), and
CANONICAL_POLICY itself (`policy.ts`) is byte-for-byte untouched.

**How recognition is consumed** (`replay()` in `engine.ts`): a valid
`recognizedRequirements` set seeds the starting `satisfied`/`basis`
state for each recognized stage **exactly once, before any evidence is
processed** — it is never re-applied mid-replay. Every existing
rollback rule (unchanged from CANON-R2R1) then runs exactly as before
against real evidence; because a rollback resets the same boolean flags
recognition seeded, a later real v1 failure **permanently overrides**
the seeded recognition for the rest of that replay, with zero new
invalidation logic required (see v1 FAILURE PRECEDENCE below).

## RECOGNITION SATISFACTION BASIS

`RequirementResult.satisfactionBasis: 'V1_EVIDENCE' | RecognizedRequirementBasis | null`
— `null` whenever `status !== 'SATISFIED'` (enforced in
`buildRequirementResult`, never stale: a rollback resets both the
boolean and the basis at the same point). `QualifiedEvidenceSummary`
carries the identical field for consistency with its own "same data as
`requirements`" design contract from CANON-R2R1. Test 18 confirms all
three real values (`LEGACY_MIGRATION_BASELINE`, `V1_EVIDENCE`, `null`)
appear correctly for a mixed decision.

## CONTIGUITY

`validateRecognitionSet` (`engine.ts`) accepts only the contiguous
prefixes of `STAGE_ORDER` starting at LEARN (`{}`, `{LEARN}`,
`{LEARN,PRACTICE}`, ...). Any other set — a gap (Test 14/15's own
`LEARN+PROVE` example), or a duplicate requirement — is rejected in its
**entirety**: the decision proceeds exactly as if `recognizedRequirements`
had been omitted, and `CanonicalPedagogicalDecision.recognitionRejected`
names the specific reason (`NON_CONTIGUOUS_RECOGNITION_SET` /
`DUPLICATE_REQUIREMENT_IN_RECOGNITION_SET`) rather than silently
gap-filling or partially applying the set.

## v1 FAILURE PRECEDENCE

The core migration principle — "newer v1 failure/rollback state beats
legacy recognition" — required **zero new invalidation/epoch machinery**.
Recognition seeds the initial boolean state once; every rollback branch
already resets that same boolean (and now also its `basis` companion) to
`false`/`null` on a genuine v1 failure. Since recognition is never
re-consulted after the seed, a stage a rollback has reset can only become
`SATISFIED` again through a **NEW real v1 qualifying attempt** — the
forbidden shortcut ("Retention fail → rollback Prove → legacy Prove
recognition instantly re-satisfies it") is structurally impossible, not
merely policy-discouraged. Tests 19–23 prove this directly: a real v1
Retention failure invalidates a legacy-recognized Prove (Test 19: status
becomes `UNSATISFIED`, not silently re-`SATISFIED`); a subsequent real
v1 Prove is required and opens a **new** retention window anchored to
its own timestamp, never the old recognition's `recognizedAt` (Test 21);
a real v1 Prove failure invalidates legacy-recognized Practice (Test
22); and a Case C critical-misconception Transfer failure rolls all the
way back to PRACTICE even when every requirement was legacy-recognized
(Test 23) — precedence is unconditional, not merely "sometimes."

## LEARN MIGRATION BASELINE

`buildPedagogicalMigrationBaseline` (`src/lib/pedagogical-migration/migration-baseline.ts`)
now accepts `isPreexistingLearnerConcept: boolean` as a **separate**
input from `knowledgeState` (which still drives the unchanged CANON-R4
higher-stage ladder). When true and the higher-stage ladder did not
already grant a stronger, evidence-grounded LEARN recognition, exactly
one `LEGACY_MIGRATION_BASELINE` LEARN recognition is added (Test 1, 5 —
never duplicated even when both paths would independently imply LEARN).
When false, no automatic LEARN recognition is granted regardless of any
other fact (Test 2). Global concept catalog existence has no bearing at
all — the gate is purely per-`(studentId, conceptId)` (Test 3).

## FUTURE CONCEPT BEHAVIOR

A concept first encountered after cutover calls the engine with no
`recognizedRequirements` at all (exactly CANON-R4R1's own Test 25
fixture) — `currentStage` resolves to `LEARN`, `nextCanonicalAction` to
`'LEARN'`, and only a real `LEARN_CHECK` scoring strictly above 80%
(Tests 26–27: 80% fails, 81% passes, unchanged from CANON-R2R1) can ever
satisfy it. No code path in this phase grants an exception to a
post-cutover pair.

## DRY RUN

`scripts/canon-r4r1-pre-v1-learn-baseline.ts` — the population-scale
dry-run/apply tool (default: dry-run, zero writes). Required output
(Part 18): cutover timestamp, migration version, preexisting
learner-concept pair count, proposed LEARN recognition count,
already-existing recognition count, duplicates-skipped count (apply mode
only — a dry-run cannot know this without also computing what WOULD be
inserted, which the tool deliberately does not simulate further than
counting), higher legacy recognition counts (Practice/Prove/Retention/Transfer),
and a bounded sample of affected concept ids (max 10) — no PII, no
student names, no answers, no question text. **Not executed** — no live
DB access in this environment.

## PREVIEW APPLY RESULT

**Not executed.** `applyRecognitions` (`src/lib/pedagogical-migration/recognition-persistence-adapter.ts`)
is built, guarded, and unit-tested for its guard branch (Test 35), but
never actually run against a database in this session. The exact
sequence for a future Preview-connected session is in PREVIEW COMMANDS
below. No recognition rows exist anywhere; no counts to report.

## RADICACIÓN RESULT

**Not executed** — no live Preview/DB access. The exact command is in
PREVIEW COMMANDS. Per Part 21's own instruction ("Do not hardcode this
expected result. Verify from real Preview data"), no result is claimed
here, predicted or otherwise, beyond what CANON-R3/R4's own prior audits
already established structurally: `learning_evidence` has no
`LEARN_CHECK`-equivalent source, so this concept's real dry-run output
will show a `LEGACY_MIGRATION_BASELINE` LEARN recognition (if the pair
predates cutover) and the first unsatisfied v1 requirement will be
whatever the real, unmodified `evaluateLegacyRecognition` ladder
determines from this student's actual `ConceptKnowledgeState` — not
assumed here.

## CONSOLIDATED LEGACY RESULT

**Not executed** — same reason. Engine-level behavior for this case IS
directly verified with synthetic fixtures (Test 13: a fully-recognized
`{LEARN,PRACTICE,PROVE,RETAIN,TRANSFER}` set reaches `CONSOLIDATED`
through one direct engine call), and Test 23 additionally confirms a
real v1 failure can still invalidate a "consolidated" legacy state's
active progression exactly like any other stage. The real Preview
verification (finding an actual `VALIDATED_MASTERY` concept and running
it through the dry-run tool) is documented in PREVIEW COMMANDS, not
executed.

## PARTIAL LEGACY RESULT

**Not executed** — same reason. Engine-level behavior is directly
verified (Test 9–12: Practice/Prove/Retention each individually
recognized and consumed, with the cascading ladder from CANON-R4
unchanged, so a `PROVISIONAL_MASTERY`-only concept never over-recognizes
RETAIN/TRANSFER). Real Preview verification is documented, not run.

## POST-CUTOVER RESULT

**Not executed** — same reason. Engine-level behavior is directly
verified (Test 25–27). Real Preview verification (constructing an
actual post-cutover learner-concept pair and confirming the dry-run tool
grants it nothing) is documented, not run.

## SAFETY

- No historical `learning_evidence` row is ever mutated — Test 34
  (frozen-engine evidence-array immutability, unchanged from every prior
  phase) plus the migration layer's own source audits confirm no
  `UPDATE`/`DELETE` against `learning_evidence` exists anywhere in this
  phase's code.
- The single sanctioned write (`INSERT INTO pedagogical_requirement_recognition`)
  is the **only** write statement anywhere in `src/lib/pedagogical-migration/`
  or either CLI script (Test 34 of the CANON-R4 suite, updated this
  phase to scope its assertion to "no OTHER table is ever written,"
  superseding CANON-R4's original "zero writes anywhere" claim — see
  SUPERSEDED CANON-R4 RULES below).
- `applyRecognitions` independently re-checks `guard.environment === 'preview'`
  and throws otherwise — Test 35, plus a direct source audit.
- The CLI additionally requires **both** `--apply` and `--confirm-preview`
  before calling `applyRecognitions` at all (Test 36 of the CANON-R4
  suite, updated this phase).
- No `--write`/`--apply` flag exists on the read-only dry-run path by
  default; dry-run is the CLI's own default mode.

## PERFORMANCE FIREWALL

No AI/provider, routing, cache, `promptCacheKey`, `reasoning_effort`,
Quality Gate, generation, or retry-topology code is imported or
referenced anywhere in the engine or migration layers this phase (Tests
30–32). Recognition lookup (`loadRecognizedRequirementsForEngine`) is
canonical-state IO only, never on a learner-critical path — it is
reachable only via the standalone CLI scripts.

## ENGINE FREEZE

Not literally frozen this phase — CANON-R4R1 explicitly sanctioned and
required the one minimal input extension (Part 9). What remained frozen:
`CANONICAL_POLICY` (`policy.ts`, byte-for-byte untouched),
`qualifyEvidence` (`evidence-qualification.ts`, untouched), the
difficulty-policy module (untouched — Test 29 re-confirms the same
default `LEARN_UNDERSTANDING_ONLY` reason code), and every existing
rollback rule (untouched — the v1 FAILURE PRECEDENCE guarantee above
falls directly out of the EXISTING rollback code, with zero new
special-casing). Test 28 re-verifies every CANON-R2R1 numeric threshold
directly against the live `CANONICAL_POLICY` object.

## TESTS

`tests/unit/canon-r4r1-pre-v1-learn-baseline.test.ts` — **36 tests**
(35 required by Part 27 + 1 supplementary end-to-end test of
`toEngineRecognizedRequirements`, the pure mapper from a
`MigrationBaseline`'s output into the engine's own input shape).
`tests/unit/canon-r4-legacy-compatibility.test.ts` was additionally
updated (all call sites of `evaluateLegacyRecognition`/
`buildPedagogicalMigrationBaseline` now supply the new required
`migrationVersion`/`isPreexistingLearnerConcept` parameters, with
`isPreexistingLearnerConcept: false` throughout to keep those CANON-R4
tests isolated to the unchanged higher-stage ladder they were written to
verify) plus two intentionally superseded assertions (below).

## SUPERSEDED CANON-R4 RULES

Exactly two, both from the CANON-R4 test suite's Safety section, both
now updated with documented reasoning inline:
1. **"No Production writes -- no INSERT/UPDATE/DELETE statement
   anywhere"** — CANON-R4 had zero write paths at all; CANON-R4R1
   explicitly introduces one sanctioned, guarded, idempotent write
   (Part 19). The test now asserts the real, still-load-bearing
   invariant: any write statement found anywhere in this layer must
   target `pedagogical_requirement_recognition` and nothing else.
2. **"No migration apply path exists in this phase -- no --write/--apply
   flag is parsed anywhere"** — directly superseded by Part 19's own
   requirement. The test now asserts the apply path is properly gated
   (both `--apply` and `--confirm-preview` required; the write function
   itself independently refuses a non-Preview guard) rather than
   asserting it doesn't exist.

## FULL REGRESSION

`npx vitest run` (whole repository): **239 test files, 4241 tests, 0
failures** — up from 238/4205 before this phase (net +1 file, +36
tests). `npx tsc --noEmit` and `npm run build` both clean.

## FILES CHANGED

```
 M scripts/canon-r4-migration-dry-run.ts
 M src/lib/pedagogical-engine/engine.ts
 M src/lib/pedagogical-engine/index.ts
 M src/lib/pedagogical-engine/types.ts
 M src/lib/pedagogical-migration/index.ts
 M src/lib/pedagogical-migration/legacy-recognition.ts
 M src/lib/pedagogical-migration/migration-baseline.ts
 M src/lib/pedagogical-migration/types.ts
 M tests/unit/canon-r4-legacy-compatibility.test.ts
?? database/migrations/20260915_1000_canon_r4r1_pedagogical_requirement_recognition.sql
?? scripts/canon-r4r1-pre-v1-learn-baseline.ts
?? src/lib/pedagogical-migration/preexisting-learner-concept.ts
?? src/lib/pedagogical-migration/recognition-persistence-adapter.ts
?? src/lib/pedagogical-migration/to-engine-recognized-requirements.ts
?? tests/unit/canon-r4r1-pre-v1-learn-baseline.test.ts
?? docs/CANON_R4R1_PRE_V1_LEARN_BASELINE.md
```

`src/lib/pedagogical-shadow/**` — untouched (`git diff --stat` empty,
confirmed above), preserving CANON-R3's own isolation guarantee.

## DB CHANGES

**None applied.** The migration file above is written, reviewed, and
ready; `npm run db:migrate` was never run in this session (no
`DATABASE_URL`). No recognition rows exist anywhere.

## PREVIEW COMMANDS

Once a future session has real Preview DB access:

```bash
# 1. Apply the additive schema (Preview only)
npm run db:migrate

# 2. MANDATORY dry-run first -- zero writes
npx tsx --env-file=.env.local scripts/canon-r4r1-pre-v1-learn-baseline.ts \
  --migration-version studyus-canonical-v1-initial-migration \
  --cutover <reviewed-and-approved-preview-cutover-iso-timestamp>

# 3. Only after reviewing step 2's output:
npx tsx --env-file=.env.local scripts/canon-r4r1-pre-v1-learn-baseline.ts \
  --migration-version studyus-canonical-v1-initial-migration \
  --cutover <same-iso-timestamp> \
  --apply --confirm-preview

# 4. Verify counts, then inspect individual cases:
npx tsx --env-file=.env.local scripts/canon-r4-migration-dry-run.ts \
  --student <uuid> --concept <radicacion-concept-uuid> \
  --migration-version studyus-canonical-v1-initial-migration --cutover <same-iso-timestamp>
```

Repeat step 4 for a real `VALIDATED_MASTERY` concept (consolidated
case), a real `PROVISIONAL_MASTERY`-only concept (partial case), and a
synthetic post-cutover pair (future-concept case), per Part 29's own
mandatory sequence.

## PRODUCTION MIGRATION PLAN

Not applicable. No Production cutover timestamp is chosen or proposed
anywhere in this phase's code or this report — `cutoverAt` remains an
explicit, human-supplied argument with no default. Production migration
requires, at minimum: the Preview sequence above completed and reviewed,
the four representative cases (Radicación, consolidated, partial,
post-cutover) verified against real data, and explicit human sign-off —
none of which is proposed as scheduled or imminent here.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `feat(canon-r4r1): recognized-requirements engine interface + pre-v1
   LEARN baseline` — the minimal engine input extension, the migration
   layer additions, the schema file, and both test files.
2. `docs(canon-r4r1): pre-v1 learn baseline report` — this document.

No file inside `src/lib/pedagogical-shadow/` is touched by either
commit.
