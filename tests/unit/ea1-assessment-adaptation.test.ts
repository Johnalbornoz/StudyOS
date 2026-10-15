/**
 * EA-1 -- Transversal Assessment Adaptation: task families, assessment-system profiles, the discipline policy,
 * the adaptation engine, the Production OS bridge and the mathematics proof of concept.
 *
 * Nothing here is a review. The families are unreviewed drafts and the profiles are illustrative; these tests
 * prove properties of the ARCHITECTURE: knowledge is referenced and never duplicated, a profile cannot carry or
 * change it, an unsupported adaptation is refused by name, the invariants survive every adaptation, an official
 * rule must cite a source the repository records, and content without a task family is as valid as it was.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { adapt, invariantsOfFamily, invariantsPreserved, type AdaptationResult } from '@/lib/assessment-adaptation/adapt';
import { ADAPTATION_REFUSAL_CODES, AdaptationSpecificationSchema, invariantHashOf, PRODUCTION_FORMAT_OF, specificationIdOf, specificationIntegrityIssues, type AdaptationRequest, type AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { applicabilityRegisterIssues, applicabilityStatusOf, AssessmentApplicabilityRecordSchema, EA1_APPLICABILITY_THRESHOLD, resolveApplicability, type ApplicabilityThresholdPolicy, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';
import { AssessmentComponentProfileSchema, AssessmentSystemProfileSchema, authorityBreakdown, PROFILE_RULE_DIMENSIONS, profileMayFeedEvidenceBearingContent, resolveProfile, RuleAuthoritySchema, validateAssessmentSystemProfile, type AssessmentComponentProfile, type AssessmentSystemProfile, type ProfileRules } from '@/lib/assessment-adaptation/assessment-system-profile';
import { canonicalJson, sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { adaptForCell, evidenceTargetOfCell, selectTaskFamilies } from '@/lib/assessment-adaptation/cell-bridge';
import { DisciplineAdaptationPolicySchema, INVARIANT_DIMENSIONS, MATHEMATICS_ADAPTATION_POLICY, VARIABLE_DIMENSIONS } from '@/lib/assessment-adaptation/discipline-policy';
import { ADAPTATION_EVIDENCE_FACETS, ADAPTATION_POOLS, AdaptationLineageSchema, AuthoredFamilyLineageSchema, CONTENT_USE_CLASSES, INSTANCE_PURPOSES, instanceClassSatisfies, instancePolicyFor, mayBearEvidence, NOT_ESTABLISHED_BY_ADAPTATION, PROMOTION_PATH, PROTECTED_MOCK_POOLS } from '@/lib/assessment-adaptation/instance-lineage';
import { MATH_POC_APPLICABILITY, MATH_POC_COMPONENT_OBJECTIVE_PREFIX, PISA_MATHEMATICS_OBJECTIVE } from '@/lib/assessment-adaptation/math-poc-applicability';
import { buildMathAdaptationMatrix, buildMathPocSpecifications, COMPARED_DIMENSIONS, differingDimensions, MATH_POC_MATRIX_ARTIFACT, MINIMUM_PAIRWISE_DIFFERENCE, MINIMUM_SAME_SYSTEM_DIFFERENCE, serializeMathAdaptationMatrix } from '@/lib/assessment-adaptation/math-poc-matrix';
import { CAMBRIDGE_SYSTEM_PROFILE, componentProfileOf, componentProfilesOf, EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES, IB_MATH_AA_HL_P1_COMPONENT, IB_MATH_AA_HL_P2_COMPONENT, IB_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT, PAA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, PISA_SYSTEM_PROFILE, systemProfileOf, systemProfileOfExamFamily } from '@/lib/assessment-adaptation/system-profiles';
import { LOGICAL_POOLS } from '@/lib/assessment-blueprint/protected/pools';
import { PAA_DOMAINS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { AICE_SYLLABI } from '@/lib/exam-core/aice/aice-syllabi.generated';
import { allLearningLinks } from '@/lib/exam-core/catalog/objective-learning-links';
import { ASSESSMENT_SOURCES } from '@/lib/exam-core/catalog/sources';
import { ComponentDefinitionSchema } from '@/lib/exam-core/component-definition';
import { DEFAULT_TASK_FAMILY_REGISTRY, EA1_DEFAULT_FAMILY_ASSUMPTION, evidenceDemandByConcept, familyMayFeedEvidenceBearingContent, KNOWN_FAMILY_TYPES, MATH_POC_FAMILIES, MATH_POC_PROFILE_IDS, MATH_PROBLEM_SPECIALIZATION, mathPocFamilyOf, minimumFamiliesFor, parameterizationViolations, TaskFamilyCommonSchema, type AssessmentTaskFamily, type MathTaskFamily, type TaskFamily, type TaskFamilySpecialization } from '@/lib/exam-core/question-bank/task-families';
import { CALCULATOR_POLICIES, ELICITATION_FORMATS, TASK_DIFFICULTY_BANDS } from '@/lib/exam-core/question-bank/task-families/task-family';
import { GenerationBatchSchema, lineageGaps, QuestionCandidateSchema, type QuestionCandidate } from '@/lib/exam-core/question-bank/production/generation-contract';
import { generateCandidates, renderGenerationPrompt, type GenerateCandidatesInput } from '@/lib/exam-core/question-bank/production/generator/generate-candidates';
import { GenerationError, RecordedResponseProvider, canonicalJson as providerCanonicalJson, sha256OfCanonicalJson as providerSha256 } from '@/lib/exam-core/question-bank/production/generator/provider';
import { DEFAULT_TEMPLATE_REGISTRY } from '@/lib/exam-core/question-bank/production/generator/templates';
import { paaCellViolations } from '@/lib/exam-core/question-bank/production/paa-backlog';
import { resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';
import { PAA_CONCEPT_IDENTITIES } from '@/lib/exam-core/question-bank/production/paa-concept-identity';
import { paaGenerationReadyPack } from '@/lib/exam-core/question-bank/production/paa-concept-profiles';
import { buildPaaGenerationPlan, PAA_PLANNED_ITEMS, PAA_POOL_TOTALS } from '@/lib/exam-core/question-bank/production/paa-generation-plan';
import { evaluatePoolAssignment } from '@/lib/exam-core/question-bank/production/pool-assignment';
import { DIFFICULTY_BANDS, PRODUCTION_POOLS, STIMULUS_KINDS } from '@/lib/exam-core/question-bank/production/requirement-cell';
import { buildHumanReviewPackage } from '@/lib/exam-core/question-bank/production/review-package';
import { evaluateRightsGate } from '@/lib/exam-core/question-bank/production/rights-gate';
import { validateCandidateStructure } from '@/lib/exam-core/question-bank/production/structural-validation';
import { validateQuestionCandidate } from '@/lib/exam-core/question-bank/production/validated-candidate';
import { toReferencePackV1 } from '@/lib/exam-core/question-bank/production/concept-profile';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { CAMBRIDGE_0580_EXTENDED_V2 } from '@/lib/exam-core/verticals/v2/cambridge-0580';
import { IB_MATH_AA_HL_V2 } from '@/lib/exam-core/verticals/v2/ib-math-aa-hl';
import { PAA_V2 } from '@/lib/exam-core/verticals/v2/paa';
import { PISA_MATH_V2 } from '@/lib/exam-core/verticals/v2/pisa-math';
import { SABER11_MATH_V2 } from '@/lib/exam-core/verticals/v2/saber11-math';
import { buildPaaEvidenceDemand, PAA_EVIDENCE_DEMAND_ARTIFACT, serializePaaEvidenceDemand } from '../../scripts/operations/ea1-paa-evidence-demand';
import { PILOT_V2_DIR, PILOT_V2_FILES, PILOT_V2_POLICY, PILOT_V2_PROVIDER, PILOT_V2_RUN, type PilotRecording } from '../../scripts/operations/qb-r2c/pilot-v2-pipeline';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
const walk = (d: string): string[] => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));

const ADAPTATION_DIR = 'src/lib/assessment-adaptation';
const FAMILIES_DIR = 'src/lib/exam-core/question-bank/task-families';
const POLICY = MATHEMATICS_ADAPTATION_POLICY;
const REQUEST: AdaptationRequest = { purpose: 'PRACTICE', contentUseClass: 'DEV_TEST_CONTENT', difficultyBand: 'STANDARD', language: 'es' };
const POC_CONCEPT_IDS = ['math.alg.quadratics', 'math.fun.linear-functions-lines', 'math.num.ratio-proportion', 'math.prob.probability', 'math.stat.data-representation'];
/** The component a test targets when it names only a system: the first one modelled for it. */
const DEFAULT_COMPONENT: Record<string, AssessmentComponentProfile> = Object.fromEntries(EA1_SYSTEM_PROFILES.map((p) => [p.profileId, componentProfilesOf(p.profileId)[0]]));
const ICFES_COMPONENT = componentProfileOf('ICFES.SABER11_MATEMATICAS')!;
const CAMBRIDGE_COMPONENT = componentProfileOf('CAMBRIDGE.9709.P1')!;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const fam = (id: string): MathTaskFamily => mathPocFamilyOf(id)!;
const MISSING_VALUE = fam('tf.math.proportion.missing-value');
const RATE_MODEL = fam('tf.math.proportion.rate-comparison-model');
const LINEAR_MODEL = fam('tf.math.linear.constant-rate-model');
const FACTORISING = fam('tf.math.quadratic.solve-by-factorising');
const DATASET = fam('tf.math.data.rate-of-change-from-realistic-dataset');
/** Adapts into a COMPONENT: the one given, or the default component of the system. `null` targets the system alone. */
const run = (family: unknown, profile: unknown, request: unknown = REQUEST, policy: unknown = POLICY, component?: unknown): AdaptationResult => adapt({ family, profile, component: component === undefined ? DEFAULT_COMPONENT[(profile as { profileId?: string })?.profileId ?? ''] : component ?? undefined, applicability: MATH_POC_APPLICABILITY, disciplinePolicy: policy, request });
const runSystem = (family: unknown, profile: unknown, request: unknown = REQUEST): AdaptationResult => run(family, profile, request, POLICY, null);
const reviewed = <T extends TaskFamily>(f: T): T => ({ ...clone(f), lifecycle: 'CERTIFIED', reviewStatus: 'REVIEWED' });
/** TEST DOUBLES ONLY: a profile marked certified, to exercise the evidence-bearing path. No profile of the repository is certified. */
const certified = <T extends { status: string; certification: unknown }>(p: T): T => ({ ...clone(p), status: 'CERTIFIED', certification: { certifiedBy: 'test-double', certifiedAt: '2026-10-11T00:00:00Z' } });
/** Evidence-bearing adaptation with a reviewed family and certified profiles (test doubles), into the system's default component or the one given. */
const runCertified = (family: TaskFamily, profile: AssessmentSystemProfile, request: Partial<AdaptationRequest> = {}, component: AssessmentComponentProfile | null | undefined = undefined): AdaptationResult => run(reviewed(family), certified(profile), { ...REQUEST, contentUseClass: 'EVIDENCE_BEARING', ...request }, POLICY, component === null ? null : certified(component ?? DEFAULT_COMPONENT[profile.profileId]));
const spec = (r: AdaptationResult): AdaptationSpecification => { if (!r.ok) throw new Error(`refused: ${r.refusal.code} ${r.refusal.detail}`); return r.specification; };
const refusal = (r: AdaptationResult): string => (r.ok ? 'NOT_REFUSED' : r.refusal.code);
const MATRIX = buildMathAdaptationMatrix();
const { specifications: ALL_SPECS } = buildMathPocSpecifications();
/** The component-level specifications, keyed `<familyId>|<componentId>`. */
const SPECS = new Map([...ALL_SPECS.entries()].filter(([, s]) => s.componentProfile !== null));
const COMPONENT_CELLS = MATRIX.cells.filter((c) => c.level === 'COMPONENT');

