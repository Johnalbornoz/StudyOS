/**
 * Question Bank V2 -- Platform Admin read models for academic review, question detail and
 * exposure / repetition metrics. Admin-only (content-authorised): the detail shows the answer
 * and explanation the reviewer must certify. Exposure figures are aggregates; no Student identity.
 */
import { REVIEW_CHECKLIST, COMPETENCIES, CONTENTS, type Saber11Competency, type Saber11Content } from './pilots/saber11-math';
import { attentionPointsFor, proposalFromContent, v21CellCheck } from './pilots/human-review';
import { saber11V21DeclaredCells } from './pilots/saber11-v21-cells';
const CHECKLIST_LABEL = new Map<string, string>(REVIEW_CHECKLIST.map(([k, l]) => [k, l]));
import { db } from '@/lib/db';
import { difficultyView, effectiveAlignment, effectiveUsage, reviewStatusOf, type DifficultyBand, type ReviewDecision } from './quality';
import type { Provenance } from './policy';
import type { CalibrationConfidence } from './lifecycle';

export interface ReviewQueueFilters {
  examVersionId?: string;
  sectionKey?: string;
  objectiveCode?: string;
  band?: DifficultyBand;
  generatedFrom?: string;
  generatedTo?: string;
  validation?: 'PASS' | 'FAIL';
  usage?: string;
  alignment?: string;
  status?: 'PENDING' | 'ALL';
}

const BAND_SQL: Record<DifficultyBand, string> = {
  LOW: `COALESCE(ai.validated_difficulty, (ai.content->>'difficulty')::int) <= 2`,
  MEDIUM: `COALESCE(ai.validated_difficulty, (ai.content->>'difficulty')::int) = 3`,
  HIGH: `COALESCE(ai.validated_difficulty, (ai.content->>'difficulty')::int) >= 4`,
};

export async function reviewQueue(f: ReviewQueueFilters, limit = 200) {
  const where: string[] = [`qi.current_version_id = ai.id OR ai.bank_lifecycle_status IN ('PILOT', 'VALIDATED', 'REVIEW_REQUIRED')`];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if ((f.status ?? 'PENDING') === 'PENDING') {
    where.push(`qi.provenance = 'STUDYUS_GENERATED' AND ai.bank_lifecycle_status IN ('PILOT', 'VALIDATED', 'REVIEW_REQUIRED')
                AND NOT EXISTS (SELECT 1 FROM question_bank_reviews r WHERE r.approved_item_id = ai.id AND r.decision = 'APPROVED')`);
  }
  if (f.examVersionId) where.push(`qi.exam_version_id = ${p(f.examVersionId)}::uuid`);
  if (f.sectionKey) where.push(`split_part(qi.cell_key, '|', 1) = ${p(f.sectionKey)}`);
  if (f.objectiveCode) where.push(`lo.code = ${p(f.objectiveCode)}`);
  if (f.band) where.push(BAND_SQL[f.band]);
  if (f.generatedFrom) where.push(`ai.created_at >= ${p(f.generatedFrom)}::date`);
  if (f.generatedTo) where.push(`ai.created_at < (${p(f.generatedTo)}::date + 1)`);
  if (f.validation === 'PASS') where.push(`ai.validation_report->>'outcome' = 'PASS'`);
  if (f.validation === 'FAIL') where.push(`COALESCE(ai.validation_report->>'outcome', '') <> 'PASS'`);
  if (f.usage) where.push(`(ai.usage_eligibility IS NULL OR ${p(f.usage)} = ANY(ai.usage_eligibility))`);
  if (f.alignment) where.push(`ai.exam_alignment = ${p(f.alignment)}`);
  const r = await db.query(
    `SELECT ai.id, ai.version_number, ai.bank_lifecycle_status, ai.created_at, ai.content->>'question' AS question, (ai.content->>'difficulty')::int AS declared,
            ai.validated_difficulty, ai.usage_eligibility, ai.exam_alignment, ai.validation_report->>'outcome' AS outcome, qi.provenance, qi.cell_key,
            lo.code AS objective_code, lo.description AS objective_description, d.name AS exam_name, d.exam_family,
            (SELECT r.decision FROM question_bank_reviews r WHERE r.approved_item_id = ai.id ORDER BY r.reviewed_at DESC LIMIT 1) AS latest_decision,
            COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(ai.validation_report->'issues') = 'array' THEN ai.validation_report->'issues' ELSE '[]'::jsonb END), 0) AS findings
       FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id
       JOIN learning_objectives lo ON lo.id = ai.learning_objective_id
       LEFT JOIN exam_versions v ON v.id = qi.exam_version_id LEFT JOIN exam_definitions d ON d.id = v.exam_definition_id
      WHERE ${where.map((w) => `(${w})`).join(' AND ')}
      ORDER BY ai.created_at DESC LIMIT ${Math.max(1, Math.min(500, limit))}`,
    params
  );
  return r.rows.map((x: any) => {
    const dv = difficultyView({ declared: x.declared, validated: x.validated_difficulty, empiricalDifficulty: null, confidence: null });
    return {
      versionId: x.id,
      version: x.version_number,
      lifecycle: x.bank_lifecycle_status,
      createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at,
      question: String(x.question ?? '').slice(0, 220),
      exam: x.exam_name,
      family: x.exam_family,
      section: String(x.cell_key ?? '').split('|')[0] || null,
      objectiveCode: x.objective_code,
      objectiveDescription: x.objective_description,
      difficulty: dv.effective,
      usage: effectiveUsage(x.usage_eligibility),
      alignment: effectiveAlignment(x.exam_alignment, x.provenance),
      automatedValidation: x.outcome === 'PASS' ? 'PASS' : 'FAIL',
      findings: Number(x.findings),
      review: reviewStatusOf({ provenance: x.provenance, latestDecision: x.latest_decision, lifecycle: x.bank_lifecycle_status }),
      provenance: x.provenance as Provenance,
    };
  });
}

