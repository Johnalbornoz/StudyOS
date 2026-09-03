/**
 * Phase 5-R: consolidated, permanent regression coverage for the
 * release-blocking checklist items not already exercised end-to-end
 * elsewhere -- turns this session's manual audit greps into CI-enforced
 * invariants (release tests 11-13, 21, 22, 24, plus a fixed live-
 * consumer count).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ADAPTIVE_LEARNING_POLICY_VERSION } from '@/lib/adaptive-learning-policy';
import { ADAPTIVE_TEACHING_POLICY_VERSION } from '@/lib/adaptive-teaching-policy';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';

const ROOT = join(__dirname, '..', '..');
const NEW_OR_CHANGED_FILES = [
  'src/lib/adaptive-teaching-policy.ts',
  'src/lib/adaptive-teaching-generation.ts',
  'src/services/adaptive-teaching.service.ts',
  'src/services/quiz-generation.service.ts',
  'src/services/explain-defend.service.ts',
  'src/services/tutor.service.ts',
  'src/app/api/quizzes/hint/route.ts',
  'src/app/api/cognitive/explain/generate/route.ts',
];

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('release test 21 -- Teaching policy version unchanged unless the policy itself changes', () => {
  it('ADAPTIVE_TEACHING_POLICY_VERSION is still 1 -- Phase 5-R activates live consumption, it does not change barrier/strategy/support rules', () => {
    expect(ADAPTIVE_TEACHING_POLICY_VERSION).toBe(1);
  });
  it('ADAPTIVE_LEARNING_POLICY_VERSION (Decision Policy, protected) is unchanged at 3', () => {
    expect(ADAPTIVE_LEARNING_POLICY_VERSION).toBe(3);
  });
});

describe('release test 22 -- every prompt this phase changed has a correctly bumped version', () => {
  it('quiz.question_hint is v2 (system prompt now optionally carries adaptive constraints)', () => {
    expect(PROMPT_REGISTRY['quiz.question_hint'].version).toBe('v2');
  });
  it('explain.prompt_generation is v2', () => {
    expect(PROMPT_REGISTRY['explain.prompt_generation'].version).toBe('v2');
  });
  it('tutor.chat_reply is v2', () => {
    expect(PROMPT_REGISTRY['tutor.chat_reply'].version).toBe('v2');
  });
  it('every other registered prompt is untouched at v1 -- only the 3 activated surfaces changed', () => {
    const untouchedIds = Object.keys(PROMPT_REGISTRY).filter(
      (id) => !['quiz.question_hint', 'explain.prompt_generation', 'tutor.chat_reply'].includes(id)
    );
    for (const id of untouchedIds) {
      expect(PROMPT_REGISTRY[id as keyof typeof PROMPT_REGISTRY].version).toBe('v1');
    }
  });
});

describe('release test 24 -- no learning-style classifier introduced by this phase\'s live wiring', () => {
  it('none of the new/changed files mention visual/auditory/kinesthetic/learning-style anywhere', () => {
    for (const file of NEW_OR_CHANGED_FILES) {
      const content = read(file);
      expect(content).not.toMatch(/visual learner|auditory learner|kinesthetic|left-brain|right-brain|learning style/i);
    }
  });
});

describe('release tests 11-13 -- zero writes to Mastery/Knowledge State/learning_evidence from the activated teaching surfaces', () => {
  it('none of the new/changed files contain an INSERT/UPDATE/DELETE against a protected cognitive-state table', () => {
    const forbiddenPattern = /(INSERT INTO|UPDATE |DELETE FROM)\s+(mastery_records|concept_knowledge_state|learning_evidence|verification_attempts|student_misconceptions)/i;
    for (const file of NEW_OR_CHANGED_FILES) {
      const content = read(file);
      expect(content).not.toMatch(forbiddenPattern);
    }
  });
  it('the two Phase 5 lib files (policy + generation adapter) contain no SQL/db reference at all -- they are pure', () => {
    for (const file of ['src/lib/adaptive-teaching-policy.ts', 'src/lib/adaptive-teaching-generation.ts']) {
      const content = read(file);
      expect(content).not.toMatch(/db\.query|@\/lib\/db/);
    }
  });
});

describe('S18 -- Phase 4 decision fields are never reassigned in the wired call sites', () => {
  it('none of the route/service changes contain an assignment into decision.activityType/actionConceptId/learningState', () => {
    const forbiddenAssignment = /decision\.(activityType|actionConceptId|learningState)\s*=/;
    for (const file of NEW_OR_CHANGED_FILES) {
      const content = read(file);
      expect(content).not.toMatch(forbiddenAssignment);
    }
  });
});

describe('LIVE_TEACHING_INTENT_CONSUMERS -- exactly 3 canonical surfaces, no indiscriminate wiring', () => {
  it('quiz-generation.service.ts::generateQuestionHint consumes TeachingGenerationContext', () => {
    expect(read('src/services/quiz-generation.service.ts')).toMatch(/generationContext\?: TeachingGenerationContext/);
  });
  it('explain-defend.service.ts::generateExplainPrompt consumes TeachingGenerationContext', () => {
    expect(read('src/services/explain-defend.service.ts')).toMatch(/generationContext\?: TeachingGenerationContext/);
  });
  it('tutor.service.ts::sendMessage consumes getTeachingIntentForConcept', () => {
    expect(read('src/services/tutor.service.ts')).toMatch(/getTeachingIntentForConcept/);
  });
  it('no other production source file references TeachingGenerationContext/getTeachingIntentForConcept (indiscriminate-wiring guard)', () => {
    const allowed = new Set(NEW_OR_CHANGED_FILES);
    const pattern = /TeachingGenerationContext|getTeachingIntentForConcept/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const relPath = join(dir, entry);
        const abs = join(ROOT, relPath);
        if (statSync(abs).isDirectory()) {
          walk(relPath);
        } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
          const content = readFileSync(abs, 'utf8');
          const normalizedRelPath = relPath.split('\\').join('/');
          if (pattern.test(content) && !allowed.has(normalizedRelPath)) {
            offenders.push(normalizedRelPath);
          }
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
