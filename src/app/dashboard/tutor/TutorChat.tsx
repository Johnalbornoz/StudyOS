'use client';

/**
 * UX-5 -- the StudyUS Tutor.
 *
 * A contextual pedagogical support layer, not a chat product: it shows
 * what it is helping with (subject · concept), whether help is available
 * right now (the existing integrity guard), and offers representation
 * requests (quick actions) instead of making the Student prompt-engineer.
 * It never decides what the Student learns next -- that stays with the
 * canonical engine.
 *
 * Context isolation: a conversation is scoped to one subject (verified
 * server-side). Arriving from a concept always starts a NEW conversation
 * for that concept; reopening an older conversation continues it with its
 * own subject and no concept focus. History sent to the model is only that
 * conversation's own messages.
 *
 * UX-3 guarantees kept: one pane at a time below 1024px, failed sends put
 * the text back, list loads are recoverable, 16px input, role="log".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Lock, Sparkles, Film } from 'lucide-react';
import { getMessages, Locale } from '@/lib/i18n/messages';
import ChatMessage from '@/components/ChatMessage';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { splitMessageContent } from '@/lib/tutor/visuals';
import { availableActions, type TutorAction, type ChatAction } from '@/lib/tutor/quick-actions';
import type { TutorSupportPolicy } from '@/lib/tutor/context-pack';
import PedagogicalVisual from './PedagogicalVisual';

// Browser-only modality controls, loaded on demand (UX-3 components, unchanged behavior).
const ReadAloudButton = dynamic(() => import('../ReadAloudButton'), { ssr: false });
const VoiceInputButton = dynamic(() => import('../VoiceInputButton'), { ssr: false });

interface SubjectOption { id: string; name: string }
interface Conversation { id: string; subjectId: string | null; subjectName?: string; title: string | null; updatedAt: string }
interface Message { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
interface ApprovedVideo { videoId: string; title: string; sourceName: string; durationSec: number }
type LocalItem =
  | { kind: 'message'; message: Message }
  | { kind: 'video'; id: string; video: ApprovedVideo }
  | { kind: 'video-none'; id: string };
interface TutorContextView {
  subject: { id: string; name: string } | null;
  concept: { id: string; label: string } | null;
  topic: string | null;
  supportPolicy: TutorSupportPolicy;
  capabilities: { video: boolean; visuals: boolean };
}
type Pending = null | 'reply' | 'video';

const ACTION_KEY: Record<TutorAction, `tt.action.${TutorAction}`> = {
  EXPLAIN_DIFFERENTLY: 'tt.action.EXPLAIN_DIFFERENTLY',
  EXAMPLE: 'tt.action.EXAMPLE',
  STEP_BY_STEP: 'tt.action.STEP_BY_STEP',
  SHOW_ME: 'tt.action.SHOW_ME',
  WHY: 'tt.action.WHY',
  FIND_VIDEO: 'tt.action.FIND_VIDEO',
};

/** Plain text for read-aloud: no LaTeX delimiters, fences or markdown markers. */
export function speakable(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The ONE text render path for both roles (LX-9R2: identical parseChatBlocks path regardless of m.role). */
function MessageBody({ m }: { m: { content: string } }) {
  return <ChatMessage content={m.content} />;
}

export default function TutorChat({
  studentId,
  locale,
  subjects,
  conceptId,
  subjectId,
}: {
  studentId: string;
  locale: Locale;
  subjects: SubjectOption[];
  conceptId?: string;
  subjectId?: string;
}) {
  const t = getMessages(locale);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [newSubjectId, setNewSubjectId] = useState('');
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  // Context of the CURRENT conversation. The entry concept applies only to the new conversation it starts.
  const [entryContext, setEntryContext] = useState<{ subjectId?: string; conceptId?: string } | null>(conceptId || subjectId ? { subjectId, conceptId } : null);
  const [context, setContext] = useState<TutorContextView | null>(null);
  const [contextFailed, setContextFailed] = useState(false);
  const [view, setView] = useState<'list' | 'chat'>(conceptId || subjectId ? 'chat' : 'list');
  const [playing, setPlaying] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const contextSubjectId = entryContext?.subjectId ?? activeConversation?.subjectId ?? undefined;
  const contextConceptId = entryContext?.conceptId;

  async function loadConversations() {
    try {
      const res = await fetch(`/api/tutor/conversations?studentId=${studentId}`);
      const body = await res.json();
      if (!res.ok) throw new Error();
      setConversations(body.data?.conversations || []);
      setListFailed(false);
    } catch {
      setListFailed(true);
    } finally {
      setLoadingConversations(false);
    }
  }

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Context (labels + support policy) for whatever the Tutor is helping with now.
  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ studentId });
    if (contextSubjectId) qs.set('subjectId', contextSubjectId);
    if (contextConceptId) qs.set('conceptId', contextConceptId);
    setContextFailed(false);
    fetch(`/api/tutor/context?${qs}`)
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!r.ok || !b?.data) throw new Error();
        if (!cancelled) setContext(b.data);
      })
      .catch(() => {
        if (!cancelled) {
          setContext(null);
          setContextFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, contextSubjectId, contextConceptId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items, pending]);

  async function openConversation(id: string) {
    setActiveId(id);
    setEntryContext(null); // an older conversation continues with its own subject, no concept focus
    setView('chat');
    setSendFailed(false);
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/tutor/messages?studentId=${studentId}&conversationId=${id}`);
      const body = await res.json();
      setItems((body.data?.messages || []).map((m: Message) => ({ kind: 'message', message: m })));
    } catch {
      setItems([]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function createConversation(forSubjectId: string | undefined): Promise<string | null> {
    try {
      const res = await fetch('/api/tutor/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, subjectId: forSubjectId || undefined }),
      });
      const body = await res.json();
      return body.data?.conversationId ?? null;
    } catch {
      return null;
    }
  }

  function startNewConversation() {
    setActiveId(null);
    setItems([]);
    setEntryContext(newSubjectId ? { subjectId: newSubjectId } : null);
    setNewSubjectId('');
    setSendFailed(false);
    setView('chat');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function send(text: string, action?: ChatAction) {
    const message = text.trim();
    if (!message || pending) return;
    setSendFailed(false);
    if (!action) setInput('');
    setPending('reply');

    // The first message of a new context creates its conversation (never an empty one on visit).
    let conversationId = activeId;
    if (!conversationId) {
      conversationId = await createConversation(context?.subject?.id ?? contextSubjectId);
      if (!conversationId) {
        setPending(null);
        if (!action) setInput(message);
        setSendFailed(true);
        return;
      }
      setActiveId(conversationId);
    }

    const optimistic: Message = { id: `optimistic-${Date.now()}`, role: 'user', content: message, createdAt: new Date().toISOString() };
    setItems((prev) => [...prev, { kind: 'message', message: optimistic }]);
    try {
      const res = await fetch('/api/tutor/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, conversationId, message, conceptId: contextConceptId, action }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data?.reply) throw new Error();
      setItems((prev) => [...prev, { kind: 'message', message: body.data.reply }]);
      await loadConversations();
    } catch {
      // Nothing is lost: the text goes back into the composer and the failure is stated.
      setItems((prev) => prev.filter((i) => !(i.kind === 'message' && i.message.id === optimistic.id)));
      if (!action) setInput(message);
      setSendFailed(true);
      // the composer is disabled while pending -- focus it once it is enabled again
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setPending(null);
    }
  }

  async function findVideo() {
    if (pending) return;
    setPending('video');
    const id = `video-${Date.now()}`;
    try {
      const res = await fetch('/api/tutor/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, subjectId: context?.subject?.id, conceptId: contextConceptId }),
      });
      const body = await res.json().catch(() => null);
      const data = body?.data;
      if (res.ok && data?.status === 'APPROVED' && data.video) setItems((prev) => [...prev, { kind: 'video', id, video: data.video }]);
      else setItems((prev) => [...prev, { kind: 'video-none', id }]);
    } catch {
      setItems((prev) => [...prev, { kind: 'video-none', id }]);
    } finally {
      setPending(null);
    }
  }

  function runAction(a: TutorAction) {
    if (a === 'FIND_VIDEO') void findVideo();
    else void send(t[ACTION_KEY[a]], a);
  }

  const policy: TutorSupportPolicy = context?.supportPolicy ?? 'OPEN';
  const restricted = policy !== 'OPEN';
  const hasReply = items.some((i) => i.kind === 'message' && i.message.role === 'assistant');
  const actions = useMemo(
    () => availableActions({ policy, hasConcept: !!context?.concept, hasReply, videoEnabled: !!context?.capabilities.video }),
    [policy, context, hasReply],
  );
  const contextTitle = context?.concept?.label ?? context?.subject?.name ?? null;
  const contextMeta = context?.concept ? [context.subject?.name, context.topic].filter(Boolean).join(' · ') : null;
  const showChat = activeId !== null || !!entryContext || view === 'chat';

  return (
    <div className="tt" data-view={view}>
      <div className="tt-list">
        <div className="card tt-new">
          <label className="ui-label" htmlFor="tt-new-subject">{t['tt.newFor']}</label>
          <select id="tt-new-subject" className="ui-select" value={newSubjectId} onChange={(e) => setNewSubjectId(e.target.value)}>
            <option value="">{t['tutor.noSubject']}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={startNewConversation}>{t['tutor.newConversation']}</button>
        </div>

        {listFailed && (
          <InlineAlert
            tone="error"
            title={t['xs.tutor.loadFailed']}
            actions={<button type="button" className="btn btn-secondary" onClick={() => { setLoadingConversations(true); loadConversations(); }}>{t['practice.prepareRetry']}</button>}
          />
        )}

        <nav aria-label={t['xs.tutor.conversations']} className="tt-nav">
          <p className="tt-nav-title">{t['tt.recent']}</p>
          <ul className="tt-convs">
            {!loadingConversations && !listFailed && conversations.length === 0 && (
              <li className="tt-conv-meta tt-convs-empty">{t['tutor.noConversations']}</li>
            )}
            {conversations.map((c) => (
              <li key={c.id}>
                <button type="button" className="tt-conv" aria-current={c.id === activeId ? 'true' : undefined} onClick={() => openConversation(c.id)}>
                  <span className="tt-conv-title">{c.title || t['tutor.newConversation']}</span>
                  <span className="tt-conv-meta">{c.subjectName || t['tutor.noSubject']}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <section className="card tt-chat" aria-label={contextTitle ?? t['tutor.title']}>
        <header className="tt-chat-top">
          <button type="button" className="btn btn-ghost tt-back" onClick={() => setView('list')} aria-label={t['xs.tutor.showConversations']}>
            ← {t['xs.tutor.conversations']}
          </button>
          <div className="tt-context">
            <span className="tt-context-kicker">{t['tutor.title']}</span>
            <span className="tt-context-title">{contextTitle ?? t['tt.general']}</span>
            {contextMeta && <span className="tt-context-meta">{contextMeta}</span>}
          </div>
        </header>

        {!showChat ? (
          <div className="tt-empty">{t['tutor.emptyState']}</div>
        ) : (
          <>
            <div ref={scrollRef} className="tt-log" role="log" aria-live="polite" aria-label={t['xs.tutor.messages']}>
              {contextFailed && <InlineAlert tone="info" title={t['tt.contextFailed']} />}
              {!restricted && items.length === 0 && !loadingMessages && (
                <div className="tt-intro">
                  <Sparkles size={18} strokeWidth={2} aria-hidden />
                  <p>{context?.concept ? t['tt.introConcept'].replace('{concept}', context.concept.label) : t['tt.introGeneral']}</p>
                </div>
              )}
              {loadingMessages ? (
                <p className="tt-thinking" role="status">{t['common.loading']}</p>
              ) : (
                items.map((item) => {
                  if (item.kind === 'video') {
                    const v = item.video;
                    return (
                      <article key={item.id} className="tt-video" aria-label={`${t['tt.video.kicker']}: ${v.title}`}>
                        <p className="tt-video-kicker"><Film size={14} strokeWidth={2} aria-hidden /> {t['tt.video.kicker']}</p>
                        <p className="tt-video-title">{v.title}</p>
                        <p className="tt-video-meta">{v.sourceName} · {fmtDuration(v.durationSec)} · {t['tt.video.approved']}</p>
                        {playing === v.videoId ? (
                          <div className="tt-video-frame">
                            <iframe
                              src={`https://www.youtube-nocookie.com/embed/${v.videoId}?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3`}
                              title={v.title}
                              allow="encrypted-media; picture-in-picture"
                              referrerPolicy="strict-origin-when-cross-origin"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <button type="button" className="btn btn-secondary tt-video-play" onClick={() => setPlaying(v.videoId)}>
                            ▶ {t['tt.video.play']}
                          </button>
                        )}
                      </article>
                    );
                  }
                  if (item.kind === 'video-none') {
                    return (
                      <div key={item.id} className="tt-notice" role="status">
                        <p>{t['tt.video.none']}</p>
                        <div className="tt-actions">
                          {(['SHOW_ME', 'EXPLAIN_DIFFERENTLY', 'STEP_BY_STEP'] as const).map((a) => (
                            <button key={a} type="button" className="btn btn-secondary tt-action" disabled={!!pending} onClick={() => runAction(a)}>{t[ACTION_KEY[a]]}</button>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  const m = item.message;
                  if (m.role === 'user') {
                    return <div key={m.id} className="tt-msg tt-msg--user"><MessageBody m={m} /></div>;
                  }
                  return (
                    <article key={m.id} className="tt-msg tt-msg--assistant">
                      {splitMessageContent(m.content).map((seg, i) =>
                        seg.kind === 'visual' ? (
                          <PedagogicalVisual key={i} spec={seg.spec} caption={t['tt.visualCaption']} />
                        ) : (
                          <MessageBody key={i} m={{ content: seg.text }} />
                        ),
                      )}
                      <div className="tt-msg-tools">
                        <ReadAloudButton text={speakable(m.content)} activityLanguage={locale} label={t['multimodal.readAloud']} stopLabel={t['multimodal.stopReading']} />
                      </div>
                    </article>
                  );
                })
              )}
              {pending && (
                <p className="tt-thinking" role="status">{pending === 'video' ? t['tt.pending.video'] : t['tt.pending.reply']}</p>
              )}
            </div>

            <div className="tt-compose">
              {/* Always in view next to the (disabled) composer -- never scrolled away at the top of a long conversation. */}
              {restricted && (
                <div className="tt-restricted" role="note">
                  <Lock size={18} strokeWidth={2} aria-hidden />
                  <div>
                    <p className="tt-restricted-title">{t[policy === 'RESTRICTED_ASSESSMENT' ? 'tt.restricted.ASSESSMENT' : policy === 'UNAVAILABLE' ? 'tt.restricted.UNAVAILABLE' : 'tt.restricted.INDEPENDENT']}</p>
                    <p className="tt-restricted-body">{t['tt.restrictedBody']}</p>
                    <Link href="/dashboard/today" className="btn btn-secondary">{t['tt.backToToday']}</Link>
                  </div>
                </div>
              )}
              {actions.length > 0 && (
                <div className="tt-actions" role="group" aria-label={t['tt.actionsLabel']}>
                  {actions.map((a) => (
                    <button key={a} type="button" className="btn btn-secondary tt-action" disabled={!!pending} onClick={() => runAction(a)}>
                      {t[ACTION_KEY[a]]}
                    </button>
                  ))}
                </div>
              )}
              {sendFailed && <InlineAlert tone="error" title={t['xs.tutor.sendFailed']} />}
              <div className="tt-compose-row">
                <label className="sr-only" htmlFor="tt-input">{t['tutor.inputPlaceholder']}</label>
                <textarea
                  id="tt-input"
                  ref={inputRef}
                  className="tt-input"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder={restricted ? t['tt.composerRestricted'] : t['tutor.inputPlaceholder']}
                  disabled={!!pending || restricted}
                />
                {!restricted && (
                  <VoiceInputButton
                    expectedResponseLanguage={locale}
                    onAccept={(transcript) => setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))}
                    micLabel={t['response.micLabel']}
                    stopLabel={t['multimodal.stopRecording']}
                    reviewTitle={t['multimodal.reviewTranscript']}
                    useThisLabel={t['multimodal.useThisAnswer']}
                    reRecordLabel={t['multimodal.recordAgain']}
                    discardLabel={t['multimodal.discard']}
                    permissionDeniedLabel={t['multimodal.micPermissionDenied']}
                    transcriptionFailedLabel={t['multimodal.transcriptionFailed']}
                  />
                )}
                <button className="btn btn-primary tt-send" disabled={!input.trim() || !!pending || restricted} aria-busy={pending === 'reply'} onClick={() => void send(input)}>
                  {t['tutor.send']}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
