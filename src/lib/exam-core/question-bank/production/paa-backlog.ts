/**
 * QB-R2A -- the PAA production backlog: the certified demand as planning rows (pure, no IO).
 *
 * A backlog row says how many items a pool needs for one slice of the hierarchy. It becomes Requirement Cells
 * when production picks a Topic (and, for a mock row, a concept) for each item -- a decision made then, with the
 * canonical ids resolved then. Nothing here reads or writes the Question Bank.
 *
 * Pilot pool policy: ZERO_INTENTIONAL_OVERLAP. Every row belongs to one pool and the totals are of UNIQUE items:
 * no row is satisfied by an item counted for another row.
 */
import { PAA_DOMAINS, PAA_SECTIONS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { PRODUCTION_POOLS, PRODUCTION_POOL_POLICY, type ProductionPool, type RequirementCell } from './requirement-cell';
import { PAA_CONCEPT_DEMAND, PAA_MOCK_DEMAND } from './paa-backlog-data';

export const PAA_BACKLOG_TOTAL = 865 as const;
export const PAA_BACKLOG_POLICY = { poolPolicyId: PRODUCTION_POOL_POLICY.id, poolPolicyVersion: PRODUCTION_POOL_POLICY.version, overlap: PRODUCTION_POOL_POLICY.overlap, perConcept: { PRACTICE: 3, DIAGNOSTIC: 2, VERIFICATION: 2 }, difficultyMix: { FOUNDATIONAL: 30, STANDARD: 50, CHALLENGE: 20 } } as const;

export interface PaaBacklogRow {
  /** Stable within the backlog; unique. */
  rowKey: string;
  pool: ProductionPool;
  sectionCode: string;
  domainCode: string;
  /** Certified Topics an item of this row may be written for. */
  candidateTopicCodes: string[];
  /** The certified concept the row is for. null on a mock row: the concept is chosen among the Domain's when the cell is made. */
  conceptStableId: string | null;
  responseFormat: 'MULTIPLE_CHOICE' | 'STUDENT_PRODUCED' | null;
  /** null on a per-concept row: the pool follows the difficulty-mix policy as a whole. */
  difficultyBand: 'FOUNDATIONAL' | 'STANDARD' | 'CHALLENGE' | null;
  count: number;
  /** Who requires the count. A mock's section total is official; its split by Domain and band is StudyUs policy. */
  countAuthority: 'STUDYUS_POLICY' | 'OFFICIAL_SECTION_TOTAL__STUDYUS_DOMAIN_SPLIT';
  blueprint: { purpose: 'FULL' | 'REDUCED'; formNumber: number } | null;
}

const topicsOfDomain = (domainCode: string): string[] => PAA_TOPICS.filter((t) => t.domainCode === domainCode).map((t) => t.code);
const topicsOfConcept = (stableId: string): string[] => PAA_TOPICS.filter((t) => t.certifiedConceptId === stableId).map((t) => t.code);
const BLUEPRINT_OF_POOL: Partial<Record<ProductionPool, { purpose: 'FULL' | 'REDUCED'; formNumber: number }>> = { FULL_MOCK_1: { purpose: 'FULL', formNumber: 1 }, FULL_MOCK_2: { purpose: 'FULL', formNumber: 2 }, REDUCED_MOCK: { purpose: 'REDUCED', formNumber: 1 } };

/** The whole backlog, in a stable order. Built from the certified data every time: there is no stored copy to drift. */
export function buildPaaBacklog(): PaaBacklogRow[] {
  const rows: PaaBacklogRow[] = [];
  for (const c of PAA_CONCEPT_DEMAND) {
    for (const [pool, count] of [['PRACTICE', c.practice], ['DIAGNOSTIC', c.diagnostic], ['VERIFICATION', c.verification]] as Array<[ProductionPool, number]>) {
      rows.push({ rowKey: `${pool}:${c.conceptStableId}`, pool, sectionCode: c.sectionCode, domainCode: c.domainCode, candidateTopicCodes: topicsOfConcept(c.conceptStableId), conceptStableId: c.conceptStableId, responseFormat: null, difficultyBand: null, count, countAuthority: 'STUDYUS_POLICY', blueprint: null });
    }
  }
  for (const m of PAA_MOCK_DEMAND) {
    rows.push({ rowKey: `${m.pool}:${m.domainCode}:${m.responseFormat}:${m.difficultyBand}`, pool: m.pool, sectionCode: m.sectionCode, domainCode: m.domainCode, candidateTopicCodes: topicsOfDomain(m.domainCode), conceptStableId: null, responseFormat: m.responseFormat, difficultyBand: m.difficultyBand, count: m.count, countAuthority: 'OFFICIAL_SECTION_TOTAL__STUDYUS_DOMAIN_SPLIT', blueprint: BLUEPRINT_OF_POOL[m.pool]! });
  }
  return rows;
}

export interface PaaBacklogSummary {
  total: number;
  byPool: Record<ProductionPool, number>;
  bySection: Record<string, number>;
  byPoolAndSection: Record<string, number>;
  concepts: number;
  domains: number;
}

export function summarizePaaBacklog(rows: readonly PaaBacklogRow[] = buildPaaBacklog()): PaaBacklogSummary {
  const byPool = Object.fromEntries(PRODUCTION_POOLS.map((p) => [p, 0])) as Record<ProductionPool, number>;
  const bySection: Record<string, number> = {};
  const byPoolAndSection: Record<string, number> = {};
  for (const r of rows) {
    byPool[r.pool] += r.count;
    bySection[r.sectionCode] = (bySection[r.sectionCode] ?? 0) + r.count;
    byPoolAndSection[`${r.pool}:${r.sectionCode}`] = (byPoolAndSection[`${r.pool}:${r.sectionCode}`] ?? 0) + r.count;
  }
  return { total: rows.reduce((n, r) => n + r.count, 0), byPool, bySection, byPoolAndSection, concepts: new Set(rows.map((r) => r.conceptStableId).filter(Boolean)).size, domains: new Set(rows.map((r) => r.domainCode)).size };
}

export type BacklogViolation = 'TOTAL_IS_NOT_865' | 'DUPLICATE_ROW' | 'ROW_WITHOUT_TOPIC' | 'UNKNOWN_DOMAIN' | 'ROW_IN_NO_POOL' | 'MOCK_ROW_WITHOUT_BLUEPRINT' | 'NON_POSITIVE_COUNT';

/** Structural checks of the plan. Zero intentional overlap = each row is in exactly one pool and row keys are unique. */
export function paaBacklogViolations(rows: readonly PaaBacklogRow[] = buildPaaBacklog()): BacklogViolation[] {
  const out = new Set<BacklogViolation>();
  if (rows.reduce((n, r) => n + r.count, 0) !== PAA_BACKLOG_TOTAL) out.add('TOTAL_IS_NOT_865');
  if (new Set(rows.map((r) => r.rowKey)).size !== rows.length) out.add('DUPLICATE_ROW');
  for (const r of rows) {
    if (r.candidateTopicCodes.length === 0) out.add('ROW_WITHOUT_TOPIC');
    if (!PAA_DOMAINS.some((d) => d.code === r.domainCode && d.sectionCode === r.sectionCode)) out.add('UNKNOWN_DOMAIN');
    if (!(PRODUCTION_POOLS as readonly string[]).includes(r.pool)) out.add('ROW_IN_NO_POOL');
    if (['REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2'].includes(r.pool) !== (r.blueprint !== null)) out.add('MOCK_ROW_WITHOUT_BLUEPRINT');
    if (!(r.count > 0)) out.add('NON_POSITIVE_COUNT');
  }
  return [...out];
}

/** The exam family this planning module is for. */
export const PAA_EXAM_FAMILY = 'PAA' as const;

export type PaaCellViolation = 'NOT_A_PAA_CELL' | 'UNKNOWN_SECTION' | 'UNKNOWN_DOMAIN' | 'UNKNOWN_TOPIC' | 'DOMAIN_NOT_IN_SECTION' | 'TOPIC_NOT_IN_DOMAIN';

/** Does a PAA cell sit in the certified hierarchy (4 Sections / 17 Domains / 84 Topics)? Checked by code, never by label. */
export function paaCellViolations(cell: Pick<RequirementCell, 'examFamily' | 'sectionCode' | 'domainNodeCode' | 'topicNodeCode'>): PaaCellViolation[] {
  if (cell.examFamily !== PAA_EXAM_FAMILY) return ['NOT_A_PAA_CELL'];
  const out: PaaCellViolation[] = [];
  const section = PAA_SECTIONS.find((s) => s.code === cell.sectionCode);
  const domain = PAA_DOMAINS.find((d) => d.code === cell.domainNodeCode);
  const topic = PAA_TOPICS.find((t) => t.code === cell.topicNodeCode);
  if (!section) out.push('UNKNOWN_SECTION');
  if (!domain) out.push('UNKNOWN_DOMAIN');
  if (!topic) out.push('UNKNOWN_TOPIC');
  if (section && domain && domain.sectionCode !== section.code) out.push('DOMAIN_NOT_IN_SECTION');
  if (domain && topic && topic.domainCode !== domain.code) out.push('TOPIC_NOT_IN_DOMAIN');
  return out;
}