describe('task family: canonical knowledge is referenced, never duplicated', () => {
  it('the ten proof-of-concept families are valid MATH_PROBLEM families, all DRAFT and UNREVIEWED, written by StudyUs with no copied expression', () => {
    expect(MATH_POC_FAMILIES.length).toBe(10);
    expect(new Set(MATH_POC_FAMILIES.map((f) => f.familyId)).size).toBe(10);
    for (const f of MATH_POC_FAMILIES) {
      const v = DEFAULT_TASK_FAMILY_REGISTRY.validate(f);
      expect(v.ok, `${f.familyId}: ${v.ok ? '' : v.details.join('; ')}`).toBe(true);
      expect([f.familyType, f.lifecycle, f.reviewStatus, f.provenance.authoredBy, f.provenance.containsCopiedProtectedExpression]).toEqual(['MATH_PROBLEM', 'DRAFT', 'UNREVIEWED', 'STUDYUS', false]);
      // a first draft written by a model is STUDYUS_GENERATED, and says so
      expect(f.provenance.authoringKind).toBe('STUDYUS_GENERATED');
    }
    // a family cannot certify itself
    expect(DEFAULT_TASK_FAMILY_REGISTRY.validate({ ...clone(MISSING_VALUE), lifecycle: 'CERTIFIED' }).ok).toBe(false);
  });

  it('every PRIMARY concept is a certified identity -- same stable id, same canonical subject, same name -- and two families share each of five concepts', () => {
    for (const f of MATH_POC_FAMILIES) for (const c of f.primaryConcepts) expect(PAA_CONCEPT_IDENTITIES.find((x) => x.stableId === c.stableId), c.stableId).toEqual({ stableId: c.stableId, canonicalSubject: c.canonicalSubject, canonicalName: c.canonicalName });
    const perConcept = new Map<string, number>();
    for (const f of MATH_POC_FAMILIES) perConcept.set(f.primaryConcepts[0].stableId, (perConcept.get(f.primaryConcepts[0].stableId) ?? 0) + 1);
    expect([...perConcept.entries()].sort()).toEqual([['math.alg.quadratics', 2], ['math.fun.linear-functions-lines', 2], ['math.num.ratio-proportion', 2], ['math.prob.probability', 2], ['math.stat.data-representation', 2]]);
  });

  it('no per-exam concept id exists anywhere: families, profiles and specifications name concepts only by certified stable ids', () => {
    const certified = new Set(PAA_CONCEPT_IDENTITIES.map((c) => c.stableId));
    const perExam = /^(paa|ib|ibdp|pisa|icfes|saber|cambridge|cie|aice)[._-]/i;
    const ids = [...MATH_POC_FAMILIES.flatMap((f) => f.primaryConcepts.map((c) => c.stableId)), ...[...SPECS.values()].flatMap((s) => [s.primaryConcept.stableId, ...s.invariants.primaryConceptStableIds])];
    for (const id of ids) { expect(certified.has(id), id).toBe(true); expect(id).not.toMatch(perExam); }
    // a family id belongs to no exam either
    for (const f of MATH_POC_FAMILIES) expect(f.familyId).not.toMatch(/paa|pisa|icfes|saber|cambridge|aice|\bib\b/i);
    // the same concept reaches several systems through ONE id: quadratics is specified for four of them
    expect(new Set([...SPECS.values()].filter((s) => s.primaryConcept.stableId === 'math.alg.quadratics').map((s) => s.systemProfile.profileId)).size).toBe(4);
    expect(new Set([...SPECS.values()].filter((s) => s.primaryConcept.stableId === 'math.alg.quadratics').map((s) => canonicalJson(s.primaryConcept))).size).toBe(1);
  });

  it('a family carries its concept\'s own canonical subject: Matemáticas and Mathematics are never merged, aliased or inferred', () => {
    expect([...new Set(MATH_POC_FAMILIES.map((f) => f.canonicalSubject))].sort()).toEqual(['Matemáticas', 'Mathematics']);
    expect(MATH_POC_FAMILIES.filter((f) => f.canonicalSubject === 'Mathematics').map((f) => f.primaryConcepts[0].stableId)).toEqual(['math.alg.quadratics', 'math.alg.quadratics']);
    // a family says nothing about applicability: the field does not exist, and cannot be added
    expect(Object.keys(TaskFamilyCommonSchema.shape)).not.toContain('canonicalKnowledgeAvailability');
    expect(TaskFamilyCommonSchema.safeParse({ ...clone(MISSING_VALUE), assessmentApplicability: {} }).success).toBe(false);
    // a concept of another subject cannot sit in a family, whatever its name
    const mixed = { ...clone(MISSING_VALUE), canonicalSubject: 'Mathematics' };
    expect(TaskFamilyCommonSchema.safeParse(mixed).error?.issues.map((i) => i.message)).toContain('CONCEPT_IS_OF_ANOTHER_CANONICAL_SUBJECT');
    for (const d of [FAMILIES_DIR, ADAPTATION_DIR]) for (const f of walk(d)) expect(code(f), f).not.toMatch(/Matemáticas'\s*[=!]==?\s*'Mathematics|SUBJECT_ALIAS|subjectAlias|equivalentSubject|toLowerCase\(\)\.startsWith\('mat/i);
  });

  it('the restated vocabularies are the repository\'s own: response formats, calculator policies, bands, stimulus kinds, skills and competencies', () => {
    const componentFormats = (ComponentDefinitionSchema.shape.responseFormats as unknown as { element: { options: string[] } }).element.options;
    for (const f of ELICITATION_FORMATS) expect(componentFormats, f).toContain(f);
    expect([...CALCULATOR_POLICIES]).toEqual((ComponentDefinitionSchema.shape.calculatorPolicy as unknown as { unwrap: () => { options: string[] } }).unwrap().options);
    expect([...TASK_DIFFICULTY_BANDS]).toEqual([...DIFFICULTY_BANDS]);
    const links = Object.values(allLearningLinks());
    const skills = new Set(links.flatMap((l) => l.skills ?? []));
    const competencies = new Set(links.flatMap((l) => l.competencies ?? []));
    for (const f of MATH_POC_FAMILIES) {
      for (const k of f.responseConstraints.stimulusKinds) expect(STIMULUS_KINDS as readonly string[], k).toContain(k);
      for (const s of f.targetSkills) expect(skills.has(s), s).toBe(true);
      for (const c of f.targetCompetencies) expect(competencies.has(c), c).toBe(true);
    }
    // every production format has an elicitation format and back
    expect([PRODUCTION_FORMAT_OF.SELECTED_RESPONSE, PRODUCTION_FORMAT_OF.NUMERIC_ENTRY, PRODUCTION_FORMAT_OF.EXTENDED_RESPONSE]).toEqual(['MULTIPLE_CHOICE', 'STUDENT_PRODUCED', null]);
  });

  it('a mathematics family states structure, ranges and modelled errors; an instance outside its ranges is named', () => {
    const s = MISSING_VALUE.specialization;
    expect(parameterizationViolations(s, { a: 4, b: 10, c: 6 })).toEqual([]);
    expect(parameterizationViolations(s, { a: 1, b: 10, c: 6.5, z: 3 })).toEqual(['OUT_OF_RANGE:a', 'OFF_STEP:c', 'NO_RANGE_FOR:z']);
    const bad = clone(MISSING_VALUE);
    bad.specialization.parameterRanges[0].symbol = 'q';
    expect(DEFAULT_TASK_FAMILY_REGISTRY.validate(bad)).toMatchObject({ ok: false, issue: 'SPECIALIZATION_INVALID' });
    for (const f of MATH_POC_FAMILIES) {
      expect(f.specialization.misconceptionModels.length, f.familyId).toBeGreaterThanOrEqual(3);
      // a family holds no item: no stem-like sentence ends in a question mark anywhere in it
      expect(JSON.stringify(f)).not.toMatch(/[?¿]/);
    }
  });
});

describe('the discipline specialisation is an open, registered model', () => {
  const ReadingSchema = z.strictObject({ textTypes: z.array(z.string()).min(1), readingOperation: z.string().min(3) });
  const READING: TaskFamilySpecialization<z.infer<typeof ReadingSchema>> = { familyType: 'READING_ANALYSIS', discipline: 'READING', version: 'test', schema: ReadingSchema, adaptationFacts: (s) => ({ invariantConstruct: { readingOperation: s.readingOperation }, toolDependency: 'NONE', parameterization: { textTypes: s.textTypes }, misconceptionModelIds: [] }) };
  const readingFamily = { ...clone(MISSING_VALUE), familyId: 'tf.reading.test-inference', familyType: 'READING_ANALYSIS', canonicalSubject: 'Lectura crítica', primaryConcepts: [{ stableId: 'read.inference', canonicalSubject: 'Lectura crítica', canonicalName: 'Inferencia textual' }], specialization: { textTypes: ['INFORMATIVE'], readingOperation: 'INFER_FROM_TWO_STATEMENTS' } };

  it('the brief\'s eight types are known; only MATH_PROBLEM is implemented, and a declared type is refused until it is registered', () => {
    // EA-1A added the STEM-oriented names and renamed SCIENCE_INVESTIGATION (declared only) to SCIENTIFIC_INVESTIGATION, keeping the old name as an alias
    expect(Object.keys(KNOWN_FAMILY_TYPES).sort()).toEqual(['CASE_ANALYSIS', 'COMPUTATIONAL_PROBLEM', 'DATA_ANALYSIS', 'ENGINEERING_DESIGN', 'INTERDISCIPLINARY_CHALLENGE', 'LANGUAGE_USE', 'MATHEMATICAL_MODELLING', 'MATH_PROBLEM', 'READING_ANALYSIS', 'SCIENCE_PROBLEM', 'SCIENTIFIC_INVESTIGATION', 'SOURCE_ANALYSIS', 'WRITING_EDITING']);
    expect(Object.entries(KNOWN_FAMILY_TYPES).filter(([, t]) => t.status === 'IMPLEMENTED').map(([k]) => k)).toEqual(['MATH_PROBLEM']);
    for (const t of Object.values(KNOWN_FAMILY_TYPES)) expect(t.intendedSpecializationFields.length).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_TASK_FAMILY_REGISTRY.familyTypes()).toEqual(['MATH_PROBLEM']);
    expect(DEFAULT_TASK_FAMILY_REGISTRY.validate(readingFamily)).toMatchObject({ ok: false, issue: 'FAMILY_TYPE_NOT_REGISTERED' });
    expect(refusal(run(readingFamily, PAA_SYSTEM_PROFILE))).toBe('FAMILY_TYPE_NOT_REGISTERED');
  });

  it('a future type is added by REGISTERING a schema: the common schema is the same object and the default registry is untouched', () => {
    const commonBefore = canonicalJson(Object.keys(TaskFamilyCommonSchema.shape));
    const extended = DEFAULT_TASK_FAMILY_REGISTRY.with(READING);
    expect(extended.familyTypes()).toEqual(['MATH_PROBLEM', 'READING_ANALYSIS']);
    expect(extended.validate(readingFamily)).toMatchObject({ ok: true });
    expect(extended.validate({ ...readingFamily, specialization: { textTypes: [] } })).toMatchObject({ ok: false, issue: 'SPECIALIZATION_INVALID' });
    expect(extended.validate(MISSING_VALUE).ok).toBe(true);
    expect(DEFAULT_TASK_FAMILY_REGISTRY.familyTypes()).toEqual(['MATH_PROBLEM']);
    expect(canonicalJson(Object.keys(TaskFamilyCommonSchema.shape))).toBe(commonBefore);
    expect(() => extended.with(READING)).toThrow(/FAMILY_TYPE_ALREADY_REGISTERED/);
    // registered, but no policy translates for it: the mathematics policy is never applied by analogy
    expect(refusal(adapt({ family: readingFamily, profile: PAA_SYSTEM_PROFILE, disciplinePolicy: POLICY, request: REQUEST, registry: extended }))).toBe('DISCIPLINE_POLICY_NOT_FOR_FAMILY_TYPE');
    // and with a policy of its own discipline the SAME engine adapts it: nothing in the engine is mathematics
    const readingPolicy = { ...clone(POLICY), policyId: 'test.reading', discipline: 'READING', familyTypes: ['READING_ANALYSIS'] };
    const s = spec(adapt({ family: readingFamily, profile: PAA_SYSTEM_PROFILE, disciplinePolicy: readingPolicy, request: REQUEST, registry: extended }));
    expect([s.taskFamily.familyType, s.disciplinePolicy.discipline, s.invariants.construct]).toEqual(['READING_ANALYSIS', 'READING', { readingOperation: 'INFER_FROM_TWO_STATEMENTS' }]);
  });
});

describe('assessment applicability (D1): a recorded fact about a concept and a scope, never a certification and never inferred', () => {
  const LINKS = allLearningLinks();
  const name = (stableId: string) => PAA_CONCEPT_IDENTITIES.find((c) => c.stableId === stableId)!;
  const quad = { stableId: 'math.alg.quadratics', canonicalSubject: 'Mathematics' };
  const linear = { stableId: 'math.fun.linear-functions-lines', canonicalSubject: 'Matemáticas' };

  it('the register is exactly what the repository records: official PAA Topics and reviewed objective links, nothing added', () => {
    expect(applicabilityRegisterIssues(MATH_POC_APPLICABILITY)).toEqual([]);
    const rebuilt: Array<{ key: string; basis: string; refs: string[] }> = [];
    const mathDomains = new Set(PAA_DOMAINS.filter((d) => d.sectionCode === 'paa.sec.matematicas').map((d) => d.code));
    for (const id of POC_CONCEPT_IDS) {
      const c = name(id);
      // OFFICIAL_EXAM_STRUCTURE: every OFFICIAL Topic of the Matemáticas section whose certified concept is this one
      const topics = PAA_TOPICS.filter((t) => t.certifiedConceptId === id && t.authority === 'OFFICIAL' && mathDomains.has(t.domainCode));
      if (topics.length > 0) rebuilt.push({ key: `${id}|${c.canonicalSubject}|PAA.MATEMATICAS`, basis: 'OFFICIAL_EXAM_STRUCTURE', refs: topics.map((t) => `${t.code}@${t.sourceReference}`).sort() });
      // REVIEWED_CATALOGUE_LINK: every objective of a modelled component whose link names this exact (subject, name)
      for (const [componentId, prefix] of Object.entries(MATH_POC_COMPONENT_OBJECTIVE_PREFIX)) {
        const objectives = Object.entries(LINKS).filter(([code, link]) => code.startsWith(prefix) && (componentId !== 'PISA.MATHEMATICS' || PISA_MATHEMATICS_OBJECTIVE.test(code)) && (link.concepts ?? []).some((x) => x.subject === c.canonicalSubject && x.name === c.canonicalName)).map(([code]) => `${code}@null`).sort();
        if (objectives.length > 0) rebuilt.push({ key: `${id}|${c.canonicalSubject}|${componentId}`, basis: 'REVIEWED_CATALOGUE_LINK', refs: objectives });
      }
    }
    const recorded = MATH_POC_APPLICABILITY.map((r) => ({ key: `${r.concept.stableId}|${r.concept.canonicalSubject}|${r.scope.componentId}`, basis: r.basis, refs: r.evidence.map((e) => `${e.reference}@${e.sourceReference}`).sort() }));
    const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : 1);
    expect([...recorded].sort(byKey)).toEqual(rebuilt.sort(byKey));
    expect(recorded.length).toBe(9);
    // review state follows the kind of evidence: a certified structure node, or a link its module declares reviewed
    for (const r of MATH_POC_APPLICABILITY) for (const e of r.evidence) expect(e.reviewState).toBe(e.kind === 'OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT' ? 'CERTIFIED' : 'DECLARED_REVIEWED');
    expect(read('src/lib/exam-core/catalog/pisa-learning-links.ts')).toMatch(/reviewed links/);
    expect(read('src/lib/exam-core/catalog/aice-learning-links.ts')).toMatch(/reviewed links/);
    expect(read('src/lib/exam-core/catalog/objective-learning-links.ts')).toMatch(/reviewed links/);
  });

  it('a record references the concept and restates nothing of it; it cannot re-key, rename or move it', () => {
    expect(Object.keys(AssessmentApplicabilityRecordSchema.shape).sort()).toEqual(['basis', 'concept', 'evidence', 'scope', 'v']);
    expect(Object.keys(AssessmentApplicabilityRecordSchema.shape.concept.shape).sort()).toEqual(['canonicalSubject', 'stableId']);
    const r = clone(MATH_POC_APPLICABILITY[0]);
    for (const extra of [{ examConceptId: 'paa.math.ratio' }, { conceptDefinition: 'x' }, { certifiesConcept: true }]) expect(AssessmentApplicabilityRecordSchema.safeParse({ ...r, ...extra }).success).toBe(false);
    expect(AssessmentApplicabilityRecordSchema.safeParse({ ...r, concept: { ...r.concept, canonicalName: 'Otro nombre' } }).success).toBe(false);
    // every concept of the register is a certified identity under its OWN canonical subject
    for (const x of MATH_POC_APPLICABILITY) expect(name(x.concept.stableId).canonicalSubject).toBe(x.concept.canonicalSubject);
    // the exam's local subject label is a label of the scope: for PAA it reads Matemáticas while the quadratics concept is owned by Mathematics
    const paaQuad = MATH_POC_APPLICABILITY.find((x) => x.concept.stableId === 'math.alg.quadratics' && x.scope.systemProfileId === 'PAA')!;
    expect([paaQuad.concept.canonicalSubject, paaQuad.scope.subject, paaQuad.basis]).toEqual(['Mathematics', 'Matemáticas', 'OFFICIAL_EXAM_STRUCTURE']);
  });

  it('a basis is what its evidence is: it cannot be claimed above it, and NONE has no evidence', () => {
    const official = clone(MATH_POC_APPLICABILITY.find((x) => x.basis === 'OFFICIAL_EXAM_STRUCTURE')!);
    const link = clone(MATH_POC_APPLICABILITY.find((x) => x.basis === 'REVIEWED_CATALOGUE_LINK')!);
    const messages = (r: unknown) => AssessmentApplicabilityRecordSchema.safeParse(r).error?.issues.map((i) => i.message) ?? [];
    expect(messages({ ...link, basis: 'OFFICIAL_EXAM_STRUCTURE' })).toContain('OFFICIAL_BASIS_NEEDS_AN_OFFICIAL_STRUCTURE_NODE');
    expect(messages({ ...official, basis: 'REVIEWED_CATALOGUE_LINK' })).toContain('OFFICIAL_EVIDENCE_IS_NOT_A_CATALOGUE_BASIS');
    expect(messages({ ...link, evidence: [] })).toContain('CATALOGUE_BASIS_NEEDS_A_LINK');
    expect(messages({ ...link, basis: 'NONE' })).toContain('NO_BASIS_HAS_NO_EVIDENCE');
    expect(messages({ ...official, evidence: [{ ...official.evidence[0], sourceReference: null }] })).toContain('OFFICIAL_NODE_NEEDS_ITS_SOURCE_REFERENCE');
    expect(applicabilityRegisterIssues([official, official])[0]).toMatch(/RECORD_LISTED_TWICE/);
  });

  it('the threshold policy decides which basis, at which review state, ESTABLISHES applicability', () => {
    expect(EA1_APPLICABILITY_THRESHOLD).toMatchObject({ authority: 'STUDYUS_POLICY', satisfiedBy: [{ basis: 'OFFICIAL_EXAM_STRUCTURE', minimumReviewState: 'CERTIFIED' }, { basis: 'REVIEWED_CATALOGUE_LINK', minimumReviewState: 'DECLARED_REVIEWED' }] });
    const link = MATH_POC_APPLICABILITY.find((x) => x.basis === 'REVIEWED_CATALOGUE_LINK')!;
    expect(applicabilityStatusOf(link, EA1_APPLICABILITY_THRESHOLD)).toBe('ESTABLISHED');
    // a stricter threshold: a link that is only DECLARED reviewed no longer establishes; an unreviewed link never does
    const strict: ApplicabilityThresholdPolicy = { ...EA1_APPLICABILITY_THRESHOLD, version: 'strict', satisfiedBy: [{ basis: 'OFFICIAL_EXAM_STRUCTURE', minimumReviewState: 'CERTIFIED' }, { basis: 'REVIEWED_CATALOGUE_LINK', minimumReviewState: 'CERTIFIED' }] };
    expect(applicabilityStatusOf(link, strict)).toBe('NOT_ESTABLISHED');
    expect(applicabilityStatusOf({ ...link, evidence: link.evidence.map((e) => ({ ...e, reviewState: 'UNREVIEWED' as const })) }, EA1_APPLICABILITY_THRESHOLD)).toBe('NOT_ESTABLISHED');
    const officialOnly: ApplicabilityThresholdPolicy = { ...EA1_APPLICABILITY_THRESHOLD, version: 'official-only', satisfiedBy: [{ basis: 'OFFICIAL_EXAM_STRUCTURE', minimumReviewState: 'CERTIFIED' }] };
    expect(applicabilityStatusOf(link, officialOnly)).toBe('NOT_ESTABLISHED');
    expect(applicabilityStatusOf({ basis: 'NONE', evidence: [] }, EA1_APPLICABILITY_THRESHOLD)).toBe('NOT_ESTABLISHED');
    // the engine applies the policy it is given, and records which one
    const p1 = adapt({ family: FACTORISING, profile: IB_SYSTEM_PROFILE, component: IB_MATH_AA_HL_P1_COMPONENT, applicability: MATH_POC_APPLICABILITY, applicabilityPolicy: strict, disciplinePolicy: POLICY, request: REQUEST });
    expect(spec(p1).assessmentApplicability).toMatchObject({ status: 'NOT_ESTABLISHED', basis: 'REVIEWED_CATALOGUE_LINK', thresholdPolicy: { version: 'strict' } });
  });

  it('scope: a component is answered by its own record or the system\'s, never by another component\'s; nothing is recorded => NONE', () => {
    const at = (concept: { stableId: string; canonicalSubject: string }, systemProfileId: string, componentId: string | null) => { const a = resolveApplicability(MATH_POC_APPLICABILITY, concept, { systemProfileId, componentId }); return `${a.status}:${a.basis}`; };
    expect(at(quad, 'PAA', 'PAA.MATEMATICAS')).toBe('ESTABLISHED:OFFICIAL_EXAM_STRUCTURE');
    expect(at(quad, 'IB', 'IB.MATH_AA_HL.P1')).toBe('ESTABLISHED:REVIEWED_CATALOGUE_LINK');
    // the IB link is of a Paper 1 objective: it says nothing about Paper 2
    expect(at(quad, 'IB', 'IB.MATH_AA_HL.P2')).toBe('NOT_ESTABLISHED:NONE');
    // the system as a whole assesses the concept somewhere
    expect(at(quad, 'IB', null)).toBe('ESTABLISHED:REVIEWED_CATALOGUE_LINK');
    expect(at(quad, 'CAMBRIDGE', 'CAMBRIDGE.9709.P1')).toBe('ESTABLISHED:REVIEWED_CATALOGUE_LINK');
    expect(at(quad, 'PISA', 'PISA.MATHEMATICS')).toBe('NOT_ESTABLISHED:NONE');
    expect(at(quad, 'ICFES', 'ICFES.SABER11_MATEMATICAS')).toBe('NOT_ESTABLISHED:NONE');
    // NO BRIDGE BY NAME: a Matemáticas concept is not applicable to IB because IB assesses "Mathematics", and the
    // quadratics id under the other subject is another concept
    expect(at(linear, 'IB', 'IB.MATH_AA_HL.P1')).toBe('NOT_ESTABLISHED:NONE');
    expect(at({ stableId: 'math.alg.quadratics', canonicalSubject: 'Matemáticas' }, 'IB', 'IB.MATH_AA_HL.P1')).toBe('NOT_ESTABLISHED:NONE');
    expect(at({ stableId: 'math.alg.quadratics', canonicalSubject: 'Matemáticas' }, 'PAA', 'PAA.MATEMATICAS')).toBe('NOT_ESTABLISHED:NONE');
    for (const f of [...walk(ADAPTATION_DIR), ...walk(FAMILIES_DIR)]) expect(code(f), f).not.toMatch(/Matemáticas'\s*[=!]==?\s*'Mathematics|SUBJECT_ALIAS|subjectAlias|equivalentSubject|normalizeSubject|toLowerCase\(\)\.startsWith\('mat/i);
    // an empty register: nothing is established for anything
    expect(resolveApplicability([], quad, { systemProfileId: 'PAA', componentId: 'PAA.MATEMATICAS' })).toMatchObject({ status: 'NOT_ESTABLISHED', basis: 'NONE', evidence: [] });
  });

  it('a concept owned by Mathematics is assessed under PAA, IB and Cambridge where applicability exists -- the canonical subject label need not match the exam\'s', () => {
    for (const [system, component, basis] of [[PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT, 'OFFICIAL_EXAM_STRUCTURE'], [IB_SYSTEM_PROFILE, IB_MATH_AA_HL_P1_COMPONENT, 'REVIEWED_CATALOGUE_LINK'], [CAMBRIDGE_SYSTEM_PROFILE, CAMBRIDGE_COMPONENT, 'REVIEWED_CATALOGUE_LINK']] as const) {
      const s = spec(run(FACTORISING, system, { ...REQUEST, applicabilityRequirement: 'ESTABLISHED' }, POLICY, component));
      expect([s.primaryConcept.canonicalSubject, s.assessmentApplicability.status, s.assessmentApplicability.basis], component.componentId).toEqual(['Mathematics', 'ESTABLISHED', basis]);
      // the specification carries the repository's evidence, with its review state
      expect(s.assessmentApplicability.evidence.length).toBeGreaterThanOrEqual(1);
      expect(s.assessmentApplicability.scope.componentId).toBe(component.componentId);
    }
    // the same concept object everywhere: one id, one subject, never a per-exam copy
    expect(new Set([...SPECS.values()].filter((x) => x.primaryConcept.stableId === 'math.alg.quadratics').map((x) => canonicalJson(x.primaryConcept))).size).toBe(1);
  });

  it('where applicability is NOT established, dev-test content records it and anything that requires it is refused by name', () => {
    const dev = spec(run(LINEAR_MODEL, IB_SYSTEM_PROFILE));
    expect([dev.contentUseClass, dev.assessmentApplicability.status, dev.assessmentApplicability.basis]).toEqual(['DEV_TEST_CONTENT', 'NOT_ESTABLISHED', 'NONE']);
    expect(refusal(run(LINEAR_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, applicabilityRequirement: 'ESTABLISHED' }))).toBe('ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED');
    expect(refusal(run(FACTORISING, IB_SYSTEM_PROFILE, { ...REQUEST, applicabilityRequirement: 'ESTABLISHED' }, POLICY, IB_MATH_AA_HL_P2_COMPONENT))).toBe('ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED');
    // evidence-bearing content requires it whatever the request says -- even from a reviewed family, even asking NOT_REQUIRED
    const r = runCertified(LINEAR_MODEL, IB_SYSTEM_PROFILE, { applicabilityRequirement: 'NOT_REQUIRED' });
    expect(r).toMatchObject({ ok: false, refusal: { code: 'ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED' } });
    expect(spec(runCertified(FACTORISING, IB_SYSTEM_PROFILE)).assessmentApplicability.status).toBe('ESTABLISHED');
    // no register given = nothing recorded = nothing established
    expect(refusal(adapt({ family: reviewed(FACTORISING), profile: certified(PAA_SYSTEM_PROFILE), component: certified(PAA_MATEMATICAS_COMPONENT), disciplinePolicy: POLICY, request: { ...REQUEST, contentUseClass: 'EVIDENCE_BEARING' } }))).toBe('ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED');
    expect(refusal(adapt({ family: MISSING_VALUE, profile: PAA_SYSTEM_PROFILE, component: PAA_MATEMATICAS_COMPONENT, applicability: [{ not: 'a record' }], disciplinePolicy: POLICY, request: REQUEST }))).toBe('APPLICABILITY_REGISTER_INVALID');
    // applicability grants nothing else: no reviewer qualification, no concept certification, no right
    expect([...NOT_ESTABLISHED_BY_ADAPTATION]).toEqual(expect.arrayContaining(['REVIEWER_QUALIFICATION', 'CONCEPT_CERTIFICATION', 'REUSE_RIGHTS']));
  });
});

describe('profile hierarchy (D2, D3): system profile -> component profile, mixed authority', () => {
  const def = (cfg: { sections: Array<{ key: string; definition?: unknown }> }, key: string) => cfg.sections.find((s) => s.key === key)!.definition as { responseFormats: string[]; calculatorPolicy: string | null; officialDurationMinutes: number | null; maxMarks: number | null; officialItemCount?: number | null; commandTerms?: string[]; sourceKeys: string[]; distributions?: Array<{ dimension: string; values: Record<string, string> }>; blueprintSpecification?: { status: string } };
  const over = <K extends keyof ProfileRules>(componentId: string, d: K): NonNullable<AssessmentComponentProfile['overrides'][K]> => componentProfileOf(componentId)!.overrides[d]!;
  const sourcesOf = (rule: { authority: ProfileRules[keyof ProfileRules]['authority'] }) => (rule.authority.kind === 'OFFICIAL' ? rule.authority.sources.map((x) => x.sourceKey) : []);

  it('five system profiles and six component profiles, all valid, MIXED_AUTHORITY and illustrative; no SEP, no invented paper', () => {
    expect(EA1_SYSTEM_PROFILES.map((p) => p.profileId)).toEqual([...MATH_POC_PROFILE_IDS]);
    expect(EA1_COMPONENT_PROFILES.map((c) => c.componentId)).toEqual(['PAA.MATEMATICAS', 'IB.MATH_AA_HL.P1', 'IB.MATH_AA_HL.P2', 'CAMBRIDGE.9709.P1', 'PISA.MATHEMATICS', 'ICFES.SABER11_MATEMATICAS']);
    for (const p of EA1_SYSTEM_PROFILES) {
      const v = validateAssessmentSystemProfile(p);
      expect(v.ok, `${p.profileId}: ${v.ok ? '' : v.issues.join('; ')}`).toBe(true);
      expect([p.status, p.certification, p.specification.basis]).toEqual(['PROVISIONAL_ILLUSTRATIVE', null, 'MIXED_AUTHORITY']);
      expect(EXAM_FAMILIES as readonly string[]).toContain(p.examFamilyCode);
      expect(systemProfileOfExamFamily(p.examFamilyCode!)).toBe(p);
      expect(componentProfilesOf(p.profileId).length).toBeGreaterThanOrEqual(1);
    }
    for (const c of EA1_COMPONENT_PROFILES) {
      const parsed = AssessmentComponentProfileSchema.safeParse(c);
      expect(parsed.success, `${c.componentId}: ${parsed.success ? '' : parsed.error.issues.map((i) => i.message).join('; ')}`).toBe(true);
      expect([c.status, c.certification, c.specification.basis]).toEqual(['PROVISIONAL_ILLUSTRATIVE', null, 'MIXED_AUTHORITY']);
      expect(resolveProfile(systemProfileOf(c.systemProfileId), c).ok).toBe(true);
    }
    expect(systemProfileOf('SEP')).toBeNull();
    // EA-1A D5: AICE has no profile of its own; as a qualification context it is assessed by the CAMBRIDGE system
    expect(systemProfileOf('AICE')).toBeNull();
    expect(systemProfileOfExamFamily('AICE')).toBe(CAMBRIDGE_SYSTEM_PROFILE);
    // every modelled component is one the repository records
    expect(PAA_V2.sections.map((x) => x.key)).toContain('matematicas');
    expect(IB_MATH_AA_HL_V2.sections.map((x) => x.key)).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(AICE_SYLLABI.find((x) => x.code === '9709')!.components.map((x) => x.key)).toContain('p1');
    expect([PISA_MATH_V2.sections.length, SABER11_MATH_V2.sections.length]).toEqual([1, 1]);
  });

  it('inheritance: an override replaces the system\'s rule whole, the rest is inherited, and every dimension says where it came from', () => {
    const r = resolveProfile(IB_SYSTEM_PROFILE, IB_MATH_AA_HL_P2_COMPONENT);
    if (!r.ok) throw new Error(r.issue);
    expect(r.resolved.component).toEqual({ componentId: 'IB.MATH_AA_HL.P2', version: IB_MATH_AA_HL_P2_COMPONENT.version, status: 'PROVISIONAL_ILLUSTRATIVE', localSubject: 'Mathematics: analysis and approaches', versionBinding: IB_MATH_AA_HL_P2_COMPONENT.versionBinding });
    const overridden = ['responseFormats', 'timePressure', 'commandTerms', 'calculatorPolicy'];
    for (const d of PROFILE_RULE_DIMENSIONS) {
      expect(r.resolved.ruleOrigin[d], d).toBe(overridden.includes(d) ? 'COMPONENT' : 'SYSTEM');
      expect(r.resolved.rules[d]).toEqual(overridden.includes(d) ? IB_MATH_AA_HL_P2_COMPONENT.overrides[d] : IB_SYSTEM_PROFILE.rules[d]);
    }
    // the override carries ITS OWN authority: the system's fallback is policy, the component's fact is official with its source
    expect([IB_SYSTEM_PROFILE.rules.calculatorPolicy.authority.kind, r.resolved.rules.calculatorPolicy.authority.kind, r.resolved.rules.calculatorPolicy.value]).toEqual(['STUDYUS_POLICY', 'OFFICIAL', { allowed: ['GDC_REQUIRED'] }]);
    expect(r.resolved.unsettledDimensions).toEqual([]);
    // without a component the system's rules stand and its component-dependent dimensions are unsettled
    const alone = resolveProfile(IB_SYSTEM_PROFILE);
    if (!alone.ok) throw new Error(alone.issue);
    expect([alone.resolved.component, alone.resolved.unsettledDimensions, new Set(Object.values(alone.resolved.ruleOrigin)).size]).toEqual([null, ['responseFormats', 'timePressure', 'commandTerms', 'calculatorPolicy'], 1]);
    // resolution is pure: neither input changes
    const before = [canonicalJson(IB_SYSTEM_PROFILE), canonicalJson(IB_MATH_AA_HL_P2_COMPONENT)];
    resolveProfile(IB_SYSTEM_PROFILE, IB_MATH_AA_HL_P2_COMPONENT);
    expect([canonicalJson(IB_SYSTEM_PROFILE), canonicalJson(IB_MATH_AA_HL_P2_COMPONENT)]).toEqual(before);
  });

  it('an override preserves authority and source provenance: an OFFICIAL override needs its own source, declared by the component', () => {
    const c = clone(PAA_MATEMATICAS_COMPONENT) as AssessmentComponentProfile;
    (c.overrides.calculatorPolicy as { authority: unknown }).authority = { kind: 'OFFICIAL' };
    expect(AssessmentComponentProfileSchema.safeParse(c).success).toBe(false);
    (c.overrides.calculatorPolicy as { authority: unknown }).authority = { kind: 'OFFICIAL', sources: [{ sourceKey: 'ibo-math-aa-guide-2021', locator: 'somewhere' }] };
    expect(AssessmentComponentProfileSchema.safeParse(c).error?.issues.map((i) => i.message)).toContain('SOURCE_NOT_IN_THE_PROFILES_SPECIFICATION_RECORDS');
    // a component may override only what its system declares component-dependent
    const stray = clone(PAA_MATEMATICAS_COMPONENT) as AssessmentComponentProfile;
    stray.overrides.rubricStyle = { ruleId: 'paa.matematicas.rubric', value: 'KEY_ONLY', authority: { kind: 'STUDYUS_POLICY', provisional: true, assumption: 'An override of a dimension the system keeps common.' } };
    expect(resolveProfile(PAA_SYSTEM_PROFILE, stray)).toMatchObject({ ok: false, issue: 'OVERRIDE_OF_A_DIMENSION_THAT_IS_NOT_COMPONENT_DEPENDENT', details: ['rubricStyle'] });
    expect(resolveProfile(IB_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT)).toMatchObject({ ok: false, issue: 'COMPONENT_NOT_OF_THE_SYSTEM' });
    expect(AssessmentComponentProfileSchema.safeParse({ ...clone(PAA_MATEMATICAS_COMPONENT), componentId: 'IB.MATEMATICAS' }).error?.issues.map((i) => i.message)).toContain('COMPONENT_ID_IS_NOT_UNDER_ITS_SYSTEM');
    // the resolved rules are checked together: a component that overrides the competencies without their elicitation does not resolve
    const half = clone(PISA_MATHEMATICS_COMPONENT) as AssessmentComponentProfile;
    delete half.overrides.competencyElicitation;
    expect(resolveProfile(PISA_SYSTEM_PROFILE, half)).toMatchObject({ ok: false, issue: 'RESOLVED_RULES_INCONSISTENT' });
    // a dimension that differs by component is never OFFICIAL at system level: what components have in common is an inference
    const promoted = clone(IB_SYSTEM_PROFILE) as AssessmentSystemProfile;
    (promoted.rules.calculatorPolicy as { authority: unknown }).authority = { kind: 'OFFICIAL', sources: [{ sourceKey: 'ibo-math-aa-guide-2021', locator: 'union of the two papers' }] };
    expect(AssessmentSystemProfileSchema.safeParse(promoted).error?.issues.map((i) => i.message)).toContain('COMPONENT_DEPENDENT_FALLBACK_IS_NOT_OFFICIAL');
    for (const p of EA1_SYSTEM_PROFILES) for (const d of p.componentDependentDimensions) expect(p.rules[d].authority.kind, `${p.profileId}.${d}`).toBe('STUDYUS_POLICY');
  });

  it('an OFFICIAL rule without source lineage is refused; a policy rule must say it is provisional; never an inference', () => {
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL' }).success).toBe(false);
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL', sources: [] }).success).toBe(false);
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL', sources: [{ sourceKey: 'cb-paa-guia-2021' }] }).success).toBe(false);
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL', sources: [{ sourceKey: 'cb-paa-guia-2021', locator: 'v2.paa > sections[matematicas]' }] }).success).toBe(true);
    expect(RuleAuthoritySchema.safeParse({ kind: 'STUDYUS_POLICY', assumption: 'A working assumption of StudyUs.' }).success).toBe(false);
    expect(RuleAuthoritySchema.safeParse({ kind: 'STUDYUS_POLICY', provisional: true, assumption: 'A working assumption of StudyUs.', sources: [] }).success).toBe(false);
    const p = clone(PAA_SYSTEM_PROFILE) as AssessmentSystemProfile;
    (p.rules.rubricStyle as { authority: unknown }).authority = { kind: 'OFFICIAL' };
    expect(AssessmentSystemProfileSchema.safeParse(p).success).toBe(false);
    (p.rules.rubricStyle as { authority: unknown }).authority = { kind: 'OFFICIAL', sources: [{ sourceKey: 'ibo-math-aa-guide-2021', locator: 'somewhere' }] };
    expect(AssessmentSystemProfileSchema.safeParse(p).error?.issues.map((i) => i.message)).toContain('SOURCE_NOT_IN_THE_PROFILES_SPECIFICATION_RECORDS');
    // STUDYUS_POLICY_ONLY: a profile the repository records nothing sourced for may hold no OFFICIAL rule and cites nothing
    const only = clone(CAMBRIDGE_SYSTEM_PROFILE) as AssessmentSystemProfile;
    only.specification = { basis: 'STUDYUS_POLICY_ONLY', records: [], note: 'No sourced fact in the repository.' };
    expect(AssessmentSystemProfileSchema.safeParse(only).error?.issues.map((i) => i.message)).toContain('STUDYUS_POLICY_ONLY_HOLDS_NO_OFFICIAL_RULE');
    for (const d of PROFILE_RULE_DIMENSIONS) (only.rules[d] as { authority: unknown }).authority = { kind: 'STUDYUS_POLICY', provisional: true, assumption: 'Entirely provisional working assumption.' };
    expect(AssessmentSystemProfileSchema.safeParse(only).success).toBe(true);
    expect(AssessmentSystemProfileSchema.safeParse({ ...clone(PAA_SYSTEM_PROFILE), specification: { ...PAA_SYSTEM_PROFILE.specification, basis: 'NO_CERTIFIED_SPECIFICATION' } }).success).toBe(false);
    expect(AssessmentSystemProfileSchema.safeParse({ ...clone(PAA_SYSTEM_PROFILE), status: 'CERTIFIED' }).success).toBe(false);
  });

  it('every OFFICIAL rule cites sources of the registry, and its value IS what the repository records at the cited place', () => {
    const registry = new Set(ASSESSMENT_SOURCES.map((s) => s.key));
    const allRules = [...EA1_SYSTEM_PROFILES.flatMap((p) => PROFILE_RULE_DIMENSIONS.map((d) => p.rules[d])), ...EA1_COMPONENT_PROFILES.flatMap((c) => PROFILE_RULE_DIMENSIONS.flatMap((d) => (c.overrides[d] ? [c.overrides[d]!] : [])))];
    expect(allRules.length).toBe(100);
    for (const r of allRules) for (const k of sourcesOf(r)) expect(registry.has(k), `${r.ruleId}: ${k}`).toBe(true);
    expect(allRules.filter((r) => r.authority.kind === 'OFFICIAL').length).toBe(23);
    // system level: the only official rule is one recorded for a whole syllabus
    expect(EA1_SYSTEM_PROFILES.map((p) => authorityBreakdown(p).official)).toEqual([[], [], ['competencyEmphasis'], [], []]);
    const officialOverrides = (id: string) => PROFILE_RULE_DIMENSIONS.filter((d) => componentProfileOf(id)!.overrides[d]?.authority.kind === 'OFFICIAL');

    const paa = def(PAA_V2 as never, 'matematicas');
    expect(officialOverrides('PAA.MATEMATICAS')).toEqual(['responseFormats', 'timePressure', 'calculatorPolicy']);
    expect(over('PAA.MATEMATICAS', 'responseFormats').value).toEqual(paa.responseFormats);
    expect(over('PAA.MATEMATICAS', 'timePressure').value).toEqual({ officialMinutes: paa.officialDurationMinutes, officialItems: paa.officialItemCount, officialMarks: paa.maxMarks });
    expect(over('PAA.MATEMATICAS', 'calculatorPolicy').value).toEqual({ allowed: [paa.calculatorPolicy] });
    expect(sourcesOf(over('PAA.MATEMATICAS', 'calculatorPolicy'))).toEqual(paa.sourceKeys);
    expect((PAA_V2 as { commandTerms?: unknown[] }).commandTerms).toEqual([]);
    // the other PAA sections record other facts: that is why these three dimensions are component-dependent
    expect(def(PAA_V2 as never, 'lectura')).toMatchObject({ responseFormats: ['SELECTED_RESPONSE'], calculatorPolicy: null, officialItemCount: 45 });

    for (const [id, key] of [['IB.MATH_AA_HL.P1', 'p1'], ['IB.MATH_AA_HL.P2', 'p2']] as const) {
      const d = def(IB_MATH_AA_HL_V2 as never, key);
      expect(officialOverrides(id)).toEqual(['responseFormats', 'timePressure', 'commandTerms', 'calculatorPolicy']);
      expect(over(id, 'responseFormats').value).toEqual(d.responseFormats);
      expect(over(id, 'timePressure').value).toEqual({ officialMinutes: d.officialDurationMinutes, officialItems: null, officialMarks: d.maxMarks });
      expect(over(id, 'commandTerms').value).toEqual({ use: 'CONTROLLED_VOCABULARY', terms: d.commandTerms });
      expect(over(id, 'calculatorPolicy').value).toEqual({ allowed: [d.calculatorPolicy] });
      expect(sourcesOf(over(id, 'commandTerms'))).toEqual(d.sourceKeys);
    }
    expect([over('IB.MATH_AA_HL.P1', 'calculatorPolicy').value.allowed, over('IB.MATH_AA_HL.P2', 'calculatorPolicy').value.allowed]).toEqual([['NONE'], ['GDC_REQUIRED']]);

    const s9709 = AICE_SYLLABI.find((s) => s.code === '9709')!;
    const c1 = s9709.components.find((c) => c.key === 'p1')!;
    expect(officialOverrides('CAMBRIDGE.9709.P1')).toEqual(['timePressure', 'calculatorPolicy']);
    expect(over('CAMBRIDGE.9709.P1', 'timePressure').value).toEqual({ officialMinutes: c1.minutes, officialItems: null, officialMarks: c1.marks });
    expect(c1.calculator).toMatch(/^Scientific calculator required/);
    expect(over('CAMBRIDGE.9709.P1', 'calculatorPolicy').value).toEqual({ allowed: ['SCIENTIFIC_REQUIRED'] });
    expect(CAMBRIDGE_SYSTEM_PROFILE.rules.competencyEmphasis.value).toEqual(s9709.assessmentObjectives.map((a) => ({ code: a.key, label: a.name, weightPercent: `${a.weightAS} (AS)` })));
    expect(sourcesOf(over('CAMBRIDGE.9709.P1', 'calculatorPolicy'))).toEqual([s9709.sourceKey]);
    // the command terms the Cambridge profile ASSUMES are the ones the repository records for another syllabus: policy, not official
    expect(CAMBRIDGE_SYSTEM_PROFILE.rules.commandTerms.value.terms).toEqual(def(CAMBRIDGE_0580_EXTENDED_V2 as never, 'p2').commandTerms);
    expect(CAMBRIDGE_SYSTEM_PROFILE.rules.commandTerms.authority.kind).toBe('STUDYUS_POLICY');

    const pisa = def(PISA_MATH_V2 as never, 'math');
    const dist = (d: typeof pisa, dimension: string) => d.distributions!.find((x) => x.dimension === dimension)!.values;
    // PISA is mixed authority like the others: official where the exact OECD-sourced fact is recorded, policy elsewhere
    expect(officialOverrides('PISA.MATHEMATICS')).toEqual(['responseFormats', 'timePressure', 'contextExpectations', 'calculatorPolicy', 'competencyEmphasis']);
    expect(over('PISA.MATHEMATICS', 'responseFormats').value).toEqual(pisa.responseFormats);
    expect(over('PISA.MATHEMATICS', 'timePressure').value).toEqual({ officialMinutes: pisa.officialDurationMinutes, officialItems: null, officialMarks: pisa.maxMarks });
    expect(over('PISA.MATHEMATICS', 'calculatorPolicy').value).toEqual({ allowed: [pisa.calculatorPolicy] });
    expect(over('PISA.MATHEMATICS', 'contextExpectations').value.allowed).toEqual(Object.keys(dist(pisa, 'Context')).map((k) => k.toUpperCase()));
    expect(over('PISA.MATHEMATICS', 'competencyEmphasis').value.map((c) => [c.label, c.weightPercent])).toEqual(Object.entries(dist(pisa, 'Process')));
    expect(sourcesOf(over('PISA.MATHEMATICS', 'responseFormats'))).toEqual(pisa.sourceKeys);
    expect(over('PISA.MATHEMATICS', 'competencyElicitation').authority.kind).toBe('STUDYUS_POLICY');
    for (const d of ['transferExpectations', 'authenticityRequirements', 'rubricStyle', 'markStructure', 'reasoningDepth', 'stimulusExpectations'] as const) expect(PISA_SYSTEM_PROFILE.rules[d].authority.kind, d).toBe('STUDYUS_POLICY');

    const saber = def(SABER11_MATH_V2 as never, 'math');
    expect(officialOverrides('ICFES.SABER11_MATEMATICAS')).toEqual(['responseFormats', 'timePressure', 'calculatorPolicy', 'competencyEmphasis']);
    expect(over('ICFES.SABER11_MATEMATICAS', 'responseFormats').value).toEqual(saber.responseFormats);
    expect(over('ICFES.SABER11_MATEMATICAS', 'timePressure').value).toEqual({ officialMinutes: saber.officialDurationMinutes, officialItems: saber.officialItemCount, officialMarks: saber.maxMarks });
    expect(over('ICFES.SABER11_MATEMATICAS', 'calculatorPolicy').value).toEqual({ allowed: [saber.calculatorPolicy] });
    expect(over('ICFES.SABER11_MATEMATICAS', 'competencyEmphasis').value.map((c) => [c.label, c.weightPercent])).toEqual(Object.entries(dist(saber, 'Competencia')));
    expect(over('ICFES.SABER11_MATEMATICAS', 'blueprintConstraints').value.fullFormSpecification).toBe(saber.blueprintSpecification!.status);
    expect(sourcesOf(over('ICFES.SABER11_MATEMATICAS', 'calculatorPolicy'))).toEqual(saber.sourceKeys);
  });

  it('a profile -- system or component -- has no field that can carry or change canonical knowledge, and holds no discipline rule', () => {
    const certified = PAA_CONCEPT_IDENTITIES.flatMap((c) => [c.stableId, c.canonicalName]);
    for (const p of [...EA1_SYSTEM_PROFILES, ...EA1_COMPONENT_PROFILES]) {
      const text = JSON.stringify(p);
      const id = 'profileId' in p ? p.profileId : p.componentId;
      for (const c of certified) expect(text.includes(`"${c}"`), `${id}: ${c}`).toBe(false);
      const keys: string[] = [];
      JSON.stringify(p, (k, v) => { if (k) keys.push(k); return v; });
      expect(keys.filter((k) => /concept|definition|masteryStatement|curriculum|topic|learningObjective|canonical/i.test(k))).toEqual([]);
      expect(keys.filter((k) => /numeric|parameter|misconception|toolInteraction|formatPreference/i.test(k))).toEqual([]);
    }
    expect(Object.keys(AssessmentSystemProfileSchema.shape).sort()).toEqual(['certification', 'componentDependentDimensions', 'displayName', 'examFamilyCode', 'profileId', 'rules', 'specification', 'status', 'v', 'version', 'versionBinding']);
    expect(Object.keys(AssessmentComponentProfileSchema.shape).sort()).toEqual(['certification', 'componentId', 'displayName', 'localSubject', 'overrides', 'semanticComponentKey', 'specification', 'status', 'systemProfileId', 'v', 'version', 'versionBinding']);
    expect([...PROFILE_RULE_DIMENSIONS].sort()).toEqual(['authenticityRequirements', 'blueprintConstraints', 'calculatorPolicy', 'commandTerms', 'competencyElicitation', 'competencyEmphasis', 'contextExpectations', 'markStructure', 'reasoningDepth', 'responseFormats', 'responseLength', 'rubricStyle', 'stimulusExpectations', 'timePressure', 'transferExpectations']);
    expect(AssessmentSystemProfileSchema.safeParse({ ...clone(PAA_SYSTEM_PROFILE), concepts: ['math.alg.quadratics'] }).success).toBe(false);
    expect(AssessmentComponentProfileSchema.safeParse({ ...clone(PAA_MATEMATICAS_COMPONENT), concepts: ['math.alg.quadratics'] }).success).toBe(false);
    const r = clone(PAA_SYSTEM_PROFILE) as AssessmentSystemProfile;
    (r.rules as Record<string, unknown>).conceptDefinitions = { ruleId: 'x', value: 'y', authority: { kind: 'STUDYUS_POLICY', provisional: true, assumption: 'An attempt to add knowledge.' } };
    expect(AssessmentSystemProfileSchema.safeParse(r).success).toBe(false);
    const c = clone(PAA_MATEMATICAS_COMPONENT) as AssessmentComponentProfile;
    (c.overrides as Record<string, unknown>).conceptDefinitions = { ruleId: 'x', value: 'y', authority: { kind: 'STUDYUS_POLICY', provisional: true, assumption: 'An attempt to add knowledge.' } };
    expect(AssessmentComponentProfileSchema.safeParse(c).success).toBe(false);
    // the local subject of a component is a label; it is never compared with a canonical subject
    for (const f of walk(ADAPTATION_DIR)) expect(code(f), f).not.toMatch(/localSubject\s*[=!]==?\s*[\w.]*canonicalSubject|canonicalSubject\s*[=!]==?\s*[\w.]*localSubject/);
  });

  it('a specification targets the concrete component, and each profile-derived dimension says SYSTEM or COMPONENT', () => {
    const s = spec(run(RATE_MODEL, IB_SYSTEM_PROFILE, REQUEST, POLICY, IB_MATH_AA_HL_P2_COMPONENT));
    expect([s.systemProfile, s.componentProfile]).toEqual([{ profileId: 'IB', version: IB_SYSTEM_PROFILE.version, status: 'PROVISIONAL_ILLUSTRATIVE', examFamilyCode: 'IB' }, { componentId: 'IB.MATH_AA_HL.P2', version: IB_MATH_AA_HL_P2_COMPONENT.version, status: 'PROVISIONAL_ILLUSTRATIVE', localSubject: 'Mathematics: analysis and approaches', versionBinding: IB_MATH_AA_HL_P2_COMPONENT.versionBinding }]);
    expect(s.provenance.toolPolicy[0]).toEqual({ origin: 'COMPONENT_PROFILE_RULE', ref: 'ib.math-aa-hl.p2.calculator', authority: 'OFFICIAL' });
    expect(s.provenance.rubricStyle).toEqual([{ origin: 'SYSTEM_PROFILE_RULE', ref: 'ib.rubric', authority: 'STUDYUS_POLICY' }]);
    expect(s.provenance.timeBudget).toEqual([{ origin: 'COMPONENT_PROFILE_RULE', ref: 'ib.math-aa-hl.p2.time', authority: 'OFFICIAL' }]);
    expect([s.variable.toolPolicy.calculator, s.variable.numericProfile, s.lineage.componentProfileContentHash].map((x) => typeof x === 'string' && x.length === 64 ? 'hash' : x)).toEqual(['GDC_REQUIRED', 'REALISTIC_VALUES', 'hash']);
    // Paper 1 and Paper 2: one family, one invariant hash, two specifications that differ exactly in the component's own rules
    const p1 = spec(run(RATE_MODEL, IB_SYSTEM_PROFILE, REQUEST, POLICY, IB_MATH_AA_HL_P1_COMPONENT));
    expect([p1.invariantHash === s.invariantHash, p1.specificationId === s.specificationId, differingDimensions(p1, s)]).toEqual([true, false, ['toolPolicy', 'numericProfile']]);
    // every profile-derived provenance entry of every specification names the level its rule really came from
    for (const x of ALL_SPECS.values()) {
      const system = systemProfileOf(x.systemProfile.profileId)!;
      const component = x.componentProfile ? componentProfileOf(x.componentProfile.componentId)! : null;
      for (const list of Object.values(x.provenance)) for (const pr of list) {
        if (pr.origin === 'COMPONENT_PROFILE_RULE') expect(PROFILE_RULE_DIMENSIONS.map((d) => component!.overrides[d]).find((r) => r?.ruleId === pr.ref)!.authority.kind).toBe(pr.authority);
        if (pr.origin === 'SYSTEM_PROFILE_RULE') expect(PROFILE_RULE_DIMENSIONS.map((d) => system.rules[d]).find((r) => r.ruleId === pr.ref)!.authority.kind).toBe(pr.authority);
        if (pr.origin === 'POLICY_RULE') expect(pr.authority).toBe('STUDYUS_POLICY');
        if (pr.origin === 'FAMILY' || pr.origin === 'REQUEST') expect(pr.authority).toBeNull();
      }
      if (!component) expect(Object.values(x.provenance).flat().some((pr) => pr.origin === 'COMPONENT_PROFILE_RULE')).toBe(false);
    }
  });

  it('COMPONENT_REQUIRED: the system alone is enough only for generic dev-test practice that needs nothing component-specific', () => {
    // generic practice: allowed, and the specification says its component is null
    const generic = spec(runSystem(RATE_MODEL, IB_SYSTEM_PROFILE));
    expect([generic.componentProfile, generic.lineage.componentProfileContentHash, generic.variable.timeBudget]).toEqual([null, null, { secondsPerUnit: null, unit: null }]);
    const why = (r: AdaptationResult) => (r.ok ? 'NOT_REFUSED' : `${r.refusal.code}|${r.refusal.detail.split(': ').slice(1).join(': ')}`);
    // a. any purpose but practice
    expect(why(runSystem(RATE_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, purpose: 'DIAGNOSTIC' }))).toBe('COMPONENT_REQUIRED|purpose DIAGNOSTIC');
    expect(runSystem(RATE_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, purpose: 'LOW_STAKES_REINFORCEMENT' }).ok).toBe(true);
    // b. evidence-bearing content (from a reviewed family, so that maturity is not what refuses)
    expect(why(runCertified(FACTORISING, IB_SYSTEM_PROFILE, {}, null))).toBe('COMPONENT_REQUIRED|evidence-bearing content');
    // c. the request fixes a component-dependent dimension
    expect(why(runSystem(RATE_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, calculatorPolicy: 'GDC_REQUIRED' }))).toBe('COMPONENT_REQUIRED|request fixes calculatorPolicy');
    expect(why(runSystem(RATE_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, responseFormat: 'SHORT_RESPONSE' }))).toBe('COMPONENT_REQUIRED|request fixes responseFormat');
    //    ... but a dimension the system keeps common may be fixed without a component
    expect(runSystem(RATE_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, context: 'PERSONAL' }).ok).toBe(true);
    expect(why(runSystem(RATE_MODEL, PISA_SYSTEM_PROFILE, { ...REQUEST, context: 'PERSONAL' }))).toBe('COMPONENT_REQUIRED|request fixes context');
    // d. the family's support is constrained on a component-dependent dimension
    expect(why(runSystem(FACTORISING, PAA_SYSTEM_PROFILE))).toBe('COMPONENT_REQUIRED|family constraint RESPONSE_FORMAT_ONLY');
    //    ... a constraint on something else (difficulty) does not need one
    expect(runSystem(MISSING_VALUE, IB_SYSTEM_PROFILE).ok).toBe(true);
    // e. the family requires a tool and the tool policy is the component's
    expect(why(runSystem(DATASET, CAMBRIDGE_SYSTEM_PROFILE))).toBe('COMPONENT_REQUIRED|the family requires a tool');
    expect(why(runSystem(DATASET, IB_SYSTEM_PROFILE))).toBe('COMPONENT_REQUIRED|family constraint CALCULATOR_ONLY; the family requires a tool');
    // f. the system-level fallback of a component-dependent dimension offers nothing the family can use
    expect(refusal(runSystem(fam('tf.math.quadratic.optimum-of-a-model'), PISA_SYSTEM_PROFILE))).toBe('COMPONENT_REQUIRED');
    // a system with no component-dependent dimension never requires one
    const flat = { ...clone(IB_SYSTEM_PROFILE), componentDependentDimensions: [] };
    expect(runSystem(RATE_MODEL, flat, { ...REQUEST, purpose: 'DIAGNOSTIC', calculatorPolicy: 'GDC_REQUIRED' }).ok).toBe(true);
    // once a component is targeted the dimension-specific answer is given
    expect(refusal(run(DATASET, IB_SYSTEM_PROFILE, REQUEST, POLICY, IB_MATH_AA_HL_P1_COMPONENT))).toBe('TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE');
    expect(refusal(run(RATE_MODEL, IB_SYSTEM_PROFILE, REQUEST, POLICY, PAA_MATEMATICAS_COMPONENT))).toBe('COMPONENT_NOT_OF_THE_SYSTEM');
    expect(refusal(run(RATE_MODEL, IB_SYSTEM_PROFILE, REQUEST, POLICY, { ...clone(IB_MATH_AA_HL_P1_COMPONENT), componentId: 'p1' }))).toBe('COMPONENT_PROFILE_INVALID');
  });

  it('adapting changes neither the family nor the profiles nor the policy nor the register, and never the family\'s PRIMARY concept ids', () => {
    for (const f of MATH_POC_FAMILIES) for (const c of EA1_COMPONENT_PROFILES) {
      const p = systemProfileOf(c.systemProfileId)!;
      const before = [canonicalJson(f), canonicalJson(p), canonicalJson(c), canonicalJson(POLICY), canonicalJson(MATH_POC_APPLICABILITY)];
      const r = run(f, p, REQUEST, POLICY, c);
      expect([canonicalJson(f), canonicalJson(p), canonicalJson(c), canonicalJson(POLICY), canonicalJson(MATH_POC_APPLICABILITY)]).toEqual(before);
      if (r.ok) {
        expect(r.specification.invariants.primaryConceptStableIds).toEqual(f.primaryConcepts.map((x) => x.stableId).sort());
        expect(r.specification.primaryConcept).toEqual(f.primaryConcepts[0]);
      }
    }
  });
});

