/**
 * Exam preparation -- the ACTIVITY AVAILABILITY CONTRACT.
 *
 * Readiness decides what a preparation can DO, never whether the objective can
 * be chosen (every objective can):
 *
 *   CATALOG_ONLY        -> the objective can be added to the preparation
 *   STRUCTURE_READY     -> + "what is assessed" (structure, requirements)
 *   PRACTICE_READY      -> + practice (by area / skill) and a diagnostic
 *   REDUCED_MOCK_READY  -> + a reduced-format StudyUS mock
 *   FULL_MOCK_READY     -> + a full-length StudyUS mock
 *
 * Pure: it reads the persisted catalogue entries of the objective (state,
 * modes, selectable -- written by the governed apply) and the bridge mapping
 * count. The server computes it; a client flag is never trusted, and every
 * launch is re-checked by the instance API against the same persisted state.
 */
import { READINESS_ORDER, type ReadinessState } from '../catalog/readiness';
import type { ExamObjective } from './objective-catalog';

export type Mode = 'PRACTICE' | 'MOCK' | 'CHALLENGE';
export type Capability = 'STRUCTURE' | 'PRACTICE' | 'DIAGNOSTIC' | 'REDUCED_MOCK' | 'FULL_MOCK' | 'LEARNING_BRIDGE';
export type UnavailableReason =
  | 'NOT_CONFIGURED' // catalogue only: no verified StudyUS structure yet
  | 'STRUCTURE_ONLY' // structure configured, no practice bank yet
  | 'BANK_IN_PROGRESS' // structure configured, some items, not enough to practise
  | 'PRACTICE_ONLY' // practice exists, no mock form yet
  | 'REDUCED_ONLY' // a reduced mock exists, the bank cannot cover the official length
  | 'NO_CONCEPT_MAPPINGS' // no reviewed requirement -> concept links yet
  | 'PLANNED_BY_SUBJECT'; // a programme (AICE Diploma): activities are per subject

/** One persisted catalogue entry of the objective (assessment_structure_nodes row, reduced). */
export interface ObjectiveEntry {
  key: string;
  type: string;
  label: string;
  purpose: 'FULL_TEST' | 'AREA_PRACTICE' | 'SKILL_PRACTICE' | null;
  state: ReadinessState;
  modes: Mode[];
  /** Bound to a published version and offering at least one mode (the instance API's own gate). */
  selectable: boolean;
  bankInProgress: boolean;
  /** Bound to a single component (area / domain / paper) rather than the whole exam. */
  sectionBound: boolean;
  lengthCoveragePercent: number | null;
}

export interface ActivityEntry { nodeKey: string; label: string; purpose: ObjectiveEntry['purpose']; lengthCoveragePercent: number | null }

export interface ExamPreparationCapabilities {
  objectiveKey: string;
  /** Best readiness inside the objective. */
  readiness: ReadinessState;
  /** Always true: an objective in the governed catalogue can be chosen. */
  canSelect: true;
  canViewStructure: boolean;
  canPractice: boolean;
  practiceModes: ActivityEntry[];
  canRunDiagnostic: boolean;
  canRunReducedMock: boolean;
  reducedMocks: ActivityEntry[];
  canRunFullMock: boolean;
  fullMocks: ActivityEntry[];
  canUseLearningBridge: boolean;
  /** AICE Diploma: the Diploma Planner. */
  canPlanDiploma: boolean;
  unavailableReasons: Array<{ capability: Capability; reason: UnavailableReason }>;
}

const COMPONENT_TYPES = new Set(['PAPER', 'COMPONENT', 'PORTFOLIO', 'PERFORMANCE', 'PROJECT', 'SECTION']);
const rank = (s: ReadinessState) => READINESS_ORDER.indexOf(s);
const atLeast = (s: ReadinessState, min: ReadinessState) => rank(s) >= rank(min);

