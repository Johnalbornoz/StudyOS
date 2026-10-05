/**
 * Blueprint Engine V2 / BP-0 -- shadow parity. For every configuration the
 * runtime applies today (80 V2 + 8 V1 DEV-cert), the compiled Blueprint V2
 * carries exactly the components, positions, cells (`deriveBlueprintCells`),
 * component columns and command terms `applyExamVerticalConfig` would write.
 * BP-0 changes no runtime path, so any diff is a compiler defect.
 */
import { describe, it, expect } from 'vitest';
import { compileBlueprint, checkParity, runtimeShapeOf } from '@/lib/exam-core/blueprint-v2';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';
import { verticalFingerprint } from '@/lib/exam-core/apply-vertical-config.service';
import { parseExamVerticalConfig } from '@/lib/exam-core/vertical-config';

const CONFIGS = [...allV2Configs(), ...DEV_CERT_VERTICALS];

describe('compiled Blueprint V2 == runtime shape', () => {
  it('covers 88 configurations', () => {
    expect(allV2Configs()).toHaveLength(80);
    expect(CONFIGS).toHaveLength(88);
  });

  it.each(CONFIGS.map((c) => [(c as { key: string }).key, c] as const))('%s', (_key, cfg) => {
    const r = compileBlueprint(cfg);
    expect(r.blueprint).not.toBeNull();
    expect(checkParity(cfg, r.blueprint!)).toEqual([]);
    // Same fingerprint input as the apply service: the blueprint version tracks the live configuration.
    const parsed = parseExamVerticalConfig(cfg);
    expect(parsed.ok && r.blueprint!.identity.sourceConfigFingerprint).toBe(parsed.ok && verticalFingerprint(parsed.config));
  });

  it('detects a semantic change (sanity check of the parity itself)', () => {
    const r = compileBlueprint(CONFIGS[0]);
    const drifted = structuredClone(r.blueprint!);
    drifted.components[0].cells[0].positions += 1;
    drifted.components[0].plannedPositions += 1;
    expect(checkParity(CONFIGS[0], drifted).map((d) => d.path)).toEqual(expect.arrayContaining(['cells', `components.${drifted.components[0].key}.itemCount`, 'targetRows']));
    expect(runtimeShapeOf(CONFIGS[0]).targetRows).toBe(r.blueprint!.components.reduce((n, c) => n + c.plannedPositions, 0));
  });
});
