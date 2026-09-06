/**
 * Phase 7 -- Step 7B1: Transfer task identity + prompt fingerprint.
 *
 * PURE. No DB, no AI, no React, no environment, no random inside the
 * fingerprint functions. `crypto` is used only for a deterministic
 * SHA-256 hash.
 *
 * This module owns:
 *   - deterministic prompt normalization,
 *   - the prompt fingerprint (a structural-surface identity hash),
 *   - the canonical Transfer task identity metadata shape,
 *   - task-id compatibility resolution (transferTaskId <-> activityId).
 *
 * It does NOT own novelty qualification, duplicate rejection, distance
 * validation, or task regeneration -- those are 7B2. The fingerprint
 * here is ONLY an input those later steps will consume.
 *
 * FINGERPRINT SEMANTICS (read before relying on it):
 *   A shared fingerprint proves ONLY that two prompts normalize to the
 *   same structural surface (same words, numbers replaced by a
 *   placeholder, punctuation/whitespace flattened). It does NOT prove
 *   the prompts are pedagogically equivalent, and it does NOT by
 *   itself certify NEAR / MID / FAR or any novelty dimension. It is a
 *   conservative surface hash, not a semantic-novelty proof, and it is
 *   language-specific (a translation of the same task is a different
 *   fingerprint).
 */
import { createHash } from 'crypto';

import type { TransferDistance } from '@/lib/transfer-policy';

export type TransferTaskId = string;

/**
 * Matches numeric literals we want to treat as interchangeable surface
 * detail: integers, decimals, thousands-grouped, signed, and a
 * trailing percent. Deliberately conservative -- it does not try to
 * catch spelled-out numbers, fractions, or units.
 */
const NUMERIC_LITERAL = /[-+]?\d[\d.,]*%?/g;

/**
 * Punctuation flattened to a single space. Includes the em / en /
 * horizontal-bar / figure dashes (— – ― ‒), which are unambiguously
 * prose punctuation. `<` and `>` are excluded so the `<number>`
 * placeholder survives; the ASCII hyphen-minus `-` and the slash `/`
 * are left intact so hyphenated words ("well-calibrated"), units
 * ("m/s") and arithmetic ("x - y") keep their token identity.
 */
const FLATTENED_PUNCTUATION = /[.,;:!?¿¡"'“”‘’`(){}\[\]…·•‒–—―]+/g;

/**
 * Deterministic structural normalization of a transfer prompt. Makes
 * obvious surface-only variants (case, spacing, trailing punctuation,
 * "solve with 10" vs "solve with 42") converge -- WITHOUT any
 * translation, AI, concept inference, or claim of semantic
 * equivalence.
 *
 * Steps: NFKC -> lowercase -> replace numbers with `<number>` ->
 * flatten punctuation to spaces -> collapse whitespace -> trim.
 * Empty / whitespace-only input normalizes to the empty string
 * (never throws).
 */
export function normalizeTransferPrompt(prompt: string): string {
  return prompt
    .normalize('NFKC')
    .toLowerCase()
    .replace(NUMERIC_LITERAL, '<number>')
    .replace(FLATTENED_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * SHA-256 of the normalized prompt, lowercase hex. No salt, no
 * learner-specific input, no randomness -- same normalized prompt
 * always yields the same fingerprint. An identity hash, not a
 * security credential. The raw prompt is never stored or returned by
 * this function.
 */
export function computeTransferPromptFingerprint(prompt: string): string {
  return createHash('sha256').update(normalizeTransferPrompt(prompt), 'utf8').digest('hex');
}

/**
 * Canonical Transfer task identity carried on the evidence row's
 * metadata. Minimal for 7B1 -- noveltyDimensions / transferModality /
 * targetConceptIds / contextDomain / taskFamilyId are deliberately
 * absent until generation produces trustworthy values for them (7B/7D).
 */
export interface TransferTaskIdentityMetadata {
  transferTaskId: TransferTaskId;
  sourceConceptId: string;
  transferDistance: TransferDistance;
  promptFingerprint: string;
  generatorVersion?: string | null;
  generatorPromptVersion?: string | null;
}

/**
 * Build the identity metadata for one submitted transfer attempt.
 * `promptFingerprint` is always computed here from the supplied prompt
 * -- callers must pass the real generated/submitted prompt, never a
 * client-supplied fingerprint.
 */
export function buildTransferTaskIdentityMetadata(input: {
  transferTaskId: TransferTaskId;
  sourceConceptId: string;
  transferDistance: TransferDistance;
  prompt: string;
  generatorVersion?: string | null;
  generatorPromptVersion?: string | null;
}): TransferTaskIdentityMetadata {
  const meta: TransferTaskIdentityMetadata = {
    transferTaskId: input.transferTaskId,
    sourceConceptId: input.sourceConceptId,
    transferDistance: input.transferDistance,
    promptFingerprint: computeTransferPromptFingerprint(input.prompt),
  };
  if (input.generatorVersion != null) meta.generatorVersion = input.generatorVersion;
  if (input.generatorPromptVersion != null) meta.generatorPromptVersion = input.generatorPromptVersion;
  return meta;
}

export type TransferTaskIdResolutionError = 'MISSING_TASK_ID' | 'CONFLICTING_TASK_IDS';

export type TransferTaskIdResolution =
  | { ok: true; taskId: TransferTaskId }
  | { ok: false; error: TransferTaskIdResolutionError };

/**
 * Resolve the one canonical task id from a submit request that may
 * carry `transferTaskId`, `activityId`, or both. During the
 * compatibility window `activityId === transferTaskId` for every
 * freshly generated task, so:
 *   - exactly one present  -> that value,
 *   - both present & equal  -> that value,
 *   - both present & different -> CONFLICTING_TASK_IDS (never silently
 *     pick one),
 *   - neither present -> MISSING_TASK_ID.
 */
export function resolveTransferTaskId(input: {
  transferTaskId?: string | null;
  activityId?: string | null;
}): TransferTaskIdResolution {
  const t = input.transferTaskId ?? undefined;
  const a = input.activityId ?? undefined;
  if (t && a) {
    return t === a ? { ok: true, taskId: t } : { ok: false, error: 'CONFLICTING_TASK_IDS' };
  }
  if (t) return { ok: true, taskId: t };
  if (a) return { ok: true, taskId: a };
  return { ok: false, error: 'MISSING_TASK_ID' };
}
