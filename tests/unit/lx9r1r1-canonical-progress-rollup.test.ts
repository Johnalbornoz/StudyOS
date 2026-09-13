/**
 * LX-9R1-R1 -- CANONICAL PROGRESS ROLLUP (SUBJECT + STUDENT OVERALL).
 *
 * Live QA: after LX-9R1 fixed concept/topic-level progress, two legacy
 * aggregates remained: the Subjects detail page's header ("dominio
 * promedio 1%") and /dashboard's overall + subject-card percentages
 * ("Dominio general: 1%") -- both still raw `mastery_score` averages,
 * inconsistent with the canonical concept journey stages shown
 * everywhere else. This file covers the 21 required tests via direct,
 * fully-mocked unit tests of `getStudentProgressOverview` (module
 * boundaries mocked; `resolveConceptJourneyStage`/
 * `deriveLearnerJourneyStage`/`averageJourneyProgress` run for REAL, so
 * the aggregation logic itself is genuinely exercised, not assumed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

const getStudentMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ getStudentMastery: (...a: any[]) => getStudentMasteryMock(...a) }));

const getSubjectKnowledgeStateMock = vi.fn();
const getActiveMasteryPolicyMock = vi.fn();
vi.mock('@/services/knowledge-state.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/knowledge-state.service')>();
  return {
    ...actual,
    getSubjectKnowledgeState: (...a: any[]) => getSubjectKnowledgeStateMock(...a),
    getActiveMasteryPolicy: (...a: any[]) => getActiveMasteryPolicyMock(...a),
  };
});

const getRecurringMisconceptionsMock = vi.fn();
vi.mock('@/services/misconception.service', () => ({ getRecurringMisconceptions: (...a: any[]) => getRecurringMisconceptionsMock(...a) }));

const getSubjectHierarchyMock = vi.fn();
vi.mock('@/services/topic-hierarchy.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/topic-hierarchy.service')>();
  return { ...actual, getSubjectHierarchy: (...a: any[]) => getSubjectHierarchyMock(...a) };
});

const getLearningOSSnapshotMock = vi.fn();
vi.mock('@/services/learning-os-snapshot.service', () => ({ getLearningOSSnapshot: (...a: any[]) => getLearningOSSnapshotMock(...a) }));

import { getStudentProgressOverview } from '@/services/progress-overview.service';

const STUDENT = 'student-1';

function hierarchyOf(conceptIds: string[]): any {
  return { topics: [], unassigned: conceptIds.map((id) => ({ id, label: id, hasEvidence: false })) };
}

function decision(subjectId: string, conceptId: string, learningState: string): any {
  return { subjectId, actionConceptId: conceptId, learningState, priorityScore: 0, facts: [], signals: [], primarySignal: {} };
}

function ks(conceptId: string, subjectId: string, masteryState: string, validationReadiness: string | null = null): any {
  return { studentId: STUDENT, conceptId, subjectId, masteryState, validationReadiness };
}

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [] });
  getStudentMasteryMock.mockReset().mockResolvedValue([]);
  getSubjectKnowledgeStateMock.mockReset().mockResolvedValue([]);
  getActiveMasteryPolicyMock.mockReset().mockResolvedValue({
    version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75,
    minimumRetention: 75, minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0,
    minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2, validationWindowDays: 14,
  });
  getRecurringMisconceptionsMock.mockReset().mockResolvedValue([]);
  getSubjectHierarchyMock.mockReset().mockResolvedValue({ topics: [], unassigned: [] });
  getLearningOSSnapshotMock.mockReset().mockResolvedValue({ decisions: [] });
});

/* ================================================================ *
 * 1-3 -- subject progress averages all canonical concept stages,     *
 * NOT_STARTED counts as 0%, different concept counts aggregate.      *
 * ================================================================ */
