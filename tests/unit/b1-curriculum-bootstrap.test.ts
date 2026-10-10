/**
 * B1 -- Curriculum Authority transition: an exam vertical configuration still materialises its curriculum
 * rows, now THROUGH the Curriculum domain's bootstrap boundary (integration, in-memory client).
 *
 * A recording client stands in for the transaction. The real configurations are applied (dry run), and the
 * statements that reach the curriculum tables must be exactly the ones issued before B1: same natural keys,
 * same columns, same values -- and every one of them issued by the boundary, none by Exam Core.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Call { sql: string; params: any[] }
let calls: Call[] = [];
let seq = 0;
/** Rows that "exist" by natural key, to test the ensure (lookup-first) behaviour. */
let existing: Array<[RegExp, (params: any[]) => any[] | null]> = [];

const clientQuery = async (sql: string, params: any[] = []) => {
  calls.push({ sql, params });
  for (const [re, handler] of existing) {
    if (re.test(sql)) {
      const rows = handler(params);
      if (rows) return { rows };
    }
  }
  if (/FROM users WHERE is_system = true/.test(sql)) return { rows: [{ id: 'sys-editor' }, { id: 'sys-reviewer' }] };
  if (/^\s*(INSERT|UPDATE)/i.test(sql) && /RETURNING/i.test(sql)) return { rows: [{ id: `id-${++seq}`, inserted: true }] };
  return { rows: [] };
};

vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: any[]) => clientQuery(sql, params), connect: async () => ({ query: (sql: string, params?: any[]) => clientQuery(sql, params), release: () => {} }) } }));
vi.mock('@/lib/exam-core/question-bank/bank.service', () => ({ ensureBankIdentities: async () => 0 }));
vi.mock('@/lib/exam-core/catalog/source-registry.service', () => ({ upsertSources: async (_c: unknown, keys: string[]) => new Map(keys.map((k) => [k, `src-${k}`])) }));

