# UX-4 — Knowledge, Explainability, Progress Consistency & Experience Completion

- **Baseline:** `UX4_BASELINE_SHA=c008587`. It is on `develop`, descends from the UX-3 certified SHA, and equals `origin/develop` and hosted DEV.
- **Environment:** DEV only. No migration. Stage, Preview and Production untouched.
- **Scope:** frozen by the execution note to the approved blockers:
  - Knowledge experience;
  - GAP-07 Progress consistency;
  - readiness consistency;
  - Tutor naming;
  - certification.

  Everything else is classified and deferred below.

## 1. Data model: what is authoritative (verified in code and the DEV DB)

| Truth | Authority (current code) | UX-4 use |
|---|---|---|
| Subject → Topic → Subtopic → Concept | `getSubjectHierarchy` (`topics`, `subtopics`, `concepts.subtopic_id`); DEV: MATH 1 has 4 topics, 8 subtopics, 18 concepts | Knowledge groups (topic level) |
| Concept stage / consolidated / intervention | `resolveConceptJourneyResultAuthoritative` (path-view.ts): the fresh `getCanonicalPedagogicalDecision` when `CANONICAL_ENGINE_V1_ENABLED`, legacy LX-1B otherwise | Knowledge state; Progress rows **and now** rollups |
| "Has the Student worked on it" | Canonical decision `qualifiedEvidence[*].(non)qualifyingEvidenceIds` | Knowledge "Por trabajar" versus "En progreso" |
| Current focus | Snapshot `nextExecutableItem` (the concept Today launches) | "En foco" |
| Concept relationships | `concept_relationships` (`PREREQUISITE_OF`, …) exists in the schema, but **0 rows in DEV** | Not shown; nothing invented |
| Journey % | Engine `STAGE_PROGRESS_PERCENT[stage]` (mirrors `journey-progress.ts` anchors; asserted equal) | Rows and rollups (one scale) |
| Readiness | F9 `readiness_snapshots` status per exam profile | The only Student-facing readiness |
| Misconceptions | `student_misconceptions` / `misconception_signatures`: **0 rows in DEV** | Unchanged (existing recurring list on Progreso) |
| Decision reason | Canonical `rollback.case`, `intervention`, `waitingReason`. `rollback` is dropped by `CanonicalLearningSession` | Deferred (§5) |

## 2. Knowledge experience: `/dashboard/knowledge` ("Tu conocimiento")

**Source.** A presentation of the same assembly My Path uses (`loadMyPathContext` plus `buildSubjectPathView`), keyed by the signed-in Student. It adds no new metric, no stage choice and no invented relationships. The mapping (`lib/experience/knowledge.ts`) is pure:

| Engine truth | Student state |
|---|---|
| consolidated | Dominado |
| REINFORCE | Necesita atención |
| RETAIN / TRANSFER | Demostrado (PROVE satisfied) |
| LEARN with no engine evidence | Por trabajar |
| otherwise | En progreso |

Every state has an icon shape, a text label and a semantic token, so colour is never the only cue.

**Overview**

- State counts.
- An honest "no evidence yet" note when nothing has been worked on.
- The focus card: "Ahora mismo trabajas en …" plus "Ir a tu siguiente reto".

**Map**

- Per subject: "X de N dominados" and a decorative distribution bar (the same numbers appear as text).
- Topic groups: an `auto-fit` grid of cards on desktop and tablet, one column on phones.
- Concept rows are native `<details>` (44 px). The detail shows a meaning sentence keyed by stage, the compact stage track, "Ir a tu siguiente reto" (focus concept only) and "Ver concepto".

**Accessibility.** The map is the accessible structure (headings, lists, disclosures). No graphic-only channel.

**Other states.** Empty (no subjects), subject with no concepts, snapshot read error with retry, and a loading skeleton.

**Reachability.** Primary navigation ("Tu conocimiento"; on phones via "Más") plus "Ver tu conocimiento" on Progreso and Mi ruta.

**Relationships.** DEV holds no `concept_relationships`, so the map is hierarchy-first by design. An edge view would need data first (GAP-08, deferred).

**B-level (read-only).** `LearnerJourneyResult.engineHasEvidence` / `ConceptJourney.engineHasEvidence` is passed through verbatim from the canonical decision.

- **Why it was needed:** the hierarchy's `hasEvidence` means "a `mastery_records` row exists". DEV has 18 such rows for MATH 1 with zero practice and zero `learning_evidence`, so using it would have shown untouched concepts as "En progreso".
- **Scope:** optional and additive. It is absent on the legacy path, where the old flag is the fallback. No decision logic, no migration.

## 3. GAP-07: final resolution (FIXED, B-level, no new formula)

**Before.** Progress mixed three authorities:

1. concept rows: the fresh canonical decision;
2. subject and overall %: `averageJourneyProgress` over the legacy-only `resolveConceptJourneyStage`;
3. "X de N validados" and "aprendizaje validado": knowledge-state `VALIDATED_MASTERY`.

Measured on DEV:

| Subject | Concept rows | Subject % shown |
|---|---|---|
| MATH 1 | all 15% | 0% |
| MATH | 15 / 70 / 15% | 18% |
| Overall | — | 3% |

The Subject detail page (already canonical-aware) disagreed with Progreso for the same subject.

**After** (`progress-overview.service.ts`)

- The rollup stages come from `resolveConceptJourneyResultAuthoritative`: the authority path-view documents for every learner-facing caller, already used by the Subject page and My Path.
- The same existing `averageJourneyProgress`: the same scale, concept-weighted, over the full hierarchy.
- "X de N dominados" and the achievement count use `CONSOLIDATED` over those same stages, the count Mi ruta and Knowledge show.

