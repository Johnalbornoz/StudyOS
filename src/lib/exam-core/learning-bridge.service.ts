/**
 * Exam V2 -- Exam -> Learning bridge (sections 38-41).
 *
 * After a scored attempt, every objective the Student did not secure becomes
 * a concrete next step:
 *
 *   "Necesitas reforzar <objective> -- fallaste 3 de 5 preguntas"
 *     - the objective maps (published mapping) to a canonical concept the
 *       Student already has  -> REINFORCE: open that concept in the existing
 *       Learning Engine (no new learning path is invented here);
 *     - otherwise                                                 -> PROPOSE:
 *       "Añadir a mi plan" files a governed LearningConceptProposal. A
 *       proposal NEVER creates a canonical concept: a curator maps it to an
 *       existing concept, approves a new one through the normal concept
 *       tooling, merges or rejects it.
 *
 * Retest loop: a retest is always a NEW instance from zero (novelty prefers
 * items the Student has not seen) -- see exam-instance.service.ts.
 */
import { db } from '@/lib/db';
import type { ResultObjectiveView } from './result-view.service';

export interface BridgeEntry {
  learningObjectiveId: string;
  description: string;
  code: string | null;
  classification: ResultObjectiveView['classification'];
  questions: number;
  questionsMissed: number;
  earned: number;
  available: number;
  action:
    | { kind: 'REINFORCE'; conceptName: string; href: string }
    | { kind: 'PROPOSE'; proposalStatus: ProposalStatus | null; requested: boolean };
}

export type ProposalStatus = 'PROPOSED' | 'MAPPED_TO_EXISTING' | 'APPROVED_NEW' | 'MERGED' | 'REJECTED';

/** Pure: per-objective question counts from the plan's targets and the committed responses. */
export function questionCountsByObjective(
  objectiveByTarget: Map<number, string | null>,
  responses: Array<{ target_index: number | null; score: unknown; max_score: unknown }>
): Map<string, { questions: number; missed: number }> {
  const byIndex = new Map(responses.filter((r) => r.target_index !== null).map((r) => [Number(r.target_index), r]));
  const out = new Map<string, { questions: number; missed: number }>();
  for (const [index, objectiveId] of objectiveByTarget) {
    if (!objectiveId) continue;
    const c = out.get(objectiveId) ?? { questions: 0, missed: 0 };
    c.questions += 1;
    const r = byIndex.get(index);
    if (!r || Number(r.score) < Number(r.max_score)) c.missed += 1;
    out.set(objectiveId, c);
  }
  return out;
}

export function proposalKeyForObjective(learningObjectiveId: string): string {
  return `lo:${learningObjectiveId}`;
}