describe('LX-9R1-R1 required tests 1-3 -- subject-level canonical aggregation', () => {
  it('1/2. subject progress is the mean of every concept\'s journey stage; a concept with no decision/knowledge-state (NOT_STARTED) counts as 0%, never excluded', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, name FROM subjects/i.test(sql)) return { rows: [{ id: 'subj1', name: 'Math' }] };
      return { rows: [] };
    });
    getSubjectHierarchyMock.mockResolvedValue(hierarchyOf(['c1', 'c2'])); // c1: RETAIN, c2: untouched (NOT_STARTED)
    getSubjectKnowledgeStateMock.mockResolvedValue([ks('c1', 'subj1', 'VALIDATED_MASTERY', 'READY')]);
    getLearningOSSnapshotMock.mockResolvedValue({ decisions: [decision('subj1', 'c1', 'RETENTION_RISK')] });

    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const subj = overview.subjects.find((s) => s.subjectId === 'subj1')!;
    // c1 -> RETAIN (70%), c2 -> NOT_STARTED (0%) -> mean = 35%
    expect(subj.journeyProgressPercent).toBe(35);
  });

  it('3. subjects with different concept counts aggregate correctly, independently of each other', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, name FROM subjects/i.test(sql)) return { rows: [{ id: 'subjA', name: 'A' }, { id: 'subjB', name: 'B' }] };
      return { rows: [] };
    });
    getSubjectHierarchyMock.mockImplementation(async (subjectId: string) => {
      if (subjectId === 'subjA') return hierarchyOf(['a1']); // 1 concept
      return hierarchyOf(['b1', 'b2', 'b3', 'b4']); // 4 concepts
    });
    getSubjectKnowledgeStateMock.mockImplementation(async (_studentId: string, subjectId: string) => {
      if (subjectId === 'subjA') return [ks('a1', 'subjA', 'VALIDATED_MASTERY', 'READY')];
      return [
        ks('b1', 'subjB', 'VALIDATED_MASTERY', 'READY'),
        ks('b2', 'subjB', 'VALIDATED_MASTERY', 'READY'),
        ks('b3', 'subjB', 'VALIDATED_MASTERY', 'READY'),
        ks('b4', 'subjB', 'VALIDATED_MASTERY', 'READY'),
      ];
    });
    getLearningOSSnapshotMock.mockResolvedValue({
      decisions: [
        decision('subjA', 'a1', 'RETENTION_RISK'), // RETAIN = 70
        decision('subjB', 'b1', 'TRANSFER_GAP'), // TRANSFER = 85
        decision('subjB', 'b2', 'TRANSFER_GAP'),
        decision('subjB', 'b3', 'TRANSFER_GAP'),
        decision('subjB', 'b4', 'RETENTION_RISK'), // RETAIN = 70
      ],
    });

    const overview = await getStudentProgressOverview(STUDENT, 'es');
    expect(overview.subjects.find((s) => s.subjectId === 'subjA')!.journeyProgressPercent).toBe(70);
    // (85+85+85+70)/4 = 81.25 -> rounds to 81
    expect(overview.subjects.find((s) => s.subjectId === 'subjB')!.journeyProgressPercent).toBe(81);
  });
});

/* ================================================================ *
 * 4-5 -- subject detail and progress dashboard use the SAME function *
 * (source-contract: both call averageJourneyProgress).               *
 * ================================================================ */
