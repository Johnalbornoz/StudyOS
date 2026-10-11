/**
 * CURR-PAA -- materialises the certified PAA hierarchy through the Curriculum Authority's own services.
 *
 *   structure version (one per PAA section, already published by the exam configuration)
 *     -> SECTION node -> DOMAIN nodes -> TOPIC nodes
 *
 * Nothing PAA-specific is stored anywhere else: the hierarchy is ordinary `structure_nodes` content. The
 * bootstrap `EXAM_SECTION` node of each version, and the objectives hanging from it, are left as they are --
 * they are the historical record every existing item, blueprint target and attempt points at.
 *
 * Idempotent: a node is looked up by (structure version, code) and created only when absent, through
 * `createStructureNode`. Every call takes the caller's executor, so the caller's transaction governs the write.
 *
 * Objective placement is a separate, explicit step (`reparentObjectives`): it moves the nineteen historical
 * objectives that belong to exactly one official Domain under that Domain's node, by id, through
 * `reparentLearningObjective`. `paa.red.cohesion` has no official Domain and is never moved.
 */
import type { DbExecutor } from '@/lib/db';
import { createStructureNode } from '../structure.service';
import { reparentLearningObjective } from '../objective.service';
import { PAA_DOMAINS, PAA_HIERARCHY_CONFIG_KEY, PAA_HIERARCHY_SOURCE, PAA_NODE_TYPES, PAA_OBJECTIVES_WITHOUT_DOMAIN, PAA_SECTIONS, PAA_TOPICS } from './paa-hierarchy';

export class PaaHierarchyError extends Error {
  constructor(public readonly code: 'STRUCTURE_VERSIONS_NOT_FOUND' | 'NODE_CONFLICT' | 'OBJECTIVE_NOT_FOUND', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'PaaHierarchyError';
  }
}

export interface PaaHierarchyLedger {
  structureVersions: Record<string, string>;
  created: { sections: number; domains: number; topics: number };
  existing: { sections: number; domains: number; topics: number };
  objectives: Array<{ code: string; objectiveId: string; domainCode: string | null; placement: 'UNDER_DOMAIN' | 'UNDER_BOOTSTRAP_SECTION' | 'MOVED_TO_DOMAIN' | 'NO_OFFICIAL_DOMAIN' }>;
}

/** The structure version of each PAA section: the one the exam configuration published, found by its bootstrap section node. */
async function sectionVersions(client: DbExecutor): Promise<Map<string, string>> {
  const r = await client.query(
    `SELECT n.code, sv.id FROM structure_versions sv JOIN structure_nodes n ON n.structure_version_id = sv.id
      WHERE sv.source_locator = $1 AND n.node_type = 'EXAM_SECTION' AND n.code = ANY($2::text[])`,
    [`exam-vertical-config:${PAA_HIERARCHY_CONFIG_KEY}`, PAA_SECTIONS.map((s) => s.bootstrapSectionCode)]
  );
  const out = new Map<string, string>(r.rows.map((x: any) => [x.code as string, x.id as string]));
  if (r.rows.length !== PAA_SECTIONS.length || out.size !== PAA_SECTIONS.length) {
    throw new PaaHierarchyError('STRUCTURE_VERSIONS_NOT_FOUND', `expected one structure version per section (${PAA_SECTIONS.length}), found ${r.rows.length}`);
  }
  return out;
}

