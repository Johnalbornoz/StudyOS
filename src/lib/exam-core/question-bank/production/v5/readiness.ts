/**
 * Question Factory V5 -- blueprint readiness from the global certified bank.
 *
 * Readiness is a function of two things only: the governed blueprints and the Student-eligible items of the GLOBAL
 * bank. No Student, no per-Student cache and no generation call enters it. It never answers "not available yet":
 * every NOT_READY carries the buckets that block it, each with required / available / gap.
 *
 * Two honest limits are stated as blockers rather than hidden:
 *   - a blueprint shorter than the official form is a REDUCED blueprint; it can make a reduced mock ready, never a
 *     full mock (FULL_FORM_BLUEPRINT_NOT_GOVERNED);
 *   - a competency benchmark (rotated booklets) has no mock at all (NOT_APPLICABLE).
 *
 * Pure.
 */
import { EXAM_FAMILIES, EXAM_FAMILY_DESCRIPTORS, type ExamFamily } from '../../../taxonomy';
import { resolveProfile, type DifficultyTier } from './generation-profile';

export const READINESS_ENGINE_VERSION = 'qf-v5-readiness-1';
/** StudyUs policy, not an official rule. */
export const READINESS_POLICY = { practiceMinPerBucket: 1, repeatableForms: 3, challengeMinTotal: 5, challengeMinPerSection: 1 } as const;

export interface BlueprintSection {
  configKey: string; family: ExamFamily; sectionKey: string; componentType: string; simulationCapable: boolean;
  /** Items of the official full form, when the framework publishes it. */
  officialItemCount: number | null;
  fullFormDocumented: boolean;
  buckets: { bucketKey: string; objectiveCode: string; required: number }[];
}

export const bucketKeyOf = (configKey: string, sectionKey: string, objectiveCode: string, targetIndex: number): string => `${configKey}/${sectionKey}/${objectiveCode}#${targetIndex}`;

interface ConfigLike { key: string; family: ExamFamily; sections: { key: string; componentType: string; simulationCapable?: boolean; objectives: { code: string; targets: { count?: number }[] }[]; definition?: { officialItemCount?: number | null; blueprintSpecification?: { status: string } } }[] }
export function blueprintSections(configs: readonly ConfigLike[]): BlueprintSection[] {
  return configs.flatMap((c) => c.sections.map((s) => ({
    configKey: c.key, family: c.family, sectionKey: s.key, componentType: s.componentType, simulationCapable: s.simulationCapable ?? true,
    officialItemCount: s.definition?.officialItemCount ?? null,
    fullFormDocumented: s.definition?.blueprintSpecification?.status === 'DOCUMENTED',
    buckets: s.objectives.flatMap((o) => o.targets.map((t, i) => ({ bucketKey: bucketKeyOf(c.key, s.key, o.code, i), objectiveCode: o.code, required: t.count ?? 1 }))),
  })));
}

/** One item of the global bank, as readiness sees it. `studentEligible` is decided by the bank's own policy. */
export interface BankItem { itemId: string; bucketKey: string; difficulty: DifficultyTier; itemType: string; studentEligible: boolean }

export type Gate = 'READY' | 'NOT_READY' | 'NOT_APPLICABLE';
export interface Blocker { code: string; bucket: string; required: number | null; available: number; gap: number | null }
export interface ModeReadiness { state: Gate; blockers: Blocker[] }
export interface FamilyReadiness {
  family: ExamFamily; eligibleItems: number;
  bySection: Record<string, { profileId: string | null; required: number; eligible: number; byDifficulty: Record<DifficultyTier, number>; byItemType: Record<string, number> }>;
  practice: ModeReadiness; reducedMock: ModeReadiness; fullMock: ModeReadiness; repeatableFullMock: ModeReadiness; challenge: ModeReadiness;
  coveragePercent: number; uniquePoolDepth: number;
}

const ready = (blockers: Blocker[]): ModeReadiness => ({ state: blockers.length ? 'NOT_READY' : 'READY', blockers });
const NA: ModeReadiness = { state: 'NOT_APPLICABLE', blockers: [] };

