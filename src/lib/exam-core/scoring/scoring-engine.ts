/**
 * Track B / B1 -- the deterministic scoring engine. Pure: no DB, no AI, no
 * clock, no randomness. The same response set + the same policy always
 * produces the same result (and the same provenance hashes).
 *
 * The engine only aggregates marks the graders already produced; it never
 * grades an answer itself and never reads or writes cognition. Its output is
 * EXAM truth (score/result); mastery stays with the Learning Engine.
 */
import { hashCanonical, SCORING_ENGINE_VERSION, type ScoringPolicy, type ScoringTransform } from './scoring-policy';

export type ScoringItemStatus = 'ANSWERED' | 'INVALID' | 'MISSING' | 'EXCLUDED';

export interface ScoringCriterionAward {
  criterionId: string;
  awarded: number;
  max: number;
}

export interface ScoringItem {
  targetIndex: number;
  componentId: string;
  learningObjectiveId: string | null;
  questionType: string | null;
  status: ScoringItemStatus;
  /** Grader fraction 0..1 for ANSWERED items; ignored otherwise. */
  fraction: number | null;
  /** The item's marks; null when the item was never delivered (policy default applies). */
  maxMarks: number | null;
  /** Per-criterion awards (mark-scheme parts); optional. */
  criteria?: ScoringCriterionAward[];
}

export interface ScoringSection {
  componentId: string;
  key: string;
  name: string;
  order: number;
}

export interface SectionResult {
  componentId: string;
  key: string;
  name: string;
  earned: number;
  available: number;
  fraction: number | null;
  weight: number | null;
  answered: number;
  invalid: number;
  missing: number;
  excluded: number;
}

export type ObjectiveClassification = 'STRENGTH' | 'DEVELOPING' | 'GAP' | 'NOT_ASSESSED';

export interface ObjectiveResult {
  learningObjectiveId: string;
  earned: number;
  available: number;
  fraction: number | null;
  classification: ObjectiveClassification;
}

export interface CriterionResult {
  criterionId: string;
  earned: number;
  available: number;
  fraction: number | null;
  weight: number;
}

export interface TransformationStep {
  step: string;
  input: number | null;
  output: number | string | null;
}

export interface ScoringOutcome {
  engineVersion: string;
  scoringStatus: 'SCORED' | 'NO_SCORING_POLICY';
  policyHash: string | null;
  strategy: ScoringPolicy['strategy'] | null;
  raw: { earned: number; available: number };
  fraction: number | null;
  final: { value: number | null; label: string | null; unit: string | null; official: boolean };
  sections: SectionResult[];
  objectives: ObjectiveResult[];
  criteria: CriterionResult[];
  transformations: TransformationStep[];
  counts: { answered: number; invalid: number; missing: number; excluded: number; total: number };
  responseSetHash: string;
}

const DEFAULT_REPORTING = { strengthFraction: 0.75, gapFraction: 0.5 };

