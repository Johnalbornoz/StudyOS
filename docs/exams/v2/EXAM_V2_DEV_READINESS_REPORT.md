# Exam & Assessment Architecture V2 — DEV readiness report (§58)

## Completion block — PAA redesign + IB DP full catalogue (current candidate)

**Candidate SHA (code):** `13d82c0456a7f91a51017d7138c5c0d4ac836e5c`, branch `track-b/exam-architecture-v2`, previous `87a5231`.

**Hosted DEV candidate:** `https://study-owcsgr899-study-so.vercel.app`, deployment `dpl_DTQpi8CFurDGB6kX2vEGda2f19jN`.

- `/api/version` → `commitSha = 13d82c0…`, so repo SHA = deployed SHA.
- `/api/diagnostics/preview-db` → fingerprint `2a29b99ee14a22b4` (DEV), 47 applied migrations.
- `/api/health` → database ok.
- An authenticated route without a session → 401.

**Shared DEV alias.** Before the deploy it pointed to Track A's `dpl_92B7r…`. During this block Track A deployed its own commit `fff2e29` (`track-a/roles-e2e`), so the alias now points to `dpl_7fKYQ13t5…`. Both are Track A deployments; Track B never moved the alias. Stage and Production were not touched, and neither was Track A's code.

**Earlier deploy attempt.** The first deploy attempt of this block ended with "fetch failed" and produced no candidate URL. Only `study-owcsgr899` is valid.

### §53 — PAA

| Verdict | Value | Basis |
|---|---|---|
| PAA_VERTICAL_READY | PASS (DEV) | Was NEEDS_REDESIGN. `v2.paa` is one integral test in the official order: Lectura 45/50′, Redacción 25/30′, Matemáticas 55/60′ (no calculator), Inglés 50/40′. It has two breaks and comes from the sourced 2021 guide. `v2.paa.math` is RETIRED. |
| PAA_FULL_MOCK | PASS (reduced format) | Frozen before start, with no adaptation, feedback, tutor or hints, and two breaks. Scenarios `PAA.full-mock-*`. The form is 36 positions = 21 % of the official length, disclosed as «Simulacro de formato reducido». |
| PAA_FULL_LENGTH_MOCK | NOT_AVAILABLE | The bank does not reach 175 items. Nothing claims full length. |
| PAA_PRACTICE_BY_AREA | PASS | 4 areas, PRACTICE only. |
| PAA_SKILL_PRACTICE | PASS | 12 skill nodes bound to objective codes. `focus_objective_ids` is practice-only, and delivered items stay inside the focus (`PAA.skill-practice-only-focus-items`). |
| PAA_BLUEPRINTS | PASS | Lectura: text sets with shared stimuli and inference→evidence pairs. Redacción: 6 operations. Math: 5 domains and 5 SPR. Inglés: language, reading, indirect writing. |
| PAA_SCORING_HONEST | PASS | Raw score + "Preparación estimada StudyUS" + `NO_OFFICIAL_SCALE`. **No 200–800 conversion.** Lectura y Redacción are reported together; Inglés is institution-defined. |
| PAA_RESULTS_BY_AREA_AND_SKILL | PASS | Reporting groups, 20 objectives, each tied to a component. Completion and minutes used are shown. |
| PAA_LEARNING_BRIDGE | PASS (DEV) | «Reforzar ahora» adds the curated canonical concept, idempotently, without creating canonical rows, and then turns into «Reforzar». |
| PAA_DELETE_EVIDENCE_PRESERVATION | PASS | A completed delete is soft, the result is kept, and the new attempt starts from zero. Another student gets 404. |
| PAA_MANUAL_E2E_READY | PASS | `MANUAL_E2E_PAA.md`. |
| PAA_E2E | **NOT DECLARED** | Manual E2E not executed. |

### §54 — IB Diploma Programme

