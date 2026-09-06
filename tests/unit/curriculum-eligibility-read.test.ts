/**
 * Phase 8 -- Step 8C1: curriculum eligibility read + NOT_STARTED
 * bootstrap.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getCurriculumEligibleConcepts } from '@/services/curriculum-eligibility-read.service';
import {
  bootstrapNotStartedLearningDecision,
  hasLiveDecisionForConcept,
} from '@/lib/curriculum-progression-bootstrap';
import { ADAPTIVE_LEARNING_POLICY_VERSION } from '@/lib/adaptive-learning-policy';

describe('8C1 -- getCurriculumEligibleConcepts', () => {
  it('ONE query, ordered by curriculum outline, filtered to concepts with NO concept_knowledge_state row', async () => {
    const query = vi.fn(async (sql: string, params: any[]) => {
      const s = sql.replace(/\s+/g, ' ');
      expect(s).toMatch(/ROW_NUMBER\(\) OVER \( PARTITION BY c\.subject_id ORDER BY COALESCE\(t\.display_order/);
      expect(s).toMatch(/NOT EXISTS \( SELECT 1 FROM concept_knowledge_state cks/);
      expect(s).toMatch(/s\.student_id = \$1 AND s\.status = 'active'/);
      expect(s).toMatch(/WHERE rank_in_subject <= \$2/);
      expect(params).toEqual(['stu-1', 3]);
      return {
        rows: [
          { concept_id: 'c1', subject_id: 'sub-a', canonical_id: 'alpha', topic_display_order: 0, subtopic_display_order: 0, rank_in_subject: 1 },
          { concept_id: 'c2', subject_id: 'sub-a', canonical_id: 'beta', topic_display_order: 0, subtopic_display_order: 1, rank_in_subject: 2 },
        ],
      };
    });
    const rows = await getCurriculumEligibleConcepts('stu-1', 3, { query } as any);
    expect(query).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.conceptId)).toEqual(['c1', 'c2']);
    expect(rows[0]).toMatchObject({ subjectId: 'sub-a', canonicalId: 'alpha', rankInSubject: 1 });
  });

  it('is read-only (no INSERT/UPDATE/DELETE in source)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'src/services/curriculum-eligibility-read.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+\w|\bDELETE\s+FROM\b/i);
  });
});

describe('8C1 -- NOT_STARTED bootstrap (Phase-4-compatible, no ranking engine)', () => {
  it('produces a minimal deterministic PRACTICE / NOT_STARTED / UNDERSTANDING decision with priorityScore 0', () => {
    const d = bootstrapNotStartedLearningDecision({ studentId: 's', subjectId: 'sub', conceptId: 'c' });
    expect(d).toMatchObject({
      actionConceptId: 'c',
      subjectId: 'sub',
      activityType: 'PRACTICE',
      learningState: 'NOT_STARTED',
      targetDimension: 'UNDERSTANDING',
      pedagogicalPriority: 'LOW',
      priorityScore: 0,
      policyVersion: ADAPTIVE_LEARNING_POLICY_VERSION,
    });
    expect(d.signals).toHaveLength(1);
    expect(d.primarySignal).toBe(d.signals[0]);
    expect(d.targetConceptIds).toEqual([]);
  });

  it('is deterministic', () => {
    const a = bootstrapNotStartedLearningDecision({ studentId: 's', subjectId: 'sub', conceptId: 'c' });
    const b = bootstrapNotStartedLearningDecision({ studentId: 's', subjectId: 'sub', conceptId: 'c' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('hasLiveDecisionForConcept detects when Phase 4 already covers the concept (bootstrap only used when it does not)', () => {
    const live = [{ actionConceptId: 'x' } as any];
    expect(hasLiveDecisionForConcept(live, 'x')).toBe(true);
    expect(hasLiveDecisionForConcept(live, 'y')).toBe(false);
  });

  it('does NOT reimplement Phase 4 ranking (grep guard on source)', () => {
    const code = readFileSync(join(__dirname, '..', '..', 'src/lib/curriculum-progression-bootstrap.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(dominantSignal|selectActivityType|computeLearningState|rankLearningDecisions)\s*[({]/);
    expect(code).not.toMatch(/@\/lib\/ai|executeAI/i);
  });
});
