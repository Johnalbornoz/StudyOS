/**
 * B1 -- Curriculum identity and Canonical Concept Identity (domain / contract tests).
 *
 * Curriculum: a canonical concept is not owned by a topic; its place in a hierarchy exists only inside a
 * structure version, through objectives (many-to-many).
 * Identity: a learner concept relates to a canonical concept through an explicit stored link; a label match
 * is not an authority; an unresolved concept stays unresolved.
 */
import { describe, it, expect } from 'vitest';
import { buildCurriculumScope, conceptsOfNode, conceptsOfObjective, curriculumScopeGaps, nodesOfConcept, objectivesOfConcept, scopeRef, type CurriculumScopeHeader } from '@/lib/curriculum/curriculum-scope';
import { authoritativeCanonicalConceptId, canonicalConceptIdForAssessment, classifyConceptIdentity, isUsableForAssessmentPlanning, legacyMatchedCanonicalConceptId, keyNamesCanonicalConcept, MAPPING_LIFECYCLE_DEFERRED, summarizeConceptIdentities, type ConceptLinkFacts } from '@/lib/catalog/concept-identity';

const CANON = '11111111-2222-3333-4444-555555555555';
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const header = (versionId: string, label: string): CurriculumScopeHeader => ({
  organization: { id: 'org', name: 'Awarding body' },
  programme: { id: 'prog', name: 'Programme', type: 'CURRICULUM' },
  qualification: { id: 'qual', name: 'Qualification' },
  subject: { academicSubjectId: 'subj', name: 'Mathematics', level: 'HL', canonicalSubjectId: 'cs-math' },
  structureVersion: { id: versionId, label, status: 'PUBLISHED' },
});

const concepts = [
  { id: 'c-quadratics', name: 'Quadratics', canonical_subject_id: 'cs-math' },
  { id: 'c-functions', name: 'Functions', canonical_subject_id: 'cs-math' },
  { id: 'c-unused', name: 'Unused', canonical_subject_id: 'cs-math' },
];

/** Version 2025: Quadratics sits under Algebra AND under Functions (two objectives). */
const v2025 = buildCurriculumScope(header('sv-2025', '2025'), {
  nodes: [
    { id: 'n-alg', parent_id: null, node_type: 'TOPIC', code: 'ALG', label: 'Algebra', order_index: 0 },
    { id: 'n-fun', parent_id: null, node_type: 'TOPIC', code: 'FUN', label: 'Functions', order_index: 1 },
  ],
  objectives: [
    { id: 'lo-1', structure_node_id: 'n-alg', code: 'A1', description: 'Solve quadratic equations' },
    { id: 'lo-2', structure_node_id: 'n-fun', code: 'F1', description: 'Graph quadratic functions' },
    { id: 'lo-3', structure_node_id: 'n-fun', code: 'F2', description: 'Unmapped objective' },
  ],
  mappings: [
    { learning_objective_id: 'lo-1', canonical_concept_id: 'c-quadratics', relation_type: 'FULL' },
    { learning_objective_id: 'lo-2', canonical_concept_id: 'c-quadratics', relation_type: 'PARTIAL' },
    { learning_objective_id: 'lo-2', canonical_concept_id: 'c-functions', relation_type: 'FULL' },
    // a mapping of an objective that is NOT in this version is ignored
    { learning_objective_id: 'lo-other-version', canonical_concept_id: 'c-unused', relation_type: 'FULL' },
  ],
  concepts,
});

/** Version 2027: the SAME canonical concept now sits under a different node. */
const v2027 = buildCurriculumScope(header('sv-2027', '2027'), {
  nodes: [{ id: 'n-mod', parent_id: null, node_type: 'TOPIC', code: 'MOD', label: 'Modelling', order_index: 0 }],
  objectives: [{ id: 'lo-9', structure_node_id: 'n-mod', code: 'M1', description: 'Model with quadratics' }],
  mappings: [{ learning_objective_id: 'lo-9', canonical_concept_id: 'c-quadratics', relation_type: 'FULL' }],
  concepts,
});

