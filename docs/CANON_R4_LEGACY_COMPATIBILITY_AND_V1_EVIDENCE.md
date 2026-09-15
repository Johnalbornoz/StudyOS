# CANON-R4 — LEGACY COMPATIBILITY & v1 EVIDENCE CAPTURE

## STATUS

**CODE_PASS** (not "LIVE PASS" — no live browser/DB/auth/AI-provider access
in this environment, confirmed absent again this phase). The migration
recognition authority, baseline builder, versioning mechanism, engine
interface-gap composition, and future v1 evidence capture contracts are
built, unit-tested against synthetic fixtures, and type/build clean.
**No live Preview migration dry-run — including the mandatory Radicación,
consolidated, partial, and failed-history cases — was executed**, because
no DB connection exists in this session. The "PREVIEW COMMANDS" section
gives the exact, ready-to-run commands for a future Preview-connected
session.

Verification:
- `npx tsc --noEmit` — clean.
- `npx vitest run tests/unit/canon-r2-pedagogical-engine.test.ts
  tests/unit/canon-r2r1-engine-contract-closure.test.ts
  tests/unit/canon-r3-shadow-integration.test.ts
  tests/unit/canon-r4-legacy-compatibility.test.ts` — **226 tests, all
  passing** (83 + 53 + 47 + 43).
- `npx vitest run` (full suite) — **238 test files, 4205 tests, all
  passing** (was 237 files / 4162 tests before this phase — +1 file, +43
  tests, zero regressions).
- `npm run build` — clean.

## APPROVED MIGRATION POLICY

Per this phase's own frozen instruction: historical achievements validly
earned under the pedagogical policy in force at the time **may be
RECOGNIZED** during migration; they must **never be fabricated or
rewritten as v1 evidence**. All evidence produced after v1 cutover must
strictly satisfy `studyus-canonical-v1`. This report and its code treat
that distinction — `LEGACY VALID ACHIEVEMENT ≠ FAKE v1 EVIDENCE` — as
load-bearing throughout.

## ARCHITECTURAL BOUNDARY

```
LEGACY EVIDENCE
      ↓
LEGACY COMPATIBILITY POLICY   (src/lib/pedagogical-migration/legacy-recognition.ts)
      ↓
MIGRATION BASELINE            (src/lib/pedagogical-migration/migration-baseline.ts)
      ↓
[ frozen PEDAGOGICAL ENGINE v1, run unmodified on real evidence only ]
      ↓
EFFECTIVE MIGRATED DECISION   (src/lib/pedagogical-migration/effective-decision.ts,
                                composed OUTSIDE the engine call)
```

`git diff --stat -- src/lib/pedagogical-engine/ src/lib/pedagogical-shadow/`
for this phase: **empty** — both the frozen engine and the CANON-R3
shadow layer are byte-for-byte untouched. `src/lib/pedagogical-migration/`
is an entirely new, separate directory.

## LEGACY EVIDENCE CLASSIFICATION

Every piece of evidence is exactly one of:
- `V1_EVIDENCE` — a real `RawEvidenceItem` that the frozen engine's own
  `qualifyEvidence` accepted.
- `LEGACY_POLICY_RECOGNITION` — a `RequirementRecognition` record, never
  a fabricated evidence row, grounded in the OLD canonical model's own
  already-computed authority (`ConceptKnowledgeState` +
  `MasteryPolicy`) rather than raw activity existence.

These two bases are kept structurally distinct in the type system
(`QualificationBasis`) — never merged into a single "satisfied" boolean
with no way to tell which kind of satisfaction produced it (Part 18).

## POLICY VERSIONING

`classifyEvidenceVersion(timestamp, policy)`
(`src/lib/pedagogical-migration/policy-version.ts`) is the one versioning
mechanism. With `policy.cutoverAt === null` — **the only value this
phase ever configures** (`UNCONFIGURED_MIGRATION_POLICY`) — every
timestamp, including one arbitrarily far in the future, classifies
`LEGACY_UNVERSIONED` (Tests 16–17). No historical row is ever
automatically labeled `studyus-canonical-v1`; the mechanism exists and is
fully tested, but is not switched on.

## CUTOVER MODEL

