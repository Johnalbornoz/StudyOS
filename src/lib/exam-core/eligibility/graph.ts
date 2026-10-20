/**
 * Exam eligibility -- the evidence graph, read from the governed catalogue.
 *
 *   Curriculum programme -> Subject -> exam definitions (config keys) -> objectives
 *
 * A curriculum programme is linked to an exam framework ONLY when the catalogue
 * itself says so: an exam_definitions row of that framework's config keys
 * carries academic_programme_id = the programme (and, for subject-level
 * objectives, academic_subject_id). Nothing is mapped by name, language or
 * academic domain. Programmes that are exams themselves (ADMISSION_EXAM,
 * ASSESSMENT_FRAMEWORK: PAA, Saber 11, PISA) are not curricula and are left
 * to the governed rules in rules.ts.
 *
 * Readiness never matters here: a DRAFT definition (catalogue-only subject) is
 * still evidence that the programme hosts the objective. Only RETIRED rows and
 * non-ACTIVE programmes / organisations are ignored.
 */
import { db } from '@/lib/db';
import { examObjectives, type ObjectiveFramework } from '../objectives/objective-catalog';
import type { EligibilityGraph, GraphProgramme } from './rules';

interface HostRow {
  config_key: string;
  programme_id: string;
  programme_name: string;
  organization_name: string;
  academic_subject_id: string | null;
}

/** Pure: builds the graph from hosting rows and the objective catalogue (exported for tests). */
export function buildEligibilityGraph(rows: HostRow[], frameworkByConfigKey: Map<string, ObjectiveFramework>): EligibilityGraph {
  const programmes = new Map<string, GraphProgramme>();
  const subjectsByConfigKey: Record<string, string[]> = {};
  for (const r of rows) {
    const framework = frameworkByConfigKey.get(r.config_key);
    if (!framework) continue; // a fixture / vertical that is not a preparation objective
    const p = programmes.get(r.programme_id) ?? { programmeId: r.programme_id, programmeName: r.programme_name, organizationName: r.organization_name, frameworks: [] };
    if (!p.frameworks.includes(framework)) p.frameworks.push(framework);
    programmes.set(r.programme_id, p);
    if (r.academic_subject_id) {
      const list = (subjectsByConfigKey[r.config_key] ??= []);
      if (!list.includes(r.academic_subject_id)) list.push(r.academic_subject_id);
    }
  }
  return { programmes: [...programmes.values()], subjectsByConfigKey };
}

export function frameworkByConfigKey(): Map<string, ObjectiveFramework> {
  const m = new Map<string, ObjectiveFramework>();
  for (const o of examObjectives()) for (const k of o.configKeys) m.set(k, o.framework);
  return m;
}

export async function loadEligibilityGraph(): Promise<EligibilityGraph> {
  const r = await db.query(
    `SELECT d.config_key, p.id AS programme_id, p.name AS programme_name, o.name AS organization_name, d.academic_subject_id
       FROM exam_definitions d
       JOIN academic_programmes p ON p.id = d.academic_programme_id AND p.status = 'ACTIVE' AND p.programme_type = 'CURRICULUM'
       JOIN academic_organizations o ON o.id = p.organization_id AND o.status = 'ACTIVE'
      WHERE d.config_key IS NOT NULL AND d.status <> 'RETIRED'`
  );
  return buildEligibilityGraph(r.rows as HostRow[], frameworkByConfigKey());
}
