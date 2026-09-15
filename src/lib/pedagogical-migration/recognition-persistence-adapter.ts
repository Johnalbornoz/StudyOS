/**
 * CANON-R4R1 Part 17/19 -- THE ONE persistence adapter for
 * `pedagogical_requirement_recognition` (schema:
 * database/migrations/20260915_1000_canon_r4r1_pedagogical_requirement_recognition.sql,
 * NOT yet applied -- see the report's STATUS section). All IO lives
 * here, outside the pure engine and outside the pure migration-baseline
 * logic -- this file is the only place in the repository that ever
 * queries this table.
 *
 * NEVER executed in this environment (no live DB access here). Every
 * function is written and type-checked against the real, documented
 * schema so a future Preview-connected session can call it verbatim.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { RecognizedRequirement } from '@/lib/pedagogical-engine';
import type { RequirementRecognition } from './types';

interface RecognitionRow {
  id: string;
  student_id: string;
  concept_id: string;
  requirement: string;
  recognition_basis: string;
  legacy_policy_version: string;
  source_evidence_ids: string[];
  reason_code: string;
  recognized_at: string;
  migration_version: string;
}

function rowToEngineRecognizedRequirement(row: RecognitionRow): RecognizedRequirement {
  return {
    requirement: row.requirement as RecognizedRequirement['requirement'],
    basis: row.recognition_basis as RecognizedRequirement['basis'],
    recognitionId: row.id,
    reasonCode: row.reason_code,
    recognizedAt: new Date(row.recognized_at).toISOString(),
  };
}

/**
 * CANON-R4R1 Part 17 -- read adapter: loads persisted recognitions for
 * ONE (studentId, conceptId, migrationVersion) and maps them directly
 * into the frozen engine's own `RecognizedRequirement[]` input shape.
 * Read-only (a single SELECT). Never called by any test in this
 * repository.
 */
export async function loadRecognizedRequirementsForEngine(
  studentId: string,
  conceptId: string,
  migrationVersion: string,
  client: DbExecutor = db,
): Promise<RecognizedRequirement[]> {
  const result = await client.query(
    `SELECT id, student_id, concept_id, requirement, recognition_basis, legacy_policy_version,
            source_evidence_ids, reason_code, recognized_at, migration_version
     FROM pedagogical_requirement_recognition
     WHERE student_id = $1 AND concept_id = $2 AND migration_version = $3
     ORDER BY requirement`,
    [studentId, conceptId, migrationVersion],
  );
  return result.rows.map(rowToEngineRecognizedRequirement);
}

export interface ApplyRecognitionsResult {
  inserted: number;
  alreadyExisted: number;
}

/**
 * CANON-R4R1 Part 19/20 -- the ONE write path, and the only place in
 * this entire compatibility layer that ever writes anything. Guarded,
 * transactional, idempotent:
 *   - `guard.environment !== 'preview'` refuses outright (Part 19:
 *     "refuse Production" -- the caller must explicitly assert Preview;
 *     this function never inspects `DATABASE_URL` or any other
 *     environment signal itself, since guessing "is this Preview" from
 *     a connection string is exactly the kind of implicit inference
 *     this phase's own Part 4/5 pattern forbids -- the caller must know
 *     and assert it).
 *   - every insert uses the row's own deterministic `id`
 *     (`RequirementRecognition.id`, see `legacy-recognition.ts`) with
 *     `ON CONFLICT (student_id, concept_id, requirement, migration_version)
 *     DO NOTHING` -- running this twice against the same recognitions
 *     inserts nothing the second time (Part 32).
 *   - wrapped in one transaction -- see `runInTransaction` at the call
 *     site (this function accepts a `DbExecutor`, typically a checked-out
 *     transactional client).
 *   - never touches `learning_evidence` or any other table.
 *
 * NEVER executed in this environment. NEVER called from `--dry-run` mode
 * (the CLI only calls this when `--apply` is explicitly passed).
 */
export async function applyRecognitions(
  recognitions: RequirementRecognition[],
  studentId: string,
  conceptId: string,
  migrationVersion: string,
  cutoverAt: string,
  guard: { environment: 'preview' },
  client: DbExecutor = db,
): Promise<ApplyRecognitionsResult> {
  if (guard.environment !== 'preview') {
    throw new Error('applyRecognitions refuses to run outside Preview -- guard.environment must be "preview".');
  }

  let inserted = 0;
  let alreadyExisted = 0;
  for (const r of recognitions) {
    const result = await client.query(
      `INSERT INTO pedagogical_requirement_recognition (
         id, student_id, concept_id, requirement, recognition_basis, legacy_policy_version,
         source_evidence_ids, reason_code, recognized_at, migration_version, cutover_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (student_id, concept_id, requirement, migration_version) DO NOTHING
       RETURNING id`,
      [
        r.id,
        studentId,
        conceptId,
        r.requirement,
        r.basis,
        r.legacyPolicyVersion,
        r.sourceEvidenceIds,
        r.reasonCode,
        r.recognizedAtMigration,
        migrationVersion,
        cutoverAt,
      ],
    );
    if (result.rows.length > 0) inserted++;
    else alreadyExisted++;
  }
  return { inserted, alreadyExisted };
}
