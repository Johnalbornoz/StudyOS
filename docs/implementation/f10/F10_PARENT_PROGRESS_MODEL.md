# F10 — Parent Progress Model

## No invented denominator (task §14)

F10 never displays an opaque "Your child is X% complete." Every percentage shown names its precise metric and its exact source:

| Displayed label | Definition | Source |
|---|---|---|
| "Concepts with qualifying evidence" | `count(concepts with >= 1 learning_evidence row meeting F5's existing mastery-record validity check) / count(active concepts in subject)` | F5 `learning_evidence`, same validity rule `getStudentMastery`/`tryMasteryScore` already enforce — not a new threshold invented for F10 |
| "Blueprint evidence coverage" | F9's own `blueprint-coverage.service.ts` output, verbatim | F9, unmodified |
| "Independent accuracy" | F5/F8's existing independent-vs-assisted accuracy split (already computed by F8's diagnostic classification), surfaced not recomputed | F8 |

No F10 code computes a new averaging/weighting formula. Every number is either a direct pass-through of an existing certified metric or a simple count/count ratio over an existing, named set (no weights, no fabricated combination).

## Explicit non-metrics

F10 does **not** show: legacy `exam-readiness.service.ts`'s `overallScore`/`predictedExamScore` (INV-F10-19); a "days until exam" derived readiness guess; any AI-generated summary percentage.
