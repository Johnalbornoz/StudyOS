/**
 * Track B / B10 -- the Student-facing RESULT view of one attempt.
 *
 * Presentation-only composition of facts other modules own:
 *   - exam truth (score, sections, objectives) from exam_attempt_results;
 *   - the canonical learning state of mapped concepts from the Learning
 *     Engine's own read model (`getConceptKnowledgeState`) -- READ ONLY;
 *   - readiness from F9's latest snapshot.
 * It never computes mastery and never recommends from the score: the "next
 * StudyUS step" is the mapped concept's own canonical page (or Today, the
 * orchestrated next step), never a second recommendation engine.
 *
 * Item review respects the attempt's frozen policy (FULL vs SCORES_ONLY) and
 * is only built after submission.
 */
import { db } from '@/lib/db';
import { getConceptKnowledgeState, type MasteryState } from '@/services/knowledge-state.service';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { deriveExamLifecycle, getAttemptResult, type ExamLifecycleStatus, type StoredAttemptResult } from './results.service';
import type { ExamItem } from './items';
import type { ExamNavState } from './navigation-state';

export interface ResultObjectiveView {
  learningObjectiveId: string;
  code: string | null;
  description: string;
  fraction: number | null;
  earned: number;
  available: number;
  classification: 'STRENGTH' | 'DEVELOPING' | 'GAP' | 'NOT_ASSESSED';
  concepts: Array<{ canonicalConceptId: string; name: string; studentConceptId: string | null; subjectId: string | null; masteryState: MasteryState | null }>;
}

export interface ResultItemReview {
  targetIndex: number;
  sectionName: string;
  question: string;
  stimulusTitle: string | null;
  yourAnswer: string | null;
  correctAnswer: string | null;
  earned: number;
  available: number;
  status: 'CORRECT' | 'PARTIAL' | 'INCORRECT' | 'INVALID' | 'MISSING' | 'SKIPPED';
  explanation: string | null;
  /** V2: how the answer was given (a portfolio submission has no text answer to show). */
  answerKind: 'STANDARD' | 'MATH' | 'PORTFOLIO';
  /** V2: the mark awaits human review (AI assessors disagreed / were unsure / could not see some files). */
  reviewRequired: boolean;
  /** V2: rubric / portfolio work -- per-criterion marks and the evidence they rest on. */
  rubric: null | { criteria: Array<{ id: string; name: string; awarded: number; max: number }>; evidence: Array<{ criterionId: string; quote: string }>; rationale: string | null; adjudicated: boolean };
}

export interface AttemptResultView {
  attemptId: string;
  examProfileId: string;
  simulationType: string;
  timingMode: string;
  lifecycle: ExamLifecycleStatus;
  exam: { definitionName: string; family: string; versionLabel: string; examYear: number | null; examSession: string | null; contentStatus: string | null };
  result: StoredAttemptResult | null;
  objectives: ResultObjectiveView[];
  review: ResultItemReview[] | null;
  reviewPolicy: 'FULL' | 'SCORES_ONLY';
  readinessStatus: string | null;
}

function optionText(item: ExamItem, ids: string): string {
  const map = new Map((item.options ?? []).map((o) => [o.id, o.text]));
  return ids
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => map.get(id) ?? id)
    .join('; ');
}

/** A math answer as stored: the literal (LaTeX / typed text), or `{ latex, working }`. */
function mathLiteral(v: unknown): string | null {
  if (typeof v === 'string') {
    if (v.trim().startsWith('{')) {
      try {
        return mathLiteral(JSON.parse(v));
      } catch {
        return v;
      }
    }
    return v;
  }
  if (v && typeof v === 'object' && typeof (v as { latex?: unknown }).latex === 'string') return (v as { latex: string }).latex;
  return null;
}

function displayAnswer(item: ExamItem, raw: string | null): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (item.exam?.portfolio) return null;
  // Math is returned as `$...$` segments so the page renders it as math, never as raw LaTeX.
  if (item.exam?.math) {
    const m = mathLiteral(raw);
    return m ? `$${m}$` : null;
  }
  if (item.exam?.parts) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return item.exam.parts
        .map((p) => {
          const v = parsed[p.id];
          if (!v) return `(${p.id}) —`;
          if (p.answerFormat === 'math') {
            const m = mathLiteral(v);
            return `(${p.id}) ${m ? `$${m}$` : '—'}`;
          }
          return `(${p.id}) ${p.answerFormat === 'text' ? String(v) : (p.options ?? []).find((o) => o.id === v)?.text ?? String(v)}`;
        })
        .join(' · ');
    } catch {
      return raw;
    }
  }
  if (item.answerFormat === 'single_choice' || item.answerFormat === 'multi_choice') return optionText(item, raw);
  return raw;
}

