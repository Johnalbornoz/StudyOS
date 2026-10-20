# Overnight pilot convergence report — 2026-10-14

| | |
|---|---|
| Line | `studyos-curriculum-first` (branch `feat/curriculum-first-learning`), base `333f61b3` → tip `fe440882` |
| Frozen PAA fallback | `preview.studyus.pro`, verified at the end of the run through `/api/version`: commit `610d3c66e145`, deployment `dpl_E46ptSYC…` — **untouched** |
| Environments written | DEV only (fp `2a29b99ee14a22b4`). Nothing written to Stage, Production, the frozen PAA database or the Preview alias |
| Standardized-exam provider calls | 0 |

## Executive table

| Front | State | One line |
|---|---|---|
| FOUNDATION | GREEN | Unit suite 607 files: 11,170 pass, 0 fail. Typecheck, build and the PAA plan hash (`a9906fa3`) are unchanged. |
| LEARNING | GREEN | `curriculum-first-learning-scenarios` on DEV: 28/28. Covers Learning, AD_HOC, timed, scheduled, and Internal Assessment writing to the Knowledge State. |
| AD_HOC | GREEN | Same run: AD_HOC, timed (planned times within the limit), scheduled (409 before due, then SCHEDULED → STARTED → COMPLETED). |
| EXAM_EVIDENCE | YELLOW | S1–S4 implemented and on DEV. Readers (S3) and the UI do not yet show Exam Readiness. See E-1. |
| READINESS | YELLOW | One generic engine report covers every exam. Challenge calibration now fails closed. Most surfaces are not yet rewired to the engine. See R-1 and R-2. |
| PAA | GREEN on DEV (Math); see P-1 | `exam-runtime-scenarios`: 43/43 in SEPARATED and 43/43 in LEGACY. Lectura, Redacción and Inglés supply exists only in the frozen candidate DB. |
| CAMBRIDGE | GREEN in DEV (P1 pilot) | Official source governed, adapter certified (pilot), 8/8 sections, 237 items. Complete form plus DEV attempt plus scoring: 13/13. |
| IB | YELLOW | 241 runtime-eligible items. P1 has 4 of 5 objectives covered and P2 has 2 of 4. The complete form fails closed (`aahl.p1.extended` has 0 items). |
| PISA | RED | No certified supply. Stimulus units are not runtime-supportable yet. See X-1. |
| SABER | RED | No certified supply. Needs selected-response deterministic capability and a governance decision on content-category concepts. See X-2. |
| AICE | RED | Equivalence NOT_GOVERNED. `AICE.9709.PURE` has no governed rule profile. See X-3. |
| ROLES | YELLOW | Matrix ready (`docs/pilot/FULL_ROLE_E2E_MATRIX.md`). Automated isolation suites pass. Clerk fixtures can only be provisioned by the operator. |
| SECURITY | GREEN | No secret written. The DEV-only fingerprint guards hold. The IBO PDF 403 was not bypassed. No account was created on an external service. |
| BUILD | GREEN | `npm run build` exit 0. `tsc --noEmit` clean. |
| PREVIEW_CANDIDATE | YELLOW | The code is ready. It is not deployed: the Vercel CLI is absent here, and a candidate database needs the operator. See K-1. |

## Commits (tip `fe440882`)

| Commit | What |
|---|---|
| `b54d19d6` | 7 IB StudyUs concept identities set to GOVERNED_PILOT. Decision `IB-CONCEPT-IDENTITIES-2026-10-14`: ARCHITECTURE_GOVERNANCE_DECISION, PILOT scope, human reviewer empty. Adds the IB applicability register and the P1 algebra/calculus and P2 statistics classifications. CF-IB-AAHL-01-R1 pinned and accepted. |
| `50a49ef0` | CF-IB-AAHL-01-A2: eight CF constructs copied byte-for-byte; the copy reproduces all 300 pinned candidates. 240 SHORT_RESPONSE items. Correspondence source-text states recorded. |
| `a61a8325` | Cambridge 9709 command words governed from the official syllabus. The archived V5.2 run and its batch use `V52_ASSESSMENT_REGISTRY`, so the plan hash is unchanged. |
| `d4a5362d` | Cambridge 9709 P1 pilot: vertical, 8/8 sections, correspondences, classification, 237 items. Projection 3 extended to CAMBRIDGE. |
| `bae3df16` | Exam evidence separation: migration `20261125_1000`, writer, reader, `EXAM_EVIDENCE_KNOWLEDGE_STATE` flag. |
| `d812c270` | Full role E2E matrix. |
| `9f67e6a1` | Challenge requires an EMPIRICAL calibration. |
| `fe440882` | DEV scenarios and evidence. |