| Verdict | Value | Basis |
|---|---|---|
| IB_ENGINE_SUPPORT | PASS | Unchanged. |
| IB_DP_CATALOG_COVERAGE | 100 % | 35 current subjects/versions: groups 1–6 + TOK, EE, CAS. Legacy courses are excluded; version pairs (History 2028, World religions) are variants. |
| IB_DP_STRUCTURE_COVERAGE | 100 % (62 examinable subject-levels) | Sourced component structure (79 registered sources). There are no invented papers; a test checks that config sections ⊆ guide components per level, and SL never gets HL-only components. |
| IB_DP_PRACTICE_COVERAGE | 19.4 % (12 / 62) | Math AA SL/HL, AI SL/HL, Physics, Chemistry and Biology SL/HL, Visual arts SL/HL. |
| IB_DP_FULL_MOCK_COVERAGE | 19.4 % (12 / 62), reduced length | Physics HL form = 23 % and Chemistry HL = 19 % of official length, disclosed on each form. |
| IB_PHYSICS_STRUCTURE / IB_CHEMISTRY_STRUCTURE / IB_BIOLOGY_STRUCTURE | PASS | 2025 model: P1A + P1B in one sitting (SL 90′ / HL 120′, 36 %), P2 (SL 90′ / HL 150′, 44 %), IA 20 %. **No Paper 3.** The 1A/1B time split is not published and is disclosed. |
| IB_SCIENCE_GRADING | PASS | Units (cm2 = cm² = cm^2, J↔kJ, mol dm⁻³), significant figures, method marks, coefficients as integer parts, signed values. 29 package claims are verified in tests. |
| IB_MATH_AA_AI | PASS | AA SL (P1, P2), AA HL (P1–P3), AI SL/HL (AI HL P3). |
| IB_ARTS_PORTFOLIO | PASS | PortfolioPerformanceAssessment, no papers. Double assessor runs on DEV (scenario `ARTS.*`, ASSESSED with 2 assessments). |
| IB_STRUCTURE_ONLY_NOT_STARTABLE | PASS | 50 structure-only configs are DRAFT and not selectable. `resolveExamLevel` returns null; the badge says «Próximamente». |
| IB_CAS | NOT_EXAMINABLE | Catalogued, never a mock. |
| CHALLENGE_MODE | **PARTIAL** | Banks reach ≈ 1.02×. |
| OFFICIAL_CONTENT_COVERAGE | **0 %** | All items are original StudyUS practice (FIXTURE). |
| OFFICIAL_EXAMINER_EQUIVALENCE | NOT CLAIMED | — |
| IB_MANUAL_E2E_READY | PASS | Math AA HL (updated), Physics HL + Chemistry HL, Visual Arts. |
| IB_E2E / IB_PHYSICS_E2E / IB_CHEMISTRY_E2E | **NOT DECLARED** | Manual E2E not executed. |

### §55 — subject readiness matrix

The full table, generated from the code, is in `IB_DP_SUBJECT_READINESS_MATRIX.md`.

- **FULL_MOCK_READY (SL + HL):** Mathematics AA, Mathematics AI, Physics, Chemistry, Biology, Visual arts. The Learning Bridge is READY for all six.
- **STRUCTURE_READY:** every other examinable subject, plus TOK and EE.
- **NOT_APPLICABLE:** CAS.

### §56 — findings

| Level | Finding |
|---|---|
| P0 | None. |
| P1 | Every Mock is reduced length (PAA 21 %, Physics HL 23 %, Chemistry HL 19 %); full-length mocks need larger reviewed banks. Challenge stays PARTIAL. |
| P1 | PAA research (unscored) items: the guide does not publish where they go, so they are not simulated. |
| P2 | The 39 generated IB subjects show their official **English** names in the Spanish UI. Only the group/level labels and Math are localized. |
| P2 | Source confidence is MEDIUM for Dance, Global politics and Social and cultural anthropology (some marks unpublished). |
| P2 | The learning catalogue is DEV_FIXTURE / NON_OFFICIAL, applied by an operator. Production needs a governed catalogue. |
| P2 | Inglés interpretation depends on `institution_exam_policies`, and DEV has few rows. |
| P3 | No authenticated hosted click-through by Claude (no browser sign-in by policy); it is covered by the manual packages. |

Defects found and fixed in this block:

- Unit-converted rounding tolerance.
- Signed INTEGER/DECIMAL forms.
- «Reforzar ahora» → «Reforzar» subject resolution.
- Readiness badge capped by the modes offered.

### Tests

| Suite | Result |
|---|---|
| Unit (full) | 414 files / **6717 tests** pass. Includes `track-b-v2-completion.test.ts` (PAA, IB catalogue / no invented papers, readiness, coverage, science grading, links, package claims). |
| Typecheck / build | Clean / OK. |
| DEV scenarios V2 (`track-b-v2-scenarios.ts`) | **90 / 90**, with fixtures cleaned. |
| DEV regression V1 (`track-b-exam-scenarios.ts`) | **203 / 203**. |
| Migration cert `track-b-exam-v2-completion-migration-cert.sh` (`CERT_APPLY_V2=1`) | PASS. Idempotent; the rollback applies inside a transaction; 66 configs applied with the second run a no-op; 50 DRAFT. |
| Migration cert V2 (steps 1–4) | PASS, with 20261021 applied on top. |

