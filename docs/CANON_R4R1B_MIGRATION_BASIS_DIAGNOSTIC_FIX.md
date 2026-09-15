# CANON-R4R1B — MIGRATION BASIS DIAGNOSTIC FIX

## STATUS

**CODE_PASS.** This is a diagnostic/reporting-only fix — no engine
semantics, no DB writes, no persisted schema, and no recognition
row changed. Verified: `npx tsc --noEmit` clean; the two directly
affected test suites plus the full suite all pass; `npm run build`
clean.

- `npx vitest run tests/unit/canon-r4r1b-migration-basis-diagnostic-fix.test.ts` — **8/8 passing**.
- `npx vitest run tests/unit/canon-r4r1-pre-v1-learn-baseline.test.ts tests/unit/canon-r4r1a-preexisting-concept-population-fix.test.ts` — **63/63 passing**, unmodified.
- `npx vitest run` (full suite) — **241 test files, 4276 tests, all passing** (was 240/4268 before this phase — +1 file, +8 tests, zero regressions).
- `npm run build` — clean.

## ROOT CAUSE

`composeEffectiveMigratedDecision`
(`src/lib/pedagogical-migration/effective-decision.ts`) computed each
requirement's diagnostic `basis` with:

```ts
basis: satisfiedByV1Evidence ? 'V1_EVIDENCE' : satisfiedByLegacyRecognition ? 'LEGACY_POLICY_RECOGNITION' : null,
```

`satisfiedByLegacyRecognition` was a plain **boolean** (`recognizedSet.has(requirement)`)
— membership in a `Set<PedagogicalStage>` built from
`migrationBaseline.recognizedRequirements.map((r) => r.requirement)`. The
function never looked at each recognition's own `.basis` field — it
unconditionally hardcoded the string literal `'LEGACY_POLICY_RECOGNITION'`
for **any** legacy-satisfied requirement, silently discarding whether the
real, persisted recognition record actually said
`LEGACY_MIGRATION_BASELINE` (CANON-R4R1's one-time preexisting-pair LEARN
grant) or `LEGACY_POLICY_RECOGNITION` (CANON-R4's old-policy dimension
ladder).

A contributing factor: `QualificationBasis`
(`src/lib/pedagogical-migration/types.ts`) — the type
`EffectiveRequirementView.basis` is declared against — was itself too
narrow: `'V1_EVIDENCE' | 'LEGACY_POLICY_RECOGNITION'`, predating CANON-R4R1's
introduction of `LEGACY_MIGRATION_BASELINE` as a real, distinct basis
value on the engine's own `RecognizedRequirementBasis` type. The type
system could not have caught the bug even if the code had tried to pass
the real value through, since `LEGACY_MIGRATION_BASELINE` was not a
member of `QualificationBasis` at all.

## INCORRECT OUTPUT

For the real Preview row (student
`ec77cac5-841c-41cc-b959-af8ec69ccec5`, concept
`1fb2b93c-0909-4127-9854-a91379825661`), `scripts/canon-r4-migration-dry-run.ts`'s
`perRequirement` diagnostic reported:

```json
{ "requirement": "LEARN", "satisfied": true, "basis": "LEGACY_POLICY_RECOGNITION" }
```

## CORRECT DB VALUE

The actual, correctly-persisted row (unaffected by this bug — the
migration itself was always correct):

```
recognition_basis = LEGACY_MIGRATION_BASELINE
reason_code       = PREEXISTING_LEARNER_CONCEPT_BEFORE_V1
```

The engine's own `effectiveV1StartingState = PRACTICE` was **also
already correct** (the `satisfied`/`effectiveStage` computation never
depended on the mislabeled `basis` string) — this confirms the bug was
confined entirely to one diagnostic field, never to any decision logic.

## EXACT CODE FIX

`effective-decision.ts`: replaced the membership-only `Set` with a
`Map<requirement, RequirementRecognition>` keyed by requirement, so the
recognition's own real `.basis` field is read and passed through
verbatim instead of being replaced by a hardcoded literal:

