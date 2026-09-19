// @ts-nocheck
/**
 * Quiz Persistence Service
 *
 * Stores and retrieves quiz sessions from database instead of memory.
 * Prevents loss on server restart and enables concurrent requests.
 */

import { db } from '@/lib/db';
import { GeneratedQuestion } from '@/services/quiz-generation.service';
import { evidenceModeForActivity, type ActivityType, type EvidenceMode } from '@/lib/activity-taxonomy';
import { fingerprintQuestion } from '@/lib/lx/exact-duplicate-novelty';

export type QuizMode =
  | 'topic_practice'
  | 'review'
  | 'quick_check'
  | 'retention_check'
  | 'cumulative_assessment'
  | 'exam_simulation'
  | 'diagnostic_check'
  /**
   * CANON-R6 Part 1/4/6 -- the ONE distinct, server-only mode for
   * exact-10, independent, canonical v1 Prove. NEVER an alias for
   * `quick_check` (which stays fixed at 6 items for every legacy
   * caller, completely untouched by this addition) -- a session can
   * only ever be CREATED in this mode by generate-and-take's own
   * independently-re-verified v1 authorization
   * (`verifyV1PracticeLaunchMarker`); no legitimate legacy caller ever
   * requests it.
   */
  | 'canonical_prove'
  /**
   * CANON-V2-ARCH-CLEANUP -- the distinct, server-only mode for the
   * exact-10, independent, NOVEL canonical v1 Retain check. Never an
   * alias for legacy `retention_check` (which stays fixed at 6 items,
   * completely untouched) -- same "new distinct mode, same
   * ActivityType/EvidenceMode, new server-only generation path" pattern
   * `canonical_prove` already established for Prove.
   */
  | 'canonical_retain'
  /**
   * CANON-V2-ARCH-CLEANUP -- the ONE canonical v1 Transfer mode: exactly
   * 3 structured challenges (NEAR/CONTEXTUAL/HIGHER), D4-5, independent.
   * No legacy Transfer mode exists to alias -- this is a wholly new,
   * server-only generation path.
   */
  | 'canonical_transfer'
  /**
   * CANON-V2-ARCH-CLEANUP -- the ONE canonical v1 LEARN comprehension
   * checkpoint: a dedicated, assisted quiz whose ONLY purpose is
   * verifying genuine understanding (>80% exclusive), never a generic
   * practice/quiz relabeled after the fact.
   */
  | 'canonical_learn_check';

/**
 * Phase 3A: the Quiz/Activity Engine's own Activity Type per quiz
 * mode -- fixed at attempt creation (see storeQuiz) and never changed
 * afterward. `quick_check` is deliberately SOLO_CHECK, not
 * CUMULATIVE_ASSESSMENT -- Solo Check must never be represented
 * internally as Cumulative Assessment just because an earlier route
 * happened to reuse that mode for a "prove it alone" moment
 * (Concept Detail's soloCheck CTA did exactly that; it's fixed
 * alongside this).
 *
 * CANON-R6: `canonical_prove` reuses the SAME `SOLO_CHECK` ActivityType
 * as `quick_check` -- CANON-R3's own evidence adapter already maps
 * SOLO_CHECK evidence to the engine's PROVE requirement, and
 * `SOLO_CHECK`'s EvidenceMode (`INDEPENDENT`) already denies every
 * AI-assistance feature via the existing, unmodified `canUseAI` policy
 * -- no new ActivityType, no new EvidenceMode, no new AI-permission
 * rule was needed.
 */
export const ACTIVITY_TYPE_BY_QUIZ_MODE: Record<QuizMode, ActivityType> = {
  topic_practice: 'PRACTICE',
  review: 'REVIEW',
  quick_check: 'SOLO_CHECK',
  retention_check: 'RETENTION_CHECK',
  cumulative_assessment: 'CUMULATIVE_ASSESSMENT',
  exam_simulation: 'MOCK_EXAM',
  diagnostic_check: 'DIAGNOSTIC_CHECK',
  canonical_prove: 'SOLO_CHECK',
  // CANON-V2-ARCH-CLEANUP: canonical_retain reuses the SAME
  // RETENTION_CHECK ActivityType (EvidenceMode INDEPENDENT) legacy
  // retention_check already uses -- new mode, new item count, same
  // ActivityType/EvidenceMode/AI-permission rule, exactly the
  // canonical_prove precedent.
  canonical_retain: 'RETENTION_CHECK',
  canonical_transfer: 'TRANSFER',
  canonical_learn_check: 'LEARN_CHECK',
};

