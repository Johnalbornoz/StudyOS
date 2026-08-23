/**
 * Cognitive Knowledge Graph (Phase 2): a second structure alongside
 * the existing Subject -> Topic -> Subtopic -> Concept organizational
 * hierarchy. That hierarchy answers "where does this live?"; this one
 * answers "what must be understood before this?". They coexist --
 * this module never touches topics/subtopics.
 *
 * AI-inferred edges are proposals, not truth: every edge carries a
 * confidence, a source, and a status, and low-confidence edges are
 * never allowed to single-handedly justify a strong pedagogical
 * intervention (see cognitive-diagnosis.service.ts's use of
 * confidenceTier).
 */

import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';

export type RelationshipType =
  | 'PREREQUISITE_OF'
  | 'DEPENDS_ON'
  | 'RELATED_TO'
  | 'EXTENSION_OF'
  | 'APPLIES_TO'
  | 'COMMONLY_CONFUSED_WITH';

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  'PREREQUISITE_OF',
  'DEPENDS_ON',
  'RELATED_TO',
  'EXTENSION_OF',
  'APPLIES_TO',
  'COMMONLY_CONFUSED_WITH',
];

export type RelationshipSource = 'MANUAL' | 'AI_INFERRED' | 'CURRICULUM' | 'CONTENT_INFERRED' | 'SYSTEM';
export type RelationshipStatus = 'active' | 'rejected' | 'superseded';
export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConceptRelationship {
  id: string;
  sourceConceptId: string;
  targetConceptId: string;
  relationshipType: RelationshipType;
  confidence: number;
  confidenceTier: ConfidenceTier;
  source: RelationshipSource;
  status: RelationshipStatus;
}

/** >=0.75 HIGH, >=0.45 MEDIUM, else LOW. A LOW-confidence edge should never alone justify a strong intervention. */
export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.75) return 'HIGH';
  if (confidence >= 0.45) return 'MEDIUM';
  return 'LOW';
}

export interface RelationshipValidation {
  valid: boolean;
  reason?: 'SELF_RELATION' | 'INVALID_CONCEPT_ID' | 'INVALID_TYPE';
}

/**
 * Pure safety checks before persisting a proposed edge: no self-edges,
 * both concept IDs must actually exist, and the relationship type must
 * be one of the six supported ones. Exact-duplicate edges are handled
 * separately by the DB's own UNIQUE constraint (ON CONFLICT DO NOTHING
 * in upsertRelationship) rather than here, since that check needs a
 * query this function deliberately doesn't make.
 */
export function validateRelationship(
  sourceConceptId: string,
  targetConceptId: string,
  relationshipType: string,
  existingConceptIds: Set<string>
): RelationshipValidation {
  if (sourceConceptId === targetConceptId) return { valid: false, reason: 'SELF_RELATION' };
  if (!existingConceptIds.has(sourceConceptId) || !existingConceptIds.has(targetConceptId)) {
    return { valid: false, reason: 'INVALID_CONCEPT_ID' };
  }
  if (!RELATIONSHIP_TYPES.includes(relationshipType as RelationshipType)) return { valid: false, reason: 'INVALID_TYPE' };
  return { valid: true };
}

function toRelationship(row: any): ConceptRelationship {
  const confidence = Number(row.confidence);
  return {
    id: row.id,
    sourceConceptId: row.source_concept_id,
    targetConceptId: row.target_concept_id,
    relationshipType: row.relationship_type,
    confidence,
    confidenceTier: confidenceTier(confidence),
    source: row.source,
    status: row.status,
  };
}

/**
 * Idempotent insert -- relies on the DB's UNIQUE(source, target, type)
 * constraint to silently no-op an exact duplicate rather than erroring
 * or creating a second copy. Validation happens before this is called.
 */
