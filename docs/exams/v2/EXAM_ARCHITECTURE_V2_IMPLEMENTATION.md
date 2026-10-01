# StudyUS — Exam & Assessment Architecture V2 (implementation)

Branch `track-b/exam-architecture-v2` (from Track B V1 `52de415`). DEV only. Audit and migration plan: [`EXAM_ARCHITECTURE_V2_AUDIT.md`](EXAM_ARCHITECTURE_V2_AUDIT.md).

V2 extends the single Track B Exam Core. It does not replace it, and no framework has its own code path. Every framework is data: a vertical configuration plus a structure catalogue, each citing registered sources.

## 1. What was built

| Area | Where | Summary |
|---|---|---|
| Structure model (§1–2) | `catalog/structure.ts`, `catalog/structure.service.ts`, table `assessment_structure_nodes` | One generic hierarchy with 19 typed nodes. Labels use the framework's own words, localized. Nodes bind to a configured vertical and component. Unbound nodes are shown as "not available yet" and are never selectable. |
| Dynamic selection (§2) | `/api/exams/catalog`, `/api/exams/catalog/level`, `/dashboard/exams` | Framework → … → exam level → papers/components → mode. The UI renders whatever children exist and contains no framework logic. |
| Versioning (§3) | `exam_versions` V2 columns, `FrameworkVersioningSchema` | Curriculum version, first/last assessment, syllabus code, framework version and sources, required for every V2 configuration. |
| Source registry (§4) | `catalog/sources.ts`, `assessment_sources` | 37 sources (IBO, OECD/NCES, Icfes, College Board PR-LA, Cambridge), each with a confidence level and license status. An unknown source key is refused (`UnknownSourceError`). |
| Component definition (§5) | `component-definition.ts`, `assessment_components.definition` | Official name, kind, assessment, duration, marks, weight, calculator, response formats, sections, AOs, distributions, command terms, submission limits, limitations and sources. `componentDefinitionForAI()` is the only structure text the generator receives. |
| Blueprint (§17) | vertical configs + `ItemBlueprintTagsSchema` | Content, process, context, competency, assertion, evidence, cognitive demand, AO and response format tags per item. Distributions are enforced through objectives (for example PISA content × process). |
| Modes (§28–31) | `exam-instance.service.ts`, `form-assembly.ts` | **PRACTICE**: adaptive level, per-item feedback, form built at start. **MOCK**: form assembled and frozen when READY, official timing, no hints, Tutor or feedback, no regeneration. **CHALLENGE**: a frozen Mock at difficulty about 1.10 (band 1.05–1.15), labelled "Más exigente que el formato estándar". |
| Strict readiness (§30) | `computeStrictReadiness`, `exam_attempt_results.strict_readiness` | A separate metric: only fully correct deterministic targets count, and rubric work takes the lower assessor. It is shown separately and never as an official score. |
| ExamPackage / fidelity (§32) | `AssembledForm` | Per-component planned marks or items against the official size. **FULL** only when the published size is met; otherwise **REDUCED** with a coverage percentage. Time is proportional to the official pace. |
| Difficulty (§33) | `difficultyIndex` on items, `assembleForm` | Mock targets 1.0 (band 0.95–1.05). The form's index is marks-weighted. A band that is not met is reported, never hidden. |
| Novelty (§34) | `fingerprints.ts`, `exam_item_usage` | Semantic, template, reasoning and stimulus fingerprints. A form never holds two items with the same template; seen items and templates are penalized on retest. |
| Scoring strategies (§35) | `SCORING_STRATEGIES`, `scoringStrategyOf` | EXACT, MATHEMATICAL_EQUIVALENCE, NUMERIC_TOLERANCE, UNIT_AWARE, PARTIAL_CREDIT, METHOD_MARK, ANALYTIC_RUBRIC, BEST_FIT_RUBRIC, MARKSCHEME, MULTI_PART, PORTFOLIO_RUBRIC and PERFORMANCE_RUBRIC. The strategy is persisted per response. |
| Deterministic first (§36) | `item-grading.ts` | Structured formats, keyed text, math, method marks and mark schemes never reach AI. Rubric items go to the double assessor. Only unkeyed AI-generated free text uses the single grader. |
| Math input (§25) | `ItemRunner` + MathLive `MathExpressionEditor` | No LaTeX knowledge is needed. An optional working box earns method marks. Literal, normalized, AST and LaTeX are persisted (`normalized_response`). |
| Math equivalence (§26) | `math/math-engine.ts` | mathjs parse with a whitelist (no eval). Covers probe-point equivalence, proportional equations and inequalities, intervals (bracket and inequality notation, unions), mixed numbers, implicit multiplication and decimal comma by language. |
| Units (§27) | `math-engine.ts` | mathjs units with dimension checks, conversion only when allowed, and superscript/negative-power normalization. |
| Required form (§28) | `formMet` | EXACT, DECIMAL (+dp), SIMPLIFIED_FRACTION, FACTORED, EXPANDED, SCIENTIFIC, INTEGER and significant figures. When the value is right but the form is wrong, the key's partial-credit policy applies. |
| Double assessor (§22–24) | `assessment/double-assessor.service.ts`, `exam_response_assessments` | A criterion-first, B holistic-first; B never sees A. Agreement gives the mean (strict = minimum). Disagreement goes to the adjudicator. Any failure or low confidence gives REVIEW_REQUIRED. Every verdict is validated against the rubric. |
| Calibration (§23) | `calibration/calibration.ts`, `assessment_calibration_*` | Benchmark cases and a runner with metrics. `equivalenceClaimAllowed` requires at least 30 official exemplars at ≥80% exact agreement and ≥95% within one mark. Today there are 0 official exemplars, so the flag is false. |
| Multimodal / Arts (§9–14, §52) | `media/*`, `submissions/*`, `PortfolioPanel` | Signed upload intents. Byte-level type detection and scan (EICAR, executables, archives, SVG/HTML, active PDF). sharp re-encode strips EXIF and makes a WebP thumbnail. Storage is owner-scoped Postgres bytea (no bucket). Reads use HMAC-signed URLs and are also owner-checked. Deletion purges bytes. Vision double assessment covers images and text; PDF, audio and video go to human review. |
| Bridge (§38–40) | `learning-bridge.service.ts`, result page | "Necesitas reforzar X — fallaste n de m preguntas" leads to **Reforzar ahora** (the concept in the existing Learning Engine) or **Añadir a mi plan** (a governed `LearningConceptProposal`, which never creates a canonical concept). |
| Retest / delete (§41–45) | `exam-instance.service.ts`, `/api/exams/instances/*` | Delete rules per state; in-progress → attempt cancelled, never resumable; completed → soft delete + result invalidated, evidence kept. "Crear nuevo simulacro" always makes a new instance from zero. Owner-scoped in both route and service, and idempotent. |
| Content origin (§46) | `approved_items.content_origin`, response `content_origin` | OFFICIAL / LICENSED / GENERATED / FIXTURE. Every non-official item shows "Práctica generada por StudyUS, alineada al formato de ⟨framework⟩". |
| DEV reset (§47) | `dev-fixture-reset.ts`, `scripts/operations/track-b-v2-reset-student.ts` | DEV fingerprint plus confirmation phrase, refused in production. Only one Student's data on fixture versions is removed; evidence and content are kept. |

