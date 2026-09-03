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
import { buildCompactTutorContext } from './tutor-strategy.service';
import { getTeachingIntentForConcept } from './adaptive-teaching.service';
import { buildTeachingConstraintsBlock, toTeachingGenerationContext } from '@/lib/adaptive-teaching-generation';
import { getActiveRestrictedEvidenceForStudent } from './active-evidence-guard.service';
import { executeAI, getPrompt } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';

/**
 * Phase 5-R2 S7: the smallest safe product behavior -- a real,
 * localized reply (not an error, not a blank response), reusing the
 * existing tutor_messages persistence path. Deliberately NOT part of
 * src/lib/i18n/messages.ts's UI-wide MessageKey system (that system is
 * for structured UI labels; tutor replies are already free-form AI
 * text keyed only by the same simple `LOCALE_FULL_NAME`-style lookup
 * this file already uses) -- one conversational sentence per language,
 * not a new type-checked key across all 5 locale objects.
 */
const ASSISTANCE_BLOCKED_REPLY: Record<string, string> = {
  es: 'No puedo darte ayuda de contenido para este tema mientras tengas un intento de evaluación independiente en curso. Termina el intento primero -- después puedo ayudarte a repasarlo.',
  en: "I can't provide instructional help for this concept while an independent assessment attempt is active. Finish the attempt first, then I can help you review it.",
  de: 'Ich kann dir zu diesem Thema keine inhaltliche Hilfe geben, solange ein unabhängiger Bewertungsversuch läuft. Beende zuerst den Versuch -- danach kann ich dir bei der Wiederholung helfen.',
  fr: "Je ne peux pas t'aider sur ce sujet tant qu'une tentative d'évaluation indépendante est en cours. Termine d'abord la tentative -- ensuite je pourrai t'aider à la revoir.",
  pt: 'Não posso te ajudar com o conteúdo deste tópico enquanto houver uma tentativa de avaliação independente em andamento. Termine a tentativa primeiro -- depois posso te ajudar a revisá-la.',
};

function assistanceBlockedReply(language: string): string {
  return ASSISTANCE_BLOCKED_REPLY[language] ?? ASSISTANCE_BLOCKED_REPLY.en;
}

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

/** Shared tail: persists one assistant reply (AI-generated or the blocked-assistance canned reply alike) and bumps the conversation. */
async function persistAssistantReply(conversationId: string, userMessage: string, replyText: string): Promise<TutorMessage> {
  const stored = await db.query(
    `INSERT INTO tutor_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id, role, content, created_at`,
    [conversationId, replyText]
  );
  await db.query(`UPDATE tutor_conversations SET updated_at = NOW(), title = COALESCE(title, $2) WHERE id = $1`, [
    conversationId,
    userMessage.slice(0, 80),
  ]);
  const row = stored.rows[0];
  return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at };
}

