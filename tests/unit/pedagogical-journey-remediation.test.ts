/**
 * 2026-10-17 pedagogical journey remediation: the learner-facing projection, the Prove routing (PED-01..03), the Learn
 * check retake (PED-04), and the subject-level test / mock setup (PED-05).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectCanonicalJourneyStage, canonicalEngineHasEvidence } from '@/lib/lx/learner-journey-contract';
import { entryTargetFor } from '@/lib/assessment-experience/entry';
import { supplyIntentOfQuizMode, supplyFamilyOf, providerGenerationAllowed } from '@/lib/assessment-supply/supply-boundary';
import { CANONICAL_POLICY } from '@/lib/pedagogical-engine/policy';
import { deriveJourneyProgress } from '@/lib/lx/journey-progress';
import { MESSAGES } from '@/lib/i18n/messages';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const d = (stage: any, actionState = 'EXECUTABLE', extra: Record<string, unknown> = {}) => ({ stage, actionState, proveAttemptsInCycle: 0, rollback: null, ...extra });

describe('the learner-facing journey is a deterministic projection of the canonical decision', () => {
  it('NOT_STARTED -> LEARN -> PRACTICE -> READY_TO_PROVE -> PROVE -> WAIT_FOR_RETENTION -> RETAIN -> TRANSFER -> CONSOLIDATED', () => {
    expect(projectCanonicalJourneyStage(d('LEARN'), false)).toBe('NOT_STARTED');
    expect(projectCanonicalJourneyStage(d('LEARN'), true)).toBe('LEARN');
    expect(projectCanonicalJourneyStage(d('PRACTICE'), true)).toBe('PRACTICE');
    expect(projectCanonicalJourneyStage(d('PROVE'), true)).toBe('READY_TO_PROVE');
    expect(projectCanonicalJourneyStage(d('PROVE', 'EXECUTABLE', { proveAttemptsInCycle: 1 }), true)).toBe('PROVE');
    expect(projectCanonicalJourneyStage(d('RETAIN', 'WAITING'), true)).toBe('WAIT_FOR_RETENTION');
    expect(projectCanonicalJourneyStage(d('RETAIN'), true)).toBe('RETAIN');
    expect(projectCanonicalJourneyStage(d('TRANSFER'), true)).toBe('TRANSFER');
    expect(projectCanonicalJourneyStage(d('CONSOLIDATED', 'CONSOLIDATED'), true)).toBe('CONSOLIDATED');
  });
  it('a learner sent back to Prove by Retain two-strike is shown PROVE (not READY_TO_PROVE)', () => {
    expect(projectCanonicalJourneyStage(d('PROVE', 'EXECUTABLE', { rollback: { rolledBackTo: 'PROVE' } }), true)).toBe('PROVE');
  });
  it('engine evidence is any replayed attempt, qualifying or not', () => {
    expect(canonicalEngineHasEvidence({ qualifiedEvidence: [] })).toBe(false);
    expect(canonicalEngineHasEvidence({ qualifiedEvidence: [{ qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: ['x'] }] })).toBe(true);
  });
  it('progress anchors keep the journey order and WAIT_FOR_RETENTION has copy in every locale', () => {
    const order = ['NOT_STARTED', 'LEARN', 'PRACTICE', 'READY_TO_PROVE', 'PROVE', 'WAIT_FOR_RETENTION', 'RETAIN', 'TRANSFER', 'CONSOLIDATED'] as const;
    const pcts = order.map((s) => deriveJourneyProgress(s).progressPercent);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
    for (const [locale, m] of Object.entries(MESSAGES)) expect((m as Record<string, string>)['conceptMission.stage.WAIT_FOR_RETENTION'], locale).toBeTruthy();
  });
  it('the three canonical surfaces use the projection (never the raw engine stage)', () => {
    expect(src('src/lib/lx/path-view.ts')).toMatch(/stage: projectCanonicalJourneyStage\(decision, canonicalEngineHasEvidence\(decision\)\)/);
    expect(src('src/lib/pedagogical-decision/concept-mission-override.ts')).toMatch(/stage: projectCanonicalJourneyStage\(decision, canonicalEngineHasEvidence\(decision\)\)/);
    expect(src('src/services/progress-overview.service.ts')).toMatch(/const projected = projectCanonicalJourneyStage\(decision, canonicalEngineHasEvidence\(decision\)\)/);
  });
});

describe('pilot pass policy constants (one policy object)', () => {
  it('80% inclusive everywhere; Learn 5, Prove 10, Retain 5; practice 3 of 3 with average', () => {
    expect(CANONICAL_POLICY.learn).toMatchObject({ minimumScorePercent: 80, itemCount: 5 });
    expect(CANONICAL_POLICY.practice).toMatchObject({ minimumScorePercent: 80, windowSize: 3, requiredPassesInWindow: 3, minimumWindowAveragePercent: 80 });
    expect(CANONICAL_POLICY.prove).toMatchObject({ itemCount: 10, minimumScorePercent: 80, independenceRequired: true, failureStaysInProve: true });
    expect(CANONICAL_POLICY.retention).toMatchObject({ itemCount: 5, minimumWaitDays: 3, minimumScorePercent: 80, independenceRequired: true });
    expect(CANONICAL_POLICY.transfer).toMatchObject({ minimumOverallScorePercent: 80, perChallengeMinimumScorePercent: 70 });
  });
  it('the Knowledge State mastery policy v2 migration sets every dimension to 80 and keeps v1', () => {
    const m = src('database/migrations/20261127_1000_mastery_policy_v2_pilot_pass_80.sql');
    expect(m).toMatch(/SELECT 2, 80, 80, 80, 80, 80,/);
    expect(m).not.toMatch(/DELETE FROM public\.mastery_policies WHERE version = 1/);
  });
});

describe('PED-01..04', () => {
  it('PED-01: a canonical (v1) launch is never re-pointed to the count-less canonical setup', () => {
    expect(entryTargetFor('/dashboard/quiz', { conceptId: 'c', mode: 'canonical_prove', v1Launch: '1' }, true)).toBeNull();
    expect(entryTargetFor('/dashboard/quiz', { conceptId: 'c', mode: 'canonical_retain', v1Launch: '1' }, true)).toBeNull();
    // an ordinary (non-canonical) single-concept practice still goes to the canonical setup when the flag is on
    expect(entryTargetFor('/dashboard/quiz', { conceptId: 'c', mode: 'topic_practice' }, true)).toMatch(/^\/dashboard\/assessment\?/);
  });
  it('PED-03: the concept row no longer offers the ungated quick_check "Comprobación individual"', () => {
    const row = src('src/app/dashboard/subjects/[id]/ConceptList.tsx');
    expect(row).not.toMatch(/mode: 'quick_check'/);
    expect(row).not.toMatch(/conceptCheckHref/);
  });
  it('PED-04: the Learn comprehension check offers no "practice again" (its retake comes from the canonical next action)', () => {
    expect(src('src/app/dashboard/quiz/page.tsx')).toMatch(/PRACTICE_EVIDENCE_MODES\.includes\(quizMode\) && quizMode !== 'canonical_learn_check' && !resumeVerifyAttemptId && studentId/);
  });
});

describe('PED-05 subject test / subject mock', () => {
  it('the subject mock is an internal assessment (generation allowed on an explicit command), never standardized Exam Prep', () => {
    expect(supplyIntentOfQuizMode('exam_simulation')).toBe('INTERNAL_AD_HOC');
    expect(supplyFamilyOf(supplyIntentOfQuizMode('exam_simulation'))).toBe('INTERNAL_ASSESSMENT');
    expect(providerGenerationAllowed('INTERNAL_ASSESSMENT', 'EXPLICIT_COMMAND')).toBe(true);
    // standardized exam modes are unchanged: an unknown mode still fails closed as standardized
    expect(supplyFamilyOf(supplyIntentOfQuizMode('not-a-mode'))).toBe('STANDARDIZED_EXAM');
  });
  // Superseded by the overnight 2026-10-16 operator rules (StudyUs decides count / distribution; DO NOW or SCHEDULE; no
  // recommended date). The full rule set is tested in tests/unit/subject-assessment-lifecycle.test.ts.
  it('setup: every concept enabled by default, select / deselect all, at least one, NO user count, DO NOW / SCHEDULE, preview, no recommended date', () => {
    const p = src('src/app/dashboard/quiz/page.tsx');
    expect(p).toMatch(/setSelectedConceptIds\(all\.map\(\(c\) => c\.id\)\)/);
    expect(p).toMatch(/t\['quiz\.subjectSetup\.selectAll'\]/);
    expect(p).toMatch(/t\['quiz\.subjectSetup\.deselectAll'\]/);
    expect(p).toMatch(/const noConcept = subjectSetup && subjectConcepts\.length > 0 && selectedConceptIds\.length === 0/);
    expect(p).not.toMatch(/quiz\.subjectSetup\.questionCount/);
    expect(p).toMatch(/data-testid="subject-scheduled-date"/);
    expect(p).not.toMatch(/subject-recommended-date|recommendedDate/);
    expect(p).toMatch(/data-testid="subject-assessment-preview"/);
  });
  it('server: subject modes are created by the subject assessment service (no user count, no recommended date)', () => {
    const r = src('src/app/api/quizzes/generate-and-take/route.ts');
    expect(r).not.toMatch(/error: 'QUESTION_COUNT_REQUIRED'/);
    expect(r).not.toMatch(/conceptIds = validated\.conceptIds\.slice\(0, maxQuestions\)/);
    expect(r).toMatch(/return await handleSubjectAssessmentCreate\(validated\)/);
    expect(r).not.toMatch(/recommendedDateStatus/);
    expect(src('database/migrations/20261127_1100_quiz_session_subject_assessment_setup.sql')).toMatch(/ADD COLUMN IF NOT EXISTS subject_assessment_setup jsonb/);
  });
  it('labels: "Prueba por materia" / "Simulacro por materia"', () => {
    const es = MESSAGES.es as Record<string, string>;
    expect(es['quiz.modeCumulative']).toBe('Prueba por materia');
    expect(es['quiz.modeExamSim']).toBe('Simulacro por materia');
  });
});
