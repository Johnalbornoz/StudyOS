# PAA foundation data (Q1 / F-DATA)

Date: 2026-10-10. Status: **applied to DEV and verified** (operator-run, three steps). This file is the reference the catalogue comment points to.

## Result in DEV (verified read-only after each step)

| Measure | Before | After |
|---|---:|---:|
| Canonical concepts | 135 | 168 (+33) |
| Concept labels (es / en) | 158 | 224 (+66 inserted, 14 updated) |
| Objective → concept mappings, PUBLISHED | 324 | 373 (+54 added, 5 retired) |
| Objective → concept mappings, RETIRED | 0 | 5 |

The 54 added rows are the 36 certified PAA objective/concept pairs; 18 of them are repeated on `dev-cert.paa`, which shares the codes `paa.mat.aritmetica`, `paa.mat.algebra` and `paa.mat.geometria`. PISA (30), IB (127) and AICE (125) mappings are row-for-row identical to the pre-write baseline. No question item, item version, review, lifecycle state, blueprint, scoring model or exam version changed.

It records the Q1-C.1 certified concept catalogue for *PAA revisada / Latin America / paper*, the stable identifiers that the schema cannot store yet, the operator steps that apply the change to DEV, and what waits for F-ARCH.

## What changed in the repository

| File | Change |
|---|---|
| `src/lib/exam-core/catalog/dev-learning-catalog.ts` | 33 certified new concepts added (Matemáticas 18, Lectura crítica 7, Redacción 3, English 5) |
| `scripts/operations/seed-canonical-localizations.ts` | es / en labels for the 33 new concepts; display labels updated for 7 existing concepts (the canonical `name`, which is the lookup key, is unchanged) |
| `src/lib/exam-core/catalog/objective-learning-links.ts` | PAA objective links rewritten to the certified concepts (36 pairs added, 5 removed) |
| `scripts/operations/q1-f-data-paa-retire-mappings.ts` | New guarded step that retires the five replaced mappings |

No migration, no schema change, no change to any exam configuration, blueprint, scoring model or question.

## Operator steps for DEV (run on 2026-10-10)

Run from a checkout that contains the three files above, with the DEV database URL.

1. Dry run, then write, the catalogue and links: `npx tsx --env-file=.env.neon-dev scripts/operations/track-b-v2-learning-catalog.ts` then add `--write`. Expected: 33 concepts created; 36 objective/concept pairs added for PAA codes only (54 rows, because `dev-cert.paa` shares the codes `paa.mat.aritmetica`, `paa.mat.algebra` and `paa.mat.geometria`).
2. Labels: `npx tsx --env-file=.env.neon-dev scripts/operations/seed-canonical-localizations.ts` then add `--apply`. Expected: 66 labels inserted and 14 updated.
3. Retire the five replaced mappings (the apply step only ever adds). They are, by objective code and concept:
   - `paa.red.adicion` → Redacción / Economía del lenguaje
   - `paa.red.integracion` → Redacción / Síntesis y generalización
   - `paa.red.particularizacion` → Redacción / Cohesión y conectores
   - `paa.lect.literario` → Lectura crítica / Análisis literario
   - `paa.ing.redaccion` → English / English sentence structure

   Run `npx tsx --env-file=.env.neon-dev scripts/operations/q1-f-data-paa-retire-mappings.ts` (dry run), then add `--write`. The script is closed to these five pairs, refuses unless it finds exactly five rows and each replacement mapping is already published, and prints a ledger with the rollback statement for every row. Nothing is deleted.

A mapping baseline taken before any change (324 rows; PISA 30) is kept with the Q1 audit files, for the before/after PISA comparison.

## Stable identifiers (61 certified concepts)

`canonical_concepts` has no column for a language-neutral identifier, so these are recorded here until F-ARCH adds one. Identity in the database is still the row id; the code looks concepts up by subject and name.