describe('B1 CurriculumScope -- version-aware, concept is not owned by a topic', () => {
  it('carries organization -> programme -> qualification -> subject -> structure version', () => {
    expect(v2025.organization?.name).toBe('Awarding body');
    expect(v2025.programme?.id).toBe('prog');
    expect(v2025.qualification?.id).toBe('qual');
    expect(v2025.subject).toMatchObject({ academicSubjectId: 'subj', level: 'HL', canonicalSubjectId: 'cs-math' });
    expect(scopeRef(v2025)).toEqual({ structureVersionId: 'sv-2025', academicSubjectId: 'subj' });
  });

  it('a canonical concept may appear under SEVERAL nodes of one version', () => {
    expect(nodesOfConcept(v2025, 'c-quadratics').sort()).toEqual(['n-alg', 'n-fun']);
  });

  it('the SAME canonical concept appears under a DIFFERENT node in another version: membership is contextual', () => {
    expect(nodesOfConcept(v2027, 'c-quadratics')).toEqual(['n-mod']);
    expect(nodesOfConcept(v2025, 'c-quadratics')).not.toContain('n-mod');
  });

  it('an objective may map to several concepts and a concept to several objectives (many-to-many)', () => {
    expect(conceptsOfObjective(v2025, 'lo-2').sort()).toEqual(['c-functions', 'c-quadratics']);
    expect(objectivesOfConcept(v2025, 'c-quadratics').sort()).toEqual(['lo-1', 'lo-2']);
    expect(conceptsOfNode(v2025, 'n-fun').sort()).toEqual(['c-functions', 'c-quadratics']);
  });

  it('only concepts reachable in THIS version are in the scope; other versions do not leak in', () => {
    expect(v2025.canonicalConcepts.map((c) => c.id).sort()).toEqual(['c-functions', 'c-quadratics']);
    expect(v2025.objectiveConcepts.some((m) => m.learningObjectiveId === 'lo-other-version')).toBe(false);
  });

  it('the scope type has no field that would make a concept belong to a node', () => {
    for (const c of v2025.canonicalConcepts) expect(Object.keys(c).sort()).toEqual(['canonicalSubjectId', 'id', 'name']);
  });

  it('an unmapped objective stays visible as a gap; it is never filled in', () => {
    expect(curriculumScopeGaps(v2025).objectivesWithoutConcept).toEqual(['lo-3']);
    expect(conceptsOfObjective(v2025, 'lo-3')).toEqual([]);
  });

  it('nodes an exam configuration bootstrapped are reported as assessment sections, not curriculum hierarchy', () => {
    const bootstrap = buildCurriculumScope(header('sv-x', 'exam'), {
      nodes: [{ id: 'n-s1', parent_id: null, node_type: 'EXAM_SECTION', code: 'sec.p1', label: 'Paper 1', order_index: 0 }],
      objectives: [],
      mappings: [],
      concepts: [],
    });
    expect(bootstrap.nodes[0].origin).toBe('BOOTSTRAP_ASSESSMENT_SECTION');
    expect(curriculumScopeGaps(bootstrap).hierarchyIsBootstrapOnly).toBe(true);
    expect(curriculumScopeGaps(v2025).hierarchyIsBootstrapOnly).toBe(false);
    expect(v2025.nodes.every((n) => n.origin === 'CURRICULUM_HIERARCHY')).toBe(true);
  });

  it('PREREQUISITE / SUPPORTING relations are kept but are not covering relations by default', () => {
    const s = buildCurriculumScope(header('sv-r', 'r'), {
      nodes: [{ id: 'n', parent_id: null, node_type: 'TOPIC', code: 'N', label: 'N', order_index: 0 }],
      objectives: [{ id: 'lo', structure_node_id: 'n', code: 'L', description: '' }],
      mappings: [
        { learning_objective_id: 'lo', canonical_concept_id: 'c-quadratics', relation_type: 'PREREQUISITE' },
        { learning_objective_id: 'lo', canonical_concept_id: 'c-functions', relation_type: 'FULL' },
      ],
      concepts,
    });
    expect(conceptsOfObjective(s, 'lo')).toEqual(['c-functions']);
    expect(conceptsOfObjective(s, 'lo', ['PREREQUISITE'])).toEqual(['c-quadratics']);
  });
});

const link = (over: Partial<ConceptLinkFacts>): ConceptLinkFacts => ({ learnerConceptId: 'lc-1', conceptKey: 'some-slug', mappingStatus: 'MATCHED', canonicalConceptId: CANON, mappingMethod: null, reviewed: false, ...over });

