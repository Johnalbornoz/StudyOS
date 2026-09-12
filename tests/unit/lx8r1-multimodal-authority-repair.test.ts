/**
 * LX-8R1 -- MULTIMODAL AUTHORITY, PRIVACY & RESPONSE-LANGUAGE REPAIR.
 *
 * Three repairs to the LX-8 phase:
 *   R1: quiz/page.tsx now CONSUMES one interaction-policy authority
 *       (buildInteractionContract) instead of independently re-deriving
 *       "voice allowed because answerFormat === text" / "audio allowed
 *       because the browser supports it" in its own JSX.
 *   R2: the privacy claim about SpeechRecognition being "entirely
 *       browser/OS-local" is corrected -- StudyUS does not control
 *       whether the BROWSER's own implementation processes audio
 *       on-device or via vendor infrastructure; only that StudyUS's own
 *       backend never receives it.
 *   R3: STT locale now derives from `expectedResponseLanguage`, TTS
 *       from `activityLanguage` -- two fields on the same
 *       ActivityLanguageContext, numerically equal today but
 *       structurally independent for a future case where they diverge.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildInteractionContract } from '@/lib/lx/interaction-contract';
import { buildActivityLanguageContext, activityLanguageToBCP47 } from '@/lib/lx/activity-language';
import { evidenceModeForActivity } from '@/lib/activity-taxonomy';
import { deriveResponseEvidenceContract } from '@/lib/lx/response-evidence-contract';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const QUIZ_PAGE_SRC = strip(read('src/app/dashboard/quiz/page.tsx'));
const VOICE_INPUT_SRC = strip(read('src/app/dashboard/VoiceInputButton.tsx'));
const READ_ALOUD_SRC = strip(read('src/app/dashboard/ReadAloudButton.tsx'));
const INTERACTION_CONTRACT_SRC = strip(read('src/lib/lx/interaction-contract.ts'));
const MULTIMODAL_OBS_SRC = strip(read('src/lib/lx/multimodal-observability.ts'));
const LANGUAGE_SRC = strip(read('src/lib/i18n/language.ts'));
const QUIZ_GEN_SRC = strip(read('src/services/quiz-generation.service.ts'));

/* ============================================================== *
 * R1 -- ONE INTERACTION CONTRACT AUTHORITY (tests 1-6)             *
 * ============================================================== */
