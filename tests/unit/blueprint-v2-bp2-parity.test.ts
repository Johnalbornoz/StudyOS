/**
 * Blueprint Engine V2 / BP-2 -- the 88 existing configurations as blueprint
 * variants. BP-0 blueprint facts and BP-1 definitions are unchanged; the
 * whole catalog validates; no reduced form is a FULL_MOCK; resolution never
 * selects silently between several candidates.
 */
import { describe, it, expect } from 'vitest';
import { compileBlueprint, compileBlueprintVariants, compileExam, resolveBlueprint, validateBlueprintCatalog, BLUEPRINT_PURPOSES, MOCK_ORDINAL_PATTERN, type BlueprintVariantV2, type CatalogExam } from '@/lib/exam-core/blueprint-v2';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';

const CONFIGS = [...allV2Configs(), ...DEV_CERT_VERTICALS];
const compiled = CONFIGS.map((cfg) => ({ cfg, key: (cfg as { key: string }).key, r: compileBlueprintVariants(cfg), exam: compileExam(cfg) }));
const all: BlueprintVariantV2[] = compiled.flatMap((c) => c.r.variants);

describe('88 configurations as blueprint variants', () => {
  it.each(compiled.map((c) => [c.key, c] as const))('%s', (_k, c) => {
    expect(c.r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    // BP-1 definition unchanged; BP-0 blueprint unchanged for the whole-assessment structure
    expect(c.r.examDefinition!.fingerprint).toBe(c.exam.examDefinition!.fingerprint);
    const bp0 = compileBlueprint(c.cfg).blueprint!;
    for (const v of c.r.variants.filter((x) => x.identity.scope.type === 'ENTIRE_ASSESSMENT' && x.identity.purpose !== 'REDUCED_MOCK' && x.identity.purpose !== 'FULL_MOCK')) expect(v.blueprint.fingerprint).toBe(bp0.fingerprint);
    // nothing invented
    for (const v of c.r.variants) {
      expect(v.contentReadiness).toEqual({ status: 'NOT_EVALUATED', owner: 'QUESTION_BANK' });
      expect(v.identity.variant).toEqual({ key: 'standard', dimension: 'STANDARD', reason: null });
      expect(MOCK_ORDINAL_PATTERN.test(v.identityKey)).toBe(false);
      expect(v.origin.type).toBe('COMPILED_FROM_CONFIG');
    }
    expect(c.r.variants.some((v) => v.identity.purpose === 'FULL_MOCK')).toBe(false); // no current configuration is at official length
  });

  it('the whole catalog validates (no duplicate identities, no overlaps)', () => {
    const exams = new Map<string, CatalogExam>(compiled.map((c) => [c.key, { definition: c.exam.examDefinition!, blueprint: c.exam.blueprint! }]));
    const v = validateBlueprintCatalog(all, { exams });
    expect(v.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    expect(v.issues.filter((i) => i.code === 'SPECIFICATION_UNRESOLVED')).toHaveLength(all.filter((x) => x.identity.specificationKey === null).length);
  });

  it('never selects silently: a selection always means exactly one compatible candidate', () => {
    for (const c of compiled) {
      const spec = c.exam.examDefinition!.specification.key;
      for (const purpose of BLUEPRINT_PURPOSES) {
        const r = resolveBlueprint({ variants: all }, { examDefinitionKey: c.key, specificationKey: spec.status === 'STATED' ? spec.value : null, purpose });
        const compatible = r.candidates.filter((x) => x.compatible).length;
        if (r.selected) expect(compatible).toBe(1);
        else expect(['NO_MATCH', 'MISSING_CONTEXT', 'AMBIGUOUS']).toContain(r.status);
        if (spec.status !== 'STATED') expect(r).toMatchObject({ status: 'MISSING_CONTEXT', missingInformation: ['specification'] });
      }
    }
  });
});
