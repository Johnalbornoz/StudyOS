/**
 * Topic hierarchy: Materia (subject) -> Tópico (topic) -> Subtópico
 * (subtopic) -> Concepto (concept). Purely organizational -- mastery,
 * quiz generation, and RAG grounding all still operate per individual
 * concept exactly as before this existed. Topics/subtopics only group
 * concepts for display and navigation.
 *
 * Names are stored in a single language (whichever the classification
 * call ran in) rather than through a localizations table like
 * concepts have -- a deliberate simplification given this layer is
 * display-only.
 */

import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { ensureTopicHierarchyLocalizations, ensureConceptLocalizations } from './localization.service';
import { getConceptIntelligenceBatch } from './learner-model.service';
import { getCanonicalMemorySignalsForStudent } from './memory-read.service';
import { masteryToPercent, tryMasteryScore } from '@/lib/mastery-format';
import { executeAI, validateJson, getPrompt } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';

export interface HierarchyConcept {
  id: string;
  label: string;
  masteryScore?: number;
  retention?: number;
  independentMastery?: number;
  confidenceCalibration?: number;
  hasEvidence: boolean; // for Evidence Coverage at Topic/Subtopic level -- distinct from masteryScore being 0
}

export interface HierarchySubtopic {
  id: string;
  name: string;
  concepts: HierarchyConcept[];
}

export interface HierarchyTopic {
  id: string;
  name: string;
  subtopics: HierarchySubtopic[];
}

export interface SubjectHierarchy {
  topics: HierarchyTopic[];
  unassigned: HierarchyConcept[];
}

async function callClaudeForHierarchy(systemPrompt: string, userPrompt: string, maxTokens: number = 4000): Promise<any> {
  const prompt = getPrompt('topic_hierarchy.classification');
  const { result } = await executeAI({
    capability: prompt.capability,
    risk: 'LOW_RISK', // purely organizational -- mastery/quiz/RAG all operate per-concept regardless of this outline
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: prompt.id,
    promptVersion: prompt.version,
    call: (signal) => callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }, signal),
    validate: (raw) => validateJson({ text: raw.text || '{}' }, (parsed) => ({ value: parsed, errors: [] })),
  });
  return result;
}

/**
 * (Re)classifies every concept in a subject into a topic/subtopic
 * tree, replacing any previous topic/subtopic assignment for this
 * subject. Used after document extraction (which can add many
 * concepts at once) and by the one-time retroactive migration for
 * subjects that predate this feature.
 */