## 2. Data model (migration `20261020_1000_track_b_exam_architecture_v2.sql`)

The migration is additive only and its rollback is documented in the header. New tables:

- `assessment_sources`
- `assessment_structure_nodes`
- `exam_instances`
- `exam_response_assessments`
- `exam_media_objects`
- `exam_submissions`
- `exam_submission_artifacts`
- `learning_concept_proposals`
- `learning_concept_proposal_requests`
- `exam_item_usage`
- `assessment_calibration_cases`
- `assessment_calibration_runs`

New nullable or defaulted columns are added on `exam_versions`, `assessment_components`, `approved_items`, `exam_attempt_item_responses` and `exam_attempt_results`. It is certified on an ephemeral PG18 by `scripts/operations/track-b-exam-v2-migration-cert.sh`: idempotent, legacy rows untouched, about 30 constraint probes, rollback inside a transaction, and catalogue apply with a no-op second run. The certification caught one real defect before DEV: `array_length` on an empty array is NULL, so the "at least one component" CHECK now uses `cardinality`.

## 3. Reference verticals (content = FIXTURE, original StudyUS items)

| Key | Structure (official) | StudyUS form |
|---|---|---|
| `v2.ib.math-aa-hl` | P1 120′/110/30 % no calc · P2 120′/110/30 % GDC · P3 60′/55/20 % GDC | 18 items; reduced forms ~20–30 % of each paper, proportional time |
| `v2.ib.visual-arts-sl` | AIP 32/40 % ext · Connections 24/20 % ext · Resolved 32/40 % int | 6 portfolio tasks (practice rubrics totalling the official marks) |
| `v2.ib.visual-arts-hl` | AIP 32/30 % · Artist project 40/30 % · Selected resolved 40/40 % | 6 portfolio tasks |
| `v2.pisa.math` | 4 processes × 25 %, 4 categories × 25 %, contexts, units | 16 items, 8 positions (2 per process / category) |
| `v2.saber11.math` | Competencias 34/43/23 %, ~50 items, 0–100 | 15 items, 12 positions 4/5/3 |
| `v2.paa.math` | 55 items / 60′, 4 domains, no penalty | 16 items, 12 positions, 13′ |
| `v2.cambridge.0580-extended` | P2 120′/100/50 % no calc · P4 120′/100/50 % scientific | 16 items, reduced forms |