`MigrationPolicy { cutoverAt: string | null }`. Per this phase's own
instruction ("Do not choose the Production cutover timestamp yet if
deployment has not been approved"), no cutover date is chosen or
proposed here — only the mechanism (`classifyEvidenceVersion`,
`isTemporallyEligibleForV1`) is implemented and tested with a synthetic
cutover date (Tests 18–20, 23) to prove it works deterministically once a
human does set one. `isTemporallyEligibleForV1` is explicitly documented
as answering only the TEMPORAL half of v1 compliance — it deliberately
does not import anything from the frozen engine, so a caller can never
mistake "administered after cutover" for "actually satisfies the v1
activity contract" (those are independently, and separately, enforced by
`qualifyEvidence` itself).

## MIGRATION RECOGNITION AUTHORITY

`evaluateLegacyRecognition({knowledgeState, masteryPolicy,
recognizedAtMigration})` (`src/lib/pedagogical-migration/legacy-recognition.ts`)
is the ONE authority — never scattered across Today/Concept Mission/
Results/routes/UI. It is grounded entirely in the OLD model's own
already-computed dimension scores and thresholds (the same fields
`determineMasteryState`/`determineValidationReadiness` already use),
never re-derived from raw evidence rows. Recognition is a **strict,
cascading ladder** — PROVE requires PRACTICE already recognized, RETAIN
requires PROVE, TRANSFER requires RETAIN — so an isolated dimension
spike (one lucky independent question with no real foundational
understanding) can never grant a higher requirement without the
foundational ones actually holding (Test 12).

## LEARN LEGACY POLICY

LEARN is recognized **only** as an implication of a legitimately-reached
higher stage (`practiceRecognized`) — never from raw activity existence,
and never from a failed Practice or premature Transfer attempt alone
(Tests 1, 3). No `LEARN_CHECK` evidence row is ever inserted;
`RequirementRecognition` records the recognition explicitly, with
`reasonCode: 'LEGACY_HIGHER_STAGE_IMPLIES_LEARN'` (Tests 2, 8).

## PRACTICE LEGACY POLICY

Recognized only when the OLD model's own evidence-sufficiency gate
(`evidenceCount >= minimumEvidenceCount`) AND understanding-dimension
threshold (`understandingScore >= minimumUnderstanding`) both legitimately
passed — the exact bar `determineMasteryState` itself uses before ever
leaving `'LEARNING'`. Never "any Practice row exists" or "highest score
happened to exceed a threshold" in isolation (Tests 3–4).

## PROVE LEGACY POLICY

Recognized only when PRACTICE is already recognized AND the OLD model's
own independence dimension (`independenceScore >= minimumIndependence`)
legitimately passed — regardless of whether the underlying historical
attempt used 6 questions or 10 (Test 5). The recognition record itself
carries no `itemCount` field at all (Test 6) — it is not, and never
becomes, a fake 10-question evidence row.

## RETENTION LEGACY POLICY

Recognized only when PROVE is already recognized AND the OLD model's own
(Phase 6-sourced) retention dimension legitimately passed (Test 7),
again without ever fabricating a 10-question row or altering the
original score/timestamp (Test 8).

## TRANSFER LEGACY POLICY

Recognized only when RETAIN is already recognized AND the OLD model's
own strongest, fully-validated state (`masteryState === 'VALIDATED_MASTERY'`,
with application and transfer dimensions also passing) held — never
inferred from Transfer evidence existing alone, and never from a failed
or premature Transfer attempt (Tests 9–10). This directly implements the
approved conservative policy: **a legacy-consolidated concept preserves
that achievement; a legacy-non-consolidated concept gets no free v1
Transfer satisfaction merely because old Transfer attempts exist.**

## CONSOLIDATED LEGACY POLICY

A concept whose OLD model reports `VALIDATED_MASTERY` recognizes all
five requirements at once (LEARN through TRANSFER) — Test 11 confirms
the full ladder (`['LEARN','PRACTICE','PROVE','RETAIN','TRANSFER']`) is
produced for exactly this case, and no other.

## MIGRATION BASELINE