### Migrations

| | |
|---|---|
| New | `20261021_1000_track_b_exam_v2_completion.sql`: `exam_instances.focus_objective_ids uuid[] NOT NULL DEFAULT '{}'`. Additive, with a documented rollback. |
| `20261020_1000` | Unedited (0-line diff). |
| DEV | 47 applied / **0 pending / 0 drifted**. |

**DEV operator steps run:**

1. `db-migrate.ts`
2. `track-b-v2-apply.ts --write`: 60 created, 6 unchanged, `v2.paa.math` retired, 366 nodes / 285 bound / 0 unresolved.
3. `track-b-v2-learning-catalog.ts --write`: 78 concepts, 11 skills, 5 competencies; 168 / 49 / 32 links; 0 missing targets.
4. `--structure-only` re-apply after the readiness cap fix.

### Stop

Manual E2E packages are ready: `MANUAL_E2E_PAA.md`, `MANUAL_E2E_IB_MATH_AA_HL.md`, `MANUAL_E2E_IB_SCIENCES_HL.md`, `MANUAL_E2E_IB_VISUAL_ARTS.md`. **Stopped before executing the manual E2E.** No PAA / IB / Physics / Chemistry E2E is declared.

---

## Previous candidate (87a5231)

**Candidate SHA (code):** `87a52319ee2bddb4ed19babeb53f5cfadba3b884` (previous: `8bf41c0a`), branch `track-b/exam-architecture-v2`, based on Track B V1 `52de415`. This report is committed on top as a docs-only commit.

**Hosted DEV candidate:** `https://study-rdvb248vz-study-so.vercel.app` (Vercel target `dev`, deployment `dpl_Q3ifFmzdsg3RFSJVjD7SZq4XtkRM`). It supersedes `study-8x5jb2kzh`.

- `/api/version` → `commitSha = 87a52319ee2bddb4ed19babeb53f5cfadba3b884`, so repo SHA = deployed SHA.
- `/api/diagnostics/preview-db` → DB fingerprint `2a29b99ee14a22b4` (DEV), 45 applied migrations.
- The shared alias `study-os-env-dev-study-so.vercel.app` was **not** moved. It still points to Track A's `dpl_92B7rELKYQzdPRnbQCFV26uY3tQR`.
- An earlier deployment from the same commit, `study-778l3t5t4`, carried a mistyped SHA env value. It was superseded, is not aliased, and must not be used.
- Stage and Production were not touched. Track A was not touched.

## Verdicts

