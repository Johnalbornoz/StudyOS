/**
 * APPROVED 2026-10-17 -- knowledge buckets of a completed subject Test / Mock attempt (diagnostic only, never erases
 * evidence): overall / per-difficulty / per-concept scores, highest difficulty demonstrated, B1..B4.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { knowledgeProfile, knowledgeBucketFor, bucketDistribution, KNOWLEDGE_BUCKET_LABEL_KEY, DIFFICULTY_LEVEL_LABEL_KEY, type BucketItem } from '@/lib/subject-assessment/knowledge-bucket';
import { aggregateGroup } from '@/lib/teacher/subject-assessment-assignment.rules';
import { MESSAGES } from '@/lib/i18n/messages';

/** n items at `level` of concept `c`, the first `right` correct, then `wrong` incorrect, the rest unanswered. */
const items = (c: string, level: number, n: number, right: number, wrong = n - right): BucketItem[] =>
  Array.from({ length: n }, (_, i) => ({ conceptId: c, level, correct: i < right ? true : i < right + wrong ? false : null }));

describe('bucket rule', () => {
  it('B1 below 60, B2 60-79 (inclusive boundaries)', () => {
    expect(knowledgeBucketFor({ overallScore: 59.9, intermediateScore: 100, advancedScore: 100 }).bucket).toBe('B1_CRITICAL_GAP');
    expect(knowledgeBucketFor({ overallScore: 60, intermediateScore: null, advancedScore: null }).bucket).toBe('B2_DEVELOPING');
    expect(knowledgeBucketFor({ overallScore: 79.9, intermediateScore: 100, advancedScore: 100 }).bucket).toBe('B2_DEVELOPING');
  });
  it('B3 = overall >= 80 AND intermediate >= 80; B4 = overall >= 80 AND advanced >= 80', () => {
    expect(knowledgeBucketFor({ overallScore: 80, intermediateScore: 80, advancedScore: 50 }).bucket).toBe('B3_COMPETENT');
    expect(knowledgeBucketFor({ overallScore: 80, intermediateScore: 80, advancedScore: null }).bucket).toBe('B3_COMPETENT');
    expect(knowledgeBucketFor({ overallScore: 90, intermediateScore: 85, advancedScore: 80 }).bucket).toBe('B4_ADVANCED');
  });
  it('edge cases are NOT invented: overall >= 80 without a qualifying level -> null with the reason (operator decision)', () => {
    expect(knowledgeBucketFor({ overallScore: 85, intermediateScore: 70, advancedScore: null })).toEqual({ bucket: null, unclassifiedReason: 'OVERALL_80_INTERMEDIATE_BELOW_80' });
    expect(knowledgeBucketFor({ overallScore: 100, intermediateScore: null, advancedScore: null })).toEqual({ bucket: null, unclassifiedReason: 'OVERALL_80_NO_INTERMEDIATE_OR_ADVANCED_EVIDENCE' });
    // the data supports B4 when the advanced items qualify, even without intermediate items
    expect(knowledgeBucketFor({ overallScore: 90, intermediateScore: null, advancedScore: 90 }).bucket).toBe('B4_ADVANCED');
  });
});

