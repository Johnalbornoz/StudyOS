import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGES } from '@/lib/i18n/messages';
import { SAMPLE_DISCLOSURE_KEYS, sampleDisclosureKeyFor } from '@/lib/exam-core/sample-disclosure';
import { PILOT_EXPOSURE_POLICY, exposedModes, isExamConfigExposed, isNodeListedForStudent, isNodeSelectableForStudent, isObjectiveExposed } from '@/lib/exam-core/student-exposure';
import { objectiveByKey } from '@/lib/exam-core/objectives/objective-catalog';
import { flattenCatalog } from '@/lib/exam-core/catalog/structure';

/**
 * FINAL PRODUCT-DECISION DELTA (2026-10-17): AICE 9709 AS (P1/P2/P4/P5), PISA (Mathematics) and Saber 11
 * (Matematicas) are re-exposed to Students under STUDENT_CATALOG_EXPOSURE=PILOT as truthfully labelled StudyUs
 * samples. Every re-exposed item must be reachable (listed, resolvable, creatable, its configuration admitted at
 * instance creation) AND carry its disclosure in every locale.
 */
const P = PILOT_EXPOSURE_POLICY;
const node = (key: string) => flattenCatalog().find((f) => f.node.key === key)!;

/** The re-exposed items: catalogue node (structure family), its configuration (exam_definitions family), its objective. */
const REEXPOSED = [
  { item: 'AICE 9709 AS (whole level)', family: 'CAMBRIDGE', nodeKey: 'cie.aice.g1.9709.as', examFamily: 'AICE', configKey: 'v2.aice.9709-as', objective: 'cie.asal.9709.as', disclosure: 'exam.sample.disclosure.aice' },
  { item: 'AICE 9709 AS Paper 1', family: 'CAMBRIDGE', nodeKey: 'cie.aice.g1.9709.as.p1', examFamily: 'AICE', configKey: 'v2.aice.9709-as', objective: 'cie.asal.9709.as', disclosure: 'exam.sample.disclosure.aice' },
  { item: 'AICE 9709 AS Paper 2', family: 'CAMBRIDGE', nodeKey: 'cie.aice.g1.9709.as.p2', examFamily: 'AICE', configKey: 'v2.aice.9709-as', objective: 'cie.asal.9709.as', disclosure: 'exam.sample.disclosure.aice' },
  { item: 'AICE 9709 AS Paper 4', family: 'CAMBRIDGE', nodeKey: 'cie.aice.g1.9709.as.p4', examFamily: 'AICE', configKey: 'v2.aice.9709-as', objective: 'cie.asal.9709.as', disclosure: 'exam.sample.disclosure.aice' },
  { item: 'AICE 9709 AS Paper 5', family: 'CAMBRIDGE', nodeKey: 'cie.aice.g1.9709.as.p5', examFamily: 'AICE', configKey: 'v2.aice.9709-as', objective: 'cie.asal.9709.as', disclosure: 'exam.sample.disclosure.aice' },
  { item: 'Saber 11 Matematicas', family: 'ICFES', nodeKey: 'saber11.math', examFamily: 'ICFES', configKey: 'v2.saber11.math', objective: 'saber11', disclosure: 'exam.sample.disclosure.saber11' },
  { item: 'PISA Mathematics', family: 'PISA', nodeKey: 'pisa.2022.math', examFamily: 'PISA', configKey: 'v2.pisa.2022', objective: 'pisa.2022', disclosure: 'exam.sample.disclosure.pisa' },
  { item: 'PISA Mathematics (a process)', family: 'PISA', nodeKey: 'pisa.2022.math.reason', examFamily: 'PISA', configKey: 'v2.pisa.2022', objective: 'pisa.2022', disclosure: 'exam.sample.disclosure.pisa' },
] as const;

