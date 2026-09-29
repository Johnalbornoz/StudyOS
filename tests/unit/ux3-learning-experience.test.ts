/**
 * UX-3 -- Complete Student Learning Experience.
 *
 * Certifies the learning-session presentation layer without touching any
 * cognitive rule:
 *   1. Vocabulary: every launched mode maps to one user-facing experience;
 *      every experience / teaching step / outcome has copy in 5 locales.
 *   2. Outcome: the Results headline comes ONLY from the server's own
 *      requirement status -- a score never makes anything "Lo tienes" or
 *      "Dominado" (correct != mastered).
 *   3. Guided-step bypass fix: the EXPLAIN/MODEL shortcut can never skip a
 *      GUIDE stage the canonical plan contains.
 *   4. Silent submit failure fix: failures are classified, visible,
 *      announced, recoverable, never "incorrect"; lost-response re-sends
 *      (`alreadySubmitted`) are handled.
 *   5. Refresh continuity: drafts are scoped to student + session +
 *      question batch, sessionStorage only, never evidence.
 *   6. Tutor: one pane at a time below 1024px; send failures recoverable.
 *   7. Remediation-step routes: failures recoverable with the same activityId.
 *   8. No frontend learning engine: no score/attempt thresholds in UX-3 code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ACTIVITY_KINDS,
  activityKindForMode,
  isIndependentKind,
  kindLabelKey,
  kindPurposeKey,
  kindDoneKey,
  TEACHING_STEPS,
  teachingStepKey,
  teachingSkipTarget,
  resolveActivityOutcome,
  outcomeKey,
  classifySubmitFailure,
  submitFailureKey,
  type ActivityOutcome,
} from '@/lib/experience/learning-session';
import {
  DRAFT_MAX_AGE_MS,
  DRAFT_PREFIX,
  clearDraft,
  draftHasInput,
  draftKey,
  loadDraft,
  purgeForeignDrafts,
  questionFingerprint,
  saveDraft,
  type DraftStorage,
  type SessionDraft,
} from '@/lib/experience/session-draft';
import { getMessages, LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const QUIZ_CODE = strip(QUIZ);
const INTRO = read('src/app/dashboard/quiz/TeachingIntro.tsx');
const CSS = read('src/app/globals.css');
const UX3_CSS = CSS.slice(CSS.indexOf('UX-3 -- learning session'));

/* ------------------------------------------------------------------ */
describe('UX-3 vocabulary -- one experience per launched mode, localized everywhere', () => {
  it('maps every quiz mode to its experience (presentation only, remediation overrides)', () => {
    expect(activityKindForMode('canonical_learn_check')).toBe('check');
    expect(activityKindForMode('topic_practice')).toBe('train');
    expect(activityKindForMode('review')).toBe('train');
    expect(activityKindForMode('canonical_prove')).toBe('prove');
    expect(activityKindForMode('quick_check')).toBe('prove');
    expect(activityKindForMode('canonical_retain')).toBe('retain');
    expect(activityKindForMode('retention_check')).toBe('retain');
    expect(activityKindForMode('canonical_transfer')).toBe('transfer');
    expect(activityKindForMode('diagnostic_check')).toBe('diagnose');
    expect(activityKindForMode('exam_simulation')).toBe('assess');
    expect(activityKindForMode('topic_practice', { remediation: true })).toBe('reinforce');
  });

  it('independent experiences are exactly the non-practice evidence modes', () => {
    expect(ACTIVITY_KINDS.filter(isIndependentKind)).toEqual(['prove', 'retain', 'transfer', 'diagnose', 'assess']);
  });

  it('every kind / purpose / done / teaching step / outcome / failure has copy in all 5 locales -- never a raw enum', () => {
    const outcomes: ActivityOutcome[] = ['MASTERED', 'SATISFIED', 'NOT_YET', 'RECORDED'];
    for (const locale of LOCALES) {
      const t = getMessages(locale) as Record<string, string>;
      const keys = [
        ...ACTIVITY_KINDS.flatMap((k) => [kindLabelKey(k), kindPurposeKey(k), kindDoneKey(k)]),
        ...TEACHING_STEPS.map(teachingStepKey),
        ...outcomes.map(outcomeKey),
        ...(['NETWORK', 'SERVER', 'EXPIRED'] as const).map(submitFailureKey),
        'xs.submitFailedTitle', 'xs.retrySubmit', 'xs.alreadySubmittedTitle', 'xs.alreadySubmittedBody', 'xs.resumed',
        'xs.skipToGuide', 'xs.checkRetry', 'xs.checking', 'xs.review', 'xs.progress', 'xs.moveUp', 'xs.moveDown',
        'xs.tutor.sendFailed', 'xs.tutor.loadFailed', 'xs.tutor.conversations',
      ];
      for (const k of keys) {
        expect(t[k], `${locale}:${k}`).toBeTruthy();
        expect(t[k], `${locale}:${k}`).not.toMatch(/^[A-Z_]{4,}$/);
      }
    }
    expect(getMessages('es')['xs.kind.train']).toBe('Entrénalo');
    expect(getMessages('es')['xs.kind.prove']).toBe('Demuéstralo');
    expect(getMessages('es')['xs.kind.retain']).toBe('¿Todavía lo recuerdas?');
    expect(getMessages('es')['xs.kind.transfer']).toBe('Aplícalo');
    expect(getMessages('es')['xs.teach.GUIDE']).toBe('Ahora tú');
    expect(getMessages('es')['xs.outcome.NOT_YET']).toBe('Todavía no');
    expect(getMessages('es')['xs.outcome.SATISFIED']).toBe('Lo tienes');
    expect(getMessages('es')['xs.outcome.MASTERED']).toBe('Dominado');
  });

  it('"Probemos de otra manera" is never claimed (no field proves a strategy change -- GAP-01/02)', () => {
    for (const locale of LOCALES) {
      expect(Object.values(getMessages(locale)).some((v) => /Probemos de otra manera/i.test(String(v)))).toBe(false);
    }
  });

  it('learning copy has no "generating with AI" chrome', () => {
    expect(QUIZ_CODE).not.toMatch(/at\['quiz\.generating'\]/);
    expect(QUIZ_CODE).toMatch(/preparingView\(at\['xs\.preparing'\]\)/);
  });
});

