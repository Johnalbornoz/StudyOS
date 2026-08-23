'use client';

import { useEffect, useRef, useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';

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
  const scrollRef = useRef<HTMLDivElement>(null);

  async function loadConversations() {
    const res = await fetch(`/api/tutor/conversations?studentId=${studentId}`);
    const body = await res.json();
    setConversations(body.data?.conversations || []);
    setLoadingConversations(false);
  }

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openConversation(id: string) {
    setActiveId(id);
    setLoadingMessages(true);
    const res = await fetch(`/api/tutor/messages?studentId=${studentId}&conversationId=${id}`);
    const body = await res.json();
    setMessages(body.data?.messages || []);
    setLoadingMessages(false);
  }

  async function startConversation() {
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
      const body = await res.json();
      if (body.data?.reply) {
        setMessages((prev) => [...prev, body.data.reply]);
      }
      await loadConversations();
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 'var(--space-6)', height: 'calc(100vh - 200px)', minHeight: 480 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div className="card" style={{ padding: 'var(--space-3)' }}>
          <select
            value={newSubjectId}
            onChange={(e) => setNewSubjectId(e.target.value)}
            style={{
              width: '100%', height: 34, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
              fontSize: 13, marginBottom: 8, fontFamily: 'inherit',
            }}
          >
            <option value="">{t['tutor.noSubject']}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" style={{ width: '100%', height: 34, fontSize: 13 }} onClick={startConversation}>
            {t['tutor.newConversation']}
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!loadingConversations && conversations.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12.5, padding: '0 var(--space-2)' }}>{t['tutor.noConversations']}</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              style={{
                textAlign: 'left', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
                border: 'none', background: c.id === activeId ? 'var(--brand-subtle)' : 'transparent',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title || t['tutor.newConversation']}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.subjectName || t['tutor.noSubject']}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        {!activeId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: 'var(--space-6)' }}>
            {t['tutor.emptyState']}
          </div>
        ) : (
          <>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {loadingMessages ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t['common.loading']}</p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '75%',
                      background: m.role === 'user' ? 'var(--brand)' : 'var(--bg-subtle)',
                      color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      fontSize: 14,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.content}
                  </div>
                ))
              )}
              {sending && (
                <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
                  {t['tutor.thinking']}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)', borderTop: '1px solid var(--border-default)' }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={t['tutor.inputPlaceholder']}
                disabled={sending}
                style={{
                  flex: 1, height: 40, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
                  padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14,
                }}
              />
              <button className="btn btn-primary" disabled={!input.trim() || sending} onClick={send}>
                {t['tutor.send']}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