## IB

The R1 package was compared field by field against the governed renders, using `src/lib/exam-bank/cf-r1-convergence.ts`.
- **Result.** 30 of 30 candidates match on every identity field: parameter set, prompt, key, policy, marks, rubric shape, concept, bucket, lineage, format and Bank projection 3.
- **Deltas owned by governance.** These are named rather than reconciled: the rubric code label (`KEY` versus `A<n>`), the seed, and the envelope hash. The envelope differs only by `commandTerms: ['find']`.
- **First delivered item.** The first DEV item (key 83/4) is R1 candidate `1236bb36…`. Track B recorded the R1 identity (`CF_IB_AAHL_01_R1`) and did not duplicate the DEV identity.

Concept source backing. The IBO guide PDF returned HTTP 403 and that was not bypassed.

| Concepts | State |
|---|---|
| 1 of 10 (quadratics) | `OFFICIAL_GUIDE_TEXT_SOURCE_BACKED` |
| 9 of 10 | `PILOT_SYLLABUS_CORRESPONDENCE_SOURCE_TEXT_REVALIDATION_PENDING`, recorded in code and tested |

These nine are not HUMAN_CERTIFIED and are not claimed as official IB concepts. CF proposes different identifiers for some of them (for example `math.alg.geometric-series` and `math.calc.derivatives`). The governed StudyUs identities are the existing catalogue rows, and the identifiers CF declares are reported, not adopted.

Bulk dry run (`cf-package-dry-run-2`):

| Package | Content | Governance | Format |
|---|---|---|---|
| Original 300 | CONTENT_VALID | only BUCKET_CERTIFIED fails, 30 times | FORMAT_REPROJECTION_REQUIRED (NUMERIC_ENTRY, 300) |
| R1 (30 candidates) | CONTENT_VALID | GOVERNANCE_PASSED | FORMAT_COMPATIBLE |

The 30 BUCKET_CERTIFIED failures are the inverse-function construct. The human-certified bucket D02 places only quadratics, and automation never re-places a human bucket.

| Metric | Value |
|---|---|
| Format-compatible candidates | 30 of 300 (R1). Track B re-projected 240 more (A2) into SHORT_RESPONSE |
| Format reprojection remaining | 30 (INVERSE_FUNCTION_VALUE). Format-ready, but blocked by the D02 bucket |
| Bank and certification | 271 certified IB instances: 30 historic, CERTIFIED_NOT_DELIVERABLE (WORKING_MARKED_WITHOUT_MACHINE_MARK_SCHEME); 1 + 240 runtime-eligible |
| Pilot blueprint coverage | 6 of 9 (P1: algebra, functions, calculus ×2; P2: statistics ×2) |
| Missing | `aahl.p1.extended` (1), `aahl.p2.trigonometry` (1), `aahl.p2.extended` (1). No content; no governed concept identity for trigonometry |
| P1 complete form | NOT_READY (fails closed in DEV: 3 of 4 objectives served) |
| P2 adapter | AUTOMATED_CERTIFIED_PILOT |

## Cambridge (P0)

| | |
|---|---|
| `CAMBRIDGE_OFFICIAL_SOURCE` | PASS |
| `CAMBRIDGE_SOURCE_URL` | https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf |
| `COMMAND_TERMS_SOURCED` | PASS |
| `CAMBRIDGE_9709_P1_ADAPTER` | AUTOMATED_CERTIFIED_PILOT |
| `CAMBRIDGE_P1_SECTIONS_GOVERNED` | 8/8 |
| `CAMBRIDGE_CERTIFIED_BANK_ITEMS` | 237 |
| `CAMBRIDGE_RUNTIME_ELIGIBLE_ITEMS` | 237 |
| `CAMBRIDGE_PILOT_BLUEPRINT_COVERAGE` | 8/8 |
| `CAMBRIDGE_FIRST_COMPLETE_FORM` | READY |
| `CAMBRIDGE_DEV_ATTEMPT` | PASS |
| `CAMBRIDGE_DEV_SCORING` | PASS |
| `CAMBRIDGE_RUNTIME_PROVIDER_CALLS` | 0 |
| `CAMBRIDGE_PILOT_READY` | YES in DEV, for the P1 representative pilot. Browser and candidate checks remain (K-1) |

