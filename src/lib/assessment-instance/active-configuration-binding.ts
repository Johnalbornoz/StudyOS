/**
 * QF V5.1 -- an adapter is bound to the ACTIVE governed configuration, never to a retired one (pure, no IO).
 *
 * A rule profile says where each of its recorded facts was read: a configuration, a section, a framework. When
 * that configuration is superseded, the profile keeps pointing at it and its facts go stale without anything
 * failing. That happened to PISA Mathematics: its EA-1 profile restates `v2.pisa.math`, which is retired; the
 * active `v2.pisa.2022` records a response format the retired one lacks (SHORT_RESPONSE).
 *
 * Two things live here:
 *   - `retiredConfigurationsReferencedBy`: which retired configurations a profile pair still cites. The registry
 *     refuses to register an adapter that cites one.
 *   - the rebinding of PISA Mathematics to `v2.pisa.2022`: the same profile pair with every recorded fact re-read
 *     from the active configuration and re-cited to it. Only recorded facts move; StudyUs's policy rules stay.
 *
 * The EA-1 profile file itself is not edited: earlier recorded runs hash it. The rebound pair is what V5.1 registers.
 */
import type { AssessmentComponentProfile, AssessmentSystemProfile } from '@/lib/assessment-adaptation/assessment-system-profile';
import { CAMBRIDGE_9709_P1_COMPONENT, CAMBRIDGE_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, PISA_SYSTEM_PROFILE } from '@/lib/assessment-adaptation/system-profiles';
import { PISA_2022_V2, RETIRED_V2_CONFIG_KEYS } from '@/lib/exam-core/verticals/v2/index';

/** How a retired configuration is named where a profile cites it: its key, its file / framework stem, its constant. */
export function markersOfRetiredConfiguration(configKey: string): string[] {
  const parts = configKey.split('.').slice(1);
  return [configKey, parts.join('-'), `${parts.join('_').toUpperCase()}_V2`];
}
export const RETIRED_CONFIGURATION_MARKERS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(RETIRED_V2_CONFIG_KEYS.map((k) => [k, markersOfRetiredConfiguration(k)]));

const citesMarker = (text: string, marker: string): boolean => new RegExp(`(^|[^A-Za-z0-9])${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`).test(text);

/** Every place a profile says where a fact was read. */
function citations(profile: { specification: { records: readonly { recordedIn: string; component: string }[] }; versionBinding?: unknown }, rules: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = profile.specification.records.flatMap((r) => [r.recordedIn, r.component]);
  const binding = profile.versionBinding as { targetIdentity?: string; provenance?: { recordedIn?: string } } | null | undefined;
  if (binding) out.push(binding.targetIdentity ?? '', binding.provenance?.recordedIn ?? '');
  for (const rule of Object.values(rules)) {
    const authority = (rule as { authority?: { kind?: string; sources?: readonly { locator: string }[] } } | undefined)?.authority;
    if (authority?.kind === 'OFFICIAL') out.push(...(authority.sources ?? []).map((s) => s.locator));
  }
  return out.filter(Boolean);
}

/** The retired configurations a profile pair still cites. Empty for a pair bound only to active ones. */
export function retiredConfigurationsReferencedBy(pair: { system: AssessmentSystemProfile; component: AssessmentComponentProfile }, markers: Readonly<Record<string, readonly string[]>> = RETIRED_CONFIGURATION_MARKERS): string[] {
  const cited = [...citations(pair.system, pair.system.rules), ...citations(pair.component, pair.component.overrides)];
  return Object.entries(markers).filter(([, ms]) => ms.some((m) => cited.some((c) => citesMarker(c, m)))).map(([key]) => key);
}

// ------------------------------------------------------------------------------------------- PISA Mathematics
export const PISA_ACTIVE_CONFIG_KEY = PISA_2022_V2.key;
const ACTIVE_FILE = 'src/lib/exam-core/verticals/v2/pisa-2022.ts (PISA_2022_V2)';
const ACTIVE_DEF = `${PISA_ACTIVE_CONFIG_KEY} > sections[math] > definition`;
/** Versions of the rebound pair: the same rules as the EA-1 profile versions they replace, re-read from the active configuration. */
export const PISA_REBOUND_SYSTEM_VERSION = '0.2.1-illustrative-pisa2022';
export const PISA_REBOUND_COMPONENT_VERSION = '0.4.1-illustrative-pisa2022';

