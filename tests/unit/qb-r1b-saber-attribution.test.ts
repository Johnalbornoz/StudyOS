/**
 * QB-R1B -- Saber competencies, the attribution writer and the production draft package: the contract side.
 * Real grants, attribution and approvals on a database are certified by qb-r1a-reviewer-governance-cert.sh.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { DEV_CANONICAL_CONCEPTS, DEV_COMPETENCIES } from '@/lib/exam-core/catalog/dev-learning-catalog';
import { OBJECTIVE_LEARNING_LINKS } from '@/lib/exam-core/catalog/objective-learning-links';
import { ItemAttributionError, setItemAttribution } from '@/lib/exam-core/question-bank/item-attribution.service';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('QB-R1B Saber -- competencies in their own layer', () => {
  const SABER = ['saber.interpretacion', 'saber.formulacion', 'saber.argumentacion'];

  it('the three Saber competencies are canonical competencies, one per objective', () => {
    const codes = DEV_COMPETENCIES.filter((c) => c.code.startsWith('icfes.saber11.mat.'));
    expect(codes.map((c) => [c.code, c.name])).toEqual([
      ['icfes.saber11.mat.interpretacion', 'Interpretación y representación'],
      ['icfes.saber11.mat.formulacion', 'Formulación y ejecución'],
      ['icfes.saber11.mat.argumentacion', 'Argumentación'],
    ]);
    expect(SABER.map((o) => OBJECTIVE_LEARNING_LINKS[o].competencies)).toEqual([['icfes.saber11.mat.interpretacion'], ['icfes.saber11.mat.formulacion'], ['icfes.saber11.mat.argumentacion']]);
  });

  it('Competency != Concept: no Saber objective is linked to a concept or a skill, and no competency is listed as a concept', () => {
    for (const o of SABER) {
      expect(OBJECTIVE_LEARNING_LINKS[o].concepts, o).toBeUndefined();
      expect(OBJECTIVE_LEARNING_LINKS[o].skills, o).toBeUndefined();
    }
    const conceptNames = new Set(DEV_CANONICAL_CONCEPTS.map((c) => c.name));
    for (const c of DEV_COMPETENCIES.filter((x) => x.code.startsWith('icfes.'))) expect(conceptNames.has(c.name), c.name).toBe(false);
  });

  it('a competency mapping is never read as concept coverage, PRIMARY evidence or reviewer subject', () => {
    for (const f of ['src/lib/assessment-foundation/question-coverage.service.ts', 'src/lib/assessment-foundation/question-coverage.ts', 'src/lib/assessment-foundation/pilot-eligibility.ts', 'src/lib/exam-core/question-bank/reviewer-qualification.service.ts', 'src/lib/exam-core/question-bank/item-attribution.service.ts']) {
      expect(code(f), f).not.toMatch(/objective_competency_mappings|FROM competencies|competency_id/);
    }
    // the attribution table accepts canonical concepts only
    expect(read('database/migrations/20261110_1300_qb_item_concept_attribution.sql')).toMatch(/canonical_concept_id uuid NOT NULL REFERENCES public\.canonical_concepts\(id\)/);
  });
});

describe('QB-R1B attribution writer -- one governed path', () => {
  const svc = code('src/lib/exam-core/question-bank/item-attribution.service.ts');

  it('exactly one PRIMARY, explicit ids, a reason: refused before any query otherwise', async () => {
    const calls: string[] = [];
    const tx = { query: async (sql: string) => { calls.push(sql); return { rows: [] }; } } as never;
    const refusal = (p: Promise<unknown>) => p.then(() => 'ACCEPTED', (e) => (e instanceof ItemAttributionError ? e.code : `OTHER:${(e as Error).message}`));
    const base = { approvedItemId: U(1), reviewerUserId: U(2), primaryConceptId: U(3), reason: 'reviewer note' };
    expect(await refusal(setItemAttribution(tx, { ...base, primaryConceptId: '' }))).toBe('PRIMARY_CONCEPT_REQUIRED');
    expect(await refusal(setItemAttribution(tx, { ...base, primaryConceptId: 'Porcentajes' }))).toBe('PRIMARY_CONCEPT_REQUIRED');
    expect(await refusal(setItemAttribution(tx, { ...base, supportingConceptIds: [U(3)] }))).toBe('CONCEPT_LISTED_TWICE');
    expect(await refusal(setItemAttribution(tx, { ...base, supportingConceptIds: [U(4), U(4)] }))).toBe('CONCEPT_LISTED_TWICE');
    expect(await refusal(setItemAttribution(tx, { ...base, reason: ' ' }))).toBe('REASON_REQUIRED');
    expect(calls).toEqual([]);
    expect(await refusal(setItemAttribution(tx, base))).toBe('ITEM_VERSION_NOT_FOUND');
  });

  it('who: a person, not the author, qualified for the exam family and the PRIMARY concept\'s subject', () => {
    for (const marker of ['REVIEWER_IS_SYSTEM_ACCOUNT', 'REVIEWER_NOT_ACTIVE', 'REVIEWER_IS_AUTHOR', 'REVIEWER_NOT_QUALIFIED', 'EXAM_FAMILY_UNDETERMINED']) expect(svc, marker).toContain(`'${marker}'`);
    expect(svc).toMatch(/validQualification\(tx, \{ reviewerUserId: input\.reviewerUserId, examFamily: row\.exam_family, canonicalSubjectIds: \[subjectOf\.get\(input\.primaryConceptId\)!\] \}\)/);
  });

  it('nothing is attributed automatically: the writer reads no objective mapping, and nothing else writes attribution', () => {
    expect(svc).not.toMatch(/objective_concept_mappings|learning_objective/);
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : []));
    expect(walk('src').filter((f) => /(INSERT INTO|DELETE FROM|UPDATE) question_bank_item_concepts/.test(read(f)))).toEqual(['src/lib/exam-core/question-bank/item-attribution.service.ts']);
  });

  it('audited in the same transaction: who, before, after, why, and the qualification it was made under', () => {
    expect(svc).toMatch(/action: 'QUESTION_BANK_ITEM_ATTRIBUTION_SET', targetType: 'QUESTION_BANK_ITEM_VERSION', targetId: input\.approvedItemId/);
    expect(svc).toMatch(/previousState: \{ primaryConceptId: before\.primaryConceptId/);
    expect(svc).toMatch(/reviewerQualificationId: held\.qualificationId/);
    expect(svc).toMatch(/recordAdminAction\(\s*\{[\s\S]*?\},\s*tx\s*\)/);
  });

  it('the operator script names every id, is dry-run by default, and proposes nothing', () => {
    const s = read('scripts/operations/qb-item-attribution.ts');
    for (const flag of ['item-version', 'reviewer', 'primary', 'reason']) expect(s, flag).toContain(`required('${flag}')`);
    expect(s).toMatch(/await client\.query\(write \? 'COMMIT' : 'ROLLBACK'\)/);
    expect(s).not.toMatch(/objective_concept_mappings|WHERE name|ILIKE/i);
  });
});