describe('discipline adaptation policy: what a profile\'s words mean in mathematics', () => {
  it('is StudyUs policy, provisional, versioned, for MATH_PROBLEM only, and keeps all three invariants', () => {
    expect(DisciplineAdaptationPolicySchema.safeParse(POLICY).success).toBe(true);
    expect([POLICY.discipline, POLICY.familyTypes, POLICY.authority, POLICY.status]).toEqual(['MATHEMATICS', ['MATH_PROBLEM'], 'STUDYUS_POLICY', 'PROVISIONAL']);
    expect([...POLICY.invariantDimensions].sort()).toEqual([...INVARIANT_DIMENSIONS].sort());
    expect(DisciplineAdaptationPolicySchema.safeParse({ ...clone(POLICY), invariantDimensions: ['PRIMARY_CONCEPT', 'CONSTRUCT'] }).success).toBe(false);
    expect(DisciplineAdaptationPolicySchema.safeParse({ ...clone(POLICY), authority: 'OFFICIAL' }).success).toBe(false);
    // it names no exam: the translation is of generic words, not of a system
    expect(JSON.stringify(POLICY)).not.toMatch(/PAA|PISA|ICFES|Icfes|Saber|Cambridge|\bIB\b/);
  });

  it('translates reasoning depth, tool policy and transfer; the same family gets another meaning under another profile', () => {
    const paa = spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE)).variable;
    const ib = spec(run(RATE_MODEL, IB_SYSTEM_PROFILE)).variable;
    expect([paa.reasoningDepth, paa.numericProfile, paa.toolPolicy.calculator]).toEqual([{ depth: 'ANSWER_ONLY', workingShown: false, justificationRequired: false }, 'EXACT_WITHOUT_TOOL', 'NONE']);
    expect(ib.reasoningDepth).toEqual({ depth: 'METHOD_SHOWN', workingShown: true, justificationRequired: false });
    expect(spec(run(RATE_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, calculatorPolicy: 'GDC_REQUIRED' }, POLICY, IB_MATH_AA_HL_P2_COMPONENT)).variable.numericProfile).toBe('REALISTIC_VALUES');
    // levers: CONTEXT_LOAD only where there is a situation, REPRESENTATION only where there is a stimulus
    expect(spec(run(MISSING_VALUE, PAA_SYSTEM_PROFILE)).variable.difficultyLevers).toEqual(['scale-factor', 'composed-proportion']);
    expect(spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE)).variable.difficultyLevers).toEqual(['rate-visibility', 'unit-mismatch', 'irrelevant-information']);
    expect(spec(run(LINEAR_MODEL, PAA_SYSTEM_PROFILE)).variable.difficultyLevers).not.toContain('information-form');
    expect(spec(run(LINEAR_MODEL, PISA_SYSTEM_PROFILE)).variable.difficultyLevers).toContain('information-form');
    // a command term comes only from the profile's vocabulary, chosen by the policy from the task's first action
    expect([ib.commandTerm, spec(run(FACTORISING, IB_SYSTEM_PROFILE)).variable.commandTerm, spec(run(FACTORISING, systemProfileOf('CAMBRIDGE'))).variable.commandTerm, paa.commandTerm]).toEqual(['find', 'solve', 'work out', null]);
  });
});

