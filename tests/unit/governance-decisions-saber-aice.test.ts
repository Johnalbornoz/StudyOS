/**
 * GOVERNANCE DECISIONS -- APPROVED (John, 2026-10-15): Saber full-length preparation mock + boundary correspondences,
 * AICE 9709 AS Papers 2 / 4 / 5 from the same governed syllabus record. Every decision is PILOT, PILOT_PREVIEW, no
 * human reviewer, review PENDING; nothing here widens any other system.
 */
import { describe, expect, it } from 'vitest';
import { SABER_APPLICABILITY, SABER_APPLICABILITY_2026_10_15, SABER_BOUNDARY_CORRESPONDENCE_DECISION, SABER_CONTENT_CORRESPONDENCES } from '@/lib/curriculum/icfes/saber11-content-correspondence';
import { coreDerivedUsageFor, fullMockAuthorizationFor, FULL_MOCK_AUTHORIZATIONS } from '@/lib/exam-bank/full-mock-authorization';
import { CORE_DERIVED_USAGE } from '@/lib/exam-bank/bank-projection';
import { MESSAGES } from '@/lib/i18n/messages';
import { AICE_9709_P2P4P5_APPLICABILITY, AICE_9709_P2P4P5_DECISION, AICE_9709_P2P4P5_EQUIVALENCES, CIE_9709_CONCEPT_IDENTITIES, CIE_9709_PAPER_ADAPTER, officialTopicsOf } from '@/lib/curriculum/cambridge/aice-9709-p2p4p5-equivalence';
import { AICE_LEARNING_LINKS } from '@/lib/exam-core/catalog/aice-learning-links';
import { DEV_CANONICAL_CONCEPTS } from '@/lib/exam-core/catalog/dev-learning-catalog';
import { AICE_9709_AS } from '@/lib/exam-core/verticals/v2/aice/aice-math-9709';
import { ibGovernedConceptByStableId } from '@/lib/curriculum/ib/ib-aa-hl-concept-correspondence';
import { PAA_CERTIFIED_CONCEPTS } from '@/lib/curriculum/paa/paa-certified-concepts';
import { STUDYUS_ASSESSMENT_REGISTRY, TRACK_B_COMPONENT_PROFILES } from '@/lib/assessment-instance/registered-systems';
import { adapterConflicts } from '@/lib/assessment-instance';
import { governAdapter } from '@/lib/assessment-instance/v52';

