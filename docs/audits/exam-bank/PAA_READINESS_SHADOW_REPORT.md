# PAA Readiness Shadow Report — generic engine vs current surfaces

Track B · 2026-10-14 · **DEV only, read only** · the PAA baseline stays frozen at `610d3c6`. Preview, Stage and Production are not touched.

| Gate | Result |
|---|---|
| READINESS_ADAPTER | **PASS**: `src/lib/exam-bank/readiness/bank-readiness-adapter.ts`, 15 unit tests |
| PAA_SHADOW_REPORT | **PASS**: 34 surface comparisons; 29 agree, 5 disagree (§3) |
| PAA_BEHAVIOR_CHANGED | **NO**: no surface is rewired; the DEV state fingerprint is identical before and after (§6) |
| MISSING_DIFFICULTY_FAILS_CLOSED | **PASS** (§5) |

- **Run:** `npx tsx --env-file=<DEV env> scripts/operations/exam-bank/paa-readiness-shadow.ts --out docs/audits/exam-bank/evidence/PAA_READINESS_SHADOW_DEV.json`
- **Generated:** 2026-10-14T15:37:54.956Z
- **Database:** DEV (fp `2a29b99ee14a22b4`, ledger 95)
- **Configuration:** mirrors the PAA Preview (`EXAM_BANK_DELIVERY_SCOPE=PILOT_PREVIEW`, `QUESTION_BANK_READINESS_MODE=ENFORCE`).
- **Exam version:** PAA V2.1 `ebb5f8cc…`. It has 4 components and 20 governed cells, and 655 bank versions were read.

> **What DEV holds:** only the PAA **Mathematics** certified supply (296 core-derived items). The Lectura, Redacción and Inglés pilot supply exists only in the frozen candidate database `neondb_trackb_exam`, which this block does not read. On DEV, PAA is therefore 12/36 by construction. The matrix compares the surfaces with the engine **on the same data**.

## 1. How the shadow works

1. **Adapter (read only).** The adapter turns the bank and its governance into the engine's input:

   | Lineage class | Certification source |
   |---|---|
   | CORE_DERIVED | instance `certification_state` + `assessment_item_instance_refusal(inst)` |
   | PILOT_CERTIFIED | `exam_bank_pilot_item_certifications` + `exam_bank_pilot_certification_in_scope` |
   | LEGACY | `LEGACY_UNGOVERNED` (no certification record exists) |

   It also reads:
   - rights (instance category / refusal, or reuse rights of LEGACY rows);
   - the Question Bank lifecycle / usage axis (`isEligible`), as a separate gate;
   - the response format, from the stored shape, against the runtime's **deterministic** scoring capability (AI-assessed rubric and unkeyed free text are not scorable for readiness);
   - stimulus;
   - the difficulty profile (a missing index stays `null`);
   - exposure, keyed by **bank item**.

2. **Engine.** For each mode, the engine reports status, reasons, coverage, depth, overlap and capabilities:
   - SECTION_PRACTICE per component, and for the whole test;
   - DIAGNOSTIC, reduced MOCK, full MOCK (full-length positions) and CHALLENGE.

3. **Current surfaces.** Each surface is called exactly as the product calls it, then compared:
   - **READY** means the surface offers the activity;
   - anything else means it withholds it;
   - **agreement** means both offer it, or both withhold it.

## 2. Engine verdicts on DEV (PAA V2.1)