| Stable id | Official Domain | Canonical row (subject / name) | Disposition |
|---|---|---|---|
| `read.vocabulary-in-context` | Vocabulario en contexto | Lectura crítica / Vocabulario en contexto | APPROVE_EXISTING |
| `read.explicit-information` | Ideas explícitas e implícitas | Lectura crítica / Ideas explícitas y tesis | RENAME_EXISTING |
| `read.central-idea` | Ideas explícitas e implícitas | Lectura crítica / Idea central, tema y resumen | NEW (in catalogue file; not yet in DEV) |
| `read.inference` | Análisis, interpretación e inferencias | Lectura crítica / Inferencia textual | APPROVE_EXISTING |
| `read.textual-evidence` | Análisis, interpretación e inferencias | Lectura crítica / Evidencia textual | NEW (in catalogue file; not yet in DEV) |
| `read.cross-text-relations` | Análisis, interpretación e inferencias | Lectura crítica / Evidencias y relación entre textos | RENAME_EXISTING |
| `read.text-structure` | Análisis, interpretación e inferencias | Lectura crítica / Estructura y organización del texto | NEW (in catalogue file; not yet in DEV) |
| `read.tables-and-graphics` | Información cuantitativa o gráficos | Lectura crítica / Lectura de tablas y gráficos | APPROVE_EXISTING |
| `lit.genres` | Análisis literario | Lectura crítica / Géneros literarios | NEW (in catalogue file; not yet in DEV) |
| `lit.narrative-elements` | Análisis literario | Lectura crítica / Elementos del texto narrativo | NEW (in catalogue file; not yet in DEV) |
| `lit.poetic-elements` | Análisis literario | Lectura crítica / Elementos del texto poético | NEW (in catalogue file; not yet in DEV) |
| `lit.figurative-language` | Análisis literario | Lectura crítica / Figuras retóricas y lenguaje figurado | NEW (in catalogue file; not yet in DEV) |
| `write.concision-elision` | Elisión | Redacción / Economía del lenguaje | REMAP_EXISTING |
| `write.stylistic-addition` | Adición | Redacción / Adición: ampliación estilística | NEW (in catalogue file; not yet in DEV) |
| `write.generalization` | Generalización | Redacción / Síntesis y generalización | RENAME_EXISTING |
| `write.global-synthesis` | Integración | Redacción / Integración: síntesis global | NEW (in catalogue file; not yet in DEV) |
| `write.indirect-expression` | Particularización | Redacción / Particularización: expresión indirecta | NEW (in catalogue file; not yet in DEV) |
| `math.num.real-numbers` | Aritmética | Matemáticas / Números reales: propiedades y operaciones | NEW (in catalogue file; not yet in DEV) |
| `math.num.fractions-decimals` | Aritmética | Matemáticas / Fracciones | APPROVE_EXISTING |
| `math.num.ratio-proportion` | Aritmética | Matemáticas / Proporcionalidad | APPROVE_EXISTING |
| `math.num.percent` | Aritmética | Matemáticas / Porcentajes | APPROVE_EXISTING |
| `math.num.divisibility` | Aritmética | Matemáticas / Divisibilidad, MCD y MCM | APPROVE_EXISTING |
| `math.num.powers-scientific-notation` | Aritmética | Matemáticas / Potencias, exponentes enteros y notación científica | NEW (in catalogue file; not yet in DEV) |
| `math.alg.expressions` | Álgebra | Matemáticas / Expresiones algebraicas | NEW (in catalogue file; not yet in DEV) |
| `math.alg.polynomials` | Álgebra | Matemáticas / Polinomios y factorización | NEW (in catalogue file; not yet in DEV) |
| `math.alg.linear-equations` | Álgebra | Matemáticas / Ecuaciones lineales | APPROVE_EXISTING |
| `math.alg.linear-inequalities` | Álgebra | Matemáticas / Inecuaciones lineales | NEW (in catalogue file; not yet in DEV) |
| `math.alg.linear-systems` | Álgebra | Matemáticas / Sistemas de ecuaciones | APPROVE_EXISTING |
| `math.alg.quadratics` | Álgebra | Mathematics / Quadratic functions and inequalities | REMAP_EXISTING |
| `math.alg.rational-radical-absolute-equations` | Álgebra | Matemáticas / Ecuaciones racionales, con radicales y con valor absoluto | NEW (in catalogue file; not yet in DEV) |
| `math.alg.radicals-rational-exponents` | Álgebra | Matemáticas / Radicales y exponentes racionales | NEW (in catalogue file; not yet in DEV) |
| `math.alg.variation` | Álgebra | Matemáticas / Variación directa e inversa | NEW (in catalogue file; not yet in DEV) |
| `math.alg.patterns-sequences` | Álgebra | Matemáticas / Patrones y sucesiones | NEW (in catalogue file; not yet in DEV) |
| `math.fun.functions` | Álgebra | Matemáticas / Funciones | APPROVE_EXISTING |
| `math.fun.linear-functions-lines` | Álgebra | Matemáticas / Rectas y funciones lineales | NEW (in catalogue file; not yet in DEV) |
| `math.fun.exponential` | Álgebra | Mathematics / Exponential models | REMAP_EXISTING |
| `math.trig.ratios` | Álgebra | Mathematics / Trigonometry and triangles | REMAP_EXISTING |
| `math.geo.coordinate-plane` | Geometría | Matemáticas / Plano cartesiano: coordenadas, distancia y punto medio | NEW (in catalogue file; not yet in DEV) |
| `math.geo.transformations` | Geometría | Matemáticas / Transformaciones geométricas | NEW (in catalogue file; not yet in DEV) |
| `math.geo.angles-lines` | Geometría | Matemáticas / Ángulos y rectas | NEW (in catalogue file; not yet in DEV) |
| `math.geo.similarity-congruence` | Geometría | Matemáticas / Semejanza de triángulos | RENAME_EXISTING |
| `math.geo.pythagorean-theorem` | Geometría | Matemáticas / Teorema de Pitágoras | APPROVE_EXISTING |
| `math.geo.plane-figures-area-perimeter` | Geometría | Matemáticas / Área y perímetro | RENAME_EXISTING |
| `math.geo.circles` | Geometría | Matemáticas / Círculo: circunferencia, área y arcos | NEW (in catalogue file; not yet in DEV) |
| `math.geo.solids-volume-surface` | Geometría | Matemáticas / Sólidos: volumen y área de superficie | NEW (in catalogue file; not yet in DEV) |
| `math.stat.central-tendency` | Análisis de datos y Probabilidad | Matemáticas / Medidas de tendencia central | APPROVE_EXISTING |
| `math.stat.dispersion` | Análisis de datos y Probabilidad | Matemáticas / Medidas de dispersión | APPROVE_EXISTING |
| `math.stat.data-representation` | Análisis de datos y Probabilidad | Matemáticas / Representación e interpretación de datos | NEW (in catalogue file; not yet in DEV) |
| `math.stat.population-sample` | Análisis de datos y Probabilidad | Matemáticas / Población, muestra y tipos de variables | NEW (in catalogue file; not yet in DEV) |
| `math.prob.counting` | Análisis de datos y Probabilidad | Matemáticas / Técnicas de conteo | APPROVE_EXISTING |
| `math.prob.probability` | Análisis de datos y Probabilidad | Matemáticas / Probabilidad | APPROVE_EXISTING |
| `math.prob.conditional` | Análisis de datos y Probabilidad | Matemáticas / Probabilidad condicional | NEW (in catalogue file; not yet in DEV) |
| `efl.vocabulary` | Uso del lenguaje y vocabulario | English / English vocabulary in context | APPROVE_EXISTING |
| `efl.grammar.sentence-structure` | Uso del lenguaje y vocabulario | English / English sentence structure | REMAP_EXISTING |
| `efl.grammar.function-words` | Uso del lenguaje y vocabulario | English / English function words | NEW (in catalogue file; not yet in DEV) |
| `efl.grammar.verb-forms` | Uso del lenguaje y vocabulario | English / English verb tenses | RENAME_EXISTING |
| `efl.grammar.noun-adjective-forms` | Uso del lenguaje y vocabulario | English / English noun, adjective and adverb forms | NEW (in catalogue file; not yet in DEV) |
| `efl.reading.literal` | Comprensión de lectura | English / Reading comprehension in English | RENAME_EXISTING |
| `efl.reading.interpretive` | Comprensión de lectura | English / Reading in English: inference, purpose and tone | NEW (in catalogue file; not yet in DEV) |
| `efl.writing.complex-sentences` | Redacción indirecta | English / English complex sentences: coordination and subordination | NEW (in catalogue file; not yet in DEV) |
| `efl.writing.paragraph-organization` | Redacción indirecta | English / English paragraph organization and coherence | NEW (in catalogue file; not yet in DEV) |

