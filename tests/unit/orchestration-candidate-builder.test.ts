/**
 * Phase 8 -- Step 8D1: PURE candidate construction from an 8C snapshot.
 * No DB, no AI, no clock. Phase 4 priority is CARRIED, never recomputed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildOrchestrationCandidates, type CandidateBuilderInput } from '@/lib/orchestration-candidate-builder';
import { orderOrchestrationCandidates, getOrchestrationGoalTier } from '@/lib/learning-orchestration-policy';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';

const S = 'stu-1';
const HS = '2026-09-06';
const HE = '2026-09-19';

function decision(o: Partial<LearningDecision> & { actionConceptId: string; subjectId: string }): LearningDecision {
  const sig = { type: (o as any).__signal ?? 'LOW_UNDERSTANDING', source: 'test', conceptId: o.actionConceptId, subjectId: o.subjectId, metadata: {} } as any;
  return {
    actionConceptId: o.actionConceptId,
    subjectId: o.subjectId,
    targetConceptIds: [],
    signals: [sig],
    primarySignal: sig,
    learningState: o.learningState ?? 'DEVELOPING',
    targetDimension: 'UNDERSTANDING',
    activityType: o.activityType ?? 'PRACTICE',
    pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null,
    priorityScore: o.priorityScore ?? 1000,
    reasonCode: sig.type,
    facts: [],
    dueAt: o.dueAt ?? null,
    policyVersion: 3,
  };
}

function baseInput(o: Partial<CandidateBuilderInput> = {}): CandidateBuilderInput {
  return {
    studentId: S,
    horizonStart: HS,
    horizonEnd: HE,
    decisions: [],
    retentionByConcept: new Map(),
    transferByConcept: new Map(),
    assessments: [],
    activeRemediations: [],
    curriculumEligible: [],
    conceptSubjectById: new Map(),
    ...o,
  };
}

describe('8D1 -- buildOrchestrationCandidates', () => {
  it('empty learner -> no candidates', () => {
    expect(buildOrchestrationCandidates(baseInput())).toEqual([]);
  });

  it('one Phase 4 decision -> one candidate carrying its activityType + priorityScore verbatim', () => {
    const c = buildOrchestrationCandidates(baseInput({ decisions: [decision({ actionConceptId: 'c1', subjectId: 'sub1', activityType: 'PRACTICE', priorityScore: 4200 })] }));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ conceptId: 'c1', subjectId: 'sub1', intendedActivityType: 'PRACTICE', phase4PriorityScore: 4200, source: 'PHASE4_DECISION', reasonCode: 'CURRICULUM_PROGRESSION' });
  });

  it('classifies Phase 4 decisions into temporal reason codes without re-ranking', () => {
    const decs: LearningDecision[] = [
      decision({ actionConceptId: 'rem', subjectId: 's', activityType: 'REMEDIATION' }),
      decision({ actionConceptId: 'ver', subjectId: 's', activityType: 'SOLO_VERIFY' }),
      decision({ actionConceptId: 'ret', subjectId: 's', activityType: 'RETENTION_CHECK' }),
      decision({ actionConceptId: 'xf', subjectId: 's', activityType: 'TRANSFER' }),
      decision({ actionConceptId: 'mock', subjectId: 's', activityType: 'MOCK_EXAM' }),
    ];
    const c = buildOrchestrationCandidates(baseInput({ decisions: decs }));
    const byConcept = Object.fromEntries(c.map((x) => [x.conceptId ?? 'mock', x.reasonCode]));
    expect(byConcept).toMatchObject({ rem: 'REMEDIATION_REQUIRED', ver: 'VERIFICATION_READY', ret: 'RETENTION_DUE', xf: 'TRANSFER_PROGRESSION', mock: 'ASSESSMENT_APPROACHING' });
    expect(c.find((x) => x.intendedActivityType === 'MOCK_EXAM')?.conceptId).toBeNull(); // subject-level
  });

  it('B: a future retention window (not covered by Phase 4) -> RETENTION_DUE with earliest = nextReviewAt date; never before', () => {
    const c = buildOrchestrationCandidates(baseInput({
      retentionByConcept: new Map([['c9', { nextReviewAt: '2026-09-11T00:00:00.000Z', retentionDue: false }]]),
      conceptSubjectById: new Map([['c9', 'subX']]),
    }));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ conceptId: 'c9', subjectId: 'subX', reasonCode: 'RETENTION_DUE', source: 'RETENTION_WINDOW', intendedActivityType: 'RETENTION_CHECK', earliestDate: '2026-09-11', phase4PriorityScore: null });
  });

  it('B: a retention window OUTSIDE the horizon is dropped', () => {
    const c = buildOrchestrationCandidates(baseInput({
      retentionByConcept: new Map([['c9', { nextReviewAt: '2026-10-30T00:00:00.000Z', retentionDue: false }]]),
      conceptSubjectById: new Map([['c9', 'subX']]),
    }));
    expect(c).toEqual([]);
  });

  it('B: retention de-dup -- a concept already in a Phase 4 decision gets NO separate retention-window candidate', () => {
    const c = buildOrchestrationCandidates(baseInput({
      decisions: [decision({ actionConceptId: 'c9', subjectId: 'subX', activityType: 'RETENTION_CHECK' })],
      retentionByConcept: new Map([['c9', { nextReviewAt: '2026-09-11T00:00:00.000Z', retentionDue: true }]]),
      conceptSubjectById: new Map([['c9', 'subX']]),
    }));
    expect(c).toHaveLength(1);
    expect(c[0].source).toBe('PHASE4_DECISION');
  });

  it('C: an upcoming assessment tightens a hard deadline on covered-concept Phase 4 candidates (no MOCK unless Phase 4 emitted it)', () => {
    const c = buildOrchestrationCandidates(baseInput({
      decisions: [decision({ actionConceptId: 'covered', subjectId: 'sMath' }), decision({ actionConceptId: 'other', subjectId: 'sPhys' })],
      assessments: [{ id: 'a1', subjectId: 'sMath', scheduledDate: '2026-09-12', topics: ['covered'] }],
    }));
    expect(c.find((x) => x.conceptId === 'covered')?.hardDeadline).toBe('2026-09-12');
    expect(c.find((x) => x.conceptId === 'other')?.hardDeadline).toBeNull();
    expect(c.some((x) => x.intendedActivityType === 'MOCK_EXAM')).toBe(false);
  });

  it('D: NEAR_DEMONSTRATED + not fragile -> TRANSFER_PROGRESSION spaced >= 3 days after last success; fragile is skipped', () => {
    const c = buildOrchestrationCandidates(baseInput({
      transferByConcept: new Map([
        ['ready', { transferDepth: 'NEAR_DEMONSTRATED', transferFragile: false, lastSuccessfulTransferAt: '2026-09-07T00:00:00.000Z' }],
        ['shaky', { transferDepth: 'NEAR_DEMONSTRATED', transferFragile: true, lastSuccessfulTransferAt: '2026-09-07T00:00:00.000Z' }],
        ['none', { transferDepth: 'NONE', transferFragile: false, lastSuccessfulTransferAt: null }],
      ]),
      conceptSubjectById: new Map([['ready', 'sT'], ['shaky', 'sT'], ['none', 'sT']]),
    }));
    expect(c.map((x) => x.conceptId)).toEqual(['ready']);
    expect(c[0]).toMatchObject({ reasonCode: 'TRANSFER_PROGRESSION', source: 'TRANSFER_READINESS', intendedActivityType: 'TRANSFER', earliestDate: '2026-09-10' });
  });

  it('E: an active remediation not in a Phase 4 decision -> REMEDIATION_REQUIRED, earliest = today, tier 1', () => {
    const c = buildOrchestrationCandidates(baseInput({
      activeRemediations: [{ remediationPathId: 'rp1', rootCauseConceptId: 'root' }],
      conceptSubjectById: new Map([['root', 'sR']]),
    }));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ conceptId: 'root', reasonCode: 'REMEDIATION_REQUIRED', source: 'REMEDIATION', earliestDate: HS });
    expect(getOrchestrationGoalTier(c[0].reasonCode)).toBe(1);
  });

  it('G: curriculum-eligible NOT_STARTED concept -> CURRICULUM_PROGRESSION PRACTICE, priorityScore 0; dropped if a live PREREQUISITE_GAP exists', () => {
    const withGap = decision({ actionConceptId: 'blocked', subjectId: 'sC', __signal: 'PREREQUISITE_GAP' } as any);
    const c = buildOrchestrationCandidates(baseInput({
      decisions: [withGap],
      curriculumEligible: [{ conceptId: 'next', subjectId: 'sC' }, { conceptId: 'blocked', subjectId: 'sC' }],
    }));
    expect(c.filter((x) => x.reasonCode === 'CURRICULUM_PROGRESSION').map((x) => x.conceptId)).toEqual(['next']);
    expect(c.find((x) => x.conceptId === 'next')).toMatchObject({ intendedActivityType: 'PRACTICE', phase4PriorityScore: 0 });
  });

  it('multi-subject: ordering is system-level (goal tier -> deadline -> carried Phase 4 priority -> stable), NEVER a new concept score', () => {
    const c = buildOrchestrationCandidates(baseInput({
      decisions: [
        decision({ actionConceptId: 'a', subjectId: 's1', activityType: 'PRACTICE', priorityScore: 10 }),
        decision({ actionConceptId: 'b', subjectId: 's2', activityType: 'REMEDIATION', priorityScore: 5 }),
        decision({ actionConceptId: 'd', subjectId: 's1', activityType: 'RETENTION_CHECK', priorityScore: 999 }),
      ],
    }));
    const ordered = orderOrchestrationCandidates(c).map((x) => x.conceptId);
    // b (tier1 remediation) first; d (tier2 retention) before a (tier6 curriculum) despite lower... a is tier6
    expect(ordered[0]).toBe('b');
    expect(ordered.indexOf('d')).toBeLessThan(ordered.indexOf('a'));
  });

  it('the builder source uses no AI and does not reimplement Phase 4 ranking', () => {
    const code = readFileSync(join(__dirname, '..', '..', 'src/lib/orchestration-candidate-builder.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/@\/lib\/ai|executeAI|callAnthropic/i);
    expect(code).not.toMatch(/\b(dominantSignal|selectActivityType|computeLearningState|rankLearningDecisions)\s*[({]/);
    expect(code).not.toMatch(/@\/lib\/db|Date\.now\(\)|Math\.random\(\)/);
  });
});
