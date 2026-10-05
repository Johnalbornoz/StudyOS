/**
 * Exam Platform V2 integration (QB 802d9be + Blueprint BP-3/BP-4A): ONE structural slot-requirement model.
 *
 * The Exam Core contract `src/lib/exam-core/slot-constraints.ts` + `ComponentDefinition.blueprintSpecification`
 * is the only definition of structured slot requirements. Blueprint V2 consumes it (cells, eligibility
 * predicates, allocation with provenance, validation); the Question Bank consumes the same contract to
 * evaluate fulfillment. No second vocabulary exists in Blueprint V2.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import {
  compileBlueprint,
  compileBlueprintVariants,
  compileExam,
  validateBlueprint,
  blueprintFingerprint,
  checkParity,
  structuralFullMockDiagnostic,
  buildShadowCatalog,
  shadowObserveSimulationPlan,
  runtimeTargetsOf,
  runRuntimeShadowParity,
  explainShadowRecord,
  provenance,
  type BlueprintV2,
  type RuntimeShadowRecord,
} from '@/lib/exam-core/blueprint-v2';
import { SLOT_DIMENSIONS, constraintSignature } from '@/lib/exam-core/slot-constraints';
import { SABER11_MATH_V2 } from '@/lib/exam-core/verticals/v2';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';

const saber = compileBlueprint(SABER11_MATH_V2).blueprint!;
const math = saber.components[0];
const reseal = (bp: BlueprintV2, fn: (d: BlueprintV2) => void): BlueprintV2 => {
  const d = structuredClone(bp);
  fn(d);
  return { ...d, fingerprint: blueprintFingerprint(d) };
};

describe('one structural model, owned by the Blueprint contract', () => {
  it('Blueprint V2 declares no slot-dimension vocabulary of its own', () => {
    const dir = path.resolve(__dirname, '../../src/lib/exam-core/blueprint-v2');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/['"]COMPETENCE['"]\s*,\s*['"]CONTENT_CATEGORY['"]/);
    }
    expect(SLOT_DIMENSIONS).toContain('CONTENT_CATEGORY');
  });
});

describe('Saber 11 V2.1 compiled from the shared contract', () => {
  it('50 positions in 9 constraint cells, each requiring competence + content + marks', () => {
    expect(math.plannedPositions).toBe(50);
    expect(math.cells).toHaveLength(9);
    for (const c of math.cells) expect(c.eligibility.constraints!.map((x) => x.dimension)).toEqual(['COMPETENCE', 'CONTENT_CATEGORY', 'MARKS']);
    expect(math.cells.reduce((n, c) => n + c.positions, 0)).toBe(50);
  });
  it('cell keys are exactly the runtime keys (constraint-aware parity with what apply writes)', () => {
    expect(checkParity(SABER11_MATH_V2, saber)).toEqual([]);
    expect(math.cells.every((c) => c.cellKey.endsWith(constraintSignature(c.eligibility.constraints)))).toBe(true);
  });
  it('allocation keeps its provenance: official-derived margins, StudyUs-policy matrix and policies', () => {
    const a = math.allocation!;
    expect(a.margins.map((m) => [m.dimension, m.origin, m.provenance.kind, m.totals])).toEqual([
      ['COMPETENCE', 'OFFICIAL_DERIVED', 'OFFICIAL_PUBLIC', { INTERPRETACION_Y_REPRESENTACION: 17, FORMULACION_Y_EJECUCION: 22, ARGUMENTACION: 11 }],
      ['CONTENT_CATEGORY', 'OFFICIAL_DERIVED', 'OFFICIAL_PUBLIC', { ALGEBRA_Y_CALCULO: 19, ESTADISTICA: 19, GEOMETRIA: 12 }],
    ]);
    expect(a.cells).toMatchObject({ origin: 'STUDYUS_POLICY', provenance: { kind: 'UNKNOWN', authority: 'NONE' } });
    expect(a.cells!.counts.reduce((n, c) => n + c.count, 0)).toBe(50);
    expect(a.policies.map((p) => [p.key, p.origin, p.provenance.authority])).toEqual([['difficulty', 'STUDYUS_POLICY', 'NONE'], ['timing', 'STUDYUS_POLICY', 'NONE'], ['scoring', 'STUDYUS_POLICY', 'NONE']]);
    expect(validateBlueprint(saber).ok).toBe(true);
  });
  it('the validator enforces the allocation and never lets policy become authoritative', () => {
    const moved = reseal(saber, (d) => {
      d.components[0].cells[0].positions += 1;
      d.components[0].cells[1].positions -= 1;
    });
    expect(validateBlueprint(moved).issues.map((i) => i.code)).toContain('ALLOCATION_NOT_REALISED');
    const laundered = reseal(saber, (d) => {
      d.components[0].allocation!.cells!.provenance = provenance('OFFICIAL_PUBLIC', ['icfes-marco-matematicas-saber11']);
    });
    expect(validateBlueprint(laundered).issues.map((i) => i.code)).toContain('POLICY_ALLOCATION_WITH_AUTHORITY');
  });
  it('a full-length structure is a FULL_MOCK variant even though the official timing is unpublished', () => {
    const vs = compileBlueprintVariants(SABER11_MATH_V2).variants;
    const full = vs.find((v) => v.identity.purpose === 'FULL_MOCK')!;
    expect(full.identityKey).toBe('v2.saber11.math|icfes-saber11-math@2026|FULL_MOCK|ENTIRE_ASSESSMENT|standard');
    expect(full.structure.lengthClass).toBe('FULL_LENGTH');
    expect(full.structuralCapability).toEqual({ assemblable: 'YES', fullLength: 'YES', mockable: 'UNKNOWN' });
    expect(vs.some((v) => v.identity.purpose === 'REDUCED_MOCK')).toBe(false);
    const e = compileExam(SABER11_MATH_V2);
    expect(structuralFullMockDiagnostic(e.examDefinition!, e.blueprint!, vs)).toMatchObject({ status: 'STRUCTURAL_FULL_MOCK_SUPPORTED', reasons: [{ code: 'MOCKABILITY_UNKNOWN', componentKey: 'math' }] });
  });
  it('blueprint identity is deterministic', () => {
    expect(compileBlueprint(structuredClone(SABER11_MATH_V2)).blueprint!.fingerprint).toBe(saber.fingerprint);
  });
});

describe('unconstrained configurations are untouched by the contract', () => {
  it('no constraints / allocation keys appear in the other 87 configurations', () => {
    for (const cfg of [...allV2Configs(), ...DEV_CERT_VERTICALS]) {
      if ((cfg as { key: string }).key === 'v2.saber11.math') continue;
      const bp = compileBlueprint(cfg).blueprint!;
      for (const c of bp.components) {
        expect('allocation' in c).toBe(false);
        for (const cell of c.cells) expect('constraints' in cell.eligibility).toBe(false);
      }
    }
  });
});

describe('the runtime shadow carries the constraints of the legacy rows', () => {
  const catalog = buildShadowCatalog([SABER11_MATH_V2]);
  const exam = catalog.exams.get('v2.saber11.math')!;
  const run = async (stripConstraints: boolean) => {
    const { targets, components } = runtimeTargetsOf(SABER11_MATH_V2);
    const rows = stripConstraints ? targets.map(({ constraints: _c, ...t }) => t) : targets;
    const records: RuntimeShadowRecord[] = [];
    await shadowObserveSimulationPlan(
      { examVersionId: 'ev-saber', legacyBlueprintId: 'bp-saber', simulationType: 'FULL_MOCK', components, allTargets: rows },
      {
        env: { EXAM_BLUEPRINT_V2: 'SHADOW' },
        catalog: async () => catalog,
        sink: (r) => records.push(r),
        store: {
          versionIdentity: async () => ({ configKey: 'v2.saber11.math', configFingerprint: exam.configFingerprint }),
          objectiveCodes: async (ids) => new Map(ids.map((id) => [id, id.replace(/^objective:/, '')])),
          commandTerms: async (ids) => new Map(ids.map((id) => [id, id])),
          instancePurpose: async () => null,
        },
      }
    );
    return records[0];
  };
  it('with the constraints: Saber F9 Full Mock MATCHes the FULL_MOCK variant', async () => {
    expect(await run(false)).toMatchObject({ parity_status: 'MATCH', v2_blueprint_identity: 'v2.saber11.math|icfes-saber11-math@2026|FULL_MOCK|ENTIRE_ASSESSMENT|standard' });
  });
  it('a hook that dropped them would be caught as STRUCTURAL_MISMATCH (the parity is constraint-sensitive)', async () => {
    expect((await run(true)).parity_status).toBe('STRUCTURAL_MISMATCH');
  });
});

describe('integration gate: every shadow record is explained', () => {
  it('0 UNEXPLAINED over the applied catalogue', async () => {
    const r = await runRuntimeShadowParity([...allV2Configs(), ...DEV_CERT_VERTICALS]);
    const tally: Record<string, number> = {};
    for (const x of r.records) tally[explainShadowRecord(x)] = (tally[explainShadowRecord(x)] ?? 0) + 1;
    expect(tally).toEqual({
      MATCH: 175,
      'LEGACY_ONLY:STRUCTURAL_FULL_MOCK_UNSUPPORTED': 28,
      'LEGACY_ONLY:REDUCED_FORM_NOT_FULL_MOCK': 13,
      'LEGACY_ONLY:STAGE_MOCK_UNMODELLED': 9,
      'LEGACY_DEFECT:ROUTED_FULL_MOCK_ALL_COMPONENTS': 6,
      'MISSING_CONTEXT:ROUTE_NOT_STORED': 4,
      'MISSING_CONTEXT:SPECIFICATION_UNDECLARED': 47,
    });
  });
});
