/**
 * QF V5.2 -- governance of the objects an instance inherits from: construct core, adapter, blueprint
 * classification, renderer envelope (pure, no IO).
 *
 * Each object is checked against explicit, listed conditions. All met: AUTOMATED_CERTIFIED_PILOT. One not met:
 * REVIEW_REQUIRED, with the condition named. A person's approval of exactly this content, when a record of it is
 * given, makes the object HUMAN_CERTIFIED -- and only then: this module never calls anything human-certified on
 * its own, and an automated result is always reported as automated.
 *
 * Nothing here names an assessment system. An object of a system registered tomorrow is governed by these same
 * functions.
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { resolveApplicability, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';
import { applicabilityThresholdFor } from '../applicability-threshold';
import { retiredConfigurationsReferencedBy } from '../active-configuration-binding';
import { reconcileAdapterDifferences, responseRepresentationsOf, STRUCTURE_CODES_AMONG_FORMATS } from '../adapter-reconciliation';
import type { AdapterConflict } from '../assessment-adapter';
import type { AssessmentSystemRegistry } from '../assessment-system-registry';
import { blueprintGate, classifyBlueprintSection } from '../blueprint-classification';
import { certificationStateOf, type CertificationRecord, type ReviewerQualification } from '../certification';
import { coreContentIntact, coreSemantics } from '../construct-core';
import type { LibraryBlueprint, LibraryEntry } from '../library/catalogue';
import { bandCapacity, PLANNING_BANDS, sweepEnvelope, sweepIsClean } from '../library/parametric';
import { envelopeHashOf, rangesOutsideTheCore, studentBandsOf } from '../renderer-envelope';
import { rightsCategoryOf } from './rights-provenance';

export const GOVERNED_OBJECT_TYPES = ['CONSTRUCT_CORE', 'ASSESSMENT_ADAPTER', 'BLUEPRINT_CLASSIFICATION', 'RENDERER_ENVELOPE'] as const;
export type GovernedObjectType = (typeof GOVERNED_OBJECT_TYPES)[number];
export type GovernanceState = 'AUTOMATED_CERTIFIED_PILOT' | 'HUMAN_CERTIFIED' | 'REVIEW_REQUIRED' | 'REJECTED';
export interface GovernanceCheck { code: string; passed: boolean; detail: string }
export interface GovernanceDecision {
  objectType: GovernedObjectType;
  objectId: string;
  objectVersion: string;
  contentHash: string;
  /** What the listed conditions give, with no person involved. */
  automated: 'AUTOMATED_CERTIFIED_PILOT' | 'REVIEW_REQUIRED' | 'REJECTED';
  /** A recorded human approval of exactly this content, when one was given and is effective. */
  humanApproval: { reviewerId: string; decidedAt: string } | null;
  state: GovernanceState;
  checks: GovernanceCheck[];
  failed: string[];
}
export const governanceEligible = (d: Pick<GovernanceDecision, 'state'>): boolean => d.state === 'AUTOMATED_CERTIFIED_PILOT' || d.state === 'HUMAN_CERTIFIED';

export interface HumanRecords { records: readonly CertificationRecord[]; qualifications: readonly ReviewerQualification[] }
const NO_HUMAN: HumanRecords = { records: [], qualifications: [] };
const check = (code: string, passed: boolean, detail: string): GovernanceCheck => ({ code, passed, detail });

function conclude(objectType: GovernedObjectType, objectId: string, objectVersion: string, contentHash: string, checks: GovernanceCheck[], human: HumanRecords): GovernanceDecision {
  const failed = checks.filter((c) => !c.passed).map((c) => c.code);
  const automated = failed.length === 0 ? 'AUTOMATED_CERTIFIED_PILOT' as const : 'REVIEW_REQUIRED' as const;
  // a human approval counts only for exactly this object at exactly this content, from a reviewer whose scope covered it
  const approval = human.records.filter((r) => r.objectType === objectType && r.objectId === objectId && r.objectVersion === objectVersion)
    .map((r) => certificationStateOf({ objectType, objectId, objectVersion, contentHash, scope: r.scope }, r, human.qualifications)).find((s) => s.certified);
  const humanApproval = approval?.certified ? { reviewerId: approval.record.reviewerId, decidedAt: approval.record.decidedAt } : null;
  // a person's approval does not erase a condition a machine found unmet: the object is then for review, with both facts on the record
  const state: GovernanceState = humanApproval && failed.length === 0 ? 'HUMAN_CERTIFIED' : automated;
  return { objectType, objectId, objectVersion, contentHash, automated, humanApproval, state, checks, failed };
}

