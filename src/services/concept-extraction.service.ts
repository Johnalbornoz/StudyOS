/**
 * Concept Extraction Service - Extract concepts from content
 *
 * Uses Claude AI to analyze chunks and extract educational concepts
 * Results are deterministic (same input = same output)
 * Concepts are language-independent (canonical IDs)
 */

import { db } from '@/lib/db';
import { updateChunkConceptMappings } from './embedding.service';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';

export interface ExtractedConcept {
  canonicalId: string; // Language-independent ID (e.g., MATH_ALG_LINEAR_EQ)
  label: string; // Human-readable label
  type: 'definition' | 'procedure' | 'formula' | 'fact' | 'skill';
  difficulty: number; // 1-5
  description?: string;
  prerequisites?: string[]; // Canonical IDs of prerequisites
}

export interface ConceptExtractionResult {
  chunkId: string;
  concepts: ExtractedConcept[];
  confidence: number; // 0-1, how confident in extraction
}

/**
 * Extract concepts from a chunk using Claude
 *
 * Prompt Claude to identify:
 * - Core concepts taught
 * - Definitions
 * - Procedures/formulas
 * - Prerequisites
 * - Difficulty level
 */
export async function extractConceptsFromChunk(
  chunkText: string,
  subjectName: string,
  language: string = 'en'
): Promise<ExtractedConcept[]> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set');
    }

    const languageName = LOCALE_FULL_NAME[language] || language;

    const systemPrompt = `You are an educational content analyzer for ${subjectName}.

Your task: Extract core learning concepts from educational text.

For each concept, provide:
1. Canonical ID (language-independent, uppercase with underscores)
   Format: SUBJECT_CATEGORY_CONCEPT
   Example: MATH_ALG_LINEAR_EQUATIONS

2. Label (human-readable, written in ${languageName})
3. Type: definition|procedure|formula|fact|skill
4. Difficulty: 1-5 (1=basic, 5=advanced)
5. Description (optional, written in ${languageName})
6. Prerequisites (canonical IDs of required prior knowledge)

IMPORTANT: The source text below may be written in a different language than ${languageName}. Regardless of what language the source text is in, the "label" and "description" fields MUST be written in ${languageName} -- translate them if the source text is in another language. Only the canonicalId stays in uppercase English-style identifiers, since it is language-independent.

Output ONLY valid JSON array, no markdown.`;

    const userPrompt = `Extract all learning concepts from this text:

<text>
${chunkText}
</text>

Return JSON array of concepts, with "label" and "description" written in ${languageName} even if the text above is in a different language:
[
  {
    "canonicalId": "MATH_ALG_LINEAR_EQ",
    "label": "<concept name, in ${languageName}>",
    "type": "definition",
    "difficulty": 2,
    "description": "<short description, in ${languageName}>",
    "prerequisites": ["MATH_ALG_VARIABLES", "MATH_ARITH_OPERATIONS"]
  }
]`;

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const responseText = data.content.find((b: any) => b.type === 'text')?.text ?? '';

    // Parse JSON response
    let concepts: ExtractedConcept[];
    try {
      concepts = parseAIJson(responseText);
    } catch (e) {
      console.error('Failed to parse Claude response:', responseText);
      return []; // Return empty if parsing fails
    }

    // Validate and normalize concepts
    return concepts
      .filter(c => c.canonicalId && c.label && c.type)
      .map(c => ({
        canonicalId: c.canonicalId,
        label: c.label,
        type: c.type,
        difficulty: Math.max(1, Math.min(5, c.difficulty || 2)),
        description: c.description,
        prerequisites: c.prerequisites || [],
      }));
  } catch (error) {
    console.error('Error extracting concepts:', error);
    return []; // Return empty on error
  }
}

/**
 * Extract concepts from all chunks in a content source
 *
 * Process:
 * 1. Get all chunks for source
 * 2. Extract concepts from each chunk
 * 3. Create/link concepts in database
 * 4. Map chunks to concepts
 * 5. Create concept dependencies
 */
export async function extractConceptsFromSource(
  sourceId: string,
  studentId: string,
  subjectId: string,
  subjectName: string,
  sourceLanguage: string = 'en'
): Promise<{
  conceptsCreated: number;
  chunksProcessed: number;
  mappingsCreated: number;
}> {
  try {
    // Get all chunks for this source
    const chunksResult = await db.query(
      `
      SELECT id, chunk_text, seq_order
      FROM content_chunks
      WHERE source_id = $1
      ORDER BY seq_order ASC
      `,
      [sourceId]
    );

    const chunks = chunksResult.rows;
    let conceptsCreated = 0;
    let mappingsCreated = 0;

    // Extract concepts from every chunk in parallel -- this is the slow
    // part (one AI call per chunk), and each call is fully independent,
    // so there's no reason to wait for chunk 1 before starting chunk 2.
    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => ({
        chunk,
        concepts: await extractConceptsFromChunk(chunk.chunk_text, subjectName, sourceLanguage),
      }))
    );

    for (const { chunk, concepts } of chunkResults) {
      if (concepts.length === 0) continue;

      const chunkConceptIds: string[] = [];

      // Create concepts in database
      for (const concept of concepts) {
        // Upsert: creates the concept if new or returns the existing id
        // otherwise. Atomic (single round trip, no separate exists
        // check), and safe now that chunks are processed in parallel
        // and may reference the same concept.
        const upsertResult = await db.query(
          `
          INSERT INTO concepts (subject_id, canonical_id)
          VALUES ($1, $2)
          ON CONFLICT (subject_id, canonical_id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id
          RETURNING id, (xmax = 0) AS inserted
          `,
          [subjectId, concept.canonicalId]
        );
        const conceptId = upsertResult.rows[0].id;
        if (upsertResult.rows[0].inserted) conceptsCreated++;

        // Create localization (if not exists)
        await db.query(
          `
          INSERT INTO concept_localizations (
            concept_id,
            language,
            label
          ) VALUES ($1, $2, $3)
          ON CONFLICT (concept_id, language) DO UPDATE
          SET label = EXCLUDED.label
          `,
          [conceptId, sourceLanguage, concept.label]
        );

        chunkConceptIds.push(conceptId);

        // Create mastery record if student doesn't have one
        await db.query(
          `
          INSERT INTO mastery_records (
            student_id,
            concept_id,
            subject_id,
            mastery_score,
            confidence_score,
            attempt_count,
            correct_count,
            incorrect_count
          ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0)
          ON CONFLICT (student_id, concept_id) DO NOTHING
          `,
          [studentId, conceptId, subjectId]
        );
      }

      // Update chunk with concept mappings
      if (chunkConceptIds.length > 0) {
        await updateChunkConceptMappings(chunk.id, chunkConceptIds);
        mappingsCreated += chunkConceptIds.length;
      }
    }

    // Update content source status
    await db.query(
      `
      UPDATE content_sources
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('conceptsCreated', $1::int)
      WHERE id = $2
      `,
      [conceptsCreated, sourceId]
    );

    return {
      conceptsCreated,
      chunksProcessed: chunks.length,
      mappingsCreated,
    };
  } catch (error) {
    console.error('Error extracting concepts from source:', error);
    throw error;
  }
}

