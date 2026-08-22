/**
 * AI Tutor: a conversational chat interface over the same RAG pipeline
 * that already grounds quiz generation in the student's own uploaded
 * material (rag.service.ts's retrieveContext, driven by a free-text
 * query here instead of a fixed conceptId).
 *
 * A conversation is optionally scoped to one subject. When it is, each
 * message retrieves fresh context matched to that specific question
 * (not a static context fetched once) so the tutor can answer
 * follow-ups about a different part of the material.
 */

import { db } from '@/lib/db';
import { retrieveContext } from './rag.service';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface TutorConversation {
  id: string;
  subjectId: string | null;
  subjectName?: string;
  title: string | null;
  updatedAt: string;
}

const MAX_HISTORY_MESSAGES = 12;

export async function createConversation(studentId: string, subjectId?: string): Promise<string> {
  const result = await db.query(
    `INSERT INTO tutor_conversations (student_id, subject_id) VALUES ($1, $2) RETURNING id`,
    [studentId, subjectId || null]
  );
  return result.rows[0].id;
}

export async function getConversations(studentId: string): Promise<TutorConversation[]> {
  const result = await db.query(
    `
    SELECT tc.id, tc.subject_id, tc.title, tc.updated_at, s.name AS subject_name
    FROM tutor_conversations tc
    LEFT JOIN subjects s ON s.id = tc.subject_id
    WHERE tc.student_id = $1
    ORDER BY tc.updated_at DESC
    LIMIT 20
    `,
    [studentId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    subjectName: r.subject_name,
    title: r.title,
    updatedAt: r.updated_at,
  }));
}

export async function getMessages(conversationId: string): Promise<TutorMessage[]> {
  const result = await db.query(
    `SELECT id, role, content, created_at FROM tutor_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return result.rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }));
}

export async function verifyConversationOwnership(conversationId: string, studentId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM tutor_conversations WHERE id = $1 AND student_id = $2`,
    [conversationId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function sendMessage(
  conversationId: string,
  studentId: string,
  userMessage: string,
  language: string = 'en'
): Promise<TutorMessage> {
  const convResult = await db.query(
    `SELECT subject_id, title FROM tutor_conversations WHERE id = $1`,
    [conversationId]
  );
  const conv = convResult.rows[0];
  if (!conv) throw new Error('CONVERSATION_NOT_FOUND');

  const historyResult = await db.query(
    `SELECT role, content FROM tutor_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [conversationId, MAX_HISTORY_MESSAGES]
  );
  const history = historyResult.rows.reverse();

  await db.query(`INSERT INTO tutor_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [
    conversationId,
    userMessage,
  ]);

  let contextChunks: string[] = [];
  if (conv.subject_id) {
    const context = await retrieveContext(studentId, conv.subject_id, { query: userMessage, limit: 5 }).catch(
      () => ({ chunks: [] as any[] })
    );
    contextChunks = context.chunks.map((c: any) => c.text);
  }

  const languageName = LOCALE_FULL_NAME[language] || language;

  const systemPrompt = `You are a patient, encouraging tutor helping a student understand their own study material.

${
  contextChunks.length > 0
    ? `Relevant material from the student's own content:\n${contextChunks
        .map((c, i) => `[${i + 1}] ${c}`)
        .join('\n\n')}\n\nGround your explanation in this material when it's relevant to the question. If the question goes beyond it, you may still help using general knowledge, but say so.`
    : `No specific study material was found for this question -- answer using your general knowledge, and mention that uploading related material would let you ground future answers in it.`
}

Teaching style:
- Don't just hand over the final answer to a problem -- guide the student toward it, asking a short clarifying or leading question first when that would help them think it through themselves.
- Keep answers focused and conversational, not a lecture.
- If they ask a direct factual question, just answer it clearly.

Write your entire response in ${languageName}.`;

  const messages = [...history.map((h: any) => ({ role: h.role, content: h.content })), { role: 'user', content: userMessage }];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const replyText = data.content.find((b: any) => b.type === 'text')?.text ?? '';

  const stored = await db.query(
    `INSERT INTO tutor_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id, role, content, created_at`,
    [conversationId, replyText]
  );

  await db.query(
    `UPDATE tutor_conversations SET updated_at = NOW(), title = COALESCE(title, $2) WHERE id = $1`,
    [conversationId, userMessage.slice(0, 80)]
  );

  const row = stored.rows[0];
  return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at };
}
