/**
 * QF V5.1 -- the ASSESSMENT CONSTRUCT CORE: the reusable asset of the Question Bank (pure contract, no IO).
 *
 *   canonical concept -> certified construct core -> explicit applicability -> certified adapter
 *     -> governed blueprint bucket -> controlled item instance -> Student delivery
 *
 * A construct core IS an EA-1 AssessmentTaskFamily, persisted and certified. This module adds no second family
 * model: a core record wraps one task-family version (the family contract, verbatim) with what persistence and
 * certification need -- a lifecycle, a certification version, a content hash and the family's shortcut / bypass
 * constraints as a first-class list. Everything a core "knows" is read from the family and its registered
 * specialisation; nothing is restated here.
 *
 * CORE != ITEM TEXT. A core holds no stem, no option and no number of an item (the family contract already
 * guarantees that). Items are instances rendered from it.
 *
 * LIFECYCLE. DRAFT -> UNDER_REVIEW -> CERTIFIED -> RETIRED. Only a CERTIFIED core may feed Student delivery, and
 * a certified version is immutable: a change is a new version.
 */
import { z } from 'zod';
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { DEFAULT_TASK_FAMILY_REGISTRY } from '@/lib/exam-core/question-bank/task-families';
import { ELICITATION_FORMATS, type TaskFamily, type TaskFamilyRegistry } from '@/lib/exam-core/question-bank/task-families/task-family';

export const CONSTRUCT_CORE_CONTRACT_VERSION = 1 as const;

export const CORE_LIFECYCLES = ['DRAFT', 'UNDER_REVIEW', 'CERTIFIED', 'RETIRED'] as const;
export type CoreLifecycle = (typeof CORE_LIFECYCLES)[number];

/** The family contract says IN_REVIEW where the persisted core says UNDER_REVIEW. One state, two spellings. */
const FAMILY_TO_CORE: Record<TaskFamily['lifecycle'], CoreLifecycle> = { DRAFT: 'DRAFT', IN_REVIEW: 'UNDER_REVIEW', CERTIFIED: 'CERTIFIED', RETIRED: 'RETIRED' };
export const coreLifecycleOfFamily = (lifecycle: TaskFamily['lifecycle']): CoreLifecycle => FAMILY_TO_CORE[lifecycle];

const TRANSITIONS: Record<CoreLifecycle, readonly CoreLifecycle[]> = { DRAFT: ['UNDER_REVIEW', 'RETIRED'], UNDER_REVIEW: ['DRAFT', 'CERTIFIED', 'RETIRED'], CERTIFIED: ['RETIRED'], RETIRED: [] };
export const canTransitionCore = (from: CoreLifecycle, to: CoreLifecycle): boolean => TRANSITIONS[from].includes(to);

const ID = z.string().trim().min(1).max(200);
const STATEMENT = z.string().trim().min(10).max(700);

/**
 * A way of answering that bypasses the construct, and what it excludes. "With options to choose from the roots
 * can be found by substitution" is a shortcut; it excludes selected response for that core.
 */
export const ShortcutConstraintSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** What the learner could do instead of the reasoning the core is evidence of. */
  bypass: STATEMENT,
  /** Response formats in which the bypass is available: an instance is never rendered in one of them. */
  excludedFormats: z.array(z.enum(ELICITATION_FORMATS)),
  /** What every instance must do so that the bypass is closed (a stated root, a produced value, ...). */
  instanceRule: STATEMENT.nullable(),
});
export type ShortcutConstraint = z.infer<typeof ShortcutConstraintSchema>;

export const CoreCertificationSchema = z.strictObject({ certificationVersion: ID, certifiedBy: ID, certifiedAt: z.string().datetime({ offset: true }) });
export type CoreCertification = z.infer<typeof CoreCertificationSchema>;

export interface ConstructCoreRecord {
  v: typeof CONSTRUCT_CORE_CONTRACT_VERSION;
  /** The family's stable id. Never contains an exam's name. */
  constructFamilyId: string;
  familyVersion: string;
  familyType: string;
  canonicalSubject: string;
  /** The certified canonical concept the core is evidence of, by stable id. */
  primaryConceptStableId: string;
  lifecycle: CoreLifecycle;
  certification: CoreCertification | null;
  shortcutConstraints: ShortcutConstraint[];
  /** sha256 of the family contract + shortcut constraints: an edit without a new version is detectable. */
  contentHash: string;
  /** The EA-1 family contract, verbatim. The single description of the construct. */
  family: TaskFamily;
}

export type CoreBuildResult = { ok: true; core: ConstructCoreRecord } | { ok: false; issue: string; details: string[] };

/**
 * A core record of one family version. The family is validated by the registry (common schema + specialisation).
 * A CERTIFIED core needs: a REVIEWED, CERTIFIED family, a certification, and exactly one primary concept (an
 * instance targets one concept; a core that names several is not certifiable as one construct).
 */
