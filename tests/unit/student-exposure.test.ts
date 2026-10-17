import { describe, it, expect } from 'vitest';
import {
  FULL_EXPOSURE_POLICY,
  PILOT_CAMBRIDGE_VISIBLE_NODE_KEYS,
  PILOT_EXPOSURE_POLICY,
  PILOT_HIDDEN_FAMILIES,
  PILOT_IB_VISIBLE_NODE_KEYS,
  exposedModes,
  isExamConfigExposed,
  isFamilyExposed,
  isModeExposed,
  isNavigationOnlyNode,
  isNodeListedForStudent,
  isNodeSelectableForStudent,
  isObjectiveExposed,
  parseStudentCatalogExposure,
  studentExposurePolicy,
  studentObjectives,
} from '@/lib/exam-core/student-exposure';
import { examObjectives, objectiveByKey } from '@/lib/exam-core/objectives/objective-catalog';
import { flattenCatalog } from '@/lib/exam-core/catalog/structure';

/**
 * Pilot exposure (OVERNIGHT_2026-10-16 contracts, section 4): STUDENT_CATALOG_EXPOSURE=PILOT hides PISA, ICFES,
 * unfinished IB, Challenge for IB / Cambridge and the unconfirmed Cambridge qualifications; unset = no change.
 */
const P = PILOT_EXPOSURE_POLICY;
const F = FULL_EXPOSURE_POLICY;

describe('student exposure -- env selection (fail-open to the current behaviour)', () => {
  it('PILOT only for the value PILOT; unset or anything else is FULL', () => {
    expect(parseStudentCatalogExposure('PILOT')).toBe('PILOT');
    expect(parseStudentCatalogExposure(' pilot ')).toBe('PILOT');
    for (const v of [undefined, null, '', 'FULL', 'true', 'PILOTX', 'off']) expect(parseStudentCatalogExposure(v as string | undefined)).toBe('FULL');
    expect(studentExposurePolicy({})).toBe(F);
    expect(studentExposurePolicy({ STUDENT_CATALOG_EXPOSURE: 'PILOT' })).toBe(P);
    expect(studentExposurePolicy({ STUDENT_CATALOG_EXPOSURE: 'nonsense' })).toBe(F);
  });

  it('FULL changes nothing: every objective, node, config and mode stays exposed', () => {
    const all = examObjectives();
    expect(studentObjectives(all, F)).toHaveLength(all.length);
    for (const f of flattenCatalog()) {
      expect(isNodeListedForStudent(f.family, f.node.key, F)).toBe(true);
      expect(isNodeSelectableForStudent(f.family, f.node.key, F)).toBe(true);
    }
    for (const fam of ['PISA', 'ICFES', 'IB', 'CAMBRIDGE', 'AICE', 'PAA']) {
      expect(isFamilyExposed(fam, F)).toBe(true);
      expect(isModeExposed(fam, 'CHALLENGE', F)).toBe(true);
      expect(isExamConfigExposed(fam, 'anything', F)).toBe(true);
    }
  });
});

