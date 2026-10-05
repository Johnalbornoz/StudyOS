/**
 * Exam V2 -- exam form assembly (sections 30-34). Pure and deterministic:
 * the same inputs (instance id, positions, pool, usage) always give the same
 * form.
 *
 * A form binds every plan position (one blueprint objective target) to one
 * PUBLISHED bank item BEFORE the Student starts, so a Mock / Challenge can be
 * frozen: no regeneration, no swap on refresh, the same paper for the whole
 * attempt.
 *
 *   - difficulty: each item has a difficultyIndex (1.0 = the calibrated
 *     difficulty of the real exam). MOCK targets 1.0, CHALLENGE 1.10 (band
 *     1.05-1.15), PRACTICE the level's target;
 *   - novelty: never two items with the same template fingerprint in one
 *     form; items (and templates) the Student has already seen are
 *     penalized, so a retest prefers new variants;
 *   - stimulus units stay together (an item sharing the previous position's
 *     stimulus is preferred);
 *   - fidelity: planned marks vs the component definition's official marks.
 *     A form the bank cannot fill completely is REDUCED and says so -- it is
 *     never presented as a full paper.
 */
import type { ContentAudience } from './audience';
import { createHash } from 'crypto';

export type InstanceMode = 'PRACTICE' | 'MOCK' | 'CHALLENGE';
export type PracticeLevel = 'FOUNDATION' | 'STANDARD' | 'ADVANCED' | 'CHALLENGE';

export const PRACTICE_LEVEL_TARGET: Record<PracticeLevel, number> = { FOUNDATION: 0.75, STANDARD: 1.0, ADVANCED: 1.1, CHALLENGE: 1.2 };
export const MOCK_TARGET = 1.0;
export const CHALLENGE_TARGET = 1.1;
export const CHALLENGE_BAND = { min: 1.05, max: 1.15 } as const;
/** A Mock form's mean difficulty must stay within this band of 1.0 to be called calibrated. */
export const MOCK_BAND = { min: 0.95, max: 1.05 } as const;

export function targetDifficultyFor(mode: InstanceMode, level: PracticeLevel | null): number {
  if (mode === 'CHALLENGE') return CHALLENGE_TARGET;
  if (mode === 'PRACTICE') return PRACTICE_LEVEL_TARGET[level ?? 'STANDARD'];
  return MOCK_TARGET;
}

export interface FormPosition {
  /** Plan position = index in the plan's selectedTargets. */
  index: number;
  blueprintObjectiveTargetId: string;
  assessmentComponentId: string;
  learningObjectiveId: string | null;
  questionType: string | null;
  difficultyRange: { min: number; max: number } | null;
}

export interface PoolItem {
  id: string;
  learningObjectiveId: string;
  questionType: string | null;
  difficulty: number;
  difficultyIndex: number | null;
  marks: number;
  templateFingerprint: string | null;
  semanticFingerprint: string | null;
  stimulusKey: string | null;
  contentOrigin: string | null;
}

export interface StudentUsage {
  approvedItemIds: Set<string>;
  templateFingerprints: Set<string>;
  /** Question Bank V2 exposure memory (all optional: absent = the previous behaviour). */
  /** Items this Student saw within the reuse cooldown (repeated only when nothing unseen is equivalent). */
  recentApprovedItemIds?: Set<string>;
  /** Distinct Students who have seen each item (lower global exposure is preferred). */
  globalExposure?: Map<string, number>;
  /** Other Students of the same group / exam who met each item recently (cross-Student collision). */
  peerExposure?: Map<string, number>;
  /** Exposure ceiling used to normalize the global exposure (Students per question). */
  exposureCeiling?: number;
}

export interface FormSlot {
  index: number;
  blueprintObjectiveTargetId: string;
  assessmentComponentId: string;
  approvedItemId: string | null;
  marks: number;
  difficultyIndex: number | null;
  contentOrigin: string | null;
  /** Why no item: the bank has nothing usable for this objective. */
  unfilledReason?: 'NO_BANK_ITEM';
}

export interface ComponentFidelity {
  componentId: string;
  officialMarks: number | null;
  officialItems: number | null;
  plannedMarks: number;
  positions: number;
  filled: number;
}