// ----------------------------------------------------------------------------------------------- 4A core
export function governCore(entry: Pick<LibraryEntry, 'core' | 'reasoning' | 'challengeMechanisms'>, register: readonly AssessmentApplicabilityRecord[], human: HumanRecords = NO_HUMAN): GovernanceDecision {
  const { core, reasoning } = entry;
  const s = coreSemantics(core);
  const f = core.family;
  const rights = rightsCategoryOf({ origin: 'DETERMINISTIC_RENDER', coreAuthoredByStudyUs: f.provenance.authoredBy === 'STUDYUS', containsCopiedProtectedExpression: f.provenance.containsCopiedProtectedExpression, runRecordPresent: false, basisRecorded: false });
  const assessedSomewhere = register.some((r) => r.concept.stableId === core.primaryConceptStableId && resolveApplicability(register, f.primaryConcepts[0], r.scope, applicabilityThresholdFor(r.scope.systemProfileId)).status === 'ESTABLISHED');
  const allowed = f.responseConstraints.allowedFormats as readonly string[];
  const checks = [
    check('CONTENT_INTACT', coreContentIntact(core), 'the stored contract matches its content hash'),
    check('CANONICAL_CONCEPT_EXISTS', f.primaryConcepts.length === 1 && assessedSomewhere, `${core.primaryConceptStableId}: one primary concept, established as assessed by at least one registered component`),
    check('TARGET_UNDERSTANDING_EXPLICIT', s.targetUnderstanding.trim().length >= 20 && s.observableEvidenceTarget.trim().length >= 20, 'what is observed, and on what'),
    check('REASONING_PATH_EXPLICIT', s.requiredActions.length > 0, `actions: ${s.requiredActions.join(', ')}`),
    check('MINIMUM_SUCCESSFUL_PATH_EXPLICIT', reasoning.minimumSuccessfulPath.length > 0, `${reasoning.minimumSuccessfulPath.length} steps`),
    check('SOLUTION_INVARIANTS_EXPLICIT', s.solutionInvariants !== null && s.constraints.length > 0 && s.validSolutionRules.length > 0, 'relationships, constraints and solution rules'),
    check('MISCONCEPTION_MODELS_EXPLICIT', s.misconceptionModels.length >= 2, `${s.misconceptionModels.length} models`),
    check('SHORTCUT_CONSTRAINTS_EXPLICIT', core.shortcutConstraints.length > 0, `${core.shortcutConstraints.length} constraints`),
    // a bypass the core itself leaves open is a construct question for a person, not a property a machine may wave through
    check('NO_OPEN_BYPASS', core.shortcutConstraints.every((c) => c.instanceRule !== null || c.excludedFormats.length > 0), core.shortcutConstraints.filter((c) => c.instanceRule === null && c.excludedFormats.length === 0).map((c) => c.id).join(', ') || 'every bypass is closed by a rule or an excluded format'),
    check('REPRESENTATION_REQUIREMENTS_EXPLICIT', allowed.length > 0 && typeof f.responseConstraints.stimulusNeed === 'string', `formats ${allowed.join(', ')}; stimulus ${f.responseConstraints.stimulusNeed}`),
    check('DIFFICULTY_MECHANISM_EXPLICIT', s.difficultyLevers.length > 0 && entry.challengeMechanisms.length > 0, `levers ${s.difficultyLevers.map((l) => l.lever).join(', ')}; hardest band: ${entry.challengeMechanisms.join(', ') || 'no mechanism named'}`),
    check('PROVENANCE_EXPLICIT', rights.established, rights.basis),
    // a method the construct requires must be observable; a construct that requires none contradicts nothing
    check('NO_CONSTRUCT_CONTRADICTION', reasoning.requiredObservableMethod === null && !core.shortcutConstraints.some((c) => c.excludedFormats.some((x) => allowed.includes(x))), 'no required method that an answer-only response cannot show; no format both allowed and excluded'),
  ];
  return conclude('CONSTRUCT_CORE', core.constructFamilyId, core.familyVersion, core.contentHash, checks, human);
}

