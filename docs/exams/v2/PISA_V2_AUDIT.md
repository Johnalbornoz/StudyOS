# PISA V2 — audit before changes

Audited 2026-10-01 against `track-b/exam-architecture-v2` at `aa53ecf` and the DEV DB (fingerprint `2a29b99ee14a22b4`). Sources were verified against OECD documents and saved in `sources/pisa-2022.json`:
- PISA 2022 Assessment and Analytical Framework (OECD 2023);
- PISA 2018 Assessment and Analytical Framework, which holds the Reading 2018 and Science 2015 frameworks reused in 2022;
- PISA 2022 Results Volume I.

## CURRENT_PISA_ARCHITECTURE

| Area | Mathematics | Reading | Science |
|---|---|---|---|
| Catalogue node | `pisa.2022.math` (DOMAIN), bound to `v2.pisa.math` | `pisa.2022.reading`, catalogue only | `pisa.2022.science`, catalogue only |
| Definition / version | `PISA 2022 — Matemáticas (práctica)`, version `V2 PISA 2022` | none | none |
| Framework mapping | Process × content grid: 8 objectives, each a content category with one process. The 4 processes and 4 content categories are tagged. | none | none |
| Competencies / processes | Formulate, Employ, Interpret and evaluate, Reason (the official names are longer; see gaps) | none | none |
| Contexts | Personal / Occupational / Societal / Scientific as catalogue nodes and item tags | none | none |
| Stimulus / units | 4 shared stimuli (taxi, recycling, garden, cycling), each a text block inside the item | none | none |
| Bank | 16 items: 10 single-choice, 5 numeric/expression through the math engine, 0 open constructed response | 0 | 0 |
| Scoring | Deterministic: choice keys plus math engine equivalence, raw %. No PISA scale (correct). | — | — |
| Simulation blueprint | 8 positions (1 per objective), 20 minutes. Readiness was reported as "FULL" with a disclosed reduced length. | — | — |
| Learning Bridge | No objective links: every gap falls back to a governed proposal | — | — |
| UI readiness | «Simulacro disponible» | «Próximamente» | «Próximamente» |
| Tests | `PISA.form-25pct-per-process` (V2 scenario) and catalogue tests | — | — |

## PISA_STRUCTURAL_GAPS

| # | Gap | Severity |
|---|---|---|
| S1 | Reading and Science have no structure, objectives, units or scoring: catalogue only. | P1 |
| S2 | One definition per domain (`v2.pisa.math`), so there is no common PISA preparation for the three domains and no cross-domain simulation. | P1 |
| S3 | The Mathematics limitation says "Two 30-minute clusters officially". In 2022 the design was a 60-minute mathematics block delivered as an adaptive multistage test, so the text is wrong. | P2 |
| S4 | Process names are abbreviations. The official names are "Formulating situations mathematically", "Employing mathematical concepts, facts and procedures", "Interpreting, applying and evaluating mathematical outcomes" and "Mathematical reasoning". | P2 |
| S5 | Readiness had four states, so reduced and full simulation were not distinguished in the state. | P1 (fixed in the shared model) |
| S6 | Stimuli are texts only: there is no table, data or multiple-source model. | P2 |

## PISA_CONTENT_GAPS

| # | Gap | Severity |
|---|---|---|
| C1 | Mathematics has 0 open constructed-response items, while the framework has open, closed and selected responses in roughly equal numbers. Partial credit is not used. | P2 |
| C2 | Mathematics has 2 items per objective and no data or table stimuli for Uncertainty and data. | P2 |
| C3 | Reading has 0 items: no single or multiple source, and none of locate / understand / evaluate & reflect. | P1 |
| C4 | Science has 0 items: no explain / evaluate & design / interpret data, and no content, procedural or epistemic knowledge. | P1 |
| C5 | No Learning Bridge links for PISA objectives. | P2 |

## PISA_UX_GAPS

| # | Gap | Severity |
|---|---|---|
| U1 | «Próximamente» is the generic status even when the real state is known (structure configured, bank in preparation). | P1 |
| U2 | No domain detail: "Sobre esta área", "Qué se evalúa", "Cómo puedes practicar" and "Estado del simulacro" are missing. | P2 |
| U3 | The domain card shows no bank coverage or framework version. | P3 |
| U4 | «Simulacro disponible» hides that the form is reduced. It must read «Simulacro reducido disponible». | P1 |

Not regressed and kept:
- The engine (frozen forms, grading, delete and restart);
- `OFFICIAL_CONTENT_COVERAGE = 0 %`;
- no PISA scale or proficiency level is shown.
