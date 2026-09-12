'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/messages';
import { activityLanguageToBCP47 } from '@/lib/lx/activity-language';
import { logInteraction } from '@/lib/lx/multimodal-observability';

/**
 * LX-8 R4-R7 -- voice is an INPUT METHOD, never assistance.
 *
 * Flow (R4): activate mic -> speech captured -> transcript shown ->
 * learner explicitly reviews/edits/accepts -> `onAccept(transcript)`
 * hands the exact same string `MathAnswerEditor`'s `textAnswer` state
 * already holds back to the caller. The transcript is NEVER
 * auto-submitted (R4/R10 of the required test matrix) -- accepting is
 * always a separate, explicit click, and the caller still owns actual
 * submission (the existing "Next"/"Submit" flow, unchanged).
 *
 * R6: no coaching, no corrections, no suggested wording, no answer
 * completion -- this component only ever shows back what
 * SpeechRecognition itself returned. Edits the learner makes in the
 * review textarea are the learner editing their own answer (R7), never
 * an AI-generated improvement -- there is no AI call anywhere in this
 * component.
 *
 * R29: no audio is ever persisted or sent anywhere -- SpeechRecognition
 * is entirely browser/OS-local; this component holds only the
 * resulting text, and only for as long as the review step lasts.
 * Observability (R30) logs event labels + safe metadata only, never
 * the transcript itself.
 *
 * R31: browser-native SpeechRecognition only -- no server-side STT
 * provider exists or is approved. Documented limitation: browser/OS
 * support and accuracy vary; when the API is absent this component
 * renders nothing and the existing typed input remains the only path
 * (R27).
 */
export interface VoiceInputButtonProps {
  activityLanguage: Locale;
  /** Called only when the learner explicitly accepts the (possibly edited) transcript. */
  onAccept: (transcript: string) => void;
  micLabel: string;
  stopLabel: string;
  reviewTitle: string;
  useThisLabel: string;
  reRecordLabel: string;
  discardLabel: string;
  permissionDeniedLabel: string;
  transcriptionFailedLabel: string;
  conceptId?: string;
}

type VoiceState = 'IDLE' | 'LISTENING' | 'REVIEW' | 'PERMISSION_DENIED' | 'FAILED';

/** Minimal shape this component needs from the vendor-prefixed Web Speech API -- avoids a hard TS lib dependency. */
interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => MinimalSpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export default function VoiceInputButton(props: VoiceInputButtonProps) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>('IDLE');
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
    return () => recognitionRef.current?.stop();
  }, []);

  function start() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = activityLanguageToBCP47(props.activityLanguage);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setState('LISTENING');
      logInteraction('VOICE_INPUT_STARTED', { conceptId: props.conceptId, activityLanguage: props.activityLanguage });
    };
    recognition.onresult = (event: any) => {
      const text = event?.results?.[0]?.[0]?.transcript ?? '';
      setTranscript(text);
      setState('REVIEW'); // R4/R7: never auto-submitted -- explicit review required.
      logInteraction('VOICE_TRANSCRIPTION_READY', { conceptId: props.conceptId, activityLanguage: props.activityLanguage });
    };
    recognition.onerror = (event: any) => {
      const code = event?.error ?? 'UNKNOWN';
      setState(code === 'not-allowed' || code === 'permission-denied' ? 'PERMISSION_DENIED' : 'FAILED');
      logInteraction('VOICE_TRANSCRIPTION_FAILED', { conceptId: props.conceptId, errorCode: String(code) });
    };
    recognition.onend = () => {
      setState((s) => (s === 'LISTENING' ? 'IDLE' : s));
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function accept() {
    logInteraction('VOICE_TRANSCRIPT_ACCEPTED', { conceptId: props.conceptId });
    props.onAccept(transcript);
    setState('IDLE');
    setTranscript('');
  }

  function discard() {
    setState('IDLE');
    setTranscript('');
  }

  if (!supported) return null; // R27: typed input (already rendered by the caller) remains the only path.

  if (state === 'REVIEW') {
    return (
      <div role="group" aria-label={props.reviewTitle} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 650, color: 'var(--text-secondary)' }}>{props.reviewTitle}</p>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={3}
          style={{
            width: '100%', fontFamily: 'inherit', fontSize: 14, padding: 'var(--space-3)',
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={accept} disabled={!transcript.trim()}>
            {props.useThisLabel}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={start}>
            {props.reRecordLabel}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={discard}>
            {props.discardLabel}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'PERMISSION_DENIED') {
    return <p role="alert" style={{ fontSize: 12, color: 'var(--error)', marginTop: 6 }}>{props.permissionDeniedLabel}</p>;
  }

  if (state === 'FAILED') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span role="alert" style={{ fontSize: 12, color: 'var(--error)' }}>{props.transcriptionFailedLabel}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={start}>{props.micLabel}</button>
      </div>
    );
  }

  const listening = state === 'LISTENING';
  return (
    <button
      type="button"
      onClick={listening ? stopListening : start}
      aria-label={listening ? props.stopLabel : props.micLabel}
      title={listening ? props.stopLabel : props.micLabel}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
        borderRadius: 'var(--radius-full)', border: '1px solid var(--border-default)',
        background: listening ? 'var(--warning-subtle)' : 'var(--bg-subtle)', cursor: 'pointer', flexShrink: 0,
      }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>{listening ? '⏹' : '🎙'}</span>
    </button>
  );
}
