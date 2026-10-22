/**
 * PERF-AI-LR -- low-risk AI latency batch (P5 explicit reasoning effort,
 * P6 topic-search reuse, P7 tutor concept-scoped retrieval, P9
 * interactive timeouts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const executeAIMock = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  return { ...actual, executeAI: (...a: any[]) => executeAIMock(...a) };
});
vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

import { TOKEN_BUDGETS, budgetFor } from '@/lib/ai/token-budgets';
import { DEFAULT_AI_TIMEOUT_MS } from '@/lib/ai/gateway';
import { suggestConceptNames, clearConceptSuggestionCache } from '@/services/concept-extraction.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('P5 -- every previously effort-less interactive call now declares a reasoning effort', () => {
  it('declares budgets with an explicit effort for error guidance, topic suggestions and free-text grading', () => {
    expect(budgetFor('error_pattern_guidance')).toMatchObject({ maxOutputTokens: 1200, reasoningEffort: 'low' });
    expect(budgetFor('concept_name_suggestions')).toMatchObject({ maxOutputTokens: 300, reasoningEffort: 'none' });
    expect(budgetFor('free_text_grading')).toMatchObject({ maxOutputTokens: 1536, reasoningEffort: 'low' });
  });

  it('wires those budgets at the call sites (no bare maxTokens literals left)', () => {
    const guidance = read('src/services/error-intelligence.service.ts');
    expect(guidance).toMatch(/budgetFor\('error_pattern_guidance'\)/);
    expect(guidance).not.toMatch(/maxTokens: 1200/);
    const grading = read('src/services/quiz-generation.service.ts');
    expect(grading).toMatch(/reasoningEffort: budgetFor\('free_text_grading'\)\.reasoningEffort/);
    expect(grading).not.toMatch(/maxTokens: 1536/);
  });
});

describe('P9 -- interactive timeouts are bounded below the Gateway default', () => {
  it('every budget that declares a timeout stays under the 30 s default', () => {
    for (const [k, b] of Object.entries(TOKEN_BUDGETS) as [string, { timeoutMs?: number }][]) {
      if (b.timeoutMs === undefined) continue;
      expect(b.timeoutMs, k).toBeGreaterThan(0);
      expect(b.timeoutMs, k).toBeLessThan(DEFAULT_AI_TIMEOUT_MS);
    }
    expect(budgetFor('learn_guided_turn').timeoutMs).toBe(25_000);
    expect(budgetFor('tutor_reply').timeoutMs).toBe(25_000);
    expect(budgetFor('contextual_help').timeoutMs).toBe(12_000);
  });

  it('guided Learn, the tutor (primary and Terra retry) and hints use the budget timeout', () => {
    expect(read('src/services/learn-guided.service.ts')).toMatch(/timeoutMs: budget\.timeoutMs/);
    expect(read('src/services/tutor.service.ts').match(/timeoutMs: budget\.timeoutMs/g)).toHaveLength(2);
    expect(read('src/services/quiz-generation.service.ts')).toMatch(/timeoutMs: HINT_BUDGET\.timeoutMs/);
  });
});

describe('P6 -- topic suggestions are reused instead of re-asking the model', () => {
  beforeEach(() => {
    clearConceptSuggestionCache();
    executeAIMock.mockReset();
  });

  it('a repeated (subject, text, language) query is answered from the memo', async () => {
    executeAIMock.mockResolvedValue({ result: ['Redes neuronales convolucionales'] });
    const a = await suggestConceptNames('Inteligencia Artificial', 'redes neuronales', 'es');
    const b = await suggestConceptNames('inteligencia artificial', '  Redes   neuronales ', 'es');
    expect(a).toEqual(['Redes neuronales convolucionales']);
    expect(b).toEqual(a);
    expect(executeAIMock).toHaveBeenCalledTimes(1);
    expect(executeAIMock.mock.calls[0][0]).toMatchObject({ timeoutMs: 8_000 });
  });

  it('never memoizes an empty / fallback result', async () => {
    executeAIMock.mockResolvedValue({ result: [] });
    await suggestConceptNames('Física', 'cinemática', 'es');
    await suggestConceptNames('Física', 'cinemática', 'es');
    expect(executeAIMock).toHaveBeenCalledTimes(2);
  });

  it('a different language is a different entry', async () => {
    executeAIMock.mockResolvedValue({ result: ['x'] });
    await suggestConceptNames('Physics', 'kinematics', 'en');
    await suggestConceptNames('Physics', 'kinematics', 'es');
    expect(executeAIMock).toHaveBeenCalledTimes(2);
  });

  it('the finder cancels superseded requests and reuses answered ones', () => {
    const finder = read('src/app/dashboard/learn/ConceptFinder.tsx');
    expect(finder).toMatch(/controller\.abort\(\)/);
    expect(finder).toMatch(/proposalCache\.current\.get\(cacheKey\)/);
  });
});

describe('P7 -- tutor retrieval is concept-scoped when the concept is known', () => {
  it('passes the verified conceptId to retrieveContext (semantic search stays the fallback)', () => {
    expect(read('src/services/tutor.service.ts')).toMatch(/retrieveContext\(studentId, conv\.subject_id, \{ query: userMessage, conceptId, limit: 5 \}\)/);
  });
  it('does not hold the composer on the conversation-list refresh', () => {
    expect(read('src/app/dashboard/tutor/TutorChat.tsx')).toMatch(/void loadConversations\(\);/);
  });
});
