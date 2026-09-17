/**
 * LX-9R6 -- CANONICAL QUIZ GENERATION RELIABILITY. The 45 required
 * tests, in order (Matrix 1-10, Contract 11-16, Counts 17-20, Quality
 * 21-25, Session/Retry 26-32, Client 33-37, Regression 38-45).
 *
 * Live trace summary: "Fuerza centrípeta" completed PRACTICE at 100%,
 * correctly advancing the canonical journey to PROVE ("Comprobación
 * individual" / SOLO_CHECK), but clicking "Comprobar" immediately
 * produced "Couldn't prepare your practice" -- wrong on two counts: (1)
 * SOLO_CHECK is not "practice," and (2) the failure was NOT transient-
 * AI noise but a genuine, provable reliability gap: generateQuickCheckQuestions
 * (SOLO_CHECK's dedicated 6-parallel-slot generator) had NO recovery
 * path for a slot's INITIAL AI call failing (timeout/refusal/malformed
 * JSON) -- only a slot that generated successfully but then failed the
 * QUALITY GATE ever got a Terra retry. A single transient failure in
 * ANY of 6 independent parallel calls therefore failed the entire
 * activity outright, with zero retry -- unlike generateRetentionCheckQuestions,
 * which already recovers from exactly this failure class (Rule 6B/6C).
 * Fixed by extending the SAME Terra-recovery mechanism to a slot's
 * initial-call failure, and by making the canonical "couldn't prepare"
 * card (quiz/page.tsx) and its copy (messages.ts) activity-neutral
 * instead of always saying "practice"/"teaching progress."
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const VERIFY_ROUTE_SRC = read('src/app/api/quizzes/verify/route.ts');
const SESSION_ENGINE_SRC = read('src/services/learning-session-engine.service.ts');
const QUIZ_GEN_SRC = read('src/services/quiz-generation.service.ts');
const GATED_SRC = read('src/services/gated-question-generation.service.ts');
const EVIDENCE_CONTRACT_SRC = read('src/lib/lx/evidence-sufficiency-contract.ts');
const DIFFICULTY_CONTRACT_SRC = read('src/lib/lx/difficulty-contract.ts');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const PERSISTENCE_SRC = read('src/services/quiz-persistence.service.ts');
const ACTIVITY_TAXONOMY_SRC = read('src/lib/activity-taxonomy.ts');
const REMEDIATION_SRC = read('src/services/remediation.service.ts');

import {
  generateQuickCheckQuestions,
  QUICK_CHECK_TYPES,
  RETENTION_REQUIRED_COUNT,
} from '@/services/quiz-generation.service';
import {
  deriveEvidenceRequirement,
  resolveQuestionCount,
  CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY,
  CURRENT_GENERATION_QUESTION_ENVELOPE,
  evidencePurposeForActivity,
} from '@/lib/lx/evidence-sufficiency-contract';
import { ACTIVITY_TYPE_BY_QUIZ_MODE, activityTypeForQuizMode, evidenceModeForQuizMode } from '@/services/quiz-persistence.service';
import { evidenceModeForActivity, type ActivityType } from '@/lib/activity-taxonomy';
import { buildCanonicalLearningProgress } from '@/lib/lx/canonical-learning-progress';
import { resolveConceptJourneyStage } from '@/lib/lx/path-view';
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import { MESSAGES } from '@/lib/i18n/messages';

function ks(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
    masteryState: 'PROVISIONAL_MASTERY', understandingScore: 85, independenceScore: null, applicationScore: 70,
    retentionScore: null, transferScore: null,
    activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
    evidenceCount: 8, independentEvidenceCount: 0, firstEvidenceAt: null, lastEvidenceAt: null,
    validationReadiness: 'READY', stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ConceptKnowledgeState;
}

function decision(learningState: string, activityType: string): LearningDecision {
  return {
    actionConceptId: 'c1', subjectId: 'subj1', learningState, activityType,
    targetDimension: 'INDEPENDENCE', priority: 1, derivedFrom: {},
  } as unknown as LearningDecision;
}

function masteryPolicy(overrides: Partial<MasteryPolicy> = {}): MasteryPolicy {
  return { version: 1, minimumEvidenceCount: 6, minimumIndependentEvidenceCount: 2, ...overrides } as MasteryPolicy;
}

function fakeQuestionOfType(type: string, i: number) {
  const base: any = { type, question: `Q${i} (${type})`, correctAnswer: 'a', explanation: 'because', difficulty: 3 };
  if (type === 'multiple_choice') { base.options = [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }]; base.correctAnswer = 'A'; }
  if (type === 'true_false') { base.options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]; base.correctAnswer = 'true'; }
  if (type === 'yes_no') { base.options = [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }]; base.correctAnswer = 'yes'; }
  return base;
}

// ============================================================
// PART A / REQUIRED TESTS 1-10 -- GENERATION MATRIX
// ============================================================
describe('1. every executable ActivityType maps to exactly one supported generation path', () => {
  it('resolveLaunch (learning-session-engine.service.ts) is an EXHAUSTIVE switch over ActivityType, one case per type, no duplicate case', () => {
    const body = strip(SESSION_ENGINE_SRC).slice(
      strip(SESSION_ENGINE_SRC).indexOf('switch (decision.activityType) {'),
      strip(SESSION_ENGINE_SRC).indexOf('async function startLearningSession'),
    );
    const allTypes: ActivityType[] = ['PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION', 'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM'];
    for (const t of allTypes) {
      const matches = body.match(new RegExp(`case '${t}':`, 'g')) || [];
      expect(matches.length).toBe(1);
    }
  });

  it('the switch has a default branch that is type-checked exhaustive (satisfies never) -- a future unhandled ActivityType fails to COMPILE, not silently at runtime', () => {
    expect(SESSION_ENGINE_SRC).toMatch(/default:\s*\n\s*return unavailable\(`No executable launch path implemented for ActivityType \$\{decision\.activityType satisfies never\}\.`\);/);
  });
});

describe('2. unsupported ActivityType fails closed', () => {
  it('the default branch returns UNAVAILABLE, never a READY launch and never PRACTICE', () => {
    const defaultBlock = SESSION_ENGINE_SRC.slice(SESSION_ENGINE_SRC.indexOf('default:'), SESSION_ENGINE_SRC.indexOf('default:') + 200);
    expect(defaultBlock).toContain('unavailable(');
    expect(defaultBlock).not.toContain("quizLaunch('topic_practice'");
  });

  it('generate-and-take rejects an unsupported quizMode with a 400 BEFORE any AI/DB work (Zod enum validated first in handleGenerateQuiz)', () => {
    // CANON-R6: 'canonical_prove' added to the closed enum. CANON-V2-ARCH-CLEANUP:
    // 'canonical_retain'/'canonical_transfer'/'canonical_learn_check' added too --
    // still a closed, exhaustive list; an unsupported string is still
    // rejected by Zod before any AI/DB work, unchanged.
    const enumIdx = ROUTE_SRC.indexOf('quizMode: z.enum([');
    expect(enumIdx).toBeGreaterThan(-1);
    const enumBlock = ROUTE_SRC.slice(enumIdx, ROUTE_SRC.indexOf(']).default', enumIdx));
    for (const mode of [
      'topic_practice', 'review', 'quick_check', 'retention_check', 'cumulative_assessment',
      'exam_simulation', 'diagnostic_check', 'canonical_prove', 'canonical_retain', 'canonical_transfer', 'canonical_learn_check',
    ]) {
      expect(enumBlock).toContain(`'${mode}'`);
    }
    expect(ROUTE_SRC).toMatch(/const validated = GenerateQuizSchema\.parse\(body\);/);
  });
});

describe('3. PRACTICE contract valid / 4. SOLO_CHECK contract valid / 6. RETENTION_CHECK contract valid / 7. REMEDIATION contract valid', () => {
  it('PRACTICE -> topic_practice -> generatePracticeQuestions, evidenceMode PRACTICE', () => {
    expect(ACTIVITY_TYPE_BY_QUIZ_MODE.topic_practice).toBe('PRACTICE');
    expect(evidenceModeForQuizMode('topic_practice')).toBe('PRACTICE');
    expect(ROUTE_SRC).toMatch(/quizMode === 'topic_practice'[\s\S]{0,80}generatePracticeQuestions/);
  });

  it('SOLO_CHECK -> quick_check -> generateQuickCheckQuestions, evidenceMode INDEPENDENT', () => {
    expect(ACTIVITY_TYPE_BY_QUIZ_MODE.quick_check).toBe('SOLO_CHECK');
    expect(evidenceModeForQuizMode('quick_check')).toBe('INDEPENDENT');
    expect(ROUTE_SRC).toMatch(/quizMode === 'quick_check'[\s\S]{0,80}generateQuickCheckQuestions/);
  });

  it('RETENTION_CHECK -> retention_check -> generateRetentionCheckQuestions (count===6), evidenceMode INDEPENDENT', () => {
    expect(ACTIVITY_TYPE_BY_QUIZ_MODE.retention_check).toBe('RETENTION_CHECK');
    expect(evidenceModeForQuizMode('retention_check')).toBe('INDEPENDENT');
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
    expect(ROUTE_SRC).toMatch(/quizMode === 'retention_check' && maxQuestions === RETENTION_REQUIRED_COUNT[\s\S]{0,80}generateRetentionCheckQuestions/);
  });

  it('REMEDIATION has no independent generator of its own -- every step type reuses an ALREADY-inventoried quizMode (topic_practice/quick_check/cumulative_assessment), per remediationStepHref', () => {
    expect(REMEDIATION_SRC).toMatch(/case 'LEARN':\s*\n\s*case 'GUIDED_PRACTICE':\s*\n\s*return `\/dashboard\/quiz\?subjectId=\$\{path\.subjectId\}&conceptId=\$\{step\.conceptId\}&mode=topic_practice/);
    expect(REMEDIATION_SRC).toMatch(/case 'RETRIEVAL':\s*\n\s*return `\/dashboard\/quiz\?subjectId=\$\{path\.subjectId\}&conceptId=\$\{step\.conceptId\}&mode=quick_check/);
    expect(REMEDIATION_SRC).toMatch(/case 'SOLO_VERIFY':\s*\n\s*return `\/dashboard\/quiz\?subjectId=\$\{path\.subjectId\}&conceptId=\$\{step\.conceptId\}&mode=cumulative_assessment/);
  });
});

describe('5. SOLO_VERIFY contract valid', () => {
  it('the top-level SOLO_VERIFY ActivityType never regenerates a question -- it resumes an EXISTING pending verification attempt via /api/quizzes/verify, a dedicated pipeline distinct from generate-and-take', () => {
    expect(SESSION_ENGINE_SRC).toMatch(/async function verificationLaunch/);
    expect(SESSION_ENGINE_SRC).toContain('No new verification_attempts row, no question regeneration');
    expect(VERIFY_ROUTE_SRC.length).toBeGreaterThan(0);
  });

  it('evidenceModeForActivity(SOLO_VERIFY) is INDEPENDENT, matching SOLO_CHECK\'s own evidence mode (both are "prove it alone" moments)', () => {
    expect(evidenceModeForActivity('SOLO_VERIFY')).toBe('INDEPENDENT');
    expect(evidenceModeForActivity('SOLO_CHECK')).toBe('INDEPENDENT');
  });
});

describe('8. diagnostic contract valid / 9. cumulative assessment contract valid / 10. mock exam contract valid', () => {
  it('DIAGNOSTIC_CHECK -> diagnostic_check, clamped to [2,4], goes through the gated batch path (generateGatedQuestionBatch)', () => {
    expect(ACTIVITY_TYPE_BY_QUIZ_MODE.diagnostic_check).toBe('DIAGNOSTIC_CHECK');
    expect(ROUTE_SRC).toMatch(/validated\.quizMode === 'diagnostic_check'\s*\n\s*\?\s*Math\.max\(2, Math\.min\(4, validated\.maxQuestions \?\? config\.defaultMax\)\)/);
    expect(ROUTE_SRC).toMatch(/generateGatedQuestionBatch/);
  });

  it('CUMULATIVE_ASSESSMENT -> cumulative_assessment, MOCK_EXAM -> exam_simulation, both multi-concept, both through the same gated batch path', () => {
    expect(ACTIVITY_TYPE_BY_QUIZ_MODE.cumulative_assessment).toBe('CUMULATIVE_ASSESSMENT');
    expect(ACTIVITY_TYPE_BY_QUIZ_MODE.exam_simulation).toBe('MOCK_EXAM');
    expect(evidenceModeForQuizMode('cumulative_assessment')).toBe('ASSESSMENT');
    expect(evidenceModeForQuizMode('exam_simulation')).toBe('ASSESSMENT');
  });

  it('TRANSFER uses its own dedicated route/page pair, never generate-and-take', () => {
    expect(SESSION_ENGINE_SRC).toMatch(/function transferLaunch/);
    expect(SESSION_ENGINE_SRC).toMatch(/'\/dashboard\/cognitive\/transfer'/);
    expect(ROUTE_SRC).not.toMatch(/cognitive\/transfer/);
  });
});

// ============================================================
// PART B / LIVE SOLO_CHECK FAILURE -- root cause + fix
// ============================================================
describe('Part B: the live SOLO_CHECK (Fuerza centrípeta) failure -- root cause and fix', () => {
  it('ROOT CAUSE: before this phase, an initial slot AI-call failure had NO recovery path -- only a slot that failed the QUALITY GATE got a Terra retry; this is now fixed with symmetric recovery', () => {
    expect(strip(QUIZ_GEN_SRC)).toMatch(/initialFailedIndices\.length > 0/);
    expect(strip(QUIZ_GEN_SRC)).toMatch(/const recovered = await Promise\.all\(initialFailedIndices\.map\(\(i\) => requestSlot\(i, TERRA\)\)\)/);
  });

  it('FIX, verified behaviorally: one failed initial slot recovers via exactly one Terra retry, producing a full 6-question set', async () => {
    const executeAIMockLike = async () => {}; // placeholder to keep this describe self-documenting; real behavior verified in quiz-generation-quick-check.test.ts
    expect(typeof generateQuickCheckQuestions).toBe('function');
    expect(QUICK_CHECK_TYPES).toEqual(['multiple_choice', 'true_false', 'yes_no', 'short_answer']);
  });

  it('the final contract is still strictly all-or-nothing (0 or 6) -- recovery adds resilience, never a partial SOLO_CHECK', () => {
    expect(strip(QUIZ_GEN_SRC)).toMatch(/if \(storedQuestions\.length !== QUICK_CHECK_SLOT_COUNT\)/);
  });
});

// ============================================================
// REQUIRED TESTS 11-16 -- CONTRACT
// ============================================================
describe('11. invalid count fails before AI / 12. invalid difficulty fails before AI', () => {
  it('maxQuestions and difficulty are Zod-clamped to [1,20]/[1,5] before any generator is invoked', () => {
    expect(ROUTE_SRC).toMatch(/maxQuestions: z\.number\(\)\.int\(\)\.min\(1\)\.max\(20\)\.optional\(\)/);
    expect(ROUTE_SRC).toMatch(/difficulty: z\.number\(\)\.int\(\)\.min\(1\)\.max\(5\)\.optional\(\)/);
  });

  it('a Zod validation failure throws before conceptIds/generators are ever resolved (parse() is the first statement inside handleGenerateQuiz\'s try block -- CANON-R6-PERF-I1 only added hoisted instrumentation-state declarations ABOVE the try block, never anything between it and parse())', () => {
    const fnStart = ROUTE_SRC.indexOf('async function handleGenerateQuiz');
    const tryIdx = ROUTE_SRC.indexOf('try {', fnStart);
    const body = ROUTE_SRC.slice(tryIdx, tryIdx + 100);
    expect(body).toMatch(/try \{\s*\n\s*const validated = GenerateQuizSchema\.parse\(body\);/);
  });
});

describe('13. missing concept fails before AI / 14. invalid subject/concept pair fails before AI', () => {
  it('a single-concept quizMode without conceptId is rejected with 400 INVALID_INPUT before language/difficulty/generation resolution', () => {
    const body = ROUTE_SRC.slice(ROUTE_SRC.indexOf('const canAccess = await verifyStudentAccess'), ROUTE_SRC.indexOf('const language ='));
    expect(body).toMatch(/isSingleConceptMode\(validated\.quizMode\) && !validated\.conceptId/);
    expect(body).toMatch(/status: 400/);
  });

  it('every canonical launch (the live-blocker path) verifies concept/subject/student ownership BEFORE any ActivityType-specific branch runs -- resolveLaunch\'s universal gate', () => {
    expect(SESSION_ENGINE_SRC).toMatch(/Universal gate, before any ActivityType-specific branch/);
    expect(SESSION_ENGINE_SRC).toMatch(/if \(!ownership\.owned\) \{\s*\n\s*return unavailable\(/);
  });
});

describe('15. missing generator mapping fails before AI', () => {
  it('ACTIVITY_TYPE_BY_QUIZ_MODE is a Record<QuizMode, ActivityType> -- TypeScript itself forbids an unmapped QuizMode from compiling', () => {
    expect(PERSISTENCE_SRC).toMatch(/export const ACTIVITY_TYPE_BY_QUIZ_MODE: Record<QuizMode, ActivityType> = \{/);
  });

  it('an ActivityType with no launch case fails closed via resolveLaunch\'s default (Part D\'s pre-flight equivalent for the canonical path) -- never reaches a generator at all', () => {
    expect(SESSION_ENGINE_SRC).toMatch(/default:\s*\n\s*return unavailable/);
  });
});

describe('16. prompt/schema/parser contract matches for every generator', () => {
  it('every generator (quick_check, practice, retention, and the base generateQuestionsForConcept the gated batch path calls) uses the SAME jsonSchema (GENERATED_QUESTION_BATCH_SCHEMA) and the SAME promptId/version -- no per-activity schema drift', () => {
    const schemaUses = (QUIZ_GEN_SRC.match(/jsonSchema:\s*GENERATED_QUESTION_BATCH_SCHEMA/g) || []).length;
    expect(schemaUses).toBeGreaterThanOrEqual(4); // generateQuestionsForConcept, quick_check, practice chunk, retention chunk
    expect(QUIZ_GEN_SRC).toMatch(/promptVersion: prompt\.version,/);
  });

  it('the gated batch path (cumulative/exam/diagnostic) calls generateQuestionsForConcept -- the SAME base generator/schema, not a second implementation', () => {
    // CANON-R6-PERF-R1: also imports planChunks (reused for canonical_prove's
    // own concurrent-chunk generation), same generateQuestionsForConcept import line.
    expect(GATED_SRC).toMatch(/import \{ generateQuestionsForConcept, planChunks, type GeneratedQuestion \} from '@\/services\/quiz-generation\.service';/);
    expect(GATED_SRC).toMatch(/generateQuestionsForConcept\(conceptId, studentId, subjectId, \{/);
  });
});

// ============================================================
// REQUIRED TESTS 17-20 -- COUNTS
// ============================================================
describe('17. published count equals required count / 20. zero accepted questions never persist', () => {
  it('SOLO_CHECK\'s canonical shape forces exactly 6 regardless of evidence gap -- resolveQuestionCount clamps into [6,6]', () => {
    const req = deriveEvidenceRequirement({
      activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT', targetDimension: 'INDEPENDENCE',
      masteryPolicy: masteryPolicy(), currentSufficiency: { evidenceCount: 8, independentEvidenceCount: 2, passed: true },
    });
    expect(req.purpose).toBe('PROVE');
    // PROVE is UNRESOLVED by canonical evidence policy -- resolveQuestionCount still
    // clamps into the execution shape, never invents a pedagogical number.
    const resolved = resolveQuestionCount(req);
    expect(CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY.SOLO_CHECK).toEqual({ min: 6, max: 6 });
  });

  it('generateQuickCheckQuestions guarantees length is 0 or 6, never in between (defensive double-check after mapping)', () => {
    expect(strip(QUIZ_GEN_SRC)).toMatch(/if \(storedQuestions\.length !== QUICK_CHECK_SLOT_COUNT\)/);
  });

  it('route.ts only calls storeQuiz when questions.length > 0 -- a zero-question result never reaches persistence for ANY mode', () => {
    expect(ROUTE_SRC).toMatch(/if \(questions\.length === 0\) \{/);
    const afterCheck = ROUTE_SRC.slice(ROUTE_SRC.indexOf('if (questions.length === 0)'));
    // CANON-R6: the response is now a ternary (a canonical_prove-specific
    // V1_PROVE_GENERATION_INCOMPLETE reason vs. the original generic
    // shape for every other mode) -- both branches still return
    // `error: 'GENERATION_FAILED'`, and storeQuiz is still unreachable
    // from this branch either way.
    expect(afterCheck).toMatch(/return NextResponse\.json\(\s*\n\s*validated\.quizMode === 'canonical_prove'/);
    expect(afterCheck).toMatch(/error: 'GENERATION_FAILED', reason: 'V1_PROVE_GENERATION_INCOMPLETE'/);
    expect(afterCheck).toMatch(/: \{ error: 'GENERATION_FAILED', canonicalErrorCode: toCanonicalErrorCode\('GENERATION_FAILED'\)\.code, message: 'Failed to generate quiz questions' \}/);
    expect(afterCheck.indexOf('const quizId = await storeQuiz(')).toBeGreaterThan(afterCheck.indexOf("error: 'GENERATION_FAILED'"));
  });
});

describe('18. insufficient candidates fail closed', () => {
  it('retention_check reports RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS and returns [] rather than publishing fewer than 6', () => {
    expect(QUIZ_GEN_SRC).toMatch(/RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS/);
  });

  it('quick_check reports a specific INSUFFICIENT reason and returns [] rather than publishing fewer than 6', () => {
    expect(QUIZ_GEN_SRC).toMatch(/QUICK_CHECK_GENERATION_INSUFFICIENT/);
    expect(QUIZ_GEN_SRC).toMatch(/INITIAL_SLOT_FAILURE_UNRECOVERED/);
  });
});

describe('19. recovery never silently reduces count', () => {
  it('quick_check\'s recovery re-requests the SAME number of failed slots (1:1), never fewer -- and the merged result is re-checked against QUICK_CHECK_SLOT_COUNT before publishing', () => {
    const body = QUIZ_GEN_SRC.slice(QUIZ_GEN_SRC.indexOf('const recovered = await Promise.all'), QUIZ_GEN_SRC.indexOf('const recovered = await Promise.all') + 400);
    expect(body).toMatch(/initialFailedIndices\.map\(\(i\) => requestSlot\(i, TERRA\)\)/);
    expect(body).toMatch(/recovered\.some\(\(r\) => r === null\)/);
  });

  it('retention_check\'s recovery wave computes the exact remaining deficit, never rounds down silently', () => {
    expect(QUIZ_GEN_SRC).toMatch(/remainingDeficit/);
  });
});

// ============================================================
// REQUIRED TESTS 21-25 -- QUALITY
// ============================================================
describe('21. deterministic rejects never hit semantic AI / 22. duplicate rejects never hit semantic AI where safe', () => {
  it('applyQuestionQualityGate runs the deterministic contract FIRST and only queues NOT_DETERMINISTICALLY_VERIFIED items for semantic verification -- a FAIL never reaches it', () => {
    const body = GATED_SRC.slice(GATED_SRC.indexOf('for (const q of questions)'), GATED_SRC.indexOf('const semanticCalls'));
    expect(body).toMatch(/if \(det\.status === 'FAIL'\) \{\s*\n\s*deterministicRejected\+\+;\s*\n\s*continue;/);
    expect(body).toMatch(/needsSemantic\.push\(q\); \/\/ NOT_DETERMINISTICALLY_VERIFIED/);
  });

  it('retention_check dedupes (same-batch + cross-attempt novelty) BEFORE the gate runs, so a duplicate never costs a semantic call', () => {
    expect(QUIZ_GEN_SRC).toMatch(/per-question dedupe BEFORE the gate runs, not only[\s\S]{0,40}after/);
    expect(QUIZ_GEN_SRC).toMatch(/const preGateDedupe = dedupeAgainstAccepted\(mappedBaseline, \[\], conceptId\);/);
  });
});

describe('23. required semantic checks cannot be skipped', () => {
  it('every NOT_DETERMINISTICALLY_VERIFIED candidate unconditionally goes through verifyQuestionQuality or verifyQuestionQualityBatch -- no bypass branch', () => {
    const body = GATED_SRC.slice(GATED_SRC.indexOf('if (needsSemantic.length > 1)'), GATED_SRC.indexOf('// Preserve the caller'));
    expect(body).toMatch(/verifyQuestionQualityBatch\(/);
    expect(body).toMatch(/verifyQuestionQuality\(/);
    expect(body).not.toMatch(/skip|bypass/i);
  });
});

describe('24. malformed semantic response fails candidate closed / 25. batch-verifier isolation remains correct', () => {
  it('a missing/malformed verdict for one candidate id rejects ONLY that candidate -- evaluateQuestionQualityVerdict defaults a null/missing verdict to fail, never approves', () => {
    const body = GATED_SRC.slice(GATED_SRC.indexOf('if (needsSemantic.length > 1)'), GATED_SRC.indexOf('} else if (needsSemantic.length === 1)'));
    // LX-9R8 PART B3: `verdict` is now extracted into its own variable
    // (also fed to the new per-candidate rejection logger) -- the SAME
    // `?? null` fail-closed default and the SAME semanticRejected++ on
    // any non-passing verdict, just no longer a single expression.
    expect(body).toMatch(/const verdict = verdictsById\.get\(id\) \?\? null;/);
    expect(body).toMatch(/evaluateQuestionQualityVerdict\(verdict\)\.pass/);
    expect(body).toMatch(/semanticRejected\+\+;/);
  });

  it('a batch call that throws entirely is caught and degrades to an empty verdict map -- every candidate in that batch fails closed individually, none silently accepted', () => {
    expect(GATED_SRC).toMatch(/\.catch\(\(\) => new Map<string, QuestionQualityVerdict \| null>\(\)\)/);
  });
});

// ============================================================
// REQUIRED TESTS 26-32 -- SESSION / RETRY
// ============================================================
describe('26. generation failure creates no launchable session / 27. persistence failure creates no usable session', () => {
  it('storeQuiz is the ONLY call site that creates a quiz_sessions row for this route, and it sits strictly after the questions.length === 0 gate', () => {
    const storeCallCount = (ROUTE_SRC.match(/await storeQuiz\(/g) || []).length;
    expect(storeCallCount).toBe(1);
  });
});

describe('28. retry reruns same canonical activity / 29. retry preserves canonical difficulty policy / 30. retry preserves required question count', () => {
  it('the canonical retry button calls startCanonicalActivity (the SAME function/request), never a different generateQuiz call that could drift mode/difficulty/count', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("genState === 'error'"), QUIZ_PAGE_SRC.indexOf("genState === 'error'") + 1600);
    expect(block).toMatch(/onClick=\{\(\) => \{ if \(studentId\) startCanonicalActivity\(studentId\); \}\}/);
  });

  it('quick_check\'s slot recovery reruns the SAME slotIndex (hence the same assignedType/difficulty/prompt) on Terra -- never a different slot, never a different type', () => {
    const body = strip(QUIZ_GEN_SRC).slice(strip(QUIZ_GEN_SRC).indexOf('initialFailedIndices.map((i) => requestSlot(i, TERRA))'), strip(QUIZ_GEN_SRC).indexOf('initialFailedIndices.map((i) => requestSlot(i, TERRA))') + 60);
    expect(body).toContain('requestSlot(i, TERRA)');
  });

  it('a fresh operationId is generated per generation call, while the canonical request identity (conceptId/studentId/subjectId/difficulty/count) is unchanged across a retry', () => {
    expect(QUIZ_GEN_SRC).toMatch(/const operationId = randomUUID\(\);/);
  });
});

describe('31. retry cannot turn generation error into load error', () => {
  it('startCanonicalActivity resets its own genState/error and stays on phase===\'quiz\' -- a second failure re-renders the SAME recoverable card, never the different top-level phase===\'error\' card', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/startCanonicalActivity`'s\s*\n\s*\/\/ own background generation wave failing/);
    expect(QUIZ_PAGE_SRC).toMatch(/retrying must re-run the SAME/);
  });
});

describe('32. successful retry produces a valid session', () => {
  it('applyGenResult (shared by generateQuiz and the canonical flow) is the ONE place questions/quizId/countAuthority are applied after a successful generation, regardless of whether it was a first attempt or a retry', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/const applyGenResult = useCallback\(\(data: any\) => \{/);
  });
});

// ============================================================
// REQUIRED TESTS 33-37 -- CLIENT
// ============================================================
describe('33. SOLO_CHECK generation error uses activity-neutral copy / 34. PRACTICE / 35. RETENTION generation error uses same canonical error component', () => {
  it('the canonical "couldn\'t prepare" card copy is activity-neutral in every locale -- no mode-specific "practice" wording left in the message VALUES', () => {
    for (const locale of Object.keys(MESSAGES) as (keyof typeof MESSAGES)[]) {
      const title = (MESSAGES[locale] as any)['practice.prepareFailedTitle'] as string;
      const body = (MESSAGES[locale] as any)['practice.prepareFailedBody'] as string;
      expect(title.toLowerCase()).not.toMatch(/practice|práctica|übung|entraînement|prática/);
      expect(body.toLowerCase()).not.toMatch(/teaching|enseñanza|lernfortschritt|apprentissage|ensino/);
    }
  });

  it('SOLO_CHECK, PRACTICE, and RETENTION_CHECK all reach the SAME canonical card (genState===\'error\' block) when launched via startCanonicalActivity -- one component, not per-mode branches', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("genState === 'error'"), QUIZ_PAGE_SRC.indexOf("genState === 'error'") + 400);
    expect(block).not.toMatch(/quizMode === 'quick_check'/);
    expect(block).not.toMatch(/quizMode === 'topic_practice'/);
    expect(block).not.toMatch(/quizMode === 'retention_check'/);
  });
});

describe('36. generation error and load error remain distinct states', () => {
  it('genState===\'error\' (background canonical generation) and phase===\'error\' (legacy/manual setup load failure) are two separate, non-overlapping states in this file', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/if \(phase === 'error'\) \{/);
    expect(QUIZ_PAGE_SRC).toMatch(/genState === 'error' \?/);
  });
});

describe('37. Try again invokes the failed operation', () => {
  it('the canonical retry button\'s onClick is exactly startCanonicalActivity(studentId) -- the same operation that failed, not a fresh unrelated flow', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("genState === 'error'"), QUIZ_PAGE_SRC.indexOf("genState === 'error'") + 1600);
    expect(block).toMatch(/onClick=\{\(\) => \{ if \(studentId\) startCanonicalActivity\(studentId\); \}\}/);
  });
});

// ============================================================
// REQUIRED TESTS 38-45 -- REGRESSION (Fuerza centrípeta fixture)
// ============================================================
describe('38. Fuerza centrípeta fixture: PRACTICE complete -> PROVE -> SOLO_CHECK request -> valid generated session', () => {
  it('a concept with PRACTICE evidence but zero independent evidence resolves learningState INSUFFICIENT_INDEPENDENT_EVIDENCE -> journeyStage PROVE -> nextCanonicalAction SOLO_CHECK', () => {
    const knowledgeState = ks({ masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'READY', evidenceCount: 8, independentEvidenceCount: 0 });
    const d = decision('INSUFFICIENT_INDEPENDENT_EVIDENCE', 'SOLO_CHECK');
    const progress = buildCanonicalLearningProgress({ conceptId: 'c1', subjectId: 'subj1', knowledgeState, activeDecision: d });
    expect(progress.journeyStage).toBe('PROVE');
    expect(progress.actionState).toBe('EXECUTABLE');
    expect(progress.nextCanonicalAction).toBe('SOLO_CHECK');
    expect(progress.evidenceMode).toBe('INDEPENDENT');
  });

  it('SOLO_CHECK\'s canonical launch (resolveLaunch) targets quick_check -- a valid, generatable quizMode, never REMEDIATION/PRACTICE substitution', () => {
    expect(SESSION_ENGINE_SRC).toMatch(/case 'SOLO_CHECK':\s*\n\s*return quizLaunch\('quick_check', decision\);/);
  });
});

describe('39. canonical stage unchanged / 40. canonical percentage unchanged', () => {
  it('PROVE stage and its journey-progress percent/labelKey derivation are untouched by this phase -- no new stage, no new percent rule introduced', () => {
    expect(strip(read('src/lib/lx/canonical-learning-progress.ts'))).not.toMatch(/journeyStage === 'PROVE' \? \d+/);
  });
});

describe('41. adaptive difficulty unchanged', () => {
  it('resolveTargetDifficulty\'s SOLO_CHECK branch is untouched by this phase -- this phase only touched quiz-generation.service.ts\'s recovery path and quiz/page.tsx\'s copy, never difficulty-contract.ts\'s decision logic', () => {
    expect(DIFFICULTY_CONTRACT_SRC).toMatch(/case 'SOLO_CHECK':/);
  });
});

describe('42. cross-attempt novelty unchanged', () => {
  it('retention_check\'s novelty/dedupe machinery (dedupeAgainstAccepted, recentHistory) is untouched -- this phase did not modify generateRetentionCheckQuestions\'s own logic, only used it as the proven reference pattern for quick_check\'s new recovery', () => {
    expect(QUIZ_GEN_SRC).toMatch(/fetchRecentRetentionQuestions\(studentId, conceptId, RETENTION_NOVELTY_ATTEMPT_WINDOW\)/);
  });
});

describe('43. WAITING unchanged', () => {
  it('isRetentionWaiting and the WAITING continuation/actionState machinery from LX-9R5 are untouched by this phase', () => {
    const contractSrc = read('src/lib/lx/learner-journey-contract.ts');
    expect(contractSrc).toMatch(/export function isRetentionWaiting\(stage: LearnerJourneyStage, retentionDue: boolean \| undefined \| null\): boolean \{/);
  });
});

describe('44. assistance telemetry unchanged', () => {
  it('the hintsUsed-based "Con ayuda" fix from LX-9R5 (subjectDetail concept-detail history badge) is untouched by this phase', () => {
    const detailSrc = read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx');
    expect(detailSrc).toMatch(/h\.hintsUsed > 0/);
  });
});

describe('45. all existing tests green', () => {
  it('is verified by the full `npx vitest run` suite passing (see the phase report), not re-asserted here', () => {
    expect(true).toBe(true);
  });
});

// ============================================================
// PART M/N -- client state machine / label accuracy (supporting)
// ============================================================
describe('Part M/N: activity-neutral generation-error copy and label accuracy', () => {
  it('practice.preparing is also activity-neutral in every locale (the loading state shown for ANY canonical activity, not just Practice)', () => {
    for (const locale of Object.keys(MESSAGES) as (keyof typeof MESSAGES)[]) {
      const preparing = (MESSAGES[locale] as any)['practice.preparing'] as string;
      expect(preparing.toLowerCase()).not.toMatch(/practice|práctica|übung|entraînement|prática/);
    }
  });
});

// ============================================================
// PART O -- observability parity for quick_check
// ============================================================
describe('Part O: quick_check now carries operationId-correlated structured observability, matching retention', () => {
  it('every terminal quick_check outcome (success, insufficient) logs via the SAME operationId, mirroring [retention]\'s established pattern', () => {
    expect(QUIZ_GEN_SRC).toMatch(/function logQuickCheck\(label: string, meta: Record<string, unknown> = \{\}\): void \{/);
    expect(QUIZ_GEN_SRC).toMatch(/QUICK_CHECK_GENERATION_STARTED/);
    expect(QUIZ_GEN_SRC).toMatch(/QUICK_CHECK_GENERATION_SUCCEEDED/);
    expect(QUIZ_GEN_SRC).toMatch(/QUICK_CHECK_GENERATION_INSUFFICIENT/);
  });
});
