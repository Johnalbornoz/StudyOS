# Exam V2 — completion block audit (before changes)

Audited on 2026-10-01 against branch `track-b/exam-architecture-v2` at `4aeb248` and the DEV DB (fingerprint `2a29b99ee14a22b4`).

Readiness corrected for the duration of this block:

| Item | Value |
|---|---|
| PAA_VERTICAL_READY | NEEDS_REDESIGN |
| IB_DP_STRUCTURE_COVERAGE | PARTIAL |
| IB_ENGINE_SUPPORT | PASS |

## PAA_CURRENT_GAPS

| # | Gap | Severity |
|---|---|---|
| 1 | PAA is modelled as **one area** (`v2.paa.math`, Mathematics). Lectura, Redacción and Inglés are absent from the configuration. The catalogue lists them only as unbound nodes. | P1 |
| 2 | There is no **Full Mock** of the integral test. The only path is `PAA → Matemáticas → exam`, which presents one area as "the PAA". | P1 |
| 3 | Full Mock and Practice are not separated. The same node offers Practice, Mock and Challenge for one area. | P1 |
| 4 | There is no skill-level practice: practice cannot be narrowed below an area. | P2 |
| 5 | Mathematics blueprint: domains only (aritmética, álgebra, geometría, datos y probabilidad). Probability is merged with data analysis; there is no reasoning type or problem type per item; there are only 3 student-produced items. | P2 |
| 6 | No Lectura blueprint (text types, skills, multi-question stimuli) and no Redacción blueprint (writing operations). | P1 |
| 7 | Inglés is not modelled, and there is no institution-specific interpretation (`institution_exam_policies.sections_considered` exists but is unused). | P2 |
| 8 | Scoring: one raw percentage. There is no per-area reporting, no Lectura+Redacción reporting group and no explicit "StudyUS estimated readiness" label. No 200–800 conversion exists, which is correct. | P2 |
| 9 | The pre-start screen does not show areas, durations, item counts, rules, calculator policy or coverage per area. | P2 |
| 10 | Results do not break down skill performance per area: strengths and gaps are a flat objective list. | P2 |
| 11 | Learning Bridge: PAA objectives have no `objective_concept_mappings`. DEV holds **one** canonical concept, so every gap ends in "Añadir a mi plan" and never "Reforzar ahora". | P2 |

## IB_DP_CURRENT_GAPS

| # | Gap | Severity |
|---|---|---|
| 1 | Configured: Math AA HL and Visual Arts SL/HL. **Physics, Chemistry and Biology are catalogue entries only**, with no components, structure or bank. | P1 |
| 2 | Groups 1–3: subjects listed (Lang A Lit, Lang & Lit, Lang B, ab initio, History, Economics, Psychology, Business, Geography, Philosophy) with no components. Missing from the catalogue: Literature & performance, Classical languages, Digital society, Global politics, Social & cultural anthropology, World religions. | P1 |
| 3 | Group 4: missing Computer science and Design technology. ESS and SEHS have no components. | P1 |
| 4 | Group 5: Math AA SL is listed as papers without a configuration. Math AI SL/HL is listed with no papers. | P1 |
| 5 | Group 6: Theatre, Music and Film are listed with component names but no versioned definitions. **Dance** is missing. | P1 |
| 6 | DP Core (TOK, EE, CAS) is absent. | P1 |
| 7 | There is no per-subject readiness state (CATALOG_ONLY / STRUCTURE_READY / PRACTICE_READY / FULL_MOCK_READY). The UI shows "not available yet" vs "choose" only, and a reduced-form Mock is not distinguished from a full-length Mock in the selector. | P1 |
| 8 | No coverage metrics (catalogue / structure / practice / full mock) and no subject readiness matrix. | P2 |
| 9 | No full-subject ExamPackage guard: SL and HL are separate versions (good), but there is no explicit "all required papers" package. | P2 |
| 10 | Learning Bridge: IB objectives have no concept, skill or competency mappings, as with PAA. | P2 |
| 11 | Science grading: the engine supports units, significant figures and method marks, but no science content exists to exercise it (no Physics/Chemistry banks; no chemical-equation representation). | P1 |

Not regressed and kept:

- The engine (forms, freezing, grading, double assessor, media, delete/soft-delete, new attempt) remains as certified for V2.
- `CHALLENGE_MODE = PARTIAL`.
- `OFFICIAL_CONTENT_COVERAGE = 0 %`.

## Resolution (completion block)

| Gap | Status | How |
|---|---|---|
| PAA 1–3 | CLOSED | `v2.paa` is one integral test, in the official order with breaks. `paa.full` offers MOCK/CHALLENGE with all components fixed. `paa.practice` offers PRACTICE only. `v2.paa.math` is RETIRED. |
| PAA 4 | CLOSED | Skill nodes bind objective codes, giving `exam_instances.focus_objective_ids` (migration `20261021_1000`, PRACTICE only). |
| PAA 5–6 | CLOSED | Lectura: text sets with shared stimuli and inference→evidence pairs. Redacción: operations. Math: 5 domains incl. probability, with 5 SPR. |
| PAA 7 | CLOSED (DEV) | Inglés is configured and reported as institution-defined. `institution_exam_policies` is shown when the target institution has one. |
| PAA 8–10 | CLOSED | Reporting groups (Lectura y Redacción / Matemáticas / Inglés), `NO_OFFICIAL_SCALE`, "Preparación estimada StudyUS", results by area and skill, pre-start disclosure. |
| PAA 11 | CLOSED (DEV) | Curated DEV catalogue + PUBLISHED objective links. "Reforzar ahora" materializes via `ensureCatalogMapping`. |
| IB 1, 3, 11 | CLOSED for Physics/Chemistry/Biology SL/HL | 2025 structure (P1A + P1B one sitting, P2, IA), banks, units/s.f./method marks, equations as integer parts. CS, SEHS, ESS and DT are STRUCTURE_READY. |
| IB 2, 5, 6 | CLOSED (structure) | All 35 current subjects / 62 subject-levels are catalogued and sourced, including TOK and EE. CAS is not examinable. Dance has MEDIUM confidence. |
| IB 4 | CLOSED | Math AA SL, AI SL/HL configured. AI HL has Paper 3; SL never does. |
| IB 7–9 | CLOSED | Readiness states per node and component. The badge shows what the entry *offers*. "Simulacro disponible" only for FULL_MOCK_READY. Reduced vs full Mock is shown on the card. Coverage metrics + matrix (`IB_DP_SUBJECT_READINESS_MATRIX.md`). Full test = all required components. |
| IB 10 | CLOSED (DEV) | Math, sciences, VA linked (curated DEV catalogue). |

Defects found and fixed while testing this block:

- Rounding tolerance ignored unit conversion and integer literals with trailing zeros. A 3 s.f. answer in another unit was marked wrong (2510 J for 2.508 kJ).
- The INTEGER/DECIMAL form rejected signed values (`+6`, `-2`).
- "Reforzar ahora" did not turn into "Reforzar": a freshly added concept had no knowledge state, so its subject was null.
- Area-practice nodes would show "Simulacro disponible": readiness was not capped by the modes offered.
