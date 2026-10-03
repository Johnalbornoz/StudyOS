/**
 * Exam V2 -- portfolio / performance submissions (sections 9-12, 21).
 *
 * A portfolio task inside an exam attempt is answered with a SUBMISSION:
 * uploaded artifacts (images, PDF pages, optional audio / video) plus a
 * statement. The Student builds it while the item is open, then commits the
 * item with `{"submissionId": "..."}` through the normal submit path, where
 * it is assessed:
 *
 *   1. completeness is checked deterministically (required artifacts,
 *      statement, word limits) -- an incomplete submission is never assessed;
 *   2. images + text go to the double assessor (vision); PDF pages, audio and
 *      video are kept for a human: their presence makes the result
 *      REVIEW_REQUIRED (the AI never pretends to have seen them);
 *   3. the submission becomes ASSESSED or REVIEW_REQUIRED, with every
 *      assessment stored.
 */
import { db } from '@/lib/db';
import type { ExamItem, PortfolioTask } from '../items';
import { assessWithRubric, type AssessorRunner, type DoubleAssessmentOutcome } from '../assessment/double-assessor.service';
import { readImagesForAssessment, deleteMedia, signedMediaPath } from '../media/media.service';
import type { ExamNavState } from '../navigation-state';

export class SubmissionError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'NOT_A_PORTFOLIO_TASK'
      | 'ITEM_NOT_OPEN'
      | 'ARTIFACT_KIND_NOT_ALLOWED'
      | 'TOO_MANY_ARTIFACTS'
      | 'STATEMENT_TOO_LONG'
      | 'SUBMISSION_LOCKED'
      | 'INCOMPLETE',
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SubmissionError';
  }
}

export interface PortfolioContext {
  instanceId: string;
  studentId: string;
  simulationAttemptId: string;
  examAttemptId: string;
  targetIndex: number;
  item: ExamItem & { exam: { portfolio: PortfolioTask } };
  assessmentComponentId: string;
}

/** The Student's open portfolio item at `targetIndex` of their in-progress instance. */
export async function loadPortfolioContext(studentId: string, instanceId: string, targetIndex: number): Promise<PortfolioContext> {
  const r = await db.query(
    `SELECT i.id, i.student_id, i.status, sa.id AS sa_id, sa.exam_attempt_id, sa.status AS sa_status, sa.navigation_state
       FROM exam_instances i JOIN simulation_attempts sa ON sa.id = i.simulation_attempt_id WHERE i.id = $1`,
    [instanceId]
  );
  const row = r.rows[0];
  if (!row) throw new SubmissionError('NOT_FOUND');
  if (row.student_id !== studentId) throw new SubmissionError('FORBIDDEN');
  if (row.status !== 'IN_PROGRESS' || row.sa_status !== 'ACTIVE') throw new SubmissionError('ITEM_NOT_OPEN', 'instance not in progress');
  const nav = row.navigation_state as ExamNavState;
  const state = nav?.items?.[String(targetIndex)];
  if (!state?.item || !state.ctx || state.status !== 'DELIVERED') throw new SubmissionError('ITEM_NOT_OPEN');
  if (!state.item.exam.portfolio) throw new SubmissionError('NOT_A_PORTFOLIO_TASK');
  return {
    instanceId,
    studentId,
    simulationAttemptId: row.sa_id,
    examAttemptId: row.exam_attempt_id,
    targetIndex,
    item: state.item as PortfolioContext['item'],
    assessmentComponentId: state.ctx.assessmentComponentId,
  };
}

export async function getOrCreateSubmission(ctx: PortfolioContext): Promise<{ id: string; status: string }> {
  await db.query(
    `INSERT INTO exam_submissions (student_id, exam_instance_id, assessment_component_id, target_index) VALUES ($1, $2, $3, $4)
     ON CONFLICT (exam_instance_id, target_index) DO NOTHING`,
    [ctx.studentId, ctx.instanceId, ctx.assessmentComponentId, ctx.targetIndex]
  );
  const r = await db.query(`SELECT id, status FROM exam_submissions WHERE exam_instance_id = $1 AND target_index = $2`, [ctx.instanceId, ctx.targetIndex]);
  return r.rows[0];
}

const TEXT_KINDS = new Set(['STATEMENT', 'TEXT', 'BIBLIOGRAPHY']);

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Which artifact kinds a task accepts and how many of each. */
export function artifactAllowance(task: PortfolioTask, kind: string): { allowed: boolean; max: number } {
  if (kind === 'STATEMENT') return { allowed: true, max: 1 };
  const req = task.requiredArtifacts.find((a) => a.kind === kind);
  if (req) return { allowed: true, max: req.max };
  if (kind === 'PROCESS_EVIDENCE') return { allowed: true, max: 5 };
  return { allowed: false, max: 0 };
}