describe('B1 Canonical Concept Identity -- explicit link, never a label match', () => {
  it('a concept enrolled / assigned from the catalogue is CANONICAL (created from canonical)', () => {
    for (const mappingMethod of ['PLAN_ENROLLMENT', 'TEACHER_ASSIGNMENT']) {
      expect(classifyConceptIdentity(link({ mappingMethod }))).toMatchObject({ status: 'CANONICAL', canonicalConceptId: CANON, basis: 'CREATED_FROM_CANONICAL' });
    }
  });

  it('a reviewed correspondence is CANONICAL', () => {
    expect(classifyConceptIdentity(link({ mappingMethod: 'MANUAL_REVIEW' }))).toMatchObject({ status: 'CANONICAL', basis: 'REVIEWED' });
    expect(classifyConceptIdentity(link({ mappingMethod: 'EXACT_LABEL_MATCH', reviewed: true }))).toMatchObject({ status: 'CANONICAL', basis: 'REVIEWED' });
  });

  it('an EXACT_LABEL_MATCH with no other fact is TRANSITIONAL: readable, not an authority', () => {
    const id = classifyConceptIdentity(link({ mappingMethod: 'EXACT_LABEL_MATCH' }));
    expect(id).toMatchObject({ status: 'TRANSITIONAL', basis: 'LABEL_MATCH', canonicalConceptId: CANON });
    expect(authoritativeCanonicalConceptId(id)).toBeNull();
    expect(legacyMatchedCanonicalConceptId(id)).toBe(CANON);
  });

  it('a legacy MATCHED row with no method is treated like a label match (never upgraded silently)', () => {
    expect(classifyConceptIdentity(link({ mappingMethod: null })).status).toBe('TRANSITIONAL');
  });

  it('the creation key of the concept proves it was created from that canonical concept (both key shapes)', () => {
    expect(keyNamesCanonicalConcept(`catalog:${CANON}`, CANON)).toBe(true);
    expect(keyNamesCanonicalConcept(`CANON_${CANON.replace(/-/g, '').toUpperCase()}`, CANON)).toBe(true);
    expect(keyNamesCanonicalConcept(`catalog:${OTHER}`, CANON)).toBe(false);
    expect(keyNamesCanonicalConcept('quadratic-equations', CANON)).toBe(false);
    // DEV shape: an exam-bridge concept that was linked by label before B1 is deterministically canonical.
    expect(classifyConceptIdentity(link({ mappingMethod: 'EXACT_LABEL_MATCH', conceptKey: `catalog:${CANON}` }))).toMatchObject({ status: 'CANONICAL', basis: 'CREATED_FROM_CANONICAL' });
    // ...but a key naming ANOTHER canonical concept proves nothing about this link.
    expect(classifyConceptIdentity(link({ mappingMethod: 'EXACT_LABEL_MATCH', conceptKey: `catalog:${OTHER}` })).status).toBe('TRANSITIONAL');
  });

  it('an unresolved learner concept stays UNRESOLVED, whatever its label or key says', () => {
    for (const mappingStatus of ['UNRESOLVED', 'AMBIGUOUS', 'PROPOSED'] as const) {
      const id = classifyConceptIdentity(link({ mappingStatus, canonicalConceptId: null, conceptKey: `catalog:${CANON}` }));
      expect(id).toEqual({ status: 'UNRESOLVED', learnerConceptId: 'lc-1', canonicalConceptId: null, mappingStatus });
      expect(legacyMatchedCanonicalConceptId(id)).toBeNull();
    }
    expect(classifyConceptIdentity(link({ mappingStatus: null, canonicalConceptId: null }))).toMatchObject({ status: 'UNRESOLVED', mappingStatus: 'NO_MAPPING_ROW' });
  });

  it('a PROPOSED candidate with a canonical id attached is still not an identity', () => {
    expect(classifyConceptIdentity(link({ mappingStatus: 'PROPOSED', canonicalConceptId: CANON })).status).toBe('UNRESOLVED');
  });

  it('B1-C consumption rule: CANONICAL is usable; TRANSITIONAL and UNRESOLVED are not valid for assessment planning', () => {
    const canonical = classifyConceptIdentity(link({ mappingMethod: 'PLAN_ENROLLMENT' }));
    const transitional = classifyConceptIdentity(link({ mappingMethod: 'EXACT_LABEL_MATCH' }));
    const unresolved = classifyConceptIdentity(link({ mappingStatus: 'UNRESOLVED', canonicalConceptId: null }));
    expect(canonicalConceptIdForAssessment(canonical)).toBe(CANON);
    expect(canonicalConceptIdForAssessment(transitional)).toBeNull();
    expect(canonicalConceptIdForAssessment(unresolved)).toBeNull();
    expect(canonicalConceptIdForAssessment(null)).toBeNull();
    expect([canonical, transitional, unresolved].map(isUsableForAssessmentPlanning)).toEqual([true, false, false]);
    // the legacy display reader still sees the stored match; it is not an assessment input
    expect(legacyMatchedCanonicalConceptId(transitional)).toBe(CANON);
  });

  it('the proposed -> confirmed mapping lifecycle is recorded as deferred, not implemented', () => {
    expect([...MAPPING_LIFECYCLE_DEFERRED]).toEqual(['AUTO_DISCOVERY', 'PROPOSED', 'REVIEW_CONFIRMATION', 'CANONICAL']);
  });

  it('the summary keeps the unresolved population visible (no coverage is manufactured)', () => {
    const ids = [
      classifyConceptIdentity(link({ learnerConceptId: 'a', mappingMethod: 'PLAN_ENROLLMENT' })),
      classifyConceptIdentity(link({ learnerConceptId: 'b', mappingMethod: 'EXACT_LABEL_MATCH' })),
      classifyConceptIdentity(link({ learnerConceptId: 'c', mappingStatus: 'UNRESOLVED', canonicalConceptId: null })),
      classifyConceptIdentity(link({ learnerConceptId: 'd', mappingStatus: null, canonicalConceptId: null })),
    ];
    expect(summarizeConceptIdentities(ids)).toEqual({ total: 4, canonical: 1, transitional: 1, unresolved: 2 });
  });
});