export async function questionDetail(versionId: string) {
  const r = await db.query(
    `SELECT ai.*, qi.provenance, qi.item_key, qi.cell_key, qi.current_version_id, qi.retired_at, qi.exam_version_id, qi.generation_metadata,
            (SELECT gr.generation_params->'pilot' FROM question_bank_generation_requests gr WHERE gr.id = qi.generation_request_id) AS pilot_params,
            lo.code AS objective_code, lo.description AS objective_description, d.name AS exam_name, d.exam_family, v.version_label,
            u.email AS author_email, u.is_system AS author_is_system
       FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id
       JOIN learning_objectives lo ON lo.id = ai.learning_objective_id
       LEFT JOIN exam_versions v ON v.id = qi.exam_version_id LEFT JOIN exam_definitions d ON d.id = v.exam_definition_id
       LEFT JOIN users u ON u.id = ai.created_by
      WHERE ai.id = $1`,
    [versionId]
  );
  const x = r.rows[0];
  if (!x) return null;
  const [concepts, reviews, events, versions, exposure, stats] = await Promise.all([
    db.query(`SELECT cc.name FROM objective_concept_mappings m JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id WHERE m.learning_objective_id = $1 AND m.status = 'PUBLISHED' ORDER BY cc.name`, [x.learning_objective_id]),
    db.query(`SELECT r.decision, r.reviewed_at, r.review_notes, r.validated_difficulty, r.usage_eligibility, r.exam_alignment, u.email FROM question_bank_reviews r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.approved_item_id = $1 ORDER BY r.reviewed_at DESC`, [versionId]),
    db.query(`SELECT e.from_status, e.to_status, e.reason, e.actor_kind, e.created_at, u.email FROM question_bank_lifecycle_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.bank_item_id = $1 ORDER BY e.created_at`, [x.bank_item_id]),
    db.query(`SELECT id, version_number, bank_lifecycle_status, created_at FROM approved_items WHERE bank_item_id = $1 ORDER BY version_number`, [x.bank_item_id]),
    db.query(
      `SELECT count(*)::int AS total, count(DISTINCT student_id)::int AS students, max(used_at) AS last_used FROM exam_item_usage WHERE approved_item_id = $1`,
      [versionId]
    ),
    db.query(`SELECT responses, empirical_difficulty, calibration_confidence FROM question_bank_item_stats WHERE approved_item_id = $1 AND delivery_mode = 'ALL'`, [versionId]),
  ]);
  const e = exposure.rows[0];
  const st = stats.rows[0];
  const latest = reviews.rows[0]?.decision as ReviewDecision | undefined;
  const c = x.content ?? {};
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? null);
  return {
    versionId: x.id,
    itemKey: x.item_key,
    version: x.version_number,
    isCurrent: x.current_version_id === x.id,
    exam: { name: x.exam_name, family: x.exam_family, version: x.version_label },
    section: String(x.cell_key ?? '').split('|')[0] || null,
    objective: { code: x.objective_code, description: x.objective_description },
    concepts: concepts.rows.map((k: any) => k.name),
    content: {
      question: c.question,
      stimulus: c.stimulus ? { title: c.stimulus.title ?? null, text: c.stimulus.text } : null,
      options: c.options ?? [],
      answer: c.correctAnswer,
      explanation: c.explanation,
      distractorRationale: c.distractorRationale ?? null,
      language: c.language,
    },
    difficulty: { ...difficultyView({ declared: c.difficulty ?? null, validated: x.validated_difficulty, empiricalDifficulty: st?.empirical_difficulty === undefined || st?.empirical_difficulty === null ? null : Number(st.empirical_difficulty), confidence: (st?.calibration_confidence ?? null) as CalibrationConfidence | null }), declaredScale: c.difficulty ?? null, validatedScale: x.validated_difficulty },
    usage: effectiveUsage(x.usage_eligibility),
    usageIsLegacy: !x.usage_eligibility,
    alignment: effectiveAlignment(x.exam_alignment, x.provenance),
    provenance: x.provenance as Provenance,
    author: x.author_is_system ? 'StudyUs Factory (AI)' : x.author_email,
    lifecycle: x.bank_lifecycle_status,
    retired: !!x.retired_at,
    automatedValidation: {
      result: x.validation_report?.outcome === 'PASS' ? 'PASS' : x.validation_report ? 'FAIL' : x.provenance === 'STUDYUS_GENERATED' ? 'FAIL' : 'NOT_APPLICABLE',
      stage: x.validation_report?.stage ?? null,
      findings: ((x.validation_report?.issues ?? []) as any[]).map((i) => ({ code: i.code, severity: i.severity, detail: i.detail ?? null })),
      validatorModel: x.validation_report?.validator?.model ?? null,
      /** The independent AI validator's verdict (an automated signal for the reviewer, never an approval). */
      validatorVerdict: x.validation_report?.validator?.verdict
        ? { selectedOption: x.validation_report.validator.verdict.selectedOptionId ?? null, estimatedDifficulty: x.validation_report.validator.verdict.estimatedDifficulty ?? null, implausibleDistractors: x.validation_report.validator.verdict.implausibleDistractorIds ?? [], alternativeDefensible: x.validation_report.validator.verdict.alternativeDefensibleOptionIds ?? [] }
        : null,
    },
    humanReview: {
      status: reviewStatusOf({ provenance: x.provenance, latestDecision: latest ?? null, lifecycle: x.bank_lifecycle_status }),
      history: reviews.rows.map((v: any) => ({ decision: v.decision, at: iso(v.reviewed_at), notes: v.review_notes, reviewer: v.email, validatedDifficulty: v.validated_difficulty, usage: v.usage_eligibility, alignment: v.exam_alignment })),
    },
    exposure: { totalUses: e.total, uniqueStudents: e.students, repeatExposures: Math.max(0, e.total - e.students), repeatRate: e.total ? Math.round(((e.total - e.students) / e.total) * 1000) / 1000 : 0, lastUsed: iso(e.last_used) },
    performance: st ? { responses: st.responses, empiricalDifficulty: st.empirical_difficulty === null ? null : Number(st.empirical_difficulty), confidence: st.calibration_confidence } : null,
    versions: versions.rows.map((v: any) => ({ versionId: v.id, version: v.version_number, lifecycle: v.bank_lifecycle_status, createdAt: iso(v.created_at) })),
    audit: events.rows.map((v: any) => ({ from: v.from_status, to: v.to_status, reason: v.reason, actor: v.actor_kind === 'ADMIN' ? v.email : v.actor_kind, at: iso(v.created_at) })),
    generation: x.generation_metadata ?? null,
    /** A governed pilot: the framework coordinates the reviewer verifies and the checklist an approval requires. */
    pilot: x.pilot_params
      ? {
          key: x.pilot_params.pilotKey ?? null,
          batch: x.pilot_params.batch ?? null,
          requested: { competency: x.pilot_params.competencyLabel ?? null, contentCategory: x.pilot_params.contentCategory ?? null, difficulty: x.pilot_params.difficulty ?? [], locale: x.pilot_params.locale ?? null },
          tags: { competency: c.tags?.competency ?? null, assertion: c.tags?.assertion ?? null, evidence: c.tags?.evidence ?? null, contentCategory: c.tags?.contentCategory ?? null },
          checklist: ((x.pilot_params.reviewChecklist ?? []) as string[]).map((k) => ({ key: k, label: CHECKLIST_LABEL.get(k) ?? k })),
          /** What the generator PROPOSED (the reviewer confirms or corrects each), never a decision. */
          proposal: proposalFromContent(c),
          /** Automated pre-review observations the reviewer confirms or rejects (never decisions). */
          attentionPoints: attentionPointsFor(x.item_key, x.pilot_params.batch ?? ''),
          /** Competence x content cell vs the request and the V2.1 blueprint (50 slots). */
          cell: x.pilot_params.competency
            ? v21CellCheck({
                requested: { competency: x.pilot_params.competency as Saber11Competency, content: (Object.keys(CONTENTS) as Saber11Content[]).find((k) => CONTENTS[k].label === x.pilot_params.contentCategory) ?? null },
                objectiveCode: x.objective_code,
                proposal: proposalFromContent(c),
                marks: c.marks,
                declaredSignatures: new Set(saber11V21DeclaredCells().keys()),
              })
            : null,
          competencyOptions: (Object.keys(COMPETENCIES) as Saber11Competency[]).map((k) => ({ key: k, label: COMPETENCIES[k].label })),
          contentOptions: (Object.keys(CONTENTS) as Saber11Content[]).map((k) => ({ key: k, label: CONTENTS[k].label })),
        }
      : null,
  };
}