describe('adapt(): a frozen specification, or a named refusal', () => {
  it('is deterministic and pure: the same inputs give the same specification and the same id; a timestamp is passed in and is not identity', () => {
    const a = spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE));
    const b = spec(run(clone(RATE_MODEL), clone(PISA_SYSTEM_PROFILE), clone(REQUEST), clone(POLICY)));
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    const stamped = spec(adapt({ family: RATE_MODEL, profile: PISA_SYSTEM_PROFILE, component: PISA_MATHEMATICS_COMPONENT, applicability: MATH_POC_APPLICABILITY, disciplinePolicy: POLICY, request: REQUEST, adaptedAt: '2026-10-11T12:00:00Z' }));
    expect([stamped.specificationId, stamped.adaptedAt, a.adaptedAt]).toEqual([a.specificationId, '2026-10-11T12:00:00Z', null]);
    expect(a.specificationId).toMatch(/^[0-9a-f]{64}$/);
    expect(specificationIdOf(a)).toBe(a.specificationId);
    expect(AdaptationSpecificationSchema.safeParse(a).success).toBe(true);
    expect(specificationIntegrityIssues(a)).toEqual([]);
    // every request, family version, profile version or policy version that differs gives another id
    const ids = new Set([a.specificationId, spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE, { ...REQUEST, difficultyBand: 'CHALLENGE' })).specificationId, spec(run({ ...clone(RATE_MODEL), version: '0.2.0' }, PISA_SYSTEM_PROFILE)).specificationId, spec(run(RATE_MODEL, { ...clone(PISA_SYSTEM_PROFILE), version: '0.2.0' })).specificationId, spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE, REQUEST, { ...clone(POLICY), version: '0.2.0' })).specificationId, spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE, REQUEST, POLICY, { ...clone(PISA_MATHEMATICS_COMPONENT), version: '0.3.0' })).specificationId, spec(adapt({ family: RATE_MODEL, profile: PISA_SYSTEM_PROFILE, component: PISA_MATHEMATICS_COMPONENT, applicability: [], disciplinePolicy: POLICY, request: REQUEST })).specificationId]);
    expect(ids.size).toBe(7);
    // a family edited WITHOUT a new version is still detectable: its content hash is part of the lineage
    const silentEdit = clone(RATE_MODEL);
    silentEdit.commonMisconceptions.push('An added misconception with no version change.');
    expect(spec(run(silentEdit, PISA_SYSTEM_PROFILE)).lineage.familyContentHash).not.toBe(a.lineage.familyContentHash);
    // the hash technique is the generation harness's, restated
    for (const v of [a, { b: [1, undefined, { z: 1, a: undefined }], a: 'x' }]) { expect(canonicalJson(v)).toBe(providerCanonicalJson(v)); expect(sha256OfCanonicalJson(v)).toBe(providerSha256(v)); }
  });

  it('a specification is immutable, detached from its inputs, and tampering with it is detected', () => {
    const s = spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE));
    expect(Object.isFrozen(s) && Object.isFrozen(s.variable) && Object.isFrozen(s.invariants) && Object.isFrozen(s.invariants.evidenceTarget.actions) && Object.isFrozen(s.provenance.context)).toBe(true);
    expect(() => { (s.variable as { language: string }).language = 'en'; }).toThrow();
    expect(() => { (s.invariants.primaryConceptStableIds as string[]).push('math.num.percent'); }).toThrow();
    expect(s.invariants.evidenceTarget.actions).not.toBe(RATE_MODEL.evidenceTarget.actions);
    const tampered = clone(s);
    tampered.variable.toolPolicy.calculator = 'ALLOWED';
    expect(specificationIntegrityIssues(tampered)).toEqual(['SPECIFICATION_ID_MISMATCH']);
    const reconcepted = clone(s);
    reconcepted.invariants.primaryConceptStableIds = ['math.num.percent'];
    expect(specificationIntegrityIssues(reconcepted)).toEqual(['SPECIFICATION_ID_MISMATCH', 'INVARIANT_HASH_MISMATCH', 'PRIMARY_CONCEPT_NOT_IN_INVARIANTS']);
    expect(specificationIntegrityIssues({ ...clone(s), stem: 'a question' })).toEqual(['SCHEMA_INVALID']);
  });

  it('holds no question: a specification has no stem, option, answer or worked solution', () => {
    for (const s of SPECS.values()) {
      const keys: string[] = [];
      JSON.stringify(s, (k, v) => { if (k) keys.push(k); return v; });
      expect(keys.filter((k) => /^(stem|options|answerKey|answer|rationale|solution|workedSolution|question|text)$/i.test(k))).toEqual([]);
      expect(JSON.stringify(s)).not.toMatch(/[?¿]/);
    }
  });

  it('records where every variable dimension came from: system or component rule with its authority, policy rule, family field or request', () => {
    const s = spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE));
    expect(Object.keys(s.provenance).sort()).toEqual([...VARIABLE_DIMENSIONS].sort());
    expect(s.provenance.toolPolicy).toEqual([{ origin: 'COMPONENT_PROFILE_RULE', ref: 'pisa.mathematics.calculator', authority: 'OFFICIAL' }, { origin: 'FAMILY', ref: 'specialization.toolDependency', authority: null }]);
    expect(s.provenance.numericProfile[0]).toEqual({ origin: 'POLICY_RULE', ref: 'studyus.adaptation.mathematics@0.2.0-provisional#toolInteraction.ALLOWED', authority: 'STUDYUS_POLICY' });
    expect(s.provenance.context.map((p) => `${p.origin}:${p.ref}:${p.authority}`)).toEqual(['COMPONENT_PROFILE_RULE:pisa.mathematics.contexts:OFFICIAL', 'FAMILY:supportedContexts:null', 'SYSTEM_PROFILE_RULE:pisa.authenticity:STUDYUS_POLICY', 'SYSTEM_PROFILE_RULE:pisa.transfer:STUDYUS_POLICY', 'POLICY_RULE:studyus.adaptation.mathematics@0.2.0-provisional#transfer:STUDYUS_POLICY']);
    expect(s.provenance.difficulty).toEqual([{ origin: 'REQUEST', ref: 'difficultyBand', authority: null }]);
    expect(spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE, { ...REQUEST, responseFormat: 'NUMERIC_ENTRY' })).provenance.responseFormat[0]).toEqual({ origin: 'REQUEST', ref: 'responseFormat', authority: null });
  });

  it('an UNSUPPORTED profile is refused with the family\'s reason and is never forced, whatever is asked', () => {
    const r = run(MISSING_VALUE, PISA_SYSTEM_PROFILE);
    expect(r).toMatchObject({ ok: false, refusal: { code: 'PROFILE_UNSUPPORTED_BY_FAMILY' } });
    expect(!r.ok && r.refusal.detail).toMatch(/cannot show transfer/);
    for (const extra of [{ context: 'PERSONAL' }, { responseFormat: 'SELECTED_RESPONSE' }, { applicabilityRequirement: 'NOT_REQUIRED' }]) expect(refusal(run(MISSING_VALUE, PISA_SYSTEM_PROFILE, { ...REQUEST, ...extra }))).toBe('PROFILE_UNSUPPORTED_BY_FAMILY');
    // a system the family does not declare is not a supported one
    const undeclared = clone(MISSING_VALUE) as MathTaskFamily;
    delete (undeclared.profileSupport as Record<string, unknown>).ICFES;
    expect(refusal(run(undeclared, systemProfileOf('ICFES')))).toBe('PROFILE_SUPPORT_NOT_DECLARED');
    // and the declaration is not the only guard: declared SUPPORTED, the engine still refuses what does not fit
    const overclaimed = clone(MISSING_VALUE) as MathTaskFamily;
    overclaimed.profileSupport.PISA = { status: 'SUPPORTED' };
    expect(refusal(run(overclaimed, PISA_SYSTEM_PROFILE))).toBe('PROFILE_REQUIRES_TRANSFER_FAMILY_CANNOT_PROVIDE');
  });

  it('SUPPORTED_WITH_CONSTRAINTS: a request outside a constraint is refused by name; inside it, the constraint shapes the specification', () => {
    const ib = (request: Partial<AdaptationRequest>) => run(MISSING_VALUE, IB_SYSTEM_PROFILE, { ...REQUEST, ...request });
    expect(refusal(ib({ difficultyBand: 'FOUNDATIONAL' }))).toBe('SUPPORT_CONSTRAINT_VIOLATED');
    expect(ib({ difficultyBand: 'CHALLENGE' }).ok).toBe(true);
    // PAA hosts the factorising family only as a produced number
    expect(spec(run(FACTORISING, PAA_SYSTEM_PROFILE)).variable.responseFormat).toEqual({ format: 'NUMERIC_ENTRY', productionFormat: 'STUDENT_PRODUCED' });
    const widened = clone(FACTORISING) as MathTaskFamily;
    widened.responseConstraints.allowedFormats.push('SELECTED_RESPONSE');
    expect(refusal(run(widened, PAA_SYSTEM_PROFILE, { ...REQUEST, responseFormat: 'SELECTED_RESPONSE' }))).toBe('SUPPORT_CONSTRAINT_VIOLATED');
    expect(spec(run(widened, PAA_SYSTEM_PROFILE)).variable.responseFormat.format).toBe('NUMERIC_ENTRY');
    // IB hosts the realistic-data family only on a component with a calculator
    expect(spec(run(DATASET, IB_SYSTEM_PROFILE, REQUEST, POLICY, IB_MATH_AA_HL_P2_COMPONENT)).variable.toolPolicy.calculator).toBe('GDC_REQUIRED');
    expect(refusal(run(DATASET, IB_SYSTEM_PROFILE, REQUEST, POLICY, IB_MATH_AA_HL_P1_COMPONENT))).toBe('TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE');
    // a context constraint
    const contextBound = clone(RATE_MODEL) as MathTaskFamily;
    contextBound.profileSupport.PAA = { status: 'SUPPORTED_WITH_CONSTRAINTS', constraints: [{ kind: 'CONTEXT_ONLY', contexts: ['SOCIETAL'], reason: 'Only a societal situation carries this comparison for this system.' }] };
    expect(spec(run(contextBound, PAA_SYSTEM_PROFILE)).variable.context.kind).toBe('SOCIETAL');
    expect(refusal(run(contextBound, PAA_SYSTEM_PROFILE, { ...REQUEST, context: 'PERSONAL' }))).toBe('SUPPORT_CONSTRAINT_VIOLATED');
    // a constraint can only narrow the family: one that adds a format the family lacks is not a valid family
    const widening = clone(MISSING_VALUE) as MathTaskFamily;
    widening.profileSupport.IB = { status: 'SUPPORTED_WITH_CONSTRAINTS', constraints: [{ kind: 'RESPONSE_FORMAT_ONLY', formats: ['EXTENDED_RESPONSE'], reason: 'A format the family does not allow at all.' }] };
    expect(refusal(run(widening, IB_SYSTEM_PROFILE))).toBe('FAMILY_INVALID');
  });

  it('the response format must be allowed by BOTH the family and the profile', () => {
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, responseFormat: 'SHORT_RESPONSE' }))).toBe('RESPONSE_FORMAT_NOT_ALLOWED');
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, responseFormat: 'MULTI_SELECT' }))).toBe('RESPONSE_FORMAT_NOT_ALLOWED');
    // no format in common: the factorising family (no selected response) and a system that offers nothing else
    const claimed = clone(FACTORISING) as MathTaskFamily;
    claimed.profileSupport.ICFES = { status: 'SUPPORTED' };
    const r = run(claimed, systemProfileOf('ICFES'));
    expect(r).toMatchObject({ ok: false, refusal: { code: 'RESPONSE_FORMAT_NOT_ALLOWED' } });
    expect(spec(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, responseFormat: 'NUMERIC_ENTRY' })).variable.distractors).toBeNull();
    expect(spec(run(MISSING_VALUE, PAA_SYSTEM_PROFILE)).variable.distractors).toEqual({ source: 'FAMILY_MISCONCEPTION_MODELS', misconceptionModelIds: ['additive', 'inverted', 'wrong-pair'] });
  });

  it('the discipline policy must be for the family\'s type', () => {
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, REQUEST, { ...clone(POLICY), familyTypes: ['SCIENCE_PROBLEM'], discipline: 'SCIENCE' }))).toBe('DISCIPLINE_POLICY_NOT_FOR_FAMILY_TYPE');
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, REQUEST, { ...clone(POLICY), discipline: 'SCIENCE' }))).toBe('DISCIPLINE_POLICY_NOT_FOR_FAMILY_TYPE');
  });

  it('the profile requires something the family cannot provide: context, transfer, a calculator-free task, a stimulus, a competency', () => {
    const abstractOnly = clone(fam('tf.math.linear.line-through-two-points')) as MathTaskFamily;
    abstractOnly.profileSupport.PISA = { status: 'SUPPORTED' };
    // PISA offers no context-free task (an OFFICIAL rule); the family supports nothing else
    expect(refusal(run(abstractOnly, PISA_SYSTEM_PROFILE))).toBe('PROFILE_REQUIRES_CONTEXT_FAMILY_CANNOT_PROVIDE');
    expect(refusal(run(abstractOnly, PISA_SYSTEM_PROFILE, { ...REQUEST, context: 'ABSTRACT' }))).toBe('CONTEXT_NOT_ALLOWED');
    expect(refusal(run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, context: 'ABSTRACT' }))).toBe('CONTEXT_NOT_ALLOWED');
    // transfer: a situation is there, but nothing is formulated or interpreted
    const procedural = clone(MISSING_VALUE) as MathTaskFamily;
    procedural.profileSupport.PISA = { status: 'SUPPORTED' };
    expect(refusal(run(procedural, PISA_SYSTEM_PROFILE))).toBe('PROFILE_REQUIRES_TRANSFER_FAMILY_CANNOT_PROVIDE');
    // a family that needs a calculator, a system that allows none
    const needsTool = clone(DATASET) as MathTaskFamily;
    needsTool.profileSupport.PAA = { status: 'SUPPORTED' };
    expect(refusal(run(needsTool, PAA_SYSTEM_PROFILE))).toBe('TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE');
    expect(refusal(run(DATASET, IB_SYSTEM_PROFILE, { ...REQUEST, calculatorPolicy: 'NONE' }))).toBe('TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE');
    expect(refusal(run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, calculatorPolicy: 'ALLOWED' }))).toBe('TOOL_POLICY_NOT_ALLOWED_BY_PROFILE');
    // a family that needs a stimulus, a profile that offers none
    const noStimulus = clone(PAA_SYSTEM_PROFILE) as AssessmentSystemProfile;
    noStimulus.rules.stimulusExpectations.value = { allowed: ['NONE'], whenOptional: 'NONE' };
    expect(refusal(run(fam('tf.math.data.judge-claim-against-display'), noStimulus))).toBe('STIMULUS_REQUIRED_BY_FAMILY_NOT_OFFERED_BY_PROFILE');
    // a system with a competency model none of whose competencies the task elicits
    const narrow = clone(PISA_MATHEMATICS_COMPONENT) as AssessmentComponentProfile;
    narrow.overrides.competencyElicitation!.value = { FORMULATE: ['RECALL'], EMPLOY: ['RECALL'], INTERPRET_EVALUATE: ['RECALL'], REASON: ['RECALL'] };
    expect(refusal(run(RATE_MODEL, PISA_SYSTEM_PROFILE, REQUEST, POLICY, narrow))).toBe('PROFILE_COMPETENCY_NOT_ELICITED');
    // a command term outside the profile's vocabulary, or any term where the profile has none
    expect(refusal(run(RATE_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, commandTerm: 'evaluate' }))).toBe('COMMAND_TERM_NOT_IN_PROFILE_VOCABULARY');
    expect(refusal(run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, commandTerm: 'solve' }))).toBe('COMMAND_TERM_NOT_IN_PROFILE_VOCABULARY');
  });

  it('a request to change an invariant is refused: concept, construct and evidence target are not negotiable', () => {
    for (const invariantOverrides of [{ primaryConceptStableId: 'math.num.percent' }, { construct: 'INVERSE_PROPORTION' }, { evidenceActions: ['RECALL'] }, { evidenceObject: 'Something else entirely.' }]) expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, invariantOverrides }))).toBe('INVARIANT_CHANGE_REQUESTED');
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, targetPrimaryConceptStableId: 'math.num.percent' }))).toBe('INVARIANT_CHANGE_REQUESTED');
    expect(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, targetPrimaryConceptStableId: 'math.num.ratio-proportion', invariantOverrides: {} }).ok).toBe(true);
  });

  it('invalid inputs and a retired family are refused by name; every refusal code is one of the declared names', () => {
    expect(refusal(run({ ...clone(MISSING_VALUE), familyId: 'not-a-family-id' }, PAA_SYSTEM_PROFILE))).toBe('FAMILY_INVALID');
    expect(refusal(run(MISSING_VALUE, { ...clone(PAA_SYSTEM_PROFILE), profileId: 'paa' }))).toBe('PROFILE_INVALID');
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, REQUEST, { ...clone(POLICY), authority: 'OFFICIAL' }))).toBe('DISCIPLINE_POLICY_INVALID');
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'HOMEWORK' }))).toBe('REQUEST_INVALID');
    // the content use class is stated, never defaulted
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { purpose: 'PRACTICE', difficultyBand: 'STANDARD', language: 'es' }))).toBe('REQUEST_INVALID');
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, knowledgeRequirement: 'CERTIFIED' }))).toBe('REQUEST_INVALID');
    expect(refusal(run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, stem: 'write this' }))).toBe('REQUEST_INVALID');
    expect(refusal(run({ ...clone(MISSING_VALUE), lifecycle: 'RETIRED' }, PAA_SYSTEM_PROFILE))).toBe('FAMILY_RETIRED');
    for (const c of MATRIX.cells) if (c.refusal) expect(ADAPTATION_REFUSAL_CODES as readonly string[]).toContain(c.refusal.code);
    expect(new Set(ADAPTATION_REFUSAL_CODES).size).toBe(ADAPTATION_REFUSAL_CODES.length);
  });
});