**Source.** The syllabus is version 4 (December 2025), sha256 `dd0131f3cd8d4e3c…`, retrieved 2026-10-14 by a plain GET (HTTP 200). The PDF is not committed. The extract records the locators: command words on p.42, the Paper 1 assessment overview on p.14, and sections 1.1–1.8 on pp.19–22.
- File: `docs/exams/sources/cambridge-9709/CIE_9709_2026_2027_SOURCE_EXTRACT.json`.
- The source key `cie-9709-syllabus-2026-2027` was already registered with this exact URL.

**Command words.** The 11 words of the syllabus table are an OFFICIAL rule of the CAMBRIDGE.9709.P1 pair, bound to the governed syllabus (`cambridge9709P1BoundToGovernedSyllabus`). The EA-1 profile file is not edited, because historic runs hash it. "find" and "write down" are not governed 9709 command words, and every Cambridge prompt uses a governed word.

**Correspondences.** Each official section maps to StudyUs canonical concepts, at PILOT scope with no reviewer:

| Section | StudyUs concept(s) |
|---|---|
| 1.1 | `math.alg.quadratics` |
| 1.2 | `math.fun.rational-functions-inverses`, plus `math.fun.functions` |
| 1.3 | `math.geo.coordinate-plane`, plus `math.fun.linear-functions-lines` |
| 1.4 | `math.geo.circles` |
| 1.5 | `math.trig.ratios` |
| 1.6 | `math.alg.sequences-series` |
| 1.7 | `math.calc.differentiation` |
| 1.8 | `math.calc.integration` |

The identities for 1.2 (additional), 1.3 and 1.4 are `CROSS_CURRICULUM_CANONICAL_IDENTITY`, with `label_locale_mismatch` and `CROSS_LANGUAGE_IDENTITY_REVIEW = PENDING`, as John decided. Each section keeps its own syllabus scope.

**Runtime.**
- Vertical `v2.cambridge.9709-as` (Cambridge system, programme Cambridge International AS & A Level) is applied on DEV. Its own objective is `cie.asal.cambridge.9709.as`; the AICE objective is unchanged.
- Readiness from the generic engine: practice, diagnostic and reduced mock are READY 8/8. Challenge is NOT_READY (CALIBRATION_REQUIRED).

**DEV scenario** (`governed-form-scenario.ts`, 13/13 PASS). It covers:
- a frozen whole-section form with 8 positions, one per section, and no key on the wire;
- keyed answers scoring full marks on all 8, and wrong answers scoring 0;
- 0 provider calls, no plan entry, and no Knowledge State or Learning evidence;
- 16 Exam Readiness rows for a Student who owns no learner concept (off-plan).

**Remaining Cambridge blockers.**
1. A browser check on an immutable candidate (K-1).
2. Every item is answer-marked SHORT_RESPONSE; method-marked structured questions are not in the supply yet.
3. The form is reduced: 8 of the paper's 10–12 questions.
4. Trigonometry has 7 Foundational parameter sets (by construction, collision filter).
5. The pilot correspondences, including the cross-language identity review, need human review before production.

**AICE.** `AICE_P1_EQUIVALENCE = NOT_GOVERNED`. What AICE could reuse later: the 9709 source extract, the command words, the sections and the 237 items. That reuse needs an explicit source-backed AICE → Cambridge equivalence first.

## Exam evidence separation

| | |
|---|---|
| Invariant | LEARNING + INTERNAL_ASSESSMENT → Knowledge State; EXAM_ASSESSMENT → Exam Readiness |
| S1 | `database/migrations/20261125_1000_exam_readiness_evidence.sql`. Additive. Applied on DEV through the governed `db-migrate` (dry run first: it was the only pending migration). DEV ledger 95 → 96 |
| S2 | `recordExamReadinessEvidence` runs in `finalizeExamCompletion`. Every response is recorded against the item's PRIMARY canonical concept and its exam context, with no learner concept and no plan entry. It is idempotent |
| S3 | `examReadinessOf(studentId, examVersionId?)`. No route or UI uses it yet |
| S4 | `EXAM_EVIDENCE_KNOWLEDGE_STATE`: SEPARATED (default) stops exam responses reaching `updateMastery` on both the canonical loop and the legacy simulation path. LEGACY is the operator rollback. Exam Readiness is written in both modes |

Proof:
- **Off-plan exam evidence.** Cambridge 16 rows with 0 owned concepts. IB P1 6 rows.
- **Knowledge State.** Unchanged: 0 → 0. Learning evidence 0.
- **PAA.** 43/43 SEPARATED, with readiness rows on the PRIMARY concept 12/12 and assisted responses not independent (9 + 3). 43/43 LEGACY.
- **Internal Assessment.** Still writes INTERNAL_ASSESSMENT evidence (A6 and T6 PASS).
- **Exam-gap recommendations.** `refreshExamGapRecommendations` still creates EXAM_GAP recommendations, never plan entries.

