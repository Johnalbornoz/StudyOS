import type { ActivityType, EvidenceMode } from '@/lib/activity-taxonomy';
import type { AnswerFormat } from '@/services/quiz-generation.service';
import type { SupportLevel } from '@/lib/adaptive-teaching-policy';
import type { Locale } from '@/lib/i18n/messages';
import type { ActivityLanguageContext } from './activity-language';
import { presentationForSupportLevel, type PresentationRichness } from './support-presentation';

/**
 * LX-8 R2 / LX-8R1 R1 -- MULTIMODAL INTERACTION CONTRACT.
 *
 * A PRESENTATION/INPUT capability declaration for one active learning
 * activity. It composes already-canonical facts into one object the UI
 * reads -- it never computes any of those facts itself, and it decides
 * NONE of: correctness, mastery, progression, next activity, support
 * level, evidence weight.
 *
 * LX-8R1 R1: this is the ONE modality-eligibility authority. There must
 * never be a second place (e.g. a page component) independently
 * re-deriving "voice allowed because answerFormat === text" or "audio
 * allowed because the browser supports it" -- every caller, server or
 * client, calls `buildInteractionContract` and reads its
 * `inputModes`/`outputModes`. Browser capability flags
 * (`ModalityCapabilities`) are an INPUT to this projection, never an
 * independent policy a caller applies on its own.
 *
 * `integrityMode` is taken as an INPUT (an already-resolved
 * `EvidenceMode`), not derived here from `ActivityType` -- this keeps
 * the module usable from both a server caller (which can resolve it via
 * `evidenceModeForActivity(activityType)`, activity-taxonomy.ts) and a
 * client caller that only has its own coarse, presentation-only mirror
 * of the same fixed taxonomy (exactly as `quiz/page.tsx` already
 * maintained before this repair, and still does -- one pure function,
 * `coarseEvidenceModeForQuizMode`, feeding this contract instead of a
 * second copy of the ternary). `activityType` is accepted separately,
 * optionally, purely as R40 provenance -- it is never read to derive
 * `integrityMode` or any mode list below.
 *
 * (See `ResponseEvidenceContract`, response-evidence-contract.ts, for
 * the SEPARATE, unmerged contract that already governs WHAT a question
 * demands -- InteractionContract only ever describes HOW the learner
 * may interact; R37 keeps these two composable, not merged, exactly as
 * response-evidence-contract.ts's own doc comment already anticipates.)
 */

export type InputMode = 'TEXT' | 'MATH' | 'VOICE';
export type OutputMode = 'TEXT' | 'VISUAL' | 'AUDIO';

export interface ModalityCapabilities {
  /** Measured by the caller at render time (`'webkitSpeechRecognition' in window`, etc.) -- this module never assumes browser support. */
  speechRecognitionSupported: boolean;
  speechSynthesisSupported: boolean;
}

/**
 * R25/R26: a learner's own remembered UX choice, nothing more. Read
 * back verbatim into `preferredInputMode`/`preferredOutputMode` below
 * (and ignored if it names a mode the activity doesn't actually
 * offer) -- NEVER fed into SupportLevel/TeachingIntent computation,
 * never used to imply a "visual learner"/"auditory learner" style.
 */
export interface AccessibilityPreferences {
  preferredInputMode?: InputMode | null;
  preferredOutputMode?: OutputMode | null;
}

export interface InteractionContractInputs {
  /** Already-resolved EvidenceMode -- server: evidenceModeForActivity(activityType); client: its own existing coarse mirror. Never derived inside this function. */
  integrityMode: EvidenceMode;
  answerFormat: AnswerFormat;
  activityLanguage: ActivityLanguageContext;
  /**
   * Optional. Fetching a full TeachingIntent costs a `getLearningDecisions`
   * call -- the existing quiz session deliberately does not pay that
   * cost today (see LearningSupportStatus.tsx's own doc comment).
   * Pass it only when the caller already has one (e.g. the
   * remediation shell); omit it everywhere else. `presentation`/
   * `supportLevel` degrade to `null` rather than triggering a new
   * fetch.
   */
  supportLevel?: SupportLevel | null;
  capabilities: ModalityCapabilities;
  accessibility?: AccessibilityPreferences;
  /** R40 provenance only -- never read to derive integrityMode or any mode list. */
  activityType?: ActivityType;
}

export interface InteractionContract {
  inputModes: InputMode[];
  outputModes: OutputMode[];
  preferredInputMode: InputMode | null;
  preferredOutputMode: OutputMode | null;
  activityLanguage: Locale;
  expectedResponseLanguage: Locale;
  /** Verbatim, caller-resolved EvidenceMode -- the sole authority for how much assistance is permitted (canUseAI remains server-side enforcement). */
  integrityMode: EvidenceMode;
  supportLevel: SupportLevel | null;
  presentation: PresentationRichness | null;
  /** R40: provenance for future Decision Trace/admin QA -- never shown to the learner. */
  provenance: {
    activityType: ActivityType | null;
    answerFormat: AnswerFormat;
    supportLevelKnown: boolean;
  };
}

export function buildInteractionContract(inputs: InteractionContractInputs): InteractionContract {
  const isFreeText = inputs.answerFormat === 'text';

  // R3: a fixed-choice answer surface (single/multi choice, matching,
  // ordering, classification) has no free-response input mode at all --
  // TEXT/MATH/VOICE only ever apply to the free-text surface.
  const inputModes: InputMode[] = [];
  if (isFreeText) {
    inputModes.push('TEXT', 'MATH');
    // R3/R4/R6: voice is a pure INPUT method. It is offered for any
    // free-text answer surface regardless of integrityMode -- whether
    // AI assistance (hints) is available is a completely separate,
    // server-enforced axis (canUseAI), never coupled to whether
    // voice-as-transcription is available.
    if (inputs.capabilities.speechRecognitionSupported) inputModes.push('VOICE');
  }

  const outputModes: OutputMode[] = ['TEXT', 'VISUAL'];
  // R8/R22: read-aloud is an accessibility capability, not pedagogical
  // help -- offered in every integrityMode, gated only on browser
  // support. Whether THIS question actually has visible content to
  // read, or a visual to show, stays a per-question check the caller
  // already makes (q.visualAid, the question text itself).
  if (inputs.capabilities.speechSynthesisSupported) outputModes.push('AUDIO');

  const requestedInput = inputs.accessibility?.preferredInputMode ?? null;
  const requestedOutput = inputs.accessibility?.preferredOutputMode ?? null;

  return {
    inputModes,
    outputModes,
    preferredInputMode: requestedInput && inputModes.includes(requestedInput) ? requestedInput : null,
    preferredOutputMode: requestedOutput && outputModes.includes(requestedOutput) ? requestedOutput : null,
    activityLanguage: inputs.activityLanguage.activityLanguage,
    expectedResponseLanguage: inputs.activityLanguage.expectedResponseLanguage,
    integrityMode: inputs.integrityMode,
    supportLevel: inputs.supportLevel ?? null,
    presentation: inputs.supportLevel ? presentationForSupportLevel(inputs.supportLevel) : null,
    provenance: {
      activityType: inputs.activityType ?? null,
      answerFormat: inputs.answerFormat,
      supportLevelKnown: inputs.supportLevel != null,
    },
  };
}
