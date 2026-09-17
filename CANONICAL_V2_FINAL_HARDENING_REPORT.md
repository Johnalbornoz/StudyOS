# STUDYUS CANONICAL V2 — FINAL HARDENING, UI CERTIFICATION & AUTOMATED JOURNEY VALIDATION

## Certification Report

Branch: `tmp/lx1` — main/Production untouched, Production canonical gate (`isCanonicalEngineV1Enabled`) unchanged: hard-disabled whenever `VERCEL_ENV === 'production'`.

---

## 1. Executive Summary

This phase built on the prior `CANONICAL_V2_ARCHITECTURE_CLEANUP_CERTIFICATION.md` (verdict FAIL: error taxonomy, contract-validator consolidation, and the full architecture/E2E test matrices were not yet built, though all 5 activity pipelines were real and wired). This phase closed those specific gaps and added the UI-facing work this task newly scoped:

**Completed and verified this phase:**
- A unified canonical error taxonomy (9 codes), wired additively into every canonical failure response.
- A unified canonical structural contract validator, with `checkV1ActivityContractCompliance` now delegating to it and a second real call site in Transfer generation.
- A real UI/backend parity fix: the quiz page's own `QuizMode` type/records did not recognize `canonical_retain`/`canonical_transfer`/`canonical_learn_check` despite the backend issuing real launch URLs with those values since the prior phase — closed, plus two genuine bugs found and fixed along the way (LEARN_CHECK's Hint/Tutor gate was missing it despite server-side permission; `canonical_retain`'s AI-failure screen fell through to fully generic copy instead of the calmer, mode-aware treatment `retention_check` already had).
- Stage-specific learner-facing copy for all 5 activities (mode labels/descriptions, loading titles, finished-activity checkpoints, Results next-step copy for the 2 stages — RETAIN and TRANSFER — that previously rendered nothing at all).
- A same-request Transfer results breakdown (near/contextual/higher/overall scores shown individually, translated failure diagnosis, never the raw engine enum) — the CRITICAL item Section 10 called out.
- The complete, literally-labeled A–J automated journey matrix.
- UI/backend parity tests for the 5 named example scenarios.
- Dead-code resolution: `composeEffectiveMigratedDecision`/`buildPedagogicalMigrationBaseline` investigated and kept (real, guarded, offline-only Preview-migration tooling — now explicitly documented as such), and genuinely dead code this session itself had introduced was removed.
- Closed an explicit spec gap in the contract validator (`contractVersion` matching, previously unimplemented).

**Not completed this phase (see Section 19):** no live Preview-database or live-AI-provider run was executed (this environment has neither, consistent with every prior phase); the richer, bespoke multi-screen UI treatments implied by Sections 6–11's fuller prose (e.g., a dedicated pre-activity "here are the 3 challenge types" walkthrough screen for Transfer, distinct from its Results breakdown) were not built — only copy/label/loading-title/Results-level distinctiveness was; and no exhaustive learner-facing regression walkthrough was performed in a live browser (this codebase's own established convention, confirmed again this phase, is source-audit testing, not `@testing-library/react` or live click-through, since no DB/AI is available in this environment either).

Per Section 20's own rule ("if any mandatory item is incomplete: FINAL CERTIFICATION = FAIL"), and because the items above were not completed, **this report's final verdict (Section 20 below) is FAIL** — an honest reflection of substantial, real, tested progress without claiming a completion this session did not reach.

---

## 2. Error Taxonomy — Before / After

**Before:** route-specific reason codes (`V1_PROVE_GENERATION_INCOMPLETE`, `V1_RETAIN_GENERATION_INCOMPLETE`, `V1_TRANSFER_GENERATION_INCOMPLETE`, `V1_ACTIVITY_CONTRACT_VIOLATION`, `CanonicalDecisionUnavailableError`, `CANONICAL_RESULTS_UNAVAILABLE`, `CANONICAL_IMPLEMENTATION_MISSING`) each independently named, no shared vocabulary a caller could key off for "same semantic failure."

