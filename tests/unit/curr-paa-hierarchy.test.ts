/**
 * CURR-PAA -- the certified PAA curriculum hierarchy and item traceability: the contract side.
 * The database side (nodes, migration 20261111_1000, re-parenting, seeds) is certified on a real database by
 * scripts/operations/curr-paa-hierarchy-cert.sh.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PAA_DOMAINS, PAA_NODE_TYPES, PAA_OBJECTIVES_WITHOUT_DOMAIN, PAA_SECTIONS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { nodeOriginOf } from '@/lib/curriculum/curriculum-scope';
import { buildCurriculumTopics, type CurriculumTopicRow } from '@/lib/learning-plan/subject-curriculum-topics';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

/** Minimal RFC-4180 reader: the certified artefacts quote fields that contain commas. */
function csv(path: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const text = read(path);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((f) => f !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
const TOPICS_CSV = csv('docs/exams/question-bank/audits/q1-paa/Q1C1_paa_certified_topics.csv');
const CONCEPTS_CSV = csv('docs/exams/question-bank/audits/q1-paa/Q1C1_paa_certified_concepts.csv');

describe('CURR-PAA certified hierarchy -- exactly the Q1-C.1 artefact', () => {
  it('4 Sections, 17 official Domains, 84 certified Topics, 61 certified Concepts', () => {
    expect(PAA_SECTIONS.map((s) => s.label)).toEqual(['Lectura', 'Redacción', 'Matemáticas', 'Inglés']);
    expect(PAA_DOMAINS).toHaveLength(17);
    expect(PAA_TOPICS).toHaveLength(84);
    expect(new Set(PAA_TOPICS.map((t) => t.certifiedConceptId).filter(Boolean)).size).toBe(61);
    expect(CONCEPTS_CSV).toHaveLength(61);
    expect(PAA_SECTIONS.map((s) => PAA_DOMAINS.filter((d) => d.sectionCode === s.code).length)).toEqual([5, 5, 4, 3]);
    expect(PAA_SECTIONS.map((s) => PAA_TOPICS.filter((t) => PAA_DOMAINS.find((d) => d.code === t.domainCode)!.sectionCode === s.code).length)).toEqual([20, 5, 44, 15]);
  });

  it('every Topic is the artefact row with the same order: section, Domain, label, authority, source, concept', () => {
    expect(TOPICS_CSV).toHaveLength(84);
    for (const r of TOPICS_CSV) {
      const t = PAA_TOPICS.find((x) => x.order === Number(r.order))!;
      const d = PAA_DOMAINS.find((x) => x.code === t.domainCode)!;
      const s = PAA_SECTIONS.find((x) => x.code === d.sectionCode)!;
      expect({ section: s.label, official_domain: d.label, topic: t.label, topic_authority: t.authority, source_reference: t.sourceReference, certified_concept_id: t.certifiedConceptId ?? '' }, `topic ${r.order}`)
        .toEqual({ section: r.section, official_domain: r.official_domain, topic: r.topic, topic_authority: r.topic_authority, source_reference: r.source_reference, certified_concept_id: r.certified_concept_id });
    }
    expect(PAA_TOPICS.map((t) => t.code)).toEqual(TOPICS_CSV.map((r) => `paa.topic.${String(Number(r.order)).padStart(3, '0')}`));
  });

  it('the Domains are the 17 the certified concepts name, and every certified concept is reached by a Topic', () => {
    const key = (section: string, domain: string) => `${section} / ${domain}`;
    const fromConcepts = new Set(CONCEPTS_CSV.map((c) => key(c.section, c.official_domain)));
    const here = new Set(PAA_DOMAINS.map((d) => key(PAA_SECTIONS.find((s) => s.code === d.sectionCode)!.label, d.label)));
    expect([...here].sort()).toEqual([...fromConcepts].sort());
    expect([...new Set(PAA_TOPICS.map((t) => t.certifiedConceptId).filter(Boolean))].sort()).toEqual(CONCEPTS_CSV.map((c) => c.stable_id).sort());
    expect(PAA_TOPICS.filter((t) => t.certifiedConceptId === null).map((t) => t.label)).toEqual(['Sentence correction', 'Error identification']);
    expect(PAA_TOPICS.filter((t) => t.authority === 'STUDYUS_POLICY')).toHaveLength(1);
  });

  it('codes are unique, and a Topic has one Domain, a Domain one Section', () => {
    const codes = [...PAA_SECTIONS, ...PAA_DOMAINS, ...PAA_TOPICS].map((x) => x.code);
    expect(new Set(codes).size).toBe(4 + 17 + 84);
    for (const d of PAA_DOMAINS) expect(PAA_SECTIONS.filter((s) => s.code === d.sectionCode)).toHaveLength(1);
    for (const t of PAA_TOPICS) expect(PAA_DOMAINS.filter((d) => d.code === t.domainCode)).toHaveLength(1);
    for (const d of PAA_DOMAINS) expect(PAA_TOPICS.some((t) => t.domainCode === d.code), d.code).toBe(true);
  });
});

describe('CURR-PAA objectives -- 20 historical objectives, 17 official Domains', () => {
  it('nineteen objectives belong to exactly one Domain; every Domain has at least one; cohesion has none', () => {
    const placed = PAA_DOMAINS.flatMap((d) => d.objectiveCodes);
    expect(placed).toHaveLength(19);
    expect(new Set(placed).size).toBe(19);
    expect(PAA_DOMAINS.every((d) => d.objectiveCodes.length >= 1)).toBe(true);
    expect(PAA_DOMAINS.filter((d) => d.objectiveCodes.length === 2).map((d) => d.label)).toEqual(['Análisis, interpretación e inferencias', 'Análisis de datos y Probabilidad']);
    expect(PAA_OBJECTIVES_WITHOUT_DOMAIN).toEqual(['paa.red.cohesion']);
    expect(placed).not.toContain('paa.red.cohesion');
    // an objective sits in the section its Domain is in
    const prefix: Record<string, string> = { 'paa.sec.lectura': 'paa.lect.', 'paa.sec.redaccion': 'paa.red.', 'paa.sec.matematicas': 'paa.mat.', 'paa.sec.ingles': 'paa.ing.' };
    for (const d of PAA_DOMAINS) for (const o of d.objectiveCodes) expect(o.startsWith(prefix[d.sectionCode]), `${o} in ${d.code}`).toBe(true);
  });

  it('re-parenting is one governed operation: same structure version, id kept, no row created or deleted', () => {
    const svc = code('src/lib/curriculum/objective.service.ts');
    const fn = svc.slice(svc.indexOf('export async function reparentLearningObjective'));
    expect(fn).toMatch(/DIFFERENT_STRUCTURE_VERSION/);
    expect(fn.match(/\b(INSERT|DELETE)\b/g)).toBeNull();
    expect(fn.match(/UPDATE learning_objectives SET structure_node_id = \$2 WHERE id = \$1/g)).toHaveLength(1);
    // nothing outside the Curriculum Authority moves an objective
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : []));
    expect(walk('src').filter((f) => /UPDATE learning_objectives/.test(code(f)))).toEqual(['src/lib/curriculum/objective.service.ts']);
  });

  it('the bootstrap identifies an objective by its code within the structure version, so a moved objective is found again', () => {
    const boot = read('src/lib/curriculum/bootstrap.service.ts');
    const fn = boot.slice(boot.indexOf('export function ensureLearningObjective'), boot.indexOf('/* ------', boot.indexOf('export function ensureLearningObjective')));
    expect(fn).toMatch(/lo\.code = \$2 AND n\.structure_version_id = \(SELECT structure_version_id FROM structure_nodes WHERE id = \$1\)/);
    expect(fn).not.toMatch(/WHERE structure_node_id = \$1 AND code = \$2/);
  });

  it('what re-parenting changes for a Student: learning-plan topics become the official Domains, and cohesion leaves the list', () => {
    const labels = new Map([['c-voc', 'Vocabulario en contexto'], ['c-coh', 'Cohesión y conectores'], ['c-eli', 'Economía del lenguaje']]);
    const row = (nodeId: string, nodeType: string, nodeLabel: string, objectiveCode: string, canonicalConceptId: string): CurriculumTopicRow => ({ nodeId, nodeType, nodeLabel, nodeOrder: 0, objectiveId: `lo-${objectiveCode}`, objectiveCode, objectiveDescription: objectiveCode, canonicalConceptId });
    const today = buildCurriculumTopics([row('sec-l', 'EXAM_SECTION', 'Lectura', 'paa.lect.vocabulario', 'c-voc'), row('sec-r', 'EXAM_SECTION', 'Redacción', 'paa.red.cohesion', 'c-coh'), row('sec-r', 'EXAM_SECTION', 'Redacción', 'paa.red.elision', 'c-eli')], labels, new Map(), 'es');
    expect(today.map((t) => t.key)).toEqual(['lo:lo-paa.lect.vocabulario', 'lo:lo-paa.red.cohesion', 'lo:lo-paa.red.elision']);
    const moved = buildCurriculumTopics([row('dom-voc', 'DOMAIN', 'Vocabulario en contexto', 'paa.lect.vocabulario', 'c-voc'), row('sec-r', 'EXAM_SECTION', 'Redacción', 'paa.red.cohesion', 'c-coh'), row('dom-eli', 'DOMAIN', 'Elisión', 'paa.red.elision', 'c-eli')], labels, new Map(), 'es');
    expect(moved.map((t) => [t.key, t.title])).toEqual([['node:dom-voc', 'Vocabulario en contexto'], ['node:dom-eli', 'Elisión']]);
    // adding the hierarchy WITHOUT moving objectives changes nothing for that reader: it starts from objectives
    expect(nodeOriginOf('DOMAIN')).toBe('CURRICULUM_HIERARCHY');
    expect(nodeOriginOf('EXAM_SECTION')).toBe('BOOTSTRAP_ASSESSMENT_SECTION');
  });
});

