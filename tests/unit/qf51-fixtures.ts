/**
 * QF V5.1 test fixtures -- a registry of TEST systems built through the public registration calls.
 * Nothing here is certified by anyone: the "certified" profiles are fixtures to exercise the certified path.
 */
import { MATH_POC_APPLICABILITY, PAA_MATEMATICAS_COMPONENT, PAA_SYSTEM_PROFILE, type AssessmentComponentProfile, type AssessmentSystemProfile } from '@/lib/assessment-adaptation';
import { createAssessmentSystemRegistry, type AssessmentSystemRegistry, type AssessmentSystemType, type BlueprintBucketRef } from '@/lib/assessment-instance';

export const FIXTURE_VERSION = 'test-certified';
const PROVENANCE = { basis: 'TEST_FIXTURE' as const, sources: [], recordedBy: 'test-fixture' };
export const certifiedProfile = <T extends { status: string; certification: unknown }>(p: T): T => ({ ...p, status: 'CERTIFIED', certification: { certifiedBy: 'test-fixture', certifiedAt: '2026-10-12T00:00:00Z' } });

/** Registers each pair's system (once), one version, the component node and the adapter. Throws on any refusal. */
export function fixtureRegistry(pairs: readonly { system: AssessmentSystemProfile; component: AssessmentComponentProfile }[], into: AssessmentSystemRegistry = createAssessmentSystemRegistry()): AssessmentSystemRegistry {
  const must = (r: { ok: boolean; code?: string; detail?: string }) => { if (!r.ok) throw new Error(`fixture registry: ${r.code} ${r.detail}`); };
  for (const { system, component } of pairs) {
    if (!into.system(system.profileId)) {
      must(into.registerSystem({ v: 1, systemId: system.profileId, displayName: system.displayName, organization: 'test fixture', region: null, systemType: 'EXAM', lifecycle: 'ACTIVE', metadata: {}, provenance: PROVENANCE }));
      must(into.registerVersion({ v: 1, systemId: system.profileId, versionId: FIXTURE_VERSION, label: 'Test fixture version', lifecycle: 'ACTIVE', effectiveFrom: null, effectiveTo: null, provenance: PROVENANCE }));
    }
    must(into.registerNode({ v: 1, nodeId: component.componentId, systemId: system.profileId, versionId: FIXTURE_VERSION, kind: 'COMPONENT', parentNodeId: null, code: component.componentId.slice(system.profileId.length + 1), displayName: component.displayName }));
    must(into.registerAdapter({ versionId: FIXTURE_VERSION, definition: { kind: 'EA1_PROFILE_PAIR', system, component } }));
  }
  return into;
}

/**
 * TEST_NEW_SYSTEM: a system no file under src/ knows, with NO code in the legacy exam-family taxonomy
 * (`examFamilyCode: null`), registered as the given kind of system. Its rules are a one-mark, answer-only paper.
 */
export function testNewSystem(systemType: AssessmentSystemType) {
  const SYSTEM_ID = 'TEST_NEW_SYSTEM';
  const COMPONENT_ID = 'TEST_NEW_SYSTEM.MATH.PAPER_A';
  const certification = { certifiedBy: 'test-fixture', certifiedAt: '2026-10-12T00:00:00Z' };
  const rule = (prefix: string, r: { ruleId: string; value: unknown }) => ({ ruleId: `${prefix}.${r.ruleId.split('.').slice(1).join('.')}`, value: r.value, authority: { kind: 'STUDYUS_POLICY' as const, provisional: true, assumption: 'Rule of a system that exists only in a test.' } });
  const system = { ...PAA_SYSTEM_PROFILE, profileId: SYSTEM_ID, version: '1.0.0-test', displayName: 'Test New System', examFamilyCode: null, status: 'CERTIFIED', certification, specification: { basis: 'STUDYUS_POLICY_ONLY', records: [], note: 'A system registered by a test.' }, rules: Object.fromEntries(Object.entries(PAA_SYSTEM_PROFILE.rules).map(([k, r]) => [k, rule('tns', r as { ruleId: string; value: unknown })])) } as unknown as AssessmentSystemProfile;
  const component = { ...PAA_MATEMATICAS_COMPONENT, componentId: COMPONENT_ID, version: '1.0.0-test', systemProfileId: SYSTEM_ID, displayName: 'Test New System — Paper A', localSubject: 'Mathematics', status: 'CERTIFIED', certification, specification: { basis: 'STUDYUS_POLICY_ONLY', records: [], note: 'A component registered by a test.' }, versionBinding: null, semanticComponentKey: null,
    overrides: { responseFormats: rule('tns.paper-a', { ruleId: 'x.response-formats', value: ['NUMERIC_ENTRY'] }), calculatorPolicy: rule('tns.paper-a', { ruleId: 'x.calculator', value: { allowed: ['NONE'] } }) } } as unknown as AssessmentComponentProfile;
  const registry = createAssessmentSystemRegistry();
  const must = (r: { ok: boolean; code?: string; detail?: string }) => { if (!r.ok) throw new Error(`testNewSystem: ${r.code} ${r.detail}`); };
  must(registry.registerSystem({ v: 1, systemId: SYSTEM_ID, displayName: 'Test New System', organization: 'test', region: null, systemType, lifecycle: 'ACTIVE', metadata: {}, provenance: PROVENANCE }));
  must(registry.registerVersion({ v: 1, systemId: SYSTEM_ID, versionId: 'v1', label: 'Version 1', lifecycle: 'ACTIVE', effectiveFrom: null, effectiveTo: null, provenance: PROVENANCE }));
  must(registry.registerNode({ v: 1, nodeId: COMPONENT_ID, systemId: SYSTEM_ID, versionId: 'v1', kind: 'COMPONENT', parentNodeId: null, code: 'MATH.PAPER_A', displayName: 'Paper A' }));
  must(registry.registerAdapter({ versionId: 'v1', definition: { kind: 'EA1_PROFILE_PAIR', system, component } }));
  const conceptRecord = { ...MATH_POC_APPLICABILITY.find((r) => r.concept.stableId === 'math.alg.quadratics' && r.scope.systemProfileId === 'IB')!, scope: { systemProfileId: SYSTEM_ID, subject: 'Mathematics', componentId: COMPONENT_ID } };
  const bucket: BlueprintBucketRef = { bucketId: `test.tns/${COMPONENT_ID}/tns.quadratics#0`, configKey: 'test.tns', sectionKey: COMPONENT_ID, adapterId: COMPONENT_ID, objectiveCode: 'tns.quadratics', primaryConceptStableIds: ['math.alg.quadratics'], responseFormat: null, blueprintClass: 'FULL' };
  return { SYSTEM_ID, COMPONENT_ID, system, component, registry, adapter: registry.adapter(COMPONENT_ID)!, register: [...MATH_POC_APPLICABILITY, conceptRecord], bucket };
}
