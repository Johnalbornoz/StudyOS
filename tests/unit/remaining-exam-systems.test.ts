/**
 * Remaining pilot exam systems (2026-10-15): PISA 8/8, AICE 9709 P1 4/4 (PILOT equivalence), Saber 11 9 cells
 * (SELECTED_RESPONSE, GOVERNED_PILOT content-category correspondences). Deterministic, certified, scored by the Exam Core.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { PISA_MATH_CONSTRUCTS } from '@/lib/assessment-instance/library/pisa-math.constructs';
import { SABER_MATH_CONSTRUCTS } from '@/lib/assessment-instance/library/saber11-math.constructs';
import { LIBRARY_BLUEPRINT_AICE_9709_P1, LIBRARY_BLUEPRINT_PISA_MATH, LIBRARY_BLUEPRINT_SABER_MATH, LIBRARY_EXTENSION_BATCHES, PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { PLANNING_BANDS, rational, sameRational } from '@/lib/assessment-instance/library/parametric';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { bankProjectionFor, scoringBankContentOf } from '@/lib/exam-bank/scoring-projection';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';
import { SABER_APPLICABILITY, SABER_CONTENT_CATEGORIES, SABER_CONTENT_CORRESPONDENCES, SABER_GOVERNANCE_DECISION, saberCorrespondenceOf } from '@/lib/curriculum/icfes/saber11-content-correspondence';
import { AICE_9709_P1_EQUIVALENCE_DECISION, AICE_9709_P1_EQUIVALENCES } from '@/lib/curriculum/cambridge/aice-9709-p1-equivalence';
import { applicabilityThresholdFor } from '@/lib/assessment-instance/applicability-threshold';
import { EA1_APPLICABILITY_THRESHOLD } from '@/lib/assessment-adaptation/assessment-applicability';
import { PAA_CERTIFIED_CONCEPTS } from '@/lib/curriculum/paa/paa-certified-concepts';

const keyOf = (k: string) => (/\//.test(k) ? rational(Number(k.split('/')[0]), Number(k.split('/')[1])) : rational(Number(k)));
const g = governLibrary(undefined, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
const batch = (id: string) => LIBRARY_EXTENSION_BATCHES.find((b) => b.batchId === id)!;

describe('constructs: every band non-empty, bands exclusive, keys hold by an independent check, never a misconception', () => {
  it.each([...PISA_MATH_CONSTRUCTS, ...SABER_MATH_CONSTRUCTS].map((c) => [c.construct, c] as const))('%s', (_n, c: any) => {
    for (const band of PLANNING_BANDS) {
      const sets = c.enumerate(band);
      expect(sets.length, band).toBeGreaterThanOrEqual(10);
      for (const p of sets) {
        const k = keyOf(c.answer(p));
        expect(k.n > 0 && c.keyHolds(p, k)).toBe(true);
        for (const other of PLANNING_BANDS) if (other !== band) expect(c.bandIssues(other, p).length, `${band} set also in ${other}`).toBeGreaterThan(0);
        expect(c.misconceptionAnswers(p).some((m: any) => m.value && sameRational(m.value, k))).toBe(false);
      }
    }
  });
});

describe('PISA 2022 Mathematics', () => {
  it('one bucket per governed objective (8), one position each; concepts are PAA-certified identities', () => {
    expect(LIBRARY_BLUEPRINT_PISA_MATH.buckets.map((b) => b.bucket.objectiveCode).sort()).toHaveLength(8);
    const certified = new Set(PAA_CERTIFIED_CONCEPTS.map((c) => c.stableId));
    for (const b of LIBRARY_BLUEPRINT_PISA_MATH.buckets) for (const k of b.bucket.primaryConceptStableIds) expect(certified.has(k), k).toBe(true);
  });
  it('every cell certifies 10 NUMERIC_ENTRY items in Spanish, in an authentic context; the Exam Core scores them', async () => {
    for (const e of batch('TB-PISA-MATH-A1').entries) {
      expect(e.core.family.supportedContexts.every((x) => x.kind !== 'ABSTRACT'), e.core.constructFamilyId).toBe(true);
      for (const band of PLANNING_BANDS) expect(certifyCell(e, e.targets[0], band, 10, g, 'TB-PISA-MATH-A1').certified, `${e.core.constructFamilyId} ${band}`).toHaveLength(10);
      const i = certifyCell(e, e.targets[0], 'STANDARD', 1, g, 'TB-PISA-MATH-A1').certified[0];
      expect({ format: i.format, language: i.language, system: i.systemId }).toEqual({ format: 'NUMERIC_ENTRY', language: 'es', system: 'PISA' });
    }
  });
});

describe('AICE 9709 Paper 1 -- PILOT equivalence to Cambridge 9709 Paper 1', () => {
  it('the decision is recorded: ARCHITECTURE_GOVERNANCE_DECISION, PILOT, PILOT_PREVIEW, no reviewer, review PENDING; source-backed', () => {
    expect(AICE_9709_P1_EQUIVALENCE_DECISION).toMatchObject({ decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', environment: 'PILOT_PREVIEW', humanReviewer: null, humanReviewStatus: 'PENDING', sources: { aiceCurriculum: 'cie-aice-curriculum', syllabus: 'cie-9709-syllabus-2026-2027' } });
    expect(JSON.stringify(AICE_9709_P1_EQUIVALENCE_DECISION)).not.toMatch(/HUMAN_CERTIFIED/);
  });
  it('the four AICE P1 objectives are filled by the governed CAMBRIDGE.9709.P1 entries (same cores), placed in the AICE buckets', () => {
    expect(LIBRARY_BLUEPRINT_AICE_9709_P1.buckets.map((b) => b.bucket.objectiveCode)).toEqual(AICE_9709_P1_EQUIVALENCES.map((e) => e.aiceObjectiveCode));
    const cie = batch('CIE-9709-P1-A1').entries.map((e) => e.core.contentHash);
    for (const e of batch('AICE-9709-P1-EQ-A1').entries) {
      expect(cie).toContain(e.core.contentHash);
      expect(e.targets[0]).toMatchObject({ adapterId: 'CAMBRIDGE.9709.P1' });
      const i = certifyCell(e, e.targets[0], 'STANDARD', 1, g, 'AICE-9709-P1-EQ-A1').certified[0];
      expect(i.bucketId.startsWith('v2.aice.9709-as/p1/aice.9709.p1.')).toBe(true);
    }
  });
});

describe('Saber 11 -- governance', () => {
  it('PILOT decision as authorised; never HUMAN_CERTIFIED; the official categories are the source labels only', () => {
    expect(SABER_GOVERNANCE_DECISION).toMatchObject({ decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', environment: 'PILOT_PREVIEW', humanReviewer: null, humanReviewStatus: 'PENDING' });
    expect([...SABER_CONTENT_CATEGORIES]).toEqual(['Estadística', 'Álgebra y cálculo', 'Geometría']);
    expect(readFileSync('src/lib/curriculum/icfes/saber11-content-correspondence.ts', 'utf8')).not.toMatch(/'HUMAN_CERTIFIED'/);
  });
  it('every correspondence reuses an EXISTING certified StudyUs concept (no Saber concept); ambiguous rows are BLOCKED, not used', () => {
    const certified = new Set(PAA_CERTIFIED_CONCEPTS.map((c) => c.stableId));
    for (const c of SABER_CONTENT_CORRESPONDENCES) { expect(certified.has(c.studyusConceptStableId), c.studyusConceptStableId).toBe(true); expect(c.studyusConceptStableId).not.toMatch(/saber|icfes/i); }
    const blocked = SABER_CONTENT_CORRESPONDENCES.filter((c) => c.governanceStatus === 'BLOCKED');
    expect(blocked.map((c) => c.studyusConceptStableId)).toEqual(['math.prob.probability', 'math.num.percent', 'math.geo.coordinate-plane']);
    for (const b of blocked) expect(saberCorrespondenceOf(b.studyusConceptStableId)).toBeNull();
  });
  it('the register is honest (UNREVIEWED) and only the Saber PILOT threshold reads it; every other system keeps EA-1', () => {
    for (const r of SABER_APPLICABILITY) expect(r.evidence.every((e) => e.reviewState === 'UNREVIEWED')).toBe(true);
    expect(applicabilityThresholdFor('ICFES').policyId).toBe('studyus.assessment-applicability-threshold.saber-pilot');
    for (const s of ['PAA', 'IB', 'CAMBRIDGE', 'PISA', 'AICE']) expect(applicabilityThresholdFor(s)).toBe(EA1_APPLICABILITY_THRESHOLD);
  });
  it('three competency buckets with the V2.1 totals 17 / 22 / 11; each concept is governed', () => {
    expect(LIBRARY_BLUEPRINT_SABER_MATH.buckets.map((b) => [b.bucket.objectiveCode, b.governedPositions])).toEqual([['saber.interpretacion', 17], ['saber.formulacion', 22], ['saber.argumentacion', 11]]);
    for (const b of LIBRARY_BLUEPRINT_SABER_MATH.buckets) for (const k of b.bucket.primaryConceptStableIds) expect(saberCorrespondenceOf(k), k).not.toBeNull();
  });
});

describe('Saber 11 -- SELECTED_RESPONSE through the governed selected-response engine', () => {
  it('nine cells (competency x category) certify; options = key + three modelled misconception values; scored by option identity', async () => {
    const cells = new Set<string>();
    for (const e of batch('TB-SABER-MATH-A1').entries) {
      for (const band of PLANNING_BANDS) expect(certifyCell(e, e.targets[0], band, 10, g, 'TB-SABER-MATH-A1').certified.length, `${e.core.constructFamilyId} ${band}`).toBe(10);
      const i = certifyCell(e, e.targets[0], 'STANDARD', 1, g, 'TB-SABER-MATH-A1').certified[0];
      expect(bankProjectionFor(i)).toEqual({ version: expect.any(String), refusal: null });
      const c: any = scoringBankContentOf(i);
      expect(c.type).toBe('multiple_choice');
      expect(c.options).toHaveLength(4);
      expect(new Set(c.options.map((o: any) => o.text)).size).toBe(4);
      cells.add(`${c.tags.competency}|${c.tags.contentCategory}`);
      const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content: c })!;
      expect((await gradeExamItem(item, c.correctAnswer, 'es')).evaluation.score).toBe(1);
      for (const o of c.options.filter((x: any) => x.id !== c.correctAnswer)) expect((await gradeExamItem(item, o.id, 'es')).evaluation.score).toBe(0);
    }
    expect(cells.size).toBe(9);
  });
  it('the key does not favour a position across a cell', () => {
    const e = batch('TB-SABER-MATH-A1').entries[0];
    const positions = certifyCell(e, e.targets[0], 'STANDARD', 10, g, 'TB-SABER-MATH-A1').certified.map((i) => i.key.correctOption);
    expect(new Set(positions).size).toBeGreaterThan(1);
  });
});