export async function sendMessage(
  conversationId: string,
  studentId: string,
  userMessage: string,
  language: string = 'en',
  conceptId?: string
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

  // Phase 5-R2/5-R3/5-R4 S3/S5: the cross-surface guard runs
  // UNCONDITIONALLY -- before any teaching computation, grounding, or
  // AI call -- and no longer depends on subject or concept scope at
  // all. Phase 5-R4 fresh finding: `conv.subject_id` is itself
  // client-chosen at conversation-creation time -- a conversation
  // deliberately labelled a different subject than an actively-
  // restricted one, then asked in free text about the restricted
  // subject's material, would have passed Phase 5-R3's subject-scoped
  // check. Free-form text cannot be proven to stay within a
  // conversation's nominal subject without AI classification, which
  // the task forbids for an integrity control -- so subject/concept are
  // no longer security boundaries for this gate (S5): while the
  // student has ANY active restricted evidence collection anywhere,
  // general Tutor instructional assistance is unavailable, full stop.
  // `conceptId`/`conv.subject_id` remain used below for TeachingIntent/
  // grounding once this gate has already passed -- never for deciding
  // whether it runs. Fails CLOSED: if the guard's own lookup fails (a
  // transient DB error), this treats it as blocked rather than
  // silently reopening the bypass this remediation exists to close --
  // an integrity control degrades to "unavailable," never "unchecked."
  const evidenceState = await getActiveRestrictedEvidenceForStudent(studentId).catch(
    (): { allowed: false; reason: 'GUARD_LOOKUP_FAILED' } => ({ allowed: false, reason: 'GUARD_LOOKUP_FAILED' })
  );
  if (!evidenceState.allowed) {
    return persistAssistantReply(conversationId, userMessage, assistanceBlockedReply(language));
  }

  let contextChunks: string[] = [];
  if (conv.subject_id) {
    const context = await retrieveContext(studentId, conv.subject_id, { query: userMessage, limit: 5 }).catch(
      () => ({ chunks: [] as any[] })
    );
    contextChunks = context.chunks.map((c: any) => c.text);
  }

  const languageName = LOCALE_FULL_NAME[language] || language;

  // Phase 5-R S1/S2 (surface A: concept teaching/tutor generator),
  // reconciling the Phase 2 Learner-Aware Tutor: prefer the canonical
  // Phase 4 `TeachingIntent` when Phase 4 has an active decision for
  // this concept -- it supersedes `buildCompactTutorContext`'s bare
  // score-threshold strategy pick with one keyed off the certified
  // `LearningState`/misconception/prerequisite/help-dependency signals.
  // `buildCompactTutorContext` itself is UNCHANGED (zero diff to
  // tutor-strategy.service.ts) and remains the honest fallback when
  // Phase 4 has no active decision for this concept (a validated
  // concept, or one with no signals yet) -- never fabricated, and the
  // conversation behaves exactly as it did before Phase 5 in that case.
  // Neither path runs at all when the caller doesn't know which
  // concept this message is about, exactly as before Phase 2.
  const teachingIntent = conceptId ? await getTeachingIntentForConcept(studentId, conceptId).catch(() => null) : null;
  const cognitiveContext = !teachingIntent && conceptId ? await buildCompactTutorContext(studentId, conceptId).catch(() => null) : null;
  const adaptiveTeachingBlock = teachingIntent ? buildTeachingConstraintsBlock(toTeachingGenerationContext(teachingIntent)) : null;

  const systemPrompt = `You are a patient, encouraging tutor helping a student understand their own study material.

${
  contextChunks.length > 0
    ? `Relevant material from the student's own content:\n${contextChunks
        .map((c, i) => `[${i + 1}] ${c}`)
        .join('\n\n')}\n\nGround your explanation in this material when it's relevant to the question. If the question goes beyond it, you may still help using general knowledge, but say so.`
    : `No specific study material was found for this question -- answer using your general knowledge, and mention that uploading related material would let you ground future answers in it.`
}

${
  adaptiveTeachingBlock
    ? adaptiveTeachingBlock
    : cognitiveContext
      ? `This question is about a concept the student has a track record on (${cognitiveContext.summary}). Pedagogical approach for this message: ${cognitiveContext.instruction}`
      : ''
}

Teaching style:
- Don't just hand over the final answer to a problem -- guide the student toward it, asking a short clarifying or leading question first when that would help them think it through themselves.
- Keep answers focused and conversational, not a lecture.
- If they ask a direct factual question, just answer it clearly.

Formatting:
- Math notation: write any mathematical expression as LaTeX wrapped in dollar delimiters -- "$$...$$" for a standalone/display equation on its own line (e.g. a limit being evaluated), "$...$" for a short expression inline within a sentence (e.g. "the radius $r$"). Never write a standalone equation as plain ASCII (e.g. "lim x->2 (x^2-4)/(x-2)").
- Graphs: never draw a graph, number line, or coordinate plot as ASCII art (characters like +, -, |, *, / arranged to look like axes) -- it renders as broken, misaligned text and is never clear. When a function's graph would genuinely help, instead emit exactly one fenced code block tagged "function-plot" containing a single-line JSON object, which the app renders as a real chart:
  \`\`\`function-plot
  {"expression": "(x^2 - 4) / (x - 2)", "domain": [-1, 5], "holes": [2], "label": "f(x) = (x^2-4)/(x-2)"}
  \`\`\`
  - "expression": a mathjs-compatible expression in terms of x only (operators +-*/^, functions like sin/cos/sqrt/abs/log -- no other variables, no assignment, no code).
  - "domain": the [min, max] x-range to plot.
  - "holes" (optional): x-values where the function is undefined/discontinuous, marked as open circles instead of connecting the curve through them.
  - "label" (optional): a short caption.
  Use this only when a visual genuinely clarifies the concept, not on every response.

Write your entire response in ${languageName}.`;

  const messages = [...history.map((h: any) => ({ role: h.role, content: h.content })), { role: 'user', content: userMessage }];

  const prompt = getPrompt('tutor.chat_reply');
  const { result: replyText } = await executeAI({
    capability: prompt.capability,
    risk: 'LOW_RISK', // conversational reply, not a graded/state-changing output
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: prompt.id,
    promptVersion: prompt.version,
    context: { studentId, subjectId: conv.subject_id ?? undefined, conceptId, sourceComponent: 'tutor.service.ts:sendMessage', sourceId: conversationId },
    call: (signal) => callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 2048, system: systemPrompt, messages }, signal),
    // Free text, not JSON -- the only structural contract is "the provider answered with something".
    validate: (raw) => ({ valid: true, value: raw.text }),
  });

  return persistAssistantReply(conversationId, userMessage, replyText);
}
