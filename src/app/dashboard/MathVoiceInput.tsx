'use client';

import { useState } from 'react';
import VoiceInputButton from './VoiceInputButton';
import MathText from '@/components/MathText';
import { parseMathSpeech, isMathSpeechSupported } from '@/lib/lx/math-speech-parser';
import { createMathResponse, type MathResponse } from '@/lib/lx/math-response-contract';
import { logInteraction } from '@/lib/lx/multimodal-observability';
import { getMessages, Locale } from '@/lib/i18n/messages';

/**
 * LX-8R2 R1/R7 -- the voice-to-math PIPELINE: mic -> transcript (owned
 * entirely by `VoiceInputButton`/SpeechRecognition, unchanged) ->
 * attempt a deterministic math parse (`parseMathSpeech`, no AI/LLM
 * call, see math-speech-parser.ts) -> show "StudyUS understood:" with
 * the parsed expression rendered as real math -> learner explicitly
 * accepts, re-records, or discards. Only explicit acceptance calls
 * `onAccept` and updates the answer's `MathResponse` state (R7) --
 * this component never writes into the math field on its own.
 *
 * This wraps, rather than duplicates, `VoiceInputButton`: that
 * component's own existing transcript-review step (unchanged) already
 * lets the learner correct what SpeechRecognition heard BEFORE this
 * component ever attempts a math parse -- two explicit review steps
 * (words, then math structure), never one blind conversion.
 *
 * R2/R7 -- when the parse fails (unrecognized word, incomplete
 * expression, ambiguous construction), this shows the raw transcript
 * plus a neutral message and lets the learner type/toolbar-build the
 * expression manually instead -- never a guessed math result.
 */
export interface MathVoiceInputProps {
  expectedResponseLanguage: Locale;
  onAccept: (response: MathResponse) => void;
  conceptId?: string;
  activityType?: string;
  micLabel: string;
  stopLabel: string;
  reviewTitle: string;
  useThisLabel: string;
  reRecordLabel: string;
  discardLabel: string;
  permissionDeniedLabel: string;
  transcriptionFailedLabel: string;
}

export default function MathVoiceInput(props: MathVoiceInputProps) {
  const [parsed, setParsed] = useState<{ transcript: string; latex: string } | null>(null);
  const [unparsed, setUnparsed] = useState<string | null>(null);
  const t = getMessages(props.expectedResponseLanguage);

  function handleTranscriptAccepted(transcript: string) {
    if (!isMathSpeechSupported(props.expectedResponseLanguage)) {
      setUnparsed(transcript);
      return;
    }
    logInteraction('MATH_VOICE_PARSE_STARTED', { conceptId: props.conceptId, activityType: props.activityType, language: props.expectedResponseLanguage });
    const result = parseMathSpeech(transcript, props.expectedResponseLanguage);
    if (result.ok) {
      setParsed({ transcript, latex: result.latex });
      setUnparsed(null);
      logInteraction('MATH_VOICE_PARSE_SUCCEEDED', { conceptId: props.conceptId, activityType: props.activityType, language: props.expectedResponseLanguage, parserResult: 'PARSED' });
    } else {
      setUnparsed(transcript);
      setParsed(null);
      logInteraction('MATH_VOICE_PARSE_FAILED', { conceptId: props.conceptId, activityType: props.activityType, language: props.expectedResponseLanguage, parserResult: result.reason });
    }
  }

  function acceptParsed() {
    if (!parsed) return;
    props.onAccept(createMathResponse(parsed.latex));
    logInteraction('MATH_RESPONSE_ACCEPTED', { conceptId: props.conceptId, activityType: props.activityType, language: props.expectedResponseLanguage });
    setParsed(null);
    setUnparsed(null);
  }

  function discardParsed() {
    setParsed(null);
    setUnparsed(null);
  }

  return (
    <div>
      <VoiceInputButton
        expectedResponseLanguage={props.expectedResponseLanguage}
        onAccept={handleTranscriptAccepted}
        micLabel={props.micLabel}
        stopLabel={props.stopLabel}
        reviewTitle={props.reviewTitle}
        useThisLabel={props.useThisLabel}
        reRecordLabel={props.reRecordLabel}
        discardLabel={props.discardLabel}
        permissionDeniedLabel={props.permissionDeniedLabel}
        transcriptionFailedLabel={props.transcriptionFailedLabel}
        conceptId={props.conceptId}
      />

      {parsed && (
        <div role="group" aria-label={t['mathExpression.voiceUnderstood']} style={{ marginTop: 8, padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 650, color: 'var(--text-secondary)' }}>{t['mathExpression.voiceUnderstood']}</p>
          <MathText text={`$${parsed.latex}$`} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={acceptParsed}>{t['mathExpression.voiceAcceptLabel']}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={discardParsed}>{t['mathExpression.voiceDiscardLabel']}</button>
          </div>
        </div>
      )}

      {unparsed !== null && (
        <div role="group" style={{ marginTop: 8, padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, color: 'var(--text-secondary)' }}>{t['mathExpression.voiceParseFailedMessage']}</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{t['mathExpression.voiceRawTranscriptLabel']} {unparsed}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={discardParsed}>{t['mathExpression.voiceDiscardLabel']}</button>
          </div>
        </div>
      )}
    </div>
  );
}
