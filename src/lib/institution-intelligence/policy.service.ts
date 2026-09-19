/**
 * F12 -- Institution Analytics Policy (small-cohort suppression),
 * mirroring F5/F8/F9's own "aggregation_policy_versions"/
 * "diagnostic_policy_versions"/"readiness_policy_versions" idiom
 * exactly. Deliberately seeded with ZERO rows (see the migration) --
 * task section 27 explicitly forbids inventing a production privacy
 * threshold. getActiveAnalyticsPolicy throws when no ACTIVE row
 * exists, so every cohort-suppression-dependent aggregate fails closed
 * (MIN_COHORT_POLICY: OPEN_DECISION) rather than silently using an
 * invented number.
 */
import { db, type DbExecutor } from '@/lib/db';

export interface AnalyticsPolicyRules {
  minimumCohortSize: number;
}

export interface AnalyticsPolicyVersion {
  id: string;
  version: number;
  rules: AnalyticsPolicyRules;
  status: 'ACTIVE' | 'RETIRED';
  effectiveFrom: string;
}

export class NoActiveAnalyticsPolicyError extends Error {
  constructor() {
    super('MIN_COHORT_POLICY: OPEN_DECISION -- no ACTIVE institution_analytics_policy_versions row exists');
    this.name = 'NoActiveAnalyticsPolicyError';
  }
}

export async function getActiveAnalyticsPolicy(client: DbExecutor = db): Promise<AnalyticsPolicyVersion> {
  const result = await client.query(`SELECT id, version, rules, status, effective_from FROM institution_analytics_policy_versions WHERE status = 'ACTIVE'`);
  if (result.rows.length === 0) throw new NoActiveAnalyticsPolicyError();
  const r = result.rows[0];
  return { id: r.id, version: r.version, rules: r.rules, status: r.status, effectiveFrom: r.effective_from instanceof Date ? r.effective_from.toISOString() : r.effective_from };
}

export type SuppressibleAggregate<T> = { suppressed: false; policyVersion: number; cohortSize: number; value: T } | { suppressed: true; policyVersion: number; cohortSize: number; reason: 'SMALL_COHORT' };

/**
 * The single disclosure-control choke point (task section 27): any
 * aggregate keyed to a population smaller than the ACTIVE policy's
 * `minimumCohortSize` is suppressed -- returned as a controlled
 * "not available" result, never an empty-looking but technically-real
 * data set an actor could use to infer individual outcomes (e.g. a
 * cohort of 1 where 100% in a bucket reveals that one learner's state).
 */
export function applyCohortSuppression<T>(cohortSize: number, policy: AnalyticsPolicyVersion, value: T): SuppressibleAggregate<T> {
  if (cohortSize < policy.rules.minimumCohortSize) {
    return { suppressed: true, policyVersion: policy.version, cohortSize, reason: 'SMALL_COHORT' };
  }
  return { suppressed: false, policyVersion: policy.version, cohortSize, value };
}