describe('mathematical invariants', () => {
  it('a family declares them -- PRIMARY concept, construct, evidence target -- and a specification carries them verbatim with their hash', () => {
    const inv = invariantsOfFamily(RATE_MODEL, MATH_PROBLEM_SPECIALIZATION as never);
    expect(Object.keys(inv).sort()).toEqual(['canonicalSubject', 'construct', 'evidenceTarget', 'primaryConceptStableIds']);
    expect(inv.construct).toEqual({ construct: 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS', variables: RATE_MODEL.specialization.variables.map((v) => ({ symbol: v.symbol, role: v.role, domain: v.domain })), relationships: RATE_MODEL.specialization.relationships });
    const s = spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE));
    expect(s.invariants).toEqual(clone(inv));
    expect([s.invariantHash, invariantHashOf(s.invariants)]).toEqual([invariantHashOf(clone(inv)), s.invariantHash]);
    expect(invariantsPreserved(RATE_MODEL, s)).toBe(true);
    // the parameter ranges are NOT an invariant: numbers vary inside them
    expect(JSON.stringify(inv)).not.toContain('parameterRanges');
    expect(s.parameterization).toMatchObject({ parameterRanges: RATE_MODEL.specialization.parameterRanges });
  });

  it('across ALL adaptations of one family the invariant hash is identical while the variable dimensions differ', () => {
    for (const f of MATH_POC_FAMILIES) {
      const own = [...SPECS.entries()].filter(([k]) => k.startsWith(`${f.familyId}|`)).map(([, s]) => s);
      expect(own.length, f.familyId).toBeGreaterThanOrEqual(2);
      expect(new Set(own.map((s) => s.invariantHash)).size, f.familyId).toBe(1);
      expect(new Set(own.map((s) => canonicalJson(s.invariants))).size).toBe(1);
      for (const s of own) expect(invariantsPreserved(f, s), `${f.familyId} / ${s.componentProfile!.componentId}`).toBe(true);
      // the system-level specifications of the family carry the same invariants too
      for (const [k, s] of ALL_SPECS) if (k.startsWith(`${f.familyId}|`)) expect(s.invariantHash).toBe(own[0].invariantHash);
      expect(new Set(own.map((s) => canonicalJson(s.variable))).size, f.familyId).toBe(own.length);
      // the request's own choices (band, format, context, calculator) never move the invariants either
      for (const extra of [{ difficultyBand: 'CHALLENGE' as const }, { purpose: 'FULL_MOCK_1' as const }, { language: 'en' }]) {
        const r = run(f, systemProfileOf(own[0].systemProfile.profileId), { ...REQUEST, ...extra }, POLICY, componentProfileOf(own[0].componentProfile!.componentId));
        if (r.ok) expect(r.specification.invariantHash).toBe(own[0].invariantHash);
      }
    }
    // different families have different invariants, even on the same concept
    expect(new Set(MATRIX.families.map((f) => f.invariantHash)).size).toBe(10);
  });

  it('a specification that drifted from its family is not preserved', () => {
    const s = spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE));
    const moved = clone(s);
    moved.invariants.evidenceTarget.actions = ['COMPUTE'];
    expect(invariantsPreserved(RATE_MODEL, moved)).toBe(false);
    expect(invariantsPreserved(MISSING_VALUE, s)).toBe(false);
    const restructured = clone(RATE_MODEL);
    restructured.specialization.relationships = ['r1 = p1 / q1', 'r2 = p2 / q2', 'd = r1 - r2'];
    expect(invariantsPreserved(restructured, s)).toBe(false);
    // changing what is variable in the family (a range, a lever) leaves the invariants as they are
    const reranged = clone(RATE_MODEL);
    reranged.specialization.parameterRanges[0].max = 900;
    expect(invariantsPreserved(reranged, s)).toBe(true);
  });
});

