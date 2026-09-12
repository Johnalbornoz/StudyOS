'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n/messages';
import { activityLanguageToBCP47 } from '@/lib/lx/activity-language';
import { logInteraction } from '@/lib/lx/multimodal-observability';

/**
 * LX-8 R8/R22 -- read-aloud is an ACCESSIBILITY capability, never
 * pedagogical help: it speaks exactly the text it is given, verbatim
 * -- it never fetches, generates, rephrases, or explains anything.
 * Always permitted in every integrityMode (R22/R36 -- accessibility is
 * not a hint).
 *
 * R31: no server-side TTS provider exists or is approved in this
 * codebase. This uses ONLY the browser-native `speechSynthesis` API --
 * no network call, no AI cost (R32 trivially holds: zero provider
 * calls). Its real limitation (browser/OS voice availability varies)
 * is documented, not hidden: if no voice matches the activity
 * language, this renders NOTHING rather than speaking in the wrong
 * language (R11 -- no silent language substitution).
 *
 * R9: `activityLanguage` must be the ACTIVITY's language (e.g. the
 * quiz page's own `quizLanguage` state), never the interface language
 * -- the caller is responsible for passing the right one.
 *
 * LX-8R1 R3 -- LANGUAGE AUTHORITY: TTS speaks the language of the
 * CONTENT being read (the question/instruction text itself), so it
 * follows `activityLanguage` -- deliberately NOT `expectedResponseLanguage`
 * (that field governs what the LEARNER's answer should be in, via
 * VoiceInputButton, a different question). The two are numerically
 * identical today; this component only ever reads `activityLanguage`,
 * so a future case where they diverge changes nothing here.
 */
export interface ReadAloudButtonProps {
  /** The exact canonical text to read -- never altered, summarized, or supplemented. */
  text: string;
  activityLanguage: Locale;
  label: string;
  stopLabel: string;
  conceptId?: string;
}

function pickVoice(bcp47: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const exact = voices.find((v) => v.lang.toLowerCase() === bcp47.toLowerCase());
  if (exact) return exact;
  const prefix = bcp47.split('-')[0].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? null;
}

export default function ReadAloudButton({ text, activityLanguage, label, stopLabel, conceptId }: ReadAloudButtonProps) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined');
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  function speak() {
    if (!text.trim()) return;
    const bcp47 = activityLanguageToBCP47(activityLanguage);
    const voice = pickVoice(bcp47);
    if (!voice) {
      // R11: never substitute a different language's voice silently.
      logInteraction('TTS_FAILED', { conceptId, activityLanguage, errorCode: 'NO_VOICE_FOR_LANGUAGE' });
      setSupported(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.onstart = () => {
      setSpeaking(true);
      logInteraction('TTS_STARTED', { conceptId, activityLanguage });
    };
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      // R27/R28: TTS failure never removes the readable text itself -- only this optional control degrades.
      logInteraction('TTS_FAILED', { conceptId, activityLanguage, errorCode: 'SYNTHESIS_ERROR' });
    };
    window.speechSynthesis.speak(utterance);
  }

  function stop() {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={speaking ? stop : speak}
      aria-label={speaking ? stopLabel : label}
      title={speaking ? stopLabel : label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
        borderRadius: 'var(--radius-full)', border: '1px solid var(--border-default)',
        background: speaking ? 'var(--brand-subtle)' : 'var(--bg-subtle)', cursor: 'pointer', flexShrink: 0,
      }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>{speaking ? '⏹' : '🔊'}</span>
    </button>
  );
}
