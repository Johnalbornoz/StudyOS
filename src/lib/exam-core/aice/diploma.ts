/**
 * Cambridge AICE Diploma -- planning and award evaluation (pure).
 *
 *   evaluateDiplomaPlan     planned subjects -> credits per group and which
 *                           composition requirements are met ("5 of 7 credits
 *                           planned", "Group 1: 1/1"). Planning, not an award.
 *   evaluateDiplomaResults  recorded results -> the 25-month / 5-series window
 *                           per result, the best VALID combination (core,
 *                           Groups 1-3, Group 4 limit, official exceptions),
 *                           its points and award band. A band is returned only
 *                           when the composition rules are met -- never from
 *                           points alone.
 *
 * Group choice for multi-group subjects is the Student's (`countedGroup`);
 * it is never resolved automatically.
 */
import { AICE_DIPLOMA_POLICY, creditsFor, pointsFor, isPass, isValidGrade, bandFor, seriesIndex, expiresAfter, type AicePolicy, type AiceGroup, type AiceLevel, type ExamSeries } from './policy';

export interface SubjectRule {
  code: string;
  name: string;
  levels: AiceLevel[];
  /** Groups this subject can count in (Cambridge curriculum); CORE for 9239. */
  groups: AiceGroup[];
}

export interface PlanEntryInput {
  syllabusCode: string;
  level: AiceLevel;
  countedGroup: AiceGroup | null;
}

export interface GroupProgress {
  group: AiceGroup;
  credits: number;
  required: number;
  max: number | null;
  satisfied: boolean;
}

export interface PlanEvaluation {
  totalCredits: number;
  minimumCredits: number;
  coreIncluded: boolean;
  groups: GroupProgress[];
  /** Every composition requirement met by the plan (planning only). */
  complete: boolean;
  issues: Array<{ code: 'CORE_MISSING' | 'GROUP_MISSING' | 'GROUP_4_OVER_LIMIT' | 'CREDITS_SHORT' | 'GROUP_NOT_CHOSEN' | 'LEVEL_NOT_OFFERED' | 'UNKNOWN_SUBJECT' | 'DUPLICATE_SUBJECT'; group?: AiceGroup; syllabusCode?: string }>;
}

const NON_CORE: AiceGroup[] = ['GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4'];

/** Where a subject's credits go: CORE for 9239, its only group, or the Student's choice among its groups. */
export function countedGroupFor(subject: SubjectRule, chosen: AiceGroup | null, policy: AicePolicy = AICE_DIPLOMA_POLICY): AiceGroup | null {
  if (subject.code === policy.coreSyllabus.value) return 'CORE';
  const eligible: AiceGroup[] = subject.groups.filter((g) => g !== 'CORE');
  if (eligible.length === 1) return eligible[0];
  return chosen && eligible.includes(chosen) ? chosen : null;
}

/** Credits by group for a set of (subject, level, counted group) -- A Level GP&R adds its Group 4 credit. */
function creditsByGroup(items: Array<{ subject: SubjectRule; level: AiceLevel; group: AiceGroup | null }>, policy: AicePolicy) {
  const by: Record<AiceGroup, number> = { CORE: 0, GROUP_1: 0, GROUP_2: 0, GROUP_3: 0, GROUP_4: 0 };
  let unassigned = 0;
  for (const it of items) {
    const c = creditsFor(it.level, policy);
    if (it.group === 'CORE') {
      by.CORE += 1;
      if (it.level === 'A' && policy.gprALevelExtraGroup4Credit.value) by.GROUP_4 += c - 1;
    } else if (it.group) by[it.group] += c;
    else unassigned += c;
  }
  return { by, unassigned, total: Object.values(by).reduce((a, b) => a + b, 0) + unassigned };
}

