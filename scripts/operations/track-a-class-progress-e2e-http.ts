/**
 * Track A -- Teacher Class Progress Intelligence E2E over REAL HTTP (DEV).
 * Runs on the Learning Plan E2E world (run track-a-learning-plan-e2e-http.ts
 * first): TA Institución LP / "LP Matemáticas 11", 20 learners in mixed
 * states, exam gaps for 3 of them.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-class-progress-e2e-http.ts <baseUrl> <tokens.json>
 *
 * Checks every component against the DEV database (read-only), the filters,
 * drill-down, class scope / cross-tenant denial, the rendered page, a fixed
 * query count, response time, and that the batched canonical decisions are
 * identical to the single-pair authority for every pair of the class.
 */
import { readFileSync } from 'fs';
import { db } from '@/lib/db';
import { getCanonicalPedagogicalDecision, getCanonicalPedagogicalDecisionsBatch } from '@/lib/pedagogical-decision/canonical-decision.service';
import { assertDev, INST_LP_NAME, LP_CLASS_NAME, type Tag } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const TOKENS: Record<Tag, string> = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf-8'));
const results: Array<{ id: string; ok: boolean; detail: string }> = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
async function get(path: string, who: Tag | null) {
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;
  const t0 = Date.now();
  const res = await fetch(BASE + path, { headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) }, redirect: 'manual' });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text, ms: Date.now() - t0 };
}
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const denied = (s: number) => s === 401 || s === 403 || s === 404;

