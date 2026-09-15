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
  fetchStudyUSEvidenceRows,
  buildNewCanonicalSnapshot,
  compareCanonicalDecisions,
  buildShadowComparisonRecord,
} from '@/lib/pedagogical-shadow';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function compareOneConceptForStudent(studentId: string, conceptId: string, subjectId: string, now: string) {
  // CANON-R5 Part 7: relocated (byte-identical query) to
  // `pedagogical-shadow/evidence-fetch.ts` so the canonical decision
  // service can share the exact same one real-evidence fetch -- no
  // second mapping from `learning_evidence` was created.
  const rows = await fetchStudyUSEvidenceRows(studentId, conceptId);
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
