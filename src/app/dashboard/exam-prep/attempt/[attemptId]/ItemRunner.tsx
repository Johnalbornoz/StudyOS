'use client';

/**
 * Track B -- the exam-taking runner (replaces the F15 one-item loop).
 *
 * Presentation + transport only. Every decision is the server's
 * (item-resolution.service.ts): which item, which section, how much time is
 * left, whether the Student may move to another item, whether feedback is
 * shown. The runner sends ANSWER STRINGS only -- never a question, an answer
 * key, a student id or a version id.
 *
 *   - sections with a server-timed clock (counts down locally, re-syncs with
 *     the server at zero: a HARD limit closes the section server-side);
 *   - shared stimulus (reading passage / PISA unit) above the question;
 *   - multi-part mark-scheme items (IB / Cambridge);
 *   - autosave (debounced) + refresh recovery: the server returns the same
 *     delivered item and the saved draft;
 *   - free order inside a section when the policy allows it;
 *   - breaks between sections; hand-in at any time.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n/messages';
import { PortfolioPanel, type PortfolioRequirements } from './PortfolioPanel';

// MathLive is browser-only.
const MathExpressionEditor = dynamic(() => import('@/components/MathExpressionEditor'), { ssr: false });
import { QuestionAnswerFields } from '@/components/quiz/QuestionAnswerFields';
import MathText from '@/components/MathText';
import { encodeClientAnswer } from '@/lib/quiz/client-answer-encoding';
import { SafetyNotice, safetyFromBody, type SafetyNoticeData } from '@/components/safety/SafetyNotice';

type AnswerFormat = 'single_choice' | 'multi_choice' | 'text' | 'matching' | 'ordering' | 'classification';

interface ClientPart {
  id: string;
  prompt: string;
  answerFormat: 'single_choice' | 'multi_choice' | 'text' | 'math';
  options?: { id: string; text: string }[];
  marks: number;
  unitRequired?: boolean;
  showWorking?: boolean;
}

/** Exam V2: a math answer as typed in the editor, plus optional working (read for method marks). */
interface MathStaged {
  latex: string;
  working?: string;
}

interface ClientItem {
  index: number;
  type: string;
  answerFormat: AnswerFormat;
  question: string;
  options?: { id: string; text: string }[];
  matchingLeft?: string[];
  matchingRightShuffled?: string[];
  orderingItemsShuffled?: string[];
  classificationItems?: string[];
  classificationCategories?: string[];
  calculatorAllowed?: boolean;
  marks: number;
  stimulus?: { key: string; title?: string; text: string };
  parts?: ClientPart[];
  commandTerm?: string;
  // ---- Exam V2 ----
  inputMode?: 'math' | 'portfolio';
  unitRequired?: boolean;
  showWorking?: boolean;
  calculator?: 'NONE' | 'ALLOWED' | 'SCIENTIFIC_REQUIRED' | 'GDC_REQUIRED';
  originLabel?: string;
  rubricCriteria?: Array<{ id: string; name: string; maxMarks: number }>;
  portfolioRequirements?: PortfolioRequirements;
}

/** Exam V2 labels (math editor, working, portfolio, content origin...). */
export type ItemRunnerV2Labels = Record<string, string>;

interface SectionView {
  index: number;
  count: number;
  key: string;
  name: string;
  startIndex: number;
  endIndex: number;
  durationSeconds: number | null;
  remainingSeconds: number | null;
  timeLimit: 'NONE' | 'SOFT' | 'HARD';
}

type NavStatus = 'OPEN' | 'DRAFT' | 'ANSWERED' | 'UNAVAILABLE' | 'SKIPPED' | 'MISSING';

export interface ItemRunnerLabels {
  loading: string;
  loadError: string;
  submit: string;
  submitting: string;
  submitError: string;
  progress: string;
  itemUnavailable: string;
  itemUnavailableReason: Record<string, string>;
  skip: string;
  skipping: string;
  complete: string;
  completeBody: string;
  finalize: string;
  finalizing: string;
  finalizeError: string;
  lastFeedback: string;
  section: string;
  timeLeft: string;
  overtime: string;
  timeUpHard: string;
  saved: string;
  saving: string;
  saveError: string;
  question: string;
  marks: string;
  resources: string;
  breakTitle: string;
  breakBody: string;
  endBreak: string;
  handIn: string;
  handInConfirm: string;
  handingIn: string;
  navLabel: string;
  navStatus: Record<NavStatus, string>;
  integrity: string;
  answerRecorded: string;
  invalidAnswer: string;
  part: string;
  answerPlaceholder: string;
  calculator: string;
  retry: string;
  v2?: ItemRunnerV2Labels;
}

