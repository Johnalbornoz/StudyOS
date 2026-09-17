/**
 * CANON-R5R1 -- v1 EVIDENCE PERSISTENCE & RESULTS RECONCILIATION.
 * Source-audit tests for the wiring inside
 * `src/app/api/quizzes/generate-and-take/route.ts` -- this file is
 * 1500+ lines deeply woven with AI generation/grading/retry logic that
 * this phase's own firewall (Part 27) forbids touching; the established
 * convention for this specific route elsewhere in this codebase (see
 * e.g. lx9r6-r1-universal-count-contract-observability.test.ts,
 * lx9-final-transfer-recovery-canonical-progress.test.ts) is a
 * source-level audit of the exact wiring rather than a full behavioral
 * invocation requiring dozens of unrelated mocks. Behavioral coverage
 * for the NEW, isolated pieces this phase adds
 * (verifyV1PracticeLaunchMarker, storeQuiz/getQuizSession's marker
 * round-trip) lives in the two sibling CANON-R5R1 test files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

describe('Part 2/6/20 -- v1Launch is an intent signal only, independently re-verified', () => {
  it('GenerateQuizSchema accepts an optional v1Launch boolean', () => {
    const schemaBlock = ROUTE_SRC.match(/const GenerateQuizSchema = z\.object\(\{[\s\S]*?\}\);/)?.[0];
    expect(schemaBlock).toBeDefined();
    expect(schemaBlock).toMatch(/v1Launch:\s*z\.boolean\(\)\.optional\(\)/);
  });

  it('the raw v1 marker is fetched only when v1Launch===true AND the feature gate is on AND the mode requests a real v1-eligible activity AND a conceptId is present (CANON-V2-ARCH-CLEANUP: every canonical_* mode, via requestedActivityType)', () => {
    const idx = ROUTE_SRC.indexOf('const requestedActivityType:');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 900);
    expect(slice).toMatch(/validated\.quizMode === 'topic_practice'\s*\n\s*\? 'PRACTICE'/);
    expect(slice).toMatch(/validated\.quizMode === 'canonical_prove'\s*\n\s*\? 'PROVE'/);
    expect(slice).toMatch(/validated\.quizMode === 'canonical_retain'\s*\n\s*\? 'RETENTION_CHECK'/);
    expect(slice).toMatch(/validated\.quizMode === 'canonical_transfer'\s*\n\s*\? 'TRANSFER'/);
    expect(slice).toMatch(/validated\.quizMode === 'canonical_learn_check'\s*\n\s*\? 'LEARN_CHECK'/);
    expect(slice).toMatch(/validated\.v1Launch === true/);
    expect(slice).toMatch(/isCanonicalEngineV1Enabled\(\)/);
    expect(slice).toMatch(/requestedActivityType/);
    expect(slice).toMatch(/validated\.conceptId/);
    expect(slice).toMatch(/verifyV1PracticeLaunchMarker\(/);
  });

  it('CANON-R6 Part 25: the raw marker is only honored (v1Marker non-null) when its OWN canonicalActivityType matches requestedActivityType -- wrong stage/mode never authorizes', () => {
    const idx = ROUTE_SRC.indexOf('const v1Marker =');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/rawV1Marker\.canonicalActivityType === requestedActivityType/);
    expect(slice).toMatch(/requestedActivityType === 'PRACTICE' && rawV1Marker\.canonicalActivityType === 'REINFORCE'/);
  });

  it('CANON-R6 Part 24/29: a canonical_prove request that fails to authorize is refused outright, never silently generated with that mode\'s own generic defaults', () => {
    const idx = ROUTE_SRC.indexOf("validated.quizMode === 'canonical_prove' && !v1Marker");
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/V1_PROVE_AUTHORIZATION_FAILED/);
    expect(slice).toMatch(/status: 403/);
  });

  it('the marker computation NEVER reads a client-supplied policyVersion/canonicalStage/canonicalRevision -- it is derived exclusively from verifyV1PracticeLaunchMarker\'s own fresh decision call', () => {
    const idx = ROUTE_SRC.indexOf('const v1Marker =');
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).not.toMatch(/validated\.(pedagogicalPolicyVersion|canonicalStage|canonicalRevision)/);
  });

  it('storeQuiz is called with the computed v1Marker (CANON-R6R1: merged with novelty diagnostics as v1MarkerToPersist) as its final argument', () => {
    const idx = ROUTE_SRC.indexOf('const quizId = await storeQuiz(');
    const slice = ROUTE_SRC.slice(idx, idx + 250);
    expect(slice).toMatch(/v1MarkerToPersist\s*\n?\s*\);/);
    // the merged object is still built directly from v1Marker (spread),
    // never a second, independent construction.
    expect(ROUTE_SRC).toMatch(/v1MarkerToPersist: QuizSessionV1Marker \| null = v1Marker\s*\n\s*\? \{ \.\.\.v1Marker, novelty: noveltyDiagnostics \}\s*\n\s*: null;/);
  });
});

describe('Part 12/20 -- SubmitQuizSchema cannot carry a forged v1 claim', () => {
  it('SubmitQuizSchema has no policyVersion/canonicalStage/canonicalRevision/pedagogicalPolicyVersion field -- structurally impossible to submit one', () => {
    const schemaBlock = ROUTE_SRC.match(/const SubmitQuizSchema = z\.object\(\{[\s\S]*?\}\);/)?.[0];
    expect(schemaBlock).toBeDefined();
    expect(schemaBlock).not.toMatch(/policyVersion|canonicalStage|canonicalRevision|pedagogicalPolicyVersion/);
  });

  it('the submission path reads the v1 marker from quizSession (the persisted, server-reloaded session), never from `validated`', () => {
    const idx = ROUTE_SRC.indexOf('quizSession.v1Marker && conceptId === quizSession.conceptId');
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('Part 6 -- legacy Practice sessions are never v1-stamped', () => {
  it('the metadata stamping block is gated on v1Qualifies (true only for the authorized concept AND a contract-compliant actual attempt) -- a session created without a marker, or one that failed contract compliance, never adds the v1 fields', () => {
    const authIdx = ROUTE_SRC.indexOf('isAuthorizedConcept = !!quizSession.v1Marker && conceptId === quizSession.conceptId');
    expect(authIdx).toBeGreaterThan(-1);
    expect(ROUTE_SRC.slice(authIdx, authIdx + 700)).toMatch(/const v1Qualifies = isAuthorizedConcept && v1Compliance!\.compliant/);

    const metadataIdx = ROUTE_SRC.indexOf('...(v1Qualifies');
    expect(metadataIdx).toBeGreaterThan(authIdx);
    const slice = ROUTE_SRC.slice(metadataIdx, metadataIdx + 500);
    expect(slice).toMatch(/\?\s*\{/);
    expect(slice).toMatch(/pedagogicalPolicyVersion: quizSession\.v1Marker!\.pedagogicalPolicyVersion/);
    expect(slice).toMatch(/canonicalRevision: quizSession\.v1Marker!\.canonicalRevision/);
    expect(slice).toMatch(/canonicalStage: quizSession\.v1Marker!\.canonicalStage/);
  });
});

describe('Part 10/11 -- actual-vs-authorized contract compliance', () => {
  it('checkV1ActivityContractCompliance is called with the REAL bucket.total/aggregate difficulty (and, for an independent contract, the real hintsUsed/aiAssistanceType) for the exact authorized concept, before any v1 stamping decision is made', () => {
    const idx = ROUTE_SRC.indexOf('checkV1ActivityContractCompliance({');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 300);
    expect(slice).toMatch(/authorization: quizSession\.v1Marker!/);
    expect(slice).toMatch(/actualItemCount: bucket\.total/);
    expect(slice).toMatch(/actualDifficulty,/);
    expect(slice).toMatch(/actualHintsUsed: hintsUsed/);
    expect(slice).toMatch(/actualAiAssistanceType/);
  });

  it('a contract violation is logged with the closed V1_ACTIVITY_CONTRACT_VIOLATION reason, never silenced', () => {
    expect(ROUTE_SRC).toMatch(/console\.warn\('\[canon-r5r1a\]'/);
  });

  it('a contract violation is persisted as an explicit, traceable v1ActivityContractViolation diagnostic -- never fabricated compliance, never erased', () => {
    const idx = ROUTE_SRC.indexOf('v1ActivityContractViolation: {');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/authorizedItemCount: quizSession\.v1Marker!\.itemCount/);
    expect(slice).toMatch(/actualItemCount: bucket\.total/);
    expect(slice).toMatch(/authorizedDifficulty: quizSession\.v1Marker!\.difficulty/);
  });

  it('a violating attempt never has its itemCount silently clamped -- the persisted itemCount for a violation is still the real bucket.total, unmodified', () => {
    // The v1 metadata block (itemCount: bucket.total) only ever fires
    // inside the v1Qualifies branch; the violation branch never writes
    // an `itemCount` field at all -- there is exactly one `itemCount:`
    // assignment site in the whole metadata object.
    const occurrences = (ROUTE_SRC.match(/itemCount: bucket\.total/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe('Part 7/8/21 -- the REAL administered/graded counts are persisted, never the originally-requested maxQuestions', () => {
  it('itemCount is stamped from bucket.total (the real per-concept administered count), never validated.maxQuestions', () => {
    const idx = ROUTE_SRC.indexOf('itemCount: bucket.total');
    expect(idx).toBeGreaterThan(-1);
  });

  it('correctCount is stamped from bucket.correct (the real graded count), never reconstructed from scorePercent', () => {
    const idx = ROUTE_SRC.indexOf('correctCount: bucket.correct');
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('Part 13/15/22 -- Results reconciliation: fresh, after the write, fail-safe', () => {
  it('the canonical results re-fetch happens strictly AFTER perConceptResults (the evidence-writing loop) has already been awaited', () => {
    const perConceptIdx = ROUTE_SRC.indexOf('const perConceptResults = await Promise.all(');
    const refetchIdx = ROUTE_SRC.indexOf('getCanonicalPedagogicalDecision({\n          studentId: validated.studentId,\n          conceptId: quizSession.conceptId,');
    expect(perConceptIdx).toBeGreaterThan(-1);
    expect(refetchIdx).toBeGreaterThan(perConceptIdx);
  });

  it('the re-fetch is gated on the ACTUAL submission having qualified as v1 (authorizedResult?.v1Qualifies), not merely on a marker having existed at generation time -- a legacy attempt, or a contract-violating v1-marked attempt, never triggers it', () => {
    const idx = ROUTE_SRC.indexOf('quizSession.v1Marker && authorizedResult?.v1Qualifies && quizSession.conceptId');
    expect(idx).toBeGreaterThan(-1);
  });

  it('a contract-violating attempt gets its own distinct canonicalResultsStatus (V1_ACTIVITY_CONTRACT_VIOLATION), never OK and never a silent NOT_V1', () => {
    const idx = ROUTE_SRC.indexOf("canonicalResultsStatus = 'V1_ACTIVITY_CONTRACT_VIOLATION';");
    expect(idx).toBeGreaterThan(-1);
  });

  it('a CanonicalDecisionUnavailableError is caught and mapped to CANONICAL_RESULTS_UNAVAILABLE -- never re-thrown, never treated as a submission failure', () => {
    const idx = ROUTE_SRC.indexOf("canonicalResultsStatus = 'CANONICAL_RESULTS_UNAVAILABLE';");
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx - 200, idx + 50);
    expect(slice).toMatch(/instanceof CanonicalDecisionUnavailableError/);
  });

  it('the response always carries canonicalResults + canonicalResultsStatus alongside the existing legacy result fields -- evidence/mastery data is never withheld because canonical re-fetch failed', () => {
    const returnIdx = ROUTE_SRC.lastIndexOf('return NextResponse.json({\n      success: true,\n      data: {\n        quizId: validated.quizId,');
    expect(returnIdx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(returnIdx, returnIdx + 1100);
    expect(slice).toMatch(/canonicalResults,/);
    expect(slice).toMatch(/canonicalResultsStatus,/);
    // CANON-V2-FINAL-HARDENING Section 3 -- additive canonicalErrorCode field.
    expect(slice).toMatch(/canonicalErrorCode:/);
    expect(slice).toMatch(/mastery:/); // legacy result data still present
  });

  it('no evidence row is ever deleted -- there is no DELETE FROM learning_evidence anywhere in this route', () => {
    expect(ROUTE_SRC).not.toMatch(/DELETE FROM learning_evidence/i);
  });
});

describe('Part 16 -- idempotency is preserved, not weakened', () => {
  it('the existing QUIZ_SUBMISSION operation-key identity (Phase 2B) is unchanged -- this phase adds no second write path and no new duplicate-evidence risk', () => {
    expect(ROUTE_SRC).toMatch(/identity: \{ operationType: 'QUIZ_SUBMISSION', operationId: validated\.quizId, conceptId \}/);
  });
});

describe('Part 26/27 -- no widening of Prove/Retention/Transfer/Learn readiness, no AI/cache/Quality Gate touch', () => {
  it('generate-and-take/route.ts still imports nothing from the AI provider layer beyond what it already used (no new @/lib/ai/adapters import)', () => {
    expect(ROUTE_SRC).not.toMatch(/@\/lib\/ai\/adapters/);
  });

  it('the v1 marker verification path never imports quiz-generation.service\'s generation functions -- it only calls the canonical decision service', () => {
    const idx = ROUTE_SRC.indexOf("from '@/lib/pedagogical-decision';");
    const importBlock = ROUTE_SRC.slice(ROUTE_SRC.lastIndexOf('import {', idx), idx);
    expect(importBlock).not.toMatch(/generatePracticeQuestions|generateQuickCheckQuestions|generateRetentionCheckQuestions/);
  });

  it('activity-launch-readiness.ts no longer keeps Retention/Transfer/Learn NOT_READY -- CANON-V2-ARCH-CLEANUP Section 1/7 supersedes CANON-R6\'s narrower "widen only Prove" scope: every canonical stage now has a real implementation, delegated to the one implementation registry', () => {
    const src = read('src/lib/pedagogical-decision/activity-launch-readiness.ts');
    // The 3 old reasons are no longer a LIVE type member / return value --
    // only their names may still appear in a historical doc-comment note
    // (the type itself is now a closed single-member union).
    expect(src).toMatch(/export type V1ActivityNotReadyReason = 'CANONICAL_IMPLEMENTATION_MISSING';/);
    expect(src).toMatch(/CANONICAL_IMPLEMENTATION_MISSING/);
    expect(src).toMatch(/resolveCanonicalImplementation/);
  });
});

describe('Part 3 -- the v1Launch intent signal travels end to end: session start -> launch URL -> quiz page -> generate request', () => {
  it('resolveCanonicalLaunch stamps v1Launch=1 on every READY Practice/Reinforce launch URL', () => {
    const src = read('src/lib/pedagogical-decision/canonical-session-launch.ts');
    expect(src).toMatch(/v1Launch: '1'/);
  });

  it('the quiz page reads v1Launch from the URL and forwards it verbatim in the generate request body', () => {
    const src = read('src/app/dashboard/quiz/page.tsx');
    expect(src).toMatch(/searchParams\.get\('v1Launch'\) === '1'/);
    expect(src).toMatch(/\.\.\.\(v1Launch \? \{ v1Launch: true \} : \{\}\)/);
  });

  it('a legacy launch URL (no v1Launch param) never sets the flag -- searchParams.get returns null, the === "1" comparison is false', () => {
    const src = read('src/app/dashboard/quiz/page.tsx');
    // Structural guarantee: v1Launch is a strict boolean derived from an
    // explicit '1' match, never defaulted to true.
    expect(src).not.toMatch(/const v1Launch = true/);
  });
});

describe('Part 25 -- feature gate parity', () => {
  it('with the gate off, rawV1Marker (and therefore v1Marker) is always null regardless of v1Launch (short-circuited by isCanonicalEngineV1Enabled() in the same && chain)', () => {
    const idx = ROUTE_SRC.indexOf('const rawV1Marker =');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 300);
    // isCanonicalEngineV1Enabled() must appear in the same guarding
    // expression as v1Launch -- both are required, neither alone suffices.
    const conditionLine = slice.split('?')[0];
    expect(conditionLine).toMatch(/validated\.v1Launch === true && isCanonicalEngineV1Enabled\(\)/);
  });
});