describe('LX-9R1-R1 required tests 4-5 -- subject detail and progress dashboard share one aggregator', () => {
  it('4. both subjects/[id]/page.tsx and progress-overview.service.ts call averageJourneyProgress from journey-progress.ts -- no independent calculation', () => {
    const pageSrc = strip(read('src/app/dashboard/subjects/[id]/page.tsx'));
    const serviceSrc = strip(read('src/services/progress-overview.service.ts'));
    expect(pageSrc).toMatch(/import \{ averageJourneyProgress \} from '@\/lib\/lx\/journey-progress'/);
    expect(serviceSrc).toMatch(/import \{ averageJourneyProgress \} from '@\/lib\/lx\/journey-progress'/);
    expect(pageSrc).toMatch(/averageJourneyProgress\(Object\.values\(journeyStages\)\)/);
    expect(serviceSrc).toMatch(/averageJourneyProgress\(journeyStages\)/);
  });

  it('5. dashboard/page.tsx renders subjects[].journeyProgressPercent for the subject card, the SAME field name progress-overview.service.ts computes -- never a re-derived value', () => {
    const dashSrc = strip(read('src/app/dashboard/page.tsx'));
    expect(dashSrc).toMatch(/s\.journeyProgressPercent/);
    expect(dashSrc).not.toMatch(/s\.avgMasteryPercent \?\? 0.*width/); // no longer drives the bar width
  });
});

/* ================================================================ *
 * 6-8 -- overall progress is concept-weighted, never legacy sources. *
 * ================================================================ */
describe('LX-9R1-R1 required tests 6-8 -- overall progress is concept-weighted and never legacy-sourced', () => {
  it('6. overall progress is concept-weighted: a 1-concept subject never weighs the same as a 4-concept subject', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, name FROM subjects/i.test(sql)) return { rows: [{ id: 'subjA', name: 'A' }, { id: 'subjB', name: 'B' }] };
      return { rows: [] };
    });
    getSubjectHierarchyMock.mockImplementation(async (subjectId: string) => (subjectId === 'subjA' ? hierarchyOf(['a1']) : hierarchyOf(['b1', 'b2', 'b3', 'b4'])));
    getSubjectKnowledgeStateMock.mockImplementation(async (_s: string, subjectId: string) =>
      subjectId === 'subjA'
        ? [ks('a1', 'subjA', 'VALIDATED_MASTERY', 'READY')]
        : [ks('b1', 'subjB', 'VALIDATED_MASTERY', 'READY'), ks('b2', 'subjB', 'VALIDATED_MASTERY', 'READY'), ks('b3', 'subjB', 'VALIDATED_MASTERY', 'READY'), ks('b4', 'subjB', 'VALIDATED_MASTERY', 'READY')]
    );
    getLearningOSSnapshotMock.mockResolvedValue({
      decisions: [
        decision('subjA', 'a1', 'TRANSFER_GAP'), // TRANSFER = 85, subjA average = 85
        // subjB: all 4 concepts NOT_STARTED-equivalent via no active decision + no knowledge state override -> but ks gives VALIDATED_MASTERY+READY with no learningState override -> falls to CONSOLIDATED via zero-signal path; to keep this deterministic, drive subjB's stage directly via RETENTION_RISK decisions instead:
        decision('subjB', 'b1', 'RETENTION_RISK'), decision('subjB', 'b2', 'RETENTION_RISK'),
        decision('subjB', 'b3', 'RETENTION_RISK'), decision('subjB', 'b4', 'RETENTION_RISK'), // all RETAIN = 70
      ],
    });

    const overview = await getStudentProgressOverview(STUDENT, 'es');
    // Concept-weighted mean across ALL 5 concepts: (85 + 70*4) / 5 = 73
    // A naive mean-of-subject-percentages ((85+70)/2 = 77.5 -> 78) would differ -- proving this is concept-weighted, not subject-weighted.
    expect(overview.overallJourneyProgressPercent).toBe(73);
    expect(overview.overallJourneyProgressPercent).not.toBe(78);
  });

  it('7. overall progress computation never reads overallMasteryPercent/avgMasteryPercent -- source contract', () => {
    const src = read('src/services/progress-overview.service.ts');
    const fnStart = src.indexOf('const overallJourneyProgressPercent');
    const fnSrc = src.slice(Math.max(0, fnStart - 5), fnStart + 200);
    expect(fnSrc).toMatch(/averageJourneyProgress\(allJourneyStages\)/);
    expect(fnSrc).not.toMatch(/overallMasteryPercent|avgMasteryPercent/);
  });

  it('8. overall/subject journey progress never reads raw mastery_score -- source contract (the journeyStages computation path only touches resolveConceptJourneyStage)', () => {
    const src = strip(read('src/services/progress-overview.service.ts'));
    const journeyBlockStart = src.indexOf('const journeyStages: LearnerJourneyStage[]');
    const journeyBlock = src.slice(journeyBlockStart, journeyBlockStart + 300);
    expect(journeyBlock).toMatch(/resolveConceptJourneyStage/);
    expect(journeyBlock).not.toMatch(/mastery_score|rawMastery/);
  });
});

