/**
 * B2-B2 -- BLUEPRINT_READERS_HARDENED.
 *
 * Migration 20261110_1600 lets one exam version carry several blueprints: its legacy blueprint
 * (`purpose IS NULL`) and variants (FULL / REDUCED / DIAGNOSTIC). Every flow that existed before reads the
 * LEGACY blueprint. This test fails when a file under src/ reads `assessment_blueprints` without saying
 * which one it means, so a future reader cannot bind to a variant by accident.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query } }));

import { getBlueprintForVersion, publishBlueprint } from '@/lib/assessment/blueprint.service';
import { listVersionAreas } from '@/lib/exam-core/catalog.service';
import { evaluateExamVersionReadiness } from '@/lib/assessment-blueprint/assessment-blueprint.service';

const ROOT = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (f: string) => f.replace(`${ROOT}/`, '');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every SQL text (template literal) of a file that reads the table: `FROM` / `JOIN assessment_blueprints`. */
function blueprintReads(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\b(?:FROM|JOIN)\s+(?:public\.)?assessment_blueprints\b/g)) {
    const start = code.lastIndexOf('`', m.index);
    const end = code.indexOf('`', m.index);
    out.push(code.slice(start, end + 1));
  }
  return out;
}

const LEGACY = /\bpurpose IS NULL\b/;
/** The same filter for a row alias, written so it also runs where the column does not exist yet. */
const LEGACY_SCHEMA_TOLERANT = /to_jsonb\(b\) ->> 'purpose' IS NULL/;

/** Files that read the table and are NOT legacy readers, each with the reason. Nothing else may skip the filter. */
const NOT_LEGACY_READERS: Record<string, { reason: string; must: RegExp }> = {
  'src/lib/assessment-blueprint/protected/blueprint-persistence.service.ts': { reason: 'the B2 persistence adapter reads VARIANTS, and says so in every statement', must: /\bpurpose IS NOT NULL\b/ },
};

/**
 * Catalogue writers the B2-B1 certification also runs against the pre-20261110 schema (seeds on the old
 * schema, then the migrations on populated data). They filter the legacy blueprint through `to_jsonb`, which
 * is NULL both for a legacy row and where the column does not exist.
 */
const SCHEMA_TOLERANT_READERS = ['src/lib/exam-core/apply-vertical-config.service.ts', 'src/lib/exam-core/catalog/learning-links.service.ts', 'src/lib/exam-core/question-bank/bank.service.ts'];

const SRC = walk(join(ROOT, 'src'));
const READERS = SRC.map((f) => ({ file: rel(f), reads: blueprintReads(stripComments(readFileSync(f, 'utf8'))) })).filter((r) => r.reads.length > 0);