function displayKey(item: ExamItem): string | null {
  if (item.exam?.portfolio) return null;
  if (item.exam?.math) return `$${item.correctAnswer}$`;
  if (item.exam?.parts) {
    return item.exam.parts.map((p) => `(${p.id}) ${p.answerFormat === 'math' ? `$${p.correctAnswer}$` : p.answerFormat === 'text' ? p.correctAnswer : (p.options ?? []).find((o) => o.id === p.correctAnswer)?.text ?? p.correctAnswer}`).join(' · ');
  }
  if (item.answerFormat === 'single_choice' || item.answerFormat === 'multi_choice') return optionText(item, item.correctAnswer);
  if (item.answerFormat === 'text') return item.correctAnswer;
  return null;
}

/**
 * Builds the view for `simulationAttemptId`. The CALLER authorizes (owner, or
 * a reader with LEARNER_PROGRESS_VIEW); this function only reads.
 */
export async function getAttemptResultView(simulationAttemptId: string): Promise<AttemptResultView | null> {
  const attempt = await getSimulationAttempt(simulationAttemptId);
  if (!attempt) return null;

  const meta = await db.query(
    `SELECT d.name AS definition_name, d.exam_family, v.version_label, v.exam_year, v.exam_session, v.navigation_rules->>'contentStatus' AS content_status, ea.status AS exam_status
       FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id
       JOIN exam_attempts ea ON ea.id = $2
      WHERE v.id = $1`,
    [attempt.examVersionId, attempt.examAttemptId]
  );
  const m = meta.rows[0] ?? {};
  const result = await getAttemptResult(attempt.examAttemptId);
  const lifecycle = deriveExamLifecycle({ simulationStatus: attempt.status, examAttemptStatus: m.exam_status ?? null, resultStatus: result?.status ?? null });
  const nav = (attempt.navigationState ?? {}) as Partial<ExamNavState>;
  const reviewPolicy: 'FULL' | 'SCORES_ONLY' = nav.policy?.resultReview ?? 'FULL';

  // Objectives: exam performance + the canonical state of their mapped concepts (read-only).
  const objectives: ResultObjectiveView[] = [];
  if (result) {
    const ids = result.objectiveResults.map((o) => o.learningObjectiveId);
    const [los, mappings] = await Promise.all([
      db.query(`SELECT id, code, description FROM learning_objectives WHERE id = ANY($1::uuid[])`, [ids]),
      db.query(
        `SELECT ocm.learning_objective_id, cc.id AS canonical_concept_id, cc.name
           FROM objective_concept_mappings ocm JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id
          WHERE ocm.learning_objective_id = ANY($1::uuid[]) AND ocm.status = 'PUBLISHED'`,
        [ids]
      ),
    ]);
    const loById = new Map(los.rows.map((r: any) => [r.id, r]));
    for (const o of result.objectiveResults) {
      const concepts: ResultObjectiveView['concepts'] = [];
      for (const mp of mappings.rows.filter((r: any) => r.learning_objective_id === o.learningObjectiveId)) {
        const studentConceptId = await resolveStudentConceptForCanonicalConcept(attempt.studentId, mp.canonical_concept_id);
        const state = studentConceptId ? await getConceptKnowledgeState(attempt.studentId, studentConceptId).catch(() => null) : null;
        concepts.push({ canonicalConceptId: mp.canonical_concept_id, name: mp.name, studentConceptId, subjectId: state?.subjectId ?? null, masteryState: state?.masteryState ?? null });
      }
      const lo = loById.get(o.learningObjectiveId);
      objectives.push({ learningObjectiveId: o.learningObjectiveId, code: lo?.code ?? null, description: lo?.description ?? o.learningObjectiveId, fraction: o.fraction, earned: o.earned, available: o.available, classification: o.classification, concepts });
    }
  }

  // Item review: only after submission, only under a FULL review policy.
  let review: ResultItemReview[] | null = null;
  if (result && reviewPolicy === 'FULL') {
    const plan = (await db.query(`SELECT plan FROM simulation_plans WHERE id = $1`, [attempt.simulationPlanId])).rows[0]?.plan ?? {};
    const sections: Array<{ name: string; startIndex: number; endIndex: number }> = plan.sections ?? [];
    const sectionName = (i: number) => sections.find((s) => i >= s.startIndex && i <= s.endIndex)?.name ?? '';
    const responses = (await db.query(`SELECT id, target_index, raw_response, score, max_score, criteria_breakdown, item_snapshot, review_status FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 AND target_index IS NOT NULL`, [attempt.examAttemptId])).rows;
    const byIndex = new Map(responses.map((r: any) => [Number(r.target_index), r]));
    // V2: the decisive assessment per rubric response (the adjudicator when there was one, else assessor A).
    const rubricIds = responses.filter((r: any) => r.criteria_breakdown?.rubric).map((r: any) => r.id);
    const assessments = rubricIds.length
      ? (await db.query(`SELECT response_id, role, rationale, evidence FROM exam_response_assessments WHERE response_id = ANY($1::uuid[]) ORDER BY (role = 'ADJUDICATOR') DESC, role ASC, created_at`, [rubricIds])).rows
      : [];
    const decisive = new Map<string, any>();
    for (const a of assessments) if (!decisive.has(a.response_id)) decisive.set(a.response_id, a);
    review = [];
    const total = (plan.selectedTargets ?? []).length;
    for (let i = 0; i < total; i++) {
      const row = byIndex.get(i);
      const state = nav.items?.[String(i)];
      const item: ExamItem | undefined = row?.item_snapshot ?? state?.item;
      if (!item) {
        review.push({ targetIndex: i, sectionName: sectionName(i), question: '', stimulusTitle: null, yourAnswer: null, correctAnswer: null, earned: 0, available: 0, status: state?.status === 'EXCLUDED' ? 'SKIPPED' : 'MISSING', explanation: null, answerKind: 'STANDARD', reviewRequired: false, rubric: null });
        continue;
      }
      const raw = row ? (typeof row.raw_response === 'string' ? row.raw_response : row.raw_response === null ? null : String(row.raw_response)) : null;
      const earned = row ? Number(row.score) : 0;
      const available = row ? Number(row.max_score) : (item.exam?.parts ? item.exam.parts.reduce((n, p) => n + p.marks, 0) : item.exam?.marks ?? 1);
      const status: ResultItemReview['status'] = !row
        ? state?.status === 'EXCLUDED' ? 'SKIPPED' : 'MISSING'
        : row.criteria_breakdown?.invalidResponse ? 'INVALID' : earned >= available ? 'CORRECT' : earned > 0 ? 'PARTIAL' : 'INCORRECT';
      review.push({
        targetIndex: i,
        sectionName: sectionName(i),
        question: item.question,
        stimulusTitle: item.exam?.stimulus?.title ?? null,
        yourAnswer: displayAnswer(item, raw),
        correctAnswer: displayKey(item),
        earned,
        available,
        status,
        explanation: item.explanation ?? null,
        answerKind: item.exam?.portfolio ? 'PORTFOLIO' : item.exam?.math || item.exam?.parts?.some((p) => p.answerFormat === 'math') ? 'MATH' : 'STANDARD',
        reviewRequired: row?.review_status === 'REVIEW_REQUIRED',
        rubric: (() => {
          const scores = row?.criteria_breakdown?.rubric as Array<{ id: string; marks: number }> | undefined;
          const def = item.exam?.portfolio?.rubric ?? item.exam?.rubric;
          if (!scores || !def) return null;
          const a = decisive.get(row.id);
          return {
            criteria: def.criteria.map((c) => ({ id: c.id, name: c.name, awarded: scores.find((x) => x.id === c.id)?.marks ?? 0, max: c.maxMarks })),
            evidence: Array.isArray(a?.evidence) ? a.evidence.slice(0, 8) : [],
            rationale: a?.rationale ?? null,
            adjudicated: !!row.criteria_breakdown?.adjudicated,
          };
        })(),
      });
    }
  }

  const snapshot = await getLatestReadinessSnapshot(attempt.examProfileId).catch(() => null);
  return {
    attemptId: attempt.id,
    examProfileId: attempt.examProfileId,
    simulationType: attempt.simulationType,
    timingMode: attempt.timingMode,
    lifecycle,
    exam: { definitionName: m.definition_name ?? '', family: m.exam_family ?? '', versionLabel: m.version_label ?? '', examYear: m.exam_year ?? null, examSession: m.exam_session ?? null, contentStatus: m.content_status ?? null },
    result,
    objectives,
    review,
    reviewPolicy,
    readinessStatus: snapshot?.overallStatus ?? null,
  };
}