export async function buildLearningBridge(params: { simulationAttemptId: string; studentId: string; objectives: ResultObjectiveView[] }): Promise<BridgeEntry[]> {
  const weak = params.objectives.filter((o) => o.classification === 'GAP' || o.classification === 'DEVELOPING');
  if (weak.length === 0) return [];
  const row = (
    await db.query(
      `SELECT sa.exam_attempt_id, sp.plan, ea.frozen_configuration FROM simulation_attempts sa
         JOIN simulation_plans sp ON sp.id = sa.simulation_plan_id JOIN exam_attempts ea ON ea.id = sa.exam_attempt_id WHERE sa.id = $1`,
      [params.simulationAttemptId]
    )
  ).rows[0];
  if (!row) return [];
  const targetsById = new Map<string, any>((row.frozen_configuration?.objectiveTargets ?? []).map((t: any) => [t.id, t]));
  const objectiveByTarget = new Map<number, string | null>();
  (row.plan?.selectedTargets ?? []).forEach((t: any, i: number) => objectiveByTarget.set(i, targetsById.get(t.blueprintObjectiveTargetId)?.learningObjectiveId ?? null));
  const responses = (await db.query(`SELECT target_index, score, max_score FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [row.exam_attempt_id])).rows;
  const counts = questionCountsByObjective(objectiveByTarget, responses);

  const proposals = await db.query(
    `SELECT p.proposal_key, p.status, EXISTS (SELECT 1 FROM learning_concept_proposal_requests r WHERE r.proposal_id = p.id AND r.student_id = $2) AS requested
       FROM learning_concept_proposals p WHERE p.proposal_key = ANY($1::text[])`,
    [weak.map((o) => proposalKeyForObjective(o.learningObjectiveId)), params.studentId]
  );
  const proposalByKey = new Map(proposals.rows.map((p: any) => [p.proposal_key, p]));

  return weak
    .map((o) => {
      const c = counts.get(o.learningObjectiveId) ?? { questions: 0, missed: 0 };
      const linked = o.concepts.find((x) => x.studentConceptId && x.subjectId);
      const p = proposalByKey.get(proposalKeyForObjective(o.learningObjectiveId));
      const action: BridgeEntry['action'] = linked
        ? { kind: 'REINFORCE', conceptName: linked.name, href: `/dashboard/subjects/${linked.subjectId}/concepts/${linked.studentConceptId}` }
        : { kind: 'PROPOSE', proposalStatus: p?.status ?? null, requested: !!p?.requested };
      return { learningObjectiveId: o.learningObjectiveId, description: o.description, code: o.code, classification: o.classification, questions: c.questions, questionsMissed: c.missed, earned: o.earned, available: o.available, action };
    })
    .sort((a, b) => (a.classification === b.classification ? b.questionsMissed - a.questionsMissed : a.classification === 'GAP' ? -1 : 1));
}

/**
 * "Añadir a mi plan" for an objective with no concept the Student can study:
 * one governed proposal per objective (shared by every Student who asks), one
 * request per Student. Never creates or links a canonical concept.
 */
export async function requestConceptForObjective(params: { studentId: string; learningObjectiveId: string; examAttemptId: string | null }): Promise<{ proposalId: string; status: ProposalStatus; alreadyRequested: boolean }> {
  const lo = (
    await db.query(
      `SELECT lo.id, lo.code, lo.description, s.name AS subject_name, sn.source_label AS topic
         FROM learning_objectives lo
         LEFT JOIN structure_nodes sn ON sn.id = lo.structure_node_id
         LEFT JOIN structure_versions sv ON sv.id = sn.structure_version_id
         LEFT JOIN academic_subjects s ON s.id = sv.academic_subject_id
        WHERE lo.id = $1`,
      [params.learningObjectiveId]
    )
  ).rows[0];
  if (!lo) throw new Error('LEARNING_OBJECTIVE_NOT_FOUND');
  const versionId = params.examAttemptId ? (await db.query(`SELECT exam_version_id FROM exam_attempts WHERE id = $1`, [params.examAttemptId])).rows[0]?.exam_version_id ?? null : null;
  const key = proposalKeyForObjective(lo.id);
  await db.query(
    `INSERT INTO learning_concept_proposals (proposal_key, proposed_title, definition, subject_name, topic, source_exam_version_id, learning_objective_id, rationale)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Requested by a Student from an exam result: the objective has no concept they can study yet.')
     ON CONFLICT (proposal_key) DO NOTHING`,
    [key, String(lo.description).slice(0, 300), lo.description, lo.subject_name ?? null, lo.topic ?? null, versionId, lo.id]
  );
  const p = (await db.query(`SELECT id, status FROM learning_concept_proposals WHERE proposal_key = $1`, [key])).rows[0];
  const ins = await db.query(
    `INSERT INTO learning_concept_proposal_requests (proposal_id, student_id, exam_attempt_id) VALUES ($1, $2, $3) ON CONFLICT (proposal_id, student_id) DO NOTHING RETURNING id`,
    [p.id, params.studentId, params.examAttemptId]
  );
  return { proposalId: p.id, status: p.status, alreadyRequested: ins.rows.length === 0 };
}

/** Curator decision. MAPPED_TO_EXISTING needs an existing canonical concept; no decision ever creates one. */
export async function decideConceptProposal(params: { proposalId: string; decision: Exclude<ProposalStatus, 'PROPOSED'>; canonicalConceptId?: string; decidedBy: string }): Promise<{ status: ProposalStatus }> {
  if (params.decision === 'MAPPED_TO_EXISTING' || params.decision === 'MERGED') {
    if (!params.canonicalConceptId) throw new Error('CANONICAL_CONCEPT_REQUIRED');
    const exists = await db.query(`SELECT 1 FROM canonical_concepts WHERE id = $1`, [params.canonicalConceptId]);
    if (exists.rows.length === 0) throw new Error('CANONICAL_CONCEPT_NOT_FOUND');
  }
  const r = await db.query(
    `UPDATE learning_concept_proposals SET status = $2, mapped_canonical_concept_id = $3, decided_by = $4, decided_at = now()
      WHERE id = $1 AND status = 'PROPOSED' RETURNING status`,
    [params.proposalId, params.decision, params.canonicalConceptId ?? null, params.decidedBy]
  );
  if (r.rows.length === 0) throw new Error('PROPOSAL_NOT_PENDING');
  return { status: r.rows[0].status };
}

export async function listConceptProposals(status: ProposalStatus | null = 'PROPOSED'): Promise<Array<{ id: string; title: string; subjectName: string | null; topic: string | null; status: ProposalStatus; requests: number; createdAt: string }>> {
  const r = await db.query(
    `SELECT p.id, p.proposed_title, p.subject_name, p.topic, p.status, p.created_at, (SELECT count(*) FROM learning_concept_proposal_requests q WHERE q.proposal_id = p.id)::int AS requests
       FROM learning_concept_proposals p WHERE ($1::text IS NULL OR p.status = $1) ORDER BY requests DESC, p.created_at ASC LIMIT 200`,
    [status]
  );
  return r.rows.map((x: any) => ({ id: x.id, title: x.proposed_title, subjectName: x.subject_name, topic: x.topic, status: x.status, requests: x.requests, createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at }));
}
