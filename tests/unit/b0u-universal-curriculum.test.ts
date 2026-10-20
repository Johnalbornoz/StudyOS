/**
 * B0-U -- Universal Curriculum & Assessment delta: architectural certification tests.
 *
 * Five curriculum systems, two teaching implementations, one knowledge graph, one student state -- all in
 * the existing model and through the existing B1 contracts. Pure; no database.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { conceptsOfNode, conceptsOfObjective, curriculumScopeGaps, nodesOfConcept, objectivesOfConcept, scopeContainsObjective, scopeRef, type CurriculumScope } from '@/lib/curriculum/curriculum-scope';
import { depthOfNode, expectationSemantics, gradeSpanOfNode, isOfficialCurriculum, isTeachingImplementation, parseGradeSpan, pathToRoot, subtreeOf, validateScopeAgainstProfile } from '@/lib/curriculum/curriculum-framework';
import { alignExpectations, conceptsUnderNode, deriveNodeState, expectationsMetByNode, expectationsOfConceptAcross, knowledgeOfExpectation, sharedConcepts } from '@/lib/curriculum/cross-curriculum';
import { coverageOfReviewedBankItem, coveredConceptIds } from '@/lib/assessment-foundation/question-coverage';
import { evaluateQuestionEligibility } from '@/lib/assessment-foundation/question-eligibility';
import { attributionViolations, planEvidenceAttribution } from '@/lib/assessment-foundation/evidence-attribution';
import { canonicalConceptIdForAssessment, type ConceptIdentity } from '@/lib/catalog/concept-identity';
import { constraintMismatches, itemDimensionValues, SLOT_DIMENSIONS } from '@/lib/exam-core/slot-constraints';
import { deriveInstanceAttemptType } from '@/lib/exam-core/form-fidelity';
import {
  CAMBRIDGE, COMPETENCIES, CONCEPTS, ENERGY, FORCE, GRAVITY, IB, LINEAR, MEN, MOMENTUM, OFFICIAL_FRAMEWORKS, PREREQUISITES, PROFILE_IB_DP, PROVIDER_IB_COURSE, SCHOOL_ADOPTION, SCHOOL_PLAN, SEP_EMS, SEP_SECUNDARIA, SKILLS,
  type FrameworkFixture,
} from '../fixtures/universal-curriculum';

const ROOT_DIR = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT_DIR, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const semantics = (f: FrameworkFixture, objectiveId: string) => expectationSemantics(f.scope, f.profile, objectiveId)!;
const maxDepth = (s: CurriculumScope) => Math.max(...s.nodes.map((n) => depthOfNode(s, n.id)));

describe('B0-U one model, five curriculum systems', () => {
  it('every framework is built by the same contract and follows its own configured shape', () => {
    for (const f of [...OFFICIAL_FRAMEWORKS, PROVIDER_IB_COURSE, SCHOOL_PLAN]) {
      expect(validateScopeAgainstProfile(f.scope, f.profile), f.key).toEqual([]);
      expect(f.scope.v, f.key).toBe(1);
      expect(curriculumScopeGaps(f.scope), f.key).toEqual({ objectivesWithoutConcept: [], hierarchyIsBootstrapOnly: false });
      expect(f.scope.nodes.every((n) => n.origin === 'CURRICULUM_HIERARCHY'), f.key).toBe(true);
    }
  });

  it('depth and vocabulary differ per framework; the model does not', () => {
    expect(OFFICIAL_FRAMEWORKS.map((f) => [f.key, maxDepth(f.scope)])).toEqual([['ib', 2], ['cam', 3], ['sep-sec', 5], ['sep-ems', 2], ['men', 3]]);
    const vocab = (f: FrameworkFixture) => [...new Set(f.scope.nodes.map((n) => n.nodeType))].sort();
    expect(vocab(IB)).toEqual(['THEME', 'TOPIC']);
    expect(vocab(CAMBRIDGE)).toEqual(['SUBTOPIC', 'TIER', 'TOPIC']);
    expect(vocab(SEP_SECUNDARIA)).toEqual(['CONTENT', 'DISCIPLINE', 'FIELD', 'GRADE', 'PHASE']);
    expect(vocab(SEP_EMS)).toEqual(['SEMESTER', 'UAC']);
    expect(vocab(MEN)).toEqual(['GRADE', 'GRADE_BAND', 'REFERENT', 'STRAND']);
    // the same keys on every scope: nothing framework-specific was added to the contract
    const keys = (s: CurriculumScope) => Object.keys(s).sort().join();
    expect(new Set([...OFFICIAL_FRAMEWORKS, PROVIDER_IB_COURSE, SCHOOL_PLAN].map((f) => keys(f.scope))).size).toBe(1);
  });

  it('A. IB: authority > programme > subject > version > theme > topic > expectations', () => {
    expect(IB.scope).toMatchObject({ organization: { name: 'International Baccalaureate' }, programme: { name: 'Diploma Programme' }, subject: { name: 'Physics', level: 'HL' }, structureVersion: { label: 'First assessment 2025', status: 'PUBLISHED' } });
    expect(semantics(IB, 'ib-lo-gravity')).toEqual({ learningObjectiveId: 'ib-lo-gravity', kind: 'IB_UNDERSTANDING', gradeSpan: null, facets: {}, placement: ['THEME', 'TOPIC'] });
    expect(isOfficialCurriculum(IB.ownership)).toBe(true);
  });

  it('A. a provider SESSION is not part of the official IB structure: the official shape rejects it', () => {
    const polluted: CurriculumScope = { ...IB.scope, nodes: [...IB.scope.nodes, { id: 'x', parentId: 'ib-D1', nodeType: 'SESSION', code: 'D1.1', label: 'Session', orderIndex: 9, origin: 'CURRICULUM_HIERARCHY' }] };
    expect(validateScopeAgainstProfile(polluted, PROFILE_IB_DP)).toEqual([{ code: 'UNKNOWN_NODE_TYPE', subject: 'x', detail: 'SESSION' }]);
    expect(IB.scope.nodes.some((n) => ['SESSION', 'SECTION', 'UNIT'].includes(n.nodeType))).toBe(false);
  });

  it('B. Cambridge: syllabus statements carry their Core / Supplement tier from where they sit', () => {
    expect(semantics(CAMBRIDGE, 'cam-lo-force-core')).toMatchObject({ kind: 'CAMBRIDGE_SYLLABUS_STATEMENT', facets: { TIER: 'CORE' }, placement: ['TOPIC', 'SUBTOPIC', 'TIER'] });
    expect(semantics(CAMBRIDGE, 'cam-lo-force-supp').facets).toEqual({ TIER: 'SUPPLEMENT' });
    expect(CAMBRIDGE.scope.qualification).toMatchObject({ name: 'IGCSE' });
  });

  it('C. SEP Secundaria: fase > grado > campo formativo > disciplina > contenido > PDA; the PDA is an expectation, not a concept', () => {
    const s = semantics(SEP_SECUNDARIA, 'sep-pda-force');
    expect(s).toEqual({ learningObjectiveId: 'sep-pda-force', kind: 'SEP_PDA', gradeSpan: { min: 8, max: 8 }, facets: { PHASE: '6' }, placement: ['PHASE', 'GRADE', 'FIELD', 'DISCIPLINE', 'CONTENT'] });
    expect(CONCEPTS.map((c): string => c.id)).not.toContain('sep-pda-force');
    expect(knowledgeOfExpectation(SEP_SECUNDARIA.scope, SEP_SECUNDARIA.capabilities, 'sep-pda-force')).toEqual({ learningObjectiveId: 'sep-pda-force', canonicalConceptIds: [FORCE], skillIds: [SKILLS.experiment], competencyIds: [COMPETENCIES.scientific] });
  });

  it('D. SEP EMS: semester > UAC > progressions, sequenced, on the same knowledge graph', () => {
    expect(semantics(SEP_EMS, 'ems-prog-2')).toMatchObject({ kind: 'SEP_EMS_PROGRESSION', facets: { SEMESTER: '3' }, gradeSpan: null, placement: ['SEMESTER', 'UAC'] });
    expect(SEP_EMS.scope.learningObjectives.map((o) => o.code)).toEqual(['P1', 'P2']);
    expect(SEP_EMS.gradeRange).toEqual({ min: 10, max: 12 });
    expect(conceptsOfNode(SEP_EMS.scope, 'ems-uac').sort()).toEqual([ENERGY, FORCE]);
    expect(knowledgeOfExpectation(SEP_EMS.scope, SEP_EMS.capabilities, 'ems-prog-2')).toMatchObject({ canonicalConceptIds: [ENERGY, FORCE], competencyIds: [COMPETENCIES.scientific] });
  });

  it('E. MEN: two referents in one version -- EBC on a grade BAND, DBA on a GRADE -- over one concept', () => {
    expect(semantics(MEN, 'men-ebc-force')).toMatchObject({ kind: 'COLOMBIA_EBC', gradeSpan: { min: 8, max: 9 }, facets: { REFERENT: 'EBC' } });
    expect(semantics(MEN, 'men-dba-force')).toMatchObject({ kind: 'COLOMBIA_DBA', gradeSpan: { min: 8, max: 8 }, facets: { REFERENT: 'DBA' } });
    expect(objectivesOfConcept(MEN.scope, FORCE).sort()).toEqual(['men-dba-force', 'men-ebc-force']);
    expect(MEN.scope.canonicalConcepts.filter((c) => c.id === FORCE)).toHaveLength(1);
    expect(nodesOfConcept(MEN.scope, FORCE).sort()).toEqual(['men-dba-8', 'men-ebc-fis']);
  });

  it('grade and grade band are read from the structure; an unreadable code is null, never a guess', () => {
    expect([parseGradeSpan('8'), parseGradeSpan('8-9'), parseGradeSpan(' 10 - 11 ')]).toEqual([{ min: 8, max: 8 }, { min: 8, max: 9 }, { min: 10, max: 11 }]);
    expect([parseGradeSpan('9-8'), parseGradeSpan('octavo'), parseGradeSpan(null)]).toEqual([null, null, null]);
    expect(gradeSpanOfNode(MEN.scope, MEN.profile, 'men-ebc-fis')).toEqual({ min: 8, max: 9 });
    expect(gradeSpanOfNode(IB.scope, IB.profile, 'ib-A2')).toBeNull();
    const broken: CurriculumScope = { ...MEN.scope, nodes: MEN.scope.nodes.map((n) => (n.id === 'men-dba-8' ? { ...n, code: 'octavo' } : n)) };
    expect(validateScopeAgainstProfile(broken, MEN.profile)).toContainEqual({ code: 'GRADE_CODE_UNREADABLE', subject: 'men-dba-8', detail: 'octavo' });
  });

  it('a profile catches a misplaced node, an expectation on a non-host and a cycle', () => {
    const misplaced: CurriculumScope = { ...SEP_SECUNDARIA.scope, nodes: SEP_SECUNDARIA.scope.nodes.map((n) => (n.id === 'sep-cont' ? { ...n, parentId: 'sep-g8' } : n)) };
    expect(validateScopeAgainstProfile(misplaced, SEP_SECUNDARIA.profile)).toContainEqual({ code: 'ILLEGAL_PLACEMENT', subject: 'sep-cont', detail: 'GRADE > CONTENT' });
    const onTheme: CurriculumScope = { ...IB.scope, learningObjectives: IB.scope.learningObjectives.map((o) => (o.id === 'ib-lo-force' ? { ...o, nodeId: 'ib-A' } : o)) };
    expect(validateScopeAgainstProfile(onTheme, IB.profile)).toContainEqual({ code: 'EXPECTATION_ON_NON_HOST', subject: 'ib-lo-force', detail: 'THEME' });
    const cyclic: CurriculumScope = { ...IB.scope, nodes: IB.scope.nodes.map((n) => (n.id === 'ib-A' ? { ...n, parentId: 'ib-A2' } : n)) };
    expect(pathToRoot(cyclic, 'ib-A2').map((n) => n.id)).toEqual(['ib-A2', 'ib-A']);
    expect(validateScopeAgainstProfile(cyclic, IB.profile).some((i) => i.code === 'CYCLE')).toBe(true);
  });
});

describe('B0-U cross-curriculum: curriculum changes, knowledge persists', () => {
  const scopes = OFFICIAL_FRAMEWORKS.map((f) => f.scope);

  it('ONE canonical concept is the target of expectations in IB, Cambridge, SEP (both levels) and MEN', () => {
    const hits = expectationsOfConceptAcross(scopes, FORCE);
    const byVersion = new Map<string, string[]>();
    for (const h of hits) byVersion.set(h.structureVersionId, [...(byVersion.get(h.structureVersionId) ?? []), h.learningObjectiveId]);
    expect([...byVersion.keys()].sort()).toEqual(['sv-cam', 'sv-ib', 'sv-men', 'sv-sep-ems', 'sv-sep-sec']);
    expect(byVersion.get('sv-ib')).toEqual(['ib-lo-force', 'ib-lo-gravity', 'ib-lo-momentum']);
    expect(byVersion.get('sv-cam')).toEqual(['cam-lo-force-core', 'cam-lo-force-supp']);
    expect(byVersion.get('sv-sep-sec')).toEqual(['sep-pda-force']);
    expect(byVersion.get('sv-men')).toEqual(['men-dba-force', 'men-ebc-force']);
    // the concept is one row, with one id and one name, in every scope that reaches it
    const rows = scopes.flatMap((s) => s.canonicalConcepts.filter((c) => c.id === FORCE));
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((c) => JSON.stringify(c))).size).toBe(1);
    expect(CONCEPTS.filter((c) => c.name === 'Force and acceleration')).toHaveLength(1);
  });

  it('two curricula align through the concept, each side keeping its own relation -- there is no curriculum-to-curriculum table', () => {
    expect(alignExpectations(SEP_SECUNDARIA.scope, IB.scope)).toEqual([
      { from: { structureVersionId: 'sv-sep-sec', learningObjectiveId: 'sep-pda-force' }, to: { structureVersionId: 'sv-ib', learningObjectiveId: 'ib-lo-force' }, viaCanonicalConceptId: FORCE, relations: { from: 'FULL', to: 'FULL' } },
      { from: { structureVersionId: 'sv-sep-sec', learningObjectiveId: 'sep-pda-force' }, to: { structureVersionId: 'sv-ib', learningObjectiveId: 'ib-lo-gravity' }, viaCanonicalConceptId: FORCE, relations: { from: 'FULL', to: 'PARTIAL' } },
      { from: { structureVersionId: 'sv-sep-sec', learningObjectiveId: 'sep-pda-force' }, to: { structureVersionId: 'sv-ib', learningObjectiveId: 'ib-lo-momentum' }, viaCanonicalConceptId: FORCE, relations: { from: 'FULL', to: 'SUPPORTING' } },
    ]);
    expect(alignExpectations(MEN.scope, CAMBRIDGE.scope).filter((a) => a.from.learningObjectiveId === 'men-dba-force').map((a) => a.to.learningObjectiveId)).toEqual(['cam-lo-force-core', 'cam-lo-force-supp']);
    expect(sharedConcepts(IB.scope, CAMBRIDGE.scope)).toEqual([FORCE, LINEAR]);
    expect(sharedConcepts(SEP_EMS.scope, IB.scope)).toEqual([FORCE]);
    const migrations = readdirSync(join(ROOT_DIR, 'database/migrations')).map((f) => read(`database/migrations/${f}`)).join('\n');
    expect(migrations).not.toMatch(/CREATE TABLE[^;]*(objective_objective|curriculum_crosswalk|objective_equivalen|curriculum_alignment)/i);
  });

  it('a concept of another discipline is linked, not duplicated: a physics expectation maps to the mathematics concept', () => {
    expect(conceptsOfObjective(IB.scope, 'ib-lo-force', ['PREREQUISITE'])).toEqual([LINEAR]);
    expect(IB.scope.canonicalConcepts.find((c) => c.id === LINEAR)!.canonicalSubjectId).toBe('cs-mathematics');
    expect(IB.scope.subject.canonicalSubjectId).toBe('cs-physics');
  });
});

describe('B0-U institution: the official curriculum and the school teaching structure are independent and relatable', () => {
  it('ownership, not shape, says what is official', () => {
    expect(OFFICIAL_FRAMEWORKS.every((f) => isOfficialCurriculum(f.ownership) && !isTeachingImplementation(f.ownership))).toBe(true);
    for (const f of [PROVIDER_IB_COURSE, SCHOOL_PLAN]) {
      expect(isOfficialCurriculum(f.ownership), f.key).toBe(false);
      expect(isTeachingImplementation(f.ownership), f.key).toBe(true);
    }
    expect(isOfficialCurriculum('STUDYUS_REFERENCE')).toBe(false);
  });

  it('they are separate versions with separate owners: neither contains a node or an expectation of the other', () => {
    for (const [official, teaching] of [[MEN, SCHOOL_PLAN], [IB, PROVIDER_IB_COURSE]] as const) {
      expect(official.scope.structureVersion.id).not.toBe(teaching.scope.structureVersion.id);
      expect(official.scope.organization!.id).not.toBe(teaching.scope.organization!.id);
      const officialNodes = new Set(official.scope.nodes.map((n) => n.id));
      expect(teaching.scope.nodes.some((n) => officialNodes.has(n.id))).toBe(false);
      expect(teaching.scope.learningObjectives.some((o) => scopeContainsObjective(official.scope, o.id))).toBe(false);
      // the official structure is valid without the teaching one, and the reverse
      expect(validateScopeAgainstProfile(official.scope, official.profile)).toEqual([]);
      expect(validateScopeAgainstProfile(teaching.scope, teaching.profile)).toEqual([]);
    }
  });

  it('period > unit > session map to the SAME concepts as the official expectations', () => {
    expect(conceptsUnderNode(SCHOOL_PLAN.scope, 'sch-u3')).toEqual([FORCE]);
    expect(subtreeOf(SCHOOL_PLAN.scope, 'sch-p2')).toEqual(['sch-p2', 'sch-s1', 'sch-s2', 'sch-u3']);
    expect(semantics(SCHOOL_PLAN, 'sch-lo-s2')).toMatchObject({ kind: 'INSTITUTION_OBJECTIVE', facets: { PERIOD: 'P2' }, placement: ['PERIOD', 'UNIT', 'SESSION'] });
    expect(knowledgeOfExpectation(SCHOOL_PLAN.scope, SCHOOL_PLAN.capabilities, 'sch-lo-s2')).toEqual({ learningObjectiveId: 'sch-lo-s2', canonicalConceptIds: [FORCE, LINEAR], skillIds: [SKILLS.experiment], competencyIds: [] });
    expect(sharedConcepts(SCHOOL_PLAN.scope, MEN.scope)).toEqual([FORCE]);
  });

  it('a session relates to the official expectations it meets, through the knowledge graph', () => {
    expect(expectationsMetByNode(SCHOOL_PLAN.scope, 'sch-s2', MEN.scope)).toEqual([
      { structureVersionId: 'sv-men', learningObjectiveId: 'men-dba-force', relationType: 'FULL', viaCanonicalConceptId: FORCE },
      { structureVersionId: 'sv-men', learningObjectiveId: 'men-ebc-force', relationType: 'PARTIAL', viaCanonicalConceptId: FORCE },
    ]);
    expect(expectationsMetByNode(PROVIDER_IB_COURSE.scope, 'prov-D1.2', IB.scope).map((e) => [e.learningObjectiveId, e.viaCanonicalConceptId, e.relationType])).toEqual([
      ['ib-lo-force', FORCE, 'FULL'], ['ib-lo-gravity', FORCE, 'PARTIAL'], ['ib-lo-gravity', GRAVITY, 'FULL'], ['ib-lo-momentum', FORCE, 'SUPPORTING'], ['ib-lo-momentum', MOMENTUM, 'FULL'],
    ]);
    // the same school plan can be read against a different official curriculum without being rewritten
    expect(expectationsMetByNode(SCHOOL_PLAN.scope, 'sch-u3', SEP_SECUNDARIA.scope).map((e) => e.learningObjectiveId)).toEqual(['sep-pda-force']);
  });

  it('the school also ADOPTS official expectations explicitly, with the existing institution-curriculum rows', () => {
    expect(SCHOOL_ADOPTION.institutionCurriculum.baseStructureVersionId).toBe(scopeRef(MEN.scope).structureVersionId);
    expect(SCHOOL_ADOPTION.objectives.every((o) => scopeContainsObjective(MEN.scope, o.learningObjectiveId))).toBe(true);
    const adopted = new Set<string>(SCHOOL_ADOPTION.objectives.map((o) => o.learningObjectiveId));
    expect(expectationsMetByNode(SCHOOL_PLAN.scope, 'sch-u3', MEN.scope).every((e) => adopted.has(e.learningObjectiveId))).toBe(true);
    // the tables this mirrors exist, and none of them holds a mastery value
    const sql = read('database/migrations/20261018_1400_track_a_learning_plan_orchestrator.sql') + read('database/migrations/20261018_1500_track_a_institution_curriculum_v2.sql');
    for (const t of ['institution_curricula', 'institution_curriculum_concepts', 'institution_curriculum_objectives']) expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    expect(sql).toMatch(/base_structure_version_id uuid REFERENCES structure_versions\(id\)/);
    expect(sql).toMatch(/'GOVERNMENT_AUTHORITY', 'INTERNATIONAL_PROGRAMME', 'INSTITUTION_DEFINED', 'STUDYUS_REFERENCE'/);
  });
});

describe('B0-U longitudinal: changing curriculum does not reset knowledge', () => {
  /** `concept_catalog_mapping` + `concepts`: the Student's own instances, linked explicitly. */
  const identities: ConceptIdentity[] = [{ status: 'CANONICAL', learnerConceptId: 'lc-1', canonicalConceptId: FORCE, basis: 'CREATED_FROM_CANONICAL' }];
  /** `concept_knowledge_state`: one row per (student, learner concept). */
  const knowledgeState = new Map([['lc-1', { masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, independentEvidenceCount: 2 }]]);
  const learnerConceptFor = (canonicalConceptId: string) => identities.find((i) => canonicalConceptIdForAssessment(i) === canonicalConceptId)?.learnerConceptId ?? null;
  const stateByCanonical = () => new Map(identities.flatMap((i) => (knowledgeState.has(i.learnerConceptId) && canonicalConceptIdForAssessment(i) ? [[canonicalConceptIdForAssessment(i)!, knowledgeState.get(i.learnerConceptId)!.masteryState] as const] : [])));

  it('evidence gathered under curriculum A is the state the Student arrives with in curriculum B', () => {
    const before = JSON.stringify([...knowledgeState]);
    // curriculum A: SEP Secundaria
    expect(conceptsOfNode(SEP_SECUNDARIA.scope, 'sep-cont')).toEqual([FORCE]);
    expect(learnerConceptFor(FORCE)).toBe('lc-1');
    // later -- curriculum B: IB Diploma Physics. The same canonical concept resolves to the same instance.
    expect(conceptsOfNode(IB.scope, 'ib-A2').sort()).toEqual([FORCE, MOMENTUM]);
    expect(learnerConceptFor(FORCE)).toBe('lc-1');
    expect(deriveNodeState(IB.scope, 'ib-A2', stateByCanonical())).toEqual({ nodeId: 'ib-A2', canonicalConceptIds: [FORCE, MOMENTUM], byState: { PROVISIONAL_MASTERY: [FORCE] }, withoutState: [MOMENTUM] });
    // what is new in B has no state yet; what was known is untouched
    expect(learnerConceptFor(MOMENTUM)).toBeNull();
    expect(JSON.stringify([...knowledgeState])).toBe(before);
  });

  it('the stored state has no curriculum in its identity', () => {
    const baseline = read('database/baseline/STUDYUS_BASELINE_2026_08.sql');
    const table = /CREATE TABLE public\.concept_knowledge_state \(([\s\S]*?)\n\);/.exec(baseline)![1];
    expect(table).not.toMatch(/structure_version|structure_node|academic_subject|academic_programme|learning_objective|curriculum/);
    expect(baseline).toMatch(/concept_knowledge_state_student_id_concept_id_key UNIQUE \(student_id, concept_id\)/);
    const f5 = read('database/migrations/20260923_1000_f5_evidence_learner_state_2.sql');
    expect(f5).toMatch(/learner_skill_state_student_skill_unique UNIQUE \(student_id, skill_id\)/);
    expect(f5).toMatch(/learner_competency_state_student_competency_unique UNIQUE \(student_id, competency_id\)/);
  });

  it('the Student instance of a canonical concept is found Student-wide, whatever curriculum asks for it', () => {
    const resolver = code('src/lib/readiness/student-concept-resolution.service.ts');
    expect(resolver).toMatch(/s\.student_id = \$1 AND ccm\.canonical_concept_id = \$2 AND ccm\.status = 'MATCHED'/);
    expect(resolver).not.toMatch(/structure_version|academic_subject|learning_objective|programme/);
    // both creation paths look for the existing instance before creating one
    for (const f of ['src/lib/exam-core/catalog/learning-links.service.ts', 'src/lib/learning-plan/personal-plan.service.ts']) expect(code(f), f).toMatch(/resolveStudentConceptForCanonicalConcept\(/);
  });
});

