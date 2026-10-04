/**
 * Question Bank V2 -- inventory DEMAND per blueprint cell, from real Students (DB, read-only).
 *
 * Consumers of an exam bank are the Students PREPARING that exam (active preparation). For each
 * cell, through its reviewed concept links (objective -> canonical concept) and each Student's own
 * learner state (one learner state per Student + canonical concept), they are counted as:
 *   in process     -- no evidence yet, in progress, or needing reinforcement;
 *   retention due  -- demonstrated, with a retention review due within the horizon;
 *   assigned       -- an open Teacher assignment on the concept.
 * A cell without reviewed concept links counts every preparing Student as in process.
 * Aggregates only: no Student identity leaves this module.
 */
import { z } from 'zod';
import { db } from '@/lib/db';
import { conceptKnowledgeLabel } from '../objectives/preparation-plan';
import { computeCellDemand, DEFAULT_DEMAND_POLICY, type CellDemand, type DemandPolicy } from './demand';
import { isEligible } from './lifecycle';
import { bandOf, type DifficultyBand } from './quality';
import type { VersionHealthInputs } from './health.service';

export const DEMAND_SETTINGS_KEY = 'question_bank.demand';

const DemandPolicySchema = z.object({
  horizonDays: z.number().int().min(1).max(90),
  practiceQuestionsPerStudent: z.number().int().min(0).max(1000),
  mocksPerStudent: z.number().int().min(0).max(20),
  retentionQuestionsPerStudent: z.number().int().min(0).max(100),
  assignmentQuestionsPerStudent: z.number().int().min(0).max(100),
  targetMaxStudentsPerQuestion: z.number().int().min(1).max(1000),
  difficultyMix: z.object({ LOW: z.number().min(0), MEDIUM: z.number().min(0), HIGH: z.number().min(0) }),
  yellowAt: z.number().min(0).max(1),
}).partial();

/** The demand policy: code defaults, overridable as data (platform_settings key `question_bank.demand`). */
export async function loadDemandPolicy(): Promise<DemandPolicy> {
  const r = await db.query(`SELECT value FROM platform_settings WHERE key = $1`, [DEMAND_SETTINGS_KEY]).catch(() => ({ rows: [] as any[] }));
  const parsed = r.rows[0]?.value ? DemandPolicySchema.safeParse(r.rows[0].value) : null;
  return parsed?.success ? { ...DEFAULT_DEMAND_POLICY, ...parsed.data, difficultyMix: { ...DEFAULT_DEMAND_POLICY.difficultyMix, ...(parsed.data.difficultyMix ?? {}) } } : DEFAULT_DEMAND_POLICY;
}

export interface CellDemandRow extends CellDemand {
  cellKey: string;
  sectionKey: string;
  componentName: string;
  objectiveCode: string;
  objectiveDescription: string | null;
  conceptNames: string[];
  studentsPreparing: number;
}

