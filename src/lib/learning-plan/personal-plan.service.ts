/**
 * Track A -- the Personal Learning Plan and the UNIVERSAL MERGE RULE:
 *
 *     1 student + 1 canonical concept = 1 learner concept = 1 learner state
 *
 * Every way a concept reaches a learner (self-selected, curriculum or
 * prerequisite recommendation, institution curriculum, class plan, teacher
 * assignment, exam gap) goes through `enrollCanonicalConcept`. It:
 *  - reuses the learner's existing concept for that canonical concept when
 *    there is one (progress, evidence and phase untouched);
 *  - otherwise creates it the way the platform creates any new concept
 *    (concept + localizations + the zero "not started" record + a MATCHED
 *    catalog mapping by construction) -- no evidence, no mastery, no phase
 *    transition: the learner starts at LEARN through the normal engine;
 *  - keeps ONE plan entry (student_plan_entries, unique per student +
 *    canonical concept) and records the SOURCE separately
 *    (student_concept_sources, one row per source), all under the
 *    learner's advisory lock, so retries and concurrent calls never
 *    duplicate anything;
 *  - writes an audit event for every change.
 *
 * Plan status (IN_PLAN / ARCHIVED) is planning intent only. The displayed
 * status (ACTIVE / MAINTENANCE / COMPLETED) is DERIVED from the canonical
 * decision and never changes it; the only pedagogical state remains
 * LEARN / PRACTICE / PROVE / RETAIN / TRANSFER from the engine.
 */
import { db } from '@/lib/db';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { catalogSubjectByName, normalizeName } from '@/lib/experience/subject-catalog';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision/canonical-decision.service';
import type { PedagogicalStage, NextCanonicalAction } from '@/lib/pedagogical-engine/types';
import { canonicalConceptLabels } from './labels';

export const PLAN_SOURCE_TYPES = [
  'SELF_SELECTED',
  'CURRICULUM_RECOMMENDATION',
  'INSTITUTION_CURRICULUM',
  'CLASS_PLAN',
  'TEACHER_ASSIGNMENT',
  'EXAM_GAP',
  'PREREQUISITE_RECOMMENDATION',
  'INSTITUTION_ASSIGNMENT',
] as const;
export type PlanSourceType = (typeof PLAN_SOURCE_TYPES)[number];

export interface PlanSource {
  type: PlanSourceType;
  /** The specific origin (class id, exam attempt id, curriculum id...); '' when there is none. */
  key?: string;
  institutionId?: string | null;
  classId?: string | null;
  examAttemptId?: string | null;
  teacherInterventionId?: string | null;
  actorUserId?: string | null;
}

export interface EnrollResult {
  learnerConceptId: string;
  /** a new learner concept was created (the learner did not have this canonical concept at all) */
  conceptCreated: boolean;
  /** a plan entry was created / an archived one restored */
  entryCreated: boolean;
  restored: boolean;
  /** this source was new (or reactivated) */
  sourceAdded: boolean;
}

export const canonicalConceptKey = (canonicalConceptId: string) => `CANON_${canonicalConceptId.replace(/-/g, '').toUpperCase()}`;

type Executor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * The learner's subject that corresponds to the canonical concept's subject:
 * one already holding a concept of that canonical subject, else one whose
 * name is the same subject in any language ("Matemáticas" = "Mathematics"),
 * else a new subject named in the learner's own language.
 */
