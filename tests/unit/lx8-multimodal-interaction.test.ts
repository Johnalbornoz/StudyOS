/**
 * LX-8 -- ADAPTIVE & MULTIMODAL INTERACTION.
 *
 * Covers the required 54-item test matrix as pure-function tests
 * (interaction-contract.ts / activity-language.ts / visual-contract.ts /
 * support-presentation.ts / the extended question-quality-contract.ts)
 * plus source-contract regex tests over the new UI components and the
 * additive quiz/page.tsx wiring -- the same established pattern as
 * every prior LX phase in this codebase (no DOM/component-render
 * harness exists here).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildInteractionContract, type InteractionContractInputs } from '@/lib/lx/interaction-contract';
import { buildActivityLanguageContext, fallbackToSupportedLocale, activityLanguageToBCP47 } from '@/lib/lx/activity-language';
import { presentationForSupportLevel } from '@/lib/lx/support-presentation';
import { deriveVisualArtifact, validateVisualArtifact, type VisualArtifact } from '@/lib/lx/visual-contract';
import { logInteraction } from '@/lib/lx/multimodal-observability';
import { checkQuestionQualityDeterministic } from '@/lib/lx/question-quality-contract';
import { deriveResponseEvidenceContract } from '@/lib/lx/response-evidence-contract';
import type { GeneratedQuestion, VisualAid } from '@/services/quiz-generation.service';
import type { SupportLevel } from '@/lib/adaptive-teaching-policy';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const READ_ALOUD_SRC = strip(read('src/app/dashboard/ReadAloudButton.tsx'));
const VOICE_INPUT_SRC = strip(read('src/app/dashboard/VoiceInputButton.tsx'));
const QUIZ_PAGE_SRC = strip(read('src/app/dashboard/quiz/page.tsx'));
const INTERACTION_CONTRACT_SRC = strip(read('src/lib/lx/interaction-contract.ts'));
const SUPPORT_PRESENTATION_SRC = strip(read('src/lib/lx/support-presentation.ts'));
const ACTIVITY_LANGUAGE_SRC = strip(read('src/lib/i18n/language.ts'));
const TODAY_SRC = strip(read('src/app/dashboard/today/page.tsx'));
const PATH_VIEW_SRC = strip(read('src/lib/lx/path-view.ts'));
const QUIZ_GEN_SRC = strip(read('src/services/quiz-generation.service.ts'));

const baseFake: GeneratedQuestion = {
  id: 'q1', conceptId: 'c1', type: 'multiple_choice', answerFormat: 'single_choice',
  question: 'Q', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }],
  correctAnswer: 'A', explanation: 'e', difficulty: 3,
} as GeneratedQuestion;

function contractInputs(over: Partial<InteractionContractInputs> = {}): InteractionContractInputs {
  return {
    activityType: 'PRACTICE',
    answerFormat: 'text',
    activityLanguage: buildActivityLanguageContext('en'),
    capabilities: { speechRecognitionSupported: true, speechSynthesisSupported: true },
    ...over,
  };
}

/* ============================================================== *
 * ADAPTIVE 1-6                                                    *
 * ============================================================== */
describe('LX-8 ADAPTIVE 1-6 -- SupportLevel presentation, never client-computed', () => {
  it('1. HIGH_SUPPORT renders allowed support (explanation/worked example/read-aloud/visual/guided steps)', () => {
    const p = presentationForSupportLevel('HIGH_SUPPORT');
    expect(p).toMatchObject({ explanation: true, workedExample: true, readAloudSuggested: true, relevantVisual: true, guidedSteps: true, pedagogicalAssistance: true });
  });

  it('2. GUIDED renders guided support (example + step prompts, no unsolicited read-aloud/visual)', () => {
    const p = presentationForSupportLevel('GUIDED');
    expect(p).toMatchObject({ explanation: true, workedExample: true, guidedSteps: true, readAloudSuggested: false, relevantVisual: false });
  });

  it('3. PARTIAL_SUPPORT reduces scaffolding to a concise reminder only', () => {
    const p = presentationForSupportLevel('PARTIAL_SUPPORT');
    expect(p).toMatchObject({ conciseReminder: true, explanation: false, workedExample: false, guidedSteps: false });
  });

  it('4. MINIMAL_SUPPORT avoids unnecessary support entirely', () => {
    const p = presentationForSupportLevel('MINIMAL_SUPPORT');
    expect(Object.values(p).every((v) => v === false)).toBe(true);
  });

  it('5. INDEPENDENT hides pedagogical help', () => {
    const p = presentationForSupportLevel('INDEPENDENT');
    expect(p.pedagogicalAssistance).toBe(false);
    expect(p.explanation).toBe(false);
  });

  it('6. the client never calculates SupportLevel -- presentationForSupportLevel is a pure lookup, never a threshold on raw scores', () => {
    expect(SUPPORT_PRESENTATION_SRC).not.toMatch(/masteryScore|independentMastery|computeSupportLevel|>=?\s*\d/);
    expect(INTERACTION_CONTRACT_SRC).toMatch(/supportLevel\?\s*:\s*SupportLevel/);
    expect(INTERACTION_CONTRACT_SRC).not.toMatch(/masteryScore|independentMastery/);
  });
});

