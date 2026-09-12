/**
 * LX-8 R30 -- safe, learner-content-free observability for the
 * multimodal interaction layer. Mirrors the established `[today]` /
 * `[my-path]` pattern exactly: one JSON line per event, metadata only.
 *
 * Never logged (R29/R30): raw audio, full transcript, learner answer,
 * question text. `logInteraction`'s type signature enforces this --
 * `meta` only accepts the safe fields below, so a caller cannot
 * accidentally pass transcript/answer content through it.
 */

export type InteractionEventLabel =
  | 'INTERACTION_CONTRACT_READY'
  | 'VOICE_INPUT_STARTED'
  | 'VOICE_TRANSCRIPTION_READY'
  | 'VOICE_TRANSCRIPTION_FAILED'
  | 'VOICE_TRANSCRIPT_ACCEPTED'
  | 'TTS_STARTED'
  | 'TTS_FAILED'
  | 'MATH_INPUT_USED'
  | 'VISUAL_RENDER_READY'
  | 'VISUAL_RENDER_FAILED'
  | 'MODALITY_FALLBACK_USED';

export interface InteractionEventMeta {
  conceptId?: string;
  activityType?: string;
  /** Comma-joined InputMode[]/OutputMode[] -- a plain string, never the learner's own content. */
  inputModes?: string;
  outputModes?: string;
  supportLevel?: string;
  /** The content/activity language (TTS follows this). */
  activityLanguage?: string;
  /** LX-8R1 R3: what the learner's answer is expected to be IN (STT follows this) -- kept distinct from activityLanguage even when numerically equal today. */
  expectedResponseLanguage?: string;
  /** Verbatim EvidenceMode -- provenance only, never re-derived from this log. */
  integrityMode?: string;
  latencyMs?: number;
  errorCode?: string;
}

export function logInteraction(label: InteractionEventLabel, meta: InteractionEventMeta = {}): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[interaction]', JSON.stringify({ label, ...meta }));
  } catch { /* logging must never break the activity */ }
}