**E-1 (non-green).**
- The exam-prep readers (readiness snapshot, preparation home, results) still read the Knowledge State, which no longer receives exam evidence in SEPARATED mode.
- Module: `src/lib/exam-core/objectives/*`, `src/lib/assessment-experience/*`.
- Next action: switch them to `examReadinessOf`. Scope: about 1 day.
- Blocks Friday E2E: no. The flows run; the exam-prep readiness signal is empty instead of contaminated.
- If the readiness signal must show on Friday, set `EXAM_EVIDENCE_KNOWLEDGE_STATE=LEGACY` on the candidate. That restores the frozen behaviour.

## Readiness single authority

- `scripts/operations/exam-bank/exam-readiness-report.ts` runs every configuration through the one adapter and engine. DEV report: `docs/audits/exam-bank/evidence/EXAM_READINESS_REPORT_DEV_2026-10-14.json`.
- Difficulty: a missing or manually populated index is no longer CALIBRATED (`examVersionHasCalibratedDifficulty` requires EMPIRICAL, at least 200 responses, not stale). Challenge fails closed. In DEV and in the candidate, Challenge is therefore not offered for any exam. This changes PAA behaviour (it was already hidden on 610d3c6).

**R-1 (non-green).**
- Catalogue (structure.service ENFORCE overlay), preparation capabilities, bank health, the reduced-mock card (PAA-FOLLOWUP-01) and the exam-instance Challenge start still compute their own rules. This is the 16 disagreements in `EXAM_BANK_READINESS_ENGINE.md` §2.
- Next action: route each through `evaluateExamBankReadiness`. Scope: 1–2 days.
- Blocks Friday E2E: no.

**R-2 (non-green).**
- A partial section starts as practice: IB P1 served 3 of 4 objectives, while the engine says PARTIAL.
- Module: `exam-instance.service` form assembly.
- Next action: gate the start on the engine's status for complete-form modes. Scope: about 0.5 day.
- Blocks Friday E2E: no (IB is not READY anyway).

## PAA

- **P-1.** DEV holds only PAA Matemáticas supply: 12 of 36 positions. Lectura, Redacción and Inglés (67 items) exist only in the frozen candidate DB `neondb_trackb_exam`, which this run never touched.
- **Morning action.** Clone that database into a new candidate database (K-1). Then run `paa-full-scenarios.ts` (Math, Reading, Writing, English and the 36-position mock) against the clone. This step blocks Friday's PAA regression on the converged code.
- Plan hash `a9906fa3` is unchanged, asserted by the unit suite and printed by the DEV publication.

## PISA / Saber / AICE — exact blockers (no paid generation was started)

**X-1 PISA.** Stimulus units with linked items are not deliverable yet:
- The Exam Bank stimulus persistence is not wired.
- The readiness capability vocabulary has only `TEXT_PASSAGE`.
- Certification gate `STIMULUS_NOT_SUPPORTED` (`certification-state.ts:104`).
- No deterministic PISA construct exists.

The smallest path: wire stimulus persistence plus SR delivery, then add 4 units × 2 deterministic items. Scope: about 2–3 days.

**X-2 Saber 11 V2.1.**
- The parametric strategy renders NUMERIC_ENTRY and SHORT_RESPONSE only. The Saber adapter is SELECTED_RESPONSE-only, and projection 3 does not include selected response.
- The objectives are competencies only, with no concept links by design. A governance decision is needed (official content category → StudyUs concept correspondence) before any core can certify.

The smallest path: a deterministic SR strategy (distractors from misconception models) plus that decision, then a 9-cell representative form. Scope: about 2 days plus the decision.

**X-3 AICE.**
- No source-backed AICE → Cambridge adapter equivalence.
- `AICE.9709.PURE` is derived from a generation profile, with no governed rule profile (`GOVERNED_RULE_PROFILE` fails).

The smallest path: an explicit equivalence decision citing the AICE curriculum source (`cie-aice-curriculum`) for 9709 AS P1, then reuse the governed CAMBRIDGE.9709.P1 pair. P5 needs its own construct set.

## K-1 Morning candidate

**Not deployed.** The Vercel CLI is not installed here, and every candidate so far has needed its own database.
- The frozen PAA database (`4c249c68e0627b9f`) must not be mutated.
- DEV lacks PAA Lectura, Redacción and Inglés.