import { applyExamVerticalConfig } from '@/lib/exam-core/apply-vertical-config.service';
import { SABER11_MATH_V2, PAA_V2, CAMBRIDGE_0580_EXTENDED_V2, IB_PHYSICS_HL_V2, PISA_2022_V2, AICE_9709_AS } from '@/lib/exam-core/verticals/v2';
import { parseExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { BOOTSTRAP_ASSESSMENT_NODE_TYPE, ensureAcademicSubject, ensureAssessmentSectionNode, ensureLearningObjective, ensureStructureVersion } from '@/lib/curriculum/bootstrap.service';

const inserts = (table: string) => calls.filter((c) => new RegExp(`^\\s*INSERT INTO ${table}\\b`).test(c.sql));
const lookups = (table: string) => calls.filter((c) => new RegExp(`^\\s*SELECT (id|1) FROM ${table}\\b`).test(c.sql));

beforeEach(() => {
  calls = [];
  seq = 0;
  existing = [];
});

const VERTICALS = { 'Saber 11 Math': SABER11_MATH_V2, PAA: PAA_V2, 'Cambridge 0580': CAMBRIDGE_0580_EXTENDED_V2, 'IB Physics HL': IB_PHYSICS_HL_V2, 'PISA 2022': PISA_2022_V2, 'AICE 9709 AS': AICE_9709_AS };

describe('B1 curriculum bootstrap -- real vertical configurations still materialise', () => {
  for (const [name, input] of Object.entries(VERTICALS)) {
    it(`${name}: organization -> programme -> subject -> structure version -> section nodes -> objectives`, async () => {
      const parsed = parseExamVerticalConfig(input);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const cfg = parsed.config;
      const result = await applyExamVerticalConfig(input, { write: false });

      expect(result.noop).toBe(false);
      // dry run: one transaction, rolled back
      expect(calls[0].sql).toBe('BEGIN');
      expect(calls.some((c) => c.sql === 'ROLLBACK')).toBe(true);
      expect(calls.some((c) => c.sql === 'COMMIT')).toBe(false);

      // organization / programme, by their natural keys, with the configured values
      expect(inserts('academic_organizations').map((c) => c.params)).toEqual([[cfg.organization.name]]);
      expect(inserts('academic_programmes')).toHaveLength(1);
      expect(inserts('academic_programmes')[0].params.slice(1)).toEqual([cfg.programme.name, cfg.programme.type, cfg.programme.stage ?? null]);
      expect(inserts('academic_qualifications')).toHaveLength(cfg.qualification ? 1 : 0);

      // one assessment-section node per configured section, typed EXAM_SECTION, keyed sec.<key>, in order
      const nodes = inserts('structure_nodes');
      expect(nodes).toHaveLength(cfg.sections.length);
      expect(nodes.every((n) => /VALUES \(\$1, 'EXAM_SECTION', \$2, \$3, \$4, \$5\)/.test(n.sql))).toBe(true);
      expect(nodes.map((n) => n.params[2])).toEqual(cfg.sections.map((s) => `sec.${s.key}`));
      expect(nodes.map((n) => n.params[1])).toEqual(cfg.sections.map((s) => s.name));
      expect(nodes.map((n) => n.params[3])).toEqual(cfg.sections.map((_, i) => i));
      expect(nodes.every((n) => n.params[4] === cfg.contentStatus)).toBe(true);

      // structure versions carry the bootstrap provenance and the configured label
      const versions = inserts('structure_versions');
      expect(versions.length).toBeGreaterThan(0);
      expect(versions.every((v) => v.params[1] === cfg.structureLabel && v.params[3] === `exam-vertical-config:${cfg.key}`)).toBe(true);
      // the fake holds no PUBLISHED version, so each new one is PUBLISHED (the pre-B1 rule)
      expect(versions.every((v) => v.params[2] === 'PUBLISHED')).toBe(true);

      // every configured objective exists once, with its code and description, and is returned by code
      const codes = cfg.sections.flatMap((s) => s.objectives.map((o) => o.code));
      const objectives = inserts('learning_objectives');
      expect(objectives.map((o) => o.params[1])).toEqual(codes);
      expect(objectives.map((o) => o.params[2])).toEqual(cfg.sections.flatMap((s) => s.objectives.map((o) => o.description)));
      expect(Object.keys(result.objectiveIdsByCode).sort()).toEqual([...new Set(codes)].sort());

      // exam structure is still written by Exam Core, with the objective ids the boundary returned
      const targets = inserts('blueprint_objective_targets');
      expect(targets).toHaveLength(cfg.sections.reduce((n, s) => n + s.objectives.reduce((m, o) => m + o.targets.reduce((k, t) => k + t.count, 0), 0), 0));
      const objectiveIds = new Set(Object.values(result.objectiveIdsByCode));
      expect(targets.every((t) => objectiveIds.has(t.params[1]))).toBe(true);
      expect(inserts('assessment_components')).toHaveLength(cfg.sections.length);
    });
  }

  it('is idempotent on curriculum rows: an existing subject / version / node / objective is reused, never duplicated', async () => {
    existing = [
      [/SELECT id FROM academic_organizations WHERE name = \$1/, () => [{ id: 'org-existing' }]],
      [/SELECT id FROM academic_programmes WHERE organization_id = \$1 AND name = \$2/, () => [{ id: 'prog-existing' }]],
      [/SELECT id FROM academic_qualifications WHERE programme_id = \$1 AND name = \$2/, () => [{ id: 'qual-existing' }]],
      [/SELECT id FROM academic_subjects WHERE programme_id = \$1/, () => [{ id: 'subj-existing' }]],
      [/SELECT id FROM structure_versions WHERE academic_subject_id = \$1 AND version_label = \$2/, () => [{ id: 'sv-existing' }]],
      [/SELECT id FROM structure_nodes WHERE structure_version_id = \$1 AND code = \$2/, () => [{ id: 'node-existing' }]],
      [/SELECT id FROM learning_objectives WHERE structure_node_id = \$1 AND code = \$2/, (p) => [{ id: `lo-existing-${p[1]}` }]],
    ];
    const result = await applyExamVerticalConfig(SABER11_MATH_V2, { write: false });
    for (const table of ['academic_organizations', 'academic_programmes', 'academic_qualifications', 'academic_subjects', 'structure_versions', 'structure_nodes', 'learning_objectives']) expect(inserts(table), table).toHaveLength(0);
    expect(Object.values(result.objectiveIdsByCode).every((id) => id.startsWith('lo-existing-'))).toBe(true);
    expect(lookups('learning_objectives').length).toBeGreaterThan(0);
  });

  it('never supersedes a version the Curriculum Authority published: a new label on a published subject is created as DRAFT', async () => {
    existing = [[/SELECT 1 FROM structure_versions WHERE academic_subject_id = \$1 AND status = 'PUBLISHED'/, () => [{ '?column?': 1 }]]];
    await applyExamVerticalConfig(SABER11_MATH_V2, { write: false });
    const versions = inserts('structure_versions');
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((v) => v.params[2] === 'DRAFT')).toBe(true);
    expect(calls.some((c) => /UPDATE structure_versions/.test(c.sql))).toBe(false);
  });
});

