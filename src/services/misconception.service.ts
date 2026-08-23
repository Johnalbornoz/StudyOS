/**
 * Misconception Intelligence (Phase 2): normalized, reusable
 * misconception signatures instead of free-text error descriptions --
 * "force points along velocity" is a signature every occurrence of it
 * can match against, not a new string each time.
 */

import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';

export interface MisconceptionSignature {
  id: string;
  conceptId: string;
  misconceptionCode: string;
  description: string;
  canonicalExplanation: string | null;
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
    `SELECT id, concept_id, misconception_code, description, canonical_explanation
     FROM misconception_signatures WHERE concept_id = $1`,
    [conceptId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    conceptId: r.concept_id,
    misconceptionCode: r.misconception_code,
    description: r.description,
    canonicalExplanation: r.canonical_explanation,
  }));
}

/** Idempotent -- relies on UNIQUE(concept_id, misconception_code) to no-op an exact repeat. */
export async function getOrCreateSignature(
  conceptId: string,
  misconceptionCode: string,
  description: string,
  canonicalExplanation?: string
): Promise<MisconceptionSignature> {
  const upserted = await db.query(
    `INSERT INTO misconception_signatures (concept_id, misconception_code, description, canonical_explanation)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (concept_id, misconception_code) DO UPDATE SET description = EXCLUDED.description
     RETURNING id, concept_id, misconception_code, description, canonical_explanation`,
    [conceptId, misconceptionCode, description, canonicalExplanation ?? null]
  );
  const row = upserted.rows[0];
  return {
    id: row.id,
    conceptId: row.concept_id,
    misconceptionCode: row.misconception_code,
    description: row.description,
    canonicalExplanation: row.canonical_explanation,
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
  language: string = 'en'
): Promise<{ signature: MisconceptionSignature; isNew: boolean } | null> {
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
{"misconceptionCode": "SCREAMING_SNAKE_CASE_ID", "description": "one sentence in ${languageName} describing the misconception generally (not tied to this specific question's numbers)", "matchedExisting": true|false}

If there's no clear, specific misconception (e.g. it looks like a careless slip, or the answer is too vague to classify), output exactly: {"misconceptionCode": null}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Classify this answer.' }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawText = data.content.find((b: any) => b.type === 'text')?.text ?? '{"misconceptionCode": null}';

  let parsed: { misconceptionCode: string | null; description?: string; matchedExisting?: boolean };
  try {
    parsed = parseAIJson(rawText);
  } catch {
    return null;
  }
  if (!parsed.misconceptionCode) return null;

  // Prefer an exact existing code match even if the model didn't flag matchedExisting.
  const matched = existing.find((s) => s.misconceptionCode === parsed.misconceptionCode);
  if (matched) return { signature: matched, isNew: false };

  const created = await getOrCreateSignature(conceptId, parsed.misconceptionCode, parsed.description || parsed.misconceptionCode);
  return { signature: created, isNew: true };
}
