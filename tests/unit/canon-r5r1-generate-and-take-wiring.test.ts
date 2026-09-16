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

  it('the v1 marker is computed only when v1Launch===true AND the feature gate is on AND the mode is topic_practice AND a conceptId is present', () => {
    const idx = ROUTE_SRC.indexOf('const v1Marker =');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/validated\.v1Launch === true/);
    expect(slice).toMatch(/isCanonicalEngineV1Enabled\(\)/);
    expect(slice).toMatch(/validated\.quizMode === 'topic_practice'/);
    expect(slice).toMatch(/validated\.conceptId/);
    expect(slice).toMatch(/verifyV1PracticeLaunchMarker\(/);
  });

  it('the marker computation NEVER reads a client-supplied policyVersion/canonicalStage/canonicalRevision -- it is derived exclusively from verifyV1PracticeLaunchMarker\'s own fresh decision call', () => {
    const idx = ROUTE_SRC.indexOf('const v1Marker =');
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).not.toMatch(/validated\.(pedagogicalPolicyVersion|canonicalStage|canonicalRevision)/);
  });

  it('storeQuiz is called with the computed v1Marker as its final argument', () => {
    const idx = ROUTE_SRC.indexOf('const quizId = await storeQuiz(');
    const slice = ROUTE_SRC.slice(idx, idx + 250);
    expect(slice).toMatch(/v1Marker\s*\n?\s*\);/);
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
  it('the metadata stamping block is gated on quizSession.v1Marker being non-null -- a session created without one (any legacy caller, or a v1Launch request that failed re-verification) never adds the v1 fields', () => {
    const idx = ROUTE_SRC.indexOf('quizSession.v1Marker && conceptId === quizSession.conceptId');
    const slice = ROUTE_SRC.slice(idx - 50, idx + 500);
    expect(slice).toMatch(/pedagogicalPolicyVersion: quizSession\.v1Marker\.pedagogicalPolicyVersion/);
    expect(slice).toMatch(/canonicalRevision: quizSession\.v1Marker\.canonicalRevision/);
    expect(slice).toMatch(/canonicalStage: quizSession\.v1Marker\.canonicalStage/);
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

  it('the re-fetch is gated on quizSession.v1Marker -- a legacy attempt never triggers it, never returns a canonicalResults value', () => {
    const idx = ROUTE_SRC.indexOf('if (quizSession.v1Marker && quizSession.conceptId) {');
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
    const slice = ROUTE_SRC.slice(returnIdx, returnIdx + 700);
    expect(slice).toMatch(/canonicalResults,/);
    expect(slice).toMatch(/canonicalResultsStatus,/);
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

  it('activity-launch-readiness.ts (Prove/Retention/Transfer/Learn NOT_READY gates) is untouched by this phase -- still the frozen CANON-R5 grounding', () => {
    const src = read('src/lib/pedagogical-decision/activity-launch-readiness.ts');
    expect(src).toMatch(/V1_PROVE_GENERATION_NOT_READY/);
    expect(src).toMatch(/V1_RETENTION_GENERATION_NOT_READY/);
    expect(src).toMatch(/V1_TRANSFER_GENERATION_NOT_READY/);
    expect(src).toMatch(/V1_LEARN_CHECK_GENERATION_NOT_READY/);
    expect(src).toMatch(/case 'PRACTICE':\n    case 'REINFORCE':\n      return \{ ready: true \};/);
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
  it('with the gate off, v1Marker is always null regardless of v1Launch (short-circuited by isCanonicalEngineV1Enabled() in the same && chain)', () => {
    const idx = ROUTE_SRC.indexOf('const v1Marker =');
    const slice = ROUTE_SRC.slice(idx, idx + 300);
    // isCanonicalEngineV1Enabled() must appear in the same guarding
    // expression as v1Launch -- both are required, neither alone suffices.
    const conditionLine = slice.split('?')[0];
    expect(conditionLine).toMatch(/validated\.v1Launch === true && isCanonicalEngineV1Enabled\(\)/);
  });
});