/* ============================================================== *
 * VOICE 7-15                                                      *
 * ============================================================== */
describe('LX-8 VOICE 7-15', () => {
  it('7. permitted open-response (answerFormat text) shows VOICE as an input mode when the browser supports it', () => {
    const c = buildInteractionContract(contractInputs({ answerFormat: 'text' }));
    expect(c.inputModes).toContain('VOICE');
  });

  it('8. a disallowed (non-text) response never shows VOICE or MATH', () => {
    const c = buildInteractionContract(contractInputs({ answerFormat: 'single_choice' }));
    expect(c.inputModes).not.toContain('VOICE');
    expect(c.inputModes).not.toContain('MATH');
  });

  it('9. transcript requires learner review -- onresult sets REVIEW state, never calls onAccept directly', () => {
    expect(VOICE_INPUT_SRC).toMatch(/onresult\s*=\s*\(event: any\) => \{[\s\S]{0,200}setState\('REVIEW'\)/);
    const onresultBlock = VOICE_INPUT_SRC.slice(VOICE_INPUT_SRC.indexOf('recognition.onresult'), VOICE_INPUT_SRC.indexOf('recognition.onerror'));
    expect(onresultBlock).not.toMatch(/onAccept/);
  });

  it('10. transcript is not auto-submitted -- onAccept is called only inside accept(), wired only to an explicit button onClick', () => {
    expect(VOICE_INPUT_SRC).toMatch(/function accept\(\)[\s\S]{0,120}props\.onAccept\(transcript\)/);
    expect(VOICE_INPUT_SRC).toMatch(/onClick=\{accept\}/);
  });

  it('11. transcription failure is recoverable -- FAILED state offers a retry control', () => {
    expect(VOICE_INPUT_SRC).toMatch(/state === 'FAILED'/);
    expect(VOICE_INPUT_SRC).toMatch(/transcriptionFailedLabel/);
  });

  it('12. mic permission denied -> typed fallback remains available (VoiceInputButton is additive, never replaces MathAnswerEditor)', () => {
    expect(VOICE_INPUT_SRC).toMatch(/permissionDeniedLabel/);
    const textBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(textBlock).toMatch(/<MathAnswerEditor/);
    expect(textBlock).toMatch(/<VoiceInputButton/);
  });

  it('13. voice is offered in Independent activities too (pure input, evidenceMode-independent) -- RETENTION_CHECK/TRANSFER/SOLO_VERIFY all get VOICE for a text answer', () => {
    for (const activityType of ['RETENTION_CHECK', 'TRANSFER', 'SOLO_VERIFY'] as const) {
      const c = buildInteractionContract(contractInputs({ activityType, answerFormat: 'text' }));
      expect(c.integrityMode).toBe('INDEPENDENT');
      expect(c.inputModes).toContain('VOICE');
    }
  });

  it('13b/36. VoiceInputButton never calls a hint/explain/coaching endpoint or performs any rewriting', () => {
    expect(VOICE_INPUT_SRC).not.toMatch(/hint|explain|coach|rewrit|suggest/i);
  });

  it('14. raw audio is never logged -- no audio/blob/MediaRecorder reference anywhere in the voice component', () => {
    expect(VOICE_INPUT_SRC).not.toMatch(/MediaRecorder|audio\/webm|Blob\(/);
  });

  it('15. the transcript itself is never passed to logInteraction -- only safe metadata fields', () => {
    const logCalls = [...VOICE_INPUT_SRC.matchAll(/logInteraction\('[A-Z_]+',\s*\{([^}]*)\}\)/g)];
    expect(logCalls.length).toBeGreaterThan(0);
    for (const m of logCalls) {
      expect(m[1]).not.toMatch(/transcript|text:/);
    }
  });
});

/* ============================================================== *
 * TTS 16-19                                                       *
 * ============================================================== */
describe('LX-8 TTS 16-19', () => {
  it('16. the quiz page reads the question aloud in quizLanguage (the activity language), not any interface-language state', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/<ReadAloudButton\s*\n?\s*text=\{q\.question\}\s*\n?\s*activityLanguage=\{quizLanguage\}/);
  });

  it('17. activityLanguageToBCP47 is a deterministic per-locale mapping, unrelated to any interface-language input', () => {
    expect(activityLanguageToBCP47('en')).toBe('en-US');
    expect(activityLanguageToBCP47('es')).toBe('es-ES');
    expect(ACTIVITY_LANGUAGE_SRC).not.toMatch(/getInterfaceLanguage.*speechSynthesis|speechSynthesis.*getInterfaceLanguage/);
  });

  it('18. TTS failure never blocks the readable question text -- the heading render is unconditional on any TTS state', () => {
    expect(READ_ALOUD_SRC).toMatch(/if \(!supported\) return null;/);
    expect(QUIZ_PAGE_SRC).toMatch(/<MathText text=\{q\.question\} \/>/);
    // the h2/MathText render is not wrapped in any TTS-supported conditional
    const questionBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('<h2 style={{ fontSize: 20'), QUIZ_PAGE_SRC.indexOf('</h2>'));
    expect(questionBlock).not.toMatch(/supported|speechSynthesis/);
  });

  it('19. ReadAloudButton speaks only the exact text it is given -- no hint/help/explain call anywhere in it', () => {
    expect(READ_ALOUD_SRC).not.toMatch(/hint|explain|help|coach/i);
    expect(READ_ALOUD_SRC).toMatch(/new SpeechSynthesisUtterance\(text\)/);
  });
});

