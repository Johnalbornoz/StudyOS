/**
 * IB_CANONICAL_CONCEPT_MODEL: StudyUs canonical knowledge -> governed IB source reference, checked against the facts the
 * repository holds. No IB topic is invented; a proposed identity is never treated as governed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { governanceOf, IB_AA_HL_APPLICABILITY, IB_AA_HL_CONCEPT_IDENTITIES, IB_AA_HL_CORRESPONDENCES, IB_CONCEPT_IDENTITY_DECISION } from '@/lib/curriculum/ib/ib-aa-hl-concept-correspondence';
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
  it('identities: math.alg.quadratics GOVERNED; the seven others GOVERNED_PILOT by the recorded architecture decision -- no human reviewer', () => {
    const statuses = IB_AA_HL_CORRESPONDENCES.map((c) => [c.constructId, governanceOf(c, facts).status]);
    expect(statuses.filter(([, s]) => s === 'GOVERNED').map(([id]) => id)).toEqual(['tf.math.quadratic.minimum-value']);
    expect(statuses.filter(([, s]) => s === 'GOVERNED_PILOT')).toHaveLength(9);
    const pilot = IB_AA_HL_CONCEPT_IDENTITIES.filter((x) => x.status === 'GOVERNED_PILOT');
    expect(pilot).toHaveLength(7);
    expect(IB_CONCEPT_IDENTITY_DECISION).toMatchObject({ decision: 'APPROVED', basis: 'ARCHITECTURE_GOVERNANCE_DECISION', reviewScope: 'PILOT', humanReviewer: null });
    const csv = readFileSync(join(process.cwd(), 'docs/audits/exam-bank/IB_CONCEPT_IDENTITY_DECISIONS.csv'), 'utf8').trim().split('\n');
    expect(csv).toHaveLength(8);
    for (const line of csv.slice(1)) expect(line).toMatch(/,APPROVED,ARCHITECTURE_GOVERNANCE_DECISION,PILOT,IB-CONCEPT-IDENTITIES-2026-10-14,,2026-10-14,/); // human_reviewer empty
    for (const p of pilot) expect(csv.some((l) => l.startsWith(`${p.stableId},`)), p.stableId).toBe(true);
    // a pilot identity is not a PAA-certified one, and no PAA identity is reused for a different concept
    const governed = new Set(PAA_CERTIFIED_CONCEPTS.map((c) => c.stableId));
    for (const p of pilot) expect(governed.has(p.stableId), p.stableId).toBe(false);
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

// ---------------------------------------------------------------------------- bucket governance
import { governBlueprint } from '@/lib/assessment-instance/v52/object-governance';
import { LIBRARY, LIBRARY_APPLICABILITY, LIBRARY_BLUEPRINT_EXTENSIONS, LIBRARY_BLUEPRINT_IB, PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { governLibrary } from '@/lib/assessment-instance/v52/library-batch';

describe('IB bucket governance with the pilot-governed identities', () => {
  it('the IB register holds the existing objective links (DECLARED_REVIEWED) for the seven, scoped to their paper', () => {
    expect(IB_AA_HL_APPLICABILITY).toHaveLength(7);
    for (const r of IB_AA_HL_APPLICABILITY) expect(r).toMatchObject({ basis: 'REVIEWED_CATALOGUE_LINK', evidence: [{ kind: 'OBJECTIVE_CONCEPT_LINK', reviewState: 'DECLARED_REVIEWED' }] });
  });
  it('without the pilot identities the new classifications fail ONLY on the concept link; with them they are AUTOMATED_CERTIFIED_PILOT', () => {
    for (const b of LIBRARY_BLUEPRINT_EXTENSIONS) {
      const before = governBlueprint(b, LIBRARY_APPLICABILITY);
      expect(before.checks.filter((c) => !c.passed).map((c) => c.code)).toEqual(['EVERY_BUCKET_LINKS_AN_ASSESSED_CONCEPT']);
      expect(governBlueprint(b, PUBLICATION_APPLICABILITY)).toMatchObject({ state: 'AUTOMATED_CERTIFIED_PILOT' });
    }
  });
  it('P1 algebra + calculus, P2 statistics: AUTOMATED_CERTIFIED_PILOT; P1 functions stays HUMAN_CERTIFIED D02; P2 adapter AUTOMATED', () => {
    const human = JSON.parse(readFileSync(join(process.cwd(), 'docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json'), 'utf8'));
    const g = governLibrary({ records: human.records.map((r: any) => r.record), qualifications: [human.qualification] } as never, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
    const find = (id: string, v: string) => g.blueprints.find((d) => d.objectId === id && d.objectVersion === v)!;
    expect(find('v2.ib.math-aa-hl/p1', 'cf-ib-aahl-01-p1').state).toBe('AUTOMATED_CERTIFIED_PILOT');
    expect(find('v2.ib.math-aa-hl/p2', 'cf-ib-aahl-01-p2').state).toBe('AUTOMATED_CERTIFIED_PILOT');
    expect(['HUMAN_CERTIFIED', 'AUTOMATED_CERTIFIED_PILOT']).toContain(find('v2.ib.math-aa-hl/p1', 'step4b-pilot-1').state);
    expect(g.adapters.find((d) => d.objectId === 'IB.MATH_AA_HL.P2')!.state).toBe('AUTOMATED_CERTIFIED_PILOT');
    // positions: P1 functions 1 (D02) + algebra 1 + calculus 2, P2 statistics 2 -> 6 of the 9 pilot positions
    expect([...LIBRARY_BLUEPRINT_IB.buckets, ...LIBRARY_BLUEPRINT_EXTENSIONS.flatMap((b) => b.buckets)].reduce((n, b) => n + b.governedPositions, 0)).toBe(6);
    // the V5.2 library and its governance are unchanged
    expect(LIBRARY.length).toBe(10);
  });
});
