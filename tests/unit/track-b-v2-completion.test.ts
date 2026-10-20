/**
 * Exam V2 completion block -- PAA redesign, IB DP full catalogue and structure,
 * science grading, Learning Bridge links, readiness and coverage.
 */
import { describe, it, expect } from 'vitest';
import { parseExamVerticalConfig, type ExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { PAA_V2 } from '@/lib/exam-core/verticals/v2';
import { IB_DP_SUBJECTS } from '@/lib/exam-core/catalog/ib-dp.generated';
import { NOT_CURRENT, FULL_CONFIG_KEYS, structureConfigKey } from '@/lib/exam-core/catalog/ib-dp';
import { ASSESSMENT_CATALOG, flattenCatalog } from '@/lib/exam-core/catalog/structure';
import { configsByKey, nodeReadiness } from '@/lib/exam-core/catalog/structure.service';
import { componentReadiness, modesFor } from '@/lib/exam-core/catalog/readiness';
import { ibCoverage, ibSubjectReadinessMatrix } from '@/lib/exam-core/catalog/coverage';
import { allLearningLinks } from '@/lib/exam-core/catalog/objective-learning-links';
import { DEV_CANONICAL_CONCEPTS, DEV_SKILLS, DEV_COMPETENCIES } from '@/lib/exam-core/catalog/dev-learning-catalog';
import { ASSESSMENT_SOURCES } from '@/lib/exam-core/catalog/sources';
import { examItemFromApproved, MathKeySchema, type ExamItem } from '@/lib/exam-core/items';
import { gradeExamItem, gradeMathTarget } from '@/lib/exam-core/item-grading';

const parsed = new Map<string, ExamVerticalConfig>();
for (const v of allV2Configs()) {
  const p = parseExamVerticalConfig(v);
  if (!p.ok) throw new Error(`${v.key}: ${p.issues.join('; ')}`);
  parsed.set(p.config.key, p.config);
}
const flat = flattenCatalog();
const node = (key: string) => flat.find((f) => f.node.key === key)!.node;
const item = (cfgKey: string, itemKey: string): ExamItem => {
  const it = parsed.get(cfgKey)!.items.find((i) => i.content.key === itemKey)!;
  return examItemFromApproved({ id: '00000000-0000-0000-0000-000000000001', learning_objective_id: '00000000-0000-0000-0000-000000000002', content: it.content }) as ExamItem;
};

describe('PAA -- one integral test, area blueprints, separate Practice', () => {
  const cfg = parsed.get('v2.paa')!;
  it('full test = Lectura, Redacción, Matemáticas, Inglés in the official order, with official size and breaks', () => {
    expect(cfg.sections.map((s) => s.key)).toEqual(['lectura', 'redaccion', 'matematicas', 'ingles']);
    expect(cfg.version.delivery.breaks.map((b) => b.afterSectionKey)).toEqual(['redaccion', 'matematicas']);
    expect(cfg.sections.find((s) => s.key === 'matematicas')!.definition!.calculatorPolicy).toBe('NONE');
  });
  it('reporting: Lectura y Redacción together, English institution-defined, no official scale', () => {
    expect(cfg.reporting?.scaleNote).toBe('NO_OFFICIAL_SCALE');
    expect(cfg.reporting?.groups.find((g) => g.key === 'lectura-redaccion')?.sectionKeys).toEqual(['lectura', 'redaccion']);
    expect(cfg.reporting?.groups.find((g) => g.key === 'ingles')?.institutionDefined).toBe(true);
    expect(cfg.scoring.policy.transform.type).toBe('NONE'); // never a fake 200-800
  });
  it('Lectura: several questions per text (text sets), literary / informational / argumentative / graphic texts', () => {
    const lect = cfg.items.filter((i) => i.objectiveCode.startsWith('paa.lect.'));
    const perStimulus = new Map<string, number>();
    for (const i of lect) if (i.content.stimulus) perStimulus.set(i.content.stimulus.key, (perStimulus.get(i.content.stimulus.key) ?? 0) + 1);
    expect([...perStimulus.values()].filter((n) => n >= 2).length).toBeGreaterThanOrEqual(3);
    expect(new Set(lect.map((i) => i.content.tags?.context))).toEqual(new Set(['informativo', 'literario', 'argumentativo']));
  });
  it('Redacción: every item names its writing operation (not generic grammar)', () => {
    for (const i of cfg.items.filter((x) => x.objectiveCode.startsWith('paa.red.'))) expect(i.content.tags?.process, i.content.key).toBeTruthy();
  });
  it('Matemáticas: domains incl. probability, MC + student-produced responses graded by equivalence', () => {
    const math = cfg.items.filter((i) => i.objectiveCode.startsWith('paa.mat.'));
    expect(new Set(math.map((i) => i.content.tags?.contentCategory))).toEqual(new Set(['Aritmética', 'Álgebra', 'Geometría', 'Análisis de datos', 'Probabilidad']));
    expect(math.filter((i) => i.content.tags?.responseFormat === 'STUDENT_PRODUCED' && i.content.math).length).toBeGreaterThanOrEqual(4);
    for (const i of math) expect(i.content.tags?.skill && i.content.tags?.process, i.content.key).toBeTruthy();
  });
  it('catalogue: "Simulacro completo" = Mock/Challenge of all areas; "Practicar" = Practice per area and per skill', () => {
    const configs = configsByKey();
    const full = node('paa.full');
    expect(full.purpose).toBe('FULL_TEST');
    // Engine view (TECHNICAL_DEMO): the modes the catalogue CAN offer once real content exists.
    expect(nodeReadiness(full, configs, 'TECHNICAL_DEMO').modes).toEqual(['MOCK', 'CHALLENGE']);
    for (const k of ['paa.practice.lectura', 'paa.practice.redaccion', 'paa.practice.matematicas', 'paa.practice.ingles', 'paa.practice.lectura.inferencia', 'paa.practice.matematicas.algebra']) {
      expect(nodeReadiness(node(k), configs, 'TECHNICAL_DEMO').modes, k).toEqual(['PRACTICE']);
      // QB D5: Student view on fixture-only content -> nothing startable.
      expect(nodeReadiness(node(k), configs).modes, k).toEqual([]);
    }
    expect(nodeReadiness(full, configs).modes).toEqual([]);
    for (const f of flat.filter((x) => x.family === 'PAA' && x.node.bind?.objectiveCodes)) {
      for (const code of f.node.bind!.objectiveCodes!) expect(cfg.sections.some((s) => s.objectives.some((o) => o.code === code)), code).toBe(true);
    }
    expect(flat.some((f) => f.node.bind?.configKey === 'v2.paa.math')).toBe(false); // the old Mathematics-only path is gone
  });
});

describe('IB DP -- complete catalogue, real structures only', () => {
  const current = IB_DP_SUBJECTS.filter((s) => !NOT_CURRENT.has(s.key));
  const ibNodes = flat.filter((f) => f.family === 'IB');
  it('every current subject (all groups + DP core) is in the catalogue', () => {
    for (const s of current) expect(ibNodes.some((f) => f.node.key === `ib.dp.${s.key}` || f.node.key.startsWith(`ib.dp.`) && f.node.key.endsWith(`.next`) && s.key.endsWith('2028') || f.node.label.startsWith(s.name.split(' (')[0])), s.key).toBe(true);
    for (const g of ['1', '2', '3', '4', '5', '6', 'core']) expect(ibNodes.some((f) => f.node.key === `ib.dp.g${g}`)).toBe(true);
    for (const k of ['ib.dp.physics', 'ib.dp.chemistry', 'ib.dp.biology', 'ib.dp.computer-science', 'ib.dp.design-technology', 'ib.dp.dance', 'ib.dp.theory-of-knowledge', 'ib.dp.extended-essay', 'ib.dp.cas', 'ib.dp.global-politics', 'ib.dp.digital-society', 'ib.dp.social-and-cultural-anthropology', 'ib.dp.classical-languages', 'ib.dp.literature-and-performance']) {
      expect(ibNodes.some((f) => f.node.key === k), k).toBe(true);
    }
  });
  it('no invented papers: every configured component exists in that subject/level of the sourced guide', () => {
    for (const s of current) {
      for (const level of s.levels) {
        const key = FULL_CONFIG_KEYS[`${s.key}:${level}`] ?? structureConfigKey(s.key, level);
        const cfg = parsed.get(key);
        if (!cfg) continue;
        const guideNames = s.components.filter((c) => c.levels.includes(level)).map((c) => c.name.toLowerCase());
        const guideKeys = s.components.filter((c) => c.levels.includes(level)).map((c) => c.key.toLowerCase());
        for (const sec of cfg.sections) {
          const ok = guideKeys.includes(sec.key) || guideNames.includes((sec.definition?.officialName ?? '').toLowerCase());
          expect(ok, `${key}: ${sec.key} / ${sec.definition?.officialName}`).toBe(true);
        }
      }
    }
  });
  it('SL never gets HL-only components; sciences have Paper 1A/1B/2 and no Paper 3', () => {
    expect(parsed.get('v2.ib.math-aa-sl')!.sections.map((s) => s.key)).toEqual(['p1', 'p2']);
    expect(parsed.get('v2.ib.math-ai-hl')!.sections.map((s) => s.key)).toEqual(['p1', 'p2', 'p3']);
    for (const k of ['physics', 'chemistry', 'biology']) for (const l of ['sl', 'hl']) expect(parsed.get(`v2.ib.${k}-${l}`)!.sections.map((s) => s.key)).toEqual(['p1a', 'p1b', 'p2']);
    expect(parsed.get(structureConfigKey('environmental-systems-societies', 'SL'))!.sections.some((s) => s.key === 'p3')).toBe(false);
    expect(parsed.get(structureConfigKey('computer-science', 'HL'))!.sections.some((s) => s.key === 'p3')).toBe(false);
    for (const s of current) for (const c of s.components.filter((x) => !x.levels.includes('SL'))) {
      const sl = parsed.get(FULL_CONFIG_KEYS[`${s.key}:SL`] ?? structureConfigKey(s.key, 'SL'));
      if (sl) expect(sl.sections.some((sec) => sec.key === c.key), `${s.key} SL has HL-only ${c.key}`).toBe(false);
    }
  });
  it('per-level official facts: Physics P2 SL 50 / HL 90 marks, 90 / 150 min; Chemistry HL P2 90 marks; Biology P2 SL 50', () => {
    const p2 = (k: string) => parsed.get(k)!.sections.find((s) => s.key === 'p2')!.definition!;
    expect([p2('v2.ib.physics-sl').maxMarks, p2('v2.ib.physics-sl').officialDurationMinutes, p2('v2.ib.physics-hl').maxMarks, p2('v2.ib.physics-hl').officialDurationMinutes]).toEqual([50, 90, 90, 150]);
    expect(p2('v2.ib.chemistry-hl').maxMarks).toBe(90);
    expect(p2('v2.ib.biology-sl').maxMarks).toBe(50);
    expect(parsed.get('v2.ib.physics-hl')!.sections.find((s) => s.key === 'p1a')!.definition!.limitations.join(' ')).toMatch(/split is not published/);
  });
  it('structure-only subjects: sourced definitions, never startable (no items, not simulation-capable)', () => {
    for (const cfg of [...parsed.values()].filter((c) => c.structureOnly)) {
      expect(cfg.items).toHaveLength(0);
      expect(cfg.sections.every((s) => s.simulationCapable === false && s.definition && s.definition.sourceKeys.length > 0)).toBe(true);
      expect(componentReadiness(cfg, cfg.sections[0].key).state).toBe('STRUCTURE_READY');
    }
  });
  it('DP core: TOK and EE structured (no papers), CAS catalogued and not examinable', () => {
    expect(parsed.get(structureConfigKey('theory-of-knowledge', 'CORE'))!.sections.map((s) => s.key)).toEqual(['exhibition', 'essay']);
    expect(node('ib.dp.cas').notExaminable).toBe(true);
    expect(nodeReadiness(node('ib.dp.cas'), configsByKey()).modes).toEqual([]);
  });
  it('every cited source is registered', () => {
    const keys = new Set(ASSESSMENT_SOURCES.map((s) => s.key));
    for (const cfg of parsed.values()) for (const k of [...(cfg.framework?.sourceKeys ?? []), ...cfg.sections.flatMap((s) => s.definition?.sourceKeys ?? [])]) expect(keys.has(k), `${cfg.key}: ${k}`).toBe(true);
  });
  it('coverage is reported separately and honestly (engine view vs Student view)', () => {
    const cov = ibCoverage('TECHNICAL_DEMO');
    expect(cov.catalogPercent).toBe(100);
    expect(cov.structurePercent).toBe(100);
    expect(cov.reducedMockPercent).toBeLessThan(cov.structurePercent);
    // QB D4: Visual arts is coursework -- never mockable -- so no IB subject reaches a full-length mock.
    expect(cov.fullMockPercent).toBe(0);
    expect(cov.practicePercent).toBeGreaterThan(cov.reducedMockPercent);
    const m = ibSubjectReadinessMatrix('TECHNICAL_DEMO');
    expect(m.find((r) => r.subject === 'Physics')).toMatchObject({ SL: 'REDUCED_MOCK_READY', HL: 'REDUCED_MOCK_READY', reducedMock: 'READY', fullMock: 'NOT_CONFIGURED', learningBridge: 'READY', officialContentCoveragePercent: 0 });
    expect(m.find((r) => r.subject === 'Economics')).toMatchObject({ structure: 'READY', practice: 'NOT_CONFIGURED', fullMock: 'NOT_CONFIGURED' });
    // QB D5: the Student view counts real content only -- today, none.
    const student = ibCoverage();
    expect(student).toMatchObject({ structurePercent: 100, practicePercent: 0, reducedMockPercent: 0, fullMockPercent: 0 });
    expect(ibSubjectReadinessMatrix().find((r) => r.subject === 'Physics')).toMatchObject({ SL: 'STRUCTURE_READY', HL: 'STRUCTURE_READY', practice: 'NOT_CONFIGURED' });
  });
});

describe('readiness model', () => {
  it('modes follow readiness: practice needs PRACTICE_READY, mock needs at least REDUCED_MOCK_READY', () => {
    expect(modesFor('REDUCED_MOCK_READY', ['MOCK', 'CHALLENGE'])).toEqual(['MOCK', 'CHALLENGE']);
    expect(modesFor('STRUCTURE_READY')).toEqual([]);
    expect(modesFor('PRACTICE_READY')).toEqual(['PRACTICE']);
    expect(modesFor('FULL_MOCK_READY', ['MOCK', 'CHALLENGE'])).toEqual(['MOCK', 'CHALLENGE']);
  });
  it('a component whose bank cannot fill every position is PRACTICE_READY, not a mock', () => {
    const cfg = structuredClone(parsed.get('v2.ib.physics-hl')!);
    cfg.items = cfg.items.filter((i) => i.content.key !== 'physics-hl.p2.projectile' && i.objectiveCode !== 'phy.p2.fields' || i.objectiveCode === 'phy.p2.fields' && false);
    cfg.items.push(...parsed.get('v2.ib.physics-hl')!.items.filter((i) => i.objectiveCode === 'phy.p2.fields'));
    cfg.sections.find((s) => s.key === 'p2')!.objectives.find((o) => o.code === 'phy.p2.fields')!.targets[0].count = 2;
    expect(componentReadiness(cfg, 'p2', undefined, 'TECHNICAL_DEMO').state).toBe('PRACTICE_READY');
  });
  it('QB D3 / D4: a non-mockable package never offers Mock / Challenge, whatever its state', () => {
    expect(modesFor('FULL_MOCK_READY', ['PRACTICE', 'MOCK', 'CHALLENGE'], { mockable: false })).toEqual(['PRACTICE']);
  });
});

describe('science grading', () => {
  const K = (k: unknown) => MathKeySchema.parse(k);
  it('area units: cm2 = cm² = cm^2; conversions only when allowed', () => {
    const k = K({ kind: 'NUMBER', answers: ['54 cm^2'], units: { expected: 'cm^2', required: true, allowConversion: true } });
    for (const a of ['54 cm2', '54 cm²', '54 cm^2', '0.0054 m^2']) {
      const r = gradeMathTarget(k, null, 1, a, 'en');
      expect('problem' in r ? 0 : r.awarded, a).toBe(1);
    }
  });
  it('Physics: units, significant figures and method marks', async () => {
    const r = await gradeExamItem(item('v2.ib.physics-hl', 'physics-hl.p1b.pendulum'), JSON.stringify({ a: { latex: '9.82 m/s^2', working: 'g=4π^2/4.02' }, b: '1', c: 'A' }), 'en');
    expect(r.evaluation.score).toBe(r.maxMarks);
    const noUnit = await gradeExamItem(item('v2.ib.physics-hl', 'physics-hl.p1b.pendulum'), JSON.stringify({ a: '9.82', b: '1', c: 'A' }), 'en');
    expect(noUnit.evaluation.score).toBeLessThan(r.maxMarks);
    const momentum = await gradeExamItem(item('v2.ib.physics-hl', 'physics-hl.p2.collision'), JSON.stringify({ a: '6 kg m s^{-1}', b: '2 m/s', c: { latex: '3', working: '0.5*2*3^2=9' }, d: 'A' }), 'en');
    expect(momentum.evaluation.score).toBe(momentum.maxMarks);
  });
  it('Chemistry: equation coefficients as structured parts, mol dm⁻³ units, kJ vs J conversion, significant figures', async () => {
    const eq = await gradeExamItem(item('v2.ib.chemistry-hl', 'chemistry-hl.p2.combustion'), JSON.stringify({ a: '5', b: '3', c: '4', d: '13.2 g' }), 'en');
    expect(eq.evaluation.score).toBe(eq.maxMarks);
    const wrongCoeff = await gradeExamItem(item('v2.ib.chemistry-hl', 'chemistry-hl.p2.combustion'), JSON.stringify({ a: '4', b: '3', c: '4', d: '13.2 g' }), 'en');
    expect(wrongCoeff.evaluation.score).toBe(eq.maxMarks - 1);
    const titr = await gradeExamItem(item('v2.ib.chemistry-hl', 'chemistry-hl.p1b.titration'), JSON.stringify({ a: '20.00', b: '0.0800 mol dm^{-3}', c: '0.5' }), 'en');
    expect(titr.evaluation.score).toBe(titr.maxMarks);
    const joules = await gradeExamItem(item('v2.ib.chemistry-hl', 'chemistry-hl.p1b.calorimetry'), JSON.stringify({ a: '2510 J', b: 'A' }), 'en');
    expect(joules.evaluation.score).toBe(joules.maxMarks); // 2510 J = 2.51 kJ, 3 s.f.
    const coarse = await gradeExamItem(item('v2.ib.chemistry-hl', 'chemistry-hl.p1b.calorimetry'), JSON.stringify({ a: '3000 J', b: 'A' }), 'en');
    expect(coarse.evaluation.score).toBeLessThan(coarse.maxMarks); // 1 s.f. is not "rounded to 3 s.f."
    const k = MathKeySchema.parse({ kind: 'NUMBER', answers: ['2508'] });
    const r2 = gradeMathTarget(k, null, 1, '2510', 'en');
    expect('problem' in r2 ? 0 : r2.awarded).toBe(0); // no s.f. requested: 2510 is not 2508
  });
  it('signed integers and decimals meet the INTEGER / DECIMAL forms (+6 oxidation state, -2 root)', () => {
    const k = MathKeySchema.parse({ kind: 'NUMBER', answers: ['6'], requiredForm: 'INTEGER' });
    for (const a of ['6', '+6']) { const r = gradeMathTarget(k, null, 1, a, 'en'); expect('problem' in r ? 0 : r.awarded, a).toBe(1); }
    const neg = MathKeySchema.parse({ kind: 'NUMBER', answers: ['-2'], requiredForm: 'INTEGER' });
    const r = gradeMathTarget(neg, null, 1, '-2', 'en');
    expect('problem' in r ? 0 : r.awarded).toBe(1);
  });
  it('Biology: signed percentage change and data reasoning', async () => {
    const r = await gradeExamItem(item('v2.ib.biology-hl', 'biology-hl.p2.osmosis'), JSON.stringify({ a: '-8', b: 'A' }), 'en');
    expect(r.evaluation.score).toBe(r.maxMarks);
  });
});

describe('Learning Bridge links', () => {
  const links = allLearningLinks();
  const allCodes = new Set([...parsed.values()].flatMap((c) => c.sections.flatMap((s) => s.objectives.map((o) => o.code))));
  it('every link points at an existing objective and at curated catalogue rows (never created by AI)', () => {
    const concepts = new Set(DEV_CANONICAL_CONCEPTS.map((c) => `${c.subject}/${c.name}`));
    const skills = new Set(DEV_SKILLS.map((s) => s.name));
    const comps = new Set(DEV_COMPETENCIES.map((c) => c.code));
    for (const [code, l] of Object.entries(links)) {
      expect(allCodes.has(code), code).toBe(true);
      for (const c of l.concepts ?? []) expect(concepts.has(`${c.subject}/${c.name}`), `${code}: ${c.subject}/${c.name}`).toBe(true);
      for (const s of l.skills ?? []) expect(skills.has(s), s).toBe(true);
      for (const c of l.competencies ?? []) expect(comps.has(c), c).toBe(true);
    }
  });
  it('PAA, Physics, Chemistry, Biology objectives are all linked to a concept', () => {
    for (const cfgKey of ['v2.paa', 'v2.ib.physics-hl', 'v2.ib.chemistry-hl', 'v2.ib.biology-hl']) {
      for (const s of parsed.get(cfgKey)!.sections) for (const o of s.objectives) expect(links[o.code]?.concepts?.length, o.code).toBeGreaterThan(0);
    }
  });
});

describe('readiness shown = what the entry offers', () => {
  it('PAA area/skill practice over a mock-ready config is PRACTICE_READY (never "Simulacro disponible")', () => {
    const configs = configsByKey();
    expect(nodeReadiness(node('paa.full'), configs, 'TECHNICAL_DEMO').state).toBe('REDUCED_MOCK_READY'); // 36 of 175 official items (engine view)
    for (const k of ['paa.practice.lectura', 'paa.practice.lectura.inferencia']) expect(nodeReadiness(node(k), configs, 'TECHNICAL_DEMO').state, k).toBe('PRACTICE_READY');
    expect(nodeReadiness(node('paa.full'), configs).state).toBe('STRUCTURE_READY'); // Student view: fixtures are not content
  });
});

describe('manual package claims (MANUAL_E2E_IB_SCIENCES_HL.md, MANUAL_E2E_PAA.md) are what the engine does', () => {
  const part = async (cfg: string, key: string, answers: Record<string, unknown>, id: string) => {
    const r = await gradeExamItem(item(cfg, key), JSON.stringify(answers), 'en');
    const p = (r.evaluation.criteriaBreakdown as any).parts[id];
    return p.awarded === p.max ? 'FULL' : p.awarded > 0 ? 'PARTIAL' : 'ZERO';
  };
  const P = 'v2.ib.physics-hl';
  const C = 'v2.ib.chemistry-hl';
  it.each([
    [P, 'physics-hl.p1b.pendulum', 'a', '9.82 m/s^2', 'FULL'],
    [P, 'physics-hl.p1b.pendulum', 'a', '9.82 m s^-2', 'FULL'],
    [P, 'physics-hl.p1b.pendulum', 'a', '9.82', 'PARTIAL'],
    [P, 'physics-hl.p1b.pendulum', 'a', '9.8205 m/s^2', 'PARTIAL'],
    [P, 'physics-hl.p1b.pendulum', 'a', '9.8203 m/s^2', 'ZERO'],
    [P, 'physics-hl.p1b.pendulum', 'b', '1', 'FULL'],
    [P, 'physics-hl.p1b.heater', 'a', '4290', 'FULL'],
    [P, 'physics-hl.p1b.heater', 'a', '4285.7', 'PARTIAL'],
    [P, 'physics-hl.p2.collision', 'a', '6 kg m s^-1', 'FULL'],
    [P, 'physics-hl.p2.collision', 'a', '6', 'PARTIAL'],
    [P, 'physics-hl.p2.collision', 'b', '2 km/h', 'ZERO'],
    [P, 'physics-hl.p2.projectile', 'a', '5.10', 'FULL'],
    [P, 'physics-hl.p2.projectile', 'a', '5.1', 'PARTIAL'],
    [P, 'physics-hl.p2.projectile', 'c', '35.3', 'FULL'],
    [P, 'physics-hl.p2.circuit', 'a', '2000 mA', 'FULL'],
    [P, 'physics-hl.p2.decay', 'b', '0.139', 'FULL'],
    [C, 'chemistry-hl.p1b.titration', 'a', '20.00', 'FULL'],
    [C, 'chemistry-hl.p1b.titration', 'a', '20', 'PARTIAL'],
    [C, 'chemistry-hl.p1b.titration', 'b', '0.0800 mol dm^-3', 'FULL'],
    [C, 'chemistry-hl.p1b.titration', 'b', '0.0800 mol/dm^3', 'FULL'],
    [C, 'chemistry-hl.p1b.titration', 'b', '0.08 mol/dm^3', 'PARTIAL'],
    [C, 'chemistry-hl.p1b.calorimetry', 'a', '2.51 kJ', 'FULL'],
    [C, 'chemistry-hl.p1b.calorimetry', 'a', '2510 J', 'FULL'],
    [C, 'chemistry-hl.p1b.calorimetry', 'a', '2.508 kJ', 'PARTIAL'],
    [C, 'chemistry-hl.p2.combustion', 'd', '13.2 g', 'FULL'],
    [C, 'chemistry-hl.p2.combustion', 'd', '13.2', 'PARTIAL'],
    [C, 'chemistry-hl.p2.gas', 'a', '0.0201', 'FULL'],
    [C, 'chemistry-hl.p2.redox', 'a', '+6', 'FULL'],
    [C, 'chemistry-hl.p2.redox', 'b', '11', 'FULL'],
    [C, 'chemistry-hl.p2.redox', 'b', '3', 'ZERO'],
  ])('%s %s part %s: "%s" -> %s', async (cfg, key, id, answer, expected) => {
    expect(await part(cfg, key, { [id]: answer }, id)).toBe(expected);
  });
  it('3000 J is not full marks; working alone earns the method mark', async () => {
    expect(await part(C, 'chemistry-hl.p1b.calorimetry', { a: '3000 J' }, 'a')).not.toBe('FULL');
    expect(await part(P, 'physics-hl.p2.collision', { c: { latex: '9', working: '0.5*2*3^2=9' } }, 'c')).toBe('PARTIAL');
  });
  it('PAA student-produced responses', () => {
    const key = (k: string) => parsed.get('v2.paa')!.items.find((i) => i.content.key === k)!.content.math!;
    const g = (k: string, a: string) => { const r = gradeMathTarget(MathKeySchema.parse(key(k)), null, 1, a, 'es'); return 'problem' in r ? -1 : r.awarded; };
    expect([g('paa.m.fracciones.spr', '17/12'), g('paa.m.fracciones.spr', '34/24')]).toEqual([1, 0.5]); // unsimplified: value right, form not
    expect(g('paa.m.fracciones.spr', '1.41')).toBeLessThan(1);
    expect([g('paa.m.sistema.spr', '21'), g('paa.m.pitagoras.spr', '12'), g('paa.m.pitagoras.spr', '\\sqrt{144}'), g('paa.m.media.spr', '9'), g('paa.m.comite.spr', '15')]).toEqual([1, 1, 1, 1, 1]);
    expect([g('paa.m.sistema.spr', '7'), g('paa.m.comite.spr', '30')]).toEqual([0, 0]);
  });
});
