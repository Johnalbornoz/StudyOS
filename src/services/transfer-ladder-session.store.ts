/**
 * APPLY transfer ladder -- server-side attempt state.
 *
 * Substrate: an EXISTING table, `quiz_sessions`, one row per attempt (no migration):
 *   - quiz_mode = 'transfer_ladder', activity_type = 'TRANSFER', evidence_mode = 'INDEPENDENT'
 *     (evidenceModeForActivity('TRANSFER')). Because the row is an ACTIVE INDEPENDENT quiz session,
 *     the existing cross-surface guard (active-evidence-guard.service.ts, getStudentActiveQuizzes)
 *     already blocks Tutor instructional help while the attempt is open, and /api/quizzes/hint's
 *     canUseAI(INDEPENDENT, 'HINT') already refuses hints -- APPLY is independent by the SAME rules
 *     as every other independent attempt, never by a new local rule.
 *   - expires_at = now() + QUIZ_SESSION_TTL_MINUTES, decided by the DB clock and never extended
 *     (Human Agency P0-2: past expiry the guard no longer restricts the Tutor, so the system can no
 *     longer vouch the attempt was unaided -- an expired attempt produces NO evidence).
 *   - questions (jsonb) holds the ladder state object (`TransferLadderSessionState`), with a
 *     `revision` counter for optimistic concurrency. The canonical attribution also goes to the
 *     existing pedagogical_policy_version / canonical_revision / canonical_stage /
 *     canonical_activity_contract columns, like every other v1-authorized session.
 * Tasks themselves are registered in `transfer_task_instances` (Phase 7), never here only.
 */
import { db, type DbExecutor } from '@/lib/db';
import { QUIZ_SESSION_TTL_MINUTES } from '@/services/quiz-persistence.service';
import type { TransferLadderLevel } from '@/lib/transfer-ladder/ladder';

export const TRANSFER_LADDER_QUIZ_MODE = 'transfer_ladder' as const;

export interface TransferLadderAttribution {
  pedagogicalPolicyVersion: string;
  canonicalRevision: string;
  canonicalStage: string;
  canonicalActivityType: 'TRANSFER';
}

export interface TransferLadderChallengeRecord {
  index: number;
  level: TransferLadderLevel;
  taskId: string;
  context: string;
  contextDomain: string | null;
  prompt: string;
  /** Server-only reference answer for the grader; revealed to the learner only after the attempt ends. */
  modelAnswer: string;
  certified: boolean;
  certificationReason: string;
  servedAt: string;
  graded: null | {
    scorePercent: number;
    passed: boolean;
    feedback: string;
    errorType: string | null;
    answer: string;
    answeredAt: string;
    aiExecutionId: string | null;
  };
}

export interface TransferLadderSessionState {
  kind: 'TRANSFER_LADDER';
  version: 'transfer-ladder-v1';
  revision: number;
  conceptLabel: string;
  learnedContext: string;
  attribution: TransferLadderAttribution;
  challenges: TransferLadderChallengeRecord[];
  /** Set when the ladder closed (FAR demonstrated or 5 challenges); evidence is then written and the row completed. */
  closedAt: string | null;
}

export interface TransferLadderSession {
  id: string;
  studentId: string;
  conceptId: string;
  subjectId: string;
  language: string;
  status: 'active' | 'completed' | 'expired';
  isExpired: boolean;
  state: TransferLadderSessionState;
}

export interface TransferLadderStore {
  create(input: { id: string; studentId: string; conceptId: string; subjectId: string; language: string; state: TransferLadderSessionState }): Promise<void>;
  findActive(studentId: string, conceptId: string): Promise<TransferLadderSession | null>;
  load(id: string): Promise<TransferLadderSession | null>;
  /** Writes `state` (whose revision must be expectedRevision + 1) only if the stored revision is still `expectedRevision`. */
  save(id: string, state: TransferLadderSessionState, expectedRevision: number): Promise<boolean>;
  complete(id: string): Promise<void>;
  markExpired(id: string): Promise<void>;
  conceptLabel(conceptId: string, language: string): Promise<string | null>;
}