interface Definition { officialDurationMinutes: number | null; officialItemCount?: number | null; calculatorPolicy: string | null; responseFormats: string[]; distributions: { dimension: string; values: Record<string, string> }[]; sourceKeys: string[] }
const activeMathematics = (): Definition => {
  const section = (PISA_2022_V2.sections as readonly { key: string; definition?: unknown }[]).find((s) => s.key === 'math');
  if (!section?.definition) throw new Error('ACTIVE_CONFIGURATION_INVALID: v2.pisa.2022 has no mathematics definition');
  return section.definition as Definition;
};
/** The four processes of the mathematics framework, as the active configuration words them, in the profile's codes. */
const PROCESS_CODE: readonly [RegExp, string, string][] = [[/formulat/i, 'FORMULATE', 'Formulate'], [/employ/i, 'EMPLOY', 'Employ'], [/interpret/i, 'INTERPRET_EVALUATE', 'Interpret and evaluate'], [/reason/i, 'REASON', 'Reason']];

/**
 * PISA Mathematics, bound to the active configuration. Recorded facts (formats, time, items, calculator, contexts,
 * process weights) are read from `v2.pisa.2022` and cited to it; nothing is restated from the retired record.
 */
export function pisaMathematicsBoundToActiveConfiguration(): { system: AssessmentSystemProfile; component: AssessmentComponentProfile } {
  const def = activeMathematics();
  const official = <V>(ruleId: string, value: V, field: string) => ({ ruleId, value, authority: { kind: 'OFFICIAL' as const, sources: def.sourceKeys.map((sourceKey) => ({ sourceKey, locator: `${ACTIVE_DEF}.${field}` })) } });
  const processes = def.distributions.find((d) => /process/i.test(d.dimension));
  const contexts = def.distributions.find((d) => d.dimension === 'Context');
  if (!processes || !contexts) throw new Error('ACTIVE_CONFIGURATION_INVALID: v2.pisa.2022 mathematics records no process or context distribution');
  const competencies = PROCESS_CODE.map(([re, code, label]) => { const hit = Object.entries(processes.values).find(([k]) => re.test(k)); if (!hit) throw new Error(`ACTIVE_CONFIGURATION_INVALID: no process matches ${code}`); return { code, label, weightPercent: hit[1] }; });
  const framework = PISA_2022_V2.framework as { frameworkKey: string; frameworkVersion: string } | undefined;
  if (!framework) throw new Error('ACTIVE_CONFIGURATION_INVALID: v2.pisa.2022 records no framework');
  const written = def.responseFormats.some((f) => f === 'SHORT_RESPONSE' || f === 'EXTENDED_RESPONSE');
  const system = {
    ...PISA_SYSTEM_PROFILE, version: PISA_REBOUND_SYSTEM_VERSION,
    specification: { ...PISA_SYSTEM_PROFILE.specification, records: [{ recordedIn: ACTIVE_FILE, component: 'The framework as the active configuration records it; mathematics is the domain modelled', sourceKeys: [...def.sourceKeys] }] },
    rules: {
      ...PISA_SYSTEM_PROFILE.rules,
      // the retired record held no written-response format, so the system assumed none was offered; the active one records short response
      responseLength: written
        ? { ruleId: PISA_SYSTEM_PROFILE.rules.responseLength.ruleId, value: { constructedResponse: 'SHORT_WORKING' as const }, authority: { kind: 'STUDYUS_POLICY' as const, provisional: true, assumption: `Follows the active configuration (${PISA_ACTIVE_CONFIG_KEY}), which records a short written response. How long such a response is expected to be is StudyUs's working assumption.` } }
        : PISA_SYSTEM_PROFILE.rules.responseLength,
    },
  } as AssessmentSystemProfile;
  const component = {
    ...PISA_MATHEMATICS_COMPONENT, version: PISA_REBOUND_COMPONENT_VERSION,
    versionBinding: { ...PISA_MATHEMATICS_COMPONENT.versionBinding!, targetIdentity: framework.frameworkKey, version: framework.frameworkVersion, componentKey: 'math', provenance: { kind: 'AUTHORITATIVE_SOURCE' as const, sourceKeys: [...def.sourceKeys], recordedIn: 'PISA_2022_V2.framework.frameworkKey / frameworkVersion / sections[math]' } },
    specification: { ...PISA_MATHEMATICS_COMPONENT.specification, records: [{ recordedIn: ACTIVE_FILE, component: 'sections[math].definition', sourceKeys: [...def.sourceKeys] }] },
    overrides: {
      ...PISA_MATHEMATICS_COMPONENT.overrides,
      responseFormats: official(PISA_MATHEMATICS_COMPONENT.overrides.responseFormats!.ruleId, [...def.responseFormats], 'responseFormats'),
      timePressure: official(PISA_MATHEMATICS_COMPONENT.overrides.timePressure!.ruleId, { officialMinutes: def.officialDurationMinutes, officialItems: def.officialItemCount ?? null, officialMarks: null }, 'officialDurationMinutes / officialItemCount'),
      contextExpectations: official(PISA_MATHEMATICS_COMPONENT.overrides.contextExpectations!.ruleId, { allowed: Object.keys(contexts.values).map((c) => c.toUpperCase()) }, 'distributions[Context]'),
      calculatorPolicy: official(PISA_MATHEMATICS_COMPONENT.overrides.calculatorPolicy!.ruleId, { allowed: [def.calculatorPolicy] }, 'calculatorPolicy'),
      competencyEmphasis: official(PISA_MATHEMATICS_COMPONENT.overrides.competencyEmphasis!.ruleId, competencies, `distributions[${processes.dimension}]`),
    },
  } as unknown as AssessmentComponentProfile;
  return { system, component };
}

