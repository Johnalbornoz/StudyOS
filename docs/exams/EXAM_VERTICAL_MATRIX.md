# Exam vertical matrix (Track B)

Every vertical is a configuration in `src/lib/exam-core/verticals/`, applied to DEV. None has its own code path.

- **ENGINE_SUPPORT** means the engine can represent and run the vertical's structure. It was certified on DEV.
- **OFFICIAL_CONTENT_COVERAGE** means official specifications or items are populated. For every vertical this is **NONE**: all content is a labelled `DEV_CERT_FIXTURE`, made of original items, illustrative durations, weights and bands, and an unofficial scoring provenance.

| Vertical | Configuration (DEV) | Sections / structure | Scoring policy | Delivery | ENGINE_SUPPORT | OFFICIAL_CONTENT_COVERAGE |
|---|---|---|---|---|---|---|
| **PAA** | `dev-cert.paa` (ADMISSION_EXAM, College Board) | Lectura (passage stimulus), Redacción, Matemáticas (incl. numeric) | SECTION_WEIGHTED, equal weights → % | LINEAR, break after Redacción | PASS | NONE |
| **PISA** | `dev-cert.pisa` (ASSESSMENT_FRAMEWORK, OECD) | Reading, Mathematics and Science units, each grouped around a shared stimulus; multi-select and numeric items | RAW → illustrative BANDS (no individual high-stakes score) | FREE_ORDER_WITHIN_SECTION; no TOPIC mode | PASS | NONE |
| **IB** | `dev-cert.ib.math-aa-sl` (SL) + `dev-cert.ib.biology-hl` (HL) | Papers as components; command terms; multi-part mark-scheme items | CRITERIA (knowledge / application / communication) and RAW | LINEAR with break / free order; resultReview SCORES_ONLY on Biology | PASS | NONE |
| **CAMBRIDGE** | `dev-cert.cambridge.igcse-math` (qualification Cambridge IGCSE, Extended) | Paper A / Paper B; method (M) and accuracy (A) marks | WEIGHTED_ITEMS (marks) | LINEAR | PASS | NONE |
| **AICE** | `dev-cert.aice.as-math` + `dev-cert.aice.as-english-general-paper` (qualification Cambridge AICE Diploma) | Cambridge structures reused; subjects grouped into fixture aggregation groups | WEIGHTED_ITEMS / RAW | LINEAR / free order | PASS (aggregate shown; diploma rules reported as NOT_CONFIGURED) | NONE |
| **ICFES** | `dev-cert.icfes.saber11` (ADMISSION_EXAM, Saber 11) | Lectura Crítica, Matemáticas, Sociales y Ciudadanas, Ciencias Naturales, Inglés | SECTION_WEIGHTED, equal weights (no official table) → LINEAR 0–100 fixture scale | FREE_ORDER_WITHIN_SECTION, break after Sociales, session label "(fixture)" | PASS | NONE |

## Other notes

- The existing PAA pilot (`PAA Mathematics (Pilot)`) is unchanged. It has no scoring policy, so its results show `NO_SCORING_POLICY`. Its objective is mapped to a canonical concept, so it is the path for the AI and evidence-bridge checks.
- Year and session are optional on versions. Every DEV fixture sets a year; ICFES and IB set a session label marked "(fixture)".
- Official content, licensed specifications and calibrated conversions (via `score_conversion_models`) are still to be populated. Doing so needs configuration only, with `contentStatus: OFFICIAL_LICENSED` and a sourced provenance.
