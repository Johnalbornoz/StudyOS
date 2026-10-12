/**
 * Question Production OS (/ QB-R2B): one authoring contract --
 *   RequirementCell -> GenerationRequest -> QuestionCandidate -> ValidatedQuestionCandidate -> HumanReviewPackage
 * -- the PAA backlog resolved into cells, the automated gates, and the 24-item pilot batch as a planning artifact.
 * Everything here is planning and dry run: nothing reads or writes a database.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PAA_DOMAINS, PAA_SECTIONS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { PRODUCTION_POOLS, PRODUCTION_POOL_POLICY, validateRequirementCell, type RequirementCell } from '@/lib/exam-core/question-bank/production/requirement-cell';
import { LOGICAL_POOLS, PILOT_POOL_POLICY } from '@/lib/assessment-blueprint/protected/pools';
import { buildPaaBacklog, paaBacklogViolations, paaCellViolations, PAA_BACKLOG_POLICY, PAA_BACKLOG_TOTAL, summarizePaaBacklog } from '@/lib/exam-core/question-bank/production/paa-backlog';
import { PAA_CONCEPT_DEMAND, PAA_MOCK_DEMAND } from '@/lib/exam-core/question-bank/production/paa-backlog-data';
import { PAA_CONCEPT_IDENTITIES } from '@/lib/exam-core/question-bank/production/paa-concept-identity';
import { bindPaaCells, paaCellSetViolations, PAA_SECTION_AWAITING_CUTOVER, resolvePaaRequirementCells, stimulusPlanOf } from '@/lib/exam-core/question-bank/production/paa-cells';
import { ReferenceIntelligencePackSchema, PEDAGOGICAL_FACT_KINDS } from '@/lib/exam-core/question-bank/production/reference-pack';
import { GenerationBatchSchema, GenerationRequestSchema, NOT_ESTABLISHED_BY_A_CANDIDATE, QuestionCandidateSchema } from '@/lib/exam-core/question-bank/production/generation-contract';
import { STRUCTURAL_CHECKS, validateCandidateStructure } from '@/lib/exam-core/question-bank/production/structural-validation';
import { evaluateOriginality, textualSimilarity, type ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { evaluateRightsGate, type RightsEvidence } from '@/lib/exam-core/question-bank/production/rights-gate';
import { evaluatePoolAssignment, type PoolAssignmentFacts } from '@/lib/exam-core/question-bank/production/pool-assignment';
import { PILOT_CONDITIONS, projectPilotEligibility, type ProjectionInput } from '@/lib/exam-core/question-bank/production/pilot-projection';
import { buildHumanReviewPackage, REVIEWER_ACTIONS } from '@/lib/exam-core/question-bank/production/review-package';
import { siblingCorpus, validateQuestionCandidate } from '@/lib/exam-core/question-bank/production/validated-candidate';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-10T12:00:00Z';
const PROD = 'src/lib/exam-core/question-bank/production';

const CELLS = resolvePaaRequirementCells();
const cellOf = (key: string): RequirementCell => CELLS.find((c) => c.cellKey === key)!;
const PERCENT = CELLS.find((c) => c.intendedPool === 'PRACTICE' && c.primaryConcept.stableId === 'math.num.percent' && c.difficultyBand === 'STANDARD')!;
const cell = (over: Record<string, unknown> = {}) => ({ ...PERCENT, ...over });
const source = (over: Record<string, unknown> = {}) => ({ sourceKey: 'studyus.catalogue', sourceType: 'STUDYUS_INTERNAL', title: 'Certified PAA catalogue', publisher: 'StudyUs', locator: null, sourceAccess: 'NOT_APPLICABLE', permittedUse: 'REFERENCE_ONLY', accessStatus: 'NOT_REQUIRED', referencedAt: NOW, licenceReference: null, ...over });
const pack = (over: Record<string, unknown> = {}) => ({ v: 1, sources: [source()], facts: [{ kind: 'CONCEPT_DEFINITION', statement: 'Un porcentaje expresa una parte de cada cien.', sourceKeys: ['studyus.catalogue'], restatedInOwnWords: true }], containsCopiedProtectedExpression: false, ...over });
const candidate = (over: Record<string, unknown> = {}) => ({
  v: 2, candidateKey: 'cand-1', cellKey: PERCENT.cellKey, batchKey: 'batch-1', stem: 'En una clase de 40 estudiantes, 18 practican un deporte. ¿Qué porcentaje de la clase practica un deporte?',
  responseFormat: 'MULTIPLE_CHOICE', options: [{ id: 'A', text: '18 %' }, { id: 'B', text: '40 %' }, { id: 'C', text: '45 %' }, { id: 'D', text: '55 %' }], answerKey: 'C', rationale: '18 de 40 equivale a 45 de cada 100.',
  distractorRationales: { A: 'Toma el número de estudiantes como porcentaje.', B: 'Toma el total como porcentaje.', D: 'Calcula el complemento.' }, primaryConceptStableId: 'math.num.percent', proposedSupportingConceptStableIds: ['math.num.fractions-decimals'],
  difficultyBand: 'STANDARD', marks: 1, language: 'es', stimulusKey: null, assets: [], provenance: 'STUDYUS_GENERATED', lineage: { kind: 'MODEL', model: 'm', promptVersion: '1', runId: 'run-1', requestedBy: 'operator', generatedAt: NOW, humanEdits: [] }, ...over,
});
const parsedCandidate = (over: Record<string, unknown> = {}) => QuestionCandidateSchema.parse(candidate(over));
const BINDING = { environmentFingerprint: 'test', examVersionId: U(1), topicNodeId: U(2), domainNodeId: U(3), primaryConceptId: U(4) };

describe('one authoring contract', () => {
  it('there is no second draft-package model: the flow is cell -> request -> candidate -> validated candidate -> review package', () => {
    const files = readdirSync(join(ROOT, PROD)).filter((f) => f.endsWith('.ts')).sort();
    // QB-R2C adds the planning primitive (stimulus plan, PAA generation plan), the concept profiles, structured stimuli,
    // answer normalisation with its evaluator, the calibration contract, the independent validators and the generator directory.
    expect(files).toEqual([
      'answer-normalization.ts', 'concept-profile.ts', 'difficulty-calibration.ts', 'expression-evaluator.ts', 'generation-contract.ts', 'independent-validators.ts', 'math-construct-registry.ts', 'originality-gate.ts', 'paa-backlog-data.ts', 'paa-backlog.ts', 'paa-cells.ts',
      'paa-concept-identity.ts', 'paa-concept-profiles.ts', 'paa-generation-plan.ts', 'pilot-projection.ts', 'pool-assignment.ts', 'reference-pack.ts', 'requirement-cell.ts', 'review-package.ts', 'rights-gate.ts', 'specification-candidate.ts', 'specification-validators-r3.ts', 'specification-validators-r4.ts', 'specification-validators.ts',
      'stimulus-plan.ts', 'stimulus-spec.ts', 'structural-validation.ts', 'validated-candidate.ts',
    ]);
    expect(readdirSync(join(ROOT, PROD), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)).toEqual(['generator']);
    // QB-R2D adds, additively, the specification-driven path: its contract, its construct vocabulary, its validators and one generator file.
    expect(readdirSync(join(ROOT, PROD, 'generator')).sort()).toEqual(['generate-candidates.ts', 'provider.ts', 'response-schema.ts', 'specification-generation-v2.ts', 'specification-generation-v3.ts', 'specification-generation-v4.ts', 'specification-generation.ts', 'templates.ts']);
    expect(existsSync(join(ROOT, PROD, 'draft-package.ts'))).toBe(false);
    const all = files.map((f) => read(`${PROD}/${f}`)).join('\n');
    expect(all).not.toMatch(/ProductionDraftPackage|validateDraftPackage|GeneratedCandidate\b/);
    for (const name of ['RequirementCellSchema', 'GenerationRequestSchema', 'QuestionCandidateSchema', 'ValidatedQuestionCandidate', 'HumanReviewPackage']) expect(all, name).toContain(name);
  });

  it('planning and dry run write nowhere: no production module imports the database, runs a query or reads the environment', () => {
    const walk = (d: string): string[] => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [`${d}/${e.name}`] : []));
    // every production module, the generator directory included: no database, no query, no environment, no network, no file system
    const production = walk(PROD);
    expect(production.length).toBe(36); // post-canary: +1 generator file (version 4, for future runs); // QB-R2D: +3 modules and +1 generator file; QB-R2E: +1 module (validators revision 3) and +1 generator file (version 2); QB-R2F: +1 module (validators revision 4) and +1 generator file (version 3); all pure
    for (const f of production) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/from '@\/lib\/db'|\bquery\(|INSERT INTO|UPDATE \w+ SET|DELETE FROM|process\.env|fetch\(|from '(node:)?fs'|from 'pg'|@\/lib\/ai\/|\bDate\.now\(|new Date\(\)|Math\.random\(/);
      expect(src, f).not.toMatch(/@\/lib\/assessment-blueprint/);
    }
    expect(walk('src').filter((f) => !f.startsWith(PROD) && /question-bank\/production\//.test(read(f)))).toEqual([]);
    // the QB-R2C scripts open no database and no network: they read and write files under docs/exams/question-bank only
    for (const s of ['scripts/operations/qb-paa-generation-plan.ts', 'scripts/operations/qb-r2c/pilot-v2-run.ts', 'scripts/operations/qb-r2c/pilot-v2-pipeline.ts']) {
      const src = read(s).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, s).not.toMatch(/from 'pg'|DATABASE_URL|process\.env|fetch\(|@\/lib\/ai\/|@\/lib\/db/);
    }
    expect(read('scripts/operations/qb-r2c/pilot-v2-pipeline.ts').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/from '(node:)?fs'|writeFileSync|readFileSync/);
    // the scripts that touch a database open a session that refuses writes, and state no mutation
    for (const s of ['scripts/operations/qb-paa-requirement-cells.ts', 'scripts/operations/qb-r2b/pilot-evaluate.ts']) {
      const src = read(s);
      expect(src, s).toMatch(/default_transaction_read_only=on/);
      expect(src.replace(/\/\*[\s\S]*?\*\//g, ''), s).not.toMatch(/INSERT INTO|UPDATE \w+ SET|DELETE FROM|BEGIN|COMMIT/);
    }
  });
});

describe('requirement cell', () => {
  it('carries every field a cell needs, and refuses one that is missing or unknown', () => {
    expect(validateRequirementCell(cell())).toMatchObject({ ok: true });
    for (const f of ['examFamily', 'examConfigKey', 'sectionCode', 'domainNodeCode', 'topicNodeCode', 'primaryConcept', 'examSkill', 'count', 'intendedPool', 'responseFormat', 'responseFormatAuthority', 'difficultyBand', 'difficultyBasis', 'stimulus', 'assets', 'authority', 'blueprint', 'curriculumCurrentness', 'binding']) {
      const without = cell() as Record<string, unknown>;
      delete without[f];
      expect(validateRequirementCell(without).ok, f).toBe(false);
    }
    expect(validateRequirementCell(cell({ secondaryPrimary: 'x' })).ok).toBe(false);
  });

  it('one Topic, one PRIMARY concept, a count; difficulty is always an editorial estimate; a mock cell names its blueprint', () => {
    const issues = (over: Record<string, unknown>) => { const r = validateRequirementCell(cell(over)); return r.ok ? [] : r.issues; };
    expect(issues({ count: 0 }).length).toBeGreaterThan(0);
    expect(issues({ topicNodeCode: ['paa.topic.029', 'paa.topic.030'] }).length).toBeGreaterThan(0);
    expect(issues({ difficultyBasis: 'OFFICIAL' }).length).toBeGreaterThan(0);
    expect(issues({ intendedPool: 'FULL_MOCK_1' })).toEqual(['blueprint: MOCK_CELL_NEEDS_BLUEPRINT']);
    expect(issues({ blueprint: { purpose: 'FULL', formNumber: 1 } })).toEqual(['blueprint: PER_CONCEPT_CELL_HAS_NO_BLUEPRINT']);
    expect(issues({ intendedPool: 'REDUCED_MOCK', blueprint: { purpose: 'FULL', formNumber: 1 } })).toEqual(['blueprint: BLUEPRINT_PURPOSE_DOES_NOT_MATCH_POOL']);
    expect(issues({ stimulus: { class: 'STIMULUS_REQUIRED' } }).length).toBeGreaterThan(0);
    expect(issues({ stimulus: { class: 'STIMULUS_REQUIRED', kind: 'PASSAGE' } })).toEqual([]);
    expect(issues({ intendedPool: 'EVERYWHERE' }).length).toBeGreaterThan(0);
    expect(PRODUCTION_POOLS).toEqual(LOGICAL_POOLS);
    expect(PRODUCTION_POOL_POLICY).toEqual({ id: PILOT_POOL_POLICY.id, version: PILOT_POOL_POLICY.version, overlap: PILOT_POOL_POLICY.overlap });
  });

  it('a PAA cell sits in the certified hierarchy, checked by code', () => {
    expect(paaCellViolations(PERCENT)).toEqual([]);
    expect(paaCellViolations({ ...PERCENT, topicNodeCode: 'paa.topic.001' })).toEqual(['TOPIC_NOT_IN_DOMAIN']);
    expect(paaCellViolations({ ...PERCENT, sectionCode: 'paa.sec.lectura' })).toEqual(['DOMAIN_NOT_IN_SECTION']);
    expect(paaCellViolations({ ...PERCENT, examFamily: 'ICFES' })).toEqual(['NOT_A_PAA_CELL']);
  });
});

describe('PAA requirement cells -- the 353 rows resolved, nothing left open', () => {
  const total = (xs: readonly RequirementCell[]) => xs.reduce((n, c) => n + c.count, 0);
  const by = (f: (c: RequirementCell) => string) => CELLS.reduce<Record<string, number>>((m, c) => ((m[f(c)] = (m[f(c)] ?? 0) + c.count), m), {});

  it('865 items, pool by pool, exactly the backlog', () => {
    expect(total(CELLS)).toBe(865);
    expect(by((c) => c.intendedPool)).toEqual({ PRACTICE: 183, DIAGNOSTIC: 122, VERIFICATION: 122, REDUCED_MOCK: 88, FULL_MOCK_1: 175, FULL_MOCK_2: 175 });
    expect(by((c) => c.sectionCode)).toEqual({ 'paa.sec.lectura': 197, 'paa.sec.redaccion': 97, 'paa.sec.matematicas': 383, 'paa.sec.ingles': 188 });
    expect(paaCellSetViolations(CELLS)).toEqual([]);
    for (const c of CELLS) expect(validateRequirementCell(c).ok, c.cellKey).toBe(true);
  });

  it('each mock form keeps its section totals: Full 45 / 25 / 55 / 50, Reduced 23 / 12 / 28 / 25', () => {
    const per = (pool: string) => PAA_SECTIONS.map((s) => total(CELLS.filter((c) => c.intendedPool === pool && c.sectionCode === s.code)));
    expect(per('FULL_MOCK_1')).toEqual([45, 25, 55, 50]);
    expect(per('FULL_MOCK_2')).toEqual([45, 25, 55, 50]);
    expect(per('REDUCED_MOCK')).toEqual([23, 12, 28, 25]);
  });

  it('every cell has one Topic, one Domain (the Topic\'s), one PRIMARY concept (the Topic\'s), and a canonical identity', () => {
    for (const c of CELLS) {
      const topic = PAA_TOPICS.find((t) => t.code === c.topicNodeCode)!;
      expect(topic.domainCode, c.cellKey).toBe(c.domainNodeCode);
      expect(PAA_DOMAINS.find((d) => d.code === c.domainNodeCode)!.sectionCode).toBe(c.sectionCode);
      expect(topic.certifiedConceptId).toBe(c.primaryConcept.stableId);
      expect(PAA_CONCEPT_IDENTITIES.find((x) => x.stableId === c.primaryConcept.stableId)).toMatchObject({ canonicalSubject: c.primaryConcept.canonicalSubject, canonicalName: c.primaryConcept.canonicalName });
    }
    expect(new Set(CELLS.map((c) => c.primaryConcept.stableId)).size).toBe(61);
    // 82 Topics take items; the two English Topics with no certified concept take none
    expect(new Set(CELLS.map((c) => c.topicNodeCode)).size).toBe(82);
    expect(PAA_TOPICS.filter((t) => !CELLS.some((c) => c.topicNodeCode === t.code)).map((t) => t.certifiedConceptId)).toEqual([null, null]);
  });

  it('zero intentional overlap: a cell is in one pool, keys are unique, per-concept pools keep 3 / 2 / 2 per concept', () => {
    expect(new Set(CELLS.map((c) => c.cellKey)).size).toBe(CELLS.length);
    expect(CELLS.every((c) => c.cellKey.startsWith(`${c.intendedPool}|`))).toBe(true);
    for (const d of PAA_CONCEPT_DEMAND) {
      const n = (pool: string) => total(CELLS.filter((c) => c.intendedPool === pool && c.primaryConcept.stableId === d.conceptStableId));
      expect([n('PRACTICE'), n('DIAGNOSTIC'), n('VERIFICATION')], d.conceptStableId).toEqual([3, 2, 2]);
    }
  });

  it('Topics are not chosen arbitrarily: items are spread over the Topics that fit, and the result is deterministic', () => {
    expect(resolvePaaRequirementCells()).toEqual(CELLS);
    // a concept certified under several Topics has its per-concept items on more than one of them
    const topicsOf = (stable: string) => PAA_TOPICS.filter((t) => t.certifiedConceptId === stable).length;
    for (const d of PAA_CONCEPT_DEMAND.filter((x) => topicsOf(x.conceptStableId) >= 3)) {
      const used = new Set(CELLS.filter((c) => !c.blueprint && c.primaryConcept.stableId === d.conceptStableId).map((c) => c.topicNodeCode));
      expect(used.size, d.conceptStableId).toBeGreaterThanOrEqual(3);
    }
    // within a mock form, a Domain's items cover its Topics as evenly as the count allows
    for (const pool of ['FULL_MOCK_1', 'FULL_MOCK_2', 'REDUCED_MOCK']) for (const dom of PAA_DOMAINS) {
      const counts = PAA_TOPICS.filter((t) => t.domainCode === dom.code && t.certifiedConceptId).map((t) => total(CELLS.filter((c) => c.intendedPool === pool && c.topicNodeCode === t.code)));
      expect(Math.max(...counts) - Math.min(...counts), `${pool} ${dom.code}`).toBeLessThanOrEqual(1);
    }
  });

  it('format and difficulty are StudyUs planning values, tagged as such; nothing is claimed official', () => {
    expect(CELLS.every((c) => c.difficultyBasis === 'EDITORIAL_ESTIMATE' && c.responseFormatAuthority === 'STUDYUS_POLICY' && c.authority.kind === 'STUDYUS_POLICY')).toBe(true);
    expect(by((c) => c.responseFormat)).toEqual({ MULTIPLE_CHOICE: 840, STUDENT_PRODUCED: 25 });
    expect(CELLS.filter((c) => c.responseFormat === 'STUDENT_PRODUCED').every((c) => c.sectionCode === 'paa.sec.matematicas' && c.blueprint !== null)).toBe(true);
    expect(total(CELLS.filter((c) => c.responseFormat === 'STUDENT_PRODUCED'))).toBe(PAA_MOCK_DEMAND.filter((m) => m.responseFormat === 'STUDENT_PRODUCED').reduce((n, m) => n + m.count, 0));
  });

  it('every cell is STANDALONE, STIMULUS_REQUIRED or STIMULUS_OPTIONAL, with a kind where there is a stimulus', () => {
    expect(by((c) => c.stimulus.class)).toEqual({ STANDALONE: 297, STIMULUS_REQUIRED: 487, STIMULUS_OPTIONAL: 81 });
    expect(stimulusPlanOf('none')).toEqual({ class: 'STANDALONE' });
    expect(stimulusPlanOf('paired passages')).toEqual({ class: 'STIMULUS_REQUIRED', kind: 'PAIRED_PASSAGE' });
    expect(stimulusPlanOf('none (graph at times)')).toEqual({ class: 'STIMULUS_OPTIONAL', kind: 'GRAPH' });
    expect(stimulusPlanOf('numbered text segment')).toEqual({ class: 'STIMULUS_REQUIRED', kind: 'NUMBERED_TEXT' });
    expect(() => stimulusPlanOf('hologram')).toThrow(/STIMULUS_NOTE_UNREADABLE/);
    for (const d of PAA_CONCEPT_DEMAND) expect(() => stimulusPlanOf(d.stimulusGuidance), d.stimulusGuidance).not.toThrow();
  });

  it('Matemáticas cells are marked blocked until the PAA cutover, and only they are', () => {
    expect(by((c) => c.curriculumCurrentness)).toEqual({ CURRENT: 482, CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER: 383 });
    expect(CELLS.every((c) => (c.sectionCode === PAA_SECTION_AWAITING_CUTOVER) === (c.curriculumCurrentness !== 'CURRENT'))).toBe(true);
  });

  it('three certified mathematics concepts live in the canonical subject Mathematics, not Matemáticas', () => {
    expect(by((c) => c.primaryConcept.canonicalSubject)).toEqual({ 'Lectura crítica': 197, Redacción: 97, Matemáticas: 355, Mathematics: 28, English: 188 });
    expect(PAA_CONCEPT_IDENTITIES.filter((x) => x.canonicalSubject === 'Mathematics').map((x) => x.stableId)).toEqual(['math.alg.quadratics', 'math.fun.exponential', 'math.trig.ratios']);
  });

  it('binding attaches an environment\'s row ids or reports what is missing; it never half-binds', () => {
    const topics = new Map(PAA_TOPICS.map((t, i) => [t.code, { topicNodeId: U(1000 + i), domainNodeId: U(2000 + i) }]));
    const concepts = new Map(PAA_CONCEPT_IDENTITIES.map((c, i) => [`${c.canonicalSubject}|${c.canonicalName}`, U(3000 + i)]));
    const all = bindPaaCells(CELLS, { environmentFingerprint: 'env', examVersionId: U(1), topics, concepts });
    expect(all.unresolved).toEqual([]);
    expect(all.bound).toHaveLength(CELLS.length);
    expect(all.bound.every((c) => c.binding?.environmentFingerprint === 'env' && validateRequirementCell(c).ok)).toBe(true);
    concepts.delete('Matemáticas|Porcentajes');
    const partial = bindPaaCells(CELLS, { environmentFingerprint: 'env', examVersionId: U(1), topics, concepts });
    expect(partial.unresolved.every((u) => u.missing === 'CONCEPT' && u.cellKey.includes('math.num.percent'))).toBe(true);
    expect(partial.bound.length + partial.unresolved.length).toBe(CELLS.length);
    expect(CELLS.every((c) => c.binding === null)).toBe(true);
  });

  it('the concept identities are the F-DATA table, row by row', () => {
    const doc = read('docs/exams/question-bank/PAA_F_DATA_FOUNDATION.md');
    const rows = doc.slice(doc.indexOf('## Stable identifiers'), doc.indexOf('## Deliberately not done')).split('\n').filter((l) => l.startsWith('| `'));
    expect(rows).toHaveLength(61);
    expect(rows.map((l) => { const c = l.split('|').map((x) => x.trim()); const [subject, ...name] = c[3].split(' / '); return { stableId: c[1].replace(/`/g, ''), canonicalSubject: subject, canonicalName: name.join(' / ') }; })).toEqual([...PAA_CONCEPT_IDENTITIES]);
  });
});

describe('reference intelligence pack', () => {
  const msgs = (p: unknown) => ReferenceIntelligencePackSchema.safeParse(p).error?.issues.map((i) => i.message) ?? [];
  const external = (over: Record<string, unknown> = {}) => source({ sourceKey: 'ext-ref', sourceType: 'PEDAGOGICAL_REFERENCE', title: 'External reference', publisher: 'Third party', sourceAccess: 'LICENSED_SOURCE', accessStatus: 'VALIDATED', ...over });

  it('carries the kinds of fact authoring needs, each restated and tied to a source', () => {
    for (const k of ['CURRICULUM_FACT', 'LEARNING_OBJECTIVE', 'CONCEPT_DEFINITION', 'PREREQUISITE', 'COMMON_MISCONCEPTION', 'REASONING_SKILL', 'EXPECTED_DIFFICULTY', 'APPROPRIATE_CONTEXT', 'RESPONSE_FORMAT_GUIDANCE', 'STIMULUS_GUIDANCE']) expect(PEDAGOGICAL_FACT_KINDS, k).toContain(k);
    expect(msgs(pack())).toEqual([]);
    expect(msgs(pack({ facts: [{ kind: 'STYLE_RULE', statement: 'Una afirmación suficientemente larga.', sourceKeys: ['other'], restatedInOwnWords: true }] }))).toEqual(['FACT_SOURCE_NOT_IN_PACK']);
    expect(msgs(pack({ sources: [source(), source()] }))).toContain('DUPLICATE_SOURCE');
  });

  it('a pedagogical reference source: identity, access status, permitted use, restated facts, reference timestamp', () => {
    expect(msgs(pack({ sources: [source(), external()] }))).toEqual([]);
    const deferred = external({ permittedUse: 'ACCESS_NOT_VALIDATED', accessStatus: 'NOT_VALIDATED', referencedAt: null });
    expect(msgs(pack({ sources: [source(), deferred] }))).toEqual([]);
    expect(msgs({ ...pack({ sources: [source(), deferred] }), facts: [{ kind: 'COMMON_MISCONCEPTION', statement: 'Un hecho pedagógico cualquiera.', sourceKeys: ['ext-ref'], restatedInOwnWords: true }] })).toEqual(['FACT_FROM_UNVALIDATED_SOURCE']);
    expect(msgs(pack({ sources: [source(), { ...deferred, referencedAt: NOW }] }))).toEqual(['UNVALIDATED_SOURCE_NOT_CONSULTED']);
    expect(msgs(pack({ sources: [source(), external({ accessStatus: 'NOT_REQUIRED' })] }))).toEqual(['PEDAGOGICAL_REFERENCE_NEEDS_ACCESS_VALIDATION']);
    expect(msgs(pack({ sources: [source(), external({ permittedUse: 'REPRODUCTION_LICENSED', licenceReference: 'L' })] }))).toEqual(['PEDAGOGICAL_REFERENCE_IS_REFERENCE_ONLY']);
    expect(msgs(pack({ sources: [source({ permittedUse: 'ADAPTATION_LICENSED' })] }))).toEqual(['LICENCE_REFERENCE_REQUIRED']);
  });

  it('reference, provenance and rights are three facts: a pack has no provenance or rights field and holds no copied expression', () => {
    expect(msgs({ ...pack(), provenance: 'STUDYUS_AUTHORED' }).length).toBeGreaterThan(0);
    expect(msgs({ ...pack(), reuseRights: 'STUDYUS_OWNED' }).length).toBeGreaterThan(0);
    expect(msgs(pack({ containsCopiedProtectedExpression: true })).length).toBe(1);
    expect(msgs(pack({ sources: [source({ questionText: 'copied question' })] })).length).toBeGreaterThan(0);
  });
});

describe('generation contract', () => {
  const request = (over: Record<string, unknown> = {}) => ({ v: 2, cell: cell({ binding: BINDING }), references: pack(), policy: { policyId: 'gen', policyVersion: '1', author: { kind: 'MODEL', model: 'm', promptVersion: '1', requestedBy: 'operator' }, language: 'es', copyReferenceExpression: false }, desiredCount: 1, ...over });
  const msgs = (r: unknown) => GenerationRequestSchema.safeParse(r).error?.issues.map((i) => i.message) ?? [];

  it('input: a BOUND cell, a pack, a policy and a count no larger than the cell needs; copying a reference cannot be allowed', () => {
    expect(msgs(request())).toEqual([]);
    expect(msgs(request({ cell: cell() }))).toEqual(['CELL_NOT_BOUND']);
    expect(msgs(request({ desiredCount: 5 }))).toEqual(['MORE_THAN_THE_CELL_NEEDS']);
    expect(GenerationRequestSchema.safeParse(request({ policy: { ...request().policy, copyReferenceExpression: true } })).success).toBe(false);
    for (const f of ['cell', 'references', 'policy', 'desiredCount']) { const r = request() as Record<string, unknown>; delete r[f]; expect(GenerationRequestSchema.safeParse(r).success, f).toBe(false); }
  });

  it('output: a candidate has stem, format, options, key, rationale, distractor rationales, target concept, proposals, difficulty, stimulus, assets, provenance and lineage', () => {
    expect(QuestionCandidateSchema.safeParse(candidate()).success).toBe(true);
    for (const f of ['stem', 'responseFormat', 'options', 'answerKey', 'rationale', 'distractorRationales', 'primaryConceptStableId', 'proposedSupportingConceptStableIds', 'difficultyBand', 'stimulusKey', 'assets', 'provenance', 'lineage']) { const c = candidate() as Record<string, unknown>; delete c[f]; expect(QuestionCandidateSchema.safeParse(c).success, f).toBe(false); }
    expect(NOT_ESTABLISHED_BY_A_CANDIDATE).toEqual(['HUMAN_REVIEW', 'PRIMARY_ATTRIBUTION', 'TOPIC_LINK', 'REUSE_RIGHTS', 'ORIGINALITY_RECORD', 'POOL_MEMBERSHIP', 'PILOT_ELIGIBILITY']);
    expect(QuestionCandidateSchema.safeParse(candidate({ approved: true })).success).toBe(false);
  });

  it('generated stays STUDYUS_GENERATED after human editing; a person\'s own draft is STUDYUS_AUTHORED', () => {
    const edited = candidate({ lineage: { ...candidate().lineage, humanEdits: [{ editorUserId: U(8), editedAt: NOW }] } });
    expect(QuestionCandidateSchema.safeParse(edited).success).toBe(true);
    expect(QuestionCandidateSchema.safeParse({ ...edited, provenance: 'STUDYUS_AUTHORED' }).error?.issues.map((i) => i.message)).toEqual(['PROVENANCE_DOES_NOT_MATCH_LINEAGE']);
    expect(QuestionCandidateSchema.safeParse(candidate({ provenance: 'STUDYUS_AUTHORED', lineage: { kind: 'HUMAN', authorUserId: U(7), writtenAt: NOW } })).success).toBe(true);
    expect(QuestionCandidateSchema.safeParse(candidate({ provenance: 'OFFICIAL' })).success).toBe(false);
    expect(QuestionCandidateSchema.safeParse(candidate({ proposedSupportingConceptStableIds: ['math.num.percent'] })).error?.issues.map((i) => i.message)).toEqual(['CONCEPT_LISTED_TWICE']);
  });

  it('a batch holds its stimuli and candidates together', () => {
    const batch = (over: Record<string, unknown> = {}) => ({ v: 2, batchKey: 'batch-1', generatedAt: NOW, stimuli: [], candidates: [candidate()], ...over });
    const m = (b: unknown) => GenerationBatchSchema.safeParse(b).error?.issues.map((i) => i.message) ?? [];
    expect(m(batch())).toEqual([]);
    expect(m(batch({ candidates: [candidate(), candidate()] }))).toEqual(['DUPLICATE_CANDIDATE_KEY']);
    expect(m(batch({ candidates: [candidate({ stimulusKey: 'missing' })] }))).toEqual(['STIMULUS_NOT_IN_BATCH']);
    expect(m(batch({ candidates: [candidate({ batchKey: 'other' })] }))).toEqual(['CANDIDATE_OUTSIDE_BATCH']);
  });
});

describe('automated structural validation', () => {
  const ctx = { hierarchyViolations: paaCellViolations };
  const codes = (over: Record<string, unknown> = {}, c: RequirementCell = PERCENT, extra: Record<string, unknown> = {}) => validateCandidateStructure(parsedCandidate(over), c, { ...ctx, ...extra }).issues.map((i) => `${i.check}:${i.code}`);

  it('a well-formed candidate passes all eleven checks, and a pass is not a human review', () => {
    const r = validateCandidateStructure(parsedCandidate(), PERCENT, ctx);
    expect(r).toMatchObject({ outcome: 'PASS', issues: [], isHumanReview: false });
    expect(r.checksRun).toEqual(STRUCTURAL_CHECKS);
    expect(STRUCTURAL_CHECKS).toHaveLength(11);
    expect(validateCandidateStructure(parsedCandidate(), PERCENT).issues.map((i) => i.code)).toEqual(['HIERARCHY_CHECK_NOT_SUPPLIED']);
  });

  it('each check fails on its own', () => {
    expect(codes({ primaryConceptStableId: 'math.num.fractions-decimals', proposedSupportingConceptStableIds: [] })).toEqual(['ONE_PRIMARY_CONCEPT:PRIMARY_IS_NOT_THE_CELLS']);
    expect(codes({ responseFormat: 'STUDENT_PRODUCED', options: [], answerKey: '45', distractorRationales: {} })).toEqual(['VALID_RESPONSE_FORMAT:FORMAT_IS_NOT_THE_CELLS']);
    expect(codes({ answerKey: 'Z' })).toContain('ANSWER_KEY_CONSISTENT:KEY_IS_NOT_AN_OPTION');
    expect(codes({ options: [{ id: 'A', text: '18 %' }, { id: 'B', text: ' 18  % ' }, { id: 'C', text: '45 %' }, { id: 'D', text: '55 %' }] })).toEqual(['OPTIONS_UNIQUE:DUPLICATE_OPTION_TEXT']);
    expect(codes({ distractorRationales: { A: 'x' } })).toEqual(['ANSWER_KEY_CONSISTENT:DISTRACTOR_RATIONALES_INCOMPLETE']);
    expect(codes({ marks: 5 })).toEqual(['MARK_ALLOCATION:MARKS_OUT_OF_RANGE']);
    expect(codes({ difficultyBand: 'CHALLENGE' })).toEqual(['DIFFICULTY_RANGE:BAND_IS_NOT_THE_CELLS']);
    expect(codes({ rationale: 'ok' })).toEqual(['ANSWER_KEY_CONSISTENT:RATIONALE_MISSING']);
    expect(codes({ stimulusKey: 's1' }, PERCENT, { stimuli: [{ stimulusKey: 's1', kind: 'PASSAGE', language: 'es', parts: [{ label: null, partKind: 'TEXT', text: 'x' }], provenance: 'STUDYUS_GENERATED' }] })).toEqual(['STIMULUS_REQUIREMENT:UNREQUESTED_STIMULUS']);
  });

  it('a stimulus-required cell needs a stimulus of the cell\'s kind; an optional one accepts either', () => {
    const required = CELLS.find((c) => c.stimulus.class === 'STIMULUS_REQUIRED' && c.stimulus.kind === 'PASSAGE' && c.intendedPool === 'PRACTICE')!;
    const optional = CELLS.find((c) => c.stimulus.class === 'STIMULUS_OPTIONAL' && c.intendedPool === 'PRACTICE')!;
    const fit = (c: RequirementCell, over: Record<string, unknown> = {}) => ({ cellKey: c.cellKey, primaryConceptStableId: c.primaryConcept.stableId, proposedSupportingConceptStableIds: [], difficultyBand: c.difficultyBand, ...over });
    const poem = [{ stimulusKey: 's1', kind: 'POEM' as const, language: 'es', parts: [{ label: null, partKind: 'VERSE' as const, text: 'x' }], provenance: 'STUDYUS_GENERATED' as const }];
    expect(codes(fit(required), required)).toEqual(['STIMULUS_REQUIREMENT:STIMULUS_MISSING']);
    expect(codes(fit(required, { stimulusKey: 's1' }), required, { stimuli: poem })).toEqual(['STIMULUS_REQUIREMENT:STIMULUS_KIND_IS_NOT_THE_CELLS']);
    expect(codes(fit(required, { stimulusKey: 's1' }), required, { stimuli: [{ ...poem[0], kind: 'PASSAGE' }] })).toEqual([]);
    expect(codes(fit(optional), optional)).toEqual([]);
  });

  it('a mock cell is unsupported for assembly until a blueprint variant is published; a draft only notes it', () => {
    const mock = CELLS.find((c) => c.intendedPool === 'FULL_MOCK_1' && c.responseFormat === 'MULTIPLE_CHOICE' && c.stimulus.class === 'STANDALONE')!;
    const fit = { cellKey: mock.cellKey, primaryConceptStableId: mock.primaryConcept.stableId, proposedSupportingConceptStableIds: [], difficultyBand: mock.difficultyBand };
    expect(codes(fit, mock)).toEqual(['SUPPORTED_BLUEPRINT_CELL:BLUEPRINT_VARIANT_NOT_PUBLISHED']);
    expect(codes(fit, mock, { draftStage: true })).toEqual([]);
    expect(codes(fit, mock, { blueprintVariantPublished: true })).toEqual([]);
  });
});

describe('validated candidate and human review package', () => {
  const validated = (over: Record<string, unknown> = {}, corpus: ComparisonEntry[] = []) => validateQuestionCandidate({ candidate: parsedCandidate(over), cell: PERCENT, corpus, structuralContext: { hierarchyViolations: paaCellViolations } });

  it('the automated status: ready, to a person for originality, back to generation, or rejected -- never "reviewed"', () => {
    expect(validated()).toMatchObject({ status: 'READY_FOR_HUMAN_REVIEW', humanReviewed: false });
    expect(validated({ marks: 9 }).status).toBe('NEEDS_REGENERATION');
    const same = [{ source: 'INTERNAL_QUESTION_BANK' as const, key: 'k', comparisonPermitted: true, text: [candidate().stem as string, '18 %', '40 %', '45 %', '55 %'].join(' \n ') }];
    expect(validated({}, same).status).toBe('REJECTED');
    expect(validated({ marks: 9 }, same).status).toBe('REJECTED');
    expect(siblingCorpus(parsedCandidate(), [parsedCandidate(), parsedCandidate({ candidateKey: 'cand-2' })]).map((e) => `${e.source}:${e.key}`)).toEqual(['GENERATION_BATCH_SIBLING:cand-2']);
  });

  it('the package shows what a reviewer needs, marks attribution as not reviewed, and cannot be acted on without a qualified reviewer', () => {
    const build = (over: Record<string, unknown> = {}) => buildHumanReviewPackage({ validated: validated(), cell: PERCENT, stimuli: [], references: ReferenceIntelligencePackSchema.parse(pack()), rights: null, ingested: false, qualifiedReviewerAvailable: false, ...over });
    const p = build();
    expect(p.question.stem).toContain('40 estudiantes');
    expect(p.answer.answerKey).toBe('C');
    expect(Object.keys(p.answer.distractorRationales).sort()).toEqual(['A', 'B', 'D']);
    expect(p.curriculum).toMatchObject({ domainNodeCode: PERCENT.domainNodeCode, topicNodeCode: PERCENT.topicNodeCode, curriculumCurrentness: 'CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER' });
    expect(p.attribution).toMatchObject({ targetPrimaryConcept: { stableId: 'math.num.percent', canonicalSubject: 'Matemáticas' }, status: 'TARGET_AND_PROPOSAL__NOT_REVIEWED' });
    expect([p.difficultyBand, p.difficultyBasis, p.provenance.class, p.intendedPool]).toEqual(['STANDARD', 'EDITORIAL_ESTIMATE', 'STUDYUS_GENERATED', 'PRACTICE']);
    expect(p.automatedGates).toMatchObject({ status: 'READY_FOR_HUMAN_REVIEW', isHumanReview: false, originality: { outcome: 'PASS_LOW_SIMILARITY' } });
    expect(p.rights.status).toBe('NOT_EVALUATED');
    expect(p.availableActions).toEqual(REVIEWER_ACTIONS);
    expect(REVIEWER_ACTIONS).toEqual(['APPROVE', 'REJECT', 'REQUEST_REVISION', 'CORRECT_ATTRIBUTION']);
    expect(p.reviewStatus).toBe('BLOCKED_NO_QUALIFIED_REVIEWER');
    expect(build({ qualifiedReviewerAvailable: true }).reviewStatus).toBe('BLOCKED_NOT_INGESTED');
    expect(build({ qualifiedReviewerAvailable: true, ingested: true }).reviewStatus).toBe('AWAITING_HUMAN_REVIEW');
    expect(build({ validated: validated({ marks: 9 }) }).reviewStatus).toBe('BLOCKED_AUTOMATED_GATES');
  });
});

describe('PAA backlog -- 865 unique items, for planning', () => {
  const rows = buildPaaBacklog();
  const s = summarizePaaBacklog(rows);

  it('865 = 427 per-concept items + 438 mock items, by pool', () => {
    expect(s.total).toBe(PAA_BACKLOG_TOTAL);
    expect(s.byPool).toEqual({ PRACTICE: 183, DIAGNOSTIC: 122, VERIFICATION: 122, REDUCED_MOCK: 88, FULL_MOCK_1: 175, FULL_MOCK_2: 175 });
    expect(s.byPool.PRACTICE + s.byPool.DIAGNOSTIC + s.byPool.VERIFICATION).toBe(61 * 7);
    expect(s.concepts).toBe(61);
    expect(s.domains).toBe(17);
    expect(paaBacklogViolations(rows)).toEqual([]);
  });

  it('each mock keeps the official section totals: Full 45 / 25 / 55 / 50, Reduced 23 / 12 / 28 / 25', () => {
    const per = (pool: string) => PAA_SECTIONS.map((sec) => s.byPoolAndSection[`${pool}:${sec.code}`]);
    expect(per('FULL_MOCK_1')).toEqual([45, 25, 55, 50]);
    expect(per('FULL_MOCK_2')).toEqual([45, 25, 55, 50]);
    expect(per('REDUCED_MOCK')).toEqual([23, 12, 28, 25]);
  });

  it('per-concept rows follow the policy 3 / 2 / 2 and point at the concept\'s certified Topics', () => {
    expect(PAA_BACKLOG_POLICY.perConcept).toEqual({ PRACTICE: 3, DIAGNOSTIC: 2, VERIFICATION: 2 });
    for (const c of PAA_CONCEPT_DEMAND) expect([c.practice, c.diagnostic, c.verification], c.conceptStableId).toEqual([3, 2, 2]);
    for (const r of rows.filter((x) => x.conceptStableId)) {
      expect(r.candidateTopicCodes.length, r.rowKey).toBeGreaterThan(0);
      for (const code of r.candidateTopicCodes) expect(PAA_TOPICS.find((t) => t.code === code)!.certifiedConceptId).toBe(r.conceptStableId);
    }
    expect(new Set(PAA_CONCEPT_DEMAND.map((c) => c.conceptStableId))).toEqual(new Set(PAA_TOPICS.map((t) => t.certifiedConceptId).filter(Boolean)));
  });

  it('zero intentional overlap: every row is in one pool, row keys are unique, mock rows name their blueprint', () => {
    expect(PAA_BACKLOG_POLICY.overlap).toBe('ZERO_INTENTIONAL_OVERLAP');
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(rows.length);
    expect(rows.filter((r) => r.blueprint).every((r) => ['REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2'].includes(r.pool))).toBe(true);
    expect(rows.filter((r) => r.pool === 'FULL_MOCK_2').every((r) => r.blueprint?.purpose === 'FULL' && r.blueprint.formNumber === 2)).toBe(true);
    expect(paaBacklogViolations([...rows, rows[0]])).toContain('DUPLICATE_ROW');
    expect(paaBacklogViolations(rows.slice(1))).toContain('TOTAL_IS_NOT_865');
  });

  it('the data is the certified artefacts: concepts CSV for the per-concept part, the requirement matrix for the mocks', () => {
    const csvRows = (p: string) => read(p).trim().split('\n').slice(1);
    expect(csvRows('docs/exams/question-bank/audits/q1-paa/Q1C1_paa_certified_concepts.csv')).toHaveLength(PAA_CONCEPT_DEMAND.length);
    const matrix = csvRows('docs/exams/question-bank/audits/q1-paa/Q1C_paa_requirement_matrix.csv').map((l) => l.split(','));
    const mockTotal = (pool: string) => matrix.filter((r) => r[0] === pool).reduce((n, r) => n + Number(r[r.length - 3]), 0); // a Domain label may hold a comma: count from the end
    expect([mockTotal('FULL_1'), mockTotal('FULL_2'), mockTotal('REDUCED_1')]).toEqual([175, 175, 88]);
    expect(PAA_MOCK_DEMAND.reduce((n, r) => n + r.count, 0)).toBe(438);
    for (const d of PAA_MOCK_DEMAND) expect(PAA_DOMAINS.some((x) => x.code === d.domainCode && x.sectionCode === d.sectionCode), d.domainCode).toBe(true);
  });
});

describe('originality gate', () => {
  const text = candidate().stem as string;
  const entry = (over: Partial<ComparisonEntry>): ComparisonEntry => ({ source: 'INTERNAL_QUESTION_BANK', key: 'item-1', comparisonPermitted: true, text: 'Un tren recorre 120 km en dos horas. ¿Cuál es su velocidad media?', templateFingerprint: 'tpl-other', ...over });

  it('three outcomes: low similarity passes, same shape goes to a person, same wording is rejected', () => {
    expect(evaluateOriginality({ text, templateFingerprint: 'tpl-a' }, [entry({})])).toMatchObject({ outcome: 'PASS_LOW_SIMILARITY', record: { result: 'CLEAR', disposition: 'ACCEPTED' } });
    expect(evaluateOriginality({ text, templateFingerprint: 'tpl-a' }, [entry({ source: 'GENERATION_BATCH_SIBLING', key: 'cand-2', templateFingerprint: 'tpl-a' })])).toMatchObject({ outcome: 'REVIEW_STRUCTURAL_SIMILARITY', record: { result: 'SIMILAR', disposition: null } });
    expect(evaluateOriginality({ text, templateFingerprint: 'tpl-a' }, [entry({ text })])).toMatchObject({ outcome: 'REJECT_TEXTUAL_SIMILARITY', maxSimilarity: 1, record: { result: 'MATCH', disposition: 'REJECTED' } });
    expect(textualSimilarity(text, text.replace('40', '50'))).toBeGreaterThan(0.5);
  });

  it('compares only where permitted: restricted material is skipped and named, never read', () => {
    const r = evaluateOriginality({ text }, [entry({}), entry({ source: 'REFERENCE_SOURCE', key: 'ext-ref', comparisonPermitted: false, text }), entry({ source: 'OFFICIAL_OR_SAMPLE_MATERIAL', key: 'sample', comparisonPermitted: false, text: undefined })]);
    expect(r.outcome).toBe('PASS_LOW_SIMILARITY');
    expect(r.comparedAgainst).toEqual(['INTERNAL_QUESTION_BANK:item-1']);
    expect(r.skippedNotPermitted).toEqual(['REFERENCE_SOURCE:ext-ref', 'OFFICIAL_OR_SAMPLE_MATERIAL:sample']);
  });

  it('the record is the existing schema\'s, and carries keys and a number -- no text', () => {
    const r = evaluateOriginality({ text }, [entry({ text })]);
    expect(Object.keys(r.record).sort()).toEqual(['comparedAgainst', 'disposition', 'maxSimilarity', 'method', 'methodVersion', 'performedByKind', 'result']);
    expect(JSON.stringify(r)).not.toContain('estudiantes');
    expect(read('database/migrations/20261110_1500_qb_review_authority_originality.sql')).toMatch(/result IN \('CLEAR', 'SIMILAR', 'MATCH', 'INCONCLUSIVE'\)/);
    // deterministic, whatever the order of the corpus
    const corpus = [entry({ key: 'b', text }), entry({ key: 'a', text })];
    expect(evaluateOriginality({ text }, corpus)).toEqual(evaluateOriginality({ text }, [...corpus].reverse()));
  });
});

describe('rights gate', () => {
  const evidence = (over: Partial<RightsEvidence> = {}): RightsEvidence => ({
    provenance: 'STUDYUS_AUTHORED', authorshipTermsReference: 'author-agreement-17', sourceUsages: [{ sourceKey: 'cb-paa-guia-2021', sourceAccess: 'PUBLICLY_ACCESSIBLE', usage: 'REFERENCE_ONLY' }],
    originality: { outcome: 'PASS_LOW_SIMILARITY', acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [], ...over,
  });

  it('a person\'s own content with authorship terms, consulted-only sources and accepted originality supports STUDYUS_OWNED', () => {
    expect(evaluateRightsGate(evidence())).toMatchObject({ supportedReuseRights: 'STUDYUS_OWNED', deliverable: true, blockers: [], proposedRecord: { reuseRights: 'STUDYUS_OWNED', sourceAccess: 'NOT_APPLICABLE', rightsHolder: 'StudyUs' } });
    // QB-R2C: a reference string is no longer evidence for a MODEL's output (see qb-r2c-rights-evidence.test.ts)
    expect(evaluateRightsGate(evidence({ provenance: 'STUDYUS_GENERATED', authorshipTermsReference: 'model-terms-2026-01' }))).toMatchObject({ deliverable: false, supportedReuseRights: 'UNKNOWN', blockers: ['MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING'] });
  });

  it('a publicly accessible source is not a right: reading it gives nothing, adapting it without a licence blocks ownership', () => {
    expect(evaluateRightsGate(evidence({ sourceUsages: [{ sourceKey: 's', sourceAccess: 'PUBLICLY_ACCESSIBLE', usage: 'ADAPTED' }] }))).toMatchObject({ deliverable: false, supportedReuseRights: 'UNKNOWN', blockers: ['SOURCE_ADAPTED_OR_REPRODUCED_WITHOUT_LICENCE'], proposedRecord: null });
    expect(evaluateRightsGate(evidence({ provenance: 'LICENSED', sourceUsages: [{ sourceKey: 's', sourceAccess: 'PUBLICLY_ACCESSIBLE', usage: 'REPRODUCED' }] })).blockers).toEqual(['LICENCE_REFERENCE_MISSING', 'RIGHTS_HOLDER_MISSING', 'PERMITTED_USE_MISSING']);
  });

  it('each missing piece of evidence blocks, and blocks the record', () => {
    expect(evaluateRightsGate(evidence({ authorshipTermsReference: null })).blockers).toEqual(['AUTHORSHIP_TERMS_MISSING']);
    expect(evaluateRightsGate(evidence({ originality: null })).blockers).toEqual(['ORIGINALITY_NOT_CHECKED']);
    expect(evaluateRightsGate(evidence({ originality: { outcome: 'REVIEW_STRUCTURAL_SIMILARITY', acceptedByHuman: false } })).blockers).toEqual(['ORIGINALITY_NOT_ACCEPTED']);
    expect(evaluateRightsGate(evidence({ originality: { outcome: 'REVIEW_STRUCTURAL_SIMILARITY', acceptedByHuman: true } })).deliverable).toBe(true);
    expect(evaluateRightsGate(evidence({ originality: { outcome: 'REJECT_TEXTUAL_SIMILARITY', acceptedByHuman: true } })).deliverable).toBe(false);
    expect(evaluateRightsGate(evidence({ dependencies: [{ kind: 'STIMULUS_VERSION', key: 'sv', reuseRights: 'STUDYUS_OWNED' }, { kind: 'ASSET', key: 'a', reuseRights: null }] })).blockers).toEqual(['DEPENDENCY_RIGHTS_NOT_ESTABLISHED']);
    expect(evaluateRightsGate(evidence({ dependencies: [{ kind: 'ASSET', key: 'a', reuseRights: 'UNKNOWN' }] })).deliverable).toBe(false);
  });

  it('third-party content: LICENSED_FOR_USE or OFFICIALLY_AUTHORIZED, with holder, use and licence', () => {
    const lic = { licenceReference: 'LIC-9', rightsHolder: 'Publisher', permittedUse: 'delivery', sourceUsages: [{ sourceKey: 's', sourceAccess: 'LICENSED_SOURCE', usage: 'REPRODUCED' as const }] };
    expect(evaluateRightsGate(evidence({ provenance: 'LICENSED', ...lic })).supportedReuseRights).toBe('LICENSED_FOR_USE');
    expect(evaluateRightsGate(evidence({ provenance: 'OFFICIAL', ...lic })).supportedReuseRights).toBe('OFFICIALLY_AUTHORIZED');
  });
});

describe('pool assignment', () => {
  const facts = (over: Partial<PoolAssignmentFacts> = {}): PoolAssignmentFacts => ({ intendedPool: 'PRACTICE', humanReviewApproved: true, rightsEstablished: true, originalityAccepted: true, activePools: [], stimulusBound: false, stimulusPool: null, ...over });

  it('only after review, rights and originality; to one of the six pools', () => {
    expect(evaluatePoolAssignment(facts())).toMatchObject({ assignable: true, action: 'ASSIGN', subject: 'ITEM', pool: 'PRACTICE', policy: { overlap: 'ZERO_INTENTIONAL_OVERLAP' } });
    expect(evaluatePoolAssignment(facts({ humanReviewApproved: false, rightsEstablished: false, originalityAccepted: false })).blockers).toEqual(['REVIEW_NOT_APPROVED', 'RIGHTS_NOT_ESTABLISHED', 'ORIGINALITY_NOT_ACCEPTED']);
    expect(evaluatePoolAssignment(facts({ intendedPool: 'FULL_MOCK_3' })).blockers).toEqual(['UNKNOWN_POOL']);
    for (const pool of ['PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']) expect(evaluatePoolAssignment(facts({ intendedPool: pool })).assignable, pool).toBe(true);
  });

  it('the production contracts name the same six pools and the same policy as B2', () => {
    expect(PRODUCTION_POOLS).toEqual(LOGICAL_POOLS);
    expect(PRODUCTION_POOL_POLICY).toEqual({ id: PILOT_POOL_POLICY.id, version: PILOT_POOL_POLICY.version, overlap: PILOT_POOL_POLICY.overlap });
  });

  it('zero intentional overlap, and a stimulus group is in one pool as a whole', () => {
    expect(evaluatePoolAssignment(facts({ activePools: ['DIAGNOSTIC'] })).blockers).toEqual(['ALREADY_IN_ANOTHER_POOL']);
    expect(evaluatePoolAssignment(facts({ activePools: ['PRACTICE'] }))).toMatchObject({ assignable: true, action: 'NONE' });
    expect(evaluatePoolAssignment(facts({ stimulusBound: true, stimulusPool: null }))).toMatchObject({ assignable: true, subject: 'STIMULUS', action: 'ASSIGN' });
    expect(evaluatePoolAssignment(facts({ stimulusBound: true, stimulusPool: 'FULL_MOCK_1' })).blockers).toEqual(['STIMULUS_IN_ANOTHER_POOL']);
  });
});

describe('pilot eligibility projection (dry run)', () => {
  const input = (over: Partial<ProjectionInput> = {}): ProjectionInput => ({
    stage: 'DRAFT', environment: { qualifiedReviewerAvailable: false, structureVersionPublished: true, publishedBlueprintVariantForPool: false }, lifecycleDeliverable: null, humanReviewDecision: null, reviewerIsAuthor: null,
    reviewedPrimaryConcepts: null, topicLinked: null, topicUnderOfficialDomain: null, responseFormatAllowedBySection: null, stimulusRequired: false, stimulusAndAssetsEligible: null, rightsEstablishedForAll: null,
    provenance: 'STUDYUS_GENERATED', lineagePresent: true, originality: null, activePools: null, blueprintRequired: false, fitsBlueprintCell: null, ...over,
  });
  const states = (i: ProjectionInput) => Object.fromEntries(projectPilotEligibility(i).conditions.map((c) => [c.key, c.state]));

  it('twelve conditions, each with one of four states and a reason; never the stored verdict', () => {
    const p = projectPilotEligibility(input());
    expect(PILOT_CONDITIONS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(p.conditions).toHaveLength(12);
    expect(p.conditions.every((c) => ['SATISFIED', 'UNSATISFIED', 'BLOCKED', 'NOT_YET_APPLICABLE'].includes(c.state) && c.reason.length > 0)).toBe(true);
    expect(p.isStoredVerdict).toBe(false);
    expect(p.projectedPilotEligible).toBe(false);
  });

  it('a draft today: most conditions are later stages; provenance holds; the format check is blocked', () => {
    expect(states(input())).toEqual({
      ACTIVE_CURRENT_VERSION: 'NOT_YET_APPLICABLE', HUMAN_REVIEW_APPROVED: 'NOT_YET_APPLICABLE', QUALIFIED_INDEPENDENT_REVIEWER: 'NOT_YET_APPLICABLE', ONE_PRIMARY_CONCEPT: 'NOT_YET_APPLICABLE', ONE_DOMAIN_ONE_TOPIC: 'NOT_YET_APPLICABLE',
      RESPONSE_FORMAT_ALLOWED: 'BLOCKED', STIMULUS_AND_ASSETS_ELIGIBLE: 'SATISFIED', REUSE_RIGHTS_ESTABLISHED: 'NOT_YET_APPLICABLE', PROVENANCE_COMPLETE: 'SATISFIED', ORIGINALITY_RECORDED: 'NOT_YET_APPLICABLE', ONE_POOL: 'NOT_YET_APPLICABLE', BLUEPRINT_CELL: 'SATISFIED',
    });
  });

  it('under review with no qualified reviewer: review, reviewer and attribution are BLOCKED, not merely unsatisfied', () => {
    const s = states(input({ stage: 'INGESTED_UNDER_REVIEW', topicLinked: true, topicUnderOfficialDomain: true, originality: { result: 'CLEAR', disposition: 'ACCEPTED' } }));
    expect([s.HUMAN_REVIEW_APPROVED, s.QUALIFIED_INDEPENDENT_REVIEWER, s.ONE_PRIMARY_CONCEPT]).toEqual(['BLOCKED', 'BLOCKED', 'BLOCKED']);
    expect(s.ONE_DOMAIN_ONE_TOPIC).toBe('SATISFIED');
    expect(s.ORIGINALITY_RECORDED).toBe('SATISFIED');
  });

  it('a PAA Mathematics item is blocked on condition 5 while its structure version is a draft; a mock item on condition 12 while no variant is published', () => {
    const s = states(input({ stage: 'INGESTED_UNDER_REVIEW', topicLinked: true, topicUnderOfficialDomain: true, blueprintRequired: true, environment: { qualifiedReviewerAvailable: true, structureVersionPublished: false, publishedBlueprintVariantForPool: false } }));
    expect(s.ONE_DOMAIN_ONE_TOPIC).toBe('BLOCKED');
    expect(s.BLUEPRINT_CELL).toBe('BLOCKED');
    expect(s.ONE_PRIMARY_CONCEPT).toBe('UNSATISFIED');
  });

  it('the intended concept of a package is not a reviewed PRIMARY; a fixture is never eligible; a similar result waits for a person', () => {
    expect(states(input({ stage: 'INGESTED_UNDER_REVIEW', environment: { qualifiedReviewerAvailable: true, structureVersionPublished: true, publishedBlueprintVariantForPool: true }, reviewedPrimaryConcepts: 0 })).ONE_PRIMARY_CONCEPT).toBe('UNSATISFIED');
    expect(states(input({ provenance: 'FIXTURE' })).PROVENANCE_COMPLETE).toBe('UNSATISFIED');
    expect(states(input({ stage: 'ORIGINALITY_CHECKED', originality: { result: 'SIMILAR', disposition: null } })).ORIGINALITY_RECORDED).toBe('UNSATISFIED');
  });

  it('all twelve satisfied only when every stage is done and nothing outside blocks', () => {
    const p = projectPilotEligibility(input({
      stage: 'POOL_ASSIGNED', environment: { qualifiedReviewerAvailable: true, structureVersionPublished: true, publishedBlueprintVariantForPool: true }, lifecycleDeliverable: true, humanReviewDecision: 'APPROVED', reviewerIsAuthor: false,
      reviewedPrimaryConcepts: 1, topicLinked: true, topicUnderOfficialDomain: true, responseFormatAllowedBySection: true, rightsEstablishedForAll: true, originality: { result: 'CLEAR', disposition: 'ACCEPTED' }, activePools: 1,
    }));
    expect(p.counts).toEqual({ SATISFIED: 12, UNSATISFIED: 0, BLOCKED: 0, NOT_YET_APPLICABLE: 0 });
    expect(p.projectedPilotEligible).toBe(true);
  });
});

describe('projection -- curriculum currentness from the cell', () => {
  it('a Matemáticas cell shows condition 5 BLOCKED at every stage, with the cutover reason', () => {
    const base = { stage: 'DRAFT' as const, environment: { qualifiedReviewerAvailable: false, structureVersionPublished: false, publishedBlueprintVariantForPool: false }, lifecycleDeliverable: null, humanReviewDecision: null, reviewerIsAuthor: null, reviewedPrimaryConcepts: null, topicLinked: null, topicUnderOfficialDomain: null, responseFormatAllowedBySection: null, stimulusRequired: false, stimulusAndAssetsEligible: null, rightsEstablishedForAll: null, provenance: 'STUDYUS_GENERATED', lineagePresent: true, originality: null, activePools: null, blueprintRequired: false, fitsBlueprintCell: null };
    const c5 = (currentness: 'CURRENT' | 'CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER') => projectPilotEligibility({ ...base, curriculumCurrentness: currentness }).conditions.find((c) => c.key === 'ONE_DOMAIN_ONE_TOPIC')!;
    expect(c5('CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER')).toMatchObject({ state: 'BLOCKED' });
    expect(c5('CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER').reason).toContain('CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER');
    expect(c5('CURRENT').state).toBe('NOT_YET_APPLICABLE');
  });
});

describe('QB-R2B pilot batch -- 24 candidates as a planning artifact', () => {
  const DIR = 'docs/exams/question-bank/pilots/qb-r2b';
  const batch = GenerationBatchSchema.parse(JSON.parse(read(`${DIR}/pilot-batch.json`)));
  const rows = batch.candidates.map((c) => ({ c, cell: cellOf(c.cellKey) }));

  it('24 schema-valid candidates, six per section, on resolved cells', () => {
    expect(batch.candidates).toHaveLength(24);
    expect(rows.every((r) => !!r.cell)).toBe(true);
    expect(PAA_SECTIONS.map((s) => rows.filter((r) => r.cell.sectionCode === s.code).length)).toEqual([6, 6, 6, 6]);
  });

  it('covers standalone and stimulus-based items, the three bands, more than one pool, and both formats', () => {
    expect(rows.filter((r) => r.c.stimulusKey !== null).length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((r) => r.c.stimulusKey === null).length).toBeGreaterThanOrEqual(6);
    expect(new Set(rows.map((r) => r.c.difficultyBand))).toEqual(new Set(['FOUNDATIONAL', 'STANDARD', 'CHALLENGE']));
    expect(new Set(rows.map((r) => r.cell.intendedPool)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((r) => r.c.responseFormat))).toEqual(new Set(['MULTIPLE_CHOICE', 'STUDENT_PRODUCED']));
    expect(new Set(batch.stimuli.map((s) => s.kind))).toEqual(new Set(['PASSAGE', 'POEM', 'NUMBERED_TEXT']));
  });

  it('every candidate is written for its cell\'s PRIMARY concept and passes the structural gate', () => {
    for (const { c, cell: target } of rows) {
      expect(c.primaryConceptStableId, c.candidateKey).toBe(target.primaryConcept.stableId);
      const v = validateCandidateStructure(c, target, { stimuli: batch.stimuli, hierarchyViolations: paaCellViolations, draftStage: true });
      expect(v.issues, c.candidateKey).toEqual([]);
    }
  });

  it('all are STUDYUS_GENERATED with a model lineage, and so are their stimuli; nothing cites an external source', () => {
    expect(batch.candidates.every((c) => c.provenance === 'STUDYUS_GENERATED' && c.lineage.kind === 'MODEL')).toBe(true);
    expect(batch.stimuli.every((s) => s.provenance === 'STUDYUS_GENERATED')).toBe(true);
    expect(read('scripts/operations/qb-r2b/pilot-evaluate.ts')).toMatch(/sourceType: 'STUDYUS_INTERNAL'/);
    expect(read('scripts/operations/qb-r2b/pilot-evaluate.ts')).not.toMatch(/PEDAGOGICAL_REFERENCE|kognity/i);
  });

  it('the originality gate over the batch: every candidate is low-similarity against its siblings', () => {
    for (const c of batch.candidates) {
      const v = validateQuestionCandidate({ candidate: c, cell: cellOf(c.cellKey), corpus: siblingCorpus(c, batch.candidates), structuralContext: { stimuli: batch.stimuli, hierarchyViolations: paaCellViolations, draftStage: true } });
      expect(v.originality.outcome, c.candidateKey).toBe('PASS_LOW_SIMILARITY');
      expect(v.status).toBe('READY_FOR_HUMAN_REVIEW');
    }
  });

  it('the stored artifacts say what they are: 24 packages, review blocked, nothing ingested', () => {
    const packages = JSON.parse(read(`${DIR}/pilot-review-packages.json`));
    const report = JSON.parse(read(`${DIR}/pilot-automated-report.json`));
    expect(packages.reviewStatus).toBe('BLOCKED_NO_QUALIFIED_REVIEWER');
    expect(packages.packages).toHaveLength(24);
    expect(packages.packages.every((p: { reviewStatus: string; attribution: { status: string }; automatedGates: { isHumanReview: boolean } }) => p.reviewStatus === 'BLOCKED_NO_QUALIFIED_REVIEWER' && p.attribution.status === 'TARGET_AND_PROPOSAL__NOT_REVIEWED' && p.automatedGates.isHumanReview === false)).toBe(true);
    expect(report).toMatchObject({ generated: 24, structural: { PASS: 24 }, reviewStatus: { BLOCKED_NO_QUALIFIED_REVIEWER: 24 }, rights: { NOT_ESTABLISHABLE: 24 } });
    // the Matemáticas items carry the cutover block into their projection
    const math = packages.packages.filter((p: { curriculum: { sectionCode: string } }) => p.curriculum.sectionCode === 'paa.sec.matematicas');
    expect(math).toHaveLength(6);
    expect(math.every((p: { projection: Array<{ key: string; state: string }> }) => p.projection.find((c) => c.key === 'ONE_DOMAIN_ONE_TOPIC')!.state === 'BLOCKED')).toBe(true);
  });
});

describe('QB-R2B planning artifact and the defect the pilot exposed', () => {
  it('the DEV-bound artifact is the resolved cells: 789 cells, 865 items, every cell bound, nothing unresolved', () => {
    const artifact = JSON.parse(read('docs/exams/question-bank/audits/q1-paa/QB_R2B_paa_requirement_cells.dev.json'));
    expect(artifact.summary).toMatchObject({ cells: 789, items: 865, violations: [], binding: { environmentFingerprint: '2a29b99ee14a22b4', bound: 789, unresolved: [] } });
    expect(artifact.cells.map((c: RequirementCell) => ({ ...c, binding: null }))).toEqual(CELLS);
    expect(artifact.cells.every((c: RequirementCell) => validateRequirementCell(c).ok && c.binding !== null)).toBe(true);
    expect(new Set(artifact.cells.map((c: RequirementCell) => c.binding!.topicNodeId)).size).toBe(82);
    expect(new Set(artifact.cells.map((c: RequirementCell) => c.binding!.primaryConceptId)).size).toBe(61);
  });

  it('KNOWN DEFECT, kept visible: the pilot planned questions of one stimulus into several pools; a stimulus group belongs to one pool', () => {
    const report = JSON.parse(read('docs/exams/question-bank/pilots/qb-r2b/pilot-automated-report.json'));
    expect(report.stimuliSpanningPools).toBe(4);
    // the cells themselves cannot express it yet: a cell is one (pool, Topic, concept), and a stimulus set spans several cells
    expect(Object.keys(CELLS[0])).not.toContain('stimulusSetKey');
  });
});