export function constructCoreOf(input: { family: unknown; shortcutConstraints: unknown; certification?: unknown }, registry: TaskFamilyRegistry = DEFAULT_TASK_FAMILY_REGISTRY): CoreBuildResult {
  const validated = registry.validate(input.family);
  if (!validated.ok) return { ok: false, issue: validated.issue, details: validated.details };
  const family = validated.family as TaskFamily;
  const shortcuts = z.array(ShortcutConstraintSchema).safeParse(input.shortcutConstraints);
  if (!shortcuts.success) return { ok: false, issue: 'SHORTCUT_CONSTRAINTS_INVALID', details: shortcuts.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  if (new Set(shortcuts.data.map((s) => s.id)).size !== shortcuts.data.length) return { ok: false, issue: 'SHORTCUT_LISTED_TWICE', details: [] };
  const widened = shortcuts.data.flatMap((s) => s.excludedFormats.filter((f) => family.responseConstraints.allowedFormats.includes(f)).map((f) => `${s.id}: ${f}`));
  // a shortcut excludes a format; the family cannot at the same time allow it
  if (widened.length > 0) return { ok: false, issue: 'FAMILY_ALLOWS_A_FORMAT_ITS_SHORTCUT_EXCLUDES', details: widened };
  const lifecycle = coreLifecycleOfFamily(family.lifecycle);
  let certification: CoreCertification | null = null;
  if (lifecycle === 'CERTIFIED') {
    const parsed = CoreCertificationSchema.safeParse(input.certification);
    if (!parsed.success) return { ok: false, issue: 'CERTIFIED_CORE_NEEDS_A_CERTIFICATION', details: [] };
    if (family.reviewStatus !== 'REVIEWED') return { ok: false, issue: 'CERTIFIED_CORE_NEEDS_A_REVIEW', details: [] };
    if (family.primaryConcepts.length !== 1) return { ok: false, issue: 'CERTIFIED_CORE_HAS_ONE_PRIMARY_CONCEPT', details: family.primaryConcepts.map((c) => c.stableId) };
    certification = parsed.data;
  } else if (input.certification != null) return { ok: false, issue: 'ONLY_A_CERTIFIED_CORE_CARRIES_A_CERTIFICATION', details: [lifecycle] };
  return {
    ok: true,
    core: {
      v: CONSTRUCT_CORE_CONTRACT_VERSION, constructFamilyId: family.familyId, familyVersion: family.version, familyType: family.familyType, canonicalSubject: family.canonicalSubject,
      primaryConceptStableId: family.primaryConcepts[0].stableId, lifecycle, certification, shortcutConstraints: shortcuts.data,
      contentHash: sha256OfCanonicalJson({ family, shortcutConstraints: shortcuts.data }), family,
    },
  };
}

/** The only cores Student delivery may be fed from. */
export const coreMayFeedStudentDelivery = (core: Pick<ConstructCoreRecord, 'lifecycle' | 'certification'>): boolean => core.lifecycle === 'CERTIFIED' && core.certification !== null;

/** Has the record been edited since its hash was taken? */
export const coreContentIntact = (core: ConstructCoreRecord): boolean => core.contentHash === sha256OfCanonicalJson({ family: core.family, shortcutConstraints: core.shortcutConstraints });

/** What a core says, in the vocabulary of the product requirement. Read from the family; nothing is stored twice. */
export interface CoreSemantics {
  stableFamilyId: string;
  primaryConcept: { stableId: string; canonicalSubject: string; canonicalName: string };
  targetUnderstanding: string;
  observableEvidenceTarget: string;
  requiredActions: readonly string[];
  misconceptionModels: readonly { id: string; description: string }[];
  solutionInvariants: unknown;
  constraints: readonly string[];
  validSolutionRules: readonly string[];
  parameterRanges: unknown;
  difficultyLevers: readonly { lever: string; kind: string }[];
  shortcutConstraints: readonly ShortcutConstraint[];
  provenance: TaskFamily['provenance'];
  lifecycle: CoreLifecycle;
  certificationVersion: string | null;
}
export function coreSemantics(core: ConstructCoreRecord, registry: TaskFamilyRegistry = DEFAULT_TASK_FAMILY_REGISTRY): CoreSemantics {
  const f = core.family;
  const facts = registry.specializationOf(f.familyType)?.adaptationFacts(f.specialization as never);
  const s = (f.specialization ?? {}) as { constraints?: string[]; validSolutionRules?: string[]; misconceptionModels?: { id: string; description: string }[] };
  return {
    stableFamilyId: core.constructFamilyId, primaryConcept: f.primaryConcepts[0], targetUnderstanding: f.evidenceTarget.observablePerformance, observableEvidenceTarget: f.evidenceTarget.object,
    requiredActions: f.evidenceTarget.actions, misconceptionModels: s.misconceptionModels ?? f.commonMisconceptions.map((d, i) => ({ id: `misconception-${i + 1}`, description: d })),
    solutionInvariants: facts?.invariantConstruct ?? null, constraints: s.constraints ?? [], validSolutionRules: s.validSolutionRules ?? [], parameterRanges: facts?.parameterization ?? null,
    difficultyLevers: f.difficultyLevers.map((l) => ({ lever: l.lever, kind: l.kind })), shortcutConstraints: core.shortcutConstraints, provenance: f.provenance, lifecycle: core.lifecycle,
    certificationVersion: core.certification?.certificationVersion ?? null,
  };
}
