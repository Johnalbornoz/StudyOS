/**
 * QB-R2A -- Question Production OS: requirement cell, PAA backlog, reference pack, generation contract,
 * structural validation, originality gate, review package, rights gate, pool assignment, eligibility projection.
 * Everything here is planning and dry-run: nothing reads or writes a database.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PAA_DOMAINS, PAA_SECTIONS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { PRODUCTION_POOLS, PRODUCTION_POOL_POLICY, validateRequirementCell } from '@/lib/exam-core/question-bank/production/requirement-cell';
import { LOGICAL_POOLS, PILOT_POOL_POLICY } from '@/lib/assessment-blueprint/protected/pools';
import { buildPaaBacklog, paaBacklogViolations, paaCellViolations, PAA_BACKLOG_POLICY, PAA_BACKLOG_TOTAL, summarizePaaBacklog } from '@/lib/exam-core/question-bank/production/paa-backlog';
import { PAA_CONCEPT_DEMAND, PAA_MOCK_DEMAND } from '@/lib/exam-core/question-bank/production/paa-backlog-data';
import { ReferenceIntelligencePackSchema, PEDAGOGICAL_FACT_KINDS } from '@/lib/exam-core/question-bank/production/draft-package';
import { GeneratedCandidateSchema, GenerationRequestSchema, generationResultViolations } from '@/lib/exam-core/question-bank/production/generation-contract';
import { STRUCTURAL_CHECKS, validateCandidateStructure } from '@/lib/exam-core/question-bank/production/structural-validation';
import { evaluateOriginality, textualSimilarity, type ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { evaluateRightsGate, type RightsEvidence } from '@/lib/exam-core/question-bank/production/rights-gate';
import { evaluatePoolAssignment, type PoolAssignmentFacts } from '@/lib/exam-core/question-bank/production/pool-assignment';
import { PILOT_CONDITIONS, projectPilotEligibility, type ProjectionInput } from '@/lib/exam-core/question-bank/production/pilot-projection';
import { buildHumanReviewPackage, REVIEWER_ACTIONS, reviewExecutionBlockers } from '@/lib/exam-core/question-bank/production/review-package';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-10T12:00:00Z';

const cell = (over: Record<string, unknown> = {}) => ({
  v: 1, cellKey: 'PRACTICE:math.num.percent:001', examFamily: 'PAA', examVersionId: U(1), sectionCode: 'paa.sec.matematicas', domainNodeCode: 'paa.dom.matematicas.aritmetica',
  topicNodeCode: PAA_TOPICS.find((t) => t.domainCode === 'paa.dom.matematicas.aritmetica')!.code, primaryConceptId: U(2), supportingConceptIds: [U(3)], examSkill: null, responseFormat: 'MULTIPLE_CHOICE',
  difficultyBand: 'STANDARD', stimulus: { required: false }, assets: [], intendedPool: 'PRACTICE', authority: { kind: 'STUDYUS_POLICY', policyId: 'q1-per-concept-pools', policyVersion: '1' }, blueprintRequirement: null, ...over,
});
const source = (over: Record<string, unknown> = {}) => ({ sourceKey: 'cb-paa-guia-2021', sourceType: 'OFFICIAL_SPECIFICATION', title: 'Guía de estudio PAA', publisher: 'College Board', locator: 'p. 35', sourceAccess: 'PUBLICLY_ACCESSIBLE', permittedUse: 'REFERENCE_ONLY', accessStatus: 'NOT_REQUIRED', referencedAt: NOW, licenceReference: null, ...over });
const pack = (over: Record<string, unknown> = {}) => ({ v: 1, sources: [source()], facts: [{ kind: 'CONCEPT_DEFINITION', statement: 'Un porcentaje expresa una parte de cada cien.', sourceKeys: ['cb-paa-guia-2021'], restatedInOwnWords: true }], containsCopiedProtectedExpression: false, ...over });
const candidate = (over: Record<string, unknown> = {}) => ({
  v: 1, candidateKey: 'cand-1', cellKey: 'PRACTICE:math.num.percent:001', batchKey: 'batch-1', stem: 'En una clase de 40 estudiantes, 18 practican un deporte. ¿Qué porcentaje de la clase practica un deporte?',
  responseFormat: 'MULTIPLE_CHOICE', options: [{ id: 'A', text: '18 %' }, { id: 'B', text: '40 %' }, { id: 'C', text: '45 %' }, { id: 'D', text: '55 %' }], answerKey: 'C', rationale: '18 de 40 equivale a 45 de cada 100.',
  primaryConceptId: U(2), supportingConceptIds: [U(3)], difficultyBand: 'STANDARD', marks: 1, language: 'es', stimulus: { required: false }, assets: [], provenance: 'STUDYUS_GENERATED',
  lineage: { kind: 'MODEL', model: 'm', promptVersion: '1', runId: 'run-1', requestedByUserId: U(9), generatedAt: NOW, humanEdits: [] }, ...over,
});
const parsedCell = () => { const r = validateRequirementCell(cell()); if (!r.ok) throw new Error(r.issues.join()); return r.cell; };
const parsedCandidate = (over: Record<string, unknown> = {}) => GeneratedCandidateSchema.parse(candidate(over));

describe('QB-R2A requirement cell', () => {
  it('carries every minimum field, and refuses a cell without one of them', () => {
    expect(validateRequirementCell(cell())).toMatchObject({ ok: true });
    for (const f of ['examFamily', 'examVersionId', 'sectionCode', 'domainNodeCode', 'topicNodeCode', 'primaryConceptId', 'supportingConceptIds', 'examSkill', 'responseFormat', 'difficultyBand', 'stimulus', 'assets', 'intendedPool', 'authority', 'blueprintRequirement']) {
      const without = cell() as Record<string, unknown>;
      delete without[f];
      expect(validateRequirementCell(without).ok, f).toBe(false);
    }
  });

  it('one PRIMARY concept; authority is official with a source or a named StudyUs policy; a mock cell names its blueprint requirement', () => {
    const issues = (over: Record<string, unknown>) => { const r = validateRequirementCell(cell(over)); return r.ok ? [] : r.issues; };
    expect(issues({ supportingConceptIds: [U(2)] })).toEqual(['supportingConceptIds: CONCEPT_LISTED_TWICE']);
    expect(issues({ authority: { kind: 'OFFICIAL', sourceKeys: [] } }).length).toBeGreaterThan(0);
    expect(issues({ authority: { kind: 'OFFICIAL', sourceKeys: ['cb-paa-guia-2021'] } })).toEqual([]);
    expect(issues({ intendedPool: 'FULL_MOCK_1' })).toEqual(['blueprintRequirement: MOCK_CELL_NEEDS_BLUEPRINT_REQUIREMENT']);
    expect(issues({ intendedPool: 'FULL_MOCK_1', blueprintRequirement: { purpose: 'FULL', formNumber: 1, requirementKey: 'SECTION_ITEM_COUNT:matematicas' } })).toEqual([]);
    expect(issues({ intendedPool: 'REDUCED_MOCK', blueprintRequirement: { purpose: 'FULL', formNumber: 1, requirementKey: 'k' } })).toEqual(['blueprintRequirement: BLUEPRINT_PURPOSE_DOES_NOT_MATCH_POOL']);
    expect(issues({ intendedPool: 'EVERYWHERE' }).length).toBeGreaterThan(0);
    expect(issues({ primaryConceptId: 'Porcentajes' }).length).toBeGreaterThan(0);
  });

  it('a PAA cell sits in the certified hierarchy, checked by code', () => {
    expect(paaCellViolations(parsedCell())).toEqual([]);
    expect(paaCellViolations({ ...parsedCell(), topicNodeCode: PAA_TOPICS.find((t) => t.domainCode === 'paa.dom.lectura.vocabulario')!.code })).toEqual(['TOPIC_NOT_IN_DOMAIN']);
    expect(paaCellViolations({ ...parsedCell(), sectionCode: 'paa.sec.lectura' })).toEqual(['DOMAIN_NOT_IN_SECTION']);
    expect(paaCellViolations({ ...parsedCell(), domainNodeCode: 'Aritmética' })).toContain('UNKNOWN_DOMAIN');
    expect(paaCellViolations({ ...parsedCell(), examFamily: 'ICFES' })).toEqual(['NOT_A_PAA_CELL']);
  });
});

describe('QB-R2A PAA backlog -- 865 unique items, for planning', () => {
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

describe('QB-R2A reference intelligence pack', () => {
  const msgs = (p: unknown) => ReferenceIntelligencePackSchema.safeParse(p).error?.issues.map((i) => i.message) ?? [];

  it('carries the kinds of fact authoring needs, each restated and tied to a source', () => {
    for (const k of ['CURRICULUM_FACT', 'LEARNING_OBJECTIVE', 'CONCEPT_DEFINITION', 'PREREQUISITE', 'COMMON_MISCONCEPTION', 'REASONING_SKILL', 'EXPECTED_DIFFICULTY', 'APPROPRIATE_CONTEXT', 'RESPONSE_FORMAT_GUIDANCE', 'STIMULUS_GUIDANCE']) expect(PEDAGOGICAL_FACT_KINDS, k).toContain(k);
    expect(msgs(pack())).toEqual([]);
  });

  it('a pedagogical reference source: identity, access status, permitted use, restated facts, reference timestamp', () => {
    const external = (over: Record<string, unknown> = {}) => source({ sourceKey: 'ext-ref', sourceType: 'PEDAGOGICAL_REFERENCE', title: 'External reference', publisher: 'Third party', sourceAccess: 'LICENSED_SOURCE', accessStatus: 'VALIDATED', ...over });
    expect(msgs(pack({ sources: [source(), external()] }))).toEqual([]);
    // deferred access: it can be listed, has not been consulted, and supports no fact
    const deferred = external({ permittedUse: 'ACCESS_NOT_VALIDATED', accessStatus: 'NOT_VALIDATED', referencedAt: null });
    expect(msgs(pack({ sources: [source(), deferred] }))).toEqual([]);
    expect(msgs(pack({ sources: [source(), { ...deferred, referencedAt: NOW }] }))).toEqual(['UNVALIDATED_SOURCE_NOT_CONSULTED']);
    expect(msgs(pack({ sources: [source(), external({ accessStatus: 'NOT_VALIDATED', referencedAt: null })] }))).toEqual(['ACCESS_STATUS_INCONSISTENT']);
    expect(msgs(pack({ sources: [source(), external({ accessStatus: 'NOT_REQUIRED' })] }))).toEqual(['PEDAGOGICAL_REFERENCE_NEEDS_ACCESS_VALIDATION']);
    expect(msgs(pack({ sources: [source(), external({ permittedUse: 'REPRODUCTION_LICENSED', licenceReference: 'L' })] }))).toEqual(['PEDAGOGICAL_REFERENCE_IS_REFERENCE_ONLY']);
  });

  it('reference, provenance and rights are three facts: a pack has no provenance and no reuse-rights field, and holds no copied expression', () => {
    expect(msgs({ ...pack(), provenance: 'STUDYUS_AUTHORED' }).length).toBeGreaterThan(0);
    expect(msgs({ ...pack(), reuseRights: 'STUDYUS_OWNED' }).length).toBeGreaterThan(0);
    expect(msgs(pack({ containsCopiedProtectedExpression: true })).length).toBe(1);
    expect(msgs(pack({ sources: [source({ questionText: 'copied question' })] })).length).toBeGreaterThan(0);
  });
});

describe('QB-R2A generation contract', () => {
  const request = (over: Record<string, unknown> = {}) => ({ v: 1, cell: cell(), references: pack(), policy: { policyId: 'gen', policyVersion: '1', author: { kind: 'MODEL', model: 'm', promptVersion: '1', requestedByUserId: U(9) }, language: 'es', copyReferenceExpression: false }, desiredCount: 3, ...over });

  it('input: cell, pack, policy, count -- and a policy cannot allow copying a reference', () => {
    expect(GenerationRequestSchema.safeParse(request()).success).toBe(true);
    expect(GenerationRequestSchema.safeParse(request({ desiredCount: 0 })).success).toBe(false);
    expect(GenerationRequestSchema.safeParse(request({ policy: { ...request().policy, copyReferenceExpression: true } })).success).toBe(false);
    for (const f of ['cell', 'references', 'policy', 'desiredCount']) { const r = request() as Record<string, unknown>; delete r[f]; expect(GenerationRequestSchema.safeParse(r).success, f).toBe(false); }
  });

  it('output: a candidate has stem, format, options, key, rationale, concepts, difficulty, stimulus, assets, provenance and lineage', () => {
    expect(GeneratedCandidateSchema.safeParse(candidate()).success).toBe(true);
    for (const f of ['stem', 'responseFormat', 'options', 'answerKey', 'rationale', 'primaryConceptId', 'supportingConceptIds', 'difficultyBand', 'stimulus', 'assets', 'provenance', 'lineage']) { const c = candidate() as Record<string, unknown>; delete c[f]; expect(GeneratedCandidateSchema.safeParse(c).success, f).toBe(false); }
  });

  it('generated stays STUDYUS_GENERATED after human editing; a person\'s own draft is STUDYUS_AUTHORED', () => {
    const edited = candidate({ lineage: { ...candidate().lineage, humanEdits: [{ editorUserId: U(8), editedAt: NOW }] } });
    expect(GeneratedCandidateSchema.safeParse(edited).success).toBe(true);
    expect(GeneratedCandidateSchema.safeParse({ ...edited, provenance: 'STUDYUS_AUTHORED' }).error?.issues.map((i) => i.message)).toEqual(['PROVENANCE_DOES_NOT_MATCH_LINEAGE']);
    expect(GeneratedCandidateSchema.safeParse(candidate({ provenance: 'STUDYUS_AUTHORED', lineage: { kind: 'HUMAN', authorUserId: U(7), writtenAt: NOW } })).success).toBe(true);
    expect(GeneratedCandidateSchema.safeParse(candidate({ provenance: 'OFFICIAL' })).success).toBe(false);
  });

  it('a result answers its request', () => {
    const req = GenerationRequestSchema.parse(request());
    const res = { v: 1 as const, cellKey: req.cell.cellKey, batchKey: 'batch-1', candidates: [parsedCandidate()] };
    expect(generationResultViolations(req, res)).toEqual([]);
    expect(generationResultViolations(req, { ...res, candidates: [parsedCandidate(), parsedCandidate()] })).toContain('DUPLICATE_CANDIDATE_KEY');
    expect(generationResultViolations(req, { ...res, candidates: [parsedCandidate({ provenance: 'STUDYUS_AUTHORED', lineage: { kind: 'HUMAN', authorUserId: U(7), writtenAt: NOW } })] })).toEqual(['LINEAGE_DOES_NOT_MATCH_POLICY:cand-1']);
  });
});

describe('QB-R2A automated structural validation', () => {
  const check = (over: Record<string, unknown> = {}, cellOver: Record<string, unknown> = {}, ctx = {}) => {
    const c = validateRequirementCell(cell(cellOver));
    if (!c.ok) throw new Error(c.issues.join());
    return validateCandidateStructure(parsedCandidate(over), c.cell, { hierarchyViolations: paaCellViolations, ...ctx });
  };
  const codes = (over: Record<string, unknown> = {}, cellOver: Record<string, unknown> = {}, ctx = {}) => check(over, cellOver, ctx).issues.map((i) => `${i.check}:${i.code}`);

  it('a well-formed candidate passes all eleven checks, and a pass is not a human review', () => {
    const r = check();
    expect(r).toMatchObject({ outcome: 'PASS', issues: [], isHumanReview: false });
    expect(r.checksRun).toEqual(STRUCTURAL_CHECKS);
    expect(STRUCTURAL_CHECKS).toHaveLength(11);
    expect(check({ answerKey: 'Z' }).isHumanReview).toBe(false);
  });

  it('each check fails on its own', () => {
    expect(codes({ primaryConceptId: U(50) })).toEqual(['ONE_PRIMARY_CONCEPT:PRIMARY_IS_NOT_THE_CELLS']);
    expect(codes({ supportingConceptIds: [U(2)] })).toEqual(['ONE_PRIMARY_CONCEPT:CONCEPT_LISTED_TWICE']);
    expect(codes({}, { topicNodeCode: 'paa.topic.001' })).toEqual(['VALID_DOMAIN_TOPIC:TOPIC_NOT_IN_DOMAIN']);
    expect(codes({ responseFormat: 'STUDENT_PRODUCED', options: [], answerKey: '45' })).toEqual(['VALID_RESPONSE_FORMAT:FORMAT_IS_NOT_THE_CELLS']);
    expect(codes({ answerKey: 'Z' })).toEqual(['ANSWER_KEY_CONSISTENT:KEY_IS_NOT_AN_OPTION']);
    expect(codes({ options: [{ id: 'A', text: '18 %' }, { id: 'B', text: ' 18  % ' }, { id: 'C', text: '45 %' }, { id: 'D', text: '55 %' }] })).toEqual(['OPTIONS_UNIQUE:DUPLICATE_OPTION_TEXT']);
    expect(codes({ options: [{ id: 'A', text: '1' }, { id: 'C', text: '2' }] })).toEqual(['VALID_RESPONSE_FORMAT:OPTION_COUNT_OUT_OF_RANGE']);
    expect(codes({ marks: 5 })).toEqual(['MARK_ALLOCATION:MARKS_OUT_OF_RANGE']);
    expect(codes({ difficultyBand: 'CHALLENGE' })).toEqual(['DIFFICULTY_RANGE:BAND_IS_NOT_THE_CELLS']);
    expect(codes({}, { stimulus: { required: true, kind: 'PASSAGE', stimulusKey: null, itemsInGroup: 4 } })).toEqual(['STIMULUS_REQUIREMENT:STIMULUS_MISSING']);
    expect(codes({}, { assets: [{ kind: 'GRAPH', purpose: 'stem' }] })).toEqual(['STIMULUS_REQUIREMENT:ASSET_MISSING:GRAPH']);
    expect(codes({ rationale: 'ok' })).toEqual(['ANSWER_KEY_CONSISTENT:RATIONALE_MISSING']);
  });

  it('the Domain / Topic check is the exam\'s own, supplied by the caller: without it the validation fails rather than assume', () => {
    const c = validateRequirementCell(cell());
    if (!c.ok) throw new Error('cell');
    expect(validateCandidateStructure(parsedCandidate(), c.cell).issues.map((i) => i.code)).toEqual(['HIERARCHY_CHECK_NOT_SUPPLIED']);
  });

  it('a mock cell is supported only by a published blueprint requirement', () => {
    const mock = { intendedPool: 'FULL_MOCK_1', blueprintRequirement: { purpose: 'FULL', formNumber: 1, requirementKey: 'SECTION_ITEM_COUNT:matematicas' } };
    expect(codes({}, mock)).toEqual(['SUPPORTED_BLUEPRINT_CELL:BLUEPRINT_REQUIREMENT_NOT_PUBLISHED']);
    expect(codes({}, mock, { knownBlueprintRequirementKeys: ['SECTION_ITEM_COUNT:matematicas'] })).toEqual([]);
  });
});

describe('QB-R2A originality gate', () => {
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

describe('QB-R2A rights gate', () => {
  const evidence = (over: Partial<RightsEvidence> = {}): RightsEvidence => ({
    provenance: 'STUDYUS_GENERATED', authorshipTermsReference: 'model-terms-2026-01', sourceUsages: [{ sourceKey: 'cb-paa-guia-2021', sourceAccess: 'PUBLICLY_ACCESSIBLE', usage: 'REFERENCE_ONLY' }],
    originality: { outcome: 'PASS_LOW_SIMILARITY', acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [], ...over,
  });

  it('StudyUs content with authorship terms, consulted-only sources and accepted originality supports STUDYUS_OWNED', () => {
    expect(evaluateRightsGate(evidence())).toMatchObject({ supportedReuseRights: 'STUDYUS_OWNED', deliverable: true, blockers: [], proposedRecord: { reuseRights: 'STUDYUS_OWNED', sourceAccess: 'NOT_APPLICABLE', rightsHolder: 'StudyUs' } });
    expect(evaluateRightsGate(evidence({ provenance: 'STUDYUS_AUTHORED', authorshipTermsReference: 'author-agreement-17' })).deliverable).toBe(true);
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

describe('QB-R2A pool assignment', () => {
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

describe('QB-R2A pilot eligibility projection (dry run)', () => {
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

describe('QB-R2A human review package', () => {
  const build = () => {
    const c = parsedCandidate();
    const cl = parsedCell();
    const structural = validateCandidateStructure(c, cl, { hierarchyViolations: paaCellViolations });
    const originality = evaluateOriginality({ text: c.stem }, []);
    const rights = evaluateRightsGate({ provenance: 'STUDYUS_GENERATED', authorshipTermsReference: 'model-terms', sourceUsages: [], originality: { outcome: originality.outcome, acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [] });
    return buildHumanReviewPackage({ candidate: c, cell: cl, references: ReferenceIntelligencePackSchema.parse(pack()), structural, originality, rights });
  };

  it('shows the question, answer, rationale, Domain, Topic, concepts, format, difficulty, provenance, references, originality, rights and pool', () => {
    const p = build();
    expect(p.question.stem).toContain('40 estudiantes');
    expect(p.answer).toEqual({ answerKey: 'C', rationale: '18 de 40 equivale a 45 de cada 100.' });
    expect(p.curriculum).toMatchObject({ domainNodeCode: 'paa.dom.matematicas.aritmetica', sectionCode: 'paa.sec.matematicas' });
    expect(p.proposedAttribution).toEqual({ primaryConceptId: U(2), supportingConceptIds: [U(3)], status: 'PROPOSED_BY_AUTHOR' });
    expect([p.question.responseFormat, p.difficultyBand, p.provenance.class, p.intendedPool]).toEqual(['MULTIPLE_CHOICE', 'STANDARD', 'STUDYUS_GENERATED', 'PRACTICE']);
    expect(p.referenceSources).toEqual([{ sourceKey: 'cb-paa-guia-2021', sourceType: 'OFFICIAL_SPECIFICATION', title: 'Guía de estudio PAA', permittedUse: 'REFERENCE_ONLY', accessStatus: 'NOT_REQUIRED' }]);
    expect(p.originality).toMatchObject({ outcome: 'PASS_LOW_SIMILARITY', needsHumanDecision: false });
    expect(p.rights).toEqual({ status: 'ESTABLISHABLE', supportedReuseRights: 'STUDYUS_OWNED', blockers: [] });
    expect(p.structuralValidation.isHumanReview).toBe(false);
  });

  it('the reviewer can approve, reject, request revision and correct attribution -- and none can be carried out yet', () => {
    const p = build();
    expect(p.availableActions).toEqual(REVIEWER_ACTIONS);
    expect(REVIEWER_ACTIONS).toEqual(['APPROVE', 'REJECT', 'REQUEST_REVISION', 'CORRECT_ATTRIBUTION']);
    expect(reviewExecutionBlockers({ pkg: p, ingested: false, qualifiedReviewerAvailable: false })).toEqual(['NO_QUALIFIED_REVIEWER', 'NOT_INGESTED']);
    expect(reviewExecutionBlockers({ pkg: p, ingested: true, qualifiedReviewerAvailable: true })).toEqual([]);
    expect(p.approvalPrerequisites.join(' ')).toMatch(/exactly one PRIMARY concept/);
  });
});

describe('QB-R2A planning and dry run write nowhere', () => {
  it('no production module imports the database, runs a query or states a mutation', () => {
    const dir = 'src/lib/exam-core/question-bank/production';
    const files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.ts'));
    expect(files.sort()).toEqual(['draft-package.ts', 'generation-contract.ts', 'originality-gate.ts', 'paa-backlog-data.ts', 'paa-backlog.ts', 'pilot-projection.ts', 'pool-assignment.ts', 'requirement-cell.ts', 'review-package.ts', 'rights-gate.ts', 'structural-validation.ts']);
    for (const f of files) {
      const src = read(`${dir}/${f}`).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/from '@\/lib\/db'|\bquery\(|INSERT INTO|UPDATE \w+ SET|DELETE FROM|process\.env|fetch\(/);
    }
    const script = read('scripts/operations/qb-paa-backlog.ts');
    expect(script).not.toMatch(/from 'pg'|DATABASE_URL|writeFile/);
    // nothing outside tests and that script uses the production modules yet: no route, no service, no ingestion
    const walk = (d: string): string[] => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [`${d}/${e.name}`] : []));
    expect(walk('src').filter((f) => !f.startsWith(dir) && /question-bank\/production\//.test(read(f)))).toEqual([]);
  });
});
