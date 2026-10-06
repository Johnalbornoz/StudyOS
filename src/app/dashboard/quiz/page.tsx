'use client';

import { SafetyNotice, safetyFromBody, type SafetyNoticeData } from '@/components/safety/SafetyNotice';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import LearningSupportStatus, { type LearningSupportContext } from '../LearningSupportStatus';
import { getMessages, LOCALES, LOCALE_NAMES, Locale } from '@/lib/i18n/messages';
import MathText from '@/components/MathText';
import ProveFocusLoading from '@/components/ProveFocusLoading';
import { deriveResponseEvidenceContract } from '@/lib/lx/response-evidence-contract';
import type { QuestionType, ExpectedReasoningType } from '@/services/quiz-generation.service';
import type { EvidenceMode } from '@/lib/activity-taxonomy';
import type { TeachingExperienceView } from '@/lib/lx/teaching-experience';
import type { LearningActivityKind } from '@/lib/lx/continuation';
import { conceptMissionPath, quizInstanceKey } from '@/lib/lx/continuation';
import { LICENSE_CTA_PATH } from '@/lib/lx/session-launch-outcome';
import { consumeLaunchTeachingHandoff } from '@/lib/lx/launch-teaching-handoff';
import TeachingIntro from './TeachingIntro';
import ContextualHelp from './ContextualHelp';
import type { TutorEntryMode } from '@/lib/tutor/context-pack';
import ContinuationPanel from './ContinuationPanel';
import DifficultyIndicator from '@/components/DifficultyIndicator';
// LX-8 R33: optional modality controls are never on the critical
// rendering path -- both use browser-only APIs (speechSynthesis /
// SpeechRecognition) and are irrelevant to the very first paint of a
// question, so their code loads on demand rather than in the initial
// quiz bundle. Each component already renders nothing until it has
// confirmed browser support, so `ssr: false` costs no extra flicker.
const ReadAloudButton = dynamic(() => import('../ReadAloudButton'), { ssr: false });
// LX-8R3: the ONE canonical unified response surface for every
// learner-facing open response (main quiz, Retention resume,
// Assessment verification) -- mixed prose/math blocks, a single mic,
// and MathLive's own keyboard, replacing the old two-box (math answer
// + separate reasoning) UX (LX-8R2-R1's `MathResponseComposer`,
// retired). Mounts a real DOM custom element (<math-field>, from the
// `mathlive` package) for any math block, so ssr:false, same pattern
// as every other browser-only modality control above. Never import
// MathExpressionEditor/MathVoiceInput/VoiceInputButton directly for a
// response surface from a page -- they are implementation details this
// ONE composer owns.
const UnifiedResponseComposer = dynamic(() => import('@/components/UnifiedResponseComposer'), { ssr: false });
import { buildInteractionContract, type ModalityCapabilities } from '@/lib/lx/interaction-contract';
import { buildActivityLanguageContext } from '@/lib/lx/activity-language';
import { logInteraction } from '@/lib/lx/multimodal-observability';
import { milestoneFeedbackKey, type MilestoneType } from '@/lib/lx/progression-milestones';
import { resolveResultMilestone } from '@/lib/experience/result-milestone';
import { isMathCapableContext } from '@/lib/lx/math-response-contract';
import { deserializeResponseDocument, isEmptyResponseDocument, toGraderText } from '@/lib/lx/response-document';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Skeleton } from '@/components/ui/Skeleton';
import { SessionHeader } from '@/components/learning/SessionHeader';
import {
  activityKindForMode,
  kindLabelKey,
  kindPurposeKey,
  kindDoneKey,
  resolveActivityOutcome,
  outcomeKey,
  classifySubmitFailure,
  submitFailureKey,
  type SubmitFailure,
} from '@/lib/experience/learning-session';
import {
  browserDraftStorage,
  clearDraft,
  draftHasInput,
  loadDraft,
  purgeForeignDrafts,
  questionFingerprint,
  saveDraft,
  type DraftPending,
} from '@/lib/experience/session-draft';

// CANON-V2-FINAL-HARDENING Section 5/12 -- widened to include the 3
// canonical activities added after canonical_prove (canonical_retain,
// canonical_transfer, canonical_learn_check) -- the backend
// (canonical-implementation-registry.ts) has issued real launch URLs
// with these `mode=` values since that phase; this page's own type/
// records must recognize them for real UI/backend parity, not silently
// fall through to a mislabeled default.
type QuizMode =
  | 'topic_practice'
  | 'review'
  | 'quick_check'
  | 'retention_check'
  | 'cumulative_assessment'
  | 'exam_simulation'
  | 'diagnostic_check'
  | 'canonical_prove'
  | 'canonical_retain'
  | 'canonical_transfer'
  | 'canonical_learn_check';
// Phase 3A: which quiz modes are Evidence Mode PRACTICE (AI hints allowed)
// vs. INDEPENDENT/ASSESSMENT (no AI assistance) -- mirrors
// src/lib/activity-taxonomy.ts's fixed Activity Type -> Evidence Mode
// mapping. Duplicated here (not imported) because this is a client
// component and that module is server-only; the source of truth for
// enforcement is still the server (see /api/quizzes/hint), this only
// controls whether the Hint button even renders.
// CANON-V2-FINAL-HARDENING -- canonical_learn_check is EvidenceMode
// PRACTICE (assistance explicitly allowed, activity-taxonomy.ts) --
// same "help/Tutor available" presentation topic_practice/review get.
const PRACTICE_EVIDENCE_MODES: readonly QuizMode[] = ['topic_practice', 'review', 'canonical_learn_check'];
// UX-5 closure: which allowed learning surface the Tutor is opened FROM
// (presentation/framing only). Only PRACTICE-evidence modes appear -- the
// Tutor is never linked from Prove / Retain / Transfer / Assessment.
const TUTOR_FROM_QUIZ_MODE: Partial<Record<QuizMode, TutorEntryMode>> = {
  topic_practice: 'PRACTICE',
  review: 'REVIEW',
  canonical_learn_check: 'LEARN_CHECK',
};
// LX-8R1 R1: the ONE place this page derives its coarse, presentation-
// only EvidenceMode mirror from quizMode -- extracted so it is computed
// once and fed into buildInteractionContract (interaction-contract.ts)
// as that module's `integrityMode` INPUT, rather than a second,
// independently-maintained copy of the same ternary living next to the
// modality-rendering JSX. Still never the enforcement authority --
// canUseAI (server) remains that.
function coarseEvidenceModeForQuizMode(quizMode: QuizMode): EvidenceMode {
  if (PRACTICE_EVIDENCE_MODES.includes(quizMode)) return 'PRACTICE';
  if (quizMode === 'cumulative_assessment' || quizMode === 'exam_simulation') return 'ASSESSMENT';
  return 'INDEPENDENT';
}
// Phase 6 Closeout A: which explanatory sentence the in-flow
// assisted/independent indicator shows. Purely presentation copy
// selection off the SAME fixed quizMode -> Evidence Mode taxonomy fact
// the Hint button already uses -- no policy, no threshold. A mode that
// is PRACTICE_EVIDENCE_MODES shows the "help available" copy; every
// other mode is independent and shows the context-specific note below.
const QUIZ_SUPPORT_CONTEXT: Record<QuizMode, LearningSupportContext> = {
  topic_practice: 'PRACTICE',
  review: 'PRACTICE',
  quick_check: 'SOLO',
  retention_check: 'SOLO',
  cumulative_assessment: 'ASSESSMENT',
  exam_simulation: 'ASSESSMENT',
  diagnostic_check: 'DIAGNOSTIC',
  canonical_prove: 'SOLO',
  // CANON-V2-FINAL-HARDENING -- RETENTION_CHECK/TRANSFER are both
  // EvidenceMode INDEPENDENT (activity-taxonomy.ts) -- no assistance,
  // same SOLO presentation Prove already uses. LEARN_CHECK is
  // EvidenceMode PRACTICE (assistance explicitly allowed) -- same
  // presentation as ordinary Practice.
  canonical_retain: 'SOLO',
  canonical_transfer: 'SOLO',
  canonical_learn_check: 'PRACTICE',
};
type AnswerFormat = 'single_choice' | 'multi_choice' | 'text' | 'matching' | 'ordering' | 'classification';

interface VisualAid {
  kind: 'diagram' | 'chart';
  svg?: string;
  chartData?: { chartType: 'line' | 'bar'; labels: string[]; values: number[]; xLabel?: string; yLabel?: string };
  caption?: string;
}

interface Question {
  index: number;
  conceptId: string;
  question: string;
  type: string;
  answerFormat: AnswerFormat;
  options?: { id: string; text: string }[];
  matchingLeft?: string[];
  matchingRightShuffled?: string[];
  orderingItemsShuffled?: string[];
  classificationItems?: string[];
  classificationCategories?: string[];
  visualAid?: VisualAid;
  difficulty: number;
  calculatorAllowed?: boolean;
  askConfidence?: boolean;
  expectedReasoningType?: string;
  // CANON-V2-PREVIEW-CERT Section 14 -- present only for a canonical
  // Transfer challenge; undefined for every other question.
  transferDepth?: 'NEAR' | 'CONTEXTUAL' | 'HIGHER';
}

type ConfidenceLevel = 'NOT_SURE' | 'SOMEWHAT_SURE' | 'VERY_SURE';

interface SubjectConcept {
  id: string;
  label: string;
  canonicalId: string;
}

interface ReviewItem {
  questionIndex: number;
  conceptId: string;
  conceptLabel: string;
  type: string;
  question: string;
  visualAid?: VisualAid;
  studentAnswer: string;
  correctAnswer: string;
  correct: boolean;
  score: number;
  feedback: string;
  explanation: string;
  /** PEDAGOGICAL_V1 teacher verdict + its three parts (absent on legacy results). */
  finalJudgment?: 'CORRECT' | 'ALMOST' | 'INCORRECT';
  feedbackParts?: { didWell: string | null; missing: string[]; toFix: string | null };
}

const MODE_DEFAULT_MAX: Record<QuizMode, number> = {
  quick_check: 6,
  retention_check: 6,
  topic_practice: 20,
  review: 20,
  cumulative_assessment: 20,
  exam_simulation: 20,
  diagnostic_check: 3,
  // Never actually used: canonical_prove is always isCanonicalFlow (a
  // concept + this single-concept mode), so maxQuestions is omitted
  // from the request entirely (see genBody) and the server's own v1
  // authorization forces exactly 10 regardless of this default.
  canonical_prove: 10,
  // Same "never actually used" reasoning as canonical_prove -- these 3
  // are always isCanonicalFlow too, so maxQuestions is omitted from the
  // request (see genBody) and the server's own v1 authorization/
  // execution-default contract decides the real count regardless of
  // this default. Values mirror QUIZ_MODE_CONFIG's own defaultMax in
  // generate-and-take/route.ts, purely for documentation consistency.
  canonical_retain: 10,
  canonical_transfer: 3,
  canonical_learn_check: 5,
};

const RESULT_MESSAGE_KEY: Record<string, 'quiz.msgExcellent' | 'quiz.msgGood' | 'quiz.msgKeepGoing'> = {
  excellent: 'quiz.msgExcellent',
  good: 'quiz.msgGood',
  keep_going: 'quiz.msgKeepGoing',
};

function MiniChart({ data }: { data: NonNullable<VisualAid['chartData']> }) {
  const width = 420;
  const height = 200;
  const padding = 36;
  const max = Math.max(...data.values, 1);
  const min = Math.min(...data.values, 0);
  const range = max - min || 1;
  const step = (width - padding * 2) / Math.max(1, data.values.length - 1);

  const points = data.values.map((v, i) => {
    const x = padding + i * step;
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return { x, y };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', maxWidth: 420 }}>
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border-default)" strokeWidth={1} />
      <line x1={padding} y1={padding / 2} x2={padding} y2={height - padding} stroke="var(--border-default)" strokeWidth={1} />
      {data.chartType === 'bar'
        ? points.map((p, i) => (
            <rect
              key={i}
              x={p.x - step / 3}
              y={p.y}
              width={(step * 2) / 3}
              height={height - padding - p.y}
              fill="var(--brand)"
              opacity={0.75}
            />
          ))
        : (
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={2}
            />
          )}
      {data.chartType === 'line' && points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--brand)" />)}
      {data.labels.map((l, i) => (
        <text key={i} x={padding + i * step} y={height - padding + 14} fontSize={10} textAnchor="middle" fill="var(--text-muted)">
          {l}
        </text>
      ))}
    </svg>
  );
}