export function activityTypeForQuizMode(quizMode: QuizMode): ActivityType {
  return ACTIVITY_TYPE_BY_QUIZ_MODE[quizMode] ?? 'PRACTICE';
}

export function evidenceModeForQuizMode(quizMode: QuizMode): EvidenceMode {
  return evidenceModeForActivity(activityTypeForQuizMode(quizMode));
}

/**
 * CANON-R5R1/R5R1A -- the trusted, server-persisted v1 launch
 * AUTHORIZATION for this session, written ONCE at generation time
 * (storeQuiz) from an independently-verified
 * `getCanonicalPedagogicalDecision` call -- never from a client claim.
 * `null` for every legacy/non-canonical session (the overwhelming
 * majority). Carries not just "this concept was at canonical PRACTICE"
 * (R5R1) but the EXACT contract (item count / difficulty / assistance)
 * that authorized generation (R5R1A) -- so submission-time compliance
 * checking (`checkV1ActivityContractCompliance`) never has to guess
 * what was authorized. See
 * src/lib/pedagogical-decision/v1-practice-launch-marker.ts.
 */
export interface QuizSessionV1Marker {
  pedagogicalPolicyVersion: string;
  canonicalRevision: string;
  canonicalStage: string;
  canonicalActivityType: string;
  /** `null` only for a `canonical_learn_check` session -- see V1PracticeLaunchMarker.itemCount's own doc comment. */
  itemCount: { min: number; max: number; authorized: number } | null;
  difficulty: { min: number; max: number; target: number };
  assistanceAllowed: boolean;
  /** CANON-R6 -- additive; `false` for every pre-R6 Practice marker still round-tripping through this same JSONB shape. */
  independence: boolean;
  supportLevel: 'ASSISTED' | 'NONE';
  minimumScorePercent: number;
  /**
   * CANON-R6R1 -- additive; present ONLY for a `canonical_prove` session
   * (`null`/omitted for Practice/Reinforce, and for any pre-R6R1 Prove
   * row that predates this field). Diagnostic record of the exact-
   * duplicate novelty filtering that ran at generation time -- never
   * full prior-question text, only counts.
   */
  novelty?: {
    priorPracticeFingerprintCount: number;
    rejectedExactDuplicateCount: number;
    acceptedNovelQuestionCount: number;
    noveltyPolicy: 'EXACT_DUPLICATE_EXCLUSION_V1';
  } | null;
}

export interface QuizSession {
  id: string;
  studentId: string;
  conceptId: string | null;
  subjectId: string;
  conceptIds: string[];
  quizMode: QuizMode;
  activityType: ActivityType;
  evidenceMode: EvidenceMode;
  questions: GeneratedQuestion[];
  language: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'active' | 'completed' | 'expired';
  hintsUsedQuestions: number[];
  v1Marker: QuizSessionV1Marker | null;
  /**
   * F11-C2 -- explicit Skill target(s) this quiz was generated for, set
   * ONLY by Skill-reinforcement orchestration. `null`/absent for every
   * ordinary, student-initiated Practice quiz and every F11-C1
   * TOPIC_PRACTICE Concept-reinforcement quiz -- never derived from the
   * Concept->Skill graph after the fact.
   */
  targetSkillIds: string[] | null;
  /**
   * F11-C3 -- explicit Competency target(s), set ONLY by
   * Competency-reinforcement orchestration. Deliberately a SEPARATE
   * field from `targetSkillIds` (never conflated) -- `null`/absent for
   * every existing quiz and every Concept/Skill-reinforcement quiz.
   * Never derived from canonical_concept_competencies/
   * skill_competencies after the fact.
   */
  targetCompetencyIds: string[] | null;
}

/**
 * Store generated quiz in database. `conceptId` is the single concept
 * for topic_practice/quick_check quizzes, or null for quizzes spanning
 * multiple concepts (cumulative_assessment/exam_simulation) -- those
 * pass the full set via `conceptIds` instead. Individual questions
 * always carry their own conceptId regardless.
 */