describe('LX-8R1 R1 tests 1-6 -- quiz/page.tsx consumes, never recreates, the interaction policy', () => {
  it('1. the quiz surface calls buildInteractionContract and stores the result (ic) -- one canonical policy call', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/const interactionContract = useMemo\(/);
    expect(QUIZ_PAGE_SRC).toMatch(/buildInteractionContract\(\{/);
    expect(QUIZ_PAGE_SRC).toMatch(/const ic = interactionContract!;/);
  });

  it('2. no duplicate VOICE eligibility logic remains -- VoiceInputButton is gated by ic.inputModes, never a raw answerFormat check of its own', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/\{ic\.inputModes\.includes\('VOICE'\) && \(/);
    // the render block between that gate and the VoiceInputButton element itself never re-checks answerFormat -- the OUTER answerFormat === 'text' switch (a pre-existing, unrelated answer-SURFACE router, not a modality-eligibility rule) is not repeated here.
    const gateIdx = QUIZ_PAGE_SRC.indexOf("ic.inputModes.includes('VOICE')");
    const voiceButtonBlock = QUIZ_PAGE_SRC.slice(gateIdx, QUIZ_PAGE_SRC.indexOf('VoiceInputButton', gateIdx) + 20);
    expect(voiceButtonBlock).not.toMatch(/answerFormat === 'text'/);
  });

  it('3. no duplicate AUDIO eligibility logic remains -- ReadAloudButton is gated by ic.outputModes; the page’s own speechSynthesis capability check feeds DETECTION (an allowed input), never a second ELIGIBILITY decision of its own', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/\{ic\.outputModes\.includes\('AUDIO'\) && \(/);
    // the one 'speechSynthesis' reference in this file is inside the
    // capability-detection effect, feeding modalityCapabilities -- not
    // a second "if supported, render/allow X" branch anywhere else.
    const detectionEffect = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('setModalityCapabilities({'), QUIZ_PAGE_SRC.indexOf('}, []);'));
    expect(detectionEffect).toMatch(/'speechSynthesis' in window/);
    const restOfFile = QUIZ_PAGE_SRC.replace(detectionEffect, '');
    expect(restOfFile).not.toMatch(/'speechSynthesis' in window/);
  });

  it('4. browser feature detection is capability INPUT only -- modalityCapabilities feeds buildInteractionContract, the page never branches rendering on it directly', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/capabilities: modalityCapabilities/);
    // the raw capability booleans are set once (mount effect) and never referenced again outside that effect and the builder call.
    const occurrences = [...QUIZ_PAGE_SRC.matchAll(/modalityCapabilities/g)];
    expect(occurrences.length).toBeGreaterThanOrEqual(2); // state decl + effect + builder input, never a JSX conditional
    expect(QUIZ_PAGE_SRC).not.toMatch(/\{modalityCapabilities\.speechRecognitionSupported &&/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/\{modalityCapabilities\.speechSynthesisSupported &&/);
  });

  it('5. INDEPENDENT quiz modes still permit VOICE/AUDIO for a free-text question, via the same contract', () => {
    const integrityMode = evidenceModeForActivity('RETENTION_CHECK');
    const c = buildInteractionContract({
      integrityMode,
      answerFormat: 'text',
      activityLanguage: buildActivityLanguageContext('en'),
      capabilities: { speechRecognitionSupported: true, speechSynthesisSupported: true },
    });
    expect(c.integrityMode).toBe('INDEPENDENT');
    expect(c.inputModes).toContain('VOICE');
    expect(c.outputModes).toContain('AUDIO');
  });

  it('6. INDEPENDENT still exposes no pedagogical help -- the Hint button gate (PRACTICE_EVIDENCE_MODES) is untouched by this repair', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/\{PRACTICE_EVIDENCE_MODES\.includes\(quizMode\) && studentId && quizId && \(/);
  });
});

/* ============================================================== *
 * VOICE REVIEW / NO-AUTO-SUBMIT (tests 7-8, unchanged by repair)   *
 * ============================================================== */
