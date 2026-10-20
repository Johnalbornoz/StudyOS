/**
 * Cambridge AICE Diploma -- the Student's own Diploma plan ("My AICE Diploma
 * Plan"): subjects, AS / A Level, the group a multi-group subject counts in,
 * the expected exam series; plus the recorded results and the Diploma
 * evaluation. Planning and readiness only -- never an official certification.
 *
 * Every write is validated server-side against the sourced catalogue and the
 * versioned policy: the Student never sends credits, groups outside the
 * subject's eligible groups, grades or points.
 */
import { stateSql } from '../catalog/readiness-view';
import { db } from '@/lib/db';
import { AICE_DIPLOMA_POLICY, availableSeries, creditsFor, seriesIndex, type AiceGroup, type AiceLevel, type ExamSeries, type SeriesMonth } from './policy';
import { evaluateDiplomaPlan, evaluateDiplomaResults, countedGroupFor, type SubjectRule, type DiplomaEvaluation, type PlanEvaluation } from './diploma';
import { AICE_SUBJECTS } from './aice-subjects.generated';
import { AICE_SYLLABI } from './aice-syllabi.generated';

export class AicePlanError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'NO_PLAN' | 'UNKNOWN_SUBJECT' | 'LEVEL_NOT_OFFERED' | 'GROUP_NOT_ELIGIBLE' | 'SERIES_NOT_AVAILABLE' | 'ALREADY_PLANNED' | 'INVALID_GRADE') {
    super(code);
    this.name = 'AicePlanError';
  }
}

export const AICE_CATALOG: Map<string, SubjectRule> = new Map(AICE_SUBJECTS.map((s) => [s.code, s]));
const configKeyFor = (code: string, level: AiceLevel) => `v2.aice.${code}-${level === 'AS' ? 'as' : 'a'}`;

export interface PlanEntryView {
  id: string;
  syllabusCode: string;
  subjectName: string;
  level: AiceLevel;
  credits: number;
  eligibleGroups: AiceGroup[];
  countedGroup: AiceGroup | null;
  needsGroupChoice: boolean;
  syllabusVersion: string | null;
  expectedSeries: ExamSeries | null;
  /** Explorer node to prepare it (practice / mock), when the level is configured. */
  prepareNodeKey: string | null;
  readiness: string;
  preparation: { profileId: string | null; attempts: number; latest: { raw: number; max: number } | null };
  results: Array<{ id: string; grade: string; series: ExamSeries; points: number; status: string; counted: boolean; expiresAfter: ExamSeries }>;
}

export interface AicePlanView {
  policy: { version: string; minimumCredits: number; group4MaxCredits: number; maxScore: number; assumptions: string[] };
  plan: { id: string; createdAt: string } | null;
  entries: PlanEntryView[];
  planEvaluation: PlanEvaluation;
  diploma: DiplomaEvaluation;
  options: Array<{ group: AiceGroup; subjects: Array<{ code: string; name: string; levels: AiceLevel[]; groups: AiceGroup[]; configured: AiceLevel[] }> }>;
  series: ExamSeries[];
}

async function activePlan(studentId: string) {
  return (await db.query(`SELECT id, created_at FROM aice_diploma_plans WHERE student_id = $1 AND status = 'ACTIVE'`, [studentId])).rows[0] ?? null;
}

export async function createPlan(studentId: string): Promise<{ id: string }> {
  const r = await db.query(
    `INSERT INTO aice_diploma_plans (student_id, policy_version) VALUES ($1, $2)
     ON CONFLICT (student_id) WHERE status = 'ACTIVE' DO NOTHING RETURNING id`,
    [studentId, AICE_DIPLOMA_POLICY.version]
  );
  return r.rows[0] ?? (await activePlan(studentId));
}

async function studentCountry(studentId: string): Promise<string | null> {
  const r = await db.query(`SELECT country_of_study FROM student_academic_profile WHERE student_id = $1`, [studentId]).catch(() => ({ rows: [] as any[] }));
  return r.rows[0]?.country_of_study ?? null;
}