/** Overall exposure / repetition metrics over the planning horizon (aggregates only). */
export async function exposureMetrics(horizonDays = 14) {
  const [bank, usage] = await Promise.all([
    db.query(`
      SELECT count(*) FILTER (WHERE qi.provenance = 'STUDYUS_GENERATED')::int AS generated,
             count(*) FILTER (WHERE qi.provenance = 'STUDYUS_GENERATED' AND EXISTS (SELECT 1 FROM question_bank_reviews r WHERE r.bank_item_id = qi.id AND r.decision = 'APPROVED'))::int AS approved,
             count(*) FILTER (WHERE qi.provenance = 'STUDYUS_GENERATED' AND cv.bank_lifecycle_status = 'REJECTED')::int AS rejected,
             count(*) FILTER (WHERE qi.provenance = 'STUDYUS_GENERATED' AND cv.bank_lifecycle_status IN ('PILOT', 'VALIDATED', 'REVIEW_REQUIRED')
                              AND NOT EXISTS (SELECT 1 FROM question_bank_reviews r WHERE r.approved_item_id = cv.id AND r.decision = 'APPROVED'))::int AS pending_review,
             count(*) FILTER (WHERE cv.bank_lifecycle_status IN ('ACTIVE', 'CALIBRATED') AND qi.retired_at IS NULL)::int AS active_inventory
        FROM question_bank_items qi JOIN approved_items cv ON cv.id = qi.current_version_id`),
    db.query(
      `WITH u AS (SELECT * FROM exam_item_usage WHERE used_at > now() - ($1::int * interval '1 day') AND approved_item_id IS NOT NULL),
            per AS (SELECT approved_item_id, count(*) AS n, count(DISTINCT student_id) AS s FROM u GROUP BY 1)
       SELECT (SELECT count(*) FROM u)::int AS exposures,
              (SELECT count(*) FROM per)::int AS items_exposed,
              (SELECT count(*) FROM per WHERE n > 1)::int AS items_reused,
              (SELECT COALESCE(sum(n - s), 0) FROM per)::int AS repeat_exposures,
              (SELECT count(*) FROM u WHERE EXISTS (SELECT 1 FROM u o WHERE o.approved_item_id = u.approved_item_id AND o.student_id <> u.student_id))::int AS colliding_exposures`,
      [horizonDays]
    ),
  ]);
  const b = bank.rows[0];
  const x = usage.rows[0];
  return {
    horizonDays,
    generated: b.generated,
    approved: b.approved,
    rejected: b.rejected,
    pendingReview: b.pending_review,
    activeInventory: b.active_inventory,
    exposures: x.exposures,
    questionsReused: x.items_reused,
    averageExposuresPerQuestion: x.items_exposed ? Math.round((x.exposures / x.items_exposed) * 100) / 100 : 0,
    repeatRate: x.exposures ? Math.round((x.repeat_exposures / x.exposures) * 1000) / 1000 : 0,
    collisionRate: x.exposures ? Math.round((x.colliding_exposures / x.exposures) * 1000) / 1000 : 0,
  };
}
