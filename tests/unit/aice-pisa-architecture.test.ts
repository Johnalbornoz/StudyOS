/**
 * Cambridge AICE reference subjects and PISA 2022 -- exam architecture as data:
 * every structural fact must match the sourced research
 * (docs/exams/v2/sources/aice-reference-syllabi.json, pisa-2022.json).
 */
import { describe, it, expect } from 'vitest';
import { parseExamVerticalConfig, type ExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { AICE_SYLLABI } from '@/lib/exam-core/aice/aice-syllabi.generated';
import { packageReadiness, componentReadiness } from '@/lib/exam-core/catalog/readiness';
import { flattenCatalog } from '@/lib/exam-core/catalog/structure';
import { configsByKey, nodeReadiness } from '@/lib/exam-core/catalog/structure.service';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { allLearningLinks } from '@/lib/exam-core/catalog/objective-learning-links';

const parsed = new Map<string, ExamVerticalConfig>();
for (const v of allV2Configs()) {
  const p = parseExamVerticalConfig(v);
  if (!p.ok) throw new Error(`${v.key}: ${p.issues.join('; ')}`);
  parsed.set(p.config.key, p.config);
}
const REF = ['9709', '9702', '9701', '9700', '9239', '9093', '9708'];

describe('AICE -- syllabus-specific architecture', () => {
  it.each(REF.flatMap((code) => (['AS', 'A'] as const).map((lv) => [code, lv] as const)))('%s %s Level: code, version, components, marks, minutes, weights exactly as the syllabus', (code, lv) => {
    const cfg = parsed.get(`v2.aice.${code}-${lv === 'AS' ? 'as' : 'a'}`)!;
    const syl = AICE_SYLLABI.find((s) => s.code === code)!;
    expect(cfg.family).toBe('AICE');
    expect(cfg.framework).toMatchObject({ syllabusCode: code, frameworkVersion: syl.versionKey, firstAssessment: syl.firstExam, lastAssessment: syl.lastExam });
    const expected = syl.components.filter((c) => c.levels.includes(lv));
    expect(cfg.sections.map((s) => s.key)).toEqual(expected.map((c) => c.key)); // no invented paper, none missing
    for (const c of expected) {
      const d = cfg.sections.find((s) => s.key === c.key)!.definition!;
      expect(d.maxMarks, `${code} ${c.key}`).toBe(c.marks);
      expect(d.officialDurationMinutes).toBe(c.minutes);
      expect(d.weightingPercent).toBe(lv === 'AS' ? c.weightAS : c.weightA);
      expect(d.componentCode).toBe(c.number);
      expect(d.sourceKeys).toEqual([syl.sourceKey]); // never a component from another version
    }
  });
  it('AS vs A Level: A Level-only components never appear at AS (9709 P3/P6, sciences P4/P5, 9239 C4)', () => {
    expect(parsed.get('v2.aice.9709-as')!.sections.map((s) => s.key)).toEqual(['p1', 'p2', 'p4', 'p5']);
    expect(parsed.get('v2.aice.9709-a')!.sections.map((s) => s.key)).toEqual(['p1', 'p3', 'p4', 'p5', 'p6']);
    for (const code of ['9702', '9701', '9700']) expect(parsed.get(`v2.aice.${code}-as`)!.sections.map((s) => s.key)).toEqual(['p1', 'p2', 'p3']);
    expect(parsed.get('v2.aice.9239-as')!.sections.some((s) => s.key === 'c4')).toBe(false);
  });
  it('9709: P1 60 % at AS and 30 % at A Level; scientific calculator; MF19 provided', () => {
    const as = parsed.get('v2.aice.9709-as')!.sections.find((s) => s.key === 'p1')!.definition!;
    const a = parsed.get('v2.aice.9709-a')!.sections.find((s) => s.key === 'p1')!.definition!;
    expect([as.weightingPercent, a.weightingPercent, as.officialDurationMinutes, as.maxMarks]).toEqual([60, 30, 110, 75]);
    expect(as.calculatorPolicy).toBe('ALLOWED');
    expect(as.resources?.[0]).toMatch(/MF19/);
  });
  it('9709 routes: the exact official combinations (AS P1+P2 / P1+P4 / P1+P5; A Level linear and staged; never P4 with P6)', () => {
    const asR = parsed.get('v2.aice.9709-as')!.assessmentRoutes!;
    expect(asR.map((r) => r.key)).toEqual(['AS_ONLY']);
    expect(asR[0].componentSets).toEqual([['p1', 'p2'], ['p1', 'p4'], ['p1', 'p5']]);
    const aR = parsed.get('v2.aice.9709-a')!.assessmentRoutes!;
    const linear = aR.find((r) => r.key === 'A_LEVEL_LINEAR')!;
    expect(linear.componentSets.map((s) => [...s].sort().join())).toEqual([['p1', 'p3', 'p4', 'p5'], ['p1', 'p3', 'p5', 'p6']].map((s) => s.sort().join()));
    const staged = aR.find((r) => r.key === 'A_LEVEL_STAGED')!;
    expect(staged.stages).toEqual([[['p1', 'p4'], ['p3', 'p5']], [['p1', 'p5'], ['p3', 'p4']], [['p1', 'p5'], ['p3', 'p6']]]);
    for (const r of aR) for (const set of r.componentSets) expect(set.includes('p4') && set.includes('p6')).toBe(false);
  });
  it('sciences: P1 is a 40-question multiple-choice paper; P3 practical; P5 planning, analysis and evaluation', () => {
    for (const code of ['9702', '9701', '9700']) {
      const cfg = parsed.get(`v2.aice.${code}-a`)!;
      const d = (k: string) => cfg.sections.find((s) => s.key === k)!.definition!;
      expect(d('p1')).toMatchObject({ kind: 'MULTIPLE_CHOICE_TEST', officialItemCount: 40, maxMarks: 40 });
      expect(d('p3').kind).toBe('PRACTICAL');
      expect(d('p4')).toMatchObject({ maxMarks: 100, officialDurationMinutes: 120, weightingPercent: 38.5 });
      // 9702 states no explicit calculator rule (shown as such); 9701 / 9700 allow calculators.
      expect(d('p1').calculatorPolicy).toBe(code === '9702' ? null : 'ALLOWED');
    }
  });
  it('9239 (core): written exam + essay + presentation + research report -- not all written papers', () => {
    const cfg = parsed.get('v2.aice.9239-a')!;
    expect(cfg.sections.map((s) => [s.key, s.definition!.kind, s.definition!.maxMarks])).toEqual([['c1', 'WRITTEN_PAPER', 45], ['c2', 'COURSEWORK', 40], ['c3', 'PRESENTATION', 40], ['c4', 'RESEARCH_REPORT', 85]]);
    for (const k of ['c2', 'c3', 'c4']) expect(cfg.sections.find((s) => s.key === k)!.durationMinutes).toBeUndefined(); // coursework: untimed
  });
  it('humanities are never generic multiple choice: 9093 and 9708 essays / data response are rubric-scored', () => {
    const eng = parsed.get('v2.aice.9093-a')!;
    expect(eng.items.every((i) => i.content.rubric)).toBe(true);
    const eco = parsed.get('v2.aice.9708-a')!;
    for (const k of ['p2', 'p4']) expect(eco.items.filter((i) => eco.sections.find((s) => s.key === k)!.objectives.some((o) => o.code === i.objectiveCode)).every((i) => i.content.rubric)).toBe(true);
  });
  it('engine view (TECHNICAL_DEMO): reduced where the bank is reduced; written papers reach the official marks per component', () => {
    const T = 'TECHNICAL_DEMO' as const;
    expect(packageReadiness(parsed.get('v2.aice.9709-as')!, undefined, undefined, T).state).toBe('REDUCED_MOCK_READY');
    expect(packageReadiness(parsed.get('v2.aice.9702-a')!, undefined, undefined, T).state).toBe('REDUCED_MOCK_READY');
    expect(packageReadiness(parsed.get('v2.aice.9708-as')!, undefined, undefined, T).state).toBe('REDUCED_MOCK_READY');
    expect(componentReadiness(parsed.get('v2.aice.9708-as')!, 'p2', undefined, T).state).toBe('FULL_MOCK_READY');
    // QB D4: 9239 C2 (essay coursework) / C3 (presentation) count for the exam but are never mockable; the written C1 decides the mock.
    const gp = packageReadiness(parsed.get('v2.aice.9239-as')!, undefined, undefined, T);
    expect(gp.components.filter((c) => !c.mockable).map((c) => c.sectionKey)).toEqual(['c2', 'c3']);
    expect(gp.components.filter((c) => !c.mockable).every((c) => c.state === 'PRACTICE_READY')).toBe(true);
    expect(gp.state).toBe('FULL_MOCK_READY');
  });
  it('Student view (QB D5): DEV fixtures are not content -- no AICE syllabus is practice- or mock-ready for a Student', () => {
    for (const code of REF) for (const lv of ['as', 'a']) {
      const r = packageReadiness(parsed.get(`v2.aice.${code}-${lv}`)!);
      expect(r.state, `${code}-${lv}`).toBe('STRUCTURE_READY');
      expect(r.components.every((c) => c.bankItems === 0 && !c.bankInProgress)).toBe(true);
    }
  });
  it('no official content and no official grade claimed', () => {
    for (const code of REF) for (const lv of ['as', 'a']) {
      const cfg = parsed.get(`v2.aice.${code}-${lv}`)!;
      expect(cfg.contentStatus).toBe('DEV_CERT_FIXTURE');
      expect(cfg.items.every((i) => i.content.contentOrigin === 'FIXTURE')).toBe(true);
      expect(cfg.reporting?.scaleNote).toBe('NO_OFFICIAL_SCALE');
      expect(cfg.scoring.policy.transform.type).toBe('NONE');
    }
  });
  it('catalogue: subjects without verified components stay catalogue-only; reference levels are bound', () => {
    const flat = flattenCatalog();
    const configs = configsByKey();
    const node = (k: string) => flat.find((f) => f.node.key === k)!.node;
    expect(nodeReadiness(node('cie.aice.g1.9990.a'), configs).state).toBe('CATALOG_ONLY');
    expect(node('cie.aice.g1.9709.as').bind?.configKey).toBe('v2.aice.9709-as');
    expect(node('cie.aice.g1.9709.as').facts).toMatchObject({ credits: 1 });
    expect(node('cie.aice.g1.9709.a').facts).toMatchObject({ credits: 2 });
    expect(node('cie.aice.g3.9990').description).toMatch(/Group 1/); // multi-group subject, same subject
  });
  it('every AICE objective links to a curated concept (Learning Bridge)', () => {
    const links = allLearningLinks();
    for (const code of REF) for (const lv of ['as', 'a']) for (const s of parsed.get(`v2.aice.${code}-${lv}`)!.sections) for (const o of s.objectives) expect(links[o.code]?.concepts?.length, o.code).toBeGreaterThan(0);
  });
});

describe('PISA 2022 -- domains, units and scoring', () => {
  const cfg = parsed.get('v2.pisa.2022')!;
  it('one versioned assessment with three independent domains -- no papers', () => {
    expect(cfg.framework).toMatchObject({ frameworkVersion: '2022', firstAssessment: 2022 });
    expect(cfg.sections.map((s) => s.key)).toEqual(['math', 'reading', 'science']);
    expect(cfg.sections.every((s) => !/paper/i.test(s.name))).toBe(true);
    expect(cfg.sections.map((s) => s.definition!.officialDurationMinutes)).toEqual([60, 60, 60]);
  });
  it('official framework names: mathematics processes, reading processes, science competencies', () => {
    const dist = (k: string, dim: string) => Object.keys(cfg.sections.find((s) => s.key === k)!.definition!.distributions.find((d) => d.dimension.startsWith(dim))!.values);
    expect(dist('math', 'Reasoning')).toEqual(['Mathematical reasoning', 'Formulating situations mathematically', 'Employing mathematical concepts, facts and procedures', 'Interpreting, applying and evaluating mathematical outcomes']);
    expect(dist('math', 'Content')).toEqual(['Change and relationships', 'Space and shape', 'Quantity', 'Uncertainty and data']);
    expect(dist('reading', 'Cognitive')).toEqual(['Locating information', 'Understanding', 'Evaluating and reflecting']);
    expect(dist('science', 'Competency')).toEqual(['Explain phenomena scientifically', 'Evaluate and design scientific enquiry', 'Interpret data and evidence scientifically']);
    expect(dist('science', 'Knowledge')).toEqual(['Content', 'Procedural', 'Epistemic']);
  });
  it('mathematics keeps 25 % per process and per content category in every form', () => {
    const codes = cfg.sections.find((s) => s.key === 'math')!.objectives.map((o) => o.code);
    for (const p of ['formular', 'emplear', 'interpretar', 'razonar']) expect(codes.filter((c) => c.endsWith(`.${p}`))).toHaveLength(2);
  });
  it('units: items sharing a stimulus share EXACTLY the same stimulus (never regenerated); single and multiple source', () => {
    const byKey = new Map<string, string>();
    for (const it of cfg.items) {
      const st = it.content.stimulus;
      if (!st) continue;
      if (byKey.has(st.key)) expect(byKey.get(st.key), st.key).toBe(st.text);
      byKey.set(st.key, st.text);
    }
    const unitsWithSeveral = [...byKey.keys()].filter((k) => cfg.items.filter((i) => i.content.stimulus?.key === k).length >= 2);
    expect(unitsWithSeveral.length).toBeGreaterThanOrEqual(8);
    expect(cfg.items.some((i) => /Fuente A[\s\S]*Fuente B/.test(i.content.stimulus?.text ?? ''))).toBe(true); // multiple source
    expect(cfg.items.some((i) => (i.content.stimulus?.text ?? '').includes('·'))).toBe(true); // non-continuous / mixed
  });
  it('item formats: selected, complex selected, closed constructed (math engine) and open constructed with partial credit', () => {
    const items = cfg.items.map((i) => examItemFromApproved({ id: '00000000-0000-0000-0000-000000000000', learning_objective_id: '00000000-0000-0000-0000-000000000000', content: i.content })!);
    expect(items.every(Boolean)).toBe(true);
    expect(items.some((i) => i.answerFormat === 'single_choice')).toBe(true);
    expect(items.some((i) => i.answerFormat === 'multi_choice')).toBe(true);
    expect(items.some((i) => i.exam.math)).toBe(true);
    const open = cfg.items.filter((i) => i.content.rubric);
    expect(open.length).toBeGreaterThanOrEqual(6);
    for (const o of open) expect(o.content.rubric!.criteria[0].descriptors.map((d) => d.marks)).toEqual(['0', '1', '2']); // no / partial / full credit
    for (const d of ['math', 'reading', 'science']) expect(open.some((o) => cfg.sections.find((s) => s.key === d)!.objectives.some((x) => x.code === o.objectiveCode)), d).toBe(true);
  });
  it('no official PISA score, scale or level -- raw marks and StudyUs readiness only', () => {
    expect(cfg.reporting?.scaleNote).toBe('NO_OFFICIAL_SCALE');
    expect(cfg.scoring.policy.transform.type).toBe('NONE');
    expect(cfg.sections.every((s) => s.definition!.limitations.join(' ').length > 0)).toBe(true);
    expect(cfg.contentStatus).toBe('DEV_CERT_FIXTURE');
  });
  it('QB D3: a competency benchmark -- per domain at most PRACTICE_READY (engine view), never mockable; nothing for a Student on fixtures', () => {
    const r = packageReadiness(cfg, undefined, undefined, 'TECHNICAL_DEMO');
    expect(r.mockable).toBe(false);
    expect(r.components.map((c) => [c.sectionKey, c.state, c.mockable])).toEqual([['math', 'PRACTICE_READY', false], ['reading', 'PRACTICE_READY', false], ['science', 'PRACTICE_READY', false]]);
    expect(r.components.find((c) => c.sectionKey === 'reading')!.lengthCoveragePercent).toBeNull();
    expect(packageReadiness(cfg).state).toBe('STRUCTURE_READY');
  });
  it('catalogue (QB D3): three-domain competency benchmark, three domains, practice by official process / competency -- never a PISA Mock', () => {
    const flat = flattenCatalog();
    const configs = configsByKey();
    const node = (k: string) => flat.find((f) => f.node.key === k)!.node;
    const T = 'TECHNICAL_DEMO' as const;
    expect(nodeReadiness(node('pisa.2022.full'), configs, T)).toMatchObject({ state: 'PRACTICE_READY', modes: ['PRACTICE'], mockable: false });
    expect(node('pisa.2022.full').label).toMatch(/estilo PISA/);
    for (const d of ['math', 'reading', 'science']) expect(nodeReadiness(node(`pisa.2022.${d}`), configs, T).modes).toEqual(['PRACTICE']);
    expect(nodeReadiness(node('pisa.2022.reading.evaluate'), configs, T)).toMatchObject({ state: 'PRACTICE_READY', modes: ['PRACTICE'] });
    // Student view: fixture content -> structure only, nothing startable.
    expect(nodeReadiness(node('pisa.2022.full'), configs)).toMatchObject({ state: 'STRUCTURE_READY', modes: [] });
    expect(node('pisa.2022.science').description).toMatch(/Explicar fenómenos/);
  });
  it('every PISA objective links to a curated concept (no automatic concept creation)', () => {
    const links = allLearningLinks();
    for (const s of cfg.sections) for (const o of s.objectives) expect(links[o.code]?.concepts?.length, o.code).toBeGreaterThan(0);
  });
});

import { gradeExamItem } from '@/lib/exam-core/item-grading';
describe('AICE manual package grading claims', () => {
  const item = (cfg: string, key: string) => examItemFromApproved({ id: '00000000-0000-0000-0000-000000000001', learning_objective_id: '00000000-0000-0000-0000-000000000002', content: parsed.get(cfg)!.items.find((i) => i.content.key === key)!.content })!;
  const part = async (cfg: string, key: string, answers: Record<string, unknown>, id: string) => {
    const r = await gradeExamItem(item(cfg, key), JSON.stringify(answers), 'en');
    const p = (r.evaluation.criteriaBreakdown as any).parts[id];
    return p.awarded === p.max ? 'FULL' : p.awarded > 0 ? 'PARTIAL' : 'ZERO';
  };
  const single = async (cfg: string, key: string, answer: unknown) => {
    const r = await gradeExamItem(item(cfg, key), typeof answer === 'string' ? answer : JSON.stringify(answer), 'en');
    return r.evaluation.score === r.maxMarks ? 'FULL' : r.evaluation.score > 0 ? 'PARTIAL' : 'ZERO';
  };
  it.each([
    ['v2.aice.9709-as', '9709-as.p1.square', 'a', '3', 'FULL'],
    ['v2.aice.9709-as', '9709-as.p1.square', 'b', '-11', 'FULL'],
    ['v2.aice.9709-as', '9709-as.p1.square', 'b', '11', 'ZERO'],
    ['v2.aice.9702-as', '9702-as.p2.car', 'b', '1800 N', 'FULL'],
    ['v2.aice.9702-as', '9702-as.p2.car', 'b', '1800', 'PARTIAL'],
    ['v2.aice.9702-as', '9702-as.p2.car', 'c', '135 kJ', 'FULL'],
    ['v2.aice.9702-as', '9702-as.p3.spring', 'a', '205', 'FULL'],
    ['v2.aice.9701-as', '9701-as.p3.titration', 'a', '22.40', 'FULL'],
    ['v2.aice.9701-as', '9701-as.p3.titration', 'b', '0.134 mol dm^-3', 'FULL'],
    ['v2.aice.9701-as', '9701-as.p2.magnesium', 'b', '3.98 g', 'FULL'],
    ['v2.aice.9700-a', '9700-a.p4.chisquared', 'a', '1.33', 'FULL'],
  ])('%s %s part %s: %s -> %s', async (cfg, key, id, answer, expected) => {
    expect(await part(cfg, key, { [id]: answer }, id)).toBe(expected);
  });
  it.each([
    ['v2.aice.9709-as', '9709-as.p1.binomial', '80', 'FULL'],
    ['v2.aice.9709-as', '9709-as.p1.binomial', { latex: '10', working: '10*8' }, 'PARTIAL'],
    ['v2.aice.9709-as', '9709-as.p1.definite', '10', 'FULL'],
    ['v2.aice.9702-a', '9702-a.p4.capacitor', '0.0338', 'FULL'],
    ['v2.aice.9702-a', '9702-a.p4.capacitor', '0.03384', 'PARTIAL'],
    ['v2.aice.9701-a', '9701-a.p2.hess', '-76', 'FULL'],
    ['v2.aice.9701-a', '9701-a.p4.kc', '0.36', 'FULL'],
  ])('%s %s: %j -> %s', async (cfg, key, answer, expected) => {
    expect(await single(cfg, key, answer)).toBe(expected);
  });
});