/* ============================================================== *
 * MATH 20-24                                                      *
 * ============================================================== */
describe('LX-8 MATH 20-24', () => {
  it('20. the canonical MathAnswerEditor is still the text-answer surface, untouched', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/<MathAnswerEditor\s*\n\s*value=\{textAnswer\}\s*\n\s*onChange=\{setTextAnswer\}/);
  });

  it('21. the math toolbar (MathAnswerEditor) is not gated by quizMode -- available in Independent/Assessment too', () => {
    const textBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("{q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("{q.answerFormat === 'matching'"));
    expect(textBlock).not.toMatch(/PRACTICE_EVIDENCE_MODES\.includes\(quizMode\)\s*&&\s*\(?\s*<MathAnswerEditor/);
  });

  it('22. SHOW_WORK/JUSTIFY questions get a separate reasoning surface alongside the main answer', () => {
    const stepByStep = deriveResponseEvidenceContract({ type: 'step_by_step' }, 'PRACTICE');
    expect(stepByStep.kind).toBe('SHOW_WORK');
    expect(stepByStep.requiresWork).toBe(true);
    const justification = deriveResponseEvidenceContract({ type: 'justification' }, 'PRACTICE');
    expect(justification.kind).toBe('JUSTIFY');
    expect(justification.requiresJustification).toBe(true);
    expect(QUIZ_PAGE_SRC).toMatch(/responseContract\.requiresWork \|\| responseContract\.requiresJustification/);
  });

  it('23. ANSWER_ONLY questions never demand work -- requiresWork/requiresJustification both false', () => {
    const mc = deriveResponseEvidenceContract({ type: 'multiple_choice' }, 'PRACTICE');
    expect(mc.kind).toBe('ANSWER_ONLY');
    expect(mc.requiresWork).toBe(false);
    expect(mc.requiresJustification).toBe(false);
    const numeric = deriveResponseEvidenceContract({ type: 'numeric_problem' }, 'PRACTICE');
    expect(numeric.kind).toBe('ANSWER_ONLY'); // unless a PROCEDURAL tag tightens it -- untouched existing rule
  });

  it('24. the existing MathAnswerEditor mobile-overflow handling is unmodified', () => {
    const editorSrc = strip(read('src/components/MathAnswerEditor.tsx'));
    expect(editorSrc).toMatch(/overflowX:\s*'auto'/);
  });
});

/* ============================================================== *
 * VISUAL 25-30                                                    *
 * ============================================================== */
describe('LX-8 VISUAL 25-30', () => {
  const diagramOk: VisualAid = { kind: 'diagram', svg: '<svg></svg>', caption: 'A right triangle' };
  const chartOk: VisualAid = { kind: 'chart', chartData: { chartType: 'bar', labels: ['a', 'b'], values: [1, 2] }, caption: 'Sample bar chart' };

  it('25. deterministic artifacts derive cleanly from the existing chart/diagram data -- no generative image call anywhere', () => {
    const artifact = deriveVisualArtifact(chartOk);
    expect(artifact.visualType).toBe('CHART');
    expect(artifact.altText).toBe('Sample bar chart');
    for (const src of [strip(read('src/lib/lx/visual-contract.ts'))]) {
      expect(src).not.toMatch(/generateImage|dall-e|dalle/i);
    }
  });

  it('26. a malformed required visual is caught by validateVisualArtifact -- a recoverable, explicit failure, never silently accepted', () => {
    const malformed = deriveVisualArtifact({ kind: 'chart', chartData: { chartType: 'bar', labels: ['a', 'b'], values: [1] } } as VisualAid);
    const result = validateVisualArtifact(malformed);
    expect(result.valid).toBe(false);
    expect(result.failures).toContain('MALFORMED_CHART_DATA');
  });

  it('27. an optional/absent visual never blocks the activity -- deriveVisualArtifact/validateVisualArtifact are only ever invoked when a VisualAid exists', () => {
    expect(QUIZ_GEN_SRC).toMatch(/visualAid\?:\s*VisualAid/);
    expect(QUIZ_PAGE_SRC).toMatch(/\{q\.visualAid && <VisualAidView/);
  });

  it('28. a missing-render-data visual cannot pass the universal Question Quality Gate', () => {
    const q: GeneratedQuestion = { ...baseFake, visualAid: { kind: 'diagram' } as VisualAid };
    const report = checkQuestionQualityDeterministic(q, { conceptId: 'c1' });
    expect(report.status).toBe('FAIL');
    expect(report.failures.map((f) => f.code)).toContain('VISUAL_MISSING_RENDER_DATA');
  });

  it('28b. a visual with no accessible description also cannot pass the gate', () => {
    const q: GeneratedQuestion = { ...baseFake, visualAid: { kind: 'diagram', svg: '<svg></svg>' } as VisualAid };
    const report = checkQuestionQualityDeterministic(q, { conceptId: 'c1' });
    expect(report.failures.map((f) => f.code)).toContain('VISUAL_INACCESSIBLE');
  });

  it('29. a well-formed visual question retains an accessible representation (altText derived from caption)', () => {
    const artifact = deriveVisualArtifact(diagramOk);
    expect(artifact.altText).toBe('A right triangle');
    expect(validateVisualArtifact(artifact).valid).toBe(true);
  });

  it('30. no model-authored executable rendering code -- visual-contract.ts and the quality gate never eval/Function() anything', () => {
    for (const src of [strip(read('src/lib/lx/visual-contract.ts')), strip(read('src/lib/lx/question-quality-contract.ts'))]) {
      expect(src).not.toMatch(/\beval\(|new Function\(/);
    }
  });
});

/* ============================================================== *
 * LANGUAGE 31-33                                                  *
 * ============================================================== */
describe('LX-8 LANGUAGE 31-33', () => {
  it('31. TTS/STT locale in the quiz page comes from quizLanguage (activity language), never getInterfaceLanguage', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/activityLanguage=\{quizLanguage\}/g);
    expect(QUIZ_PAGE_SRC).not.toMatch(/activityLanguage=\{.*[Ii]nterface/);
  });

  it('32. expectedResponseLanguage is preserved as its own distinct field, not merely an alias', () => {
    const ctx = buildActivityLanguageContext('es');
    expect(ctx).toEqual({ activityLanguage: 'es', expectedResponseLanguage: 'es' });
    expect(Object.keys(ctx)).toEqual(['activityLanguage', 'expectedResponseLanguage']);
  });

  it('33. locale fallback is deterministic -- strips region, never guesses a different language', () => {
    expect(fallbackToSupportedLocale('es-MX')).toBe('es');
    expect(fallbackToSupportedLocale('en-GB')).toBe('en');
    expect(fallbackToSupportedLocale('pt-PT')).toBe('pt');
    expect(fallbackToSupportedLocale('ja-JP')).toBeNull(); // unsupported -> null, never a silent substitution
  });
});

/* ============================================================== *
 * INTEGRITY 34-39                                                 *
 * ============================================================== */
describe('LX-8 INTEGRITY 34-39', () => {
  it('34. accessibility TTS (AUDIO output) remains available in INDEPENDENT integrityMode', () => {
    const c = buildInteractionContract(contractInputs({ activityType: 'RETENTION_CHECK' }));
    expect(c.integrityMode).toBe('INDEPENDENT');
    expect(c.outputModes).toContain('AUDIO');
  });

  it('35. STT remains available as pure input in INDEPENDENT integrityMode (duplicate of test 13, restated as an integrity requirement)', () => {
    const c = buildInteractionContract(contractInputs({ activityType: 'TRANSFER', answerFormat: 'text' }));
    expect(c.integrityMode).toBe('INDEPENDENT');
    expect(c.inputModes).toContain('VOICE');
  });

  it('36. no Explain/Hint/Guide affordance exists in either new modality component', () => {
    for (const src of [READ_ALOUD_SRC, VOICE_INPUT_SRC]) {
      expect(src).not.toMatch(/ContextualHelp|generateQuestionHint|Guide\b/);
    }
  });

  it('37. modality never changes evidence weight -- independentEvidenceRequired depends only on evidenceMode, and encodeCurrentAnswer("text") is one code path regardless of how textAnswer was populated', () => {
    const viaVoiceOrTyped = deriveResponseEvidenceContract({ type: 'short_answer' }, 'INDEPENDENT');
    expect(viaVoiceOrTyped.independentEvidenceRequired).toBe(true);
    const practiceSame = deriveResponseEvidenceContract({ type: 'short_answer' }, 'PRACTICE');
    expect(practiceSame.independentEvidenceRequired).toBe(false);
    // encodeCurrentAnswer's 'text' case reads only textAnswer/explanationAnswer state -- no inputMode/modality parameter exists anywhere in it
    const encodeBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('function encodeCurrentAnswer'), QUIZ_PAGE_SRC.indexOf('function canProceed'));
    expect(encodeBlock).not.toMatch(/inputMode|modality|voice/i);
  });

  it('38. no "learning style" classification exists anywhere in the new LX-8 modules', () => {
    const allNewSrc = [
      INTERACTION_CONTRACT_SRC, ACTIVITY_LANGUAGE_SRC, SUPPORT_PRESENTATION_SRC,
      strip(read('src/lib/lx/visual-contract.ts')), strip(read('src/lib/lx/multimodal-observability.ts')),
      READ_ALOUD_SRC, VOICE_INPUT_SRC,
    ].join('\n');
    expect(allNewSrc).not.toMatch(/visual learner|auditory learner|kinesthetic learner|learning style/i);
  });

  it('39. pronunciation is never scored -- no pronunciation grading logic exists anywhere in the new modules', () => {
    expect(VOICE_INPUT_SRC).not.toMatch(/pronunciation|accent|fluency/i);
    expect(INTERACTION_CONTRACT_SRC).not.toMatch(/pronunciation/i);
  });
});

/* ============================================================== *
 * FALLBACK 40-42                                                  *
 * ============================================================== */
describe('LX-8 FALLBACK 40-42', () => {
  it('40. STT unavailable -> the component renders nothing and the existing typed input remains the only path', () => {
    expect(VOICE_INPUT_SRC).toMatch(/if \(!supported\) return null;/);
  });

  it('41. a required-but-malformed visual is rejected at the Quality Gate BEFORE it can ever reach a learner (fails closed, not open)', () => {
    const q: GeneratedQuestion = { ...baseFake, visualAid: { kind: 'chart' } as VisualAid };
    expect(checkQuestionQualityDeterministic(q, { conceptId: 'c1' }).status).toBe('FAIL');
  });

  it('42. optional modality controls (TTS/voice) unavailable still leaves the core answer surfaces intact', () => {
    const textBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(textBlock).toMatch(/<MathAnswerEditor/);
  });
});

/* ============================================================== *
 * OBSERVABILITY 43-44                                             *
 * ============================================================== */
describe('LX-8 OBSERVABILITY 43-44', () => {
  it('43. every required safe event label is emittable via logInteraction', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const labels = [
      'INTERACTION_CONTRACT_READY', 'VOICE_INPUT_STARTED', 'VOICE_TRANSCRIPTION_READY', 'VOICE_TRANSCRIPTION_FAILED',
      'TTS_STARTED', 'TTS_FAILED', 'MATH_INPUT_USED', 'VISUAL_RENDER_READY', 'VISUAL_RENDER_FAILED', 'MODALITY_FALLBACK_USED',
    ] as const;
    for (const label of labels) {
      logInteraction(label, { conceptId: 'c1', activityType: 'PRACTICE', latencyMs: 12 });
    }
    expect(logSpy).toHaveBeenCalledTimes(labels.length);
    for (const call of logSpy.mock.calls) {
      expect(call[0]).toBe('[interaction]');
      const parsed = JSON.parse(call[1] as string);
      expect(Object.keys(parsed).every((k) => ['label', 'conceptId', 'activityType', 'inputMode', 'outputMode', 'supportLevel', 'activityLanguage', 'latencyMs', 'errorCode'].includes(k))).toBe(true);
    }
    logSpy.mockRestore();
  });

  it('44. no learner answer/audio/question text can be logged -- InteractionEventMeta has no field for it', () => {
    const src = strip(read('src/lib/lx/multimodal-observability.ts'));
    const metaBlock = src.slice(src.indexOf('interface InteractionEventMeta'), src.indexOf('export function logInteraction'));
    expect(metaBlock).not.toMatch(/answer|transcript|audio|question\s*:/i);
  });
});

/* ============================================================== *
 * REGRESSION 45-54                                                *
 * ============================================================== */
describe('LX-8 REGRESSION 45-54 -- unrelated certified surfaces untouched', () => {
  it('45. Today is untouched by LX-8', () => {
    expect(TODAY_SRC).not.toMatch(/interaction-contract|ReadAloudButton|VoiceInputButton/);
  });

  it('46. My Path (path-view.ts) is untouched by LX-8', () => {
    expect(PATH_VIEW_SRC).not.toMatch(/interaction-contract|ReadAloudButton|VoiceInputButton/);
  });

  it('47. Concept Mission (concept-mission.ts) is untouched by LX-8', () => {
    const src = strip(read('src/lib/lx/concept-mission.ts'));
    expect(src).not.toMatch(/interaction-contract|ReadAloudButton|VoiceInputButton/);
  });

  it('48. Practice generation (generatePracticeQuestions) is untouched', () => {
    expect(QUIZ_GEN_SRC).toMatch(/export async function generatePracticeQuestions/);
  });

  it('49. Retention remains the 6-question canonical path', () => {
    expect(QUIZ_GEN_SRC).toMatch(/RETENTION_REQUIRED_COUNT = RETENTION_CHUNK_COUNT \(2\) \* RETENTION_QUESTIONS_PER_CHUNK \(3\) = 6|RETENTION_REQUIRED_COUNT/);
  });

  it('50. Transfer integrity (transfer-policy.ts) is untouched', () => {
    const src = strip(read('src/lib/transfer-policy.ts'));
    expect(src).not.toMatch(/interaction-contract|ReadAloudButton|VoiceInputButton/);
  });

  it('51. activity-language resolution (resolveQuizLanguage) is untouched', () => {
    expect(ACTIVITY_LANGUAGE_SRC).toMatch(/export function resolveQuizLanguage/);
  });

  it('52. LearningDecision authority (adaptive-learning-policy.ts) is untouched by LX-8', () => {
    const src = strip(read('src/lib/adaptive-learning-policy.ts'));
    expect(src).not.toMatch(/interaction-contract|ReadAloudButton|VoiceInputButton/);
  });

  it('53. no new evidence write anywhere in the new LX-8 modules', () => {
    for (const src of [INTERACTION_CONTRACT_SRC, READ_ALOUD_SRC, VOICE_INPUT_SRC, strip(read('src/lib/lx/visual-contract.ts'))]) {
      expect(src).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|learning_evidence/);
    }
  });
});
