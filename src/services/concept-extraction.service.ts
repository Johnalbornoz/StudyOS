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

    const systemPrompt = `You are an educational content analyzer for ${subjectName}.

Your task: Extract core learning concepts from educational text.

For each concept, provide:
1. Canonical ID (language-independent, uppercase with underscores)
   Format: SUBJECT_CATEGORY_CONCEPT
   Example: MATH_ALG_LINEAR_EQUATIONS

2. Label (human-readable in ${language})
3. Type: definition|procedure|formula|fact|skill
4. Difficulty: 1-5 (1=basic, 5=advanced)
5. Description (optional)
6. Prerequisites (canonical IDs of required prior knowledge)

Output ONLY valid JSON array, no markdown.`;

    const userPrompt = `Extract all learning concepts from this text:

<text>
${chunkText}
</text>

Return JSON array of concepts:
[
  {
    "canonicalId": "MATH_ALG_LINEAR_EQ",
    "label": "Linear Equations",
    "type": "definition",
    "difficulty": 2,
    "description": "Equations with variables of degree 1",
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
        max_tokens: 1024,
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

    for (const chunk of chunks) {
      // Extract concepts from chunk
      const concepts = await extractConceptsFromChunk(
        chunk.chunk_text,
        subjectName,
        sourceLanguage
      );

      if (concepts.length === 0) continue;

      const chunkConceptIds: string[] = [];

      // Create concepts in database
      for (const concept of concepts) {
        let conceptId: string;

        // Check if concept already exists
        const existsResult = await db.query(
          `
          SELECT id FROM concepts
          WHERE subject_id = $1 AND canonical_id = $2
          LIMIT 1
          `,
          [subjectId, concept.canonicalId]
        );

        if (existsResult.rows.length > 0) {
          conceptId = existsResult.rows[0].id;
        } else {
          // Create new concept
          const createResult = await db.query(
            `
            INSERT INTO concepts (
              subject_id,
              canonical_id,
              hierarchy_level,
              source_language
            ) VALUES ($1, $2, 1, $3)
            RETURNING id
            `,
            [subjectId, concept.canonicalId, sourceLanguage]
          );

          conceptId = createResult.rows[0].id;
          conceptsCreated++;
        }

        // Create localization (if not exists)
        await db.query(
          `
          INSERT INTO concept_localizations (
            concept_id,
            language,
            label,
            description
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (concept_id, language) DO UPDATE
          SET label = EXCLUDED.label, description = EXCLUDED.description
          `,
          [conceptId, sourceLanguage, concept.label, concept.description || '']
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
            incorrect_count,
            forgetting_risk
          ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 0)
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
      SET extracted_concepts = $1
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
        cl.label,
        cl.description,
        c.hierarchy_level
      FROM concepts c
      LEFT JOIN concept_localizations cl ON c.id = cl.concept_id AND cl.language = $2
      WHERE c.subject_id = $1
      ORDER BY c.hierarchy_level ASC, cl.label ASC
      `,
      [subjectId, language]
    );

    return result.rows.map(row => ({
      id: row.id,
      canonicalId: row.canonical_id,
      label: row.label,
      description: row.description,
      hierarchyLevel: row.hierarchy_level,
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