/** Practice Coach (coached practice only; a simulation never receives it). The strategy is certified Exam Bank content. */
interface CoachStrategy { strategyType: string; noReliableShortcut: boolean; title: string; fastPath: string[]; whyFastPathWorks: string; directPath: string[]; commonTimeTrap: string; whenNotToUse: string; mentalMathOpportunity: string | null }
interface CoachTiming { targetSeconds: number; skipThresholdSeconds: number; targetProvenance: string; skipThresholdProvenance: string }
interface CoachView { timing: CoachTiming; elapsedSeconds: number; strategyAvailable: boolean; assisted: boolean; strategy: CoachStrategy | null }
interface SpeedReviewView { correct: boolean; assisted: boolean; targetSeconds: number; actualSeconds: number | null; deltaSeconds: number | null; verdict: string | null; targetProvenance: string; strategy: CoachStrategy }

function StrategyBody({ s, l, review }: { s: CoachStrategy; l: Record<string, string>; review: boolean }) {
  return (
    <div className="xr-coach-strategy">
      <p className="xr-coach-strategy-title"><strong>{s.noReliableShortcut ? l['exv2.coach.direct'] : l['exv2.coach.fast']}:</strong> {s.title}</p>
      <ol className="xr-coach-steps">{s.fastPath.map((x, i) => <li key={i}>{x}</li>)}</ol>
      {s.mentalMathOpportunity && <p><strong>{l['exv2.coach.mental']}:</strong> {s.mentalMathOpportunity}</p>}
      <p><strong>{l['exv2.coach.why']}:</strong> {s.whyFastPathWorks}</p>
      <p><strong>{l['exv2.coach.trap']}:</strong> {s.commonTimeTrap}</p>
      {review && (
        <>
          <p><strong>{l['exv2.coach.direct']}:</strong></p>
          <ol className="xr-coach-steps">{s.directPath.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </>
      )}
      <p className="ui-hint"><strong>{l['exv2.coach.notWhen']}:</strong> {s.whenNotToUse}</p>
    </div>
  );
}

type Phase = 'loading' | 'ready' | 'submitting' | 'unavailable' | 'skipping' | 'break' | 'complete' | 'handingIn' | 'error';

function decodeMath(value: unknown): MathStaged | undefined {
  if (typeof value === 'string') {
    if (value.trim().startsWith('{')) {
      try {
        return decodeMath(JSON.parse(value));
      } catch {
        return { latex: value };
      }
    }
    return { latex: value };
  }
  if (value && typeof value === 'object' && typeof (value as MathStaged).latex === 'string') return { latex: (value as MathStaged).latex, working: (value as MathStaged).working };
  return undefined;
}

function encodeMath(m: unknown): unknown {
  const v = decodeMath(m);
  if (!v || (!v.latex.trim() && !(v.working ?? '').trim())) return undefined;
  return v.working && v.working.trim() ? { latex: v.latex, working: v.working } : v.latex;
}

function decodeDraft(item: ClientItem, draft: string | null): unknown {
  if (draft === null || draft === undefined) return undefined;
  try {
    if (item.inputMode === 'portfolio') return JSON.parse(draft)?.submissionId;
    if (item.inputMode === 'math') return decodeMath(draft);
    if (item.parts) return JSON.parse(draft);
    switch (item.answerFormat) {
      case 'single_choice':
      case 'text':
        return draft;
      case 'multi_choice':
        return draft.split(',').map((s) => s.trim()).filter(Boolean);
      case 'matching':
      case 'classification':
        return JSON.parse(draft);
      case 'ordering': {
        const order = JSON.parse(draft) as string[];
        return Object.fromEntries(order.map((it, i) => [it, i + 1]));
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function encodeAnswer(item: ClientItem, staged: unknown): string {
  if (item.inputMode === 'portfolio') return typeof staged === 'string' && staged ? JSON.stringify({ submissionId: staged }) : '';
  if (item.inputMode === 'math') {
    const v = encodeMath(staged);
    return v === undefined ? '' : typeof v === 'string' ? v.trim() : JSON.stringify(v);
  }
  if (item.parts) {
    const map = (staged as Record<string, unknown>) || {};
    const out: Record<string, unknown> = {};
    for (const p of item.parts) {
      const v = map[p.id];
      if (p.answerFormat === 'math') {
        const m = encodeMath(v);
        if (m !== undefined) out[p.id] = m;
      } else if (p.answerFormat === 'multi_choice') {
        if (Array.isArray(v) && v.length > 0) out[p.id] = (v as string[]).join(',');
      } else if (typeof v === 'string' && v.trim() !== '') {
        out[p.id] = v;
      }
    }
    return Object.keys(out).length > 0 ? JSON.stringify(out) : '';
  }
  if (item.answerFormat === 'text') return typeof staged === 'string' ? staged.trim() : '';
  return encodeClientAnswer(item, staged);
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function ChoiceList({ name, options, multi, value, onChange }: { name: string; options: { id: string; text: string }[]; multi: boolean; value: unknown; onChange: (v: unknown) => void }) {
  const selected: string[] = multi ? ((value as string[]) || []) : value ? [value as string] : [];
  return (
    <div className="xr-choices" role={multi ? 'group' : 'radiogroup'}>
      {options.map((opt, at) => {
        const checked = selected.includes(opt.id);
        // The label the Student reads. An authored id is its own label ("A", "B"); an OPAQUE id (a certified item's
        // stable option identity) is never shown: the label is the letter of the position it is presented in.
        const label = /^[A-Za-z0-9]{1,2}$/.test(opt.id) ? opt.id : String.fromCharCode(65 + at);
        return (
          <label key={opt.id} className={`xr-choice${checked ? ' is-checked' : ''}`}>
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={name}
              checked={checked}
              onChange={(e) => {
                if (!multi) onChange(opt.id);
                else onChange(e.target.checked ? [...selected, opt.id] : selected.filter((id) => id !== opt.id));
              }}
            />
            <span className="xr-choice-key" aria-hidden>{label}</span>
            <span className="xr-choice-text"><MathText text={opt.text} /></span>
          </label>
        );
      })}
    </div>
  );
}

function MathInput({ id, value, onChange, showWorking, unitRequired, locale, labels }: { id: string; value: unknown; onChange: (v: MathStaged) => void; showWorking?: boolean; unitRequired?: boolean; locale: Locale; labels: ItemRunnerLabels }) {
  const v = decodeMath(value) ?? { latex: '' };
  const l = labels.v2 ?? {};
  return (
    <div className="exv2-math">
      <MathExpressionEditor value={{ latex: v.latex }} onChange={(next) => onChange({ ...v, latex: next.latex })} locale={locale} placeholder={l['exv2.math.placeholder'] ?? labels.answerPlaceholder} />
      <p className="ui-hint">{unitRequired ? l['exv2.math.unitRequired'] : l['exv2.math.hint']}</p>
      {showWorking && (
        <>
          <label htmlFor={`exv2-w-${id}`} className="ui-hint">{l['exv2.math.working']}</label>
          <textarea id={`exv2-w-${id}`} className="ui-input exv2-working" rows={4} placeholder={l['exv2.math.workingPlaceholder']} value={v.working ?? ''} onChange={(e) => onChange({ ...v, working: e.target.value })} />
        </>
      )}
    </div>
  );
}

function AnswerInput({ item, staged, onChange, labels, locale, instanceId, onPortfolioReady }: { item: ClientItem; staged: unknown; onChange: (v: unknown) => void; labels: ItemRunnerLabels; locale: Locale; instanceId: string | null; onPortfolioReady: (id: string | null) => void }) {
  if (item.inputMode === 'portfolio' && item.portfolioRequirements) {
    if (!instanceId) return <p className="xr-error">{labels.v2?.['exv2.portfolio.noInstance'] ?? labels.loadError}</p>;
    return <PortfolioPanel instanceId={instanceId} targetIndex={item.index} requirements={item.portfolioRequirements} labels={labels.v2 ?? {}} onReady={onPortfolioReady} />;
  }
  if (item.inputMode === 'math') {
    return <MathInput id={`q-${item.index}`} value={staged} onChange={onChange} showWorking={item.showWorking} unitRequired={item.unitRequired} locale={locale} labels={labels} />;
  }
  if (item.parts) {
    const map = (staged as Record<string, unknown>) || {};
    return (
      <ol className="xr-parts">
        {item.parts.map((p) => (
          <li key={p.id} className="xr-part">
            <div className="xr-part-head">
              <span className="xr-part-id">{labels.part.replace('{id}', p.id)}</span>
              <span className="xr-marks">{labels.marks.replace('{n}', String(p.marks))}</span>
            </div>
            <p className="xr-part-prompt">{p.prompt}</p>
            {p.answerFormat === 'math' ? (
              <MathInput id={`p-${item.index}-${p.id}`} value={map[p.id]} onChange={(v) => onChange({ ...map, [p.id]: v })} showWorking={p.showWorking} unitRequired={p.unitRequired} locale={locale} labels={labels} />
            ) : p.answerFormat === 'text' ? (
              <input
                className="ui-input"
                aria-label={`${labels.part.replace('{id}', p.id)}: ${p.prompt}`}
                placeholder={labels.answerPlaceholder}
                value={(map[p.id] as string) || ''}
                onChange={(e) => onChange({ ...map, [p.id]: e.target.value })}
              />
            ) : (
              <ChoiceList name={`p-${item.index}-${p.id}`} options={p.options ?? []} multi={p.answerFormat === 'multi_choice'} value={map[p.id]} onChange={(v) => onChange({ ...map, [p.id]: v })} />
            )}
          </li>
        ))}
      </ol>
    );
  }
  if ((item.answerFormat === 'single_choice' || item.answerFormat === 'multi_choice') && item.options) {
    return <ChoiceList name={`q-${item.index}`} options={item.options} multi={item.answerFormat === 'multi_choice'} value={staged} onChange={onChange} />;
  }
  if (item.answerFormat === 'text') {
    return item.type === 'numeric_problem' || item.type === 'short_answer' ? (
      <input className="ui-input" aria-label={labels.answerPlaceholder} placeholder={labels.answerPlaceholder} value={(staged as string) || ''} onChange={(e) => onChange(e.target.value)} />
    ) : (
      <textarea className="ui-input" rows={5} aria-label={labels.answerPlaceholder} placeholder={labels.answerPlaceholder} value={(staged as string) || ''} onChange={(e) => onChange(e.target.value)} />
    );
  }
  return <QuestionAnswerFields question={item} staged={staged} onChange={onChange} />;
}

export function ItemRunner({ attemptId, labels, locale = 'es', instanceId = null }: { attemptId: string; labels: ItemRunnerLabels; locale?: Locale; instanceId?: string | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [targetIndex, setTargetIndex] = useState(0);
  const [totalTargets, setTotalTargets] = useState(0);
  const [question, setQuestion] = useState<ClientItem | null>(null);
  const [section, setSection] = useState<SectionView | null>(null);
  const [navMode, setNavMode] = useState<'LINEAR' | 'FREE_ORDER_WITHIN_SECTION'>('LINEAR');
  const [navItems, setNavItems] = useState<Array<{ targetIndex: number; status: NavStatus }>>([]);
  const [resources, setResources] = useState<string[]>([]);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [staged, setStaged] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Human Agency P0-4: fixed safety response from the server (no AI involved).
  const [safety, setSafety] = useState<SafetyNoticeData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  // The governed delivery policy's item feedback (AFTER_EACH_ITEM): the grade of the previous answer. Independent of the
  // Practice Coach (a certified speed strategy is a separate capability); never sent by the server in a mock.
  const [lastEvaluation, setLastEvaluation] = useState<{ score: number; maxScore: number } | null>(null);
  const [coach, setCoach] = useState<CoachView | null>(null);
  const [coachSince, setCoachSince] = useState<number | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [lastReview, setLastReview] = useState<SpeedReviewView | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [deadline, setDeadline] = useState<number | null>(null);
  const [breakUntil, setBreakUntil] = useState<number | null>(null);
  const [nextSectionName, setNextSectionName] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string | null>(null);
  const dirty = useRef(false);

  const loadItem = useCallback(
    async (index?: number) => {
      setPhase('loading');
      setError(null);
      try {
        const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item${index === undefined ? '' : `?index=${index}`}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (body?.error === 'ATTEMPT_NOT_ACTIVE') {
            router.refresh();
            return;
          }
          setError(labels.loadError);
          setPhase('error');
          return;
        }
        const data = body.data;
        setTotalTargets(data.totalTargets ?? 0);
        if (data.outcome === 'COMPLETE') {
          setPhase('complete');
          return;
        }
        if (data.outcome === 'BREAK') {
          setBreakUntil(Date.now() + Math.max(0, new Date(data.breakUntil).getTime() - new Date(data.serverTime).getTime()));
          setNextSectionName(data.nextSectionName);
          setPhase('break');
          return;
        }
        setTargetIndex(data.targetIndex);
        setSection(data.section);
        setNavMode(data.navigation?.mode ?? 'LINEAR');
        setNavItems(data.navigation?.items ?? []);
        setResources(data.policy?.permittedResources ?? []);
        setDeadline(data.section?.remainingSeconds === null || data.section?.remainingSeconds === undefined ? null : Date.now() + data.section.remainingSeconds * 1000);
        if (data.outcome === 'ITEM_UNAVAILABLE') {
          setUnavailableReason(data.reason);
          setQuestion(null);
          setPhase('unavailable');
          return;
        }
        setQuestion(data.question);
        setCoach(data.coach ?? null);
        setCoachSince(data.coach ? Date.now() - data.coach.elapsedSeconds * 1000 : null);
        setStaged(decodeDraft(data.question, data.draft));
        lastSaved.current = data.draft ?? null;
        dirty.current = false;
        setSaveState(data.draft ? 'saved' : 'idle');
        setPhase('ready');
      } catch {
        setError(labels.loadError);
        setPhase('error');
      }
    },
    [attemptId, labels.loadError, router]
  );

  useEffect(() => {
    loadItem();
  }, [loadItem]);

  // One clock for the section timer and the break countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = deadline === null ? null : Math.round((deadline - now) / 1000);
  const hardExpired = section?.timeLimit === 'HARD' && remaining !== null && remaining <= 0;
  useEffect(() => {
    if (hardExpired && (phase === 'ready' || phase === 'unavailable')) {
      setNotice(labels.timeUpHard);
      setDeadline(null);
      loadItem();
    }
  }, [hardExpired, phase, labels.timeUpHard, loadItem]);
  useEffect(() => {
    if (phase === 'break' && breakUntil !== null && now >= breakUntil) loadItem();
  }, [phase, breakUntil, now, loadItem]);

  const saveDraft = useCallback(
    async (encoded: string) => {
      if (encoded === lastSaved.current) return;
      setSaveState('saving');
      try {
        const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'autosave', targetIndex, studentAnswer: encoded }),
        });
        if (!res.ok) throw new Error('save');
        lastSaved.current = encoded;
        dirty.current = false;
        setSaveState('saved');
        setNavItems((items) => items.map((it) => (it.targetIndex === targetIndex && it.status === 'OPEN' ? { ...it, status: 'DRAFT' } : it)));
      } catch {
        setSaveState('error');
      }
    },
    [attemptId, targetIndex]
  );

  const onPortfolioReady = useCallback((submissionId: string | null) => {
    setStaged(submissionId ?? undefined);
  }, []);

  function onChange(value: unknown) {
    setStaged(value);
    dirty.current = true;
    if (!question) return;
    const encoded = encodeAnswer(question, value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(encoded), 700);
  }

  async function flushDraft() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (question && dirty.current) await saveDraft(encodeAnswer(question, staged));
  }

  async function onSubmit() {
    if (!question) return;
    const answer = encodeAnswer(question, staged);
    if (!answer) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setPhase('submitting');
    setError(null);
    setNotice(null);
    setSafety(null);
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A stable key per (attempt, item): a transport retry is recognized as the SAME submission.
        body: JSON.stringify({ action: 'submit', targetIndex, studentAnswer: answer, idempotencyKey: `submit:${attemptId}:${targetIndex}` }),
      });
      const body = await res.json().catch(() => ({}));
      const safetyResponse = safetyFromBody(body);
      if (safetyResponse) {
        // Human Agency P0-4: nothing was recorded or graded; show the fixed response.
        setSafety(safetyResponse);
        setPhase('ready');
        return;
      }
      if (!res.ok) {
        // the attempt was finished elsewhere (another tab, a hand-in): show its real state instead of an error
        if (body?.error === 'ATTEMPT_NOT_ACTIVE') {
          router.refresh();
          return;
        }
        setError(res.status === 422 ? labels.invalidAnswer : labels.submitError);
        if (body?.error === 'SECTION_CLOSED') await loadItem();
        else setPhase('ready');
        return;
      }
      setLastFeedback(body.data.evaluation?.feedback ?? null);
      setLastEvaluation(body.data.evaluation ? { score: Number(body.data.evaluation.score), maxScore: Number(body.data.evaluation.maxScore) } : null);
      setLastReview(body.data.speedReview ?? null);
      setNotice(body.data.evaluation ? null : labels.answerRecorded);
      if (body.data.done) setPhase('complete');
      else await loadItem();
    } catch {
      setError(labels.submitError);
      setPhase('ready');
    }
  }

  /** Practice Coach: asks for the item's certified speed strategy. The server records it (the answer will be ASSISTED) before returning it. */
  async function onRevealStrategy() {
    if (!question || !coach || coach.strategy || revealing) return;
    setRevealing(true);
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revealStrategy', targetIndex }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.data?.strategy) setCoach({ ...coach, assisted: true, strategy: body.data.strategy });
    } finally {
      setRevealing(false);
    }
  }

  async function onSkip() {
    setPhase('skipping');
    setError(null);
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip', targetIndex }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(labels.submitError);
        setPhase('unavailable');
        return;
      }
      if (body.data.done) setPhase('complete');
      else await loadItem();
    } catch {
      setError(labels.submitError);
      setPhase('unavailable');
    }
  }

  async function onEndBreak() {
    await fetch(`/api/simulation/attempts/${attemptId}/next-item`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'endBreak' }) }).catch(() => null);
    await loadItem();
  }

  async function onHandIn(confirmFirst: boolean) {
    if (confirmFirst && !window.confirm(labels.handInConfirm)) return;
    await flushDraft();
    setPhase('handingIn');
    setError(null);
    // BRW-C3-01 (RC-3): the other lifecycle controls stay disabled while this hand-in runs
    const signal = (active: boolean) => window.dispatchEvent(new CustomEvent('studyus:attempt-handing-in', { detail: { attemptId, active } }));
    signal(true);
    try {
      const complete = () => fetch(`/api/simulation/attempts/${attemptId}/complete`, { method: 'POST' });
      let res = await complete();
      if (res.status === 401) {
        // BRW-C3-01 (RC-2): the session token can expire while a blocking dialog is open; refresh it once and retry.
        // The server is idempotent: a hand-in that already happened returns the SAME stored result.
        await (window as unknown as { Clerk?: { session?: { getToken?: (o: { skipCache: boolean }) => Promise<unknown> } } }).Clerk?.session?.getToken?.({ skipCache: true }).catch(() => null);
        res = await complete();
      }
      if (!res.ok) {
        signal(false);
        setError(labels.finalizeError);
        setPhase(question ? 'ready' : 'complete');
        return;
      }
      const done = await res.json().catch(() => null);
      if (done?.data?.safety) {
        // Human Agency P0-4: a handed-in draft carried a safety signal. The
        // attempt is complete; show the fixed response before the result.
        signal(false);
        setSafety(done.data.safety as SafetyNoticeData);
        setPhase('complete');
        return;
      }
      router.push(`/dashboard/exam-prep/attempt/${attemptId}/result`);
    } catch {
      signal(false);
      setError(labels.finalizeError);
      setPhase(question ? 'ready' : 'complete');
    }
  }

  async function goTo(index: number) {
    await flushDraft();
    await loadItem(index);
  }

  const progressText = useMemo(() => labels.progress.replace('{n}', String(targetIndex + 1)).replace('{total}', String(totalTargets)), [labels.progress, targetIndex, totalTargets]);

  const header = section && (
    <div className="xr-head">
      <div className="xr-head-main">
        <p className="xr-kicker">{labels.section.replace('{n}', String(section.index + 1)).replace('{total}', String(section.count))}</p>
        <h2 className="xr-section-name">{section.name}</h2>
        <p className="xr-progress" aria-live="polite">{progressText}</p>
      </div>
      {remaining !== null && (
        <div className={`xr-timer${remaining <= 60 ? ' is-low' : ''}${remaining <= 0 ? ' is-over' : ''}`} role="timer" aria-live="off">
          <span className="xr-timer-label">{remaining > 0 ? labels.timeLeft : labels.overtime}</span>
          <span className="xr-timer-value">{formatClock(remaining)}</span>
        </div>
      )}
    </div>
  );

  const handInBar = (
    <div className="xr-actions-secondary">
      <p className="xr-integrity">{labels.integrity}</p>
      <button type="button" className="btn" onClick={() => onHandIn(true)} disabled={phase === 'submitting'}>
        {labels.handIn}
      </button>
    </div>
  );

  if (phase === 'loading') return <div className="card xr-card" aria-busy>{labels.loading}</div>;
  if (phase === 'error')
    return (
      <div className="card xr-card">
        <p role="alert" className="xr-error">{error}</p>
        <button type="button" className="btn" onClick={() => loadItem()}>{labels.retry}</button>
      </div>
    );

  if (phase === 'break') {
    const left = breakUntil === null ? 0 : Math.max(0, Math.round((breakUntil - now) / 1000));
    return (
      <div className="card xr-card">
        <h2 className="xr-section-name">{labels.breakTitle}</h2>
        <p>{labels.breakBody.replace('{name}', nextSectionName ?? '').replace('{time}', formatClock(left))}</p>
        <button type="button" className="btn btn-primary" onClick={onEndBreak}>{labels.endBreak}</button>
      </div>
    );
  }

  if (phase === 'complete' && safety) {
    // The attempt was handed in; a draft carried a safety signal (never graded).
    return (
      <div className="xr">
        <SafetyNotice safety={safety} />
        <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--space-3)' }} onClick={() => router.push(`/dashboard/exam-prep/attempt/${attemptId}/result`)}>
          {labels.complete}
        </button>
      </div>
    );
  }

  if (phase === 'complete' || phase === 'handingIn') {
    return (
      <div className="card xr-card">
        <h2 className="xr-section-name">{phase === 'handingIn' ? labels.handingIn : labels.complete}</h2>
        {/* "you answered every available question" is true only when the runner reached the end, never on an early hand-in */}
        {phase === 'complete' && <p className="ui-hint">{labels.completeBody}</p>}
        <button type="button" className="btn btn-primary btn-lg" disabled={phase === 'handingIn'} onClick={() => onHandIn(false)}>
          {phase === 'handingIn' ? labels.finalizing : labels.finalize}
        </button>
        {error && <p role="alert" className="xr-error">{error}</p>}
      </div>
    );
  }

  const navStrip = navMode === 'FREE_ORDER_WITHIN_SECTION' && navItems.length > 1 && (
    <nav aria-label={labels.navLabel} className="xr-nav">
      {navItems.map((it) => {
        const open = it.status === 'OPEN' || it.status === 'DRAFT';
        return (
          <button
            key={it.targetIndex}
            type="button"
            className={`xr-nav-item is-${it.status.toLowerCase()}${it.targetIndex === targetIndex ? ' is-current' : ''}`}
            aria-current={it.targetIndex === targetIndex ? 'step' : undefined}
            aria-label={`${labels.question.replace('{n}', String(it.targetIndex + 1))}: ${labels.navStatus[it.status]}`}
            disabled={!open || it.targetIndex === targetIndex || phase !== 'ready'}
            onClick={() => goTo(it.targetIndex)}
          >
            {it.targetIndex + 1}
          </button>
        );
      })}
    </nav>
  );

  if (phase === 'unavailable' || phase === 'skipping') {
    return (
      <div className="xr">
        {header}
        {navStrip}
        <div className="card xr-card">
          <p>{unavailableReason ? labels.itemUnavailableReason[unavailableReason] ?? labels.itemUnavailable : labels.itemUnavailable}</p>
          <button type="button" className="btn" disabled={phase === 'skipping'} onClick={onSkip}>
            {phase === 'skipping' ? labels.skipping : labels.skip}
          </button>
          {error && <p role="alert" className="xr-error">{error}</p>}
        </div>
        {handInBar}
      </div>
    );
  }

  const canSubmit = !!question && encodeAnswer(question, staged) !== '' && phase === 'ready';

  return (
    <div className="xr">
      {header}
      {notice && <p className="xr-notice" role="status">{notice}</p>}
      {safety && <SafetyNotice safety={safety} />}
      {navStrip}
      {!lastReview && lastEvaluation && labels.v2 && (
        <section className="card xr-coach xr-coach-review" aria-label={labels.v2['exv2.coach.review']} data-testid="item-feedback">
          <div className="xr-coach-head">
            <strong>{labels.v2['exv2.coach.review']}</strong>
            {lastEvaluation.maxScore > 0 && lastEvaluation.score >= lastEvaluation.maxScore ? (
              <span className="xr-pill is-correct">{labels.v2['exv2.coach.correct']}</span>
            ) : lastEvaluation.score <= 0 ? (
              <span className="xr-pill is-incorrect">{labels.v2['exv2.coach.incorrect']}</span>
            ) : (
              <span className="xr-pill">{`${lastEvaluation.score} / ${labels.marks.replace('{n}', String(lastEvaluation.maxScore))}`}</span>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLastEvaluation(null); setLastFeedback(null); }}>{labels.v2['exv2.coach.dismiss']}</button>
          </div>
          {lastFeedback && <p>{lastFeedback}</p>}
        </section>
      )}
      {lastReview && labels.v2 && (
        <section className="card xr-coach xr-coach-review" aria-label={labels.v2['exv2.coach.review']}>
          <div className="xr-coach-head">
            <strong>{labels.v2['exv2.coach.review']}</strong>
            <span className={`xr-pill is-${lastReview.correct ? 'correct' : 'incorrect'}`}>{lastReview.correct ? labels.v2['exv2.coach.correct'] : labels.v2['exv2.coach.incorrect']}</span>
            {lastReview.assisted && <span className="xr-pill">{labels.v2['exv2.coach.assisted']}</span>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLastReview(null)}>{labels.v2['exv2.coach.dismiss']}</button>
          </div>
          <p>
            {lastReview.actualSeconds === null
              ? labels.v2['exv2.coach.timeUnknown'].replace('{t}', String(lastReview.targetSeconds))
              : labels.v2['exv2.coach.time'].replace('{a}', String(lastReview.actualSeconds)).replace('{t}', String(lastReview.targetSeconds)).replace('{d}', (lastReview.deltaSeconds ?? 0) <= 0 ? labels.v2['exv2.coach.faster'].replace('{n}', String(Math.abs(lastReview.deltaSeconds ?? 0))) : labels.v2['exv2.coach.slower'].replace('{n}', String(lastReview.deltaSeconds)))}
            {lastReview.verdict && labels.v2[`exv2.coach.verdict.${lastReview.verdict}`] ? ` · ${labels.v2[`exv2.coach.verdict.${lastReview.verdict}`]}` : ''}
          </p>
          <StrategyBody s={lastReview.strategy} l={labels.v2} review />
        </section>
      )}
      {question?.stimulus && (
        <section className="card xr-stimulus" aria-label={question.stimulus.title ?? undefined}>
          {question.stimulus.title && <h3 className="xr-stimulus-title">{question.stimulus.title}</h3>}
          <p className="xr-stimulus-text">{question.stimulus.text}</p>
        </section>
      )}
      {question && (
        <section className="card xr-card" aria-labelledby={`xr-q-${question.index}`}>
          <div className="xr-q-head">
            <span className="xr-q-num">{labels.question.replace('{n}', String(question.index + 1))}</span>
            <span className="xr-marks">{labels.marks.replace('{n}', String(question.marks))}</span>
          </div>
          <p id={`xr-q-${question.index}`} className="xr-q-text"><MathText text={question.question} /></p>
          {question.calculator ? (
            <p className="ui-hint">{labels.v2?.[`exv2.calculator.${question.calculator}`] ?? labels.calculator}</p>
          ) : (
            question.calculatorAllowed && <p className="ui-hint">{labels.calculator}</p>
          )}
          {question.rubricCriteria && question.rubricCriteria.length > 0 && (
            <div>
              <p className="ui-hint">{labels.v2?.['exv2.rubric.title']}</p>
              <ul className="exv2-criteria">
                {question.rubricCriteria.map((c) => (
                  <li key={c.id} className="xr-pill">{`${c.id} · ${c.name} (${c.maxMarks})`}</li>
                ))}
              </ul>
            </div>
          )}
          <AnswerInput item={question} staged={staged} onChange={onChange} labels={labels} locale={locale} instanceId={instanceId} onPortfolioReady={onPortfolioReady} />
          {question.originLabel && labels.v2?.[question.originLabel] && <p className="exv2-origin">{labels.v2[question.originLabel]}</p>}
          {coach && labels.v2 && (() => {
            const l = labels.v2;
            const elapsed = coachSince === null ? coach.elapsedSeconds : Math.max(0, Math.round((now - coachSince) / 1000));
            return (
              <div className="xr-coach" data-testid="speed-coach">
                <div className="xr-coach-head">
                  <strong>{l['exv2.coach.title']}</strong>
                  <span className="xr-pill" title={l[`exv2.coach.targetNote.${coach.timing.targetProvenance}`]}>{l['exv2.coach.target'].replace('{s}', String(coach.timing.targetSeconds))}</span>
                  <span className={`xr-pill${elapsed > coach.timing.targetSeconds ? ' is-incorrect' : ''}`} role="timer" aria-live="off">{l['exv2.coach.elapsed'].replace('{t}', formatClock(elapsed))}</span>
                  {coach.assisted && <span className="xr-pill">{l['exv2.coach.assisted']}</span>}
                </div>
                <p className="ui-hint">{l[`exv2.coach.targetNote.${coach.timing.targetProvenance}`]}</p>
                {elapsed > coach.timing.skipThresholdSeconds && <p className="xr-notice" role="status">{l['exv2.coach.skipRule']}</p>}
                {coach.strategy ? (
                  <StrategyBody s={coach.strategy} l={l} review={false} />
                ) : (
                  coach.strategyAvailable && (
                    <div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={onRevealStrategy} disabled={revealing}>{l['exv2.coach.show']}</button>
                      <p className="ui-hint">{l['exv2.coach.showNote']}</p>
                    </div>
                  )
                )}
              </div>
            );
          })()}
          <div className="xr-save" aria-live="polite">
            {saveState === 'saving' ? labels.saving : saveState === 'saved' ? labels.saved : saveState === 'error' ? labels.saveError : ''}
          </div>
        </section>
      )}
      {resources.length > 0 && (
        <p className="ui-hint">
          <strong>{labels.resources}:</strong> {resources.join(' · ')}
        </p>
      )}
      {lastFeedback && (lastReview || !lastEvaluation || !labels.v2) && <p className="ui-hint">{labels.lastFeedback}: {lastFeedback}</p>}
      <button type="button" className="btn btn-primary btn-lg xr-submit" disabled={!canSubmit} onClick={onSubmit}>
        {phase === 'submitting' ? labels.submitting : labels.submit}
      </button>
      {error && <p role="alert" className="xr-error">{error}</p>}
      {handInBar}
    </div>
  );
}