| scope | status | covered | certified items | runtime-eligible | unique forms | overlap next form | calibration | blocking reasons |
|---|---|---|---|---|---|---|---|---|
| practice:lectura | NOT_READY | 0/10 | 0 | 0 | 0 | 0 | NOT_REQUIRED | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED, NO_CERTIFIED_SUPPLY |
| practice:redaccion | NOT_READY | 0/6 | 0 | 0 | 0 | 0 | NOT_REQUIRED | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, NO_CERTIFIED_SUPPLY |
| practice:matematicas | READY | 12/12 | 296 | 296 | 13 | 0 | NOT_REQUIRED | — |
| practice:ingles | NOT_READY | 0/8 | 0 | 0 | 0 | 0 | NOT_REQUIRED | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, NO_CERTIFIED_SUPPLY |
| practiceWhole | PARTIAL | 12/36 | 296 | 296 | 0 | 0 | NOT_REQUIRED | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED |
| diagnostic | PARTIAL | 12/36 | 296 | 296 | 0 | 0 | NOT_REQUIRED | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED |
| reducedMock | PARTIAL | 12/36 | 296 | 296 | 0 | 0 | NOT_REQUIRED | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED |
| fullMock | NOT_READY | 0/175 | 296 | 0 | 0 | 0 | NOT_REQUIRED | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED |
| challenge | NOT_READY | 0/36 | 296 | 0 | 0 | 0 | NONE | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, CALIBRATION_REQUIRED, RETIRED |

**Notes**

- **Mathematics practice is READY** with 13 disjoint forms of 12 positions. The figure counts items; distinct wording is lower, as the Content Factory noted.
- **The full mock is NOT_READY.** The 296 Math items carry usage `PRACTICE, REDUCED_MOCK`, so none may enter a FULL mock (`LIFECYCLE_NOT_DELIVERABLE`). They are therefore certified but not deliverable *for that mode*.
- **Challenge is NOT_READY:** no row is calibrated (§5).
- **No Student exposure exists on DEV for PAA** (`exam_item_usage` = 0), so the Student-specific depth is not exercised on DEV. Exposure is proven by unit tests.

## 3. Matrix