async function resolveLearnerSubject(client: Executor, studentId: string, canonicalSubject: { id: string; name: string }): Promise<string> {
  const byMapping = await client.query(
    `SELECT s.id FROM subjects s
     JOIN concepts c ON c.subject_id = s.id
     JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id AND m.status = 'MATCHED'
     JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
     WHERE s.student_id = $1 AND s.status = 'active' AND cc.canonical_subject_id = $2
     ORDER BY s.created_at LIMIT 1`,
    [studentId, canonicalSubject.id]
  );
  if (byMapping.rows[0]) return byMapping.rows[0].id;

  const catalogEntry = catalogSubjectByName(canonicalSubject.name);
  const own = await client.query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY created_at`, [studentId]);
  const wanted = normalizeName(canonicalSubject.name);
  const same = own.rows.find((s: any) => {
    if (normalizeName(s.name) === wanted) return true;
    const entry = catalogSubjectByName(s.name);
    return Boolean(entry && catalogEntry && entry.key === catalogEntry.key);
  });
  if (same) return same.id;

  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const name = (catalogEntry?.names as Record<string, string> | undefined)?.[locale] ?? canonicalSubject.name;
  const inserted = await client.query(`INSERT INTO subjects (student_id, name, status) VALUES ($1, $2, 'active') RETURNING id`, [studentId, name]);
  return inserted.rows[0].id;
}

/**
 * No duplicate because of translations: when the learner already has ONE
 * unlinked concept whose label (in any language) is the canonical concept's
 * name or one of its localized labels, that concept is linked (MATCHED)
 * instead of creating a second one. Ambiguous (several) → none is guessed.
 */
async function linkExistingUnmatchedConcept(client: Executor, studentId: string, canonicalConceptId: string): Promise<string | null> {
  const candidates = await client.query(
    `SELECT DISTINCT c.id FROM concepts c
     JOIN subjects s ON s.id = c.subject_id
     JOIN concept_localizations cl ON cl.concept_id = c.id
     LEFT JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id
     WHERE s.student_id = $1 AND (m.id IS NULL OR m.status <> 'MATCHED')
       AND lower(trim(cl.label)) IN (
         SELECT lower(trim(name)) FROM canonical_concepts WHERE id = $2
         UNION SELECT lower(trim(label)) FROM canonical_concept_localizations WHERE canonical_concept_id = $2
       )`,
    [studentId, canonicalConceptId]
  );
  if (candidates.rows.length !== 1) return null;
  const conceptId = candidates.rows[0].id;
  await client.query(
    `INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ($1, $2, 'MATCHED', 'PLAN_ENROLLMENT')
     ON CONFLICT (learner_concept_id) DO UPDATE SET canonical_concept_id = EXCLUDED.canonical_concept_id, status = 'MATCHED', mapping_method = 'PLAN_ENROLLMENT', updated_at = now()`,
    [conceptId, canonicalConceptId]
  );
  return conceptId;
}

async function createLearnerConcept(client: Executor, studentId: string, canonicalConceptId: string, source: PlanSource): Promise<{ id: string; created: boolean }> {
  const canonical = await client.query(
    `SELECT cc.id, cc.name, cs.id AS subject_id, cs.name AS subject_name
     FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
     WHERE cc.id = $1 AND cc.status = 'ACTIVE'`,
    [canonicalConceptId]
  );
  const cc = canonical.rows[0];
  if (!cc) throw new Error('CANONICAL_CONCEPT_NOT_AVAILABLE');
  const subjectId = await resolveLearnerSubject(client, studentId, { id: cc.subject_id, name: cc.subject_name });
  const concept = await client.query(
    `INSERT INTO concepts (subject_id, canonical_id, origin, origin_class_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (subject_id, canonical_id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id
     RETURNING id, (xmax = 0) AS inserted`,
    [subjectId, canonicalConceptKey(cc.id), source.type, source.classId ?? null]
  );
  const conceptId: string = concept.rows[0].id;
  // Labels: the catalog name, plus every localized catalog label (so the learner sees it in their language).
  await client.query(
    `INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'en', $2) ON CONFLICT (concept_id, language) DO NOTHING`,
    [conceptId, cc.name]
  );
  await client.query(
    `INSERT INTO concept_localizations (concept_id, language, label)
     SELECT $1, language, label FROM canonical_concept_localizations WHERE canonical_concept_id = $2
     ON CONFLICT (concept_id, language) DO UPDATE SET label = EXCLUDED.label`,
    [conceptId, cc.id]
  );
  // The same zero-initialized "not started" record every new concept gets (no attempts, no score).
  await client.query(
    `INSERT INTO mastery_records (student_id, concept_id, subject_id, mastery_score, confidence_score, attempt_count, correct_count, incorrect_count)
     VALUES ($1, $2, $3, 0, 0, 0, 0, 0) ON CONFLICT (student_id, concept_id) DO NOTHING`,
    [studentId, conceptId, subjectId]
  );
  await client.query(
    `INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method)
     VALUES ($1, $2, 'MATCHED', $3)
     ON CONFLICT (learner_concept_id) DO NOTHING`,
    [conceptId, cc.id, source.type === 'TEACHER_ASSIGNMENT' ? 'TEACHER_ASSIGNMENT' : 'PLAN_ENROLLMENT']
  );
  return { id: conceptId, created: Boolean(concept.rows[0].inserted) };
}

async function audit(client: Executor, studentId: string, canonicalConceptId: string, eventType: string, source: PlanSource | null, detail: Record<string, unknown> = {}) {
  await client.query(
    `INSERT INTO student_plan_events (student_id, canonical_concept_id, event_type, source_type, source_key, actor_user_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [studentId, canonicalConceptId, eventType, source?.type ?? null, source?.key ?? null, source?.actorUserId ?? null, JSON.stringify(detail)]
  );
}

