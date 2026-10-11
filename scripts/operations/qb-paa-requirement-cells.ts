/**
 * QB-R2B -- prints the resolved PAA requirement cells (865 unique items), for planning.
 *   npx tsx scripts/operations/qb-paa-requirement-cells.ts                 summary; reads nothing but the repository
 *   npx tsx scripts/operations/qb-paa-requirement-cells.ts --cells         every cell (JSON), unbound
 *   npx tsx --env-file=.env.local scripts/operations/qb-paa-requirement-cells.ts --bind [--cells]
 *                                                                          attaches the row ids of DEV, READ-ONLY
 * --bind opens a session that refuses writes and only selects structure nodes, concepts and the exam version.
 * It runs on DEV (fingerprint guard) or an ephemeral local database. This script never writes a database.
 */
import { createHash } from 'crypto';
import { Client } from 'pg';
import { bindPaaCells, paaCellSetViolations, PAA_CELL_POLICY, PAA_EXAM_CONFIG_KEY, resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';

const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';

async function main() {
  let cells = resolvePaaRequirementCells();
  const violations = paaCellSetViolations(cells);
  let binding: Record<string, unknown> | null = null;
  if (process.argv.includes('--bind')) {
    const raw = process.env.DATABASE_URL ?? '';
    const url = new URL(raw);
    const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
    if (fp !== DEV_DB_FINGERPRINT && url.hostname !== '127.0.0.1') throw new Error(`Refusing: DB fingerprint ${fp} is neither DEV nor an ephemeral local database`);
    const client = new Client({ connectionString: raw.replace('-pooler', ''), options: '-c default_transaction_read_only=on' });
    await client.connect();
    try {
      const version = (await client.query(`SELECT ev.id FROM exam_versions ev JOIN exam_definitions ed ON ed.id = ev.exam_definition_id WHERE ed.config_key = $1 AND ev.status = 'PUBLISHED'`, [PAA_EXAM_CONFIG_KEY])).rows;
      if (version.length !== 1) throw new Error(`expected one published version of ${PAA_EXAM_CONFIG_KEY}, found ${version.length}`);
      const topics = (await client.query(`SELECT t.code, t.id, t.parent_id FROM structure_nodes t JOIN structure_versions sv ON sv.id = t.structure_version_id WHERE sv.source_locator = $1 AND t.node_type = 'TOPIC' AND t.status = 'ACTIVE' AND t.code LIKE 'paa.topic.%'`, [`exam-vertical-config:${PAA_EXAM_CONFIG_KEY}`])).rows;
      const concepts = (await client.query(`SELECT cs.name AS subject, cc.name, cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cc.status = 'ACTIVE'`)).rows;
      const r = bindPaaCells(cells, { environmentFingerprint: fp, examVersionId: version[0].id, topics: new Map(topics.map((t: any) => [t.code, { topicNodeId: t.id, domainNodeId: t.parent_id }])), concepts: new Map(concepts.map((c: any) => [`${c.subject}|${c.name}`, c.id])) });
      binding = { environmentFingerprint: fp, bound: r.bound.length, unresolved: r.unresolved };
      if (r.unresolved.length === 0) cells = r.bound;
    } finally {
      await client.end();
    }
  }
  const sum = (f: (c: (typeof cells)[number]) => string) => cells.reduce<Record<string, number>>((m, c) => ((m[f(c)] = (m[f(c)] ?? 0) + c.count), m), {});
  const summary = { policy: PAA_CELL_POLICY, cells: cells.length, items: cells.reduce((n, c) => n + c.count, 0), byPool: sum((c) => c.intendedPool), bySection: sum((c) => c.sectionCode), byStimulusClass: sum((c) => c.stimulus.class), byFormat: sum((c) => c.responseFormat), byBand: sum((c) => c.difficultyBand), byCurrentness: sum((c) => c.curriculumCurrentness), bySubject: sum((c) => c.primaryConcept.canonicalSubject), topicsUsed: new Set(cells.map((c) => c.topicNodeCode)).size, conceptsUsed: new Set(cells.map((c) => c.primaryConcept.stableId)).size, violations, binding };
  console.log(JSON.stringify(process.argv.includes('--cells') ? { summary, cells } : summary, null, 2));
  if (violations.length || (binding && (binding.unresolved as unknown[]).length)) process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