Measured on DEV after the fix:

| Subject | Concept rows | Subject % shown |
|---|---|---|
| MATH 1 | all 15% | 15% |
| MATH | 15 / 70 / 15% | 33% |
| Overall | — | 18% |

**Remaining labelled metrics.** Capabilities (knowledge-state dimensions, "Por validar" when null), "con evidencia independiente" and the retention achievement lines (knowledge-state dimensions against the policy) keep their own, precisely labelled meaning. `validatedMasteryCount` / `validatedCount` stay in the API and are no longer rendered.

**Documented semantic.** An untouched concept sits at the canonical LEARN anchor (15%). That is a journey position, not work done. Knowledge says "Por trabajar" for it, using the engine's evidence fact.

## 4. Readiness consistency

- **Surfaces:** Hoy (goal and date only, no readiness), Preparación de examen (list and detail: F9 status on F9's own order, unchanged from UX-2), the subject page `AssessmentPanel`, and quiz results.
- **Conflict found:**
  - `AssessmentPanel` fetched and showed a legacy subject "Preparación X%" (`/api/exam-readiness/score`, a different formula), plus a "Predicho X%" column after a school result.
  - Quiz results showed a legacy "predicted → actual %" line.

  These are two readinesses with different semantics under the same name.
- **Resolution (presentation only):** the legacy percentages are no longer fetched or shown to the Student. The API, the calculation and the stored data are unchanged. The Student's single readiness language is the F9 status. No readiness is computed in the frontend.

## 5. Gap outcome table

| Gap | Outcome | Why |
|---|---|---|
| GAP-01 decision reason | **DEFERRED** | Truth exists (`rollback.case`, `intervention`, `waitingReason`), but `CanonicalLearningSession` drops `rollback`. It is a small read-only passthrough to `NextChallengeView`, but it is advanced explainability, out of the frozen scope. Existing "why" copy (UX-2 facts, REINFORCE badge, waiting date) is unchanged. |
| GAP-02 practice / intervention / rollback reason | **DEFERRED** | Same passthrough as GAP-01. `practiceProgress` pass counts would expose policy thresholds; not recommended. |
| GAP-03 misconception | **DEFERRED** | DEV has 0 misconception rows. Copy safety of AI-derived descriptions can't be validated. The existing recurring list on Progreso is unchanged. |
| GAP-04 cross-device drafts | **DEFERRED** (expected) | UX-3 sessionStorage is sufficient for the pilot. |
| GAP-05 recently demonstrated | **DEFERRED** | `lastQualifyingProveAt` exists, but it is nice-to-have per the execution note. |
| GAP-06 streak | **DEFERRED** (expected) | Timezone not persisted. |
| GAP-07 Progress reconciliation | **FIXED** | §3. |
| GAP-08 prerequisite edges | **DEFERRED** | 0 rows in DEV; nothing to show honestly. |
| GAP-09 readiness on Hoy | **DEFERRED** | Nice-to-have. Consistency is ensured by removing the conflicting legacy %. |
| GAP-11 read-on-view writes | **DEFERRED TO NFRA** | `getOrCreateStudentId` upserts, `checkAndResolveDebt`, assessment occurrences, background concept localization, `after()` replenishment. None is small enough to change safely here. Knowledge adds no new write path (it reuses the reads Mi ruta already performs). |
| Experience Read Model | **NOT NEEDED** | path-view already assembles the authoritative per-concept view that Knowledge and Mi ruta share. |

## 6. Security and privacy

- **Knowledge page:** a server component. The Student id comes only from the Clerk session (`getOrCreateStudentId`); no id is read from the URL or client.
- **No new endpoint.** The only new data (`engineHasEvidence`) is a boolean from the Student's own decision.
- **Nothing leaks:** no reason codes, diagnostics or evidence ids reach the page.
- The UX-2 ownership fixes (readiness profile, practice-exam start) are untouched.

## 7. Tutor naming

`nav.tutor` / `tutor.title`: "Tutor" (ES, EN, DE, PT), "Tuteur" (FR). No Student string says "Tutor IA", "AI Tutor", "KI-Tutor", "Tuteur IA" or "Tutor de IA". Prompts, provider, capabilities and backend are unchanged.

## 8. Validation

- **Authenticated real data:** DEV student, local server on the DEV DB.
  - **Knowledge:** 0 Dominado · 1 Demostrado · 1 En progreso · 19 Por trabajar, matching the DB (2 concepts with evidence). Focus is "Regla de tres simple directa · MATH". The concept detail shows "Ya lo demostraste por tu cuenta…", the track and the actions.
  - **Progreso:** GAP-07 figures as in §3.
  - Mi ruta, exam prep, Tutor and Hoy were re-checked.
- **Device matrix** (1440 / 1024 / 768 / 430 / 390, exact-width iframes: overflow, targets, clipping, raw codes, "Tutor IA"), for Knowledge, concept detail, Progress, Mi ruta, exam prep list and detail, Tutor, Hoy: see the final certification.
- **Touch targets:** buttons are 44 px on touch devices (`pointer: coarse`); desktop keeps the 40 px geometry.

## 9. Tests and gates

- New: `tests/unit/ux4-knowledge-consistency.test.ts` (21 tests).
- Updated three existing guards to the new, stronger invariants:
  - `lx2-learner-navigation`: knowledge in primary, not a tab;
  - `lx9r1r1` #8: the rollup uses the authoritative resolver and never the legacy one;
  - UX-2 Progreso: "dominados".
- Full suite, `tsc` and build: see the final certification.