```ts
// before
const recognizedSet = new Set(migrationBaseline.recognizedRequirements.map((r) => r.requirement));
...
basis: satisfiedByV1Evidence ? 'V1_EVIDENCE' : satisfiedByLegacyRecognition ? 'LEGACY_POLICY_RECOGNITION' : null,

// after
const recognitionByRequirement = new Map(migrationBaseline.recognizedRequirements.map((r) => [r.requirement, r]));
...
const legacyRecognition = recognitionByRequirement.get(requirement);
...
basis: satisfiedByV1Evidence ? 'V1_EVIDENCE' : legacyRecognition ? legacyRecognition.basis : null,
```

`types.ts`: widened `QualificationBasis` to include
`'LEGACY_MIGRATION_BASELINE'`, matching the engine's own
`RecognizedRequirementBasis` union so this class of silent narrowing can
no longer happen for either legacy basis value:

```ts
export type QualificationBasis = 'V1_EVIDENCE' | 'LEGACY_MIGRATION_BASELINE' | 'LEGACY_POLICY_RECOGNITION';
```

`V1_EVIDENCE` still takes priority when a requirement is satisfied by
BOTH real engine evidence and a legacy recognition (Test 3) — that
precedence was already correct and is unchanged; only the previously-mislabeled
legacy branch was fixed.

## REGRESSION TESTS

`tests/unit/canon-r4r1b-migration-basis-diagnostic-fix.test.ts` — 8
tests, all passing:
1. `LEGACY_MIGRATION_BASELINE` preserved verbatim (the exact bug).
2. `LEGACY_POLICY_RECOGNITION` remains distinct, never conflated.
3. `V1_EVIDENCE` still takes priority over a co-existing legacy
   recognition.
4. `null` stays `null` for a genuinely unrecognized/unsatisfied
   requirement.
5. `effectiveStage` is unchanged by this reporting-only fix.
6. The exact Radicación-shaped fixture (real student/concept ids)
   resolves: LEARN satisfied via `LEGACY_MIGRATION_BASELINE`, PRACTICE
   unsatisfied, effective stage `PRACTICE`.
7. Source audit: no `src/lib/pedagogical-engine/` file references the
   migration layer at all.
8. Source audit: the persistence adapter and schema file are unchanged
   (exactly one CANON-R4R1 migration `.sql` file still exists; the
   adapter's own SELECT/CREATE TABLE text is intact).

## FILES CHANGED

```
 M src/lib/pedagogical-migration/effective-decision.ts
 M src/lib/pedagogical-migration/types.ts
?? tests/unit/canon-r4r1b-migration-basis-diagnostic-fix.test.ts
?? docs/CANON_R4R1B_MIGRATION_BASIS_DIAGNOSTIC_FIX.md
```

`src/lib/pedagogical-engine/**`, `src/lib/pedagogical-shadow/**`,
`database/**`, and `src/lib/pedagogical-migration/recognition-persistence-adapter.ts`
(the persistence adapter itself) are all untouched — confirmed directly
via `git diff --stat` (both engine and shadow diffs empty) and Tests
7–8.

## CONFIRMATION: ENGINE/DB SEMANTICS UNTOUCHED

- No pedagogical engine policy, rollback rule, contiguity rule, or
  output-contract field changed — `git diff --stat -- src/lib/pedagogical-engine/`
  is empty.
- No DB row was read, written, or migrated — this fix touches only
  in-memory TypeScript composition and type declarations; no file
  importing `@/lib/db` was modified.
- No new migration file was added or altered — exactly one
  `canon_r4r1_*` schema file still exists, unchanged.
- `recognizedRequirements` engine-input semantics (CANON-R4R1),
  Practice/Prove/Retention/Transfer legacy recognition (CANON-R4), and
  the preexisting-learner-concept population source (CANON-R4R1A) are
  all unchanged — this fix corrects only how an ALREADY-correct
  recognition's basis is labeled in one downstream diagnostic
  composition function.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `fix(canon-r4r1b): preserve real recognition basis in migration
   diagnostic composition` — the two-file fix and the new test file.
2. `docs(canon-r4r1b): migration basis diagnostic fix report` — this
   document.
