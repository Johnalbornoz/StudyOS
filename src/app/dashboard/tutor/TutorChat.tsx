'use client';

import { useEffect, useRef, useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';
import ChatMessage from '@/components/ChatMessage';
import { InlineAlert } from '@/components/ui/InlineAlert';

interface SubjectOption {
  id: string;
  name: string;
}

interface Conversation {
  id: string;
  subjectId: string | null;
  subjectName?: string;
  title: string | null;
  updatedAt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export default function TutorChat({
  studentId,
  locale,
  subjects,
  conceptId,
}: {
  studentId: string;
  locale: Locale;
  subjects: SubjectOption[];
  conceptId?: string;
}) {
  const t = getMessages(locale);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newSubjectId, setNewSubjectId] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  // UX-3: failures are visible and recoverable -- never a silent no-op.
  const [listFailed, setListFailed] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  // UX-3: below 1024px one pane at a time (list OR conversation).
  const [view, setView] = useState<'list' | 'chat'>('list');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function openConversation(id: string) {
    setActiveId(id);
    setView('chat');
    setSendFailed(false);
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/tutor/messages?studentId=${studentId}&conversationId=${id}`);
      const body = await res.json();
      setMessages(body.data?.messages || []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function startConversation() {
    try {
      const res = await fetch('/api/tutor/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, subjectId: newSubjectId || undefined }),
      });
      const body = await res.json();
      const id = body.data?.conversationId;
      if (id) {
        setNewSubjectId('');
        await loadConversations();
        setActiveId(id);
        setMessages([]);
        setSendFailed(false);
        setView('chat');
      }
    } catch {
      setListFailed(true);
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || !activeId || sending) return;
    const userText = input.trim();
    setInput('');
    setSending(true);
    setSendFailed(false);

    const optimisticUser: Message = {
      id: `optimistic-${Date.now()}`,
      role: 'user',
      content: userText,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const res = await fetch('/api/tutor/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, conversationId: activeId, message: userText, conceptId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data?.reply) throw new Error();
      setMessages((prev) => [...prev, body.data.reply]);
      await loadConversations();
    } catch {
      // UX-3: the message was not answered -- take it back out of the log,
      // put the text back in the box, and say so. Nothing is lost.
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setInput(userText);
      setSendFailed(true);
      inputRef.current?.focus();
    } finally {
      setSending(false);
    }
  }

  const activeTitle = conversations.find((c) => c.id === activeId)?.title || t['tutor.newConversation'];

  return (
    <div className="tt" data-view={view}>
      <div className="tt-list">
        <div className="card tt-new">
          <select
            className="ui-select"
            value={newSubjectId}
            onChange={(e) => setNewSubjectId(e.target.value)}
            aria-label={t['tutor.noSubject']}
          >
            <option value="">{t['tutor.noSubject']}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={startConversation}>
            {t['tutor.newConversation']}
          </button>
        </div>

        {listFailed && (
          <InlineAlert
            tone="error"
            title={t['xs.tutor.loadFailed']}
            actions={<button type="button" className="btn btn-secondary" onClick={() => { setLoadingConversations(true); loadConversations(); }}>{t['practice.prepareRetry']}</button>}
          />
        )}

        <nav aria-label={t['xs.tutor.conversations']} style={{ display: 'contents' }}>
          <ul className="tt-convs">
            {!loadingConversations && !listFailed && conversations.length === 0 && (
              <li className="tt-conv-meta" style={{ padding: 'var(--space-2) var(--space-3)' }}>{t['tutor.noConversations']}</li>
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

      <section className="card tt-chat" aria-label={activeId ? activeTitle : t['tutor.emptyState']}>
        <div className="tt-chat-head">
          <button type="button" className="btn btn-ghost" onClick={() => setView('list')} aria-label={t['xs.tutor.showConversations']}>
            ← {t['xs.tutor.conversations']}
          </button>
        </div>
        {!activeId ? (
          <div className="tt-empty">{t['tutor.emptyState']}</div>
        ) : (
          <>
            <div ref={scrollRef} className="tt-log" role="log" aria-live="polite" aria-label={t['xs.tutor.messages']}>
              {loadingMessages ? (
                <p className="tt-thinking">{t['common.loading']}</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`tt-msg tt-msg--${m.role}`}>
                    <ChatMessage content={m.content} />
                  </div>
                ))
              )}
              {sending && <div className="tt-thinking">{t['tutor.thinking']}</div>}
            </div>
            <div className="tt-compose">
              {sendFailed && <InlineAlert tone="error" title={t['xs.tutor.sendFailed']} />}
              <div className="tt-compose-row">
                <input
                  ref={inputRef}
                  className="tt-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={t['tutor.inputPlaceholder']}
                  aria-label={t['tutor.inputPlaceholder']}
                  disabled={sending}
                />
                <button className="btn btn-primary" disabled={!input.trim() || sending} aria-busy={sending} onClick={send}>
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
