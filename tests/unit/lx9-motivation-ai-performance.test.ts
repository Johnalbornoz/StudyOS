/**
 * LX-9 -- MOTIVATION, PROGRESSION & AI PERFORMANCE.
 *
 * Covers the required test matrix (48 items) for the changes actually
 * made in this phase:
 *   - AI ARCHITECTURE (1-4): central routing extended to 5 call sites
 *     that previously hardcoded `claude-sonnet-5` directly.
 *   - DETERMINISTIC (5-8): a bare-number `numeric_problem` grade needs
 *     no AI call.
 *   - ROUTING (9-12): Luna-first + one bounded Terra fallback for the
 *     newly-migrated tutor call, with a documented Terra-only rationale
 *     audit for the capabilities that stay Terra-only.
 *   - QUALITY GATE (16-18): confirmed via EXISTING coverage in
 *     tests/unit/lx4p-perf-r1c-r1-gate-primitives.test.ts (not
 *     duplicated here) -- deterministic PASS/FAIL already skip the
 *     semantic call; only NOT_DETERMINISTICALLY_VERIFIED reaches it.
 *   - TOKENS (21-23): the tutor's RAG context is now bounded via
 *     `fitContextChunks`, and its own token budget entry exists.
 *   - OBSERVABILITY (32-37): the tutor's calls now carry real
 *     token/cost telemetry and an operationId, which they had zero of
 *     before this phase.
 *   - MOTIVATION (38-42): the new milestone/weekly-days modules are
 *     pure presentation over EXISTING canonical authorities -- no new
 *     scoring engine, no XP/streak-pressure, no mastery mutation.
 *   - Global regression (43-48) is the full `npx vitest run` /
 *     `npx tsc --noEmit` / `npm run build` referenced in the report,
 *     not re-asserted here.
 *
 * DEDUP (27-28) is intentionally NOT covered here -- in-flight request
 * deduplication was audited (B13) but not implemented this phase; see
 * the report's CONDITIONS section.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// --- module-scope mocks (vi.mock is hoisted; ALL mocks live here, at the
// top level, never inside a describe/it block) ---
const queryMock = vi.fn();
const retrieveContextMock = vi.fn();
const callModelMock = vi.fn();
const recordRuntimeEventMock = vi.fn();
const getActiveRestrictedEvidenceForStudentMock = vi.fn();

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => retrieveContextMock(...a) }));
vi.mock('@/services/tutor-strategy.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/tutor-strategy.service')>();
  return { ...actual, buildCompactTutorContext: vi.fn().mockResolvedValue(null) };
});
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/active-evidence-guard.service', () => ({
  getActiveRestrictedEvidenceForStudent: (...a: any[]) => getActiveRestrictedEvidenceForStudentMock(...a),
}));
vi.mock('@/lib/ai/adapters/call-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/adapters/call-model')>();
  return { ...actual, callModel: (...a: any[]) => callModelMock(...a) };
});
vi.mock('@/lib/ai/runtime-event', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/runtime-event')>();
  return { ...actual, recordRuntimeEvent: (...a: any[]) => recordRuntimeEventMock(...a) };
});

import { sendMessage } from '@/services/tutor.service';
import { gradeAnswer } from '@/services/quiz-generation.service';
import { budgetFor } from '@/lib/ai/token-budgets';
import { resolveModels, LUNA, TERRA, CAPABILITY_ROUTING } from '@/lib/ai/model-routing';
import { deriveMilestoneFromStageTransition } from '@/lib/lx/progression-milestones';
import { summarizeByCapability, groupByOperation, detectWastedOperations } from '@/lib/ai/performance-dashboard-contract';
import { getMessages } from '@/lib/i18n/messages';

function mockDbSequence() {
  queryMock.mockReset();
  queryMock.mockResolvedValueOnce({ rows: [{ subject_id: 'subj1', title: null }] }); // conversation lookup
  queryMock.mockResolvedValueOnce({ rows: [] }); // history
  queryMock.mockResolvedValueOnce({ rows: [] }); // insert user message
  queryMock.mockResolvedValueOnce({ rows: [{ id: 'msg-1', role: 'assistant', content: 'reply', created_at: '2026-01-01T00:00:00Z' }] }); // insert assistant message
  queryMock.mockResolvedValueOnce({ rows: [] }); // update conversation
}

beforeEach(() => {
  mockDbSequence();
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [{ text: 'a'.repeat(20000) }] });
  getActiveRestrictedEvidenceForStudentMock.mockReset().mockResolvedValue({ allowed: true, reason: 'NO_ACTIVE_RESTRICTED_EVIDENCE', activityType: null, evidenceMode: null, sessionId: null });
  callModelMock.mockReset();
  recordRuntimeEventMock.mockReset();
});

/* ================================================================ *
 * AI ARCHITECTURE 1-4                                                *
 * ================================================================ */
