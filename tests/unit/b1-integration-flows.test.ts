/**
 * B1 -- integration flows over the read boundaries, against an in-memory SQL router (no database):
 *
 *   Learning:  student -> learner concept -> explicit canonical link -> learning-cache coverage
 *   Exam:      exam target -> exam version -> learning objective -> canonical concepts -> reviewed-bank coverage
 *   Scope:     structure version -> nodes -> objectives -> concepts
 *   Identity:  a concept created from the catalogue is linked explicitly (no label is read)
 *
 * The fixtures mirror DEV's real shapes, including its gaps (unlinked concepts, unmapped objectives, no
 * human review, no licence on items). The gaps must stay visible: nothing here fills them in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (params: any[]) => any[];
let routes: Array<[RegExp, Handler]> = [];
const log: Array<{ sql: string; params: any[] }> = [];
const query = async (sql: string, params: any[] = []) => {
  log.push({ sql, params });
  for (const [re, handler] of routes) if (re.test(sql)) return { rows: handler(params) };
  return { rows: [] };
};

const getStudentExamProfileMock = vi.fn();
const listStudentExamProfilesMock = vi.fn();
const resolveExamProfilesMock = vi.fn();
const loadResolvedStudentContextMock = vi.fn();

vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: any[]) => query(sql, params), connect: async () => ({ query, release: () => {} }) } }));
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({ getStudentExamProfile: (...a: any[]) => getStudentExamProfileMock(...a), listStudentExamProfiles: (...a: any[]) => listStudentExamProfilesMock(...a) }));
vi.mock('@/lib/learning-plan/exam-profile-resolution', () => ({ resolveExamProfiles: (...a: any[]) => resolveExamProfilesMock(...a) }));
vi.mock('@/lib/student/student-context.server', () => ({ loadResolvedStudentContext: (...a: any[]) => loadResolvedStudentContextMock(...a) }));
vi.mock('@/lib/readiness/student-concept-resolution.service', () => ({ resolveStudentConceptForCanonicalConcept: async () => null }));
vi.mock('@/lib/exam-core/dev-fixture-reset', () => ({ assertResetAllowed: () => undefined }));

import { resolveConceptIdentities, resolveStudentConceptIdentities, linkLearnerConceptCreatedFromCanonical } from '@/lib/catalog/concept-identity.service';
import { loadCurriculumScope, publishedScopeRefForSubject, scopeRefForObjective } from '@/lib/curriculum/curriculum-scope.service';
import { conceptsOfObjective, curriculumScopeGaps, nodesOfConcept } from '@/lib/curriculum/curriculum-scope';
import { learningItemCacheCoverageProvider, loadQuestionCoverage, reviewedExamBankCoverageProvider } from '@/lib/assessment-foundation/question-coverage.service';
import { summarizeCoverage } from '@/lib/assessment-foundation/question-coverage';
import { evaluateQuestionEligibility } from '@/lib/assessment-foundation/question-eligibility';
import { loadPreparationContext } from '@/lib/assessment-foundation/preparation-context.service';
import { loadStudentAssessmentContext } from '@/lib/assessment-foundation/student-assessment-context.service';
import { learnerConceptFor } from '@/lib/assessment-foundation/student-assessment-context';
import { planEvidenceAttribution } from '@/lib/assessment-foundation/evidence-attribution';
import { addConceptToStudentLearning } from '@/lib/exam-core/catalog/learning-links.service';

const CANON_A = '11111111-1111-4111-8111-111111111111';
const CANON_B = '22222222-2222-4222-8222-222222222222';

/** DEV-shaped learner concepts of one Student: enrolled, exam-bridge (label-matched before B1), label-only, unresolved, no row. */
const CONCEPT_LINKS = [
  { learner_concept_id: 'lc-enrolled', concept_key: `CANON_${CANON_A.replace(/-/g, '').toUpperCase()}`, mapping_status: 'MATCHED', canonical_concept_id: CANON_A, mapping_method: 'PLAN_ENROLLMENT', reviewed: false },
  { learner_concept_id: 'lc-bridge', concept_key: `catalog:${CANON_B}`, mapping_status: 'MATCHED', canonical_concept_id: CANON_B, mapping_method: 'EXACT_LABEL_MATCH', reviewed: false },
  { learner_concept_id: 'lc-label', concept_key: 'photosynthesis', mapping_status: 'MATCHED', canonical_concept_id: 'c-label', mapping_method: 'EXACT_LABEL_MATCH', reviewed: false },
  { learner_concept_id: 'lc-unresolved', concept_key: 'my-own-notes', mapping_status: 'UNRESOLVED', canonical_concept_id: null, mapping_method: null, reviewed: false },
  { learner_concept_id: 'lc-norow', concept_key: 'older-concept', mapping_status: null, canonical_concept_id: null, mapping_method: null, reviewed: false },
];