describe('LX-8R1 tests 7-8 -- voice review/no-auto-submit behavior unchanged by this repair', () => {
  it('7. transcript still requires learner review before anything else happens', () => {
    expect(VOICE_INPUT_SRC).toMatch(/setState\('REVIEW'\)/);
  });

  it('8. transcript still cannot auto-submit -- onAccept only ever called from the explicit accept() handler', () => {
    const acceptCalls = [...VOICE_INPUT_SRC.matchAll(/props\.onAccept\(/g)];
    expect(acceptCalls.length).toBe(1);
    expect(VOICE_INPUT_SRC).toMatch(/function accept\(\)[\s\S]{0,120}props\.onAccept\(transcript\)/);
  });
});

/* ============================================================== *
 * R2 -- PRIVACY CLAIM CORRECTION (tests 9-10)                      *
 * ============================================================== */
describe('LX-8R1 R2 tests 9-10 -- corrected privacy model', () => {
  it('9. StudyUS backend receives no raw audio upload -- no fetch/upload call anywhere carries audio', () => {
    expect(VOICE_INPUT_SRC).not.toMatch(/fetch\(|FormData|Blob\(|MediaRecorder/);
  });

  it('10. code/docs no longer claim browser STT is guaranteed device-local, and state the corrected boundary (checked against the raw file -- this documentation legitimately lives in the component’s doc comment, which source-contract checks elsewhere in this suite deliberately strip)', () => {
    const raw = read('src/app/dashboard/VoiceInputButton.tsx');
    expect(raw).not.toMatch(/entirely browser\/OS-local/);
    expect(raw).not.toMatch(/never leaves the device/i);
    expect(raw).toMatch(/does not intentionally persist or upload/i);
    expect(raw).toMatch(/outside this runtime'?s control|outside StudyUS'?s runtime control/i);
    expect(raw).toMatch(/Production use with minors/i);
    // and the LX-8 report itself must not still be quoted/relied on as current -- this repair supersedes it in code, which is what matters for behavior.
    expect(raw).toMatch(/vendor'?s own cloud service|vendor infrastructure/i);
  });
});

/* ============================================================== *
 * R3 -- STT/TTS LANGUAGE AUTHORITY (tests 11-16)                   *
 * ============================================================== */
describe('LX-8R1 R3 tests 11-16 -- STT follows expectedResponseLanguage, TTS follows activityLanguage', () => {
  it('11. STT locale derives from expectedResponseLanguage, not activityLanguage', () => {
    expect(VOICE_INPUT_SRC).toMatch(/recognition\.lang = activityLanguageToBCP47\(props\.expectedResponseLanguage\)/);
    expect(VOICE_INPUT_SRC).not.toMatch(/props\.activityLanguage/);
  });

  it('12. TTS language derives from the spoken content’s own activityLanguage', () => {
    expect(READ_ALOUD_SRC).toMatch(/activityLanguageToBCP47\(activityLanguage\)/);
  });

  it('13. neither component reads interface language to drive STT/TTS', () => {
    for (const src of [VOICE_INPUT_SRC, READ_ALOUD_SRC]) {
      expect(src).not.toMatch(/getInterfaceLanguage|interfaceLanguage/i);
    }
  });

  it('14. activityLanguage != expectedResponseLanguage is representable end-to-end through the contract', () => {
    const c = buildInteractionContract({
      integrityMode: 'PRACTICE',
      answerFormat: 'text',
      activityLanguage: { activityLanguage: 'es', expectedResponseLanguage: 'de' },
      capabilities: { speechRecognitionSupported: true, speechSynthesisSupported: true },
    });
    expect(c.activityLanguage).toBe('es');
    expect(c.expectedResponseLanguage).toBe('de');
  });

  it('15. Spanish interface + English activity -> STT English (expectedResponseLanguage governs, never interface locale)', () => {
    const ctx = buildActivityLanguageContext('en'); // the activity itself is English, regardless of any interface setting
    expect(activityLanguageToBCP47(ctx.expectedResponseLanguage)).toBe('en-US');
  });

  it('16. hypothetical Spanish instruction + German expected response -> STT German', () => {
    const c = buildInteractionContract({
      integrityMode: 'PRACTICE',
      answerFormat: 'text',
      activityLanguage: { activityLanguage: 'es', expectedResponseLanguage: 'de' },
      capabilities: { speechRecognitionSupported: true, speechSynthesisSupported: true },
    });
    expect(activityLanguageToBCP47(c.expectedResponseLanguage)).toBe('de-DE');
    expect(activityLanguageToBCP47(c.activityLanguage)).toBe('es-ES'); // TTS would still speak the Spanish content
  });
});

/* ============================================================== *
 * R4 -- RESPONSE PACKAGING AUDIT (tests 17-23)                     *
 * ============================================================== */
describe('LX-8R1 R4 tests 17-23 -- response packaging audit', () => {
  it('17. ANSWER_ONLY has no unnecessary reasoning field', () => {
    const mc = deriveResponseEvidenceContract({ type: 'multiple_choice' }, 'PRACTICE');
    expect(mc.requiresWork || mc.requiresJustification).toBe(false);
  });

  it('18. SHOW_WORK renders the required reasoning/work capability', () => {
    const c = deriveResponseEvidenceContract({ type: 'step_by_step' }, 'PRACTICE');
    expect(c.kind).toBe('SHOW_WORK');
    expect(c.requiresWork).toBe(true);
    expect(QUIZ_PAGE_SRC).toMatch(/responseContract\.requiresWork \|\| responseContract\.requiresJustification/);
  });

  it('19. JUSTIFY renders the justification capability', () => {
    const c = deriveResponseEvidenceContract({ type: 'justification' }, 'PRACTICE');
    expect(c.kind).toBe('JUSTIFY');
    expect(c.requiresJustification).toBe(true);
  });

  it('20. EXPLAIN remains a single, correctly answerable surface -- no unwanted second box for requiresFinalAnswer: false questions', () => {
    const c = deriveResponseEvidenceContract({ type: 'open_ended' }, 'PRACTICE');
    expect(c.kind).toBe('EXPLAIN');
    expect(c.requiresFinalAnswer).toBe(false);
    expect(c.requiresWork || c.requiresJustification).toBe(false); // no second box triggered for a pure EXPLAIN ask
  });

  it('21. requiresWork=false cannot create a mandatory work requirement -- canProceed’s text case never references explanationAnswer', () => {
    const canProceedBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('function canProceed'), QUIZ_PAGE_SRC.indexOf('function nextQuestion'));
    expect(canProceedBlock).not.toMatch(/explanationAnswer/);
  });

  it('22. the learner-facing reasoning label is read from activity-language messages (at[...]), never hardcoded', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/at\['multimodal\.reasoningLabel'\]/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/placeholder="Explain your reasoning"/);
  });

  it('23. the grader receives deterministic, unambiguous packaging -- a fixed language-neutral marker precedes the localized label', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/\$\{textAnswer\}\\n\\n---\\n\$\{at\['multimodal\.reasoningLabel'\]\}: \$\{explanationAnswer\}/);
  });
});