**After:** `src/lib/pedagogical-decision/canonical-error-taxonomy.ts` defines the exact 9 required codes (`CANONICAL_DECISION_UNAVAILABLE`, `CANONICAL_IMPLEMENTATION_MISSING`, `ACTIVITY_CONTRACT_MISMATCH`, `AI_GENERATION_FAILED`, `AI_GENERATION_INVALID`, `AI_VALIDATION_FAILED`, `EVIDENCE_PERSISTENCE_FAILED`, `CANONICAL_REEVALUATION_FAILED`, `DEPENDENCY_UNAVAILABLE`). `toCanonicalErrorCode(legacyCode)` maps every existing identifier to exactly one of these — additive, not a breaking rename (existing reason strings/response shapes are unchanged; a `canonicalErrorCode` field was added alongside them). Wired into: all 4 canonical_* authorization-failure responses, both generation-incomplete guard sites (×3 modes each), and the Results endpoint's `canonicalResultsStatus`-derived field. `AI_GENERATION_INVALID`, `AI_VALIDATION_FAILED`, and `EVIDENCE_PERSISTENCE_FAILED` are defined in the closed set but have no current mapped legacy alias — no code path in this codebase today distinguishes "AI produced something but it was invalid" from "AI failed to produce anything," or reports an evidence-write failure as anything other than a raised exception; assigning real codes to those paths is scoped, bounded follow-on work.

## 3. Contract Validator — Before / After

**Before:** structural validation (item count, difficulty, independence) lived only inside `checkV1ActivityContractCompliance`'s own inline `if` chain; generation services (Prove/Retain/Transfer) each ran their own separate, uncoordinated range checks.

**After:** `src/lib/pedagogical-decision/canonical-contract-validator.ts` is the one shared module: `validateItemCountAgainstContract`, `validateDifficultyAgainstContract`, `validateIndependenceAgainstContract`, `validateImplementationIdMatch`, `validateContractVersionMatch`, `validateCanonicalRevisionMatch`, and the aggregate `validateCanonicalActivityContract`. `checkV1ActivityContractCompliance` now delegates to it (byte-identical external behavior, verified by test). `canonical-transfer-generation.service.ts`'s own post-generation difficulty check now also calls it directly — a genuine second call site, not a single aliased wrapper. Generation-semantic validation (AI quality gates, novelty/duplicate filtering, response-contract grading) deliberately remains in its own specialized modules per the spec's own scope boundary.

## 4. UI Certification by Surface

| Surface | Status |
|---|---|
| ConceptMission / journey rail | Already stage-aware (prior phases); `toLegacyActivityType` extended (prior phase) so RETENTION_CHECK/TRANSFER/LEARN_CHECK render real CTAs instead of `CANONICAL_ACTION_UNAVAILABLE`. Not further modified this phase beyond what parity tests confirm. |
| Quiz/activity execution page | `QuizMode` type/records widened to recognize all 3 new modes (real parity bug fixed); mode-specific labels/descriptions/loading titles added; Hint/Tutor gate fixed for LEARN_CHECK. |
| Results screen | RETAIN/TRANSFER/LEARN next-step branches added (previously rendered nothing); Transfer breakdown + translated diagnosis added (same-request, no second fetch). |
| Today / My Path / Progress / Subjects rows | Already derive generically from `ActivityType`/journey-stage lookups (prior phases); not independently re-audited this phase beyond confirming they don't hardcode a 5-mode list that would need updating (they don't — they key off `ActivityType`, already correct). |
| Waiting states | Already stage-aware and honest (`RETENTION_WAITING` shows a real date, no CTA) — confirmed via parity test, not modified. |
| Error/AI-failure states | `canonical_retain` gap fixed (fell through to fully generic copy); `canonical_transfer`/`canonical_learn_check` given their own calm headlines. |

## 5. UI Certification by Canonical Stage

