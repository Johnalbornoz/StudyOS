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
  // Step 6L-B1: the Remediation Session Shell's one read boundary --
  // the 4th deliberate TeachingIntent consumer (see its own header
  // comment for why: the same getTeachingIntentForConcept call
  // explain/generate and quizzes/hint already make live, called once
  // more here for the support-level/misconception-context signal, not
  // a new category of side effect).
  'src/lib/remediation-session-view.ts',
  // LX-4R R1/R4: two deliberate consumers that make canonical adaptive
  // teaching VISIBLE in the active-learning experience -- both call the
  // SAME getTeachingIntentForConcept (never a re-implementation).
  //   - teaching-intent route: returns ONLY the derived
  //     TeachingExperienceView (client never sees raw TeachingIntent).
  //   - contextual-help route: uses it to adapt hint generation, exactly
  //     as /api/quizzes/hint already does.
  'src/app/api/learning/teaching-intent/route.ts',
  'src/app/api/learning/contextual-help/route.ts',
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
  it('quiz.question_hint is v3 (v2 adaptive constraints + v3 Phase 7 7E3 teach-for-transfer clause)', () => {
    expect(PROMPT_REGISTRY['quiz.question_hint'].version).toBe('v3');
  });
  it('explain.prompt_generation is v2', () => {
    expect(PROMPT_REGISTRY['explain.prompt_generation'].version).toBe('v2');
  });
  it('tutor.chat_reply is v2', () => {
    expect(PROMPT_REGISTRY['tutor.chat_reply'].version).toBe('v2');
  });
  it('every other registered prompt is untouched at v1 -- only the 3 Phase 5-R activated surfaces changed (plus quiz.question_generation for STABILIZATION QUIZ PERFORMANCE Step 9, and transfer.activity_generation / transfer.response_evaluation for Phase 7 Steps 7D1 / 7D3 -- see their own doc comments in prompt-registry.ts)', () => {
    const untouchedIds = Object.keys(PROMPT_REGISTRY).filter(
      (id) =>
        ![
          'quiz.question_hint',
          'explain.prompt_generation',
          'tutor.chat_reply',
          'quiz.question_generation',
          'transfer.activity_generation',
          'transfer.response_evaluation',
        ].includes(id)
    );
    for (const id of untouchedIds) {
      expect(PROMPT_REGISTRY[id as keyof typeof PROMPT_REGISTRY].version).toBe('v1');
    }
  });
  it('transfer.activity_generation is v2 (Phase 7 Step 7D1 -- structured candidate generation)', () => {
    expect(PROMPT_REGISTRY['transfer.activity_generation'].version).toBe('v2');
  });
  it('transfer.response_evaluation is v2 (Phase 7 Step 7D3 -- grades application to the new context)', () => {
    expect(PROMPT_REGISTRY['transfer.response_evaluation'].version).toBe('v2');
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

describe('LIVE_TEACHING_INTENT_CONSUMERS -- canonical surfaces only (6L-B1 added the 4th; LX-4R added the teaching-intent + contextual-help routes), no indiscriminate wiring', () => {
  it('quiz-generation.service.ts::generateQuestionHint consumes TeachingGenerationContext', () => {
    expect(read('src/services/quiz-generation.service.ts')).toMatch(/generationContext\?: TeachingGenerationContext/);
  });
  it('explain-defend.service.ts::generateExplainPrompt consumes TeachingGenerationContext', () => {
    expect(read('src/services/explain-defend.service.ts')).toMatch(/generationContext\?: TeachingGenerationContext/);
  });
  it('tutor.service.ts::sendMessage consumes getTeachingIntentForConcept', () => {
    expect(read('src/services/tutor.service.ts')).toMatch(/getTeachingIntentForConcept/);
  });
  it('Step 6L-B1: remediation-session-view.ts::getRemediationSessionView consumes getTeachingIntentForConcept for the support-level/misconception-context signal only', () => {
    expect(read('src/lib/remediation-session-view.ts')).toMatch(/getTeachingIntentForConcept/);
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