export function evaluateDiplomaPlan(entries: PlanEntryInput[], catalog: Map<string, SubjectRule>, policy: AicePolicy = AICE_DIPLOMA_POLICY): PlanEvaluation {
  const issues: PlanEvaluation['issues'] = [];
  const seen = new Set<string>();
  const items: Array<{ subject: SubjectRule; level: AiceLevel; group: AiceGroup | null }> = [];
  for (const e of entries) {
    const subject = catalog.get(e.syllabusCode);
    if (!subject) {
      issues.push({ code: 'UNKNOWN_SUBJECT', syllabusCode: e.syllabusCode });
      continue;
    }
    if (seen.has(e.syllabusCode)) {
      issues.push({ code: 'DUPLICATE_SUBJECT', syllabusCode: e.syllabusCode });
      continue;
    }
    seen.add(e.syllabusCode);
    if (!subject.levels.includes(e.level)) issues.push({ code: 'LEVEL_NOT_OFFERED', syllabusCode: e.syllabusCode });
    const group = countedGroupFor(subject, e.countedGroup, policy);
    if (!group) issues.push({ code: 'GROUP_NOT_CHOSEN', syllabusCode: e.syllabusCode });
    items.push({ subject, level: e.level, group });
  }
  const { by, total } = creditsByGroup(items, policy);
  const coreIncluded = items.some((i) => i.group === 'CORE');
  if (!coreIncluded) issues.push({ code: 'CORE_MISSING' });
  const groups: GroupProgress[] = NON_CORE.map((g) => {
    const required = (policy.requiredGroups.value as readonly AiceGroup[]).includes(g) ? 1 : 0;
    const max = g === 'GROUP_4' ? policy.group4MaxCredits.value : null;
    const satisfied = by[g] >= required && (max === null || by[g] <= max);
    if (by[g] < required) issues.push({ code: 'GROUP_MISSING', group: g });
    if (max !== null && by[g] > max) issues.push({ code: 'GROUP_4_OVER_LIMIT', group: g });
    return { group: g, credits: by[g], required, max, satisfied };
  });
  // Credits over the Group 4 limit do not count towards the total.
  const countable = total - Math.max(0, by.GROUP_4 - policy.group4MaxCredits.value);
  if (countable < policy.minimumCredits.value) issues.push({ code: 'CREDITS_SHORT' });
  return { totalCredits: countable, minimumCredits: policy.minimumCredits.value, coreIncluded, groups, complete: issues.length === 0, issues };
}

// ---------------------------------------------------------------- results

export interface ResultInput {
  id: string;
  syllabusCode: string;
  level: AiceLevel;
  grade: string;
  series: ExamSeries;
}

export type ResultWindowStatus = 'ELIGIBLE' | 'OUTSIDE_WINDOW' | 'NOT_A_PASS' | 'INVALID_GRADE' | 'SUPERSEDED' | 'NOT_COUNTED';

export interface ResultView {
  id: string;
  syllabusCode: string;
  level: AiceLevel;
  grade: string;
  series: ExamSeries;
  points: number;
  status: ResultWindowStatus;
  expiresAfter: ExamSeries;
  counted: boolean;
}

export interface DiplomaEvaluation {
  /** The series the 25-month window ends at (the latest passing result, or the planned final series). */
  windowEnd: ExamSeries | null;
  results: ResultView[];
  counted: string[];
  credits: number;
  points: number;
  compositionValid: boolean;
  band: 'DISTINCTION' | 'MERIT' | 'PASS' | null;
  issues: PlanEvaluation['issues'];
  assumptions: string[];
}


function* subsets<T>(arr: T[], start = 0, acc: T[] = []): Generator<T[]> {
  yield acc;
  for (let i = start; i < arr.length; i++) yield* subsets(arr, i + 1, [...acc, arr[i]]);
}

