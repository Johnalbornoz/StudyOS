/**
 * Track A -- concept proposals. Teachers and coordinators never create
 * canonical concepts: when a concept does not exist they PROPOSE it. Before a
 * proposal is accepted, likely equivalents already in the catalog are
 * suggested (lexical equivalence on normalized, stemmed tokens -- e.g.
 * "Systems of Linear Equations" ~ "Linear Systems"), so an existing concept
 * is reused instead of duplicated.
 *
 * Only StudyUs catalog governance (Platform Admin) resolves a proposal:
 * MAPPED_TO_EXISTING / MERGED (to an existing canonical concept), APPROVED
 * (StudyUs creates the canonical concept) or REJECTED.
 */
import { db } from '@/lib/db';
import { normalizeName } from '@/lib/experience/subject-catalog';
import { notifyInstitutionAdmins } from '@/lib/notifications/role-notifications.service';
import { recordCurriculumEvent } from './institution-curriculum.service';

const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'of', 'the', 'and', 'in', 'to', 'for', 'un', 'una', 'des', 'le', 'les', 'et', 'do', 'da', 'und', 'der', 'die', 'das']);

/** Normalized, de-pluralized content tokens (accent/case-insensitive). */
export function conceptTokens(text: string): string[] {
  return normalizeName(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith('es') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/** Pure similarity in [0, 1]: token overlap (Dice) with a bonus for containment. */
export function conceptSimilarity(a: string, b: string): number {
  const ta = new Set(conceptTokens(a));
  const tb = new Set(conceptTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  const dice = (2 * common) / (ta.size + tb.size);
  const contained = common === Math.min(ta.size, tb.size) ? 0.15 : 0;
  return Math.min(1, Number((dice + contained).toFixed(3)));
}

export async function findEquivalentConcepts(title: string, canonicalSubjectId: string | null): Promise<Array<{ canonicalConceptId: string; name: string; score: number }>> {
  const r = await db.query(
    `SELECT cc.id, cc.name, array_remove(array_agg(l.label), NULL) AS labels FROM canonical_concepts cc
     LEFT JOIN canonical_concept_localizations l ON l.canonical_concept_id = cc.id
     WHERE cc.status = 'ACTIVE' AND ($1::uuid IS NULL OR cc.canonical_subject_id = $1)
     GROUP BY cc.id, cc.name`,
    [canonicalSubjectId]
  );
  return r.rows
    .map((row: any) => ({ canonicalConceptId: row.id, name: row.name, score: Math.max(conceptSimilarity(title, row.name), ...(row.labels ?? []).map((l: string) => conceptSimilarity(title, l))) }))
    .filter((c: any) => c.score >= 0.4)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5);
}

export class ProposalError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'NOT_OPEN' | 'TARGET_REQUIRED' | 'SUBJECT_REQUIRED') {
    super(code);
    this.name = 'ProposalError';
  }
}