function validateEntry(code: string, level: AiceLevel, countedGroup: AiceGroup | null | undefined) {
  const subject = AICE_CATALOG.get(code);
  if (!subject) throw new AicePlanError('UNKNOWN_SUBJECT');
  if (!subject.levels.includes(level)) throw new AicePlanError('LEVEL_NOT_OFFERED');
  if (countedGroup && !subject.groups.includes(countedGroup)) throw new AicePlanError('GROUP_NOT_ELIGIBLE');
  return subject;
}

async function validateSeries(studentId: string, series: ExamSeries | null | undefined) {
  if (!series) return;
  const country = await studentCountry(studentId);
  const allowed = availableSeries(2020, 81, country);
  if (!allowed.some((s) => s.year === series.year && s.month === series.month)) throw new AicePlanError('SERIES_NOT_AVAILABLE');
}

async function ownedEntry(studentId: string, entryId: string) {
  const r = await db.query(
    `SELECT e.* FROM aice_plan_entries e JOIN aice_diploma_plans p ON p.id = e.plan_id WHERE e.id = $1 AND p.student_id = $2 AND p.status = 'ACTIVE'`,
    [entryId, studentId]
  );
  if (!r.rows[0]) throw new AicePlanError('NOT_FOUND');
  return r.rows[0];
}

export async function addPlanEntry(studentId: string, input: { syllabusCode: string; level: AiceLevel; countedGroup?: AiceGroup | null; expectedSeries?: ExamSeries | null }): Promise<{ id: string }> {
  const plan = await activePlan(studentId);
  if (!plan) throw new AicePlanError('NO_PLAN');
  validateEntry(input.syllabusCode, input.level, input.countedGroup);
  await validateSeries(studentId, input.expectedSeries);
  const r = await db.query(
    `INSERT INTO aice_plan_entries (plan_id, syllabus_code, level, counted_group, expected_series_year, expected_series_month)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (plan_id, syllabus_code) DO NOTHING RETURNING id`,
    [plan.id, input.syllabusCode, input.level, input.countedGroup ?? null, input.expectedSeries?.year ?? null, input.expectedSeries?.month ?? null]
  );
  if (!r.rows[0]) throw new AicePlanError('ALREADY_PLANNED');
  await db.query(`UPDATE aice_diploma_plans SET updated_at = now() WHERE id = $1`, [plan.id]);
  return { id: r.rows[0].id };
}

export async function updatePlanEntry(studentId: string, entryId: string, patch: { level?: AiceLevel; countedGroup?: AiceGroup | null; expectedSeries?: ExamSeries | null }): Promise<void> {
  const e = await ownedEntry(studentId, entryId);
  const level = (patch.level ?? e.level) as AiceLevel;
  const countedGroup = patch.countedGroup === undefined ? e.counted_group : patch.countedGroup;
  validateEntry(e.syllabus_code, level, countedGroup);
  const series = patch.expectedSeries === undefined ? (e.expected_series_year ? { year: e.expected_series_year, month: e.expected_series_month } : null) : patch.expectedSeries;
  await validateSeries(studentId, series);
  await db.query(
    `UPDATE aice_plan_entries SET level = $2, counted_group = $3, expected_series_year = $4, expected_series_month = $5, updated_at = now() WHERE id = $1`,
    [entryId, level, countedGroup ?? null, series?.year ?? null, series?.month ?? null]
  );
}

export async function removePlanEntry(studentId: string, entryId: string): Promise<void> {
  await ownedEntry(studentId, entryId);
  await db.query(`DELETE FROM aice_plan_entries WHERE id = $1`, [entryId]);
}