| 1 | catalogue | `catalog/structure.service.ts listStructureChildren` | paa.full | NOT_READY | PARTIAL | available=false readiness=STRUCTURE_READY | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 2 | catalogue | `catalog/structure.service.ts listStructureChildren` | paa.practice | NOT_READY | READY | available=false readiness=STRUCTURE_READY | — | **NO** |
| 3 | catalogue | `catalog/structure.service.ts listStructureChildren` | paa.practice.lectura | NOT_READY | NOT_READY | available=false readiness=STRUCTURE_READY | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED, NO_CERTIFIED_SUPPLY | **YES** |
| 4 | catalogue | `catalog/structure.service.ts listStructureChildren` | paa.practice.redaccion | NOT_READY | NOT_READY | available=false readiness=STRUCTURE_READY | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, NO_CERTIFIED_SUPPLY | **YES** |
| 5 | catalogue | `catalog/structure.service.ts listStructureChildren` | paa.practice.matematicas | NOT_READY | READY | available=false readiness=STRUCTURE_READY | — | **NO** |
| 6 | catalogue | `catalog/structure.service.ts listStructureChildren` | paa.practice.ingles | NOT_READY | NOT_READY | available=false readiness=STRUCTURE_READY | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, NO_CERTIFIED_SUPPLY | **YES** |
| 7 | instance API | `structure.service.ts resolveExamLevel` | paa.full MOCK | NOT_READY | PARTIAL | not selectable | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 8 | instance API | `structure.service.ts resolveExamLevel` | paa.full PRACTICE (whole test) | NOT_READY | PARTIAL | not selectable | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 9 | instance API | `structure.service.ts resolveExamLevel` | paa.practice.ingles PRACTICE | NOT_READY | NOT_READY | not selectable | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, NO_CERTIFIED_SUPPLY | **YES** |
| 10 | instance API | `structure.service.ts resolveExamLevel` | paa.practice.lectura PRACTICE | NOT_READY | NOT_READY | not selectable | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED, NO_CERTIFIED_SUPPLY | **YES** |
| 11 | instance API | `structure.service.ts resolveExamLevel` | paa.practice.matematicas PRACTICE | READY | READY | readiness=PRACTICE_READY modes=PRACTICE | — | **YES** |
| 12 | instance API | `structure.service.ts resolveExamLevel` | paa.practice.redaccion PRACTICE | NOT_READY | NOT_READY | not selectable | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, NO_CERTIFIED_SUPPLY | **YES** |
| 13 | Actividades disponibles | `objectives/capabilities.ts computeCapabilities` | practice | READY | READY | available | — | **YES** |
| 14 | Actividades disponibles | `objectives/capabilities.ts computeCapabilities` | diagnostic | READY | PARTIAL | available | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **NO** |
| 15 | Actividades disponibles | `objectives/capabilities.ts computeCapabilities` | Simulacro reducido (PreparationHome card) | NOT_READY | PARTIAL | PRACTICE_ONLY | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 16 | Actividades disponibles | `objectives/capabilities.ts computeCapabilities` | full mock | NOT_READY | NOT_READY | PRACTICE_ONLY | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 17 | Simulacro reducido card | `assessment-experience.service.ts examAvailabilityForVersion` | REDUCED_MOCK | NOT_READY | PARTIAL | CONTENT_NOT_READY | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 18 | Simulacro reducido card | `assessment-experience.service.ts examAvailabilityForVersion` | FULL_MOCK | NOT_READY | NOT_READY | CONTENT_NOT_READY | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 19 | Simulacro reducido card | `assessment-experience.service.ts examAvailabilityForVersion` | EXAM_PRACTICE | READY | READY | available (eligibleQuestions=296) | — | **YES** |
| 20 | Challenge | `(a) question-bank/readiness-overlay.ts overlayNodeReadiness -> catalog/readiness.ts modesFor` | paa.full | NOT_READY | NOT_READY | overlay modes=none | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, CALIBRATION_REQUIRED, RETIRED | **YES** |
| 21 | Challenge | `(b) structure.service.ts offeredModes (resolveExamLevel)` | paa.full | NOT_READY | NOT_READY | offered modes=none | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, CALIBRATION_REQUIRED, RETIRED | **YES** |
| 22 | Challenge | `(c) objectives/capabilities.ts computeCapabilities` | PAA objective | NOT_REPRESENTED | NOT_READY | capabilities carry no Challenge (practiceModes only) | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, CALIBRATION_REQUIRED, RETIRED | **NO** |
| 23 | Challenge | `(d) assessment-experience/views.ts examAttemptOptions` | EXAM_CHALLENGE | NOT_READY | NOT_READY | DIFFICULTY_NOT_CALIBRATED | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, CALIBRATION_REQUIRED, RETIRED | **YES** |
| 24 | Challenge | `(e) exam-core/form-fidelity.ts deriveInstanceAttemptType` | mode CHALLENGE at start | READY | NOT_READY | always startable | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, CALIBRATION_REQUIRED, RETIRED | **NO** |
| 25 | Calibrated difficulty | `C7 examVersionHasCalibratedDifficulty` | PAA version | NOT_READY | NOT_READY | no index present | CALIBRATION_REQUIRED | **YES** |
| 26 | Calibrated difficulty | `Health FULL_MOCK_CALIBRATED` | PAA version | NOT_READY | NOT_READY | ["FULL_MOCK_READY = NO","Lectura · paa.lect.evidencia: 0/4 (faltan 4)","Lectura · paa.lect.explicitas: 0/9 (faltan 9)","Lectura · paa.lect.graficos: 0/5 (faltan 5)","Lectura · paa.lect.inferencia: 0/9 (faltan 9)","Lectura · paa.lect.literario: 0/9 (faltan 9)","Lectura · paa.lect.vocabulario: 0/9 (faltan 9)","Redacción · paa.red.adicion: 0/4 (faltan 4)","Redacción · paa.red.cohesion: 0/4 (faltan 4)","Redacción · paa.red.elision: 0/4 (faltan 4)","Redacción · paa.red.generalizacion: 0/5 (faltan 5)","Redacción · paa.red.integracion: 0/4 (faltan 4)","Redacción · paa.red.particularizacion: 0/4 (faltan 4)","Matemáticas · paa.mat.algebra: 0/14 (faltan 14)","Matemáticas · paa.mat.aritmetica: 0/14 (faltan 14)","Matemáticas · paa.mat.datos: 0/9 (faltan 9)","Matemáticas · paa.mat.geometria: 0/14 (faltan 14)","Matemáticas · paa.mat.probabilidad: 0/4 (faltan 4)","Inglés como lengua extranjera (ESLAT) · paa.ing.lectura: 0/19 (faltan 19)","Inglés como lengua extranjera (ESLAT) · paa.ing.lenguaje: 0/19 (faltan 19)","Inglés como lengua extranjera (ESLAT) · paa.ing.redaccion: 0/12 (faltan 12)"] | CALIBRATION_REQUIRED | **YES** |
| 27 | Admin health / coverage report | `scripts/operations/exam-bank/paa-coverage.ts (live)` | reduced blueprint coverage | NOT_READY | PARTIAL | 12/36 positions | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 28 | Admin health / coverage report | `question-bank/health.ts readinessFrom (live)` | reducedMock gate | NOT_READY | PARTIAL | 20 cells short (mockEligible counted from the FULL_MOCK pool, see D5) | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 29 | Admin health / coverage report | `question-bank/health.ts ComponentAssembly (live)` | lectura practice | NOT_READY | NOT_READY | practice=false reducedAssembles=false | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED, NO_CERTIFIED_SUPPLY | **YES** |
| 30 | Admin health / coverage report | `question-bank/health.ts ComponentAssembly (live)` | redaccion practice | NOT_READY | NOT_READY | practice=false reducedAssembles=false | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, NO_CERTIFIED_SUPPLY | **YES** |
| 31 | Admin health / coverage report | `question-bank/health.ts ComponentAssembly (live)` | matematicas practice | READY | READY | practice=true reducedAssembles=true | — | **YES** |
| 32 | Admin health / coverage report | `question-bank/health.ts ComponentAssembly (live)` | ingles practice | NOT_READY | NOT_READY | practice=false reducedAssembles=false | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, NO_CERTIFIED_SUPPLY | **YES** |
| 33 | Admin health (persisted) | `health.service.ts latestSnapshots (what the ENFORCE overlay reads)` | reducedMock gate | NOT_READY | PARTIAL | snapshot qb-health-v2 2026-10-14T00:52:50.813Z | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |
| 34 | Legacy full-mock guard | `assessment/full-mock-guard.service.ts canFullMockBeOffered` | FULL_MOCK | NOT_READY | NOT_READY | NO_REAL_MOCK_CONTENT × 36 objective rows | BUCKET_UNCOVERED, NOT_CERTIFIED, LINEAGE_INCOMPLETE, RIGHTS_NOT_CLEARED, LIFECYCLE_NOT_DELIVERABLE, RETIRED | **YES** |

