import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { getSubjectAssessmentGroupResults, SubjectAssignmentError } from '@/lib/teacher/subject-assessment-assignment.service';
import { StatusBadge, toneForInterventionStatus } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ClassChrome } from '../../class-chrome';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAND_LABEL = { LOW: 'tsa.difficulty.BASICO', MEDIUM: 'tsa.difficulty.INTERMEDIO', HIGH: 'tsa.difficulty.AVANZADO', MIXED: 'tsa.difficulty.MIXTO' } as const;

/**
 * Overnight 2026-10-16 -- the Teacher's GROUP view of one subject Test / Mock assignment: per student the LATEST
 * COMPLETED attempt (score, attempts used / max), the group average, the result distribution (a reading aid, not a
 * policy), performance by concept, the difficulty assessed, high-error questions / areas, strongest concepts and the
 * largest gaps. Only for a Teacher of this class (anyone else: 404, never a hint).
 */
export default async function SubjectAssessmentGroupPage({ params }: { params: Promise<{ classId: string; groupId: string }> }) {
  const { classId, groupId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId) || !UUID_RE.test(groupId)) notFound();
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) notFound();
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  let g;
  try {
    g = await getSubjectAssessmentGroupResults(actor.id, classId, groupId, { locale });
  } catch (error) {
    if (error instanceof SubjectAssignmentError) notFound();
    throw error;
  }
  const pct = (n: number | null) => (n === null ? '—' : `${n} %`);

  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="assignments" t={t} locale={locale} />
      <section className="card ta-card" aria-labelledby="tsa-group-title" data-testid="tsa-group">
        <h2 id="tsa-group-title" style={{ fontSize: 18 }}>{g.title ?? t[`tsa.kind.${g.kind}`]}</h2>
        <p className="ta-msg">{[t[`tsa.kind.${g.kind}`], g.subjectName, fillMessage(t['tsa.previewCount'], { n: g.plan.questionCount }), g.timing.timed && g.timing.durationMinutes ? `${g.timing.durationMinutes} min` : t['tsa.untimed'], t[`tsa.phase.${g.windowPhase}`]].filter(Boolean).join(' · ')}</p>
        <p className="ta-msg">{fillMessage(t['tsa.student.windowLine'], { start: g.window.startDate, end: g.window.endDate, tz: g.window.timezone })}</p>
        <p className="ta-msg">
          {t['tsa.group.difficulty']}: {t[BAND_LABEL[g.difficultyBand]]}
          {g.servedDifficultyMean !== null ? ` (${fillMessage(t['tsa.group.servedDifficulty'], { n: g.servedDifficultyMean })})` : ''}
        </p>
        <p className="ta-msg">{[fillMessage(t['tsa.completed'], { n: g.completedStudents, total: g.students.length }), g.averageScorePercent !== null ? fillMessage(t['tsa.average'], { n: g.averageScorePercent }) : null].filter(Boolean).join(' · ')}</p>
        <p className="ta-msg">{fillMessage(t['tsa.group.versions'], { shared: g.versions.sharedItemCount, reused: g.versions.reusedItemCount })}</p>
      </section>

      <section className="card" aria-labelledby="tsa-students-title">
        <h3 id="tsa-students-title" style={{ fontSize: 16, padding: 'var(--space-4) var(--space-4) 0' }}>{t['tsa.group.students']}</h3>
        <div className="ta-table-row ta-table-head" aria-hidden>
          <span>{t['tsa.group.students']}</span>
          <span>{t['tsa.group.score']}</span>
          <span>{t['tsa.student.history']}</span>
        </div>
        {g.students.map((s) => (
          <div key={s.studentId} className="ta-table-row">
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <Link href={`/dashboard/teacher/classes/${classId}/subject-assessments/${groupId}/students/${s.studentId}`}>{s.name}</Link>
              <StatusBadge label={t[`assignments.status.${s.status}`] ?? s.status} tone={toneForInterventionStatus(s.status)} />
            </span>
            <span>{s.latest ? `${s.latest.scorePercent} % · ${s.latest.passed ? t['quiz.subject.passed'] : t['quiz.subject.notPassed']} · ${fillMessage(t['tsa.drill.attempt'], { n: s.latest.attemptNumber })}` : t['tsa.group.noResult']}</span>
            <span>{fillMessage(t['tsa.attempts'], { used: s.attemptsUsed, max: s.maxAttempts })}</span>
          </div>
        ))}
      </section>

      <section className="card ta-card" aria-labelledby="tsa-dist-title">
        <h3 id="tsa-dist-title" style={{ fontSize: 16 }}>{t['tsa.group.distribution']}</h3>
        <p className="ta-msg">{Object.entries(g.distribution).map(([k, n]) => `${k} %: ${n}`).join(' · ')}</p>
        <p className="ta-msg">{t['tsa.group.distributionNote']}</p>
      </section>

      <section className="card ta-card" aria-labelledby="tsa-concept-title">
        <h3 id="tsa-concept-title" style={{ fontSize: 16 }}>{t['tsa.group.byConcept']}</h3>
        {g.perConcept.length === 0 ? (
          <EmptyState title={t['tsa.group.none']} />
        ) : (
          <ul className="ta-msg" style={{ margin: 0, paddingLeft: 18 }}>
            {g.perConcept.map((c) => (
              <li key={c.conceptKey}>{c.conceptName}: {pct(c.scorePercent)} ({c.correct}/{c.total}{c.unanswered ? ` · ${t['quiz.subject.unanswered']} ${c.unanswered}` : ''})</li>
            ))}
          </ul>
        )}
        <p className="ta-msg"><strong>{t['tsa.group.strongest']}:</strong> {g.strongestConcepts.map((c) => c.conceptName).join(', ') || '—'}</p>
        <p className="ta-msg"><strong>{t['tsa.group.gaps']}:</strong> {g.largestGaps.map((c) => c.conceptName).join(', ') || '—'}</p>
      </section>

      <section className="card ta-card" aria-labelledby="tsa-errors-title">
        <h3 id="tsa-errors-title" style={{ fontSize: 16 }}>{t['tsa.group.highError']}</h3>
        {g.highErrorAreas.length === 0 && g.highErrorQuestions.length === 0 ? (
          <p className="ta-msg">—</p>
        ) : (
          <ul className="ta-msg" style={{ margin: 0, paddingLeft: 18 }}>
            {g.highErrorAreas.map((a) => <li key={`a-${a.conceptKey}`}>{a.conceptName}: {Math.round(a.errorRate * 100)} %</li>)}
            {g.highErrorQuestions.map((q) => <li key={`q-${q.questionKey}`}>{q.conceptName} — {fillMessage(t['tsa.group.highErrorQuestion'], { served: q.served, wrong: q.wrong })}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