export async function storeQuiz(
  studentId: string,
  conceptId: string | null,
  subjectId: string,
  questions: GeneratedQuestion[],
  language: string = 'en',
  quizMode: QuizMode = 'topic_practice',
  conceptIds: string[] = [],
  /**
   * CANON-R5R1 -- the ALREADY-INDEPENDENTLY-VERIFIED v1 marker (see
   * verifyV1PracticeLaunchMarker), or `null`/omitted for every ordinary
   * (legacy) session. This function never verifies eligibility itself
   * -- it only persists what the caller already confirmed.
   */
  v1Marker: QuizSessionV1Marker | null = null,
  /**
   * F11-C2 -- explicit Skill target(s) for a Skill-reinforcement
   * execution. `undefined`/omitted (the default) for every existing
   * caller -- the column stays NULL, byte-identical to pre-F11-C2
   * behavior. Never populated by inferring from the Concept->Skill
   * graph; only ever passed by Skill-reinforcement orchestration, which
   * already resolved this specific student's own explicit Skill target.
   */
  targetSkillIds?: string[] | null,
  /**
   * F11-C3 -- explicit Competency target(s) for a Competency-
   * reinforcement execution. `undefined`/omitted (the default) for
   * every existing caller, including F11-C1/F11-C2's own orchestration
   * -- the column stays NULL, byte-identical to pre-F11-C3 behavior.
   */
  targetCompetencyIds?: string[] | null
): Promise<string> {
  try {
    const quizId = `quiz-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 45 * 60 * 1000); // Expire after 45 minutes

    // Phase 3A: Activity Type/Evidence Mode are derived once, here, at
    // attempt creation, and stamped onto the row -- never recomputed or
    // rewritten afterward. That's what makes them immutable per attempt:
    // there is no UPDATE path in this file that touches either column.
    const activityType = activityTypeForQuizMode(quizMode);
    const evidenceMode = evidenceModeForActivity(activityType);

    // CANON-R5R1A Part 9/24 -- the cheap, top-level auditable fields
    // (policy version/revision/stage) stay as plain TEXT columns
    // (unchanged from R5R1); the richer, structured contract this phase
    // adds (item count range, difficulty range/target, assistance) goes
    // into ONE additive JSONB column, matching this schema's own
    // established precedent (`learning_evidence.metadata`) for
    // structured-but-optional data rather than five more discrete columns.
    const canonicalActivityContract = v1Marker
      ? JSON.stringify({
          canonicalActivityType: v1Marker.canonicalActivityType,
          itemCount: v1Marker.itemCount,
          difficulty: v1Marker.difficulty,
          assistanceAllowed: v1Marker.assistanceAllowed,
          independence: v1Marker.independence,
          supportLevel: v1Marker.supportLevel,
          minimumScorePercent: v1Marker.minimumScorePercent,
          // CANON-R6R1 -- additive; `undefined` (omitted from the JSON)
          // for every non-Prove marker, exactly as before this phase.
          novelty: v1Marker.novelty ?? undefined,
        })
      : null;

    await db.query(
      `
      INSERT INTO quiz_sessions (
        id, student_id, concept_id, subject_id,
        questions, language, status, created_at, expires_at,
        quiz_mode, concept_ids, activity_type, evidence_mode,
        pedagogical_policy_version, canonical_revision, canonical_stage,
        canonical_activity_contract, target_skill_ids, target_competency_ids
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `,
      [
        quizId,
        studentId,
        conceptId,
        subjectId,
        JSON.stringify(questions),
        language,
        'active',
        now,
        expiresAt,
        quizMode,
        conceptIds.length > 0 ? conceptIds : questions.map((q) => q.conceptId),
        activityType,
        evidenceMode,
        v1Marker?.pedagogicalPolicyVersion ?? null,
        v1Marker?.canonicalRevision ?? null,
        v1Marker?.canonicalStage ?? null,
        canonicalActivityContract,
        targetSkillIds && targetSkillIds.length > 0 ? targetSkillIds : null,
        targetCompetencyIds && targetCompetencyIds.length > 0 ? targetCompetencyIds : null,
      ]
    );

    return quizId;
  } catch (error) {
    console.error('Error storing quiz:', error);
    throw error;
  }
}

/**
 * CANON-R6R1 Part 2/3 -- the REAL, previously-administered v1 Practice
 * question text for this exact (student, concept) pair, as
 * exact-novelty fingerprints. This is the strongest real source already
 * available: `quiz_sessions.questions` holds the actual generated/
 * administered question payload (not a re-derivation from
 * `learning_evidence` score rows, which never carry question text).
 *
 * Part 3 -- rather than isolating only the single Practice attempt that
 * currently satisfies the canonical PRACTICE requirement (the schema
 * has no such marker on a `quiz_sessions` row), this conservatively
 * excludes EVERY prior v1 `topic_practice` question for this
 * (student, concept) pair -- excluding more than strictly necessary is
 * safer than excluding too little, and the spec explicitly permits this
 * fallback. `pedagogical_policy_version IS NOT NULL` restricts this to
 * v1-authorized Practice sessions only (never legacy, pre-v1 rows,
 * which carry no comparable authorization). Unrelated concepts are
 * never touched: both the SQL filter and the per-question
 * `q.conceptId === conceptId` check below scope this to the ONE
 * concept being Proved.
 */
export async function loadPriorPracticeQuestionFingerprints(studentId: string, conceptId: string): Promise<Set<string>> {
  const result = await db.query(
    `
    SELECT questions
    FROM quiz_sessions
    WHERE student_id = $1
      AND quiz_mode = 'topic_practice'
      AND pedagogical_policy_version IS NOT NULL
      AND $2::uuid = ANY(concept_ids)
    `,
    [studentId, conceptId]
  );

  const fingerprints = new Set<string>();
  for (const row of result.rows) {
    const questions: GeneratedQuestion[] = row.questions || [];
    for (const question of questions) {
      if (question.conceptId === conceptId && typeof question.question === 'string') {
        fingerprints.add(fingerprintQuestion(question));
      }
    }
  }
  return fingerprints;
}

/**
 * CANON-V2-ARCH-CLEANUP -- the REAL, previously-administered question
 * text this (student, concept) pair has already seen across every
 * canonical activity RETAIN's own "novel" requirement must be checked
 * against: Practice (`topic_practice`), Prove (`canonical_prove`), AND
 * any earlier Retain attempt (`canonical_retain`) itself. Broader than
 * `loadPriorPracticeQuestionFingerprints` (Prove's own base) on purpose
 * -- RETAIN's frozen contract requires items the learner has never seen
 * in ANY prior canonical activity, not just Practice.
 */
export async function loadPriorCanonicalQuestionFingerprintsForRetain(studentId: string, conceptId: string): Promise<Set<string>> {
  const result = await db.query(
    `
    SELECT questions
    FROM quiz_sessions
    WHERE student_id = $1
      AND quiz_mode = ANY($3::text[])
      AND pedagogical_policy_version IS NOT NULL
      AND $2::uuid = ANY(concept_ids)
    `,
    [studentId, conceptId, ['topic_practice', 'canonical_prove', 'canonical_retain']]
  );

  const fingerprints = new Set<string>();
  for (const row of result.rows) {
    const questions: GeneratedQuestion[] = row.questions || [];
    for (const question of questions) {
      if (question.conceptId === conceptId && typeof question.question === 'string') {
        fingerprints.add(fingerprintQuestion(question));
      }
    }
  }
  return fingerprints;
}

/**
 * Retrieve quiz questions from database
 */
export async function getQuiz(quizId: string): Promise<GeneratedQuestion[] | null> {
  try {
    const result = await db.query(
      `
      SELECT questions, status, expires_at
      FROM quiz_sessions
      WHERE id = $1
      `,
      [quizId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Check if quiz has expired
    if (new Date() > new Date(row.expires_at)) {
      // Mark as expired
      await db.query(
        'UPDATE quiz_sessions SET status = $1 WHERE id = $2',
        ['expired', quizId]
      );
      return null;
    }

    return row.questions;
  } catch (error) {
    console.error('Error retrieving quiz:', error);
    return null;
  }
}

/**
 * Mark quiz as completed
 */
export async function completeQuiz(quizId: string): Promise<boolean> {
  try {
    const result = await db.query(
      `
      UPDATE quiz_sessions
      SET status = $1, completed_at = NOW()
      WHERE id = $2
      `,
      ['completed', quizId]
    );

    return result.rowCount > 0;
  } catch (error) {
    console.error('Error completing quiz:', error);
    return false;
  }
}

/**
 * Records that a hint was requested for a specific question, so
 * submission-time telemetry (learning_evidence.hints_used) knows which
 * concepts got assisted. Idempotent -- requesting a hint twice for the
 * same question doesn't double-count.
 */
export async function recordHintUsed(quizId: string, questionIndex: number): Promise<void> {
  await db.query(
    `
    UPDATE quiz_sessions
    SET hints_used_questions = (
      SELECT ARRAY(SELECT DISTINCT unnest(hints_used_questions || $2::int[]))
    )
    WHERE id = $1
    `,
    [quizId, [questionIndex]]
  );
}

/**
 * Get quiz session metadata
 */
export async function getQuizSession(quizId: string): Promise<QuizSession | null> {
  try {
    const result = await db.query(
      `
      SELECT id, student_id, concept_id, subject_id,
             questions, language, status, created_at, expires_at,
             quiz_mode, concept_ids, hints_used_questions, activity_type, evidence_mode,
             pedagogical_policy_version, canonical_revision, canonical_stage,
             canonical_activity_contract, target_skill_ids, target_competency_ids
      FROM quiz_sessions
      WHERE id = $1
      `,
      [quizId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const quizMode: QuizMode = row.quiz_mode || 'topic_practice';
    // Backward compatibility: a row created before this migration has
    // NULL activity_type/evidence_mode -- derive them from its
    // (unchanged) quiz_mode via the same mapping, rather than treating
    // historical attempts as mode-less.
    const activityType: ActivityType = row.activity_type || activityTypeForQuizMode(quizMode);
    const evidenceMode: EvidenceMode = row.evidence_mode || evidenceModeForActivity(activityType);
    // CANON-R5R1A -- a v1 marker is trusted ONLY when BOTH the simple
    // top-level fields (policy version/revision/stage) AND the
    // structured contract JSONB are present. A row with one but not the
    // other (e.g. a hypothetical pre-R5R1A row stamped before this
    // phase's contract column existed) is treated as `v1Marker: null` --
    // never reconstructed, never guessed, never trusted with a partial
    // authorization (Part 0's Primary Invariant: stage-only verification
    // is insufficient).
    let v1Marker: QuizSessionV1Marker | null = null;
    if (row.pedagogical_policy_version && row.canonical_activity_contract) {
      const contract = typeof row.canonical_activity_contract === 'string' ? JSON.parse(row.canonical_activity_contract) : row.canonical_activity_contract;
      v1Marker = {
        pedagogicalPolicyVersion: row.pedagogical_policy_version,
        canonicalRevision: row.canonical_revision,
        canonicalStage: row.canonical_stage,
        canonicalActivityType: contract.canonicalActivityType,
        itemCount: contract.itemCount,
        difficulty: contract.difficulty,
        assistanceAllowed: contract.assistanceAllowed,
        // CANON-R6: `?? false`/`?? 'ASSISTED'`/`?? 80` are backward-compat
        // defaults ONLY for a hypothetical pre-R6 stored contract that
        // predates these three fields -- every row this session's own
        // code ever writes always includes them (storeQuiz always
        // persists a full, current-shape v1Marker).
        independence: contract.independence ?? false,
        supportLevel: contract.supportLevel ?? 'ASSISTED',
        minimumScorePercent: contract.minimumScorePercent ?? 80,
        novelty: contract.novelty ?? null,
      };
    }

    return {
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      conceptIds: row.concept_ids || [],
      quizMode,
      activityType,
      evidenceMode,
      questions: row.questions,
      language: row.language,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      status: row.status,
      hintsUsedQuestions: row.hints_used_questions || [],
      v1Marker,
      targetSkillIds: row.target_skill_ids && row.target_skill_ids.length > 0 ? row.target_skill_ids : null,
      targetCompetencyIds: row.target_competency_ids && row.target_competency_ids.length > 0 ? row.target_competency_ids : null,
    };
  } catch (error) {
    console.error('Error getting quiz session:', error);
    return null;
  }
}

/**
 * Get all active quizzes for a student
 */
export async function getStudentActiveQuizzes(studentId: string): Promise<QuizSession[]> {
  try {
    const result = await db.query(
      `
      SELECT id, student_id, concept_id, subject_id,
             questions, status, created_at, expires_at, quiz_mode, concept_ids, activity_type, evidence_mode
      FROM quiz_sessions
      WHERE student_id = $1
      AND status = 'active'
      AND expires_at > NOW()
      ORDER BY created_at DESC
      `,
      [studentId]
    );

    return result.rows.map((row) => {
      const quizMode: QuizMode = row.quiz_mode || 'topic_practice';
      const activityType: ActivityType = row.activity_type || activityTypeForQuizMode(quizMode);
      const evidenceMode: EvidenceMode = row.evidence_mode || evidenceModeForActivity(activityType);
      return {
        id: row.id,
        studentId: row.student_id,
        conceptId: row.concept_id,
        subjectId: row.subject_id,
        conceptIds: row.concept_ids || [],
        quizMode,
        activityType,
        evidenceMode,
        questions: row.questions,
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
        status: row.status,
        hintsUsedQuestions: [],
        // This listing query doesn't select the v1 marker columns --
        // callers of getStudentActiveQuizzes never need submission
        // authority, only getQuizSession (the real reload path) does.
        v1Marker: null,
      };
    });
  } catch (error) {
    console.error('Error getting student quizzes:', error);
    return [];
  }
}

/**
 * Cleanup expired quizzes (run periodically)
 */
export async function cleanupExpiredQuizzes(): Promise<number> {
  try {
    const result = await db.query(
      `
      DELETE FROM quiz_sessions
      WHERE status = 'expired'
      OR (status = 'active' AND expires_at < NOW())
      `
    );

    return result.rowCount || 0;
  } catch (error) {
    console.error('Error cleaning up quizzes:', error);
    return 0;
  }
}