## Deliberately not done here

| Item | Why | Phase |
|---|---|---|
| PAA version identity (label, first assessment, effective dates, region, modality) | A published configuration is immutable: any change needs a new version label, which re-creates the blueprint and supersedes the version that holds the current items and student profiles. Region and modality have no column. | F-ARCH, with the new blueprint |
| 20 objectives → 17 official Domains | Objectives are referenced by blueprint targets and, immutably, by every item version. There is no Domain layer. | F-ARCH |
| 84 Topics | No table can hold a Topic with authority and source lineage. | F-ARCH |
| Renaming canonical `name` values | The name is the lookup key in the catalogue, links and label scripts, and 13 of these concepts are shared with PISA. Only display labels were changed. | F-ARCH (after stable ids) |
| Merging language duplicates (e.g. Ecuaciones lineales / Linear Equations) | Needs a stable id and a re-pointing plan for learner mappings, plans and institution curricula. | F-ARCH |
| `paa.red.cohesion` link | The objective still holds a blueprint slot; removing its only concept link would leave it unlinked. It goes when the objective is retired. | F-ARCH |
| Link for *Estructura y organización del texto* | It belongs to a Domain, not to either existing reading objective. | F-ARCH |
| Legacy "PAA Mathematics (Pilot)" definition | It has an ACTIVE student profile and an IN_PROGRESS attempt. | Needs an owner decision |