export async function upsertRelationship(input: {
  sourceConceptId: string;
  targetConceptId: string;
  relationshipType: RelationshipType;
  confidence: number;
  source: RelationshipSource;
  academicContext?: Record<string, unknown> | null;
}): Promise<ConceptRelationship | null> {
  const result = await db.query(
    `INSERT INTO concept_relationships (source_concept_id, target_concept_id, relationship_type, confidence, source, academic_context)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_concept_id, target_concept_id, relationship_type) DO NOTHING
     RETURNING id, source_concept_id, target_concept_id, relationship_type, confidence, source, status`,
    [
      input.sourceConceptId,
      input.targetConceptId,
      input.relationshipType,
      input.confidence,
      input.source,
      input.academicContext ? JSON.stringify(input.academicContext) : null,
    ]
  );
  return result.rows[0] ? toRelationship(result.rows[0]) : null;
}

/** Active PREREQUISITE_OF edges pointing at this concept, highest confidence first -- "what should be understood before this?" */
export async function getPrerequisites(conceptId: string): Promise<ConceptRelationship[]> {
  const result = await db.query(
    `SELECT id, source_concept_id, target_concept_id, relationship_type, confidence, source, status
     FROM concept_relationships
     WHERE target_concept_id = $1 AND relationship_type = 'PREREQUISITE_OF' AND status = 'active'
     ORDER BY confidence DESC`,
    [conceptId]
  );
  return result.rows.map(toRelationship);
}

/**
 * Every concept whose mastery would plausibly improve if this one
 * were repaired -- i.e. concepts this one is a prerequisite of.
 * Used for "Learning Unlock Value" (NBA v2) and the Foundational Gap
 * card ("affects: Circular Motion, Centripetal Force, ...").
 */
export async function getConceptsUnlockedBy(conceptId: string): Promise<ConceptRelationship[]> {
  const result = await db.query(
    `SELECT id, source_concept_id, target_concept_id, relationship_type, confidence, source, status
     FROM concept_relationships
     WHERE source_concept_id = $1 AND relationship_type = 'PREREQUISITE_OF' AND status = 'active'
     ORDER BY confidence DESC`,
    [conceptId]
  );
  return result.rows.map(toRelationship);
}

/**
 * Prerequisite chain starting from a concept, shallowest-first,
 * capped in both depth and total nodes visited so a data error (an
 * accidental cycle) can never cause an infinite loop -- visited-set
 * based BFS, not because cycles are semantically banned (RELATED_TO
 * cycles are fine) but because PREREQUISITE_OF traversal specifically
 * must terminate.
 */
export async function getPrerequisiteChain(conceptId: string, maxDepth: number = 5): Promise<ConceptRelationship[]> {
  const visited = new Set<string>([conceptId]);
  const chain: ConceptRelationship[] = [];
  let frontier = [conceptId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0 && chain.length < 50; depth++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      const prereqs = await getPrerequisites(id);
      for (const rel of prereqs) {
        if (visited.has(rel.sourceConceptId)) continue;
        visited.add(rel.sourceConceptId);
        chain.push(rel);
        nextFrontier.push(rel.sourceConceptId);
      }
    }
    frontier = nextFrontier;
  }
  return chain;
}

export interface LearningUnlockValue {
  score: number; // internal only -- never shown to the student directly (NBA v2)
  blockedCount: number;
}

/**
 * How much learning progress plausibly unlocks if this concept were
 * repaired -- the number of concepts it's a prerequisite for, weighted
 * by how confident each of those edges is. Deliberately simple for v1
 * (no exam-relevance or repair-cost terms yet, per the brief's "the
 * exact formula can evolve" allowance) -- but already enough to make
 * NBA v2 prefer a foundational gap over a merely-low-mastery symptom.
 */
export async function getLearningUnlockValue(conceptId: string): Promise<LearningUnlockValue> {
  const unlocked = await getConceptsUnlockedBy(conceptId);
  const blockedCount = unlocked.length;
  if (blockedCount === 0) return { score: 0, blockedCount: 0 };
  const avgConfidence = unlocked.reduce((sum, r) => sum + r.confidence, 0) / blockedCount;
  return { score: Math.round(blockedCount * 10 * avgConfidence), blockedCount };
}

interface CandidateConcept {
  id: string;
  label: string;
}