describe('student exposure -- PILOT policy', () => {
  it('the allowlists name real catalogue nodes (a typo would silently hide a qualification)', () => {
    const keys = new Set(flattenCatalog().map((f) => f.node.key));
    for (const k of [...PILOT_IB_VISIBLE_NODE_KEYS, ...PILOT_CAMBRIDGE_VISIBLE_NODE_KEYS]) expect(keys.has(k)).toBe(true);
    expect(PILOT_HIDDEN_FAMILIES).toEqual(['PISA', 'ICFES']);
  });

  it('PISA and ICFES (Saber 11) are hidden: objectives, nodes, configs', () => {
    expect(isFamilyExposed('PISA', P)).toBe(false);
    expect(isFamilyExposed('ICFES', P)).toBe(false);
    expect(isObjectiveExposed(objectiveByKey('pisa.2022')!, P)).toBe(false);
    expect(isObjectiveExposed(objectiveByKey('saber11')!, P)).toBe(false);
    expect(isNodeListedForStudent('PISA', 'pisa.2022', P)).toBe(false);
    expect(isNodeSelectableForStudent('ICFES', 'saber11.math', P)).toBe(false);
    expect(isExamConfigExposed('ICFES', 'v2.saber11.math', P)).toBe(false);
    expect(isExamConfigExposed('PISA', 'v2.pisa.2022', P)).toBe(false);
  });

  it('PAA stays fully visible (practice, mock and its Challenge)', () => {
    expect(isObjectiveExposed(objectiveByKey('paa')!, P)).toBe(true);
    for (const k of ['paa', 'paa.full', 'paa.full-length', 'paa.practice.matematicas']) expect(isNodeSelectableForStudent('PAA', k, P)).toBe(true);
    expect(isExamConfigExposed('PAA', 'v2.paa', P)).toBe(true);
    expect(isExamConfigExposed('PAA', 'v2.paa-full-length', P)).toBe(true);
    expect(exposedModes('PAA', ['PRACTICE', 'MOCK', 'CHALLENGE'], P)).toEqual(['PRACTICE', 'MOCK', 'CHALLENGE']);
  });

  it('IB: Math AA HL (P1/P2/P3) stays; every other IB subject level is hidden; Challenge is not offered', () => {
    expect(isObjectiveExposed(objectiveByKey('ib.dp.math-aa.hl')!, P)).toBe(true);
    for (const k of ['ib.dp.math-aa.sl', 'ib.dp.math-ai.hl', 'ib.dp.biology.hl', 'ib.dp.theory-of-knowledge']) expect(isObjectiveExposed(objectiveByKey(k)!, P)).toBe(false);
    for (const k of ['ib.dp.math-aa.hl', 'ib.dp.math-aa.hl.p1', 'ib.dp.math-aa.hl.p2', 'ib.dp.math-aa.hl.p3']) expect(isNodeSelectableForStudent('IB', k, P)).toBe(true);
    // navigation ancestors are listed but never resolvable
    for (const k of ['ib.dp', 'ib.dp.g5', 'ib.dp.math-aa']) {
      expect(isNodeListedForStudent('IB', k, P)).toBe(true);
      expect(isNodeSelectableForStudent('IB', k, P)).toBe(false);
      expect(isNavigationOnlyNode('IB', k, P)).toBe(true);
    }
    for (const k of ['ib.dp.g1', 'ib.dp.math-aa.sl', 'ib.dp.math-aa.sl.p1', 'ib.dp.biology.hl']) expect(isNodeListedForStudent('IB', k, P)).toBe(false);
    expect(isExamConfigExposed('IB', 'v2.ib.math-aa-hl', P)).toBe(true);
    expect(isExamConfigExposed('IB', 'v2.ib.math-aa-sl', P)).toBe(false);
    expect(isExamConfigExposed('IB', null, P)).toBe(false);
    expect(exposedModes('IB', ['PRACTICE', 'MOCK', 'CHALLENGE'], P)).toEqual(['PRACTICE', 'MOCK']);
  });

  it('Cambridge: only the explicit allowlist (9709 AS; AICE 9709 AS) -- IGCSE 0580, other AICE subjects and the AICE planner are hidden', () => {
    expect(isObjectiveExposed(objectiveByKey('cie.asal.cambridge.9709.as')!, P)).toBe(true);
    expect(isObjectiveExposed(objectiveByKey('cie.asal.9709.as')!, P)).toBe(true); // AICE 9709 AS (node cie.aice.g1.9709.as)
    for (const k of ['cie.igcse.0580.extended', 'cie.igcse.0580.core', 'cie.asal.9709.a', 'cie.asal.9700.as', 'cie.asal.9239.as', 'cie.aice.diploma']) expect(isObjectiveExposed(objectiveByKey(k)!, P)).toBe(false);
    for (const k of ['cie.asal.cambridge.9709.as', 'cie.asal.cambridge.9709.p1', 'cie.aice.g1.9709.as', 'cie.aice.g1.9709.as.p1', 'cie.aice.g1.9709.as.p5']) expect(isNodeSelectableForStudent('CAMBRIDGE', k, P)).toBe(true);
    for (const k of ['cie.asal', 'cie.asal.cambridge.9709', 'cie.aice', 'cie.aice.g1', 'cie.aice.g1.9709']) expect(isNavigationOnlyNode('CAMBRIDGE', k, P)).toBe(true);
    for (const k of ['cie.igcse', 'cie.igcse.0580', 'cie.igcse.0580.extended', 'cie.aice.g1.9709.a', 'cie.aice.g1.9700', 'cie.aice.core', 'cie.aice.g2']) expect(isNodeListedForStudent('CAMBRIDGE', k, P)).toBe(false);
    // exam_definitions.exam_family AICE is governed by the CAMBRIDGE scope
    expect(isExamConfigExposed('AICE', 'v2.aice.9709-as', P)).toBe(true);
    expect(isExamConfigExposed('AICE', 'v2.aice.9709-a', P)).toBe(false);
    expect(isExamConfigExposed('AICE', 'v2.aice.9700-as', P)).toBe(false);
    expect(isExamConfigExposed('CAMBRIDGE', 'v2.cambridge.9709-as', P)).toBe(true);
    expect(isExamConfigExposed('CAMBRIDGE', 'v2.cambridge.0580-extended', P)).toBe(false);
    expect(isModeExposed('AICE', 'CHALLENGE', P)).toBe(false);
    expect(isModeExposed('CAMBRIDGE', 'CHALLENGE', P)).toBe(false);
    expect(isModeExposed('CAMBRIDGE', 'MOCK', P)).toBe(true);
  });

  it('the Student objective list is exactly PAA + IB AA HL + the two Cambridge entries; objectiveByKey stays complete', () => {
    const all = examObjectives();
    const shown = studentObjectives(all, P).map((o) => o.key).sort();
    expect(shown).toEqual(['cie.asal.9709.as', 'cie.asal.cambridge.9709.as', 'ib.dp.math-aa.hl', 'paa'].sort());
    // nothing is deleted: history / existing preparations still resolve every key
    for (const o of all) expect(objectiveByKey(o.key)).toBe(o);
  });
});