export async function applyPaaCurriculumHierarchy(client: DbExecutor, options: { reparentObjectives?: boolean } = {}): Promise<PaaHierarchyLedger> {
  const versions = await sectionVersions(client);
  const ledger: PaaHierarchyLedger = { structureVersions: {}, created: { sections: 0, domains: 0, topics: 0 }, existing: { sections: 0, domains: 0, topics: 0 }, objectives: [] };
  const ensureNode = async (kind: keyof PaaHierarchyLedger['created'], p: { structureVersionId: string; parentId: string | null; nodeType: string; code: string; label: string; orderIndex: number; source: string; sourceLocator: string | null }): Promise<string> => {
    const found = await client.query(`SELECT id, parent_id, node_type FROM structure_nodes WHERE structure_version_id = $1 AND code = $2`, [p.structureVersionId, p.code]);
    if (found.rows.length > 1) throw new PaaHierarchyError('NODE_CONFLICT', `${p.code} exists ${found.rows.length} times`);
    if (found.rows.length === 1) {
      const row = found.rows[0];
      // A node with this code that is something else is never adopted or rewritten.
      if (row.node_type !== p.nodeType || (row.parent_id ?? null) !== p.parentId) throw new PaaHierarchyError('NODE_CONFLICT', `${p.code} exists as ${row.node_type} under another parent`);
      ledger.existing[kind] += 1;
      return row.id as string;
    }
    const node = await createStructureNode({ structureVersionId: p.structureVersionId, parentId: p.parentId ?? undefined, nodeType: p.nodeType, sourceLabel: p.label, code: p.code, orderIndex: p.orderIndex, source: p.source, sourceLocator: p.sourceLocator ?? undefined }, client);
    ledger.created[kind] += 1;
    return node.id;
  };

  const sectionNode = new Map<string, { id: string; structureVersionId: string }>();
  for (const [i, s] of PAA_SECTIONS.entries()) {
    const structureVersionId = versions.get(s.bootstrapSectionCode)!;
    ledger.structureVersions[s.code] = structureVersionId;
    const id = await ensureNode('sections', { structureVersionId, parentId: null, nodeType: PAA_NODE_TYPES.section, code: s.code, label: s.label, orderIndex: i, source: PAA_HIERARCHY_SOURCE, sourceLocator: null });
    sectionNode.set(s.code, { id, structureVersionId });
  }
  const domainNode = new Map<string, { id: string; structureVersionId: string }>();
  for (const [i, d] of PAA_DOMAINS.entries()) {
    const parent = sectionNode.get(d.sectionCode)!;
    const id = await ensureNode('domains', { structureVersionId: parent.structureVersionId, parentId: parent.id, nodeType: PAA_NODE_TYPES.domain, code: d.code, label: d.label, orderIndex: i, source: 'OFFICIAL', sourceLocator: null });
    domainNode.set(d.code, { id, structureVersionId: parent.structureVersionId });
  }
  for (const t of PAA_TOPICS) {
    const parent = domainNode.get(t.domainCode)!;
    await ensureNode('topics', { structureVersionId: parent.structureVersionId, parentId: parent.id, nodeType: PAA_NODE_TYPES.topic, code: t.code, label: t.label, orderIndex: t.order, source: t.authority, sourceLocator: t.sourceReference });
  }

  for (const d of PAA_DOMAINS) {
    const node = domainNode.get(d.code)!;
    for (const code of d.objectiveCodes) {
      const o = await client.query(
        `SELECT lo.id, lo.structure_node_id FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id WHERE n.structure_version_id = $1 AND lo.code = $2`,
        [node.structureVersionId, code]
      );
      if (o.rows.length !== 1) throw new PaaHierarchyError('OBJECTIVE_NOT_FOUND', `${code}: expected 1 objective in its section's structure version, found ${o.rows.length}`);
      const row = o.rows[0];
      if (row.structure_node_id === node.id) ledger.objectives.push({ code, objectiveId: row.id, domainCode: d.code, placement: 'UNDER_DOMAIN' });
      else if (options.reparentObjectives) {
        await reparentLearningObjective(row.id, node.id, client);
        ledger.objectives.push({ code, objectiveId: row.id, domainCode: d.code, placement: 'MOVED_TO_DOMAIN' });
      } else ledger.objectives.push({ code, objectiveId: row.id, domainCode: d.code, placement: 'UNDER_BOOTSTRAP_SECTION' });
    }
  }
  const versionIds = [...new Set(versions.values())];
  const without = await client.query(
    `SELECT lo.id, lo.code FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id WHERE n.structure_version_id = ANY($1::uuid[]) AND lo.code = ANY($2::text[])`,
    [versionIds, [...PAA_OBJECTIVES_WITHOUT_DOMAIN]]
  );
  for (const row of without.rows as any[]) ledger.objectives.push({ code: row.code, objectiveId: row.id, domainCode: null, placement: 'NO_OFFICIAL_DOMAIN' });
  return ledger;
}

export interface PaaHierarchyState {
  sections: number;
  domains: number;
  topics: number;
  topicsByAuthority: Record<string, number>;
  /** Structural problems; empty when the hierarchy is exactly the certified one. */
  problems: string[];
}

/** Read-only: what is materialised, compared with the certified hierarchy. */
export async function readPaaCurriculumHierarchy(client: DbExecutor): Promise<PaaHierarchyState> {
  const r = await client.query(
    `SELECT n.code, n.node_type, n.source_label, n.source, n.status, p.code AS parent_code
       FROM structure_nodes n JOIN structure_versions sv ON sv.id = n.structure_version_id LEFT JOIN structure_nodes p ON p.id = n.parent_id
      WHERE sv.source_locator = $1 AND n.node_type = ANY($2::text[])`,
    [`exam-vertical-config:${PAA_HIERARCHY_CONFIG_KEY}`, Object.values(PAA_NODE_TYPES)]
  );
  const rows = r.rows as Array<{ code: string | null; node_type: string; source_label: string; source: string | null; status: string; parent_code: string | null }>;
  const byCode = new Map(rows.map((x) => [x.code ?? '', x]));
  const problems: string[] = [];
  const expect = (code: string, type: string, label: string, parent: string | null) => {
    const n = byCode.get(code);
    if (!n) problems.push(`MISSING ${code}`);
    else if (n.node_type !== type || n.source_label !== label || (n.parent_code ?? null) !== parent || n.status !== 'ACTIVE') problems.push(`DIFFERENT ${code}`);
  };
  for (const s of PAA_SECTIONS) expect(s.code, PAA_NODE_TYPES.section, s.label, null);
  for (const d of PAA_DOMAINS) expect(d.code, PAA_NODE_TYPES.domain, d.label, d.sectionCode);
  for (const t of PAA_TOPICS) expect(t.code, PAA_NODE_TYPES.topic, t.label, t.domainCode);
  const certified = new Set([...PAA_SECTIONS, ...PAA_DOMAINS, ...PAA_TOPICS].map((x) => x.code));
  for (const x of rows) if (!certified.has(x.code ?? '')) problems.push(`UNCERTIFIED ${x.node_type} ${x.code ?? x.source_label}`);
  if (rows.length !== new Set(rows.map((x) => x.code)).size) problems.push('DUPLICATE_CODE');
  const count = (type: string) => rows.filter((x) => x.node_type === type).length;
  const topicsByAuthority: Record<string, number> = {};
  for (const x of rows) if (x.node_type === PAA_NODE_TYPES.topic) topicsByAuthority[x.source ?? 'UNKNOWN'] = (topicsByAuthority[x.source ?? 'UNKNOWN'] ?? 0) + 1;
  return { sections: count(PAA_NODE_TYPES.section), domains: count(PAA_NODE_TYPES.domain), topics: count(PAA_NODE_TYPES.topic), topicsByAuthority, problems };
}
