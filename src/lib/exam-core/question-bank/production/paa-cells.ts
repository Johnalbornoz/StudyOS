/**
 * QB-R2B -- the PAA backlog resolved into actionable requirement cells (pure, no IO).
 *
 * `buildPaaBacklog()` says how many items each pool needs per concept or per Domain. This module turns every
 * row into cells that leave nothing open: one Topic, one PRIMARY concept, a count, a format, a difficulty band
 * and a stimulus plan. The cells sum to the same 865 items, pool by pool.
 *
 * TOPIC AND CONCEPT POLICY (`PAA_CELL_POLICY`) -- deterministic, no randomness, no judgement at run time:
 *   1. A per-concept row (Practice / Diagnostic / Verification) already names its concept. Its items are spread
 *      over that concept's certified Topics in code order, one item per Topic in turn. The starting Topic is
 *      shifted by pool, so the three pools of a concept do not all begin on the same Topic.
 *   2. A mock row names a Domain. Its items are spread over the Domain's certified (Topic, concept) pairs in
 *      Topic-code order, one in turn, and the turn carries over from one row of that Domain to the next within a
 *      form -- so a form covers the Domain's Topics as evenly as its count allows instead of repeating the first.
 *      Each form starts at a different Topic of the Domain, so two forms do not concentrate on the same ones.
 *   3. A cell's Domain is the Domain of its Topic. A concept certified under Topics of two Domains (three are)
 *      therefore yields cells in both.
 *   3b. A Topic with no certified concept takes no item (two English Topics): a cell always has a PRIMARY concept.
 *   4. Pools never share a cell: the pool is part of the cell key (zero intentional overlap).
 * FORMAT: per-concept cells are multiple choice (StudyUs policy). Mock cells keep the format of their row, which
 *   follows the reference pattern of the published practice test -- a StudyUs policy, not an official allocation.
 * DIFFICULTY: mock cells keep the band of their row; per-concept cells take Practice F/S/C, Diagnostic S/F,
 *   Verification S/F, as the certified requirement matrix does. Always an editorial estimate.
 * STIMULUS: from the certified catalogue's note on the concept: none -> STANDALONE; "... at times" -> OPTIONAL;
 *   otherwise REQUIRED, with the kind the note names.
 * CURRENTNESS: Matemáticas cells are marked blocked until the PAA cutover (its structure version is a draft).
 */
