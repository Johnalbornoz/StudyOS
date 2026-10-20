import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { getSubjectAssessmentStudentResult, SubjectAssignmentError } from '@/lib/teacher/subject-assessment-assignment.service';
import { ClassChrome } from '../../../../class-chrome';
import { DIFFICULTY_LEVEL_LABEL_KEY, KNOWLEDGE_BUCKET_LABEL_KEY } from '@/lib/subject-assessment/knowledge-bucket';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Overnight 2026-10-16 -- the Teacher's drill-down of ONE student of a subject Test / Mock assignment: the result
 * (LATEST COMPLETED attempt) in total and by concept, the response to every question with the expected answer and
 * explanation, the errors, the concepts needing reinforcement, and the attempt history. Only for a Teacher of this
 * class AND this learner (anyone else: 404).
 */
export default async function SubjectAssessmentStudentPage({ params }: { params: Promise<{ classId: string; groupId: string; studentId: string }> }) {
  const { classId, groupId, studentId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (![classId, groupId, studentId].every((x) => UUID_RE.test(x))) notFound();
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) notFound();
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  let d;
  try {
    d = await getSubjectAssessmentStudentResult(actor.id, classId, groupId, studentId, { locale });
  } catch (error) {
    if (error instanceof SubjectAssignmentError) notFound();
    throw error;
  }
  const r = d.result;
  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="assignments" t={t} locale={locale} />
      <p><Link href={`/dashboard/teacher/classes/${classId}/subject-assessments/${groupId}`}>← {t['tsa.list.results']}</Link></p>
      <section className="card ta-card" aria-labelledby="tsa-drill-title" data-testid="tsa-drill">
        <h2 id="tsa-drill-title" style={{ fontSize: 18 }}>{t['tsa.drill.title']}: {d.name}</h2>
        <p className="ta-msg">{t[`tsa.kind.${d.kind}`]} · {fillMessage(t['tsa.attempts'], { used: d.attemptsUsed, max: d.maxAttempts })}</p>
        {r ? (
          <>
            <p><strong>{t['tsa.drill.total']}: {r.scorePercent} %</strong> · {r.passed ? t['quiz.subject.passed'] : t['quiz.subject.notPassed']} · {fillMessage(t['tsa.drill.attempt'], { n: r.attemptNumber })}</p>
            <p className="ta-msg">{fillMessage(t['quiz.subject.scoreLine'], { correct: r.correct, incorrect: r.incorrect, unanswered: r.unanswered, total: r.total })} · {t['quiz.subject.passRule']}</p>
            <p className="ta-msg">{t['tsa.student.resultNote']}{r.completionReason === 'WINDOW_CLOSED_AFTER_EXIT' ? ` (${t['tsa.drill.closedAsIs']})` : r.completionReason === 'INACTIVITY_CLOSED' ? ` (${t['tsa.drill.closedInactivity']})` : ''}</p>
          </>
        ) : (
          <p className="ta-msg">{t['tsa.group.noResult']}</p>
        )}
      </section>
      {r && (
        <>
          <section className="card ta-card" aria-labelledby="tsa-drill-kb" data-testid="tsa-drill-bucket">
            <h3 id="tsa-drill-kb" style={{ fontSize: 16 }}>{t['kb.title']}: {t[KNOWLEDGE_BUCKET_LABEL_KEY[r.knowledge.knowledgeBucket ?? 'INSUFFICIENT_DIFFICULTY_EVIDENCE']]}</h3>
            <ul className="ta-msg" style={{ margin: 0, paddingLeft: 18 }}>
              {(['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const).map((lv) => {
                const score = lv === 'BASIC' ? r.knowledge.basicScore : lv === 'INTERMEDIATE' ? r.knowledge.intermediateScore : r.knowledge.advancedScore;
                return <li key={lv}>{t[DIFFICULTY_LEVEL_LABEL_KEY[lv]]}: {score === null ? t['kb.noItems'] : `${score} % (${r.knowledge.levelCounts[lv]})`}</li>;
              })}
            </ul>
            <p className="ta-msg">{t['kb.highest']}: {r.knowledge.highestDifficultyDemonstrated ? t[DIFFICULTY_LEVEL_LABEL_KEY[r.knowledge.highestDifficultyDemonstrated]] : '—'}</p>
            <p className="ta-msg">{t['kb.note']}</p>
          </section>
          <section className="card ta-card" aria-labelledby="tsa-drill-concepts">
            <h3 id="tsa-drill-concepts" style={{ fontSize: 16 }}>{t['quiz.subject.perConcept']}</h3>
            <ul className="ta-msg" style={{ margin: 0, paddingLeft: 18 }}>
              {r.perConcept.map((c) => <li key={c.conceptId}>{c.conceptLabel}: {c.scorePercent} % ({c.correct}/{c.total})</li>)}
            </ul>
            <p className="ta-msg"><strong>{t['tsa.drill.reinforce']}:</strong> {r.conceptsToReinforce.map((c) => c.conceptLabel).join(', ') || t['quiz.subject.nothingToReinforce']}</p>
          </section>
          <section className="card ta-card" aria-labelledby="tsa-drill-questions">
            <h3 id="tsa-drill-questions" style={{ fontSize: 16 }}>{t['tsa.drill.byQuestion']}</h3>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 12 }}>
              {r.responses.map((q) => (
                <li key={q.questionIndex} data-status={q.status}>
                  <div>{q.question}</div>
                  <div className="ta-msg"><span className={`chip ${q.status === 'CORRECT' ? 'chip-good' : q.status === 'INCORRECT' ? 'chip-critical' : 'chip-warn'}`}>{t[`tsa.status.${q.status}`]}</span> · {q.conceptLabel}</div>
                  <div className="ta-msg">{t['tsa.drill.answer']}: {q.studentAnswer || '—'}</div>
                  {q.status !== 'CORRECT' && <div className="ta-msg">{t['tsa.drill.expected']}: {q.correctAnswer}</div>}
                  {q.explanation && <div className="ta-msg">{t['tsa.drill.explanation']}: {q.explanation}</div>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
      <section className="card ta-card" aria-labelledby="tsa-drill-history">
        <h3 id="tsa-drill-history" style={{ fontSize: 16 }}>{t['tsa.drill.history']}</h3>
        <ul className="ta-msg" style={{ margin: 0, paddingLeft: 18 }}>
          {d.history.map((h) => (
            <li key={h.attemptNumber}>
              {fillMessage(t['tsa.drill.attempt'], { n: h.attemptNumber })}: {h.state === 'COMPLETED' ? `${h.scorePercent} %` : t[`quiz.subject.state.${h.state === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED'}`]}
              {h.completionReason === 'WINDOW_CLOSED_AFTER_EXIT' ? ` (${t['tsa.drill.closedAsIs']})` : h.completionReason === 'INACTIVITY_CLOSED' ? ` (${t['tsa.drill.closedInactivity']})` : ''}
              {r && h.attemptNumber === r.attemptNumber ? ' ✓' : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