describe('B1 curriculum bootstrap -- the boundary itself', () => {
  const client = { query: clientQuery };

  it('looks a row up by its natural key before creating it, with the statements used before B1', async () => {
    await ensureAcademicSubject(client, { programmeId: 'p', qualificationId: null, name: 'Physics', level: 'HL' });
    expect(calls[0].sql).toBe(`SELECT id FROM academic_subjects WHERE programme_id = $1 AND qualification_id IS NOT DISTINCT FROM $2 AND name = $3 AND level IS NOT DISTINCT FROM $4 ORDER BY created_at LIMIT 1`);
    expect(calls[1].sql).toBe(`INSERT INTO academic_subjects (programme_id, qualification_id, name, level) VALUES ($1, $2, $3, $4) RETURNING id`);
    expect(calls[1].params).toEqual(['p', null, 'Physics', 'HL']);
  });

  it('structure version: one PUBLISHED per subject is respected', async () => {
    expect(await ensureStructureVersion(client, { academicSubjectId: 's', versionLabel: '2026', sourceLocator: 'exam-vertical-config:x' })).toBe('id-1');
    expect(calls.map((c) => c.sql)).toEqual([
      `SELECT id FROM structure_versions WHERE academic_subject_id = $1 AND version_label = $2 LIMIT 1`,
      `SELECT 1 FROM structure_versions WHERE academic_subject_id = $1 AND status = 'PUBLISHED'`,
      `INSERT INTO structure_versions (academic_subject_id, version_label, status, source_locator) VALUES ($1, $2, $3, $4) RETURNING id`,
    ]);
    expect(calls[2].params).toEqual(['s', '2026', 'PUBLISHED', 'exam-vertical-config:x']);
  });

  it('a bootstrapped node is an assessment section, and an objective belongs to exactly one node', async () => {
    expect(BOOTSTRAP_ASSESSMENT_NODE_TYPE).toBe('EXAM_SECTION');
    await ensureAssessmentSectionNode(client, { structureVersionId: 'sv', code: 'sec.p1', label: 'Paper 1', orderIndex: 0, source: 'DEV_CERT_FIXTURE' });
    await ensureLearningObjective(client, { structureNodeId: 'n', code: 'obj.1', description: 'An objective' });
    expect(calls[1].params).toEqual(['sv', 'Paper 1', 'sec.p1', 0, 'DEV_CERT_FIXTURE']);
    expect(calls[3].sql).toBe(`INSERT INTO learning_objectives (structure_node_id, code, description) VALUES ($1, $2, $3) RETURNING id`);
    expect(calls[3].params).toEqual(['n', 'obj.1', 'An objective']);
  });
});
