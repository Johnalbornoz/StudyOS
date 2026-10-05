/**
 * Blueprint SLOT CONSTRAINTS + the Saber 11 Matemáticas 50-slot blueprint (pure):
 * totals, the StudyUs 3x3 policy, strict all-dimension matching, eligibility / provenance,
 * compatibility of every existing blueprint, completeness and determinism.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseExamVerticalConfig, type ExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { SABER11_MATH_V2 } from '@/lib/exam-core/verticals/v2';
import { ComponentDefinitionSchema } from '@/lib/exam-core/component-definition';
import { blueprintAllocationProblems, constraintMismatches, constraintSignature, dimensionKey, itemDimensionValues, normalizeConstraints, type SlotConstraint } from '@/lib/exam-core/slot-constraints';
import { certificationInputFromConfig } from '@/lib/exam-core/question-bank/certification-input';
import { assessExam, certifyBlueprint, itemBlockers, type BankItemFacts } from '@/lib/exam-core/question-bank/mock-certification';
import { cellKeyOf, deriveBlueprintCells } from '@/lib/exam-core/question-bank/cells';
import { assembleForm, type FormPosition, type PoolItem } from '@/lib/exam-core/form-assembly';

const ROOT = join(__dirname, '..', '..');
const saber = (() => {
  const p = parseExamVerticalConfig(SABER11_MATH_V2);
  if (!p.ok) throw new Error(p.issues.join('; '));
  return p.config;
})();
const COMP = { I: 'INTERPRETACION_Y_REPRESENTACION', F: 'FORMULACION_Y_EJECUCION', A: 'ARGUMENTACION' } as const;
const CONT = { AC: 'ALGEBRA_Y_CALCULO', E: 'ESTADISTICA', G: 'GEOMETRIA' } as const;
const sig = (c: string, k: string) => `COMPETENCE=${c};CONTENT_CATEGORY=${k};MARKS=1`;

function slotCounts(cfg: ExamVerticalConfig): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of cfg.sections[0].objectives) for (const t of o.targets) m.set(constraintSignature(t.constraints), (m.get(constraintSignature(t.constraints)) ?? 0) + t.count);
  return m;
}

/** A human-approved, real, mock-eligible item declaring competence / content. */
let n = 0;
function approved(objectiveId: string, competence: string, content: string, over: Partial<BankItemFacts> = {}): BankItemFacts {
  n += 1;
  return {
    id: `real-${String(n).padStart(3, '0')}`, objectiveId, questionType: 'multiple_choice', difficulty: 3, marks: 1,
    lifecycle: 'ACTIVE', usage: ['PRACTICE', 'FULL_MOCK'], alignment: 'MOCK_READY', provenance: 'STUDYUS_GENERATED', status: 'PUBLISHED', isCurrentVersion: true, retired: false, calibrationConfidence: null,
    contentStatus: 'ORIGINAL', templateFingerprint: null, structureProblems: [], grading: 'DETERMINISTIC', placeholderSignals: [], unresolvedDependencies: [],
    dimensions: { COMPETENCE: competence, CONTENT_CATEGORY: content, MARKS: '1' }, ...over,
  };
}
const OBJ: Record<keyof typeof COMP, string> = { I: 'saber.interpretacion', F: 'saber.formulacion', A: 'saber.argumentacion' };
const MATRIX: Array<[keyof typeof COMP, keyof typeof CONT, number]> = [['I', 'AC', 6], ['I', 'E', 7], ['I', 'G', 4], ['F', 'AC', 9], ['F', 'E', 8], ['F', 'G', 5], ['A', 'AC', 4], ['A', 'E', 4], ['A', 'G', 3]];
const fullBank = () => MATRIX.flatMap(([c, k, count]) => Array.from({ length: count }, () => approved(OBJ[c], COMP[c], CONT[k])));