/* ------------------------------------------------------------------ */
describe('UX-3 outcome -- the server decides; the score never does', () => {
  const req = (stage: string, status: string) => ({ stage, status });

  it('MASTERED only when the fresh canonical decision is CONSOLIDATED', () => {
    expect(resolveActivityOutcome({ kind: 'transfer', canonicalResultsStatus: 'OK', canonicalResults: { stage: 'CONSOLIDATED', requirements: [] } })).toBe('MASTERED');
    expect(resolveActivityOutcome({ kind: 'prove', canonicalResultsStatus: 'OK', canonicalResults: { stage: 'RETAIN', requirements: [req('PROVE', 'SATISFIED')] } })).toBe('SATISFIED');
  });

  it("this activity's own requirement decides SATISFIED / NOT_YET; WAITING or absent stays neutral", () => {
    expect(resolveActivityOutcome({ kind: 'check', canonicalResultsStatus: 'OK', canonicalResults: { stage: 'LEARN', requirements: [req('LEARN', 'UNSATISFIED')] } })).toBe('NOT_YET');
    expect(resolveActivityOutcome({ kind: 'train', canonicalResultsStatus: 'OK', canonicalResults: { stage: 'PROVE', requirements: [req('PRACTICE', 'SATISFIED')] } })).toBe('SATISFIED');
    expect(resolveActivityOutcome({ kind: 'retain', canonicalResultsStatus: 'OK', canonicalResults: { stage: 'RETAIN', requirements: [req('RETAIN', 'WAITING')] } })).toBe('RECORDED');
    expect(resolveActivityOutcome({ kind: 'transfer', canonicalResultsStatus: 'OK', canonicalResults: { stage: 'TRANSFER', requirements: [] } })).toBe('RECORDED');
  });

  it('a non-OK canonical status never produces a verdict from stale data', () => {
    for (const status of ['CANONICAL_RESULTS_UNAVAILABLE', 'V1_ACTIVITY_CONTRACT_VIOLATION', 'NOT_V1']) {
      expect(resolveActivityOutcome({ kind: 'prove', canonicalResultsStatus: status, canonicalResults: { stage: 'CONSOLIDATED', requirements: [req('PROVE', 'SATISFIED')] } })).toBe('RECORDED');
    }
  });

  it('legacy attempts use only the server re-read (proveSufficiency) or the server-status milestone', () => {
    expect(resolveActivityOutcome({ kind: 'prove', canonicalResultsStatus: 'NOT_V1', proveSufficiency: { sufficient: true } })).toBe('SATISFIED');
    expect(resolveActivityOutcome({ kind: 'prove', canonicalResultsStatus: 'NOT_V1', proveSufficiency: { sufficient: false } })).toBe('NOT_YET');
    expect(resolveActivityOutcome({ kind: 'retain', canonicalResultsStatus: 'NOT_V1', milestone: 'RETAINED' })).toBe('SATISFIED');
    expect(resolveActivityOutcome({ kind: 'train', canonicalResultsStatus: 'NOT_V1' })).toBe('RECORDED');
  });

  it('correct != mastered: the resolver has no score input, and 100% with no status is still neutral', () => {
    const src = strip(read('src/lib/experience/learning-session.ts'));
    expect(src).not.toMatch(/score|correctCount|percent|threshold/i);
    // a perfect score the server did not qualify is not "Lo tienes"
    expect(resolveActivityOutcome({ kind: 'train', canonicalResultsStatus: 'OK', canonicalResults: { stage: 'PRACTICE', requirements: [req('PRACTICE', 'UNSATISFIED')] } })).toBe('NOT_YET');
  });

  it('the results page feeds the resolver only server fields and shows the score as a plain fact', () => {
    expect(QUIZ_CODE).toMatch(/resolveActivityOutcome\(\{\s*kind: activityKind,\s*canonicalResultsStatus: results\.canonicalResultsStatus,\s*canonicalResults: results\.canonicalResults,\s*proveSufficiency: results\.proveSufficiency,\s*milestone,\s*\}\)/);
    expect(QUIZ_CODE).toMatch(/at\['xs\.resultFact'\]\.replace\('\{correct\}', String\(results\.results\.correctCount\)\)/);
    // the canonical next step is still the ONLY next-step authority, and its CTA sits with it
    expect(QUIZ_CODE).toMatch(/const canonicalNextShown = results\.canonicalResultsStatus === 'OK' && !!results\.canonicalResults;/);
    expect(QUIZ_CODE).toMatch(/\{continuation\(true\)\}\s*<\/section>/);
  });
});

