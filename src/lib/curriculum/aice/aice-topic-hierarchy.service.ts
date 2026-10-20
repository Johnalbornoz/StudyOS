/**
 * Curriculum convergence -- materialises the Cambridge AS & A Level syllabus Topic layer (aice-topic-hierarchy.ts)
 * as ordinary `structure_nodes`, through the Curriculum Authority's `createStructureNode`.
 *
 * Idempotent: a node is looked up by (structure version, code) and created only when absent. A node with the
 * code that is something else is never adopted or rewritten (NODE_CONFLICT). A syllabus + level whose
 * structure version is not in this database is skipped and reported; nothing is created for it.
 * Paper nodes, objectives and mappings are not touched.
 */
import type { DbExecutor } from '@/lib/db';
import { createStructureNode } from '../structure.service';
import { AICE_TOPIC_NODE_TYPE, AICE_TOPIC_SOURCE, aiceTopicStructures, type AiceTopicStructure } from './aice-topic-hierarchy';

export interface AiceTopicLedger {
  structures: Array<{ syllabusCode: string; level: string; structureVersionId: string | null; topicsBefore: number; topicsAfter: number; created: number; existing: number }>;
  created: number;
  existing: number;
  problems: string[];
}

async function versionOf(client: DbExecutor, s: AiceTopicStructure): Promise<string | null | 'AMBIGUOUS'> {
  const r = await client.query(`SELECT id FROM structure_versions WHERE source_locator = $1 AND status = 'PUBLISHED'`, [s.structureSourceLocator]);
  return r.rows.length === 1 ? (r.rows[0].id as string) : r.rows.length === 0 ? null : 'AMBIGUOUS';
}

const topicCount = async (client: DbExecutor, versionId: string) =>
  Number((await client.query(`SELECT count(*)::int AS n FROM structure_nodes WHERE structure_version_id = $1 AND node_type = $2 AND status = 'ACTIVE'`, [versionId, AICE_TOPIC_NODE_TYPE])).rows[0].n);

export async function applyAiceTopicHierarchy(client: DbExecutor): Promise<AiceTopicLedger> {
  const ledger: AiceTopicLedger = { structures: [], created: 0, existing: 0, problems: [] };
  for (const s of aiceTopicStructures()) {
    const versionId = await versionOf(client, s);
    if (versionId === 'AMBIGUOUS') {
      ledger.problems.push(`AMBIGUOUS_STRUCTURE_VERSION ${s.structureSourceLocator}`);
      continue;
    }
    if (!versionId) {
      ledger.structures.push({ syllabusCode: s.syllabusCode, level: s.level, structureVersionId: null, topicsBefore: 0, topicsAfter: 0, created: 0, existing: 0 });
      continue;
    }
    const topicsBefore = await topicCount(client, versionId);
    let created = 0;
    let existing = 0;
    for (const t of s.topics) {
      const found = await client.query(`SELECT id, node_type, parent_id, source_label FROM structure_nodes WHERE structure_version_id = $1 AND code = $2`, [versionId, t.code]);
      if (found.rows.length === 1) {
        const row = found.rows[0];
        if (row.node_type !== AICE_TOPIC_NODE_TYPE || row.parent_id !== null || row.source_label !== t.label) ledger.problems.push(`NODE_CONFLICT ${s.structureSourceLocator} ${t.code}`);
        else existing += 1;
        continue;
      }
      if (found.rows.length > 1) {
        ledger.problems.push(`NODE_CONFLICT ${s.structureSourceLocator} ${t.code} exists ${found.rows.length} times`);
        continue;
      }
      await createStructureNode({ structureVersionId: versionId, nodeType: AICE_TOPIC_NODE_TYPE, sourceLabel: t.label, code: t.code, orderIndex: t.orderIndex, source: AICE_TOPIC_SOURCE, sourceLocator: t.sourceLocator }, client);
      created += 1;
    }
    ledger.structures.push({ syllabusCode: s.syllabusCode, level: s.level, structureVersionId: versionId, topicsBefore, topicsAfter: await topicCount(client, versionId), created, existing });
    ledger.created += created;
    ledger.existing += existing;
  }
  return ledger;
}

/** Read-only: is the materialised Topic layer exactly the governed one (for the structures this database has)? */
export async function readAiceTopicHierarchy(client: DbExecutor): Promise<{ structures: number; topics: number; problems: string[] }> {
  const problems: string[] = [];
  let structures = 0;
  let topics = 0;
  for (const s of aiceTopicStructures()) {
    const versionId = await versionOf(client, s);
    if (!versionId || versionId === 'AMBIGUOUS') continue;
    structures += 1;
    const rows = (await client.query(`SELECT code, source_label, parent_id, status FROM structure_nodes WHERE structure_version_id = $1 AND node_type = $2`, [versionId, AICE_TOPIC_NODE_TYPE])).rows as Array<{ code: string | null; source_label: string; parent_id: string | null; status: string }>;
    const byCode = new Map(rows.map((r) => [r.code ?? '', r]));
    for (const t of s.topics) {
      const n = byCode.get(t.code);
      if (!n) problems.push(`MISSING ${s.structureSourceLocator} ${t.code}`);
      else if (n.source_label !== t.label || n.parent_id !== null || n.status !== 'ACTIVE') problems.push(`DIFFERENT ${s.structureSourceLocator} ${t.code}`);
    }
    const governed = new Set(s.topics.map((t) => t.code));
    for (const r of rows) if (!governed.has(r.code ?? '')) problems.push(`UNGOVERNED_TOPIC ${s.structureSourceLocator} ${r.code ?? r.source_label}`);
    topics += rows.length;
  }
  return { structures, topics, problems };
}
