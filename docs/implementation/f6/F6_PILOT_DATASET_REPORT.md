# F6 — Pilot Dataset Report

Source: `scripts/operations/f6-seed-pilot-dataset.ts` + `f6-lifecycle-cert-runner.ts`, run against
real PostgreSQL. Architecture certification, not full content population (task §22).

## PAA — Mathematics (Admission Exam, task §23)

- Organization: ICFES. Programme: PAA, `programme_type = ADMISSION_EXAM` — explicitly not a
  curriculum clone.
- Subject: Mathematics (no qualification layer — PAA has none, which is valid).
- Structure v1 (PUBLISHED, later superseded by v2): nomenclature `COMPONENT` (a flat, 2-level
  tree — a single root "Algebra" component holding objectives directly).
- 5 objectives: Linear Equations (FULL-mapped), Quadratic Graphs (PARTIAL-mapped), Quadratic
  Formula (PREREQUISITE-mapped to Linear Equations), Vector Operations (ambiguous correspondence,
  resolved to one candidate), Probability Distributions (deliberately left unmapped).

## Contrasting curriculum fixture — Cambridge IGCSE Mathematics (task §24)

- Organization: Cambridge International. Programme: Cambridge IGCSE, `programme_type =
  CURRICULUM`, `stage = 'Lower Secondary'`.
- Qualification: IGCSE (the optional layer PAA doesn't need).
- Structure v1 (PUBLISHED): nomenclature `STRAND → SUB_STRAND` — a genuinely different depth (3
  levels: Number → Fractions and percentages → objective) and different vocabulary than PAA's
  flat `COMPONENT`.
- 1 objective ("Solve linear equations") mapped FULL to the **same** canonical concept
  ("Linear Equations") as PAA's own Linear Equations objective.

## What this demonstrates (AC-F6-17/18)

- **PAA represented without duplicating curriculum knowledge** — its `programme_type` is
  distinct (`ADMISSION_EXAM`), it has no qualification layer, and its mapped objectives point at
  the exact same `canonical_concepts` rows Cambridge uses — proven live: `canonical_concepts`
  contains exactly one row named "Linear Equations" after both frameworks' mappings publish.
- **The contrast fixture shares Canonical Concepts correctly** — PAA's and Cambridge's "linear
  equations" objectives both resolve to the identical `canonical_concept_id`, verified by direct
  equality assertion in the real-Postgres certification, not merely by convention.
- **Different structure nomenclature and depth, side by side** — `COMPONENT` (2-level) vs.
  `STRAND → SUB_STRAND` (3-level), neither forced into the other's shape.

## Full adversarial coverage checklist (task §22's required vertical)

| Required demonstration | Present in fixture |
|---|---|
| Different structure nomenclature | ✅ COMPONENT vs. STRAND/SUB_STRAND |
| Shared Canonical Concepts | ✅ "Linear Equations" referenced by both frameworks |
| FULL mapping | ✅ PAA & Cambridge Linear Equations |
| PARTIAL mapping | ✅ PAA Quadratic Graphs |
| PREREQUISITE mapping | ✅ PAA Quadratic Formula → Linear Equations |
| Ambiguous mapping | ✅ PAA Vector Operations (2 same-named canonical concepts) |
| Unmapped objective | ✅ PAA Probability Distributions |
| Approved content | ✅ "PAA Math Official Guide" (PUBLISHED) |
| Rejected content | ✅ "Random Practice PDF" (REJECTED) |
| Retired content | ✅ "Old PAA Prep Book 2019" (PUBLISHED → RETIRED) |
| Multiple resources on same objective | ✅ 3 PUBLISHED resources linked to Linear Equations |
| Version change | ✅ PAA structure v2 supersedes v1, v1 stays intact |

## Explicit scope discipline (task §22/§23)

This is a small, reviewed architecture-certification fixture — not real PAA or Cambridge syllabus
content, and not a claim of broad framework coverage. No exam scoring, timing engine, mock
generation, or institution admission policy was implemented (task §23's explicit exclusions,
reserved for F7+).