## 4. Disagreements, exactly

### Status-level (the 5 rows marked NO)

**D1. Catalogue tree vs instance API (#2, #5 vs #11).**
- `listStructureChildren` reads the persisted node rows and applies **no** ENFORCE bank overlay. On DEV it shows `paa.practice` and `paa.practice.matematicas` as `available=false` with readiness `STRUCTURE_READY`.
- `resolveExamLevel` applies the overlay and offers Mathematics PRACTICE. The engine says READY.
- The tree hides what the API would start.

**D2. Diagnostic (#14).**
- `computeCapabilities` sets `canRunDiagnostic = canPractice`. The diagnostic exists as soon as one area is practice-ready, and on DEV it samples Mathematics only.
- The engine evaluates the diagnostic against the governed 4-component blueprint: PARTIAL, 12/36.
- A "PAA diagnostic" covering 1 of 4 components is offered as available.

**D3. Challenge (c), `computeCapabilities` (#22).** Challenge is not represented at all. The capabilities carry only practice modes, so "Actividades disponibles" can neither offer Challenge nor explain why it is missing.

**D4. Challenge (e), `deriveInstanceAttemptType` (#24).**
- `mode: CHALLENGE` is **always startable**; nothing at start checks calibration.
- Today Challenge is withheld upstream: (b) `offeredModes` plus the instance API's `MODE_NOT_AVAILABLE`. Any other path to an instance with `mode: CHALLENGE` would start it.

**D3/D4 combined with (a), (b), (d).** Challenge is decided in five places with three different rules:

| Location | Rule | Row |
|---|---|---|
| (a) overlay / `modesFor` | follows readiness only, no calibration | #20 |
| (b) `offeredModes` | the C7 calibration rule | #21 |
| (c) capabilities | not represented | #22 |
| (d) `examAttemptOptions` | the C7 rule | #23 |
| (e) start | always startable | #24 |

On DEV, (a), (b) and (d) agree with the engine (NOT_READY), but each for its own reason.

### Detail-level (the status agrees, the reasons do not)

**D5. Health reduced-mock reasons count the FULL_MOCK pool.**
- `computeBankHealth` counts `mockEligible` from the FULL_MOCK pool (`health.ts:302`, `mockIds = inSet(fullPool)`).
- `readinessFrom` compares that count with **reduced** positions (`health.ts:431`).
- Result: the reasons say "Matemáticas · paa.mat.algebra: 0/3 (faltan 3)", although the reduced Math form assembles (`reducedAssembles = true`, #31) and the engine counts 12/12 Math positions.
- Admin / coverage reasons are therefore misleading for any REDUCED_MOCK-only supply, which includes all core-derived content.

**D6. Three meanings of "calibrated difficulty"** (§5). All three answer "not calibrated" on DEV today, so they agree, but they disagree on *why*. C7 would flip to "calibrated" on any authored index: 63 rows on DEV carry one, none deliverable.

**D7. LEGACY content.**
- `certifiedSupplySql` is TRUE for every LEGACY row, so LEGACY content is deliverable whenever its lifecycle allows.
- The engine marks LEGACY as `LEGACY_UNGOVERNED`, i.e. not certified.
- On DEV the PAA LEGACY rows are also lifecycle-blocked, so the statuses agree. The difference becomes visible in families whose LEGACY rows are ACTIVE.

### The known reduced-mock card contradiction (PAA-FOLLOWUP-01)

- **On DEV it does not show.** With Mathematics-only supply, both the card (#17, `officialForm: null` → `CONTENT_NOT_READY`) and "Actividades disponibles" (#15) withhold the reduced mock, and the engine agrees (PARTIAL).
- **On the frozen Preview (36/36) they contradict each other.** This block does not read the candidate database.
- **Reproduced without a database** by `tests/unit/exam-bank-readiness-adapter.test.ts` ("the reduced-mock card contradiction"): on full synthetic supply the engine says READY, while `examAttemptOptions(officialForm: null)` says `REDUCED_MOCK: CONTENT_NOT_READY`.
- **The card can never be available**, whatever the bank holds.

## 5. Calibrated difficulty: the definitions side by side, and the fail-closed proof

| Definition | Rule | DEV verdict |
|---|---|---|
| C7 examVersionHasCalibratedDifficulty (assessment-experience.service.ts:143) | any Student-deliverable version has difficulty_index OR content.difficultyIndex | False |
| Health FULL_MOCK_CALIBRATED (question-bank/lifecycle.ts DEFAULT_ELIGIBILITY) | calibration_confidence >= MODERATE_CONFIDENCE and a full calibrated form assembles | False |
| form-assembly.ts DEFAULT_INDEX | a missing difficultyIndex is read as 1.0 (the official difficulty) | every uncalibrated item counts as exactly on-target |
| Engine isCalibrated (exam-bank-readiness-1) | EMPIRICAL source, sample >= 200, fresh, with an exam-relative index; a missing index is NOT_CALIBRATED | 0 calibrated of 655 rows (63 carry any index) |

**MISSING_DIFFICULTY_FAILS_CLOSED = PASS** (`tests/unit/exam-bank-readiness-adapter.test.ts`):

- **A missing index.** `difficultyProfileOfRaw` returns `difficultyIndex: null`. `calibrationStatusOf` returns `NOT_CALIBRATED`, and `calibratedDifficultyIndex` returns `null`, **never 1.0**.
- **An authored index of exactly 1.0.** It is an `AUTOMATED_PRIOR` (sample 0): `NOT_CALIBRATED`, usable index `null`.
- **Field evidence.** It calibrates only with an EMPIRICAL sample ≥ 200, fresh (≤ 730 days) and an exam-relative index. Without the index it stays `NOT_CALIBRATED`.
- **Challenge on uncalibrated supply** (including authored 1.0 indices): `NOT_READY` with `CALIBRATION_REQUIRED` and `difficultyCapability: NONE`, while practice on the same supply is READY.
- **Frozen behaviour, not changed.** `form-assembly.ts` `DEFAULT_INDEX = 1.0` still reads a missing index as on-target, and C7 still accepts any authored index. Fixing either changes PAA runtime and catalogue behaviour, so both wait for the freeze to lift.

## 6. Read-only proof

- **Fingerprint guard.** Any database other than DEV `2a29b99ee14a22b4` is refused before the first query.
- **Statement guard** (`src/lib/exam-bank/readiness/read-only-guard.ts`, unit-tested). Every statement on the pool and on checked-out clients is inspected, and anything but a read is refused. No statement was refused during the run.
- **State fingerprint.** Taken before and after; it is identical:

| ledger | exam_instances | exam_attempts | responses | evidence | usage | health snapshots | plan entries | nodes md5 | items md5 | instances md5 |
|---|---|---|---|---|---|---|---|---|---|---|
| 95 | 0 | 0 | 0 | 0 | 0 | 313 | 0 | `360978eb3eae…` | `74f613affa1b…` | `19b7bd0f1934…` |

## 7. Appendix: IB Mathematics AA HL on DEV, through the same adapter and engine

| scope | status | covered | certified items | rows by format | rows by certification |
|---|---|---|---|---|---|
| practice:p1 | NOT_READY | 0/5 | 0 | {"MULTI_PART": 4, "NUMERIC_ENTRY": 4, "MATH_EXPRESSION": 1} | {"LEGACY_UNGOVERNED": 9} |
| practice:p2 | NOT_READY | 0/4 | 0 | {"MULTI_PART": 3, "NUMERIC_ENTRY": 4} | {"LEGACY_UNGOVERNED": 7} |
| practice:p3 | NOT_READY | 0/1 | 0 | {"MULTI_PART": 2} | {"LEGACY_UNGOVERNED": 2} |
| reducedMock | NOT_READY | 0/10 | 0 | {"MULTI_PART": 9, "NUMERIC_ENTRY": 8, "MATH_EXPRESSION": 1} | {"LEGACY_UNGOVERNED": 18} |

- **What the engine sees.** The only IB rows the engine can see on DEV are 18 `DEV_CERT_FIXTURE` LEGACY versions, and none is certified.
- **The 30 certified IB instances** (`AUTOMATED_CERTIFIED_PILOT`, database refusal `NULL`) have **no bank row**, so no consumer can see them. They are CERTIFIED_NOT_DELIVERABLE at the projection (`IB_CONSTRUCTED_RESPONSE_GAP.md` §6).

## 8. Next (after the freeze lifts; none done here)

R3 of `EXAM_BANK_READINESS_ENGINE.md`, one consumer at a time behind a flag:

1. Catalogue tree (D1).
2. Diagnostic scope (D2).
3. The reduced-mock card (PAA-FOLLOWUP-01).
4. Challenge: one rule, gated at start (D3/D4).
5. Health reasons from the reduced pool (D5).
6. One calibration definition (D6).
7. Decide what LEGACY means for Students (D7).