export interface AssembledForm {
  v: 1;
  mode: InstanceMode;
  targetDifficulty: number;
  difficultyIndex: number | null;
  slots: FormSlot[];
  components: ComponentFidelity[];
  /**
   * LENGTH fidelity only: FULL = every position filled and every component's planned marks reach its official
   * marks. It is never a certification -- MOCK_READY comes from the Mock Certification gate
   * (question-bank/mock-certification.ts), never from this flag.
   */
  fidelity: 'FULL' | 'REDUCED';
  /** Which content the form was drawn from (absent on forms frozen before QB-0 = STUDENT). */
  contentAudience?: ContentAudience;
  coveragePercent: number;
  /** For a Challenge / Mock: whether the mean difficulty landed in the mode's band. */
  difficultyBandMet: boolean;
  notes: string[];
  /** Question Bank V2: unfilled positions per objective -- the structured shortage signal for inventory demand. */
  shortages?: Array<{ learningObjectiveId: string | null; missing: number }>;
  /** Question Bank V2: positions filled with an item this Student had already seen (pool exhausted). */
  repeatedForStudent?: number;
}

const DEFAULT_INDEX = 1.0;

function rank(seed: string, id: string): string {
  return createHash('sha256').update(`${seed}:${id}`).digest('hex');
}