/**
 * Get concepts for a subject (for dashboard/display)
 */
export async function getSubjectConcepts(
  subjectId: string,
  language: string = 'en'
) {
  try {
    const result = await db.query(
      `
      SELECT
        c.id,
        c.canonical_id,
        cl.label
      FROM concepts c
      LEFT JOIN concept_localizations cl ON c.id = cl.concept_id AND cl.language = $2
      WHERE c.subject_id = $1
      ORDER BY cl.label ASC
      `,
      [subjectId, language]
    );

    return result.rows.map(row => ({
      id: row.id,
      canonicalId: row.canonical_id,
      label: row.label,
    }));
  } catch (error) {
    console.error('Error fetching subject concepts:', error);
    throw error;
  }
}

/**
 * Get concept details with mastery info
 */
export async function getConceptWithMastery(
  conceptId: string,
  studentId: string
) {
  try {
    const conceptResult = await db.query(
      `
      SELECT
        c.id,
        c.canonical_id,
        cl.label,
        cl.description,
        mr.mastery_score,
        mr.confidence_score,
        mr.attempt_count
      FROM concepts c
      LEFT JOIN concept_localizations cl ON c.id = cl.concept_id AND cl.language = 'en'
      LEFT JOIN mastery_records mr ON c.id = mr.concept_id AND mr.student_id = $2
      WHERE c.id = $1
      LIMIT 1
      `,
      [conceptId, studentId]
    );

    if (conceptResult.rows.length === 0) {
      return null;
    }

    return conceptResult.rows[0];
  } catch (error) {
    console.error('Error fetching concept with mastery:', error);
    throw error;
  }
}

function slugifyCanonicalId(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${base || 'CONCEPT'}_${suffix}`;
}

/**
 * Manually create a single concept from a typed name, bypassing the
 * document upload pipeline entirely -- for when a student wants to add
 * a concept without having a source document for it. Mirrors the same
 * concepts/concept_localizations/mastery_records triple that
 * extractConceptsFromSource creates per concept, so it behaves
 * identically everywhere else in the app (delete, "Learn more", etc).
 */
export async function createConceptManually(
  studentId: string,
  subjectId: string,
  label: string,
  language: string = 'en'
): Promise<{ conceptId: string; label: string }> {
  const canonicalId = slugifyCanonicalId(label);

  const conceptResult = await db.query(
    `INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`,
    [subjectId, canonicalId]
  );
  const conceptId = conceptResult.rows[0].id;

  await db.query(
    `INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, $2, $3)`,
    [conceptId, language, label]
  );

  await db.query(
    `INSERT INTO mastery_records (
      student_id, concept_id, subject_id, mastery_score, confidence_score, attempt_count, correct_count, incorrect_count
    ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0)`,
    [studentId, conceptId, subjectId]
  );

  return { conceptId, label };
}

/**
 * Suggest concept/topic names as the student types, matching the
 * subject they're adding to. Kept deliberately cheap (small
 * max_tokens, no RAG) since this fires on a debounced keystroke, not
 * a deliberate user action.
 */
export async function suggestConceptNames(
  subjectName: string,
  partialText: string,
  language: string = 'en'
): Promise<string[]> {
  if (!partialText || partialText.trim().length < 2) {
    return [];
  }

  const languageName = LOCALE_FULL_NAME[language] || language;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 300,
        system: `You suggest concept/topic names for a student's study subject, written in ${languageName}. Reply with ONLY a JSON array of strings, no markdown, no explanation.`,
        messages: [
          {
            role: 'user',
            content: `Subject: "${subjectName}"\nThe student is typing a concept name and has written so far: "${partialText}"\n\nSuggest up to 5 concept or topic names for this subject that match or naturally complete what they've typed, written in ${languageName}. Return ONLY a JSON array of strings.`,
          },
        ],
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const text = data.content.find((b: any) => b.type === 'text')?.text ?? '[]';
    const parsed = parseAIJson(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => typeof s === 'string').slice(0, 5);
  } catch (error) {
    console.error('Error suggesting concept names:', error);
    return [];
  }
}
