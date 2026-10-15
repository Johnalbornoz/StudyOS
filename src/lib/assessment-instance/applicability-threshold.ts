/**
 * Which applicability threshold policy decides a record of a given SYSTEM (pure): the one the system's registration
 * names (registered-systems.ts), else EA-1 -- as before for every system that names none.
 */
import { EA1_APPLICABILITY_THRESHOLD, type ApplicabilityThresholdPolicy } from '@/lib/assessment-adaptation/assessment-applicability';
import { SYSTEM_APPLICABILITY_THRESHOLDS } from './registered-systems';

export function applicabilityThresholdFor(systemProfileId: string): ApplicabilityThresholdPolicy {
  return SYSTEM_APPLICABILITY_THRESHOLDS[systemProfileId] ?? EA1_APPLICABILITY_THRESHOLD;
}
