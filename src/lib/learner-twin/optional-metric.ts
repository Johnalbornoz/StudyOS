/**
 * D6 -- Concept Detail derived-metric resilience.
 *
 * Wrap ONE optional derived Learner Twin metric read so that a
 * computation/read failure in it degrades to an unavailable metric
 * (reason COMPUTATION_ERROR) plus a structured operational WARN,
 * instead of rejecting the whole `getConceptView` projection and
 * 500-ing Concept Detail.
 *
 * Scope: ONLY the four optional Phase 1E derived metrics
 * (learningVelocity, prerequisiteGaps, helpDependency, persistence).
 * NEVER wrap a required/core Twin read (concept existence, mastery,
 * knowledge state, canonical memory, evidence/history) -- those must
 * still reject so Concept Detail fails closed rather than rendering a
 * partial truth.
 *
 * No retry, no DB write, no new dependency. `studentId` is never
 * logged (Closeout D0 decision 1) -- only the failed reader name and
 * the concept/subject ids.
 */
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { metricUnavailable, type MetricResult } from './metrics/types';

export async function readOptionalDerivedMetric<T>(
  failedSource: string,
  read: () => Promise<MetricResult<T>>,
  context: { conceptId: string; subjectId?: string },
): Promise<MetricResult<T>> {
  try {
    return await read();
  } catch (error) {
    logOperationalWarning({
      subsystem: 'learner-twin',
      operation: 'getConceptView',
      error,
      context: {
        failedSource,
        conceptId: context.conceptId,
        ...(context.subjectId ? { subjectId: context.subjectId } : {}),
      },
    });
    return metricUnavailable(
      'COMPUTATION_ERROR',
      'This metric could not be computed during this request and is temporarily unavailable.',
    );
  }
}