/**
 * AI-assisted relationship inference for one target concept against
 * every other concept in the same subject (concepts are always
 * subject-scoped already, so this is the natural context boundary --
 * see the migration's comment on why academic_context is a secondary
 * refinement, not the primary scope). Structured output only;
 * everything is validated and deduplicated before persistence, and
 * every stored edge keeps source='AI_INFERRED' so it's never confused
 * with a manually curated one.
 */
export async function inferPrerequisitesForConcept(
  subjectId: string,
  targetConceptId: string,
  language: string = 'en'
): Promise<ConceptRelationship[]> {
  const conceptsResult = await db.query(
    `SELECT c.id, COALESCE(cl.label, c.canonical_id) AS label
     FROM concepts c
     LEFT JOIN LATERAL (
       SELECT label FROM concept_localizations WHERE concept_id = c.id ORDER BY (language = $2) DESC LIMIT 1
     ) cl ON true
     WHERE c.subject_id = $1`,
    [subjectId, language]
  );
  const allConcepts: CandidateConcept[] = conceptsResult.rows;
  const target = allConcepts.find((c) => c.id === targetConceptId);
  const candidates = allConcepts.filter((c) => c.id !== targetConceptId);
  if (!target || candidates.length === 0) return [];

  const existingIds = new Set(allConcepts.map((c) => c.id));
  const languageName = LOCALE_FULL_NAME[language] || language;

  const systemPrompt = `You are a curriculum expert identifying cognitive dependencies between concepts in the same subject.

Target concept: "${target.label}"

Candidate concepts in the same subject:
${candidates.map((c, i) => `${i + 1}. [id=${c.id}] ${c.label}`).join('\n')}

For each candidate that has a genuine cognitive relationship to the target, classify it. Only include a candidate if there's a real, specific relationship -- most candidates will have none and should be omitted entirely.

Relationship types:
- PREREQUISITE_OF: the candidate must be understood before the target (candidate -> target)
- DEPENDS_ON: the target meaningfully uses/builds on the candidate, weaker than a strict prerequisite (target -> candidate, but report it as {"conceptId": candidate, "relationshipType": "DEPENDS_ON"} from the candidate's perspective same as PREREQUISITE_OF)
- RELATED_TO: conceptually connected, no dependency direction
- COMMONLY_CONFUSED_WITH: students frequently mix these two up

Write in ${languageName} only for any free text, but ids/types stay in English exactly as given.

Output ONLY a JSON array, no markdown fences, no other text:
[{"conceptId": "<candidate id>", "relationshipType": "PREREQUISITE_OF" | "DEPENDS_ON" | "RELATED_TO" | "COMMONLY_CONFUSED_WITH", "confidence": 0.0-1.0}]

Return an empty array [] if no candidate has a genuine relationship to the target.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Classify the relationships.' }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawText = data.content.find((b: any) => b.type === 'text')?.text ?? '[]';

  let proposals: { conceptId: string; relationshipType: string; confidence: number }[];
  try {
    proposals = parseAIJson(rawText);
    if (!Array.isArray(proposals)) proposals = [];
  } catch {
    proposals = [];
  }

  const persisted: ConceptRelationship[] = [];
  for (const p of proposals) {
    // PREREQUISITE_OF and DEPENDS_ON are both reported candidate-first (candidate is the source);
    // RELATED_TO/COMMONLY_CONFUSED_WITH are symmetric in spirit but stored directionally the same way.
    const sourceConceptId = p.conceptId;
    const targetConceptIdForEdge = targetConceptId;
    const validation = validateRelationship(sourceConceptId, targetConceptIdForEdge, p.relationshipType, existingIds);
    if (!validation.valid) continue;
    const confidence = Math.max(0, Math.min(1, Number(p.confidence) || 0.5));
    const saved = await upsertRelationship({
      sourceConceptId,
      targetConceptId: targetConceptIdForEdge,
      relationshipType: p.relationshipType as RelationshipType,
      confidence,
      source: 'AI_INFERRED',
    });
    if (saved) persisted.push(saved);
  }
  return persisted;
}
