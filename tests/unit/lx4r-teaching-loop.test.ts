/**
 * LX-4R -- TEACHING LOOP COMPLETION.
 *
 * Source-content + pure checks (no component harness in this repo);
 * runtime behaviour is HARNESS-verified in the LX-4R report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';
import { deriveEvidenceRequirement, resolveQuestionCount } from '@/lib/lx/evidence-sufficiency-contract';
import type { MasteryPolicy } from '@/services/knowledge-state.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const ROUTE = read('src/app/api/quizzes/generate-and-take/route.ts');
const GEN = read('src/services/quiz-generation.service.ts');
const TEACHING_CONTENT = read('src/services/teaching-content.service.ts');
const TI_ROUTE = read('src/app/api/learning/teaching-intent/route.ts');
const HELP_ROUTE = read('src/app/api/learning/contextual-help/route.ts');
const GP_ROUTE = read('src/app/api/learning/guided-practice/route.ts');
const INTRO = read('src/app/dashboard/quiz/TeachingIntro.tsx');
const HELP_UI = read('src/app/dashboard/quiz/ContextualHelp.tsx');

const POLICY: MasteryPolicy = {
  version: 1,
  minimumUnderstanding: 80,
  minimumIndependence: 80,
  minimumApplication: 75,
  minimumRetention: 75,
  minimumTransfer: 70,
  requiresTransfer: true,
  maximumCriticalMisconceptions: 0,
  minimumEvidenceCount: 3,
  minimumIndependentEvidenceCount: 2,
  validationWindowDays: 30,
};

/* ---------- R1: adaptive support rendering ---------- */
describe('LX-4R R1 -- canonical Teaching Experience is fetched and rendered, never computed in React', () => {
  it('the teaching-intent route returns ONLY the derived TeachingExperienceView (no raw TeachingIntent leak)', () => {
    expect(TI_ROUTE).toMatch(/getTeachingIntentForConcept/);
    expect(TI_ROUTE).toMatch(/deriveTeachingExperience\(\{/);
    expect(TI_ROUTE).toMatch(/data: \{ teachingExperience \}/);
    // it must not put raw TeachingIntent internals into the response body
    expect(TI_ROUTE).not.toMatch(/intent\.(strategy|successCriteria|avoidStrategies|instructionalGoal|policyVersion|previousStrategies)/);
  });
  it('conceptId + evidenceMode come from the canonical quiz_sessions row, not the client', () => {
    expect(TI_ROUTE).toMatch(/quizSession\.conceptId/);
    expect(TI_ROUTE).toMatch(/quizSession\.evidenceMode/);
  });
  it('the quiz page fetches the view and enters a teach-first phase; it never calls computeSupportLevel', () => {
    expect(QUIZ).toMatch(/\/api\/learning\/teaching-intent/);
    expect(QUIZ).toMatch(/teachingStage === 'teaching'/);
    expect(QUIZ).toMatch(/<TeachingIntro/);
    expect(QUIZ).not.toMatch(/computeSupportLevel|computeTeachingIntent/);
  });
});

/* ---------- R2: worked examples ---------- */
describe('LX-4R R2 -- worked examples come from ConceptExplanation.examples, never assessment questions', () => {
  it('TeachingIntro sources MODEL content from the concept-explanation endpoint', () => {
    expect(INTRO).toMatch(/\/api\/concepts\/\$\{conceptId\}\/explanation/);
    expect(INTRO).toMatch(/explanation\.examples/);
  });
  it('TeachingIntro never fetches or renders quiz questions as examples', () => {
    expect(INTRO).not.toMatch(/generate-and-take|\/api\/quizzes\/generate/);
  });
  it('MODEL is shown only when the canonical view asks for a worked example', () => {
    expect(INTRO).toMatch(/view\.showWorkedExample/);
  });
});

/* ---------- R3: guided practice ---------- */
describe('LX-4R R3 -- guided practice is scaffolding, never evidence, never a decision authority', () => {
  it('teaching-content.service writes NO learning evidence and picks no concept/activity/support', () => {
    expect(TEACHING_CONTENT).not.toMatch(/updateMastery|learning_evidence|recordEvidence|applyEvidence/);
    expect(TEACHING_CONTENT).not.toMatch(/computeSupportLevel|selectActivityType|LearningDecision|isProveRequired/);
  });
  it('the guided-practice route is gated on canUseAI (PRACTICE only) and touches no evidence path', () => {
    // LX-4P-PERF-R1E: evidenceMode now resolves from either the quizId
    // session or the canonical QuizMode taxonomy, but the SAME canUseAI
    // gate applies to whichever one resolved it.
    expect(GP_ROUTE).toMatch(/canUseAI\(\{ evidenceMode, feature: 'EXPLAIN' \}\)/);
    expect(GP_ROUTE).toMatch(/evidenceMode = session\.evidenceMode/);
    expect(GP_ROUTE).toMatch(/evidenceMode = evidenceModeForQuizMode\(mode\)/);
    expect(GP_ROUTE).not.toMatch(/updateMastery|learning_evidence/);
  });
  it('the GUIDE stage in the UI states it does not count as evidence', () => {
    expect(INTRO).toMatch(/guided\.notEvidence/);
  });
});

/* ---------- R4: contextual help ---------- */
describe('LX-4R R4 -- contextual help: server permission is the authority', () => {
  it('one gated endpoint -- canUseAI denies help for every non-PRACTICE evidence mode', () => {
    expect(HELP_ROUTE).toMatch(/canUseAI\(\{ evidenceMode: session\.evidenceMode, feature: FEATURE_BY_ACTION\[v\.action\] \}\)/);
    expect(HELP_ROUTE).toMatch(/HELP_DISABLED_FOR_MODE/);
    expect(HELP_ROUTE).toMatch(/status: 403/);
  });
  it('every action maps to a real existing content source; none is a client diagnosis', () => {
    for (const src of ['generateQuestionHint', 'getConceptExplanation', 'generateGuidedPractice']) {
      expect(HELP_ROUTE).toContain(src);
    }
    // the help UI renders server-provided text; it never runs a classifier
    expect(HELP_UI).not.toMatch(/function .*(classify|diagnose)|=> .*(classify|diagnose)\(/i);
  });
  it('the quiz page renders the help surface only for PRACTICE evidence modes', () => {
    expect(QUIZ).toMatch(/PRACTICE_EVIDENCE_MODES\.includes\(quizMode\) && studentId && quizId && \(\s*<ContextualHelp/);
  });
  it('the legacy single hint toggle is gone from the page', () => {
    expect(QUIZ).not.toMatch(/function toggleHints/);
    expect(QUIZ).not.toMatch(/hintsVisible/);
  });
});

/* ---------- R5: expectedReasoningType generation ---------- */
describe('LX-4R R5 -- expectedReasoningType is generated, read back with a known-enum guard, never fabricated post-hoc', () => {
  it('the generation prompt asks for it and the JSON shape example includes it', () => {
    expect(GEN).toMatch(/"expectedReasoningType" \(what a COMPLETE correct response must actually demonstrate/);
    expect(GEN).toMatch(/expectedReasoningType: '"FACTUAL"\|"PROCEDURAL"\|"CONCEPTUAL"\|"METACOGNITIVE"'/);
  });
  it('it is read back only when a KNOWN enum value, same guard as cognitiveLevel', () => {
    expect(GEN).toMatch(/KNOWN_EXPECTED_REASONING_TYPES\.has\(q\.expectedReasoningType\)/);
    expect(GEN).toMatch(/KNOWN_EXPECTED_REASONING_TYPES = new Set<string>\(\['FACTUAL', 'PROCEDURAL', 'CONCEPTUAL', 'METACOGNITIVE'\]\)/);
  });
  it('the client contract + server grader use the same tag (never re-derived after the answer)', () => {
    // LX-4P-R2: toClientQuestion moved to @/lib/quiz/client-question.
    const CLIENTQ = read('src/lib/quiz/client-question.ts');
    expect(CLIENTQ).toMatch(/expectedReasoningType: q\.expectedReasoningType/); // sent to client
    expect(QUIZ).toMatch(/expectedReasoningType: \(\(q as any\)\.expectedReasoningType/); // client contract input
    expect(ROUTE).toMatch(/deriveResponseEvidenceContract\(/); // grader guard input
  });
});

/* ---------- R6: pedagogical feedback + retry ---------- */
describe('LX-4R R6 -- feedback presents the canonical grader classification; the client creates no diagnosis', () => {
  it('the route passes errorType / reasoningValid through on each review item', () => {
    expect(ROUTE).toMatch(/errorType: \(gradeResult as any\)\.errorType \?\? null/);
    expect(ROUTE).toMatch(/reasoningValid:/);
  });
  it('the review UI maps errorType -> a copy key (errorTeach.*) -- it does not classify', () => {
    expect(QUIZ).toMatch(/errorTeach\.\$\{r\.errorType\}/);
    expect(QUIZ).toMatch(/feedback\.why/);
    expect(QUIZ).toMatch(/feedback\.whatToChange/);
    expect(QUIZ).not.toMatch(/switch \(r\.errorType\)/);
  });
  it('a supported-practice retry is offered in the activity (not forced to next)', () => {
    expect(QUIZ).toMatch(/activeLearning\.practiceAgain/);
    expect(QUIZ).toMatch(/onClick=\{\(\) => studentId && generateQuiz\(studentId\)\}/);
  });
  it('the retry evidence semantics are stated to the learner', () => {
    expect(QUIZ).toMatch(/activeLearning\.retryNote/);
    for (const loc of LOCALES) {
      expect(MESSAGES[loc]['activeLearning.retryNote']).toMatch(/evidence|Nachweis|preuve|evidência|evidencia/i);
    }
  });
});

/* ---------- R7: Prove evidence sufficiency ---------- */
describe('LX-4R R7 -- one correct answer is not "Prove complete"; canonical sufficiency is re-read', () => {
  it('the route re-reads canonical sufficiency after INDEPENDENT/ASSESSMENT evidence via deriveEvidenceRequirement', () => {
    expect(ROUTE).toMatch(/proveSufficiency/);
    expect(ROUTE).toMatch(/quizSession\.evidenceMode === 'INDEPENDENT' \|\| quizSession\.evidenceMode === 'ASSESSMENT'/);
    expect(ROUTE).toMatch(/deriveEvidenceRequirement\(\{[\s\S]*?activityType: quizSession\.activityType/);
  });
  it('it uses the canonical gap, not a local threshold', () => {
    const start = ROUTE.indexOf('let proveSufficiency');
    const end = ROUTE.indexOf('return NextResponse.json', start);
    const block = ROUTE.slice(start, end);
    // no local pass/score threshold inside the sufficiency computation
    expect(block).not.toMatch(/score\s*[<>]=?\s*\d+/);
    expect(block).toMatch(/pedagogicalRequirement/);
    expect(block).toMatch(/sufficient: gap === 0/);
  });
});

/* ---------- R8: canonical question count ---------- */
describe('LX-4R R8 -- canonical evidence gap drives Practice/Prove count; unresolved modes preserved', () => {
  it('PRACTICE count = canonical total-evidence gap', () => {
    const req = deriveEvidenceRequirement({
      activityType: 'PRACTICE',
      evidenceMode: 'PRACTICE',
      targetDimension: 'UNDERSTANDING',
      masteryPolicy: POLICY,
      currentSufficiency: { evidenceCount: 1, independentEvidenceCount: 0, passed: false },
    });
    expect(req.questionCount.status).toBe('DETERMINED');
    if (req.questionCount.status === 'DETERMINED') {
      expect(req.questionCount.pedagogicalRequirement).toBe(2); // 3 - 1
      expect(req.questionCount.source).toBe('MASTERY_POLICY_TOTAL_EVIDENCE_GAP');
    }
    expect(resolveQuestionCount(req)).toMatchObject({ status: 'DETERMINED' });
  });
  it('PROVE count = canonical independent-evidence gap', () => {
    const req = deriveEvidenceRequirement({
      activityType: 'SOLO_CHECK',
      evidenceMode: 'INDEPENDENT',
      targetDimension: 'INDEPENDENCE',
      masteryPolicy: POLICY,
      currentSufficiency: { evidenceCount: 5, independentEvidenceCount: 0, passed: false },
    });
    if (req.questionCount.status === 'DETERMINED') {
      expect(req.questionCount.pedagogicalRequirement).toBe(2); // 2 - 0
      expect(req.questionCount.source).toBe('MASTERY_POLICY_INDEPENDENT_EVIDENCE_GAP');
    }
  });
  it('RETAIN / TRANSFER / ASSESS stay UNRESOLVED (execution defaults are not pedagogical truth)', () => {
    for (const at of ['RETENTION_CHECK', 'TRANSFER', 'CUMULATIVE_ASSESSMENT'] as const) {
      const req = deriveEvidenceRequirement({
        activityType: at,
        evidenceMode: 'INDEPENDENT',
        targetDimension: 'UNDERSTANDING',
        masteryPolicy: POLICY,
      });
      expect(req.questionCount.status).toBe('UNRESOLVED');
      expect(resolveQuestionCount(req).status).toBe('UNRESOLVED');
    }
  });
  it('the route wires this in and surfaces a zero-gap authority mismatch (not hidden by an execution minimum)', () => {
    expect(ROUTE).toMatch(/deriveEvidenceRequirement/);
    expect(ROUTE).toMatch(/resolveQuestionCount\(requirement\)/);
    expect(ROUTE).toMatch(/zeroGapMismatch/);
    expect(ROUTE).toMatch(/countAuthority/);
    expect(ROUTE).toMatch(/authority mismatch/);
  });
});

/* ---------- R9: accessibility ---------- */
describe('LX-4R R9 -- active-learning a11y', () => {
  it('feedback / outcome is in a live region and receives focus', () => {
    expect(QUIZ).toMatch(/role="status" aria-live="polite"/);
    expect(QUIZ).toMatch(/resultsHeadingRef\.current\?\.focus\(\)/);
  });
  it('the question is a heading; the response-requirement line is text, not colour', () => {
    expect(QUIZ).toMatch(/<h2 style=\{\{ fontSize: 20[\s\S]*?<MathText text=\{q\.question\}/);
  });
  it('teach-first + help disclosures are keyboard operable', () => {
    expect(INTRO).toMatch(/onClick=\{advance\}/);
    expect(HELP_UI).toMatch(/aria-expanded=\{open\}/);
    expect(HELP_UI).toMatch(/aria-controls=\{panelId\}/);
  });
  it('Prove states WHY help is unavailable, not just omits it', () => {
    expect(QUIZ).toMatch(/activeLearning\.helpUnavailable/);
  });
});

/* ---------- i18n ---------- */
describe('LX-4R i18n', () => {
  const KEYS = [
    'teachingIntro.explainTitle', 'teachingIntro.modelTitle', 'teachingIntro.guideTitle',
    'teachingIntro.startPractice', 'teachingIntro.skip', 'teachingIntro.loading',
    'workedExample.step', 'workedExample.why', 'workedExample.revealNext',
    'guided.title', 'guided.check', 'guided.reveal', 'guided.expected', 'guided.nextStep', 'guided.notEvidence',
    'help.menuTitle', 'help.close', 'help.loading', 'help.error',
    'feedback.whatNow', 'feedback.almost', 'feedback.incorrect', 'feedback.correct',
    'errorTeach.CONCEPTUAL', 'errorTeach.PROCEDURAL', 'errorTeach.ARITHMETIC', 'errorTeach.UNIT',
    'prove.sufficientTitle', 'prove.moreNeededBody',
    'activeLearning.activityComplete', 'activeLearning.practiceAgain', 'activeLearning.retryNote',
  ];
  it('every key present and non-empty in all 5 locales', () => {
    for (const loc of LOCALES) {
      for (const k of KEYS) {
        const v = MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]];
        expect(typeof v === 'string' && v.length > 0, `${loc}:${k}`).toBe(true);
      }
    }
  });
  it('interpolation placeholders survive translation', () => {
    for (const loc of LOCALES) {
      expect(MESSAGES[loc]['workedExample.step']).toContain('{n}');
      expect(MESSAGES[loc]['prove.moreNeededBody']).toContain('{n}');
    }
  });
});
