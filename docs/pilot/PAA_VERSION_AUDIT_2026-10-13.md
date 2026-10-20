# PAA version audit — findings and deferred remediation

Date: 2026-10-13 · Read-only audit · **No migration was created; no internal binding was changed.**

## Finding

`2021` is the copyright/publication year of the College Board study guide StudyUs governs the PAA structure from. It is **not** an exam version identifier. College Board names the test **"PAA revisada"** (last revision; applied from October 2017 in Puerto Rico and August 2018 in Latin America) and publishes no per-year version.

| | |
|---|---|
| Source | Guía de estudio PAA, © 2021 College Board — `https://latam.collegeboard.org/wp-content/uploads/2021/07/Guia_de_estudios_PAA.pdf` (governed key `cb-paa-guia-2021`) |
| sha256 of the file retrieved 2026-10-13 | `6bcb3efc6c4074e0a7b1272d67b50bd8835cfb3e486411020039ba84b932e1fc` |
| Still the guide linked from the official page | yes (`latam.collegeboard.org/publicaciones/guia-de-estudio-paa/`) |
| Structure confirmed | four parts (Lectura, Redacción, Matemáticas, Inglés), four-option multiple choice, student-produced responses in part of Matemáticas, no penalty, 3:00 total |
| Discrepancy inside the guide | structure table: Inglés 40 min; ESLAT section text: 50 exercises / 50 min. StudyUs governs 40 (it is what adds up to 3:00). |
| Not verified in this guide | per-part counts 45 / 25 / 55 (recorded from `cb-paa-preguntas-respuestas-2017`, not re-opened in this audit) |

## Where `2021` lives (unchanged)

- Code: `src/lib/exam-core/verticals/v2/paa.ts` (`version.label`, `framework.frameworkVersion`, `curriculumVersion`), `src/lib/exam-core/catalog/structure.ts` (root node `frameworkVersion`), `src/lib/assessment-adaptation/system-profiles.ts` (the label is inside the Mathematics `versionBinding`).
- Candidate database, exam version `4babb748…`: 1 `exam_versions` row, 17 structure nodes (1 with `framework_version = 2021`), 4 components, 36 blueprint targets, 343 bank items (296 certified + 47 fixtures), 3 exam attempts / 3 simulation attempts / 3 results / 3 plans, 1 Student preparation profile, 4 health + 3 readiness snapshots.
- The certification registry uses its own version (`0-2-0-illustrative`, a StudyUs rules profile) and does not name 2021.

## What was done now (presentation only)

`studentFacingExamReference` (`src/lib/exam-core/exam-family-owner.ts`): where a Student or Parent would read "Versión: V2.1 PAA revisada (guía 2021)", they read **"Referencia: PAA revisada · Guía de estudio ©2021"**. The stored label, bindings, hashes and lineage are untouched.

## TODO (deferred until after the Student practice milestone)

1. Create an immutable governed version/profile `paa-revisada` ("PAA revisada, vigente desde 2017"); never label it by a year College Board does not use.
2. Prove equivalence by configuration fingerprint (only labels may differ), then associate the blueprint and the certified supply; keep the historical rows on the existing version.
3. Do not edit the label inside the certified `versionBinding`: check first whether it enters the adapter hash (if it does, an edit would orphan the 296 certified instances).
4. Resolve the Inglés 40 / 50 minute discrepancy with a second official source and record the decision.
5. Re-verify the per-part item counts against `cb-paa-preguntas-respuestas-2017`.
