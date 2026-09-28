/**
 * LEARNING_ACTIVITY_DELIVERY -- the canonical activity contract and its
 * fingerprints.
 *
 * - The ACTIVITY contract fingerprint says which questions are admissible
 *   for an activity: concept, activity type, language, academic context
 *   (curriculum / programme / year / IB group / HL-SL), difficulty band,
 *   item count / independence contract, and the generator + grader
 *   versions. A bank candidate or prepared activity built under another
 *   fingerprint is incompatible.
 * - The LEARNER-STATE fingerprint (prepared activities only) captures what
 *   a per-learner selection depended on: the evidence ledger position,
 *   critical misconceptions and help used. When it changes, a READY
 *   activity is invalidated and re-assembled -- TTL is never the only rule.
 *
 * Pure. No I/O.
 */
import { createHash } from 'crypto';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';

export type DeliveryActivityType = 'LEARN_CHECK' | 'PRACTICE' | 'PROVE' | 'RETAIN' | 'TRANSFER';
export type DeliveryStage = 'LEARN' | 'PRACTICE' | 'PROVE' | 'RETAIN' | 'TRANSFER';

export const DELIVERY_QUIZ_MODES: Record<string, DeliveryActivityType> = {
  canonical_learn_check: 'LEARN_CHECK',
  topic_practice: 'PRACTICE',
  canonical_prove: 'PROVE',
  canonical_retain: 'RETAIN',
  canonical_transfer: 'TRANSFER',
};

export const STAGE_FOR_ACTIVITY: Record<DeliveryActivityType, DeliveryStage> = {
  LEARN_CHECK: 'LEARN',
  PRACTICE: 'PRACTICE',
  PROVE: 'PROVE',
  RETAIN: 'RETAIN',
  TRANSFER: 'TRANSFER',
};

export const ACTIVITY_FOR_STAGE: Record<DeliveryStage, DeliveryActivityType> = {
  LEARN: 'LEARN_CHECK',
  PRACTICE: 'PRACTICE',
  PROVE: 'PROVE',
  RETAIN: 'RETAIN',
  TRANSFER: 'TRANSFER',
};

export const QUIZ_MODE_FOR_ACTIVITY: Record<DeliveryActivityType, string> = {
  LEARN_CHECK: 'canonical_learn_check',
  PRACTICE: 'topic_practice',
  PROVE: 'canonical_prove',
  RETAIN: 'canonical_retain',
  TRANSFER: 'canonical_transfer',
};

/** Generator / grader identities that make content incompatible when they change. */
export const GENERATOR_VERSION = `${PROMPT_REGISTRY['quiz.question_generation'].id}@${PROMPT_REGISTRY['quiz.question_generation'].version}`;
export const GRADER_VERSION = `${PROMPT_REGISTRY['quiz.free_text_grading'].id}@${PROMPT_REGISTRY['quiz.free_text_grading'].version}+PEDAGOGICAL_V1`;

export interface AcademicContext {
  curriculum: string | null;
  programme: string;
  year: string | null;
  subjectGroup: string | null;
  level: string | null;
}

export const NO_ACADEMIC_CONTEXT: AcademicContext = { curriculum: null, programme: 'none', year: null, subjectGroup: null, level: null };

const h = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);

export function academicContextFingerprint(ctx: AcademicContext): string {
  return h(['academic.v1', ctx.curriculum ?? null, ctx.programme, ctx.year ?? null, ctx.subjectGroup ?? null, ctx.level ?? null]);
}

export interface ActivityContract {
  conceptId: string;
  activityType: DeliveryActivityType;
  language: string;
  academic: AcademicContext;
  difficulty: { min: number; max: number; target: number };
  /** Exact number of questions administered. */
  itemCount: number;
  independence: boolean;
  policyVersion: string;
}

export function difficultyBand(d: { min: number; max: number }): string {
  return `${d.min}-${d.max}`;
}

export function activityContractFingerprint(c: ActivityContract): string {
  return h([
    'activity.v1',
    c.conceptId,
    c.activityType,
    c.language,
    academicContextFingerprint(c.academic),
    difficultyBand(c.difficulty),
    c.difficulty.target,
    c.itemCount,
    c.independence,
    c.policyVersion,
    GENERATOR_VERSION,
    GRADER_VERSION,
  ]);
}

export interface LearnerStateSnapshot {
  evidenceCount: number;
  lastEvidenceId: string | null;
  criticalMisconceptions: number;
  hintsUsed: number;
}

export function learnerStateFingerprint(s: LearnerStateSnapshot): string {
  return h(['learner.v1', s.evidenceCount, s.lastEvidenceId, s.criticalMisconceptions, s.hintsUsed]);
}

export type CompatibilityVerdict = { compatible: true } | { compatible: false; reason: 'CONTRACT_CHANGED' | 'LEARNER_STATE_CHANGED' | 'EXPIRED' | 'LEGACY_PREPARATION' };

/** Whether a prepared activity can still be delivered for the current contract + learner state. */
export function preparedActivityCompatibility(
  prepared: { contractFingerprint: string | null; learnerStateFingerprint: string | null; expiresAt: Date | null },
  current: { contractFingerprint: string; learnerStateFingerprint: string; now: Date },
): CompatibilityVerdict {
  if (!prepared.contractFingerprint || !prepared.learnerStateFingerprint) return { compatible: false, reason: 'LEGACY_PREPARATION' };
  if (prepared.expiresAt && prepared.expiresAt.getTime() <= current.now.getTime()) return { compatible: false, reason: 'EXPIRED' };
  if (prepared.contractFingerprint !== current.contractFingerprint) return { compatible: false, reason: 'CONTRACT_CHANGED' };
  if (prepared.learnerStateFingerprint !== current.learnerStateFingerprint) return { compatible: false, reason: 'LEARNER_STATE_CHANGED' };
  return { compatible: true };
}

/** Replenishment policy: how many READY activities to keep for the canonical next action. */
export function inventoryTarget(activityType: DeliveryActivityType): number {
  return activityType === 'PRACTICE' ? 2 : 1;
}

/**
 * Bank depth policy, in COMPLETE SETS the bank can still assemble beyond the
 * READY inventory (same filters, novelty exclusions and diversity as a real
 * launch) -- never a raw candidate count: leftovers of earlier assemblies are
 * often near-duplicates of each other and would not form a valid set.
 */
export const SPARE_ASSEMBLABLE_SETS = 2;

/** Splits a candidate need into generator-sized chunks (one BANK_REPLENISH job each, run in parallel). */
export function bankChunks(needed: number, batchCap: number): number[] {
  const out: number[] = [];
  for (let left = Math.max(0, Math.floor(needed)); left > 0; left -= batchCap) out.push(Math.min(batchCap, left));
  return out;
}