const linksRoute: [RegExp, Handler] = [
  /FROM concepts c\s+LEFT JOIN concept_catalog_mapping m/,
  (params) => (Array.isArray(params[0]) ? CONCEPT_LINKS.filter((l) => params[0].includes(l.learner_concept_id)) : CONCEPT_LINKS),
];

beforeEach(() => {
  routes = [];
  log.length = 0;
  getStudentExamProfileMock.mockReset();
  listStudentExamProfilesMock.mockReset();
  resolveExamProfilesMock.mockReset();
  loadResolvedStudentContextMock.mockReset();
});

describe('B1 integration -- learning context resolution', () => {
  it('student -> learner concept -> canonical concept, with the unresolved population kept visible', async () => {
    routes = [linksRoute];
    const ids = await resolveStudentConceptIdentities('stu-1');
    expect(ids.map((i) => [i.learnerConceptId, i.status])).toEqual([
      ['lc-enrolled', 'CANONICAL'],
      ['lc-bridge', 'CANONICAL'],
      ['lc-label', 'TRANSITIONAL'],
      ['lc-unresolved', 'UNRESOLVED'],
      ['lc-norow', 'UNRESOLVED'],
    ]);
    // read-only, and it never looks at a label
    expect(log.every((q) => /^\s*SELECT/i.test(q.sql))).toBe(true);
    expect(log.some((q) => /concept_localizations|lower\(/.test(q.sql))).toBe(false);
  });

  it('learning question -> learner concept -> explicit canonical concept (coverage provider)', async () => {
    routes = [
      [/FROM question_bank_candidates/, () => [
        { id: 'q-enrolled', student_id: 'stu-1', concept_id: 'lc-enrolled', activity_type: 'PRACTICE', question_type: 'multiple_choice', difficulty: 2, language: 'es', validation_status: 'VALIDATED' },
        { id: 'q-label', student_id: 'stu-1', concept_id: 'lc-label', activity_type: 'PROVE', question_type: 'short_answer', difficulty: 3, language: 'es', validation_status: 'VALIDATED' },
        { id: 'q-unresolved', student_id: 'stu-1', concept_id: 'lc-unresolved', activity_type: 'PRACTICE', question_type: 'multiple_choice', difficulty: 1, language: 'es', validation_status: 'VALIDATED' },
      ]],
      linksRoute,
    ];
    const coverage = await learningItemCacheCoverageProvider().load(['q-enrolled', 'q-label', 'q-unresolved']);
    const byId = new Map(coverage.map((c) => [c.ref.id, c]));
    expect(byId.get('q-enrolled')!.concepts).toEqual([{ canonicalConceptId: CANON_A, role: 'PRIMARY', basis: 'LEARNER_CONCEPT_LINK' }]);
    // B1-C: a label-matched link is not coverage
    expect(byId.get('q-label')!.concepts).toEqual([]);
    expect(byId.get('q-label')!.conceptResolution).toEqual({ status: 'UNRESOLVED', reason: 'LEARNER_CONCEPT_LINK_TRANSITIONAL' });
    expect(byId.get('q-label')!.unconfirmedConceptId).toBe('c-label');
    expect(byId.get('q-unresolved')!.conceptResolution).toEqual({ status: 'UNRESOLVED', reason: 'LEARNER_CONCEPT_NOT_LINKED' });
    expect(coverage.every((c) => c.ref.store === 'LEARNING_ITEM_CACHE' && c.provenance === 'GENERATED_UNREVIEWED')).toBe(true);
    // the learning provider never reads the reviewed bank
    expect(log.some((q) => /approved_items|question_bank_items/.test(q.sql))).toBe(false);
  });

  it('StudentAssessmentContext composes the authorities for a LEARNING intent and writes nothing', async () => {
    routes = [linksRoute, [/FROM structure_versions WHERE academic_subject_id = \$1 AND status = 'PUBLISHED'/, (p) => (p[0] === 'subj-1' ? [{ id: 'sv-1' }] : [])]];
    loadResolvedStudentContextMock.mockResolvedValue({ contextType: 'ACADEMIC', profileCompleted: true, programme: { id: 'prog', name: 'IB', authority: 'IBO' }, qualification: null, profileSubjects: [{ academicSubjectId: 'subj-1', label: 'Maths · HL', level: 'HL', catalogKey: 'mathematics' }, { academicSubjectId: 'subj-empty', label: 'Art', level: null, catalogKey: null }], knownLevels: {}, legacy: {} });
    const r = await loadStudentAssessmentContext('stu-1', { family: 'LEARNING', purpose: 'PRACTICE', canonicalConceptIds: [CANON_A] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context.curriculum).toEqual([{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1', basis: 'ACADEMIC_PROFILE' }]);
    expect(r.context.learnerState.identity).toEqual({ total: 5, canonical: 2, transitional: 1, unresolved: 2 });
    expect(learnerConceptFor(r.context, CANON_A)?.learnerConceptId).toBe('lc-enrolled');
    expect(r.context.preparation).toBeNull();
    expect(log.every((q) => /^\s*SELECT/i.test(q.sql))).toBe(true);
  });
});

/** DEV-shaped reviewed bank: a human-approved generated item, a PILOT item, a fixture, and an item on an unmapped objective. */
const BANK_ITEMS = [
  { id: 'ai-approved', learning_objective_id: 'lo-mapped', question_type: 'multiple_choice', content: { difficulty: 3, marks: 1, language: 'es' }, status: 'PUBLISHED', bank_lifecycle_status: 'ACTIVE', usage_eligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], exam_alignment: 'MOCK_READY', calibration_confidence: 'INSUFFICIENT_DATA', content_origin: 'GENERATED', source_ids: null, bank_item_id: 'ai-approved', provenance: 'STUDYUS_GENERATED', exam_version_id: 'ev-1', assessment_component_id: 'comp-1', current_version_id: 'ai-approved', retired: false, language: 'es', structure_version_id: 'sv-1', academic_subject_id: 'subj-1', review_count: 1 },
  { id: 'ai-pilot', learning_objective_id: 'lo-mapped', question_type: 'multiple_choice', content: { difficulty: 2, marks: 1 }, status: 'PUBLISHED', bank_lifecycle_status: 'PILOT', usage_eligibility: ['PRACTICE', 'DIAGNOSTIC', 'QUIZ'], exam_alignment: 'EXAM_STYLE', calibration_confidence: 'INSUFFICIENT_DATA', content_origin: 'GENERATED', source_ids: null, bank_item_id: 'ai-pilot', provenance: 'STUDYUS_GENERATED', exam_version_id: 'ev-1', assessment_component_id: 'comp-1', current_version_id: 'ai-pilot', retired: false, language: 'es', structure_version_id: 'sv-1', academic_subject_id: 'subj-1', review_count: 0 },
  { id: 'ai-fixture', learning_objective_id: 'lo-mapped', question_type: 'numeric_problem', content: { difficulty: 3, marks: 2, contentStatus: 'DEV_CERT_FIXTURE' }, status: 'PUBLISHED', bank_lifecycle_status: 'ACTIVE', usage_eligibility: null, exam_alignment: null, calibration_confidence: null, content_origin: null, source_ids: null, bank_item_id: 'ai-fixture', provenance: 'FIXTURE', exam_version_id: 'ev-1', assessment_component_id: 'comp-1', current_version_id: 'ai-fixture', retired: false, language: 'es', structure_version_id: 'sv-1', academic_subject_id: 'subj-1', review_count: 0 },
  { id: 'ai-unmapped', learning_objective_id: 'lo-unmapped', question_type: 'short_answer', content: { difficulty: 4, marks: 3 }, status: 'PUBLISHED', bank_lifecycle_status: 'ACTIVE', usage_eligibility: ['PRACTICE', 'FULL_MOCK'], exam_alignment: 'MOCK_READY', calibration_confidence: null, content_origin: 'GENERATED', source_ids: null, bank_item_id: 'ai-unmapped', provenance: 'STUDYUS_GENERATED', exam_version_id: 'ev-1', assessment_component_id: 'comp-2', current_version_id: 'ai-unmapped', retired: false, language: 'es', structure_version_id: 'sv-1', academic_subject_id: 'subj-1', review_count: 1 },
];
const bankRoutes: Array<[RegExp, Handler]> = [
  [/FROM approved_items ai\s+LEFT JOIN question_bank_items qi/, (p) => BANK_ITEMS.filter((i) => p[0].includes(i.id))],
  [/FROM objective_concept_mappings WHERE learning_objective_id = ANY/, (p) => [
    { learning_objective_id: 'lo-mapped', canonical_concept_id: CANON_A, relation_type: 'PARTIAL' },
    { learning_objective_id: 'lo-mapped', canonical_concept_id: CANON_B, relation_type: 'PARTIAL' },
  ].filter((m) => p[0].includes(m.learning_objective_id))],
];

const examProfile = { id: 'target-1', studentId: 'stu-1', examDefinitionId: 'def-1', examVersionId: 'ev-1', objectiveKey: 'icfes.saber11.math', objectiveFramework: 'ICFES', objectiveContext: { programme: 'Saber 11', subject: 'Matemáticas', level: null }, targetExamSeries: null, targetExamYear: null, examDate: '2027-03-14', status: 'ACTIVE', purpose: null, programmeContext: null, subjectFocus: null, timezone: null, institutionTargetId: null };

describe('B1 integration -- exam context resolution', () => {
  it('exam target -> exam version -> objective -> canonical concepts -> reviewed-bank coverage', async () => {
    routes = [...bankRoutes, [/FROM structure_versions WHERE academic_subject_id = \$1 AND status = 'PUBLISHED'/, () => [{ id: 'sv-1' }]]];
    getStudentExamProfileMock.mockResolvedValue(examProfile);
    resolveExamProfilesMock.mockResolvedValue(new Map([['target-1', { profileId: 'target-1', name: 'Saber 11', definitionIds: ['def-1'], versionIds: ['ev-1'], academicSubjectIds: ['subj-1'], source: 'OBJECTIVE', mappingStatus: 'MAPPED' }]]));

    const prep = await loadPreparationContext('target-1');
    expect(prep).toMatchObject({ examTargetId: 'target-1', exam: { versionIds: ['ev-1'], pinnedVersionId: 'ev-1', mappingStatus: 'MAPPED' }, academicSubjectIds: ['subj-1'], curriculumScopes: [{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }] });
    expect(prep!.targetDate).toEqual({ state: 'KNOWN', value: { date: '2027-03-14', source: 'STUDENT_ENTERED' } });
    expect(prep!.targetResult).toEqual({ state: 'UNKNOWN' });

    const coverage = await reviewedExamBankCoverageProvider().load(BANK_ITEMS.map((i) => i.id));
    const approved = coverage.find((c) => c.ref.id === 'ai-approved')!;
    // the exam item reaches canonical concepts through its objective; neither is claimed as primary
    expect(approved.concepts).toEqual([
      { canonicalConceptId: CANON_A, role: 'UNSPECIFIED', basis: 'OBJECTIVE_MAPPING', relationType: 'PARTIAL' },
      { canonicalConceptId: CANON_B, role: 'UNSPECIFIED', basis: 'OBJECTIVE_MAPPING', relationType: 'PARTIAL' },
    ]);
    expect(approved.examApplicability).toEqual({ state: 'KNOWN', value: { examVersionId: 'ev-1', assessmentComponentId: 'comp-1' } });

    // eligibility for THIS target's exam version, per family
    const official = { family: 'OFFICIAL_EXAM' as const, studentId: 'stu-1', examVersionId: prep!.exam.versionIds[0], structureVersionIds: prep!.curriculumScopes.map((s) => s.structureVersionId) };
    const verdict = Object.fromEntries(coverage.map((c) => [c.ref.id, evaluateQuestionEligibility(c, official).eligible]));
    // DEV shape: no item has a rights record, so nothing is deliverable to a Student -- whatever its review says
    expect(verdict).toEqual({ 'ai-approved': false, 'ai-pilot': false, 'ai-fixture': false, 'ai-unmapped': false });
    expect(evaluateQuestionEligibility(approved, official)).toEqual({ eligible: false, reasons: ['REUSE_RIGHTS_NOT_ESTABLISHED'] });
    // once the Question Bank records an established reuse right, the same items are judged by the other rules
    routes = [
      ...routes,
      [/to_regclass\('public\.question_bank_content_rights'\)/, () => [{ ready: true }]],
      [/FROM question_bank_content_rights WHERE superseded_at IS NULL/, (p) => BANK_ITEMS.filter((i) => p[0].includes(i.id)).map((i) => ({ content_type: 'ITEM_VERSION', content_id: i.id, source_access: 'NOT_APPLICABLE', reuse_rights: i.id === 'ai-pilot' ? 'UNKNOWN' : 'STUDYUS_OWNED', in_force: true }))],
    ];
    const withRights = await reviewedExamBankCoverageProvider().load(BANK_ITEMS.map((i) => i.id));
    expect(Object.fromEntries(withRights.map((c) => [c.ref.id, evaluateQuestionEligibility(c, official).eligible]))).toEqual({ 'ai-approved': true, 'ai-pilot': false, 'ai-fixture': false, 'ai-unmapped': true });
    expect(withRights.find((c) => c.ref.id === 'ai-approved')!.rights).toEqual([{ contentType: 'ITEM_VERSION', contentId: 'ai-approved', sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }]);
    // the reviewed provider never reads the learning cache
    expect(log.some((q) => /question_bank_candidates|quiz_sessions/.test(q.sql))).toBe(false);
  });

  it('DEV data gaps stay visible through the contracts (nothing is repaired)', async () => {
    routes = bankRoutes;
    const coverage = await reviewedExamBankCoverageProvider().load(BANK_ITEMS.map((i) => i.id));
    const s = summarizeCoverage(coverage);
    expect(s.unresolved).toBe(1); // the item on the unmapped objective
    expect(s.byProvenance).toEqual({ STUDYUS_GENERATED: 3, FIXTURE: 1 });
    expect(s.licenceKnown).toBe(0); // no item cites a source
    expect(s.humanReviewed).toBe(2);
    expect(coverage.every((c) => c.estimatedSeconds.state === 'UNKNOWN')).toBe(true);
    expect(coverage.find((c) => c.ref.id === 'ai-unmapped')!.conceptResolution).toEqual({ status: 'UNRESOLVED', reason: 'OBJECTIVE_HAS_NO_CONCEPT_MAPPING' });
  });

  it('one abstraction over both stores: refs are dispatched to their own provider and come back in order', async () => {
    routes = [...bankRoutes, [/FROM question_bank_candidates/, () => [{ id: 'q-1', student_id: 'stu-1', concept_id: 'lc-enrolled', activity_type: 'PRACTICE', question_type: 'multiple_choice', difficulty: 2, language: 'es', validation_status: 'VALIDATED' }]], linksRoute];
    const out = await loadQuestionCoverage([
      { store: 'LEARNING_ITEM_CACHE', id: 'q-1' },
      { store: 'REVIEWED_EXAM_BANK', id: 'ai-approved' },
      { store: 'REVIEWED_EXAM_BANK', id: 'does-not-exist' },
    ]);
    expect(out.map((c) => `${c.ref.store}:${c.ref.id}`)).toEqual(['LEARNING_ITEM_CACHE:q-1', 'REVIEWED_EXAM_BANK:ai-approved']);
    // both describe the same canonical concept through different chains
    expect(out[0].concepts[0].canonicalConceptId).toBe(CANON_A);
    expect(out[1].concepts.map((c) => c.canonicalConceptId)).toContain(CANON_A);
  });

  it('an exam response is planned against the Student own concept instances, without crediting both concepts', async () => {
    routes = [...bankRoutes, linksRoute];
    const [approved] = await reviewedExamBankCoverageProvider().load(['ai-approved']);
    const identities = await resolveConceptIdentities(['lc-enrolled', 'lc-bridge']);
    const learner = new Map([...identities.values()].filter((i) => i.status === 'CANONICAL').map((i) => [i.canonicalConceptId as string, i.learnerConceptId]));
    const a = planEvidenceAttribution(approved, { family: 'OFFICIAL_EXAM', path: 'OFFICIAL_MOCK', assessmentRef: 'att-1', dimension: 'EXAM_PERFORMANCE', learnerConceptByCanonical: learner, independentActivity: true, examScope: { examTargetId: 'target-1', examVersionId: 'ev-1', examAttemptId: 'att-1' } });
    expect(a.targets.map((t) => [t.canonicalConceptId, t.learnerConceptId, t.credit])).toEqual([[CANON_A, 'lc-enrolled', 'UNDETERMINED'], [CANON_B, 'lc-bridge', 'UNDETERMINED']]);
    expect(a.targets.some((t) => t.independentEvidenceEligible)).toBe(false);
    expect(a.source.examScope).toEqual({ examTargetId: 'target-1', examVersionId: 'ev-1', examAttemptId: 'att-1' });
  });
});

describe('B1 integration -- CurriculumScope read', () => {
  const scopeRoutes: Array<[RegExp, Handler]> = [
    [/FROM structure_versions sv\s+JOIN academic_subjects sub/, (p) => (p[0] === 'sv-1' ? [{ version_id: 'sv-1', version_label: '2026', version_status: 'PUBLISHED', subject_id: 'subj-1', subject_name: 'Matemáticas', subject_level: null, canonical_subject_id: 'cs-1', qualification_id: null, qualification_name: null, programme_id: 'prog', programme_name: 'Saber 11', programme_type: 'ADMISSION_EXAM', organization_id: 'org', organization_name: 'ICFES' }] : [])],
    [/FROM structure_nodes WHERE structure_version_id = \$1/, () => [{ id: 'n-1', parent_id: null, node_type: 'EXAM_SECTION', code: 'sec.math', label: 'Matemáticas', order_index: 0 }]],
    [/FROM learning_objectives lo JOIN structure_nodes sn/, () => [{ id: 'lo-mapped', structure_node_id: 'n-1', code: 'icfes.mat.razonamiento', description: 'Razonamiento' }, { id: 'lo-unmapped', structure_node_id: 'n-1', code: 'icfes.mat.otro', description: 'Otro' }]],
    [/FROM objective_concept_mappings WHERE learning_objective_id = ANY\(\$1::uuid\[\]\) AND status = 'PUBLISHED'/, () => [{ learning_objective_id: 'lo-mapped', canonical_concept_id: CANON_A, relation_type: 'PARTIAL' }, { learning_objective_id: 'lo-mapped', canonical_concept_id: CANON_B, relation_type: 'PARTIAL' }]],
    [/FROM canonical_concepts WHERE id = ANY/, () => [{ id: CANON_A, name: 'Álgebra', canonical_subject_id: 'cs-1' }, { id: CANON_B, name: 'Funciones', canonical_subject_id: 'cs-1' }]],
  ];

  it('loads one structure version as the canonical scope, with DEV shape (bootstrap sections, unmapped objectives)', async () => {
    routes = scopeRoutes;
    const scope = (await loadCurriculumScope('sv-1'))!;
    expect(scope.organization?.name).toBe('ICFES');
    expect(scope.structureVersion).toEqual({ id: 'sv-1', label: '2026', status: 'PUBLISHED' });
    expect(conceptsOfObjective(scope, 'lo-mapped').sort()).toEqual([CANON_A, CANON_B].sort());
    expect(nodesOfConcept(scope, CANON_A)).toEqual(['n-1']);
    expect(curriculumScopeGaps(scope)).toEqual({ objectivesWithoutConcept: ['lo-unmapped'], hierarchyIsBootstrapOnly: true });
    expect(await loadCurriculumScope('sv-missing')).toBeNull();
    expect(log.every((q) => /^\s*SELECT/i.test(q.sql))).toBe(true);
  });

  it('resolves the scope of a subject and of an objective by reference', async () => {
    routes = [
      [/FROM structure_versions WHERE academic_subject_id = \$1 AND status = 'PUBLISHED'/, (p) => (p[0] === 'subj-1' ? [{ id: 'sv-1' }] : [])],
      [/FROM learning_objectives lo JOIN structure_nodes sn ON sn\.id = lo\.structure_node_id JOIN structure_versions sv/, () => [{ structure_version_id: 'sv-1', academic_subject_id: 'subj-1' }]],
    ];
    expect(await publishedScopeRefForSubject('subj-1')).toEqual({ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' });
    expect(await publishedScopeRefForSubject('subj-none')).toBeNull();
    expect(await scopeRefForObjective('lo-mapped')).toEqual({ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' });
  });
});

describe('B1 integration -- explicit link when a concept is created from the catalogue', () => {
  it('writes the link with the canonical id it was created from, and reads no label to do it', async () => {
    let stored: string | null = null;
    routes = [
      [/INSERT INTO concept_catalog_mapping/, (p) => { stored = p[1]; return []; }],
      [/SELECT canonical_concept_id FROM concept_catalog_mapping WHERE learner_concept_id = \$1/, () => (stored ? [{ canonical_concept_id: stored }] : [])],
    ];
    await linkLearnerConceptCreatedFromCanonical('lc-new', CANON_A);
    const insert = log.find((q) => /INSERT INTO concept_catalog_mapping/.test(q.sql))!;
    expect(insert.params).toEqual(['lc-new', CANON_A]);
    expect(insert.sql).toMatch(/'MATCHED', 'PLAN_ENROLLMENT'/);
    expect(insert.sql).toMatch(/ON CONFLICT \(learner_concept_id\) DO NOTHING/);
    expect(log.some((q) => /concept_localizations|canonical_concepts|lower\(/.test(q.sql))).toBe(false);
  });

  it('never overwrites a link that already points elsewhere', async () => {
    routes = [[/SELECT canonical_concept_id FROM concept_catalog_mapping WHERE learner_concept_id = \$1/, () => [{ canonical_concept_id: CANON_B }]]];
    await expect(linkLearnerConceptCreatedFromCanonical('lc-old', CANON_A)).rejects.toThrow('CATALOG_MAPPING_MISMATCH');
    expect(log.some((q) => /UPDATE/.test(q.sql))).toBe(false);
  });

  it('"Reforzar": the exam bridge creates the Student concept and links it explicitly (behaviour preserved)', async () => {
    let stored: string | null = null;
    routes = [
      [/FROM canonical_concepts cc JOIN canonical_subjects cs/, () => [{ name: 'Álgebra', subject_name: 'Matemáticas' }]],
      [/SELECT id FROM subjects WHERE student_id = \$1/, () => [{ id: 'subj-own' }]],
      [/INSERT INTO concepts \(subject_id, canonical_id\)/, () => [{ id: 'lc-created' }]],
      [/INSERT INTO concept_catalog_mapping/, (p) => { stored = p[1]; return []; }],
      [/SELECT canonical_concept_id FROM concept_catalog_mapping WHERE learner_concept_id = \$1/, () => (stored ? [{ canonical_concept_id: stored }] : [])],
    ];
    const r = await addConceptToStudentLearning('stu-1', CANON_A, 'es');
    expect(r).toEqual({ studentConceptId: 'lc-created', subjectId: 'subj-own', existed: false });
    const created = log.find((q) => /INSERT INTO concepts/.test(q.sql))!;
    expect(created.params).toEqual(['subj-own', `catalog:${CANON_A}`]);
    // the label is still stored for display, and is not what links the concept
    expect(log.some((q) => /INSERT INTO concept_localizations/.test(q.sql))).toBe(true);
    expect(log.find((q) => /INSERT INTO concept_catalog_mapping/.test(q.sql))!.params).toEqual(['lc-created', CANON_A]);
    expect(log.some((q) => /concept_catalog_mapping_candidates/.test(q.sql))).toBe(false);
  });
});