describe('every re-exposed item is reachable under PILOT', () => {
  for (const r of REEXPOSED) {
    it(r.item, () => {
      expect(node(r.nodeKey)?.node.bind?.configKey, 'bound to its configuration').toBe(r.configKey);
      expect(isNodeListedForStudent(r.family, r.nodeKey, P)).toBe(true);
      expect(isNodeSelectableForStudent(r.family, r.nodeKey, P)).toBe(true);
      expect(isExamConfigExposed(r.examFamily, r.configKey, P)).toBe(true);
      expect(exposedModes(r.examFamily, ['PRACTICE'], P)).toEqual(['PRACTICE']);
      expect(isObjectiveExposed(objectiveByKey(r.objective)!, P)).toBe(true);
    });
  }

  it('AICE 9709 AS offers exactly Papers 1 / 2 / 4 / 5, each bound to its own governed section', () => {
    const papers = flattenCatalog().filter((f) => f.parentKey === 'cie.aice.g1.9709.as');
    expect(papers.map((f) => f.node.bind?.sectionKey)).toEqual(['p1', 'p2', 'p4', 'p5']);
    expect(papers.every((f) => f.node.bind?.configKey === 'v2.aice.9709-as')).toBe(true);
  });

  it('AICE / Cambridge Challenge stays hidden (not reopened); MOCK stays offered for AICE and Saber, never for PISA (PRACTICE-only in the catalogue)', () => {
    expect(exposedModes('AICE', ['PRACTICE', 'MOCK', 'CHALLENGE'], P)).toEqual(['PRACTICE', 'MOCK']);
    expect(exposedModes('ICFES', ['PRACTICE', 'MOCK', 'CHALLENGE'], P)).toEqual(['PRACTICE', 'MOCK']);
    for (const k of ['pisa.2022.math', 'pisa.2022.math.reason']) expect(node(k).node.modes).toEqual(['PRACTICE']);
  });
});

describe('every re-exposed item carries its disclosure', () => {
  for (const r of REEXPOSED) {
    it(`${r.item}: catalogue level and preparation objective`, () => {
      expect(sampleDisclosureKeyFor({ family: r.family, nodeKey: r.nodeKey })).toBe(r.disclosure);
      const o = objectiveByKey(r.objective)!;
      expect(sampleDisclosureKeyFor({ family: o.family, nodeKeys: o.nodeKeys, framework: o.framework })).toBe(r.disclosure);
    });
  }

  it('none where the decision does not apply (PAA, IB, Cambridge AS & A Level 9709)', () => {
    expect(sampleDisclosureKeyFor({ family: 'PAA', nodeKey: 'paa' })).toBeNull();
    expect(sampleDisclosureKeyFor({ family: 'IB', nodeKey: 'ib.dp.math-aa.hl' })).toBeNull();
    expect(sampleDisclosureKeyFor({ family: 'CAMBRIDGE', nodeKey: 'cie.asal.cambridge.9709.as' })).toBeNull();
    const o = objectiveByKey('cie.asal.cambridge.9709.as')!;
    expect(sampleDisclosureKeyFor({ family: o.family, nodeKeys: o.nodeKeys, framework: o.framework })).toBeNull();
  });

  it('the copy exists in every locale and says StudyUs, not official, and not an official result', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(['de', 'en', 'es', 'fr', 'pt']);
    for (const [locale, m] of Object.entries(MESSAGES)) {
      const t = m as Record<string, string>;
      for (const k of SAMPLE_DISCLOSURE_KEYS) {
        expect(t[k], `${locale} ${k}`).toMatch(/StudyUs/);
        expect(t[k].length, `${locale} ${k}`).toBeGreaterThan(40);
      }
      expect(t['exam.sample.disclosure.aice'], locale).toMatch(/Cambridge/);
      expect(t['exam.sample.disclosure.saber11'], locale).toMatch(/ICFES.*ICFES/);
      expect(t['exam.sample.disclosure.pisa'], locale).toMatch(/PISA/);
      expect(t['exam.sample.disclosure.pisa'], locale).toMatch(/OCDE|OECD/);
    }
    const en = MESSAGES.en as Record<string, string>;
    expect(en['exam.sample.disclosure.aice']).toMatch(/not an official Cambridge paper/);
    expect(en['exam.sample.disclosure.aice']).toMatch(/length differs from the official paper/);
    expect(en['exam.sample.disclosure.saber11']).toMatch(/not an official ICFES exam/);
    expect(en['exam.sample.disclosure.saber11']).toMatch(/not an official ICFES score/);
    expect(en['exam.sample.disclosure.pisa']).toMatch(/not an official OECD assessment/);
    // never an official paper size claimed
    for (const k of SAMPLE_DISCLOSURE_KEYS) expect(en[k]).not.toMatch(/\d/);
  });

  it('the Student surfaces render it: the exam launcher (before start) and the preparation page (both views)', () => {
    const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    const browser = src('src/app/dashboard/exams/ExamCatalogBrowser.tsx');
    expect(browser).toMatch(/sampleDisclosureKeyFor\(\{ family: level\.family, nodeKey: level\.nodeKey \}\)/);
    expect(browser).toMatch(/data-testid="exam-sample-disclosure"/);
    expect(src('src/app/dashboard/exams/page.tsx')).toMatch(/for \(const k of SAMPLE_DISCLOSURE_KEYS\) labels\[k\] = t\[k\]/);
    const prep = src('src/app/dashboard/exam-prep/[examProfileId]/page.tsx');
    expect(prep.match(/data-testid="exam-sample-disclosure"/g)).toHaveLength(2);
  });
});