export async function classifySubjectHierarchy(subjectId: string, language: string = 'en'): Promise<void> {
  const subjectResult = await db.query(`SELECT name FROM subjects WHERE id = $1`, [subjectId]);
  const subject = subjectResult.rows[0];
  if (!subject) throw new Error('SUBJECT_NOT_FOUND');

  const conceptsResult = await db.query(
    `
    SELECT c.id, COALESCE(cl.label, c.canonical_id) AS label
    FROM concepts c
    LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
    WHERE c.subject_id = $1
    ORDER BY c.created_at ASC
    `,
    [subjectId, language]
  );
  const concepts = conceptsResult.rows;
  if (concepts.length === 0) return;

  const languageName = LOCALE_FULL_NAME[language] || language;

  const systemPrompt = `You organize a student's list of learning concepts into a clear two-level outline: Topic -> Subtopic -> concepts. This is purely for navigation, like a table of contents.

Write topic/subtopic names in ${languageName}. Output ONLY a JSON object, no markdown fences, no other text:
{
  "topics": [
    {
      "name": "Topic name",
      "subtopics": [
        { "name": "Subtopic name", "conceptIds": ["<id>", "<id>"] }
      ]
    }
  ]
}

Rules:
- EVERY concept ID given below must appear in exactly one subtopic's "conceptIds" -- none left out, none duplicated.
- Group by genuine topical relationship, not superficial wording similarity.
- Aim for 2-6 topics and 2-5 subtopics per topic, sized to fit the number of concepts given (don't over-split a small list, don't force a huge list into too few buckets).
- If a concept genuinely doesn't fit any natural grouping with others, it's fine to place it in a small or single-concept subtopic rather than forcing a bad fit.`;

  const userPrompt = `Subject: "${subject.name}"

Concepts to organize (id: label):
${concepts.map((c) => `${c.id}: ${c.label}`).join('\n')}`;

  // Scales with concept count -- each concept's UUID appears once in
  // the output tree, and a large subject (100+ concepts) previously
  // risked the same mid-JSON truncation fixed elsewhere in this app.
  const maxTokens = Math.min(16000, 2000 + concepts.length * 60);
  const parsed = await callClaudeForHierarchy(systemPrompt, userPrompt, maxTokens);
  if (!parsed || !Array.isArray(parsed.topics)) {
    throw new Error('HIERARCHY_PARSE_FAILED');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Clear this subject's previous hierarchy -- concepts first
    // (their subtopic_id FK references subtopics), then subtopics,
    // then topics.
    await client.query(
      `UPDATE concepts SET subtopic_id = NULL WHERE subject_id = $1`,
      [subjectId]
    );
    await client.query(
      `DELETE FROM subtopics WHERE topic_id IN (SELECT id FROM topics WHERE subject_id = $1)`,
      [subjectId]
    );
    await client.query(`DELETE FROM topics WHERE subject_id = $1`, [subjectId]);

    const validConceptIds = new Set(concepts.map((c) => c.id));
    let topicOrder = 0;
    for (const topic of parsed.topics) {
      if (!topic || typeof topic.name !== 'string' || !Array.isArray(topic.subtopics)) continue;
      const topicRow = await client.query(
        `INSERT INTO topics (subject_id, name, display_order) VALUES ($1, $2, $3) RETURNING id`,
        [subjectId, topic.name, topicOrder++]
      );
      const topicId = topicRow.rows[0].id;

      let subtopicOrder = 0;
      for (const subtopic of topic.subtopics) {
        if (!subtopic || typeof subtopic.name !== 'string' || !Array.isArray(subtopic.conceptIds)) continue;
        const subtopicRow = await client.query(
          `INSERT INTO subtopics (topic_id, name, display_order) VALUES ($1, $2, $3) RETURNING id`,
          [topicId, subtopic.name, subtopicOrder++]
        );
        const subtopicId = subtopicRow.rows[0].id;

        const conceptIds = subtopic.conceptIds.filter((id: any) => typeof id === 'string' && validConceptIds.has(id));
        if (conceptIds.length > 0) {
          await client.query(
            `UPDATE concepts SET subtopic_id = $1 WHERE id = ANY($2::uuid[])`,
            [subtopicId, conceptIds]
          );
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cheaper path for adding a single new concept (e.g. via "Escribir un
 * concepto"): fits it into the subject's EXISTING topic/subtopic tree
 * rather than re-running the full classification. Falls back to a
 * full classification if the subject has no hierarchy yet.
 */
export async function classifySingleConcept(
  subjectId: string,
  conceptId: string,
  conceptLabel: string,
  language: string = 'en'
): Promise<void> {
  const existingTopics = await db.query(
    `
    SELECT t.id AS topic_id, t.name AS topic_name, st.id AS subtopic_id, st.name AS subtopic_name
    FROM topics t
    JOIN subtopics st ON st.topic_id = t.id
    WHERE t.subject_id = $1
    ORDER BY t.display_order, st.display_order
    `,
    [subjectId]
  );

  if (existingTopics.rowCount === 0) {
    await classifySubjectHierarchy(subjectId, language);
    return;
  }

  const languageName = LOCALE_FULL_NAME[language] || language;
  const outline = existingTopics.rows
    .map((r) => `${r.topic_id}::${r.subtopic_id} - ${r.topic_name} > ${r.subtopic_name}`)
    .join('\n');

  const systemPrompt = `You place a single new concept into an existing topic/subtopic outline for a subject.

Output ONLY a JSON object, no markdown fences: { "subtopicId": "<id>" } -- the id of the best-fitting EXISTING subtopic from the list below. If truly nothing fits, respond with { "subtopicId": null } instead of forcing a bad fit.`;

  const userPrompt = `New concept: "${conceptLabel}"

Existing outline (format: topicId::subtopicId - Topic > Subtopic), in ${languageName}:
${outline}`;

  try {
    const parsed = await callClaudeForHierarchy(systemPrompt, userPrompt);
    const subtopicId = parsed?.subtopicId;
    if (typeof subtopicId === 'string' && existingTopics.rows.some((r) => r.subtopic_id === subtopicId)) {
      await db.query(`UPDATE concepts SET subtopic_id = $1 WHERE id = $2`, [subtopicId, conceptId]);
    }
    // else: leave unassigned -- shows up in the "unassigned" bucket rather than forcing a bad fit.
  } catch (error) {
    console.error('Error classifying single concept into hierarchy:', error);
    // Leave unassigned rather than fail the whole concept-creation flow.
  }
}

export async function getSubjectHierarchy(subjectId: string, studentId: string, language: string = 'en'): Promise<SubjectHierarchy> {
  const conceptIdsResult = await db.query(`SELECT id FROM concepts WHERE subject_id = $1`, [subjectId]);
  const conceptIds = conceptIdsResult.rows.map((r) => r.id);

  // Both concept-label AND topic/subtopic translation run in the
  // background now, never blocking the page. Topic/subtopic sets are
  // small, but "small input" doesn't mean "fast" -- it's still a real
  // Claude call (network + model latency), and awaiting it here made
  // the very first subject-page load after switching language feel
  // slow (previously the single biggest contributor to reported
  // language-switch latency). The SELECT below already falls back via
  // COALESCE(tl.name, t.name) to the concept's current name/prior
  // translation until this completes, exactly like concept labels
  // already do -- next load picks up the fresh translation.
  ensureConceptLocalizations(conceptIds, language).catch((err) =>
    console.error('Background concept localization failed:', err)
  );
  ensureTopicHierarchyLocalizations(subjectId, language).catch((err) =>
    console.error('Background topic/subtopic localization failed:', err)
  );

  // One batched query for Independent Mastery + Confidence Calibration
  // across every concept in the subject, instead of a per-concept call
  // per accordion row. Step 6J-B1: same discipline for Phase 6's
  // canonical predictive memory (retrievabilityNow) -- ONE batch read,
  // never one query per concept row below.
  const [intelligence, canonicalMemorySignals] = await Promise.all([
    getConceptIntelligenceBatch(studentId, conceptIds),
    getCanonicalMemorySignalsForStudent(db, studentId),
  ]);

  const rows = await db.query(
    `
    SELECT
      t.id AS topic_id, COALESCE(tl.name, t.name) AS topic_name, t.display_order AS topic_order,
      st.id AS subtopic_id, COALESCE(sl.name, st.name) AS subtopic_name, st.display_order AS subtopic_order,
      c.id AS concept_id, COALESCE(cl.label, c.canonical_id) AS concept_label,
      mr.mastery_score, mr.confidence_score, mr.last_practiced
    FROM concepts c
    JOIN subtopics st ON st.id = c.subtopic_id
    JOIN topics t ON t.id = st.topic_id
    LEFT JOIN topic_localizations tl ON tl.topic_id = t.id AND tl.language = $3
    LEFT JOIN subtopic_localizations sl ON sl.subtopic_id = st.id AND sl.language = $3
    LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $3
    LEFT JOIN mastery_records mr ON mr.concept_id = c.id AND mr.student_id = $2
    WHERE c.subject_id = $1
    ORDER BY t.display_order, st.display_order, cl.label
    `,
    [subjectId, studentId, language]
  );

  const topicMap = new Map<string, HierarchyTopic>();
  for (const row of rows.rows) {
    let topic = topicMap.get(row.topic_id);
    if (!topic) {
      topic = { id: row.topic_id, name: row.topic_name, subtopics: [] };
      topicMap.set(row.topic_id, topic);
    }
    let subtopic = topic.subtopics.find((s) => s.id === row.subtopic_id);
    if (!subtopic) {
      subtopic = { id: row.subtopic_id, name: row.subtopic_name, concepts: [] };
      topic.subtopics.push(subtopic);
    }
    const conceptIntel = intelligence.get(row.concept_id);
    subtopic.concepts.push({
      id: row.concept_id,
      label: row.concept_label,
      // mastery_records.mastery_score is canonically 0.0-1.0 -- convert
      // for display. Step 6J-B1: retention is Phase 6's canonical
      // retrievabilityNow (a live, predicted "how likely is unaided
      // recall right now" -- never demonstratedRetentionScore, a
      // different, evidence-based concept) -- null (never fabricated)
      // when no concept_memory_state row exists yet.
      masteryScore: masteryToPercent(tryMasteryScore(row.mastery_score, `topic-hierarchy concept ${row.concept_id}`)) ?? undefined,
      retention: canonicalMemorySignals.get(row.concept_id)?.retrievabilityNow ?? undefined,
      independentMastery: conceptIntel?.independentMastery ?? undefined,
      confidenceCalibration: conceptIntel?.confidenceCalibration ?? undefined,
      hasEvidence: row.mastery_score !== null,
    });
  }

  const unassignedResult = await db.query(
    `
    SELECT c.id, COALESCE(cl.label, c.canonical_id) AS label, mr.mastery_score, mr.confidence_score, mr.last_practiced
    FROM concepts c
    LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $3
    LEFT JOIN mastery_records mr ON mr.concept_id = c.id AND mr.student_id = $2
    WHERE c.subject_id = $1 AND c.subtopic_id IS NULL
    ORDER BY cl.label
    `,
    [subjectId, studentId, language]
  );

  return {
    topics: Array.from(topicMap.values()),
    unassigned: unassignedResult.rows.map((r) => {
      const conceptIntel = intelligence.get(r.id);
      return {
        id: r.id,
        label: r.label,
        masteryScore: masteryToPercent(tryMasteryScore(r.mastery_score, `topic-hierarchy unassigned concept ${r.id}`)) ?? undefined,
        // Step 6J-B1: same Phase 6 canonical retrievabilityNow as the
        // assigned-concept branch above -- no fallback when unavailable.
        retention: canonicalMemorySignals.get(r.id)?.retrievabilityNow ?? undefined,
        independentMastery: conceptIntel?.independentMastery ?? undefined,
        confidenceCalibration: conceptIntel?.confidenceCalibration ?? undefined,
        hasEvidence: r.mastery_score !== null,
      };
    }),
  };
}