describe('B0-U mastery is derived for a curriculum node, never stored on it', () => {
  it('a session with a gap in ONE concept: the gap, not the session, is what needs work', () => {
    const state = new Map([[GRAVITY, 'VALIDATED_MASTERY'], [FORCE, 'VALIDATED_MASTERY'], [MOMENTUM, 'INTERVENTION_REQUIRED']]);
    const d12 = deriveNodeState(PROVIDER_IB_COURSE.scope, 'prov-D1.2', state);
    expect(d12).toEqual({ nodeId: 'prov-D1.2', canonicalConceptIds: [FORCE, GRAVITY, MOMENTUM], byState: { VALIDATED_MASTERY: [FORCE, GRAVITY], INTERVENTION_REQUIRED: [MOMENTUM] }, withoutState: [] });
    // the engine reasons on the concept and its prerequisites, not on "repeat D1.2"
    const gap = d12.byState.INTERVENTION_REQUIRED!;
    expect(gap).toEqual([MOMENTUM]);
    expect(PREREQUISITES.filter(([, concept]) => gap.includes(concept)).map(([prerequisite]) => prerequisite)).toEqual([FORCE]);
    // the same concept states answer for a section, a unit, an official topic and another curriculum
    expect(deriveNodeState(PROVIDER_IB_COURSE.scope, 'prov-unit-D', state).byState.INTERVENTION_REQUIRED).toEqual([MOMENTUM]);
    expect(deriveNodeState(IB.scope, 'ib-A', state).byState).toEqual({ VALIDATED_MASTERY: [FORCE], INTERVENTION_REQUIRED: [MOMENTUM] });
    expect(deriveNodeState(CAMBRIDGE.scope, 'cam-1', state)).toMatchObject({ byState: { VALIDATED_MASTERY: [FORCE] }, withoutState: [] });
  });

  it('no table stores mastery for a node, topic, unit or curriculum', () => {
    const ddl = [read('database/baseline/STUDYUS_BASELINE_2026_08.sql'), ...readdirSync(join(ROOT_DIR, 'database/migrations')).map((f) => read(`database/migrations/${f}`))].join('\n');
    const tables = [...ddl.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-z_0-9]+)/gi)].map((m) => m[1].toLowerCase());
    expect(tables.filter((t) => /(node|topic|subtopic|unit|curriculum|structure|objective)_(mastery|knowledge_state|state)/.test(t))).toEqual([]);
    for (const t of ['structure_nodes', 'structure_versions', 'learning_objectives', 'institution_curricula']) {
      const body = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${t} \\(([\\s\\S]*?)\\n\\);`).exec(ddl)![1];
      expect(body, t).not.toMatch(/mastery|score|evidence_count/);
    }
  });
});

describe('B0-U assessment: one question, five separate responsibilities', () => {
  /** A reviewed item of a Cambridge paper, anchored on a syllabus statement. Rows shaped like the bank's own. */
  const item = coverageOfReviewedBankItem({
    approvedItemId: 'item-0625-1', learningObjectiveId: 'cam-lo-force-supp', questionType: 'structured', content: { difficulty: 3, marks: 3, tags: { assessmentObjective: 'AO2' } }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
    usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null,
    bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-0625', assessmentComponentId: 'paper-4', currentVersionId: 'item-0625-1', retired: false, language: 'en' }, sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1,
    scope: scopeRef(CAMBRIDGE.scope), objectiveConcepts: CAMBRIDGE.scope.objectiveConcepts.filter((m) => m.learningObjectiveId === 'cam-lo-force-supp').map((m) => ({ canonicalConceptId: m.canonicalConceptId, relationType: m.relationType })),
  });
  const content = { marks: 3, tags: { assessmentObjective: 'AO2' } };

  it('curriculum alignment: where it belongs (a statement of one syllabus version)', () => {
    expect(item.learningObjectiveIds).toEqual({ state: 'KNOWN', value: ['cam-lo-force-supp'] });
    expect(item.curriculumApplicability).toEqual({ state: 'KNOWN', value: [{ structureVersionId: 'sv-cam', academicSubjectId: 'subj-cam' }] });
    expect(semantics(CAMBRIDGE, 'cam-lo-force-supp')).toMatchObject({ kind: 'CAMBRIDGE_SYLLABUS_STATEMENT', facets: { TIER: 'SUPPLEMENT' } });
  });

  it('knowledge measurement: what it measures (canonical concepts), independent of the syllabus', () => {
    expect(coveredConceptIds(item).sort()).toEqual([FORCE, LINEAR]);
    // the same knowledge is what an IB or a SEP expectation points at
    expect(expectationsOfConceptAcross([IB.scope, SEP_SECUNDARIA.scope], FORCE).map((e) => e.learningObjectiveId)).toEqual(['ib-lo-force', 'ib-lo-gravity', 'ib-lo-momentum', 'sep-pda-force']);
  });

  it('assessment objective: a dimension of the assessment framework -- not an expectation, a concept or a skill', () => {
    expect(SLOT_DIMENSIONS).toContain('ASSESSMENT_OBJECTIVE');
    expect(itemDimensionValues(content)).toEqual({ ASSESSMENT_OBJECTIVE: 'AO2', MARKS: '3' });
    expect(CAMBRIDGE.scope.learningObjectives.some((o) => /AO\d/.test(`${o.id} ${o.code}`))).toBe(false);
    expect(CONCEPTS.some((c) => /AO\d/.test(c.id))).toBe(false);
    expect(Object.values(SKILLS).some((s) => /AO\d/i.test(s))).toBe(false);
    // it is declared per assessment component, and carried by the item as a tag
    expect(code('src/lib/exam-core/component-definition.ts')).toMatch(/assessmentObjectives: z\.array/);
    expect(code('src/lib/exam-core/items.ts')).toMatch(/assessmentObjective: z\.string\(\)/);
  });

  it('blueprint eligibility: paper / component, exam version, objective and slot dimensions decide; knowledge does not', () => {
    const request = { family: 'OFFICIAL_EXAM' as const, studentId: 'stu-1', examVersionId: 'ev-0625', assessmentComponentIds: ['paper-4'], structureVersionIds: ['sv-cam'], learningObjectiveIds: ['cam-lo-force-supp'] };
    expect(evaluateQuestionEligibility(item, request)).toEqual({ eligible: true, use: 'FULL_MOCK' });
    expect(evaluateQuestionEligibility(item, { ...request, assessmentComponentIds: ['paper-2'] })).toEqual({ eligible: false, reasons: ['COMPONENT_MISMATCH'] });
    expect(evaluateQuestionEligibility(item, { ...request, examVersionId: 'ev-ib' })).toEqual({ eligible: false, reasons: ['EXAM_VERSION_MISMATCH'] });
    const values = itemDimensionValues(content);
    expect(constraintMismatches([{ dimension: 'ASSESSMENT_OBJECTIVE', value: 'AO2' }, { dimension: 'MARKS', value: '3' }], values)).toEqual([]);
    expect(constraintMismatches([{ dimension: 'ASSESSMENT_OBJECTIVE', value: 'AO3' }], values)).toEqual(['ASSESSMENT_OBJECTIVE']);
  });

  it('evidence production: a response becomes evidence about the Student CONCEPT, with honest credit', () => {
    const a = planEvidenceAttribution(item, { family: 'OFFICIAL_EXAM', path: 'OFFICIAL_MOCK', assessmentRef: 'att-1', dimension: 'EXAM_PERFORMANCE', learnerConceptByCanonical: new Map([[FORCE, 'lc-1']]), independentActivity: true, examScope: { examTargetId: 't-1', examVersionId: 'ev-0625', examAttemptId: 'att-1' } });
    expect(attributionViolations(a)).toEqual([]);
    expect(a.targets.map((t) => [t.canonicalConceptId, t.learnerConceptId, t.credit, t.eligibleDimensions.join()]).sort()).toEqual([[FORCE, 'lc-1', 'UNDETERMINED', 'EXAM_PERFORMANCE'], [LINEAR, null, 'UNDETERMINED', '']]);
    // nothing in the attribution names a node, a syllabus or a curriculum: evidence is about knowledge
    expect(JSON.stringify(a.targets)).not.toMatch(/sv-cam|cam-lo|TIER|SUBTOPIC/);
  });

  it('the frozen attempt semantics are unchanged by this delta', () => {
    const full = { fidelity: 'FULL' as const, reasons: [] };
    expect(deriveInstanceAttemptType({ mode: 'PRACTICE', fidelity: null, difficultyBandMet: null })).toEqual({ startable: true, type: 'EXAM_PRACTICE' });
    expect(deriveInstanceAttemptType({ mode: 'CHALLENGE', fidelity: null, difficultyBandMet: null })).toEqual({ startable: true, type: 'EXAM_CHALLENGE' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: full, difficultyBandMet: true })).toEqual({ startable: true, type: 'FULL_MOCK' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: { fidelity: 'REDUCED', reasons: [] }, difficultyBandMet: null })).toEqual({ startable: true, type: 'REDUCED_MOCK' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: null, difficultyBandMet: true })).toMatchObject({ startable: false, reason: 'FIDELITY_UNKNOWN' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: full, difficultyBandMet: true, contentAudience: 'TECHNICAL_DEMO' })).toEqual({ startable: true, type: 'REDUCED_MOCK' });
  });
});

describe('B0-U architecture guards', () => {
  const CORE = ['src/lib/curriculum/curriculum-scope.ts', 'src/lib/curriculum/curriculum-framework.ts', 'src/lib/curriculum/cross-curriculum.ts'];

  it('no framework or country vocabulary is encoded in the core', () => {
    const terms = /\b(IB|IBO|IGCSE|CAMBRIDGE|SEP|MEN|MCCEMS|PDA|DBA|EBC|UAC|PEI|TOPIC|SUBTOPIC|SESSION|STRAND|THEME|PAPER|PROGRESSION|CAMPO|FASE|ICFES|SABER)\b/i;
    for (const f of CORE) expect(code(f), f).not.toMatch(terms);
    // the only node type the core knows by name is the bootstrap assessment section B1 already isolates
    expect(code('src/lib/curriculum/curriculum-scope.ts').match(/'[A-Z][A-Z_]+'/g)!.filter((s) => !['\'FULL\'', '\'PARTIAL\'', '\'PREREQUISITE\'', '\'SUPPORTING\'', '\'CURRICULUM_HIERARCHY\'', '\'BOOTSTRAP_ASSESSMENT_SECTION\''].includes(s))).toEqual(['\'EXAM_SECTION\'']);
  });

  it('the new modules are pure: no IO, no clock, no flag, no learner write', () => {
    for (const f of CORE.slice(1)) expect(code(f), f).not.toMatch(/@\/lib\/db|\.service'|process\.env|Date\.now|new Date\(|Math\.random|INSERT|UPDATE |DELETE /);
  });

  it('the schema is open where it must be: node types are free text, hierarchy is self-referencing, mappings are many-to-many', () => {
    const f6 = read('database/migrations/20260924_1000_f6_curriculum_standards_mapping.sql');
    const nodes = /CREATE TABLE IF NOT EXISTS public\.structure_nodes \(([\s\S]*?)\n\);/.exec(f6)![1];
    expect(nodes).toMatch(/node_type text NOT NULL/);
    expect(nodes).not.toMatch(/node_type[^,]*CHECK|structure_nodes_node_type_check|structure_nodes_type_check/);
    expect(nodes).toMatch(/parent_id uuid REFERENCES public\.structure_nodes\(id\)/);
    for (const t of ['objective_concept_mappings', 'objective_skill_mappings', 'objective_competency_mappings']) expect(f6).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} `));
    const f4 = read('database/migrations/20260922_1000_f4_learning_architecture_2.sql');
    const concepts = /CREATE TABLE IF NOT EXISTS public\.canonical_concepts \(([\s\S]*?)\n\);/.exec(f4)![1];
    expect(concepts).not.toMatch(/structure_|academic_|programme|learning_objective|grade/);
  });

  it('this delta adds no migration and no table', () => {
    const migrations = readdirSync(join(ROOT_DIR, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    // The delta itself added none: position 71 is still the B1-E migration. What follows belongs to later blocks (B3).
    expect(migrations[70]).toBe('20261109_1000_simulation_type_challenge_reduced_mock.sql');
    expect(migrations.slice(71).every((f) => f > '20261110_')).toBe(true);
  });

  it('nothing in the delivered runtime depends on the new modules yet', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(join(ROOT_DIR, dir), { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name), out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(join(dir, e.name));
      }
      return out;
    };
    const importers = walk('src').filter((f) => !CORE.includes(f) && /from '[^']*(curriculum-framework|cross-curriculum)'/.test(read(f)));
    // B4: the setup read model resolves a curriculum node to its concepts through these modules (read-only).
    expect(importers.filter((f) => !f.startsWith('src/lib/assessment-experience/'))).toEqual([]);
  });
});
