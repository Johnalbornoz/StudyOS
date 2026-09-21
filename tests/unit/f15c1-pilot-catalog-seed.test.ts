/**
 * F15-C1 -- src/lib/assessment/pilot-catalog-seed.service.ts
 *
 * Mocks every downstream F4/F6/F7 service function directly (never the
 * raw SQL each of them issues) so these tests exercise ONLY this
 * seed's own orchestration: idempotency checks, collision aborts, and
 * dry-run write suppression -- not the already-certified services it
 * calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const listOrganizations = vi.fn();
const createOrganization = vi.fn();
const listProgrammes = vi.fn();
const createProgramme = vi.fn();
const createSubject = vi.fn();
vi.mock('@/lib/curriculum/organization.service', () => ({
  listOrganizations: (...a: any[]) => listOrganizations(...a),
  createOrganization: (...a: any[]) => createOrganization(...a),
  listProgrammes: (...a: any[]) => listProgrammes(...a),
  createProgramme: (...a: any[]) => createProgramme(...a),
  createSubject: (...a: any[]) => createSubject(...a),
}));

const createStructureVersion = vi.fn();
const publishStructureVersion = vi.fn();
const getPublishedStructureVersion = vi.fn();
const createStructureNode = vi.fn();
vi.mock('@/lib/curriculum/structure.service', () => ({
  createStructureVersion: (...a: any[]) => createStructureVersion(...a),
  publishStructureVersion: (...a: any[]) => publishStructureVersion(...a),
  getPublishedStructureVersion: (...a: any[]) => getPublishedStructureVersion(...a),
  createStructureNode: (...a: any[]) => createStructureNode(...a),
}));

const createLearningObjective = vi.fn();
const listObjectivesForNode = vi.fn();
vi.mock('@/lib/curriculum/objective.service', () => ({
  createLearningObjective: (...a: any[]) => createLearningObjective(...a),
  listObjectivesForNode: (...a: any[]) => listObjectivesForNode(...a),
}));

const listCanonicalSubjects = vi.fn();
const listCanonicalConcepts = vi.fn();
vi.mock('@/lib/catalog/canonical-catalog.service', () => ({
  listCanonicalSubjects: (...a: any[]) => listCanonicalSubjects(...a),
  listCanonicalConcepts: (...a: any[]) => listCanonicalConcepts(...a),
}));

const createMapping = vi.fn();
const proposeMapping = vi.fn();
const beginReview = vi.fn();
const approveMapping = vi.fn();
const publishMapping = vi.fn();
const listMappingsForObjective = vi.fn();
vi.mock('@/lib/curriculum/mapping.service', () => ({
  createMapping: (...a: any[]) => createMapping(...a),
  proposeMapping: (...a: any[]) => proposeMapping(...a),
  beginReview: (...a: any[]) => beginReview(...a),
  approveMapping: (...a: any[]) => approveMapping(...a),
  publishMapping: (...a: any[]) => publishMapping(...a),
  listMappingsForObjective: (...a: any[]) => listMappingsForObjective(...a),
}));

const grantEditorialRole = vi.fn();
const revokeEditorialRole = vi.fn();
vi.mock('@/lib/curriculum/editorial.service', () => ({
  grantEditorialRole: (...a: any[]) => grantEditorialRole(...a),
  revokeEditorialRole: (...a: any[]) => revokeEditorialRole(...a),
}));

const createExamDefinition = vi.fn();
const createScoringModel = vi.fn();
const createExamVersion = vi.fn();
const publishExamVersion = vi.fn();
vi.mock('@/lib/assessment/exam-definition.service', () => ({
  createExamDefinition: (...a: any[]) => createExamDefinition(...a),
  createScoringModel: (...a: any[]) => createScoringModel(...a),
  createExamVersion: (...a: any[]) => createExamVersion(...a),
  publishExamVersion: (...a: any[]) => publishExamVersion(...a),
}));

const createComponent = vi.fn();
const configureTiming = vi.fn();
const configureToolRules = vi.fn();
const markSupported = vi.fn();
vi.mock('@/lib/assessment/component.service', () => ({
  createComponent: (...a: any[]) => createComponent(...a),
  configureTiming: (...a: any[]) => configureTiming(...a),
  configureToolRules: (...a: any[]) => configureToolRules(...a),
  markSupported: (...a: any[]) => markSupported(...a),
}));

const createBlueprint = vi.fn();
const publishBlueprint = vi.fn();
const addComponentAllocation = vi.fn();
const addObjectiveTarget = vi.fn();
const getBlueprintForVersion = vi.fn();
const listObjectiveTargets = vi.fn();
const listComponentAllocations = vi.fn();
vi.mock('@/lib/assessment/blueprint.service', () => ({
  createBlueprint: (...a: any[]) => createBlueprint(...a),
  publishBlueprint: (...a: any[]) => publishBlueprint(...a),
  addComponentAllocation: (...a: any[]) => addComponentAllocation(...a),
  addObjectiveTarget: (...a: any[]) => addObjectiveTarget(...a),
  getBlueprintForVersion: (...a: any[]) => getBlueprintForVersion(...a),
  listObjectiveTargets: (...a: any[]) => listObjectiveTargets(...a),
  listComponentAllocations: (...a: any[]) => listComponentAllocations(...a),
}));

import { runPilotExamCatalogSeed, AbortSeed } from '@/lib/assessment/pilot-catalog-seed.service';

const MATH_SUBJECT = { id: 'canon-subj-math', name: 'Mathematics', status: 'ACTIVE' };
const MATH_CONCEPT = { id: 'canon-concept-algebra', canonicalSubjectId: 'canon-subj-math', name: 'Algebra I', status: 'ACTIVE' };

function mockEverythingAbsent() {
  listOrganizations.mockResolvedValue([]);
  createOrganization.mockResolvedValue({ id: 'org-1', name: 'College Board', status: 'ACTIVE' });
  listProgrammes.mockResolvedValue([]);
  createProgramme.mockResolvedValue({ id: 'prog-1', organizationId: 'org-1', name: 'PAA (Pilot)', programmeType: 'ADMISSION_EXAM', stage: null, status: 'ACTIVE' });
  createSubject.mockResolvedValue({ id: 'subj-1', programmeId: 'prog-1', name: 'Mathematics (Pilot)', qualificationId: null, level: null, status: 'ACTIVE' });
  getPublishedStructureVersion.mockResolvedValue(null);
  createStructureVersion.mockResolvedValue({ id: 'sv-1', academicSubjectId: 'subj-1', versionLabel: 'Pilot 2026 v1', effectiveFrom: null, effectiveTo: null, status: 'DRAFT', sourceLocator: null });
  publishStructureVersion.mockResolvedValue({});
  createStructureNode.mockResolvedValue({ id: 'node-1', structureVersionId: 'sv-1', parentId: null, nodeType: 'TOPIC', sourceLabel: 'Mathematics (Pilot Catalog)', code: null, orderIndex: 0, description: null, status: 'ACTIVE' });
  listObjectivesForNode.mockResolvedValue([]);
  createLearningObjective.mockResolvedValue({ id: 'obj-1', structureNodeId: 'node-1', code: null, description: 'x', status: 'ACTIVE' });
  listCanonicalSubjects.mockResolvedValue([MATH_SUBJECT]);
  listCanonicalConcepts.mockResolvedValue([MATH_CONCEPT]);
  listMappingsForObjective.mockResolvedValue([]);
  createMapping.mockResolvedValue({ id: 'map-1', learningObjectiveId: 'obj-1', targetId: MATH_CONCEPT.id, relationType: 'FULL', status: 'DRAFT' });
  proposeMapping.mockResolvedValue({});
  beginReview.mockResolvedValue({});
  approveMapping.mockResolvedValue({});
  publishMapping.mockResolvedValue({});
  grantEditorialRole.mockResolvedValue(undefined);
  revokeEditorialRole.mockResolvedValue(undefined);
  createExamDefinition.mockResolvedValue({ id: 'def-1', academicProgrammeId: 'prog-1', name: 'PAA Mathematics (Pilot)', examFamily: 'PAA', purpose: 'x', domains: null, status: 'ACTIVE' });
  createScoringModel.mockResolvedValue({ id: 'score-1', name: 'x', scoringType: 'BINARY', config: null, status: 'ACTIVE' });
  createExamVersion.mockResolvedValue({ id: 'ver-1', examDefinitionId: 'def-1', versionLabel: 'Pilot 2026 v1', effectiveFrom: null, effectiveTo: null, navigationRules: null, scoringModelId: null, supportedModalities: null, status: 'DRAFT' });
  publishExamVersion.mockResolvedValue({});
  createComponent.mockResolvedValue({ id: 'comp-1', examVersionId: 'ver-1', name: 'Mathematics', componentType: 'SECTION', modality: null, academicSubjectId: 'subj-1', timingStatus: 'NOT_CONFIGURED', durationMinutes: null, toolRuleStatus: 'NOT_CONFIGURED', toolRules: null, procedureRequired: false, simulationCapable: false, supportStatus: 'UNSUPPORTED' });
  configureTiming.mockResolvedValue({});
  configureToolRules.mockResolvedValue({});
  markSupported.mockResolvedValue({});
  getBlueprintForVersion.mockResolvedValue(null);
  createBlueprint.mockResolvedValue({ id: 'bp-1', examVersionId: 'ver-1', status: 'DRAFT' });
  publishBlueprint.mockResolvedValue({});
  listComponentAllocations.mockResolvedValue([]);
  addComponentAllocation.mockResolvedValue(undefined);
  listObjectiveTargets.mockResolvedValue([]);
  addObjectiveTarget.mockResolvedValue({});
  queryMock.mockImplementation((sql: string) => {
    if (/FROM academic_subjects/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM structure_versions/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM structure_nodes/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM exam_definitions/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM scoring_models/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM exam_versions/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM assessment_components/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM users/.test(sql)) return Promise.resolve({ rows: [{ id: 'user-editor' }, { id: 'user-reviewer' }] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEverythingAbsent();
});

describe('runPilotExamCatalogSeed', () => {
  it('A. dry-run performs zero writes', async () => {
    const result = await runPilotExamCatalogSeed(false);

    expect(createOrganization).not.toHaveBeenCalled();
    expect(createProgramme).not.toHaveBeenCalled();
    expect(createSubject).not.toHaveBeenCalled();
    expect(createStructureVersion).not.toHaveBeenCalled();
    expect(createStructureNode).not.toHaveBeenCalled();
    expect(createLearningObjective).not.toHaveBeenCalled();
    expect(createMapping).not.toHaveBeenCalled();
    expect(createExamDefinition).not.toHaveBeenCalled();
    expect(createScoringModel).not.toHaveBeenCalled();
    expect(createExamVersion).not.toHaveBeenCalled();
    expect(createComponent).not.toHaveBeenCalled();
    expect(createBlueprint).not.toHaveBeenCalled();
    expect(addComponentAllocation).not.toHaveBeenCalled();
    expect(addObjectiveTarget).not.toHaveBeenCalled();
    expect(grantEditorialRole).not.toHaveBeenCalled();

    expect(result.write).toBe(false);
    // Every step is CREATE except the canonical-concept lookup, which is
    // always EXISTS (this seed only ever finds an existing one, never
    // creates one -- see test E).
    const nonConceptSteps = result.plan.filter((s) => s.entity !== 'CanonicalConcept (existing, not created)');
    expect(nonConceptSteps.every((s) => s.action === 'CREATE')).toBe(true);
    expect(result.plan.some((s) => s.entity === 'CanonicalConcept (existing, not created)' && s.action === 'EXISTS')).toBe(true);
  });

  it('B. first --write execution creates exactly the expected catalog, publishing the mapping via a temporary, revoked grant', async () => {
    const result = await runPilotExamCatalogSeed(true);

    expect(createOrganization).toHaveBeenCalledWith('College Board');
    expect(createProgramme).toHaveBeenCalledWith(expect.objectContaining({ name: 'PAA (Pilot)', programmeType: 'ADMISSION_EXAM' }));
    expect(createSubject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mathematics (Pilot)' }));
    expect(createStructureVersion).toHaveBeenCalled();
    expect(publishStructureVersion).toHaveBeenCalledWith('sv-1');
    expect(createStructureNode).toHaveBeenCalled();
    expect(createLearningObjective).toHaveBeenCalled();

    // Mapping workflow: grant -> full transition chain -> revoke, in that order.
    expect(grantEditorialRole).toHaveBeenCalledWith('user-editor', 'EDITOR', 'user-editor');
    expect(grantEditorialRole).toHaveBeenCalledWith('user-reviewer', 'REVIEWER', 'user-editor');
    expect(grantEditorialRole).toHaveBeenCalledWith('user-reviewer', 'PUBLISHER', 'user-editor');
    expect(createMapping).toHaveBeenCalledWith('CONCEPT', 'user-editor', expect.objectContaining({ targetId: MATH_CONCEPT.id }));
    expect(proposeMapping).toHaveBeenCalledWith('CONCEPT', 'user-editor', 'map-1');
    expect(beginReview).toHaveBeenCalledWith('CONCEPT', 'user-reviewer', 'map-1');
    expect(approveMapping).toHaveBeenCalledWith('CONCEPT', 'user-reviewer', 'map-1');
    expect(publishMapping).toHaveBeenCalledWith('CONCEPT', 'user-reviewer', 'map-1');
    expect(revokeEditorialRole).toHaveBeenCalledWith('user-editor', 'EDITOR');
    expect(revokeEditorialRole).toHaveBeenCalledWith('user-reviewer', 'REVIEWER');
    expect(revokeEditorialRole).toHaveBeenCalledWith('user-reviewer', 'PUBLISHER');

    // Exam definition ACTIVE, version published, scoring model created but NOT attached.
    expect(createExamDefinition).toHaveBeenCalledWith(expect.objectContaining({ name: 'PAA Mathematics (Pilot)', examFamily: 'PAA' }));
    expect(createScoringModel).toHaveBeenCalled();
    expect(createExamVersion).toHaveBeenCalledWith(expect.not.objectContaining({ scoringModelId: expect.anything() }));
    expect(publishExamVersion).toHaveBeenCalledWith('ver-1');

    // Component supported, blueprint published, allocation + target wired.
    expect(createComponent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mathematics', componentType: 'SECTION' }));
    expect(configureTiming).toHaveBeenCalled();
    expect(configureToolRules).toHaveBeenCalled();
    expect(markSupported).toHaveBeenCalledWith('comp-1', true);
    expect(createBlueprint).toHaveBeenCalledWith('ver-1');
    expect(addComponentAllocation).toHaveBeenCalled();
    expect(addObjectiveTarget).toHaveBeenCalled();
    expect(publishBlueprint).toHaveBeenCalledWith('bp-1');

    expect(result.mappingPublished).toBe(true);
    expect(result.canonicalConceptName).toBe('Algebra I');
  });

  it('C. second --write execution reports EXISTS everywhere and creates zero duplicates', async () => {
    // Simulate the post-first-run state: everything now exists.
    listOrganizations.mockResolvedValue([{ id: 'org-1', name: 'College Board', status: 'ACTIVE' }]);
    listProgrammes.mockResolvedValue([{ id: 'prog-1', organizationId: 'org-1', name: 'PAA (Pilot)', programmeType: 'ADMISSION_EXAM', stage: null, status: 'ACTIVE' }]);
    getPublishedStructureVersion.mockResolvedValue({ id: 'sv-1', academicSubjectId: 'subj-1', versionLabel: 'Pilot 2026 v1', status: 'PUBLISHED' });
    listObjectivesForNode.mockResolvedValue([{ id: 'obj-1', structureNodeId: 'node-1', code: null, description: 'Pilot configuration objective for PAA Mathematics -- non-official, functional placeholder only.', status: 'ACTIVE' }]);
    listMappingsForObjective.mockResolvedValue([{ id: 'map-1', learningObjectiveId: 'obj-1', targetId: MATH_CONCEPT.id, status: 'PUBLISHED' }]);
    getBlueprintForVersion.mockResolvedValue({ id: 'bp-1', examVersionId: 'ver-1', status: 'PUBLISHED' });
    listComponentAllocations.mockResolvedValue([{ assessmentComponentId: 'comp-1', itemCount: 10, weight: 1 }]);
    listObjectiveTargets.mockResolvedValue([{ id: 'tgt-1', blueprintId: 'bp-1', learningObjectiveId: 'obj-1', assessmentComponentId: 'comp-1' }]);
    queryMock.mockImplementation((sql: string, params?: any[]) => {
      if (/FROM academic_subjects/.test(sql)) return Promise.resolve({ rows: [{ id: 'subj-1', status: 'ACTIVE' }] });
      if (/FROM structure_nodes/.test(sql)) return Promise.resolve({ rows: [{ id: 'node-1' }] });
      if (/FROM exam_definitions/.test(sql)) return Promise.resolve({ rows: [{ id: 'def-1', status: 'ACTIVE' }] });
      if (/FROM scoring_models/.test(sql)) return Promise.resolve({ rows: [{ id: 'score-1' }] });
      if (/FROM exam_versions/.test(sql) && /status = 'PUBLISHED'/.test(sql)) return Promise.resolve({ rows: [{ id: 'ver-1', version_label: 'Pilot 2026 v1' }] });
      if (/FROM assessment_components/.test(sql)) return Promise.resolve({ rows: [{ id: 'comp-1', support_status: 'SUPPORTED', timing_status: 'CONFIGURED', tool_rule_status: 'CONFIGURED' }] });
      if (/FROM users/.test(sql)) return Promise.resolve({ rows: [{ id: 'user-editor' }, { id: 'user-reviewer' }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await runPilotExamCatalogSeed(true);

    expect(createOrganization).not.toHaveBeenCalled();
    expect(createProgramme).not.toHaveBeenCalled();
    expect(createSubject).not.toHaveBeenCalled();
    expect(createStructureVersion).not.toHaveBeenCalled();
    expect(createStructureNode).not.toHaveBeenCalled();
    expect(createLearningObjective).not.toHaveBeenCalled();
    expect(createMapping).not.toHaveBeenCalled();
    expect(grantEditorialRole).not.toHaveBeenCalled();
    expect(createExamDefinition).not.toHaveBeenCalled();
    expect(createScoringModel).not.toHaveBeenCalled();
    expect(createExamVersion).not.toHaveBeenCalled();
    expect(createComponent).not.toHaveBeenCalled();
    expect(createBlueprint).not.toHaveBeenCalled();
    expect(addComponentAllocation).not.toHaveBeenCalled();
    expect(addObjectiveTarget).not.toHaveBeenCalled();

    expect(result.plan.every((s) => s.action === 'EXISTS')).toBe(true);
  });

  it('D. an incompatible collision (wrong programmeType) aborts rather than overwriting', async () => {
    listOrganizations.mockResolvedValue([{ id: 'org-1', name: 'College Board', status: 'ACTIVE' }]);
    listProgrammes.mockResolvedValue([{ id: 'prog-1', organizationId: 'org-1', name: 'PAA (Pilot)', programmeType: 'CURRICULUM', stage: null, status: 'ACTIVE' }]);

    await expect(runPilotExamCatalogSeed(true)).rejects.toThrow(AbortSeed);
    expect(createSubject).not.toHaveBeenCalled();
  });

  it('E. no compatible canonical concept found -- aborts and never invents an equivalence', async () => {
    listCanonicalSubjects.mockResolvedValue([{ id: 'canon-subj-history', name: 'History', status: 'ACTIVE' }]);

    await expect(runPilotExamCatalogSeed(true)).rejects.toThrow(/will not invent a canonical-concept equivalence/);
    expect(createMapping).not.toHaveBeenCalled();
    expect(createExamDefinition).not.toHaveBeenCalled();
  });

  it('F. never queries or writes students/profiles/users(as identity)/institutions/institution_memberships tables, except the 2 read-only editor/reviewer ids', async () => {
    await runPilotExamCatalogSeed(true);

    for (const call of queryMock.mock.calls) {
      const sql = String(call[0]);
      expect(sql).not.toMatch(/\bstudents\b/i);
      expect(sql).not.toMatch(/\bprofiles\b/i);
      expect(sql).not.toMatch(/\binstitutions\b/i);
      expect(sql).not.toMatch(/\binstitution_memberships\b/i);
      expect(sql).not.toMatch(/test\.local/i);
      if (/\busers\b/i.test(sql)) {
        expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
        expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
      }
    }
  });
});
