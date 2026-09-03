/**
 * Misconception Intelligence (Phase 2): normalized, reusable
 * misconception signatures instead of free-text error descriptions --
 * "force points along velocity" is a signature every occurrence of it
 * can match against, not a new string each time.
 */

import { db, type DbExecutor } from '@/lib/db';
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

/** Phase 2C: the only two persisted states -- see the migration's own doc comment for why no richer workflow state machine is introduced. */
export type MisconceptionStatus = 'ACTIVE' | 'RESOLVED';

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

export interface MisconceptionObservationResult {
  /** True when this observation found the signature RESOLVED and reactivated it -- false for a brand-new row or a repeat while already ACTIVE. */
  isReactivation: boolean;
  previousStatus: MisconceptionStatus | null;
  occurrenceCount: number;
}

/**
 * Phase 2C: applies ONE misconception observation as part of the SAME
 * atomic cognitive application it was classified from -- the caller
 * (mastery.service.ts::updateMastery) invokes this only after its own
 * operation_key gate has already confirmed this is a genuinely new
 * logical operation, using that same transaction's client. This is
 * what makes a transport replay of the triggering Explain & Defend
 * submission NOT increment occurrence_count a second time: the
 * replay's evidence-insert conflicts and rolls back before this
 * function is ever called again for it (Phase 2B's operation identity
 * reused, not a second idempotency system -- Phase 2C Step 8).
 *
 * Always leaves (or puts) the row ACTIVE -- a genuinely new
 * observation is current-cognitive-state evidence by definition,
 * whether the signature is brand new, already ACTIVE (a plain
 * recurrence -- occurrence_count increments, status unchanged), or
 * RESOLVED (a reactivation -- occurrence_count still increments,
 * resolved_at/resolved_by_evidence_id are cleared, reactivation_count
 * increments). occurrence_count is a lifetime, never-decremented total
 * across this entire history -- current truth belongs to `status`.
 */
export async function recordStudentMisconception(
  studentId: string,
  signatureId: string,
  evidenceRef?: Record<string, unknown>,
  observedByEvidenceId?: string | null,
  client: DbExecutor = db
): Promise<MisconceptionObservationResult> {
  const existing = await client.query(
    `SELECT status, occurrence_count FROM student_misconceptions WHERE student_id = $1 AND misconception_signature_id = $2`,
    [studentId, signatureId]
  );
  const previousStatus: MisconceptionStatus | null = existing.rows[0]?.status ?? null;
  const isReactivation = previousStatus === 'RESOLVED';

  const upserted = await client.query(
    `INSERT INTO student_misconceptions (student_id, misconception_signature_id, occurrence_count, last_seen, evidence, status, reactivation_count)
     VALUES ($1, $2, 1, NOW(), $3, 'ACTIVE', 0)
     ON CONFLICT (student_id, misconception_signature_id)
     DO UPDATE SET
       occurrence_count = student_misconceptions.occurrence_count + 1,
       last_seen = NOW(),
       evidence = COALESCE(student_misconceptions.evidence, '[]'::jsonb) || $3::jsonb,
       status = 'ACTIVE',
       resolved_at = CASE WHEN student_misconceptions.status = 'RESOLVED' THEN NULL ELSE student_misconceptions.resolved_at END,
       resolved_by_evidence_id = CASE WHEN student_misconceptions.status = 'RESOLVED' THEN NULL ELSE student_misconceptions.resolved_by_evidence_id END,
       reactivation_count = student_misconceptions.reactivation_count + CASE WHEN student_misconceptions.status = 'RESOLVED' THEN 1 ELSE 0 END
     RETURNING occurrence_count`,
    [studentId, signatureId, JSON.stringify(evidenceRef ? [{ ...evidenceRef, observedByEvidenceId: observedByEvidenceId ?? null }] : [])]
  );

  // Analytics stays outside the atomic cognitive-application boundary
  // (Phase 2B/2C convention: best-effort product telemetry, not part
  // of the exactly-once cognitive-state guarantee).
  track(studentId, 'misconception_detected', { signatureId, isReactivation });

  return { isReactivation, previousStatus, occurrenceCount: Number(upserted.rows[0].occurrence_count) };
}

