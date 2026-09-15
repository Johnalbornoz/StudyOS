/**
 * CANON-R3 -- Pedagogical Engine Shadow Comparison CLI.
 *
 * READ-ONLY. Dry-run only -- there is no `--write`/`--apply` mode in
 * this phase (CANON-R3 Part 24: "Do not add an 'apply' mode"). Every
 * query below is a plain SELECT; nothing this script imports can write
 * to learning_evidence, knowledge state, journey state, or any other
 * table (verified by tests/unit/canon-r3-shadow-integration.test.ts's
 * own safety source audits).
 *
 * NOT EXECUTED in this environment (no .env.local / DATABASE_URL / live
 * DB access here -- see docs/CANON_R3_SHADOW_INTEGRATION.md's STATUS
 * and COMMANDS FOR PREVIEW sections). Documented and type-checked so a
 * future Preview-connected session can run it verbatim:
 *
 *   npx tsx --env-file=.env.local scripts/canon-r3-shadow-compare.ts \
 *     --student <uuid> --concept <uuid>
 *
 *   npx tsx --env-file=.env.local scripts/canon-r3-shadow-compare.ts \
 *     --student <uuid> --all-concepts
 *
 *   npx tsx --env-file=.env.local scripts/canon-r3-shadow-compare.ts \
 *     --sample 25
 *
 * Prints ONLY safe structural output: ids, stages, actions, counts,
 * reason codes -- never learner answer text, question text, or names.
 */
import { db } from '@/lib/db';
import { getMisconceptionCountsForConcept } from '@/services/misconception.service';
import {
  mapStudyUSEvidenceToPedagogicalEvidence,
  fetchOldCanonicalSnapshot,
  buildNewCanonicalSnapshot,
  compareCanonicalDecisions,
  buildShadowComparisonRecord,
  type StudyUSEvidenceRow,
} from '@/lib/pedagogical-shadow';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Read-only. One SELECT against `learning_evidence`, LEFT JOINed
 * against `decision_events` for the ONE place a real, historical item
 * count (`reason_details->>'sampleSize'`) is actually persisted (see
 * src/services/mastery.service.ts's own `recordDecisionEvent` call --
 * `learning_evidence` itself has no item-count column). Never writes.
 */
async function loadEvidenceRows(studentId: string, conceptId: string): Promise<StudyUSEvidenceRow[]> {
  const result = await db.query(
    `
    SELECT
      le.id,
      le.source_type,
      le.result,
      le.score_percent,
      le.difficulty,
      le.timestamp,
      le.hints_used,
      le.ai_assistance_type,
      le.metadata->>'activityType' AS activity_type,
      de.reason_details->>'sampleSize' AS sample_size
    FROM learning_evidence le
    LEFT JOIN decision_events de
      ON de.source_event_type = 'learning_evidence'
      AND de.source_event_id = le.id
      AND de.decision_type = 'MASTERY_UPDATED'
    WHERE le.student_id = $1 AND le.concept_id = $2
    ORDER BY le.timestamp ASC
    `,
    [studentId, conceptId],
  );
  return result.rows.map(
    (row: any): StudyUSEvidenceRow => ({
      id: row.id,
      sourceType: row.source_type,
      result: row.result,
      scorePercent: row.score_percent !== null ? Number(row.score_percent) : null,
      difficulty: Number(row.difficulty),
      timestamp: new Date(row.timestamp).toISOString(),
      hintsUsed: row.hints_used ?? 0,
      aiAssistanceType: row.ai_assistance_type ?? 'NONE',
      activityType: row.activity_type ?? null,
      itemCount: row.sample_size != null ? Number(row.sample_size) : undefined,
    }),
  );
}

async function compareOneConceptForStudent(studentId: string, conceptId: string, subjectId: string, now: string) {
  const rows = await loadEvidenceRows(studentId, conceptId);
  const adapterResult = mapStudyUSEvidenceToPedagogicalEvidence(rows);

  const misconceptionCounts = await getMisconceptionCountsForConcept(studentId, conceptId);
  const activeCriticalMisconception = misconceptionCounts.criticalCount > 0;

  const [oldSnapshot, newSnapshot] = await Promise.all([
    fetchOldCanonicalSnapshot(studentId, conceptId, subjectId),
    Promise.resolve(
      buildNewCanonicalSnapshot({ conceptId, studentId, evidence: adapterResult.items, activeCriticalMisconception, now }),
    ),
  ]);

  const comparison = compareCanonicalDecisions(oldSnapshot, newSnapshot, {
    unresolved: adapterResult.unresolved,
    confidence: adapterResult.confidence,
  });

  return buildShadowComparisonRecord({ conceptId, adapterResult, oldSnapshot, newSnapshot, comparison });
}

async function main() {
  const studentId = arg('--student');
  const conceptId = arg('--concept');
  const allConcepts = process.argv.includes('--all-concepts');
  const sampleSize = arg('--sample');
  const now = new Date().toISOString();

  console.log('\n=== CANON-R3 Pedagogical Engine Shadow Comparison [READ-ONLY / DRY-RUN] ===');

  if (studentId && conceptId) {
    const conceptRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [conceptId]);
    const subjectId = conceptRow.rows[0]?.subject_id;
    if (!subjectId) {
      console.log(`  concept ${conceptId} not found.`);
      return;
    }
    const record = await compareOneConceptForStudent(studentId, conceptId, subjectId, now);
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (studentId && allConcepts) {
    const concepts = await db.query(
      `SELECT DISTINCT le.concept_id, c.subject_id FROM learning_evidence le JOIN concepts c ON c.id = le.concept_id WHERE le.student_id = $1`,
      [studentId],
    );
    const records = [];
    for (const row of concepts.rows) {
      records.push(await compareOneConceptForStudent(studentId, row.concept_id, row.subject_id, now));
    }
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (sampleSize) {
    const n = Number(sampleSize);
    const sample = await db.query(
      `SELECT DISTINCT le.student_id, le.concept_id, c.subject_id
       FROM learning_evidence le JOIN concepts c ON c.id = le.concept_id
       ORDER BY random() LIMIT $1`,
      [n],
    );
    const records = [];
    for (const row of sample.rows) {
      records.push(await compareOneConceptForStudent(row.student_id, row.concept_id, row.subject_id, now));
    }
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  console.log('Usage: --student <uuid> --concept <uuid>  |  --student <uuid> --all-concepts  |  --sample <N>');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