describe('1-2. Saber 11 Matemáticas V2.1: 50 required slots and the 3x3 StudyUs policy', () => {
  it('50 slots: competence 17 / 22 / 11 (the competence learning objectives), content 19 / 19 / 12', () => {
    const objs = saber.sections[0].objectives.map((o) => [o.code, o.targets.reduce((a, t) => a + t.count, 0)]);
    expect(objs).toEqual([['saber.interpretacion', 17], ['saber.formulacion', 22], ['saber.argumentacion', 11]]);
    const slots = slotCounts(saber);
    const sum = (f: (s: string) => boolean) => [...slots].filter(([s]) => f(s)).reduce((a, [, c]) => a + c, 0);
    expect(sum(() => true)).toBe(50);
    expect([CONT.AC, CONT.E, CONT.G].map((k) => sum((s) => s.includes(`CONTENT_CATEGORY=${k}`)))).toEqual([19, 19, 12]);
    expect(certificationInputFromConfig(saber).positions).toHaveLength(50);
    expect(saber.sections[0].definition!.officialItemCount).toBe(50);
  });
  it('the matrix is exactly 6/7/4, 9/8/5, 4/4/3 -- rows 17/22/11, columns 19/19/12, total 50', () => {
    const slots = slotCounts(saber);
    for (const [c, k, count] of MATRIX) expect(slots.get(sig(COMP[c], CONT[k])), `${c}x${k}`).toBe(count);
    expect(slots.size).toBe(9);
    expect(blueprintAllocationProblems(saber.sections[0].definition!.blueprintSpecification, slots)).toEqual([]);
  });
  it('competence x content is a slot constraint, never a learning objective (still 3 objectives)', () => {
    expect(saber.sections[0].objectives).toHaveLength(3);
    expect(saber.sections[0].objectives.every((o) => !/geometr|estad|algebra/i.test(o.code))).toBe(true);
  });
});

describe('3-4. an item satisfies a slot only if EVERY dimension matches', () => {
  const slot: SlotConstraint[] = [{ dimension: 'COMPETENCE', value: COMP.F }, { dimension: 'CONTENT_CATEGORY', value: CONT.G }];
  it('right competence + wrong content = FAIL; right content + wrong competence = FAIL; both = OK', () => {
    expect(constraintMismatches(slot, { COMPETENCE: COMP.F, CONTENT_CATEGORY: CONT.E })).toEqual(['CONTENT_CATEGORY']);
    expect(constraintMismatches(slot, { COMPETENCE: COMP.I, CONTENT_CATEGORY: CONT.G })).toEqual(['COMPETENCE']);
    expect(constraintMismatches(slot, { COMPETENCE: COMP.F })).toEqual(['CONTENT_CATEGORY']);
    expect(constraintMismatches(slot, { COMPETENCE: COMP.F, CONTENT_CATEGORY: CONT.G })).toEqual([]);
  });
  it('in the certification gate: a complete bank with ONE item in the wrong content cannot fill that slot', () => {
    const bank = fullBank();
    const i = bank.findIndex((b) => b.dimensions!.CONTENT_CATEGORY === CONT.G && b.dimensions!.COMPETENCE === COMP.F);
    bank[i] = { ...bank[i], dimensions: { ...bank[i].dimensions, CONTENT_CATEGORY: CONT.E } };
    const r = certifyBlueprint({ ...certificationInputFromConfig(saber), items: bank }, 'CERTIFIED');
    expect(r.verdict).toBe('FAIL');
    expect(r.components[0].missing).toEqual([expect.objectContaining({ objectiveCode: 'saber.formulacion', count: 1, constraints: expect.arrayContaining([`CONTENT_CATEGORY=${CONT.G}`]) })]);
  });
  it('the same holds for runtime assembly (no fallback to the competence alone)', () => {
    const pos: FormPosition = { index: 0, blueprintObjectiveTargetId: 't', assessmentComponentId: 'c', learningObjectiveId: 'lo', questionType: null, difficultyRange: null, constraints: slot };
    const pool = (content: string): PoolItem => ({ id: content, learningObjectiveId: 'lo', questionType: 'multiple_choice', difficulty: 3, difficultyIndex: 1, marks: 1, templateFingerprint: null, semanticFingerprint: null, stimulusKey: null, contentOrigin: 'GENERATED', dimensions: { COMPETENCE: COMP.F, CONTENT_CATEGORY: content } });
    const usage = { approvedItemIds: new Set<string>(), templateFingerprints: new Set<string>() };
    expect(assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions: [pos], pool: [pool(CONT.E)], usage, officialMarksByComponent: {}, officialItemsByComponent: {} }).slots[0].approvedItemId).toBeNull();
    expect(assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions: [pos], pool: [pool(CONT.G)], usage, officialMarksByComponent: {}, officialItemsByComponent: {} }).slots[0].approvedItemId).toBe(CONT.G);
  });
});

