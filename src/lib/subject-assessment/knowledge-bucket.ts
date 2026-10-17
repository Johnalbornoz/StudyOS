/**
 * Knowledge buckets of a completed subject Test / Mock attempt (pure, no IO) -- APPROVED 2026-10-17.
 *
 * DIAGNOSTIC ONLY: a bucket is a label read from the attempt's own frozen items and recorded grades. It never erases,
 * replaces or rewrites evidence, and it is not an engine stage (the engine's internal-assessment rule -- revalidation
 * below 60, alert 60-79 -- is applied by the engine from the per-concept evidence, independently of this label).
 *
 *   overallScore        correct / total over every item (UNANSWERED in the denominator: subjectAssessmentScorePercent)
 *   basicScore          the same over the items at level 2 (BASIC); null when the attempt has no item at that level
 *   intermediateScore   level 3 (INTERMEDIATE); null when none
 *   advancedScore       level 4 (ADVANCED); null when none
 *   highestDifficultyDemonstrated  the highest of BASIC / INTERMEDIATE / ADVANCED whose score is >= 80, else null
 *   conceptScore        per concept, same rule
 *   knowledgeBucket
 *     B1 CRITICAL_GAP   overall < 60   (the engine's revalidation applies to Practice; this only labels it)
 *     B2 DEVELOPING     60 <= overall < 80   (alert)
 *     B4 ADVANCED       overall >= 80 AND advanced >= 80
 *     B3 COMPETENT      overall >= 80 AND intermediate >= 80 (and not B4)
 *     B3 + B4 both qualify -> B4 wins.
 *     null              overall >= 80 but neither B3 nor B4 can be demonstrated (no intermediate / advanced item, or both
 *                       below 80): classificationStatus INSUFFICIENT_DIFFICULTY_EVIDENCE (APPROVED D69, 2026-10-17) --
 *                       never forced into B2, never called Competent on the overall alone ("Evidencia de nivel
 *                       insuficiente"); `unclassifiedReason` keeps the detail. Scores and evidence are kept as they are.
 *
 * The item's level is the level it was generated at (`plannedDifficultyLevel`), else its recorded `difficulty`. Only
 * levels 2 / 3 / 4 are banded; an item at level 1 or 5 (possible with AUTO difficulty) counts in the overall and the
 * concept scores but in no level score (`unbandedItemCount`).
 */
import { subjectAssessmentScorePercent, SUBJECT_ASSESSMENT_PASS_PERCENT } from './sizing';

export const KNOWLEDGE_BUCKETS = ['B1_CRITICAL_GAP', 'B2_DEVELOPING', 'B3_COMPETENT', 'B4_ADVANCED'] as const;
export type KnowledgeBucket = (typeof KNOWLEDGE_BUCKETS)[number];
export type DifficultyLevelName = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED';
export type ClassificationStatus = 'CLASSIFIED' | 'INSUFFICIENT_DIFFICULTY_EVIDENCE';
export type UnclassifiedReason = 'OVERALL_80_INTERMEDIATE_BELOW_80' | 'OVERALL_80_ADVANCED_BELOW_80_NO_INTERMEDIATE' | 'OVERALL_80_NO_INTERMEDIATE_OR_ADVANCED_EVIDENCE';

/** Below this overall score the attempt is a critical gap (the engine's strongContradictionBelow). */
export const CRITICAL_GAP_BELOW = 60;
/** A level / overall score at or above this demonstrates it (the pass mark). */
export const DEMONSTRATED_AT = SUBJECT_ASSESSMENT_PASS_PERCENT;

const LEVEL_NAME_OF: Record<number, DifficultyLevelName> = { 2: 'BASIC', 3: 'INTERMEDIATE', 4: 'ADVANCED' };

export interface BucketItem {
  conceptId: string;
  /** The level the item was generated at (1-5), or its recorded difficulty. */
  level: number | null | undefined;
  /** true correct, false incorrect, null UNANSWERED (0 in the denominator). */
  correct: boolean | null;
}

export interface KnowledgeProfile {
  version: 'knowledge-bucket-v1';
  overallScore: number;
  basicScore: number | null;
  intermediateScore: number | null;
  advancedScore: number | null;
  levelCounts: Record<DifficultyLevelName, number>;
  unbandedItemCount: number;
  highestDifficultyDemonstrated: DifficultyLevelName | null;
  conceptScore: Record<string, number>;
  knowledgeBucket: KnowledgeBucket | null;
  classificationStatus: ClassificationStatus;
  unclassifiedReason: UnclassifiedReason | null;
}

export function levelNameOf(level: number | null | undefined): DifficultyLevelName | null {
  return typeof level === 'number' && Number.isFinite(level) ? LEVEL_NAME_OF[Math.round(level)] ?? null : null;
}