export async function versionDemand(inputs: VersionHealthInputs, policy?: DemandPolicy): Promise<{ policy: DemandPolicy; studentsPreparing: number; cells: CellDemandRow[] }> {
  const pol = policy ?? (await loadDemandPolicy());
  const objectiveIds = [...new Set(inputs.cells.map((c) => c.learningObjectiveId))];
  const [prep, links, states, assigned, exposure, queued] = await Promise.all([
    db.query(`SELECT DISTINCT student_id FROM student_exam_profiles WHERE exam_definition_id = $1 AND status = 'ACTIVE'`, [inputs.meta.examDefinitionId]),
    db.query(
      `SELECT m.learning_objective_id, m.canonical_concept_id, cc.name FROM objective_concept_mappings m JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
        WHERE m.status = 'PUBLISHED' AND m.learning_objective_id = ANY($1::uuid[])`,
      [objectiveIds]
    ),
    db.query(
      `SELECT DISTINCT ON (p.student_id, ccm.canonical_concept_id) p.student_id, ccm.canonical_concept_id, ks.mastery_state, ks.validation_readiness,
              COALESCE(ks.critical_misconception_count, 0) AS critical, COALESCE(ks.evidence_count, 0) AS evidence, ms.memory_status,
              (ms.next_review_at IS NOT NULL AND ms.next_review_at <= now() + ($3::int * interval '1 day')) AS due
         FROM (SELECT DISTINCT student_id FROM student_exam_profiles WHERE exam_definition_id = $1 AND status = 'ACTIVE') p
         JOIN subjects s ON s.student_id = p.student_id JOIN concepts c ON c.subject_id = s.id
         JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = c.id AND ccm.status = 'MATCHED'
         LEFT JOIN concept_knowledge_state ks ON ks.student_id = p.student_id AND ks.concept_id = c.id
         LEFT JOIN concept_memory_state ms ON ms.student_id = p.student_id AND ms.concept_id = c.id
        WHERE ccm.canonical_concept_id IN (SELECT canonical_concept_id FROM objective_concept_mappings WHERE status = 'PUBLISHED' AND learning_objective_id = ANY($2::uuid[]))
        ORDER BY p.student_id, ccm.canonical_concept_id, ks.updated_at DESC NULLS LAST`,
      [inputs.meta.examDefinitionId, objectiveIds, pol.horizonDays]
    ),
    db.query(
      `SELECT DISTINCT ti.student_id, ccm.canonical_concept_id FROM teacher_interventions ti
         JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = ti.concept_id AND ccm.status = 'MATCHED'
        WHERE ti.status IN ('ASSIGNED', 'IN_PROGRESS') AND ti.student_id IN (SELECT student_id FROM student_exam_profiles WHERE exam_definition_id = $1 AND status = 'ACTIVE')`,
      [inputs.meta.examDefinitionId]
    ),
    db.query(
      `SELECT ai.learning_objective_id, count(*)::int AS exposures, count(DISTINCT u.student_id)::int AS students
         FROM exam_item_usage u JOIN approved_items ai ON ai.id = u.approved_item_id
        WHERE ai.learning_objective_id = ANY($1::uuid[]) AND u.used_at > now() - ($2::int * interval '1 day') GROUP BY 1`,
      [objectiveIds, pol.horizonDays]
    ),
    db.query(`SELECT cell_key, sum(requested_count)::int AS n FROM question_bank_generation_requests WHERE exam_version_id = $1 AND status IN ('PENDING', 'RUNNING') GROUP BY 1`, [inputs.meta.examVersionId]),
  ]);
  const preparing: string[] = prep.rows.map((r: any) => r.student_id);
  const conceptsByObjective = new Map<string, Array<{ id: string; name: string }>>();
  for (const l of links.rows as any[]) {
    const list = conceptsByObjective.get(l.learning_objective_id) ?? [];
    if (!list.some((c) => c.id === l.canonical_concept_id)) list.push({ id: l.canonical_concept_id, name: l.name });
    conceptsByObjective.set(l.learning_objective_id, list);
  }
  const stateKey = (s: string, c: string) => `${s}|${c}`;
  const stateBy = new Map<string, any>((states.rows as any[]).map((r) => [stateKey(r.student_id, r.canonical_concept_id), r]));
  const assignedBy = new Set((assigned.rows as any[]).map((r) => stateKey(r.student_id, r.canonical_concept_id)));
  const exposureBy = new Map<string, { exposures: number; students: number }>((exposure.rows as any[]).map((r) => [r.learning_objective_id, { exposures: r.exposures, students: r.students }]));
  const queuedBy = new Map<string, number>((queued.rows as any[]).map((r) => [r.cell_key, r.n]));
  const totalReduced = inputs.cells.reduce((n, c) => n + c.reducedPositions, 0) || 1;

  const cells: CellDemandRow[] = inputs.cells.map((cell) => {
    const concepts = conceptsByObjective.get(cell.learningObjectiveId) ?? [];
    let inProcess = 0;
    let due = 0;
    let assignedN = 0;
    for (const sid of preparing) {
      if (concepts.length === 0) {
        inProcess += 1;
        continue;
      }
      const labels = concepts.map((c) => {
        const r = stateBy.get(stateKey(sid, c.id));
        return conceptKnowledgeLabel(r ? { studentConceptId: '', subjectId: '', masteryState: r.mastery_state, validationReadiness: r.validation_readiness, memoryStatus: r.memory_status, retentionDue: !!r.due, criticalMisconceptions: Number(r.critical), evidenceCount: Number(r.evidence) } : null);
      });
      if (labels.some((l) => l === 'NO_EVIDENCE' || l === 'IN_PROGRESS' || l === 'NEEDS_REINFORCEMENT')) inProcess += 1;
      else if (labels.some((l) => l === 'MAINTENANCE') || concepts.some((c) => stateBy.get(stateKey(sid, c.id))?.due)) due += 1;
      if (concepts.some((c) => assignedBy.has(stateKey(sid, c.id)))) assignedN += 1;
    }
    // Approved, practice-usable inventory of the cell, by effective difficulty band (validated, else declared).
    const own = inputs.items.filter((i) => i.isCurrentVersion && i.learningObjectiveId === cell.learningObjectiveId);
    const approvedItems = own.filter((i) => ['ACTIVE', 'CALIBRATED'].includes(i.lifecycle ?? (i.status === 'PUBLISHED' ? 'ACTIVE' : '')) && isEligible(i, 'PRACTICE'));
    const byBand: Record<DifficultyBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const i of approvedItems) byBand[bandOf(i.validatedDifficulty ?? i.difficulty) ?? 'MEDIUM'] += 1;
    const pipeline = own.filter((i) => ['PILOT', 'VALIDATING', 'VALIDATED', 'DRAFT_AI'].includes(i.lifecycle ?? '')).length + (queuedBy.get(cell.cellKey) ?? 0);
    const exp = exposureBy.get(cell.learningObjectiveId) ?? { exposures: 0, students: 0 };
    const d = computeCellDemand(
      {
        blueprintShare: cell.reducedPositions / totalReduced,
        reducedPositions: cell.reducedPositions,
        studentsInProcess: inProcess,
        studentsRetentionDue: due,
        studentsAssigned: assignedN,
        approvedByBand: byBand,
        mockReady: own.filter((i) => isEligible(i, 'REDUCED_MOCK')).length,
        recentExposures: exp.exposures,
        recentStudents: exp.students,
        inPipeline: pipeline,
      },
      pol
    );
    return { ...d, cellKey: cell.cellKey, sectionKey: cell.sectionKey, componentName: cell.componentName, objectiveCode: cell.objectiveCode, objectiveDescription: cell.objectiveDescription, conceptNames: concepts.map((c) => c.name), studentsPreparing: preparing.length };
  });
  return { policy: pol, studentsPreparing: preparing.length, cells };
}