export function assembleForm(params: {
  seed: string;
  mode: InstanceMode;
  practiceLevel: PracticeLevel | null;
  positions: FormPosition[];
  pool: PoolItem[];
  usage: StudentUsage;
  officialMarksByComponent: Record<string, number | null>;
  officialItemsByComponent?: Record<string, number | null>;
}): AssembledForm {
  const target = targetDifficultyFor(params.mode, params.practiceLevel);
  const usedIds = new Set<string>();
  const usedTemplates = new Set<string>();
  const slots: FormSlot[] = [];
  let prevStimulus: string | null = null;

  for (const pos of [...params.positions].sort((a, b) => a.index - b.index)) {
    const candidates = params.pool.filter(
      (it) =>
        it.learningObjectiveId === pos.learningObjectiveId &&
        !usedIds.has(it.id) &&
        (!it.templateFingerprint || !usedTemplates.has(it.templateFingerprint)) &&
        (!pos.questionType || it.questionType === pos.questionType) &&
        (!pos.difficultyRange || (it.difficulty >= pos.difficultyRange.min && it.difficulty <= pos.difficultyRange.max))
    );
    if (candidates.length === 0) {
      slots.push({ index: pos.index, blueprintObjectiveTargetId: pos.blueprintObjectiveTargetId, assessmentComponentId: pos.assessmentComponentId, approvedItemId: null, marks: 0, difficultyIndex: null, contentOrigin: null, unfilledReason: 'NO_BANK_ITEM' });
      continue;
    }
    // Academic constraints are the filters above; among equivalent candidates the cost prefers, in order:
    // closeness to the target difficulty, unseen by this Student (recently seen weighs most), lower global
    // exposure, fewer collisions with other Students; the seeded rank only breaks exact ties (never pure random).
    const u = params.usage;
    const ceiling = Math.max(1, u.exposureCeiling ?? 8);
    const cost = (it: PoolItem) => {
      let c = Math.abs((it.difficultyIndex ?? DEFAULT_INDEX) - target);
      if (u.approvedItemIds.has(it.id)) c += 2 + (u.recentApprovedItemIds?.has(it.id) ? 1 : 0);
      else if (it.templateFingerprint && u.templateFingerprints.has(it.templateFingerprint)) c += 1;
      if (u.globalExposure) c += 0.5 * Math.min(1, (u.globalExposure.get(it.id) ?? 0) / ceiling);
      if (u.peerExposure) c += 0.75 * Math.min(1, (u.peerExposure.get(it.id) ?? 0) / 3);
      if (prevStimulus && it.stimulusKey === prevStimulus) c -= 3;
      return c;
    };
    candidates.sort((a, b) => cost(a) - cost(b) || rank(params.seed, a.id).localeCompare(rank(params.seed, b.id)));
    const pick = candidates[0];
    usedIds.add(pick.id);
    if (pick.templateFingerprint) usedTemplates.add(pick.templateFingerprint);
    prevStimulus = pick.stimulusKey;
    slots.push({ index: pos.index, blueprintObjectiveTargetId: pos.blueprintObjectiveTargetId, assessmentComponentId: pos.assessmentComponentId, approvedItemId: pick.id, marks: pick.marks, difficultyIndex: pick.difficultyIndex ?? DEFAULT_INDEX, contentOrigin: pick.contentOrigin });
  }

  const components: ComponentFidelity[] = [];
  for (const s of slots) {
    let c = components.find((x) => x.componentId === s.assessmentComponentId);
    if (!c) {
      c = { componentId: s.assessmentComponentId, officialMarks: params.officialMarksByComponent[s.assessmentComponentId] ?? null, officialItems: params.officialItemsByComponent?.[s.assessmentComponentId] ?? null, plannedMarks: 0, positions: 0, filled: 0 };
      components.push(c);
    }
    c.positions += 1;
    if (s.approvedItemId) {
      c.filled += 1;
      c.plannedMarks += s.marks;
    }
  }

  const filled = slots.filter((s) => s.approvedItemId);
  const totalMarks = filled.reduce((n, s) => n + s.marks, 0);
  const difficultyIndex = totalMarks > 0 ? Math.round((filled.reduce((n, s) => n + (s.difficultyIndex ?? DEFAULT_INDEX) * s.marks, 0) / totalMarks) * 1000) / 1000 : null;
  const officialTotal = components.reduce((n, c) => n + (c.officialMarks ?? 0), 0);
  // A form is only FULL against a published size (marks or item count); an unknown size is never assumed to be met.
  const sizeKnown = components.every((c) => c.officialMarks !== null || c.officialItems !== null);
  const marksComplete = sizeKnown && components.every((c) => (c.officialMarks !== null ? c.plannedMarks >= c.officialMarks : true) && (c.officialItems !== null ? c.filled >= c.officialItems : true));
  const allFilled = filled.length === slots.length;
  const officialItemsTotal = components.reduce((n, c) => n + (c.officialMarks === null ? c.officialItems ?? 0 : 0), 0);
  const coveragePercent = officialTotal > 0 && officialItemsTotal === 0
    ? Math.min(100, Math.round((totalMarks / officialTotal) * 100))
    : officialItemsTotal > 0 && officialTotal === 0
      ? Math.min(100, Math.round((filled.length / officialItemsTotal) * 100))
      : officialTotal > 0 ? Math.min(100, Math.round((totalMarks / officialTotal) * 100)) : slots.length > 0 ? Math.round((filled.length / slots.length) * 100) : 0;

  const band = params.mode === 'CHALLENGE' ? CHALLENGE_BAND : params.mode === 'MOCK' ? MOCK_BAND : null;
  const difficultyBandMet = band === null || (difficultyIndex !== null && difficultyIndex >= band.min && difficultyIndex <= band.max);
  const notes: string[] = [];
  if (!allFilled) notes.push('UNFILLED_POSITIONS');
  if (!sizeKnown) notes.push('OFFICIAL_SIZE_UNKNOWN');
  else if (!marksComplete) notes.push('BELOW_OFFICIAL_SIZE');
  if (!difficultyBandMet) notes.push(params.mode === 'CHALLENGE' ? 'CHALLENGE_BAND_NOT_REACHED' : 'MOCK_BAND_NOT_REACHED');

  const missingByObjective = new Map<string | null, number>();
  const objectiveOfPosition = new Map(params.positions.map((p) => [p.index, p.learningObjectiveId]));
  for (const s of slots) if (!s.approvedItemId) missingByObjective.set(objectiveOfPosition.get(s.index) ?? null, (missingByObjective.get(objectiveOfPosition.get(s.index) ?? null) ?? 0) + 1);
  const shortages = [...missingByObjective.entries()].map(([learningObjectiveId, missing]) => ({ learningObjectiveId, missing }));
  const repeatedForStudent = filled.filter((s) => params.usage.approvedItemIds.has(s.approvedItemId!)).length;
  return { v: 1, mode: params.mode, targetDifficulty: target, difficultyIndex, slots, components, fidelity: allFilled && marksComplete ? 'FULL' : 'REDUCED', coveragePercent, difficultyBandMet, notes, shortages, repeatedForStudent };
}

/** Practice adapts between sessions: a strong result moves the Student up a level, a weak one down. */
export function nextPracticeLevel(current: PracticeLevel, lastFraction: number | null): PracticeLevel {
  const order: PracticeLevel[] = ['FOUNDATION', 'STANDARD', 'ADVANCED', 'CHALLENGE'];
  const i = order.indexOf(current);
  if (lastFraction === null) return current;
  if (lastFraction >= 0.8) return order[Math.min(order.length - 1, i + 1)];
  if (lastFraction < 0.5) return order[Math.max(0, i - 1)];
  return current;
}