export function evaluateDiplomaResults(
  results: ResultInput[],
  catalog: Map<string, SubjectRule>,
  countedGroups: Map<string, AiceGroup | null>,
  opts: { windowEnd?: ExamSeries; policy?: AicePolicy } = {}
): DiplomaEvaluation {
  const policy = opts.policy ?? AICE_DIPLOMA_POLICY;
  const passing = results.filter((r) => isValidGrade(r.level, r.grade) && isPass(r.grade));
  const end = opts.windowEnd ?? (passing.length ? passing.reduce((a, b) => (seriesIndex(b.series) > seriesIndex(a.series) ? b : a)).series : null);
  const span = policy.window.value.months - 1;
  const views = new Map<string, ResultView>();
  for (const r of results) {
    const status: ResultWindowStatus = !isValidGrade(r.level, r.grade)
      ? 'INVALID_GRADE'
      : !isPass(r.grade)
        ? 'NOT_A_PASS'
        : !end || seriesIndex(end) - seriesIndex(r.series) > span || seriesIndex(r.series) > seriesIndex(end)
          ? 'OUTSIDE_WINDOW'
          : 'ELIGIBLE';
    views.set(r.id, { id: r.id, syllabusCode: r.syllabusCode, level: r.level, grade: r.grade, series: r.series, points: pointsFor(r.level, r.grade, policy), status, expiresAfter: expiresAfter(r.series, policy), counted: false });
  }
  // One counted instance per syllabus: the best eligible result (A Level over AS when points are higher).
  const bestBySyllabus = new Map<string, ResultView>();
  for (const v of views.values()) {
    if (v.status !== 'ELIGIBLE') continue;
    const cur = bestBySyllabus.get(v.syllabusCode);
    const better = !cur || v.points > cur.points || (v.points === cur.points && seriesIndex(v.series) > seriesIndex(cur.series));
    if (better) {
      if (cur) cur.status = 'SUPERSEDED';
      bestBySyllabus.set(v.syllabusCode, v);
    } else v.status = 'SUPERSEDED';
  }
  const candidates = [...bestBySyllabus.values()].filter((v) => catalog.has(v.syllabusCode));
  const core = candidates.find((v) => v.syllabusCode === policy.coreSyllabus.value) ?? null;
  const others = candidates.filter((v) => v !== core);

  const issues: PlanEvaluation['issues'] = [];
  if (!core) issues.push({ code: 'CORE_MISSING' });
  let best: { set: ResultView[]; points: number; credits: number; series: number } | null = null;
  if (core) {
    const gprA = core.level === 'A';
    const groupOf = (v: ResultView) => countedGroupFor(catalog.get(v.syllabusCode)!, countedGroups.get(v.syllabusCode) ?? null, policy);
    for (const set of subsets(others)) {
      const all = [core, ...set];
      const credits = all.reduce((n, v) => n + creditsFor(v.level, policy), 0);
      const threeALevelsException = gprA && policy.gprALevelPlusThreeALevels.value && set.length === 3 && set.every((v) => v.level === 'A') && credits === 8;
      if (credits !== policy.minimumCredits.value && !threeALevelsException) continue;
      const items = all.map((v) => ({ subject: catalog.get(v.syllabusCode)!, level: v.level, group: groupOf(v) }));
      if (items.some((i) => !i.group)) continue;
      const { by } = creditsByGroup(items, policy);
      if (!(policy.requiredGroups.value as readonly AiceGroup[]).every((g) => by[g] >= 1)) continue;
      const tsOver = gprA && set.some((v) => v.syllabusCode === policy.thinkingSkillsAOverGroup4WithGprA.value && v.level === 'A');
      if (by.GROUP_4 > policy.group4MaxCredits.value && !tsOver) continue;
      const seriesCount = new Set(all.map((v) => seriesIndex(v.series))).size;
      if (seriesCount > policy.window.value.maxSeries) continue;
      const points = Math.min(policy.maxScore.value, all.reduce((n, v) => n + v.points, 0));
      if (!best || points > best.points || (points === best.points && seriesCount < best.series)) best = { set: all, points, credits, series: seriesCount };
    }
  }
  if (core && !best) {
    // Explain what is missing for the eligible results as a plan.
    const plan = evaluateDiplomaPlan(candidates.map((v) => ({ syllabusCode: v.syllabusCode, level: v.level, countedGroup: countedGroups.get(v.syllabusCode) ?? null })), catalog, policy);
    issues.push(...plan.issues.filter((i) => i.code !== 'CORE_MISSING'));
  }
  for (const v of views.values()) if (v.status === 'ELIGIBLE') v.status = best?.set.includes(v) ? 'ELIGIBLE' : 'NOT_COUNTED';
  for (const v of best?.set ?? []) v.counted = true;
  const assumptions = [policy.oneCountedInstancePerSyllabus, policy.bestEligibleRetake, policy.scoreMethod].filter((r) => !r.confirmed).map((r) => r.note ?? '');
  return {
    windowEnd: end,
    results: [...views.values()],
    counted: best?.set.map((v) => v.id) ?? [],
    credits: best?.credits ?? 0,
    points: best?.points ?? 0,
    compositionValid: !!best,
    band: best ? bandFor(best.points, policy) : null,
    issues,
    assumptions,
  };
}