describe('mathematics proof of concept: 10 families x 6 component profiles (and x 5 system profiles alone)', () => {
  it('the stored artifact is exactly what the function produces', () => {
    expect(serializeMathAdaptationMatrix(MATRIX)).toBe(read(MATH_POC_MATRIX_ARTIFACT));
    expect(serializeMathAdaptationMatrix(buildMathAdaptationMatrix())).toBe(serializeMathAdaptationMatrix(MATRIX));
    const script = code('scripts/operations/ea1-adaptation-matrix.ts') + code('scripts/operations/ea1-paa-evidence-demand.ts');
    expect(script).not.toMatch(/from 'pg'|DATABASE_URL|process\.env|fetch\(|@\/lib\/ai\/|@\/lib\/db/);
  });

  it('component level: 60 attempts, 51 DEV_TEST specifications, 9 named refusals -- eight declared by the family, one found by the engine', () => {
    expect(MATRIX.summary.componentLevel).toEqual({
      attempts: 60, specifications: 51, refusals: 9, declaredSupport: { SUPPORTED: 42, SUPPORTED_WITH_CONSTRAINTS: 10, UNSUPPORTED: 8 }, refusalCodes: { PROFILE_UNSUPPORTED_BY_FAMILY: 8, TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE: 1 },
      specificationsByTarget: { 'PAA.MATEMATICAS': 9, 'IB.MATH_AA_HL.P1': 9, 'IB.MATH_AA_HL.P2': 10, 'CAMBRIDGE.9709.P1': 10, 'PISA.MATHEMATICS': 6, 'ICFES.SABER11_MATEMATICAS': 7 },
    });
    const refused = COMPONENT_CELLS.filter((c) => c.outcome === 'REFUSED').map((c) => `${c.familyId.replace('tf.math.', '')}|${c.targetId}|${c.refusal!.code}`).sort();
    expect(refused).toEqual([
      'data.rate-of-change-from-realistic-dataset|IB.MATH_AA_HL.P1|TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE',
      'data.rate-of-change-from-realistic-dataset|ICFES.SABER11_MATEMATICAS|PROFILE_UNSUPPORTED_BY_FAMILY',
      'data.rate-of-change-from-realistic-dataset|PAA.MATEMATICAS|PROFILE_UNSUPPORTED_BY_FAMILY',
      'linear.line-through-two-points|PISA.MATHEMATICS|PROFILE_UNSUPPORTED_BY_FAMILY',
      'probability.single-event-equally-likely|PISA.MATHEMATICS|PROFILE_UNSUPPORTED_BY_FAMILY',
      'proportion.missing-value|PISA.MATHEMATICS|PROFILE_UNSUPPORTED_BY_FAMILY',
      'quadratic.optimum-of-a-model|ICFES.SABER11_MATEMATICAS|PROFILE_UNSUPPORTED_BY_FAMILY',
      'quadratic.solve-by-factorising|ICFES.SABER11_MATEMATICAS|PROFILE_UNSUPPORTED_BY_FAMILY',
      'quadratic.solve-by-factorising|PISA.MATHEMATICS|PROFILE_UNSUPPORTED_BY_FAMILY',
    ]);
    // every procedural family is refused for PISA; every modelling family reaches it
    expect(MATH_POC_FAMILIES.filter((f) => f.profileSupport.PISA.status === 'UNSUPPORTED').every((f) => !f.evidenceTarget.actions.some((a) => ['FORMULATE', 'INTERPRET', 'EVALUATE'].includes(a)))).toBe(true);
    // a declared-unsupported system is always refused; the support semantics are the family's, per system
    for (const c of MATRIX.cells) if (c.declaredSupport === 'UNSUPPORTED') expect(c.refusal?.code, `${c.familyId}|${c.targetId}`).toBe('PROFILE_UNSUPPORTED_BY_FAMILY');
    expect(new Set(COMPONENT_CELLS.flatMap((c) => (c.specificationId ? [c.specificationId] : []))).size).toBe(51);
    // every specification says what it is: dev-test content of a draft family, for a named component
    for (const s of SPECS.values()) expect([s.contentUseClass, s.taskFamily.lifecycle, s.taskFamily.reviewStatus, s.componentProfile !== null, s.purpose.minimumInstanceClass]).toEqual(['DEV_TEST_CONTENT', 'DRAFT', 'UNREVIEWED', true, 'DYNAMIC']);
  });

  it('system level (generic practice): 50 attempts, 36 specifications, 6 COMPONENT_REQUIRED and the same 8 declared refusals', () => {
    expect(MATRIX.summary.systemLevel).toEqual({
      attempts: 50, specifications: 36, refusals: 14, declaredSupport: { SUPPORTED: 35, SUPPORTED_WITH_CONSTRAINTS: 7, UNSUPPORTED: 8 }, refusalCodes: { COMPONENT_REQUIRED: 6, PROFILE_UNSUPPORTED_BY_FAMILY: 8 },
      specificationsByTarget: { PAA: 7, IB: 9, CAMBRIDGE: 9, PISA: 4, ICFES: 7 },
    });
    expect(MATRIX.cells.filter((c) => c.refusal?.code === 'COMPONENT_REQUIRED').map((c) => `${c.familyId.replace('tf.math.', '')}|${c.targetId}`).sort()).toEqual(['data.rate-of-change-from-realistic-dataset|CAMBRIDGE', 'data.rate-of-change-from-realistic-dataset|IB', 'data.rate-of-change-from-realistic-dataset|PISA', 'quadratic.optimum-of-a-model|PAA', 'quadratic.optimum-of-a-model|PISA', 'quadratic.solve-by-factorising|PAA']);
    for (const [k, s] of ALL_SPECS) if (s.componentProfile === null) expect(MATH_POC_PROFILE_IDS as readonly string[], k).toContain(k.split('|')[1]);
  });

  it('applicability of the 51 component-level specifications: 9 by official exam structure, 6 by reviewed catalogue link, 36 not established', () => {
    expect(MATRIX.summary.applicabilityOfComponentSpecifications).toEqual({ byBasis: { NONE: 36, OFFICIAL_EXAM_STRUCTURE: 9, REVIEWED_CATALOGUE_LINK: 6 }, byStatus: { ESTABLISHED: 15, NOT_ESTABLISHED: 36 } });
    const produced = COMPONENT_CELLS.filter((c) => c.outcome === 'SPECIFICATION');
    expect(produced.filter((c) => c.applicability.basis === 'OFFICIAL_EXAM_STRUCTURE').every((c) => c.targetId === 'PAA.MATEMATICAS')).toBe(true);
    expect(produced.filter((c) => c.applicability.basis === 'REVIEWED_CATALOGUE_LINK').map((c) => `${c.familyId.replace('tf.math.', '')}|${c.targetId}`).sort()).toEqual(['probability.compare-chances-to-decide|PISA.MATHEMATICS', 'proportion.rate-comparison-model|PISA.MATHEMATICS', 'quadratic.optimum-of-a-model|CAMBRIDGE.9709.P1', 'quadratic.optimum-of-a-model|IB.MATH_AA_HL.P1', 'quadratic.solve-by-factorising|CAMBRIDGE.9709.P1', 'quadratic.solve-by-factorising|IB.MATH_AA_HL.P1']);
    // the cell's applicability is the specification's
    for (const c of produced) expect(SPECS.get(`${c.familyId}|${c.targetId}`)!.assessmentApplicability).toMatchObject(c.applicability);
    // no Matemáticas concept is established for a system on the strength of that system assessing "Mathematics"
    for (const s of SPECS.values()) if (s.primaryConcept.canonicalSubject === 'Matemáticas' && ['IB', 'CAMBRIDGE'].includes(s.systemProfile.profileId)) expect(s.assessmentApplicability.status).toBe('NOT_ESTABLISHED');
  });

  it('asked for EVIDENCE_BEARING content, every one of the 60 attempts is refused: all ten families are drafts', () => {
    expect(MATRIX.summary.evidenceBearingAttempts).toEqual({ attempts: 60, specifications: 0, refusalCodes: { FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT: 60 } });
  });

  it(`two specifications of one family for different systems differ in at least ${MINIMUM_PAIRWISE_DIFFERENCE} of the ${COMPARED_DIMENSIONS.length} compared dimensions, with the invariant hash equal`, () => {
    expect(COMPARED_DIMENSIONS.length).toBe(12);
    let cross = 0;
    let same = 0;
    for (const f of MATRIX.fidelity) {
      expect(f.invariant.identicalAcrossTargets).toBe(true);
      for (const p of f.pairwise) {
        const a = SPECS.get(`${f.familyId}|${p.a}`)!;
        const b = SPECS.get(`${f.familyId}|${p.b}`)!;
        expect(a.invariantHash).toBe(b.invariantHash);
        expect(differingDimensions(a, b)).toEqual(p.differing);
        expect(p.sameSystem).toBe(a.systemProfile.profileId === b.systemProfile.profileId);
        if (p.sameSystem) { same += 1; expect(p.differing.length, `${f.familyId}: ${p.a} / ${p.b}`).toBeGreaterThanOrEqual(MINIMUM_SAME_SYSTEM_DIFFERENCE); } else { cross += 1; expect(p.differing.length, `${f.familyId}: ${p.a} / ${p.b}`).toBeGreaterThanOrEqual(MINIMUM_PAIRWISE_DIFFERENCE); }
      }
    }
    expect([cross, same]).toEqual([100, 9]);
    // the floors are the measured minima, not comfortable ones
    expect([MATRIX.summary.minimumCrossSystemDifference, MATRIX.summary.minimumSameSystemDifference]).toEqual([MINIMUM_PAIRWISE_DIFFERENCE, MINIMUM_SAME_SYSTEM_DIFFERENCE]);
    const closest = MATRIX.fidelity.flatMap((f) => f.pairwise.filter((p) => !p.sameSystem && p.differing.length === MINIMUM_PAIRWISE_DIFFERENCE).map((p) => `${p.a}-${p.b}`));
    expect([...new Set(closest)].sort()).toEqual(['IB.MATH_AA_HL.P2-CAMBRIDGE.9709.P1', 'PAA.MATEMATICAS-ICFES.SABER11_MATEMATICAS']);
    // the two IB papers differ exactly in what the component owns here: the tool policy and what it does to the numbers
    for (const f of MATRIX.fidelity) for (const p of f.pairwise) if (p.sameSystem) expect(p.differing).toEqual(['toolPolicy', 'numericProfile']);
    expect(MATRIX.summary.crossSystemDifferenceDistribution).toEqual({ 'differ-in-03': 11, 'differ-in-04': 9, 'differ-in-05': 6, 'differ-in-06': 4, 'differ-in-07': 9, 'differ-in-08': 6, 'differ-in-09': 14, 'differ-in-10': 17, 'differ-in-11': 23, 'differ-in-12': 1 });
  });

  it('worked fidelity comparison: the linear model, identical in what it is evidence of, materially different in how six components ask it', () => {
    const f = MATRIX.fidelity.find((x) => x.familyId === 'tf.math.linear.constant-rate-model')!;
    expect(f.invariant).toMatchObject({ primaryConceptStableIds: ['math.fun.linear-functions-lines'], canonicalSubject: 'Matemáticas', construct: 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE', evidenceActions: ['FORMULATE', 'INTERPRET'], identicalAcrossTargets: true });
    expect(f.targets).toEqual(['PAA.MATEMATICAS', 'IB.MATH_AA_HL.P1', 'IB.MATH_AA_HL.P2', 'CAMBRIDGE.9709.P1', 'PISA.MATHEMATICS', 'ICFES.SABER11_MATEMATICAS']);
    const v = (t: string) => SPECS.get(`${f.familyId}|${t}`)!.variable;
    expect(f.targets.map((t) => v(t)).map((x) => [x.responseFormat.format, x.context.kind, x.reasoningDepth.depth, x.commandTerm, x.stimulus.mode, x.toolPolicy.calculator, x.numericProfile, x.markStructure, x.rubricStyle, x.competencies.join('+')])).toEqual([
      ['SELECTED_RESPONSE', 'PERSONAL', 'ANSWER_ONLY', null, 'NONE', 'NONE', 'EXACT_WITHOUT_TOOL', 'ONE_MARK_PER_ITEM', 'KEY_ONLY', ''],
      ['SHORT_RESPONSE', 'SCIENTIFIC', 'METHOD_SHOWN', 'find', 'NONE', 'NONE', 'EXACT_WITHOUT_TOOL', 'MULTI_MARK_PARTS', 'METHOD_AND_ACCURACY', ''],
      ['SHORT_RESPONSE', 'SCIENTIFIC', 'METHOD_SHOWN', 'find', 'NONE', 'GDC_REQUIRED', 'REALISTIC_VALUES', 'MULTI_MARK_PARTS', 'METHOD_AND_ACCURACY', ''],
      ['SHORT_RESPONSE', 'SCIENTIFIC', 'METHOD_SHOWN', 'work out', 'NONE', 'SCIENTIFIC_REQUIRED', 'REALISTIC_VALUES', 'MULTI_MARK_PARTS', 'METHOD_AND_ACCURACY', 'AO2'],
      ['SELECTED_RESPONSE', 'PERSONAL', 'ANSWER_ONLY', null, 'OWN_STIMULUS', 'ALLOWED', 'REALISTIC_VALUES', 'CODED_CREDIT', 'CODED_CREDIT_LEVELS', 'FORMULATE+INTERPRET_EVALUATE'],
      ['SELECTED_RESPONSE', 'PERSONAL', 'ANSWER_ONLY', null, 'NONE', 'NONE', 'EXACT_WITHOUT_TOOL', 'ONE_MARK_PER_ITEM', 'KEY_ONLY', 'INTERPRETACION_REPRESENTACION+FORMULACION_EJECUCION'],
    ]);
    expect([v('PAA.MATEMATICAS').timeBudget, v('IB.MATH_AA_HL.P1').timeBudget, v('CAMBRIDGE.9709.P1').timeBudget, v('PISA.MATHEMATICS').timeBudget]).toEqual([{ secondsPerUnit: 65.45, unit: 'ITEM' }, { secondsPerUnit: 65.45, unit: 'MARK' }, { secondsPerUnit: 88, unit: 'MARK' }, { secondsPerUnit: null, unit: null }]);
    // applicability of this Matemáticas concept: established for PAA only -- the repository records nothing for the others
    expect(f.targets.map((t) => SPECS.get(`${f.familyId}|${t}`)!.assessmentApplicability.status)).toEqual(['ESTABLISHED', 'NOT_ESTABLISHED', 'NOT_ESTABLISHED', 'NOT_ESTABLISHED', 'NOT_ESTABLISHED', 'NOT_ESTABLISHED']);
    // only three of the six can be generated by the Production OS today: the constructed formats have no template
    expect(f.targets.filter((t) => v(t).responseFormat.productionFormat !== null)).toEqual(['PAA.MATEMATICAS', 'PISA.MATHEMATICS', 'ICFES.SABER11_MATEMATICAS']);
  });
});

describe('content use class, instance class and task-family maturity', () => {
  it('the pools are restated identically to the Production OS and to B2', () => {
    expect([...ADAPTATION_POOLS]).toEqual([...PRODUCTION_POOLS]);
    expect([...ADAPTATION_POOLS]).toEqual([...LOGICAL_POOLS]);
    expect([...CONTENT_USE_CLASSES]).toEqual(['DEV_TEST_CONTENT', 'EVIDENCE_BEARING']);
  });

  it('instance policy per purpose x use class: the locked rulings, as a total function', () => {
    const row = (purpose: string) => [purpose, instancePolicyFor(purpose, 'EVIDENCE_BEARING').allowedClasses.join('+'), instancePolicyFor(purpose, 'DEV_TEST_CONTENT').allowedClasses.join('+') || 'NOT ACCEPTED'];
    expect(INSTANCE_PURPOSES.map(row)).toEqual([
      ['PRACTICE', 'DYNAMIC+CERTIFIED_FROZEN', 'DYNAMIC+CERTIFIED_FROZEN'],
      ['DIAGNOSTIC', 'CERTIFIED_FROZEN', 'DYNAMIC+CERTIFIED_FROZEN'],
      ['VERIFICATION', 'CERTIFIED_FROZEN', 'DYNAMIC+CERTIFIED_FROZEN'],
      // LOCKED (EA-1A): a protected mock pool does not accept DEV_TEST_CONTENT. The earlier reading that allowed it is overruled.
      ['REDUCED_MOCK', 'CERTIFIED_FROZEN', 'NOT ACCEPTED'],
      ['FULL_MOCK_1', 'CERTIFIED_FROZEN', 'NOT ACCEPTED'],
      ['FULL_MOCK_2', 'CERTIFIED_FROZEN', 'NOT ACCEPTED'],
      ['LOW_STAKES_REINFORCEMENT', 'DYNAMIC+CERTIFIED_FROZEN', 'DYNAMIC+CERTIFIED_FROZEN'],
      ['BENCHMARK', 'CERTIFIED_FROZEN', 'NOT ACCEPTED'],
      ['CALIBRATION', 'CERTIFIED_FROZEN', 'NOT ACCEPTED'],
      ['PILOT_CERTIFICATION', 'CERTIFIED_FROZEN', 'NOT ACCEPTED'],
    ]);
    for (const pool of ADAPTATION_POOLS) for (const use of CONTENT_USE_CLASSES) expect(instancePolicyFor(pool, use).basis, `${pool}/${use}`).toBe('USER_DECISION');
    for (const pool of PROTECTED_MOCK_POOLS) expect(instancePolicyFor(pool, 'DEV_TEST_CONTENT')).toMatchObject({ permitted: false, allowedClasses: [], minimumClass: null });
    // the three non-pool certification purposes are not named by the rulings: refused like the mock pools, and flagged as a reading
    expect(['BENCHMARK', 'CALIBRATION', 'PILOT_CERTIFICATION'].map((p) => [instancePolicyFor(p, 'DEV_TEST_CONTENT').permitted, instancePolicyFor(p, 'DEV_TEST_CONTENT').basis])).toEqual(Array(3).fill([false, 'CONSERVATIVE_READING']));
    expect([instanceClassSatisfies('DYNAMIC', 'PRACTICE', 'EVIDENCE_BEARING'), instanceClassSatisfies('DYNAMIC', 'DIAGNOSTIC', 'EVIDENCE_BEARING'), instanceClassSatisfies('DYNAMIC', 'DIAGNOSTIC', 'DEV_TEST_CONTENT'), instanceClassSatisfies('DYNAMIC', 'FULL_MOCK_1', 'EVIDENCE_BEARING'), instanceClassSatisfies('CERTIFIED_FROZEN', 'FULL_MOCK_1', 'EVIDENCE_BEARING'), instanceClassSatisfies('CERTIFIED_FROZEN', 'FULL_MOCK_1', 'DEV_TEST_CONTENT'), instanceClassSatisfies('DYNAMIC', 'FULL_MOCK_1', 'DEV_TEST_CONTENT')]).toEqual([true, false, true, false, true, false, false]);
    expect(() => instancePolicyFor('HOMEWORK', 'EVIDENCE_BEARING')).toThrow(/UNKNOWN_INSTANCE_PURPOSE/);
    expect(() => instancePolicyFor('PRACTICE', 'STAGING')).toThrow(/UNKNOWN_CONTENT_USE_CLASS/);
    // dev-test content is a different USE, not weaker evidence: it never bears evidence. Diagnostic and Verification
    // accept it only as that: non-evidence test execution.
    expect([mayBearEvidence('DEV_TEST_CONTENT'), mayBearEvidence('EVIDENCE_BEARING')]).toEqual([false, true]);
  });

  it('LOCKED: a protected mock pool refuses DEV_TEST_CONTENT by name, whatever the family, the profile or the request', () => {
    for (const purpose of PROTECTED_MOCK_POOLS) {
      const r = run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose });
      expect(r).toMatchObject({ ok: false, refusal: { code: 'DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE' } });
      expect(!r.ok && r.refusal.detail).toMatch(/protected mock pool does not accept DEV_TEST_CONTENT/);
      // not even from a reviewed family under certified profiles: it is the USE that is refused
      expect(refusal(run(reviewed(RATE_MODEL), certified(PAA_SYSTEM_PROFILE), { ...REQUEST, purpose }, POLICY, certified(PAA_MATEMATICAS_COMPONENT)))).toBe('DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE');
    }
    for (const purpose of ['PRACTICE', 'DIAGNOSTIC', 'VERIFICATION'] as const) expect(spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose })).purpose).toMatchObject({ purpose, allowedInstanceClasses: ['DYNAMIC', 'CERTIFIED_FROZEN'], minimumInstanceClass: 'DYNAMIC' });
    // the EA-1 matrix asks for Practice only, so the ruling refuses none of its attempts
    expect(MATRIX.request.purpose).toBe('PRACTICE');
    expect(MATRIX.cells.filter((c) => c.refusal?.code === 'DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE')).toEqual([]);
  });

  it('LOCKED: a PROVISIONAL / ILLUSTRATIVE assessment profile generates DEV_TEST_CONTENT only; evidence-bearing content requires a CERTIFIED one', () => {
    for (const p of [...EA1_SYSTEM_PROFILES, ...EA1_COMPONENT_PROFILES]) expect(profileMayFeedEvidenceBearingContent(p)).toBe(false);
    // a reviewed family is not enough: the profile is provisional
    const r = run(reviewed(RATE_MODEL), PAA_SYSTEM_PROFILE, { ...REQUEST, contentUseClass: 'EVIDENCE_BEARING' });
    expect(r).toMatchObject({ ok: false, refusal: { code: 'ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT' } });
    expect(!r.ok && r.refusal.detail).toMatch(/PAA@.*PROVISIONAL_ILLUSTRATIVE.*PAA\.MATEMATICAS@.*PROVISIONAL_ILLUSTRATIVE/);
    // system and component must BOTH be certified
    expect(refusal(run(reviewed(RATE_MODEL), certified(PAA_SYSTEM_PROFILE), { ...REQUEST, contentUseClass: 'EVIDENCE_BEARING' }))).toBe('ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT');
    expect(refusal(run(reviewed(RATE_MODEL), PAA_SYSTEM_PROFILE, { ...REQUEST, contentUseClass: 'EVIDENCE_BEARING' }, POLICY, certified(PAA_MATEMATICAS_COMPONENT)))).toBe('ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT');
    expect(runCertified(RATE_MODEL, PAA_SYSTEM_PROFILE).ok).toBe(true);
    // the provisional profile still generates dev-test content, and the specification says what it is
    expect(spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE))).toMatchObject({ contentUseClass: 'DEV_TEST_CONTENT', systemProfile: { status: 'PROVISIONAL_ILLUSTRATIVE' }, componentProfile: { status: 'PROVISIONAL_ILLUSTRATIVE' } });
  });

  it('LOCKED: a profile is version-aware -- an OFFICIAL rule needs a typed, authoritative version binding (EXAM / SYLLABUS / FRAMEWORK version)', () => {
    const exam = (cfg: { key: string; version: { label: string }; sections: Array<{ key: string }> }, key: string) => ({ targetType: 'EXAM_VERSION', targetIdentity: cfg.key, version: cfg.version.label, componentKey: cfg.sections.find((x) => x.key === key)!.key });
    // every binding is what the repository records, and of the kind the system really has
    expect(PAA_MATEMATICAS_COMPONENT.versionBinding).toMatchObject(exam(PAA_V2 as never, 'matematicas'));
    expect(IB_MATH_AA_HL_P1_COMPONENT.versionBinding).toMatchObject(exam(IB_MATH_AA_HL_V2 as never, 'p1'));
    expect(IB_MATH_AA_HL_P2_COMPONENT.versionBinding).toMatchObject(exam(IB_MATH_AA_HL_V2 as never, 'p2'));
    expect(ICFES_COMPONENT.versionBinding).toMatchObject(exam(SABER11_MATH_V2 as never, 'math'));
    // PISA binds to its FRAMEWORK version
    const framework = (PISA_MATH_V2 as unknown as { framework: { frameworkKey: string; frameworkVersion: string } }).framework;
    expect(PISA_MATHEMATICS_COMPONENT.versionBinding).toMatchObject({ targetType: 'FRAMEWORK_VERSION', targetIdentity: framework.frameworkKey, version: framework.frameworkVersion, componentKey: 'math' });
    // Cambridge binds to its real carrier, the 9709 SYLLABUS version: no exam-version record is invented for it
    const s9709 = AICE_SYLLABI.find((x) => x.code === '9709')!;
    expect(CAMBRIDGE_COMPONENT.versionBinding).toEqual({ targetType: 'SYLLABUS_VERSION', targetIdentity: s9709.code, version: s9709.versionKey, componentKey: s9709.components.find((c) => c.key === 'p1')!.key, provenance: { kind: 'AUTHORITATIVE_SOURCE', sourceKeys: [s9709.sourceKey], recordedIn: 'AICE_SYLLABI[code 9709].code / versionKey / components[p1]' } });
    expect(CAMBRIDGE_SYSTEM_PROFILE.versionBinding).toMatchObject({ targetType: 'SYLLABUS_VERSION', targetIdentity: '9709', version: '2026-2027', componentKey: null });
    for (const f of walk(ADAPTATION_DIR)) expect(code(f), f).not.toMatch(/targetIdentity: 'v2\.(cambridge|aice)|'v2\.aice\.9709/);
    // a binding preserves target type, identity, version and provenance, and its sources are registered ones
    const registry = new Set(ASSESSMENT_SOURCES.map((x) => x.key));
    for (const c of EA1_COMPONENT_PROFILES) {
      expect(Object.keys(c.versionBinding!).sort(), c.componentId).toEqual(['componentKey', 'provenance', 'targetIdentity', 'targetType', 'version']);
      const p = c.versionBinding!.provenance;
      expect(p.kind).toBe('AUTHORITATIVE_SOURCE');
      if (p.kind === 'AUTHORITATIVE_SOURCE') for (const k of p.sourceKeys) expect(registry.has(k), `${c.componentId}: ${k}`).toBe(true);
    }
    // an OFFICIAL override without a binding is refused; the stable semantic key does not replace it
    const unbound = { ...clone(PAA_MATEMATICAS_COMPONENT), versionBinding: null };
    expect(unbound.semanticComponentKey).toBe('paa.matematicas');
    expect(AssessmentComponentProfileSchema.safeParse(unbound).error?.issues.map((i) => i.message)).toContain('OFFICIAL_RULE_NEEDS_A_VERSION_BINDING');
    expect(refusal(run(RATE_MODEL, PAA_SYSTEM_PROFILE, REQUEST, POLICY, unbound))).toBe('COMPONENT_PROFILE_INVALID');
    // ... so is one bound to an institution's policy version, and one whose binding does not carry the rule's source
    const institutionBound = { ...clone(PAA_MATEMATICAS_COMPONENT), versionBinding: { targetType: 'INSTITUTION_POLICY_VERSION', targetIdentity: 'institution.x.policy', version: '1', componentKey: null, provenance: { kind: 'INSTITUTION', institutionKey: 'institution.x', recordedIn: 'nowhere in the repository' } } };
    expect(AssessmentComponentProfileSchema.safeParse(institutionBound).error?.issues.map((i) => i.message)).toContain('OFFICIAL_RULE_NEEDS_AN_AUTHORITATIVE_BINDING');
    const otherSource = clone(PAA_MATEMATICAS_COMPONENT) as AssessmentComponentProfile;
    (otherSource.versionBinding!.provenance as { sourceKeys: string[] }).sourceKeys = ['cb-paa-guia-2021'];
    expect(AssessmentComponentProfileSchema.safeParse(otherSource).error?.issues.map((i) => i.message)).toContain('OFFICIAL_SOURCE_IS_NOT_OF_THE_BOUND_VERSION');
    expect(AssessmentComponentProfileSchema.safeParse({ ...clone(PAA_MATEMATICAS_COMPONENT), versionBinding: { ...PAA_MATEMATICAS_COMPONENT.versionBinding, provenance: { kind: 'INSTITUTION', institutionKey: 'x', recordedIn: 'a b c' } } }).error?.issues.map((i) => i.message)).toContain('BINDING_PROVENANCE_DOES_NOT_MATCH_TARGET_TYPE');
    // the same holds at system level: a system profile with an OFFICIAL rule and no binding is refused
    const { versionBinding: _b, ...cambridgeUnbound } = clone(CAMBRIDGE_SYSTEM_PROFILE);
    expect(AssessmentSystemProfileSchema.safeParse(cambridgeUnbound).error?.issues.map((i) => i.message)).toContain('OFFICIAL_RULE_NEEDS_A_VERSION_BINDING');
    for (const p of EA1_SYSTEM_PROFILES) expect(p.versionBinding !== undefined, p.profileId).toBe(authorityBreakdown(p).official.length > 0);
    // a component that states no official fact may be unbound, and the semantic key is optional
    const policyOnly = clone(unbound) as AssessmentComponentProfile;
    for (const d of PROFILE_RULE_DIMENSIONS) if (policyOnly.overrides[d]) (policyOnly.overrides[d] as { authority: unknown }).authority = { kind: 'STUDYUS_POLICY', provisional: true, assumption: 'A working assumption, bound to no version.' };
    expect(AssessmentComponentProfileSchema.safeParse({ ...policyOnly, semanticComponentKey: null }).success).toBe(true);
    // the specification carries the binding of what it targets
    expect(spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE)).componentProfile!.versionBinding).toEqual(PAA_MATEMATICAS_COMPONENT.versionBinding);
    expect(spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE)).systemProfile).not.toHaveProperty('versionBinding');
    expect(spec(run(RATE_MODEL, CAMBRIDGE_SYSTEM_PROFILE)).systemProfile.versionBinding).toEqual(CAMBRIDGE_SYSTEM_PROFILE.versionBinding);
    for (const c of EA1_COMPONENT_PROFILES) expect(c.versionBinding, c.componentId).not.toBeNull();
  });

  it('a specification records the use class it was produced for and the instance classes its purpose accepts', () => {
    expect(spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'DIAGNOSTIC' }))).toMatchObject({ contentUseClass: 'DEV_TEST_CONTENT', purpose: { purpose: 'DIAGNOSTIC', pool: 'DIAGNOSTIC', allowedInstanceClasses: ['DYNAMIC', 'CERTIFIED_FROZEN'], minimumInstanceClass: 'DYNAMIC' } });
    expect(spec(runCertified(RATE_MODEL, PAA_SYSTEM_PROFILE, { purpose: 'FULL_MOCK_2' }))).toMatchObject({ contentUseClass: 'EVIDENCE_BEARING', taskFamily: { lifecycle: 'CERTIFIED', reviewStatus: 'REVIEWED' }, systemProfile: { status: 'CERTIFIED' }, purpose: { allowedInstanceClasses: ['CERTIFIED_FROZEN'], minimumInstanceClass: 'CERTIFIED_FROZEN' } });
    expect(spec(runCertified(RATE_MODEL, PAA_SYSTEM_PROFILE, { purpose: 'DIAGNOSTIC' })).purpose.allowedInstanceClasses).toEqual(['CERTIFIED_FROZEN']);
    expect(spec(runCertified(RATE_MODEL, PAA_SYSTEM_PROFILE, { purpose: 'PRACTICE' })).purpose.allowedInstanceClasses).toEqual(['DYNAMIC', 'CERTIFIED_FROZEN']);
    expect(spec(runCertified(RATE_MODEL, PAA_SYSTEM_PROFILE, { purpose: 'CALIBRATION' })).purpose).toMatchObject({ pool: null, minimumInstanceClass: 'CERTIFIED_FROZEN' });
    // the use class is part of the identity: the same request for the other use is another specification
    expect(spec(runCertified(RATE_MODEL, PAA_SYSTEM_PROFILE, { contentUseClass: 'DEV_TEST_CONTENT' })).specificationId).not.toBe(spec(runCertified(RATE_MODEL, PAA_SYSTEM_PROFILE)).specificationId);
  });

  it('task-family maturity: a DRAFT or UNREVIEWED family generates DEV_TEST_CONTENT only; evidence-bearing content is refused by name', () => {
    for (const f of MATH_POC_FAMILIES) {
      expect(familyMayFeedEvidenceBearingContent(f), f.familyId).toBe(false);
      for (const purpose of ['PRACTICE', 'DIAGNOSTIC', 'FULL_MOCK_1'] as const) expect(refusal(run(f, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose, contentUseClass: 'EVIDENCE_BEARING' }))).toBe('FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT');
    }
    const states: Array<[TaskFamily['lifecycle'], TaskFamily['reviewStatus'], boolean]> = [['DRAFT', 'UNREVIEWED', false], ['DRAFT', 'REVIEWED', false], ['IN_REVIEW', 'IN_REVIEW', false], ['IN_REVIEW', 'REVIEWED', false], ['CERTIFIED', 'REVIEWED', true]];
    for (const [lifecycle, reviewStatus, ok] of states) {
      const f = { ...clone(RATE_MODEL), lifecycle, reviewStatus };
      expect(familyMayFeedEvidenceBearingContent(f), `${lifecycle}/${reviewStatus}`).toBe(ok);
      expect(run(f, certified(PAA_SYSTEM_PROFILE), { ...REQUEST, contentUseClass: 'EVIDENCE_BEARING' }, POLICY, certified(PAA_MATEMATICAS_COMPONENT)).ok, `${lifecycle}/${reviewStatus}`).toBe(ok);
      // every non-retired state may still produce dev-test content
      expect(run(f, PAA_SYSTEM_PROFILE).ok).toBe(true);
    }
    const r = run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'FULL_MOCK_1', contentUseClass: 'EVIDENCE_BEARING' });
    expect(!r.ok && r.refusal.detail).toMatch(/DRAFT \/ UNREVIEWED; it may generate DEV_TEST_CONTENT only/);
    // a reviewed family is still subject to everything else: support, applicability, and every Question Bank gate after generation
    expect(refusal(runCertified(MISSING_VALUE, PISA_SYSTEM_PROFILE))).toBe('PROFILE_UNSUPPORTED_BY_FAMILY');
    expect(refusal(runCertified(MISSING_VALUE, IB_SYSTEM_PROFILE))).toBe('ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED');
    // no proof-of-concept family was marked reviewed
    expect(MATH_POC_FAMILIES.map((f) => `${f.lifecycle}/${f.reviewStatus}`)).toEqual(Array(10).fill('DRAFT/UNREVIEWED'));
  });

  it('the promotion path DESCRIBES the existing gates and adds none; adaptation establishes no right, review, attribution or pool', () => {
    expect(PROMOTION_PATH.map((s) => s.step)).toEqual(['AUTOMATED_VALIDATION', 'ORIGINALITY', 'RIGHTS', 'HUMAN_REVIEW', 'ATTRIBUTION', 'POOL_ASSIGNMENT']);
    expect([...NOT_ESTABLISHED_BY_ADAPTATION]).toEqual(['REUSE_RIGHTS', 'ORIGINALITY', 'HUMAN_REVIEW', 'PRIMARY_ATTRIBUTION', 'POOL_MEMBERSHIP', 'INSTANCE_CERTIFICATION', 'EVIDENCE_INDEPENDENCE', 'REVIEWER_QUALIFICATION', 'CONCEPT_CERTIFICATION']);
    // the gates are untouched by this phase: neither file was changed, and neither knows a family or a specification
    for (const gate of ['rights-gate.ts', 'review-package.ts', 'pool-assignment.ts', 'originality-gate.ts', 'structural-validation.ts', 'validated-candidate.ts']) expect(read(`src/lib/exam-core/question-bank/production/${gate}`), gate).not.toMatch(/adaptation|taskFamily|task-famil|AdaptationSpecification/i);
    // a generated instance's rights are not establishable without verified evidence -- with or without a specification behind it
    const evidence = { provenance: 'STUDYUS_GENERATED' as const, authorshipTermsReference: 'provider terms', sourceUsages: [], originality: { outcome: 'ORIGINAL_LOW_RISK' as never, acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [] };
    const verdict = evaluateRightsGate(evidence);
    expect(verdict).toMatchObject({ deliverable: false, supportedReuseRights: 'UNKNOWN', proposedRecord: null });
    expect(verdict.blockers).toContain('MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING');
    // a specification, a certified family or a certified profile is not evidence the gate reads: passing them changes nothing
    const s = spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE));
    expect(evaluateRightsGate({ ...evidence, adaptationSpecification: s, taskFamily: { ...RATE_MODEL, lifecycle: 'CERTIFIED', reviewStatus: 'REVIEWED' } } as never)).toEqual(verdict);
    expect(evaluatePoolAssignment({ intendedPool: 'PRACTICE', humanReviewApproved: false, rightsEstablished: false, originalityAccepted: false, activePools: [], stimulusBound: false, stimulusPool: null })).toMatchObject({ assignable: false, blockers: ['REVIEW_NOT_APPROVED', 'RIGHTS_NOT_ESTABLISHED', 'ORIGINALITY_NOT_ACCEPTED'] });
  });

  it('the independence carrier and the evidence facets are types and names only: no rule, no weight, no writer', () => {
    expect([...ADAPTATION_EVIDENCE_FACETS]).toEqual(['KNOWLEDGE', 'SKILL', 'COMPETENCY', 'CONTEXT', 'INDEPENDENCE', 'TRANSFER', 'LEARNING_APPROACH', 'ASSESSMENT_PROFILE', 'RETENTION']);
    const src = read(`${ADAPTATION_DIR}/instance-lineage.ts`);
    for (const t of ['export interface InstanceIndependenceCarrier', 'export type SiblingRelationship', 'export type ExposureRelationship', 'export interface InstancePairRelationship', 'export interface EvidenceFacetCarrier']) expect(src).toContain(t);
    for (const field of ['familyIdentity', 'parameterizationIdentity', 'variantFamilyIdentity']) expect(src).toContain(field);
    // the only functions of the module are the instance-class contract; nothing computes a relationship or independence
    expect([...code(`${ADAPTATION_DIR}/instance-lineage.ts`).matchAll(/export (?:function|const) (\w+)\s*(?:=\s*\(|\()/g)].map((m) => m[1]).sort()).toEqual(['instanceClassSatisfies', 'instancePolicyFor', 'mayBearEvidence']);
    for (const f of [...walk(ADAPTATION_DIR), ...walk(FAMILIES_DIR)]) expect(code(f), f).not.toMatch(/isIndependent|independenceOf|areIndependent|evidenceWeight|updateMastery|recordEvidence|writeEvidence|learning_evidence|knowledge_state/);
  });
});

