/**
 * Misconception Intelligence (Phase 2): normalized, reusable
 * misconception signatures instead of free-text error descriptions --
 * "force points along velocity" is a signature every occurrence of it
 * can match against, not a new string each time.
 */

import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { track } from '@/lib/analytics';
import { executeAI, validateJson, getPrompt, AIExecutionFailure, type AIProvenance } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';

export interface MisconceptionSignature {
  id: string;
  conceptId: string;
  misconceptionCode: string;
  description: string;
  canonicalExplanation: string | null;
  isCritical: boolean;
}

export interface RecurringMisconception {
  signatureId: string;
  conceptId: string;
  conceptLabel: string;
  subjectId: string;
  subjectName: string;
  misconceptionCode: string;
  description: string;
  occurrenceCount: number;
  lastSeen: string;
}

/** Every existing signature for a concept -- passed to the classifier so it prefers matching one of these over minting a new code. */
export async function getSignaturesForConcept(conceptId: string): Promise<MisconceptionSignature[]> {
  const result = await db.query(
    `SELECT id, concept_id, misconception_code, description, canonical_explanation, is_critical
     FROM misconception_signatures WHERE concept_id = $1`,
    [conceptId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    conceptId: r.concept_id,
    misconceptionCode: r.misconception_code,
    description: r.description,
    canonicalExplanation: r.canonical_explanation,
    isCritical: r.is_critical,
  }));
}

/** Idempotent -- relies on UNIQUE(concept_id, misconception_code) to no-op an exact repeat. */
export async function getOrCreateSignature(
  conceptId: string,
  misconceptionCode: string,
  description: string,
  canonicalExplanation?: string,
  isCritical: boolean = false
): Promise<MisconceptionSignature> {
  const upserted = await db.query(
    `INSERT INTO misconception_signatures (concept_id, misconception_code, description, canonical_explanation, is_critical)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (concept_id, misconception_code) DO UPDATE SET description = EXCLUDED.description
     RETURNING id, concept_id, misconception_code, description, canonical_explanation, is_critical`,
    [conceptId, misconceptionCode, description, canonicalExplanation ?? null, isCritical]
  );
  const row = upserted.rows[0];
  return {
    id: row.id,
    conceptId: row.concept_id,
    misconceptionCode: row.misconception_code,
    description: row.description,
    canonicalExplanation: row.canonical_explanation,
    isCritical: row.is_critical,
  };
}

