# Cambridge Whole-School Pilot — Phase 0 inventory (Colegio Bilingüe José Max León)

Date: 2026-10-16. Scope decision: operator, "CONFIRMED SCOPE — CAMBRIDGE PATHWAY WHOLE-SCHOOL PILOT".
`CAMBRIDGE.9709.P1 = sufficient for Cambridge pilot` is **SUPERSEDED**.
No content was generated. No product change was made. Nothing was deployed.

School evidence and Cambridge official evidence are kept in separate columns. No qualification is inferred from Cambridge offering it.

## Governance decision — Cambridge Checkpoint (operator, 2026-10-16)

This decision supersedes the earlier rule that Primary and Lower Secondary are "Learning + Internal Assessment only". It does so for one narrow case only: the school actually sits the external Cambridge Checkpoint.

```
Primary          -> Learning -> Internal Assessment -> Exam Prep for the actual external Checkpoint used by the school
Lower Secondary  -> Learning -> Internal Assessment -> Exam Prep for the actual external Checkpoint used by the school
CAMBRIDGE_PRIMARY_CHECKPOINT = REQUIRED
CAMBRIDGE_LOWER_CHECKPOINT   = REQUIRED
CHECKPOINT_EXACT_VARIANT     = SCHOOL_CONFIRMATION_REQUIRED
```

- This does **not** authorize generic Exam Prep for any other Primary or Lower Secondary year or subject.
- No Checkpoint content may be generated until every blocker below is resolved by school evidence. Nothing is chosen by probability.

| Blocker | School evidence so far | Options |
|---|---|---|
| Grade / stage taking Primary Checkpoint | Cronograma 2026-27: 5°. Manual 2025-26 table: 6° (listed among English certifications) | 5° (Stage 6) / 6° |
| Grade / stage taking Lower Secondary Checkpoint | Cronograma 2026-27: 8°. Manual 2025-26: 9° | 8° (Stage 9) / 9° |
| English framework | Booklists use Cambridge Global English (inference only) | English (0058 / 0861) / ESL (0057 / 0876) |
| Checkpoint subjects actually taken | Not stated. CORE areas are Science, Mathematics, English, Global Perspectives | any subset of English-or-ESL, Mathematics, Science, Global Perspectives |
| Exact frameworks / codes | Not stated | see the variant-independent structure (official) below |

## Sources

**School (official).** Verified directly against the PDF:
- Manual de Convivencia 2025-2026, pp. 66–68 (arts. 57–60):
  `https://cdn.prod.website-files.com/69332e59fc42ea73ca7ff0b9/6976651163cc76525f03b4f5_E2-MA-01-Manual-de-Convivencia-CBJML-2025-2026-1.pdf`
- Cronograma 2026-27.
- Booklists 2026-27 for grades 1°–11°.
- Admisiones, Historia and Colegio Internacional pages on josemaxleon.edu.co.
- Cambridge registration certificate, shown as a photo on the school site.

**Cambridge (official).**
- "Find a Cambridge school" lists COLEGIO BILINGUE JOSE MAX LEON, Cota (no programme data).
- Syllabus PDFs on cambridgeinternational.org.
- Checkpoint FAQ and timetable.
- ICE page.

**StudyUs.** Pilot candidate database `4baac799`, read-only:
- the curriculum tables (`academic_*`, `structure_*`, `learning_objectives`, `objective_concept_mappings`);
- catalogue nodes with the ENFORCE overlay;
- the Readiness Engine per published version.

## Verified school facts

All quotes are from the Manual, pp. 66–68.

- Since 2022 the school is a Colegio Internacional under CAIE.
- "Transición a quinto grado: Primary · Sexto a octavo grado: Lower secondary · Noveno a décimo grado: IGCSE".
- Primary and Lower Secondary CORE areas: Science, Mathematics, English, Global Perspectives.
- IGCSE (9°–10°) areas: English, Mathematics, Biology, Global Perspectives, Lengua Castellana, Computer Science, Entrepreneurship.
- Instruments:
  - Progression tests (internal);
  - Check Point (set and marked by CAIE);
  - IGCSE exams "al finalizar el grado décimo", covering "siete (7) dimensiones de área".
- "Bachiller internacional" requires passing all seven. A student may also certify only some of them.
- Advanced is mentioned only as a future option: "continuum Cambridge en los cursos A Levels". There is no AS/A Level or AICE delivery evidence. The certificate approves Advanced, but approval is not delivery.

## Matrix

Readiness scale: CATALOGUE_ONLY / STRUCTURE_ONLY / PARTIAL / READY.

