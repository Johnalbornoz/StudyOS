/**
 * UX-2 -- "Tu siguiente reto": the ONE presentation of a concept's next
 * action, shared by Today, My Path and the subject surfaces.
 *
 * Pure presentation over decisions that already exist. It never ranks a
 * concept, never picks an activity and never evaluates a threshold:
 *
 *   - which concept      -> the caller's existing Phase 3C/3D decision
 *   - which activity     -> the canonical launch (`resolveCanonicalLaunch`,
 *                           the SAME function /api/learning/session/start
 *                           runs) when the Canonical V2 gate is on
 *   - waiting / blocked  -> that canonical launch's own `launchStatus`, or
 *                           the legacy gate flags the caller already
 *                           computed when the gate is off
 *
 * The rule this module exists to enforce: the label, narrative and CTA a
 * learner sees are derived from the SAME authority the Start button
 * launches. When the canonical gate is on, the legacy `activityType` is
 * never shown -- a missing canonical read is reported as unavailable,
 * never silently replaced by the legacy value.
 */
import type { ActivityType } from '@/lib/activity-taxonomy';
import type { LearningFact } from '@/lib/adaptive-learning-policy';
import type { PedagogicalStage } from '@/lib/pedagogical-engine/types';
import type { CanonicalLearningSession } from '@/lib/pedagogical-decision/canonical-session-launch';
import { presentedActivityTypeForCanonical } from '@/lib/pedagogical-decision/concept-mission-override';

/** The activity as the learner sees it, plus the REINFORCE overlay the canonical engine can launch. */
export type ChallengeKind = ActivityType | 'REINFORCE';

export type ChallengeAuthority = 'CANONICAL' | 'LEGACY';

export type ChallengeUnavailableReason =
  | 'CANONICAL_READ_FAILED'
  | 'BLOCKED'
  | 'LOCKED'
  | 'NOT_READY'
  | 'ZERO_GAP';

export type NextChallengeView =
  | {
      status: 'READY';
      authority: ChallengeAuthority;
      conceptId: string;
      subjectId: string;
      /** Feeds the certified activityLabel/activityCta/activityNarrative mappers. */
      activityType: ActivityType;
      /** Feeds the challenge verb ("Entrénalo", "Demuéstralo", "Refuérzalo"). */
      challenge: ChallengeKind;
      /** Canonical stage of this concept; null under the legacy authority. */
      stage: PedagogicalStage | null;
      reinforce: boolean;
      /** Items the canonical activity contract authorizes (launch param), when known. */
      itemCount: number | null;
      /** Explanatory facts compatible with the authority that chose the activity. */
      facts: LearningFact[];
    }
  | { status: 'WAITING'; authority: ChallengeAuthority; conceptId: string; subjectId: string; stage: PedagogicalStage | null; nextEligibleAt: string | null }
  | { status: 'CONSOLIDATED'; authority: ChallengeAuthority; conceptId: string; subjectId: string; stage: PedagogicalStage | null }
  | { status: 'UNAVAILABLE'; authority: ChallengeAuthority; conceptId: string; subjectId: string; stage: PedagogicalStage | null; reason: ChallengeUnavailableReason };

export interface LegacyGate {
  waiting: boolean;
  nextEligibleAt: string | null;
  zeroGapBlocked: boolean;
}

export interface NextChallengeInput {
  conceptId: string;
  subjectId: string;
  /** The Phase 3C decision that selected this concept. Its activityType is used ONLY under the legacy authority. */
  legacyDecision: { activityType: ActivityType; facts: LearningFact[] };
  /** `isCanonicalEngineV1Enabled()` for this render. */
  canonicalAuthority: boolean;
  /** The canonical launch for THIS concept, or null when the gate is off or the canonical read failed. */
  canonical: CanonicalLearningSession | null;
  /** Legacy gate flags, consulted only when `canonicalAuthority` is false. Absent means "no legacy gate applies". */
  legacyGate?: LegacyGate;
}

/**
 * Facts that explain why a CONCEPT was prioritized (Phase 3C ranking,
 * which still selects the concept under the canonical gate). Facts that
 * justify a specific legacy ACTIVITY choice (retention due, transfer
 * required, independence gap, ...) could contradict the canonical
 * activity actually launched, so they are not shown next to it -- the
 * same discipline Concept Mission's canonical NOW card already applies
 * (it shows no legacy facts at all).
 */
const CONCEPT_PRIORITY_FACT_KINDS: ReadonlySet<string> = new Set([
  'examApproaching',
  'learningDebt',
  'prerequisiteGap',
  'recurringMisconception',
  'criticalMisconception',
]);

export function factsCompatibleWithAuthority(facts: LearningFact[], authority: ChallengeAuthority): LearningFact[] {
  if (authority === 'LEGACY') return facts;
  return facts.filter((f) => CONCEPT_PRIORITY_FACT_KINDS.has(f.kind));
}

function parseItemCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function presentNextChallenge(input: NextChallengeInput): NextChallengeView {
  const { conceptId, subjectId, legacyDecision } = input;

  if (input.canonicalAuthority) {
    const c = input.canonical;
    if (!c) {
      return { status: 'UNAVAILABLE', authority: 'CANONICAL', conceptId, subjectId, stage: null, reason: 'CANONICAL_READ_FAILED' };
    }
    const stage = c.stage;
    switch (c.launchStatus) {
      case 'READY': {
        if (!c.activityType) {
          return { status: 'UNAVAILABLE', authority: 'CANONICAL', conceptId, subjectId, stage, reason: 'BLOCKED' };
        }
        const reinforce = c.activityType === 'REINFORCE';
        return {
          status: 'READY',
          authority: 'CANONICAL',
          conceptId,
          subjectId,
          activityType: presentedActivityTypeForCanonical(c.activityType),
          challenge: reinforce ? 'REINFORCE' : presentedActivityTypeForCanonical(c.activityType),
          stage,
          reinforce,
          itemCount: parseItemCount(c.launchParams?.maxQuestions),
          facts: factsCompatibleWithAuthority(legacyDecision.facts, 'CANONICAL'),
        };
      }
      case 'WAITING':
        return { status: 'WAITING', authority: 'CANONICAL', conceptId, subjectId, stage, nextEligibleAt: c.nextEligibleAt };
      case 'CONSOLIDATED':
        return { status: 'CONSOLIDATED', authority: 'CANONICAL', conceptId, subjectId, stage };
      case 'LOCKED':
        return { status: 'UNAVAILABLE', authority: 'CANONICAL', conceptId, subjectId, stage, reason: 'LOCKED' };
      case 'NOT_READY':
        return { status: 'UNAVAILABLE', authority: 'CANONICAL', conceptId, subjectId, stage, reason: 'NOT_READY' };
      default:
        return { status: 'UNAVAILABLE', authority: 'CANONICAL', conceptId, subjectId, stage, reason: 'BLOCKED' };
    }
  }

  const gate = input.legacyGate;
  if (gate?.waiting) {
    return { status: 'WAITING', authority: 'LEGACY', conceptId, subjectId, stage: null, nextEligibleAt: gate.nextEligibleAt };
  }
  if (gate?.zeroGapBlocked) {
    return { status: 'UNAVAILABLE', authority: 'LEGACY', conceptId, subjectId, stage: null, reason: 'ZERO_GAP' };
  }
  return {
    status: 'READY',
    authority: 'LEGACY',
    conceptId,
    subjectId,
    activityType: legacyDecision.activityType,
    challenge: legacyDecision.activityType,
    stage: null,
    reinforce: false,
    itemCount: null,
    facts: legacyDecision.facts,
  };
}