function VisualAidView({ aid }: { aid: VisualAid }) {
  return (
    <div style={{ margin: '0 0 var(--space-4)', padding: 'var(--space-3)', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
      {aid.kind === 'diagram' && aid.svg && (
        <div style={{ maxWidth: 320, margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: aid.svg }} />
      )}
      {aid.kind === 'chart' && aid.chartData && <MiniChart data={aid.chartData} />}
      {aid.caption && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center', margin: '6px 0 0' }}>{aid.caption}</p>
      )}
    </div>
  );
}

/**
 * LX-5R1 -- a canonical PRACTICE -> PRACTICE (or any same-route) LAUNCH
 * still needs a genuinely NEW activity instance: fresh quizId, fresh
 * questions, fresh answers/results, teaching stage reset. React does not
 * reset a component's own state just because its search params changed
 * on a re-render, and query-string-only navigation does not remount a
 * Next.js page on its own -- so this thin wrapper reads the one-shot
 * relaunch nonce ContinuationPanel appends for a same-route relaunch
 * (see src/lib/lx/continuation.ts) and uses it as a React `key`. A key
 * change forces React to fully discard and recreate `QuizPageContent`,
 * which resets EVERY piece of local state in one guaranteed operation --
 * far more robust than manually nulling out each field (quizId,
 * questions, answers, results, teachingExperience, phase, genState,
 * autoStartedRef, ...) and risking missing one. A normal, different-route
 * launch is unaffected: no nonce is present, the key is just `''`.
 */
export default function QuizPage() {
  const searchParams = useSearchParams();
  // PRACTICE_SESSION_RESTART: keyed on the relaunch nonce AND the launch
  // identity, so a continuation that changes only a query param (e.g.
  // difficulty 2 -> 3) is still a brand-new activity instance -- never the
  // stale Results.
  return <QuizPageContent key={quizInstanceKey(searchParams)} />;
}

function QuizPageContent() {
  const searchParams = useSearchParams();
  const subjectId = searchParams.get('subjectId');
  const conceptId = searchParams.get('conceptId');
  const diagnosisId = searchParams.get('diagnosisId'); // only used for mode=diagnostic_check
  const remediationStepId = searchParams.get('remediationStepId'); // only used when launched from a Repair Path step
  // CANON-R5R1 -- set ONLY by resolveCanonicalLaunch's own session-start
  // launch URL. An INTENT signal only, forwarded verbatim to
  // generate-and-take, which independently re-verifies it against a
  // fresh canonical decision before ever trusting it -- see
  // v1-practice-launch-marker.ts's own doc comment. Absent from every
  // legacy/manual launch (My Path, Today's older item rows, ?setup=1).
  const v1Launch = searchParams.get('v1Launch') === '1';
  const modeParam = (searchParams.get('mode') as QuizMode | null) || (conceptId ? 'topic_practice' : 'cumulative_assessment');
  // LX-4K: a canonical learning launch (Concept Mission / LearningDecision
  // -> session/start) always arrives with a concept + a single-concept
  // mode. It already carries its purpose -- no configurator, no
  // learner-facing question-count control. Only legacy/manual
  // multi-concept entry (assessment / exam), or an explicit ?setup=1,
  // still shows the setup form.
  const wantsSetup = searchParams.get('setup') === '1';
  const isCanonicalFlow =
    !wantsSetup && !!conceptId && modeParam !== 'cumulative_assessment' && modeParam !== 'exam_simulation';

  // LX-5D: which finished-activity checkpoint copy to show. Presentation
  // only -- the continuation resolver re-reads canonical truth for the
  // actual next action regardless of this.
  // CANON-V2-FINAL-HARDENING Section 12/13 -- canonical_retain/
  // canonical_transfer/canonical_learn_check now map to their own real
  // checkpoint kind (RETAIN/TRANSFER/LEARN, all already fully supported
  // by checkpointFor -- continuation.ts) instead of silently falling
  // through to the generic PRACTICE checkpoint copy, which would have
  // mislabeled "you just finished a Transfer challenge" as an ordinary
  // Practice session.
  const continuationKind: LearningActivityKind = remediationStepId
    ? 'REINFORCE'
    : modeParam === 'quick_check' || modeParam === 'canonical_prove'
      ? 'PROVE'
      : modeParam === 'retention_check' || modeParam === 'canonical_retain'
        ? 'RETAIN'
        : modeParam === 'canonical_transfer'
          ? 'TRANSFER'
          : modeParam === 'canonical_learn_check'
            ? 'LEARN'
            : 'PRACTICE';

  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [quizMode] = useState<QuizMode>(modeParam);
  // UX-3: the user-facing experience of the launched mode (Entrénalo /
  // Demuéstralo / …). Presentation only -- the mode was chosen upstream.
  const activityKind = activityKindForMode(modeParam, { remediation: !!remediationStepId });
  // UX-3: the concept's own display name for the session header (the
  // subject concepts response already carries it; nothing new is fetched).
  const [conceptLabel, setConceptLabel] = useState('');
  const [maxQuestions, setMaxQuestions] = useState<number>(MODE_DEFAULT_MAX[modeParam]);
  const allowsTopicSelection = quizMode === 'cumulative_assessment' || quizMode === 'exam_simulation';
  const [subjectConcepts, setSubjectConcepts] = useState<SubjectConcept[]>([]);
  const [subjectName, setSubjectName] = useState('');
  // A concept passed alongside cumulative_assessment (e.g. an older
  // link) still pre-selects it -- Solo Check itself is its own quiz
  // mode now (quick_check) and never needs this path.
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>(
    quizMode === 'cumulative_assessment' && conceptId ? [conceptId] : []
  );

  const [quizId, setQuizId] = useState<string | null>(null);
  // Assisted activities (LEARN_CHECK): immediate per-question feedback via
  // /api/quizzes/session/[quizId]/check (read-only -- no evidence). Once
  // checked, the answer is locked, so the answer recorded at submission is
  // always the first attempt.
  const [answerCheck, setAnswerCheck] = useState<{
    index: number;
    status: 'checking' | 'done' | 'unavailable';
    correct?: boolean;
    partial?: boolean;
    feedback?: string | null;
    // non-revealing help (never the answer key -- only the final review shows the solution)
    direction?: string | null;
    scaffold?: string[];
    scaffoldShown?: number;
  } | null>(null);
  const [quizLanguage, setQuizLanguage] = useState<Locale>('es');
  // Until the activity reports its canonical language (generation result or
  // an explicit switch), `at` follows the INTERFACE language -- never a
  // hard-coded 'en'. Otherwise a failure BEFORE the activity starts (e.g.
  // generation refused) would render in English for a Spanish learner.
  const activityLanguageEstablishedRef = useRef(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const [singleChoice, setSingleChoice] = useState<string | null>(null);
  const [multiChoice, setMultiChoice] = useState<string[]>([]);
  // LX-8R3 R1/R2/R8: the ONE unified response document (JSON-serialized
  // via response-document.ts) for a free-text answer -- prose and math
  // blocks together, never a second "reasoning" state field. `kind`
  // (ResponseEvidenceContract) still governs the ONE instruction line
  // shown above the composer (R7); it no longer forks into two
  // separately-tracked pieces of state.
  const [textAnswer, setTextAnswer] = useState('');
  const [matchingAnswer, setMatchingAnswer] = useState<Record<string, string>>({});
  const [orderingAnswer, setOrderingAnswer] = useState<string[]>([]);
  const [classificationAnswer, setClassificationAnswer] = useState<Record<string, string>>({});
  const [confidences, setConfidences] = useState<Record<number, ConfidenceLevel>>({});
  const [confidenceSelected, setConfidenceSelected] = useState<ConfidenceLevel | null>(null);

  // Phase 1D: response-time telemetry. Refs (not state) on purpose --
  // recording a timestamp must never trigger a re-render, and must
  // survive re-renders caused by hints/confidence/validation without
  // being reset. Keyed by question index; each is stamped exactly once.
  const questionPresentedAtRef = useRef<Record<number, string>>({});
  const answerSubmittedAtRef = useRef<Record<number, string>>({});
  const verificationPresentedAtRef = useRef<Record<string, string>>({});
  // R9: move focus to the results heading when results appear.
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  const [phase, setPhase] = useState<'setup' | 'loading' | 'quiz' | 'error'>('setup');
  // LX-4P-PERF-R1 R3: for the canonical flow, question generation runs in
  // the BACKGROUND while the learner is in MODEL/GUIDE -- it never blocks
  // the teaching stage. 'idle' before start, 'loading' in flight, 'ready'
  // batch stored, 'error' recoverable (retry at the Practice transition).
  const [genState, setGenState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [switchingLanguage, setSwitchingLanguage] = useState(false);
  // LX-4P-R1 / LX-4P-R2: a language change during an ACTIVE attempt must
  // never silently regenerate the item the learner is on.
  //  - LX-4P-R2 (preferred): translate the SAME question in place
  //    (/api/quizzes/localize-question) -- same quizId, index, draft,
  //    teaching stage, evidence context.
  //  - LX-4P-R1 (fallback): if a safe translation can't be produced,
  //    the explicit "start a new session" confirmation. `pendingLanguageSwitch`
  //    holds the target locale while that confirmation is pending.
  const [pendingLanguageSwitch, setPendingLanguageSwitch] = useState<Locale | null>(null);
  // LX-4P-R2: the language the current question batch was GENERATED in
  // (the stored quiz_sessions.language). Switching back to it restores
  // the stored original; switching away localizes.
  const [sessionOriginalLanguage, setSessionOriginalLanguage] = useState<Locale | null>(null);
  // LX-4P-R2: pristine batch as generated -- the source for restoring a
  // question when the learner switches back to the original language.
  const originalQuestionsRef = useRef<Question[]>([]);
  // LX-4P-R2: `${index}@${locale}` keys already attempted, so the lazy
  // per-question localization effect never re-fires for the same target.
  const localizeAttemptedRef = useRef<Set<string>>(new Set());
  // LX-4P-R2: true only while the localize dialog fallback path itself
  // failed validation/provider (drives the R15 "can't do it in place" copy).
  const [localizeFailedFallback, setLocalizeFailedFallback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Human Agency P0-4: fixed safety response from the server (no AI involved).
  const [safety, setSafety] = useState<SafetyNoticeData | null>(null);
  // RELEASE-R1 PART D: set only for a canonical-state MISMATCH
  // (INVALID_GENERATION_CONTRACT/ZERO_GAP_PRACTICE_MISMATCH) -- never for
  // a genuine generation/provider failure. Drives a DIFFERENT recovery
  // UX in the 'error' phase render below (never the generic
  // "couldn't prepare this activity" message for a KNOWN canonical
  // mismatch).
  const [errorReason, setErrorReason] = useState<string | null>(null);
  // RELEASE-R1 PART D: the SAME reason-tracking as `errorReason` above,
  // but for `startCanonicalActivity`'s own background generation wave
  // (genState), which is a genuinely different failure/retry path (see
  // the LX-9 FINAL note at its retry button) and must not be conflated
  // with the top-level `phase==='error'` state.
  const [genErrorReason, setGenErrorReason] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);
  const [reviewing, setReviewing] = useState(false);
  // UX-3 (silent submit failure): a failed submission is its own visible,
  // recoverable state -- never an incorrect answer, never silent. The
  // answers stay in state; Retry re-sends the SAME set.
  const [submitFailure, setSubmitFailure] = useState<SubmitFailure | null>(null);
  // UX-3: the server answered a re-send with `alreadySubmitted` (the first
  // response was lost in transit). Nothing changed server-side; the learner
  // continues from canonical truth.
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  // UX-3 (refresh continuity): true once a local draft of THIS session was
  // restored -- drives the one-line "picking up where you left off" note.
  const [resumedFromDraft, setResumedFromDraft] = useState(false);
  const draftFingerprintRef = useRef<string | null>(null);
  const draftRestoreAttemptedRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<{ index: number; pending: DraftPending } | null>(null);
  const resumedFromDraftRef = useRef(false);
  // UX-3: a synchronous guard -- two quick clicks can never send two submissions.
  const submittingRef = useRef(false);

  // LX-4R R4: per-question hints moved into the ContextualHelp surface
  // (/api/learning/contextual-help). The legacy toggle/state is gone.

  // LX-5R Issue 2: the quiz no longer writes a Focus Mode origin. The
  // quiz URL already carries subjectId + conceptId, so LearnerShell
  // derives Exit from the current route -- which cannot go stale the way
  // a shared sessionStorage key did (a later transfer/remediation would
  // read a previous quiz's concept). See LearnerShell + FocusOriginBeacon.

  // LX-4R: the teach-first phase + canonical support presentation.
  const [teachingExperience, setTeachingExperience] = useState<TeachingExperienceView | null>(null);
  const [teachingStage, setTeachingStage] = useState<'teaching' | 'questions'>('questions');
  // CANON-V2-PREVIEW-CERT Section 14 -- canonical_transfer's own
  // one-time pre-execution framing screen (Transfer has no
  // EXPLAIN/MODEL/GUIDE teaching stage of its own -- it's INDEPENDENT --
  // so this is a dedicated gate, not a reuse of `teachingStage`).
  const [transferIntroDismissed, setTransferIntroDismissed] = useState(false);
  const [countAuthority, setCountAuthority] = useState<{ status: string; zeroGapMismatch?: boolean } | null>(null);

  // Phase 3B: student verification flow -- one additional confirming
  // question per concept whose evidence was ambiguous, never shown for
  // strong evidence. Keyed by conceptId since a Cumulative/Mock attempt
  // can surface more than one at once.
  const [verificationAnswers, setVerificationAnswers] = useState<Record<string, string>>({});
  const [verificationSubmitting, setVerificationSubmitting] = useState<Record<string, boolean>>({});
  const [verificationResults, setVerificationResults] = useState<Record<string, { outcome: string; evidenceQualification?: { strength: string } }>>({});
  const [verificationError, setVerificationError] = useState<Record<string, boolean>>({});

  // Phase 4-R: resuming an EXISTING pending verification the Decision
  // Engine's SOLO_VERIFY action pointed at (learning-session-engine.service.ts's
  // verificationLaunch) -- entirely separate from the normal quiz-taking
  // flow above (no generate-and-take call, no new quiz_session, no new
  // verification_attempts row). `resumeQuizId` is the EXISTING quiz
  // session id from the launch URL, distinct from the `quizId` state
  // above (which is only ever set by a fresh generate-and-take call).
  const resumeVerifyAttemptId = searchParams.get('verifyAttemptId');
  const resumeQuizId = searchParams.get('quizId');
  const [resumePhase, setResumePhase] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [resumeQuestion, setResumeQuestion] = useState<any>(null);
  const [resumeAnswer, setResumeAnswer] = useState('');
  const [resumeSubmitting, setResumeSubmitting] = useState(false);
  const [resumeOutcome, setResumeOutcome] = useState<any>(null);
  const [resumeError, setResumeError] = useState(false);
  const resumePresentedAtRef = useRef<string | null>(null);

  // LX-4P-R3: `t` is the GLOBAL interface locale (account/settings, the
  // pre-activity setup form, and the app shell -- e.g. "Salir" -- which
  // this file never renders). `at` ("activity translations") is the
  // canonical ACTIVITY language -- the entire active learning experience
  // once an activity has actually started (MODEL/GUIDE/PRACTICE/PROVE,
  // question chrome, assistance, response-contract, confidence, math
  // toolbar, hints, feedback, retry, verification) reads ONLY from `at`,
  // never from `t`, and never infers a language of its own. `quizLanguage`
  // is the SAME canonical value already threaded to TeachingIntro /
  // ContextualHelp / ContinuationPanel -- this just makes every OTHER
  // string on this page follow it too, instead of silently defaulting to
  // the interface locale.
  const t = getMessages(locale);
  const at = getMessages(quizLanguage);
  // Demo mode (no LEARNING_FULL_ACCESS): an account/licence message, so it
  // uses the interface language (`t`), with the path to activate a licence
  // -- never the generic "try again".
  const licenseRequiredCard = () => (
    <div className="card empty-state" role="note">
      <strong>{t['learning.licenseRequiredTitle']}</strong>
      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{t['learning.licenseRequiredBody']}</p>
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href={LICENSE_CTA_PATH} className="btn btn-primary">{t['license.demoBannerCta']}</Link>
        <Link href={subjectId && conceptId ? conceptMissionPath({ subjectId, conceptId }) : '/dashboard'} className="btn btn-secondary">
          {t['continuation.backToConcept']}
        </Link>
      </div>
    </div>
  );

  // LX-8R1 R1: ONE interaction-policy authority. Runtime browser
  // capability detection is an INPUT to buildInteractionContract
  // (interaction-contract.ts), never an independent modality-
  // eligibility rule this page decides on its own -- this page must
  // never re-derive "voice allowed because answerFormat === text"
  // anywhere; it only reads interactionContract.inputModes/outputModes
  // below.
  const [modalityCapabilities, setModalityCapabilities] = useState<ModalityCapabilities>({
    speechRecognitionSupported: false,
    speechSynthesisSupported: false,
  });
  useEffect(() => {
    setModalityCapabilities({
      speechRecognitionSupported: typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
      speechSynthesisSupported: typeof window !== 'undefined' && 'speechSynthesis' in window,
    });
  }, []);

  // LX-8R1 R3: activityLanguage (the content's own language, governs
  // TTS) and expectedResponseLanguage (governs STT) are kept as two
  // distinct fields on ONE context object, even though they resolve
  // identically today -- the seam a future language-learning surface
  // would widen, with zero VoiceInputButton/ReadAloudButton
  // architecture change.
  const activityLanguageContext = buildActivityLanguageContext(quizLanguage);
  const coarseEvidenceMode = coarseEvidenceModeForQuizMode(quizMode);
  const currentQuestionForContract = questions[current] ?? null;
  const interactionContract = useMemo(
    () =>
      currentQuestionForContract
        ? buildInteractionContract({
            integrityMode: coarseEvidenceMode,
            answerFormat: currentQuestionForContract.answerFormat,
            activityLanguage: activityLanguageContext,
            capabilities: modalityCapabilities,
          })
        : null,
    // activityLanguageContext is a fresh object every render (a plain
    // pure builder call, not state) -- depend on its primitive fields,
    // never the object identity, so this memo doesn't recompute every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentQuestionForContract, coarseEvidenceMode, activityLanguageContext.activityLanguage, activityLanguageContext.expectedResponseLanguage, modalityCapabilities],
  );

  // LX-8R1 observability: INTERACTION_CONTRACT_READY once per question
  // shown (never per re-render -- a hint toggle or confidence pick must
  // not spam this event).
  const loggedInteractionContractForRef = useRef<number>(-1);
  useEffect(() => {
    if (!interactionContract || loggedInteractionContractForRef.current === current) return;
    loggedInteractionContractForRef.current = current;
    logInteraction('INTERACTION_CONTRACT_READY', {
      conceptId: conceptId ?? undefined,
      inputModes: interactionContract.inputModes.join(','),
      outputModes: interactionContract.outputModes.join(','),
      supportLevel: interactionContract.supportLevel ?? undefined,
      activityLanguage: interactionContract.activityLanguage,
      expectedResponseLanguage: interactionContract.expectedResponseLanguage,
      integrityMode: interactionContract.integrityMode,
    });
  }, [interactionContract, current, conceptId]);

  useEffect(() => {
    async function init() {
      if (!subjectId) {
        setError('Missing subjectId in the URL');
        setPhase('error');
        return;
      }
      try {
        const [meRes, langRes] = await Promise.all([fetch('/api/me'), fetch('/api/language')]);
        const me = await meRes.json();
        const lang = await langRes.json();
        if (lang.locale) {
          setLocale(lang.locale);
          if (!activityLanguageEstablishedRef.current) setQuizLanguage(lang.locale);
        }
        if (!me.studentId) throw new Error('Could not identify the student');
        setStudentId(me.studentId);

        const conceptsRes = await fetch(
          `/api/subjects/${subjectId}/concepts?studentId=${me.studentId}&language=${lang.locale || 'en'}`
        );
        const conceptsBody = await conceptsRes.json();
        if (conceptsRes.ok) {
          if (allowsTopicSelection) setSubjectConcepts(conceptsBody.data.concepts || []);
          setSubjectName(conceptsBody.data.subjectName || '');
          const match = conceptId
            ? ((conceptsBody.data.concepts || []) as SubjectConcept[]).find((c) => c.id === conceptId || c.canonicalId === conceptId)
            : null;
          if (match?.label) setConceptLabel(match.label);
        }
      } catch (err: any) {
        setError(err.message);
        setPhase('error');
      }
    }
    init();
  }, [subjectId]);

  // LX-4P-PERF-R1 R22: cheap client journey marks (T0..T6) -> one console
  // line each, no telemetry infra. `[perf]` so ops can grep a real TTFI.
  const perfMark = useCallback((label: string) => {
    try {
      console.log('[perf]', JSON.stringify({ label, t: Math.round(performance.now()), conceptId, quizMode }));
    } catch { /* performance unavailable */ }
  }, [conceptId, quizMode]);

  // Apply one generate-and-take response to state (everything EXCEPT phase
  // / teaching stage, which the caller owns). Shared by generateQuiz and
  // the canonical background flow.
  const applyGenResult = useCallback((data: any) => {
    setQuizId(data.quizId);
    activityLanguageEstablishedRef.current = true;
    setQuizLanguage(data.language);
    // LX-4P-R2: remember the generated language + the pristine batch, so a
    // later same-item localization can translate away and restore back.
    setSessionOriginalLanguage(data.language);
    originalQuestionsRef.current = data.quiz.questions;
    localizeAttemptedRef.current = new Set();
    setQuestions(data.quiz.questions);
    setCountAuthority(data.countAuthority ?? null);
    setCurrent(0);
    setAnswers({});
    setResults(null);
    setReviewing(false);
    setSubmitFailure(null);
    setAlreadySubmitted(false);
    // UX-3: identity of this exact question batch, for draft scoping.
    draftFingerprintRef.current = questionFingerprint(data.quiz.questions);
  }, []);

  const genBody = useCallback(
    (sid: string, languageOverride?: Locale) => ({
      studentId: sid,
      subjectId,
      conceptId: conceptId || undefined,
      conceptIds: selectedConceptIds.length > 0 ? selectedConceptIds : undefined,
      quizMode,
      // LX-4I: the learner never sets evidence sufficiency for a canonical
      // Practice/Prove flow. The route applies its own per-mode canonical
      // count. Legacy/manual setup still passes the slider value.
      ...(isCanonicalFlow ? {} : { maxQuestions }),
      ...(languageOverride ? { language: languageOverride } : {}),
      ...(v1Launch ? { v1Launch: true } : {}),
    }),
    [subjectId, conceptId, selectedConceptIds, quizMode, isCanonicalFlow, maxQuestions, v1Launch],
  );

  const generateQuiz = useCallback(
    async (sid: string, languageOverride?: Locale) => {
      setPhase('loading');
      setError(null);
      setErrorReason(null);
      try {
        const genRes = await fetch('/api/quizzes/generate-and-take', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(genBody(sid, languageOverride)),
        });
        const body = await genRes.json();
        if (!genRes.ok) {
          // RELEASE-R1 PART D: a canonical-state mismatch (the server's
          // ZERO_GAP backstop fired -- canonical authority no longer
          // considers this activity executable, most likely a stale
          // client CTA or a race with a just-completed activity) is NOT
          // a generation failure. Never the generic "couldn't prepare
          // this activity" message for this known, machine-readable case.
          if (body.error === 'INVALID_GENERATION_CONTRACT' && body.reason === 'ZERO_GAP_PRACTICE_MISMATCH') {
            setErrorReason(body.reason);
            setPhase('error');
            return;
          }
          // Demo mode: AI-generated activities need a licence. Retrying cannot
          // help, so this is its own explained state, never "try again".
          if (genRes.status === 403 && body.error === 'ENTITLEMENT_REQUIRED') {
            setErrorReason('ENTITLEMENT_REQUIRED');
            setPhase('error');
            return;
          }
          throw new Error(body.message || 'Could not generate the quiz');
        }

        applyGenResult(body.data);
        setGenState('ready');
        setTeachingExperience(null);
        setTeachingStage('questions');
        setPhase('quiz');

        // LX-4R R1: fetch the canonical Teaching Experience for this
        // activity. Presentation only -- SupportLevel was decided server-side.
        void fetch(`/api/learning/teaching-intent?studentId=${sid}&quizId=${body.data.quizId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((b) => {
            const view: TeachingExperienceView | null = b?.data?.teachingExperience ?? null;
            setTeachingExperience(view);
            if (view && view.stages.some((s: string) => s === 'EXPLAIN' || s === 'MODEL' || s === 'GUIDE')) {
              setTeachingStage('teaching');
            }
          })
          .catch(() => {});
      } catch (err: any) {
        setError(err.message);
        setPhase('error');
      }
    },
    [genBody, applyGenResult]
  );

  // LX-4P-PERF-R1 R3/R4/R6: the canonical activity start. TeachingIntent
  // (resolved from conceptId, NOT quizId) and question generation run in
  // PARALLEL. For a teach-first experience the teaching stage renders as
  // soon as TeachingIntent resolves -- it never waits for the question
  // batch, which keeps preparing in the background while the learner is
  // in MODEL/GUIDE.
  const startCanonicalActivity = useCallback(
    (sid: string) => {
      setError(null);
      setGenErrorReason(null);
      perfMark('T0_start');

      // wave A -- canonical Teaching Experience, no quiz session needed.
      // LX-4P-PERF-R1C C12: when the Continue handoff already carries the
      // server-derived Teaching Experience for THIS concept + mode and it
      // is fresh + intact, transport it -- the canonical decision was
      // already computed by /api/learning/continue, so we skip the
      // /api/learning/teaching-intent round-trip entirely. Consume-once:
      // the handoff is always cleared on read. Missing / stale / mismatched
      // / forged -> null -> the canonical fetch runs exactly as before.
      const handoffView = conceptId ? consumeLaunchTeachingHandoff(conceptId, quizMode) : null;
      const tiP: Promise<TeachingExperienceView | null> = handoffView
        ? Promise.resolve(handoffView)
        : fetch(
            `/api/learning/teaching-intent?studentId=${sid}&conceptId=${conceptId}&mode=${quizMode}`,
          )
            .then((r) => (r.ok ? r.json() : null))
            .then((b) => (b?.data?.teachingExperience ?? null) as TeachingExperienceView | null)
            .catch(() => null);

      // wave B -- question generation, in the background.
      // LX-4P-PERF-R1E R8: QUESTION_GEN_* marks, distinct from TeachingIntro's
      // own GUIDE_* marks -- a generation failure here must be
      // unambiguous in the logs and never be confused with a GUIDE failure.
      setGenState('loading');
      perfMark('T4_gen_start');
      perfMark('QUESTION_GEN_STARTED');
      const genP = fetch('/api/quizzes/generate-and-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genBody(sid)),
      })
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) {
            // RELEASE-R1 PART D: same distinction as generateQuiz above --
            // a canonical-state mismatch is never a generic generation
            // failure, and "retry the same request" is useless for it
            // (canonical state, not the provider, rejected it).
            const err = new Error(b.message || 'Could not generate the quiz') as Error & { reason?: string };
            if (b.error === 'INVALID_GENERATION_CONTRACT' && b.reason === 'ZERO_GAP_PRACTICE_MISMATCH') err.reason = b.reason;
            if (r.status === 403 && b.error === 'ENTITLEMENT_REQUIRED') err.reason = 'ENTITLEMENT_REQUIRED';
            throw err;
          }
          return b.data;
        });

      const applyGen = genP
        .then((data) => {
          applyGenResult(data);
          setGenState('ready');
          perfMark('T5_gen_ready');
          perfMark('QUESTION_GEN_READY');
        })
        .catch((err: Error & { reason?: string }) => {
          setGenState('error'); // recoverable at the Practice transition
          setGenErrorReason(err?.reason ?? null);
          perfMark('QUESTION_GEN_FAILED');
        });

      tiP.then((view) => {
        setTeachingExperience(view);
        perfMark('T1_teachingintent_ready');
        // UX-3: a learner whose draft of THIS session was restored had
        // already reached its questions -- the teaching stage is not re-entered.
        const teachFirst =
          !resumedFromDraftRef.current && !!view && view.stages.some((s: string) => s === 'EXPLAIN' || s === 'MODEL' || s === 'GUIDE');
        if (teachFirst) {
          setTeachingStage('teaching');
          setPhase('quiz'); // teaching UI can render NOW -- questions still cooking
        } else {
          // direct Practice -- we do need the batch before showing anything
          void applyGen.then(() => {
            setTeachingStage('questions');
            setPhase('quiz');
          });
        }
      });

      // safety net: if TeachingIntent is slow/failed but questions are
      // ready, don't leave the learner on the spinner.
      void applyGen.then(() => {
        setPhase((p) => (p === 'setup' || p === 'loading' ? 'quiz' : p));
      });
    },
    [conceptId, quizMode, genBody, applyGenResult, perfMark],
  );

  // LX-4K: canonical flow skips the configurator entirely.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (
      isCanonicalFlow &&
      studentId &&
      phase === 'setup' &&
      !resumeVerifyAttemptId &&
      !autoStartedRef.current
    ) {
      autoStartedRef.current = true;
      startCanonicalActivity(studentId);
    }
  }, [isCanonicalFlow, studentId, phase, resumeVerifyAttemptId, startCanonicalActivity]);

  useEffect(() => {
    const q = questions[current];
    if (!q) return;
    // Phase 1D: stamp this question's presentation moment exactly once.
    // This effect already fires exactly when a new question becomes the
    // one on screen (Step 7's canonical presentation point) and nowhere
    // else -- a hint, confidence pick, or validation error re-renders
    // the component without changing `current`, so this branch simply
    // doesn't run again for the same index.
    if (!questionPresentedAtRef.current[current]) {
      questionPresentedAtRef.current[current] = new Date().toISOString();
      if (current === 0) perfMark('T6_first_practice_question');
    }
    setSingleChoice(null);
    setMultiChoice([]);
    setTextAnswer('');
    setMatchingAnswer({});
    setOrderingAnswer(q.orderingItemsShuffled ? [...q.orderingItemsShuffled] : []);
    setClassificationAnswer({});
    setConfidenceSelected(null);
    // UX-3: a draft restored for THIS index refills the learner's own
    // unsubmitted input (never an answer they did not give).
    const restore = pendingRestoreRef.current;
    if (restore && restore.index === current) {
      pendingRestoreRef.current = null;
      applyPendingDraft(restore.pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, questions.length]);

  function applyPendingDraft(p: DraftPending) {
    setSingleChoice(p.singleChoice);
    setMultiChoice(p.multiChoice);
    setTextAnswer(p.textAnswer);
    setMatchingAnswer(p.matchingAnswer);
    if (p.orderingAnswer.length > 0) setOrderingAnswer(p.orderingAnswer);
    setClassificationAnswer(p.classificationAnswer);
    setConfidenceSelected(p.confidenceSelected as ConfidenceLevel | null);
  }

  // UX-3 (refresh continuity): restore the learner's unsubmitted input for
  // the SAME server session only. The canonical delivery path resumes the
  // open session after a reload (same quizId, same questions); a new
  // session never matches its key or fingerprint, so nothing is restored
  // into it. The server's state is never changed here -- no request is made.
  useEffect(() => {
    if (!studentId || !quizId || questions.length === 0 || !draftFingerprintRef.current) return;
    if (draftRestoreAttemptedRef.current === quizId) return;
    draftRestoreAttemptedRef.current = quizId;
    const storage = browserDraftStorage();
    const now = Date.now();
    purgeForeignDrafts(storage, studentId, now);
    const d = loadDraft(storage, { studentId, quizId, fingerprint: draftFingerprintRef.current, questionCount: questions.length, now });
    if (!d || !draftHasInput(d)) return;
    questionPresentedAtRef.current = { ...questionPresentedAtRef.current, ...d.presentedAt };
    answerSubmittedAtRef.current = { ...d.submittedAt };
    setAnswers(d.answers);
    setConfidences(d.confidences as Record<number, ConfidenceLevel>);
    const check = d.check as { index?: number; status?: string } | null;
    if (check && check.index === d.current && (check.status === 'done' || check.status === 'unavailable')) {
      setAnswerCheck(d.check as NonNullable<typeof answerCheck>);
    }
    if (d.current === current) applyPendingDraft(d.pending);
    else {
      pendingRestoreRef.current = { index: d.current, pending: d.pending };
      setCurrent(d.current);
    }
    // The learner had already reached the questions of this very session.
    resumedFromDraftRef.current = true;
    setTeachingStage('questions');
    setPhase('quiz');
    setResumedFromDraft(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, quizId, questions.length]);

  useEffect(() => {
    if (results && !reviewing) resultsHeadingRef.current?.focus();
  }, [results, reviewing]);

  useEffect(() => {
    // Phase 1D: a verification question becomes presented the moment it
    // renders as part of the results screen -- stamped once per
    // conceptId, same one-shot pattern as the main quiz questions above.
    for (const v of results?.verificationNeeded || []) {
      if (!verificationPresentedAtRef.current[v.conceptId]) {
        verificationPresentedAtRef.current[v.conceptId] = new Date().toISOString();
      }
    }
  }, [results]);

  // LX-4P-R1: regenerate the session in a new question language. This is
  // the ONLY path that mints a new quizId / question batch for a language
  // change, and it is only ever reached (a) before an item is on screen,
  // or (b) after the learner explicitly confirmed a restart.
  async function regenerateInLanguage(next: Locale) {
    if (!studentId) return;
    setSwitchingLanguage(true);
    try {
      await generateQuiz(studentId, next);
    } finally {
      setSwitchingLanguage(false);
    }
  }

  // LX-4P-R2: translate ONE stored question in place. Returns the
  // localized client question on success, or null (caller falls back to
  // the explicit-restart dialog). Never mutates quizId/index/answers/
  // teaching state -- it only swaps the presentation of questions[idx].
  const localizeQuestionAt = useCallback(
    async (idx: number, target: Locale): Promise<Question | null> => {
      if (!studentId || !quizId) return null;
      const cur = questions[idx];
      const optionOrder = cur?.options?.map((o) => o.id);
      try {
        const res = await fetch('/api/quizzes/localize-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, quizId, questionIndex: idx, targetLanguage: target, optionOrder }),
        });
        const body = await res.json();
        if (!res.ok || !body?.success || !body.data?.ok || !body.data.question) return null;
        return { ...body.data.question, index: idx } as Question;
      } catch {
        return null;
      }
    },
    [studentId, quizId, questions],
  );

  // LX-4P-R2: the learner changed the question language mid-attempt.
  // Preferred path -- same-item localization of the CURRENT question.
  async function attemptSameItemLocalization(next: Locale) {
    if (!studentId || !quizId) {
      setPendingLanguageSwitch(next);
      return;
    }
    setSwitchingLanguage(true);
    try {
      const localized = await localizeQuestionAt(current, next);
      if (localized) {
        localizeAttemptedRef.current.add(`${current}@${next}`);
        setQuestions((qs) => qs.map((q, i) => (i === current ? localized : q)));
        activityLanguageEstablishedRef.current = true;
        setQuizLanguage(next);
        // quizId, current, answers, draft, teachingExperience,
        // teachingStage, results are all deliberately untouched.
      } else {
        // No safe in-place translation -- fall back to LX-4P-R1.
        setLocalizeFailedFallback(true);
        setPendingLanguageSwitch(next);
      }
    } finally {
      setSwitchingLanguage(false);
    }
  }

  function changeQuizLanguage(next: Locale) {
    if (!studentId || next === quizLanguage) return;
    if (phase === 'quiz') {
      if (teachingStage === 'teaching') {
        // No in-place localization of a teach-first stage in this hotfix;
        // and there is no selector rendered here. Defensive: restart path.
        setPendingLanguageSwitch(next);
        return;
      }
      // Active question: try to translate the SAME item first.
      void attemptSameItemLocalization(next);
      return;
    }
    // Setup / pre-item: no learner-facing item to disturb.
    void regenerateInLanguage(next);
  }

  function confirmPendingLanguageSwitch() {
    const next = pendingLanguageSwitch;
    setPendingLanguageSwitch(null);
    setLocalizeFailedFallback(false);
    if (next) void regenerateInLanguage(next);
  }

  function cancelPendingLanguageSwitch() {
    setPendingLanguageSwitch(null);
    setLocalizeFailedFallback(false);
  }

  // LX-4P-R2: keep the CURRENT question's presentation in sync with the
  // chosen question language as the learner advances through a batch
  // that was switched. Best-effort: a failure leaves that one question
  // in the original language rather than interrupting the attempt.
  useEffect(() => {
    if (phase !== 'quiz' || teachingStage !== 'questions' || !quizId || !sessionOriginalLanguage) return;
    const orig = originalQuestionsRef.current[current];
    if (!orig) return;

    if (quizLanguage === sessionOriginalLanguage) {
      // Back on the generated language -- restore the stored original.
      setQuestions((qs) => (qs[current] && qs[current] !== orig ? qs.map((q, i) => (i === current ? orig : q)) : qs));
      return;
    }
    const key = `${current}@${quizLanguage}`;
    if (localizeAttemptedRef.current.has(key)) return;
    localizeAttemptedRef.current.add(key);
    let cancelled = false;
    void localizeQuestionAt(current, quizLanguage).then((localized) => {
      if (cancelled) return;
      if (localized) setQuestions((qs) => qs.map((q, i) => (i === current ? localized : q)));
      else setQuestions((qs) => (qs[current] !== orig ? qs.map((q, i) => (i === current ? orig : q)) : qs));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, quizLanguage, phase, teachingStage, quizId, sessionOriginalLanguage]);

  function encodeCurrentAnswer(q: Question): string {
    switch (q.answerFormat) {
      case 'single_choice':
        return singleChoice || '';
      case 'multi_choice':
        return multiChoice.join(',');
      case 'text':
        // LX-8R3 R8: `textAnswer` now holds the ONE unified
        // ResponseDocument (response-document.ts) -- prose and math
        // blocks in whatever order the learner wrote them, never a
        // separate "final answer" + "reasoning" pair. `toGraderText`
        // is the ONE deterministic transform to the plain string the
        // EXISTING grader receives -- no grader change, no new
        // evidence field.
        return toGraderText(deserializeResponseDocument(textAnswer));
      case 'matching':
        return JSON.stringify(matchingAnswer);
      case 'ordering':
        return JSON.stringify(orderingAnswer);
      case 'classification':
        return JSON.stringify(classificationAnswer);
    }
  }

  function canProceed(q: Question): boolean {
    if (q.askConfidence && !confidenceSelected) return false;
    switch (q.answerFormat) {
      case 'single_choice':
        return !!singleChoice;
      case 'multi_choice':
        return multiChoice.length > 0;
      case 'text':
        return !isEmptyResponseDocument(deserializeResponseDocument(textAnswer));
      case 'matching':
        return (q.matchingLeft || []).every((l) => !!matchingAnswer[l]);
      case 'ordering':
        return orderingAnswer.length > 0;
      case 'classification':
        return (q.classificationItems || []).every((it) => !!classificationAnswer[it]);
    }
  }

  const perQuestionFeedback = quizMode === 'canonical_learn_check';
  const answerLocked =
    perQuestionFeedback && answerCheck?.index === current && (answerCheck.status === 'done' || answerCheck.status === 'unavailable');

  async function checkAnswer() {
    const q = questions[current];
    if (!q || !quizId || !studentId) return;
    const index = current;
    setResumedFromDraft(false);
    setAnswerCheck({ index, status: 'checking' });
    try {
      const res = await fetch(`/api/quizzes/session/${quizId}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, questionIndex: index, answer: encodeCurrentAnswer(q) }),
      });
      const body = await res.json().catch(() => null);
      const safetyResponse = safetyFromBody(body);
      if (safetyResponse) {
        // Human Agency P0-4: the server's fixed safety response (no AI involved).
        setSafety(safetyResponse);
        setAnswerCheck({ index, status: 'unavailable' });
        return;
      }
      if (!res.ok || !body?.data) {
        setAnswerCheck({ index, status: 'unavailable' });
        return;
      }
      setAnswerCheck({ index, status: 'done', ...body.data });
    } catch {
      setAnswerCheck({ index, status: 'unavailable' });
    }
  }

  function nextQuestion() {
    // Phase 1D: the explicit-submission moment for the CURRENT question
    // -- covers every question including the last one, since advancing
    // past the last question is exactly what triggers submitQuiz below.
    answerSubmittedAtRef.current[current] = new Date().toISOString();
    setResumedFromDraft(false);
    const q = questions[current];
    const encoded = encodeCurrentAnswer(q);
    const updatedAnswers = { ...answers, [current]: encoded };
    setAnswers(updatedAnswers);

    const updatedConfidences = confidenceSelected ? { ...confidences, [current]: confidenceSelected } : confidences;
    if (confidenceSelected) setConfidences(updatedConfidences);

    if (current + 1 < questions.length) {
      setCurrent(current + 1);
      setAnswerCheck(null);
    } else {
      submitQuiz(updatedAnswers, updatedConfidences);
    }
  }

  function moveOrderingItem(index: number, direction: -1 | 1) {
    setOrderingAnswer((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submitQuiz(finalAnswers: Record<number, string>, finalConfidences: Record<number, ConfidenceLevel> = confidences) {
    if (!studentId || !quizId) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setSubmitFailure(null);
    try {
      const answerList = Object.entries(finalAnswers).map(([idx, ans]) => ({
        questionIndex: Number(idx),
        answer: ans,
        confidence: finalConfidences[Number(idx)],
        // Phase 1D: observational only -- omitted entirely (not sent as
        // empty strings) when a timestamp was never captured for this
        // index, so the server correctly reads that as MISSING, not as
        // a malformed value.
        questionPresentedAt: questionPresentedAtRef.current[Number(idx)],
        answerSubmittedAt: answerSubmittedAtRef.current[Number(idx)],
      }));
      const res = await fetch('/api/quizzes/generate-and-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          quizId,
          answers: answerList,
          diagnosisId: diagnosisId || undefined,
          remediationStepId: remediationStepId || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      const safetyResponse = safetyFromBody(body);
      if (safetyResponse) {
        // Human Agency P0-4: nothing was graded or recorded; show the fixed response.
        setSafety(safetyResponse);
        return;
      }
      if (!res.ok || !body) {
        // UX-3: visible and recoverable -- a transport/server failure is
        // never presented as an incorrect answer, and nothing is scored.
        setError(body?.message || t['common.error']);
        setSubmitFailure(classifySubmitFailure({ status: res.status, errorCode: body?.error ?? null }));
        return;
      }
      if (body.alreadySubmitted) {
        // The first submission was recorded; its response was lost. The
        // server changed nothing -- continue from canonical truth.
        setAlreadySubmitted(true);
        return;
      }
      setResults(body.data);
    } catch (err: any) {
      setError(err?.message || t['common.error']);
      setSubmitFailure(classifySubmitFailure({ thrown: true }));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // UX-3: persist the learner's own unsubmitted input for this session
  // (see session-draft.ts). Declared after the restore effect so a reload
  // reads the stored draft before anything is written.
  useEffect(() => {
    if (!studentId || !quizId || !draftFingerprintRef.current || results || alreadySubmitted) return;
    if (phase !== 'quiz' || teachingStage !== 'questions' || questions.length === 0) return;
    if (draftRestoreAttemptedRef.current !== quizId) return;
    saveDraft(browserDraftStorage(), {
      v: 1,
      studentId,
      quizId,
      fingerprint: draftFingerprintRef.current,
      current,
      answers,
      confidences,
      presentedAt: questionPresentedAtRef.current,
      submittedAt: answerSubmittedAtRef.current,
      pending: { singleChoice, multiChoice, textAnswer, matchingAnswer, orderingAnswer, classificationAnswer, confidenceSelected },
      check: answerCheck && answerCheck.index === current && (answerCheck.status === 'done' || answerCheck.status === 'unavailable') ? answerCheck : null,
      savedAt: Date.now(),
    });
  }, [studentId, quizId, results, alreadySubmitted, phase, teachingStage, questions.length, current, answers, confidences, singleChoice, multiChoice, textAnswer, matchingAnswer, orderingAnswer, classificationAnswer, confidenceSelected, answerCheck]);

  // UX-3: authoritative completion (or a session the server no longer
  // has) ends the draft's life.
  useEffect(() => {
    if (!studentId || !quizId) return;
    if (results || alreadySubmitted || submitFailure === 'EXPIRED') clearDraft(browserDraftStorage(), studentId, quizId);
  }, [results, alreadySubmitted, submitFailure, studentId, quizId]);

  // Submits the student's answer to a triggered verification question.
  // The server (never this client) computes the outcome and evidence
  // qualification -- this only displays whatever it returns.
  async function submitVerification(conceptId: string) {
    if (!studentId || !quizId) return;
    // Phase 1D: captured before setVerificationSubmitting/the fetch, so it
    // measures the learner's answering time, not network/request latency.
    const answerSubmittedAt = new Date().toISOString();
    setVerificationSubmitting((prev) => ({ ...prev, [conceptId]: true }));
    setVerificationError((prev) => ({ ...prev, [conceptId]: false }));
    try {
      const res = await fetch('/api/quizzes/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          quizId,
          conceptId,
          // LX-8R3 R8: see submitResumeVerification's identical comment --
          // a lossless no-op for a bare single_choice option id, the ONE
          // canonical grader-facing transform for a serialized
          // ResponseDocument free-text answer.
          answer: toGraderText(deserializeResponseDocument(verificationAnswers[conceptId] || '')),
          language: quizLanguage,
          questionPresentedAt: verificationPresentedAtRef.current[conceptId],
          answerSubmittedAt,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || t['common.error']);
      setVerificationResults((prev) => ({ ...prev, [conceptId]: body.data }));
    } catch {
      setVerificationError((prev) => ({ ...prev, [conceptId]: true }));
    } finally {
      setVerificationSubmitting((prev) => ({ ...prev, [conceptId]: false }));
    }
  }

  // Phase 4-R: fetches the EXISTING pending verification's question via
  // the new GET /api/quizzes/verify continuation path (never regenerated,
  // never a new attempt) once the student is identified. A `{pending:
  // null}` response (Finding 9 -- already resolved, or a stale link) is
  // not an error: it renders the honest "not pending anymore" state.
  useEffect(() => {
    if (!resumeVerifyAttemptId || !resumeQuizId || !conceptId || !studentId) return;
    let cancelled = false;
    async function loadPending() {
      setResumePhase('loading');
      try {
        const res = await fetch(
          `/api/quizzes/verify?studentId=${encodeURIComponent(studentId!)}&quizId=${encodeURIComponent(resumeQuizId!)}&conceptId=${encodeURIComponent(conceptId!)}`
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.success) {
          setResumePhase('error');
          return;
        }
        if (!body.data.pending) {
          setResumePhase('none');
          return;
        }
        setResumeQuestion(body.data.pending.question);
        resumePresentedAtRef.current = new Date().toISOString();
        setResumePhase('ready');
      } catch {
        if (!cancelled) setResumePhase('error');
      }
    }
    loadPending();
    return () => {
      cancelled = true;
    };
  }, [resumeVerifyAttemptId, resumeQuizId, conceptId, studentId]);

  // Same request shape as submitVerification above, POSTing to the
  // exact same, unmodified, certified /api/quizzes/verify pipeline --
  // this is not a second write path.
  async function submitResumeVerification() {
    if (!studentId || !resumeQuizId || !conceptId || !resumeAnswer) return;
    const answerSubmittedAt = new Date().toISOString();
    setResumeSubmitting(true);
    setResumeError(false);
    try {
      const res = await fetch('/api/quizzes/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          quizId: resumeQuizId,
          conceptId,
          // LX-8R3 R8: `resumeAnswer` may hold a serialized ResponseDocument
          // (a free-text answer) or a bare option id (single_choice) --
          // toGraderText(deserializeResponseDocument(...)) is a lossless
          // no-op for the latter (a plain string round-trips as itself
          // through a single paragraph block) and the ONE canonical
          // grader-facing transform for the former. No grader change.
          answer: toGraderText(deserializeResponseDocument(resumeAnswer)),
          language: quizLanguage,
          questionPresentedAt: resumePresentedAtRef.current || undefined,
          answerSubmittedAt,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || t['common.error']);
      setResumeOutcome(body.data);
    } catch {
      setResumeError(true);
    } finally {
      setResumeSubmitting(false);
    }
  }

  // Evidence-strength labels only -- never "Mastered"/"Not mastered".
  // Mastery, wherever it's shown anywhere in the product, comes
  // exclusively from Phase 2.2 Knowledge State, never from this number.
  // LX-4P-R3: only ever rendered inside the active Results/verification
  // surface -- activity language (`at`), like everything else there.
  const evidenceStrengthLabel = (strength: string) =>
    strength === 'HIGH'
      ? at['quiz.evidenceStrengthHigh']
      : strength === 'MEDIUM'
      ? at['quiz.evidenceStrengthMedium']
      : strength === 'CONTRADICTED'
      ? at['quiz.evidenceStrengthContradicted']
      : at['quiz.evidenceStrengthLow'];

  // canonical_prove/canonical_retain/canonical_transfer/canonical_learn_check
  // never actually reach these in the normal canonical flow
  // (isCanonicalFlow always shows the loading state instead of this
  // setup form for them -- see below), but each now has its OWN real
  // copy (Sections 6/8/9/10) rather than falling back to a mislabeling
  // default if ever reached (e.g. a manual ?setup=1 URL).
  const modeLabel = (mode: QuizMode) =>
    mode === 'quick_check'
      ? t['quiz.modeQuickCheck']
      : mode === 'canonical_prove'
      ? t['quiz.modeCanonicalProve']
      : mode === 'canonical_retain'
      ? t['quiz.modeCanonicalRetain']
      : mode === 'canonical_transfer'
      ? t['quiz.modeCanonicalTransfer']
      : mode === 'canonical_learn_check'
      ? t['quiz.modeCanonicalLearnCheck']
      : mode === 'retention_check'
      ? t['quiz.modeRetentionCheck']
      : mode === 'review'
      ? t['quiz.modeReview']
      : mode === 'cumulative_assessment'
      ? t['quiz.modeCumulative']
      : mode === 'exam_simulation'
      ? t['quiz.modeExamSim']
      : mode === 'diagnostic_check'
      ? t['quiz.modeDiagnosticCheck']
      : t['quiz.modeTopicPractice'];

  const modeDesc = (mode: QuizMode) =>
    mode === 'quick_check'
      ? t['quiz.modeQuickCheckDesc']
      : mode === 'canonical_prove'
      ? t['quiz.modeCanonicalProveDesc']
      : mode === 'canonical_retain'
      ? t['quiz.modeCanonicalRetainDesc']
      : mode === 'canonical_transfer'
      ? t['quiz.modeCanonicalTransferDesc']
      : mode === 'canonical_learn_check'
      ? t['quiz.modeCanonicalLearnCheckDesc']
      : mode === 'retention_check'
      ? t['quiz.modeRetentionCheckDesc']
      : mode === 'review'
      ? t['quiz.modeReviewDesc']
      : mode === 'cumulative_assessment'
      ? t['quiz.modeCumulativeDesc']
      : mode === 'exam_simulation'
      ? t['quiz.modeExamSimDesc']
      : mode === 'diagnostic_check'
      ? t['quiz.modeDiagnosticCheckDesc']
      : t['quiz.modeTopicPracticeDesc'];

  // UX-3: every "getting it ready" moment has context (which experience)
  // and a stable skeleton of the task -- never a bare floating line.
  const preparingView = (text: string) => (
    <div className="ls" data-kind={activityKind}>
      <div className="card ls-preparing" role="status" aria-live="polite">
        <span className="ls-kicker">{at[kindLabelKey(activityKind)]}</span>
        <p className="ls-preparing-text">{text}</p>
        <Skeleton height={24} width="85%" />
        <Skeleton height={52} radius="var(--radius-md)" />
        <Skeleton height={52} radius="var(--radius-md)" />
      </div>
    </div>
  );

  // Phase 4-R: a resumed pending verification is a small, self-contained
  // flow -- it never enters the normal setup/loading/quiz/results phase
  // machine above at all (no generate-and-take call is ever made for
  // it).
  if (resumeVerifyAttemptId) {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>{at['nav.subjects']}</Link> / {at['quiz.verificationTitle']}
        </div>
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <p className="label" style={{ color: 'var(--brand-ink)', marginBottom: 6 }}>{at['quiz.verificationTitle']}</p>

          {resumePhase === 'loading' && <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{at['common.loading']}</p>}
          {resumePhase === 'error' && <p role="alert" style={{ fontSize: 13.5, color: 'var(--error)' }}>{at['common.error']}</p>}
          {resumePhase === 'none' && !resumeOutcome && (
            <div>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{at['quiz.verificationNotPending']}</p>
              <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ marginTop: 12 }}>{at['quiz.backToSubject']}</Link>
            </div>
          )}
          {resumeOutcome && (
            <div>
              <p style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
                {resumeOutcome.outcome === 'CONFIRMED'
                  ? at['quiz.verificationConfirmed']
                  : resumeOutcome.outcome === 'CONTRADICTED'
                  ? at['quiz.verificationContradicted']
                  : at['quiz.verificationInconclusive']}
              </p>
              <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ marginTop: 12 }}>{at['quiz.backToSubject']}</Link>
            </div>
          )}
          {resumePhase === 'ready' && resumeQuestion && !resumeOutcome && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{at['quiz.verificationExplain']}</p>
              <p style={{ fontSize: 14, fontWeight: 600, margin: '8px 0' }}>
                <MathText text={resumeQuestion.question} />
              </p>
              {resumeQuestion.visualAid && <VisualAidView aid={resumeQuestion.visualAid} />}
              {resumeQuestion.answerFormat === 'single_choice' ? (
                <div role="radiogroup" aria-label={at['quiz.verificationTitle']} className="ls-options">
                  {(resumeQuestion.options || []).map((opt: any, i: number) => {
                    const isSelected = resumeAnswer === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className="ls-option"
                        onClick={() => setResumeAnswer(opt.id)}
                      >
                        <span className="ls-option-key" aria-hidden>{String.fromCharCode(65 + i)}</span>
                        <span className="ls-option-text"><MathText text={opt.text} /></span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                (() => {
                  // LX-8R2-R1/LX-8R3 R3/R6/R9/R16: a resumed Assessment
                  // verification question is a GeneratedQuestion (server-
                  // persisted, includes type/expectedReasoningType) -- the
                  // SAME canonical deriveResponseEvidenceContract/
                  // buildInteractionContract authorities the main quiz
                  // flow already uses, computed inline here since this
                  // early-return branch predates that flow's own
                  // responseContract/interactionContract. Verification
                  // only ever fires from an Assessment-mode attempt (see
                  // src/app/api/quizzes/verify/route.ts), so integrityMode
                  // is the literal 'ASSESSMENT' EvidenceMode -- never
                  // re-derived, never guessed. `modalityCapabilities` and
                  // `activityLanguageContext` are the SAME state/value
                  // already computed above (before this early return) for
                  // the main flow -- no second capability-detection
                  // effect, no second language context. The SAME
                  // UnifiedResponseComposer as the main quiz renders here
                  // (R16: no route-specific input experience) -- its own
                  // `mathEnabled` prop decides whether a math block/
                  // keyboard is offered, never a second composer.
                  const resumeContract = deriveResponseEvidenceContract(
                    { type: resumeQuestion.type, expectedReasoningType: resumeQuestion.expectedReasoningType ?? null },
                    'ASSESSMENT',
                  );
                  const resumeIc = buildInteractionContract({
                    integrityMode: 'ASSESSMENT',
                    answerFormat: resumeQuestion.answerFormat,
                    activityLanguage: activityLanguageContext,
                    capabilities: modalityCapabilities,
                  });
                  return (
                    <UnifiedResponseComposer
                      value={resumeAnswer}
                      onChange={setResumeAnswer}
                      responseKind={resumeContract.kind}
                      activityLanguageContext={activityLanguageContext}
                      voiceEnabled={resumeIc.inputModes.includes('VOICE')}
                      mathEnabled={isMathCapableContext(subjectName)}
                      studentId={studentId}
                      conceptId={conceptId ?? undefined}
                      activityType="retention_verification"
                      placeholder={at['quiz.typeAnswer']}
                    />
                  );
                })()
              )}
              {resumeError && <p role="alert" style={{ fontSize: 12.5, color: 'var(--error)', marginTop: 6 }}>{at['common.error']}</p>}
              <button
                className="btn btn-primary"
                style={{ marginTop: 8 }}
                disabled={!resumeAnswer || resumeSubmitting}
                aria-busy={resumeSubmitting}
                onClick={submitResumeVerification}
              >
                {resumeSubmitting ? at['quiz.submitting'] : at['quiz.verificationSubmit']}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // LX-4K: the canonical flow never shows the configurator -- it
  // auto-starts (effect above). While that resolves, show a calm
  // loading state, not the form.
  // CANON-R6-PERF-R2 Part 15-27 -- canonical_prove gets the dedicated
  // focused preparation experience (a cache HIT is typically fast
  // enough that ProveFocusLoading's own 0-800ms threshold renders
  // nothing at all; a cold miss gets the full calm, academic waiting
  // state instead of a bare "generating..." spinner).
  // CANON-V2-FINAL-HARDENING Section 8/9/10 -- the other 3 canonical
  // activities (Retain/Transfer/LearnCheck) each get their OWN
  // stage-appropriate loading title instead of the bare generic
  // "generating..." string, so a Transfer/Retain wait never LOOKS like
  // an ordinary Practice load. Legacy single-concept modes
  // (topic_practice, quick_check, etc.) are completely unaffected.
  if (phase === 'setup' && isCanonicalFlow) {
    if (quizMode === 'canonical_prove') {
      return <ProveFocusLoading at={at} />;
    }
    const canonicalLoadingTitle =
      quizMode === 'canonical_retain'
        ? t['quiz.retainPreparingTitle']
        : quizMode === 'canonical_transfer'
        ? t['quiz.transferPreparingTitle']
        : quizMode === 'canonical_learn_check'
        ? t['quiz.learnCheckPreparingTitle']
        : t['quiz.generating'];
    return preparingView(canonicalLoadingTitle);
  }

  if (phase === 'setup') {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>{t['nav.subjects']}</Link> / {t['quiz.breadcrumbQuiz']}
        </div>
        <div className="card" style={{ padding: 'var(--space-8)' }}>
          <p className="label" style={{ color: 'var(--brand-ink)' }}>{modeLabel(quizMode)}</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '6px 0 var(--space-6)' }}>{modeDesc(quizMode)}</p>

          <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            {t['quiz.maxQuestionsLabel']}: <strong className="tabular">{maxQuestions}</strong>
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={maxQuestions}
            onChange={(e) => setMaxQuestions(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>{t['quiz.maxQuestionsHint']}</p>

          {allowsTopicSelection && subjectConcepts.length > 0 && (
            <div style={{ marginTop: 'var(--space-6)' }}>
              <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                {t['quiz.selectTopicsLabel']}
              </label>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 10px' }}>{t['quiz.selectTopicsHint']}</p>
              <div
                style={{
                  maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)',
                }}
              >
                {subjectConcepts.map((c) => {
                  const checked = selectedConceptIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                        fontSize: 13.5, cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                        background: checked ? 'var(--brand-subtle)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedConceptIds((prev) =>
                            checked ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                          )
                        }
                      />
                      {c.label}
                    </label>
                  );
                })}
              </div>
              {selectedConceptIds.length > 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--brand-ink)', margin: '8px 0 0' }}>
                  {selectedConceptIds.length} {t['quiz.selectTopicsCount']}
                </p>
              )}
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-6)' }}
            disabled={!studentId}
            onClick={() => studentId && generateQuiz(studentId)}
          >
            {t['quiz.startQuiz']}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    // UX-3: no "generating with AI" chrome inside learning -- the learner
    // is waiting for their activity, not for a model.
    return preparingView(at['xs.preparing']);
  }

  if (phase === 'error') {
    // RET-R3 B9: a bounded-generation failure (e.g. Retention closing
    // insufficient after a full recovery attempt, per RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS)
    // is a RECOVERABLE, learner-safe state, not a dead end -- the raw
    // technical error string (e.g. "Failed to generate quiz questions")
    // is never shown to the learner; ONE calm, mode-aware headline is,
    // matching the SAME copy pattern `modeLabel`/`modeDesc` already use
    // elsewhere in this file (no separate Retention error design/
    // component -- this is the SAME error card every quiz-generation
    // failure already used, just with mode-aware copy and an added
    // retry). "Try again" reuses the pre-existing, previously-unused
    // `activeLearning.tryAgain` label and simply re-invokes the SAME
    // `generateQuiz` this page already calls from four other places --
    // no new generation path. Nothing implies prior learner progress
    // was lost, because none was: this failure can only occur before
    // the first question is ever shown.
    // RELEASE-R1 PART D: a canonical-state mismatch is a DIFFERENT
    // recovery shape entirely -- never "Try again" (the SAME request
    // would fail again identically; canonical state, not the provider,
    // rejected it), never the raw generic error copy. Route the learner
    // back to Concept Mission, where fresh canonical state (and whatever
    // IS actually next) is shown -- never a dead end, never a repeated
    // invalid request.
    if (errorReason === 'ENTITLEMENT_REQUIRED') return licenseRequiredCard();
    if (errorReason === 'ZERO_GAP_PRACTICE_MISMATCH') {
      return (
        <div className="ls" data-kind={activityKind}>
          <InlineAlert
            tone="info"
            title={at['quiz.canonicalStateChanged']}
            actions={
              <Link href={subjectId && conceptId ? conceptMissionPath({ subjectId, conceptId }) : '/dashboard/today'} className="btn btn-primary">
                {at['continuation.backToConcept']}
              </Link>
            }
          />
        </div>
      );
    }

    // CANON-V2-FINAL-HARDENING Section 16 -- AI failure UX must never
    // say "you failed," "your answer was wrong," "stage reset," or
    // "knowledge lost" (no evidence was ever created for a generation
    // failure, so none of those is even true). `canonical_retain` was a
    // real gap: it fell through to the fully generic quiz.loadError
    // instead of the SAME calm, mode-aware treatment retention_check
    // already had. canonical_transfer/canonical_learn_check now get
    // their own reassuring copy too, explicitly naming "your progress
    // is safe" -- canonical_prove and every legacy mode keep their
    // existing, already-calm generic copy unchanged.
    const isRetentionFailure = quizMode === 'retention_check' || quizMode === 'canonical_retain';
    const failureMessageKey =
      isRetentionFailure
        ? 'quiz.retentionLoadError'
        : quizMode === 'canonical_transfer'
        ? 'quiz.transferLoadError'
        : quizMode === 'canonical_learn_check'
        ? 'quiz.learnCheckLoadError'
        : 'quiz.loadError';
    return (
      <div className="ls" data-kind={activityKind}>
        <InlineAlert
          tone="error"
          title={at[failureMessageKey]}
          actions={
            <>
              {studentId && (
                <button className="btn btn-primary" onClick={() => generateQuiz(studentId)}>
                  {at['activeLearning.tryAgain']}
                </button>
              )}
              <Link href="/dashboard" className="btn btn-secondary">
                {at['quiz.backToDashboard']}
              </Link>
            </>
          }
        />
      </div>
    );
  }

  // UX-3: a re-send after a lost response. The server kept the first
  // submission unchanged (`alreadySubmitted`), so there are no new results
  // to show -- only the honest statement and the canonical continuation.
  if (alreadySubmitted) {
    return (
      <div className="ls ls-result" data-kind={activityKind}>
        <section className="card ls-outcome" data-outcome="RECORDED" role="status" aria-live="polite" data-testid="already-submitted">
          <span className="ls-kicker">{at[kindLabelKey(activityKind)]}</span>
          <h1 className="ls-outcome-title">{at['xs.alreadySubmittedTitle']}</h1>
          <p className="ls-outcome-body">{at['xs.alreadySubmittedBody']}</p>
        </section>
        {subjectId && conceptId && studentId && !diagnosisId ? (
          <ContinuationPanel studentId={studentId} subjectId={subjectId} conceptId={conceptId} locale={quizLanguage} from={continuationKind} />
        ) : (
          <div className="ls-secondary">
            <Link href={subjectId ? `/dashboard/subjects/${subjectId}` : '/dashboard'} className="btn btn-primary">{at['quiz.backToSubject']}</Link>
          </div>
        )}
      </div>
    );
  }

  if (results) {
    // LX-9 A8/A9 + UX-2: a genuine independent-evidence achievement
    // (retention_check or quick_check, never a Practice pass -- A9: correct
    // answer != achievement) gets ONE calm, evidence-specific line instead
    // of the generic score-tier message. UX-2: the milestone now follows
    // the requirement status the SERVER already reported
    // (proveSufficiency / canonical RETAIN requirement), never the score
    // tier -- `messageKey !== 'keep_going'` meant any score >= 50% was
    // celebrated as PROVED/RETAINED. See lib/experience/result-milestone.ts.
    // LX-9R3 A1/A6: `retentionCheckQualified` is undefined/true for a
    // genuine, evidence-counting attempt and explicitly false for a real
    // attempt that arrived too soon to ever count -- `=== false` (not
    // `!== true`) so an absent field never suppresses the honest copy.
    const retentionTooSoon = quizMode === 'retention_check' && results.retentionCheckQualified === false;
    const milestone: MilestoneType | null = resolveResultMilestone({
      quizMode,
      proveSufficiency: results.proveSufficiency,
      retentionCheckQualified: results.retentionCheckQualified,
      canonicalResults: results.canonicalResults,
    });
    const messageText = retentionTooSoon
      ? at['quiz.retentionTooSoon']
      : milestone
        ? at[milestoneFeedbackKey(milestone)]
        : at[RESULT_MESSAGE_KEY[results.messageKey] || 'quiz.msgKeepGoing'];
    const perConcept = results.perConceptResults || [];
    // CANON-R6R1 Part 14/15 -- for ANY v1 attempt (canonicalResultsStatus
    // is anything but the default 'NOT_V1'), canonicalResults is the
    // ONLY displayed next-step authority: the legacy `messageText` line
    // below is a next-step/progression interpretation
    // (RESULT_MESSAGE_KEY / milestone feedback), and must never render
    // alongside it -- whether the v1 status is 'OK', a contract
    // violation, or an unavailable re-fetch. Factual attempt outcome
    // (score/correct/incorrect above) is unaffected; only this one
    // legacy next-step line is suppressed. Legacy (non-v1) attempts
    // keep rendering it exactly as before this phase.
    const isV1Result = results.canonicalResultsStatus !== 'NOT_V1';

    if (reviewing) {
      const review: (ReviewItem & { errorType?: string | null; reasoningValid?: boolean | null })[] = results.review || [];
      const supportedPractice = PRACTICE_EVIDENCE_MODES.includes(quizMode) && !resumeVerifyAttemptId;
      return (
        <div className="ls" data-kind={activityKind}>
          <h1 className="ls-title">{at['xs.review']}</h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {review.map((r) => {
              // LX-4R R6: pedagogical feedback -- what happened / why /
              // what to change / what now. `errorType` / `reasoningValid`
              // are the CANONICAL grader classification; the UI presents
              // them, it never re-derives a diagnosis.
              // PEDAGOGICAL_V1: the server's teacher verdict is the verdict;
              // legacy results fall back to the previous derivation.
              const judgment = r.finalJudgment ?? (r.correct ? 'CORRECT' : r.reasoningValid ? 'ALMOST' : 'INCORRECT');
              const whatHappened = judgment === 'CORRECT' ? at['feedback.correct'] : judgment === 'ALMOST' ? at['feedback.almost'] : at['feedback.incorrect'];
              const chipClass = judgment === 'CORRECT' ? 'chip-good' : judgment === 'ALMOST' ? 'chip-warn' : 'chip-critical';
              const parts = r.feedbackParts;
              const whyKey = r.errorType ? (`errorTeach.${r.errorType}` as keyof typeof t) : null;
              const why = whyKey && at[whyKey] ? at[whyKey] : r.reasoningValid ? at['feedback.methodSoundNumberOff'] : '';
              return (
                <div key={r.questionIndex} className="card al-fb" style={{ padding: 'var(--space-6)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.conceptLabel}</span>
                    <span className={`chip ${chipClass}`} data-judgment={judgment}>{whatHappened}</span>
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 600, margin: '10px 0' }}>
                    <MathText text={r.question} />
                  </p>
                  {r.visualAid && <VisualAidView aid={r.visualAid} />}
                  <div style={{ fontSize: 14, marginBottom: 4 }}>
                    <strong>{at['quiz.yourAnswer']}:</strong> {r.studentAnswer ? <MathText text={r.studentAnswer} /> : '—'}
                  </div>
                  {!r.correct && (
                    <div style={{ fontSize: 14, marginBottom: 4, color: 'var(--success)' }}>
                      <strong>{at['quiz.correctAnswerLabel']}:</strong> <MathText text={r.correctAnswer} />
                    </div>
                  )}

                  {parts && judgment !== 'CORRECT' && (parts.didWell || parts.missing.length > 0 || parts.toFix) && (
                    <div className="al-fb-body" data-testid="pedagogical-feedback">
                      {parts.didWell && (
                        <div>
                          <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 2px' }}>{at['grading.section.didWell']}</p>
                          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}><MathText text={parts.didWell} /></p>
                        </div>
                      )}
                      {parts.missing.length > 0 && (
                        <div>
                          <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 2px' }}>{at['grading.section.missing']}</p>
                          {parts.missing.map((m, i) => (
                            <p key={i} style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>{m}</p>
                          ))}
                        </div>
                      )}
                      {parts.toFix && (
                        <div>
                          <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 2px' }}>{at['grading.section.toFix']}</p>
                          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}><MathText text={parts.toFix} /></p>
                        </div>
                      )}
                    </div>
                  )}
                  {!parts && !r.correct && (why || r.feedback) && (
                    <div className="al-fb-body">
                      {why && (
                        <div>
                          <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 2px' }}>{at['feedback.why']}</p>
                          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>{why}</p>
                        </div>
                      )}
                      {r.feedback && (
                        <div>
                          <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 2px' }}>{at['feedback.whatToChange']}</p>
                          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}><MathText text={r.feedback} /></p>
                        </div>
                      )}
                    </div>
                  )}

                  <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 8 }}>
                    <strong>{at['quiz.explanationLabel']}:</strong> <MathText text={r.explanation} />
                  </p>
                </div>
              );
            })}
          </div>
          <div className="ls-secondary">
            <button className="btn btn-secondary" onClick={() => setReviewing(false)}>{at['quiz.backToResults']}</button>
            {/* LX-4R R6: act on the feedback -- retry inside the activity
                rather than being pushed straight on. See the results view
                for the retry-evidence note. */}
            {supportedPractice && studentId && (
              <button className="btn btn-primary" onClick={() => studentId && generateQuiz(studentId)}>
                {at['activeLearning.practiceAgain']}
              </button>
            )}
            <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-ghost">{at['quiz.backToSubject']}</Link>
          </div>
        </div>
      );
    }

    // UX-3: the headline is the SERVER's verdict on this activity's own
    // requirement (resolveActivityOutcome) -- never the score. The score
    // stays visible as a plain fact about this attempt.
    const outcome = resolveActivityOutcome({
      kind: activityKind,
      canonicalResultsStatus: results.canonicalResultsStatus,
      canonicalResults: results.canonicalResults,
      proveSufficiency: results.proveSufficiency,
      milestone,
    });
    const outcomeTitle = outcome === 'RECORDED' ? at[kindDoneKey(activityKind)] : at[outcomeKey(outcome)];
    const outcomeBody =
      outcome === 'MASTERED'
        ? at['progression.milestoneConsolidated']
        : outcome === 'NOT_YET'
          ? at['xs.outcomeBody.NOT_YET']
          : outcome === 'SATISFIED'
            ? activityKind === 'prove' ? at['progression.milestoneProved']
              : activityKind === 'retain' ? at['progression.milestoneRetained']
              : activityKind === 'transfer' ? at['progression.milestoneTransferred']
              : activityKind === 'check' ? at['xs.satisfied.check']
              : at['xs.satisfied.train']
            : null;

    // LX-5D: the activity no longer dead-ends at "back to subject".
    // One canonical continuation -- the resolver re-reads Phase 4 /
    // first-touch and launches the next canonical action, or returns to
    // the Concept Mission. For Prove, an insufficient gap simply means
    // the canonical re-read keeps the same purpose (no local "if
    // sufficient => RETAIN"). UX-3: rendered inside the canonical next-step
    // card when there is one (inline, no second headline), else on its own.
    const canonicalNextShown = results.canonicalResultsStatus === 'OK' && !!results.canonicalResults;
    const continuation = (inline: boolean) =>
      subjectId && conceptId && studentId && !resumeVerifyAttemptId && !diagnosisId ? (
        <ContinuationPanel
          studentId={studentId}
          subjectId={subjectId}
          conceptId={conceptId}
          locale={quizLanguage}
          from={continuationKind}
          variant={inline ? 'inline' : 'card'}
          showHeadline={!inline}
          note={
            results.proveSufficiency && !results.proveSufficiency.sufficient
              ? at['prove.moreNeededBody'].replace('{n}', String(results.proveSufficiency.remainingGap))
              : undefined
          }
        />
      ) : null;

    return (
      <div className="ls ls-result" data-kind={activityKind}>
        {/* R9: the outcome is announced to assistive tech when it appears. */}
        <section className="card ls-outcome" data-outcome={outcome} role="status" aria-live="polite" data-testid="results-outcome">
          <span className="ls-kicker">{at[kindLabelKey(activityKind)]}</span>
          <h1 className="ls-outcome-title" tabIndex={-1} ref={resultsHeadingRef}>{outcomeTitle}</h1>
          {outcomeBody && !(!isV1Result && outcomeBody === messageText) && <p className="ls-outcome-body">{outcomeBody}</p>}
          <div className="ls-fact">
            <span className="ls-fact-value">{at['xs.resultFact'].replace('{correct}', String(results.results.correctCount)).replace('{total}', String(results.results.totalQuestions))}</span>
            <span className="ls-fact-label">{at['quiz.score']}: <span className="tabular">{results.results.score}%</span></span>
          </div>
          {/* CANON-R6R1: the legacy next-step line only ever renders for a
              non-v1 attempt -- never alongside canonicalResults. */}
          {!isV1Result && (
            <p className="ls-outcome-body">{messageText}</p>
          )}

          {/* UX/CANON-R1 PART D: canonical difficulty this activity was
              generated at -- the session's own targetDifficulty when
              every question shares it (the ordinary case), or a range
              when they legitimately differ. Never a new average metric. */}
          {questions.length > 0 && (
            <p style={{ marginTop: 2 }}>
              <DifficultyIndicator
                t={at}
                range={{
                  min: Math.min(...questions.map((q) => q.difficulty)),
                  max: Math.max(...questions.map((q) => q.difficulty)),
                }}
              />
            </p>
          )}

          {results.diagnosticOutcome && (
            <div
              style={{
                marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)',
                background: results.diagnosticOutcome.outcome === 'CONFIRMED' ? 'var(--warning-subtle)' : 'var(--brand-subtle)',
              }}
            >
              <strong style={{ fontSize: 13.5 }}>
                {results.diagnosticOutcome.outcome === 'CONFIRMED'
                  ? at['quiz.diagnosticConfirmed']
                  : results.diagnosticOutcome.outcome === 'REJECTED'
                  ? at['quiz.diagnosticRejected']
                  : at['quiz.diagnosticInconclusive']}
              </strong>
            </div>
          )}

          {results.ibEstimate && (
            <div
              style={{
                marginTop: 'var(--space-3)', display: 'inline-flex', flexDirection: 'column', gap: 2,
                padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--brand-subtle)',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--brand-ink)' }}>
                {results.ibEstimate.programme === 'DP'
                  ? `${at['ib.estimatedGrade']}: ${results.ibEstimate.grade}/7`
                  : `${at['ib.estimatedBand']}: ${results.ibEstimate.band}/8`}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{at['ib.disclaimer']}</span>
            </div>
          )}

          {/* LX-9R5 PART K: broadened from LX-9R3's retention_check-only
              guard -- raw mastery_score confidence is never the PRIMARY
              learner-facing feedback for ANY activity now (the reported
              "Dominio del concepto: 3.57% -> 3.75%" leak on an ordinary
              Practice result, inconsistent with LX-9R1's canonical
              journey model). No new percentage is invented to replace
              it -- `messageText` below and the ContinuationPanel's own
              canonical next-action already carry the real, meaningful
              feedback. The raw value itself is NOT deleted from the
              API response (`results.mastery` still exists for
              admin/analytics/debug consumers); only this learner-facing
              render is removed. */}

          {/* LX-9R5 PART K: the per-concept raw mastery delta
              (previousMastery% -> newMastery%) is removed for the same
              reason as the single-concept block above -- never deleted
              from the underlying data, just not rendered as the
              learner-facing per-concept summary here. The evidence-
              strength chip (already canonical, never a raw score)
              remains. */}
          {perConcept.length > 1 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <p className="label" style={{ color: 'var(--text-muted)', marginBottom: 6 }}>{at['quiz.perConceptResultsTitle']}</p>
              {perConcept.map((p: any) => (
                <div key={p.conceptId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13.5, marginBottom: 4, gap: 8 }}>
                  <span>
                    {p.conceptLabel}
                    {p.evidenceQualification && (
                      <span
                        className="chip"
                        style={{ marginLeft: 6, fontSize: 11 }}
                        title={at['quiz.evidenceStrengthExplain']}
                      >
                        {evidenceStrengthLabel(p.evidenceQualification.strength)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* UX-4 (readiness consistency): the legacy "predicted -> actual"
              readiness % is not shown -- the Student's one readiness is the
              F9 status in Preparación de examen. The field stays in the API. */}

        </section>

          {/* CANON-V2-FINAL-HARDENING Section 10 -- the TRANSFER-specific
              results breakdown: the 3 challenge scores shown
              individually (never collapsed into one number the learner
              can't interpret), then a translated pedagogical
              interpretation of the diagnostic on failure -- never the
              raw engine enum (RETENTION_WEAKNESS etc). The CTA the
              canonical-next-step card below shows is computed from the
              SAME fresh `canonicalResults` the rollback already ran
              against server-side -- this block never independently
              decides where to go next, only explains what just
              happened. */}
          {results.transferResult && (
            <section className="card ls-panel" aria-labelledby="ls-transfer-breakdown">
              <p id="ls-transfer-breakdown" className="ls-panel-label">{at['quiz.transferResultTitle']}</p>
              <div className="ls-rows">
                <div className="ls-row">
                  <span>{at['quiz.transferChallengeNear']}</span>
                  <span className="tabular">{results.transferResult.nearScore}%</span>
                </div>
                <div className="ls-row">
                  <span>{at['quiz.transferChallengeContextual']}</span>
                  <span className="tabular">{results.transferResult.contextualScore}%</span>
                </div>
                <div className="ls-row">
                  <span>{at['quiz.transferChallengeHigher']}</span>
                  <span className="tabular">{results.transferResult.higherScore}%</span>
                </div>
                <div className="ls-row ls-row--total">
                  <span>{at['quiz.transferOverallLabel']}</span>
                  <span className="tabular">{results.transferResult.overallScore}%</span>
                </div>
              </div>
              {!results.transferResult.passed && results.transferResult.diagnostic && (
                <p className="ls-outcome-body">
                  {results.transferResult.diagnostic === 'RETENTION_WEAKNESS'
                    ? at['quiz.transferDiagnosticRetentionWeakness']
                    : results.transferResult.diagnostic === 'FOUNDATIONAL_PROCEDURAL_FAILURE'
                    ? at['quiz.transferDiagnosticFoundationalProceduralFailure']
                    : at['quiz.transferDiagnosticApplicationContextWeakness']}
                </p>
              )}
            </section>
          )}
          {/* CANON-R6/R6R1 Part 14-17 -- for ANY v1 attempt,
              `canonicalResults` (a FRESH getCanonicalPedagogicalDecision,
              computed by the server strictly after the evidence write)
              is the SOLE next-step authority -- never inferred from
              score/quizMode/mastery deltas here, and never shown
              alongside the legacy `messageText` next-step line below
              (which CANON-R6R1 now gates on `!isV1Result`). Legacy
              (non-v1) Results are completely unaffected: none of these
              three blocks render when `canonicalResultsStatus` is the
              default 'NOT_V1'.
              CANON-V2-FINAL-HARDENING Section 9/10 -- RETAIN and
              TRANSFER stages now also render their own real next-step
              copy (previously fell through to `null`, showing nothing
              at all after a Retain or Transfer attempt). */}
          {results.canonicalResultsStatus === 'OK' && results.canonicalResults && (
            <section className="card ls-panel ls-next" data-testid="results-next-step" aria-labelledby="ls-next-title">
              <p id="ls-next-title" className="ls-panel-label">{at['quiz.canonicalNextStepTitle']}</p>
              <p className="ls-next-text">
                {results.canonicalResults.actionState === 'WAITING'
                  ? (results.canonicalResults.nextEligibleAt
                      ? at['conceptMission.noActionRetentionWaitingBodyWithDate'].replace('{date}', new Date(results.canonicalResults.nextEligibleAt).toLocaleDateString(quizLanguage))
                      : at['conceptMission.noActionRetentionWaitingBody'])
                  : results.canonicalResults.stage === 'PROVE'
                    ? at['quiz.canonicalNextProve']
                    : results.canonicalResults.stage === 'PRACTICE'
                      ? at['quiz.canonicalNextPractice']
                      : results.canonicalResults.stage === 'RETAIN'
                        ? at['quiz.canonicalNextRetain']
                        : results.canonicalResults.stage === 'TRANSFER'
                          ? at['quiz.canonicalNextTransfer']
                          : results.canonicalResults.stage === 'LEARN'
                            ? at['quiz.canonicalNextLearn']
                            : results.canonicalResults.stage === 'CONSOLIDATED'
                              ? at['quiz.canonicalNextConsolidated']
                              : null}
              </p>
              {/* UX-3: the ONE continue action sits with the canonical next
                  step it resolves -- the resolver re-reads the same truth. */}
              {continuation(true)}
            </section>
          )}
          {results.canonicalResultsStatus === 'V1_ACTIVITY_CONTRACT_VIOLATION' && (
            <InlineAlert tone="info" title={at['quiz.canonicalContractViolation']} />
          )}
          {/* CANON-R6R1 Part 17 -- evidence write succeeded but the
              canonical re-fetch failed. The factual score/correct/
              incorrect card above already shows the attempt outcome;
              this is only a neutral "next step unavailable right now"
              notice -- never legacy progression copy, never an invented
              stage. */}
          {results.canonicalResultsStatus === 'CANONICAL_RESULTS_UNAVAILABLE' && (
            <InlineAlert tone="info" title={at['quiz.canonicalResultsUnavailable']} />
          )}


        {(results.verificationNeeded || []).length > 0 && (
          <section className="card ls-panel" aria-labelledby="ls-verify-title">
            <p id="ls-verify-title" className="ls-panel-label">{at['quiz.verificationTitle']}</p>
            {(results.verificationNeeded || []).map((v: any) => {
              const resolved = verificationResults[v.conceptId];
              if (resolved) {
                return (
                  <div key={v.conceptId} style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--border-default)' }}>
                    <p style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{v.conceptLabel}</p>
                    <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                      {resolved.outcome === 'CONFIRMED'
                        ? at['quiz.verificationConfirmed']
                        : resolved.outcome === 'CONTRADICTED'
                        ? at['quiz.verificationContradicted']
                        : at['quiz.verificationInconclusive']}
                    </p>
                    {resolved.evidenceQualification && (
                      <span className="chip" style={{ fontSize: 11, marginTop: 4, display: 'inline-block' }}>
                        {evidenceStrengthLabel(resolved.evidenceQualification.strength)}
                      </span>
                    )}
                  </div>
                );
              }
              return (
                <div key={v.conceptId} style={{ padding: 'var(--space-4) 0', borderTop: '1px solid var(--border-default)' }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{v.conceptLabel}</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{at['quiz.verificationExplain']}</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '8px 0' }}>
                    <MathText text={v.question.question} />
                  </p>
                  {v.question.visualAid && <VisualAidView aid={v.question.visualAid} />}
                  {v.question.answerFormat === 'single_choice' ? (
                    <div role="radiogroup" aria-label={at['quiz.verificationTitle']} className="ls-options">
                      {(v.question.options || []).map((opt: any, i: number) => {
                        const isSelected = verificationAnswers[v.conceptId] === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            className="ls-option"
                            onClick={() => setVerificationAnswers((prev) => ({ ...prev, [v.conceptId]: opt.id }))}
                          >
                            <span className="ls-option-key" aria-hidden>{String.fromCharCode(65 + i)}</span>
                            <span className="ls-option-text"><MathText text={opt.text} /></span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    (() => {
                      // LX-8R2-R1/LX-8R3 R3/R6/R9/R16: same reasoning as the
                      // standalone resume-verification branch above -- an
                      // inline post-quiz Assessment verification question is
                      // also a persisted GeneratedQuestion, so the SAME
                      // canonical contracts are computed inline, reusing
                      // the SAME activityLanguageContext/modalityCapabilities
                      // already in scope for the main flow, rendering the
                      // SAME UnifiedResponseComposer as every other surface.
                      const vContract = deriveResponseEvidenceContract(
                        { type: v.question.type, expectedReasoningType: v.question.expectedReasoningType ?? null },
                        'ASSESSMENT',
                      );
                      const vIc = buildInteractionContract({
                        integrityMode: 'ASSESSMENT',
                        answerFormat: v.question.answerFormat,
                        activityLanguage: activityLanguageContext,
                        capabilities: modalityCapabilities,
                      });
                      return (
                        <UnifiedResponseComposer
                          value={verificationAnswers[v.conceptId] || ''}
                          onChange={(val) => setVerificationAnswers((prev) => ({ ...prev, [v.conceptId]: val }))}
                          responseKind={vContract.kind}
                          activityLanguageContext={activityLanguageContext}
                          voiceEnabled={vIc.inputModes.includes('VOICE')}
                          mathEnabled={isMathCapableContext(subjectName)}
                          studentId={studentId}
                          conceptId={v.conceptId}
                          activityType="assessment_verification"
                          placeholder={at['quiz.typeAnswer']}
                        />
                      );
                    })()
                  )}
                  {verificationError[v.conceptId] && (
                    <p role="alert" style={{ fontSize: 12.5, color: 'var(--error)', marginTop: 6 }}>{at['common.error']}</p>
                  )}
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 8 }}
                    disabled={!verificationAnswers[v.conceptId] || !!verificationSubmitting[v.conceptId]}
                    aria-busy={!!verificationSubmitting[v.conceptId]}
                    onClick={() => submitVerification(v.conceptId)}
                  >
                    {verificationSubmitting[v.conceptId] ? at['quiz.submitting'] : at['quiz.verificationSubmit']}
                  </button>
                </div>
              );
            })}
          </section>
        )}

        {/* LX-4R R7: canonical Evidence Sufficiency after INDEPENDENT
            evidence -- one correct answer is not "Prove complete". The
            server re-read the mastery-policy gap; this only presents it
            and NEVER decides the next activity (LX-5). */}
        {results.proveSufficiency && (
          <div
            className="card ls-panel"
            style={{ borderColor: results.proveSufficiency.sufficient ? 'var(--success)' : 'var(--warning)' }}
          >
            <p className="label" style={{ color: results.proveSufficiency.sufficient ? 'var(--success)' : 'var(--warning)', margin: '0 0 4px' }}>
              {results.proveSufficiency.sufficient ? at['prove.sufficientTitle'] : at['prove.moreNeededTitle']}
            </p>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
              {results.proveSufficiency.sufficient
                ? at['prove.sufficientBody']
                : at['prove.moreNeededBody'].replace('{n}', String(results.proveSufficiency.remainingGap))}
            </p>
          </div>
        )}

        {/* LX-4R R8: surfaced authority mismatch -- Phase 3C launched a
            canonical PRACTICE/PROVE activity with no remaining evidence
            gap. Not hidden behind an execution minimum. */}
        {countAuthority?.zeroGapMismatch && (
          <p className="ls-note">
            {at['activeLearning.activityComplete']}
          </p>
        )}

        {/* LX-5D: the activity no longer dead-ends at "back to subject".
            One canonical continuation -- the resolver re-reads Phase 4 /
            first-touch and launches the next canonical action, or
            returns to the Concept Mission. For Prove, an insufficient
            gap simply means the canonical re-read keeps the same
            purpose (no local "if sufficient => RETAIN"). */}
        {!canonicalNextShown && continuation(false)}

        <div className="ls-secondary">
          <button className="btn btn-secondary" onClick={() => setReviewing(true)}>{at['xs.review']}</button>
          {PRACTICE_EVIDENCE_MODES.includes(quizMode) && !resumeVerifyAttemptId && studentId && (
            <button className="btn btn-secondary" onClick={() => studentId && generateQuiz(studentId)}>
              {at['activeLearning.practiceAgain']}
            </button>
          )}
        </div>
        {PRACTICE_EVIDENCE_MODES.includes(quizMode) && !resumeVerifyAttemptId && (
          <p className="ls-note">{at['activeLearning.retryNote']}</p>
        )}
      </div>
    );
  }

  // LX-4R R1/R2/R3: the teach-first phase, when the canonical Teaching
  // Experience prescribes it. Renders EXPLAIN / MODEL / GUIDE, then
  // hands off to the questions.
  // LX-4P-PERF-R1 R3: `quizId` is NOT required -- the teaching stage
  // renders while the question batch is still generating in the
  // background (EXPLAIN/MODEL need only conceptId; GUIDE waits for the
  // session internally).
  if (
    phase === 'quiz' &&
    teachingStage === 'teaching' &&
    teachingExperience &&
    studentId &&
    conceptId
  ) {
    return (
      <div className="ls" data-kind={activityKind}>
      <SessionHeader
        kind={activityKind}
        kindLabel={at[kindLabelKey(activityKind)]}
        title={conceptLabel || subjectName || at[kindLabelKey(activityKind)]}
        context={conceptLabel ? subjectName : null}
      />
      <TeachingIntro
        view={teachingExperience}
        studentId={studentId}
        quizId={quizId}
        conceptId={conceptId}
        conceptLabel={subjectName}
        quizMode={quizMode}
        locale={quizLanguage}
        // LX-4P-PERF-R1E-R1 R2/R5: where "Exit the activity" goes when a
        // canonically required GUIDE stage fails to prepare -- the
        // Concept Mission, never a silent fall-through to Practice.
        exitHref={subjectId ? conceptMissionPath({ subjectId, conceptId }) : '/dashboard/today'}
        // UX-5 closure: the teach-first stages (EXPLAIN/MODEL/GUIDE) may open
        // the Tutor with context -- only before a PRACTICE-evidence activity.
        tutorSubjectId={subjectId && PRACTICE_EVIDENCE_MODES.includes(quizMode) ? subjectId : null}
        onDone={() => setTeachingStage('questions')}
      />
      </div>
    );
  }

  // LX-4P-PERF-R1 R3/R25: teaching is done but the background question
  // batch isn't ready yet -- a brief recoverable state, never a dead end.
  // RELEASE-R1 PART D: "never a return to Concept Mission" no longer
  // holds unconditionally -- it is still correct for a genuine
  // generation failure (retry in place, exactly as before), but a
  // canonical-state MISMATCH (genErrorReason set) is the ONE exception:
  // retrying the identical request would fail again identically
  // (canonical state, not the provider, rejected it), so THAT case
  // routes to Concept Mission instead, matching `generateQuiz`'s own
  // `errorReason` handling above.
  if (phase === 'quiz' && teachingStage === 'questions' && questions.length === 0 && genState !== 'ready') {
    if (genErrorReason === 'ENTITLEMENT_REQUIRED') return licenseRequiredCard();
    if (genErrorReason === 'ZERO_GAP_PRACTICE_MISMATCH') {
      return (
        <div className="ls" data-kind={activityKind}>
          <InlineAlert
            tone="info"
            title={at['quiz.canonicalStateChanged']}
            actions={
              <Link href={subjectId && conceptId ? conceptMissionPath({ subjectId, conceptId }) : '/dashboard/today'} className="btn btn-primary">
                {at['continuation.backToConcept']}
              </Link>
            }
          />
        </div>
      );
    }
    if (genState !== 'error') return preparingView(at['practice.preparing']);
    return (
      <div className="ls" data-kind={activityKind}>
        {genState === 'error' ? (
          <InlineAlert
            tone="error"
            title={at['practice.prepareFailedTitle']}
            body={at['practice.prepareFailedBody']}
            actions={
            <button
              type="button"
              className="btn btn-primary"
              // LX-9 FINAL: this state was produced by `startCanonicalActivity`'s
              // own background generation wave failing (genState='error'),
              // NEVER by `generateQuiz` -- retrying must re-run the SAME
              // function that actually failed. The previous `generateQuiz(...)`
              // call here was a different, setup/legacy-flow retry path: it
              // immediately calls `setPhase('loading')`, so on a second
              // failure it lands the learner in the unrelated top-level
              // `phase==='error'` ("Couldn't load the quiz") state instead of
              // retrying in place -- turning one recoverable failure into a
              // different, more severe-looking one (the proven live bug:
              // "Couldn't prepare your practice" -> retry -> "Couldn't load
              // the quiz"). `startCanonicalActivity` resets its own
              // `genState`/`error` at its top and stays on `phase==='quiz'`
              // throughout, so a second failure re-renders this SAME recoverable
              // card, never a different one.
              onClick={() => { if (studentId) startCanonicalActivity(studentId); }}
            >
              {at['practice.prepareRetry']}
            </button>
            }
          />
        ) : null}
      </div>
    );
  }

  // CANON-V2-PREVIEW-CERT Section 14 -- TRANSFER's own one-time
  // pre-execution framing screen: makes the 3 challenge types
  // perceptible (translated into learner language, never the raw
  // NEAR/CONTEXTUAL/HIGHER enum) BEFORE the learner starts, distinct
  // from the in-execution challenge-type label (the progress indicator
  // above) and from the post-completion Results breakdown.
  if (quizMode === 'canonical_transfer' && questions.length > 0 && !transferIntroDismissed) {
    return (
      <div className="ls" data-kind={activityKind}>
        <SessionHeader
          kind={activityKind}
          kindLabel={at[kindLabelKey(activityKind)]}
          title={conceptLabel || subjectName || at[kindLabelKey(activityKind)]}
          context={conceptLabel ? subjectName : null}
          purpose={at[kindPurposeKey(activityKind)]}
        />
        <section className="card ls-teach-card" aria-labelledby="ls-transfer-intro">
          <h2 id="ls-transfer-intro" className="ls-teach-title">{at['quiz.transferIntroBody']}</h2>
          <ol className="ls-worked">
            {(['quiz.transferChallengeNear', 'quiz.transferChallengeContextual', 'quiz.transferChallengeHigher'] as const).map((k, i) => (
              <li key={k}>
                <span className="ls-worked-num" aria-hidden>{i + 1}</span>
                <span className="ls-worked-body">{at[k]}</span>
              </li>
            ))}
          </ol>
          <div className="ls-teach-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setTransferIntroDismissed(true)}>
              {at['quiz.transferIntroStart']}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const q = questions[current];
  if (!q) return null;

  // LX-4F (presentation): the learner sees BEFORE answering what a
  // complete response is. Presentation-only -- the server-side grader
  // guard (applyResponseContractGuard) is the enforcement authority.
  // LX-8R1 R1: reuses the SAME coarseEvidenceMode already computed
  // above for interactionContract -- never a second, independently
  // maintained copy of this ternary.
  const clientEvidenceMode = coarseEvidenceMode;
  const responseContract = deriveResponseEvidenceContract(
    // LX-4R R5: the generator now populates expectedReasoningType, so the
    // learner-facing "what's being asked" line matches the grader's view.
    { type: q.type as QuestionType, expectedReasoningType: ((q as any).expectedReasoningType as ExpectedReasoningType | undefined) ?? null },
    clientEvidenceMode,
  );
  // LX-8R1 R1: the ONE interaction-policy authority for this question --
  // computed once above (useMemo), never re-derived here. Guaranteed
  // non-null: `currentQuestionForContract` (questions[current]) equals
  // `q` at this point, past the `if (!q) return null` guard above.
  const ic = interactionContract!;
  // Choice-based answers get a phone-sticky primary action; free-text /
  // math answers keep it inline so it never fights the math keyboard.
  const stickyAction = q.answerFormat === 'single_choice' || q.answerFormat === 'multi_choice';

  return (
    <div className="ls" data-kind={activityKind}>
      {/* LX-4P-R2: a mid-attempt question-language change first tries
          same-item localization (/api/quizzes/localize-question). This
          dialog is only the FALLBACK -- shown when no safe in-place
          translation could be produced (localizeFailedFallback) or when
          there is no live session yet. Confirming it starts a new
          activity. UI language is a separate account setting this
          control never touches. */}
      {pendingLanguageSwitch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lx-langswitch-title"
          style={{
            position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)', padding: 'var(--space-4)',
          }}
        >
          <div className="card" style={{ maxWidth: 420, padding: 'var(--space-6)' }}>
            <h2 id="lx-langswitch-title" style={{ fontSize: 17, fontWeight: 650, margin: '0 0 var(--space-2)' }}>
              {at[localizeFailedFallback ? 'quiz.langSwitch.cantLocalizeTitle' : 'quiz.langSwitch.title']}
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 var(--space-4)' }}>
              {at[localizeFailedFallback ? 'quiz.langSwitch.cantLocalizeBody' : 'quiz.langSwitch.body'].replace(
                '{lang}',
                LOCALE_NAMES[pendingLanguageSwitch],
              )}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost" onClick={cancelPendingLanguageSwitch}>
                {at['quiz.langSwitch.cancel']}
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmPendingLanguageSwitch}>
                {localizeFailedFallback
                  ? at['quiz.langSwitch.startNewActivity']
                  : at['quiz.langSwitch.confirm'].replace('{lang}', LOCALE_NAMES[pendingLanguageSwitch])}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UX-3: one focused header -- kind, concept, purpose, position.
          LX-4K: Focus Mode already provides the Exit affordance. The
          question-language picker (not the UI language) stays, demoted
          into the header tools. */}
      <SessionHeader
        kind={activityKind}
        kindLabel={at[kindLabelKey(activityKind)]}
        title={conceptLabel || subjectName || at[kindLabelKey(activityKind)]}
        context={conceptLabel ? subjectName : null}
        purpose={at[kindPurposeKey(activityKind)]}
        progress={{
          current: current + 1,
          total: questions.length,
          label: at['xs.progressLabel'],
          // CANON-V2-PREVIEW-CERT Section 14 -- Transfer identifies
          // WHICH challenge type the learner is on (translated into
          // learner language, never the raw NEAR/CONTEXTUAL/HIGHER
          // enum) instead of the generic "Question X of Y" every
          // other mode keeps using.
          text: quizMode === 'canonical_transfer' && questions[current]?.transferDepth
            ? `${
                questions[current].transferDepth === 'NEAR'
                  ? at['quiz.transferChallengeNear']
                  : questions[current].transferDepth === 'CONTEXTUAL'
                  ? at['quiz.transferChallengeContextual']
                  : at['quiz.transferChallengeHigher']
              } · ${current + 1}/${questions.length}`
            : at['xs.progress'].replace('{n}', String(current + 1)).replace('{total}', String(questions.length)),
        }}
        tools={
          <select
            className="ls-lang"
            value={quizLanguage}
            disabled={switchingLanguage}
            onChange={(e) => changeQuizLanguage(e.target.value as Locale)}
            title={at['quiz.languagePickerLabel']}
            aria-label={at['quiz.languagePickerLabel']}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
            ))}
          </select>
        }
      />

      {resumedFromDraft && current + 1 <= questions.length && (
        <div className="ls-resumed">
          <InlineAlert tone="info" title={at['xs.resumed']} />
        </div>
      )}

      <section className="card ls-task" aria-labelledby="ls-question" style={{ opacity: switchingLanguage ? 0.5 : 1 }}>
        {/* R9 + UX-3: in an independent activity (Prove / Retain / Transfer /
            assessment) this line states WHY help is unavailable ("Por tu
            cuenta · Sin pistas ni ayuda…"), not just omits it; the header
            names the kind -- never "Demuéstralo" on a Retain or Transfer.
            Phase 6 Closeout A: in-flow assisted/independent indicator.
            Presentation only -- derived from the quiz mode already in
            the URL (or the resumed verification flow), never from
            mastery/retention/hint thresholds and never from a
            TeachingIntent fetch. Server (canUseAI) stays the AI-use
            authority. */}
        {(() => {
          const isVerify = !!resumeVerifyAttemptId;
          const supported = !isVerify && PRACTICE_EVIDENCE_MODES.includes(quizMode);
          return (
            <LearningSupportStatus
              assistanceMode={supported ? 'SUPPORTED' : 'INDEPENDENT'}
              hintsAvailable={supported}
              context={isVerify ? 'SOLO' : QUIZ_SUPPORT_CONTEXT[quizMode]}
              t={at}
            />
          );
        })()}
        {/* UX/CANON-R1 PART A-C: LX-4J removed the intrinsic 1-5
            difficulty dots because, at the time, there was no canonical
            learner-relative difficulty authority -- showing a
            five-level scale would have implied one that didn't exist.
            StudyUs now DOES canonically determine difficulty
            (resolveTargetDifficulty), so showing it is no longer a
            false claim -- it is SYSTEM-DEFINED, LEARNER-VISIBLE, and
            NOT LEARNER-EDITABLE: no selector, no slider, no
            preference, StudyUs remains the sole authority. */}
        <div className="ls-meta">
          <DifficultyIndicator value={q.difficulty} t={at} />
          {typeof q.calculatorAllowed === 'boolean' && (
            <span
              title={q.calculatorAllowed ? at['quiz.calculatorAllowed'] : at['quiz.calculatorNotAllowed']}
              aria-label={q.calculatorAllowed ? at['quiz.calculatorAllowed'] : at['quiz.calculatorNotAllowed']}
              role="img"
              style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 'var(--radius-full)',
                border: `1px solid ${q.calculatorAllowed ? 'var(--border-default)' : 'var(--error)'}`,
                fontSize: 14,
              }}
            >
              <span aria-hidden>🧮</span>
              {!q.calculatorAllowed && (
                <svg
                  aria-hidden
                  viewBox="0 0 26 26"
                  width={26}
                  height={26}
                  style={{ position: 'absolute', inset: 0 }}
                >
                  <circle cx="13" cy="13" r="11" fill="none" stroke="var(--error)" strokeWidth="2" />
                  <line x1="5" y1="21" x2="21" y2="5" stroke="var(--error)" strokeWidth="2" />
                </svg>
              )}
            </span>
          )}
        </div>

        <div className="ls-question-row">
          <h2 id="ls-question" className="ls-question">
            <MathText text={q.question} />
          </h2>
          {/* LX-8 R8/R22: read-aloud is accessibility, not help -- offered
              regardless of quizMode/evidenceMode, reading exactly this
              question text, nothing more. LX-8R1 R1: gated by the ONE
              interactionContract authority (ic.outputModes), never a
              second "AUDIO allowed because..." rule here. */}
          {ic.outputModes.includes('AUDIO') && (
            <ReadAloudButton
              text={q.question}
              activityLanguage={ic.activityLanguage}
              label={at['multimodal.readAloud']}
              stopLabel={at['multimodal.stopReading']}
              conceptId={conceptId ?? undefined}
            />
          )}
        </div>

        {at[`responseContract.${responseContract.kind}` as keyof typeof t] && (
          <p className="al-response-req ls-ask">
            <strong>{at['responseContract.label']}:</strong>{' '}
            {at[`responseContract.${responseContract.kind}` as keyof typeof t]}
          </p>
        )}

        {q.visualAid && <VisualAidView aid={q.visualAid} />}

        {/* LX-4R R4: the contextual help surface (PRACTICE only). The
            server (/api/learning/contextual-help -> canUseAI) is the
            authority; it is never rendered for Prove / assessment. */}
        {PRACTICE_EVIDENCE_MODES.includes(quizMode) && studentId && quizId && (
          <ContextualHelp
            key={`${quizId}:${current}`}
            studentId={studentId}
            quizId={quizId}
            questionIndex={current}
            locale={quizLanguage}
            tutor={subjectId && conceptId ? { subjectId, conceptId, from: TUTOR_FROM_QUIZ_MODE[quizMode] ?? 'PRACTICE' } : null}
          />
        )}

        {q.askConfidence && (
          <div role="radiogroup" aria-label={at['quiz.confidenceQuestion']} className="ls-confidence">
            <p className="ls-confidence-title">{at['quiz.confidenceQuestion']}</p>
            <div className="ls-confidence-options">
              {(['NOT_SURE', 'SOMEWHAT_SURE', 'VERY_SURE'] as ConfidenceLevel[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={confidenceSelected === level}
                  onClick={() => setConfidenceSelected(level)}
                  className={`btn ${confidenceSelected === level ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {level === 'NOT_SURE' ? at['quiz.confidenceLow'] : level === 'SOMEWHAT_SURE' ? at['quiz.confidenceMedium'] : at['quiz.confidenceHigh']}
                </button>
              ))}
            </div>
          </div>
        )}

        <fieldset className="ls-answer" disabled={answerLocked || answerCheck?.status === 'checking' || submitting}>
        {(q.answerFormat === 'single_choice') && (
          <div role="radiogroup" aria-labelledby="ls-question" className="ls-options">
            {(q.options || []).map((opt, i) => {
              const letter = String.fromCharCode(65 + i);
              const isSelected = singleChoice === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className="ls-option"
                  onClick={() => setSingleChoice(opt.id)}
                  disabled={switchingLanguage}
                >
                  <span className="ls-option-key" aria-hidden>{letter}</span>
                  <span className="ls-option-text"><MathText text={opt.text} /></span>
                </button>
              );
            })}
          </div>
        )}

        {q.answerFormat === 'multi_choice' && (
          <div className="ls-options">
            <p className="ls-instructions">{at['quiz.selectAllThatApply']}</p>
            {(q.options || []).map((opt) => {
              const isSelected = multiChoice.includes(opt.id);
              return (
                <label key={opt.id} className="ls-option">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() =>
                      setMultiChoice((prev) => (prev.includes(opt.id) ? prev.filter((id) => id !== opt.id) : [...prev, opt.id]))
                    }
                  />
                  <span className="ls-option-text"><MathText text={opt.text} /></span>
                </label>
              );
            })}
          </div>
        )}

        {q.answerFormat === 'text' && (
          <div>
            {/* LX-8R3/LX-8R4 R1/R7/A2: ONE response surface -- prose,
                structured math, or any mix, in the order the learner
                writes them -- replacing the old "math final-answer box
                PLUS a separate reasoning box" two-editor UX.
                `responseContract.kind` selects the ONE instruction line
                (R7) only -- it is NEVER used to decide math capability
                (LX-8R4 A2: evidence kind and math-entry capability are
                separate axes; a JUSTIFY/EXPLAIN ask in a math subject
                still gets the math affordance). `textAnswer` now holds
                the FULL serialized ResponseDocument (response-
                document.ts), still the one string
                `encodeCurrentAnswer`/`canProceed` read --
                `isMathCapableContext` (the ONE shared capability
                classifier, subject-only, no kind parameter) decides
                only whether a math block/keyboard is ever offered
                within this same composer, never which of two composers
                renders (R16: the same component operates prose-only
                when false). Voice eligibility remains the ONE
                interactionContract authority (ic.inputModes). */}
            <UnifiedResponseComposer
              value={textAnswer}
              onChange={setTextAnswer}
              responseKind={responseContract.kind}
              activityLanguageContext={activityLanguageContext}
              voiceEnabled={ic.inputModes.includes('VOICE')}
              mathEnabled={isMathCapableContext(subjectName)}
              studentId={studentId}
              conceptId={conceptId ?? undefined}
              activityType={quizMode}
              placeholder={at['quiz.typeAnswer']}
            />
          </div>
        )}

        {q.answerFormat === 'matching' && (
          <div className="ls-pairs">
            <p className="ls-instructions">{at['quiz.matchInstructions']}</p>
            {(q.matchingLeft || []).map((left, i) => (
              <div key={left} className="ls-pair">
                <span className="ls-pair-text" id={`ls-match-${i}`}><MathText text={left} /></span>
                <select
                  className="ui-select"
                  aria-labelledby={`ls-match-${i}`}
                  value={matchingAnswer[left] || ''}
                  onChange={(e) => setMatchingAnswer((prev) => ({ ...prev, [left]: e.target.value }))}
                >
                  <option value="" disabled>—</option>
                  {(q.matchingRightShuffled || []).map((right) => (
                    <option key={right} value={right}>{right}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {q.answerFormat === 'ordering' && (
          <div className="ls-order">
            <p className="ls-instructions">{at['quiz.orderInstructions']}</p>
            {orderingAnswer.map((item, i) => (
              <div key={item} className="ls-order-item">
                <span className="ls-order-index">{i + 1}</span>
                <span className="ls-option-text"><MathText text={item} /></span>
                <span className="ls-order-moves">
                  <button type="button" className="btn btn-ghost" aria-label={`${at['xs.moveUp']}: ${item}`} onClick={() => moveOrderingItem(i, -1)} disabled={i === 0}>↑</button>
                  <button type="button" className="btn btn-ghost" aria-label={`${at['xs.moveDown']}: ${item}`} onClick={() => moveOrderingItem(i, 1)} disabled={i === orderingAnswer.length - 1}>↓</button>
                </span>
              </div>
            ))}
          </div>
        )}

        {q.answerFormat === 'classification' && (
          <div className="ls-pairs">
            <p className="ls-instructions">{at['quiz.classifyInstructions']}</p>
            {(q.classificationItems || []).map((item, i) => (
              <div key={item} className="ls-pair">
                <span className="ls-pair-text" id={`ls-class-${i}`}><MathText text={item} /></span>
                <select
                  className="ui-select"
                  aria-labelledby={`ls-class-${i}`}
                  value={classificationAnswer[item] || ''}
                  onChange={(e) => setClassificationAnswer((prev) => ({ ...prev, [item]: e.target.value }))}
                >
                  <option value="" disabled>—</option>
                  {(q.classificationCategories || []).map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        </fieldset>

        {perQuestionFeedback && answerCheck?.index === current && answerCheck.status !== 'checking' && (
          <div
            role="status"
            aria-live="polite"
            className="ls-feedback"
            data-testid="answer-feedback"
            data-tone={answerCheck.status !== 'done' ? 'unavailable' : answerCheck.correct ? 'correct' : answerCheck.partial ? 'almost' : 'notyet'}
          >
            {answerCheck.status === 'unavailable' ? (
              <>
                {/* UX-3: a failed check is not a mistake -- say so, and let
                    the learner re-run the SAME read-only check. The answer
                    stays locked exactly as before. */}
                <p>{at['quiz.checkUnavailable']}</p>
                <button type="button" className="btn btn-secondary" onClick={checkAnswer}>{at['xs.checkRetry']}</button>
              </>
            ) : (
              <>
                <p className="ls-feedback-title">
                  {answerCheck.correct ? at['feedback.correct'] : answerCheck.partial ? at['feedback.almost'] : at['feedback.incorrect']}
                </p>
                {answerCheck.feedback ? (
                  <p><MathText text={answerCheck.feedback} /></p>
                ) : !answerCheck.correct ? (
                  // Structured formats carry no grader text: a short, visible "why"
                  // that does not reveal the right option.
                  <p>{at['quiz.checkIncorrectGeneric']}</p>
                ) : null}
                {!answerCheck.correct && answerCheck.direction && (
                  <p data-testid="answer-direction">
                    <strong>{at['quiz.feedbackDirection']}</strong> <MathText text={answerCheck.direction} />
                  </p>
                )}
                {/* Progressive scaffold: one extra hint per click, never the solution. */}
                {!answerCheck.correct &&
                  (answerCheck.scaffold ?? []).slice(0, answerCheck.scaffoldShown ?? 0).map((hint, i) => (
                    <p key={i} data-testid="answer-scaffold"><MathText text={hint} /></p>
                  ))}
                {!answerCheck.correct && (answerCheck.scaffoldShown ?? 0) < (answerCheck.scaffold?.length ?? 0) && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setAnswerCheck((prev) => (prev ? { ...prev, scaffoldShown: (prev.scaffoldShown ?? 0) + 1 } : prev))}
                  >
                    {(answerCheck.scaffoldShown ?? 0) === 0 ? at['quiz.keyIdeaShow'] : at['quiz.keyIdeaMore']}
                  </button>
                )}
                {!answerCheck.correct && (
                  <p className="ls-feedback-note">{at['quiz.checkHelpHint']}</p>
                )}
              </>
            )}
            {current + 1 < questions.length && (
              <p className="ls-feedback-note">{at['quiz.checkContinuity']}</p>
            )}
          </div>
        )}

        {safety && <SafetyNotice safety={safety} />}

        {/* UX-3: a failed submission is visible, announced, and recoverable.
            The answers stay exactly as entered; nothing was scored. */}
        {submitFailure && (
          <InlineAlert
            tone="error"
            title={at['xs.submitFailedTitle']}
            body={at[submitFailureKey(submitFailure)]}
            actions={
              submitFailure === 'EXPIRED' ? (
                <Link href={subjectId && conceptId ? conceptMissionPath({ subjectId, conceptId }) : '/dashboard/today'} className="btn btn-secondary">
                  {at['continuation.backToConcept']}
                </Link>
              ) : null
            }
          />
        )}

        <div className={`ls-actions${stickyAction ? ' ls-actions--sticky' : ''}`}>
          {perQuestionFeedback && !answerLocked ? (
            <button
              onClick={checkAnswer}
              disabled={!canProceed(q) || answerCheck?.status === 'checking' || switchingLanguage}
              aria-busy={answerCheck?.status === 'checking'}
              className="btn btn-primary btn-lg"
            >
              {answerCheck?.status === 'checking' ? at['xs.checking'] : at['quiz.checkAnswer']}
            </button>
          ) : submitFailure && submitFailure !== 'EXPIRED' ? (
            <button onClick={() => submitQuiz(answers, confidences)} disabled={submitting} aria-busy={submitting} className="btn btn-primary btn-lg">
              {submitting ? at['quiz.submitting'] : at['xs.retrySubmit']}
            </button>
          ) : (
            <button
              onClick={nextQuestion}
              disabled={!canProceed(q) || submitting || switchingLanguage || submitFailure === 'EXPIRED'}
              aria-busy={submitting}
              className="btn btn-primary btn-lg"
            >
              {submitting ? at['quiz.submitting'] : current + 1 < questions.length ? at['quiz.next'] : at['quiz.viewResults']}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
