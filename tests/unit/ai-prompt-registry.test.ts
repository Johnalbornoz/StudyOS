import { describe, it, expect } from 'vitest';
import { PROMPT_REGISTRY, getPrompt, type PromptId } from '@/lib/ai/prompt-registry';
import { AIExecutionError } from '@/lib/ai/errors';

const VALID_CAPABILITIES = new Set([
  'CONTENT_GENERATION',
  'QUESTION_GENERATION',
  'GRADING',
  'CLASSIFICATION',
  'COGNITIVE_ANALYSIS',
  'TRANSFER_EVALUATION',
  'EXPLANATION_EVALUATION',
  'EMBEDDING',
  'TUTOR',
  'OTHER',
]);

describe('PROMPT_REGISTRY', () => {
  it('every entry has a non-empty id, version, capability, service, and description', () => {
    for (const [key, def] of Object.entries(PROMPT_REGISTRY)) {
      expect(def.id).toBe(key);
      expect(def.id.length).toBeGreaterThan(0);
      expect(def.version).toMatch(/^v\d+$/);
      expect(VALID_CAPABILITIES.has(def.capability)).toBe(true);
      expect(def.service.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('every registered id is unique (the object keys themselves already guarantee this, but assert it explicitly)', () => {
    const ids = Object.values(PROMPT_REGISTRY).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getPrompt returns the exact registered definition for a known id', () => {
    const def = getPrompt('quiz.free_text_grading');
    expect(def.capability).toBe('GRADING');
    expect(def.version).toBe('v1');
  });

  it('getPrompt throws CONFIGURATION_ERROR for an unregistered id', () => {
    expect(() => getPrompt('not.a.real.prompt' as PromptId)).toThrow(AIExecutionError);
    try {
      getPrompt('not.a.real.prompt' as PromptId);
    } catch (err) {
      expect((err as AIExecutionError).code).toBe('CONFIGURATION_ERROR');
    }
  });

  it('every capability StudyUs actually uses appears somewhere in the registry (Step 23 inventory sanity check)', () => {
    const capabilitiesInUse = new Set(Object.values(PROMPT_REGISTRY).map((d) => d.capability));
    expect(capabilitiesInUse.has('GRADING')).toBe(true);
    expect(capabilitiesInUse.has('CLASSIFICATION')).toBe(true);
    expect(capabilitiesInUse.has('TRANSFER_EVALUATION')).toBe(true);
    expect(capabilitiesInUse.has('EXPLANATION_EVALUATION')).toBe(true);
    expect(capabilitiesInUse.has('QUESTION_GENERATION')).toBe(true);
    expect(capabilitiesInUse.has('COGNITIVE_ANALYSIS')).toBe(true);
    expect(capabilitiesInUse.has('CONTENT_GENERATION')).toBe(true);
    expect(capabilitiesInUse.has('EMBEDDING')).toBe(true);
    expect(capabilitiesInUse.has('TUTOR')).toBe(true);
  });
});