describe('B2-B2 legacy blueprint readers are explicit', () => {
  it('every statement under src/ that reads assessment_blueprints names the legacy blueprint, unless its file is listed with a reason', () => {
    expect(READERS.length).toBeGreaterThanOrEqual(15);
    for (const { file, reads } of READERS) {
      for (const sql of reads) {
        const listed = NOT_LEGACY_READERS[file];
        if (listed) expect(sql, `${file}: ${listed.reason}`).toMatch(listed.must);
        else if (SCHEMA_TOLERANT_READERS.includes(file)) expect(sql, file).toMatch(LEGACY_SCHEMA_TOLERANT);
        else expect(sql, `${file} reads assessment_blueprints without \`purpose IS NULL\``).toMatch(LEGACY);
      }
    }
  });

  it('the reader list is the known one: a new reader is a deliberate addition here, not a silent one', () => {
    expect(READERS.map((r) => `${r.file} x${r.reads.length}`).sort()).toEqual([
      'src/app/api/diagnostics/preview-db/route.ts x1',
      'src/lib/assessment-blueprint/assessment-blueprint.service.ts x1',
      'src/lib/assessment-blueprint/protected/blueprint-persistence.service.ts x2',
      'src/lib/assessment/blueprint.service.ts x1',
      // curriculum convergence: the certified PAA catalogue loader reads the objectives of published versions (legacy blueprint)
      'src/lib/curriculum/paa/paa-certified-catalog.service.ts x1',
      'src/lib/exam-core/apply-vertical-config.service.ts x1',
      'src/lib/exam-core/catalog.service.ts x1',
      'src/lib/exam-core/catalog/learning-links.service.ts x1',
      'src/lib/exam-core/catalog/structure.service.ts x1',
      'src/lib/exam-core/exam-gaps.service.ts x1',
      'src/lib/exam-core/objectives/preparation.service.ts x4',
      'src/lib/exam-core/question-bank/bank.service.ts x1',
      'src/lib/exam-core/question-bank/health.service.ts x1',
      'src/lib/exam-core/question-bank/review.service.ts x1',
      'src/lib/institution/intelligence-context.service.ts x1',
      // curriculum convergence: the academic subjects a prepared exam assesses (legacy blueprint, read-only)
      'src/lib/learning-plan/curriculum.service.ts x1',
      'src/lib/learning-plan/exam-bridge.service.ts x1',
      'src/lib/simulation/post-exam-diagnosis.service.ts x1',
      'src/lib/teacher/class-progress.service.ts x1',
    ]);
    // the allow-lists name real readers only
    for (const f of [...Object.keys(NOT_LEGACY_READERS), ...SCHEMA_TOLERANT_READERS]) expect(READERS.some((r) => r.file === f), f).toBe(true);
  });

  it('outside the B2 persistence adapter, a blueprint is only ever written as a legacy blueprint', () => {
    const adapter = 'src/lib/assessment-blueprint/protected/blueprint-persistence.service.ts';
    const writers = SRC.map((f) => ({ file: rel(f), code: stripComments(readFileSync(f, 'utf8')) })).filter((w) => w.file !== adapter && /\b(INSERT INTO|UPDATE)\s+(?:public\.)?assessment_blueprints\b/.test(w.code));
    expect(writers.map((w) => w.file).sort()).toEqual(['src/lib/assessment/blueprint.service.ts', 'src/lib/exam-core/apply-vertical-config.service.ts']);
    for (const w of writers) {
      // an insert names the exam version and nothing else: purpose, form, revision and pool stay NULL
      for (const m of w.code.matchAll(/INSERT INTO assessment_blueprints \(([^)]*)\)/g)) expect(m[1], w.file).toBe('exam_version_id');
      // an update only ever changes the status
      for (const m of w.code.matchAll(/UPDATE assessment_blueprints SET ([^`]*?) WHERE/g)) expect(m[1], w.file).toBe("status = 'PUBLISHED'");
    }
    // no other module reads or writes the requirement or frozen-form tables
    const users = SRC.map(rel).filter((f) => f !== adapter && /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:public\.)?(?:assessment_blueprint_requirement|assessment_frozen_form)/.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));
    expect(users).toEqual([]);
  });
});

describe('B2-B2 legacy readers at runtime (the statement that reaches the database)', () => {
  beforeEach(() => query.mockReset());

  it('getBlueprintForVersion asks for the legacy blueprint and publishBlueprint cannot publish a variant', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await getBlueprintForVersion('ev-1')).toBeNull();
    expect(query.mock.calls[0][0]).toMatch(/FROM assessment_blueprints WHERE exam_version_id = \$1 AND purpose IS NULL/);
    await expect(publishBlueprint('bp-1')).rejects.toThrow(/could not be published/);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE assessment_blueprints SET status = 'PUBLISHED' WHERE id = \$1 AND status = 'DRAFT' AND purpose IS NULL/);
  });

  it('readers that reach targets through the blueprint keep a variant\'s targets out', async () => {
    query.mockResolvedValue({ rows: [] });
    await listVersionAreas('ev-1');
    expect(query.mock.calls[0][0]).toMatch(/LEFT JOIN assessment_blueprints b ON b\.exam_version_id = c\.exam_version_id AND b\.purpose IS NULL/);
    query.mockReset();
    query.mockImplementation(async (sql: string) => (/FROM mastery_policies/.test(sql) ? { rows: [{ version: 1, minimum_evidence_count: 3, minimum_independent_evidence_count: 2 }] } : { rows: [] }));
    await evaluateExamVersionReadiness('ev-1');
    expect(query.mock.calls.map(([sql]) => String(sql)).find((sql) => /blueprint_objective_targets/.test(sql))).toMatch(/b\.exam_version_id = \$1 AND b\.purpose IS NULL/);
  });
});