import { PAA_DOMAINS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { buildPaaBacklog, PAA_EXAM_FAMILY, type PaaBacklogRow } from './paa-backlog';
import { PAA_CONCEPT_DEMAND } from './paa-backlog-data';
import { PAA_CONCEPT_IDENTITIES } from './paa-concept-identity';
import { REQUIREMENT_CELL_VERSION, type ProductionPool, type RequirementCell, type StimulusKind, type StimulusPlan } from './requirement-cell';

export const PAA_CELL_POLICY = { id: 'q1-paa-cell-resolution', version: '1' } as const;
export const PAA_EXAM_CONFIG_KEY = 'v2.paa' as const;
/** The section whose structure version is a draft on DEV; its cells cannot satisfy condition 5 before the cutover. */
export const PAA_SECTION_AWAITING_CUTOVER = 'paa.sec.matematicas' as const;

type Band = RequirementCell['difficultyBand'];
const PER_CONCEPT_BANDS: Record<'PRACTICE' | 'DIAGNOSTIC' | 'VERIFICATION', Band[]> = { PRACTICE: ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'], DIAGNOSTIC: ['STANDARD', 'FOUNDATIONAL'], VERIFICATION: ['STANDARD', 'FOUNDATIONAL'] };
const POOL_SHIFT: Record<ProductionPool, number> = { PRACTICE: 0, DIAGNOSTIC: 1, VERIFICATION: 2, FULL_MOCK_1: 0, FULL_MOCK_2: 1, REDUCED_MOCK: 2 };

const STIMULUS_NOTE_KINDS: Array<[RegExp, StimulusKind]> = [
  [/paired passages/, 'PAIRED_PASSAGE'], [/poem/, 'POEM'], [/numbered text/, 'NUMBERED_TEXT'], [/draft paragraph/, 'DRAFT_PARAGRAPH'], [/passage with table\/graph/, 'COMPOSITE'],
  [/table\/graph/, 'TABLE'], [/data set/, 'DATA_SET'], [/graph|coordinate grid|number line/, 'GRAPH'], [/figure/, 'FIGURE'], [/passage|text/, 'PASSAGE'],
];
/** The catalogue's free-text note on a concept, read into a plan. An unreadable note fails loudly rather than default. */
export function stimulusPlanOf(note: string): StimulusPlan {
  const n = note.trim().toLowerCase();
  if (n === 'none') return { class: 'STANDALONE' };
  const kind = STIMULUS_NOTE_KINDS.find(([re]) => re.test(n))?.[1];
  if (!kind) throw new Error(`STIMULUS_NOTE_UNREADABLE: ${note}`);
  return /at times/.test(n) ? { class: 'STIMULUS_OPTIONAL', kind } : { class: 'STIMULUS_REQUIRED', kind };
}

const identityOf = (stableId: string) => {
  const c = PAA_CONCEPT_IDENTITIES.find((x) => x.stableId === stableId);
  if (!c) throw new Error(`CONCEPT_IDENTITY_MISSING: ${stableId}`);
  return { stableId, canonicalSubject: c.canonicalSubject, canonicalName: c.canonicalName };
};
const noteOf = (stableId: string): string => PAA_CONCEPT_DEMAND.find((c) => c.conceptStableId === stableId)!.stimulusGuidance;
const topicNumber = (code: string): string => code.replace('paa.topic.', '');

/** Every cell, in a stable order. Unbound: `binding` is null until a read-only step attaches an environment's ids. */
export function resolvePaaRequirementCells(rows: readonly PaaBacklogRow[] = buildPaaBacklog()): RequirementCell[] {
  const cells = new Map<string, RequirementCell>();
  const add = (p: { pool: ProductionPool; sectionCode: string; domainCode: string; topicCode: string; stableId: string; format: RequirementCell['responseFormat']; band: Band; blueprint: RequirementCell['blueprint']; policyId: string }) => {
    const cellKey = `${p.pool}|${topicNumber(p.topicCode)}|${p.stableId}|${p.format}|${p.band}`;
    const existing = cells.get(cellKey);
    if (existing) {
      existing.count += 1;
      return;
    }
    cells.set(cellKey, {
      v: REQUIREMENT_CELL_VERSION, cellKey, examFamily: PAA_EXAM_FAMILY, examConfigKey: PAA_EXAM_CONFIG_KEY, sectionCode: p.sectionCode, domainNodeCode: p.domainCode, topicNodeCode: p.topicCode,
      primaryConcept: identityOf(p.stableId), examSkill: null, count: 1, intendedPool: p.pool, responseFormat: p.format, responseFormatAuthority: 'STUDYUS_POLICY', difficultyBand: p.band, difficultyBasis: 'EDITORIAL_ESTIMATE',
      stimulus: stimulusPlanOf(noteOf(p.stableId)), assets: [], authority: { kind: 'STUDYUS_POLICY', policyId: p.policyId, policyVersion: '1' }, blueprint: p.blueprint,
      curriculumCurrentness: p.sectionCode === PAA_SECTION_AWAITING_CUTOVER ? 'CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER' : 'CURRENT', binding: null,
    });
  };
  // where the next item of a (form, Domain) goes: carried across the rows of that Domain
  const cursor = new Map<string, number>();
  for (const row of rows) {
    if (row.conceptStableId) {
      const topics = [...row.candidateTopicCodes].sort();
      const bands = PER_CONCEPT_BANDS[row.pool as 'PRACTICE'];
      for (let i = 0; i < row.count; i += 1) {
        const topicCode = topics[(POOL_SHIFT[row.pool] + i) % topics.length];
        // A concept can be certified under Topics of two Domains: the cell's Domain is its Topic's, always.
        const domainCode = PAA_TOPICS.find((t) => t.code === topicCode)!.domainCode;
        add({ pool: row.pool, sectionCode: row.sectionCode, domainCode, topicCode, stableId: row.conceptStableId, format: 'MULTIPLE_CHOICE', band: bands[i % bands.length], blueprint: null, policyId: 'q1-per-concept-pools' });
      }
      continue;
    }
    const pairs = PAA_TOPICS.filter((t) => t.domainCode === row.domainCode && t.certifiedConceptId).sort((a, b) => (a.code < b.code ? -1 : 1));
    const key = `${row.pool}|${row.domainCode}`;
    let at = cursor.get(key) ?? POOL_SHIFT[row.pool] % pairs.length;
    for (let i = 0; i < row.count; i += 1) {
      const t = pairs[at % pairs.length];
      add({ pool: row.pool, sectionCode: row.sectionCode, domainCode: row.domainCode, topicCode: t.code, stableId: t.certifiedConceptId!, format: row.responseFormat!, band: row.difficultyBand!, blueprint: row.blueprint, policyId: 'q1-mock-domain-split-reference-pattern' });
      at += 1;
    }
    cursor.set(key, at);
  }
  return [...cells.values()].sort((a, b) => (a.cellKey < b.cellKey ? -1 : a.cellKey > b.cellKey ? 1 : 0));
}

export type CellSetViolation = 'TOTAL_IS_NOT_865' | 'POOL_TOTAL_MISMATCH' | 'DUPLICATE_CELL' | 'TOPIC_NOT_IN_DOMAIN' | 'TOPIC_DOES_NOT_CARRY_CONCEPT' | 'CONCEPT_IDENTITY_MISSING' | 'MATH_NOT_MARKED_BLOCKED' | 'MOCK_SECTION_TOTAL_MISMATCH';

/** The cells against the backlog they came from and the certified hierarchy. Empty = the plan is exact. */
export function paaCellSetViolations(cells: readonly RequirementCell[], rows: readonly PaaBacklogRow[] = buildPaaBacklog()): CellSetViolation[] {
  const out = new Set<CellSetViolation>();
  const total = (xs: readonly { count: number }[]) => xs.reduce((n, x) => n + x.count, 0);
  if (total(cells) !== 865) out.add('TOTAL_IS_NOT_865');
  for (const pool of new Set(rows.map((r) => r.pool))) if (total(cells.filter((c) => c.intendedPool === pool)) !== total(rows.filter((r) => r.pool === pool))) out.add('POOL_TOTAL_MISMATCH');
  for (const key of new Set(rows.filter((r) => r.blueprint).map((r) => `${r.pool}|${r.sectionCode}`))) {
    const [pool, section] = key.split('|');
    if (total(cells.filter((c) => c.intendedPool === pool && c.sectionCode === section)) !== total(rows.filter((r) => r.pool === pool && r.sectionCode === section))) out.add('MOCK_SECTION_TOTAL_MISMATCH');
  }
  if (new Set(cells.map((c) => c.cellKey)).size !== cells.length) out.add('DUPLICATE_CELL');
  for (const c of cells) {
    const topic = PAA_TOPICS.find((t) => t.code === c.topicNodeCode);
    const domain = PAA_DOMAINS.find((d) => d.code === c.domainNodeCode);
    if (!topic || !domain || topic.domainCode !== domain.code || domain.sectionCode !== c.sectionCode) out.add('TOPIC_NOT_IN_DOMAIN');
    if (topic && topic.certifiedConceptId !== c.primaryConcept.stableId) out.add('TOPIC_DOES_NOT_CARRY_CONCEPT');
    if (!PAA_CONCEPT_IDENTITIES.some((x) => x.stableId === c.primaryConcept.stableId)) out.add('CONCEPT_IDENTITY_MISSING');
    if ((c.sectionCode === PAA_SECTION_AWAITING_CUTOVER) !== (c.curriculumCurrentness !== 'CURRENT')) out.add('MATH_NOT_MARKED_BLOCKED');
  }
  return [...out];
}

/** Row ids of one environment, read by a caller that may read that environment. */
export interface PaaEnvironmentIds {
  environmentFingerprint: string;
  examVersionId: string;
  /** Topic code -> { topic node id, its Domain node id }. */
  topics: ReadonlyMap<string, { topicNodeId: string; domainNodeId: string }>;
  /** `${canonicalSubject}|${canonicalName}` -> canonical concept id. */
  concepts: ReadonlyMap<string, string>;
}

/** Attaches an environment's ids. A cell whose Topic or concept is not found there is reported, never half-bound. */
export function bindPaaCells(cells: readonly RequirementCell[], ids: PaaEnvironmentIds): { bound: RequirementCell[]; unresolved: Array<{ cellKey: string; missing: 'TOPIC' | 'CONCEPT' }> } {
  const bound: RequirementCell[] = [];
  const unresolved: Array<{ cellKey: string; missing: 'TOPIC' | 'CONCEPT' }> = [];
  for (const c of cells) {
    const topic = ids.topics.get(c.topicNodeCode);
    const concept = ids.concepts.get(`${c.primaryConcept.canonicalSubject}|${c.primaryConcept.canonicalName}`);
    if (!topic) unresolved.push({ cellKey: c.cellKey, missing: 'TOPIC' });
    else if (!concept) unresolved.push({ cellKey: c.cellKey, missing: 'CONCEPT' });
    else bound.push({ ...c, binding: { environmentFingerprint: ids.environmentFingerprint, examVersionId: ids.examVersionId, topicNodeId: topic.topicNodeId, domainNodeId: topic.domainNodeId, primaryConceptId: concept } });
  }
  return { bound, unresolved };
}