export interface MisconceptionResolution {
  signatureId: string;
  misconceptionCode: string;
  isCritical: boolean;
}

/**
 * Phase 2C-R: every currently-ACTIVE misconception signature id for a
 * (student, concept) -- the input the resolution-scope decision (Phase
 * 2C-R Step 5) is made from. Bounded by the number of canonical
 * misconception signatures ever recorded for this one concept (never a
 * full-table or per-historical-event scan).
 */
export async function getActiveMisconceptionSignatureIdsForConcept(studentId: string, conceptId: string, client: DbExecutor = db): Promise<string[]> {
  const result = await client.query(
    `SELECT sm.misconception_signature_id
     FROM student_misconceptions sm
     JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
     WHERE sm.student_id = $1 AND ms.concept_id = $2 AND sm.status = 'ACTIVE'`,
    [studentId, conceptId]
  );
  return result.rows.map((r) => r.misconception_signature_id as string);
}

/**
 * Phase 2C-R: replaces Phase 2C's `resolveActiveMisconceptionsForConcept`.
 * External review correctly found that function unsafe: resolving
 * EVERY active signature on a concept from evidence that may only
 * genuinely address ONE of them created a false-positive
 * VALIDATED_MASTERY path whenever two or more signatures were
 * simultaneously ACTIVE on the same concept -- "same concept" was
 * never sufficient resolution identity (the exact principle Phase 2C's
 * own report already used to reject ordinary quiz/Transfer evidence,
 * just not applied to this function's own concept-wide WHERE clause).
 *
 * Transitions ONLY the given `signatureIds` -- never a bulk
 * `WHERE concept_id = ? AND status = 'ACTIVE'` scan. Every id is
 * required to both belong to `conceptId` (via the join to
 * misconception_signatures) AND currently be ACTIVE for this student;
 * a foreign or already-resolved id in the list is silently excluded
 * from the result, never trusted, never erroring the whole call.
 * Idempotent: replaying with the same ids after they are already
 * RESOLVED matches zero rows and returns an empty list.
 */
export async function resolveMisconceptionSignatures(
  studentId: string,
  conceptId: string,
  signatureIds: string[],
  resolvedByEvidenceId: string | null,
  client: DbExecutor = db
): Promise<MisconceptionResolution[]> {
  if (signatureIds.length === 0) return [];
  const result = await client.query(
    `UPDATE student_misconceptions sm
     SET status = 'RESOLVED', resolved_at = NOW(), resolved_by_evidence_id = $4
     FROM misconception_signatures ms
     WHERE sm.misconception_signature_id = ms.id
       AND sm.student_id = $1 AND ms.concept_id = $2 AND sm.status = 'ACTIVE'
       AND sm.misconception_signature_id = ANY($3::uuid[])
     RETURNING sm.misconception_signature_id, ms.misconception_code, ms.is_critical`,
    [studentId, conceptId, signatureIds, resolvedByEvidenceId]
  );
  return result.rows.map((r) => ({
    signatureId: r.misconception_signature_id,
    misconceptionCode: r.misconception_code,
    isCritical: r.is_critical,
  }));
}