export async function getPlanView(studentId: string, opts: { now?: Date } = {}): Promise<AicePlanView> {
  const plan = await activePlan(studentId);
  const rows = plan ? (await db.query(`SELECT * FROM aice_plan_entries WHERE plan_id = $1 ORDER BY created_at`, [plan.id])).rows : [];
  const results = (await db.query(`SELECT * FROM cambridge_results WHERE student_id = $1 AND status = 'ACTIVE' ORDER BY series_year, series_month`, [studentId])).rows;
  const countedGroups = new Map<string, AiceGroup | null>(rows.map((r: any) => [r.syllabus_code, r.counted_group]));
  const diploma = evaluateDiplomaResults(
    results.map((r: any) => ({ id: r.id, syllabusCode: r.syllabus_code, level: r.level, grade: r.grade, series: { year: r.series_year, month: r.series_month as SeriesMonth } })),
    AICE_CATALOG,
    countedGroups
  );
  const planEvaluation = evaluateDiplomaPlan(rows.map((r: any) => ({ syllabusCode: r.syllabus_code, level: r.level, countedGroup: r.counted_group })), AICE_CATALOG);

  // Explorer nodes + readiness of each configured level; the Student's preparation per exam definition.
  const keys = rows.map((r: any) => configKeyFor(r.syllabus_code, r.level));
  const nodes = keys.length
    ? (await db.query(
        `SELECT DISTINCT ON (n.metadata->'bind'->>'configKey') n.metadata->'bind'->>'configKey' AS config_key, n.node_key, ${stateSql('n', 'STUDENT')} AS state
           FROM assessment_structure_nodes n WHERE n.status = 'ACTIVE' AND node_type = 'LEVEL' AND metadata->'bind'->>'configKey' = ANY($1::text[]) ORDER BY metadata->'bind'->>'configKey', node_key`,
        [keys]
      )).rows
    : [];
  const prep = keys.length
    ? (await db.query(
        `SELECT d.config_key, p.id AS profile_id,
                (SELECT count(*)::int FROM simulation_attempts sa WHERE sa.exam_profile_id = p.id AND sa.hidden_at IS NULL) AS attempts,
                (SELECT json_build_object('raw', r.raw_score, 'max', r.max_score) FROM simulation_attempts sa JOIN exam_attempt_results r ON r.exam_attempt_id = sa.exam_attempt_id AND r.status = 'SCORED'
                  WHERE sa.exam_profile_id = p.id AND sa.hidden_at IS NULL ORDER BY sa.created_at DESC LIMIT 1) AS latest
           FROM exam_definitions d JOIN student_exam_profiles p ON p.exam_definition_id = d.id AND p.student_id = $1 AND p.status <> 'ARCHIVED'
          WHERE d.config_key = ANY($2::text[])`,
        [studentId, keys]
      )).rows
    : [];
  const entries: PlanEntryView[] = rows.map((r: any) => {
    const subject = AICE_CATALOG.get(r.syllabus_code)!;
    const key = configKeyFor(r.syllabus_code, r.level);
    const node = nodes.find((n: any) => n.config_key === key);
    const p = prep.find((x: any) => x.config_key === key);
    const syl = AICE_SYLLABI.find((x) => x.code === r.syllabus_code);
    const counted = countedGroupFor(subject, r.counted_group);
    return {
      id: r.id,
      syllabusCode: r.syllabus_code,
      subjectName: subject.name,
      level: r.level,
      credits: creditsFor(r.level),
      eligibleGroups: subject.groups,
      countedGroup: counted,
      needsGroupChoice: counted === null,
      syllabusVersion: syl?.versionKey ?? null,
      expectedSeries: r.expected_series_year ? { year: r.expected_series_year, month: r.expected_series_month } : null,
      prepareNodeKey: node?.node_key ?? null,
      readiness: node?.state ?? 'CATALOG_ONLY',
      preparation: { profileId: p?.profile_id ?? null, attempts: p?.attempts ?? 0, latest: p?.latest ? { raw: Number(p.latest.raw), max: Number(p.latest.max) } : null },
      results: diploma.results
        .filter((x) => x.syllabusCode === r.syllabus_code)
        .map((x) => ({ id: x.id, grade: x.grade, series: x.series, points: x.points, status: x.status, counted: x.counted, expiresAfter: x.expiresAfter })),
    };
  });
  const configured = new Set(nodes.map((n: any) => n.config_key));
  const allConfigured = (await db.query(`SELECT config_key FROM exam_definitions WHERE config_key LIKE 'v2.aice.%' AND status = 'ACTIVE'`)).rows.map((x: any) => x.config_key as string);
  for (const k of allConfigured) configured.add(k);
  const groups: AiceGroup[] = ['CORE', 'GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4'];
  const now = opts.now ?? new Date();
  const country = await studentCountry(studentId);
  return {
    policy: {
      version: AICE_DIPLOMA_POLICY.version,
      minimumCredits: AICE_DIPLOMA_POLICY.minimumCredits.value,
      group4MaxCredits: AICE_DIPLOMA_POLICY.group4MaxCredits.value,
      maxScore: AICE_DIPLOMA_POLICY.maxScore.value,
      assumptions: diploma.assumptions,
    },
    plan: plan ? { id: plan.id, createdAt: plan.created_at instanceof Date ? plan.created_at.toISOString() : plan.created_at } : null,
    entries,
    planEvaluation,
    diploma,
    options: groups.map((g) => ({
      group: g,
      subjects: AICE_SUBJECTS.filter((s) => (g === 'CORE' ? s.code === AICE_DIPLOMA_POLICY.coreSyllabus.value : s.groups.includes(g) && s.code !== AICE_DIPLOMA_POLICY.coreSyllabus.value)).map((s) => ({
        code: s.code,
        name: s.name,
        levels: s.levels,
        groups: s.groups,
        configured: s.levels.filter((lv) => configured.has(configKeyFor(s.code, lv))),
      })),
    })),
    series: availableSeries(now.getFullYear(), 3, country).filter((s) => seriesIndex(s) >= seriesIndex({ year: now.getFullYear(), month: (now.getMonth() + 1 > 6 ? 11 : 6) as SeriesMonth })),
  };
}

