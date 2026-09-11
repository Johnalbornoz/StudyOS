/**
 * LX-4P-PERF-R1 -- provider-independent performance subset.
 *
 * Delivered here: parallel teaching runtime (MODEL never waits on the
 * question batch or on GUIDE), TeachingIntent decoupled from quizId,
 * R20 activity-language rule, R21 (no localization in initial launch),
 * R22 journey marks. The OpenAI Luna/Terra migration, quality gate,
 * deterministic academic validators, visual contract and every live
 * benchmark are BLOCKED on provider credentials -- see the report.
 *
 * Source/contract checks; runtime behaviour is HARNESS-verified.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const TEACH = read('src/app/dashboard/quiz/TeachingIntro.tsx');
const TI_ROUTE = read('src/app/api/learning/teaching-intent/route.ts');
const GEN_ROUTE = read('src/app/api/quizzes/generate-and-take/route.ts');

/* ---------- R3: question generation is off the teaching critical path ---------- */
describe('LX-4P-PERF-R1 R3 -- teaching renders without waiting for the question batch', () => {
  it('the canonical start fires TeachingIntent and generate-and-take in PARALLEL', () => {
    const fn = QUIZ.slice(QUIZ.indexOf('const startCanonicalActivity = useCallback'), QUIZ.indexOf('// LX-4K: canonical flow skips the configurator'));
    expect(fn).toMatch(/wave A -- canonical Teaching Experience/);
    expect(fn).toMatch(/wave B -- question generation, in the background/);
    // LX-4P-PERF-R1C C12: wave A is either the transported Continue handoff
    // (no round-trip) or the canonical teaching-intent fetch -- still issued
    // in parallel with wave B, still never awaited before the teach-first render.
    expect(fn).toMatch(/const handoffView = conceptId \? consumeLaunchTeachingHandoff\(conceptId, quizMode\) : null/);
    expect(fn).toMatch(/const tiP: Promise<TeachingExperienceView \| null> = handoffView\s*\n\s*\? Promise\.resolve\(handoffView\)\s*\n\s*: fetch\(\s*\n?\s*`\/api\/learning\/teaching-intent\?studentId=\$\{sid\}&conceptId=\$\{conceptId\}&mode=\$\{quizMode\}`/);
    expect(fn).toMatch(/const genP = fetch\('\/api\/quizzes\/generate-and-take'/);
    // teach-first: render the teaching stage as soon as TeachingIntent resolves
    expect(fn).toMatch(/if \(teachFirst\) \{\s*\n\s*setTeachingStage\('teaching'\);\s*\n\s*setPhase\('quiz'\); \/\/ teaching UI can render NOW/);
    // it does NOT await the question batch before that
    const beforeTeachFirst = fn.slice(0, fn.indexOf('if (teachFirst)'));
    expect(beforeTeachFirst).not.toMatch(/await genP|await applyGen/);
  });

  it('the teach-first render gate no longer requires quizId', () => {
    const gate = QUIZ.slice(QUIZ.indexOf("teachingStage === 'teaching' &&"), QUIZ.indexOf('<TeachingIntro'));
    expect(gate).toMatch(/teachingExperience &&\s*\n\s*studentId &&\s*\n\s*conceptId\s*\n\s*\)/);
    expect(gate).not.toMatch(/quizId &&/);
  });

  it('a not-yet-ready batch shows a recoverable "preparing" state, never a dead end (R25)', () => {
    expect(QUIZ).toMatch(/teachingStage === 'questions' && questions\.length === 0 && genState !== 'ready'/);
    expect(QUIZ).toMatch(/t\['practice\.preparing'\]/);
    expect(QUIZ).toMatch(/t\['practice\.prepareRetry'\]/);
    // retry re-runs generation; it does not navigate away / to Concept Mission
    const block = QUIZ.slice(QUIZ.indexOf("t['practice.prepareFailedTitle']"), QUIZ.indexOf("t['practice.prepareFailedTitle']") + 500);
    expect(block).toMatch(/void generateQuiz\(studentId\)/);
    expect(block).not.toMatch(/router\.push|window\.location|conceptMissionPath/);
  });
});

/* ---------- R4: TeachingIntent resolvable before quiz generation ---------- */
describe('LX-4P-PERF-R1 R4 -- TeachingIntent resolves from studentId + conceptId (+ mode), not quizId', () => {
  it('the route accepts conceptId + mode and derives evidenceMode from the canonical taxonomy', () => {
    expect(TI_ROUTE).toMatch(/const conceptIdParam = searchParams\.get\('conceptId'\)/);
    expect(TI_ROUTE).toMatch(/const modeParam = searchParams\.get\('mode'\)/);
    expect(TI_ROUTE).toMatch(/!studentId \|\| \(!quizId && !conceptIdParam\)/);
    expect(TI_ROUTE).toMatch(/evidenceMode = evidenceModeForQuizMode\(mode\)/);
    // SupportLevel still comes only from the canonical TeachingIntent
    expect(TI_ROUTE).toMatch(/getTeachingIntentForConcept\(studentId, conceptId\)/);
    expect(TI_ROUTE).toMatch(/supportLevel: intent\.supportLevel/);
  });
  it('the quizId path is preserved unchanged for back-compat', () => {
    expect(TI_ROUTE).toMatch(/if \(quizId\) \{[\s\S]*?getQuizSession\(quizId\)[\s\S]*?evidenceMode = quizSession\.evidenceMode/);
  });
  it('the client no longer needs a quizId to ask for the teaching experience', () => {
    expect(QUIZ).toMatch(/\/api\/learning\/teaching-intent\?studentId=\$\{sid\}&conceptId=\$\{conceptId\}&mode=\$\{quizMode\}/);
  });
});

/* ---------- R6: MODEL and GUIDE readiness are independent ---------- */
describe('LX-4P-PERF-R1 R6 -- MODEL renders when its content is ready; it never waits for GUIDE', () => {
  it('explanation and guided-practice load in SEPARATE effects', () => {
    expect(TEACH).not.toMatch(/Promise\.all\(\[/); // the old blocking join is gone
    expect(TEACH).toMatch(/\/\/ EXPLAIN \/ MODEL content -- needs only conceptId, fires immediately\./);
    // LX-4P-PERF-R1E: GUIDE no longer needs the quiz session either -- it
    // fires from the same canonical context (conceptId/quizMode/locale).
    expect(TEACH).toMatch(/\/\/ GUIDE content -- teaching scaffolding, not evidence\./);
    expect(TEACH).toMatch(/const \[expLoading, setExpLoading\] = useState/);
    expect(TEACH).toMatch(/const \[gpLoading, setGpLoading\] = useState/);
  });
  it('the whole-component loading gate blocks only on explanation, not on GUIDE', () => {
    expect(TEACH).toMatch(/\/\/ Block only on the FIRST needed content \(explanation\)\.[\s\S]*?if \(expLoading\) \{/);
  });
  it('a still-preparing canonical GUIDE is treated as PENDING, not skipped', () => {
    expect(TEACH).toMatch(/const guidePending = needsGuided && gpLoading/);
    expect(TEACH).toMatch(/const isLast = idx >= effectivePlan\.length - 1 && !guidePending/);
  });
  it('quizId is nullable on the TeachingIntro contract (question batch may still be cooking)', () => {
    expect(TEACH).toMatch(/quizId: string \| null/);
  });
});

/* ---------- R21: no localization AI call during initial launch ---------- */
describe('LX-4P-PERF-R1 R21 -- same-item localization / semantic verify never run on initial launch', () => {
  it('generate-and-take does not import or call the localization service', () => {
    expect(GEN_ROUTE).not.toMatch(/question-localization\.service|localizeGeneratedQuestion|verifyLocalizationEquivalence/);
  });
  it('the canonical start path issues only teaching-intent + generate-and-take (no /localize-question)', () => {
    const fn = QUIZ.slice(QUIZ.indexOf('const startCanonicalActivity = useCallback'), QUIZ.indexOf('// LX-4K: canonical flow skips the configurator'));
    expect(fn).not.toMatch(/localize-question|attemptSameItemLocalization|localizeQuestionAt/);
  });
  it('the lazy localization effect no-ops while quizLanguage === sessionOriginalLanguage (true right after generation)', () => {
    expect(QUIZ).toMatch(/if \(quizLanguage === sessionOriginalLanguage\) \{[\s\S]*?return;/);
  });
});

/* ---------- R22: journey marks ---------- */
describe('LX-4P-PERF-R1 R22 -- lightweight journey marks', () => {
  it('the client emits [perf] marks for the key journey points', () => {
    expect(QUIZ).toMatch(/console\.log\('\[perf\]'/);
    for (const m of ['T0_start', 'T1_teachingintent_ready', 'T4_gen_start', 'T5_gen_ready', 'T6_first_practice_question']) {
      expect(QUIZ).toContain(`'${m}'`);
    }
  });
});

/* ---------- authority not altered ---------- */
describe('LX-4P-PERF-R1 -- canonical authority unchanged', () => {
  it('React still never computes SupportLevel; deriveTeachingExperience consumes the canonical intent', () => {
    expect(QUIZ).not.toMatch(/computeSupportLevel|SupportLevel =/);
    expect(TI_ROUTE).toMatch(/deriveTeachingExperience\(\{/);
    expect(TI_ROUTE).toMatch(/supportLevel: intent\.supportLevel/);
  });
  it('the LX-4R R8 canonical question-count logic in generate-and-take is untouched', () => {
    expect(GEN_ROUTE).toMatch(/deriveEvidenceRequirement\(\{/);
    expect(GEN_ROUTE).toMatch(/resolveQuestionCount\(requirement\)/);
  });
});