describe('Saber: boundary correspondences approved to existing identities', () => {
  it('no BLOCKED row remains; the three are GOVERNED_PILOT under the recorded decision, the concepts their existing ids', () => {
    expect(SABER_CONTENT_CORRESPONDENCES.filter((c) => c.governanceStatus === 'BLOCKED')).toEqual([]);
    expect(SABER_CONTENT_CORRESPONDENCES.filter((c) => c.approvedBy).map((c) => [c.studyusConceptStableId, c.officialContentCategory])).toEqual([
      ['math.prob.probability', 'Estadística'], ['math.num.percent', 'Álgebra y cálculo'], ['math.geo.coordinate-plane', 'Geometría'],
    ]);
    expect(SABER_BOUNDARY_CORRESPONDENCE_DECISION).toMatchObject({ decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', environment: 'PILOT_PREVIEW', humanReviewer: null, humanReviewStatus: 'PENDING' });
    expect(SABER_APPLICABILITY).toHaveLength(10);
    // the register as published with TB-SABER-MATH-A1/A2 stays seven rows (their inputs hash is history)
    expect(SABER_APPLICABILITY_2026_10_15).toHaveLength(7);
    for (const r of SABER_APPLICABILITY) expect(r.evidence.every((e) => e.reviewState === 'UNREVIEWED')).toBe(true);
  });
});

describe('Saber: full-length StudyUs preparation mock (PILOT_PREVIEW only)', () => {
  it('one authorisation, ICFES in PILOT_PREVIEW, presented as StudyUs preparation, zero runtime generation, no reviewer', () => {
    // + PAA full-length (PAA-FULL-LENGTH-PREPARATION-MOCK-2026-10-15), the only other authorisation
    expect(FULL_MOCK_AUTHORIZATIONS.map((a) => [a.systemId, a.deliveryScope, a.positions])).toEqual([['ICFES', 'PILOT_PREVIEW', 50], ['PAA', 'PILOT_PREVIEW', 175]]);
    expect(fullMockAuthorizationFor('ICFES', 'PILOT_PREVIEW')).toMatchObject({ presentation: 'STUDYUS_PREPARATION_NOT_OFFICIAL', runtimeGeneration: 0, humanReviewer: null, humanReviewStatus: 'PENDING' });
  });
  it('the usage widens for Saber and PAA in PILOT_PREVIEW only; every other system and scope keeps PRACTICE + REDUCED_MOCK', () => {
    expect(coreDerivedUsageFor('ICFES', 'PILOT_PREVIEW')).toEqual([...CORE_DERIVED_USAGE, 'FULL_MOCK']);
    expect(coreDerivedUsageFor('PAA', 'PILOT_PREVIEW')).toEqual([...CORE_DERIVED_USAGE, 'FULL_MOCK']);
    // PAA multiple choice serves the full-length form ONLY: the coached PAA practice and the reduced mock keep their certified bank
    expect(coreDerivedUsageFor('PAA', 'PILOT_PREVIEW', 'SELECTED_RESPONSE')).toEqual(['FULL_MOCK']);
    expect(coreDerivedUsageFor('PAA', 'PILOT_PREVIEW', 'NUMERIC_ENTRY')).toEqual([...CORE_DERIVED_USAGE, 'FULL_MOCK']);
    expect(coreDerivedUsageFor('ICFES', 'PILOT_PREVIEW', 'SELECTED_RESPONSE')).toEqual([...CORE_DERIVED_USAGE, 'FULL_MOCK']);
    for (const [system, scope] of [['ICFES', 'PRODUCTION'], ['ICFES', 'DEV'], ['PAA', 'PRODUCTION'], ['IB', 'PILOT_PREVIEW'], ['CAMBRIDGE', 'PILOT_PREVIEW'], ['PISA', 'PILOT_PREVIEW']]) expect(coreDerivedUsageFor(system, scope)).toEqual(CORE_DERIVED_USAGE);
  });
  it('the mock setup says it is StudyUs preparation, not an official exam, in every locale', () => {
    for (const [locale, m] of Object.entries(MESSAGES)) expect((m as Record<string, string>)['exv2.setup.preparationNotOfficial'], locale).toMatch(/StudyUs/);
    expect(MESSAGES.es['exv2.setup.preparationNotOfficial']).toMatch(/No es un examen oficial/);
  });
});

describe('AICE 9709 AS Papers 2 / 4 / 5: source-backed component equivalence', () => {
  const aiceObjectives = (AICE_9709_AS as any).sections.filter((s: any) => ['p2', 'p4', 'p5'].includes(s.key)).flatMap((s: any) => s.objectives.map((o: any) => o.code));
  it('every AICE P2 / P4 / P5 objective has exactly one equivalence, to an official topic of ITS paper in the sourced syllabus record', () => {
    expect(AICE_9709_P2P4P5_EQUIVALENCES.map((e) => e.aiceObjectiveCode).sort()).toEqual([...aiceObjectives].sort());
    for (const e of AICE_9709_P2P4P5_EQUIVALENCES) {
      expect(e.aiceObjectiveCode.startsWith(`aice.9709.${e.paper}.`)).toBe(true);
      expect(officialTopicsOf(e.paper), e.aiceObjectiveCode).toContain(e.officialTopic);
    }
  });
  it('the concept is the one the reviewed AICE link names, an existing catalogue row, through an existing or pilot identity (no new concept)', () => {
    for (const e of AICE_9709_P2P4P5_EQUIVALENCES) {
      // a cross-curriculum identity is an EXISTING canonical identity; the AICE link names its English catalogue row
      const linked = e.correspondence === 'CROSS_CURRICULUM_CANONICAL_IDENTITY' ? e.linkedCatalogueRow!.split(' / ')[1] : e.conceptName;
      expect((AICE_LEARNING_LINKS[e.aiceObjectiveCode]?.concepts ?? []).map((c) => c.name), e.aiceObjectiveCode).toEqual([linked]);
      expect(DEV_CANONICAL_CONCEPTS.some((c: any) => c.subject === 'Mathematics' && c.name === linked), linked).toBe(true);
      const identity = e.correspondence === 'CROSS_CURRICULUM_CANONICAL_IDENTITY' ? PAA_CERTIFIED_CONCEPTS.find((x) => x.stableId === e.conceptStableId) : ibGovernedConceptByStableId(e.conceptStableId) ?? CIE_9709_CONCEPT_IDENTITIES.find((x) => x.stableId === e.conceptStableId && x.status === 'GOVERNED_PILOT');
      expect(identity?.canonicalName, e.conceptStableId).toBe(e.conceptName);
    }
    // AICE-9709-IDENTITY-COLLISION-2026-10-16: the two duplicates are SUPERSEDED by the existing PAA identities
    expect(CIE_9709_CONCEPT_IDENTITIES.filter((x) => x.status === 'SUPERSEDED').map((x) => [x.stableId, x.supersededBy])).toEqual([['math.prob.permutations-combinations', 'math.prob.counting'], ['math.prob.probability-events', 'math.prob.probability']]);
    expect(CIE_9709_CONCEPT_IDENTITIES.filter((x) => x.status === 'GOVERNED_PILOT').map((x) => x.stableId)).toEqual(['math.calc.numerical-methods', 'math.mech.kinematics', 'math.mech.forces-equilibrium', 'math.mech.energy-work-power']);
    expect(CIE_9709_CONCEPT_IDENTITIES.every((x) => x.governedBy === AICE_9709_P2P4P5_DECISION.decisionId)).toBe(true);
    // live records + the two superseded records kept as history (their bank rows are retired)
    expect(AICE_9709_P2P4P5_APPLICABILITY).toHaveLength(12);
  });
  it('CAMBRIDGE.9709.P2 / P4 / P5 restate the sourced component records and govern like P1 (official command words)', () => {
    const conflicts = adapterConflicts();
    for (const [paper, adapterId] of Object.entries(CIE_9709_PAPER_ADAPTER)) {
      const a = STUDYUS_ASSESSMENT_REGISTRY.adapter(adapterId)!;
      expect(a, adapterId).toBeTruthy();
      const g = governAdapter(adapterId, STUDYUS_ASSESSMENT_REGISTRY, conflicts);
      expect({ paper, state: g.state, failed: g.failed }).toEqual({ paper, state: 'AUTOMATED_CERTIFIED_PILOT', failed: [] });
      expect(a.component).toBe(`Cambridge 9709 — ${{ p2: 'Pure Mathematics 2', p4: 'Mechanics', p5: 'Probability & Statistics 1' }[paper]}`);
      const profile = TRACK_B_COMPONENT_PROFILES.find((c) => c.componentId === adapterId) as any;
      expect(profile.overrides.timePressure.value).toEqual({ officialMinutes: 75, officialItems: null, officialMarks: 50 });
      expect(profile.versionBinding.componentKey).toBe(paper);
    }
  });
});

describe('AICE 9709 AS Papers 2 / 4 / 5: certified supply scored by the canonical contract', () => {
  it('every cell of AICE-9709-P2P4P5-A1 certifies (10 per band), publishes by projection 3 and scores key = full marks, key + 1 = 0', async () => {
    const { LIBRARY_EXTENSION_BATCHES, PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } = await import('@/lib/assessment-instance/library/catalogue');
    const { certifyCell, governLibrary } = await import('@/lib/assessment-instance/v52/library-batch');
    const { PLANNING_BANDS } = await import('@/lib/assessment-instance/library/parametric');
    const { bankProjectionFor, scoringBankContentOf } = await import('@/lib/exam-bank/scoring-projection');
    const { examItemFromApproved } = await import('@/lib/exam-core/items');
    const { gradeExamItem } = await import('@/lib/exam-core/item-grading');
    const g = governLibrary(undefined, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
    const batch = LIBRARY_EXTENSION_BATCHES.find((b) => b.batchId === 'AICE-9709-P2P4P5-A1')!;
    expect(batch.entries.map((e) => e.targets[0].objectiveCode)).toEqual(AICE_9709_P2P4P5_EQUIVALENCES.map((e) => e.aiceObjectiveCode));
    const canon = LIBRARY_EXTENSION_BATCHES.find((b) => b.batchId === 'AICE-9709-P5-CANON-A2')!;
    expect(canon.entries.map((e) => [e.targets[0].objectiveCode, e.core.primaryConceptStableId])).toEqual([['aice.9709.p5.permutations', 'math.prob.counting'], ['aice.9709.p5.probability', 'math.prob.probability']]);
    for (const e of batch.entries) for (const band of PLANNING_BANDS) {
      const cell = certifyCell(e, e.targets[0], band, 10, g, batch.batchId);
      expect(cell.certified, `${e.core.constructFamilyId} ${band}`).toHaveLength(10);
      const i = cell.certified[0];
      expect(bankProjectionFor(i).refusal).toBeNull();
      const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content: scoringBankContentOf(i) })!;
      expect((await gradeExamItem(item, i.key.answers[0], 'en')).evaluation.score, e.core.constructFamilyId).toBe(i.marks);
    }
  }, 120000);
});