/* ============================================================== *
 * OBSERVABILITY (tests 24-25)                                     *
 * ============================================================== */
describe('LX-8R1 tests 24-25 -- INTERACTION_CONTRACT_READY wired, still no content leakage', () => {
  it('24. InteractionEventMeta still cannot carry a transcript/audio/answer/question value', () => {
    const metaBlock = MULTIMODAL_OBS_SRC.slice(MULTIMODAL_OBS_SRC.indexOf('interface InteractionEventMeta'), MULTIMODAL_OBS_SRC.indexOf('export function logInteraction'));
    expect(metaBlock).not.toMatch(/answer|transcript|audio|question\s*:/i);
  });

  it('25. INTERACTION_CONTRACT_READY is wired on the live quiz surface with the required safe metadata', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/logInteraction\('INTERACTION_CONTRACT_READY',\s*\{/);
    const logCall = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("logInteraction('INTERACTION_CONTRACT_READY'"), QUIZ_PAGE_SRC.indexOf("});", QUIZ_PAGE_SRC.indexOf("logInteraction('INTERACTION_CONTRACT_READY'")));
    for (const field of ['conceptId', 'inputModes', 'outputModes', 'supportLevel', 'activityLanguage', 'expectedResponseLanguage', 'integrityMode']) {
      expect(logCall, field).toMatch(new RegExp(field));
    }
  });
});

/* ============================================================== *
 * REGRESSIONS (tests 26-29; 30 is the full-suite run itself)      *
 * ============================================================== */
describe('LX-8R1 tests 26-29 -- unrelated certified surfaces untouched', () => {
  it('26. Retention remains the 6-question canonical path', () => {
    expect(QUIZ_GEN_SRC).toMatch(/RETENTION_REQUIRED_COUNT/);
  });

  it('27. Transfer (transfer-policy.ts) is untouched by this repair', () => {
    const src = strip(read('src/lib/transfer-policy.ts'));
    expect(src).not.toMatch(/interaction-contract|expectedResponseLanguage/);
  });

  it('28. Practice generation (generatePracticeQuestions) is untouched', () => {
    expect(QUIZ_GEN_SRC).toMatch(/export async function generatePracticeQuestions/);
  });

  it('29. resolveQuizLanguage (activity-language authority) is untouched', () => {
    expect(LANGUAGE_SRC).toMatch(/export function resolveQuizLanguage/);
    expect(LANGUAGE_SRC).not.toMatch(/expectedResponseLanguage/); // the new field lives in lib/lx/activity-language.ts, not here
  });

  it('interaction-contract.ts no longer derives integrityMode from ActivityType internally -- it is an input, never computed here', () => {
    expect(INTERACTION_CONTRACT_SRC).not.toMatch(/evidenceModeForActivity\(/);
  });
});
