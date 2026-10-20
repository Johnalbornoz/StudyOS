import { db } from '@/lib/db';
import { getClassProgress } from '@/lib/teacher/class-progress.service';
(async () => {
  const k = (await db.query(`SELECT c.id FROM classes c JOIN institutions i ON i.id = c.institution_id WHERE i.name = 'TA Institución LP'`)).rows[0].id;
  const teacher = (await db.query(`SELECT id FROM users WHERE email = 'studyus-ta-lp-teacher+clerk_test@example.com'`)).rows[0].id;
  for (const period of ['30d', 'all', 'period'] as const) {
    const t0 = Date.now();
    const v = await getClassProgress(teacher, k, { period }, 'es');
    console.log(period, Date.now() - t0, 'ms', { q: v.queryCount, learners: v.summary.activeStudents.length, concepts: v.concepts.length, pairs: v.phases.reduce((a, p) => a + p.pairs, 0), gaps: v.gaps.length, pareto: v.pareto.map((p) => `${p.label}:${p.count}`), trend: v.trend.totalEvidence, quadrantPts: v.quadrant.filter((p) => p.y !== null).length, timeline: v.timeline.length, recs: v.recommendations.map((r) => r.kind), topics: v.options.topics.length, topicSource: v.topicSource, exams: v.exams.length, periodLabel: v.filters.periodLabel });
  }
  await (db as any).end();
})().catch((e) => { console.error(e); process.exit(1); });