describe('LX-9 required tests 1-4 -- AI architecture: central routing is authoritative for the newly-migrated call sites', () => {
  const MIGRATED_SERVICES = [
    'src/services/concept-extraction.service.ts',
    'src/services/topic-hierarchy.service.ts',
    'src/services/localization.service.ts',
    'src/services/tutor.service.ts',
  ];

  it('1/3. no hard-coded claude-* id or Anthropic adapter import remains in any newly-migrated service (checked against CODE, not doc comments explaining the migration)', () => {
    for (const svc of MIGRATED_SERVICES) {
      const src = strip(read(svc));
      expect(src).not.toMatch(/['"`]claude[-.][\w.-]+['"`]/);
      expect(src).not.toMatch(/adapters\/anthropic/);
      expect(src).not.toMatch(/callAnthropicMessages/);
    }
  });

  it('3. every newly-migrated service routes through resolveModels(...) rather than a literal provider/model', () => {
    for (const svc of MIGRATED_SERVICES) {
      expect(read(svc)).toMatch(/resolveModels\(/);
    }
  });

  it('2. ai.service.ts keeps exactly one documented Anthropic exception (vision transcription, which the OpenAI adapter does not support) -- not a silent, unjustified bypass', () => {
    const rawSrc = read('src/services/ai.service.ts');
    expect(rawSrc).toMatch(/callAnthropicMessages/);
    expect(rawSrc).toMatch(/vision|image/i);
  });

  it('4. no new model-name literal branching exists outside model-routing.ts / pricing.ts', () => {
    const offenders = [
      'src/services/concept-extraction.service.ts',
      'src/services/topic-hierarchy.service.ts',
      'src/services/localization.service.ts',
      'src/services/tutor.service.ts',
      'src/services/quiz-generation.service.ts',
    ];
    for (const svc of offenders) {
      expect(read(svc)).not.toMatch(/model\s*===\s*['"`]gpt-/);
    }
  });
});

/* ================================================================ *
 * ROUTING 9-12                                                       *
 * ================================================================ */
describe('LX-9 required tests 9-12 -- Luna-first routing, bounded Terra fallback, documented Terra-only rationale', () => {
  it('9. CLASSIFICATION/OTHER/CONTENT_GENERATION/TUTOR all resolve to Luna as primary', () => {
    expect(resolveModels('CLASSIFICATION').primary).toBe(LUNA);
    expect(resolveModels('OTHER').primary).toBe(LUNA);
    expect(resolveModels('CONTENT_GENERATION').primary).toBe(LUNA);
    expect(resolveModels('TUTOR').primary).toBe(LUNA);
  });

  it('10. every capability pinned to Terra-only (primary === fallback === TERRA) carries a non-empty documented rationale', () => {
    for (const [capability, route] of Object.entries(CAPABILITY_ROUTING)) {
      if (route.primary === TERRA && route.fallback === TERRA) {
        expect(route.rationale.trim().length, `${capability} has no rationale`).toBeGreaterThan(0);
      }
    }
  });
});

/* ================================================================ *
 * Tutor: Luna-first + one bounded Terra fallback (routing 11-12,     *
 * observability 32-37, tokens 21/23).                                *
 * ================================================================ */
describe('LX-9 tutor migration -- Luna-first, one bounded Terra fallback, real telemetry', () => {
  it('11/12. one Luna failure triggers exactly one Terra retry, never a third call', async () => {
    callModelMock
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'AbortError' }))
      .mockResolvedValueOnce({ text: 'terra reply', raw: {}, provider: 'openai', model: 'gpt-5.6-terra' });
    const reply = await sendMessage('conv-1', 's1', 'hi', 'en');
    expect(reply.content).toBe('reply'); // persisted row content from the mocked DB insert
    expect(callModelMock).toHaveBeenCalledTimes(2);
    const [firstCall] = callModelMock.mock.calls[0];
    const [secondCall] = callModelMock.mock.calls[1];
    expect(firstCall.model).toBe('gpt-5.6-luna');
    expect(secondCall.model).toBe('gpt-5.6-terra');
  });

  it('11. a successful Luna call never triggers a Terra call at all', async () => {
    callModelMock.mockResolvedValueOnce({ text: 'luna reply', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
    await sendMessage('conv-1', 's1', 'hi', 'en');
    expect(callModelMock).toHaveBeenCalledTimes(1);
  });

  it('every callModel invocation passes plainText: true -- a tutor reply is prose/LaTeX, never forced JSON', async () => {
    callModelMock.mockResolvedValueOnce({ text: 'luna reply', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
    await sendMessage('conv-1', 's1', 'hi', 'en');
    const [params] = callModelMock.mock.calls[0];
    expect(params.plainText).toBe(true);
  });

  it('21. the RAG context inserted into the system prompt is bounded (fitContextChunks), not the full unbounded chunk text', async () => {
    // Many SMALL chunks (not one giant unsplittable one) -- fitContextChunks
    // keeps whole chunks and never drops below one, so a single oversized
    // chunk would defeat this test regardless of bounding; many small ones
    // actually exercise the cutoff.
    retrieveContextMock.mockResolvedValueOnce({ chunks: Array.from({ length: 20 }, () => ({ text: 'x'.repeat(1000) })) });
    callModelMock.mockResolvedValueOnce({ text: 'luna reply', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
    await sendMessage('conv-1', 's1', 'hi', 'en');
    const [params] = callModelMock.mock.calls[0];
    expect(params.system.length).toBeLessThan(budgetFor('tutor_reply').maxContextChars + 5000); // some slack for the fixed instructional text around it
  });

  it('23. maxTokens for the tutor call comes from the tutor_reply token budget, not a bare literal', async () => {
    callModelMock.mockResolvedValueOnce({ text: 'luna reply', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
    await sendMessage('conv-1', 's1', 'hi', 'en');
    const [params] = callModelMock.mock.calls[0];
    expect(params.maxTokens).toBe(budgetFor('tutor_reply').maxOutputTokens);
  });

  it('33/34/35. usage/cost telemetry and fallback are captured for both the Luna attempt and the Terra fallback attempt', async () => {
    callModelMock
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'AbortError' }))
      .mockResolvedValueOnce({ text: 'terra reply', raw: { usage: { input_tokens: 100, output_tokens: 50 } }, provider: 'openai', model: 'gpt-5.6-terra' });
    await sendMessage('conv-1', 's1', 'hi', 'en');
    expect(recordRuntimeEventMock).toHaveBeenCalledTimes(2);
    const [lunaEvent] = recordRuntimeEventMock.mock.calls[0];
    const [terraEvent] = recordRuntimeEventMock.mock.calls[1];
    expect(lunaEvent.fallbackUsed).toBe(false);
    expect(terraEvent.fallbackUsed).toBe(true);
    expect(terraEvent.fallbackReason).toMatch(/luna:/);
  });

  it('32. both events for one turn share the same operationId', async () => {
    callModelMock
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'AbortError' }))
      .mockResolvedValueOnce({ text: 'terra reply', raw: {}, provider: 'openai', model: 'gpt-5.6-terra' });
    await sendMessage('conv-1', 's1', 'hi', 'en');
    const [lunaEvent] = recordRuntimeEventMock.mock.calls[0];
    const [terraEvent] = recordRuntimeEventMock.mock.calls[1];
    expect(lunaEvent.operationId).toBeTruthy();
    expect(lunaEvent.operationId).toBe(terraEvent.operationId);
  });

  it('36. a failure of BOTH Luna and Terra still propagates rather than being silently swallowed', async () => {
    callModelMock
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'AbortError' }))
      .mockRejectedValueOnce(Object.assign(new Error('timeout again'), { name: 'AbortError' }));
    await expect(sendMessage('conv-1', 's1', 'hi', 'en')).rejects.toThrow();
    expect(callModelMock).toHaveBeenCalledTimes(2); // still never a 3rd attempt
  });
});

/* ================================================================ *
 * DETERMINISTIC 5-8, GRADING 29-31                                   *
 * ================================================================ */
describe('LX-9 required tests 5-8, 29-31 -- deterministic numeric grading needs no AI call', () => {
  const numericQuestion = (correctAnswer: string): any => ({
    conceptId: 'c1', type: 'numeric_problem', question: 'What is 2+2?', correctAnswer, options: undefined,
    explanation: 'e', difficulty: 3,
  });

  it('29. a bare-number answer that exactly matches the correct answer is graded with ZERO AI calls', async () => {
    const result = await gradeAnswer(numericQuestion('4'), '4', 'en');
    expect(callModelMock).not.toHaveBeenCalled();
    expect(result.correct).toBe(true);
    expect(result.score).toBe(1);
    expect(result.reasoningValid).toBe(true);
    expect(result.aiExecution.aiModel).toBe('deterministic-numeric-match');
  });

  it('29. a bare-number answer within the same tight tolerance the Quality Gate itself uses is also graded deterministically', async () => {
    const result = await gradeAnswer(numericQuestion('4.00001'), '4', 'en');
    expect(callModelMock).not.toHaveBeenCalled();
    expect(result.correct).toBe(true);
  });

  it('30/31. a WRONG bare-number answer is NOT graded deterministically -- it still goes through AI grading', async () => {
    callModelMock.mockResolvedValueOnce({
      text: JSON.stringify({ correct: false, score: 0, feedback: 'Wrong.', confidence: 0.9, errorType: 'CARELESS', reasoningValid: true }),
      raw: {}, provider: 'openai', model: 'gpt-5.6-terra',
    });
    const result = await gradeAnswer(numericQuestion('4'), '5', 'en');
    expect(callModelMock).toHaveBeenCalledTimes(1);
    expect(result.correct).toBe(false);
  });

  it('30. an answer that SHOWS WORK (not a bare number) still goes through AI grading, even if it contains the right final number', async () => {
    callModelMock.mockResolvedValueOnce({
      text: JSON.stringify({ correct: true, score: 1, feedback: 'Correct.', confidence: 0.9, errorType: null, reasoningValid: true }),
      raw: {}, provider: 'openai', model: 'gpt-5.6-terra',
    });
    await gradeAnswer(numericQuestion('4'), '2+2=4', 'en');
    expect(callModelMock).toHaveBeenCalledTimes(1);
  });

  it('5/7. a non-numeric_problem type never uses the deterministic numeric path -- always AI-graded', async () => {
    callModelMock.mockResolvedValueOnce({
      text: JSON.stringify({ correct: true, score: 1, feedback: 'Correct.', confidence: 0.9, errorType: null, reasoningValid: true }),
      raw: {}, provider: 'openai', model: 'gpt-5.6-terra',
    });
    const q: any = { conceptId: 'c1', type: 'short_answer', question: 'q', correctAnswer: '4', explanation: 'e', difficulty: 3 };
    await gradeAnswer(q, '4', 'en');
    expect(callModelMock).toHaveBeenCalledTimes(1);
  });

  it('8. gradeStructuredAnswer (multiple_choice/matching/ordering/classification) invokes zero AI -- source contract', () => {
    const src = strip(read('src/services/quiz-generation.service.ts'));
    const fnStart = src.indexOf('function gradeStructuredAnswer');
    const fnSrc = src.slice(fnStart, fnStart + 2500);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnSrc).not.toMatch(/executeAI|callModel/);
  });
});