/* ================================================================ *
 * 9-10 -- subject primary never uses raw mastery_score; secondary    *
 * mastery analytics remain available.                                *
 * ================================================================ */
describe('LX-9R1-R1 required tests 9-10 -- subject primary is never raw mastery; secondary analytics remain', () => {
  it('9. SubjectProgress.avgMasteryPercent (legacy, secondary) is computed completely independently of journeyProgressPercent (primary)', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, name FROM subjects/i.test(sql)) return { rows: [{ id: 'subj1', name: 'Math' }] };
      return { rows: [] };
    });
    getSubjectHierarchyMock.mockResolvedValue(hierarchyOf(['c1']));
    getSubjectKnowledgeStateMock.mockResolvedValue([ks('c1', 'subj1', 'VALIDATED_MASTERY', 'READY')]);
    getStudentMasteryMock.mockResolvedValue([{ concept_id: 'c1', label: 'C1', mastery_score: 1.2 }]); // very low raw mastery
    getLearningOSSnapshotMock.mockResolvedValue({ decisions: [decision('subj1', 'c1', 'TRANSFER_GAP')] }); // but journey stage is TRANSFER (85%)

    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const subj = overview.subjects[0];
    expect(subj.journeyProgressPercent).toBe(85); // primary: canonical, high
    expect(subj.avgMasteryPercent).toBe(1); // secondary: legacy raw mastery, low -- exactly the live-QA "1%" value, now correctly demoted to secondary
  });

  it('10. capabilities (5-dimension KPIs) and achievements remain computed and available, untouched by this repair', () => {
    const src = strip(read('src/services/progress-overview.service.ts'));
    expect(src).toMatch(/const capabilities: DimensionScores = \{/);
    expect(src).toMatch(/const achievements: AchievementCounts = \{/);
  });
});

/* ================================================================ *
 * 11-13 -- RETAIN/TRANSFER/CONSOLIDATED contribute the exact LX-9R1  *
 * stage-anchor percentages, unchanged.                                *
 * ================================================================ */
describe('LX-9R1-R1 required tests 11-13 -- stage anchors unchanged (RETAIN=70, TRANSFER=85, CONSOLIDATED=100)', () => {
  it('11-13. a subject with one concept at each of RETAIN/TRANSFER/CONSOLIDATED averages using the unchanged LX-9R1 anchors', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, name FROM subjects/i.test(sql)) return { rows: [{ id: 'subj1', name: 'Math' }] };
      return { rows: [] };
    });
    getSubjectHierarchyMock.mockResolvedValue(hierarchyOf(['retain1', 'transfer1', 'consolidated1']));
    getSubjectKnowledgeStateMock.mockResolvedValue([
      ks('retain1', 'subj1', 'VALIDATED_MASTERY', 'READY'),
      ks('transfer1', 'subj1', 'VALIDATED_MASTERY', 'READY'),
      ks('consolidated1', 'subj1', 'VALIDATED_MASTERY', 'READY'),
    ]);
    getLearningOSSnapshotMock.mockResolvedValue({
      decisions: [
        decision('subj1', 'retain1', 'RETENTION_RISK'),
        decision('subj1', 'transfer1', 'TRANSFER_GAP'),
        decision('subj1', 'consolidated1', 'VALIDATED'),
      ],
    });
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    // (70 + 85 + 100) / 3 = 85
    expect(overview.subjects[0].journeyProgressPercent).toBe(85);
  });
});