`buildPedagogicalMigrationBaseline({conceptId, knowledgeState,
masteryPolicy, recognizedAtMigration, oldStateReadFailed?})`
(`src/lib/pedagogical-migration/migration-baseline.ts`) composes
`evaluateLegacyRecognition`'s output into `{recognizedRequirements,
unresolvedRequirements, warnings, sourceEvidenceIds, category}` and
classifies into exactly one of the nine `MigrationCategory` values (Part
39). Pure, deterministic (Test 14), and idempotent by construction (Test
15 — no internal state, no side effects; the same input always produces
a structurally identical, non-duplicated baseline).

## ENGINE INTERFACE COMPATIBILITY

**DOCUMENTED FINDING (Part 21):** `PedagogicalEngineInput`
(`src/lib/pedagogical-engine/types.ts`, frozen) has **no primitive** for
"this requirement is already satisfied, but not by a `RawEvidenceItem`."
`qualifyEvidence` is the ONLY path to `SATISFIED` for any requirement —
there is no `recognizedPrerequisites`-shaped field, and adding one would
be a genuine v1 semantics change, exactly what the Engine Freeze Rule
forbids doing silently in this phase.

Per that rule's own instruction, this phase **stops at the engine's real
boundary** rather than injecting fabricated rows:
`composeEffectiveMigratedDecision` (`src/lib/pedagogical-migration/effective-decision.ts`)
never constructs a fake `RawEvidenceItem` and never calls
`evaluateCanonicalLearningState` with anything but real evidence. It
runs the frozen engine completely normally (on real evidence only —
likely none, for most concepts, before cutover), then combines that
untouched decision with a separately-computed `MigrationBaseline`
**entirely outside and after** the engine call. Every result carries
`engineInterfaceNote: 'ENGINE_INTERFACE_EXTENSION_REQUIRED'` — the
permanent label for this gap, and the supplementary end-to-end test
confirms the composition changes the *effective* starting stage
(`RETAIN` in that fixture) while the engine's own raw decision stays
untouched (`LEARN`, from zero real evidence).

**This is a certification-relevant finding, not a defect**: a future,
narrowly-reviewed phase (candidate name: CANON-R4R1) could propose an
actual engine input extension for recognized prerequisites — that
decision is explicitly **not** made here.

## NEW LEARN EVIDENCE CAPTURE

`V1LearnCheckCapture` (`src/lib/pedagogical-migration/new-evidence-capture-contract.ts`)
— `policyVersion`, `scorePercent`, `itemCount`, `correctCount`,
`assistanceType`, `hintsUsed`, `timestamp`, `difficulty`. A pure data
contract; not wired into any route.

## NEW PRACTICE EVIDENCE CAPTURE

`V1PracticeCapture` — the same core fields plus optional
`hasCriticalMisconception` (only ever set from a real, authoritative
per-attempt misconception link, never inferred from score).

## NEW PROVE EVIDENCE CAPTURE

`V1ProveCapture` — `itemCount: 10` (typed as the literal, not a general
`number`, so a future implementation cannot accidentally satisfy the
type with a wrong count), `independent: true`, explicit
`evidenceContract: 'PROVE_NO_HINTS_NO_TUTOR_NO_WORKED_EXAMPLES'`.

## NEW RETENTION EVIDENCE CAPTURE

`V1RetentionCapture` — `itemCount: 10`, `novel: true`, optional
`qualifyingProveEvidenceId`/`nextEligibleAtWhenAdministered` for
traceability (explicitly documented as non-authoritative — the frozen
engine re-derives eligibility itself from the ledger's own qualifying
Prove timestamp; this is not a second source of truth).

## NEW TRANSFER EVIDENCE CAPTURE

`V1TransferCapture` — `challenges: [V1TransferChallengeCapture x3]`, each
carrying its own `depth` (the frozen engine's own `TransferChallengeDepth`
type) and `scorePercent`, plus `overallScorePercent` and optional
`transferFoundationalFailureIndicated`. This directly answers CANON-R3's
own "never fabricate a 3-challenge breakdown" finding by specifying
exactly what a future real capture path must store instead.

## ITEM COUNT

CANON-R3 found `learning_evidence` has no durable item-count column. This
phase's capture contract makes `itemCount` a first-class, explicit field
on every stage's capture type (Learn/Practice/Prove/Retention) — a
future schema change (documented, not applied — see below) would add it
as a real column on the pedagogical evidence ledger itself, never leaving
it recoverable only by joining an unrelated operational audit trail
(`decision_events`).

## TRANSFER CHALLENGE STORAGE

Documented, additive schema direction (NOT written to
`database/migrations/`, and NOT applied — see MIGRATION SAFETY below):

```sql
-- PROPOSAL ONLY -- not applied, not committed to database/migrations/.
-- Additive, backward-compatible, nullable/default-safe, non-destructive.
ALTER TABLE learning_evidence
  ADD COLUMN IF NOT EXISTS pedagogical_policy_version text,
  ADD COLUMN IF NOT EXISTS item_count integer,
  ADD COLUMN IF NOT EXISTS correct_count integer,
  ADD COLUMN IF NOT EXISTS independent boolean,
  ADD COLUMN IF NOT EXISTS transfer_challenges jsonb; -- [{depth, scorePercent, reasoningProvided?}, ...]