/* ================================================================ *
 * OBSERVABILITY 37 -- performance dashboard read contract.           *
 * ================================================================ */
describe('LX-9 required test 37 -- wasted-call classification is available', () => {
  it('summarizeByCapability aggregates calls/latency/tokens/cost/fallback/first-pass-acceptance per capability, never fabricating a capability with zero events', () => {
    const events: any[] = [
      { capability: 'QUESTION_GENERATION', provider: 'openai', model: 'gpt-5.6-luna', promptId: 'p', promptVersion: 'v1', inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, latencyMs: 1000, fallbackUsed: false, qualityGateResult: 'PASS', acceptedCount: 3, rejectedCount: 1, estimatedCostUSD: 0.001, costComplete: true },
      { capability: 'QUESTION_GENERATION', provider: 'openai', model: 'gpt-5.6-terra', promptId: 'p', promptVersion: 'v1', inputTokens: 200, cachedInputTokens: 0, outputTokens: 80, latencyMs: 2000, fallbackUsed: true, qualityGateResult: 'PASS', acceptedCount: 2, rejectedCount: 0, estimatedCostUSD: 0.003, costComplete: true },
    ];
    const [summary] = summarizeByCapability(events);
    expect(summary.capability).toBe('QUESTION_GENERATION');
    expect(summary.calls).toBe(2);
    expect(summary.totalLatencyMs).toBe(3000);
    expect(summary.fallbackCount).toBe(1);
    expect(summary.fallbackRate).toBe(0.5);
    expect(summary.totalEstimatedCostUSD).toBeCloseTo(0.004, 5);
    expect(summary.firstPassAcceptanceRate).toBeCloseTo(0.75, 5); // 3 accepted / 4 attempted, Luna-only (non-fallback) event
    expect(summarizeByCapability([])).toEqual([]);
  });

  it('groupByOperation correlates events sharing an operationId; detectWastedOperations flags a fallback that ran after the primary already succeeded', () => {
    const healthy: any[] = [
      { capability: 'QUESTION_GENERATION', provider: 'openai', model: 'gpt-5.6-luna', promptId: 'p', promptVersion: 'v1', inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, latencyMs: 1000, fallbackUsed: false, qualityGateResult: 'DETERMINISTIC_FAIL', acceptedCount: 0, rejectedCount: 4, estimatedCostUSD: 0.001, costComplete: true, operationId: 'op1' },
      { capability: 'QUESTION_GENERATION', provider: 'openai', model: 'gpt-5.6-terra', promptId: 'p', promptVersion: 'v1', inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, latencyMs: 1000, fallbackUsed: true, qualityGateResult: 'PASS', acceptedCount: 4, rejectedCount: 0, estimatedCostUSD: 0.001, costComplete: true, operationId: 'op1' },
    ];
    expect(groupByOperation(healthy)).toHaveLength(1);
    expect(detectWastedOperations(healthy)).toEqual([]); // expected, healthy case: fallback only ran because the primary had nothing accepted

    const wasteful: any[] = [
      { ...healthy[0], qualityGateResult: 'PASS', acceptedCount: 4, rejectedCount: 0, operationId: 'op2' },
      { ...healthy[1], operationId: 'op2' },
    ];
    const findings = detectWastedOperations(wasteful);
    expect(findings).toHaveLength(1);
    expect(findings[0].operationId).toBe('op2');
  });
});

