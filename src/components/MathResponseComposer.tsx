'use client';

import MathExpressionEditor from './MathExpressionEditor';
import MathVoiceInput from '@/app/dashboard/MathVoiceInput';
import { createMathResponse, toGraderString, unwrapMathFromStorage, wrapMathForStorage, type MathResponse } from '@/lib/lx/math-response-contract';
import { getMessages } from '@/lib/i18n/messages';
import type { ActivityLanguageContext } from '@/lib/lx/activity-language';

/**
 * LX-8R2-R1 -- THE canonical Math Response Composer. Every learner-
 * facing surface with a mathematical final answer (main quiz,
 * Retention resume, Assessment verification, and any future one) must
 * render THIS component -- never a bespoke re-assembly of
 * MathExpressionEditor + MathVoiceInput, and never a second math
 * editor.
 *
 * Ownership (R2): this component owns the structured editor, the
 * canonical MathResponse serialization (via the storage-string
 * wrap/unwrap in math-response-contract.ts), the professional toolbar
 * (inside MathExpressionEditor), the optional voice-to-math pipeline,
 * the parse/review/accept flow (inside MathVoiceInput), the
 * activity/expectedResponseLanguage split, and its own accessibility
 * copy (resolved internally via `getMessages`, so callers never wire
 * eight label props by hand).
 *
 * This component does NOT own and NEVER computes: mastery, EvidenceMode,
 * SupportLevel, grading, correctness, or what activity comes next. It
 * also does not decide whether THIS question should show a math
 * surface at all (`isMathAnswerContext`, math-response-contract.ts) or
 * whether voice is eligible (`voiceEnabled` -- the caller's own
 * `InteractionContract.inputModes.includes('VOICE')` decision, per the
 * established LX-8R1 R1 "one modality-eligibility authority" rule).
 * Passing those decisions in, rather than re-deriving them here, is
 * what keeps this the ONE composer usable from every surface without
 * duplicating eligibility logic in each one (R2/R9).
 *
 * `value`/`onChange` are a plain string -- the SAME canonical,
 * `$...$`-wrapped storage convention `textAnswer`/`resumeAnswer`/
 * `verificationAnswers[id]` already used with the legacy
 * `MathAnswerEditor`, so migrating any existing call site to this
 * composer is a drop-in prop-shape change, never a new state shape
 * threaded through the surrounding activity (R8: no route-specific
 * math serialization).
 */
export interface MathResponseComposerProps {
  /** The canonical stored string -- `$latex$` or `''`. Same shape as MathAnswerEditor's own `value`. */
  value: string;
  onChange: (next: string) => void;
  /** The SAME ActivityLanguageContext the caller already built (buildActivityLanguageContext) -- never re-derived here. UI copy/toolbar follow activityLanguage; voice/parser follow expectedResponseLanguage (LX-8R1 R3). */
  activityLanguageContext: ActivityLanguageContext;
  /** The caller's own InteractionContract.inputModes.includes('VOICE') decision -- this composer never re-derives modality eligibility. */
  voiceEnabled: boolean;
  studentId?: string | null;
  conceptId?: string;
  activityType?: string;
  placeholder?: string;
}

export default function MathResponseComposer({
  value,
  onChange,
  activityLanguageContext,
  voiceEnabled,
  studentId,
  conceptId,
  activityType,
  placeholder,
}: MathResponseComposerProps) {
  const t = getMessages(activityLanguageContext.activityLanguage);
  const mathResponse = createMathResponse(unwrapMathFromStorage(value));

  function handleEditorChange(next: MathResponse) {
    onChange(wrapMathForStorage(toGraderString(next)));
  }

  function handleVoiceAccept(response: MathResponse) {
    onChange(wrapMathForStorage(toGraderString(response)));
  }

  return (
    <div>
      <MathExpressionEditor
        value={mathResponse}
        onChange={handleEditorChange}
        locale={activityLanguageContext.activityLanguage}
        studentId={studentId}
        conceptId={conceptId}
        activityType={activityType}
        placeholder={placeholder}
      />
      {/* R4/R13: voice is a strictly additional, optional input path --
          the activity remains completable without a microphone
          regardless of this branch. R5: identical pipeline (STT ->
          deterministic parse -> review -> explicit acceptance) on
          every surface that renders this composer. */}
      {voiceEnabled && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <MathVoiceInput
            expectedResponseLanguage={activityLanguageContext.expectedResponseLanguage}
            onAccept={handleVoiceAccept}
            conceptId={conceptId}
            activityType={activityType}
            micLabel={t['multimodal.speakAnswer']}
            stopLabel={t['multimodal.stopRecording']}
            reviewTitle={t['multimodal.reviewTranscript']}
            useThisLabel={t['multimodal.useThisAnswer']}
            reRecordLabel={t['multimodal.recordAgain']}
            discardLabel={t['multimodal.discard']}
            permissionDeniedLabel={t['multimodal.micPermissionDenied']}
            transcriptionFailedLabel={t['multimodal.transcriptionFailed']}
          />
        </div>
      )}
    </div>
  );
}