/* ------------------------------------------------------------------ */
describe('UX-3 bug B -- the "go straight to practice" shortcut can never skip a required GUIDE', () => {
  it('jumps to the next GUIDE in the plan, else ends the teaching phase', () => {
    expect(teachingSkipTarget(['EXPLAIN', 'MODEL', 'GUIDE'], 0)).toEqual({ kind: 'STAGE', index: 2 });
    expect(teachingSkipTarget(['MODEL', 'GUIDE'], 0)).toEqual({ kind: 'STAGE', index: 1 });
    expect(teachingSkipTarget(['EXPLAIN', 'MODEL'], 0)).toEqual({ kind: 'DONE' });
    expect(teachingSkipTarget(['EXPLAIN'], 0)).toEqual({ kind: 'DONE' });
    // it never invents a stage and never moves backwards
    expect(teachingSkipTarget(['GUIDE', 'EXPLAIN'], 0)).toEqual({ kind: 'DONE' });
  });

  it('TeachingIntro routes the shortcut through teachingSkipTarget -- no direct onDone() from it', () => {
    const code = strip(INTRO);
    expect(code).toMatch(/const skip = teachingSkipTarget\(effectivePlan, idx\);/);
    expect(code).toMatch(/onClick=\{skipAhead\}/);
    expect(code).not.toMatch(/teachingIntro\.skip'\][\s\S]{0,40}onClick=\{onDone\}|onClick=\{onDone\}[\s\S]{0,80}teachingIntro\.skip/);
    expect(code).toMatch(/skip\.kind === 'STAGE' \? t\['xs\.skipToGuide'\] : t\['teachingIntro\.skip'\]/);
  });

  it('a skipped reading step is never shown as done; GUIDE survives a StrictMode remount', () => {
    const code = strip(INTRO);
    expect(code).toMatch(/i < idx && visited\.has\(i\) \? 'done'/);
    expect(code).toMatch(/if \(guideKeyRef\.current === key\) guideKeyRef\.current = null;/);
  });
});

/* ------------------------------------------------------------------ */
describe('UX-3 bug A -- a failed submission is visible, announced, recoverable, never "incorrect"', () => {
  it('classifies failures from the transport outcome only', () => {
    expect(classifySubmitFailure({ thrown: true })).toBe('NETWORK');
    expect(classifySubmitFailure({ status: 0 })).toBe('NETWORK');
    expect(classifySubmitFailure({ status: 500 })).toBe('SERVER');
    expect(classifySubmitFailure({ status: 400, errorCode: 'QUIZ_NOT_FOUND' })).toBe('EXPIRED');
  });

  it('submitQuiz keeps answers, guards double submission and handles alreadySubmitted', () => {
    const fn = QUIZ_CODE.slice(QUIZ_CODE.indexOf('async function submitQuiz'), QUIZ_CODE.indexOf('async function submitVerification'));
    expect(fn).toMatch(/if \(submittingRef\.current\) return;\s*submittingRef\.current = true;/);
    expect(fn).toMatch(/setSubmitFailure\(classifySubmitFailure\(\{ status: res\.status, errorCode: body\?\.error \?\? null \}\)\)/);
    expect(fn).toMatch(/setSubmitFailure\(classifySubmitFailure\(\{ thrown: true \}\)\)/);
    expect(fn).toMatch(/if \(body\.alreadySubmitted\) \{\s*setAlreadySubmitted\(true\);/);
    // a failure never touches answers or results
    expect(fn).not.toMatch(/setAnswers|setResults\(null\)|setCurrent/);
  });

  it('the failure is rendered in the question view with role=alert and a Retry that re-sends the SAME answers', () => {
    expect(QUIZ_CODE).toMatch(/\{submitFailure && \(\s*<InlineAlert\s+tone="error"\s+title=\{at\['xs\.submitFailedTitle'\]\}\s+body=\{at\[submitFailureKey\(submitFailure\)\]\}/);
    expect(QUIZ_CODE).toMatch(/onClick=\{\(\) => submitQuiz\(answers, confidences\)\} disabled=\{submitting\} aria-busy=\{submitting\}/);
    expect(read('src/components/ui/InlineAlert.tsx')).toMatch(/role=\{tone === 'error' \? 'alert' : 'status'\}/);
    // inputs stay visible but frozen while a submission is in flight
    expect(QUIZ_CODE).toMatch(/disabled=\{answerLocked \|\| answerCheck\?\.status === 'checking' \|\| submitting\}/);
  });

  it('a lost-response re-send shows an honest state plus the canonical continuation', () => {
    const block = QUIZ_CODE.slice(QUIZ_CODE.indexOf('if (alreadySubmitted) {'), QUIZ_CODE.indexOf('if (results) {'));
    expect(block).toMatch(/at\['xs\.alreadySubmittedTitle'\]/);
    expect(block).toMatch(/<ContinuationPanel/);
  });

  it('LEARN_CHECK: a failed read-only check says so and can be re-run; the answer stays locked', () => {
    expect(QUIZ_CODE).toMatch(/answerCheck\.status === 'unavailable' \? \([\s\S]*?at\['quiz\.checkUnavailable'\][\s\S]*?onClick=\{checkAnswer\}>\{at\['xs\.checkRetry'\]\}/);
  });

  it('remediation-step routes (Explain / Transfer) keep the text and retry with the same activityId', () => {
    for (const p of ['src/app/dashboard/cognitive/explain/page.tsx', 'src/app/dashboard/cognitive/transfer/page.tsx']) {
      const code = strip(read(p));
      expect(code, p).toMatch(/setSubmitFailure\(classifySubmitFailure\(\{ thrown: true \}\)\);\s*setPhase\('answering'\);/);
      expect(code, p).toMatch(/activityId: activityIdRef\.current/);
      expect(code, p).not.toMatch(/if \(!res\.ok\) \{\s*setPhase\('error'\);\s*return;\s*\}\s*setFeedback|if \(!res\.ok\) \{\s*setPhase\('error'\);\s*return;\s*\}\s*setResult/);
      expect(code, p).toMatch(/setLoadAttempt\(\(n\) => n \+ 1\)/);
    }
  });
});

/* ------------------------------------------------------------------ */
function memoryStorage(): DraftStorage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
  };
}
const QS = [{ question: 'Q1', answerFormat: 'single_choice' }, { question: 'Q2', answerFormat: 'text' }];
function draft(over: Partial<SessionDraft> = {}): SessionDraft {
  return {
    v: 1, studentId: 'stu-A', quizId: 'quiz-1', fingerprint: questionFingerprint(QS), current: 1,
    answers: { 0: 'b' }, confidences: {}, presentedAt: {}, submittedAt: {},
    pending: { singleChoice: null, multiChoice: [], textAnswer: 'x', matchingAnswer: {}, orderingAnswer: [], classificationAnswer: {}, confidenceSelected: null },
    check: null, savedAt: 1_000, ...over,
  };
}

describe('UX-3 bug C -- refresh continuity is scoped, disposable and never evidence', () => {
  const scope = { studentId: 'stu-A', quizId: 'quiz-1', fingerprint: questionFingerprint(QS), questionCount: 2, now: 2_000 };

  it('restores only into the same student + session + question batch', () => {
    const s = memoryStorage();
    saveDraft(s, draft());
    expect(loadDraft(s, scope)?.answers).toEqual({ 0: 'b' });
    expect(loadDraft(s, { ...scope, studentId: 'stu-B' })).toBeNull(); // another account
    expect(loadDraft(s, { ...scope, quizId: 'quiz-2' })).toBeNull(); // another session
  });

  it('a different question batch or an out-of-range position discards the draft', () => {
    const s = memoryStorage();
    saveDraft(s, draft());
    expect(loadDraft(s, { ...scope, fingerprint: questionFingerprint([{ question: 'other' }]) })).toBeNull();
    expect(s.getItem(draftKey('stu-A', 'quiz-1'))).toBeNull();
    saveDraft(s, draft({ current: 5 }));
    expect(loadDraft(s, scope)).toBeNull();
  });

  it('stale drafts expire; other students’ drafts are purged on read (shared devices)', () => {
    const s = memoryStorage();
    saveDraft(s, draft());
    expect(loadDraft(s, { ...scope, now: 1_000 + DRAFT_MAX_AGE_MS + 1 })).toBeNull();
    saveDraft(s, draft({ studentId: 'stu-B' }));
    saveDraft(s, draft());
    purgeForeignDrafts(s, 'stu-A', 2_000);
    expect(Object.keys(s.dump())).toEqual([draftKey('stu-A', 'quiz-1')]);
    clearDraft(s, 'stu-A', 'quiz-1');
    expect(Object.keys(s.dump()).filter((k) => k.startsWith(DRAFT_PREFIX))).toEqual([]);
  });

  it('never throws when storage is blocked', () => {
    const broken: DraftStorage = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); }, key: () => null, length: 1 };
    expect(() => saveDraft(broken, draft())).not.toThrow();
    expect(loadDraft(broken, scope)).toBeNull();
    expect(() => purgeForeignDrafts(broken, 'stu-A', 0)).not.toThrow();
  });

  it('an untouched session is not "resumed"', () => {
    expect(draftHasInput(draft({ current: 0, answers: {}, pending: { ...draft().pending, textAnswer: '' } }))).toBe(false);
    expect(draftHasInput(draft())).toBe(true);
  });

  it('the page uses sessionStorage, never scores or submits a draft, and clears it on authoritative completion', () => {
    const src = strip(read('src/lib/experience/session-draft.ts'));
    expect(src).toMatch(/window\.sessionStorage/);
    expect(src).not.toMatch(/localStorage|fetch\(/);
    // the restore path makes no request and only refills learner input
    const restore = QUIZ_CODE.slice(QUIZ_CODE.indexOf('const d = loadDraft('), QUIZ_CODE.indexOf('setResumedFromDraft(true);'));
    expect(restore).not.toMatch(/fetch\(|submitQuiz|setResults|nextQuestion/);
    expect(QUIZ_CODE).toMatch(/if \(results \|\| alreadySubmitted \|\| submitFailure === 'EXPIRED'\) clearDraft\(browserDraftStorage\(\), studentId, quizId\);/);
    // a LEARN_CHECK answer that was already checked stays locked after reload
    expect(QUIZ_CODE).toMatch(/check && check\.index === d\.current && \(check\.status === 'done' \|\| check\.status === 'unavailable'\)/);
  });
});

/* ------------------------------------------------------------------ */
describe('UX-3 learning shell, controls and mobile rules', () => {
  it('every activity state renders inside one .ls shell with the shared header', () => {
    expect(QUIZ_CODE.match(/<SessionHeader/g)!.length).toBeGreaterThanOrEqual(3);
    expect(QUIZ_CODE).toMatch(/<div className="ls" data-kind=\{activityKind\}>/);
    expect(read('src/app/dashboard/cognitive/explain/page.tsx')).toMatch(/<SessionHeader/);
    expect(read('src/app/dashboard/cognitive/transfer/page.tsx')).toMatch(/<SessionHeader/);
    expect(read('src/app/dashboard/remediation/[pathId]/page.tsx')).toMatch(/<SessionHeader/);
  });

  it('single-choice options are real radios: whole-row target, checked state, focus ring', () => {
    expect(QUIZ_CODE).toMatch(/<div role="radiogroup" aria-labelledby="ls-question" className="ls-options">/);
    expect(QUIZ_CODE).toMatch(/role="radio"\s+aria-checked=\{isSelected\}\s+className="ls-option"/);
    expect(UX3_CSS).toMatch(/\.ls-option \{[^}]*min-height: 52px;/);
    expect(UX3_CSS).toMatch(/\.ls-option:focus-visible, \.ls-option:has\(input:focus-visible\) \{ outline: 2px solid var\(--brand\);/);
    expect(UX3_CSS).toMatch(/\.ls-option\[aria-checked='true'\]/);
  });

  it('audio controls (read-aloud, dictation) share one 44px geometry with a pressed state', () => {
    for (const p of ['src/app/dashboard/ReadAloudButton.tsx', 'src/app/dashboard/VoiceInputButton.tsx']) {
      const src = read(p);
      expect(src, p).toMatch(/className=\{?[`"]ls-audio/);
      expect(src, p).toMatch(/aria-pressed=/);
      expect(src, p).not.toMatch(/'🔊'|'🎙'|'⏹'/);
    }
    expect(UX3_CSS).toMatch(/\.ls-audio \{[^}]*width: var\(--touch-target\); height: var\(--touch-target\);/);
    expect(UX3_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.ls-audio--mic\.is-listening \{ animation: none;/);
  });

  it('phones: sticky action only for choice answers (never over the math keyboard), 16px fields', () => {
    expect(QUIZ_CODE).toMatch(/const stickyAction = q\.answerFormat === 'single_choice' \|\| q\.answerFormat === 'multi_choice';/);
    expect(UX3_CSS).toMatch(/\.ls-actions--sticky \{[\s\S]*?position: sticky; bottom: 0;[\s\S]*?env\(safe-area-inset-bottom\)/);
    expect(UX3_CSS).toMatch(/@media \(pointer: coarse\) \{\s*\.ui-input, \.ui-select, \.ls-lang \{ font-size: 16px; \}/);
    expect(read('src/components/UnifiedResponseComposer.tsx')).toMatch(/fontSize: 16,/);
    expect(UX3_CSS).toMatch(/\.ls \.katex-display, \.ls-task \.katex-display \{ overflow-x: auto;/);
  });

  it('Tutor: one pane at a time below 1024px, 16px input, recoverable send failure', () => {
    const tutor = strip(read('src/app/dashboard/tutor/TutorChat.tsx'));
    expect(tutor).toMatch(/<div className="tt" data-view=\{view\}>/);
    expect(UX3_CSS).toMatch(/@media \(max-width: 1023px\) \{\s*\.tt \{ grid-template-columns: minmax\(0, 1fr\);[\s\S]*?\.tt\[data-view='chat'\] \.tt-list \{ display: none; \}/);
    expect(UX3_CSS).toMatch(/\.tt-input \{[^}]*font-size: 16px;/);
    expect(tutor).toMatch(/setMessages\(\(prev\) => prev\.filter\(\(m\) => m\.id !== optimisticUser\.id\)\);\s*setInput\(userText\);\s*setSendFailed\(true\);/);
    expect(tutor).toMatch(/role="log" aria-live="polite"/);
  });

  it('precision: UX-3 CSS keeps the UX-2 rules (no transforms, token spacing, derived offsets only)', () => {
    expect(UX3_CSS).not.toMatch(/rotate\(|skew\(|translate[XY]?\(/);
    const raw = UX3_CSS.split('\n').filter((l) => /(^|[\s{;])(padding|margin|gap|row-gap|column-gap)[a-z-]*:\s*[^;]*\b\d+(\.\d+)?px/.test(l) && !/calc\(/.test(l));
    expect(raw).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
describe('UX-3 -- the frontend is not a second learning engine', () => {
  const files = [
    'src/lib/experience/learning-session.ts',
    'src/lib/experience/session-draft.ts',
    'src/components/learning/SessionHeader.tsx',
    'src/app/dashboard/quiz/TeachingIntro.tsx',
    'src/app/dashboard/tutor/TutorChat.tsx',
  ];
  it('no score / attempt / confidence thresholds and no stage choice in UX-3-owned code', () => {
    for (const f of files) {
      const code = strip(read(f));
      expect(code, f).not.toMatch(/\b(score|mastery|attempts?|confidence|correctCount)\s*[<>]=?\s*\d/i);
      expect(code, f).not.toMatch(/getCanonicalPedagogicalDecision|resolveCanonicalLaunch|computeSupportLevel/);
    }
  });
  it('the quiz page still takes the next step from the canonical continuation only', () => {
    expect(QUIZ_CODE).not.toMatch(/results\.results\.score\s*[<>]=?\s*\d/);
    expect(QUIZ_CODE).toMatch(/from=\{continuationKind\}/);
  });
});
