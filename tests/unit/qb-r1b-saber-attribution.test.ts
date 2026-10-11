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
import { NOT_ESTABLISHED_BY_A_PACKAGE, ReferenceIntelligencePackSchema, validateDraftPackage } from '@/lib/exam-core/question-bank/production/draft-package';

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

describe('QB-R1B production draft package -- the input to authoring, nothing more', () => {
  const source = (over: Record<string, unknown> = {}) => ({ sourceKey: 'cb-paa-guia-2021', sourceType: 'OFFICIAL_SPECIFICATION', title: 'Guía de estudio PAA', publisher: 'College Board', locator: 'p. 35', sourceAccess: 'PUBLICLY_ACCESSIBLE', permittedUse: 'REFERENCE_ONLY', licenceReference: null, ...over });
  const pack = (over: Record<string, unknown> = {}) => ({ v: 1, sources: [source()], facts: [{ kind: 'TYPICAL_TASK_FORM', statement: 'Los problemas de proporcionalidad suelen pedir un cuarto valor.', sourceKeys: ['cb-paa-guia-2021'], restatedInOwnWords: true }], containsCopiedProtectedExpression: false, ...over });
  const pkg = (over: Record<string, unknown> = {}) => ({
    v: 1, packageKey: 'paa.mat.aritmetica.0001', examFamily: 'PAA', examVersionId: U(10), canonicalSubjectId: U(11), domainNodeCode: 'paa.dom.matematicas.aritmetica', topicNodeCode: 'paa.topic.027',
    learningObjectiveCode: 'paa.mat.aritmetica', targetPrimaryConceptId: U(12), intendedSupportingConceptIds: [U(13)], examSkill: null, responseFormat: 'multiple_choice', difficultyBand: 'STANDARD', language: 'es',
    intendedPool: 'PRACTICE', stimulus: { required: false }, assets: [], provenance: 'STUDYUS_AUTHORED', authorship: { kind: 'HUMAN', authorUserId: U(14) }, references: pack(), ...over,
  });
  const issues = (input: unknown) => {
    const r = validateDraftPackage(input);
    return r.ok ? [] : r.issues;
  };

  it('carries every field authoring needs: family, subject, Domain, Topic, concepts, format, difficulty, stimulus, assets, provenance, references', () => {
    expect(issues(pkg())).toEqual([]);
    for (const field of ['examFamily', 'canonicalSubjectId', 'domainNodeCode', 'topicNodeCode', 'targetPrimaryConceptId', 'intendedSupportingConceptIds', 'examSkill', 'responseFormat', 'difficultyBand', 'stimulus', 'assets', 'provenance', 'references']) {
      const without = { ...pkg() } as Record<string, unknown>;
      delete without[field];
      expect(issues(without).length, field).toBeGreaterThan(0);
    }
    expect(issues(pkg({ stimulus: { required: true, kind: 'PASSAGE', stimulusKey: null, itemsInGroup: 5 }, assets: [{ kind: 'GRAPH', purpose: 'stem' }] }))).toEqual([]);
  });

  it('provenance follows authorship: a model draft is STUDYUS_GENERATED and a person\'s is STUDYUS_AUTHORED', () => {
    expect(issues(pkg({ provenance: 'STUDYUS_GENERATED', authorship: { kind: 'MODEL', model: 'm', promptVersion: '1', requestedByUserId: U(14) } }))).toEqual([]);
    expect(issues(pkg({ provenance: 'STUDYUS_AUTHORED', authorship: { kind: 'MODEL', model: 'm', promptVersion: '1', requestedByUserId: U(14) } }))).toEqual(['authorship: PROVENANCE_AUTHORSHIP_MISMATCH']);
    expect(issues(pkg({ provenance: 'OFFICIAL' })).length).toBeGreaterThan(0);
    expect(issues(pkg({ intendedSupportingConceptIds: [U(12)] }))).toEqual(['intendedSupportingConceptIds: CONCEPT_LISTED_TWICE']);
  });

  it('the reference pack keeps source identity, type and permitted use, and carries facts, never copied expression', () => {
    const ok = ReferenceIntelligencePackSchema.safeParse(pack());
    expect(ok.success).toBe(true);
    const bad = (over: Record<string, unknown>) => ReferenceIntelligencePackSchema.safeParse(pack(over)).error?.issues.map((i) => i.message) ?? [];
    expect(bad({ containsCopiedProtectedExpression: true }).length).toBe(1);
    expect(bad({ facts: [{ kind: 'STYLE_RULE', statement: 'Una afirmación suficientemente larga.', sourceKeys: ['other'], restatedInOwnWords: true }] })).toEqual(['FACT_SOURCE_NOT_IN_PACK']);
    expect(bad({ facts: [{ kind: 'STYLE_RULE', statement: 'Una afirmación suficientemente larga.', sourceKeys: ['cb-paa-guia-2021'], restatedInOwnWords: false }] }).length).toBe(1);
    expect(bad({ sources: [source(), source()] })).toContain('DUPLICATE_SOURCE');
    expect(bad({ sources: [source({ permittedUse: 'ADAPTATION_LICENSED' })] })).toEqual(['LICENCE_REFERENCE_REQUIRED']);
  });

  it('an external pedagogical reference is reference-only, and teaches nothing until its access is validated', () => {
    const external = (over: Record<string, unknown> = {}) => source({ sourceKey: 'ext-ref', sourceType: 'PEDAGOGICAL_REFERENCE', title: 'External reference', publisher: 'Third party', sourceAccess: 'LICENSED_SOURCE', ...over });
    const msgs = (p: unknown) => ReferenceIntelligencePackSchema.safeParse(p).error?.issues.map((i) => i.message) ?? [];
    expect(msgs(pack({ sources: [source(), external()] }))).toEqual([]);
    expect(msgs(pack({ sources: [source(), external({ permittedUse: 'REPRODUCTION_LICENSED', licenceReference: 'L-1' })] }))).toEqual(['PEDAGOGICAL_REFERENCE_IS_REFERENCE_ONLY']);
    const listedOnly = pack({ sources: [source(), external({ permittedUse: 'ACCESS_NOT_VALIDATED' })] });
    expect(msgs(listedOnly)).toEqual([]);
    expect(msgs({ ...listedOnly, facts: [{ kind: 'COMMON_MISCONCEPTION', statement: 'Un hecho pedagógico cualquiera.', sourceKeys: ['ext-ref'], restatedInOwnWords: true }] })).toEqual(['FACT_FROM_UNVALIDATED_SOURCE']);
  });

  it('a package makes nothing eligible: it has no review, rights, pool or eligibility field, and writes nowhere', () => {
    expect(NOT_ESTABLISHED_BY_A_PACKAGE).toEqual(['HUMAN_REVIEW', 'PRIMARY_ATTRIBUTION', 'TOPIC_LINK', 'REUSE_RIGHTS', 'ORIGINALITY', 'POOL_MEMBERSHIP', 'PILOT_ELIGIBILITY']);
    expect(issues(pkg({ reuseRights: 'STUDYUS_OWNED' })).length).toBeGreaterThan(0);
    expect(issues(pkg({ approved: true })).length).toBeGreaterThan(0);
    const src = code('src/lib/exam-core/question-bank/production/draft-package.ts');
    expect(src).not.toMatch(/from '@\/lib\/db'|\bquery\(|INSERT|UPDATE /);
  });
});
