# F4 — Canonical V2 Compatibility Report

## Finding (from the current-architecture assessment)

Canonical V2 (`src/lib/pedagogical-engine`, `src/lib/pedagogical-decision`) treats `conceptId`
and `studentId` as wholly opaque strings, always required as a pair, never independently, never
used to look up a name/label, never compared across students. The ownership gate it depends on,
`resolveConceptSubjectForStudent`, resolves `(conceptId, studentId) → subjectId` via
`concepts JOIN subjects`.

## What F4 changes here

**Nothing.** `concepts`, `subjects`, and `resolveConceptSubjectForStudent` are byte-for-byte
unmodified by this phase (verified structurally in `f4-canonical-v2-noninterference.test.ts` and
empirically — the full Canonical V2 test suite, 36 files / 806 tests, passes unmodified in this
same branch).

## Compatibility boundary (explicit, per task §16)

No compatibility boundary needed to be introduced this phase, because F4 never asks Canonical V2
to accept, return, or reason about a `canonical_concept_id`. The correspondence layer
(`concept_catalog_mapping`) is entirely outside Canonical V2's call graph — nothing in
`pedagogical-engine`/`pedagogical-decision` imports from, or is imported by, `src/lib/catalog`
(verified structurally).

If a future phase wants Canonical V2-aware canonical reporting (e.g. "show mastery aggregated
by canonical concept across a learner's several per-subject concept instances of it"), that is a
new, explicit compatibility boundary to design then — most likely a read-only join at the
reporting layer (`concept_catalog_mapping.canonical_concept_id` alongside
`concept_knowledge_state`), never a change to the engine's own opaque-id contract. This is named
here as a candidate for F5+ scope, not started in F4 (INV-F4-01).

## Regression evidence

```
npx vitest run tests/unit/canon-*.test.ts tests/unit/audit-canon-v2-*.test.ts
  Test Files  36 passed (36)
       Tests  806 passed (806)
```

No PRACTICE/PROVE/RETAIN/TRANSFER eligibility logic, misconception blocking, assistance
independence, historical recognition, or Continue behavior changed. No new progression authority
was introduced — `canonical_concept_prerequisites` is a distinct, F4-owned dependency graph for
future curriculum-structure use, not a progression gate, and nothing in F4 reads it to make a
PRACTICE/PROVE/RETAIN/TRANSFER decision.
