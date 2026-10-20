/**
 * B2-A -- logical content pools (pure).
 *
 * A pool is a content PROTECTION classification, not the in-memory list of candidates a solver run
 * receives. It says which use a reviewed item is reserved for. For the pilot every item belongs to
 * exactly one pool (ZERO_INTENTIONAL_OVERLAP); sharing between pools exists only when a policy names the
 * pair explicitly.
 *
 * B2 owns: selecting from the pool a blueprint is allowed to use, and refusing the others. It does not own
 * lifecycle, review, authorship or rights -- those decide whether an item is a candidate at all (B1
 * eligibility), before any pool rule is looked at.
 */
import type { BlueprintIdentity } from './blueprint-identity';

export const LOGICAL_POOLS = ['PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2'] as const;
export type LogicalPool = (typeof LOGICAL_POOLS)[number];

/** Pools whose content must reach a Student unseen. */
export const PROTECTED_POOLS: ReadonlySet<LogicalPool> = new Set(['DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']);

export interface PoolPolicy {
  id: string;
  version: string;
  overlap: 'ZERO_INTENTIONAL_OVERLAP' | 'EXPLICIT_SHARED';
  /** Pairs of pools an item may belong to together. Read only under EXPLICIT_SHARED. */
  shared: ReadonlyArray<readonly [LogicalPool, LogicalPool]>;
}

export const PILOT_POOL_POLICY: PoolPolicy = { id: 'b2-pilot-pools', version: '1', overlap: 'ZERO_INTENTIONAL_OVERLAP', shared: [] };

/** Pool membership of reviewed items, by `<store>:<question id>`. Authored by the Question Bank; read here. */
export type PoolAssignments = ReadonlyMap<string, readonly LogicalPool[]>;

const pairAllowed = (policy: PoolPolicy, a: LogicalPool, b: LogicalPool): boolean => policy.overlap === 'EXPLICIT_SHARED' && policy.shared.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

export type PoolAssignmentViolation = { key: string; code: 'NO_POOL' | 'UNKNOWN_POOL' | 'DUPLICATE_POOL' | 'OVERLAP_NOT_ALLOWED' };

/** Is one item's membership valid under the policy? Under the pilot policy that means exactly one known pool. */
export function assignmentViolations(key: string, pools: readonly LogicalPool[], policy: PoolPolicy = PILOT_POOL_POLICY): PoolAssignmentViolation[] {
  const out: PoolAssignmentViolation[] = [];
  if (pools.length === 0) return [{ key, code: 'NO_POOL' }];
  if (pools.some((p) => !(LOGICAL_POOLS as readonly string[]).includes(p))) out.push({ key, code: 'UNKNOWN_POOL' });
  if (new Set(pools).size !== pools.length) out.push({ key, code: 'DUPLICATE_POOL' });
  const distinct = [...new Set(pools)];
  for (let i = 0; i < distinct.length; i += 1) for (let j = i + 1; j < distinct.length; j += 1) if (!pairAllowed(policy, distinct[i], distinct[j])) {
    out.push({ key, code: 'OVERLAP_NOT_ALLOWED' });
    return out;
  }
  return out;
}

export function poolAssignmentViolations(assignments: PoolAssignments, policy: PoolPolicy = PILOT_POOL_POLICY): PoolAssignmentViolation[] {
  return [...assignments].sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([key, pools]) => assignmentViolations(key, pools, policy));
}

/**
 * The pool a blueprint variant draws from. Pilot mapping: Full form 1 / 2, Reduced form 1, Diagnostic.
 * A variant with no configured pool (e.g. Full form 3) has none: nothing is selected for it.
 */
export function poolForBlueprint(identity: Pick<BlueprintIdentity, 'purpose' | 'form'>): LogicalPool | null {
  if (identity.purpose === 'FULL') return identity.form === 1 ? 'FULL_MOCK_1' : identity.form === 2 ? 'FULL_MOCK_2' : null;
  if (identity.purpose === 'REDUCED') return identity.form === 1 ? 'REDUCED_MOCK' : null;
  if (identity.purpose === 'DIAGNOSTIC') return 'DIAGNOSTIC';
  return null;
}

export type PoolRejection = 'POOL_UNASSIGNED' | 'POOL_ASSIGNMENT_INVALID' | 'POOL_MISMATCH';

/** May this item be selected for the target pool? Hard: a mismatch is never traded for a better score. */
export function poolVerdict(key: string, target: LogicalPool, assignments: PoolAssignments, policy: PoolPolicy = PILOT_POOL_POLICY): { allowed: true } | { allowed: false; reason: PoolRejection } {
  const pools = assignments.get(key);
  if (!pools || pools.length === 0) return { allowed: false, reason: 'POOL_UNASSIGNED' };
  if (assignmentViolations(key, pools, policy).length > 0) return { allowed: false, reason: 'POOL_ASSIGNMENT_INVALID' };
  return pools.includes(target) ? { allowed: true } : { allowed: false, reason: 'POOL_MISMATCH' };
}