CREATE TABLE IF NOT EXISTS pedagogical_requirement_recognition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  concept_id uuid NOT NULL,
  requirement text NOT NULL,
  recognition_basis text NOT NULL DEFAULT 'LEGACY_POLICY_RECOGNITION',
  legacy_policy_version text NOT NULL DEFAULT 'LEGACY_UNVERSIONED',
  source_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  reason_code text NOT NULL,
  recognized_at timestamptz NOT NULL DEFAULT now(),
  migration_version text NOT NULL,
  UNIQUE (student_id, concept_id, requirement, migration_version)
);
```

The `UNIQUE` constraint is the concrete mechanism that would make a real
apply-mode migration idempotent (Part 32) — re-running it against the
same `migration_version` label would conflict-and-skip rather than
duplicate. This proposal is deliberately not implemented as a real
migration file in this phase (see MIGRATION SAFETY).

## POLICY VERSION STORAGE

`pedagogical_policy_version` (proposed column, above) would carry either
`'studyus-canonical-v1'` or `'LEGACY_UNVERSIONED'` per row, written by a
future real capture path using `classifyEvidenceVersion` at write time —
never backfilled onto existing rows (Part 3: "Do NOT backfill legacy rows
with v1").

## SHADOW COMPARATOR EXTENSION

`compareWithAndWithoutMigrationBaseline` (`src/lib/pedagogical-migration/migration-shadow-comparison.ts`)
composes CANON-R3's own `compareCanonicalDecisions` **twice** against the
same OLD snapshot — once against the engine's raw decision, once against
the migration-aware effective decision — and reports
`migrationExplainsDisagreement: boolean`. `src/lib/pedagogical-shadow/comparator.ts`
itself is untouched (confirmed above).

## DRY RUN TOOL

`scripts/canon-r4-migration-dry-run.ts` — read-only, no `--write`/`--apply`
flag exists anywhere in this phase's code (Test 36). For each concept it
prints: OLD canonical state, proposed recognitions per requirement, the
resulting `MigrationCategory`, the effective v1 starting stage, and any
warnings. Not executed in this environment (no DB access) — see PREVIEW
COMMANDS.

## RADICACIÓN PLAN

**Not executed — no live Preview/DB access.** Plan, ready to run once
access exists:

```bash
npx tsx --env-file=.env.local scripts/canon-r4-migration-dry-run.ts \
  --student <uuid> --concept <radicacion-concept-uuid>