export async function createConceptProposal(params: {
  title: string;
  description?: string | null;
  canonicalSubjectId: string | null;
  topic?: string | null;
  academicContext?: Record<string, unknown>;
  rationale?: string | null;
  requestedByUserId: string;
  institutionId: string | null;
  classId?: string | null;
}): Promise<{ id: string; candidates: Array<{ canonicalConceptId: string; name: string; score: number }> }> {
  const candidates = await findEquivalentConcepts(params.title, params.canonicalSubjectId);
  const r = await db.query(
    `INSERT INTO concept_proposals (title, description, canonical_subject_id, topic, academic_context, rationale, requested_by_user_id, institution_id, class_id, candidate_equivalences)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [params.title.trim(), params.description ?? null, params.canonicalSubjectId, params.topic ?? null, JSON.stringify(params.academicContext ?? {}), params.rationale ?? null, params.requestedByUserId, params.institutionId, params.classId ?? null, JSON.stringify(candidates)]
  );
  if (params.institutionId) {
    await recordCurriculumEvent({ institutionId: params.institutionId, classId: params.classId ?? null, eventType: 'PROPOSAL_CREATED', actorUserId: params.requestedByUserId, detail: { proposalId: r.rows[0].id, title: params.title } });
    await notifyInstitutionAdmins(params.institutionId, {
      type: 'CONCEPT_PROPOSAL_CREATED',
      title: 'Nueva propuesta de concepto',
      message: `Se propuso el concepto «${params.title.trim()}». StudyUs lo revisará.`,
      payload: { title: params.title.trim() },
      actionHref: `/dashboard/institution/${params.institutionId}/curriculum`,
    });
  }
  return { id: r.rows[0].id, candidates };
}

export interface ProposalRow {
  id: string;
  title: string;
  description: string | null;
  subjectName: string | null;
  status: string;
  requestedBy: string | null;
  institutionName: string | null;
  className: string | null;
  candidates: Array<{ canonicalConceptId: string; name: string; score: number }>;
  resolvedConceptName: string | null;
  createdAt: string;
}

export async function listConceptProposals(filter: { institutionId?: string; status?: string } = {}): Promise<ProposalRow[]> {
  const r = await db.query(
    `SELECT p.*, cs.name AS subject_name, u.email AS requested_by, i.name AS institution_name, k.name AS class_name, rc.name AS resolved_name
     FROM concept_proposals p
     LEFT JOIN canonical_subjects cs ON cs.id = p.canonical_subject_id
     LEFT JOIN users u ON u.id = p.requested_by_user_id
     LEFT JOIN institutions i ON i.id = p.institution_id
     LEFT JOIN classes k ON k.id = p.class_id
     LEFT JOIN canonical_concepts rc ON rc.id = p.resolved_canonical_concept_id
     WHERE ($1::uuid IS NULL OR p.institution_id = $1) AND ($2::text IS NULL OR p.status = $2)
     ORDER BY (p.status = 'PROPOSED') DESC, p.created_at DESC LIMIT 200`,
    [filter.institutionId ?? null, filter.status ?? null]
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    subjectName: row.subject_name,
    status: row.status,
    requestedBy: row.requested_by,
    institutionName: row.institution_name,
    className: row.class_name,
    candidates: row.candidate_equivalences ?? [],
    resolvedConceptName: row.resolved_name,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));
}

/** Catalog governance resolves a proposal (Platform Admin only -- gated by the caller). */
export async function resolveConceptProposal(params: {
  proposalId: string;
  action: 'MAP_TO_EXISTING' | 'MERGE' | 'APPROVE' | 'REJECT';
  canonicalConceptId?: string | null;
  note?: string | null;
  reviewerUserId: string;
}): Promise<{ status: string; canonicalConceptId: string | null }> {
  const r = await db.query(`SELECT * FROM concept_proposals WHERE id = $1`, [params.proposalId]);
  const p = r.rows[0];
  if (!p) throw new ProposalError('NOT_FOUND');
  if (p.status !== 'PROPOSED') throw new ProposalError('NOT_OPEN');
  let status: string;
  let conceptId: string | null = null;
  if (params.action === 'MAP_TO_EXISTING' || params.action === 'MERGE') {
    if (!params.canonicalConceptId) throw new ProposalError('TARGET_REQUIRED');
    const exists = await db.query(`SELECT 1 FROM canonical_concepts WHERE id = $1 AND status = 'ACTIVE'`, [params.canonicalConceptId]);
    if (!exists.rows[0]) throw new ProposalError('TARGET_REQUIRED');
    status = params.action === 'MERGE' ? 'MERGED' : 'MAPPED_TO_EXISTING';
    conceptId = params.canonicalConceptId;
  } else if (params.action === 'APPROVE') {
    if (!p.canonical_subject_id) throw new ProposalError('SUBJECT_REQUIRED');
    const created = await db.query(
      `INSERT INTO canonical_concepts (canonical_subject_id, name, description, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [p.canonical_subject_id, p.title, p.description]
    );
    status = 'APPROVED';
    conceptId = created.rows[0].id;
  } else {
    status = 'REJECTED';
  }
  await db.query(
    `UPDATE concept_proposals SET status = $2, resolved_canonical_concept_id = $3, reviewed_by_user_id = $4, reviewed_at = now(), review_note = $5, updated_at = now() WHERE id = $1`,
    [params.proposalId, status, conceptId, params.reviewerUserId, params.note ?? null]
  );
  if (p.institution_id) {
    await recordCurriculumEvent({ institutionId: p.institution_id, classId: p.class_id, canonicalConceptId: conceptId, eventType: 'PROPOSAL_RESOLVED', actorUserId: params.reviewerUserId, detail: { proposalId: p.id, status } });
  }
  return { status, canonicalConceptId: conceptId };
}