| Verdict | Value | Basis |
|---|---|---|
| EXAM_ARCHITECTURE_V2 | **PASS (DEV)** | All §1–§56 surfaces built on the one Exam Core; automated checks green |
| DYNAMIC_EXAM_SELECTION | **PASS** | Catalogue API + UI; `CAT.*` scenarios on DEV |
| ASSESSMENT_SOURCE_REGISTRY | **PASS** | 37 sources with confidence and license; unknown keys refused |
| ASSESSMENT_STRUCTURE_MODEL | **PASS** | 93 nodes, 19 typed node kinds, 18 bindings, 0 unresolved |
| ASSESSMENT_BLUEPRINT_ENGINE | **PASS** | Distributions enforced (PISA 2/2/2/2, Saber 4/5/3, PAA 3×4) |
| PRACTICE_MOCK_SEPARATION | **PASS** | Mock frozen before start, no feedback, Tutor blocked, no regeneration; Practice adaptive with feedback |
| OFFICIAL_FIDELITY_MODE | **PASS** (structure) | Official structure, time ratio and tools. Forms are honestly **REDUCED** (fixture bank size) |
| STRICT_READINESS_MODE | **PASS** | Separate metric, never above the official score, shown apart |
| CHALLENGE_MODE | **PARTIAL** | Engine targets 1.10 and is labelled; current fixture banks reach about 1.02 (band 1.05–1.15 not met), and the UI says so. Needs harder bank items (P2) |
| ASSESSMENT_CALIBRATION_SUITE | **PASS** (infrastructure) | 16/16 benchmark agreement; 0 official exemplars, so no equivalence claim |
| DOUBLE_ASSESSOR_GRADING | **PASS** | Live on DEV: two independent assessments stored, adjudication and REVIEW_REQUIRED paths unit-tested |
| MATHEMATICAL_INPUT_EDITOR | **PASS** (automated) | MathLive editor plus working box wired; visual check is part of the manual E2E |
| MATHEMATICAL_EQUIVALENCE_ENGINE | **PASS** | No eval; equivalence, relations, intervals, mixed numbers, decimal comma |
| UNIT_NORMALIZATION | **PASS** | cm²/cm^2/cm2, m·s⁻¹, conversions only when allowed |
| REQUIRED_FORM_GRADING | **PASS** | EXACT, DECIMAL+dp, SIMPLIFIED_FRACTION, FACTORED, EXPANDED, SCIENTIFIC, INTEGER, significant figures |
| MULTIMODAL_ASSESSMENT_ENGINE | **PASS** | Images and text assessed with vision; PDF, audio and video go to human review |
| IB_ARTS_MEDIA_SUBMISSION | **PASS** | Signed intents, scan, re-encode, thumbnails, signed and owner-checked reads, purge on delete |
| IB_ARTS_RUBRIC_ASSESSMENT | **PASS** | StudyUS practice rubrics totalling the official marks; evidence-backed feedback; no equivalence claim |
| EXAM_ITEM_NOVELTY | **PASS** | Fingerprints, template uniqueness per form, unseen items preferred on retest |
| EXAM_SCORING_STRATEGIES | **PASS** | 12 strategies; persisted per response |
| EXAM_TO_LEARNING_BRIDGE | **PASS** | "Reforzar ahora" goes to the existing concept; "n de m preguntas" shown |
| EXAM_CONCEPT_PROPOSAL_GOVERNANCE | **PASS** | Proposals and requests only; curator API; never creates canonical concepts |
| EXAM_INSTANCE_DELETE | **PASS** | Per-state rules; idempotent; in-progress attempt cancelled; completed = soft delete of the instance only (hidden everywhere; result, responses and evidence preserved) |
| EXAM_COMPLETED_DELETE_EVIDENCE_PRESERVATION | **PASS** | DEV scenarios: result stays SCORED with the same response-set hash; responses and real `learning_evidence` (written through `updateMastery`) unchanged; hidden from exam list, Exam Prep history and the attempt/result pages |
| IB_MATH_AA_HL_MANUAL_E2E_READY | **PASS** | [`MANUAL_E2E_IB_MATH_AA_HL.md`](MANUAL_E2E_IB_MATH_AA_HL.md) — P1, P2, P3 |
| EXAM_DELETE_SECURITY | **PASS** | Owner-scoped in route and service; 404 for others; content untouchable |
| NEW_ATTEMPT_FROM_ZERO | **PASS** | New instance, attempt and form; no drafts, position, score or timer carried over |
| IB_ENGINE_SUPPORT | **PASS** | The transversal engine supports every IB component type (papers, multipart, rubric, portfolio) |
| IB_DP_STRUCTURE_COVERAGE | **PARTIAL** | All six groups and the main subjects are listed with sources and versions; configured: Math AA HL and Visual Arts SL/HL |
| IB_REFERENCE_VERTICAL_READY | **PASS** | Ready for manual E2E |
| IB_ARTS_REFERENCE_VERTICAL_READY | **PASS** | Ready for manual E2E |
| PISA_VERTICAL_READY | **PASS** | Ready for manual E2E |
| SABER_VERTICAL_READY | **PASS** | Ready for manual E2E |
| PAA_VERTICAL_READY | **NEEDS_REDESIGN** | Modelled as a Mathematics-only area; the full PAA (Lectura, Redacción, Matemáticas, Inglés, Full Mock vs Practice) is being redesigned |
| CAMBRIDGE_VERTICAL_READY | **PASS** | Ready for manual E2E |
| EXAM_AUTOMATED_E2E | **PASS** | V2 scenarios 59/59 on DEV (real services, real AI) |
| HOSTED_DEV_READY_FOR_MANUAL_EXAM_E2E | **PASS** | SHA, DB and migrations aligned; unauthenticated gates verified. The authenticated hosted flow was **not** run by Claude: it is the manual E2E |

**Not certified (§59):**