describe('knowledge profile of one attempt', () => {
  it('MIXED 10 items (3/5/2): per-level scores, unanswered in the denominator, highest demonstrated, per concept', () => {
    const p = knowledgeProfile([...items('a', 2, 3, 3), ...items('a', 3, 5, 4, 0), ...items('b', 4, 2, 1)]);
    expect(p.overallScore).toBe(80);
    expect(p.basicScore).toBe(100);
    expect(p.intermediateScore).toBe(80); // 4 correct, 1 unanswered
    expect(p.advancedScore).toBe(50);
    expect(p.levelCounts).toEqual({ BASIC: 3, INTERMEDIATE: 5, ADVANCED: 2 });
    expect(p.highestDifficultyDemonstrated).toBe('INTERMEDIATE');
    expect(p.conceptScore).toEqual({ a: 87.5, b: 50 });
    expect(p.knowledgeBucket).toBe('B3_COMPETENT');
  });
  it('null level scores when the attempt has no item at that level; B4 when advanced qualifies', () => {
    const p = knowledgeProfile(items('a', 4, 5, 5));
    expect(p).toMatchObject({ overallScore: 100, basicScore: null, intermediateScore: null, advancedScore: 100, highestDifficultyDemonstrated: 'ADVANCED', knowledgeBucket: 'B4_ADVANCED' });
  });
  it('B1 / B2 from the overall score; nothing demonstrated -> null', () => {
    expect(knowledgeProfile(items('a', 3, 10, 5)).knowledgeBucket).toBe('B1_CRITICAL_GAP');
    expect(knowledgeProfile(items('a', 3, 10, 7)).knowledgeBucket).toBe('B2_DEVELOPING');
    expect(knowledgeProfile(items('a', 3, 10, 5)).highestDifficultyDemonstrated).toBeNull();
  });
  it('levels 1 / 5 (AUTO difficulty) count overall but in no level score', () => {
    const p = knowledgeProfile([...items('a', 1, 2, 2), ...items('a', 5, 2, 2), ...items('a', 3, 1, 1)]);
    expect(p.unbandedItemCount).toBe(4);
    expect(p.levelCounts).toEqual({ BASIC: 0, INTERMEDIATE: 1, ADVANCED: 0 });
    expect(p.overallScore).toBe(100);
    expect(p.knowledgeBucket).toBe('B3_COMPETENT');
  });
});

describe('group view and wiring', () => {
  it('the group aggregate counts the latest attempts per bucket (UNCLASSIFIED for the edge case)', () => {
    const r = (studentId: string, scorePercent: number, knowledgeBucket: ReturnType<typeof knowledgeBucketFor>['bucket']) => ({ studentId, scorePercent, perConcept: [], items: [], knowledgeBucket });
    const g = aggregateGroup([r('s1', 40, 'B1_CRITICAL_GAP'), r('s2', 70, 'B2_DEVELOPING'), r('s3', 90, 'B3_COMPETENT'), r('s4', 95, 'B4_ADVANCED'), r('s5', 92, 'B4_ADVANCED'), r('s6', 85, null)]);
    expect(g.bucketDistribution).toEqual({ B1_CRITICAL_GAP: 1, B2_DEVELOPING: 1, B3_COMPETENT: 1, B4_ADVANCED: 2, UNCLASSIFIED: 1 });
    expect(bucketDistribution([])).toEqual({ B1_CRITICAL_GAP: 0, B2_DEVELOPING: 0, B3_COMPETENT: 0, B4_ADVANCED: 0, UNCLASSIFIED: 0 });
  });
  it('every locale has every bucket / level label', () => {
    const keys = [...Object.values(KNOWLEDGE_BUCKET_LABEL_KEY), ...Object.values(DIFFICULTY_LEVEL_LABEL_KEY), 'kb.title', 'kb.distribution', 'kb.note', 'kb.highest', 'kb.noItems'] as const;
    for (const m of Object.values(MESSAGES)) for (const k of keys) expect(typeof m[k] === 'string' && m[k].length > 0, k).toBe(true);
  });
  it('the service derives the profile at read time from the frozen items, persists it in completion, never touches evidence for it', () => {
    const svc = readFileSync(join(process.cwd(), 'src/services/subject-assessment.service.ts'), 'utf8');
    expect(svc).toMatch(/knowledge: knowledgeProfile\(items\.map/);
    expect(svc).toMatch(/const completion = \{ completedAt: now\.toISOString\(\), reason, scorePercent: report\.scorePercent, passed: report\.passed, knowledge \}/);
    const teacher = readFileSync(join(process.cwd(), 'src/lib/teacher/subject-assessment-assignment.service.ts'), 'utf8');
    expect(teacher).toMatch(/knowledgeBucket: read\.data\.subjectAssessment\.knowledge\.knowledgeBucket/);
    expect(teacher).toMatch(/knowledge: detail\.data\.subjectAssessment\.knowledge,/);
    const group = readFileSync(join(process.cwd(), 'src/app/dashboard/teacher/classes/[classId]/subject-assessments/[groupId]/page.tsx'), 'utf8');
    expect(group).toMatch(/data-testid="tsa-bucket-distribution"/);
    const drill = readFileSync(join(process.cwd(), 'src/app/dashboard/teacher/classes/[classId]/subject-assessments/[groupId]/students/[studentId]/page.tsx'), 'utf8');
    expect(drill).toMatch(/data-testid="tsa-drill-bucket"/);
  });
});