describe('5-6. eligibility: unreviewed and fixture items never fill a certified slot', () => {
  it('a generated item not yet human-approved (PILOT) is NOT_HUMAN_APPROVED', () => {
    expect(itemBlockers(approved(OBJ.F, COMP.F, CONT.G, { lifecycle: 'PILOT', usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }), 'CERTIFIED')).toEqual(expect.arrayContaining(['NOT_HUMAN_APPROVED']));
  });
  it('a fixture is DEV_FIXTURE, whatever its tags', () => {
    expect(itemBlockers(approved(OBJ.F, COMP.F, CONT.G, { provenance: 'FIXTURE', contentStatus: 'DEV_CERT_FIXTURE' }), 'CERTIFIED')).toContain('DEV_FIXTURE');
  });
  it('the bank of the configuration itself (15 fixtures) certifies nothing; the engine cannot assemble 50 from them either', () => {
    const a = assessExam(certificationInputFromConfig(saber));
    expect(a).toMatchObject({ contentReadiness: 'NONE', mockReady: false, engineCapability: 'NONE' });
    expect(a.certified!.ineligibleReasons.DEV_FIXTURE).toBe(saber.items.length);
  });
});

describe('7. provenance: StudyUs policy is never presented as official Icfes content', () => {
  const spec = saber.sections[0].definition!.blueprintSpecification!;
  it('margins are OFFICIAL_DERIVED with Icfes sources; the 3x3 cells and the difficulty / timing / scoring targets are STUDYUS_POLICY without sources', () => {
    expect(spec.margins!.map((m) => [m.dimension, m.provenance, m.sourceKeys.length > 0])).toEqual([['COMPETENCE', 'OFFICIAL_DERIVED', true], ['CONTENT_CATEGORY', 'OFFICIAL_DERIVED', true]]);
    expect(spec.cells).toMatchObject({ provenance: 'STUDYUS_POLICY', sourceKeys: [] });
    expect(spec.cells!.note).toMatch(/not an official Icfes/);
    expect(spec.policies!.map((p) => [p.key, p.provenance, p.sourceKeys.length])).toEqual([['difficulty', 'STUDYUS_POLICY', 0], ['timing', 'STUDYUS_POLICY', 0], ['scoring', 'STUDYUS_POLICY', 0]]);
    expect(spec.policies!.find((p) => p.key === 'difficulty')!.note).toMatch(/never Icfes performance levels/);
  });
  it('the schema refuses a policy that cites an official source, and an official allocation without one', () => {
    const def = saber.sections[0].definition!;
    const withSpec = (bs: unknown) => ComponentDefinitionSchema.safeParse({ ...def, blueprintSpecification: bs }).success;
    expect(withSpec({ ...spec, cells: { ...spec.cells, sourceKeys: ['icfes-guia-saber11-2026'] } })).toBe(false);
    expect(withSpec({ ...spec, margins: [{ ...spec.margins![0], sourceKeys: [] }] })).toBe(false);
    expect(withSpec(spec)).toBe(true);
  });
  it('no difficulty slot constraint yet: the StudyUs difficulty target waits for the human review', () => {
    expect(saber.sections[0].objectives.flatMap((o) => o.targets).every((t) => t.difficultyMin === undefined && t.difficultyMax === undefined)).toBe(true);
  });
});