// ---------------------------------------------------------------------------------------------- 4B adapter
const COHERENT_MARKS: Readonly<Record<string, readonly string[]>> = { ONE_MARK_PER_ITEM: ['KEY_ONLY'], MULTI_MARK_PARTS: ['METHOD_AND_ACCURACY'], CODED_CREDIT: ['CODED_CREDIT_LEVELS'] };
export function governAdapter(adapterId: string, registry: AssessmentSystemRegistry, conflicts: readonly AdapterConflict[], human: HumanRecords = NO_HUMAN): GovernanceDecision {
  const adapter = registry.adapter(adapterId);
  const pair = registry.profilePairOf(adapterId);
  if (!adapter) return conclude('ASSESSMENT_ADAPTER', adapterId, 'unregistered', sha256OfCanonicalJson(adapterId), [check('ADAPTER_REGISTERED', false, 'no adapter of that id is registered')], human);
  const hash = sha256OfCanonicalJson(pair ?? adapter);
  if (!pair) return conclude('ASSESSMENT_ADAPTER', adapterId, adapter.version, hash, [check('GOVERNED_RULE_PROFILE', false, `${adapter.source}: derived from a generation profile; no governed rule profile exists for it`)], human);
  const system = registry.system(adapter.systemId);
  const version = adapter.systemVersionId ? registry.version(adapter.systemId, adapter.systemVersionId) : null;
  const rules = Object.entries({ ...pair.system.rules, ...pair.component.overrides } as Record<string, { ruleId: string; authority: { kind: string; provisional?: boolean; assumption?: string; sources?: readonly unknown[] } }>);
  const untraceable = rules.filter(([, r]) => (r.authority.kind === 'OFFICIAL' ? (r.authority.sources ?? []).length === 0 : r.authority.kind === 'STUDYUS_POLICY' ? !(r.authority.assumption ?? '').trim() : true)).map(([k]) => k);
  const reading = reconcileAdapterDifferences(conflicts.filter((c) => c.adapterId === adapterId), (id) => registry.adapter(id));
  const termsRule = rules.find(([k]) => k === 'commandTerms')?.[1];
  const checks = [
    check('SYSTEM_VERSION_ACTIVE', system?.lifecycle === 'ACTIVE' && version?.lifecycle === 'ACTIVE', `${adapter.systemId} is ${system?.lifecycle ?? 'not registered'}; version ${adapter.systemVersionId ?? 'none'} is ${version?.lifecycle ?? 'not registered'}`),
    check('GOVERNED_RULE_PROFILE', adapter.source === 'EA1_COMPONENT_PROFILE', adapter.source),
    check('NO_RETIRED_CONFIGURATION', retiredConfigurationsReferencedBy(pair).length === 0, retiredConfigurationsReferencedBy(pair).join(', ') || 'cites only active configurations'),
    // every rule says who says so: an official source, or StudyUs policy stated as StudyUs policy
    check('EVERY_RULE_IS_TRACEABLE_OR_LABELLED_POLICY', untraceable.length === 0, untraceable.join(', ') || `${rules.length} rules: ${rules.filter(([, r]) => r.authority.kind === 'OFFICIAL').length} official with sources, ${rules.filter(([, r]) => r.authority.kind === 'STUDYUS_POLICY').length} labelled StudyUs policy`),
    check('NO_UNRESOLVED_CONFLICT', reading.every((e) => e.adapterIsValidAsItIs), reading.filter((e) => !e.adapterIsValidAsItIs).map((e) => `${e.dimension}: ${e.values.join(', ')}`).join('; ') || 'differences from a generation profile ask nothing of the adapter'),
    check('FORMATS_COHERENT', adapter.responseFormats.length > 0 && adapter.responseFormats.every((f) => !(f in STRUCTURE_CODES_AMONG_FORMATS)) && responseRepresentationsOf(adapter).length === adapter.responseFormats.length, adapter.responseFormats.join(', ')),
    check('MARKS_COHERENT', (COHERENT_MARKS[adapter.marksRubric.markStructure] ?? []).includes(adapter.marksRubric.rubricStyle), `${adapter.marksRubric.markStructure} / ${adapter.marksRubric.rubricStyle}`),
    check('COMMAND_TERMS_SOURCED', adapter.commandTerms.use === 'NONE' ? adapter.commandTerms.terms.length === 0 : adapter.commandTerms.terms.length > 0 && termsRule?.authority.kind === 'OFFICIAL' && (termsRule.authority.sources ?? []).length > 0, adapter.commandTerms.use === 'NONE' ? 'no controlled vocabulary' : `${adapter.commandTerms.terms.length} governed terms`),
    check('CALCULATOR_COHERENT', adapter.calculator.length > 0 && (!adapter.calculator.includes('NONE') || adapter.calculator.length === 1), adapter.calculator.join(', ') || 'no calculator rule'),
    check('REPRESENTATION_RULES_COHERENT', adapter.stimulusContext.stimulus.length > 0 && adapter.stimulusContext.contexts.length > 0, `stimulus ${adapter.stimulusContext.stimulus.join(', ')}; contexts ${adapter.stimulusContext.contexts.join(', ')}`),
  ];
  return conclude('ASSESSMENT_ADAPTER', adapterId, adapter.version, hash, checks, human);
}