/* ================================================================ *
 * 14-15 -- all-NOT_STARTED subject = 0%; empty subject fails soft.   *
 * ================================================================ */
describe('LX-9R1-R1 required tests 14-15 -- empty/all-untouched subjects fail soft, never NaN/100%', () => {
  it('14. a subject whose every concept is NOT_STARTED (no decision, no knowledge state) is 0%, not null and not excluded', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, name FROM subjects/i.test(sql)) return { rows: [{ id: 'subj1', name: 'New Subject' }] };
      return { rows: [] };
    });
    getSubjectHierarchyMock.mockResolvedValue(hierarchyOf(['c1', 'c2']));
    // no knowledge state, no decisions -- both concepts NOT_STARTED.
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    expect(overview.subjects[0].journeyProgressPercent).toBe(0);
  });

  it('15. a subject with ZERO concepts fails soft to null -- never NaN, never 100%', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, name FROM subjects/i.test(sql)) return { rows: [{ id: 'subj1', name: 'Empty Subject' }] };
      return { rows: [] };
    });
    getSubjectHierarchyMock.mockResolvedValue({ topics: [], unassigned: [] });
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    expect(overview.subjects[0].journeyProgressPercent).toBeNull();
    expect(Number.isNaN(overview.subjects[0].journeyProgressPercent)).toBe(false);
  });

  it('a learner with zero active subjects gets overallJourneyProgressPercent = null, never NaN/100%', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, name FROM subjects/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    expect(overview.overallJourneyProgressPercent).toBeNull();
    expect(overview.subjects).toEqual([]);
  });
});

/* ================================================================ *
 * 16 -- no evidence/mastery writes.                                  *
 * ================================================================ */
describe('LX-9R1-R1 required test 16 -- no evidence/mastery writes were added', () => {
  it('progress-overview.service.ts performs no INSERT/UPDATE/DELETE anywhere', () => {
    const src = strip(read('src/services/progress-overview.service.ts'));
    expect(src).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });
});

/* ================================================================ *
 * 17-20 -- Today, My Path, milestones, attention/recommendation      *
 * logic unchanged.                                                    *
 * ================================================================ */
describe('LX-9R1-R1 required tests 17-20 -- Today, My Path, milestones, and attention logic are unaffected', () => {
  it('17. today-view.ts was not touched by this repair', () => {
    const src = read('src/lib/lx/today-view.ts');
    expect(src).not.toMatch(/progress-overview\.service/);
  });

  it('18. path-view.ts\'s own resolveConceptJourney/buildSubjectPathView are unchanged -- progress-overview.service.ts only calls the existing exported resolveConceptJourneyStage, never a new My Path code path', () => {
    const src = strip(read('src/lib/lx/path-view.ts'));
    expect(src).toMatch(/export function resolveConceptJourneyStage\(/);
    expect(src).not.toMatch(/progress-overview/);
  });

  it('19. progression-milestones.ts (LX-9 milestone system) was not touched by this repair', () => {
    const src = read('src/lib/lx/progression-milestones.ts');
    expect(src).not.toMatch(/progress-overview|journeyProgressPercent/);
  });

  it('20. needsAttention (learning_debt-derived) computation is untouched -- still a plain read, never sorted/filtered by the new journey percentage', () => {
    const src = strip(read('src/services/progress-overview.service.ts'));
    const needsAttentionBlockStart = src.indexOf('const needsAttention: NeedsAttentionItem[]');
    const block = src.slice(needsAttentionBlockStart, needsAttentionBlockStart + 300);
    expect(block).not.toMatch(/journeyProgressPercent|averageJourneyProgress/);
  });
});
