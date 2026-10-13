/**
 * QF V5.1 -- the systems StudyUs has registered so far (data, pure).
 *
 * This file is the ONLY place that names today's systems, and it names them the way any later system is added:
 * `registerSystem`, `registerVersion`, `registerNode`, `registerAdapter`. Nothing else in this directory refers to
 * one of them. A new system is a new block of registrations -- here for a system StudyUs ships, in a database for
 * one an operator adds, in a test for a test system -- and no other file changes.
 *
 * What is honest about these records:
 *   - every version is "the rules as the repository records them": no official version binding is claimed here
 *     beyond what the EA-1 profile itself records, and effective dates are left open (null) rather than invented;
 *   - AICE is registered as a QUALIFICATION that belongs to the Cambridge system (EA-1A, D5): it has no rule
 *     profile of its own, only provisional adapters derived from generation profiles;
 *   - every adapter is PROVISIONAL, because no profile is certified.
 */
import { EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES } from '@/lib/assessment-adaptation/system-profiles';
import { adapterConflictsWith, uncoveredGenerationProfileAdapters, type AdapterConflict, type AssessmentAdapter } from './assessment-adapter';
import { ACTIVE_CONFIGURATION_REBINDINGS, retiredConfigurationsReferencedBy } from './active-configuration-binding';
import { createAssessmentSystemRegistry, type AssessmentSystemRegistry, type AssessmentSystemType } from './assessment-system-registry';

const RECORDED_BY = 'studyus:registered-systems';
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface SystemSeed { systemId: string; displayName: string; organization: string; region: string | null; systemType: AssessmentSystemType; metadata: Record<string, string | string[]> }
/** The registrations. Order is irrelevant; each row is independent of the others. */
const SYSTEMS: readonly SystemSeed[] = [
  { systemId: 'PAA', displayName: 'Prueba de Aptitud Académica', organization: 'College Board (Puerto Rico y América Latina)', region: 'LATAM', systemType: 'EXAM', metadata: { legacyExamFamilyCodes: ['PAA'] } },
  { systemId: 'PISA', displayName: 'Programme for International Student Assessment', organization: 'OECD', region: null, systemType: 'EXAM', metadata: { legacyExamFamilyCodes: ['PISA'], assessmentSemantics: 'COMPETENCY_BENCHMARK' } },
  { systemId: 'IB', displayName: 'International Baccalaureate Diploma Programme', organization: 'International Baccalaureate Organization', region: null, systemType: 'HYBRID', metadata: { legacyExamFamilyCodes: ['IB'] } },
  { systemId: 'CAMBRIDGE', displayName: 'Cambridge International', organization: 'Cambridge University Press & Assessment', region: null, systemType: 'HYBRID', metadata: { legacyExamFamilyCodes: ['CAMBRIDGE'] } },
  { systemId: 'AICE', displayName: 'Cambridge AICE Diploma', organization: 'Cambridge University Press & Assessment', region: null, systemType: 'QUALIFICATION', metadata: { legacyExamFamilyCodes: ['AICE'], qualificationOfSystem: 'CAMBRIDGE' } },
  { systemId: 'ICFES', displayName: 'Saber 11', organization: 'Instituto Colombiano para la Evaluación de la Educación (ICFES)', region: 'CO', systemType: 'EXAM', metadata: { legacyExamFamilyCodes: ['ICFES'] } },
];
/** V5 generation profile -> the EA-1 component that is the SAME component. Only real identities are listed. */
export const GENERATION_PROFILE_COMPONENT: Readonly<Record<string, string>> = {
  'PAA.MATEMATICAS': 'PAA.MATEMATICAS',
  'IB.MATH_AA.HL.P1': 'IB.MATH_AA_HL.P1',
  'IB.MATH_AA.HL.P2': 'IB.MATH_AA_HL.P2',
  'PISA.MATHEMATICS': 'PISA.MATHEMATICS',
  'ICFES.SABER11.MATEMATICAS': 'ICFES.SABER11_MATEMATICAS',
};

/** The one version registered for a system that has no EA-1 profile of its own. */
const UNPROFILED_VERSION = 'repository-recorded';