/** Fixed-precision rounding: removes float drift so equal inputs hash equally. */
export function round(value: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

function clampFraction(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function itemMarks(item: ScoringItem, policy: ScoringPolicy | null): number {
  if (item.maxMarks !== null && Number.isFinite(item.maxMarks) && item.maxMarks > 0) return item.maxMarks;
  return policy?.defaultItemMarks ?? 1;
}

/** Earned marks for one item under the policy's partial-credit rule. */
function itemEarned(item: ScoringItem, marks: number, policy: ScoringPolicy | null): number {
  if (item.status !== 'ANSWERED') return 0;
  const fraction = clampFraction(item.fraction);
  if (policy && !policy.partialCredit && fraction < 1) return 0;
  return round(fraction * marks);
}

export function applyTransform(transform: ScoringTransform, fraction: number | null): { value: number | null; label: string | null; step: TransformationStep } {
  if (fraction === null) return { value: null, label: null, step: { step: transform.type, input: null, output: null } };
  switch (transform.type) {
    case 'NONE': {
      const value = round(fraction * 100, 1);
      return { value, label: null, step: { step: 'NONE(percent)', input: fraction, output: value } };
    }
    case 'LINEAR': {
      const value = round(transform.min + fraction * (transform.max - transform.min), transform.decimals);
      return { value, label: null, step: { step: `LINEAR(${transform.min}..${transform.max})`, input: fraction, output: value } };
    }
    case 'PIECEWISE': {
      const pts = transform.points;
      let value = pts[pts.length - 1][1];
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        if (fraction <= x1) {
          value = y0 + ((fraction - x0) / (x1 - x0)) * (y1 - y0);
          break;
        }
      }
      value = round(value, transform.decimals);
      return { value, label: null, step: { step: 'PIECEWISE', input: fraction, output: value } };
    }
    case 'BANDS': {
      let label = transform.bands[0].label;
      for (const band of transform.bands) if (fraction >= band.minFraction) label = band.label;
      return { value: round(fraction * 100, 1), label, step: { step: 'BANDS', input: fraction, output: label } };
    }
  }
}

function classify(fraction: number | null, reporting: { strengthFraction: number; gapFraction: number }): ObjectiveClassification {
  if (fraction === null) return 'NOT_ASSESSED';
  if (fraction >= reporting.strengthFraction) return 'STRENGTH';
  if (fraction < reporting.gapFraction) return 'GAP';
  return 'DEVELOPING';
}

export function scoreResponseSet(params: { policy: ScoringPolicy | null; sections: ScoringSection[]; items: ScoringItem[] }): ScoringOutcome {
  const { policy } = params;
  const items = [...params.items].sort((a, b) => a.targetIndex - b.targetIndex);
  const sectionsSorted = [...params.sections].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  const reporting = policy?.reporting ?? DEFAULT_REPORTING;

  const counts = { answered: 0, invalid: 0, missing: 0, excluded: 0, total: items.length };
  let earned = 0;
  let available = 0;
  let weightedEarned = 0;
  let weightedAvailable = 0;

  const sectionAcc = new Map<string, SectionResult>();
  for (const s of sectionsSorted) {
    sectionAcc.set(s.componentId, { componentId: s.componentId, key: s.key, name: s.name, earned: 0, available: 0, fraction: null, weight: null, answered: 0, invalid: 0, missing: 0, excluded: 0 });
  }
  const objectiveAcc = new Map<string, { earned: number; available: number }>();
  const criterionAcc = new Map<string, { earned: number; available: number }>();

  for (const item of items) {
    const section = sectionAcc.get(item.componentId);
    if (item.status === 'EXCLUDED') {
      counts.excluded++;
      if (section) section.excluded++;
      continue;
    }
    if (item.status === 'ANSWERED') counts.answered++;
    else if (item.status === 'INVALID') counts.invalid++;
    else counts.missing++;

    const marks = itemMarks(item, policy);
    const got = itemEarned(item, marks, policy);
    earned = round(earned + got);
    available = round(available + marks);

    const typeWeight = policy?.questionTypeWeights?.[item.questionType ?? ''] ?? 1;
    weightedEarned = round(weightedEarned + got * typeWeight);
    weightedAvailable = round(weightedAvailable + marks * typeWeight);

    if (section) {
      section.earned = round(section.earned + got);
      section.available = round(section.available + marks);
      if (item.status === 'ANSWERED') section.answered++;
      else if (item.status === 'INVALID') section.invalid++;
      else section.missing++;
    }

    if (item.learningObjectiveId) {
      const acc = objectiveAcc.get(item.learningObjectiveId) ?? { earned: 0, available: 0 };
      acc.earned = round(acc.earned + got);
      acc.available = round(acc.available + marks);
      objectiveAcc.set(item.learningObjectiveId, acc);
    }

    // Criteria: explicit per-criterion awards when the item carries them,
    // otherwise the whole item counts under the synthetic `__item` criterion.
    const criteria = item.criteria && item.criteria.length > 0 ? item.criteria : null;
    if (criteria) {
      const scale = item.status === 'ANSWERED' && !(policy && !policy.partialCredit && clampFraction(item.fraction) < 1) ? 1 : 0;
      for (const c of criteria) {
        const acc = criterionAcc.get(c.criterionId) ?? { earned: 0, available: 0 };
        acc.earned = round(acc.earned + Math.min(Math.max(c.awarded, 0), c.max) * scale);
        acc.available = round(acc.available + Math.max(c.max, 0));
        criterionAcc.set(c.criterionId, acc);
      }
    } else {
      const acc = criterionAcc.get('__item') ?? { earned: 0, available: 0 };
      acc.earned = round(acc.earned + got);
      acc.available = round(acc.available + marks);
      criterionAcc.set('__item', acc);
    }
  }

  const sections = [...sectionAcc.values()].map((s) => ({ ...s, fraction: s.available > 0 ? round(s.earned / s.available) : null }));
  const objectives: ObjectiveResult[] = [...objectiveAcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([learningObjectiveId, acc]) => {
      const fraction = acc.available > 0 ? round(acc.earned / acc.available) : null;
      return { learningObjectiveId, earned: acc.earned, available: acc.available, fraction, classification: classify(fraction, reporting) };
    });
  const criteria: CriterionResult[] = [...criterionAcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([criterionId, acc]) => ({
      criterionId,
      earned: acc.earned,
      available: acc.available,
      fraction: acc.available > 0 ? round(acc.earned / acc.available) : null,
      weight: policy?.criterionWeights?.[criterionId] ?? 1,
    }));

  const responseSetHash = hashCanonical(
    items.map((i) => ({ t: i.targetIndex, c: i.componentId, o: i.learningObjectiveId, q: i.questionType, s: i.status, f: i.status === 'ANSWERED' ? round(clampFraction(i.fraction)) : null, m: i.maxMarks, k: i.criteria ?? null }))
  );

  const base = { engineVersion: SCORING_ENGINE_VERSION, raw: { earned, available }, objectives, criteria, counts, responseSetHash };

  if (!policy) {
    for (const s of sections) s.weight = null;
    return {
      ...base,
      scoringStatus: 'NO_SCORING_POLICY',
      policyHash: null,
      strategy: null,
      fraction: null,
      final: { value: null, label: null, unit: null, official: false },
      sections,
      transformations: [],
    };
  }

  const transformations: TransformationStep[] = [];
  let fraction: number | null = null;

  switch (policy.strategy) {
    case 'RAW':
      fraction = available > 0 ? round(earned / available) : null;
      transformations.push({ step: 'RAW(earned/available)', input: null, output: fraction });
      break;
    case 'WEIGHTED_ITEMS':
      fraction = weightedAvailable > 0 ? round(weightedEarned / weightedAvailable) : null;
      transformations.push({ step: 'WEIGHTED_ITEMS(sum(w*earned)/sum(w*marks))', input: null, output: fraction });
      break;
    case 'SECTION_WEIGHTED': {
      let num = 0;
      let den = 0;
      for (const s of sections) {
        const w = policy.sectionWeights?.[s.key] ?? 0;
        s.weight = w;
        if (s.fraction === null || w <= 0) continue;
        num = round(num + w * s.fraction);
        den = round(den + w);
      }
      fraction = den > 0 ? round(num / den) : null;
      transformations.push({ step: 'SECTION_WEIGHTED(sum(w*fraction)/sum(w))', input: null, output: fraction });
      break;
    }
    case 'CRITERIA': {
      let num = 0;
      let den = 0;
      for (const c of criteria) {
        if (c.fraction === null || c.weight <= 0) continue;
        num = round(num + c.weight * c.fraction);
        den = round(den + c.weight);
      }
      fraction = den > 0 ? round(num / den) : null;
      transformations.push({ step: 'CRITERIA(sum(w*criterionFraction)/sum(w))', input: null, output: fraction });
      break;
    }
  }

  const transformed = applyTransform(policy.transform, fraction);
  transformations.push(transformed.step);

  return {
    ...base,
    scoringStatus: 'SCORED',
    policyHash: hashCanonical(policy),
    strategy: policy.strategy,
    fraction,
    final: {
      value: transformed.value,
      label: transformed.label,
      unit: policy.unit ?? (policy.transform.type === 'NONE' || policy.transform.type === 'BANDS' ? '%' : null),
      official: policy.provenance.official,
    },
    sections,
    transformations,
  };
}