| Pathway stage | School grade(s) | School subject | Cambridge qualification / framework | Syllabus code | Version cycle | Variant / route | Required papers / components (Cambridge official) | Core/Ext | Coursework / practical / oral | StudyUs catalogue | Canonical curriculum / concept coverage | Exam Bank supply | Readiness | Browser |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Primary | Transición–5° (Stages 1–6) | Science | Cambridge Primary Science framework | 0097 (curriculum code) | current framework | — | n/a (curriculum) | n/a | n/a | none | **no Cambridge Primary framework in StudyUs** | n/a by scope | MISSING | — |
| Primary | Transición–5° | Mathematics | Cambridge Primary Mathematics | 0096 | current | — | n/a | n/a | n/a | none | none (3°–5° use a Scholastic PRIME book) | n/a | MISSING | — |
| Primary | Transición–5° | English | Cambridge Primary English **or** ESL | 0058 / 0057 — **unresolved** | current | — | n/a | n/a | n/a | none | none | n/a | MISSING | — |
| Primary | Transición–5° | Global Perspectives | Cambridge Primary Global Perspectives | 0838 | current | — | n/a | n/a | n/a | none | none | n/a | MISSING | — |
| Primary (Checkpoint) | 5° per Cronograma 26-27 (Manual says 6°) | subjects not stated | Primary Checkpoint (external, CAIE) | — | May series (inference) | — | per subject | — | — | none | — | **REQUIRED (decision 2026-10-16); not created: blocked by SCHOOL_CONFIRMATION** | MISSING | — |
| Lower Secondary | 6°–8° (Stages 7–9) | Science | Lower Secondary Science | 0893 | current | — | n/a | n/a | n/a | none | none | n/a | MISSING | — |
| Lower Secondary | 6°–8° | Mathematics | Lower Secondary Mathematics | 0862 | current | — | n/a | n/a | n/a | none | none (6° uses WebAssign) | n/a | MISSING | — |
| Lower Secondary | 6°–8° | English | Lower Secondary English **or** ESL | 0861 / 0876 — **unresolved** | current | — | n/a | n/a | n/a | none | none | n/a | MISSING | — |
| Lower Secondary | 6°–8° | Global Perspectives | Lower Secondary Global Perspectives | 1129 | current | — | n/a | n/a | n/a | none | none | n/a | MISSING | — |
| Lower Secondary (Checkpoint) | 8° per Cronograma (Manual says 9°) | subjects not stated | Lower Secondary Checkpoint | — | May (inference) | — | English 0861/01–02 or ESL 0876/01–03; Maths 0862/01–02; Science 0893/01–02 | — | — | none | — | **REQUIRED (decision 2026-10-16); not created: blocked by SCHOOL_CONFIRMATION** | MISSING | — |
| Upper Secondary | 9°–10° (exam end of 10°) | English | IGCSE English | **unresolved**: 0510 / 0511 / 0991 / 0993 (ESL) or 0500 / 0990 (First Language) | ESL 2027–2029 | ESL route is suggested by the textbook (inference) | ESL: Reading & Writing (2 h), Listening (~50 min), Speaking (10–15 min; endorsed vs count-in by code) | — | Speaking (oral) | none | none | none | MISSING | — |
| Upper Secondary | 9°–10° | Mathematics | IGCSE Mathematics | **unresolved**: 0580 / 0980 / 0607 / 0626 | 0580: 2025–2027 | **Core vs Extended unresolved** | 0580 Core P1+P3; 0580 Extended P2+P4. 0607 adds P5/P6 investigation | unresolved | 0607 only: investigation | 0580 node; Extended bound; Core catalogue-only | 0580 Extended: 8 objectives, **0 concept mappings** | 0580 Extended: 16 DEV fixtures, engine NOT_READY (P2, P4); Core: none | Extended STRUCTURE_ONLY; Core CATALOGUE_ONLY | Extended not selectable |
| Upper Secondary | 9°–10° | Biology | IGCSE Biology | **unresolved**: 0610 / 0970 | 2026–2028 | Core vs Extended unresolved | Core P1+P3 or Extended P2+P4, plus P5 practical or P6 alternative | unresolved | practical (P5) or alternative (P6) | none | none | none | MISSING | — |
| Upper Secondary | 9°–10° | Global Perspectives | IGCSE Global Perspectives | 0457 (the only IGCSE GP syllabus; school does not state it) | 2025–2027 | — | C1 written exam 35%, C2 individual report 30%, C3 team project 35% | — | **C2 and C3 coursework** | none | none | none | MISSING | — |
| Upper Secondary | 9°–10° | Lengua Castellana | IGCSE Spanish | **unresolved**: 0502 / 0530 / 7160 / 0474 | 2025–2027 | — | 0502: P1 Reading + P2 Writing (+ optional Speaking); 0530: four papers | — | oral (0502 optional, 0530 required) | none | none | none | MISSING | — |
| Upper Secondary | 9°–10° (SIEE says 9°–11°) | Computer Science | IGCSE Computer Science | **unresolved**: 0478 / 0984 | 2026–2028 | — | P1 Computer Systems + P2 Algorithms, Programming and Logic | — | none | none | none | none | MISSING | — |
| Upper Secondary | 9°–10° (SIEE says 8°–11°) | Entrepreneurship | IGCSE Enterprise (strong fit) or Business | **unresolved**: 0454 / 0450 (ends 2026) / 0264 | 0454: 2027 | — | 0454: written paper 50% + coursework 50% | — | **coursework** | none | none | none | MISSING | — |
| Upper Secondary (unclear) | 9°–11° | Chemistry, Physics | IGCSE 0620 / 0625 materials | — | — | — | — | — | — | — | — | — | **not in the 7 examined areas: out of scope unless the school confirms** | — |
| Upper Secondary (ICE) | — | the 7-subject package | ICE (inference only) | — | — | — | — | — | — | none | — | — | **unresolved** | — |
| Advanced | — | — | AS & A Level / AICE | **no delivery evidence** | — | — | — | — | — | 9709 AS, AICE tree (60 subjects) | AICE: 7 subjects × AS/A, objectives mapped | 9709 AS READY (Cambridge P1; AICE P1/P2/P4/P5); all other AICE subjects NOT_READY | **not school scope until confirmed** | 9709 AS selectable |

