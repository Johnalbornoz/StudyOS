/**
 * EA-1A -- Learning Approach Profiles and the STEM+ overlay.
 *
 * Three independent layers -- curriculum (what is learned), learning approach (how the institution wants it
 * worked and shown), assessment profile (how an assessment requires evidence) -- and what the engine does when
 * they are composed. Nothing here is a review: the STEM+ approach, the school STEM performance profile and the
 * families are provisional drafts. These tests prove properties of the architecture.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { adapt, type AdaptationResult } from '@/lib/assessment-adaptation/adapt';
import { AdaptationSpecificationSchema, LearningApproachResolutionSchema, PROVENANCE_ORIGINS, specificationIntegrityIssues, type AdaptationRequest, type AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { AssessmentComponentProfileSchema, AssessmentSystemProfileSchema, authorityBreakdown, PROFILE_RULE_DIMENSIONS, REASONING_DEPTHS, RULE_AUTHORITIES, RuleAuthoritySchema, SPECIFICATION_BASES, STIMULUS_MODES, type AssessmentComponentProfile, type AssessmentSystemProfile } from '@/lib/assessment-adaptation/assessment-system-profile';
import { canonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { ADAPTATION_EVIDENCE_FACETS, AdaptationLineageSchema, instancePolicyFor, PROTECTED_MOCK_POOLS } from '@/lib/assessment-adaptation/instance-lineage';
import { buildLearningApproachPoc, LEARNING_APPROACH_POC_ARTIFACT, LEARNING_APPROACH_POC_FAMILY_IDS, serializeLearningApproachPoc } from '@/lib/assessment-adaptation/learning-approach-poc';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { buildMathAdaptationMatrix, buildMathPocSpecifications, COMPARED_DIMENSIONS, differingDimensions, MATH_POC_LANGUAGE, MATH_POC_MATRIX_ARTIFACT, serializeMathAdaptationMatrix } from '@/lib/assessment-adaptation/math-poc-matrix';
import { ILLUSTRATIVE_INSTITUTION_KEY, SCHOOL_STEM_PERFORMANCE_PROFILE } from '@/lib/assessment-adaptation/school-stem-performance';
import { componentProfileOf, EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES, PAA_MATEMATICAS_COMPONENT, PAA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, PISA_SYSTEM_PROFILE, systemProfileOf } from '@/lib/assessment-adaptation/system-profiles';
import { DEV_COMPETENCIES } from '@/lib/exam-core/catalog/dev-learning-catalog';
import { DEFAULT_TASK_FAMILY_REGISTRY, FAMILY_TYPE_ALIASES, canonicalFamilyType, KNOWN_FAMILY_TYPES, knownFamilyType, MATH_POC_FAMILIES, MATH_POC_FAMILIES_EA1A, mathPocFamilyEa1aOf, mathPocFamilyOf, PARTICIPATION_MODES, TaskFamilyCommonSchema, TRANSVERSAL, type MathTaskFamily } from '@/lib/exam-core/question-bank/task-families';
import { CALCULATOR_POLICIES, CONTEXT_KINDS, ELICITATION_FORMATS } from '@/lib/exam-core/question-bank/task-families/task-family';
import { PAA_CONCEPT_IDENTITIES } from '@/lib/exam-core/question-bank/production/paa-concept-identity';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { CO_MEN_CURRICULUM, CurriculumProfileSchema, EA1A_CURRICULUM_ENTITLEMENT, EA1A_CURRICULUM_PROFILES, EA1A_EXAMPLE_CONFIGURATIONS, MX_MCCEMS_CURRICULUM, resolveEffectiveApproach, resolveEntitlement } from '@/lib/learning-approach/institution-configuration';
import { APPROACH_DIMENSION_VALUES, APPROACH_PARTICIPATION_MODES, competencyCodeOf, evidenceYieldOf, LEARNING_APPROACHES, learningApproachOf, LearningApproachProfileSchema, STANDARD_APPROACH, STEM_PLUS_APPROACH, validateLearningApproachProfile, type LearningApproachProfile } from '@/lib/learning-approach/learning-approach-profile';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
const walk = (d: string): string[] => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const APPROACH_DIR = 'src/lib/learning-approach';
const ADAPTATION_DIR = 'src/lib/assessment-adaptation';
const FAMILIES_DIR = 'src/lib/exam-core/question-bank/task-families';
const POLICY = MATHEMATICS_ADAPTATION_POLICY;
const REQUEST: AdaptationRequest = { purpose: 'PRACTICE', contentUseClass: 'DEV_TEST_CONTENT', difficultyBand: 'STANDARD', language: 'es' };
const RATE = mathPocFamilyEa1aOf('tf.math.proportion.rate-comparison-model')!;
const CLAIM = mathPocFamilyEa1aOf('tf.math.data.judge-claim-against-display')!;
const FACTORISING = mathPocFamilyEa1aOf('tf.math.quadratic.solve-by-factorising')!;
const SCHOOL = SCHOOL_STEM_PERFORMANCE_PROFILE;
type Extra = { approach?: unknown; request?: Partial<AdaptationRequest>; curriculum?: unknown; entitlement?: readonly unknown[] };
const run = (family: unknown, profile: AssessmentSystemProfile, component: AssessmentComponentProfile | null, x: Extra = {}): AdaptationResult =>
  adapt({ family, profile, component: component ?? undefined, applicability: MATH_POC_APPLICABILITY, disciplinePolicy: POLICY, request: { ...REQUEST, ...(x.request ?? {}) }, learningApproach: x.approach, curriculum: x.curriculum, entitlement: x.entitlement });
const spec = (r: AdaptationResult): AdaptationSpecification => { if (!r.ok) throw new Error(`refused: ${r.refusal.code} ${r.refusal.detail}`); return r.specification; };
const refusal = (r: AdaptationResult): string => (r.ok ? 'NOT_REFUSED' : r.refusal.code);
const STEM = { approach: STEM_PLUS_APPROACH };
const certified = <T extends { status: string; certification: unknown }>(p: T): T => ({ ...clone(p), status: 'CERTIFIED', certification: { certifiedBy: 'test-double', certifiedAt: '2026-10-11T00:00:00Z' } });
const reviewed = <T extends { lifecycle: string; reviewStatus: string }>(f: T): T => ({ ...clone(f), lifecycle: 'CERTIFIED', reviewStatus: 'REVIEWED' });
const POC = buildLearningApproachPoc();

describe('three independent layers: curriculum, learning approach, assessment profile', () => {
  it('an approach carries no curriculum knowledge and no exam rule: no concept, topic or objective, no exam family, no profile dimension', () => {
    expect(Object.keys(LearningApproachProfileSchema.shape).sort()).toEqual(['approachId', 'authority', 'certification', 'displayName', 'participationModes', 'preferences', 'statement', 'status', 'transversalCompetencies', 'v', 'version']);
    const certifiedConcepts = PAA_CONCEPT_IDENTITIES.flatMap((c) => [c.stableId, c.canonicalName]);
    for (const a of LEARNING_APPROACHES) {
      expect(validateLearningApproachProfile(a).ok, a.approachId).toBe(true);
      const text = JSON.stringify(a);
      for (const c of certifiedConcepts) expect(text.includes(`"${c}"`), `${a.approachId}: ${c}`).toBe(false);
      for (const exam of [...EXAM_FAMILIES, 'SEP', 'MEN', 'MCCEMS', 'Saber']) expect(new RegExp(`\\b${exam}\\b`).test(text), `${a.approachId} names ${exam}`).toBe(false);
      const keys: string[] = [];
      JSON.stringify(a, (k, v) => { if (k) keys.push(k); return v; });
      expect(keys.filter((k) => /concept|topic|objective|curriculum|canonical|examFamily|profileId|componentId|ruleId|sources|locator/i.test(k))).toEqual([]);
      expect(a.authority).toBe('STUDYUS_POLICY');
    }
    // strict: neither knowledge nor an exam rule can be added
    for (const extra of [{ concepts: ['math.alg.quadratics'] }, { curriculumId: 'MX.SEP.MCCEMS' }, { examFamilyCode: 'PISA' }, { rules: {} }, { authority: 'OFFICIAL' }]) expect(LearningApproachProfileSchema.safeParse({ ...clone(STEM_PLUS_APPROACH), ...extra }).success).toBe(false);
    // there is no STEM curriculum: no curriculum profile is an approach, and no approach is one
    expect(EA1A_CURRICULUM_PROFILES.map((c) => c.curriculumId)).toEqual(['MX.SEP.MCCEMS', 'CO.MEN.EBC_DBA']);
    for (const c of EA1A_CURRICULUM_PROFILES) expect(JSON.stringify(c)).not.toMatch(/STEM/);
    expect(Object.keys(CurriculumProfileSchema.shape).sort()).toEqual(['authorityName', 'country', 'curriculumId', 'programmeName', 'programmeVersion', 'recordedIn', 'structureStatus', 'v']);
  });

  it('an assessment profile carries no approach, and a curriculum reference carries neither', () => {
    for (const p of [...EA1_SYSTEM_PROFILES, SCHOOL, ...EA1_COMPONENT_PROFILES]) {
      const keys: string[] = [];
      JSON.stringify(p, (k, v) => { if (k) keys.push(k); return v; });
      expect(keys.filter((k) => /approach|participation|transversal|learningApproach/i.test(k))).toEqual([]);
      expect(JSON.stringify(p)).not.toMatch(/STEM_PLUS|STANDARD_APPROACH/);
    }
    expect(AssessmentSystemProfileSchema.safeParse({ ...clone(PAA_SYSTEM_PROFILE), learningApproach: 'STEM_PLUS' }).success).toBe(false);
    expect(AssessmentComponentProfileSchema.safeParse({ ...clone(PAA_MATEMATICAS_COMPONENT), learningApproach: 'STEM_PLUS' }).success).toBe(false);
    expect(CurriculumProfileSchema.safeParse({ ...clone(MX_MCCEMS_CURRICULUM), learningApproach: 'STEM_PLUS' }).success).toBe(false);
    // the school STEM assessment profile is composed with STEM+ from outside: its own competency model is empty
    expect(SCHOOL.rules.competencyEmphasis.value).toEqual([]);
  });

  it('the vocabularies an approach may prefer over are the task-family and profile ones, restated', () => {
    expect([...APPROACH_DIMENSION_VALUES.context]).toEqual([...CONTEXT_KINDS]);
    expect([...APPROACH_DIMENSION_VALUES.responseFormat]).toEqual([...ELICITATION_FORMATS]);
    expect([...APPROACH_DIMENSION_VALUES.reasoningDepth]).toEqual([...REASONING_DEPTHS]);
    expect([...APPROACH_DIMENSION_VALUES.stimulus]).toEqual([...STIMULUS_MODES]);
    expect([...APPROACH_DIMENSION_VALUES.toolPolicy]).toEqual([...CALCULATOR_POLICIES]);
    expect([...APPROACH_PARTICIPATION_MODES]).toEqual([...PARTICIPATION_MODES]);
    const bad = clone(STEM_PLUS_APPROACH);
    bad.preferences[0].prefer = ['IN_A_LABORATORY'];
    expect(LearningApproachProfileSchema.safeParse(bad).error?.issues.map((i) => i.message)).toContain('VALUE_IS_NOT_OF_THE_DIMENSION');
    const twice = clone(STEM_PLUS_APPROACH);
    twice.preferences.push({ ...twice.preferences[0], preferenceId: 'again' });
    expect(LearningApproachProfileSchema.safeParse(twice).error?.issues.map((i) => i.message)).toContain('ONE_PREFERENCE_PER_DIMENSION');
  });

  it('changing the approach never changes the concept, the invariants or the assessment profile\'s constraints', () => {
    const targets: Array<[AssessmentSystemProfile, AssessmentComponentProfile | null]> = [[PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT], [PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT], [systemProfileOf('ICFES')!, componentProfileOf('ICFES.SABER11_MATEMATICAS')!], [SCHOOL, null]];
    for (const f of [RATE, CLAIM]) for (const [system, component] of targets) {
      const before = [canonicalJson(f), canonicalJson(system), canonicalJson(component), canonicalJson(STEM_PLUS_APPROACH)];
      const standard = spec(run(f, system, component));
      const stem = spec(run(f, system, component, STEM));
      expect([canonicalJson(f), canonicalJson(system), canonicalJson(component), canonicalJson(STEM_PLUS_APPROACH)]).toEqual(before);
      const id = `${f.familyId} / ${component?.componentId ?? system.profileId}`;
      expect([stem.primaryConcept, stem.invariants, stem.invariantHash], id).toEqual([standard.primaryConcept, standard.invariants, standard.invariantHash]);
      expect([stem.systemProfile, stem.componentProfile, stem.assessmentApplicability, stem.lineage.systemProfileContentHash, stem.lineage.componentProfileContentHash, stem.lineage.familyContentHash], id).toEqual([standard.systemProfile, standard.componentProfile, standard.assessmentApplicability, standard.lineage.systemProfileContentHash, standard.lineage.componentProfileContentHash, standard.lineage.familyContentHash]);
      // every value the approach led to lies inside what the profile's rule offered
      const rules = { ...system.rules, ...(component?.overrides ?? {}) };
      expect(rules.responseFormats.value, id).toContain(stem.variable.responseFormat.format);
      expect(rules.contextExpectations.value.allowed, id).toContain(stem.variable.context.kind);
      expect(rules.calculatorPolicy.value.allowed, id).toContain(stem.variable.toolPolicy.calculator);
      expect(rules.stimulusExpectations.value.allowed, id).toContain(stem.variable.stimulus.mode);
      // and what the profile alone decides is the same under both
      expect([stem.variable.markStructure, stem.variable.rubricStyle, stem.variable.timeBudget, stem.variable.competencies, stem.variable.commandTerm], id).toEqual([standard.variable.markStructure, standard.variable.rubricStyle, standard.variable.timeBudget, standard.variable.competencies, standard.variable.commandTerm]);
    }
  });

  it('no per-approach or per-curriculum concept id exists: one stable id, one canonical subject, whatever the approach, curriculum or country', () => {
    const ids = new Set<string>();
    for (const curriculum of [undefined, MX_MCCEMS_CURRICULUM, CO_MEN_CURRICULUM]) for (const approach of [undefined, STANDARD_APPROACH, STEM_PLUS_APPROACH]) ids.add(canonicalJson(spec(run(RATE, PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, { approach, curriculum })).primaryConcept));
    expect([...ids]).toEqual([canonicalJson({ stableId: 'math.num.ratio-proportion', canonicalSubject: 'Matemáticas', canonicalName: 'Proporcionalidad' })]);
    for (const f of [...walk(APPROACH_DIR), ...walk(ADAPTATION_DIR), ...walk(FAMILIES_DIR)]) expect(code(f), f).not.toMatch(/stem[._-]?(plus)?[._-]concept|STEM_CURRICULUM|stemCurriculum|['"]stem\.(math|sci)/i);
  });
});

describe('STANDARD is the emphasis-neutral default, recorded by absence', () => {
  it('STANDARD has no competency, no preference and individual work only; nothing else may be neutral and STANDARD may not be anything else', () => {
    expect(STANDARD_APPROACH).toMatchObject({ approachId: 'STANDARD', transversalCompetencies: [], preferences: [], participationModes: ['INDIVIDUAL'] });
    expect(LearningApproachProfileSchema.safeParse({ ...clone(STANDARD_APPROACH), preferences: STEM_PLUS_APPROACH.preferences }).error?.issues.map((i) => i.message)).toContain('STANDARD_IS_EMPHASIS_NEUTRAL');
    expect(LearningApproachProfileSchema.safeParse({ ...clone(STANDARD_APPROACH), approachId: 'PLAIN' }).error?.issues.map((i) => i.message)).toContain('ONLY_STANDARD_IS_EMPHASIS_NEUTRAL');
    expect(learningApproachOf('STANDARD')).toBe(STANDARD_APPROACH);
  });

  it('every EA-1 attempt gives the same result with no approach and with STANDARD: same specification, same id, byte for byte', () => {
    const none = buildMathPocSpecifications();
    let compared = 0;
    for (const f of MATH_POC_FAMILIES) for (const system of EA1_SYSTEM_PROFILES) for (const component of [null, ...EA1_COMPONENT_PROFILES.filter((c) => c.systemProfileId === system.profileId)]) {
      const key = `${f.familyId}|${component?.componentId ?? system.profileId}`;
      const language = MATH_POC_LANGUAGE[system.profileId as keyof typeof MATH_POC_LANGUAGE];
      const without = run(f, system, component, { request: { language } });
      const standard = run(f, system, component, { approach: STANDARD_APPROACH, request: { language } });
      expect(canonicalJson(standard), key).toBe(canonicalJson(without));
      if (without.ok) {
        expect(without.specification.specificationId, key).toBe(none.specifications.get(key)!.specificationId);
        expect(without.specification).not.toHaveProperty('learningApproach');
        expect(without.specification).not.toHaveProperty('curriculumContext');
      }
      compared += 1;
    }
    expect(compared).toBe(110);
  });

  it('the EA-1 matrix artifact is what the function produces; its system-level specification ids are the ones EA-1 was accepted with', () => {
    const matrix = buildMathAdaptationMatrix();
    expect(serializeMathAdaptationMatrix(matrix)).toBe(read(MATH_POC_MATRIX_ARTIFACT));
    // anchors recorded from the accepted EA-1 artifact (commit af0d763): the engine, the system profiles and the
    // families are unchanged, so these ids are unchanged
    const id = (familyId: string, targetId: string) => matrix.cells.find((c) => c.familyId === familyId && c.targetId === targetId && c.level === 'SYSTEM')!.specificationId!.slice(0, 8);
    expect([id('tf.math.proportion.missing-value', 'PAA'), id('tf.math.proportion.rate-comparison-model', 'PISA'), id('tf.math.linear.constant-rate-model', 'IB'), id('tf.math.quadratic.solve-by-factorising', 'CAMBRIDGE'), id('tf.math.data.judge-claim-against-display', 'ICFES')]).toEqual(['7e8a5102', 'e03f9797', 'dfc246b9', '15545c47', 'f82420da']);
    // numbers, refusals and applicability are exactly EA-1's
    expect(matrix.summary.componentLevel).toMatchObject({ attempts: 60, specifications: 51, refusals: 9 });
    expect(matrix.summary.systemLevel).toMatchObject({ attempts: 50, specifications: 36, refusals: 14 });
    expect(matrix.summary.applicabilityOfComponentSpecifications.byStatus).toEqual({ ESTABLISHED: 15, NOT_ESTABLISHED: 36 });
    // what DID change, and why: the component profiles gained their version binding (a locked ruling), so their
    // content hash -- which every component-level specification embeds -- changed, and with it those ids
    for (const c of matrix.componentProfiles) expect(c.version).toBe('0.3.0-illustrative');
    for (const p of matrix.systemProfiles) expect(p.version).toBe('0.2.0-illustrative');
  });

  it('a specification never carries STANDARD: the default has one representation', () => {
    const s = spec(run(RATE, PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, STEM));
    expect(LearningApproachResolutionSchema.safeParse({ ...clone(s.learningApproach), approachId: 'STANDARD' }).error?.issues.map((i) => i.message)).toContain('STANDARD_IS_RECORDED_BY_ABSENCE');
    expect(refusal(run(RATE, PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, { approach: { approachId: 'STEM_PLUS' } }))).toBe('LEARNING_APPROACH_INVALID');
  });
});

describe('STEM_PLUS: emphasis, preferences and the conflict rule', () => {
  it('references the existing competency catalogue; it is not a second registry', () => {
    const catalogue = new Set(DEV_COMPETENCIES.map((c) => c.code));
    expect(STEM_PLUS_APPROACH.transversalCompetencies.map((c) => c.key)).toEqual(['SCIENTIFIC_INQUIRY', 'MATHEMATICAL_MODELLING', 'ENGINEERING_DESIGN', 'DATA_AND_COMPUTATIONAL_REASONING', 'PROBLEM_SOLVING_AND_TRANSFER', 'SCIENTIFIC_COMMUNICATION_AND_ARGUMENTATION']);
    for (const c of STEM_PLUS_APPROACH.transversalCompetencies) {
      // IN_CATALOGUE names a code the catalogue holds; NOT_YET_IN_CATALOGUE names one it does not, and says who would create it
      if (c.reference.catalogueStatus === 'IN_CATALOGUE') expect(catalogue.has(c.reference.code), c.key).toBe(true);
      else { expect(catalogue.has(c.reference.proposedCode), c.key).toBe(false); expect(c.reference.toBeCreatedBy).toBe('CURRICULUM'); }
    }
    expect(STEM_PLUS_APPROACH.transversalCompetencies.filter((c) => c.reference.catalogueStatus === 'IN_CATALOGUE').map((c) => [c.key, competencyCodeOf(c.reference)])).toEqual([['SCIENTIFIC_INQUIRY', 'dev.comp.scientific-inquiry']]);
    // what the repository's catalogue holds today: eight competencies, three of them the Saber 11 ones
    expect(DEV_COMPETENCIES.map((c) => c.code)).toEqual(['dev.comp.math-reasoning', 'dev.comp.reading', 'dev.comp.writing', 'dev.comp.english', 'dev.comp.scientific-inquiry', 'icfes.saber11.mat.interpretacion', 'icfes.saber11.mat.formulacion', 'icfes.saber11.mat.argumentacion']);
    // no competency table, registry or catalogue is defined in the new directories
    for (const f of [...walk(APPROACH_DIR), ...walk(ADAPTATION_DIR)]) expect(code(f), f).not.toMatch(/COMPETENCY_REGISTRY|COMPETENCY_CATALOGUE|registerCompetency|createCompetency|INSERT INTO competencies/i);
    // the families reference the same codes the approach does
    expect(Object.entries(TRANSVERSAL).map(([key, code]) => [key, code])).toEqual(STEM_PLUS_APPROACH.transversalCompetencies.filter((c) => c.key in TRANSVERSAL).map((c) => [c.key, competencyCodeOf(c.reference)]));
    expect(STEM_PLUS_APPROACH.status).toBe('PROVISIONAL');
  });

  it('STEM_PLUS changes only what an approach controls, and records what it did', () => {
    const standard = spec(run(CLAIM, SCHOOL, null));
    const stem = spec(run(CLAIM, SCHOOL, null, STEM));
    expect(differingDimensions(standard, stem)).toEqual(['responseFormat', 'reasoningDepth', 'distractors']);
    expect([standard.variable.responseFormat.format, stem.variable.responseFormat.format, standard.variable.reasoningDepth.depth, stem.variable.reasoningDepth.depth]).toEqual(['SELECTED_RESPONSE', 'EXTENDED_RESPONSE', 'ANSWER_ONLY', 'JUSTIFIED_ARGUMENT']);
    const la = stem.learningApproach!;
    expect(la).toMatchObject({ approachId: 'STEM_PLUS', version: STEM_PLUS_APPROACH.version, status: 'PROVISIONAL', authority: 'STUDYUS_POLICY', participation: { mode: 'INDIVIDUAL', evidenceYield: 'INDIVIDUAL_EVIDENCE' }, unmetPreferences: [] });
    expect(la.honouredPreferences.map((h) => `${h.preferenceId}=${h.decided}`)).toEqual(['stem-plus.response.constructed=EXTENDED_RESPONSE', 'stem-plus.context.situated=SCIENTIFIC', 'stem-plus.tools.available=ALLOWED', 'stem-plus.stimulus.data=OWN_STIMULUS', 'stem-plus.reasoning.justified=JUSTIFIED_ARGUMENT']);
    // the family says which of the approach's competencies it can evidence; the others are listed as not served
    expect(la.transversalCompetencies.filter((c) => c.servedByFamily).map((c) => c.key)).toEqual(['DATA_AND_COMPUTATIONAL_REASONING', 'SCIENTIFIC_COMMUNICATION_AND_ARGUMENTATION']);
    expect(la.transversalCompetencies.map((c) => c.catalogueStatus)).toEqual(['IN_CATALOGUE', 'NOT_YET_IN_CATALOGUE', 'NOT_YET_IN_CATALOGUE', 'NOT_YET_IN_CATALOGUE', 'NOT_YET_IN_CATALOGUE', 'NOT_YET_IN_CATALOGUE']);
    // provenance: the dimension the approach chose says so
    expect(PROVENANCE_ORIGINS).toContain('LEARNING_APPROACH_PREFERENCE');
    expect(stem.provenance.responseFormat[stem.provenance.responseFormat.length - 1]).toEqual({ origin: 'LEARNING_APPROACH_PREFERENCE', ref: 'stem-plus.response.constructed', authority: 'STUDYUS_POLICY' });
    expect(standard.provenance.responseFormat.some((p) => p.origin === 'LEARNING_APPROACH_PREFERENCE')).toBe(false);
    // it is a valid, intact specification, and another one than STANDARD's
    expect(AdaptationSpecificationSchema.safeParse(stem).success).toBe(true);
    expect(specificationIntegrityIssues(stem)).toEqual([]);
    expect(stem.specificationId).not.toBe(standard.specificationId);
    expect(Object.isFrozen(stem.learningApproach) && Object.isFrozen(stem.learningApproach!.unmetPreferences)).toBe(true);
    // deterministic
    expect(canonicalJson(spec(run(clone(CLAIM), clone(SCHOOL), null, { approach: clone(STEM_PLUS_APPROACH) })))).toBe(canonicalJson(stem));
  });

  it('an OFFICIAL assessment constraint wins over a STEM_PLUS preference, and the unmet preference is recorded with the rule that overrode it', () => {
    const s = spec(run(RATE, PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT, STEM));
    // the official formats of PAA Matemáticas are selected response and a produced number: no constructed response
    expect(s.variable.responseFormat.format).toBe('SELECTED_RESPONSE');
    expect(s.variable.toolPolicy.calculator).toBe('NONE');
    const unmet = s.learningApproach!.unmetPreferences;
    expect(unmet.find((u) => u.preferenceId === 'stem-plus.response.constructed')).toEqual({ preferenceId: 'stem-plus.response.constructed', dimension: 'responseFormat', strength: 'PREFERRED', wanted: ['EXTENDED_RESPONSE', 'SHORT_RESPONSE'], decided: 'SELECTED_RESPONSE', overriddenBy: { origin: 'COMPONENT_PROFILE_RULE', ref: 'paa.matematicas.response-formats', authority: 'OFFICIAL' } });
    expect(unmet.find((u) => u.preferenceId === 'stem-plus.tools.available')!.overriddenBy).toEqual({ origin: 'COMPONENT_PROFILE_RULE', ref: 'paa.matematicas.calculator', authority: 'OFFICIAL' });
    // the same specification as STANDARD's in everything the official rules fix
    const standard = spec(run(RATE, PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT));
    expect(differingDimensions(standard, s)).toEqual(['context']);
    // PISA's official context categories exclude a context-free task: there the approach and the official rule agree
    const pisa = spec(run(RATE, PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, STEM));
    expect(pisa.learningApproach!.honouredPreferences.map((h) => h.preferenceId)).toEqual(expect.arrayContaining(['stem-plus.context.situated', 'stem-plus.tools.available']));
    expect(pisa.learningApproach!.unmetPreferences.find((u) => u.preferenceId === 'stem-plus.response.constructed')!.overriddenBy.authority).toBe('OFFICIAL');
  });

  it('STUDYUS POLICY (flagged): a profile rule of ANY authority constrains; the approach chooses within it and never widens it', () => {
    const s = spec(run(RATE, PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT, STEM));
    // the reasoning depth of a closed response is a StudyUs-policy rule of the profile: the approach does not raise it
    expect(s.variable.reasoningDepth.depth).toBe('ANSWER_ONLY');
    expect(s.learningApproach!.unmetPreferences.find((u) => u.preferenceId === 'stem-plus.reasoning.justified')!.overriddenBy).toEqual({ origin: 'SYSTEM_PROFILE_RULE', ref: 'paa.reasoning', authority: 'STUDYUS_POLICY' });
    // an institution's rule constrains in the same way: a school that allows no calculator overrides the tool preference
    const noTools = clone(SCHOOL);
    noTools.rules.calculatorPolicy = { ruleId: 'school-stem.calculator', value: { allowed: ['NONE'] }, authority: { kind: 'INSTITUTION_POLICY', institutionKey: ILLUSTRATIVE_INSTITUTION_KEY, statement: 'The school allows no calculator in this assessment.' } };
    const school = spec(run(RATE, noTools, null, STEM));
    expect(school.variable.toolPolicy.calculator).toBe('NONE');
    expect(school.learningApproach!.unmetPreferences.find((u) => u.preferenceId === 'stem-plus.tools.available')!.overriddenBy).toEqual({ origin: 'SYSTEM_PROFILE_RULE', ref: 'school-stem.calculator', authority: 'INSTITUTION_POLICY' });
    // what the family needs is not the approach's to change either: a task with no stimulus stays without one
    expect(s.variable.stimulus.mode).toBe('NONE');
    expect(s.learningApproach!.unmetPreferences.find((u) => u.preferenceId === 'stem-plus.stimulus.data')!.overriddenBy).toEqual({ origin: 'FAMILY', ref: 'responseConstraints.stimulusNeed', authority: null });
    // and an explicit request beats a preference, on the record
    const asked = spec(run(CLAIM, SCHOOL, null, { ...STEM, request: { responseFormat: 'SELECTED_RESPONSE' } }));
    expect(asked.learningApproach!.unmetPreferences.find((u) => u.dimension === 'responseFormat')!.overriddenBy).toEqual({ origin: 'REQUEST', ref: 'responseFormat', authority: null });
    // every unmet preference of every proof-of-concept cell names its overrider; none is dropped
    for (const c of POC.cells) if (c.learningApproach) {
      expect(c.learningApproach.honoured.length + c.learningApproach.unmet.length, `${c.country} ${c.targetId} ${c.familyId}`).toBe(STEM_PLUS_APPROACH.preferences.length);
      for (const u of c.learningApproach.unmet) expect(u.overriddenBy.ref.length).toBeGreaterThan(0);
    }
  });

  it('a preference REQUIRED_OUTSIDE_EXAMS refuses in a school\'s own assessment and yields, on the record, against an exam system', () => {
    // FACTORISING has no situation; STEM+ requires one outside exams
    const school = run(FACTORISING, SCHOOL, null, STEM);
    expect(school).toMatchObject({ ok: false, refusal: { code: 'LEARNING_APPROACH_REQUIREMENT_UNMET' } });
    expect(!school.ok && school.refusal.detail).toMatch(/stem-plus\.context\.situated: wanted SCIENTIFIC \/ SOCIETAL \/ OCCUPATIONAL \/ PERSONAL, decided ABSTRACT \(FAMILY supportedContexts\)/);
    // under STANDARD the same task is fine for the school
    expect(run(FACTORISING, SCHOOL, null).ok).toBe(true);
    // against an exam system the requirement yields: a specification, with the preference recorded as unmet
    const paa = spec(run(FACTORISING, PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT, STEM));
    expect(paa.learningApproach!.unmetPreferences.find((u) => u.preferenceId === 'stem-plus.context.situated')).toMatchObject({ strength: 'REQUIRED_OUTSIDE_EXAMS', decided: 'ABSTRACT', overriddenBy: { origin: 'FAMILY', ref: 'supportedContexts' } });
    // a merely PREFERRED preference never refuses, anywhere
    const soft: LearningApproachProfile = { ...clone(STEM_PLUS_APPROACH), preferences: STEM_PLUS_APPROACH.preferences.map((p) => ({ ...p, strength: 'PREFERRED' as const })) };
    expect(run(FACTORISING, SCHOOL, null, { approach: soft }).ok).toBe(true);
  });
});

describe('individual evidence vs collaborative activity', () => {
  it('a collaborative activity yields a group artefact, never individual evidence by itself', () => {
    expect([evidenceYieldOf('INDIVIDUAL'), evidenceYieldOf('COLLABORATIVE')]).toEqual(['INDIVIDUAL_EVIDENCE', 'GROUP_ARTEFACT_ONLY']);
    const group = spec(run(RATE, SCHOOL, null, { ...STEM, request: { participationMode: 'COLLABORATIVE' } }));
    expect(group.learningApproach!.participation).toEqual({ mode: 'COLLABORATIVE', evidenceYield: 'GROUP_ARTEFACT_ONLY' });
    expect(group.contentUseClass).toBe('DEV_TEST_CONTENT');
    // it can never be evidence-bearing content -- even from a reviewed family under a certified profile
    expect(refusal(run(reviewed(RATE), certified(SCHOOL), null, { ...STEM, request: { participationMode: 'COLLABORATIVE', contentUseClass: 'EVIDENCE_BEARING' } }))).toBe('COLLABORATIVE_ACTIVITY_IS_NOT_INDIVIDUAL_EVIDENCE');
    // the individual version of the same task is another specification, with the same invariants
    const alone = spec(run(RATE, SCHOOL, null, STEM));
    expect([alone.learningApproach!.participation.mode, alone.invariantHash === group.invariantHash, alone.specificationId === group.specificationId]).toEqual(['INDIVIDUAL', true, false]);
  });

  it('collaborative work needs an approach that uses it, a family that declares it and a target that is not an exam system', () => {
    const collaborative = { request: { participationMode: 'COLLABORATIVE' as const } };
    expect(refusal(run(RATE, SCHOOL, null, collaborative))).toBe('PARTICIPATION_MODE_NOT_ALLOWED');
    expect(refusal(run(RATE, SCHOOL, null, { ...collaborative, approach: STANDARD_APPROACH }))).toBe('PARTICIPATION_MODE_NOT_ALLOWED');
    expect(refusal(run(CLAIM, SCHOOL, null, { ...collaborative, ...STEM }))).toBe('PARTICIPATION_MODE_NOT_ALLOWED');
    expect(refusal(run(RATE, PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, { ...collaborative, ...STEM }))).toBe('PARTICIPATION_MODE_NOT_ALLOWED');
    // an EA-1 family declares nothing, so it supports individual work only
    expect(mathPocFamilyOf(RATE.familyId)!.approachSupport).toBeUndefined();
    const ea1 = { ...mathPocFamilyOf(RATE.familyId)!, profileSupport: { ...mathPocFamilyOf(RATE.familyId)!.profileSupport, SCHOOL_STEM_PERFORMANCE: { status: 'SUPPORTED' as const } } };
    expect(refusal(run(ea1, SCHOOL, null, { ...collaborative, ...STEM }))).toBe('PARTICIPATION_MODE_NOT_ALLOWED');
    expect(LearningApproachProfileSchema.safeParse({ ...clone(STEM_PLUS_APPROACH), participationModes: ['COLLABORATIVE'] }).error?.issues.map((i) => i.message)).toContain('INDIVIDUAL_WORK_IS_ALWAYS_POSSIBLE');
  });
});

describe('task-family integration', () => {
  it('the STEM family types are declared in the extensible registry; none is implemented, and SCIENCE_INVESTIGATION resolves to SCIENTIFIC_INVESTIGATION', () => {
    for (const t of ['SCIENCE_PROBLEM', 'SCIENTIFIC_INVESTIGATION', 'ENGINEERING_DESIGN', 'MATHEMATICAL_MODELLING', 'DATA_ANALYSIS', 'COMPUTATIONAL_PROBLEM', 'INTERDISCIPLINARY_CHALLENGE']) {
      expect(KNOWN_FAMILY_TYPES[t], t).toMatchObject({ status: 'DECLARED' });
      expect(KNOWN_FAMILY_TYPES[t].intendedSpecializationFields.length, t).toBeGreaterThanOrEqual(5);
      expect(DEFAULT_TASK_FAMILY_REGISTRY.specializationOf(t)).toBeNull();
      expect(DEFAULT_TASK_FAMILY_REGISTRY.validate({ ...clone(RATE), familyType: t })).toMatchObject({ ok: false, issue: 'FAMILY_TYPE_NOT_REGISTERED' });
    }
    expect(Object.entries(KNOWN_FAMILY_TYPES).filter(([, t]) => t.status === 'IMPLEMENTED').map(([k]) => k)).toEqual(['MATH_PROBLEM']);
    expect(DEFAULT_TASK_FAMILY_REGISTRY.familyTypes()).toEqual(['MATH_PROBLEM']);
    // the EA-1 name: an alias, not a second type
    expect(FAMILY_TYPE_ALIASES).toEqual({ SCIENCE_INVESTIGATION: 'SCIENTIFIC_INVESTIGATION' });
    expect(KNOWN_FAMILY_TYPES).not.toHaveProperty('SCIENCE_INVESTIGATION');
    expect([canonicalFamilyType('SCIENCE_INVESTIGATION'), canonicalFamilyType('MATH_PROBLEM'), knownFamilyType('SCIENCE_INVESTIGATION')?.status, knownFamilyType('NOT_A_TYPE')]).toEqual(['SCIENTIFIC_INVESTIGATION', 'MATH_PROBLEM', 'DECLARED', null]);
    // a declared type is extended by registering a schema, as in EA-1: the common schema does not change
    const before = canonicalJson(Object.keys(TaskFamilyCommonSchema.shape));
    DEFAULT_TASK_FAMILY_REGISTRY.with({ familyType: 'ENGINEERING_DESIGN', discipline: 'ENGINEERING', version: 'test', schema: TaskFamilyCommonSchema.shape.familyId as never, adaptationFacts: () => ({ invariantConstruct: null, toolDependency: 'NONE', parameterization: null, misconceptionModelIds: [] }) });
    expect(canonicalJson(Object.keys(TaskFamilyCommonSchema.shape))).toBe(before);
  });

  it('modelling and data analysis stay BEHAVIOURS of MATH_PROBLEM for the EA-1 families: none changed type, version or content', () => {
    for (const f of MATH_POC_FAMILIES) expect([f.familyType, f.version, f.approachSupport], f.familyId).toEqual(['MATH_PROBLEM', '0.1.0-draft', undefined]);
    // the modelling and data families of EA-1 are still what they were, and still valid
    for (const id of ['tf.math.proportion.rate-comparison-model', 'tf.math.linear.constant-rate-model', 'tf.math.quadratic.optimum-of-a-model', 'tf.math.data.judge-claim-against-display']) expect(DEFAULT_TASK_FAMILY_REGISTRY.validate(mathPocFamilyOf(id)).ok, id).toBe(true);
    expect([KNOWN_FAMILY_TYPES.MATHEMATICAL_MODELLING.discipline, KNOWN_FAMILY_TYPES.DATA_ANALYSIS.discipline]).toEqual(['TRANSVERSAL_STEM', 'TRANSVERSAL_STEM']);
  });

  it('a family may declare what an approach can ask of it -- additively: same family, same concept, same invariant hash, new version', () => {
    expect(MATH_POC_FAMILIES_EA1A.map((f) => [f.familyId, f.version, f.lifecycle, f.reviewStatus])).toEqual([['tf.math.proportion.rate-comparison-model', '0.2.0-draft', 'DRAFT', 'UNREVIEWED'], ['tf.math.data.judge-claim-against-display', '0.2.0-draft', 'DRAFT', 'UNREVIEWED'], ['tf.math.quadratic.solve-by-factorising', '0.2.0-draft', 'DRAFT', 'UNREVIEWED']]);
    for (const f of MATH_POC_FAMILIES_EA1A) {
      expect(DEFAULT_TASK_FAMILY_REGISTRY.validate(f).ok, f.familyId).toBe(true);
      const ea1 = mathPocFamilyOf(f.familyId)!;
      // only the version, the support for one more assessment system and the approach support differ
      const { version: _v, profileSupport, approachSupport: _a, ...rest } = f;
      const { version: _v1, profileSupport: support1, ...rest1 } = ea1;
      expect(canonicalJson(rest)).toBe(canonicalJson(rest1));
      expect(canonicalJson({ ...profileSupport, SCHOOL_STEM_PERFORMANCE: undefined })).toBe(canonicalJson(support1));
      // hence the same invariants under any target
      expect(spec(run(f, PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT)).invariantHash).toBe(spec(run(ea1, PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT)).invariantHash);
      // it names no approach and no curriculum
      expect(JSON.stringify(f.approachSupport)).not.toMatch(/STEM_PLUS|STANDARD|MCCEMS|MEN/);
    }
    expect(RATE.approachSupport).toEqual({ transversalCompetencies: [TRANSVERSAL.MATHEMATICAL_MODELLING, TRANSVERSAL.PROBLEM_SOLVING_AND_TRANSFER], participationModes: ['INDIVIDUAL', 'COLLABORATIVE'] });
    expect(FACTORISING.approachSupport).toEqual({ transversalCompetencies: [], participationModes: ['INDIVIDUAL'] });
    expect(TaskFamilyCommonSchema.safeParse({ ...clone(RATE), approachSupport: { transversalCompetencies: [], participationModes: ['COLLABORATIVE'] } }).error?.issues.map((i) => i.message)).toContain('APPROACH_SUPPORT_INVALID');
    expect(TaskFamilyCommonSchema.safeParse({ ...clone(RATE), approachSupport: { ...RATE.approachSupport, approachId: 'STEM_PLUS' } }).success).toBe(false);
  });
});

describe('institution configuration: Institution -> CurriculumProfile -> LearningApproachProfile', () => {
  it('resolves the approach in force; STANDARD when none is configured and for a learner with no institution', () => {
    const by = (key: string) => resolveEffectiveApproach(EA1A_EXAMPLE_CONFIGURATIONS.find((c) => c.institutionKey === key), LEARNING_APPROACHES);
    const row = (key: string) => { const r = by(key); return r.ok ? [r.curriculumId, r.approach.approachId, r.source] : [r.issue]; };
    expect(EA1A_EXAMPLE_CONFIGURATIONS.map((c) => row(c.institutionKey))).toEqual([
      ['MX.SEP.MCCEMS', 'STANDARD', 'DEFAULT_NO_APPROACH_CONFIGURED'], ['MX.SEP.MCCEMS', 'STEM_PLUS', 'INSTITUTION_CONFIGURATION'],
      ['CO.MEN.EBC_DBA', 'STANDARD', 'DEFAULT_NO_APPROACH_CONFIGURED'], ['CO.MEN.EBC_DBA', 'STEM_PLUS', 'INSTITUTION_CONFIGURATION'],
    ]);
    for (const none of [null, undefined]) expect(resolveEffectiveApproach(none, LEARNING_APPROACHES)).toMatchObject({ ok: true, approach: { approachId: 'STANDARD' }, source: 'DEFAULT_NO_INSTITUTION', institutionKey: null });
    expect(resolveEffectiveApproach({ institutionKey: 'x', curriculumId: 'MX.SEP.MCCEMS', learningApproach: { approachId: 'STANDARD', version: null } }, LEARNING_APPROACHES)).toMatchObject({ ok: true, approach: { approachId: 'STANDARD' }, source: 'INSTITUTION_CONFIGURATION' });
    // a configured approach that does not exist is an error, never a silent STANDARD
    expect(resolveEffectiveApproach({ institutionKey: 'x', curriculumId: 'MX.SEP.MCCEMS', learningApproach: { approachId: 'MONTESSORI', version: null } }, LEARNING_APPROACHES)).toEqual({ ok: false, issue: 'UNKNOWN_LEARNING_APPROACH', detail: 'MONTESSORI' });
    expect(resolveEffectiveApproach({ institutionKey: 'x', curriculumId: 'MX.SEP.MCCEMS', learningApproach: { approachId: 'STEM_PLUS', version: '9' } }, LEARNING_APPROACHES)).toMatchObject({ ok: false, issue: 'LEARNING_APPROACH_VERSION_NOT_FOUND' });
    expect(resolveEffectiveApproach({ institutionKey: 'x' }, LEARNING_APPROACHES)).toMatchObject({ ok: false, issue: 'CONFIGURATION_INVALID' });
    // the same curriculum under two approaches, the same approach under two curricula: the layers compose freely
    expect(new Set(EA1A_EXAMPLE_CONFIGURATIONS.map((c) => `${c.curriculumId}|${c.learningApproach?.approachId ?? 'STANDARD'}`)).size).toBe(4);
  });

  it('the curriculum profiles name only what the repository records for MCCEMS and MEN: reference metadata, structure NOT imported', () => {
    // the seed script opens a database when run, so it is READ here, never imported
    const seed = read('scripts/operations/seed-education-authorities.ts');
    for (const c of EA1A_CURRICULUM_PROFILES) for (const recorded of [c.authorityName, c.programmeName, c.programmeVersion]) expect(seed.includes(`'${recorded}'`), `${c.curriculumId}: ${recorded}`).toBe(true);
    expect(seed).toMatch(/name: 'Secretaría de Educación Pública \(SEP\)',\s*country: 'MX'/);
    expect(seed).toMatch(/name: 'Ministerio de Educación Nacional \(MEN\)',\s*country: 'CO'/);
    // what the repository holds for them: a programme and one mathematics subject each, linked to the canonical SUBJECT only
    expect(seed).toMatch(/subjects: \[\{ name: 'Pensamiento Matemático', canonicalSubject: 'Matemáticas', qualification: 'Bachillerato general', level: null, version: 'MCCEMS 2023' \}\]/);
    expect(seed).toMatch(/name: 'Estándares Básicos de Competencias y DBA',[\s\S]{0,120}subjects: \[\{ name: 'Matemáticas', canonicalSubject: 'Matemáticas'/);
    expect(seed).not.toMatch(/learning_objectives|objective_concept_mappings|canonical_concepts/);
    expect(read('scripts/operations/seed-education-authorities.ts')).toMatch(/STRUCTURE_NOT_IMPORTED/);
    for (const c of EA1A_CURRICULUM_PROFILES) expect(c.structureStatus).toBe('STRUCTURE_NOT_IMPORTED');
    // no exam family of the taxonomy is a national curriculum, and no profile pretends to be one
    for (const f of ['SEP', 'MEN', 'MCCEMS']) expect(EXAM_FAMILIES as readonly string[]).not.toContain(f);
  });

  it('curriculum entitlement is read, never invented: with no mapping in the repository it is NOT_ESTABLISHED and evidence-bearing content is refused', () => {
    expect(EA1A_CURRICULUM_ENTITLEMENT).toEqual([]);
    const concept = RATE.primaryConcepts[0];
    expect(resolveEntitlement(EA1A_CURRICULUM_ENTITLEMENT, concept, MX_MCCEMS_CURRICULUM)).toEqual({ status: 'NOT_ESTABLISHED', basis: 'NONE', curriculumId: 'MX.SEP.MCCEMS', structureStatus: 'STRUCTURE_NOT_IMPORTED', evidenceReferences: [] });
    const s = spec(run(RATE, PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, { curriculum: MX_MCCEMS_CURRICULUM }));
    expect(s.curriculumContext).toEqual({ curriculumId: 'MX.SEP.MCCEMS', country: 'MX', programmeName: MX_MCCEMS_CURRICULUM.programmeName, programmeVersion: 'MCCEMS 2023', structureStatus: 'STRUCTURE_NOT_IMPORTED', entitlement: { status: 'NOT_ESTABLISHED', basis: 'NONE', evidenceReferences: [] } });
    // a structure mapping claimed for a structure that was never imported is not believed
    const claimed = [{ concept: { stableId: concept.stableId, canonicalSubject: concept.canonicalSubject }, curriculumId: 'MX.SEP.MCCEMS', basis: 'CURRICULUM_STRUCTURE_MAPPING', evidenceReference: 'mccems.pm.unidad-1', recordedIn: 'nowhere in the repository' }];
    expect(resolveEntitlement(claimed as never, concept, MX_MCCEMS_CURRICULUM).status).toBe('NOT_ESTABLISHED');
    expect(resolveEntitlement(claimed as never, concept, { ...MX_MCCEMS_CURRICULUM, structureStatus: 'STRUCTURE_IMPORTED' })).toMatchObject({ status: 'ESTABLISHED', basis: 'CURRICULUM_STRUCTURE_MAPPING', evidenceReferences: ['mccems.pm.unidad-1'] });
    // same subject label is not entitlement, and the other subject's concept of the same id is another concept
    expect(resolveEntitlement([{ ...claimed[0], basis: 'INSTITUTION_CURRICULUM_SELECTION' }] as never, { stableId: concept.stableId, canonicalSubject: 'Mathematics' }, MX_MCCEMS_CURRICULUM).status).toBe('NOT_ESTABLISHED');
    // evidence-bearing content for a curriculum needs entitlement, whatever else is in order (test doubles: reviewed family, certified profiles)
    const evidence = { request: { contentUseClass: 'EVIDENCE_BEARING' as const }, curriculum: MX_MCCEMS_CURRICULUM };
    expect(refusal(run(reviewed(RATE), certified(PISA_SYSTEM_PROFILE), certified(PISA_MATHEMATICS_COMPONENT), evidence))).toBe('CURRICULUM_ENTITLEMENT_NOT_ESTABLISHED');
    expect(run(reviewed(RATE), certified(PISA_SYSTEM_PROFILE), certified(PISA_MATHEMATICS_COMPONENT), { ...evidence, entitlement: [{ ...claimed[0], basis: 'INSTITUTION_CURRICULUM_SELECTION' }] }).ok).toBe(true);
    expect(refusal(run(RATE, PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, { curriculum: { curriculumId: 'mexico' } }))).toBe('CURRICULUM_PROFILE_INVALID');
  });
});

describe('INSTITUTION_POLICY and the school STEM performance profile', () => {
  it('three authorities that are never confusable: an institution\'s rule names the institution, cites no source and is never OFFICIAL', () => {
    expect([...RULE_AUTHORITIES]).toEqual(['OFFICIAL', 'STUDYUS_POLICY', 'INSTITUTION_POLICY']);
    expect([...SPECIFICATION_BASES]).toEqual(['MIXED_AUTHORITY', 'STUDYUS_POLICY_ONLY', 'INSTITUTION_POLICY']);
    const rule = { kind: 'INSTITUTION_POLICY', institutionKey: 'institution.x', statement: 'The school decided this for its own assessment.' };
    expect(RuleAuthoritySchema.safeParse(rule).success).toBe(true);
    for (const bad of [{ ...rule, institutionKey: undefined }, { ...rule, sources: [{ sourceKey: 'cb-paa-guia-2021', locator: 'x y z' }] }, { ...rule, provisional: true }, { kind: 'INSTITUTION_POLICY' }]) expect(RuleAuthoritySchema.safeParse(bad).success).toBe(false);
    // an OFFICIAL rule cannot be given an institution, and an institution's rule cannot be given a source
    expect(RuleAuthoritySchema.safeParse({ kind: 'OFFICIAL', institutionKey: 'institution.x', sources: [{ sourceKey: 'cb-paa-guia-2021', locator: 'x y z' }] }).success).toBe(false);
    // an institution's rule cannot sit in the profile of an exam system
    const paa = clone(PAA_SYSTEM_PROFILE);
    (paa.rules.rubricStyle as { authority: unknown }).authority = rule;
    expect(AssessmentSystemProfileSchema.safeParse(paa).error?.issues.map((i) => i.message)).toContain('INSTITUTION_RULE_ONLY_IN_AN_INSTITUTION_PROFILE');
    const component = clone(PAA_MATEMATICAS_COMPONENT);
    (component.overrides.calculatorPolicy as { authority: unknown }).authority = rule;
    expect(AssessmentComponentProfileSchema.safeParse(component).error?.issues.map((i) => i.message)).toContain('INSTITUTION_RULE_ONLY_IN_AN_INSTITUTION_PROFILE');
    // no profile of an exam system holds one
    for (const p of EA1_SYSTEM_PROFILES) expect(authorityBreakdown(p).institutionPolicy).toEqual([]);
  });

  it('SCHOOL_STEM_PERFORMANCE is an institution\'s assessment: no exam family, no official rule, no source, illustrative -- it pretends to be nothing else', () => {
    expect(AssessmentSystemProfileSchema.safeParse(SCHOOL).success).toBe(true);
    expect([SCHOOL.profileId, SCHOOL.examFamilyCode, SCHOOL.status, SCHOOL.certification, SCHOOL.specification.basis, SCHOOL.specification.records, SCHOOL.componentDependentDimensions]).toEqual(['SCHOOL_STEM_PERFORMANCE', null, 'PROVISIONAL_ILLUSTRATIVE', null, 'INSTITUTION_POLICY', [], []]);
    const b = authorityBreakdown(SCHOOL);
    expect([b.official, b.institutionPolicy, b.studyusPolicy.length]).toEqual([[], ['stimulusExpectations', 'rubricStyle'], 13]);
    expect(JSON.stringify(SCHOOL)).not.toMatch(/\bSEP\b|\bMEN\b|MCCEMS|\bIB\b|PISA|Icfes|ICFES|PAA|Cambridge|sourceKey/);
    // it cannot claim an exam family, and it cannot hold an official rule
    expect(AssessmentSystemProfileSchema.safeParse({ ...clone(SCHOOL), examFamilyCode: 'PISA' }).error?.issues.map((i) => i.message)).toContain('INSTITUTION_ASSESSMENT_IS_NOT_AN_EXAM_FAMILY');
    const official = clone(SCHOOL);
    (official.rules.calculatorPolicy as { authority: unknown }).authority = { kind: 'OFFICIAL', sources: [{ sourceKey: 'oecd-pisa-2022-framework', locator: 'anywhere' }] };
    expect(AssessmentSystemProfileSchema.safeParse(official).error?.issues.map((i) => i.message)).toContain('INSTITUTION_POLICY_HOLDS_NO_OFFICIAL_RULE');
    // a specification made with it records the institution's rules as such, never as official
    const s = spec(run(CLAIM, SCHOOL, null, STEM));
    expect(new Set(Object.values(s.provenance).flat().map((p) => p.authority))).toEqual(new Set(['INSTITUTION_POLICY', 'STUDYUS_POLICY', null]));
    expect(s.provenance.rubricStyle).toEqual([{ origin: 'SYSTEM_PROFILE_RULE', ref: 'school-stem.rubric', authority: 'INSTITUTION_POLICY' }]);
    expect([s.systemProfile.examFamilyCode, s.componentProfile, s.assessmentApplicability.status]).toEqual([null, null, 'NOT_ESTABLISHED']);
    // illustrative: dev-test content only
    expect(refusal(run(reviewed(CLAIM), SCHOOL, null, { request: { contentUseClass: 'EVIDENCE_BEARING' } }))).toBe('ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT');
  });
});

describe('locked rulings', () => {
  it('protected mock pools refuse DEV_TEST_CONTENT; Diagnostic and Verification take it only as non-evidence test content', () => {
    expect([...PROTECTED_MOCK_POOLS]).toEqual(['REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']);
    for (const purpose of PROTECTED_MOCK_POOLS) {
      expect(instancePolicyFor(purpose, 'DEV_TEST_CONTENT')).toMatchObject({ permitted: false, allowedClasses: [], basis: 'USER_DECISION' });
      expect(instancePolicyFor(purpose, 'EVIDENCE_BEARING')).toMatchObject({ permitted: true, allowedClasses: ['CERTIFIED_FROZEN'] });
      for (const approach of [undefined, STEM_PLUS_APPROACH]) expect(refusal(run(RATE, PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT, { approach, request: { purpose } }))).toBe('DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE');
    }
    for (const purpose of ['DIAGNOSTIC', 'VERIFICATION'] as const) {
      expect(instancePolicyFor(purpose, 'DEV_TEST_CONTENT')).toMatchObject({ permitted: true, allowedClasses: ['DYNAMIC', 'CERTIFIED_FROZEN'], basis: 'USER_DECISION' });
      expect(instancePolicyFor(purpose, 'DEV_TEST_CONTENT').reason).toMatch(/non-evidence test execution/);
      expect(instancePolicyFor(purpose, 'EVIDENCE_BEARING').allowedClasses).toEqual(['CERTIFIED_FROZEN']);
    }
  });

  it('a PROVISIONAL / ILLUSTRATIVE assessment profile generates DEV_TEST_CONTENT only', () => {
    const evidence = { request: { contentUseClass: 'EVIDENCE_BEARING' as const } };
    expect(refusal(run(reviewed(RATE), PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT, evidence))).toBe('ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT');
    expect(refusal(run(reviewed(RATE), certified(PAA_SYSTEM_PROFILE), PAA_MATEMATICAS_COMPONENT, evidence))).toBe('ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT');
    expect(run(reviewed(RATE), certified(PAA_SYSTEM_PROFILE), certified(PAA_MATEMATICAS_COMPONENT), evidence).ok).toBe(true);
    for (const p of [...EA1_SYSTEM_PROFILES, ...EA1_COMPONENT_PROFILES, SCHOOL]) expect(p.status).toBe('PROVISIONAL_ILLUSTRATIVE');
  });

  it('a component profile binds to a concrete exam / component version; an OFFICIAL rule without the binding is refused', () => {
    for (const c of EA1_COMPONENT_PROFILES) expect(c.versionBinding, c.componentId).toMatchObject({ configKey: expect.any(String), versionLabel: expect.any(String), componentKey: expect.any(String) });
    expect(AssessmentComponentProfileSchema.safeParse({ ...clone(PISA_MATHEMATICS_COMPONENT), versionBinding: null }).error?.issues.map((i) => i.message)).toContain('OFFICIAL_RULE_NEEDS_A_VERSION_BINDING');
    // the stable semantic key is for continuity only: with it and without a binding the component is still refused
    expect(AssessmentComponentProfileSchema.safeParse({ ...clone(PISA_MATHEMATICS_COMPONENT), versionBinding: null, semanticComponentKey: 'pisa.mathematics' }).success).toBe(false);
    expect(spec(run(RATE, PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT)).componentProfile!.versionBinding).toEqual({ source: 'EXAM_VERTICAL_CONFIGURATION', configKey: 'v2.pisa.math', versionLabel: 'V2 PISA 2022', componentKey: 'math' });
  });

  it('no stable key was added to canonical_concepts, no migration or SQL file was created, and nothing ingests dev-test content', () => {
    const migrations = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect([migrations.length, migrations[migrations.length - 1]]).toEqual([82, '20261112_1000_qb_review_requires_primary_attribution.sql']);
    expect(migrations.filter((f) => /canonical_concepts\s+ADD COLUMN|learning_approach|stem_plus/i.test(read(`database/migrations/${f}`)))).toEqual([]);
    for (const d of [APPROACH_DIR, ADAPTATION_DIR, FAMILIES_DIR]) for (const f of walk(d)) {
      expect(f.endsWith('.sql')).toBe(false);
      expect(code(f), f).not.toMatch(/INSERT INTO|UPDATE \w+ SET|DELETE FROM|createGeneratedItem|ingest[A-Z]\w*\(|from '@\/lib\/db'/);
    }
    expect(readdirSync(join(ROOT, 'docs/exams/assessment-adaptation')).filter((f) => f.endsWith('.sql'))).toEqual([]);
    // the rejected persistence sketch is filed as what it is
    const names = readdirSync(join(ROOT, 'docs/exams/assessment-adaptation'));
    expect(names).toContain('DRAFT_AUXILIARY_ADAPTATION_PERSISTENCE_SKETCH.md');
    expect(names).not.toContain('EA1A_ADAPTATION_PERSISTENCE_DESIGN.md');
    expect(read('docs/exams/assessment-adaptation/DRAFT_AUXILIARY_ADAPTATION_PERSISTENCE_SKETCH.md').slice(0, 400)).toMatch(/AUXILIARY DRAFT — NOT EA-1A, NOT CERTIFIED/);
    for (const f of [...walk('src'), ...walk('tests/unit').filter((x) => /ea1/.test(x)), ...walk('scripts/operations').filter((x) => /ea1/.test(x))]) if (!f.endsWith('ea1a-learning-approach.test.ts')) expect(read(f), f).not.toMatch(/EA1A_ADAPTATION_PERSISTENCE_DESIGN/);
  });
});

describe('Mexico and Colombia proofs of concept', () => {
  it('the stored artifact is exactly what the function produces', () => {
    expect(serializeLearningApproachPoc(POC)).toBe(read(LEARNING_APPROACH_POC_ARTIFACT));
    expect(serializeLearningApproachPoc(buildLearningApproachPoc())).toBe(serializeLearningApproachPoc(POC));
  });

  it('24 cells, 24 dev-test specifications: 2 countries x 2 approaches x 3 assessment targets x 2 families', () => {
    expect(POC.summary).toMatchObject({ cells: 24, specifications: 24, refusals: 0, standardEqualsNoApproach: true, contentUseClasses: { DEV_TEST_CONTENT: 24 }, approachChangedSomethingIn: 12 });
    expect([...new Set(POC.cells.filter((c) => c.country === 'MX').map((c) => c.targetId))]).toEqual(['PAA.MATEMATICAS', 'PISA.MATHEMATICS', 'SCHOOL_STEM_PERFORMANCE']);
    expect([...new Set(POC.cells.filter((c) => c.country === 'CO').map((c) => c.targetId))]).toEqual(['ICFES.SABER11_MATEMATICAS', 'PISA.MATHEMATICS', 'SCHOOL_STEM_PERFORMANCE']);
    expect([...new Set(POC.cells.map((c) => `${c.country}:${c.curriculumId}`))]).toEqual(['MX:MX.SEP.MCCEMS', 'CO:CO.MEN.EBC_DBA']);
    expect(POC.cells.map((c) => c.approachId).filter((a, i) => i < 2)).toEqual(['STANDARD', 'STEM_PLUS']);
    // the approach came from the institution configuration: STANDARD by default, STEM_PLUS where configured
    expect([...new Set(POC.cells.map((c) => `${c.approachId}<-${c.approachSource}`))]).toEqual(['STANDARD<-DEFAULT_NO_APPROACH_CONFIGURED', 'STEM_PLUS<-INSTITUTION_CONFIGURATION']);
    expect(new Set(POC.cells.map((c) => c.specificationId)).size).toBe(24);
    // STANDARD is recorded by absence
    for (const c of POC.cells) expect(c.learningApproach === null, `${c.country} ${c.approachId}`).toBe(c.approachId === 'STANDARD');
  });

  it('the same canonical concept is NOT duplicated: one stable id and one invariant hash per family across Mexico and Colombia, both approaches and four targets', () => {
    expect(POC.summary.conceptIdsPerFamily).toEqual({ 'tf.math.proportion.rate-comparison-model': ['math.num.ratio-proportion (Matemáticas)'], 'tf.math.data.judge-claim-against-display': ['math.stat.data-representation (Matemáticas)'] });
    expect(POC.summary.invariantHashesPerFamily).toEqual({ 'tf.math.proportion.rate-comparison-model': 1, 'tf.math.data.judge-claim-against-display': 1 });
    for (const id of LEARNING_APPROACH_POC_FAMILY_IDS) {
      const own = POC.cells.filter((c) => c.familyId === id);
      expect(new Set(own.map((c) => c.country)).size).toBe(2);
      expect(new Set(own.map((c) => `${c.conceptStableId}|${c.canonicalSubject}|${c.invariantHash}`)).size, id).toBe(1);
    }
    // and it is the invariant hash of the EA-1 version of the family
    for (const f of POC.families) expect(f.invariantHash, f.familyId).toBe(f.invariantHashOfTheEa1Version);
    for (const x of POC.comparisons) expect([x.invariantHashEqual, x.conceptEqual]).toEqual([true, true]);
    // PISA is the same target in both countries: the two specifications differ only in the curriculum they are for
    for (const id of LEARNING_APPROACH_POC_FAMILY_IDS) for (const approach of ['STANDARD', 'STEM_PLUS']) {
      const [mx, co] = ['MX', 'CO'].map((country) => POC.cells.find((c) => c.country === country && c.targetId === 'PISA.MATHEMATICS' && c.familyId === id && c.approachId === approach)!);
      expect(canonicalJson([mx.variable, mx.learningApproach, mx.applicability, mx.invariantHash])).toBe(canonicalJson([co.variable, co.learningApproach, co.applicability, co.invariantHash]));
      expect(mx.specificationId).not.toBe(co.specificationId);
    }
  });

  it('what the approach changed, and what the assessment profile forced', () => {
    const changed = (country: string, targetId: string, family: string) => POC.comparisons.find((x) => x.country === country && x.targetId === targetId && x.familyId === `tf.math.${family}`)!;
    // against an exam the official rules leave the approach only the context to choose
    for (const [country, targetId] of [['MX', 'PAA.MATEMATICAS'], ['MX', 'PISA.MATHEMATICS'], ['CO', 'ICFES.SABER11_MATEMATICAS'], ['CO', 'PISA.MATHEMATICS']]) for (const f of ['proportion.rate-comparison-model', 'data.judge-claim-against-display']) expect(changed(country, targetId, f).changedByApproach, `${country} ${targetId} ${f}`).toEqual(['context']);
    // in the school's own assessment it also gets the produced response and the justified argument it prefers
    for (const country of ['MX', 'CO']) for (const f of ['proportion.rate-comparison-model', 'data.judge-claim-against-display']) expect(changed(country, 'SCHOOL_STEM_PERFORMANCE', f).changedByApproach).toEqual(['responseFormat', 'reasoningDepth', 'distractors']);
    expect(changed('MX', 'SCHOOL_STEM_PERFORMANCE', 'data.judge-claim-against-display').unmet).toEqual([]);
    for (const x of POC.comparisons) for (const d of x.changedByApproach) expect(COMPARED_DIMENSIONS).toContain(d);
    // the official overrides, recorded: PAA and Icfes fix the format and forbid the calculator; PISA fixes the format
    expect(POC.summary.unmetByAuthority).toEqual({ FAMILY_OR_REQUEST: 6, OFFICIAL: 12, STUDYUS_POLICY: 8 });
    expect([...new Set(POC.summary.officialOverrides.map((o) => `${o.targetId}|${o.preferenceId}|${o.overriddenByRule}`))]).toEqual([
      'PAA.MATEMATICAS|stem-plus.response.constructed|COMPONENT_PROFILE_RULE:paa.matematicas.response-formats',
      'PAA.MATEMATICAS|stem-plus.tools.available|COMPONENT_PROFILE_RULE:paa.matematicas.calculator',
      'PISA.MATHEMATICS|stem-plus.response.constructed|COMPONENT_PROFILE_RULE:pisa.mathematics.response-formats',
      'ICFES.SABER11_MATEMATICAS|stem-plus.response.constructed|COMPONENT_PROFILE_RULE:icfes.saber11-matematicas.response-formats',
      'ICFES.SABER11_MATEMATICAS|stem-plus.tools.available|COMPONENT_PROFILE_RULE:icfes.saber11-matematicas.calculator',
    ]);
    // no official override exists against the school's own assessment: it has no official rule
    expect(POC.summary.officialOverrides.filter((o) => o.targetId === 'SCHOOL_STEM_PERFORMANCE')).toEqual([]);
  });

  it('entitlement and applicability are handled honestly: nothing established that the repository does not record', () => {
    expect(POC.summary.curriculumEntitlement).toEqual({ NOT_ESTABLISHED: 24 });
    for (const c of POC.cells) expect(c.curriculumEntitlement).toEqual({ status: 'NOT_ESTABLISHED', basis: 'NONE', structureStatus: 'STRUCTURE_NOT_IMPORTED' });
    expect(POC.summary.applicability).toEqual({ 'ESTABLISHED:OFFICIAL_EXAM_STRUCTURE': 4, 'ESTABLISHED:REVIEWED_CATALOGUE_LINK': 4, 'NOT_ESTABLISHED:NONE': 16 });
    // official structure: PAA only. Catalogue link: proportion on PISA only. The school's assessment and Icfes: nothing recorded
    expect(POC.cells.filter((c) => c.applicability!.basis === 'OFFICIAL_EXAM_STRUCTURE').every((c) => c.targetId === 'PAA.MATEMATICAS')).toBe(true);
    expect(POC.cells.filter((c) => c.applicability!.basis === 'REVIEWED_CATALOGUE_LINK').every((c) => c.targetId === 'PISA.MATHEMATICS' && c.familyId === 'tf.math.proportion.rate-comparison-model')).toBe(true);
    expect(POC.cells.filter((c) => ['SCHOOL_STEM_PERFORMANCE', 'ICFES.SABER11_MATEMATICAS'].includes(c.targetId)).every((c) => c.applicability!.status === 'NOT_ESTABLISHED')).toBe(true);
    expect(POC.curricula.map((c) => c.structureStatus)).toEqual(['STRUCTURE_NOT_IMPORTED', 'STRUCTURE_NOT_IMPORTED']);
  });

  it('the special cases: collaborative work, the required preference, evidence-bearing content and the mock pool', () => {
    expect(POC.specialCases.map((c) => c.outcome)).toEqual(['SPECIFICATION', 'REFUSED PARTICIPATION_MODE_NOT_ALLOWED', 'REFUSED PARTICIPATION_MODE_NOT_ALLOWED', 'REFUSED PARTICIPATION_MODE_NOT_ALLOWED', 'REFUSED LEARNING_APPROACH_REQUIREMENT_UNMET', 'SPECIFICATION', 'REFUSED FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT', 'REFUSED DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE']);
    expect(POC.specialCases[0].detail).toEqual({ mode: 'COLLABORATIVE', evidenceYield: 'GROUP_ARTEFACT_ONLY' });
    // the artifact holds no question
    expect(read(LEARNING_APPROACH_POC_ARTIFACT)).not.toMatch(/"stem"|"options"|"answerKey"|[?¿]/);
  });
});

describe('evidence design, boundaries and purity', () => {
  it('the evidence facets name the learning approach; they are still types and names only -- B3 scoring is not implemented', () => {
    expect([...ADAPTATION_EVIDENCE_FACETS]).toEqual(['KNOWLEDGE', 'SKILL', 'COMPETENCY', 'CONTEXT', 'INDEPENDENCE', 'TRANSFER', 'LEARNING_APPROACH', 'ASSESSMENT_PROFILE', 'RETENTION']);
    const src = read(`${ADAPTATION_DIR}/instance-lineage.ts`);
    expect(src).toMatch(/LEARNING_APPROACH: \{ approachId: string; version: string; transversalCompetencyCodes: string\[\]; participationMode: 'INDIVIDUAL' \| 'COLLABORATIVE'; evidenceYield: 'INDIVIDUAL_EVIDENCE' \| 'GROUP_ARTEFACT_ONLY' \} \| null;/);
    for (const f of [...walk(APPROACH_DIR), ...walk(ADAPTATION_DIR), ...walk(FAMILIES_DIR)]) expect(code(f), f).not.toMatch(/isIndependent|independenceOf|evidenceWeight|scoreEvidence|updateMastery|recordEvidence|writeEvidence|learning_evidence|knowledge_state|masteryThreshold/);
    expect(readdirSync(join(ROOT, 'src/lib')).filter((d) => /evidence-engine|assessment-evidence|^b3/i.test(d))).toEqual([]);
    // the generated-instance lineage may name the approach, optionally; a lineage without it is as valid as before
    const lineage = { taskFamily: { id: 'tf.x', version: '1' }, systemProfile: { id: 'PAA', version: '1' }, componentProfile: null, disciplinePolicy: { id: 'p', version: '1' }, adaptationSpecificationId: 'a'.repeat(64), invariantHash: 'b'.repeat(64), contentUseClass: 'DEV_TEST_CONTENT', generationRunId: 'r' };
    expect(AdaptationLineageSchema.safeParse(lineage).success).toBe(true);
    expect(AdaptationLineageSchema.safeParse({ ...lineage, learningApproach: { id: 'STEM_PLUS', version: '0.1.0-provisional' } }).success).toBe(true);
  });

  it('AssessmentTaskFamily and TransferTaskFamily are still separate: neither imports the other', () => {
    for (const f of [...walk(APPROACH_DIR), ...walk(ADAPTATION_DIR), ...walk(FAMILIES_DIR)]) expect(code(f), f).not.toMatch(/transfer-task-identity|transfer-policy|computeTransferTaskFamilyId|transfer_task_instances/);
    for (const f of walk('src').filter((x) => /transfer/i.test(x))) expect(read(f), f).not.toMatch(/assessment-adaptation|learning-approach|question-bank\/task-families|AssessmentTaskFamily|LearningApproachProfile/);
    expect(read('src/lib/transfer-task-identity.ts')).toMatch(/export function computeTransferTaskFamilyId\(/);
  });

  it('the learning-approach directory is pure and imports nothing but zod; the dependency runs engine -> approach, never back', () => {
    const files = walk(APPROACH_DIR);
    expect(files.map((f) => f.replace(`${APPROACH_DIR}/`, '')).sort()).toEqual(['index.ts', 'institution-configuration.ts', 'learning-approach-profile.ts']);
    for (const f of files) {
      const imports = [...read(f).matchAll(/from '([^']+)'/g)].map((m) => m[1]).filter((i) => !i.startsWith('./'));
      expect(imports.filter((i) => i !== 'zod'), f).toEqual([]);
      expect(code(f), f).not.toMatch(/from '@\/lib\/db'|\bquery\(|INSERT INTO|process\.env|fetch\(|from '(node:)?fs'|from 'pg'|@\/lib\/ai\/|\bDate\.now\(|new Date\(|Math\.random\(|https?:\/\/|\.service'/);
      expect(read(f), f).not.toMatch(/assessment-blueprint|assessment-adaptation|question-bank|exam-core|curriculum\//);
    }
    // B2 and B1 know nothing of it; nothing at runtime imports it but the adaptation engine
    for (const d of ['src/lib/assessment-blueprint', 'src/lib/assessment-foundation', 'src/app', 'src/services']) expect(walk(d).filter((f) => /learning-approach|LearningApproachProfile/.test(read(f))), d).toEqual([]);
    const importers = walk('src').filter((f) => !f.startsWith(APPROACH_DIR) && /from '@\/lib\/learning-approach/.test(read(f))).sort();
    expect(importers).toEqual(['src/lib/assessment-adaptation/adapt.ts', 'src/lib/assessment-adaptation/adaptation-specification.ts', 'src/lib/assessment-adaptation/learning-approach-poc.ts']);
    // the task-family directory still imports nothing but zod
    for (const f of walk(FAMILIES_DIR)) expect([...read(f).matchAll(/from '([^']+)'/g)].map((m) => m[1]).filter((i) => i !== 'zod' && !i.startsWith('./')), f).toEqual([]);
  });
});
