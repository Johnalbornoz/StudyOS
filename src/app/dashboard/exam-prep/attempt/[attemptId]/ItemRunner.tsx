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
import { useRouter } from 'next/navigation';
import { QuestionAnswerFields } from '@/components/quiz/QuestionAnswerFields';
import { encodeClientAnswer } from '@/lib/quiz/client-answer-encoding';

type AnswerFormat = 'single_choice' | 'multi_choice' | 'text' | 'matching' | 'ordering' | 'classification';

interface ClientPart {
  id: string;
  prompt: string;
  answerFormat: 'single_choice' | 'multi_choice' | 'text';
  options?: { id: string; text: string }[];
  marks: number;
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
}

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
}

type Phase = 'loading' | 'ready' | 'submitting' | 'unavailable' | 'skipping' | 'break' | 'complete' | 'handingIn' | 'error';

function decodeDraft(item: ClientItem, draft: string | null): unknown {
  if (draft === null || draft === undefined) return undefined;
  try {
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
  if (item.parts) {
    const map = (staged as Record<string, unknown>) || {};
    const out: Record<string, string> = {};
    for (const p of item.parts) {
      const v = map[p.id];
      if (p.answerFormat === 'multi_choice') {
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
      {options.map((opt) => {
        const checked = selected.includes(opt.id);
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
            <span className="xr-choice-key" aria-hidden>{opt.id}</span>
            <span className="xr-choice-text">{opt.text}</span>
          </label>
        );
      })}
    </div>
  );
}

function AnswerInput({ item, staged, onChange, labels }: { item: ClientItem; staged: unknown; onChange: (v: unknown) => void; labels: ItemRunnerLabels }) {
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
            {p.answerFormat === 'text' ? (
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

export function ItemRunner({ attemptId, labels }: { attemptId: string; labels: ItemRunnerLabels }) {
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
  const [notice, setNotice] = useState<string | null>(null);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
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
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A stable key per (attempt, item): a transport retry is recognized as the SAME submission.
        body: JSON.stringify({ action: 'submit', targetIndex, studentAnswer: answer, idempotencyKey: `submit:${attemptId}:${targetIndex}` }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 422 ? labels.invalidAnswer : labels.submitError);
        if (body?.error === 'SECTION_CLOSED') await loadItem();
        else setPhase('ready');
        return;
      }
      setLastFeedback(body.data.evaluation?.feedback ?? null);
      setNotice(body.data.evaluation ? null : labels.answerRecorded);
      if (body.data.done) setPhase('complete');
      else await loadItem();
    } catch {
      setError(labels.submitError);
      setPhase('ready');
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
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/complete`, { method: 'POST' });
      if (!res.ok) {
        setError(labels.finalizeError);
        setPhase(question ? 'ready' : 'complete');
        return;
      }
      router.push(`/dashboard/exam-prep/attempt/${attemptId}/result`);
      router.refresh();
    } catch {
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

  if (phase === 'complete' || phase === 'handingIn') {
    return (
      <div className="card xr-card">
        <h2 className="xr-section-name">{labels.complete}</h2>
        <p className="ui-hint">{labels.completeBody}</p>
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
      {navStrip}
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
          <p id={`xr-q-${question.index}`} className="xr-q-text">{question.question}</p>
          {question.calculatorAllowed && <p className="ui-hint">{labels.calculator}</p>}
          <AnswerInput item={question} staged={staged} onChange={onChange} labels={labels} />
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
      {lastFeedback && <p className="ui-hint">{labels.lastFeedback}: {lastFeedback}</p>}
      <button type="button" className="btn btn-primary btn-lg xr-submit" disabled={!canSubmit} onClick={onSubmit}>
        {phase === 'submitting' ? labels.submitting : labels.submit}
      </button>
      {error && <p role="alert" className="xr-error">{error}</p>}
      {handInBar}
    </div>
  );
}