describe('CURR-PAA materialisation -- canonical structure only', () => {
  it('uses structure nodes through the Curriculum services: no PAA table, no direct node write', () => {
    const svc = code('src/lib/curriculum/paa/paa-hierarchy.service.ts');
    expect(svc).toMatch(/createStructureNode\(/);
    expect(svc).toMatch(/reparentLearningObjective\(/);
    expect(svc).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\b/);
    expect(Object.values(PAA_NODE_TYPES)).toEqual(['SECTION', 'DOMAIN', 'TOPIC']);
    const migrations = readdirSync(join(ROOT, 'database/migrations')).map((f) => read(`database/migrations/${f}`).replace(/^\s*--.*$/gm, '')).join('\n');
    expect(migrations).not.toMatch(/CREATE TABLE[^;]*paa_/i);
    // without the explicit option, no objective is touched
    expect(svc).toMatch(/else if \(options\.reparentObjectives\)/);
  });

  it('the operator script is dry-run by default, DEV-or-ephemeral only, and aborts unless the result is exactly 4 / 17 / 84', () => {
    const script = read('scripts/operations/curr-paa-hierarchy.ts');
    expect(script).toMatch(/DEV_DB_FINGERPRINT = '2a29b99ee14a22b4'/);
    expect(script).toMatch(/fp !== DEV_DB_FINGERPRINT && url\.hostname !== '127\.0\.0\.1'/);
    expect(script).toMatch(/if \(write && problems\.length === 0\)/);
    expect(script).toMatch(/learning objectives changed by/);
    expect(script).toMatch(/an objective changed its node without --reparent-objectives/);
  });
});

describe('CURR-PAA migration 10 -- item version -> curriculum node', () => {
  const sql = read('database/migrations/20261111_1000_qb_item_curriculum_nodes.sql').replace(/^\s*--.*$/gm, '');

  it('one Topic per item version, a Topic under a Domain, in the structure version of the item objective', () => {
    expect(sql).toMatch(/approved_item_id uuid PRIMARY KEY REFERENCES public\.approved_items\(id\)/);
    expect(sql).toMatch(/structure_node_id uuid NOT NULL REFERENCES public\.structure_nodes\(id\)/);
    for (const marker of ['NOT_A_TOPIC', 'TOPIC_WITHOUT_DOMAIN', 'OTHER_STRUCTURE', 'NEEDS_BANK_VERSION', 'FROZEN', 'NO_UPDATE']) expect(sql, marker).toContain(`QUESTION_BANK_ITEM_CURRICULUM_NODE_${marker}`);
    expect(sql).toMatch(/STRUCTURE_NODE_TRACED_BY_ITEMS/);
  });

  it('additive: no curriculum row, no link and no legacy mapping is created by the migration', () => {
    expect(sql).not.toMatch(/INSERT INTO|UPDATE public\.|DELETE FROM|DROP TABLE|DROP COLUMN|ALTER TABLE/);
    expect(sql.match(/CREATE TABLE public\.(\w+)/g)).toEqual(['CREATE TABLE public.question_bank_item_curriculum_nodes']);
  });

  it('the reader derives nothing for an untraced item and tolerates a database without the table', () => {
    const svc = code('src/lib/curriculum/item-traceability.service.ts');
    expect(svc).toMatch(/to_regclass\('public\.question_bank_item_curriculum_nodes'\)/);
    expect(svc).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(svc).toMatch(/JOIN structure_nodes d ON d\.id = t\.parent_id/);
  });
});