// -------------------------------------------------------------------------------------------- 4C blueprint
export const blueprintHashOf = (b: LibraryBlueprint): string => sha256OfCanonicalJson({ blueprintId: b.blueprintId, classificationVersion: b.classificationVersion, facts: b.facts, blueprintClass: b.blueprintClass, buckets: b.buckets.map((x) => ({ bucket: x.bucket, governedPositions: x.governedPositions })) });
export function governBlueprint(b: LibraryBlueprint, register: readonly AssessmentApplicabilityRecord[], human: HumanRecords = NO_HUMAN, humanHash?: string): GovernanceDecision {
  const positions = b.buckets.reduce((n, x) => n + x.governedPositions, 0);
  const unlinked = b.buckets.flatMap((x) => x.bucket.primaryConceptStableIds.filter((c) => !register.some((r) => r.concept.stableId === c && r.scope.componentId === b.adapterId && resolveApplicability(register, { stableId: c, canonicalSubject: r.concept.canonicalSubject }, r.scope, applicabilityThresholdFor(r.scope.systemProfileId)).status === 'ESTABLISHED')).map((c) => `${x.bucket.objectiveCode} -> ${c}`));
  const checks = [
    // the class is of the STRUCTURE: the content status of the items a configuration ships is not an input
    check('CLASS_FOLLOWS_FROM_THE_RECORDED_FACTS', classifyBlueprintSection(b.facts) === b.blueprintClass, `${JSON.stringify(b.facts)} -> ${classifyBlueprintSection(b.facts)}`),
    check('STRUCTURAL_EVIDENCE_SUFFICIENT', b.facts.itemBankable && b.facts.governedSlots > 0, `${b.facts.governedSlots} governed positions`),
    check('CLASS_ADMITS_STUDENT_USE', blueprintGate('PRACTICE', b.blueprintClass).ok, b.blueprintClass),
    check('NOT_FULL_WITHOUT_THE_FULL_FORM', b.blueprintClass !== 'FULL' || b.facts.fullFormDocumented || (b.facts.officialItemCount !== null && b.facts.governedSlots >= b.facts.officialItemCount), `${b.facts.governedSlots} of ${b.facts.officialItemCount ?? 'no official count'}`),
    check('BUCKETS_WITHIN_THE_GOVERNED_POSITIONS', b.buckets.length > 0 && positions <= b.facts.governedSlots, `${positions} positions in ${b.buckets.length} linked buckets, of ${b.facts.governedSlots} governed`),
    check('EVERY_BUCKET_LINKS_AN_ASSESSED_CONCEPT', b.buckets.every((x) => x.bucket.primaryConceptStableIds.length > 0) && unlinked.length === 0, unlinked.join('; ') || 'each linked concept is established as assessed by this component'),
    check('BUCKETS_ARE_OF_THIS_COMPONENT', b.buckets.every((x) => x.bucket.adapterId === b.adapterId && x.bucket.blueprintClass === b.blueprintClass), b.adapterId),
  ];
  return conclude('BLUEPRINT_CLASSIFICATION', b.blueprintId, b.classificationVersion, humanHash ?? blueprintHashOf(b), checks, human);
}