function parseState(raw: unknown): TransferLadderSessionState | null {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || (value as { kind?: unknown }).kind !== 'TRANSFER_LADDER') return null;
  return value as TransferLadderSessionState;
}

function rowToSession(row: any): TransferLadderSession | null {
  const state = parseState(row.questions);
  if (!state) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    subjectId: row.subject_id,
    language: row.language,
    status: row.status,
    isExpired: row.is_expired === true,
    state,
  };
}

const SELECT_COLUMNS = `id, student_id, concept_id, subject_id, language, status, questions, (now() >= expires_at) AS is_expired`;

export function createDbTransferLadderStore(client: DbExecutor = db): TransferLadderStore {
  return {
    async create({ id, studentId, conceptId, subjectId, language, state }) {
      await client.query(
        `INSERT INTO quiz_sessions (
           id, student_id, concept_id, subject_id, questions, language, status, created_at, expires_at,
           quiz_mode, concept_ids, activity_type, evidence_mode,
           pedagogical_policy_version, canonical_revision, canonical_stage, canonical_activity_contract
         ) VALUES ($1, $2, $3, $4, $5, $6, 'active', now(), now() + make_interval(mins => $7),
           $8, ARRAY[$3]::uuid[], 'TRANSFER', 'INDEPENDENT', $9, $10, $11, $12)`,
        [
          id,
          studentId,
          conceptId,
          subjectId,
          JSON.stringify(state),
          language,
          QUIZ_SESSION_TTL_MINUTES,
          TRANSFER_LADDER_QUIZ_MODE,
          state.attribution.pedagogicalPolicyVersion,
          state.attribution.canonicalRevision,
          state.attribution.canonicalStage,
          JSON.stringify({
            canonicalActivityType: 'TRANSFER',
            implementation: 'transfer-ladder-v1',
            itemCount: { min: 3, max: 5 },
            assistanceAllowed: false,
            independence: true,
            supportLevel: 'NONE',
            minimumScorePercent: 80,
          }),
        ],
      );
    },
    async findActive(studentId, conceptId) {
      const r = await client.query(
        `SELECT ${SELECT_COLUMNS} FROM quiz_sessions
         WHERE student_id = $1 AND concept_id = $2 AND quiz_mode = $3 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [studentId, conceptId, TRANSFER_LADDER_QUIZ_MODE],
      );
      return r.rows[0] ? rowToSession(r.rows[0]) : null;
    },
    async load(id) {
      const r = await client.query(`SELECT ${SELECT_COLUMNS} FROM quiz_sessions WHERE id = $1 AND quiz_mode = $2`, [id, TRANSFER_LADDER_QUIZ_MODE]);
      return r.rows[0] ? rowToSession(r.rows[0]) : null;
    },
    async save(id, state, expectedRevision) {
      const r = await client.query(
        `UPDATE quiz_sessions SET questions = $2
         WHERE id = $1 AND quiz_mode = $4 AND status = 'active' AND (questions->>'revision')::int = $3`,
        [id, JSON.stringify(state), expectedRevision, TRANSFER_LADDER_QUIZ_MODE],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async complete(id) {
      await client.query(`UPDATE quiz_sessions SET status = 'completed', completed_at = now() WHERE id = $1 AND quiz_mode = $2`, [id, TRANSFER_LADDER_QUIZ_MODE]);
    },
    async markExpired(id) {
      await client.query(`UPDATE quiz_sessions SET status = 'expired' WHERE id = $1 AND quiz_mode = $2 AND status = 'active'`, [id, TRANSFER_LADDER_QUIZ_MODE]);
    },
    async conceptLabel(conceptId, language) {
      const r = await client.query(
        `SELECT c.canonical_id, cl.label
         FROM concepts c
         LEFT JOIN LATERAL (
           SELECT label FROM concept_localizations WHERE concept_id = c.id ORDER BY (language = $2) DESC LIMIT 1
         ) cl ON true
         WHERE c.id = $1`,
        [conceptId, language],
      );
      const row = r.rows[0];
      return row ? (row.label || row.canonical_id || null) : null;
    },
  };
}