// ---------------------------------------------------------------- results (governed: never the Student)

export async function recordResult(input: { studentId: string; syllabusCode: string; level: AiceLevel; series: ExamSeries; grade: string; source: 'OFFICIAL_STATEMENT' | 'COORDINATOR_VERIFIED' | 'DEV_FIXTURE'; recordedByUserId: string }): Promise<{ id: string }> {
  validateEntry(input.syllabusCode, input.level, null);
  const { isValidGrade } = await import('./policy');
  if (!isValidGrade(input.level, input.grade)) throw new AicePlanError('INVALID_GRADE');
  const r = await db.query(
    `INSERT INTO cambridge_results (student_id, syllabus_code, level, series_year, series_month, grade, source, recorded_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (student_id, syllabus_code, level, series_year, series_month) DO UPDATE SET grade = EXCLUDED.grade, source = EXCLUDED.source, recorded_by_user_id = EXCLUDED.recorded_by_user_id, status = 'ACTIVE', recorded_at = now()
     RETURNING id`,
    [input.studentId, input.syllabusCode, input.level, input.series.year, input.series.month, input.grade, input.source, input.recordedByUserId]
  );
  return { id: r.rows[0].id };
}

/** Coordinator view: AICE plans of the Students in ONE institution (aggregates + per-Student summary, no answers). */
export async function institutionAiceSummary(institutionId: string) {
  const students = (await db.query(
    `SELECT DISTINCT s.id, s.name FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN students s ON s.id = ce.student_id
      WHERE c.institution_id = $1 AND ce.status = 'ACTIVE'`,
    [institutionId]
  )).rows as Array<{ id: string; name: string | null }>;
  const out = [];
  for (const s of students) {
    const plan = await activePlan(s.id);
    if (!plan) continue;
    const v = await getPlanView(s.id);
    out.push({
      studentId: s.id,
      name: s.name,
      plannedCredits: v.planEvaluation.totalCredits,
      coreIncluded: v.planEvaluation.coreIncluded,
      groups: v.planEvaluation.groups.map((g) => ({ group: g.group, credits: g.credits, satisfied: g.satisfied })),
      missing: v.planEvaluation.issues.map((i) => i.code),
      series: [...new Set(v.entries.filter((e) => e.expectedSeries).map((e) => `${e.expectedSeries!.year}-${e.expectedSeries!.month}`))],
      subjects: v.entries.map((e) => ({ code: e.syllabusCode, level: e.level, readiness: e.readiness, attempts: e.preparation.attempts })),
    });
  }
  return { studentsPursuingAice: out.length, students: out };
}
