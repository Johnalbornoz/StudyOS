/**
 * F9 -- Full Mock eligibility, extending (never reimplementing) F7's
 * canFullMockBeOffered. "Mandatory domain" is determined from what the
 * PUBLISHED blueprint's own objective targets actually reference --
 * never from exam_definitions.domains, which nothing else validates.
 * See F9_FULL_MOCK_ELIGIBILITY.md.
 */
import { db } from '@/lib/db';
import { getBlueprintForVersion, listObjectiveTargets } from '@/lib/assessment/blueprint.service';
import { getComponent } from '@/lib/assessment/component.service';
import { canFullMockBeOffered } from '@/lib/assessment/full-mock-guard.service';
import type { SimulationEligibility } from './types';

export interface FullMockDomainCoverage {
  requiredSubjects: Array<{ academicSubjectId: string; academicSubjectName: string }>;
  coverageBySubject: Array<{ academicSubjectId: string; fullyCovered: boolean; blockingReasons: string[] }>;
  allDomainsCovered: boolean;
}

export async function getFullMockDomainCoverage(examVersionId: string): Promise<FullMockDomainCoverage> {
  const blueprint = await getBlueprintForVersion(examVersionId);
  if (!blueprint) return { requiredSubjects: [], coverageBySubject: [], allDomainsCovered: false };

  const targets = await listObjectiveTargets(blueprint.id);
  const subjectIds = new Set<string>();
  const targetsBySubject = new Map<string, typeof targets>();

  for (const target of targets) {
    const component = await getComponent(target.assessmentComponentId);
    const subjectId = component?.academicSubjectId ?? null;
    if (!subjectId) continue;
    subjectIds.add(subjectId);
    if (!targetsBySubject.has(subjectId)) targetsBySubject.set(subjectId, []);
    targetsBySubject.get(subjectId)!.push(target);
  }

  const subjectRows = subjectIds.size > 0 ? await db.query(`SELECT id, name FROM academic_subjects WHERE id = ANY($1::uuid[])`, [Array.from(subjectIds)]) : { rows: [] };
  const nameById = new Map<string, string>(subjectRows.rows.map((r: any) => [r.id, r.name]));

  const coverageBySubject = [];
  for (const subjectId of subjectIds) {
    const subjectTargets = targetsBySubject.get(subjectId) ?? [];
    const blockingReasons: string[] = [];
    for (const target of subjectTargets) {
      const component = await getComponent(target.assessmentComponentId);
      if (!component || component.supportStatus !== 'SUPPORTED') blockingReasons.push(`COMPONENT_UNSUPPORTED: ${component?.name ?? target.assessmentComponentId}`);
      else if (component.timingStatus !== 'CONFIGURED') blockingReasons.push(`TIMING_NOT_CONFIGURED: ${component.name}`);
      else if (component.toolRuleStatus !== 'CONFIGURED') blockingReasons.push(`TOOL_RULES_NOT_CONFIGURED: ${component.name}`);
    }
    coverageBySubject.push({ academicSubjectId: subjectId, fullyCovered: blockingReasons.length === 0, blockingReasons });
  }

  return {
    requiredSubjects: Array.from(subjectIds).map((id) => ({ academicSubjectId: id, academicSubjectName: nameById.get(id) ?? id })),
    coverageBySubject,
    allDomainsCovered: coverageBySubject.every((c) => c.fullyCovered),
  };
}

export async function getFullMockEligibility(examVersionId: string): Promise<SimulationEligibility> {
  const platformCapability = await canFullMockBeOffered(examVersionId);
  const domainCoverage = await getFullMockDomainCoverage(examVersionId);

  const reasons = [...platformCapability.reasons];
  for (const subject of domainCoverage.coverageBySubject) {
    if (!subject.fullyCovered) {
      reasons.push(`MANDATORY_DOMAIN_INCOMPLETE: ${subject.academicSubjectId}`, ...subject.blockingReasons);
    }
  }

  return {
    simulationType: 'FULL_MOCK',
    eligible: platformCapability.ready && domainCoverage.allDomainsCovered,
    reasons,
    structuralReadiness: platformCapability,
  };
}