async function main() {
  assertDev();
  const klass = (await db.query(`SELECT c.id FROM classes c JOIN institutions i ON i.id = c.institution_id WHERE i.name = $1 AND c.name = $2`, [INST_LP_NAME, LP_CLASS_NAME])).rows[0]?.id;
  if (!klass) throw new Error('run track-a-learning-plan-e2e-http.ts first (LP world missing)');
  const api = `/api/teacher/classes/${klass}/progress`;

  // --- overview (all time)
  const all = await get(`${api}?period=all`, 'lp-teacher');
  const v = all.body?.data;
  check('OVERVIEW.status', all.status === 200 && !!v, `${all.status} ${all.ms}ms`);
  const roster = (await db.query(`SELECT student_id FROM class_enrollments WHERE class_id = $1 AND status = 'ACTIVE'`, [klass])).rows.map((r: any) => r.student_id);
  check('OVERVIEW.active-students', v.summary.activeStudents.length === roster.length && roster.length === 20, `${v.summary.activeStudents.length}`);
  const scope = (await db.query(`SELECT canonical_concept_id FROM class_plan_concepts WHERE class_id = $1 AND status = 'ACTIVE'`, [klass])).rows.map((r: any) => r.canonical_concept_id);
  check('OVERVIEW.scope-includes-class-plan', scope.every((c: string) => v.concepts.some((x: any) => x.id === c)), `${scope.length} plan / ${v.concepts.length} scope`);

  // --- phase counts = DB plan entries × engine
  const pairsTotal = v.phases.reduce((t: number, p: any) => t + p.pairs, 0);
  check('PHASES.total-pairs', pairsTotal === 20 * v.concepts.length, `${pairsTotal}`);
  const entries = (await db.query(
    `SELECT student_id AS "studentId", learner_concept_id AS "conceptId", canonical_concept_id FROM student_plan_entries WHERE student_id = ANY($1::uuid[]) AND canonical_concept_id = ANY($2::uuid[]) AND plan_status = 'IN_PLAN'`,
    [roster, v.concepts.map((c: any) => c.id)]
  )).rows;
  const notStarted = v.phases.find((p: any) => p.bucket === 'NOT_STARTED').pairs;
  const now = new Date().toISOString();
  const batch = await getCanonicalPedagogicalDecisionsBatch({ pairs: entries, now });
  let same = 0;
  for (const e of entries) {
    const single = (await getCanonicalPedagogicalDecision({ studentId: e.studentId, conceptId: e.conceptId, now })).decision;
    if (JSON.stringify(single) === JSON.stringify(batch.get(`${e.studentId}:${e.conceptId}`)?.decision)) same += 1;
  }
  check('PERF.batch-equals-single-authority', same === entries.length, `${same}/${entries.length}`);
  const expectedNotStarted = 20 * v.concepts.length - entries.length;
  check('PHASES.not-started-matches-db', notStarted === expectedNotStarted, `${notStarted} vs ${expectedNotStarted}`);
  const sofia = (await db.query(`SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = 'studyus-ta-student-a+clerk_test@example.com'`)).rows[0].id;
  const proveList = v.phases.find((p: any) => p.bucket === 'PROVE');
  check('PHASES.drilldown-lists-learners', v.phases.every((p: any) => p.items.length === p.pairs) && (proveList.pairs === 0 || proveList.items.every((x: any) => roster.includes(x.studentId))));

  // --- gaps / Pareto / exams (3 learners with an exam gap in S56)
  check('PARETO.real-exam-gaps', v.pareto.length >= 1 && v.pareto[0].count >= 3 && v.pareto[v.pareto.length - 1].cumulativePercent === 100, JSON.stringify(v.pareto.map((p: any) => [p.label, p.count, p.cumulativePercent])));
  check('PARETO.drilldown-evidence', v.pareto[0].items.every((i: any) => i.reasons.length > 0 && roster.includes(i.studentId)));
  check('EXAMS.groups', v.exams.length >= 1 && v.exams[0].examName.length > 0 && v.exams[0].items.every((x: any) => typeof x.fraction === 'number' && x.fraction < 0.5));
  const lpStudent = (await db.query(`SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = 'studyus-ta-lp-student+clerk_test@example.com'`)).rows[0].id;
  check('SECURITY.no-outside-learner', !JSON.stringify(v).includes(lpStudent));
  check('SECURITY.no-private-fields', !/tutor|transcript|billing|subscription|parent/i.test(JSON.stringify(v.students)));
  check('ACTIONS.reinforce-recommendation', v.recommendations.some((r: any) => r.kind === 'REINFORCE' && r.students.length >= 2 && r.conceptId));

  // --- quadrant: Sofía has real PROVE evidence (Teacher E2E history)
  const sofiaPoint = v.quadrant.find((p: any) => p.studentId === sofia);
  check('QUADRANT.coordinates', !!sofiaPoint && sofiaPoint.x >= 0 && sofiaPoint.x <= 100 && (sofiaPoint.y === null || (sofiaPoint.y >= 0 && sofiaPoint.y <= 100)), JSON.stringify(sofiaPoint));
  check('QUADRANT.no-evidence-no-point', v.quadrant.filter((p: any) => p.studentId !== sofia).every((p: any) => p.y === null));

  // --- trend + table
  check('TREND.weeks', v.trend.totalEvidence === 0 || v.trend.weeks.length > 0, `${v.trend.totalEvidence} evidence`);
  const row = v.students.find((s: any) => s.studentId === sofia);
  check('TABLE.row', !!row && typeof row.progress === 'number' && row.nextAction?.kind, JSON.stringify(row?.nextAction));
  check('TABLE.no-evidence-learner', v.students.filter((s: any) => s.studentId !== sofia).every((s: any) => s.lastActivity === null));

  // --- timeline: the class plan target date of Linear Equations (2026-11-15) is within 60 days of a DEV run in October/November
  check('TIMELINE.sorted', v.timeline.every((e: any, i: number, arr: any[]) => i === 0 || arr[i - 1].date <= e.date));

  // --- filters
  const concept = v.pareto[0].conceptId;
  const byConcept = (await get(`${api}?period=all&concept=${concept}`, 'lp-teacher')).body?.data;
  check('FILTER.concept', byConcept.concepts.length === 1 && byConcept.concepts[0].id === concept && byConcept.phases.reduce((t: number, p: any) => t + p.pairs, 0) === 20);
  const two = roster.slice(0, 2);
  const byStudents = (await get(`${api}?period=all&students=${two.join(',')}`, 'lp-teacher')).body?.data;
  check('FILTER.students', byStudents.summary.activeStudents.length === 2 && byStudents.students.every((s: any) => two.includes(s.studentId)));
  const week = (await get(`${api}?period=7d`, 'lp-teacher')).body?.data;
  check('FILTER.7d-window', !!week.filters.windowFrom && new Date(week.filters.windowFrom).getTime() > Date.now() - 8 * 86_400_000);
  const period = (await get(`${api}?period=period`, 'lp-teacher')).body?.data;
  check('FILTER.period', period.filters.periodLabel === null || period.concepts.every((c: any) => c.period === period.filters.periodLabel), `${period.filters.periodLabel}`);
  if (v.options.topics.length > 0) {
    const topic = v.options.topics[0].key;
    const byTopic = (await get(`${api}?period=all&topic=${topic}`, 'lp-teacher')).body?.data;
    check('FILTER.topic', byTopic.concepts.length >= 1 && byTopic.concepts.every((c: any) => c.topicKey === topic));
  }
  const outsider = (await get(`${api}?period=all&students=${lpStudent}`, 'lp-teacher')).body?.data;
  check('FILTER.outsider-ignored', outsider.summary.activeStudents.length === 0 && !JSON.stringify(outsider.students).includes(lpStudent));

  // --- security
  check('SECURITY.foreign-teacher', denied((await get(api, 'teacher-b')).status));
  check('SECURITY.coordinator', denied((await get(api, 'lp-coord')).status));
  check('SECURITY.student', denied((await get(api, 'student-a')).status));
  check('SECURITY.anonymous', (await get(api, null)).status === 401);
  check('SECURITY.foreign-page', (await get(`/dashboard/teacher/classes/${klass}/progress`, 'teacher-b')).status === 404);

  // --- performance
  check('PERF.query-count', v.queryCount <= 25, `${v.queryCount} queries`);
  const timed = await get(`${api}?period=all`, 'lp-teacher');
  check('PERF.response-time', timed.ms < 8000, `${timed.ms}ms`);

  // --- page
  const page = await get(`/dashboard/teacher/classes/${klass}/progress?period=all`, 'lp-teacher');
  const text = visible(page.text);
  const must = ['Progreso de la clase', 'Resumen', 'Recomendaciones', 'Estudiantes', 'Evolución semanal', 'Conceptos con más estudiantes con dificultades', 'Mapa de la clase', 'Distribución por fase', 'Próximas fechas', 'Dificultades en exámenes', 'Asignar refuerzo', 'Siguiente acción'];
  const missing = must.filter((m) => !text.includes(m));
  check('PAGE.renders-all-components', page.status === 200 && missing.length === 0, `${page.status} missing: ${missing.join(' | ')}`);
  check('PAGE.empty-states-explained', !/NaN|undefined/.test(text));
  const empty = await get(`/dashboard/teacher/classes/${klass}/progress?period=7d&students=${roster[19]}`, 'lp-teacher');
  check('PAGE.empty-state', empty.status === 200 && visible(empty.text).includes('Aún no hay suficiente actividad para mostrar esta visualización.'));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nCLASS PROGRESS E2E: ${results.length - failed.length}/${results.length} PASS${failed.length ? ' -- FAILED: ' + failed.map((f) => f.id).join(', ') : ''}`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (db as any).end?.();
  });
