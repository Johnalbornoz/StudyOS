/**
 * QF V5.1 -- the ONE assessment adapter: how a system / component expresses a construct (pure, no IO).
 *
 * The authoritative adapter definition is the EA-1 pair AssessmentSystemProfile + AssessmentComponentProfile,
 * read through the discipline policy. This module adds no rule of its own: `adapterOfComponent` is a VIEW of the
 * resolved profile in the twelve dimensions the product requirement names.
 *
 * V5's QuestionGenerationProfile carries adapter-shaped fields of its own (formats, command terms, marks,
 * calculator, context, difficulty). They are NOT a second authority:
 *   - where an EA-1 component profile exists for the same component (registered data: `GENERATION_PROFILE_COMPONENT`), the adapter
 *     is the EA-1 one and V5's fields are only compared against it (`adapterConflicts`);
 *   - where none exists yet, `adapterOfGenerationProfile` exposes V5's fields through this same contract, marked
 *     PROVISIONAL and `source: 'V5_GENERATION_PROFILE'`. A provisional adapter never feeds Student delivery.
 * Either way a consumer asks for the adapter; it never reads the fields from a generation profile.
 *
 * WHICH SYSTEM. An adapter is the adapter of one REGISTERED assessment system version. The functions here build
 * the view of the rules; the Assessment System Registry (`assessment-system-registry.ts`) binds a view to a
 * registered system and version, and that binding is the only way an adapter gets a `systemVersionId`. A view that
 * was never registered has none, and the composer and the renderer refuse it. Nothing in this module lists systems.
 */
import { resolveProfile, type AssessmentComponentProfile, type AssessmentSystemProfile } from '@/lib/assessment-adaptation/assessment-system-profile';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { GENERATION_PROFILES, type QuestionGenerationProfile } from '@/lib/exam-core/question-bank/production/v5/generation-profile';

export const ASSESSMENT_ADAPTER_CONTRACT_VERSION = 1 as const;
export const ADAPTER_STATUSES = ['PROVISIONAL', 'CERTIFIED'] as const;
export type AdapterStatus = (typeof ADAPTER_STATUSES)[number];
export const ADAPTER_SOURCES = ['EA1_COMPONENT_PROFILE', 'V5_GENERATION_PROFILE'] as const;
export type AdapterSource = (typeof ADAPTER_SOURCES)[number];

export interface AssessmentAdapter {
  v: typeof ASSESSMENT_ADAPTER_CONTRACT_VERSION;
  /** The component id: `<SYSTEM>.<COMPONENT...>`. Stable across versions; `version` identifies the rules. */
  adapterId: string;
  version: string;
  status: AdapterStatus;
  source: AdapterSource;
  /** The registered assessment system this is an adapter of (the first segment of `adapterId`). */
  systemId: string;
  /** The registered version of that system. null until the registry binds the view: an unbound view is not usable. */
  systemVersionId: string | null;
  /** The code of the system in the legacy exam-family taxonomy, when it has one. A label kept for continuity; nothing resolves through it. */
  examFamily: string | null;
  qualification: string;
  subject: string | null;
  level: string | null;
  component: string;
  responseFormats: readonly string[];
  commandTerms: { use: 'NONE' | 'CONTROLLED_VOCABULARY'; terms: readonly string[] };
  marksRubric: { markStructure: string; rubricStyle: string; constructedMarks: readonly [number, number] | null };
  calculator: readonly string[];
  stimulusContext: { contexts: readonly string[]; stimulus: readonly string[]; contextRule: string | null };
  distractorPolicy: string;
  authenticity: { requirement: string; transfer: string };
  difficultyInterpretation: { referencePopulation: string; drivers: readonly string[] } | null;
}

/** The adapter of one EA-1 component: the resolved rules, viewed. Refused when the pair does not resolve. */
export function adapterOfComponent(system: AssessmentSystemProfile, component: AssessmentComponentProfile): AssessmentAdapter | null {
  const r = resolveProfile(system, component);
  if (!r.ok) return null;
  const rules = r.resolved.rules;
  return {
    v: ASSESSMENT_ADAPTER_CONTRACT_VERSION, adapterId: component.componentId, version: `${system.version}+${component.version}`,
    status: system.status === 'CERTIFIED' && component.status === 'CERTIFIED' ? 'CERTIFIED' : 'PROVISIONAL', source: 'EA1_COMPONENT_PROFILE',
    systemId: system.profileId, systemVersionId: null,
    examFamily: system.examFamilyCode, qualification: system.displayName, subject: component.localSubject, level: null, component: component.displayName,
    responseFormats: rules.responseFormats.value, commandTerms: rules.commandTerms.value,
    marksRubric: { markStructure: rules.markStructure.value, rubricStyle: rules.rubricStyle.value, constructedMarks: null },
    calculator: rules.calculatorPolicy.value.allowed,
    stimulusContext: { contexts: rules.contextExpectations.value.allowed, stimulus: rules.stimulusExpectations.value.allowed, contextRule: null },
    distractorPolicy: MATHEMATICS_ADAPTATION_POLICY.distractors.meaning,
    authenticity: { requirement: rules.authenticityRequirements.value, transfer: rules.transferExpectations.value },
    difficultyInterpretation: null,
  };
}