export function computeCapabilities(objective: Pick<ExamObjective, 'key' | 'kind'>, entries: ObjectiveEntry[], bridgeMappings: number): ExamPreparationCapabilities {
  const reasons: ExamPreparationCapabilities['unavailableReasons'] = [];
  if (objective.kind === 'PROGRAMME_PLAN') {
    for (const c of ['PRACTICE', 'DIAGNOSTIC', 'REDUCED_MOCK', 'FULL_MOCK', 'LEARNING_BRIDGE'] as Capability[]) reasons.push({ capability: c, reason: 'PLANNED_BY_SUBJECT' });
    return { objectiveKey: objective.key, readiness: 'STRUCTURE_READY', canSelect: true, canViewStructure: true, canPractice: false, practiceModes: [], canRunDiagnostic: false, canRunReducedMock: false, reducedMocks: [], canRunFullMock: false, fullMocks: [], canUseLearningBridge: false, canPlanDiploma: true, unavailableReasons: reasons };
  }
  const readiness = entries.reduce<ReadinessState>((best, e) => (rank(e.state) > rank(best) ? e.state : best), 'CATALOG_ONLY');
  // Launchable entries: the exam / level / area / skill nodes the instance API accepts (never a lone paper node).
  const launchable = entries.filter((e) => e.selectable && !COMPONENT_TYPES.has(e.type));
  const entry = (e: ObjectiveEntry): ActivityEntry => ({ nodeKey: e.key, label: e.label, purpose: e.purpose, lengthCoveragePercent: e.lengthCoveragePercent });

  const practiceModes = launchable.filter((e) => e.modes.includes('PRACTICE') && atLeast(e.state, 'PRACTICE_READY')).map(entry);
  const mocks = launchable.filter((e) => e.modes.includes('MOCK'));
  const fullMocks = mocks.filter((e) => e.state === 'FULL_MOCK_READY').map(entry);
  const reducedMocks = mocks.filter((e) => e.state === 'REDUCED_MOCK_READY').map(entry);
  const canViewStructure = atLeast(readiness, 'STRUCTURE_READY');
  const canPractice = practiceModes.length > 0;
  const bankInProgress = entries.some((e) => e.bankInProgress);

  const notReady: UnavailableReason = !canViewStructure ? 'NOT_CONFIGURED' : bankInProgress ? 'BANK_IN_PROGRESS' : 'STRUCTURE_ONLY';
  if (!canViewStructure) reasons.push({ capability: 'STRUCTURE', reason: 'NOT_CONFIGURED' });
  if (!canPractice) {
    reasons.push({ capability: 'PRACTICE', reason: notReady });
    reasons.push({ capability: 'DIAGNOSTIC', reason: notReady });
  }
  if (!reducedMocks.length && !fullMocks.length) reasons.push({ capability: 'REDUCED_MOCK', reason: canPractice ? 'PRACTICE_ONLY' : notReady });
  if (!fullMocks.length) reasons.push({ capability: 'FULL_MOCK', reason: reducedMocks.length ? 'REDUCED_ONLY' : canPractice ? 'PRACTICE_ONLY' : notReady });
  if (bridgeMappings === 0) reasons.push({ capability: 'LEARNING_BRIDGE', reason: canViewStructure ? 'NO_CONCEPT_MAPPINGS' : 'NOT_CONFIGURED' });

  return {
    objectiveKey: objective.key,
    readiness,
    canSelect: true,
    canViewStructure,
    canPractice,
    practiceModes,
    // The diagnostic samples the practice-ready areas: it exists exactly when practice does.
    canRunDiagnostic: canPractice,
    canRunReducedMock: reducedMocks.length > 0,
    reducedMocks,
    canRunFullMock: fullMocks.length > 0,
    fullMocks,
    canUseLearningBridge: bridgeMappings > 0,
    canPlanDiploma: false,
    unavailableReasons: reasons,
  };
}

/** Short, Student-facing status of an objective (Explorer card): what StudyUS can do for it today. */
export type ObjectiveStatusKey = 'canAdd' | 'structure' | 'practice' | 'reducedMock' | 'fullMock' | 'bankInProgress' | 'plan';
export function objectiveStatusKey(c: Pick<ExamPreparationCapabilities, 'canPlanDiploma' | 'canRunFullMock' | 'canRunReducedMock' | 'canPractice' | 'canViewStructure' | 'unavailableReasons'>): ObjectiveStatusKey {
  if (c.canPlanDiploma) return 'plan';
  if (c.canRunFullMock) return 'fullMock';
  if (c.canRunReducedMock) return 'reducedMock';
  if (c.canPractice) return 'practice';
  if (c.canViewStructure) return c.unavailableReasons.some((r) => r.reason === 'BANK_IN_PROGRESS') ? 'bankInProgress' : 'structure';
  return 'canAdd';
}
