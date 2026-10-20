/**
 * B4 -- fixture preview of the unified assessment experience. LOCAL DEVELOPMENT ONLY.
 *
 * It renders the shared components with hand-written view contracts so the screens can be inspected in a
 * browser without an account, a database or any real data. It reads nothing and writes nothing.
 *
 * It does not exist in a deployed build: any Vercel environment and any production build return 404.
 */
import { notFound } from 'next/navigation';
import NextChallengeCard from '@/app/dashboard/NextChallengeCard';
import { AssessmentContinuation, AssessmentResult, AssessmentRunHeader, AssessmentSetup, ExamAttemptOptions } from '@/components/assessment/AssessmentExperience';
import { getMessages, isLocale } from '@/lib/i18n/messages';
import type { NextChallengeView } from '@/lib/experience/next-challenge';
import type { AssessmentContinuationView } from '@/lib/assessment-experience/continuation';
import type { AssessmentPreview, AssessmentResultView, AssessmentRunView, AssessmentSetupView, ExamAttemptOption } from '@/lib/assessment-experience/views';

export const dynamic = 'force-dynamic';

const preview = (over: Partial<AssessmentPreview>): AssessmentPreview => ({ availability: 'AVAILABLE', effort: { questions: null, minutes: null }, targets: { requested: 7, covered: 7 }, limitations: [], canStart: true, ...over });

const SETUP_KNOWN: AssessmentSetupView = {
  family: 'LEARNING',
  state: 'READY',
  preview: null,
  depthOptions: [
    { depth: 'QUICK', preview: preview({ effort: { questions: 5, minutes: 9 } }) },
    { depth: 'BALANCED', preview: preview({ effort: { questions: 11, minutes: 22 } }) },
    { depth: 'DEEP', preview: preview({ effort: { questions: 16, minutes: 34 } }) },
  ],
};
const SETUP_NO_DURATION: AssessmentSetupView = {
  family: 'LEARNING',
  state: 'READY',
  preview: null,
  depthOptions: [
    { depth: 'QUICK', preview: preview({ effort: { questions: 4, minutes: null } }) },
    { depth: 'BALANCED', preview: preview({ availability: 'PARTIAL', effort: { questions: 7, minutes: null }, targets: { requested: 7, covered: 5 }, limitations: ['NOT_ENOUGH_QUESTIONS'] }) },
    { depth: 'DEEP', preview: preview({ availability: 'UNAVAILABLE', targets: { requested: 7, covered: 0 }, limitations: ['NOT_ENOUGH_QUESTIONS'], canStart: false }) },
  ],
};
const SETUP_PARTIAL_ONLY: AssessmentSetupView = {
  family: 'LEARNING',
  state: 'PARTIAL',
  preview: null,
  depthOptions: [
    { depth: 'QUICK', preview: preview({ availability: 'PARTIAL', effort: { questions: 3, minutes: null }, targets: { requested: 7, covered: 3 }, limitations: ['NOT_ENOUGH_QUESTIONS', 'SOME_TOPICS_NOT_READY'] }) },
    { depth: 'BALANCED', preview: preview({ availability: 'UNAVAILABLE', targets: { requested: 7, covered: 0 }, limitations: ['NOT_ENOUGH_QUESTIONS'], canStart: false }) },
    { depth: 'DEEP', preview: preview({ availability: 'UNAVAILABLE', targets: { requested: 7, covered: 0 }, limitations: ['NOT_ENOUGH_QUESTIONS'], canStart: false }) },
  ],
};
const SETUP_UNAVAILABLE: AssessmentSetupView = { family: 'EXAM_PREPARATION', state: 'UNAVAILABLE', depthOptions: [], preview: preview({ availability: 'UNAVAILABLE', targets: { requested: 4, covered: 0 }, limitations: ['NOT_ENOUGH_QUESTIONS', 'SOME_TOPICS_NOT_READY'], canStart: false }) };

const EXAM_OPTIONS: ExamAttemptOption[] = [
  { type: 'EXAM_PRACTICE', available: true, reason: null },
  { type: 'REDUCED_MOCK', available: true, reason: null },
  { type: 'FULL_MOCK', available: false, reason: 'FIDELITY_NOT_VERIFIED' },
  { type: 'EXAM_CHALLENGE', available: false, reason: 'CONTENT_NOT_READY' },
];

const RUN_PRACTICE: AssessmentRunView = { snapshotId: 'fixture', family: 'LEARNING', path: 'LEARNING_ACTIVITY', progress: { answered: 4, total: 11 }, capabilities: { canUseAIHelp: true, canShowImmediateFeedback: true, canNavigateBack: false, hasMarks: false, requiresIntegrity: false } };
const RUN_OFFICIAL: AssessmentRunView = { snapshotId: 'fixture', family: 'OFFICIAL_EXAM', path: 'OFFICIAL_MOCK', progress: { answered: 12, total: 50 }, capabilities: { canUseAIHelp: false, canShowImmediateFeedback: false, canNavigateBack: true, hasMarks: true, requiresIntegrity: true } };

const LABELS: Record<string, string> = { c1: 'Funciones cuadráticas', c2: 'Vértice de una parábola', c3: 'Factorización', c4: 'Discriminante', c5: 'Raíces de una ecuación' };