// --------------------------------------------------------------------------------------- 4D renderer envelope
export interface EnvelopeEvidence { sweep: ReturnType<typeof sweepEnvelope>; capacity: ReturnType<typeof bandCapacity>[]; determinism: boolean }
/** `determinism`: the caller rendered the same seeds twice and compared the bytes. A property of the run, so it is given, not assumed. */
export function governEnvelope(entry: Pick<LibraryEntry, 'core' | 'envelope' | 'construct' | 'strategy'>, determinism: boolean, human: HumanRecords = NO_HUMAN): GovernanceDecision & { evidence: EnvelopeEvidence } {
  const { envelope: env, construct, core } = entry;
  const language = construct.languages[0];
  const sweep = sweepEnvelope(construct, language);
  const capacity = PLANNING_BANDS.map((b) => bandCapacity(construct, b, language));
  const coreRanges = ((core.family.specialization as { parameterRanges?: { symbol: string; min: number; max: number }[] } | null)?.parameterRanges ?? []);
  const outside = rangesOutsideTheCore(env, coreRanges);
  const failures = sweep.reduce((n, s) => n + s.keyFailures, 0);
  const checks = [
    check('ENVELOPE_IS_OF_THIS_CORE_AND_RENDERER', env.constructFamilyId === core.constructFamilyId && env.constructFamilyVersion === core.familyVersion && env.rendererVersion === entry.strategy.rendererVersion && env.construct === construct.construct, `${env.rendererVersion} for ${env.constructFamilyId}@${env.constructFamilyVersion}`),
    check('DETERMINISTIC_STRATEGY', entry.strategy.kind === 'PARAMETRIC_DETERMINISTIC' && env.strategy === 'PARAMETRIC_DETERMINISTIC', entry.strategy.kind),
    check('EVERY_PARAMETER_BRANCH_BOUNDED', sweep.every((s) => s.checked > 0) && env.bands.every((b) => sweep.some((s) => s.band === b.planningBand)), sweep.map((s) => `${s.band}: ${s.checked} parameter sets`).join('; ')),
    check('RANGES_INSIDE_THE_CORE', outside.length === 0, outside.join('; ') || 'no range reaches outside the core'),
    check('KEYS_INDEPENDENTLY_VERIFIED', failures === 0, `${sweep.reduce((n, s) => n + s.checked, 0)} keys recomputed by a second route; ${failures} do not hold`),
    check('EVERY_INSTANCE_IS_OF_ITS_BAND', sweep.every((s) => s.bandFailures === 0), `${sweep.reduce((n, s) => n + s.bandFailures, 0)} parameter sets miss a lever setting of their band`),
    check('NO_KEY_IS_A_MISCONCEPTION_ANSWER', sweep.every((s) => s.misconceptionCollisions === 0), `${sweep.reduce((n, s) => n + s.misconceptionCollisions, 0)} collisions`),
    check('ONE_WORDING_ONE_KEY', sweep.every((s) => s.duplicateWordingsWithDifferentKeys === 0), `${sweep.reduce((n, s) => n + s.duplicateWordingsWithDifferentKeys, 0)} wordings with two keys`),
    check('KEYS_ARE_POSITIVE', sweep.every((s) => s.nonPositiveKeys === 0), `${sweep.reduce((n, s) => n + s.nonPositiveKeys, 0)} non-positive keys`),
    check('SWEEP_CLEAN', sweepIsClean(sweep), 'the whole envelope, exhaustively'),
    check('DIFFICULTY_MAPPING_DEFINED', env.bands.length === PLANNING_BANDS.length && studentBandsOf(env).length === 3, env.bands.map((b) => `${b.planningBand} -> ${b.itemDifficulty}`).join(', ')),
    check('REPRESENTATION_SUPPORTED', env.stimulusKinds.length === 0, env.stimulusKinds.join(', ') || 'text only'),
    check('SEED_DETERMINISM', determinism, determinism ? 'the same seeds rendered twice give the same bytes' : 'not shown'),
    check('ENOUGH_DISTINCT_INSTANCES', capacity.every((c) => c.recognitionClasses >= 3), capacity.map((c) => `${c.band}: ${c.recognitionClasses}`).join('; ')),
  ];
  return { ...conclude('RENDERER_ENVELOPE', env.rendererVersion, env.constructFamilyVersion, envelopeHashOf(env), checks, human), evidence: { sweep, capacity, determinism } };
}