## Ambiguities (SCHOOL_VARIANT_CONFIRMATION_REQUIRED)

See the operator report. These need answers from the school's exams officer, entry list or statements of results:
- the code and tier for each of the 7 IGCSE subjects;
- the IGCSE series (June or November);
- the Checkpoint grades (5°/8° or 6°/9°) and subjects;
- the Primary and Lower Secondary English framework (English or ESL);
- whether Chemistry and Physics are examined;
- whether the package is entered as ICE;
- whether any AS/A Level or AICE is delivered.

## Checkpoint structure, independent of the school's variant (Cambridge official)

Every subject option is listed. None is chosen.

Sources:
- October 2026 final timetable `/Images/758132-october-2026-checkpoint-final-timetable-document.pdf`. Its codes and durations were re-verified directly.
- Checkpoint FAQ PDF.
- `checkpoint-changes-2026`.
- `primary-lower-secondary-changes`.
- Cambridge help-centre articles.

| Checkpoint | Subject option | Framework | Timetabled components | Notes |
|---|---|---|---|---|
| Primary (end of Stage 6) | English | 0058 | 0058/01 1h · 0058/02 1h | A learner cannot enter both English and ESL |
| Primary | English as a Second Language | 0057 | 0057/01 35m · 0057/02 25m (listening audio) · 0057/03 35m | |
| Primary | Mathematics | 0096 | 0096/01 45m · 0096/02 45m | No calculator listed (protractor, compasses, tracing paper); this is an inference, not a stated rule |
| Primary | Science | 0097 | 0097/01 35m · 0097/02 35m | |
| Primary | Global Perspectives | 0838 | No written test: a team project (teams of 3–4), teacher-marked and moderated by Cambridge | May and October only |
| Lower Secondary (end of Stage 9) | English | 0861 | 0861/01 1h10m · 0861/02 1h10m | |
| Lower Secondary | English as a Second Language | 0876 | 0876/01 45m · 0876/02 35m (listening audio) · 0876/03 40m | |
| Lower Secondary | Mathematics | 0862 | 0862/01 1h · 0862/02 1h | No calculator listed (geometrical instruments, tracing paper); inference |
| Lower Secondary | Science | 0893 | 0893/01 45m · 0893/02 45m | |
| Lower Secondary | Global Perspectives | 1129 | Individual research report, 800–1000 words, teacher-marked and moderated | May and October only |

Rules common to both levels:
- **Scale.** A 0–50 score since May 2023, in bands: Basic 1–10, Aspiring 11–20, Good 21–30, High 31–40, Outstanding 41–50. Global Perspectives is excluded and its scale is not published.
- **Reports.** Strand and sub-strand reporting. A Statement of Achievement, no certificate.
- **Series from 2026.** March, May and October. Global Perspectives is not offered in March.
- **Entries.** Per subject and optional. Every component of a subject must be sat in the same series.
- **Frameworks.** Revised in 2020, with first new tests in 2023. No revision announced for 2026–2028.

Not published publicly (support-site login only): paper titles, maximum marks, specimen papers, and the Global Perspectives mark schemes.

These gaps matter for supply. A future Checkpoint blueprint needs per-paper marks and content distribution. That needs Cambridge-supported specimen or past papers under the school's licence, or an operator decision. Until then the blueprint stays STRUCTURE_ONLY at most.