describe('8. every existing blueprint stays compatible', () => {
  const parsed = allV2Configs().map((c) => parseExamVerticalConfig(c)).filter((p): p is { ok: true; config: ExamVerticalConfig } => p.ok);
  it('every V2 configuration still parses, and only Saber declares slot constraints / a bank source / an allocation', () => {
    expect(parsed).toHaveLength(allV2Configs().length);
    const others = parsed.filter((p) => p.config.key !== 'v2.saber11.math');
    for (const { config } of others) {
      const json = JSON.stringify(config);
      expect(json, config.key).not.toMatch(/"constraints"|"bankSource"|"margins"|"cells"/);
    }
  });
  it('cell keys without constraints are byte-identical to before; constrained slots get their own cells', () => {
    expect(cellKeyOf('math', 'saber.formulacion', null, null, null, null)).toBe('math|saber.formulacion|*|*-*|*');
    expect(cellKeyOf('math', 'saber.formulacion', null, null, null, null, [])).toBe('math|saber.formulacion|*|*-*|*');
    const targets = certificationInputFromConfig(saber).positions.map((p, i) => ({ id: `t${i}`, learningObjectiveId: p.objectiveId, objectiveCode: p.objectiveId, assessmentComponentId: 'c', questionType: p.questionType, difficultyMin: null, difficultyMax: null, commandTerm: null, constraints: p.constraints }));
    const cells = deriveBlueprintCells(targets, [{ id: 'c', sectionKey: 'math', name: 'Matemáticas', order: 0, officialItemCount: 50, maxMarks: null, simulationCapable: true }]);
    expect(cells).toHaveLength(9);
    expect(cells.map((c) => c.reducedPositions).sort((a, b) => a - b)).toEqual([3, 4, 4, 4, 5, 6, 7, 8, 9]);
  });
  it('the persisted constraint column is optional for readers and writers (schema-tolerant)', () => {
    expect(readFileSync(join(ROOT, 'src/lib/assessment/blueprint.service.ts'), 'utf8')).toMatch(/constraintsFromJson\(r\.constraints \?\? \[\]\)/);
    expect(readFileSync(join(ROOT, 'src/lib/exam-core/apply-vertical-config.service.ts'), 'utf8')).toMatch(/if \(constraints\.length\) \{/);
    expect(readFileSync(join(ROOT, 'database/migrations/20261102_1000_blueprint_slot_constraints.sql'), 'utf8')).toMatch(/ADD COLUMN IF NOT EXISTS constraints jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  });
});

describe('9. certification never passes with fewer than all required cells', () => {
  it('50 human-approved real items in the right cells: PASS (the gate is reachable, not lowered)', () => {
    const r = assessExam({ ...certificationInputFromConfig(saber), items: fullBank() });
    expect(r).toMatchObject({ mockReady: true, contentReadiness: 'ONE_MOCK_READY' });
  });
  it('one cell short (49 items) -> FAIL', () => {
    const r = certifyBlueprint({ ...certificationInputFromConfig(saber), items: fullBank().slice(0, 49) }, 'CERTIFIED');
    expect(r.verdict).toBe('FAIL');
    expect(r.gates.find((g) => g.gate === 2)!.pass).toBe(false);
  });
  it('a blueprint missing a declared cell is invalid as configuration AND fails the gate', () => {
    const broken = structuredClone(SABER11_MATH_V2) as any;
    broken.version.label = 'broken';
    broken.sections[0].objectives[2].targets = broken.sections[0].objectives[2].targets.slice(0, 2); // drop Argumentación x Geometría (3 slots)
    const p = parseExamVerticalConfig(broken);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.issues.join(' ')).toMatch(/BLUEPRINT_CELL_MISMATCH COMPETENCE=ARGUMENTACION;CONTENT_CATEGORY=GEOMETRIA;MARKS=1: declared 3, slots 0/);
    const input = certificationInputFromConfig(saber);
    const g1 = certifyBlueprint({ ...input, positions: input.positions.filter((x) => !(x.objectiveId === OBJ.A && constraintSignature(x.constraints).includes(CONT.G))), items: fullBank() }, 'CERTIFIED').gates.find((g) => g.gate === 1)!;
    expect(g1.pass).toBe(false);
    expect(g1.detail.join(' ')).toMatch(/BLUEPRINT_BELOW_OFFICIAL_LENGTH \(47\/50 items\).*BLUEPRINT_CELL_MISMATCH/);
  });
});

describe('10. slot requirements are deterministic', () => {
  it('keys, signatures and positions are stable and order-independent', () => {
    expect(dimensionKey('Formulación y ejecución')).toBe('FORMULACION_Y_EJECUCION');
    expect(dimensionKey('Álgebra y cálculo')).toBe('ALGEBRA_Y_CALCULO');
    const a: SlotConstraint[] = [{ dimension: 'CONTENT_CATEGORY', value: 'GEOMETRIA' }, { dimension: 'COMPETENCE', value: 'ARGUMENTACION' }];
    expect(normalizeConstraints(a)).toEqual(normalizeConstraints([...a].reverse()));
    expect(() => normalizeConstraints([...a, { dimension: 'COMPETENCE', value: 'OTRA' }])).toThrow(/CONTRADICTORY_SLOT_CONSTRAINT:COMPETENCE/);
    expect(JSON.stringify(certificationInputFromConfig(saber).positions)).toBe(JSON.stringify(certificationInputFromConfig(saber).positions));
  });
  it('item dimensions come from the item\'s own tags (pilot items: label -> key)', () => {
    expect(itemDimensionValues({ tags: { competency: 'Formulación y ejecución', contentCategory: 'Geometría' }, marks: 1 })).toEqual({ COMPETENCE: COMP.F, CONTENT_CATEGORY: CONT.G, MARKS: '1' });
  });
});
