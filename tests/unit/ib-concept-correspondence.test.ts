/**
 * IB_CANONICAL_CONCEPT_MODEL: StudyUs canonical knowledge -> governed IB source reference, checked against the facts the
 * repository holds. No IB topic is invented; a proposed identity is never treated as governed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { governanceOf, IB_AA_HL_CONCEPT_IDENTITIES, IB_AA_HL_CORRESPONDENCES } from '@/lib/curriculum/ib/ib-aa-hl-concept-correspondence';
import { allLearningLinks } from '@/lib/exam-core/catalog/objective-learning-links';
import { DEV_CANONICAL_CONCEPTS } from '@/lib/exam-core/catalog/dev-learning-catalog';
import { PAA_CERTIFIED_CONCEPTS } from '@/lib/curriculum/paa/paa-certified-concepts';
import { IB_MATH_AA_HL_V2 } from '@/lib/exam-core/verticals/v2';

const objectives = ((IB_MATH_AA_HL_V2 as any).sections as any[]).flatMap((c: any) => c.objectives ?? []) as { code: string; description: string }[];
const links = allLearningLinks();
const facts = {
  objectiveDescription: (code: string) => objectives.find((o) => o.code === code)?.description ?? null,
  objectiveLinks: (code: string) => (links[code]?.concepts ?? []).map((x: any) => ({ subject: x.subject ?? x.canonicalSubject, name: x.name ?? x.canonicalName })),
  catalogue: DEV_CANONICAL_CONCEPTS,
};
const PKG = JSON.parse(readFileSync(join(process.cwd(), 'docs/exams/content-factory/CF-IB-AAHL-01/CF-IB-AAHL-01_CANDIDATE_PACKAGE.json'), 'utf8')) as { constructs: any[] };

describe('IB_CANONICAL_CONCEPT_MODEL', () => {
  it('one correspondence per CF-IB-AAHL-01 construct, each to the objective the package targets', () => {
    expect(IB_AA_HL_CORRESPONDENCES.map((c) => c.constructId).sort()).toEqual(PKG.constructs.map((k) => k.proposedCoreId).sort());
    for (const k of PKG.constructs) expect(IB_AA_HL_CORRESPONDENCES.find((c) => c.constructId === k.proposedCoreId)!.ibSourceReference.objectiveCode).toBe(k.objectiveCode);
  });
  it('10/10 are source-backed: the governed syllabus area names the construct, the objective links the concept, the concept exists in the catalogue', () => {
    expect(objectives.length).toBeGreaterThan(0);
    for (const c of IB_AA_HL_CORRESPONDENCES) expect(governanceOf(c, facts).status, c.constructId).not.toBe('NOT_DEFENSIBLE');
  });
  it('exactly one identity is governed (math.alg.quadratics, by precedent); seven are PROPOSED and fail closed', () => {
    const statuses = IB_AA_HL_CORRESPONDENCES.map((c) => [c.constructId, governanceOf(c, facts).status]);
    expect(statuses.filter(([, s]) => s === 'GOVERNED').map(([id]) => id)).toEqual(['tf.math.quadratic.minimum-value']);
    expect(statuses.filter(([, s]) => s === 'SOURCE_BACKED_IDENTITY_PENDING_DECISION')).toHaveLength(9);
    const proposed = IB_AA_HL_CONCEPT_IDENTITIES.filter((x) => x.status === 'PROPOSED_PENDING_DECISION');
    expect(proposed).toHaveLength(7);
    // a proposed identity is not a governed one, and no PAA identity is reused for a different concept
    const governed = new Set(PAA_CERTIFIED_CONCEPTS.map((c) => c.stableId));
    for (const p of proposed) expect(governed.has(p.stableId), p.stableId).toBe(false);
    expect(governed.has('math.alg.quadratics')).toBe(true);
  });
  it('every concept is StudyUs canonical knowledge, never an "official IB concept"; no topic layer is created', () => {
    for (const x of IB_AA_HL_CONCEPT_IDENTITIES) expect(x.origin).toBe('STUDYUS_CANONICAL_KNOWLEDGE');
    for (const c of IB_AA_HL_CORRESPONDENCES) expect(c.ibCorrespondenceType).toBe('SYLLABUS_AREA_CORRESPONDENCE');
    const src = readFileSync(join(process.cwd(), 'src/lib/curriculum/ib/ib-aa-hl-concept-correspondence.ts'), 'utf8');
    expect(src).not.toMatch(/node_type|structure_nodes|TOPIC'/);
  });
  it('a correspondence the source does not support is refused (fail closed)', () => {
    const bad = { ...IB_AA_HL_CORRESPONDENCES[0], ibSourceReference: { ...IB_AA_HL_CORRESPONDENCES[0].ibSourceReference, objectiveCode: 'aahl.p2.trigonometry' } };
    expect(governanceOf(bad, facts)).toMatchObject({ status: 'NOT_DEFENSIBLE' });
  });
});

// ---------------------------------------------------------------------------- bucket governance, projected
import { governBlueprint } from '@/lib/assessment-instance/v52/object-governance';
import { LIBRARY_APPLICABILITY, LIBRARY_BLUEPRINT_IB } from '@/lib/assessment-instance/library/catalogue';
import { classifyBlueprintSection } from '@/lib/assessment-instance/blueprint-classification';
import { ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';

const bucket = (paper: 'p1' | 'p2', adapterId: string, objectiveCode: string, concepts: string[]) => ({ bucketId: `v2.ib.math-aa-hl/${paper}/${objectiveCode}#0`, configKey: 'v2.ib.math-aa-hl', sectionKey: paper, adapterId, objectiveCode, primaryConceptStableIds: concepts, responseFormat: null, blueprintClass: 'REDUCED' as const });
const P1_FACTS = LIBRARY_BLUEPRINT_IB.facts;
const P1 = { ...LIBRARY_BLUEPRINT_IB, classificationVersion: 'ib-aahl-p1-2', buckets: [
  { governedPositions: 1, conceptLinks: ['aahl.p1.algebra'], bucket: bucket('p1', 'IB.MATH_AA_HL.P1', 'aahl.p1.algebra', ['math.alg.sequences-series', 'math.alg.logarithms']) },
  { governedPositions: 1, conceptLinks: ['aahl.p1.functions'], bucket: bucket('p1', 'IB.MATH_AA_HL.P1', 'aahl.p1.functions', ['math.alg.quadratics', 'math.fun.rational-functions-inverses']) },
  { governedPositions: 2, conceptLinks: ['aahl.p1.calculus'], bucket: bucket('p1', 'IB.MATH_AA_HL.P1', 'aahl.p1.calculus', ['math.calc.differentiation', 'math.calc.integration']) },
] };
const P2_FACTS = { ...P1_FACTS, governedSlots: 4 };
const P2 = { blueprintId: 'v2.ib.math-aa-hl/p2', classificationVersion: 'ib-aahl-p2-1', adapterId: 'IB.MATH_AA_HL.P2', configKey: 'v2.ib.math-aa-hl', sectionKey: 'p2', facts: P2_FACTS, blueprintClass: classifyBlueprintSection(P2_FACTS),
  buckets: [{ governedPositions: 2, conceptLinks: ['aahl.p2.statistics'], bucket: { ...bucket('p2', 'IB.MATH_AA_HL.P2', 'aahl.p2.statistics', ['math.prob.binomial-distribution', 'math.prob.normal-distribution']), blueprintClass: classifyBlueprintSection(P2_FACTS) } }] };
/** The register as it WOULD be if the seven identities were governed: the existing DECLARED_REVIEWED objective links. */
const wouldBe: AssessmentApplicabilityRecord[] = [...LIBRARY_APPLICABILITY, ...IB_AA_HL_CORRESPONDENCES.filter((c) => c.conceptExistingOrNew !== 'EXISTING_GOVERNED').map((c) => ({
  v: ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, concept: { stableId: c.studyusCanonicalConceptId, canonicalSubject: 'Mathematics' }, scope: { systemProfileId: 'IB', subject: 'Mathematics: analysis and approaches', componentId: c.assessmentApplicability.componentId }, basis: 'REVIEWED_CATALOGUE_LINK' as const,
  evidence: [{ kind: 'OBJECTIVE_CONCEPT_LINK' as const, reference: c.ibSourceReference.objectiveCode, recordedIn: 'src/lib/exam-core/catalog/objective-learning-links.ts (OBJECTIVE_LEARNING_LINKS)', sourceReference: null, reviewState: 'DECLARED_REVIEWED' as const }],
} as AssessmentApplicabilityRecord)).filter((r, k, all) => all.findIndex((x) => x.concept.stableId === r.concept.stableId && x.scope.componentId === r.scope.componentId) === k)];

describe('IB bucket governance: the exact remaining blocker', () => {
  it('TODAY: P1 algebra + calculus and P2 statistics are refused only because their concepts are not established', () => {
    const p1 = governBlueprint(P1 as any, LIBRARY_APPLICABILITY);
    const p2 = governBlueprint(P2 as any, LIBRARY_APPLICABILITY);
    for (const d of [p1, p2]) {
      expect(d.state).toBe('REVIEW_REQUIRED');
      expect(d.checks.filter((c) => !c.passed).map((c) => c.code)).toEqual(['EVERY_BUCKET_LINKS_AN_ASSESSED_CONCEPT']);
    }
  });
  it('ONCE the seven identities are governed, both classifications pass the automated pilot governance with no other change', () => {
    expect(governBlueprint(P1 as any, wouldBe).state).toBe('AUTOMATED_CERTIFIED_PILOT');
    expect(governBlueprint(P2 as any, wouldBe).state).toBe('AUTOMATED_CERTIFIED_PILOT');
    // positions: P1 algebra 1 + functions 1 + calculus 2, P2 statistics 2 -> 6 of the 9 pilot positions
    expect([...P1.buckets, ...P2.buckets].reduce((n, b) => n + b.governedPositions, 0)).toBe(6);
  });
});
