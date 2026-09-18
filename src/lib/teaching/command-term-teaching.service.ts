/**
 * F8 -- command_term_interpretations CRUD (task §16). Additive to
 * F7's command_terms, never a replacement. A command term's meaning is
 * never assumed identical across frameworks: the programme-specific
 * ACTIVE row is preferred, falling back to the academic_programme_id
 * IS NULL default row, and returning null (never an invented
 * interpretation) if neither exists.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { CommandTermInterpretation } from './types';

function toInterpretation(row: {
  id: string;
  command_term_id: string;
  academic_programme_id: string | null;
  expected_structure: string;
  rubric_notes: string | null;
  common_failure_patterns: unknown[];
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
}): CommandTermInterpretation {
  return {
    id: row.id,
    commandTermId: row.command_term_id,
    academicProgrammeId: row.academic_programme_id,
    expectedStructure: row.expected_structure,
    rubricNotes: row.rubric_notes,
    commonFailurePatterns: row.common_failure_patterns ?? [],
    status: row.status,
  };
}

export async function resolveCommandTermInterpretation(
  commandTermId: string,
  academicProgrammeId: string | null,
  client: DbExecutor = db
): Promise<CommandTermInterpretation | null> {
  if (academicProgrammeId) {
    const scoped = await client.query(
      `SELECT * FROM command_term_interpretations WHERE command_term_id = $1 AND academic_programme_id = $2 AND status = 'ACTIVE' LIMIT 1`,
      [commandTermId, academicProgrammeId]
    );
    if (scoped.rows.length > 0) return toInterpretation(scoped.rows[0]);
  }
  const fallback = await client.query(
    `SELECT * FROM command_term_interpretations WHERE command_term_id = $1 AND academic_programme_id IS NULL AND status = 'ACTIVE' LIMIT 1`,
    [commandTermId]
  );
  if (fallback.rows.length === 0) return null;
  return toInterpretation(fallback.rows[0]);
}

export async function createCommandTermInterpretation(params: {
  commandTermId: string;
  academicProgrammeId?: string | null;
  expectedStructure: string;
  rubricNotes?: string | null;
  commonFailurePatterns?: unknown[];
}): Promise<CommandTermInterpretation> {
  const result = await db.query(
    `
    INSERT INTO command_term_interpretations (command_term_id, academic_programme_id, expected_structure, rubric_notes, common_failure_patterns, status)
    VALUES ($1, $2, $3, $4, $5, 'DRAFT')
    RETURNING *
    `,
    [
      params.commandTermId,
      params.academicProgrammeId ?? null,
      params.expectedStructure,
      params.rubricNotes ?? null,
      JSON.stringify(params.commonFailurePatterns ?? []),
    ]
  );
  return toInterpretation(result.rows[0]);
}

/** Publishes a DRAFT interpretation to ACTIVE, atomically retiring whatever was previously ACTIVE for the same (command_term_id, academic_programme_id) pair -- same retire-and-insert discipline as every prior phase's own versioned reference data. */
export async function activateCommandTermInterpretation(id: string): Promise<CommandTermInterpretation> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT command_term_id, academic_programme_id, status FROM command_term_interpretations WHERE id = $1`, [id]);
    if (current.rows.length === 0) throw new Error(`command_term_interpretation ${id} not found`);
    if (current.rows[0].status !== 'DRAFT') throw new Error(`only a DRAFT interpretation may be activated (current: ${current.rows[0].status})`);
    const { command_term_id: commandTermId, academic_programme_id: academicProgrammeId } = current.rows[0];

    if (academicProgrammeId) {
      await client.query(
        `UPDATE command_term_interpretations SET status = 'RETIRED', updated_at = now() WHERE command_term_id = $1 AND academic_programme_id = $2 AND status = 'ACTIVE'`,
        [commandTermId, academicProgrammeId]
      );
    } else {
      await client.query(
        `UPDATE command_term_interpretations SET status = 'RETIRED', updated_at = now() WHERE command_term_id = $1 AND academic_programme_id IS NULL AND status = 'ACTIVE'`,
        [commandTermId]
      );
    }

    const updated = await client.query(`UPDATE command_term_interpretations SET status = 'ACTIVE', updated_at = now() WHERE id = $1 RETURNING *`, [id]);
    await client.query('COMMIT');
    return toInterpretation(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