export function familyReadiness(family: ExamFamily, sections: readonly BlueprintSection[], bank: readonly BankItem[]): FamilyReadiness {
  const mine = sections.filter((s) => s.family === family);
  const bankable = mine.filter((s) => resolveProfile(s).kind === 'PROFILE');
  const eligible = bank.filter((i) => i.studentEligible);
  const per = new Map<string, BankItem[]>();
  for (const i of eligible) per.set(i.bucketKey, [...(per.get(i.bucketKey) ?? []), i]);
  const buckets = bankable.flatMap((s) => s.buckets);
  const own = new Set(buckets.map((b) => b.bucketKey));
  const inFamily = eligible.filter((i) => own.has(i.bucketKey));
  const have = (k: string) => per.get(k)?.length ?? 0;

  const shortfall = (code: string, need: (required: number) => number): Blocker[] =>
    buckets.filter((b) => have(b.bucketKey) < need(b.required)).map((b) => ({ code, bucket: b.bucketKey, required: need(b.required), available: have(b.bucketKey), gap: need(b.required) - have(b.bucketKey) }));
  const structural: Blocker[] = [
    ...(bankable.length ? [] : [{ code: 'NO_ITEM_BANKABLE_SECTION', bucket: family, required: null, available: 0, gap: null }]),
    ...mine.filter((s) => resolveProfile(s).kind === 'NO_PROFILE' && s.simulationCapable).map((s) => ({ code: 'NO_GENERATION_PROFILE', bucket: `${s.configKey}/${s.sectionKey}`, required: null, available: 0, gap: null })),
  ];
  const notFull: Blocker[] = bankable
    .filter((s) => { const slots = s.buckets.reduce((a, b) => a + b.required, 0); return !(s.fullFormDocumented || (s.officialItemCount !== null && slots >= s.officialItemCount)); })
    .map((s) => { const slots = s.buckets.reduce((a, b) => a + b.required, 0); return { code: 'FULL_FORM_BLUEPRINT_NOT_GOVERNED', bucket: `${s.configKey}/${s.sectionKey}`, required: s.officialItemCount, available: slots, gap: s.officialItemCount === null ? null : s.officialItemCount - slots }; });

  const practice = ready([...structural, ...shortfall('PRACTICE_BUCKET_EMPTY', () => READINESS_POLICY.practiceMinPerBucket)]);
  const mock = EXAM_FAMILY_DESCRIPTORS[family].assessmentSemantics !== 'COMPETENCY_BENCHMARK';
  const reduced = ready([...structural, ...shortfall('BUCKET_BELOW_BLUEPRINT', (r) => r)]);
  const full = ready([...structural, ...notFull, ...shortfall('BUCKET_BELOW_BLUEPRINT', (r) => r)]);
  const repeatable = ready([...structural, ...notFull, ...shortfall('BUCKET_BELOW_REPEATABLE_DEPTH', (r) => r * READINESS_POLICY.repeatableForms)]);
  const challengeItems = inFamily.filter((i) => i.difficulty.startsWith('CHALLENGE'));
  const challenge = ready([
    ...structural,
    ...(challengeItems.length >= READINESS_POLICY.challengeMinTotal ? [] : [{ code: 'CHALLENGE_POOL_TOO_SMALL', bucket: family, required: READINESS_POLICY.challengeMinTotal, available: challengeItems.length, gap: READINESS_POLICY.challengeMinTotal - challengeItems.length }]),
    ...bankable.filter((s) => challengeItems.filter((i) => s.buckets.some((b) => b.bucketKey === i.bucketKey)).length < READINESS_POLICY.challengeMinPerSection).map((s) => ({ code: 'SECTION_WITHOUT_CHALLENGE_ITEM', bucket: `${s.configKey}/${s.sectionKey}`, required: READINESS_POLICY.challengeMinPerSection, available: 0, gap: READINESS_POLICY.challengeMinPerSection })),
  ]);

  const required = buckets.reduce((a, b) => a + b.required, 0);
  const covered = buckets.reduce((a, b) => a + Math.min(b.required, have(b.bucketKey)), 0);
  const depth = buckets.length ? Math.min(...buckets.map((b) => Math.floor(have(b.bucketKey) / b.required))) : 0;
  const tiers = (xs: BankItem[]): Record<DifficultyTier, number> => ({ FOUNDATIONAL: xs.filter((i) => i.difficulty.startsWith('F')).length, STANDARD: xs.filter((i) => i.difficulty.startsWith('S')).length, CHALLENGE: xs.filter((i) => i.difficulty.startsWith('C')).length });
  return {
    family, eligibleItems: inFamily.length,
    bySection: Object.fromEntries(mine.map((s) => {
      const items = inFamily.filter((i) => s.buckets.some((b) => b.bucketKey === i.bucketKey));
      const r = resolveProfile(s);
      const types: Record<string, number> = {};
      for (const i of items) types[i.itemType] = (types[i.itemType] ?? 0) + 1;
      return [`${s.configKey}/${s.sectionKey}`, { profileId: r.kind === 'PROFILE' ? r.profile.profileId : null, required: s.buckets.reduce((a, b) => a + b.required, 0), eligible: items.length, byDifficulty: tiers(items), byItemType: types }];
    })),
    practice, reducedMock: mock ? reduced : NA, fullMock: mock ? full : NA, repeatableFullMock: mock ? repeatable : NA, challenge,
    coveragePercent: required ? Math.round((covered / required) * 1000) / 10 : 0, uniquePoolDepth: depth,
  };
}

export const globalReadiness = (sections: readonly BlueprintSection[], bank: readonly BankItem[]): FamilyReadiness[] => EXAM_FAMILIES.map((f) => familyReadiness(f, sections, bank));

/** Coverage-driven allocation (brief 23): empty buckets first, then practice, reduced mock, full mock, then depth. */
export interface AllocationRow { bucket: string; family: ExamFamily; profileId: string; required: number; available: number; toGenerate: number; priority: 1 | 2 | 3 }
export function generationAllocation(sections: readonly BlueprintSection[], bank: readonly BankItem[], yieldRate: number): AllocationRow[] {
  const per = new Map<string, number>();
  for (const i of bank) if (i.studentEligible) per.set(i.bucketKey, (per.get(i.bucketKey) ?? 0) + 1);
  const rows: AllocationRow[] = [];
  for (const s of sections) {
    const r = resolveProfile(s);
    if (r.kind !== 'PROFILE') continue;
    for (const b of s.buckets) {
      const available = per.get(b.bucketKey) ?? 0;
      const target = b.required * READINESS_POLICY.repeatableForms;
      if (available >= target) continue;
      rows.push({ bucket: b.bucketKey, family: s.family, profileId: r.profile.profileId, required: target, available, toGenerate: Math.ceil((target - available) / yieldRate), priority: available < 1 ? 1 : available < b.required ? 2 : 3 });
    }
  }
  return rows.sort((a, b) => a.priority - b.priority || (a.bucket < b.bucket ? -1 : 1));
}
