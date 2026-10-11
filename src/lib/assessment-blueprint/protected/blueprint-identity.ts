/**
 * B2-A -- blueprint purpose and identity (pure).
 *
 * Three different things, never conflated:
 *   blueprint PURPOSE     what a blueprint variant is for: FULL | REDUCED | DIAGNOSTIC   (this file)
 *   form FIDELITY         what an assembled form verifiably is: FULL | REDUCED | UNKNOWN (B1, `form-fidelity`)
 *   stored ATTEMPT TYPE   what an attempt is recorded as: FULL_MOCK | REDUCED_MOCK | ... (B1, `deriveInstanceAttemptType`)
 *
 * One exam version has SEVERAL blueprint variants (Full, Reduced, Diagnostic) and may have several forms of
 * one purpose (Full form 1, Full form 2) without a new exam version. A purpose is part of the identity; it
 * is never read from a display name, and fidelity alone never identifies a blueprint.
 *
 * Nothing here is persisted: B2-A defines the contract. A purpose that contradicts the verified fidelity
 * is a violation, never a silent downgrade.
 */
import type { FormFidelity, InstanceAttemptDecision, InstanceAttemptType } from '@/lib/exam-core/form-fidelity';

export const BLUEPRINT_PURPOSES = ['FULL', 'REDUCED', 'DIAGNOSTIC'] as const;
export type BlueprintPurpose = (typeof BLUEPRINT_PURPOSES)[number];

export const BLUEPRINT_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type BlueprintStatus = (typeof BLUEPRINT_STATUSES)[number];

export interface BlueprintIdentity {
  examVersionId: string;
  purpose: BlueprintPurpose;
  /** Form number within the purpose, from 1 (Full form 1, Full form 2 ...). */
  form: number;
  /** Revision of this variant, from 1. A changed requirement is a new revision, never an edit in place. */
  revision: number;
  status: BlueprintStatus;
}

/** Stable key of a variant: exam version + purpose + form + revision. Status is state, not identity. */
export const blueprintKey = (i: Pick<BlueprintIdentity, 'examVersionId' | 'purpose' | 'form' | 'revision'>): string => `${i.examVersionId}:${i.purpose}:F${i.form}:R${i.revision}`;

/** The variant slot a revision belongs to (exam version + purpose + form). */
export const blueprintSlotKey = (i: Pick<BlueprintIdentity, 'examVersionId' | 'purpose' | 'form'>): string => `${i.examVersionId}:${i.purpose}:F${i.form}`;

export type BlueprintSetViolation =
  | { code: 'INVALID_IDENTITY'; key: string; detail: string }
  | { code: 'DUPLICATE_IDENTITY'; key: string }
  | { code: 'SEVERAL_PUBLISHED_REVISIONS'; slot: string };

/** A set of variants is valid when identities are well-formed and unique, and each variant slot has at most one PUBLISHED revision. */
export function blueprintSetViolations(set: readonly BlueprintIdentity[]): BlueprintSetViolation[] {
  const out: BlueprintSetViolation[] = [];
  const seen = new Set<string>();
  const published = new Map<string, number>();
  for (const i of set) {
    const key = blueprintKey(i);
    if (!i.examVersionId) out.push({ code: 'INVALID_IDENTITY', key, detail: 'exam version missing' });
    if (!(BLUEPRINT_PURPOSES as readonly string[]).includes(i.purpose)) out.push({ code: 'INVALID_IDENTITY', key, detail: 'unknown purpose' });
    if (!Number.isInteger(i.form) || i.form < 1) out.push({ code: 'INVALID_IDENTITY', key, detail: 'form must be an integer from 1' });
    if (!Number.isInteger(i.revision) || i.revision < 1) out.push({ code: 'INVALID_IDENTITY', key, detail: 'revision must be an integer from 1' });
    if (seen.has(key)) out.push({ code: 'DUPLICATE_IDENTITY', key });
    seen.add(key);
    if (i.status === 'PUBLISHED') published.set(blueprintSlotKey(i), (published.get(blueprintSlotKey(i)) ?? 0) + 1);
  }
  for (const [slot, n] of [...published].sort()) if (n > 1) out.push({ code: 'SEVERAL_PUBLISHED_REVISIONS', slot });
  return out;
}

/** The PUBLISHED variants of an exam version, optionally of one purpose, in a stable order. */
export function publishedVariants(set: readonly BlueprintIdentity[], examVersionId: string, purpose?: BlueprintPurpose): BlueprintIdentity[] {
  return set
    .filter((i) => i.examVersionId === examVersionId && i.status === 'PUBLISHED' && (!purpose || i.purpose === purpose))
    .sort((a, b) => (blueprintKey(a) < blueprintKey(b) ? -1 : 1));
}

/** The stored attempt type a purpose may produce. A Diagnostic is not a mock and produces neither. */
export const ATTEMPT_TYPE_OF_PURPOSE: Record<BlueprintPurpose, Extract<InstanceAttemptType, 'FULL_MOCK' | 'REDUCED_MOCK'> | null> = { FULL: 'FULL_MOCK', REDUCED: 'REDUCED_MOCK', DIAGNOSTIC: null };

export type PurposeFidelityViolation =
  /** The form's fidelity has not been verified: a protected mock is not offered. */
  | 'FIDELITY_NOT_VERIFIED'
  | 'FULL_PURPOSE_REQUIRES_FULL_FIDELITY'
  | 'REDUCED_PURPOSE_REQUIRES_REDUCED_FIDELITY'
  /** B1 would store the attempt as a type the purpose does not allow (e.g. a Reduced blueprint run as FULL_MOCK). */
  | 'ATTEMPT_TYPE_CONTRADICTS_PURPOSE'
  /** B1 refuses to start the form (unknown fidelity, or a full structure outside the official difficulty band). */
  | 'ATTEMPT_NOT_STARTABLE'
  | 'DIAGNOSTIC_IS_NOT_A_MOCK';

/**
 * Purpose and fidelity may not contradict each other. B1 stays the authority on fidelity and on the stored
 * attempt type; this only refuses a combination that would misrepresent a form.
 */
export function purposeFidelityViolations(purpose: BlueprintPurpose, fidelity: FormFidelity | null, decision?: InstanceAttemptDecision | { startable: false; reason: string }): PurposeFidelityViolation[] {
  const out: PurposeFidelityViolation[] = [];
  if (purpose === 'DIAGNOSTIC') {
    if (decision && decision.startable && (decision.type === 'FULL_MOCK' || decision.type === 'REDUCED_MOCK')) out.push('DIAGNOSTIC_IS_NOT_A_MOCK');
    return out;
  }
  if (!fidelity || fidelity.fidelity === 'UNKNOWN') out.push('FIDELITY_NOT_VERIFIED');
  else if (purpose === 'FULL' && fidelity.fidelity !== 'FULL') out.push('FULL_PURPOSE_REQUIRES_FULL_FIDELITY');
  else if (purpose === 'REDUCED' && fidelity.fidelity !== 'REDUCED') out.push('REDUCED_PURPOSE_REQUIRES_REDUCED_FIDELITY');
  if (decision) {
    if (!decision.startable) out.push('ATTEMPT_NOT_STARTABLE');
    else if (decision.type !== ATTEMPT_TYPE_OF_PURPOSE[purpose]) out.push('ATTEMPT_TYPE_CONTRADICTS_PURPOSE');
  }
  return out;
}