/**
 * occurrence_count >= 2: a misconception seen only once isn't a
 * "recurring" pattern yet. Feeds Improve v2, NBA v2/v3, and today-plan
 * "needs attention" signals -- all current-cognitive-risk surfaces, so
 * Phase 2C scopes this to status = 'ACTIVE' only: a RESOLVED
 * misconception is real learner history, not a current defect, and
 * must stop nagging these surfaces once resolved.
 */
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
     WHERE sm.student_id = $1 AND sm.status = 'ACTIVE' AND sm.occurrence_count >= 2 AND s.status = 'active'
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
  /** Phase 2C: exactly the number of CURRENTLY ACTIVE misconception signatures -- never a lifetime count (the Phase 1F/2A semantic-overclaim finding this phase closes). */
  activeCount: number;
  /** Phase 2C: ACTIVE + critical only -- this is what determineMasteryState's criticalOk gate reads. A RESOLVED critical misconception is not counted here and cannot block VALIDATED_MASTERY. */
  criticalCount: number;
  /** Phase 2C: ACTIVE + occurrence_count >= 2 only. */
  recurringCount: number;
  /** Phase 2C, additive: every signature ever observed for this (student, concept), ACTIVE or RESOLVED -- the lifetime count the old activeCount used to (mis)represent. */
  historicalCount: number;
  /** Phase 2C, additive: currently RESOLVED signature count. */
  resolvedCount: number;
}

/**
 * Misconception counts for a single (student, concept) -- feeds the
 * Knowledge Projector (Phase 2.2A) and the Digital Twin's
 * MisconceptionSummary. One query, both the current (ACTIVE-scoped)
 * and historical (all-time) views, so callers needing either never
 * pay for a second round trip (Phase 2C Step 40).
 */
export async function getMisconceptionCountsForConcept(studentId: string, conceptId: string, client: DbExecutor = db): Promise<MisconceptionCounts> {
  const result = await client.query(
    `SELECT sm.occurrence_count, sm.status, ms.is_critical
     FROM student_misconceptions sm
     JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
     WHERE sm.student_id = $1 AND ms.concept_id = $2`,
    [studentId, conceptId]
  );
  let activeCount = 0;
  let criticalCount = 0;
  let recurringCount = 0;
  let resolvedCount = 0;
  for (const row of result.rows) {
    const isActive = row.status === 'ACTIVE';
    if (isActive) {
      activeCount++;
      if (row.is_critical) criticalCount++;
      if (Number(row.occurrence_count) >= 2) recurringCount++;
    } else {
      resolvedCount++;
    }
  }
  return { activeCount, criticalCount, recurringCount, historicalCount: result.rows.length, resolvedCount };
}

export interface MisconceptionResolutionEvidence {
  sourceType: string;
  scorePercent: number | null;
  result: 'correct' | 'partial' | 'incorrect';
  aiAssistanceType: string;
}

/**
 * Phase 2C Step 10-11: which evidence is conservative enough to
 * resolve a misconception -- reusing only already-certified concepts,
 * never an invented weighted formula. Deliberately narrow:
 * EXPLANATION (Explain & Defend -- the same evidence TYPE that most
 * directly demonstrates, or fails to demonstrate, genuine
 * understanding, scored against the SAME minimumUnderstanding
 * threshold Knowledge State's own Understanding dimension already
 * uses) and SOLO_VERIFICATION (the system's own "prove it
 * independently" check, 0.9 weight, unassisted by construction) only.
 *
 * Ordinary quiz/Transfer evidence is deliberately excluded (Phase 2C
 * report §20-23): no existing architecture links a specific quiz
 * question or Transfer prompt to a specific misconception signature,
 * so treating ordinary correctness as resolution evidence would risk
 * exactly the lucky-guess false resolution this phase exists to
 * prevent, not introduce. `aiAssistanceType !== 'NONE'` (assisted
 * evidence) never qualifies, regardless of score.
 */
export function isMisconceptionResolutionEvidence(evidence: MisconceptionResolutionEvidence, minimumUnderstanding: number): boolean {
  if (evidence.aiAssistanceType !== 'NONE') return false;
  if (evidence.sourceType === 'EXPLANATION') return (evidence.scorePercent ?? 0) >= minimumUnderstanding;
  if (evidence.sourceType === 'SOLO_VERIFICATION') return evidence.result === 'correct';
  return false;
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