const V5_CALCULATOR: Record<QuestionGenerationProfile['calculator'], readonly string[]> = { NOT_ALLOWED: ['NONE'], ALLOWED: ['ALLOWED'], REQUIRED: ['GDC_REQUIRED'], NOT_APPLICABLE: [] };

/** V5's adapter-shaped fields, exposed through the adapter contract. Always PROVISIONAL. */
export function adapterOfGenerationProfile(p: QuestionGenerationProfile): AssessmentAdapter {
  return {
    v: ASSESSMENT_ADAPTER_CONTRACT_VERSION, adapterId: p.profileId, version: 'v5-profile-derived', status: 'PROVISIONAL', source: 'V5_GENERATION_PROFILE',
    systemId: p.profileId.split('.')[0], systemVersionId: null,
    examFamily: p.family, qualification: p.qualification, subject: p.subject, level: p.level, component: p.component,
    responseFormats: p.itemFormats, commandTerms: { use: p.commandTermPolicy.required ? 'CONTROLLED_VOCABULARY' : 'NONE', terms: p.commandTermPolicy.allowed },
    marksRubric: { markStructure: p.markPolicy.scoring, rubricStyle: p.markPolicy.scoring, constructedMarks: p.markPolicy.constructedMarks },
    calculator: V5_CALCULATOR[p.calculator], stimulusContext: { contexts: [], stimulus: [], contextRule: `${p.contextPolicy.requirement}: ${p.contextPolicy.rule}` },
    distractorPolicy: p.forbiddenPatterns.filter((f) => /distractor/i.test(f)).join(' ') || 'No distractor rule is stated.',
    authenticity: { requirement: p.contextPolicy.requirement, transfer: 'NOT_STATED' },
    difficultyInterpretation: { referencePopulation: p.difficultyPolicy.referencePopulation, drivers: p.difficultyPolicy.drivers },
  };
}

/** The provisional adapters of the generation profiles that have no EA-1 component yet. Views only: the registry binds them. */
export const uncoveredGenerationProfileAdapters = (covered: ReadonlySet<string>): AssessmentAdapter[] => GENERATION_PROFILES.filter((p) => !covered.has(p.profileId)).map(adapterOfGenerationProfile);
export const adapterMayFeedStudentDelivery = (a: Pick<AssessmentAdapter, 'status' | 'source'> & Partial<Pick<AssessmentAdapter, 'systemVersionId'>>): boolean => a.status === 'CERTIFIED' && a.source === 'EA1_COMPONENT_PROFILE' && a.systemVersionId !== null;

export interface AdapterConflict { profileId: string; adapterId: string; dimension: 'responseFormats' | 'calculator' | 'commandTerms'; adapter: readonly string[]; generationProfile: readonly string[] }
/** Where V5's own fields disagree with the authoritative adapter of the same component. The adapter wins; this is the list to reconcile. */
export function adapterConflictsWith(adapterById: (adapterId: string) => AssessmentAdapter | null, sameComponent: Readonly<Record<string, string>>): AdapterConflict[] {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  return Object.entries(sameComponent).flatMap(([profileId, adapterId]) => {
    const p = GENERATION_PROFILES.find((x) => x.profileId === profileId);
    const a = adapterById(adapterId);
    if (!p || !a) return [];
    const v5 = adapterOfGenerationProfile(p);
    const out: AdapterConflict[] = [];
    if (!same(a.responseFormats, v5.responseFormats)) out.push({ profileId, adapterId, dimension: 'responseFormats', adapter: a.responseFormats, generationProfile: v5.responseFormats });
    if (!same(a.calculator, v5.calculator)) out.push({ profileId, adapterId, dimension: 'calculator', adapter: a.calculator, generationProfile: v5.calculator });
    if (!same(a.commandTerms.terms, v5.commandTerms.terms)) out.push({ profileId, adapterId, dimension: 'commandTerms', adapter: a.commandTerms.terms, generationProfile: v5.commandTerms.terms });
    return out;
  });
}