describe('Production OS integration: additive, and content without a task family is as valid as before', () => {
  const CELLS = resolvePaaRequirementCells();
  const PLAN = buildPaaGenerationPlan(CELLS);
  const UNIT_KEY = 'SU|FULL_MOCK_1|028|math.num.ratio-proportion|STUDENT_PRODUCED|STANDARD#1';
  const UNIT = PLAN.units.find((u) => u.unitKey === UNIT_KEY)!;
  const SLOT = UNIT.type === 'STANDALONE' ? UNIT.slot : UNIT.plan.memberSlots[0];
  const CELL = CELLS.find((c) => c.cellKey === SLOT.cellKey)!;
  const RECORDING = JSON.parse(read(`${PILOT_V2_DIR}/${PILOT_V2_FILES.recording}`)) as PilotRecording;
  const RECORDED = RECORDING.responses.find((r) => r.unitKey === UNIT_KEY)!;
  const PILOT_BATCH = GenerationBatchSchema.parse(JSON.parse(read(`${PILOT_V2_DIR}/${PILOT_V2_FILES.batch}`)));
  const input = (provider: GenerateCandidatesInput['provider'], adaptationSpecifications?: Record<string, unknown>): GenerateCandidatesInput => ({
    unit: UNIT, cells: [CELL], packs: { [CELL.primaryConcept.stableId]: paaGenerationReadyPack(CELL.primaryConcept.stableId, PILOT_V2_RUN.now) },
    policy: { policyId: PILOT_V2_POLICY.id, policyVersion: PILOT_V2_POLICY.version, author: { kind: 'MODEL', model: PILOT_V2_PROVIDER.model, promptVersion: 'template-registry/1', requestedBy: 'qb-r2c-coordinating-session' }, language: 'es', copyReferenceExpression: false },
    provider, templateRegistry: DEFAULT_TEMPLATE_REGISTRY, runId: PILOT_V2_RUN.runId, batchKey: PILOT_V2_RUN.batchKey, now: PILOT_V2_RUN.now, options: { allowUnboundCells: true, attachOptionalStimulus: false },
    labels: { topics: Object.fromEntries(PAA_TOPICS.map((t) => [t.code, t.label])) },
    ...(adaptationSpecifications ? { adaptationSpecifications } : {}),
  });
  const replay = new RecordedResponseProvider(PILOT_V2_PROVIDER.id, PILOT_V2_PROVIDER.model, new Map(RECORDING.responses.map((r) => [r.promptHash, providerCanonicalJson(r.response)])));
  // The pilot unit is in a protected mock pool (FULL_MOCK_1), which takes evidence-bearing content only. That needs a
  // reviewed family and certified profiles, and the repository has neither: this suite uses TEST DOUBLES for both.
  const CERTIFIED_PAA = certified(PAA_SYSTEM_PROFILE);
  const CERTIFIED_PAA_MATEMATICAS = certified(PAA_MATEMATICAS_COMPONENT);
  const REVIEWED_MISSING_VALUE = reviewed(MISSING_VALUE);
  const BRIDGE = { profiles: [CERTIFIED_PAA, ...EA1_SYSTEM_PROFILES.filter((p) => p.profileId !== 'PAA')], component: CERTIFIED_PAA_MATEMATICAS, applicability: MATH_POC_APPLICABILITY, contentUseClass: 'EVIDENCE_BEARING' as const, disciplinePolicy: POLICY, language: 'es' };
  const bridged = adaptForCell({ cell: CELL, family: REVIEWED_MISSING_VALUE, ...BRIDGE });
  const SPEC = spec(bridged as AdaptationResult);

  it('cell -> evidence target -> family selection -> profile -> specification, from the cell\'s own fields and nothing else', () => {
    expect(evidenceTargetOfCell(CELL)).toEqual({ primaryConcept: CELL.primaryConcept, examFamily: 'PAA', pool: 'FULL_MOCK_1' });
    const selection = selectTaskFamilies(CELL, MATH_POC_FAMILIES);
    expect(selection.candidates.map((f) => f.familyId)).toEqual(['tf.math.proportion.missing-value', 'tf.math.proportion.rate-comparison-model']);
    expect(SPEC).toMatchObject({ taskFamily: { familyId: 'tf.math.proportion.missing-value' }, systemProfile: { profileId: 'PAA', examFamilyCode: 'PAA' }, componentProfile: { componentId: 'PAA.MATEMATICAS' }, primaryConcept: CELL.primaryConcept, assessmentApplicability: { status: 'ESTABLISHED', basis: 'OFFICIAL_EXAM_STRUCTURE' }, contentUseClass: 'EVIDENCE_BEARING', blueprintRequirement: { requirementCellKey: CELL.cellKey }, purpose: { pool: 'FULL_MOCK_1', minimumInstanceClass: 'CERTIFIED_FROZEN' }, variable: { responseFormat: { format: 'NUMERIC_ENTRY', productionFormat: 'STUDENT_PRODUCED' }, difficulty: { band: 'STANDARD' }, language: 'es' } });
    // selection matches by stable id AND canonical subject: a concept of another subject is never matched by its id alone
    expect(selectTaskFamilies({ ...CELL, primaryConcept: { ...CELL.primaryConcept, canonicalSubject: 'Mathematics' } }, MATH_POC_FAMILIES).candidates).toEqual([]);
    const quadratic = CELLS.find((c) => c.primaryConcept.stableId === 'math.alg.quadratics' && c.responseFormat === 'MULTIPLE_CHOICE')!;
    // the two quadratic families exclude selected response: a multiple-choice cell has no family, and is generated as before
    expect(selectTaskFamilies(quadratic, MATH_POC_FAMILIES)).toMatchObject({ candidates: [], excluded: [{ reason: 'RESPONSE_FORMAT_NOT_OF_THE_FAMILY' }, { reason: 'RESPONSE_FORMAT_NOT_OF_THE_FAMILY' }] });
    expect(selectTaskFamilies(CELLS.find((c) => c.primaryConcept.stableId === 'math.stat.data-representation' && c.stimulus.class === 'STANDALONE') ?? { ...CELL, primaryConcept: { stableId: 'math.stat.data-representation', canonicalSubject: 'Matemáticas', canonicalName: 'x' } }, MATH_POC_FAMILIES).candidates).toEqual([]);
    // named refusals of the bridge
    expect(adaptForCell({ cell: { ...CELL, examFamily: 'SEP' }, family: REVIEWED_MISSING_VALUE, ...BRIDGE })).toMatchObject({ ok: false, refusal: { code: 'NO_PROFILE_FOR_EXAM_FAMILY' } });
    // EA-1A D5: an AICE cell is assessed by the CAMBRIDGE system (AICE is a qualification context, with no profile of its own)
    const aiceQuadratic = { ...CELL, intendedPool: 'PRACTICE', examFamily: 'AICE', responseFormat: 'STUDENT_PRODUCED', primaryConcept: FACTORISING.primaryConcepts[0] };
    expect(adaptForCell({ cell: aiceQuadratic, family: FACTORISING, profiles: EA1_SYSTEM_PROFILES, component: CAMBRIDGE_COMPONENT, applicability: MATH_POC_APPLICABILITY, contentUseClass: 'DEV_TEST_CONTENT', disciplinePolicy: POLICY, language: 'en' })).toMatchObject({ ok: false, refusal: { code: 'RESPONSE_FORMAT_NOT_ALLOWED' } });
    expect(adaptForCell({ cell: { ...CELL, examFamily: 'AICE' }, family: REVIEWED_MISSING_VALUE, ...BRIDGE })).toMatchObject({ ok: false, refusal: { code: 'COMPONENT_NOT_OF_THE_SYSTEM' } });
    expect(adaptForCell({ cell: CELL, family: reviewed(FACTORISING), ...BRIDGE })).toMatchObject({ ok: false, refusal: { code: 'FAMILY_DOES_NOT_TARGET_THE_CELLS_CONCEPT' } });
    // a cell is content of a component: without one the bridge is refused (a mock pool is never generic practice)
    expect(adaptForCell({ cell: CELL, family: REVIEWED_MISSING_VALUE, ...BRIDGE, component: null })).toMatchObject({ ok: false, refusal: { code: 'COMPONENT_REQUIRED' } });
    // WITH WHAT THE REPOSITORY REALLY HOLDS this cell gets no specification at all, in either use:
    //   the draft family cannot produce evidence-bearing content ...
    expect(adaptForCell({ cell: CELL, family: MISSING_VALUE, ...BRIDGE })).toMatchObject({ ok: false, refusal: { code: 'FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT' } });
    //   ... the provisional profiles cannot either ...
    expect(adaptForCell({ cell: CELL, family: REVIEWED_MISSING_VALUE, ...BRIDGE, profiles: EA1_SYSTEM_PROFILES, component: PAA_MATEMATICAS_COMPONENT })).toMatchObject({ ok: false, refusal: { code: 'ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT' } });
    //   ... and a protected mock pool does not accept dev-test content
    expect(adaptForCell({ cell: CELL, family: MISSING_VALUE, ...BRIDGE, profiles: EA1_SYSTEM_PROFILES, component: PAA_MATEMATICAS_COMPONENT, contentUseClass: 'DEV_TEST_CONTENT' })).toMatchObject({ ok: false, refusal: { code: 'DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE' } });
    // production is strict about applicability, even for dev-test content: a Practice cell under a system where the repository records none is refused
    const practiceIcfes = { ...CELL, intendedPool: 'PRACTICE', examFamily: 'ICFES', responseFormat: 'MULTIPLE_CHOICE' };
    const DEV = { profiles: EA1_SYSTEM_PROFILES, applicability: MATH_POC_APPLICABILITY, contentUseClass: 'DEV_TEST_CONTENT' as const, disciplinePolicy: POLICY, language: 'es' };
    expect(adaptForCell({ cell: practiceIcfes, family: MISSING_VALUE, ...DEV, component: ICFES_COMPONENT })).toMatchObject({ ok: false, refusal: { code: 'ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED' } });
    expect(adaptForCell({ cell: practiceIcfes, family: MISSING_VALUE, ...DEV, component: ICFES_COMPONENT, applicabilityRequirement: 'NOT_REQUIRED' }).ok).toBe(true);
    // a real Practice cell of PAA with the real draft family and the real provisional profiles: a dev-test specification
    const practiceCell = CELLS.find((c) => c.primaryConcept.stableId === 'math.num.ratio-proportion' && c.intendedPool === 'PRACTICE' && c.responseFormat === 'MULTIPLE_CHOICE')!;
    expect(adaptForCell({ cell: practiceCell, family: MISSING_VALUE, ...DEV, component: PAA_MATEMATICAS_COMPONENT })).toMatchObject({ ok: true, specification: { contentUseClass: 'DEV_TEST_CONTENT', taskFamily: { lifecycle: 'DRAFT' }, systemProfile: { status: 'PROVISIONAL_ILLUSTRATIVE' }, assessmentApplicability: { basis: 'OFFICIAL_EXAM_STRUCTURE' } } });
    // every PAA cell of the five concepts that has a fitting family gets a specification under the strict rule, or a named refusal
    let specified = 0;
    for (const c of CELLS) for (const f of selectTaskFamilies(c, MATH_POC_FAMILIES).candidates) {
      const r = adaptForCell({ cell: c, family: reviewed(f), ...BRIDGE });
      if (r.ok) { specified += 1; expect(r.specification.assessmentApplicability.basis).toBe('OFFICIAL_EXAM_STRUCTURE'); expect(r.specification.blueprintRequirement).toEqual({ requirementCellKey: c.cellKey }); } else expect(['SUPPORT_CONSTRAINT_VIOLATED', 'PROFILE_UNSUPPORTED_BY_FAMILY']).toContain(r.refusal.code);
    }
    expect(specified).toBeGreaterThan(20);
  });

  it('WITHOUT a specification the prompt, its hash and the candidate are exactly the pilot\'s: the QB-R2C artifact still reproduces', async () => {
    const rendered = renderGenerationPrompt(input(replay));
    expect(rendered.promptHash).toBe(RECORDED.promptHash);
    expect(Object.keys(rendered.prompt.instruction)).not.toContain('adaptation');
    const batch = await generateCandidates(input(replay));
    const stored = PILOT_BATCH.candidates.find((c) => c.slotKey === SLOT.slotKey)!;
    expect(canonicalJson(batch.candidates[0])).toBe(canonicalJson(stored));
    expect(batch.candidates[0].lineage).not.toHaveProperty('adaptation');
    // an empty map is the same as no map: the member is absent, not empty
    expect(renderGenerationPrompt(input(replay, {})).promptHash).toBe(RECORDED.promptHash);
    // no stored pilot candidate carries adaptation lineage, and none is reported as a lineage gap for lacking it
    for (const c of PILOT_BATCH.candidates) { expect(c.lineage).not.toHaveProperty('adaptation'); expect(lineageGaps(c.lineage)).toEqual([]); }
  });

  it('WITH a specification it is part of the prompt, hence of the prompt hash, and its identity is recorded on the candidate', async () => {
    const rendered = renderGenerationPrompt(input(replay, { [SLOT.slotKey]: SPEC }));
    expect(rendered.promptHash).not.toBe(RECORDED.promptHash);
    expect(rendered.prompt.instruction.adaptation).toEqual([{ slotKey: SLOT.slotKey, specificationId: SPEC.specificationId, contentUseClass: 'EVIDENCE_BEARING', taskFamily: { familyId: 'tf.math.proportion.missing-value', version: MISSING_VALUE.version }, systemProfile: { profileId: 'PAA', version: PAA_SYSTEM_PROFILE.version }, componentProfile: { componentId: 'PAA.MATEMATICAS', version: PAA_MATEMATICAS_COMPONENT.version }, disciplinePolicy: { policyId: POLICY.policyId, version: POLICY.version }, invariants: SPEC.invariants, invariantHash: SPEC.invariantHash, variable: SPEC.variable, parameterization: SPEC.parameterization }]);
    // everything else in the prompt is unchanged
    const { adaptation: _a, ...rest } = rendered.prompt.instruction;
    expect(canonicalJson(rest)).toBe(canonicalJson(renderGenerationPrompt(input(replay)).prompt.instruction));
    // a recording made for the prompt without a specification does not answer this one: never rebound silently
    await expect(generateCandidates(input(replay, { [SLOT.slotKey]: SPEC }))).rejects.toMatchObject({ code: 'RECORDED_RESPONSE_NOT_FOUND' });
    // the same recorded CONTENT, recorded against the new prompt (a test double, not a provider run)
    const provider = new RecordedResponseProvider('recorded:ea1-test-double', PILOT_V2_PROVIDER.model, new Map([[rendered.promptHash, providerCanonicalJson(RECORDED.response)]]));
    const batch = await generateCandidates(input(provider, { [SLOT.slotKey]: SPEC }));
    const c = batch.candidates[0];
    const lineage = c.lineage as Extract<QuestionCandidate['lineage'], { kind: 'MODEL' }>;
    expect(lineage.adaptation).toEqual({ taskFamily: { id: 'tf.math.proportion.missing-value', version: MISSING_VALUE.version }, systemProfile: { id: 'PAA', version: PAA_SYSTEM_PROFILE.version }, componentProfile: { id: 'PAA.MATEMATICAS', version: PAA_MATEMATICAS_COMPONENT.version }, disciplinePolicy: { id: POLICY.policyId, version: POLICY.version }, adaptationSpecificationId: SPEC.specificationId, invariantHash: SPEC.invariantHash, contentUseClass: 'EVIDENCE_BEARING', generationRunId: PILOT_V2_RUN.runId });
    expect(AdaptationLineageSchema.safeParse(lineage.adaptation).success).toBe(true);
    expect(lineage.promptHash).toBe(rendered.promptHash);
    // the plan still decides concept, format, band and pool; the specification changed none of them
    expect([c.primaryConceptStableId, c.responseFormat, c.difficultyBand, c.cellKey]).toEqual([CELL.primaryConcept.stableId, CELL.responseFormat, CELL.difficultyBand, CELL.cellKey]);
    // and the adapted candidate goes through the same gates, with the same outcome as the one without
    const ctx = { stimuli: batch.stimuli, draftStage: true, hierarchyViolations: paaCellViolations };
    expect(validateCandidateStructure(c, CELL, ctx)).toMatchObject({ outcome: 'PASS', isHumanReview: false });
    const validated = validateQuestionCandidate({ candidate: c, cell: CELL, structuralContext: ctx, corpus: [] });
    const pkg = buildHumanReviewPackage({ validated, cell: CELL, stimuli: batch.stimuli, references: toReferencePackV1(paaGenerationReadyPack(CELL.primaryConcept.stableId, PILOT_V2_RUN.now)), rights: evaluateRightsGate({ provenance: 'STUDYUS_GENERATED', authorshipTermsReference: null, sourceUsages: [], originality: { outcome: validated.originality.outcome, acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [] }), ingested: false, qualifiedReviewerAvailable: false });
    expect(pkg).toMatchObject({ rights: { status: 'NOT_ESTABLISHABLE' }, reviewStatus: 'BLOCKED_NO_QUALIFIED_REVIEWER', attribution: { status: 'TARGET_AND_PROPOSAL__NOT_REVIEWED' } });
    expect((pkg.provenance.lineage as typeof lineage).adaptation!.adaptationSpecificationId).toBe(SPEC.specificationId);
  });

  it('a specification that is not intact, or not for the slot, is refused by name: the plan is never bent to it', async () => {
    const tampered = clone(SPEC);
    tampered.variable.difficulty.band = 'CHALLENGE';
    expect(() => renderGenerationPrompt(input(replay, { [SLOT.slotKey]: tampered }))).toThrow(GenerationError);
    expect(() => renderGenerationPrompt(input(replay, { [SLOT.slotKey]: tampered }))).toThrow(/ADAPTATION_SPECIFICATION_INVALID/);
    expect(() => renderGenerationPrompt(input(replay, { [SLOT.slotKey]: { not: 'a specification' } }))).toThrow(/ADAPTATION_SPECIFICATION_INVALID/);
    expect(() => renderGenerationPrompt(input(replay, { 'another-cell#1': SPEC }))).toThrow(/ADAPTATION_SPECIFICATION_NOT_FOR_THE_SLOT/);
    const cases: Array<[string, AdaptationResult]> = [
      ['PRIMARY_CONCEPT', runCertified(fam('tf.math.probability.single-event-equally-likely'), PAA_SYSTEM_PROFILE, { purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY' })],
      ['RESPONSE_FORMAT', runCertified(MISSING_VALUE, PAA_SYSTEM_PROFILE, { purpose: 'FULL_MOCK_1' })],
      ['DIFFICULTY_BAND', runCertified(MISSING_VALUE, PAA_SYSTEM_PROFILE, { purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY', difficultyBand: 'CHALLENGE' })],
      ['POOL', runCertified(MISSING_VALUE, PAA_SYSTEM_PROFILE, { purpose: 'PRACTICE', responseFormat: 'NUMERIC_ENTRY' })],
      ['LANGUAGE', runCertified(MISSING_VALUE, PAA_SYSTEM_PROFILE, { purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY', language: 'en' })],
      ['EXAM_FAMILY', runCertified(RATE_MODEL, PISA_SYSTEM_PROFILE, { purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY' })],
      ['REQUIREMENT_CELL', runCertified(MISSING_VALUE, PAA_SYSTEM_PROFILE, { purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY', requirementCellKey: 'another-cell' })],
    ];
    for (const [misfit, r] of cases) expect(() => renderGenerationPrompt(input(replay, { [SLOT.slotKey]: spec(r) })), misfit).toThrow(new RegExp(`ADAPTATION_SPECIFICATION_NOT_FOR_THE_SLOT: .*${misfit}`));
  });

  it('legacy and fixed content needs no task family anywhere, and a human-authored item MAY carry one without any generation field', () => {
    const legacy = PILOT_BATCH.candidates.find((c) => c.slotKey === SLOT.slotKey)!;
    expect(QuestionCandidateSchema.safeParse(legacy).success).toBe(true);
    // a human-written draft needs no lineage of a family ...
    const human = { ...clone(legacy), provenance: 'STUDYUS_AUTHORED', lineage: { kind: 'HUMAN', authorUserId: '00000000-0000-4000-8000-000000000001', writtenAt: PILOT_V2_RUN.now } };
    expect(QuestionCandidateSchema.safeParse(human).success).toBe(true);
    // ... and MAY carry one: authorship and task-family lineage are separate dimensions
    const fromFamilyAlone = { taskFamily: { id: 'tf.math.proportion.missing-value', version: MISSING_VALUE.version }, invariantHash: SPEC.invariantHash, adaptationSpecificationId: null, systemProfile: null, componentProfile: null, contentUseClass: 'EVIDENCE_BEARING' };
    const fromSpecification = { ...fromFamilyAlone, adaptationSpecificationId: SPEC.specificationId, systemProfile: { id: 'PAA', version: PAA_SYSTEM_PROFILE.version }, componentProfile: { id: 'PAA.MATEMATICAS', version: PAA_MATEMATICAS_COMPONENT.version } };
    for (const familyLineage of [fromFamilyAlone, fromSpecification]) {
      expect(AuthoredFamilyLineageSchema.safeParse(familyLineage).success).toBe(true);
      const authored = QuestionCandidateSchema.parse({ ...human, lineage: { ...human.lineage, familyLineage } });
      // it stays authored content: STUDYUS_AUTHORED, a HUMAN lineage, and it passes the same structural gate
      expect([authored.provenance, authored.lineage.kind]).toEqual(['STUDYUS_AUTHORED', 'HUMAN']);
      expect(validateCandidateStructure(authored, CELL, { stimuli: PILOT_BATCH.stimuli, draftStage: true, hierarchyViolations: paaCellViolations }).outcome).toBe('PASS');
    }
    // the authored carrier has NO generation field: no run, no prompt, no provider, no model
    expect(Object.keys(AuthoredFamilyLineageSchema.shape).sort()).toEqual(['adaptationSpecificationId', 'componentProfile', 'contentUseClass', 'invariantHash', 'systemProfile', 'taskFamily']);
    for (const generationField of [{ generationRunId: 'r' }, { promptHash: 'a'.repeat(64) }, { provider: 'x' }, { model: 'm' }]) expect(QuestionCandidateSchema.safeParse({ ...human, lineage: { ...human.lineage, familyLineage: { ...fromFamilyAlone, ...generationField } } }).success).toBe(false);
    // the GENERATED carrier is not accepted on a human lineage, and the authored one is not accepted on a model lineage
    const anAdaptation = { taskFamily: { id: 'tf.math.proportion.missing-value', version: '1' }, systemProfile: { id: 'PAA', version: '1' }, componentProfile: null, disciplinePolicy: { id: 'p', version: '1' }, adaptationSpecificationId: 'a'.repeat(64), invariantHash: 'b'.repeat(64), contentUseClass: 'DEV_TEST_CONTENT', generationRunId: 'r' };
    expect(AdaptationLineageSchema.safeParse(anAdaptation).success).toBe(true);
    expect(QuestionCandidateSchema.safeParse({ ...human, lineage: { ...human.lineage, adaptation: anAdaptation } }).success).toBe(false);
    expect(QuestionCandidateSchema.safeParse({ ...clone(legacy), lineage: { ...legacy.lineage, familyLineage: fromFamilyAlone } }).success).toBe(false);
    // on a model draft the generated carrier is accepted when whole and refused when partial
    expect(QuestionCandidateSchema.safeParse({ ...clone(legacy), lineage: { ...legacy.lineage, adaptation: anAdaptation } }).success).toBe(true);
    expect(QuestionCandidateSchema.safeParse({ ...clone(legacy), lineage: { ...legacy.lineage, adaptation: { taskFamily: anAdaptation.taskFamily } } }).success).toBe(false);
    // no backfill: no stored pilot candidate, human or model, carries either member
    for (const c of PILOT_BATCH.candidates) { expect(c.lineage).not.toHaveProperty('adaptation'); expect(c.lineage).not.toHaveProperty('familyLineage'); }
    // the earliest contract shape (no QB-R2C lineage at all) still parses
    expect(QuestionCandidateSchema.safeParse({ ...clone(legacy), lineage: { kind: 'MODEL', model: 'm', promptVersion: '1', runId: 'r', requestedBy: 'o', generatedAt: PILOT_V2_RUN.now, humanEdits: [] } }).success).toBe(true);
    const ctx = { stimuli: PILOT_BATCH.stimuli, draftStage: true, hierarchyViolations: paaCellViolations };
    expect(validateCandidateStructure(legacy, CELL, ctx).outcome).toBe('PASS');
    const validated = validateQuestionCandidate({ candidate: legacy, cell: CELL, structuralContext: ctx, corpus: [] });
    expect(buildHumanReviewPackage({ validated, cell: CELL, stimuli: PILOT_BATCH.stimuli, references: toReferencePackV1(paaGenerationReadyPack(CELL.primaryConcept.stableId, PILOT_V2_RUN.now)), rights: null, ingested: false, qualifiedReviewerAvailable: false }).reviewStatus).toBe('BLOCKED_NO_QUALIFIED_REVIEWER');
    // the lineage of an instance has an empty form: every identity of the independence carrier is null for legacy content
    expect(AdaptationLineageSchema.safeParse(undefined).success).toBe(false);
    expect(lineageGaps(legacy.lineage)).toEqual([]);
  });

  it('the cells are untouched: 789 cells, 865 items, the same pools, and adapting changes none of them', () => {
    const before = canonicalJson(CELLS);
    for (const c of CELLS.slice(0, 80)) for (const f of selectTaskFamilies(c, MATH_POC_FAMILIES).candidates) adaptForCell({ cell: c, family: reviewed(f), ...BRIDGE });
    expect(canonicalJson(CELLS)).toBe(before);
    expect(canonicalJson(resolvePaaRequirementCells())).toBe(before);
    expect([CELLS.length, CELLS.reduce((s, c) => s + c.count, 0)]).toEqual([789, PAA_PLANNED_ITEMS]);
    expect(Object.keys(CELLS[0]).sort()).toEqual(['assets', 'authority', 'binding', 'blueprint', 'cellKey', 'count', 'curriculumCurrentness', 'difficultyBand', 'difficultyBasis', 'domainNodeCode', 'examConfigKey', 'examFamily', 'examSkill', 'intendedPool', 'primaryConcept', 'responseFormat', 'responseFormatAuthority', 'sectionCode', 'stimulus', 'topicNodeCode', 'v']);
  });
});

describe('the 865 planned items as required evidence instances', () => {
  const CELLS = resolvePaaRequirementCells();
  const DEMAND = buildPaaEvidenceDemand();

  it('the stored estimate is exactly what the function produces, and it is labelled a planning estimate under a provisional assumption', () => {
    expect(serializePaaEvidenceDemand(DEMAND)).toBe(read(PAA_EVIDENCE_DEMAND_ARTIFACT));
    for (const s of DEMAND.scenarios) expect([s.kind, s.assumption.authority, s.assumption.status]).toEqual(['PLANNING_ESTIMATE', 'STUDYUS_POLICY', 'PROVISIONAL']);
    expect(DEMAND.scenarios[0].assumption).toMatchObject(EA1_DEFAULT_FAMILY_ASSUMPTION);
    expect(EA1_DEFAULT_FAMILY_ASSUMPTION).toEqual({ maxInstancesPerFamilyPerPool: 2, familyMayServeSeveralPools: true });
  });

  it('the demand is unchanged: 865 instances of 61 concepts in the six pools, 438 of them frozen', () => {
    for (const s of DEMAND.scenarios) {
      expect(s.totals).toMatchObject({ concepts: 61, requiredInstances: PAA_PLANNED_ITEMS, frozenInstances: 88 + 175 + 175, instancesByPool: PAA_POOL_TOTALS });
      expect(s.byConcept.map((c) => c.conceptStableId).sort()).toEqual(PAA_CONCEPT_IDENTITIES.map((c) => c.stableId).sort());
      for (const c of s.byConcept) expect(PAA_CONCEPT_IDENTITIES.find((x) => x.stableId === c.conceptStableId)).toMatchObject({ canonicalSubject: c.canonicalSubject, canonicalName: c.canonicalName });
    }
    expect(Object.fromEntries(Object.entries(DEMAND.scenarios[0].bySection).map(([k, v]) => [k, [v.concepts, v.requiredInstances]]))).toEqual({ 'paa.sec.ingles': [9, 188], 'paa.sec.lectura': [12, 197], 'paa.sec.matematicas': [35, 383], 'paa.sec.redaccion': [5, 97] });
    // order of the cells does not matter
    expect(canonicalJson(evidenceDemandByConcept([...CELLS].reverse()))).toBe(canonicalJson(evidenceDemandByConcept(CELLS)));
  });

  it('the family count follows from the assumption, and only from it', () => {
    expect(DEMAND.scenarios.map((s) => [s.assumption.maxInstancesPerFamilyPerPool, s.assumption.familyMayServeSeveralPools, s.totals.minimumFamilies, s.bySection['paa.sec.matematicas'].minimumFamilies])).toEqual([[2, true, 145, 70], [1, true, 241, 106], [2, false, 508, 237], [1, false, 865, 383]]);
    expect(minimumFamiliesFor({ PRACTICE: 3, FULL_MOCK_1: 2, FULL_MOCK_2: 2 }, { maxInstancesPerFamilyPerPool: 2, familyMayServeSeveralPools: true })).toBe(2);
    expect(minimumFamiliesFor({ PRACTICE: 3, FULL_MOCK_1: 2, FULL_MOCK_2: 2 }, { maxInstancesPerFamilyPerPool: 2, familyMayServeSeveralPools: false })).toBe(4);
    expect(minimumFamiliesFor({ PRACTICE: 3 }, { maxInstancesPerFamilyPerPool: 1, familyMayServeSeveralPools: true })).toBe(3);
    expect(() => minimumFamiliesFor({ PRACTICE: 3 }, { maxInstancesPerFamilyPerPool: 0, familyMayServeSeveralPools: true })).toThrow(/ASSUMPTION_INVALID/);
    // the five proof-of-concept concepts: 61 instances, two families each under the default assumption -- which is what the proof of concept drafted
    const poc = DEMAND.scenarios[0].byConcept.filter((c) => POC_CONCEPT_IDS.includes(c.conceptStableId));
    expect(poc.map((c) => [c.conceptStableId, c.requiredInstances, c.pools, c.minimumFamilies])).toEqual([['math.alg.quadratics', 12, 6, 2], ['math.fun.linear-functions-lines', 14, 6, 2], ['math.num.ratio-proportion', 12, 6, 2], ['math.prob.probability', 11, 6, 2], ['math.stat.data-representation', 12, 6, 2]]);
    // the three Mathematics-subject concepts of the PAA plan: 28 instances that sit under the other canonical subject
    expect(DEMAND.scenarios[0].byConcept.filter((c) => c.canonicalSubject === 'Mathematics').map((c) => [c.conceptStableId, c.requiredInstances])).toEqual([['math.alg.quadratics', 12], ['math.fun.exponential', 9], ['math.trig.ratios', 7]]);
  });
});

describe('architecture: ownership, purity and no runtime wiring', () => {
  const adaptationFiles = walk(ADAPTATION_DIR);
  const familyFiles = walk(FAMILIES_DIR);

  it('the two directories hold exactly these modules', () => {
    expect(adaptationFiles.map((f) => f.replace(`${ADAPTATION_DIR}/`, '')).sort()).toEqual(['adapt.ts', 'adaptation-specification.ts', 'assessment-applicability.ts', 'assessment-system-profile.ts', 'canonical-hash.ts', 'cell-bridge.ts', 'discipline-policy.ts', 'index.ts', 'instance-lineage.ts', 'item-demand-policy.ts', 'learning-approach-poc.ts', 'math-poc-applicability.ts', 'math-poc-matrix.ts', 'school-stem-performance.ts', 'system-profiles.ts']);
    expect(familyFiles.map((f) => f.replace(`${FAMILIES_DIR}/`, '')).sort()).toEqual(['family-demand.ts', 'index.ts', 'math-poc-families-ea1a.ts', 'math-poc-families.ts', 'math-problem.ts', 'task-family.ts']);
  });

  it('both are pure: no database, query, environment, network, file system, clock or randomness', () => {
    for (const f of [...adaptationFiles, ...familyFiles]) {
      const src = code(f);
      expect(src, f).not.toMatch(/from '@\/lib\/db'|\bquery\(|INSERT INTO|UPDATE \w+ SET|DELETE FROM|process\.env|fetch\(|from '(node:)?fs'|from 'pg'|@\/lib\/ai\/|\bDate\.now\(|new Date\(|Math\.random\(|https?:\/\/|\.service'/);
      expect(src, f).not.toMatch(/anthropic|openai|kognity/i);
    }
  });

  it('dependency direction: task families import nothing of the engine or the Production OS; the engine imports no Production OS, no B2, no service', () => {
    const imports = (f: string) => [...read(f).matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const f of familyFiles) expect(imports(f).filter((i) => i !== 'zod' && !i.startsWith('./')), f).toEqual([]);
    // EA-1A: the engine also reads the learning-approach contract (a directory that itself imports nothing but zod)
    const allowed = /^(zod|crypto|\.\/[a-z-]+|@\/lib\/exam-core\/taxonomy|@\/lib\/learning-approach\/(learning-approach-profile|institution-configuration)|@\/lib\/exam-core\/question-bank\/task-families(\/(task-family|math-problem|math-poc-families|math-poc-families-ea1a))?)$/;
    for (const f of adaptationFiles) for (const i of imports(f)) expect(i, `${f} imports ${i}`).toMatch(allowed);
    // B2 does not own adaptation, and adaptation does not reach into B2
    for (const f of [...adaptationFiles, ...familyFiles]) expect(code(f), f).not.toMatch(/assessment-blueprint/);
    expect(walk('src/lib/assessment-blueprint').filter((f) => /assessment-adaptation|task-families|AdaptationSpecification|TaskFamily/.test(read(f)))).toEqual([]);
    // B1 does not know it either
    expect(walk('src/lib/assessment-foundation').filter((f) => /assessment-adaptation|task-families/.test(read(f)))).toEqual([]);
  });

  it('no runtime wiring: nothing under src imports the new modules except the two additive Production OS contracts; no route, no service, no table', () => {
    // QF V5.1: `src/lib/assessment-instance` is the composition layer over these modules (construct core -> adapter ->
    // instance). It is the one consumer added; it is pure except its repository, and it is wired to no route or service.
    const INSTANCE_DIR = 'src/lib/assessment-instance';
    // Track B: the governed Exam Bank publication (src/lib/exam-bank) is the one consumer -- a loader, not a Student runtime
    // + the scoring-preserving projection 3; + the CF package dry run and the re-projection compatibility assessment (pure
    //   readers of certified artefacts); + the canonical response contract, which NAMES the QF evaluator in its documentation
    //   and imports nothing from it
    expect(walk('src').filter((f) => !f.startsWith(INSTANCE_DIR) && /assessment-instance/.test(read(f))).sort()).toEqual(['src/lib/assessment-scoring/canonical-response.ts', 'src/lib/exam-bank/bank-projection.ts', 'src/lib/exam-bank/cf-package-validation.ts', 'src/lib/exam-bank/cf-r1-convergence.ts', 'src/lib/exam-bank/ib-reprojection-compatibility.ts', 'src/lib/exam-bank/publication-plan.ts', 'src/lib/exam-bank/publication.service.ts', 'src/lib/exam-bank/scoring-projection.ts']);
    const importers = walk('src').filter((f) => !f.startsWith(ADAPTATION_DIR) && !f.startsWith(FAMILIES_DIR) && !f.startsWith(INSTANCE_DIR) && /assessment-adaptation|question-bank\/task-families/.test(read(f))).sort();
    // QB-R2D adds three Production OS modules of the specification-driven path. Same direction (production -> adaptation), still pure, still no route, service or table.
    expect(importers).toEqual([
      // the IB pilot applicability register (pure data in the EA-1 register's own record type; no route, service or table)
      'src/lib/curriculum/ib/ib-aa-hl-concept-correspondence.ts',
      // Exam Bank hardening: the CF package dry run resolves concept applicability with the EA-1 register (pure, no IO)
      'src/lib/exam-bank/cf-package-validation.ts',
      // Track B: the Exam Bank publication plan hashes with the same canonical hash (pure; no route, service or table of its own)
      'src/lib/exam-bank/publication-plan.ts',
      // Exam Bank hardening: the scoring-preserving projection 3 digests the mark scheme / rubric / policy with that same canonical hash (pure, not wired)
      'src/lib/exam-bank/scoring-projection.ts',
      'src/lib/exam-core/question-bank/production/generation-contract.ts', 'src/lib/exam-core/question-bank/production/generator/generate-candidates.ts',
      'src/lib/exam-core/question-bank/production/generator/specification-generation-v2.ts', 'src/lib/exam-core/question-bank/production/generator/specification-generation-v3.ts', 'src/lib/exam-core/question-bank/production/generator/specification-generation-v4.ts', 'src/lib/exam-core/question-bank/production/generator/specification-generation.ts', 'src/lib/exam-core/question-bank/production/specification-candidate.ts',
      // QB-R2F adds generator version 3 and validators revision 4 (both read the item demand policy); same direction, still pure
      'src/lib/exam-core/question-bank/production/specification-validators-r3.ts', 'src/lib/exam-core/question-bank/production/specification-validators-r4.ts', 'src/lib/exam-core/question-bank/production/specification-validators.ts',
    ]);
    expect(walk('src/app').filter((f) => /assessment-adaptation|task-families|AdaptationSpecification/.test(read(f)))).toEqual([]);
    expect(walk('src/services').filter((f) => /assessment-adaptation|task-families|AdaptationSpecification/.test(read(f)))).toEqual([]);
    // no migration names anything of this phase: the persistence is a design
    const migrations = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    const NEW_SCHEMA = /question_bank_task_famil|task_family_version|adaptation_specification|item_adaptation|assessment_system_profile|assessment_discipline_polic/i;
    // QF V5.1 realises that design in ONE additive migration (construct cores = persisted task families, instance lineage with the specification id). No other file names it.
    expect(migrations.filter((f) => NEW_SCHEMA.test(f) || NEW_SCHEMA.test(read(`database/migrations/${f}`)))).toEqual(['20261121_1100_qf51_construct_core_lineage.sql']);
    // 82 files up to QB-R1C, plus the three of the L10 shared-foundation batch (20261120_*), which name nothing of this phase (asserted above).
    // 85 + the Student's scheduled assessments (20261121_1000) + QF V5.1 (20261121_1100) + curriculum convergence (20261122_1000, _1100).
    expect([migrations.length, migrations[migrations.length - 1]]).toEqual([94, '20261124_1200_exam_bank_pilot_certification_scope.sql']); // + QF V5.2 (20261122_1200), the Exam Bank certification model
  });

  it('B3 is not implemented here: no evidence engine, no evidence path, no second evidence writer', () => {
    const lib = readdirSync(join(ROOT, 'src/lib'));
    expect(lib.filter((d) => /evidence-engine|assessment-evidence|evidence-attribution-engine|^b3/i.test(d))).toEqual([]);
    expect(walk('src').filter((f) => /\bupdateMastery\(/.test(code(f)) && /assessment-adaptation|task-families/.test(f))).toEqual([]);
    expect(lib).toContain('assessment-adaptation');
  });

  it('AssessmentTaskFamily and TransferTaskFamily are two concepts: neither imports the other, and they are not merged', () => {
    // the explicit name exists and is the same type as the contract's
    const named: AssessmentTaskFamily = MISSING_VALUE satisfies TaskFamily;
    expect(named.familyId).toBe('tf.math.proportion.missing-value');
    expect(read(`${FAMILIES_DIR}/task-family.ts`)).toMatch(/export type AssessmentTaskFamily<S = unknown> = TaskFamily<S>;/);
    for (const doc of [`${FAMILIES_DIR}/task-family.ts`, `${ADAPTATION_DIR}/instance-lineage.ts`]) expect(read(doc), doc).toMatch(/TRANSFER task family|TransferTaskFamily/);
    // it exists, it is persisted as `transfer_task_instances.task_family_id`, and it already backs one independence rule (ROBUST transfer)
    expect(read('database/migrations/20260908_1000_phase7_transfer_task_instances.sql')).toMatch(/task_family_id TEXT NOT NULL/);
    expect(read('src/lib/transfer-task-identity.ts')).toMatch(/export function computeTransferTaskFamilyId\(/);
    // EA-1 neither imports it nor reuses its identity, and the transfer engine does not import EA-1
    for (const f of [...adaptationFiles, ...familyFiles]) expect(code(f), f).not.toMatch(/transfer-task-identity|transfer-policy|computeTransferTaskFamilyId|transfer_task_instances/);
    // the transfer code is untouched by this phase: it knows nothing of assessment families, profiles or specifications
    for (const f of walk('src').filter((x) => /transfer/i.test(x))) expect(read(f), f).not.toMatch(/assessment-adaptation|question-bank\/task-families|AssessmentTaskFamily|AdaptationSpecification/);
    for (const f of ['src/lib/transfer-task-identity.ts', 'src/lib/transfer-policy.ts', 'src/services/transfer-task-instance.service.ts']) expect(read(f), f).not.toMatch(/assessment-adaptation|question-bank\/task-families/);
    // an authored family id can never be mistaken for a transfer family hash
    for (const f of MATH_POC_FAMILIES) expect(f.familyId).toMatch(/^tf\./);
  });

  it('the existing `assessment-profiles.ts` (Phase 3B activity verification settings) is another thing: untouched, not imported, not shadowed', () => {
    const existing = read('src/lib/assessment-profiles.ts');
    expect(existing).toMatch(/export interface AssessmentProfile \{\s*activityType: 'CUMULATIVE_ASSESSMENT' \| 'MOCK_EXAM';/);
    expect(walk('src').filter((f) => /from '[^']*\/assessment-profiles'/.test(read(f))).sort()).toEqual(['src/services/assessment-verification.service.ts']);
    for (const f of [...adaptationFiles, ...familyFiles]) {
      expect(read(f), f).not.toMatch(/from '[^']*assessment-profiles'/);
      // the new concept never exports a symbol called AssessmentProfile or ASSESSMENT_PROFILES
      expect(code(f), f).not.toMatch(/export (?:type|interface|const|function) (?:AssessmentProfile|ASSESSMENT_PROFILES|getAssessmentProfile)\b/);
    }
  });
});
