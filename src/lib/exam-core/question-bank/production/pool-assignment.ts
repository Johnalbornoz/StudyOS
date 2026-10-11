/**
 * QB-R2A -- pool assignment, decided after review, rights and originality (pure, no IO).
 *
 * A pool is what reviewed content is reserved for. Membership is on the item, or on the stimulus for a
 * stimulus-bound item (the group is in one pool as a whole). Pilot policy ZERO_INTENTIONAL_OVERLAP: one
 * active pool per item or stimulus. This module says whether an assignment MAY be made; it makes none.
 */
import { PRODUCTION_POOLS, PRODUCTION_POOL_POLICY, type ProductionPool } from './requirement-cell';

export interface PoolAssignmentFacts {
  intendedPool: string;
  humanReviewApproved: boolean;
  rightsEstablished: boolean;
  originalityAccepted: boolean;
  /** Active memberships the subject (the item, or its stimulus) already has. */
  activePools: readonly string[];
  /** The item is asked about a stimulus: the membership belongs to the stimulus. */
  stimulusBound: boolean;
  /** For a stimulus-bound item: the pool its stimulus is in, if any. */
  stimulusPool: string | null;
}

export type PoolAssignmentBlocker = 'UNKNOWN_POOL' | 'REVIEW_NOT_APPROVED' | 'RIGHTS_NOT_ESTABLISHED' | 'ORIGINALITY_NOT_ACCEPTED' | 'ALREADY_IN_ANOTHER_POOL' | 'STIMULUS_IN_ANOTHER_POOL';

export interface PoolAssignmentVerdict {
  assignable: boolean;
  blockers: PoolAssignmentBlocker[];
  /** Who receives the membership row when it is written. */
  subject: 'ITEM' | 'STIMULUS';
  pool: ProductionPool | null;
  /** NONE = the subject is already in that pool; nothing to write. */
  action: 'ASSIGN' | 'NONE' | 'BLOCKED';
  policy: { id: string; version: string; overlap: string };
}

export function evaluatePoolAssignment(f: PoolAssignmentFacts): PoolAssignmentVerdict {
  const blockers: PoolAssignmentBlocker[] = [];
  const known = (PRODUCTION_POOLS as readonly string[]).includes(f.intendedPool);
  if (!known) blockers.push('UNKNOWN_POOL');
  if (!f.humanReviewApproved) blockers.push('REVIEW_NOT_APPROVED');
  if (!f.rightsEstablished) blockers.push('RIGHTS_NOT_ESTABLISHED');
  if (!f.originalityAccepted) blockers.push('ORIGINALITY_NOT_ACCEPTED');
  const current = f.stimulusBound ? (f.stimulusPool ? [f.stimulusPool] : []) : [...f.activePools];
  // zero intentional overlap: content already reserved for another pool is not reserved twice
  if (current.some((p) => p !== f.intendedPool)) blockers.push(f.stimulusBound ? 'STIMULUS_IN_ANOTHER_POOL' : 'ALREADY_IN_ANOTHER_POOL');
  const policy = { id: PRODUCTION_POOL_POLICY.id, version: PRODUCTION_POOL_POLICY.version, overlap: PRODUCTION_POOL_POLICY.overlap };
  const subject = f.stimulusBound ? 'STIMULUS' : 'ITEM';
  if (blockers.length > 0) return { assignable: false, blockers, subject, pool: known ? (f.intendedPool as ProductionPool) : null, action: 'BLOCKED', policy };
  return { assignable: true, blockers: [], subject, pool: f.intendedPool as ProductionPool, action: current.includes(f.intendedPool) ? 'NONE' : 'ASSIGN', policy };
}