- `IB_E2E`, `PISA_E2E`, `SABER_E2E`, `PAA_E2E` and `CAMBRIDGE_E2E` are **not declared**. They are pending the team's manual E2E ([`MANUAL_E2E_PACKAGES.md`](MANUAL_E2E_PACKAGES.md)).
- `OFFICIAL_EXAMINER_EQUIVALENCE` is **not claimed**: there are no official marked exemplars in the calibration suite.

## Tests

| Suite | Result |
|---|---|
| Unit (vitest), whole repo | **6652 / 6652** (413 files), including 50 new V2 tests |
| Typecheck (`tsc --noEmit`) | clean |
| Build (`next build`) | success |
| V2 migration certification (ephemeral PG18, with catalogue apply) | **PASS** |
| V1 migration certification (with verticals) | **PASS** |
| V2 scenarios on an ephemeral DB (no AI → honest REVIEW_REQUIRED path) | 53 / 53 (before the delete-security additions) |
| V2 scenarios on DEV (real AI for the Arts double assessor) | **59 / 59** |
| V1 Track B scenarios on DEV (regression, real AI) | **203 / 203** |
| Calibration (benchmark, deterministic) | 16 / 16 exact agreement |
| Hosted smoke | version/SHA, DEV DB fingerprint, 401 on every V2 API route, sign-in redirect |

## Migrations

- `20261020_1000_track_b_exam_architecture_v2` applied to DEV through the governed runner.
- `db:status`: **45 applied, 0 pending, 0 drifted**.
- Additive only, with the rollback documented in the file header and certified inside a transaction.
- No applied migration was edited. The only fix (`cardinality` in place of `array_length` for the non-empty components CHECK) was made before any persistent application.

## Findings

- **P0:** none.
- **P1:** none open for DEV. Before any non-DEV environment: replace the heuristic media scanner with a real AV engine and the Postgres media backend with an object store.
- **P2:**
  - Challenge band not reached by the fixture banks (about 1.02).
  - Full Mock forms are REDUCED (bank size).
  - No human review queue UI for REVIEW_REQUIRED responses (status and data exist).
  - Single-vendor assessor independence.
  - No curator UI for concept proposals (admin API only).
- **P3:**
  - Official grade transforms (IB 1–7, Saber 0–100, PAA 200–800) are intentionally not configured, so results show percentages.
  - The superseded deployment `study-778l3t5t4` can be removed.
  - A pre-existing legacy ACTIVE attempt on DEV, noted in V1, is not ours.

## Unsupported components (shown in the catalogue as not available, never simulated)

- **IB:** internal assessments (Math exploration and others); Math AA SL; Math AI SL/HL; Groups 1–4 subjects; Theatre, Music, Film.
- **Cambridge:** IGCSE 0580 Core (P1/P3); AS & A Level 9709.
- **PISA:** Reading and Science.
- **Saber 11:** areas other than Mathematics.
- **PAA:** sections other than Mathematics.
- **AICE:** remains V1 only.
- **Modalities:** oral components; AI assessment of audio, video and PDF pages (these go to human review).

## Official and licensed content coverage

0 official or licensed items. Every V2 item is `content_origin = FIXTURE` (original StudyUS practice) and is labelled "Práctica generada por StudyUS, alineada al formato de ⟨framework⟩".

Structural facts (papers, marks, timing, weights, distributions, calculator rules) come from registered public sources. Confidence is HIGH except where marked: Saber content ranges and Music weightings are MEDIUM; Visual Arts criterion breakdowns are LOW and are not used as criteria.

## Calibration coverage

- 16 StudyUS benchmark cases covering IB, Cambridge, PISA and PAA deterministic strategies: 100 % exact agreement.
- 0 OFFICIAL_EXEMPLAR or RELEASED_SAMPLE cases, so `equivalenceClaimAllowed = false`.
- Rubric and portfolio AI assessment has run live on DEV but has no calibrated benchmark yet.

## Open decisions

1. A production media object store and antivirus engine.
2. A second AI vendor for assessor B (routing policy).
3. Licensing of official content and official marked exemplars for calibration.
4. A human review queue and the reviewer role for REVIEW_REQUIRED.
5. Official grade boundary transforms per framework.
6. Bank expansion to reach FULL fidelity and the Challenge band.

## Stop

Per §60, everything is ready for the team's manual E2E. Work stops here, **before the first manual E2E**.