// ------------------------------------------------------------------------------- Cambridge 9709 Pure Mathematics 1
/**
 * The command words of the 9709 syllabus for 2026 and 2027, exactly as its command-word table lists them (lower case):
 * section 4 "Details of the assessment" > "Command words", p. 42 of the v4 syllabus (source `cie-9709-syllabus-2026-2027`,
 * src/lib/exam-core/catalog/sources.ts). Provenance, retrieval and document digest:
 * docs/exams/sources/cambridge-9709/CIE_9709_2026_2027_SOURCE_EXTRACT.json. Read from the official document; never
 * inferred from words that appear in questions ("find" and "write down" are not in the table).
 */
export const CIE_9709_COMMAND_WORDS = ['calculate', 'describe', 'determine', 'evaluate', 'explain', 'identify', 'justify', 'show that', 'sketch', 'state', 'verify'] as const;
export const CIE_9709_COMMAND_WORDS_LOCATOR = 'syllabus 9709 (2026-2027, v4) > 4 Details of the assessment > Command words (p. 42)';
export const CAMBRIDGE_REBOUND_SYSTEM_VERSION = '0.3.1-illustrative-cie9709-command-words';
export const CAMBRIDGE_REBOUND_COMPONENT_VERSION = '0.4.1-illustrative-cie9709-command-words';
/**
 * Cambridge 9709 P1 bound to the governed syllabus source. The EA-1 profile recorded the IGCSE 0580 terms as a
 * StudyUs working assumption (so COMMAND_TERMS_SOURCED failed); this pair records the 9709 syllabus's OWN command-word
 * table as an OFFICIAL rule. Every other rule is the EA-1 profile's, unchanged (StudyUs policy stays policy).
 * The EA-1 profile file itself is not edited: earlier recorded runs hash it.
 */
export function cambridge9709P1BoundToGovernedSyllabus(): { system: AssessmentSystemProfile; component: AssessmentComponentProfile } {
  const sources = [{ sourceKey: 'cie-9709-syllabus-2026-2027', locator: CIE_9709_COMMAND_WORDS_LOCATOR }];
  const system = {
    ...CAMBRIDGE_SYSTEM_PROFILE, version: CAMBRIDGE_REBOUND_SYSTEM_VERSION,
    rules: { ...CAMBRIDGE_SYSTEM_PROFILE.rules, commandTerms: { ruleId: CAMBRIDGE_SYSTEM_PROFILE.rules.commandTerms.ruleId, value: { use: 'CONTROLLED_VOCABULARY' as const, terms: [...CIE_9709_COMMAND_WORDS] }, authority: { kind: 'OFFICIAL' as const, sources } } },
  } as AssessmentSystemProfile;
  const component = { ...CAMBRIDGE_9709_P1_COMPONENT, version: CAMBRIDGE_REBOUND_COMPONENT_VERSION } as AssessmentComponentProfile;
  return { system, component };
}

/** Component id -> the pair V5.1 registers instead of the EA-1 pair: bound to the active configuration (PISA) or to the governed official source (Cambridge 9709 P1). */
export const ACTIVE_CONFIGURATION_REBINDINGS: Readonly<Record<string, () => { system: AssessmentSystemProfile; component: AssessmentComponentProfile }>> = {
  [PISA_MATHEMATICS_COMPONENT.componentId]: pisaMathematicsBoundToActiveConfiguration,
  [CAMBRIDGE_9709_P1_COMPONENT.componentId]: cambridge9709P1BoundToGovernedSyllabus,
};