Steps (operator):
1. Create a Neon branch or clone of `neondb_trackb_exam`. It becomes a NEW database with a new fingerprint; the frozen one is never written.
2. Add the new fingerprint to the publication `AUTHORISED_TARGETS` and the scenario `TARGETS`. This is a one-line, reviewed change.
3. Run, against the clone:
   1. `scripts/db-migrate.ts --dry-run`. Expect only `20261125_1000`.
   2. `scripts/db-migrate.ts`.
   3. `scripts/operations/exam-bank/apply-cambridge-9709-vertical.ts --write`.
   4. `publish-certified-supply.ts` (dry run), then `--apply`.
4. Deploy tip `fe440882` as an immutable Preview bound to the clone, with these settings:

   | Variable | Value |
   |---|---|
   | `EXAM_BANK_DELIVERY_SCOPE` | `PILOT_PREVIEW` |
   | `QUESTION_BANK_READINESS_MODE` | `ENFORCE` |
   | `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED` | `true` |
   | `EXAM_EVIDENCE_KNOWLEDGE_STATE` | `SEPARATED`, or `LEGACY` per E-1 |

   Do not move `preview.studyus.pro`.
5. Run against the candidate DB: `paa-full-scenarios`, `exam-runtime-scenarios`, and `governed-form-scenario --config v2.cambridge.9709-as --section p1 --system CAMBRIDGE`. Then the browser role matrix.

## FINAL RETURN

```
OVERNIGHT_RUN = PARTIAL
PAA_FALLBACK_ALIAS_SHA = 610d3c6
PAA_FALLBACK_UNTOUCHED = YES
PAA_PLAN_HASH = a9906fa3
LEARNING = READY
AD_HOC = READY
TIMED_AD_HOC = READY
SCHEDULED_AD_HOC = READY
EXAM_EVIDENCE_SEPARATION = PARTIAL   (S1-S4 done and proven on DEV; exam-prep readers not switched)
READINESS_SINGLE_AUTHORITY = PARTIAL
PAA = READY (DEV Math 43/43 both modes; full 36 needs the candidate clone)
IB = PARTIAL                IB_BLUEPRINT = 6/9
CAMBRIDGE = READY (DEV P1 pilot)   CAMBRIDGE_BLUEPRINT = 8/8
PISA = FAIL                 PISA_BLUEPRINT = 0/8
SABER = FAIL                SABER_BLUEPRINT = 0/9 (representative) · 0/50 (V2.1)
AICE = FAIL                 AICE_BLUEPRINT = 0/4 (P1)
STANDARDIZED_EXAM_RUNTIME_PROVIDER_CALLS = 0
ROLE_FIXTURES = READY (tool + personas; provisioning is an operator step; G1 Student B to add)
ROLE_E2E_MATRIX = READY
STUDENT_ISOLATION_AUTOMATED = PASS
PARENT_SCOPE_AUTOMATED = PASS
TEACHER_SCOPE_AUTOMATED = PASS
INSTITUTION_SCOPE_AUTOMATED = PASS
ADMIN_SCOPE_AUTOMATED = PASS
FULL_UNIT_SUITE = PASS (11,170)
TYPECHECK = PASS
BUILD = PASS
CANDIDATE_READY_FOR_DEPLOY = YES (steps K-1)
IMMUTABLE_CANDIDATE_DEPLOYED = NO
PREVIEW_ALIAS_MOVED = NO
STABLE_STAGE_ALIAS_MOVED = NO
PRODUCTION_TOUCHED = NO
```

**Blockers for Thursday morning:**
1. K-1: clone the candidate database, migrate and publish, deploy an immutable candidate (operator; Vercel and Neon access).
2. P-1: PAA full regression (36 positions) on the clone.
3. E-1: choose SEPARATED or LEGACY for the candidate.
4. Add the G1 Student B fixture.

**Blockers for the Friday pilot E2E:**
1. The candidate deployment plus operator sign-in on its host.
2. The browser role matrix run (G2: admin storage state).
3. IB: `aahl.p1.extended`, P2 trigonometry and extended have no content.
4. PISA, Saber and AICE are not exam-ready (X-1, X-2, X-3).
5. Exam Readiness is not yet shown in the UI (E-1).

**RECOMMENDED_FIRST_ACTION_TOMORROW:** create the Neon clone of `neondb_trackb_exam` as a new candidate database (K-1 step 1), so the converged tip can be migrated, published and deployed as one immutable candidate.