export async function addArtifact(ctx: PortfolioContext, a: { kind: string; mediaId?: string; text?: string; caption?: string }): Promise<{ artifactId: string }> {
  const sub = await getOrCreateSubmission(ctx);
  if (sub.status !== 'DRAFT') throw new SubmissionError('SUBMISSION_LOCKED');
  const allowance = artifactAllowance(ctx.item.exam.portfolio, a.kind);
  if (!allowance.allowed) throw new SubmissionError('ARTIFACT_KIND_NOT_ALLOWED', a.kind);
  if (a.kind === 'STATEMENT') {
    const max = ctx.item.exam.portfolio.statementMaxWords;
    if (max && wordCount(a.text ?? '') > max) throw new SubmissionError('STATEMENT_TOO_LONG', `${max}`);
    await db.query(`DELETE FROM exam_submission_artifacts WHERE submission_id = $1 AND kind = 'STATEMENT'`, [sub.id]);
  } else {
    const n = await db.query(`SELECT count(*)::int AS n FROM exam_submission_artifacts WHERE submission_id = $1 AND kind = $2`, [sub.id, a.kind]);
    if (n.rows[0].n >= allowance.max) throw new SubmissionError('TOO_MANY_ARTIFACTS', `${a.kind} max ${allowance.max}`);
  }
  if (!a.mediaId && !(a.text && a.text.trim())) throw new SubmissionError('INCOMPLETE', 'artifact needs a file or text');
  if (a.mediaId) {
    const m = await db.query(`SELECT 1 FROM exam_media_objects WHERE id = $1 AND owner_student_id = $2 AND status = 'ACTIVE' AND scan_status = 'CLEAN'`, [a.mediaId, ctx.studentId]);
    if (m.rows.length === 0) throw new SubmissionError('FORBIDDEN', 'media');
  }
  const order = await db.query(`SELECT COALESCE(max(order_index), -1) + 1 AS o FROM exam_submission_artifacts WHERE submission_id = $1`, [sub.id]);
  const r = await db.query(
    `INSERT INTO exam_submission_artifacts (submission_id, media_object_id, kind, caption, text_content, order_index) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [sub.id, a.mediaId ?? null, a.kind, a.caption?.slice(0, 500) ?? null, TEXT_KINDS.has(a.kind) ? (a.text ?? '').slice(0, 30000) : a.text?.slice(0, 2000) ?? null, order.rows[0].o]
  );
  return { artifactId: r.rows[0].id };
}

export async function removeArtifact(ctx: PortfolioContext, artifactId: string): Promise<boolean> {
  const sub = await getOrCreateSubmission(ctx);
  if (sub.status !== 'DRAFT') throw new SubmissionError('SUBMISSION_LOCKED');
  const r = await db.query(`DELETE FROM exam_submission_artifacts WHERE id = $1 AND submission_id = $2 RETURNING media_object_id`, [artifactId, sub.id]);
  if (r.rows[0]?.media_object_id) await deleteMedia(r.rows[0].media_object_id, ctx.studentId);
  return r.rows.length > 0;
}

export interface SubmissionView {
  submissionId: string;
  status: string;
  artifacts: Array<{ id: string; kind: string; caption: string | null; text: string | null; mime: string | null; name: string | null; thumbUrl: string | null; fileUrl: string | null }>;
  completeness: { complete: boolean; missing: string[] };
}

export function checkCompleteness(task: PortfolioTask, artifacts: Array<{ kind: string; text_content: string | null }>): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const req of task.requiredArtifacts) {
    const n = artifacts.filter((a) => a.kind === req.kind).length;
    if (n < req.min) missing.push(`${req.kind}:${req.min - n}`);
  }
  if (task.statementRequired) {
    const st = artifacts.find((a) => a.kind === 'STATEMENT');
    if (!st || !st.text_content || !st.text_content.trim()) missing.push('STATEMENT');
  }
  return { complete: missing.length === 0, missing };
}

export async function getSubmissionView(ctx: PortfolioContext): Promise<SubmissionView> {
  const sub = await getOrCreateSubmission(ctx);
  const arts = await db.query(
    `SELECT a.id, a.kind, a.caption, a.text_content, a.media_object_id, m.mime_type, m.original_name, m.thumbnail IS NOT NULL AS has_thumb
       FROM exam_submission_artifacts a LEFT JOIN exam_media_objects m ON m.id = a.media_object_id WHERE a.submission_id = $1 ORDER BY a.order_index`,
    [sub.id]
  );
  return {
    submissionId: sub.id,
    status: sub.status,
    artifacts: arts.rows.map((a: any) => ({
      id: a.id,
      kind: a.kind,
      caption: a.caption,
      text: a.text_content,
      mime: a.mime_type,
      name: a.original_name,
      thumbUrl: a.media_object_id && a.has_thumb ? signedMediaPath(a.media_object_id, ctx.studentId, 'thumb') : null,
      fileUrl: a.media_object_id ? signedMediaPath(a.media_object_id, ctx.studentId, 'full') : null,
    })),
    completeness: checkCompleteness(ctx.item.exam.portfolio, arts.rows),
  };
}

const MAX_ASSESSED_IMAGES = 8;

/**
 * Assesses a submission for the grader. Owner/attempt binding is verified
 * by the caller (scoring.service). Never throws on AI failure: the outcome
 * then carries REVIEW_REQUIRED.
 */
export async function assessSubmission(params: { submissionId: string; studentId: string; item: ExamItem; language: string; runner?: AssessorRunner }): Promise<{ outcome: DoubleAssessmentOutcome; humanOnlyArtifacts: string[] }> {
  const portfolio = params.item.exam.portfolio!;
  const arts = (await db.query(`SELECT a.kind, a.caption, a.text_content, a.media_object_id, m.mime_type FROM exam_submission_artifacts a LEFT JOIN exam_media_objects m ON m.id = a.media_object_id WHERE a.submission_id = $1 ORDER BY a.order_index`, [params.submissionId])).rows;
  const completeness = checkCompleteness(portfolio, arts);
  if (!completeness.complete) throw new SubmissionError('INCOMPLETE', completeness.missing.join(','));

  const imageIds = arts.filter((a: any) => a.media_object_id && /^image\//.test(a.mime_type ?? '')).map((a: any) => a.media_object_id).slice(0, MAX_ASSESSED_IMAGES);
  const humanOnly = arts.filter((a: any) => a.media_object_id && !/^image\//.test(a.mime_type ?? '')).map((a: any) => `${a.kind}:${a.mime_type}`);
  const images = await readImagesForAssessment(imageIds, params.studentId);
  const statement = arts.find((a: any) => a.kind === 'STATEMENT')?.text_content ?? '';
  const otherText = arts.filter((a: any) => a.kind !== 'STATEMENT' && a.text_content).map((a: any) => `[${a.kind}] ${a.text_content}`).join('\n\n');
  const captions = arts.filter((a: any) => a.caption).map((a: any, i: number) => `Image ${i + 1}: ${a.caption}`).join('\n');
  const response = [`STATEMENT:\n${statement}`, captions ? `CAPTIONS:\n${captions}` : '', otherText, humanOnly.length ? `(Also submitted, not visible to you: ${humanOnly.join(', ')})` : ''].filter(Boolean).join('\n\n');

  const outcome = await assessWithRubric(
    { rubric: portfolio.rubric, task: params.item.question, response, images: images.map((im, i) => ({ mediaType: im.mime, base64: im.base64, label: `artifact ${i + 1}` })), language: params.language, context: { studentId: params.studentId, sourceComponent: 'submission.service.ts:assessSubmission' } },
    params.runner
  );
  if (humanOnly.length > 0 && !outcome.reviewReasons.includes('NON_VISUAL_ARTIFACTS')) {
    outcome.reviewRequired = true;
    outcome.reviewReasons.push('NON_VISUAL_ARTIFACTS');
  }
  await db.query(`UPDATE exam_submissions SET status = $2, submitted_at = COALESCE(submitted_at, now()) WHERE id = $1`, [params.submissionId, outcome.reviewRequired ? 'REVIEW_REQUIRED' : 'ASSESSED']);
  return { outcome, humanOnlyArtifacts: humanOnly };
}

/** Binds a submission id from an answer to THIS attempt position and owner; null when it does not belong. */
export async function resolveSubmissionForAnswer(params: { examAttemptId: string; targetIndex: number | undefined; studentId: string; submissionId: string }): Promise<string | null> {
  if (params.targetIndex === undefined) return null;
  const r = await db.query(
    `SELECT s.id FROM exam_submissions s
       JOIN exam_instances i ON i.id = s.exam_instance_id
       JOIN simulation_attempts sa ON sa.id = i.simulation_attempt_id
      WHERE s.id = $1 AND s.student_id = $2 AND s.target_index = $3 AND sa.exam_attempt_id = $4 AND s.status = 'DRAFT'`,
    [params.submissionId, params.studentId, params.targetIndex, params.examAttemptId]
  );
  return r.rows[0]?.id ?? null;
}

export function parsePortfolioAnswer(answer: string): string | null {
  try {
    const p = JSON.parse(answer);
    return p && typeof p === 'object' && typeof p.submissionId === 'string' && /^[0-9a-f-]{36}$/i.test(p.submissionId) ? p.submissionId : null;
  } catch {
    return null;
  }
}

/** Pre-commit check for a portfolio answer: it must name THIS position's own, complete draft submission. */
export async function portfolioAnswerProblem(params: { examAttemptId: string; targetIndex: number; studentId: string; answer: string; item: ExamItem }): Promise<string | null> {
  const submissionId = parsePortfolioAnswer(params.answer);
  if (!submissionId) return 'PORTFOLIO_ANSWER_NOT_A_SUBMISSION';
  const bound = await resolveSubmissionForAnswer({ examAttemptId: params.examAttemptId, targetIndex: params.targetIndex, studentId: params.studentId, submissionId });
  if (!bound) return 'SUBMISSION_NOT_FOUND';
  const arts = (await db.query(`SELECT kind, text_content FROM exam_submission_artifacts WHERE submission_id = $1`, [bound])).rows;
  const c = checkCompleteness(params.item.exam.portfolio!, arts);
  return c.complete ? null : `SUBMISSION_INCOMPLETE:${c.missing.join(',')}`;
}
