/**
 * F12 -- Curriculum Coverage Intelligence (task section 15/16). Uses
 * F6's own, unmodified, structure-scoped `computeMappingCoverage`/
 * `computeContentCoverage` (never per-learner, never re-derived) --
 * these numbers describe StudyUS's platform/content completeness for a
 * curriculum structure and are the SAME regardless of which
 * institution is asking; the institution parameter here exists only to
 * authorize the request, exactly like any other F12 entry point. This
 * keeps STRUCTURE/MAPPING/CONTENT coverage cleanly separate from
 * per-student blueprint evidence coverage (F9) and from learner mastery
 * (F5) -- never mixed into one number (INV-F12-10/11, task section 15).
 */
import { requireInstitutionAccess } from './authorization';
import { computeMappingCoverage, computeContentCoverage } from '@/lib/curriculum/coverage.service';
import { buildMetric, nowIso, type AnalyticsScope, type MetricEnvelope } from './types';
import type { MappingCoverageResult, ContentCoverageResult } from '@/lib/curriculum/types';

export interface InstitutionCoverageSummary {
  scope: AnalyticsScope;
  structureVersionId: string;
  structureAvailable: true;
  mappingCoverage: MetricEnvelope<MappingCoverageResult>;
  contentCoverage: MetricEnvelope<ContentCoverageResult>;
}

export async function getInstitutionCoverage(actorUserId: string, institutionId: string, params: { structureVersionId: string }): Promise<InstitutionCoverageSummary> {
  await requireInstitutionAccess(actorUserId, institutionId);

  const [mapping, content] = await Promise.all([
    computeMappingCoverage(params.structureVersionId),
    computeContentCoverage(params.structureVersionId),
  ]);

  const scope: AnalyticsScope = { type: 'INSTITUTION', id: institutionId };
  const lifetime = { type: 'LIFETIME' as const, asOf: nowIso() };
  const sharedLimitations = [
    'this is platform/content coverage (F6), NOT learner mastery (F5) and NOT per-student exam-blueprint evidence coverage (F9) -- these three are never mixed (INV-F12-10)',
    'a structure with zero learners in this institution shows the same coverage numbers as one with many -- coverage describes StudyUS content completeness, not this institution\'s population',
  ];

  return {
    scope,
    structureVersionId: params.structureVersionId,
    structureAvailable: true,
    mappingCoverage: buildMetric({
      metricId: 'CURRICULUM_MAPPING_COVERAGE', name: 'Curriculum Objective Mapping Coverage', scope, timeWindow: lifetime,
      populationDescription: 'PUBLISHED learning_objectives in this structure version', populationCount: mapping.total,
      numerator: mapping.fullyMappedCount, denominator: mapping.total, dataSource: 'objective_concept_mappings / objective_skill_mappings / objective_competency_mappings (PUBLISHED only)',
      policyVersion: mapping.policyVersion,
      exclusions: ['DRAFT/PROPOSED/IN_REVIEW/REJECTED/RETIRED mappings never count'],
      limitations: [...sharedLimitations, `partiallyMappedCount (${mapping.partiallyMappedCount}) is reported separately and is NEVER summed into fullyMappedCount (a PARTIAL mapping never counts as full coverage)`],
      value: mapping,
    }),
    contentCoverage: buildMetric({
      metricId: 'CURRICULUM_CONTENT_COVERAGE', name: 'Curriculum Objective Content Coverage', scope, timeWindow: lifetime,
      populationDescription: 'PUBLISHED learning_objectives in this structure version', populationCount: content.total,
      numerator: content.withApprovedResourceCount, denominator: content.total, dataSource: 'resource_objective_links / academic_resources (PUBLISHED only)',
      policyVersion: content.policyVersion,
      exclusions: ['DRAFT/rejected/retired resources never count', 'duplicate resources on the same objective never inflate the count (DISTINCT objective count, not resource count)'],
      limitations: sharedLimitations,
      value: content,
    }),
  };
}
