/**
 * Lazy translate-and-cache for AI-generated display text (topic/subtopic
 * names, concept labels) that only ever gets written in ONE language at
 * creation time. Whenever a student's interface language doesn't match
 * that language, these `ensure*` functions batch-translate the missing
 * pieces once and cache the result in a `*_localizations` table -- the
 * same shape `concept_localizations` already used, just applied
 * consistently and proactively instead of silently falling back to a
 * mismatched language or a raw canonical id.
 */

import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { executeAI, validateJson, getPrompt } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';

interface TranslateItem {
  id: string;
  text: string;
}

async function translateBatch(items: TranslateItem[], targetLanguage: string): Promise<Record<string, string>> {
  if (items.length === 0) return {};
  const languageName = LOCALE_FULL_NAME[targetLanguage] || targetLanguage;

  const systemPrompt = `You translate short educational labels (subject topic names, concept names) into ${languageName}. Keep them short and natural, matching how a student in that language would actually phrase them -- not a literal word-for-word translation.

Output ONLY a JSON object, no markdown fences: { "translations": [{ "id": "<id>", "text": "<translated text>" }] } -- one entry per input id, same ids, same order.`;

  const userPrompt = items.map((i) => `${i.id}: ${i.text}`).join('\n');
  // Each item's UUID alone is ~20 tokens once echoed back in the JSON
  // response, plus translated text and JSON syntax overhead -- scale
  // generously to avoid the mid-JSON truncation bug this app has hit
  // before with under-scaled max_tokens on batch AI calls.
  const maxTokens = Math.min(16000, 1000 + items.length * 90);

  const prompt = getPrompt('localization.batch_translate');
  const { result: parsed } = await executeAI({
    capability: prompt.capability,
    risk: 'LOW_RISK', // display text only (topic/subtopic/concept names)
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: prompt.id,
    promptVersion: prompt.version,
    call: (signal) => callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }, signal),
    validate: (raw) =>
      validateJson<{ translations: { id: string; text: string }[] }>({ text: raw.text || '{}' }, (v) => ({ value: v, errors: [] })),
  });

  const map: Record<string, string> = {};
  for (const t of parsed?.translations ?? []) {
    if (t && typeof t.id === 'string' && typeof t.text === 'string') map[t.id] = t.text;
  }
  return map;
}

/**
 * Ensures every topic and subtopic in a subject has a name cached for
 * `language`. No-op (no AI call) once everything is already cached.
 */
export async function ensureTopicHierarchyLocalizations(subjectId: string, language: string): Promise<void> {
  const missingTopics = await db.query(
    `
    SELECT t.id, t.name FROM topics t
    LEFT JOIN topic_localizations tl ON tl.topic_id = t.id AND tl.language = $2
    WHERE t.subject_id = $1 AND tl.id IS NULL
    `,
    [subjectId, language]
  );
  const missingSubtopics = await db.query(
    `
    SELECT st.id, st.name FROM subtopics st
    JOIN topics t ON t.id = st.topic_id
    LEFT JOIN subtopic_localizations sl ON sl.subtopic_id = st.id AND sl.language = $2
    WHERE t.subject_id = $1 AND sl.id IS NULL
    `,
    [subjectId, language]
  );

  if (missingTopics.rowCount === 0 && missingSubtopics.rowCount === 0) return;

  try {
    const items: TranslateItem[] = [
      ...missingTopics.rows.map((r) => ({ id: r.id, text: r.name })),
      ...missingSubtopics.rows.map((r) => ({ id: r.id, text: r.name })),
    ];
    const translations = await translateBatch(items, language);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const row of missingTopics.rows) {
        const name = translations[row.id] || row.name;
        await client.query(
          `INSERT INTO topic_localizations (topic_id, language, name) VALUES ($1, $2, $3)
           ON CONFLICT (topic_id, language) DO UPDATE SET name = EXCLUDED.name`,
          [row.id, language, name]
        );
      }
      for (const row of missingSubtopics.rows) {
        const name = translations[row.id] || row.name;
        await client.query(
          `INSERT INTO subtopic_localizations (subtopic_id, language, name) VALUES ($1, $2, $3)
           ON CONFLICT (subtopic_id, language) DO UPDATE SET name = EXCLUDED.name`,
          [row.id, language, name]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error translating topic hierarchy names:', error);
    // Leave untranslated for this pass -- callers fall back to the base name.
  }
}

/**
 * Ensures every concept in conceptIds has a label cached for `language`.
 * Translates from whichever locale each concept already has a label in
 * (there's always at least one, set at extraction/creation time).
 */
export async function ensureConceptLocalizations(conceptIds: string[], language: string): Promise<void> {
  if (conceptIds.length === 0) return;

  const missing = await db.query(
    `
    SELECT c.id, c.canonical_id,
      (SELECT label FROM concept_localizations WHERE concept_id = c.id ORDER BY created_at ASC LIMIT 1) AS source_label
    FROM concepts c
    WHERE c.id = ANY($1::uuid[])
      AND NOT EXISTS (SELECT 1 FROM concept_localizations cl WHERE cl.concept_id = c.id AND cl.language = $2)
    `,
    [conceptIds, language]
  );

  if (missing.rowCount === 0) return;

  try {
    const items: TranslateItem[] = missing.rows.map((r) => ({ id: r.id, text: r.source_label || r.canonical_id }));
    const translations = await translateBatch(items, language);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const row of missing.rows) {
        const label = translations[row.id] || row.source_label || row.canonical_id;
        await client.query(
          `INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, $2, $3)
           ON CONFLICT (concept_id, language) DO UPDATE SET label = EXCLUDED.label`,
          [row.id, language, label]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error translating concept labels:', error);
  }
}