- **LEARN:** `canonical_learn_check` mode label ("Understanding check" / "Let's check that you understand the main idea") replaces a mislabeling fallback; Hint/Tutor now correctly available (assistance allowed); Results next-step for a still-LEARN stage (failed check) now shows a calm "let's go over the main idea together" message instead of nothing. **Not built:** a distinct in-activity "teaching" framing (explanation/worked-example UI) beyond the label/description and results copy — the actual question-answering UI is the same shared component every mode uses.
- **PRACTICE:** unaffected by this phase's own changes (no new gaps found); the "2 of last 3" internal language was never exposed to learners (confirmed — no occurrence of that phrasing in any locale).
- **PROVE:** given its own real setup-form copy for defensive completeness (previously fell to `quick_check` copy if ever reached); `ProveFocusLoading`'s existing rich multi-stage loading experience (item count/independence/difficulty/no-hints chips, rotating tips) is untouched and unaffected.
- **RETAIN:** WAITING state already correct (confirmed by parity test); the AI-failure screen bug (fell through to generic copy) is fixed; Results next-step now shows real copy instead of nothing; first-failure vs. second-failure distinct copy exists at the ENGINE level (`checkpointFor`'s own `RETAIN` kind, `continuation.retain.*` keys) and is now correctly wired for `canonical_retain` specifically (previously only `retention_check` reached it).
- **TRANSFER:** mode label/description added; Results breakdown (near/contextual/higher/overall, individually) + translated diagnosis added — the CRITICAL item. **Not built:** a distinct pre-activity "3 challenge types" walkthrough screen before the learner starts (Section 10's own illustrative structure); only the mode label distinguishes it going in.
- **CONSOLIDATED:** `canonicalNextConsolidated` copy strengthened across all 5 locales to explain understanding + independent application + retention + transfer, rather than a bare "consolidated" label. No new dedicated celebratory screen was built (this codebase's own established, explicitly "never gamified" design philosophy — confirmed by the prior UI-surface exploration — treats consolidation as an understated end state everywhere else in the product; a new bespoke screen here would be inconsistent with that established style, so this was a deliberate choice, not an oversight).

## 6. Transfer Results UX

Rendered only when `results.transferResult` is present (a v1Qualifying `canonical_transfer` submission): near/contextual/higher scores shown as individual rows, an overall total below a divider, and — only on failure — one translated sentence per diagnostic (`APPLICATION_CONTEXT_WEAKNESS`/`RETENTION_WEAKNESS`/`FOUNDATIONAL_PROCEDURAL_FAILURE`; `CRITICAL_MISCONCEPTION` copy exists in all 5 locales for completeness, though this module never assigns that diagnostic itself — it's decided independently at evidence-read time). The data is carried in the SAME submission response that already writes `transferChallenges`/`transferFailureDiagnostic` to evidence — no second fetch. The CTA immediately below (the pre-existing canonical-next-step card, now extended with RETAIN/TRANSFER/LEARN branches) reflects the SAME fresh post-rollback decision the engine already computed, so it is structurally guaranteed to match the backend rollback rather than being independently derived from the diagnostic.

## 7. Consolidated UX

`quiz.canonicalNextConsolidated` (all 5 locales) now states what was demonstrated (understanding, independent application, retention over time, transfer to new situations) rather than a bare "you've consolidated this concept." No new screen; reuses the existing next-step card, consistent with the codebase's established non-gamified design language.

## 8. UI/Backend Parity Results

New test file (`canon-v2-ui-backend-parity.test.ts`, 7 tests) proves the 5 scenarios the spec names by example, using `resolveCanonicalLaunch` (session-launch layer) and `overrideConceptMissionViewWithCanonicalDecision` (UI layer) together, both derived from the same fresh decision:
- RETAIN/WAITING → UI shows waiting with the real date, no CTA; session/start refuses to launch.
- TRANSFER/EXECUTABLE → UI renders a real CTA; session/start launches `canonical_transfer`.
- PRACTICE with 1 qualifying attempt → stage (and therefore every derived CTA) stays PRACTICE, never PROVE.
- PRACTICE satisfied → UI/backend both show the Prove CTA with its real exact-10 contract.
- Critical misconception active → given an already-rolled-back-to-PRACTICE decision, neither surface exposes a later-stage CTA.

**PASS** for these 5 named scenarios specifically; not an exhaustive sweep of every possible state combination.

## 9. A–J Scenario Matrix

`canon-v2-journey-matrix-a-j.test.ts` (16 tests) — all 10 scenarios, literally labeled, each a fresh direct engine/generation-service call:

| Scenario | Result |
|---|---|
| A — Happy path | PASS |
| B — Practice consistency (100/40/40/100/100) | PASS |
| C — Prove failure + window reset | PASS |
| D — Retain first failure | PASS |
| E — Retain double failure + new 3-day clock | PASS |
| F — Transfer application-context failure | PASS |
| G — Transfer retention failure | PASS |
| H — Transfer foundational failure (full chain) | PASS |
| I — Critical misconception block + resolution | PASS |
| J — AI failure safety (all 5 activities) | PASS |

**10/10 PASS.** A–I are proven against the real, unmodified pure engine (no mocks); J is proven at the generation-service/route level with the AI call itself mocked (the pure engine has no AI concern), reusing the exact mocking pattern already established for Retain/Transfer generation elsewhere in this phase.

## 10. AI Failure-Safety Results

For all 5 activities: no partial/malformed activity is ever published (each generation service either returns the full required count/structure or a short/empty result, never in between); no evidence is written on a short result (the universal route-level guard runs before the one `storeQuiz` call site, confirmed structurally); no stage advancement is possible without evidence; the same standardized `canonicalErrorCode` (`AI_GENERATION_FAILED`) is returned regardless of which of the 3 exact-count activities failed; retry re-invokes the identical canonical activity contract (same `quizMode`, read from unchanging component state), never a different stage. LEARN_CHECK and PRACTICE share one generation call site (confirmed exactly 2 occurrences of `generatePracticeQuestions(`), so neither has a separate, potentially-weaker failure path.

## 11. Legacy/Dead Code — Removed or Justified

| Candidate | Action | Reason |
|---|---|---|
| `composeEffectiveMigratedDecision` | Kept | No live app caller; real caller is `scripts/canon-r4-migration-dry-run.ts` (read-only). Doc comment now explicitly marks it offline/historical-only. |
| `buildPedagogicalMigrationBaseline` | Kept | No live app caller; real callers are both migration CLI scripts (one read-only, one with an explicitly double-gated `--apply --confirm-preview` write path). Doc comment updated likewise. |
| `CanonicalError` / `makeCanonicalError` (this phase's own addition) | **Removed** | Zero callers anywhere — written speculatively during Section 3's own work and never wired in. Deleted rather than kept "for later," per this phase's own stated philosophy. |
| `contractVersion` validation gap | **Closed** | Section 4 named it explicitly; `validateContractVersionMatch` added, mirroring the existing identity-check pattern. |

No further TODO/FIXME/commented-out-implementation found in `src/lib/pedagogical-decision`, `src/lib/pedagogical-engine`, `src/services/canonical-*.ts`, or `src/lib/lx/canonical-*.ts` this phase (repeat of the prior phase's search, re-run after this phase's own additions).

## 12. Remaining NOT_READY Search Results

Unchanged from the prior phase, re-confirmed: `resolveV1ActivityLaunchReadiness` returns `{ ready: true }` for every real value of `PedagogicalActivityType | 'REINFORCE'` (proven by test, `canon-r5-canonical-decision-service.test.ts`). **0 normal NOT_READY paths.** The `{ ready: false }` branch remains only as a structurally-unreachable defensive backstop for a value outside that closed union.

## 13. Production Files Changed

New: `src/lib/pedagogical-decision/canonical-error-taxonomy.ts`, `src/lib/pedagogical-decision/canonical-contract-validator.ts`.

Modified (substantive): `src/app/api/quizzes/generate-and-take/route.ts` (canonicalErrorCode wiring, transferResult in submission response), `src/lib/pedagogical-decision/v1-practice-launch-marker.ts` (delegates to the shared validator), `src/services/canonical-transfer-generation.service.ts` (uses the shared validator directly), `src/app/dashboard/quiz/page.tsx` (QuizMode widened; mode labels/descriptions/loading titles/continuationKind/Results next-step/Transfer breakdown/AI-failure copy), `src/lib/i18n/messages.ts` (23 + 2 new keys × 5 locales, 1 existing key's copy strengthened across all 5), `src/lib/pedagogical-migration/effective-decision.ts` and `migration-baseline.ts` (doc comments only — offline/historical-only clarification).

No changes to `src/lib/pedagogical-engine/engine.ts` (the pure engine itself), Production configuration, or the feature gate.

## 14. Tests Added/Changed

New: `canon-v2-error-taxonomy.test.ts` (11), `canon-v2-contract-validator.test.ts` (13, extended to 14 with the contractVersion addition), `canon-v2-ui-certification.test.ts` (36), `canon-v2-journey-matrix-a-j.test.ts` (16), `canon-v2-ui-backend-parity.test.ts` (7).

Repaired (structural-anchor or stale-assumption fixes, never weakened): `canon-r5r1-generate-and-take-wiring.test.ts`, `canon-v2-learn-check-generation.test.ts`, `canon-r6-prove-v1-exact10-independent-assessment.test.ts` (×2), `canon-r6r1-prove-novelty-and-results-single-authority.test.ts`, `lx9r6-canonical-quiz-generation-reliability.test.ts`, `canon-r6-perf-r2-focus-loading-ux.test.ts`, `ret-r3-retention-availability.test.ts`, `release-r1-zero-gap-frontend-action-integrity.test.ts`, `lx9-final-transfer-recovery-canonical-progress.test.ts`, `lx4p-r3-active-learning-language.test.ts`.

## 15. TypeScript / Build / Full-Suite Results

- `npx tsc --noEmit`: **clean, 0 errors** (confirmed after every commit this phase).
- `npm run build`: **PASS**.
- Full `npx vitest run`: **274 files, 4858 tests, 100% green** (up from the 269 files / 4774 tests baseline at the start of this phase).

## 16. Skipped-Test Count

`.skip`/`.todo`/`xit`/`xdescribe` anywhere in `tests/unit/`: **0**.

## 17. Preview DB Validation — Commands to Run Manually

None of the following were executed in this environment (no live database access here, consistent with every prior phase). Run against a Preview-connected environment with `DATABASE_URL` pointed at Preview:

```bash
# A. Practice evidence exists and is v1-tagged for a real (student, concept):
psql "$DATABASE_URL" -c "
  SELECT id, source_type, score_percent, metadata->>'pedagogicalPolicyVersion' AS policy_version,
         metadata->>'canonicalActivityType' AS activity_type
  FROM learning_evidence
  WHERE student_id = '<uuid>' AND concept_id = '<uuid>' AND source_type = 'PRACTICE_QUESTION'
  ORDER BY created_at DESC LIMIT 10;"

# B. Misconception observedByEvidenceId is a real, joinable link:
psql "$DATABASE_URL" -c "
  SELECT sm.id, sm.observed_by_evidence_id, le.id AS evidence_id
  FROM student_misconceptions sm
  JOIN learning_evidence le ON le.id = sm.observed_by_evidence_id
  WHERE sm.student_id = '<uuid>' LIMIT 10;"

# C. Retain evidence (canonical_retain quiz_mode) persists correctly:
psql "$DATABASE_URL" -c "
  SELECT id, quiz_mode, pedagogical_policy_version, jsonb_array_length(questions) AS item_count
  FROM quiz_sessions
  WHERE quiz_mode = 'canonical_retain' AND student_id = '<uuid>'
  ORDER BY created_at DESC LIMIT 10;"

# D. Transfer challenge persistence + transferFailureDiagnostic:
psql "$DATABASE_URL" -c "
  SELECT id, metadata->'transferChallenges' AS challenges, metadata->>'transferFailureDiagnostic' AS diagnostic
  FROM learning_evidence
  WHERE student_id = '<uuid>' AND concept_id = '<uuid>' AND metadata ? 'transferChallenges'
  ORDER BY created_at DESC LIMIT 10;"

# E. Same-request canonical re-evaluation reflects the just-written evidence:
#    Submit a real quiz via the app UI or API (see Section 18 below), then
#    confirm the SAME response's canonicalResults.requirements already
#    show the new evidence's effect (no second request needed):
curl -s -X POST "$PREVIEW_URL/api/quizzes/generate-and-take" \
  -H 'Content-Type: application/json' \
  -d '{"action":"submit","studentId":"<uuid>","quizId":"<uuid>","answers":[...]}' | jq '.data.canonicalResults, .data.canonicalResultsStatus'

# F. Legacy data cannot fabricate PRACTICE/PROVE/RETAIN/TRANSFER/CONSOLIDATED
#    (regression check for the already-frozen LEARN-only migration):
psql "$DATABASE_URL" -c "
  SELECT recognition_id, requirement, basis, reason_code
  FROM pedagogical_recognitions
  WHERE requirement <> 'LEARN' AND basis = 'LEGACY_MIGRATION_BASELINE';"
  -- Expected: 0 rows. Any row here is a real regression.
```

## 18. Real AI Validation — Commands to Run Manually

Requires `CANONICAL_ENGINE_V1_ENABLED=true` in a non-Production environment (Preview) and a real AI provider key configured. Not executed here (no AI provider access in this environment):

```bash
# For each of the 5 activities, generate a real quiz and confirm the
# exact contract (item/challenge count, difficulty range, independence):
for MODE in canonical_learn_check topic_practice canonical_prove canonical_retain canonical_transfer; do
  echo "=== $MODE ==="
  curl -s -X POST "$PREVIEW_URL/api/quizzes/generate-and-take" \
    -H 'Content-Type: application/json' \
    -d "{\"studentId\":\"<uuid>\",\"subjectId\":\"<uuid>\",\"conceptId\":\"<uuid>\",\"quizMode\":\"$MODE\",\"v1Launch\":true}" \
    | jq '.data.quiz.count, .data.quiz.questions[].difficulty'
done
```
Expected: `canonical_prove`/`canonical_retain` → exactly 10 items, D3–D4; `canonical_transfer` → exactly 3 items, D4–D5, one each `transferDepth` NEAR/CONTEXTUAL/HIGHER (visible only server-side; confirm via the DB query in Section 17.D after submission); `canonical_learn_check` → the execution-default count, D1–D2.

## 19. Remaining Risks

1. No live Preview-database or live-AI-provider run was executed this phase — everything above the unit/integration-mock level remains unverified live (unchanged from the prior phase's own stated risk).
2. `AI_GENERATION_INVALID`, `AI_VALIDATION_FAILED`, `EVIDENCE_PERSISTENCE_FAILED` are defined in the taxonomy but have no real code path mapped to them yet — a future phase should either wire real detection for these or confirm they are structurally unreachable and document why.
3. The richer, bespoke UI treatments implied by Sections 6–11's fuller illustrative prose (a distinct in-activity "teaching" screen for LEARN, a pre-activity "3 challenge types" walkthrough for TRANSFER) were not built — only copy/label/results-level distinctiveness was, a deliberate proportionality choice given this phase's scope and this codebase's existing shared-component architecture for question execution.
4. `composeEffectiveMigratedDecision`/`buildPedagogicalMigrationBaseline` remain in the codebase — a future phase, once the Preview migration is actually run and confirmed complete, should decide whether to retire the 2 CLI scripts (and these helpers with them) as truly historical.
5. UI/backend parity tests (Section 8/12) cover the 5 named example scenarios, not an exhaustive sweep of every stage × actionState combination.

## 20. Confirmation: Production Untouched, Gate OFF

- All work occurred exclusively on branch `tmp/lx1`; no commit touched `main`; no push, no deployment.
- `isCanonicalEngineV1Enabled()` unchanged: hard-disabled whenever `VERCEL_ENV === 'production'`.
- No migration-apply command was run; no live database was modified; no real AI provider call was made.

---

# FINAL STRUCTURED RESULT

```
ARCHITECTURE HARDENING: PASS (implementation registry, error taxonomy, contract validator, NOT_READY=0 all real and tested)
ERROR TAXONOMY: PASS
UNIFIED CONTRACT VALIDATOR: PASS
DEAD / LEGACY CLEANUP: PASS (2 kept-and-justified, 1 removed, 1 gap closed)
NOT_READY NORMAL PATHS: 0/0
UI — LEARN: PARTIAL (label/description/Hint-gate/Results-copy fixed; no dedicated teaching-screen redesign)
UI — PRACTICE: PASS (no new gaps found; internal language confirmed never exposed)
UI — PROVE: PASS (defensive copy added; existing rich loading experience unaffected)
UI — RETAIN: PASS (AI-failure gap fixed; WAITING/Results copy confirmed/added)
UI — TRANSFER: PARTIAL (CRITICAL Results breakdown + diagnosis translation done; no pre-activity walkthrough screen)
UI — CONSOLIDATED: PASS (copy strengthened; no new screen, consistent with existing design language)
UI / BACKEND PARITY: PASS (5/5 named scenarios)
SCENARIOS A-J: 10/10 PASS
AI FAILURE SAFETY: PASS
TYPESCRIPT: PASS
BUILD: PASS
FULL SUITE: 4858/4858 PASS (274 files)
SKIPPED CANONICAL TESTS: 0
PREVIEW CERTIFICATION READY: NO (commands documented in Sections 17/18; not executed -- no live DB/AI access in this environment)
BLOCKERS: 5/5 open (see Section 19 -- none architectural; all scoped follow-on work or explicit, documented scope decisions)
FINAL CERTIFICATION: FAIL (2 UI surfaces PARTIAL rather than PASS, Preview/AI validation not executed -- per Section 20's own rule, any incomplete mandatory item fails certification regardless of the real, tested progress made elsewhere)
```