```

Based on the reported history (`TRANSFER 0%, PRACTICE 0%, PRACTICE 0%,
PRACTICE 33%`), the recognition ladder's own logic predicts (a
prediction, not a claimed live result): `understandingScore` from three
mostly-failing Practice attempts is very unlikely to legitimately clear
`minimumUnderstanding`, so `PRACTICE` — and therefore everything above it
— should NOT be recognized; the premature `TRANSFER 0%` row grants
nothing regardless (Part 16 — a failed/premature Transfer is history
only). The expected dry-run category is `INSUFFICIENT_LEGACY_EVIDENCE`,
with the first unsatisfied v1 requirement after migration remaining
`PRACTICE`. **This must be verified live, not assumed.**

## MIGRATION SAFETY

- No `database/migrations/*.sql` file was added this phase. The proposed
  schema (above) is deliberately kept OUT of that directory — `npm run
  db:migrate` applies every pending `.sql` file it finds there
  automatically once a human runs it, and this phase's own instruction
  ("Do not run Production migration") means a draft sitting in that real,
  auto-discovered directory is a live risk, not a neutral placeholder.
- No historical row is mutated, no row is inserted, anywhere in this
  phase's code (Tests 33–34: no `INSERT`/`UPDATE`/`DELETE` keyword in any
  file under `src/lib/pedagogical-migration/` or either CLI script).
- The dry-run CLI is read-only by construction (Test 35); no apply-mode
  path exists to gate in the first place (Test 36).

## PERFORMANCE FIREWALL

No AI provider, routing, prompt cache, `reasoning_effort`, Quality Gate,
generation, or retry-topology code is imported or referenced anywhere in
this phase (Tests 39–41). Migration logic runs only via the standalone
CLI, never on any learner request path.

## ENGINE FREEZE

`git diff --stat -- src/lib/pedagogical-engine/`: **empty**. Test 21
additionally re-verifies directly against the live, unmodified engine
that a 6-question historical Retention attempt still does NOT satisfy
v1's exact-10 policy regardless of migration context; Test 22 confirms
`CANONICAL_POLICY.transfer.challengeCount` is still 3.

## TESTS

`tests/unit/canon-r4-legacy-compatibility.test.ts` — **43 tests**: Legacy
Recognition (Part 47, 15 tests), Versioning (Part 48, 8 tests), New
Capture Contract (Part 49, 8 tests), Safety (Part 50, 10 tests), plus 2
end-to-end composition tests (migration-recognized effective starting
state; a live critical misconception still blocking advancement despite
full legacy recognition).

## FULL REGRESSION

`npx vitest run` (whole repository): **238 test files, 4205 tests, 0
failures** — up from 237/4162 before this phase (net +1 file, +43
tests). `npx tsc --noEmit` and `npm run build` both clean.

## FILES CHANGED

```
?? scripts/canon-r4-migration-dry-run.ts
?? src/lib/pedagogical-migration/effective-decision.ts
?? src/lib/pedagogical-migration/index.ts
?? src/lib/pedagogical-migration/legacy-recognition.ts
?? src/lib/pedagogical-migration/migration-baseline.ts
?? src/lib/pedagogical-migration/migration-shadow-comparison.ts
?? src/lib/pedagogical-migration/new-evidence-capture-contract.ts
?? src/lib/pedagogical-migration/policy-version.ts
?? src/lib/pedagogical-migration/types.ts
?? tests/unit/canon-r4-legacy-compatibility.test.ts
?? docs/CANON_R4_LEGACY_COMPATIBILITY_AND_V1_EVIDENCE.md
```

`src/lib/pedagogical-engine/**` and `src/lib/pedagogical-shadow/**` —
untouched (confirmed above).

## PREVIEW COMMANDS

Once a future session has real Preview DB access:

```bash
# Radicación — the mandatory first case
npx tsx --env-file=.env.local scripts/canon-r4-migration-dry-run.ts \
  --student <student-uuid> --concept <radicacion-concept-uuid>

# All concepts for one student -- surface consolidated/partial/failed cases from real data
npx tsx --env-file=.env.local scripts/canon-r4-migration-dry-run.ts \
  --student <student-uuid> --all-concepts
```

From the `--all-concepts` output, identify (per Parts 35–37, not
fabricated here):
- a concept the old model reports `VALIDATED_MASTERY` → confirms the
  CONSOLIDATED LEGACY CASE preserves full recognition;
- a concept with `PROVISIONAL_MASTERY` and a passing independence
  dimension but no retention dimension yet → confirms the PARTIALLY
  COMPLETED case recognizes only up through PROVE, never further;
- a concept dominated by failed/low-score evidence → confirms the FAILED
  LEGACY CASE produces `INSUFFICIENT_LEGACY_EVIDENCE` with zero
  artificial progression.

Every invocation above is read-only.

## PRODUCTION MIGRATION PLAN

Not applicable yet. No schema change has been applied; no cutover date
has been chosen; no apply-mode migration exists. When that time comes:
the proposed schema (above) would ship as an additive-only migration in
`database/migrations/`, reviewed and applied only after the dry-run has
been run against real Preview data across the four representative cases
above and a human has signed off — never automatically, never bundled
into this or any other code phase's commit.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `feat(canon-r4): legacy compatibility and v1 evidence capture
   contracts` — the new `src/lib/pedagogical-migration/` module, the
   dry-run CLI, and the test file.
2. `docs(canon-r4): legacy compatibility and v1 evidence report` — this
   document.

No file inside `src/lib/pedagogical-engine/` or `src/lib/pedagogical-shadow/`
is touched by either commit.