/** Increments occurrence_count / bumps last_seen if this (student, signature) pair already exists, otherwise creates it at count 1. */
export async function recordStudentMisconception(
  studentId: string,
  signatureId: string,
  evidenceRef?: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO student_misconceptions (student_id, misconception_signature_id, occurrence_count, last_seen, evidence)
     VALUES ($1, $2, 1, NOW(), $3)
     ON CONFLICT (student_id, misconception_signature_id)
     DO UPDATE SET occurrence_count = student_misconceptions.occurrence_count + 1, last_seen = NOW(),
       evidence = COALESCE(student_misconceptions.evidence, '[]'::jsonb) || $3::jsonb`,
    [studentId, signatureId, JSON.stringify(evidenceRef ? [evidenceRef] : [])]
  );
  track(studentId, 'misconception_detected', { signatureId });
}

/** occurrence_count >= 2: a misconception seen only once isn't a "recurring" pattern yet. Feeds Improve v2 and the diagnosis/NBA v2 signals. */
export async function getRecurringMisconceptions(studentId: string): Promise<RecurringMisconception[]> {
  const result = await db.query(
    `SELECT sm.misconception_signature_id, sm.occurrence_count, sm.last_seen,
            ms.concept_id, ms.misconception_code, ms.description,
            COALESCE(cl.label, c.canonical_id) AS concept_label,
            c.subject_id, s.name AS subject_name
     FROM student_misconceptions sm
     JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
     JOIN concepts c ON c.id = ms.concept_id
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN LATERAL (SELECT label FROM concept_localizations WHERE concept_id = c.id LIMIT 1) cl ON true
     WHERE sm.student_id = $1 AND sm.occurrence_count >= 2 AND s.status = 'active'
     ORDER BY sm.occurrence_count DESC, sm.last_seen DESC`,
    [studentId]
  );
  return result.rows.map((r) => ({
    signatureId: r.misconception_signature_id,
    conceptId: r.concept_id,
    conceptLabel: r.concept_label,
    subjectId: r.subject_id,
    subjectName: r.subject_name,
    misconceptionCode: r.misconception_code,
    description: r.description,
    occurrenceCount: Number(r.occurrence_count),
    lastSeen: r.last_seen,
  }));
}

export interface MisconceptionCounts {
  activeCount: number;
  criticalCount: number;
  recurringCount: number;
}

/**
 * Misconception counts for a single (student, concept) -- feeds the
 * Knowledge Projector (Phase 2.2A). "Active" is every misconception
 * ever recorded for this student on this concept (student_misconceptions
 * has no resolution/expiry concept yet, so every row is currently
 * active by construction); "critical" and "recurring" narrow that set.
 */
export async function getMisconceptionCountsForConcept(studentId: string, conceptId: string): Promise<MisconceptionCounts> {
  const result = await db.query(
    `SELECT sm.occurrence_count, ms.is_critical
     FROM student_misconceptions sm
     JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
     WHERE sm.student_id = $1 AND ms.concept_id = $2`,
    [studentId, conceptId]
  );
  let criticalCount = 0;
  let recurringCount = 0;
  for (const row of result.rows) {
    if (row.is_critical) criticalCount++;
    if (Number(row.occurrence_count) >= 2) recurringCount++;
  }
  return { activeCount: result.rows.length, criticalCount, recurringCount };
}

/**
 * AI-assisted classification of an incorrect answer into a
 * misconception signature -- structured output, and explicitly
 * steered to reuse an existing signature over minting a new one. This
 * never decides the student's cognitive state on its own; it only
 * labels a specific wrong answer, and the caller persists it via
 * recordStudentMisconception (which is what actually accumulates into
 * a "recurring" signal).
 */
export async function classifyMisconception(
  conceptId: string,
  conceptLabel: string,
  question: string,
  studentAnswer: string,
  correctAnswer: string,
  language: string = 'en',
  /** Phase 0E2 Step 11: optional, purely additive. */
  context?: { studentId?: string; subjectId?: string }
): Promise<{ signature: MisconceptionSignature; isNew: boolean; aiExecution: AIProvenance } | null> {
  const existing = await getSignaturesForConcept(conceptId);
  const languageName = LOCALE_FULL_NAME[language] || language;

  const systemPrompt = `You classify a student's incorrect answer into a specific, reusable misconception -- not a generic error-type label.

Concept: "${conceptLabel}"
Question: ${question}
Student's answer: ${studentAnswer}
Correct answer: ${correctAnswer}

Existing known misconceptions for this concept (prefer matching one of these over inventing a new one):
${existing.length > 0 ? existing.map((s) => `- code=${s.misconceptionCode}: ${s.description}`).join('\n') : '(none yet)'}

If the student's answer reflects a genuine, specific, describable misconception (not just a careless slip or unrelated error), output ONLY this JSON, no markdown fences, no other text:
{"misconceptionCode": "SCREAMING_SNAKE_CASE_ID", "description": "one sentence in ${languageName} describing the misconception generally (not tied to this specific question's numbers)", "matchedExisting": true|false, "isCritical": true|false}

isCritical means this misconception is foundational -- it would systematically produce wrong reasoning across many problems on this concept (not just this one question), and blocks real mastery until resolved. A minor surface slip or a misconception that only affects edge cases is NOT critical.

If there's no clear, specific misconception (e.g. it looks like a careless slip, or the answer is too vague to classify), output exactly: {"misconceptionCode": null}`;

  type ClassificationResult = { misconceptionCode: string | null; description?: string; matchedExisting?: boolean; isCritical?: boolean };
  const prompt = getPrompt('misconception.classification');

  let parsed: ClassificationResult;
  let aiExecution: AIProvenance;
  try {
    const outcome = await executeAI({
      capability: prompt.capability,
      risk: 'HIGH_RISK',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: { studentId: context?.studentId, subjectId: context?.subjectId, conceptId, sourceComponent: 'misconception.service.ts:classifyMisconception' },
      call: (signal) =>
        callAnthropicMessages(
          { model: 'claude-sonnet-5', maxTokens: 500, system: systemPrompt, messages: [{ role: 'user', content: 'Classify this answer.' }] },
          signal
        ),
      validate: (raw) => validateJson<ClassificationResult>({ text: raw.text || '{"misconceptionCode": null}' }, (v) => ({ value: v, errors: [] })),
    });
    parsed = outcome.result;
    aiExecution = outcome.provenance;
  } catch (err) {
    // Preserves the pre-existing split: a parse/validation failure
    // resolves to "no misconception detected" (null); a transport/
    // provider failure propagates, same as the original uncaught fetch.
    if (err instanceof AIExecutionFailure && (err.code === 'INVALID_RESPONSE' || err.code === 'VALIDATION_ERROR')) {
      return null;
    }
    throw err;
  }
  if (!parsed.misconceptionCode) return null;

  // Prefer an exact existing code match even if the model didn't flag matchedExisting.
  const matched = existing.find((s) => s.misconceptionCode === parsed.misconceptionCode);
  if (matched) return { signature: matched, isNew: false, aiExecution };

  const created = await getOrCreateSignature(
    conceptId,
    parsed.misconceptionCode,
    parsed.description || parsed.misconceptionCode,
    undefined,
    parsed.isCritical === true
  );
  return { signature: created, isNew: true, aiExecution };
}
