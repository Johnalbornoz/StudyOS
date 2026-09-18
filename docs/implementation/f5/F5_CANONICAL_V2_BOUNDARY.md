# F5 — Canonical V2 Boundary

## The rule (task §30, non-negotiable)

**Canonical V2 decides**: pedagogical stage, requirement eligibility, next-action requirements,
PROVE, RETAIN, TRANSFER progression — via `src/lib/pedagogical-engine`/`pedagogical-decision`
exclusively.

**F5 decides/derives**: analytical learner state only — Knowledge evidence summary/
explainability, Skill evidence summary, Competency evidence summary, Transfer analytical
(context-diversity) summary.

**If any code path lets F5 override Canonical V2, the phase fails** — this document exists to
make the boundary auditable, not just asserted.

## Why this is structurally true, not just a convention

The assessment (§9) already established that Canonical V2 does not read
`concept_knowledge_state`, `mastery_records`, `concept_memory_state`, or `concept_transfer_state`
for its progression decisions — it consumes raw `learning_evidence` directly through
`pedagogical-shadow/evidence-adapter.ts` and its own `evidence-qualification.ts`. F5's three new
tables (`learner_skill_state`, `learner_competency_state`, `learner_transfer_analytics`) are
therefore **already outside Canonical V2's read set by construction** — the same way F4's
canonical catalog tables were already outside it. F5 adds no new column to `learning_evidence`
that Canonical V2's adapter reads (the three new `metadata` fields — `skillIds`, `competencyIds`,
`contextCode` — are additive keys Canonical V2's adapter never looks at).

## What F5 does NOT do (explicit negative proof, task §26/§30)

- F5 never writes to `pedagogical_requirement_recognition`, `canonical_prepared_activity`,
  `concept_transfer_state`, or any table Canonical V2 itself owns.
- F5 never calls `qualifyEvidence`, `evaluateCanonicalLearningState`, or
  `rebuildConceptCanonicalState`.
- F5's projectors never throw in a way that could abort `updateMastery`'s transaction before the
  evidence row and Knowledge State recalculation commit (target architecture's fail-soft design).
- No F5 API route or service function computes or returns a PRACTICE/PROVE/RETAIN/TRANSFER
  verdict — every F5 read endpoint returns only `NO_EVIDENCE`/`INSUFFICIENT_EVIDENCE`/
  `EMERGING`/`CONSISTENT_INDEPENDENT` or raw counters, vocabulary that does not exist anywhere in
  Canonical V2's own type system (verified: these four strings do not appear in
  `pedagogical-engine/types.ts`).

## Regression proof

The complete Canonical V2 test suite (~40 files) is re-run unmodified after F5's implementation
and must produce byte-identical PRACTICE/PROVE/RETAIN/TRANSFER verdicts on the same fixtures —
see the QA report for the actual run. Any new Evidence created by F5's own certification fixtures
uses the standard `updateMastery` path and is expected, per task §31, to be reflected in Canonical
V2's own evidence stream exactly as any other evidence would be — this is not a violation of the
boundary, since Canonical V2 already owns interpreting raw evidence; F5 does not add a competing
interpretation of the *same* evidence for progression purposes.

## Structural test

`f5-canonical-v2-noninterference.test.ts` extends the F3/F4 non-interference pattern: no F5 file
imports `pedagogical-engine`/`pedagogical-decision`/`pedagogical-shadow`/`pedagogical-migration`;
no F5 file writes to any Canonical-V2-owned table; no F5 file exposes a
PRACTICE/PROVE/RETAIN/TRANSFER-shaped verdict.
