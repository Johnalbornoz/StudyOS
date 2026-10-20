/**
 * Curriculum convergence -- fail-closed curriculum resolution, Learn curriculum provenance, and the end of the
 * false "Sin clasificar".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CURRICULUM_MAPPING_NOT_READY, decideCurriculumContext, type ExplicitAcademicSubject } from '@/lib/learning-plan/curriculum-context-resolution';
import { ASSESSMENT_NODE_TYPES, curriculumUnitOf, groupUnassignedByCurriculum, type ConceptCurriculumPlacement } from '@/lib/learning-plan/curriculum-grouping';
import { buildCurriculumTopics, type CurriculumTopicRow } from '@/lib/learning-plan/subject-curriculum-topics';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
/** Code only: comments are where the removed behaviour is described. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '');

const option = (academicSubjectId: string, conceptCount: number, programmeId = 'prog') => ({ academicSubjectId, structureVersionId: `sv-${academicSubjectId}`, programmeId, conceptCount });
const named = (academicSubjectId: string, source: ExplicitAcademicSubject['source'], over: Partial<ExplicitAcademicSubject> = {}): ExplicitAcademicSubject => ({ academicSubjectId, source, exists: true, belongsToCatalogSubject: true, hasPublishedVersion: true, ...over });

describe('curriculum resolution fails closed', () => {
  it('Subject A selected without mappings, Subject B with many: B is NEVER selected', () => {
    // B is in the same programme, has the most mappings, and is first in the options list.
    const options = [option('subject-b', 250), option('subject-c', 40)];
    const decision = decideCurriculumContext(options, [named('subject-a', 'ACADEMIC_PROFILE')]);
    expect(decision.status).toBe('NOT_READY');
    expect(decision.context).toBeNull();
    expect(decision.notReady).toEqual([{ code: CURRICULUM_MAPPING_NOT_READY, academicSubjectId: 'subject-a', source: 'ACADEMIC_PROFILE', missing: 'CONCEPT_MAPPINGS' }]);
  });

  it('the size and the order of the options never decide', () => {
    const explicit = [named('small', 'ACADEMIC_PROFILE')];
    const a = decideCurriculumContext([option('huge', 999), option('small', 1)], explicit);
    const b = decideCurriculumContext([option('small', 1), option('huge', 999)], explicit);
    expect(a.status === 'RESOLVED' && a.context.academicSubjectId).toBe('small');
    expect(b.status === 'RESOLVED' && b.context.academicSubjectId).toBe('small');
  });

  it('no explicit subject at all: GENERAL, never "the first" option', () => {
    const decision = decideCurriculumContext([option('subject-b', 250)], []);
    expect(decision).toEqual({ status: 'GENERAL', context: null, notReady: [] });
  });

  it('an explicit subject of ANOTHER Learn subject says nothing here (no cross-subject resolution, no false not-ready)', () => {
    const decision = decideCurriculumContext([option('math-b', 250)], [named('physics-a', 'ACADEMIC_PROFILE', { belongsToCatalogSubject: false })]);
    expect(decision.status).toBe('GENERAL');
  });

  it('a requested curriculum is exclusive: it resolves or it is not ready -- it is never answered with another one', () => {
    const options = [option('subject-b', 250)];
    const miss = decideCurriculumContext(options, [named('subject-a', 'REQUESTED'), named('subject-b', 'ACADEMIC_PROFILE')]);
    expect(miss.status).toBe('NOT_READY');
    expect(miss.notReady[0]).toMatchObject({ academicSubjectId: 'subject-a', source: 'REQUESTED' });
    const hit = decideCurriculumContext(options, [named('subject-b', 'REQUESTED')]);
    expect(hit.status === 'RESOLVED' && hit.source).toBe('REQUESTED');
  });

  it('the missing link is named: no academic subject, no published version, no concept mappings', () => {
    const missing = (over: Partial<ExplicitAcademicSubject>) => decideCurriculumContext([], [named('a', 'REQUESTED', over)]).notReady[0]?.missing;
    expect(missing({ exists: false })).toBe('ACADEMIC_SUBJECT');
    expect(missing({ hasPublishedVersion: false })).toBe('PUBLISHED_STRUCTURE_VERSION');
    expect(missing({})).toBe('CONCEPT_MAPPINGS');
  });

  it('two explicit subjects: the exam preparation precedes the Academic Profile, and a not-ready one is still reported', () => {
    const decision = decideCurriculumContext([option('profile-subject', 5)], [named('exam-subject', 'EXAM_PROFILE'), named('profile-subject', 'ACADEMIC_PROFILE')]);
    expect(decision.status === 'RESOLVED' && [decision.context.academicSubjectId, decision.source]).toEqual(['profile-subject', 'ACADEMIC_PROFILE']);
    expect(decision.notReady.map((n) => n.academicSubjectId)).toEqual(['exam-subject']);
  });

  it('the resolver has no size-ordered, first-of-programme or name-pattern pick left', () => {
    const service = code('src/lib/learning-plan/curriculum.service.ts');
    expect(service).not.toMatch(/ORDER BY\s+concept_count/i);
    expect(service).not.toMatch(/inProgramme\[0\]|options\[0\]/);
    expect(service).not.toMatch(/\/IB\/i/);
    expect(service).toMatch(/decideCurriculumContext\(options, await describeExplicitSubjects\(named, catalogKey\)\)/);
    expect(service).toMatch(/: await studentExplicitAcademicSubjects\(studentId\);/);
    // the decision module never reads a count or a position
    const decision = code('src/lib/learning-plan/curriculum-context-resolution.ts');
    expect(decision).not.toMatch(/conceptCount|\.sort\(|options\[\d\]|\[0\]/);
  });

  it('an exam the Student prepares names the academic subjects it assesses through its published blueprint, never by name', () => {
    const service = code('src/lib/learning-plan/curriculum.service.ts');
    const fn = service.slice(service.indexOf('export async function studentExplicitAcademicSubjects'), service.indexOf('async function describeExplicitSubjects'));
    expect(fn).toMatch(/FROM assessment_blueprints b\s+JOIN blueprint_objective_targets t ON t\.blueprint_id = b\.id\s+JOIN learning_objectives lo ON lo\.id = t\.learning_objective_id AND lo\.status = 'ACTIVE'\s+JOIN structure_nodes sn ON sn\.id = lo\.structure_node_id\s+JOIN structure_versions sv ON sv\.id = sn\.structure_version_id AND sv\.status = 'PUBLISHED'/);
    expect(fn).toMatch(/WHERE b\.exam_version_id = ANY\(\$1::uuid\[\]\) AND b\.status = 'PUBLISHED'/);
    expect(fn).not.toMatch(/LIKE|lower\(|count\(/i);
    // exam preparations come before Academic Profile selections
    expect(fn.indexOf("source: 'EXAM_PROFILE'")).toBeLessThan(fn.indexOf("source: 'ACADEMIC_PROFILE'"));
  });

  it('a Teacher class with no bound curriculum gets no borrowed structure ("covering most of its concepts" is gone)', () => {
    const service = code('src/lib/teacher/class-progress.service.ts');
    expect(service).not.toMatch(/ORDER BY COUNT\(DISTINCT ocm\.canonical_concept_id\) DESC/);
    expect(service).not.toMatch(/PUBLISHED_CURRICULUM/);
  });

  it('no curriculum reader in src picks a structure by its size', () => {
    for (const f of ['src/lib/learning-plan/curriculum.service.ts', 'src/lib/learning-plan/subject-curriculum-topics.ts', 'src/lib/learning-plan/curriculum-provenance.service.ts', 'src/lib/learning-plan/student-views.service.ts', 'src/lib/teacher/class-progress.service.ts', 'src/lib/curriculum/curriculum-scope.service.ts']) {
      expect(code(f), f).not.toMatch(/ORDER BY\s+(COUNT|count)\([^)]*\)\s+DESC[\s\S]{0,80}LIMIT 1/);
    }
  });

  it('a not-ready curriculum suggests nothing from another sequence and is shown as not ready', () => {
    expect(code('src/lib/learning-plan/recommendations.service.ts')).toMatch(/if \(reason === CURRICULUM_MAPPING_NOT_READY\) continue;/);
    expect(code('src/app/dashboard/learn/page.tsx')).toMatch(/data-curriculum-not-ready/);
  });
});

describe('Learn curriculum provenance', () => {
  const migration = read('database/migrations/20261122_1000_learner_concept_curriculum_provenance.sql');

  it('normalized references only: canonical concept + academic subject + structure version + node + objective, no copied names', () => {
    for (const ref of ['learner_concept_id uuid PRIMARY KEY REFERENCES public.concepts(id)', 'canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id)', 'academic_subject_id uuid NOT NULL REFERENCES public.academic_subjects(id)', 'structure_version_id uuid NOT NULL REFERENCES public.structure_versions(id)', 'structure_node_id uuid NOT NULL REFERENCES public.structure_nodes(id)', 'learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id)']) expect(migration).toContain(ref);
    const table = migration.slice(migration.indexOf('CREATE TABLE'), migration.indexOf(');', migration.indexOf('CREATE TABLE')));
    expect(table).not.toMatch(/\b(name|label|title)\b\s+(text|varchar)/i);
  });

  it('the lineage is verified by the database and immutable', () => {
    for (const guard of ['_IMMUTABLE', '_CANONICAL_MISMATCH', '_NODE_VERSION', '_VERSION_SUBJECT', '_VERSION_NOT_PUBLISHED', '_OBJECTIVE_NODE', '_NO_MAPPING']) expect(migration).toContain(`LEARNER_CONCEPT_CURRICULUM_PROVENANCE${guard}`);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE ON public\.learner_concept_curriculum_provenance/);
  });

  it('canonical identity is untouched: the migration alters no existing table', () => {
    expect(code('database/migrations/20261122_1000_learner_concept_curriculum_provenance.sql')).not.toMatch(/ALTER TABLE|DROP |UPDATE public\.|DELETE FROM/);
  });

  it('the catalogue rows carry their node and objective, and the add sends the whole lineage', () => {
    const row = (nodeId: string, nodeType: string, objectiveId: string, canonicalConceptId: string): CurriculumTopicRow => ({ nodeId, nodeType, nodeLabel: nodeId, nodeOrder: 0, objectiveId, objectiveCode: null, objectiveDescription: objectiveId, canonicalConceptId });
    const labels = new Map([['c1', 'Fracciones'], ['c2', 'Porcentajes']]);
    const byObjective = buildCurriculumTopics([row('paper-1', 'EXAM_SECTION', 'lo-1', 'c1')], labels, new Map());
    expect(byObjective[0].concepts[0]).toMatchObject({ canonicalConceptId: 'c1', structureNodeId: 'paper-1', learningObjectiveId: 'lo-1' });
    const byNode = buildCurriculumTopics([row('dom-1', 'DOMAIN', 'lo-2', 'c2')], labels, new Map());
    expect(byNode[0].concepts[0]).toMatchObject({ canonicalConceptId: 'c2', structureNodeId: 'dom-1', learningObjectiveId: 'lo-2' });
    expect(read('src/app/dashboard/learn/CurriculumTopics.tsx')).toMatch(/curriculum=\{provenance \? \{ \.\.\.provenance, structureNodeId: c\.structureNodeId, learningObjectiveId: c\.learningObjectiveId \} : null\}/);
    expect(read('src/app/dashboard/plan/PlanActions.tsx')).toMatch(/curriculum: curriculum \?\? null/);
  });

  it('the API refuses a lineage that does not hold (never repairs it) and never guesses one', () => {
    const route = read('src/app/api/student/plan/route.ts');
    expect(route).toMatch(/if \(statedCurriculum && !\(await verifyCurriculumProvenance\(canonicalConceptId, statedCurriculum\)\)\) return NextResponse\.json\(\{ error: CURRICULUM_PROVENANCE_INVALID \}, \{ status: 422 \}\)/);
    // every way a catalogue concept enters Learn records its lineage: plan enrolment (all sources) and the exam bridge
    expect(read('src/lib/learning-plan/personal-plan.service.ts')).toMatch(/statedProvenance !== undefined \? statedProvenance : await deriveCurriculumProvenance\(studentId, canonicalConceptId\)/);
    expect(read('src/lib/exam-core/catalog/learning-links.service.ts')).toMatch(/recordCurriculumProvenance\(db, conceptId, canonicalConceptId, lineage, null\)/);
    const service = code('src/lib/learning-plan/curriculum-provenance.service.ts');
    // derived only from an academic subject the Student explicitly has, and only where the concept is mapped
    expect(service).toMatch(/const explicit = \[\.\.\.new Set\(\(await studentExplicitAcademicSubjects\(studentId\)\)\.map\(\(e\) => e\.academicSubjectId\)\)\];\s+if \(explicit\.length === 0\) return null;/);
    expect(service).toMatch(/AND sv\.academic_subject_id = ANY\(\$1::uuid\[\]\)/);
    expect(service).not.toMatch(/ORDER BY\s+count/i);
    expect(service).toMatch(/ON CONFLICT \(learner_concept_id\) DO NOTHING/);
  });
});

describe('"Sin clasificar" means no resolvable classification', () => {
  const placement = (over: Partial<ConceptCurriculumPlacement>): ConceptCurriculumPlacement => ({
    academicSubjectId: 'as', structureVersionId: 'sv', structureNodeId: 'n', learningObjectiveId: 'lo', programme: 'PAA', subject: 'Matemáticas', level: null,
    nodeType: 'EXAM_SECTION', nodeLabel: 'Matemáticas', nodeOrder: 0, objectiveCode: null, objectiveDescription: 'Álgebra: ecuaciones y funciones.', ...over,
  });

  it('PAA: a concept added from the catalogue is listed under its curriculum, not in the unassigned bucket', () => {
    const concepts = [{ id: 'k-eq' }, { id: 'k-own' }];
    const placements = new Map([['k-eq', placement({ structureVersionId: 'sv-paa-mat', learningObjectiveId: 'lo-alg' })]]);
    const out = groupUnassignedByCurriculum(concepts, placements, 'es');
    expect(out.unassigned).toEqual([{ id: 'k-own' }]);
    expect(out.curriculumTopics).toEqual([{ id: 'curriculum:sv-paa-mat', name: 'PAA · Matemáticas', subtopics: [{ id: 'curriculum:sv-paa-mat:lo:lo-alg', name: 'Álgebra: ecuaciones y funciones', concepts: [{ id: 'k-eq' }] }] }]);
  });

  it('PAA with the certified hierarchy: the unit is the official Domain node', () => {
    const p = placement({ nodeType: 'DOMAIN', nodeLabel: 'Álgebra', structureNodeId: 'dom-alg' });
    expect(curriculumUnitOf(p, 'es')).toEqual({ key: 'node:dom-alg', title: 'Álgebra' });
    expect(ASSESSMENT_NODE_TYPES.has('DOMAIN')).toBe(false);
  });

  it('IB: a paper is not a topic -- the unit is the learning objective, under the IB curriculum', () => {
    const placements = new Map([['k-kin', placement({ programme: 'IB Diploma Programme', subject: 'Physics', level: 'HL', structureVersionId: 'sv-ib-phy', structureNodeId: 'paper-1a', nodeLabel: 'Paper 1A', learningObjectiveId: 'lo-motion', objectiveDescription: 'A Space, time and motion: kinematics, forces, momentum.' })]]);
    const out = groupUnassignedByCurriculum([{ id: 'k-kin' }], placements, 'en');
    expect(out.unassigned).toEqual([]);
    expect(out.curriculumTopics[0].id).toBe('curriculum:sv-ib-phy');
    expect(out.curriculumTopics[0].name).toMatch(/^IB Diploma Programme · Physics · /);
    expect(out.curriculumTopics[0].subtopics.map((s) => s.id)).toEqual(['curriculum:sv-ib-phy:lo:lo-motion']);
  });

  it('a concept with no recorded provenance stays unassigned: nothing is inferred', () => {
    const out = groupUnassignedByCurriculum([{ id: 'typed-by-student' }], new Map(), 'es');
    expect(out).toEqual({ curriculumTopics: [], unassigned: [{ id: 'typed-by-student' }] });
  });

  it('units follow catalogue order and concepts of two curricula are never mixed', () => {
    const placements = new Map([
      ['a', placement({ structureVersionId: 'sv-1', nodeType: 'DOMAIN', structureNodeId: 'd2', nodeLabel: 'Geometría', nodeOrder: 2 })],
      ['b', placement({ structureVersionId: 'sv-1', nodeType: 'DOMAIN', structureNodeId: 'd1', nodeLabel: 'Aritmética', nodeOrder: 1 })],
      ['c', placement({ structureVersionId: 'sv-2', programme: 'Cambridge', subject: 'Mathematics', learningObjectiveId: 'lo-x' })],
    ]);
    const out = groupUnassignedByCurriculum([{ id: 'a' }, { id: 'b' }, { id: 'c' }], placements, 'es');
    expect(out.curriculumTopics.map((t) => [t.id, t.subtopics.map((s) => s.name)])).toEqual([['curriculum:sv-1', ['Aritmética', 'Geometría']], ['curriculum:sv-2', ['Álgebra: ecuaciones y funciones']]]);
  });

  it('the subject hierarchy applies it for every reader (Learn, path, subject page)', () => {
    const service = read('src/services/topic-hierarchy.service.ts');
    expect(service).toMatch(/groupUnassignedByCurriculum\(unassignedConcepts, placements, language\)/);
    expect(service).toMatch(/unassigned: grouped\.unassigned/);
  });
});