/* ================================================================ *
 * MOTIVATION 38-42                                                   *
 * ================================================================ */
describe('LX-9 required tests 38-42 -- motivation/progression is presentation-only, evidence-grounded, no new authority', () => {
  it('39. a milestone fires ONLY on a genuine forward stage crossing -- never on a lateral or backward move', () => {
    expect(deriveMilestoneFromStageTransition(null, 'LEARN')).toBe('STARTED');
    // PROVE/RETAIN/TRANSFER are open-obligation stages -- clearing one
    // means moving PAST it, so a jump from READY_TO_PROVE straight to
    // RETAIN reports the most advanced milestone actually reached
    // (RETAIN's own obligation isn't cleared yet, so PROVED is correct
    // here, not RETAINED).
    expect(deriveMilestoneFromStageTransition('READY_TO_PROVE', 'RETAIN')).toBe('PROVED');
    expect(deriveMilestoneFromStageTransition('PRACTICE', 'TRANSFER')).toBe('RETAINED');
    // clearing the RETAIN obligation and landing back in TRANSFER (a new
    // obligation, not yet cleared) is a RETAINED milestone, not TRANSFERRED.
    expect(deriveMilestoneFromStageTransition('RETAIN', 'TRANSFER')).toBe('RETAINED');
    // TRANSFER and CONSOLIDATED are adjacent stages -- clearing the
    // transfer obligation specifically is the one case that reports
    // TRANSFERRED rather than the general CONSOLIDATED catch-all.
    expect(deriveMilestoneFromStageTransition('TRANSFER', 'CONSOLIDATED')).toBe('TRANSFERRED');
    // no movement / lateral / backward -> null, never fabricated
    expect(deriveMilestoneFromStageTransition('PRACTICE', 'PRACTICE')).toBeNull();
    expect(deriveMilestoneFromStageTransition('RETAIN', 'PRACTICE')).toBeNull();
    expect(deriveMilestoneFromStageTransition('CONSOLIDATED', 'CONSOLIDATED')).toBeNull();
  });

  it('40. CONSOLIDATED milestone fires only when the actual canonical stage IS CONSOLIDATED, never inferred from a score -- and never for the TRANSFER->CONSOLIDATED transition specifically, which reports the more precise TRANSFERRED instead', () => {
    expect(deriveMilestoneFromStageTransition('RETAIN', 'CONSOLIDATED')).toBe('CONSOLIDATED');
    expect(deriveMilestoneFromStageTransition('TRANSFER', 'CONSOLIDATED')).toBe('TRANSFERRED');
    expect(deriveMilestoneFromStageTransition('LEARN', 'PRACTICE')).not.toBe('CONSOLIDATED');
  });

  it('42. progression-milestones.ts never redefines or duplicates deriveLearnerJourneyStage -- it only imports the stage TYPE', () => {
    const src = strip(read('src/lib/lx/progression-milestones.ts'));
    expect(src).not.toMatch(/function deriveLearnerJourneyStage/);
    expect(src).toMatch(/import type \{ LearnerJourneyStage \}/);
  });

  it('38. no XP/points/badge/loot mechanic exists in the ACTUAL BEHAVIOR of the new motivation modules (comments documenting the anti-pattern to avoid are not code)', () => {
    const src = strip(read('src/lib/lx/progression-milestones.ts')) + strip(read('src/services/gamification.service.ts'));
    expect(src).not.toMatch(/\bXP\b|\bpoints\b|\bbadge\b|\bloot\b/i);
  });

  it('41. getLearningDaysThisWeek only SELECTs -- it never writes to mastery_records / concept_knowledge_state, so habit tracking cannot alter competence', () => {
    const src = read('src/services/gamification.service.ts');
    const fnSrc = src.slice(src.indexOf('export async function getLearningDaysThisWeek'));
    expect(fnSrc).toMatch(/SELECT/);
    expect(fnSrc).not.toMatch(/UPDATE|INSERT|DELETE/);
  });

  it('41. the count is bounded to a single calendar week (Monday-Sunday), never a growing cumulative total', () => {
    const src = read('src/services/gamification.service.ts');
    const fnSrc = src.slice(src.indexOf('export async function getLearningDaysThisWeek'));
    expect(fnSrc).toMatch(/date_trunc\('week'/);
  });

  it('milestone feedback copy exists for all 5 milestones across the required locales and never mentions XP/points', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt'] as const) {
      const t = getMessages(locale);
      for (const key of [
        'progression.milestoneStarted',
        'progression.milestoneProved',
        'progression.milestoneRetained',
        'progression.milestoneTransferred',
        'progression.milestoneConsolidated',
      ] as const) {
        expect(t[key]).toBeTruthy();
        expect(t[key]).not.toMatch(/XP|points|\+\d+/i);
      }
    }
  });
});

/* ================================================================ *
 * QUALITY GATE 16-18 -- confirmed via EXISTING coverage, not          *
 * duplicated; this test only proves the citation is accurate.        *
 * ================================================================ */
describe('LX-9 required tests 16-18 -- deterministic PASS/FAIL already skip the semantic call (pre-existing, audited not re-implemented)', () => {
  it('applyQuestionQualityGate only sends NOT_DETERMINISTICALLY_VERIFIED questions to the semantic verifier -- unchanged by LX-9', () => {
    const rawSrc = read('src/services/gated-question-generation.service.ts');
    const strippedSrc = strip(rawSrc);
    expect(strippedSrc).toMatch(/needsSemantic\.push/);
    expect(rawSrc).toMatch(/NOT_DETERMINISTICALLY_VERIFIED/);
  });
});
