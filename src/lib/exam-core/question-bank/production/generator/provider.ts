/**
 * QB-R2C -- the generation PROVIDER boundary (pure, no IO).
 *
 * The harness never names a vendor. It renders a provider-neutral prompt, hashes it, and hands it to whatever
 * implements `GenerationProvider`. Two things follow:
 *   - a LIVE provider can be added later, outside this directory, by wrapping the repository's AI gateway in this
 *     interface. None exists here on purpose: nothing in the production directory may open a network connection.
 *   - a run can be REPLAYED. `RecordedResponseProvider` answers from an in-memory map of prompt hash -> recorded
 *     response, so the same inputs give the same batch byte for byte. An unknown hash is a named error: a
 *     recording is never matched "approximately" to a prompt it was not made for.
 * A replayed recording proves that the harness is repeatable. It proves nothing about a live provider.
 */
import { createHash } from 'crypto';

export const GENERATION_ERROR_CODES = [
  'UNIT_INVALID', 'UNKNOWN_CELL', 'CELL_NOT_BOUND', 'SLOT_OUT_OF_RANGE', 'POLICY_INVALID', 'POLICY_AUTHOR_IS_NOT_A_MODEL', 'POLICY_MODEL_IS_NOT_THE_PROVIDERS', 'POLICY_LANGUAGE_IS_NOT_THE_UNITS', 'PACK_NOT_GENERATION_READY', 'NO_TEMPLATE_FOR_UNIT',
  'RECORDED_RESPONSE_NOT_FOUND', 'PROVIDER_ANSWERED_ANOTHER_PROMPT', 'PROVIDER_RESPONSE_NOT_JSON', 'PROVIDER_RESPONSE_SCHEMA_INVALID', 'RESPONSE_SLOTS_DO_NOT_MATCH_UNIT', 'RESPONSE_STIMULUS_MISSING', 'RESPONSE_UNEXPECTED_STIMULUS',
  'RESPONSE_FORMAT_IS_NOT_THE_SLOTS', 'RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE', 'RESPONSE_KEY_IS_NOT_AN_OPTION', 'RESPONSE_NUMERIC_KEY_MISSING', 'RESPONSE_STRUCTURED_STIMULUS_INVALID', 'RESPONSE_STIMULUS_HAS_NO_CONTENT', 'RESPONSE_REPEATS_FIXED_INSTRUCTION',
  'BATCHES_NOT_OF_ONE_RUN',
  // EA-1: an adaptation specification given for a slot must be intact and must be for that slot
  'ADAPTATION_SPECIFICATION_INVALID', 'ADAPTATION_SPECIFICATION_NOT_FOR_THE_SLOT',
] as const;
export type GenerationErrorCode = (typeof GENERATION_ERROR_CODES)[number];

/** Every refusal of the harness has a name. Nothing is repaired silently. */
export class GenerationError extends Error {
  constructor(public readonly code: GenerationErrorCode, public readonly detail: string = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'GenerationError';
  }
}

/** JSON with object keys in sorted order at every depth: one value, one text. `undefined` members are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
/** sha256 (hex) of the canonical JSON. Hashing is computation, not IO. */
export const sha256OfCanonicalJson = (value: unknown): string => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

/** What a provider is asked. `prompt` is provider-neutral: a system text and a structured instruction. */
export interface RenderedPrompt<P = unknown> { prompt: P; promptHash: string }
/** What a provider hands back: its text, untouched, and the hash of the prompt it answered. */
export interface ProviderResponse { providerId: string; model: string; promptHash: string; rawText: string }
export interface GenerationProvider {
  /** Stable identity of the provider, e.g. `recorded:in-session-authoring`. Never branched on by the harness. */
  readonly id: string;
  readonly model: string;
  generate(prompt: RenderedPrompt): Promise<ProviderResponse>;
}

/** Answers from recordings held in memory, keyed by prompt hash. Deterministic; opens nothing. */
export class RecordedResponseProvider implements GenerationProvider {
  private readonly recordings: ReadonlyMap<string, string>;
  constructor(public readonly id: string, public readonly model: string, recordings: ReadonlyMap<string, string> | Readonly<Record<string, string>>) {
    this.recordings = recordings instanceof Map ? recordings : new Map(Object.entries(recordings));
  }
  async generate(prompt: RenderedPrompt): Promise<ProviderResponse> {
    const rawText = this.recordings.get(prompt.promptHash);
    if (rawText === undefined) throw new GenerationError('RECORDED_RESPONSE_NOT_FOUND', prompt.promptHash);
    return { providerId: this.id, model: this.model, promptHash: prompt.promptHash, rawText };
  }
}