const RESULT_LEARNING: AssessmentResultView = {
  snapshotId: 'fixture',
  family: 'LEARNING',
  path: 'LEARNING_ACTIVITY',
  happened: { questions: 11, answered: 9, scored: 9, pendingReview: 0, scorePercent: 78, marks: null },
  coverage: { intended: 5, withEvidence: 3 },
  learningAttribution: 'AVAILABLE',
  examGaps: [],
  concepts: [
    { canonicalConceptId: 'c1', status: 'EVIDENCE_OBTAINED', state: { before: 'LEARNING', after: 'DEVELOPING', changed: true }, direction: 'UP' },
    { canonicalConceptId: 'c2', status: 'EVIDENCE_OBTAINED', state: { before: 'DEVELOPING', after: 'DEVELOPING', changed: false }, direction: 'UP' },
    { canonicalConceptId: 'c3', status: 'EVIDENCE_OBTAINED', state: { before: 'DEVELOPING', after: 'LEARNING', changed: true }, direction: 'DOWN' },
    { canonicalConceptId: 'c4', status: 'NOT_ANSWERED', state: null, direction: null },
    { canonicalConceptId: 'c5', status: 'NOT_ATTRIBUTABLE', state: null, direction: null },
  ],
};
const RESULT_OFFICIAL: AssessmentResultView = {
  snapshotId: 'fixture',
  family: 'OFFICIAL_EXAM',
  path: 'OFFICIAL_MOCK',
  happened: { questions: 50, answered: 50, scored: 50, pendingReview: 0, scorePercent: 64, marks: { obtained: 32, available: 50 } },
  coverage: { intended: 0, withEvidence: 0 },
  learningAttribution: 'UNAVAILABLE',
  examGaps: [{ canonicalConceptId: 'c3', learningObjectiveId: 'lo-1', severity: 'HIGH' }, { canonicalConceptId: 'c4', learningObjectiveId: 'lo-2', severity: 'MEDIUM' }],
  concepts: [],
};

const CONT_CANONICAL: AssessmentContinuationView = { authority: 'CANONICAL', primary: { kind: 'NEXT_CHALLENGE', href: '/dashboard/today', conceptId: 'c3', subjectId: 's1', activityType: 'PRACTICE' }, secondary: [{ kind: 'BACK_TO_PATH', href: '/dashboard/path' }] };
const CONT_RETURN: AssessmentContinuationView = { authority: 'NONE', primary: { kind: 'RETURN', href: '/dashboard/today' }, secondary: [{ kind: 'BACK_TO_EXAM_PREP', href: '/dashboard/exam-prep' }] };

const TODAY: NextChallengeView = { status: 'READY', authority: 'CANONICAL', conceptId: 'c3', subjectId: 's1', activityType: 'PRACTICE', challenge: 'PRACTICE', stage: null, reinforce: false, itemCount: 6, facts: [] };

export default async function ExperiencePreviewPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV) notFound();
  const { lang } = await searchParams;
  const locale = lang && isLocale(lang) ? lang : 'es';
  const t = getMessages(locale);
  const block = (n: number, title: string) => <h2 style={{ margin: 'var(--space-6) 0 var(--space-2)', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{n}. {title}</h2>;
  return (
    <main lang={locale} style={{ maxWidth: 760, margin: '0 auto', padding: 'var(--space-5) var(--space-4) var(--space-8)' }}>
      <p className="ui-hint">Fixture preview — local development only. No account, no data.</p>
      {block(1, 'Today recommendation')}
      <NextChallengeCard view={TODAY} conceptLabel={LABELS.c3} subjectName="Matemáticas" studentId="fixture" t={t} locale={locale} />
      {block(2, 'Practice setup — known effort')}
      <AssessmentSetup view={SETUP_KNOWN} t={t} scopeLabel="Funciones cuadráticas · 7 conceptos" action="/experience-preview" hidden={{ lang: locale }} backHref="/experience-preview" />
      {block(2, 'Practice setup — duration unknown, partial coverage')}
      <AssessmentSetup view={SETUP_NO_DURATION} t={t} scopeLabel="Funciones cuadráticas · 7 conceptos" action="/experience-preview" hidden={{ lang: locale }} backHref="/experience-preview" />
      {block(2, 'Practice setup — only part of the topic can be practised')}
      <AssessmentSetup view={SETUP_PARTIAL_ONLY} t={t} scopeLabel="Funciones cuadráticas · 7 conceptos" action="/experience-preview" hidden={{ lang: locale }} backHref="/experience-preview" />
      {block(2, 'Practice setup — unavailable')}
      <AssessmentSetup view={SETUP_UNAVAILABLE} t={t} action="/experience-preview" backHref="/experience-preview" />
      {block(3, 'Active activity — practice / official')}
      <AssessmentRunHeader view={RUN_PRACTICE} t={t} title="Funciones cuadráticas" />
      <div style={{ height: 'var(--space-3)' }} />
      <AssessmentRunHeader view={RUN_OFFICIAL} t={t} title={(t as Record<string, string>)['ex.type.FULL_MOCK']} timer={<span className="chip tabular" role="timer" aria-label="Time remaining">01:12:40</span>} />
      {block(4, 'Result — learning')}
      <AssessmentResult view={RESULT_LEARNING} t={t} conceptLabels={LABELS}>
        {/* 5. Continuation */}
        <AssessmentContinuation view={CONT_CANONICAL} t={t} conceptLabel={LABELS.c3} />
      </AssessmentResult>
      {block(4, 'Result — official exam, score without learning attribution')}
      <AssessmentResult view={RESULT_OFFICIAL} t={t} conceptLabels={LABELS}>
        <AssessmentContinuation view={CONT_RETURN} t={t} />
      </AssessmentResult>
      {block(6, 'Exam preparation — attempt options and mock availability')}
      <ExamAttemptOptions options={EXAM_OPTIONS} t={t} hrefs={{ EXAM_PRACTICE: '/experience-preview', REDUCED_MOCK: '/experience-preview', FULL_MOCK: '/experience-preview', EXAM_CHALLENGE: '/experience-preview' }} />
    </main>
  );
}