The catalogue also lists, without binding them, IB Groups 1–4 and 6 (Theatre, Music, Film), Math AA SL, Math AI, Cambridge Core, 9709, PISA Reading/Science and the other Saber and PAA areas.

## 4. Decisions taken (and why)

1. **Assessor independence within one vendor.** The canonical runtime is OpenAI-only (`model-routing.ts` and its guard test), so A and B are separate Terra calls with different reading orders and prompts, and B never sees A. A second vendor is an open decision.
2. **Media backend.** Postgres bytea at ≤4 MB per file (the Vercel body limit), behind `media.service.ts`. A production object store is an open decision; only that file changes.
3. **Scanner.** The scanner is heuristic, not an antivirus engine. A production AV scanner is an open decision.
4. **Non-visual artifacts.** PDF pages, audio and video are stored and listed, but the AI never claims to have seen them, so the response is REVIEW_REQUIRED.
5. **Reduced forms.** The bank fills a fraction of each official paper. Section time is proportional to the official pace, and the form says REDUCED with a coverage percentage. It is never presented as a full paper.
6. **Practice adaptivity between sessions.** The level moves up at ≥80 % and down below 50 %. Within a session, items are already fixed by the plan.
7. **Deleting a completed exam.** The instance is soft-deleted and its result is INVALIDATED: kept for audit, no longer shown or counted. Learning evidence already written from independent answers is kept.
8. **Review-required responses are not evidence** until a reviewer confirms them.

## 5. Open decisions

- A production object store and antivirus scanner for exam media.
- A second assessor vendor, which needs a routing-policy change.
- Licensed official content and official marked exemplars for the calibration suite. Without them, OFFICIAL_EXAMINER_EQUIVALENCE stays unclaimed.
- A human review queue UI for REVIEW_REQUIRED responses (the data and status exist today).
- Official grade-boundary transforms such as IB 1–7 or Saber 0–100. These are not configured, so results are percentages.
- Full-length banks for Full Mock fidelity = FULL.
