/**
 * Audience semantics (QB-0): who an exam is for, and which bank content a
 * delivery may draw from. Two dimensions, never collapsed:
 *
 *   ExamAudience     STUDENT                   a supported exam (Student catalogue);
 *                    TECHNICAL_CERTIFICATION   engine certification verticals (`dev-cert.*`);
 *                    INTERNAL                  legacy / unconfigured definitions (no config_key,
 *                                              e.g. "PAA Pilot 2026 v1"). Never deleted, never
 *                                              offered to Students.
 *   ContentAudience  STUDENT                   real content only: DEV fixtures never qualify
 *                                              (practice, paper training, mocks, coverage, evidence);
 *                    TECHNICAL_DEMO            the engine may run on fixtures (certification,
 *                                              unit / integration tests, demos, assembly testing).
 *
 * STUDENT is the default everywhere. TECHNICAL_DEMO is an in-process parameter
 * only: no Student route accepts it, so a Student-facing mock never needs an
 * override to run.
 */

export type ExamAudience = 'STUDENT' | 'TECHNICAL_CERTIFICATION' | 'INTERNAL';
export type ContentAudience = 'STUDENT' | 'TECHNICAL_DEMO';

export const TECHNICAL_CONFIG_PREFIX = 'dev-cert.';

/** Audience of an exam definition, from its declared vertical configuration. */
export function examAudienceOf(configKey: string | null | undefined): ExamAudience {
  if (!configKey) return 'INTERNAL';
  if (configKey.startsWith(TECHNICAL_CONFIG_PREFIX)) return 'TECHNICAL_CERTIFICATION';
  return 'STUDENT';
}

export const isStudentAudience = (configKey: string | null | undefined) => examAudienceOf(configKey) === 'STUDENT';

/** The content an exam's deliveries draw from: a technical / internal exam is, by definition, a demo of the engine. */
export function contentAudienceFor(exam: ExamAudience, requested?: ContentAudience): ContentAudience {
  return exam === 'STUDENT' ? requested ?? 'STUDENT' : 'TECHNICAL_DEMO';
}

/**
 * SQL: the exam definition `alias` is offered to Students (ACTIVE and a
 * Student-audience vertical). Constants only: no input reaches this SQL.
 */
export function studentVisibleDefinitionSql(alias = 'd'): string {
  return `(${alias}.status = 'ACTIVE' AND ${alias}.config_key IS NOT NULL AND ${alias}.config_key NOT LIKE '${TECHNICAL_CONFIG_PREFIX}%')`;
}

/** SQL: the definition `alias` is NOT a technical / internal one (status not checked: history of a retired exam stays visible). */
export function studentAudienceDefinitionSql(alias = 'd'): string {
  return `(${alias}.config_key IS NOT NULL AND ${alias}.config_key NOT LIKE '${TECHNICAL_CONFIG_PREFIX}%')`;
}

/* ------------------------------------------------------------------ */
/* Fixture content                                                      */
/* ------------------------------------------------------------------ */

export interface ContentProvenanceFacts {
  provenance?: string | null;
  contentOrigin?: string | null;
  contentStatus?: string | null;
}

/** A DEV certification fixture, by any of the three places provenance is recorded. */
export function isFixtureContent(f: ContentProvenanceFacts): boolean {
  return f.provenance === 'FIXTURE' || f.contentOrigin === 'FIXTURE' || f.contentStatus === 'DEV_CERT_FIXTURE';
}

/**
 * SQL: the approved_items row `alias` is a DEV fixture (column origin, content
 * origin / status, or the bank identity's provenance). Constants only.
 */
export function fixtureContentSql(alias = 'ai'): string {
  return `(${alias}.content_origin = 'FIXTURE' OR ${alias}.content->>'contentOrigin' = 'FIXTURE' OR ${alias}.content->>'contentStatus' = 'DEV_CERT_FIXTURE'`
    + ` OR EXISTS (SELECT 1 FROM question_bank_items fx_qi WHERE fx_qi.id = ${alias}.bank_item_id AND fx_qi.provenance = 'FIXTURE'))`;
}

/** SQL predicate a delivery adds for its content audience ('TRUE' for a technical demo). */
export function contentAudienceSql(audience: ContentAudience, alias = 'ai'): string {
  return audience === 'TECHNICAL_DEMO' ? 'TRUE' : `NOT ${fixtureContentSql(alias)}`;
}

/* ------------------------------------------------------------------ */
/* Evidence                                                             */
/* ------------------------------------------------------------------ */

/**
 * SQL: the exam attempt `examAttemptIdExpr` is technical -- it belongs to a technical / internal exam or to an
 * in-process TECHNICAL_DEMO instance. Such an attempt never feeds gaps, readiness or prediction evidence.
 * `to_jsonb(t_i)` keeps it valid before the instance audience column (20261031_1000) is applied.
 */
export function technicalExamAttemptSql(examAttemptIdExpr: string): string {
  return `EXISTS (SELECT 1 FROM simulation_attempts t_sa JOIN exam_versions t_v ON t_v.id = t_sa.exam_version_id JOIN exam_definitions t_d ON t_d.id = t_v.exam_definition_id`
    + ` LEFT JOIN exam_instances t_i ON t_i.simulation_attempt_id = t_sa.id`
    + ` WHERE t_sa.exam_attempt_id = ${examAttemptIdExpr} AND (NOT ${studentAudienceDefinitionSql('t_d')} OR to_jsonb(t_i)->>'content_audience' = 'TECHNICAL_DEMO'))`;
}

/** SQL: a graded response `alias` (exam_attempt_item_responses) on fixture content -- never prediction evidence. */
export function fixtureResponseSql(alias = 'r'): string {
  return `(${alias}.content_origin = 'FIXTURE' OR ${alias}.item_snapshot->'exam'->>'contentStatus' = 'DEV_CERT_FIXTURE' OR ${alias}.item_snapshot->'exam'->>'contentOrigin' = 'FIXTURE')`;
}