/**
 * Put a canonical concept in a learner's plan from one source. Idempotent,
 * never resets progress, never creates a second learner state. Callers MUST
 * already have authorized the actor for this learner and validated the
 * canonical concept for the context (class subject, curriculum...).
 */
export async function enrollCanonicalConcept(studentId: string, canonicalConceptId: string, source: PlanSource): Promise<EnrollResult> {
  const key = source.key ?? '';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Same lock key as Student subject creation and every other enrollment for this learner.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('subject-create:' || $1::text))`, [studentId]);
    let learnerConceptId = await resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId, client as any);
    let conceptCreated = false;
    if (!learnerConceptId) learnerConceptId = await linkExistingUnmatchedConcept(client, studentId, canonicalConceptId);
    if (!learnerConceptId) {
      const created = await createLearnerConcept(client, studentId, canonicalConceptId, { ...source, key });
      learnerConceptId = created.id;
      conceptCreated = created.created;
    }

    const entry = await client.query(
      `INSERT INTO student_plan_entries (student_id, canonical_concept_id, learner_concept_id) VALUES ($1, $2, $3)
       ON CONFLICT (student_id, canonical_concept_id) DO UPDATE SET plan_status = 'IN_PLAN', archived_at = NULL, updated_at = now()
         WHERE student_plan_entries.plan_status = 'ARCHIVED'
       RETURNING (xmax = 0) AS inserted`,
      [studentId, canonicalConceptId, learnerConceptId]
    );
    const entryCreated = entry.rows.length > 0 && Boolean(entry.rows[0].inserted);
    const restored = entry.rows.length > 0 && !entry.rows[0].inserted;

    const sourceRow = await client.query(
      `INSERT INTO student_concept_sources (student_id, canonical_concept_id, source_type, source_key, institution_id, class_id, exam_attempt_id, teacher_intervention_id, added_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (student_id, canonical_concept_id, source_type, source_key) DO UPDATE
         SET active = true, deactivated_at = NULL, deactivation_reason = NULL
         WHERE student_concept_sources.active = false
       RETURNING id`,
      [studentId, canonicalConceptId, source.type, key, source.institutionId ?? null, source.classId ?? null, source.examAttemptId ?? null, source.teacherInterventionId ?? null, source.actorUserId ?? null]
    );
    const sourceAdded = sourceRow.rows.length > 0;

    if (entryCreated) await audit(client, studentId, canonicalConceptId, 'ADDED', { ...source, key }, { conceptCreated });
    if (restored) await audit(client, studentId, canonicalConceptId, 'RESTORED', { ...source, key });
    if (sourceAdded) await audit(client, studentId, canonicalConceptId, 'SOURCE_ADDED', { ...source, key });
    await client.query('COMMIT');
    return { learnerConceptId, conceptCreated, entryCreated, restored, sourceAdded };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** The learner archives a concept from their plan: planning only (concept, evidence, learner state and history stay). */
export async function setPlanEntryArchived(studentId: string, canonicalConceptId: string, archived: boolean, actorUserId: string | null): Promise<boolean> {
  const r = await db.query(
    `UPDATE student_plan_entries SET plan_status = $3, archived_at = CASE WHEN $3 = 'ARCHIVED' THEN now() ELSE NULL END, updated_at = now()
     WHERE student_id = $1 AND canonical_concept_id = $2 AND plan_status <> $3 RETURNING id`,
    [studentId, canonicalConceptId, archived ? 'ARCHIVED' : 'IN_PLAN']
  );
  if (r.rows.length === 0) return false;
  await audit(db, studentId, canonicalConceptId, archived ? 'ARCHIVED' : 'RESTORED', null, { actorUserId });
  return true;
}

/**
 * Deactivate sources tied to a class (class plan removal, enrollment end).
 * The plan entry, the learner concept and all learning history stay.
 */
export async function deactivateClassSources(params: { classId: string; studentId?: string; canonicalConceptId?: string; sourceTypes: PlanSourceType[]; reason: string; actorUserId?: string | null }): Promise<number> {
  const r = await db.query(
    `UPDATE student_concept_sources SET active = false, deactivated_at = now(), deactivation_reason = $5
     WHERE class_id = $1 AND active = true AND source_type = ANY($4::text[])
       AND ($2::uuid IS NULL OR student_id = $2) AND ($3::uuid IS NULL OR canonical_concept_id = $3)
     RETURNING student_id, canonical_concept_id, source_type, source_key`,
    [params.classId, params.studentId ?? null, params.canonicalConceptId ?? null, params.sourceTypes, params.reason]
  );
  for (const row of r.rows) {
    await audit(db, row.student_id, row.canonical_concept_id, 'SOURCE_REMOVED', { type: row.source_type, key: row.source_key, actorUserId: params.actorUserId ?? null }, { reason: params.reason });
  }
  return r.rows.length;
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export type DisplayPlanStatus = 'IN_PLAN' | 'ACTIVE' | 'MAINTENANCE' | 'COMPLETED' | 'ARCHIVED';

/** Pure: planning status shown to people. Derived FROM the canonical stage; never feeds back into it. */
export function derivePlanStatus(planStatus: 'IN_PLAN' | 'ARCHIVED', stage: PedagogicalStage | null, evidenceCount: number): DisplayPlanStatus {
  if (planStatus === 'ARCHIVED') return 'ARCHIVED';
  if (stage === 'CONSOLIDATED') return 'COMPLETED';
  if (stage === 'RETAIN' || stage === 'TRANSFER') return 'MAINTENANCE';
  if (evidenceCount > 0) return 'ACTIVE';
  return 'IN_PLAN';
}

export interface PlanEntryView {
  canonicalConceptId: string;
  learnerConceptId: string;
  label: string;
  subjectId: string;
  subjectName: string;
  planStatus: 'IN_PLAN' | 'ARCHIVED';
  displayStatus: DisplayPlanStatus;
  stage: PedagogicalStage | null;
  nextAction: NextCanonicalAction | null;
  evidenceCount: number;
  sources: Array<{ type: PlanSourceType; classId: string | null; className: string | null; addedAt: string }>;
  addedAt: string;
}

export interface OwnConceptView {
  learnerConceptId: string;
  label: string;
  subjectName: string;
}

export interface PersonalPlanView {
  entries: PlanEntryView[];
  /** learner concepts not linked to the catalog yet (created from documents / free text) */
  ownConcepts: OwnConceptView[];
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));

export async function getPersonalPlan(studentId: string, locale: string): Promise<PersonalPlanView> {
  const [entries, sources, own] = await Promise.all([
    db.query(
      `SELECT e.canonical_concept_id, e.learner_concept_id, e.plan_status, e.added_at, c.subject_id, s.name AS subject_name,
         (SELECT COUNT(*)::int FROM learning_evidence le WHERE le.student_id = e.student_id AND le.concept_id = e.learner_concept_id) AS evidence_count
       FROM student_plan_entries e JOIN concepts c ON c.id = e.learner_concept_id JOIN subjects s ON s.id = c.subject_id
       WHERE e.student_id = $1 ORDER BY e.plan_status, s.name, e.added_at`,
      [studentId]
    ),
    db.query(
      `SELECT src.canonical_concept_id, src.source_type, src.class_id, k.name AS class_name, src.added_at
       FROM student_concept_sources src LEFT JOIN classes k ON k.id = src.class_id
       WHERE src.student_id = $1 AND src.active = true ORDER BY src.added_at`,
      [studentId]
    ),
    db.query(
      `SELECT c.id, s.name AS subject_name,
         COALESCE((SELECT label FROM concept_localizations cl WHERE cl.concept_id = c.id ORDER BY (cl.language = $2) DESC, cl.language LIMIT 1), c.canonical_id) AS label
       FROM concepts c JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id AND m.status = 'MATCHED'
       WHERE s.student_id = $1 AND s.status = 'active' AND m.id IS NULL
       ORDER BY s.name, label LIMIT 200`,
      [studentId, locale]
    ),
  ]);
  const labels = await canonicalConceptLabels(entries.rows.map((e: any) => e.canonical_concept_id), locale);
  const decisions = await Promise.all(
    entries.rows.map((e: any) =>
      e.plan_status === 'ARCHIVED' ? Promise.resolve(null) : getCanonicalPedagogicalDecision({ studentId, conceptId: e.learner_concept_id }).then((r) => r.decision).catch(() => null)
    )
  );
  return {
    entries: entries.rows.map((e: any, i: number) => {
      const decision = decisions[i];
      const stage = decision?.stage ?? null;
      return {
        canonicalConceptId: e.canonical_concept_id,
        learnerConceptId: e.learner_concept_id,
        label: labels.get(e.canonical_concept_id) ?? '',
        subjectId: e.subject_id,
        subjectName: e.subject_name,
        planStatus: e.plan_status,
        displayStatus: derivePlanStatus(e.plan_status, stage, e.evidence_count),
        stage,
        nextAction: decision?.nextCanonicalAction ?? null,
        evidenceCount: e.evidence_count,
        sources: sources.rows
          .filter((s: any) => s.canonical_concept_id === e.canonical_concept_id)
          .map((s: any) => ({ type: s.source_type, classId: s.class_id, className: s.class_name, addedAt: iso(s.added_at) })),
        addedAt: iso(e.added_at),
      };
    }),
    ownConcepts: own.rows.map((r: any) => ({ learnerConceptId: r.id, label: r.label, subjectName: r.subject_name })),
  };
}

/** Plan entries of one learner keyed by canonical concept (status overlays for curriculum / recommendation views). */
export async function planIndex(studentId: string): Promise<Map<string, { learnerConceptId: string; planStatus: 'IN_PLAN' | 'ARCHIVED' }>> {
  const r = await db.query(`SELECT canonical_concept_id, learner_concept_id, plan_status FROM student_plan_entries WHERE student_id = $1`, [studentId]);
  return new Map(r.rows.map((row: any) => [row.canonical_concept_id, { learnerConceptId: row.learner_concept_id, planStatus: row.plan_status }]));
}