function build(): AssessmentSystemRegistry {
  // an adapter bound to a retired configuration cannot be registered here
  const registry = createAssessmentSystemRegistry({ retiredConfigurationsOf: retiredConfigurationsReferencedBy });
  // the pair V5.1 registers for a component: the EA-1 profile, or its rebinding where that profile cites a retired configuration
  const pairOf = (c: (typeof EA1_COMPONENT_PROFILES)[number]) => ACTIVE_CONFIGURATION_REBINDINGS[c.componentId]?.() ?? (() => { const system = EA1_SYSTEM_PROFILES.find((p) => p.profileId === c.systemProfileId); return system ? { system, component: c } : null; })();
  const must = <T>(r: { ok: true; value: T } | { ok: false; code: string; detail: string }): T => { if (!r.ok) throw new Error(`REGISTERED_SYSTEMS_INVALID: ${r.code} ${r.detail}`); return r.value; };
  const provenance = { basis: 'STUDYUS_POLICY' as const, sources: ['src/lib/assessment-adaptation/system-profiles.ts', 'src/lib/assessment-instance/active-configuration-binding.ts'], recordedBy: RECORDED_BY };
  const versionOf = new Map<string, string>();
  for (const s of SYSTEMS) {
    must(registry.registerSystem({ v: 1, ...s, lifecycle: 'ACTIVE', provenance }));
    // the version of a system is the version of the rules V5.1 actually registers for it
    const profile = EA1_COMPONENT_PROFILES.filter((c) => c.systemProfileId === s.systemId).map((c) => pairOf(c)?.system).find(Boolean) ?? EA1_SYSTEM_PROFILES.find((p) => p.profileId === s.systemId);
    const versionId = profile ? slug(profile.version) : UNPROFILED_VERSION;
    must(registry.registerVersion({ v: 1, systemId: s.systemId, versionId, label: profile ? `Rules as recorded in the repository (profile ${profile.version})` : 'As recorded in the repository; no rule profile yet', lifecycle: 'ACTIVE', effectiveFrom: null, effectiveTo: null, provenance }));
    versionOf.set(s.systemId, versionId);
  }
  const component = (adapterId: string, displayName: string): string => {
    const systemId = adapterId.split('.')[0];
    const versionId = versionOf.get(systemId);
    if (!versionId) throw new Error(`REGISTERED_SYSTEMS_INVALID: ${adapterId} belongs to no registered system`);
    must(registry.registerNode({ v: 1, nodeId: adapterId, systemId, versionId, kind: 'COMPONENT', parentNodeId: null, code: adapterId.slice(systemId.length + 1), displayName }));
    return versionId;
  };
  for (const c of EA1_COMPONENT_PROFILES) {
    const pair = pairOf(c);
    if (!pair) continue;
    must(registry.registerAdapter({ versionId: component(c.componentId, c.displayName), definition: { kind: 'EA1_PROFILE_PAIR', system: pair.system, component: pair.component } }));
  }
  for (const a of uncoveredGenerationProfileAdapters(new Set(Object.keys(GENERATION_PROFILE_COMPONENT)))) must(registry.registerAdapter({ versionId: component(a.adapterId, a.component), definition: { kind: 'PROVISIONAL_ADAPTER', adapter: a } }));
  return registry;
}

/** The registry of the systems StudyUs ships. Read-only use: a caller that needs another system builds its own registry. */
export const STUDYUS_ASSESSMENT_REGISTRY: AssessmentSystemRegistry = build();

/** Every adapter StudyUs has, each defined once and each bound to a registered system version. */
export const ASSESSMENT_ADAPTERS: readonly AssessmentAdapter[] = Object.freeze([...STUDYUS_ASSESSMENT_REGISTRY.adapters()]);
export const adapterById = (adapterId: string): AssessmentAdapter | null => STUDYUS_ASSESSMENT_REGISTRY.adapter(adapterId);
/** The adapter a V5 generation profile must consume. Never the profile's own fields when an EA-1 component exists. */
export const adapterForGenerationProfile = (profileId: string): AssessmentAdapter | null => adapterById(GENERATION_PROFILE_COMPONENT[profileId] ?? profileId);
export const adapterConflicts = (): AdapterConflict[] => adapterConflictsWith(adapterById, GENERATION_PROFILE_COMPONENT);