/** The bucket rule over the scores alone (null scores = no items at that level). */
export function knowledgeBucketFor(s: { overallScore: number; intermediateScore: number | null; advancedScore: number | null }): { bucket: KnowledgeBucket | null; classificationStatus: ClassificationStatus; unclassifiedReason: UnclassifiedReason | null } {
  const classified = (bucket: KnowledgeBucket) => ({ bucket, classificationStatus: 'CLASSIFIED' as const, unclassifiedReason: null });
  if (s.overallScore < CRITICAL_GAP_BELOW) return classified('B1_CRITICAL_GAP');
  if (s.overallScore < DEMONSTRATED_AT) return classified('B2_DEVELOPING');
  // B4 is checked first: when B3 and B4 both qualify, B4 wins
  if (s.advancedScore !== null && s.advancedScore >= DEMONSTRATED_AT) return classified('B4_ADVANCED');
  if (s.intermediateScore !== null && s.intermediateScore >= DEMONSTRATED_AT) return classified('B3_COMPETENT');
  return {
    bucket: null,
    classificationStatus: 'INSUFFICIENT_DIFFICULTY_EVIDENCE',
    unclassifiedReason: s.intermediateScore !== null ? 'OVERALL_80_INTERMEDIATE_BELOW_80' : s.advancedScore !== null ? 'OVERALL_80_ADVANCED_BELOW_80_NO_INTERMEDIATE' : 'OVERALL_80_NO_INTERMEDIATE_OR_ADVANCED_EVIDENCE',
  };
}

/** The knowledge profile of one completed attempt, from its frozen items and recorded grades. */
export function knowledgeProfile(items: readonly BucketItem[]): KnowledgeProfile {
  const level: Record<DifficultyLevelName, { total: number; correct: number }> = { BASIC: { total: 0, correct: 0 }, INTERMEDIATE: { total: 0, correct: 0 }, ADVANCED: { total: 0, correct: 0 } };
  const concept = new Map<string, { total: number; correct: number }>();
  let correct = 0;
  let unbanded = 0;
  for (const it of items) {
    const ok = it.correct === true ? 1 : 0;
    correct += ok;
    const c = concept.get(it.conceptId) ?? { total: 0, correct: 0 };
    c.total++; c.correct += ok;
    concept.set(it.conceptId, c);
    const name = levelNameOf(it.level);
    if (name) { level[name].total++; level[name].correct += ok; } else unbanded++;
  }
  const score = (x: { total: number; correct: number }) => (x.total > 0 ? subjectAssessmentScorePercent(x.correct, x.total) : null);
  const overallScore = subjectAssessmentScorePercent(correct, items.length);
  const basicScore = score(level.BASIC);
  const intermediateScore = score(level.INTERMEDIATE);
  const advancedScore = score(level.ADVANCED);
  const highestDifficultyDemonstrated: DifficultyLevelName | null =
    advancedScore !== null && advancedScore >= DEMONSTRATED_AT ? 'ADVANCED'
      : intermediateScore !== null && intermediateScore >= DEMONSTRATED_AT ? 'INTERMEDIATE'
        : basicScore !== null && basicScore >= DEMONSTRATED_AT ? 'BASIC' : null;
  const { bucket, classificationStatus, unclassifiedReason } = knowledgeBucketFor({ overallScore, intermediateScore, advancedScore });
  return {
    version: 'knowledge-bucket-v1',
    overallScore, basicScore, intermediateScore, advancedScore,
    levelCounts: { BASIC: level.BASIC.total, INTERMEDIATE: level.INTERMEDIATE.total, ADVANCED: level.ADVANCED.total },
    unbandedItemCount: unbanded,
    highestDifficultyDemonstrated,
    conceptScore: Object.fromEntries([...concept.entries()].map(([id, x]) => [id, subjectAssessmentScorePercent(x.correct, x.total)])),
    knowledgeBucket: bucket,
    classificationStatus,
    unclassifiedReason,
  };
}

/** Group view: how many students' latest completed attempts fall in each bucket (null = INSUFFICIENT_DIFFICULTY_EVIDENCE). */
export function bucketDistribution(buckets: ReadonlyArray<KnowledgeBucket | null>): Record<KnowledgeBucket | 'INSUFFICIENT_DIFFICULTY_EVIDENCE', number> {
  const out: Record<KnowledgeBucket | 'INSUFFICIENT_DIFFICULTY_EVIDENCE', number> = { B1_CRITICAL_GAP: 0, B2_DEVELOPING: 0, B3_COMPETENT: 0, B4_ADVANCED: 0, INSUFFICIENT_DIFFICULTY_EVIDENCE: 0 };
  for (const b of buckets) out[b ?? 'INSUFFICIENT_DIFFICULTY_EVIDENCE']++;
  return out;
}

/** i18n keys (src/lib/i18n/messages.ts) of the bucket and level labels, shared by the Teacher and Student views. */
export const KNOWLEDGE_BUCKET_LABEL_KEY = {
  B1_CRITICAL_GAP: 'kb.bucket.B1_CRITICAL_GAP', B2_DEVELOPING: 'kb.bucket.B2_DEVELOPING', B3_COMPETENT: 'kb.bucket.B3_COMPETENT', B4_ADVANCED: 'kb.bucket.B4_ADVANCED', INSUFFICIENT_DIFFICULTY_EVIDENCE: 'kb.bucket.INSUFFICIENT_DIFFICULTY_EVIDENCE',
} as const;
export const DIFFICULTY_LEVEL_LABEL_KEY = { BASIC: 'kb.level.BASIC', INTERMEDIATE: 'kb.level.INTERMEDIATE', ADVANCED: 'kb.level.ADVANCED' } as const;
