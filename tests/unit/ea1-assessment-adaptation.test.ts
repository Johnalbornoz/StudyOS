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
import { AssessmentSystemProfileSchema, authorityBreakdown, PROFILE_RULE_DIMENSIONS, RuleAuthoritySchema, validateAssessmentSystemProfile, type AssessmentSystemProfile, type ProfileRules } from '@/lib/assessment-adaptation/assessment-system-profile';
import { canonicalJson, sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { adaptForCell, evidenceTargetOfCell, selectTaskFamilies } from '@/lib/assessment-adaptation/cell-bridge';
import { DisciplineAdaptationPolicySchema, INVARIANT_DIMENSIONS, MATHEMATICS_ADAPTATION_POLICY, VARIABLE_DIMENSIONS } from '@/lib/assessment-adaptation/discipline-policy';
import { ADAPTATION_EVIDENCE_FACETS, ADAPTATION_POOLS, AdaptationLineageSchema, INSTANCE_PURPOSES, instanceClassSatisfies, minimumInstanceClassFor, NOT_ESTABLISHED_BY_ADAPTATION, PROMOTION_PATH } from '@/lib/assessment-adaptation/instance-lineage';
import { buildMathAdaptationMatrix, buildMathPocSpecifications, COMPARED_DIMENSIONS, differingDimensions, MATH_POC_MATRIX_ARTIFACT, MINIMUM_PAIRWISE_DIFFERENCE, serializeMathAdaptationMatrix } from '@/lib/assessment-adaptation/math-poc-matrix';
import { EA1_SYSTEM_PROFILES, IB_SYSTEM_PROFILE, PAA_SYSTEM_PROFILE, PISA_SYSTEM_PROFILE, systemProfileOf, systemProfileOfExamFamily } from '@/lib/assessment-adaptation/system-profiles';
import { LOGICAL_POOLS } from '@/lib/assessment-blueprint/protected/pools';
import { PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { AICE_SYLLABI } from '@/lib/exam-core/aice/aice-syllabi.generated';
import { allLearningLinks } from '@/lib/exam-core/catalog/objective-learning-links';
import { ASSESSMENT_SOURCES } from '@/lib/exam-core/catalog/sources';
import { ComponentDefinitionSchema } from '@/lib/exam-core/component-definition';
import { DEFAULT_TASK_FAMILY_REGISTRY, EA1_DEFAULT_FAMILY_ASSUMPTION, evidenceDemandByConcept, KNOWN_FAMILY_TYPES, MATH_POC_FAMILIES, MATH_POC_KNOWLEDGE_LINKS, MATH_POC_PROFILE_IDS, MATH_PROBLEM_SPECIALIZATION, mathPocFamilyOf, minimumFamiliesFor, parameterizationViolations, TaskFamilyCommonSchema, type MathTaskFamily, type TaskFamilySpecialization } from '@/lib/exam-core/question-bank/task-families';
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
const REQUEST: AdaptationRequest = { purpose: 'PRACTICE', difficultyBand: 'STANDARD', language: 'es' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const fam = (id: string): MathTaskFamily => mathPocFamilyOf(id)!;
const MISSING_VALUE = fam('tf.math.proportion.missing-value');
const RATE_MODEL = fam('tf.math.proportion.rate-comparison-model');
const LINEAR_MODEL = fam('tf.math.linear.constant-rate-model');
const FACTORISING = fam('tf.math.quadratic.solve-by-factorising');
const DATASET = fam('tf.math.data.rate-of-change-from-realistic-dataset');
const run = (family: unknown, profile: unknown, request: unknown = REQUEST, policy: unknown = POLICY): AdaptationResult => adapt({ family, profile, disciplinePolicy: policy, request });
const spec = (r: AdaptationResult): AdaptationSpecification => { if (!r.ok) throw new Error(`refused: ${r.refusal.code} ${r.refusal.detail}`); return r.specification; };
const refusal = (r: AdaptationResult): string => (r.ok ? 'NOT_REFUSED' : r.refusal.code);
const MATRIX = buildMathAdaptationMatrix();
const { specifications: SPECS } = buildMathPocSpecifications();

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
    expect(new Set([...SPECS.values()].filter((s) => s.primaryConcept.stableId === 'math.alg.quadratics').map((s) => s.assessmentProfile.profileId)).size).toBe(4);
    expect(new Set([...SPECS.values()].filter((s) => s.primaryConcept.stableId === 'math.alg.quadratics').map((s) => canonicalJson(s.primaryConcept))).size).toBe(1);
  });

  it('a family carries its concept\'s own canonical subject: Matemáticas and Mathematics are never merged, aliased or inferred', () => {
    expect([...new Set(MATH_POC_FAMILIES.map((f) => f.canonicalSubject))].sort()).toEqual(['Matemáticas', 'Mathematics']);
    expect(MATH_POC_FAMILIES.filter((f) => f.canonicalSubject === 'Mathematics').map((f) => f.primaryConcepts[0].stableId)).toEqual(['math.alg.quadratics', 'math.alg.quadratics']);
    // a concept of another subject cannot sit in a family, whatever its name
    const mixed = { ...clone(MISSING_VALUE), canonicalSubject: 'Mathematics' };
    expect(TaskFamilyCommonSchema.safeParse(mixed).error?.issues.map((i) => i.message)).toContain('CONCEPT_IS_OF_ANOTHER_CANONICAL_SUBJECT');
    for (const d of [FAMILIES_DIR, ADAPTATION_DIR]) for (const f of walk(d)) expect(code(f), f).not.toMatch(/Matemáticas'\s*[=!]==?\s*'Mathematics|SUBJECT_ALIAS|subjectAlias|equivalentSubject|toLowerCase\(\)\.startsWith\('mat/i);
  });

  it('canonical-knowledge availability is a fact read from the repository, separate from behaviour support, and never inferred across subjects', () => {
    const links = allLearningLinks();
    const prefixOf: Record<string, RegExp> = { PISA: /^pisa\./, IB: /^(aahl|aasl|ai)\./, CAMBRIDGE: /^aice\./, ICFES: /^saber\./ };
    for (const f of MATH_POC_FAMILIES) {
      const c = f.primaryConcepts[0];
      expect(f.canonicalKnowledgeAvailability.PAA.status).toBe('CERTIFIED_FOR_THIS_EXAM_FAMILY');
      for (const p of ['IB', 'CAMBRIDGE', 'PISA', 'ICFES'] as const) {
        // every reviewed objective link of that exam family that names this exact (subject, name)
        const recorded = Object.entries(links).filter(([objective, link]) => prefixOf[p].test(objective) && (link.concepts ?? []).some((x) => x.subject === c.canonicalSubject && x.name === c.canonicalName)).map(([objective]) => objective).sort();
        expect([...(MATH_POC_KNOWLEDGE_LINKS[c.stableId][p] ?? [])].sort(), `${c.stableId} / ${p}`).toEqual(recorded);
        expect(f.canonicalKnowledgeAvailability[p].status, `${f.familyId} / ${p}`).toBe(recorded.length > 0 ? 'CATALOGUE_LINK_RECORDED' : 'NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY');
      }
    }
    // the tension, stated: a Matemáticas concept fits IB behaviour and is NOT certified there; nothing bridges the two
    const s = spec(run(LINEAR_MODEL, IB_SYSTEM_PROFILE));
    expect([s.primaryConcept.canonicalSubject, s.canonicalKnowledgeAvailability.status]).toEqual(['Matemáticas', 'NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY']);
    expect(refusal(run(LINEAR_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, knowledgeRequirement: 'CATALOGUE_LINK_OR_CERTIFIED' }))).toBe('CANONICAL_KNOWLEDGE_NOT_CERTIFIED_FOR_EXAM_FAMILY');
    // quadratics (Mathematics) is linked for IB in the catalogue, which is weaker than certified and is told apart
    expect(spec(run(FACTORISING, IB_SYSTEM_PROFILE, { ...REQUEST, knowledgeRequirement: 'CATALOGUE_LINK_OR_CERTIFIED' })).canonicalKnowledgeAvailability.status).toBe('CATALOGUE_LINK_RECORDED');
    expect(refusal(run(FACTORISING, IB_SYSTEM_PROFILE, { ...REQUEST, knowledgeRequirement: 'CERTIFIED' }))).toBe('CANONICAL_KNOWLEDGE_NOT_CERTIFIED_FOR_EXAM_FAMILY');
    // a system the family says nothing about is not certified, and not supported
    const silent = clone(MISSING_VALUE) as MathTaskFamily;
    delete (silent.canonicalKnowledgeAvailability as Record<string, unknown>).ICFES;
    expect(spec(run(silent, systemProfileOf('ICFES'))).canonicalKnowledgeAvailability.status).toBe('NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY');
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
    expect(Object.keys(KNOWN_FAMILY_TYPES).sort()).toEqual(['CASE_ANALYSIS', 'LANGUAGE_USE', 'MATH_PROBLEM', 'READING_ANALYSIS', 'SCIENCE_INVESTIGATION', 'SCIENCE_PROBLEM', 'SOURCE_ANALYSIS', 'WRITING_EDITING']);
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

describe('assessment-system profile: behaviour and constraints, with an authority on every rule', () => {
  it('five profiles (PAA, IB, CAMBRIDGE, PISA, ICFES), each valid, illustrative and linked to an exam family of the taxonomy; no SEP', () => {
    expect(EA1_SYSTEM_PROFILES.map((p) => p.profileId)).toEqual([...MATH_POC_PROFILE_IDS]);
    for (const p of EA1_SYSTEM_PROFILES) {
      const v = validateAssessmentSystemProfile(p);
      expect(v.ok, `${p.profileId}: ${v.ok ? '' : v.issues.join('; ')}`).toBe(true);
      expect([p.status, p.certification]).toEqual(['PROVISIONAL_ILLUSTRATIVE', null]);
      expect(EXAM_FAMILIES as readonly string[]).toContain(p.examFamilyCode);
      expect(systemProfileOfExamFamily(p.examFamilyCode!)).toBe(p);
    }
    expect(systemProfileOf('SEP')).toBeNull();
    // AICE is a family of the taxonomy with no profile of its own: it is not silently resolved to Cambridge
    expect(systemProfileOfExamFamily('AICE')).toBeNull();
  });

  it('an OFFICIAL rule without source lineage is refused; a policy rule must say it is provisional', () => {
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL' }).success).toBe(false);
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL', sources: [] }).success).toBe(false);
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL', sources: [{ sourceKey: 'cb-paa-guia-2021' }] }).success).toBe(false);
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL', sources: [{ sourceKey: 'cb-paa-guia-2021', locator: 'v2.paa > sections[matematicas]' }] }).success).toBe(true);
    expect(RuleAuthoritySchema.safeParse({ kind: 'STUDYUS_POLICY', assumption: 'A working assumption of StudyUs.' }).success).toBe(false);
    expect(RuleAuthoritySchema.safeParse({ kind: 'STUDYUS_POLICY', provisional: true, assumption: 'A working assumption of StudyUs.', sources: [] }).success).toBe(false);
    const p = clone(PAA_SYSTEM_PROFILE) as AssessmentSystemProfile;
    // promoting a policy rule to OFFICIAL by relabelling it does not parse ...
    (p.rules.rubricStyle as { authority: unknown }).authority = { kind: 'OFFICIAL' };
    expect(AssessmentSystemProfileSchema.safeParse(p).success).toBe(false);
    // ... and citing a source the profile's own specification records do not hold is refused too
    (p.rules.rubricStyle as { authority: unknown }).authority = { kind: 'OFFICIAL', sources: [{ sourceKey: 'ibo-math-aa-guide-2021', locator: 'somewhere' }] };
    expect(AssessmentSystemProfileSchema.safeParse(p).error?.issues.map((i) => i.message)).toContain('SOURCE_NOT_IN_THE_PROFILES_SPECIFICATION_RECORDS');
    // a system with no sourced definition may hold no OFFICIAL rule at all
    const none = clone(PISA_SYSTEM_PROFILE) as AssessmentSystemProfile;
    none.specification = { basis: 'NO_CERTIFIED_SPECIFICATION', records: [], note: 'No sourced definition in the repository.' };
    expect(AssessmentSystemProfileSchema.safeParse(none).error?.issues.map((i) => i.message)).toContain('NO_CERTIFIED_SPECIFICATION_HOLDS_NO_OFFICIAL_RULE');
    for (const d of PROFILE_RULE_DIMENSIONS) (none.rules[d] as { authority: unknown }).authority = { kind: 'STUDYUS_POLICY', provisional: true, assumption: 'Entirely provisional working assumption.' };
    expect(AssessmentSystemProfileSchema.safeParse(none).success).toBe(true);
    // a certified profile needs a certification, which no profile here has
    expect(AssessmentSystemProfileSchema.safeParse({ ...clone(PAA_SYSTEM_PROFILE), status: 'CERTIFIED' }).success).toBe(false);
  });

  it('every OFFICIAL rule cites sources of the registry, and its value IS what the repository records at the cited place', () => {
    const registry = new Set(ASSESSMENT_SOURCES.map((s) => s.key));
    for (const p of EA1_SYSTEM_PROFILES) for (const d of authorityBreakdown(p).official) {
      const a = p.rules[d].authority;
      if (a.kind === 'OFFICIAL') for (const s of a.sources) expect(registry.has(s.sourceKey), `${p.profileId}.${d}: ${s.sourceKey}`).toBe(true);
    }
    const def = (cfg: { sections: Array<{ key: string; definition?: unknown }> }, key: string) => cfg.sections.find((s) => s.key === key)!.definition as { responseFormats: string[]; calculatorPolicy: string | null; officialDurationMinutes: number | null; maxMarks: number | null; officialItemCount?: number | null; commandTerms?: string[]; sourceKeys: string[]; distributions?: Array<{ dimension: string; values: Record<string, string> }>; blueprintSpecification?: { status: string } };
    const value = <K extends keyof ProfileRules>(id: string, d: K): ProfileRules[K]['value'] => systemProfileOf(id)!.rules[d].value;
    const sourcesOf = (id: string, d: (typeof PROFILE_RULE_DIMENSIONS)[number]) => { const a = systemProfileOf(id)!.rules[d].authority; return a.kind === 'OFFICIAL' ? a.sources.map((s) => s.sourceKey) : []; };
    const official = (id: string) => authorityBreakdown(systemProfileOf(id)!).official;

    const paa = def(PAA_V2 as never, 'matematicas');
    expect(official('PAA')).toEqual(['responseFormats', 'timePressure', 'calculatorPolicy']);
    expect(value('PAA', 'responseFormats')).toEqual(paa.responseFormats);
    expect(value('PAA', 'timePressure')).toEqual({ officialMinutes: paa.officialDurationMinutes, officialItems: paa.officialItemCount, officialMarks: paa.maxMarks });
    expect(value('PAA', 'calculatorPolicy')).toEqual({ allowed: [paa.calculatorPolicy] });
    expect(sourcesOf('PAA', 'calculatorPolicy')).toEqual(paa.sourceKeys);
    expect((PAA_V2 as { commandTerms?: unknown[] }).commandTerms).toEqual([]);

    const p1 = def(IB_MATH_AA_HL_V2 as never, 'p1');
    const p2 = def(IB_MATH_AA_HL_V2 as never, 'p2');
    expect(official('IB')).toEqual(['responseFormats', 'timePressure', 'commandTerms', 'calculatorPolicy']);
    expect(value('IB', 'responseFormats')).toEqual(p1.responseFormats);
    expect(value('IB', 'timePressure')).toEqual({ officialMinutes: p1.officialDurationMinutes, officialItems: null, officialMarks: p1.maxMarks });
    expect(value('IB', 'commandTerms')).toEqual({ use: 'CONTROLLED_VOCABULARY', terms: p1.commandTerms });
    expect(value('IB', 'calculatorPolicy')).toEqual({ allowed: [p1.calculatorPolicy, p2.calculatorPolicy] });
    expect(sourcesOf('IB', 'commandTerms')).toEqual(p1.sourceKeys);

    const s9709 = AICE_SYLLABI.find((s) => s.code === '9709')!;
    const c1 = s9709.components.find((c) => c.key === 'p1')!;
    expect(official('CAMBRIDGE')).toEqual(['timePressure', 'calculatorPolicy', 'competencyEmphasis']);
    expect(value('CAMBRIDGE', 'timePressure')).toEqual({ officialMinutes: c1.minutes, officialItems: null, officialMarks: c1.marks });
    expect(c1.calculator).toMatch(/^Scientific calculator required/);
    expect(value('CAMBRIDGE', 'calculatorPolicy')).toEqual({ allowed: ['SCIENTIFIC_REQUIRED'] });
    expect(value('CAMBRIDGE', 'competencyEmphasis')).toEqual(s9709.assessmentObjectives.map((a) => ({ code: a.key, label: a.name, weightPercent: `${a.weightAS} (AS)` })));
    expect(sourcesOf('CAMBRIDGE', 'calculatorPolicy')).toEqual([s9709.sourceKey]);
    // the command terms the Cambridge profile ASSUMES are the ones the repository records for another syllabus: policy, not official
    expect(value('CAMBRIDGE', 'commandTerms').terms).toEqual(def(CAMBRIDGE_0580_EXTENDED_V2 as never, 'p2').commandTerms);
    expect(systemProfileOf('CAMBRIDGE')!.rules.commandTerms.authority.kind).toBe('STUDYUS_POLICY');

    const pisa = def(PISA_MATH_V2 as never, 'math');
    const dist = (d: typeof pisa, dimension: string) => d.distributions!.find((x) => x.dimension === dimension)!.values;
    expect(official('PISA')).toEqual(['responseFormats', 'timePressure', 'contextExpectations', 'calculatorPolicy', 'competencyEmphasis']);
    expect(value('PISA', 'responseFormats')).toEqual(pisa.responseFormats);
    expect(value('PISA', 'timePressure')).toEqual({ officialMinutes: pisa.officialDurationMinutes, officialItems: null, officialMarks: pisa.maxMarks });
    expect(value('PISA', 'calculatorPolicy')).toEqual({ allowed: [pisa.calculatorPolicy] });
    expect(value('PISA', 'contextExpectations').allowed).toEqual(Object.keys(dist(pisa, 'Context')).map((k) => k.toUpperCase()));
    expect(value('PISA', 'competencyEmphasis').map((c) => [c.label, c.weightPercent])).toEqual(Object.entries(dist(pisa, 'Process')));
    expect(sourcesOf('PISA', 'responseFormats')).toEqual(pisa.sourceKeys);

    const saber = def(SABER11_MATH_V2 as never, 'math');
    expect(official('ICFES')).toEqual(['responseFormats', 'timePressure', 'calculatorPolicy', 'competencyEmphasis']);
    expect(value('ICFES', 'responseFormats')).toEqual(saber.responseFormats);
    expect(value('ICFES', 'timePressure')).toEqual({ officialMinutes: saber.officialDurationMinutes, officialItems: saber.officialItemCount, officialMarks: saber.maxMarks });
    expect(value('ICFES', 'calculatorPolicy')).toEqual({ allowed: [saber.calculatorPolicy] });
    expect(value('ICFES', 'competencyEmphasis').map((c) => [c.label, c.weightPercent])).toEqual(Object.entries(dist(saber, 'Competencia')));
    expect(value('ICFES', 'blueprintConstraints').fullFormSpecification).toBe(saber.blueprintSpecification!.status);
    expect(sourcesOf('ICFES', 'calculatorPolicy')).toEqual(saber.sourceKeys);
    // only the Saber definition documents a full form; the others say UNKNOWN or not applicable, never a guess
    expect(EA1_SYSTEM_PROFILES.map((p) => p.rules.blueprintConstraints.value.fullFormSpecification)).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'NOT_APPLICABLE_NO_FIXED_FORM', 'DOCUMENTED']);
  });

  it('a profile has no field that can carry or change canonical knowledge', () => {
    const certified = PAA_CONCEPT_IDENTITIES.flatMap((c) => [c.stableId, c.canonicalName]);
    for (const p of EA1_SYSTEM_PROFILES) {
      const text = JSON.stringify(p);
      for (const c of certified) expect(text.includes(`"${c}"`), `${p.profileId}: ${c}`).toBe(false);
      const keys: string[] = [];
      JSON.stringify(p, (k, v) => { if (k) keys.push(k); return v; });
      expect(keys.filter((k) => /concept|definition|masteryStatement|curriculum|topic|learningObjective|canonical/i.test(k))).toEqual([]);
    }
    expect(Object.keys(AssessmentSystemProfileSchema.shape).sort()).toEqual(['certification', 'displayName', 'examFamilyCode', 'profileId', 'rules', 'specification', 'status', 'v', 'version']);
    expect([...PROFILE_RULE_DIMENSIONS].sort()).toEqual(['authenticityRequirements', 'blueprintConstraints', 'calculatorPolicy', 'commandTerms', 'competencyElicitation', 'competencyEmphasis', 'contextExpectations', 'markStructure', 'reasoningDepth', 'responseFormats', 'responseLength', 'rubricStyle', 'stimulusExpectations', 'timePressure', 'transferExpectations']);
    // the schema is strict: a concept cannot be smuggled in at any level
    expect(AssessmentSystemProfileSchema.safeParse({ ...clone(PAA_SYSTEM_PROFILE), concepts: ['math.alg.quadratics'] }).success).toBe(false);
    const r = clone(PAA_SYSTEM_PROFILE) as AssessmentSystemProfile;
    (r.rules as Record<string, unknown>).conceptDefinitions = { ruleId: 'x', value: 'y', authority: { kind: 'STUDYUS_POLICY', provisional: true, assumption: 'An attempt to add knowledge.' } };
    expect(AssessmentSystemProfileSchema.safeParse(r).success).toBe(false);
    // and it holds no discipline rule: nothing of the mathematics policy's vocabulary appears in a profile
    for (const p of EA1_SYSTEM_PROFILES) expect(Object.keys(p.rules).filter((k) => /numeric|parameter|misconception|toolInteraction|formatPreference/i.test(k))).toEqual([]);
  });

  it('adapting changes neither the family nor the profile nor the policy, and never the family\'s PRIMARY concept ids', () => {
    for (const f of MATH_POC_FAMILIES) for (const p of EA1_SYSTEM_PROFILES) {
      const before = [canonicalJson(f), canonicalJson(p), canonicalJson(POLICY)];
      const r = run(f, p);
      expect([canonicalJson(f), canonicalJson(p), canonicalJson(POLICY)]).toEqual(before);
      if (r.ok) {
        expect(r.specification.invariants.primaryConceptStableIds).toEqual(f.primaryConcepts.map((c) => c.stableId).sort());
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
    expect(spec(run(RATE_MODEL, IB_SYSTEM_PROFILE, { ...REQUEST, calculatorPolicy: 'GDC_REQUIRED' })).variable.numericProfile).toBe('REALISTIC_VALUES');
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
    const stamped = spec(adapt({ family: RATE_MODEL, profile: PISA_SYSTEM_PROFILE, disciplinePolicy: POLICY, request: REQUEST, adaptedAt: '2026-10-11T12:00:00Z' }));
    expect([stamped.specificationId, stamped.adaptedAt, a.adaptedAt]).toEqual([a.specificationId, '2026-10-11T12:00:00Z', null]);
    expect(a.specificationId).toMatch(/^[0-9a-f]{64}$/);
    expect(specificationIdOf(a)).toBe(a.specificationId);
    expect(AdaptationSpecificationSchema.safeParse(a).success).toBe(true);
    expect(specificationIntegrityIssues(a)).toEqual([]);
    // every request, family version, profile version or policy version that differs gives another id
    const ids = new Set([a.specificationId, spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE, { ...REQUEST, difficultyBand: 'CHALLENGE' })).specificationId, spec(run({ ...clone(RATE_MODEL), version: '0.2.0' }, PISA_SYSTEM_PROFILE)).specificationId, spec(run(RATE_MODEL, { ...clone(PISA_SYSTEM_PROFILE), version: '0.2.0' })).specificationId, spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE, REQUEST, { ...clone(POLICY), version: '0.2.0' })).specificationId]);
    expect(ids.size).toBe(5);
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

  it('records where every variable dimension came from: profile rule with its authority, policy rule, family field or request', () => {
    const s = spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE));
    expect(Object.keys(s.provenance).sort()).toEqual([...VARIABLE_DIMENSIONS].sort());
    expect(s.provenance.toolPolicy).toEqual([{ origin: 'PROFILE_RULE', ref: 'pisa.calculator', authority: 'OFFICIAL' }, { origin: 'FAMILY', ref: 'specialization.toolDependency', authority: null }]);
    expect(s.provenance.numericProfile[0]).toEqual({ origin: 'POLICY_RULE', ref: 'studyus.adaptation.mathematics@0.1.0-provisional#toolInteraction.ALLOWED', authority: 'STUDYUS_POLICY' });
    expect(s.provenance.context.map((p) => `${p.origin}:${p.ref}:${p.authority}`)).toEqual(['PROFILE_RULE:pisa.contexts:OFFICIAL', 'FAMILY:supportedContexts:null', 'PROFILE_RULE:pisa.authenticity:STUDYUS_POLICY', 'PROFILE_RULE:pisa.transfer:STUDYUS_POLICY', 'POLICY_RULE:studyus.adaptation.mathematics@0.1.0-provisional#transfer:STUDYUS_POLICY']);
    expect(s.provenance.difficulty).toEqual([{ origin: 'REQUEST', ref: 'difficultyBand', authority: null }]);
    expect(spec(run(RATE_MODEL, PISA_SYSTEM_PROFILE, { ...REQUEST, responseFormat: 'NUMERIC_ENTRY' })).provenance.responseFormat[0]).toEqual({ origin: 'REQUEST', ref: 'responseFormat', authority: null });
    // an OFFICIAL rule and a STUDYUS_POLICY rule are never confused in a specification
    for (const x of SPECS.values()) for (const list of Object.values(x.provenance)) for (const p of list) {
      if (p.origin === 'PROFILE_RULE') expect(PROFILE_RULE_DIMENSIONS.map((d) => systemProfileOf(x.assessmentProfile.profileId)!.rules[d]).find((r) => r.ruleId === p.ref)!.authority.kind).toBe(p.authority);
      if (p.origin === 'POLICY_RULE') expect(p.authority).toBe('STUDYUS_POLICY');
      if (p.origin === 'FAMILY' || p.origin === 'REQUEST') expect(p.authority).toBeNull();
    }
  });

  it('an UNSUPPORTED profile is refused with the family\'s reason and is never forced, whatever is asked', () => {
    const r = run(MISSING_VALUE, PISA_SYSTEM_PROFILE);
    expect(r).toMatchObject({ ok: false, refusal: { code: 'PROFILE_UNSUPPORTED_BY_FAMILY' } });
    expect(!r.ok && r.refusal.detail).toMatch(/cannot show transfer/);
    for (const extra of [{ context: 'PERSONAL' }, { responseFormat: 'SELECTED_RESPONSE' }, { knowledgeRequirement: 'NONE' }]) expect(refusal(run(MISSING_VALUE, PISA_SYSTEM_PROFILE, { ...REQUEST, ...extra }))).toBe('PROFILE_UNSUPPORTED_BY_FAMILY');
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
    expect(spec(run(DATASET, IB_SYSTEM_PROFILE)).variable.toolPolicy.calculator).toBe('GDC_REQUIRED');
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
    const narrow = clone(PISA_SYSTEM_PROFILE) as AssessmentSystemProfile;
    narrow.rules.competencyElicitation.value = { FORMULATE: ['RECALL'], EMPLOY: ['RECALL'], INTERPRET_EVALUATE: ['RECALL'], REASON: ['RECALL'] };
    expect(refusal(run(RATE_MODEL, narrow))).toBe('PROFILE_COMPETENCY_NOT_ELICITED');
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
      for (const s of own) expect(invariantsPreserved(f, s), `${f.familyId} / ${s.assessmentProfile.profileId}`).toBe(true);
      expect(new Set(own.map((s) => canonicalJson(s.variable))).size, f.familyId).toBe(own.length);
      // the request's own choices (band, format, context, calculator) never move the invariants either
      for (const extra of [{ difficultyBand: 'CHALLENGE' as const }, { purpose: 'FULL_MOCK_1' as const }, { language: 'en' }]) {
        const r = run(f, systemProfileOf(own[0].assessmentProfile.profileId), { ...REQUEST, ...extra });
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

describe('mathematics proof of concept: 10 families x 5 profiles', () => {
  it('the stored artifact is exactly what the function produces', () => {
    expect(serializeMathAdaptationMatrix(MATRIX)).toBe(read(MATH_POC_MATRIX_ARTIFACT));
    expect(serializeMathAdaptationMatrix(buildMathAdaptationMatrix())).toBe(serializeMathAdaptationMatrix(MATRIX));
    const script = code('scripts/operations/ea1-adaptation-matrix.ts') + code('scripts/operations/ea1-paa-evidence-demand.ts');
    expect(script).not.toMatch(/from 'pg'|DATABASE_URL|process\.env|fetch\(|@\/lib\/ai\/|@\/lib\/db/);
  });

  it('50 attempts: 42 specifications and 8 named refusals; the support matrix is not uniform', () => {
    expect(MATRIX.summary).toMatchObject({ attempts: 50, specifications: 42, refusals: 8, declaredSupport: { SUPPORTED: 35, SUPPORTED_WITH_CONSTRAINTS: 7, UNSUPPORTED: 8 }, refusalCodes: { PROFILE_UNSUPPORTED_BY_FAMILY: 8 }, specificationsByProfile: { PAA: 9, IB: 10, CAMBRIDGE: 10, PISA: 6, ICFES: 7 }, familiesReachingSeveralProfiles: 10, invariantHashIdenticalWithinEveryFamily: true });
    const refused = MATRIX.cells.filter((c) => c.outcome === 'REFUSED').map((c) => `${c.familyId.replace('tf.math.', '')}|${c.profileId}`);
    expect(refused).toEqual(['proportion.missing-value|PISA', 'linear.line-through-two-points|PISA', 'quadratic.solve-by-factorising|PISA', 'quadratic.solve-by-factorising|ICFES', 'quadratic.optimum-of-a-model|ICFES', 'probability.single-event-equally-likely|PISA', 'data.rate-of-change-from-realistic-dataset|PAA', 'data.rate-of-change-from-realistic-dataset|ICFES']);
    // every procedural family is refused for PISA; every modelling family reaches it
    expect(MATH_POC_FAMILIES.filter((f) => f.profileSupport.PISA.status === 'UNSUPPORTED').every((f) => !f.evidenceTarget.actions.some((a) => ['FORMULATE', 'INTERPRET', 'EVALUATE'].includes(a)))).toBe(true);
    // the outcome agrees with the declaration in every cell, and a specification id is unique
    for (const c of MATRIX.cells) expect(c.outcome === 'REFUSED', `${c.familyId}|${c.profileId}`).toBe(c.declaredSupport === 'UNSUPPORTED');
    expect(new Set(MATRIX.cells.flatMap((c) => (c.specificationId ? [c.specificationId] : []))).size).toBe(42);
  });

  it('the canonical-subject tension is in the numbers: 27 of the 42 specifications are for a system where the concept is not certified', () => {
    expect(MATRIX.summary.knowledgeAvailabilityOfSpecifications).toEqual({ CATALOGUE_LINK_RECORDED: 6, CERTIFIED_FOR_THIS_EXAM_FAMILY: 9, NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY: 27 });
    expect(MATRIX.summary.specificationsIfKnowledgeRequired).toEqual({ CATALOGUE_LINK_OR_CERTIFIED: 15, CERTIFIED: 9 });
    // certified = PAA only; linked = quadratics for IB and Cambridge (Mathematics), proportion and probability for PISA (Matemáticas)
    const linked = MATRIX.cells.filter((c) => c.outcome === 'SPECIFICATION' && c.canonicalKnowledgeAvailability === 'CATALOGUE_LINK_RECORDED').map((c) => `${c.familyId.replace('tf.math.', '')}|${c.profileId}`);
    expect(linked).toEqual(['proportion.rate-comparison-model|PISA', 'quadratic.solve-by-factorising|IB', 'quadratic.solve-by-factorising|CAMBRIDGE', 'quadratic.optimum-of-a-model|IB', 'quadratic.optimum-of-a-model|CAMBRIDGE', 'probability.compare-chances-to-decide|PISA']);
    expect(MATRIX.cells.filter((c) => c.canonicalKnowledgeAvailability === 'CERTIFIED_FOR_THIS_EXAM_FAMILY').every((c) => c.profileId === 'PAA')).toBe(true);
    // no Matemáticas concept is treated as available to a Mathematics curriculum, or the reverse
    for (const s of SPECS.values()) if (s.primaryConcept.canonicalSubject === 'Matemáticas' && ['IB', 'CAMBRIDGE'].includes(s.assessmentProfile.profileId)) expect(s.canonicalKnowledgeAvailability.status).toBe('NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY');
  });

  it(`any two specifications of one family differ in at least ${MINIMUM_PAIRWISE_DIFFERENCE} of the ${COMPARED_DIMENSIONS.length} compared dimensions, with the invariant hash equal`, () => {
    expect(COMPARED_DIMENSIONS.length).toBe(12);
    let pairs = 0;
    for (const f of MATRIX.fidelity) {
      expect(f.invariant.identicalAcrossProfiles).toBe(true);
      for (const p of f.pairwise) {
        pairs += 1;
        const a = SPECS.get(`${f.familyId}|${p.a}`)!;
        const b = SPECS.get(`${f.familyId}|${p.b}`)!;
        expect(a.invariantHash).toBe(b.invariantHash);
        expect(differingDimensions(a, b)).toEqual(p.differing);
        expect(p.differing.length, `${f.familyId}: ${p.a} / ${p.b}`).toBeGreaterThanOrEqual(MINIMUM_PAIRWISE_DIFFERENCE);
      }
    }
    expect(pairs).toBe(70);
    // the floor is the measured minimum, not a comfortable one: PAA / Icfes sit exactly on it
    expect(MATRIX.summary.minimumPairwiseDifference).toBe(MINIMUM_PAIRWISE_DIFFERENCE);
    const closest = MATRIX.fidelity.flatMap((f) => f.pairwise.filter((p) => p.differing.length === MINIMUM_PAIRWISE_DIFFERENCE).map((p) => `${p.a}-${p.b}`));
    expect([...new Set(closest)].sort()).toEqual(['IB-CAMBRIDGE', 'PAA-ICFES']);
    expect(MATRIX.summary.pairwiseDifferenceDistribution).toEqual({ 'differ-in-03': 8, 'differ-in-04': 3, 'differ-in-05': 6, 'differ-in-06': 4, 'differ-in-07': 9, 'differ-in-08': 5, 'differ-in-09': 9, 'differ-in-10': 10, 'differ-in-11': 15, 'differ-in-12': 1 });
  });

  it('worked fidelity comparison: the linear model, identical in what it is evidence of, materially different in how five systems ask it', () => {
    const f = MATRIX.fidelity.find((x) => x.familyId === 'tf.math.linear.constant-rate-model')!;
    expect(f.invariant).toMatchObject({ primaryConceptStableIds: ['math.fun.linear-functions-lines'], canonicalSubject: 'Matemáticas', construct: 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE', evidenceActions: ['FORMULATE', 'INTERPRET'], identicalAcrossProfiles: true });
    expect(f.profiles).toEqual(['PAA', 'IB', 'CAMBRIDGE', 'PISA', 'ICFES']);
    const v = (p: string) => SPECS.get(`${f.familyId}|${p}`)!.variable;
    expect([v('PAA'), v('IB'), v('CAMBRIDGE'), v('PISA'), v('ICFES')].map((x) => [x.responseFormat.format, x.context.kind, x.reasoningDepth.depth, x.commandTerm, x.stimulus.mode, x.toolPolicy.calculator, x.markStructure, x.rubricStyle, x.competencies.join('+')])).toEqual([
      ['SELECTED_RESPONSE', 'PERSONAL', 'ANSWER_ONLY', null, 'NONE', 'NONE', 'ONE_MARK_PER_ITEM', 'KEY_ONLY', ''],
      ['SHORT_RESPONSE', 'SCIENTIFIC', 'METHOD_SHOWN', 'find', 'NONE', 'NONE', 'MULTI_MARK_PARTS', 'METHOD_AND_ACCURACY', ''],
      ['SHORT_RESPONSE', 'SCIENTIFIC', 'METHOD_SHOWN', 'work out', 'NONE', 'SCIENTIFIC_REQUIRED', 'MULTI_MARK_PARTS', 'METHOD_AND_ACCURACY', 'AO2'],
      ['SELECTED_RESPONSE', 'PERSONAL', 'ANSWER_ONLY', null, 'OWN_STIMULUS', 'ALLOWED', 'CODED_CREDIT', 'CODED_CREDIT_LEVELS', 'FORMULATE+INTERPRET_EVALUATE'],
      ['SELECTED_RESPONSE', 'PERSONAL', 'ANSWER_ONLY', null, 'NONE', 'NONE', 'ONE_MARK_PER_ITEM', 'KEY_ONLY', 'INTERPRETACION_REPRESENTACION+FORMULACION_EJECUCION'],
    ]);
    expect([v('PAA').timeBudget, v('IB').timeBudget, v('CAMBRIDGE').timeBudget, v('PISA').timeBudget]).toEqual([{ secondsPerUnit: 65.45, unit: 'ITEM' }, { secondsPerUnit: 65.45, unit: 'MARK' }, { secondsPerUnit: 88, unit: 'MARK' }, { secondsPerUnit: null, unit: null }]);
    // only two of the five can be generated by the Production OS today: the constructed formats have no template
    expect(f.profiles.filter((p) => v(p).responseFormat.productionFormat !== null)).toEqual(['PAA', 'PISA', 'ICFES']);
  });
});

describe('instance class, promotion path and the carriers for B2 and B3', () => {
  it('the pools are restated identically to the Production OS and to B2; a purpose maps to the least instance class it accepts', () => {
    expect([...ADAPTATION_POOLS]).toEqual([...PRODUCTION_POOLS]);
    expect([...ADAPTATION_POOLS]).toEqual([...LOGICAL_POOLS]);
    expect(INSTANCE_PURPOSES.map((p) => [p, minimumInstanceClassFor(p).minimumClass, minimumInstanceClassFor(p).basis])).toEqual([
      ['PRACTICE', 'DYNAMIC', 'BRIEF'], ['DIAGNOSTIC', 'CERTIFIED_FROZEN', 'CONSERVATIVE_DEFAULT'], ['VERIFICATION', 'CERTIFIED_FROZEN', 'CONSERVATIVE_DEFAULT'], ['REDUCED_MOCK', 'CERTIFIED_FROZEN', 'BRIEF'], ['FULL_MOCK_1', 'CERTIFIED_FROZEN', 'BRIEF'], ['FULL_MOCK_2', 'CERTIFIED_FROZEN', 'BRIEF'],
      ['LOW_STAKES_REINFORCEMENT', 'DYNAMIC', 'BRIEF'], ['BENCHMARK', 'CERTIFIED_FROZEN', 'BRIEF'], ['CALIBRATION', 'CERTIFIED_FROZEN', 'BRIEF'], ['PILOT_CERTIFICATION', 'CERTIFIED_FROZEN', 'BRIEF'],
    ]);
    expect(() => minimumInstanceClassFor('HOMEWORK')).toThrow(/UNKNOWN_INSTANCE_PURPOSE/);
    expect([instanceClassSatisfies('DYNAMIC', 'PRACTICE'), instanceClassSatisfies('DYNAMIC', 'FULL_MOCK_1'), instanceClassSatisfies('CERTIFIED_FROZEN', 'FULL_MOCK_1'), instanceClassSatisfies('CERTIFIED_FROZEN', 'PRACTICE')]).toEqual([true, false, true, true]);
    expect(spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'FULL_MOCK_2' })).purpose).toEqual({ purpose: 'FULL_MOCK_2', pool: 'FULL_MOCK_2', minimumInstanceClass: 'CERTIFIED_FROZEN' });
    expect(spec(run(RATE_MODEL, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'CALIBRATION' })).purpose).toEqual({ purpose: 'CALIBRATION', pool: null, minimumInstanceClass: 'CERTIFIED_FROZEN' });
  });

  it('the promotion path DESCRIBES the existing gates and adds none; adaptation establishes no right, review, attribution or pool', () => {
    expect(PROMOTION_PATH.map((s) => s.step)).toEqual(['AUTOMATED_VALIDATION', 'ORIGINALITY', 'RIGHTS', 'HUMAN_REVIEW', 'ATTRIBUTION', 'POOL_ASSIGNMENT']);
    expect([...NOT_ESTABLISHED_BY_ADAPTATION]).toEqual(['REUSE_RIGHTS', 'ORIGINALITY', 'HUMAN_REVIEW', 'PRIMARY_ATTRIBUTION', 'POOL_MEMBERSHIP', 'INSTANCE_CERTIFICATION', 'EVIDENCE_INDEPENDENCE']);
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
    expect([...ADAPTATION_EVIDENCE_FACETS]).toEqual(['KNOWLEDGE', 'SKILL', 'COMPETENCY', 'CONTEXT', 'TRANSFER', 'ASSESSMENT_PROFILE', 'INDEPENDENCE', 'RETENTION']);
    const src = read(`${ADAPTATION_DIR}/instance-lineage.ts`);
    for (const t of ['export interface InstanceIndependenceCarrier', 'export type SiblingRelationship', 'export type ExposureRelationship', 'export interface InstancePairRelationship', 'export interface EvidenceFacetCarrier']) expect(src).toContain(t);
    for (const field of ['familyIdentity', 'parameterizationIdentity', 'variantFamilyIdentity']) expect(src).toContain(field);
    // the only functions of the module are the instance-class contract; nothing computes a relationship or independence
    expect([...code(`${ADAPTATION_DIR}/instance-lineage.ts`).matchAll(/export (?:function|const) (\w+)\s*(?:=\s*\(|\()/g)].map((m) => m[1]).sort()).toEqual(['instanceClassSatisfies', 'minimumInstanceClassFor']);
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
  const bridged = adaptForCell({ cell: CELL, family: MISSING_VALUE, profiles: EA1_SYSTEM_PROFILES, disciplinePolicy: POLICY, language: 'es' });
  const SPEC = spec(bridged as AdaptationResult);

  it('cell -> evidence target -> family selection -> profile -> specification, from the cell\'s own fields and nothing else', () => {
    expect(evidenceTargetOfCell(CELL)).toEqual({ primaryConcept: CELL.primaryConcept, examFamily: 'PAA', pool: 'FULL_MOCK_1' });
    const selection = selectTaskFamilies(CELL, MATH_POC_FAMILIES);
    expect(selection.candidates.map((f) => f.familyId)).toEqual(['tf.math.proportion.missing-value', 'tf.math.proportion.rate-comparison-model']);
    expect(SPEC).toMatchObject({ taskFamily: { familyId: 'tf.math.proportion.missing-value' }, assessmentProfile: { profileId: 'PAA', examFamilyCode: 'PAA' }, primaryConcept: CELL.primaryConcept, canonicalKnowledgeAvailability: { status: 'CERTIFIED_FOR_THIS_EXAM_FAMILY' }, blueprintRequirement: { requirementCellKey: CELL.cellKey }, purpose: { pool: 'FULL_MOCK_1', minimumInstanceClass: 'CERTIFIED_FROZEN' }, variable: { responseFormat: { format: 'NUMERIC_ENTRY', productionFormat: 'STUDENT_PRODUCED' }, difficulty: { band: 'STANDARD' }, language: 'es' } });
    // selection matches by stable id AND canonical subject: a concept of another subject is never matched by its id alone
    expect(selectTaskFamilies({ ...CELL, primaryConcept: { ...CELL.primaryConcept, canonicalSubject: 'Mathematics' } }, MATH_POC_FAMILIES).candidates).toEqual([]);
    const quadratic = CELLS.find((c) => c.primaryConcept.stableId === 'math.alg.quadratics' && c.responseFormat === 'MULTIPLE_CHOICE')!;
    // the two quadratic families exclude selected response: a multiple-choice cell has no family, and is generated as before
    expect(selectTaskFamilies(quadratic, MATH_POC_FAMILIES)).toMatchObject({ candidates: [], excluded: [{ reason: 'RESPONSE_FORMAT_NOT_OF_THE_FAMILY' }, { reason: 'RESPONSE_FORMAT_NOT_OF_THE_FAMILY' }] });
    expect(selectTaskFamilies(CELLS.find((c) => c.primaryConcept.stableId === 'math.stat.data-representation' && c.stimulus.class === 'STANDALONE') ?? { ...CELL, primaryConcept: { stableId: 'math.stat.data-representation', canonicalSubject: 'Matemáticas', canonicalName: 'x' } }, MATH_POC_FAMILIES).candidates).toEqual([]);
    // named refusals of the bridge
    expect(adaptForCell({ cell: { ...CELL, examFamily: 'SEP' }, family: MISSING_VALUE, profiles: EA1_SYSTEM_PROFILES, disciplinePolicy: POLICY, language: 'es' })).toMatchObject({ ok: false, refusal: { code: 'NO_PROFILE_FOR_EXAM_FAMILY' } });
    expect(adaptForCell({ cell: { ...CELL, examFamily: 'AICE' }, family: MISSING_VALUE, profiles: EA1_SYSTEM_PROFILES, disciplinePolicy: POLICY, language: 'es' })).toMatchObject({ ok: false, refusal: { code: 'NO_PROFILE_FOR_EXAM_FAMILY' } });
    expect(adaptForCell({ cell: CELL, family: FACTORISING, profiles: EA1_SYSTEM_PROFILES, disciplinePolicy: POLICY, language: 'es' })).toMatchObject({ ok: false, refusal: { code: 'FAMILY_DOES_NOT_TARGET_THE_CELLS_CONCEPT' } });
    // production is strict about knowledge: the same cell under an exam family where the concept is not certified is refused
    expect(adaptForCell({ cell: { ...CELL, examFamily: 'ICFES', responseFormat: 'MULTIPLE_CHOICE' }, family: MISSING_VALUE, profiles: EA1_SYSTEM_PROFILES, disciplinePolicy: POLICY, language: 'es' })).toMatchObject({ ok: false, refusal: { code: 'CANONICAL_KNOWLEDGE_NOT_CERTIFIED_FOR_EXAM_FAMILY' } });
    // every PAA cell of the five concepts that has a fitting family gets a specification under the strict rule, or a named refusal
    let specified = 0;
    for (const c of CELLS) for (const f of selectTaskFamilies(c, MATH_POC_FAMILIES).candidates) {
      const r = adaptForCell({ cell: c, family: f, profiles: EA1_SYSTEM_PROFILES, disciplinePolicy: POLICY, language: 'es' });
      if (r.ok) { specified += 1; expect(r.specification.blueprintRequirement).toEqual({ requirementCellKey: c.cellKey }); } else expect(['SUPPORT_CONSTRAINT_VIOLATED', 'PROFILE_UNSUPPORTED_BY_FAMILY']).toContain(r.refusal.code);
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
    expect(rendered.prompt.instruction.adaptation).toEqual([{ slotKey: SLOT.slotKey, specificationId: SPEC.specificationId, taskFamily: { familyId: 'tf.math.proportion.missing-value', version: MISSING_VALUE.version }, assessmentProfile: { profileId: 'PAA', version: PAA_SYSTEM_PROFILE.version }, disciplinePolicy: { policyId: POLICY.policyId, version: POLICY.version }, invariants: SPEC.invariants, invariantHash: SPEC.invariantHash, variable: SPEC.variable, parameterization: SPEC.parameterization }]);
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
    expect(lineage.adaptation).toEqual({ taskFamily: { id: 'tf.math.proportion.missing-value', version: MISSING_VALUE.version }, assessmentProfile: { id: 'PAA', version: PAA_SYSTEM_PROFILE.version }, disciplinePolicy: { id: POLICY.policyId, version: POLICY.version }, adaptationSpecificationId: SPEC.specificationId, invariantHash: SPEC.invariantHash, generationRunId: PILOT_V2_RUN.runId });
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
      ['PRIMARY_CONCEPT', run(fam('tf.math.probability.single-event-equally-likely'), PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY' })],
      ['RESPONSE_FORMAT', run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'FULL_MOCK_1' })],
      ['DIFFICULTY_BAND', run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY', difficultyBand: 'CHALLENGE' })],
      ['POOL', run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'PRACTICE', responseFormat: 'NUMERIC_ENTRY' })],
      ['LANGUAGE', run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY', language: 'en' })],
      ['EXAM_FAMILY', run(RATE_MODEL, PISA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY' })],
      ['REQUIREMENT_CELL', run(MISSING_VALUE, PAA_SYSTEM_PROFILE, { ...REQUEST, purpose: 'FULL_MOCK_1', responseFormat: 'NUMERIC_ENTRY', requirementCellKey: 'another-cell' })],
    ];
    for (const [misfit, r] of cases) expect(() => renderGenerationPrompt(input(replay, { [SLOT.slotKey]: spec(r) })), misfit).toThrow(new RegExp(`ADAPTATION_SPECIFICATION_NOT_FOR_THE_SLOT: .*${misfit}`));
  });

  it('legacy and fixed content needs no task family anywhere: contract, structural validation and the review package', () => {
    const legacy = PILOT_BATCH.candidates.find((c) => c.slotKey === SLOT.slotKey)!;
    expect(QuestionCandidateSchema.safeParse(legacy).success).toBe(true);
    // a human-written draft has no adaptation lineage either, and cannot be given one by accident
    const human = { ...clone(legacy), provenance: 'STUDYUS_AUTHORED', lineage: { kind: 'HUMAN', authorUserId: '00000000-0000-4000-8000-000000000001', writtenAt: PILOT_V2_RUN.now } };
    expect(QuestionCandidateSchema.safeParse(human).success).toBe(true);
    const anAdaptation = { taskFamily: { id: 'tf.math.proportion.missing-value', version: '1' }, assessmentProfile: { id: 'PAA', version: '1' }, disciplinePolicy: { id: 'p', version: '1' }, adaptationSpecificationId: 'a'.repeat(64), invariantHash: 'b'.repeat(64), generationRunId: 'r' };
    expect(AdaptationLineageSchema.safeParse(anAdaptation).success).toBe(true);
    expect(QuestionCandidateSchema.safeParse({ ...human, lineage: { ...human.lineage, adaptation: anAdaptation } }).success).toBe(false);
    // on a model draft the member is accepted when whole and refused when partial
    expect(QuestionCandidateSchema.safeParse({ ...clone(legacy), lineage: { ...legacy.lineage, adaptation: anAdaptation } }).success).toBe(true);
    expect(QuestionCandidateSchema.safeParse({ ...clone(legacy), lineage: { ...legacy.lineage, adaptation: { taskFamily: anAdaptation.taskFamily } } }).success).toBe(false);
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
    for (const c of CELLS.slice(0, 80)) for (const f of selectTaskFamilies(c, MATH_POC_FAMILIES).candidates) adaptForCell({ cell: c, family: f, profiles: EA1_SYSTEM_PROFILES, disciplinePolicy: POLICY, language: 'es' });
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
    const poc = DEMAND.scenarios[0].byConcept.filter((c) => Object.keys(MATH_POC_KNOWLEDGE_LINKS).includes(c.conceptStableId));
    expect(poc.map((c) => [c.conceptStableId, c.requiredInstances, c.pools, c.minimumFamilies])).toEqual([['math.alg.quadratics', 12, 6, 2], ['math.fun.linear-functions-lines', 14, 6, 2], ['math.num.ratio-proportion', 12, 6, 2], ['math.prob.probability', 11, 6, 2], ['math.stat.data-representation', 12, 6, 2]]);
    // the three Mathematics-subject concepts of the PAA plan: 28 instances that sit under the other canonical subject
    expect(DEMAND.scenarios[0].byConcept.filter((c) => c.canonicalSubject === 'Mathematics').map((c) => [c.conceptStableId, c.requiredInstances])).toEqual([['math.alg.quadratics', 12], ['math.fun.exponential', 9], ['math.trig.ratios', 7]]);
  });
});

describe('architecture: ownership, purity and no runtime wiring', () => {
  const adaptationFiles = walk(ADAPTATION_DIR);
  const familyFiles = walk(FAMILIES_DIR);

  it('the two directories hold exactly these modules', () => {
    expect(adaptationFiles.map((f) => f.replace(`${ADAPTATION_DIR}/`, '')).sort()).toEqual(['adapt.ts', 'adaptation-specification.ts', 'assessment-system-profile.ts', 'canonical-hash.ts', 'cell-bridge.ts', 'discipline-policy.ts', 'index.ts', 'instance-lineage.ts', 'math-poc-matrix.ts', 'system-profiles.ts']);
    expect(familyFiles.map((f) => f.replace(`${FAMILIES_DIR}/`, '')).sort()).toEqual(['family-demand.ts', 'index.ts', 'math-poc-families.ts', 'math-problem.ts', 'task-family.ts']);
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
    const allowed = /^(zod|crypto|\.\/[a-z-]+|@\/lib\/exam-core\/taxonomy|@\/lib\/exam-core\/question-bank\/task-families(\/(task-family|math-problem|math-poc-families))?)$/;
    for (const f of adaptationFiles) for (const i of imports(f)) expect(i, `${f} imports ${i}`).toMatch(allowed);
    // B2 does not own adaptation, and adaptation does not reach into B2
    for (const f of [...adaptationFiles, ...familyFiles]) expect(code(f), f).not.toMatch(/assessment-blueprint/);
    expect(walk('src/lib/assessment-blueprint').filter((f) => /assessment-adaptation|task-families|AdaptationSpecification|TaskFamily/.test(read(f)))).toEqual([]);
    // B1 does not know it either
    expect(walk('src/lib/assessment-foundation').filter((f) => /assessment-adaptation|task-families/.test(read(f)))).toEqual([]);
  });

  it('no runtime wiring: nothing under src imports the new modules except the two additive Production OS contracts; no route, no service, no table', () => {
    const importers = walk('src').filter((f) => !f.startsWith(ADAPTATION_DIR) && !f.startsWith(FAMILIES_DIR) && /assessment-adaptation|question-bank\/task-families/.test(read(f))).sort();
    expect(importers).toEqual(['src/lib/exam-core/question-bank/production/generation-contract.ts', 'src/lib/exam-core/question-bank/production/generator/generate-candidates.ts']);
    expect(walk('src/app').filter((f) => /assessment-adaptation|task-families|AdaptationSpecification/.test(read(f)))).toEqual([]);
    expect(walk('src/services').filter((f) => /assessment-adaptation|task-families|AdaptationSpecification/.test(read(f)))).toEqual([]);
    // no migration names anything of this phase: the persistence is a design
    const migrations = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    const NEW_SCHEMA = /question_bank_task_famil|task_family_version|adaptation_specification|item_adaptation|assessment_system_profile|assessment_discipline_polic/i;
    expect(migrations.filter((f) => NEW_SCHEMA.test(f) || NEW_SCHEMA.test(read(`database/migrations/${f}`)))).toEqual([]);
    expect([migrations.length, migrations[migrations.length - 1]]).toEqual([82, '20261112_1000_qb_review_requires_primary_attribution.sql']);
  });

  it('B3 is not implemented here: no evidence engine, no evidence path, no second evidence writer', () => {
    const lib = readdirSync(join(ROOT, 'src/lib'));
    expect(lib.filter((d) => /evidence-engine|assessment-evidence|evidence-attribution-engine|^b3/i.test(d))).toEqual([]);
    expect(walk('src').filter((f) => /\bupdateMastery\(/.test(code(f)) && /assessment-adaptation|task-families/.test(f))).toEqual([]);
    expect(lib).toContain('assessment-adaptation');
  });

  it('the Learning Engine\'s TRANSFER task family (Phase 7) is another thing with a similar name: a derived hash on a learner\'s transfer task, not an authored family', () => {
    // it exists, it is persisted as `transfer_task_instances.task_family_id`, and it already backs one independence rule (ROBUST transfer)
    expect(read('database/migrations/20260908_1000_phase7_transfer_task_instances.sql')).toMatch(/task_family_id TEXT NOT NULL/);
    expect(read('src/lib/transfer-task-identity.ts')).toMatch(/export function computeTransferTaskFamilyId\(/);
    // EA-1 neither imports it nor reuses its identity, and the transfer engine does not import EA-1
    for (const f of [...adaptationFiles, ...familyFiles]) expect(read(f), f).not.toMatch(/transfer-task-identity|transfer-policy|computeTransferTaskFamilyId|transfer_task_instances/);
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
