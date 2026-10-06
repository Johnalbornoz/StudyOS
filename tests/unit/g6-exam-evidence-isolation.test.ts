/**
 * G6 -- exam evidence isolation (pure contract + reader wiring). The DB-backed acceptance scenario
 * (PAA mock -> PISA diagnostic, real writers and readers) is scripts/operations/g6-exam-evidence-isolation-cert.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  classifyEvidenceScope,
  evidenceExamTargetId,
  examAttemptEvidenceSql,
  examEvidenceScopeMetadata,
  inExamScopeSql,
  isExamAttemptEvidence,
  isInExamScope,
} from '@/lib/exam-core/evidence-scope';
import { buildPreparationPlan, classifyRequirement, conceptKnowledgeLabel, examRequirementLabel, nextStep, type LearnerConceptState, type RequirementInput } from '@/lib/exam-core/objectives/preparation-plan';
import { learningFactsFromPlan } from '@/lib/exam-journey/plan-facts';
import { VALID_EXAM_TARGET_PREDICATE } from '@/lib/student/onboarding-gate';
import { studentVisibleDefinitionSql } from '@/lib/exam-core/audience';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const PAA = '11111111-1111-4111-8111-111111111111';
const PISA = '22222222-2222-4222-8222-222222222222';
const TECH = '33333333-3333-4333-8333-333333333333';
const ATTEMPT = '44444444-4444-4444-8444-444444444444';
const VERSION = '55555555-5555-4555-8555-555555555555';

const row = (over: Partial<Parameters<typeof classifyEvidenceScope>[0]> = {}) => ({ sourceType: 'EXAM_SIMULATION', activityType: 'EXAM_SIMULATION', metadata: null, attemptTargetId: null, ...over });

describe('evidence scope contract', () => {
  it('G6 rows: metadata.examScope carries target + version + attempt', () => {
    const m = examEvidenceScopeMetadata({ examTargetId: PAA, examVersionId: VERSION, examAttemptId: ATTEMPT });
    expect(m).toEqual({ examTargetId: PAA, examVersionId: VERSION, examAttemptId: ATTEMPT, source: 'EXAM_ATTEMPT' });
    const r = row({ metadata: { examScope: m } });
    expect(classifyEvidenceScope(r, PAA)).toBe('EXAM_TARGET');
    expect(classifyEvidenceScope(r, PISA)).toBe('OTHER_EXAM_TARGET');
  });

  it('pre-G6 F9 rows: the attempt id recorded at write time resolves the target through the attempt FK (not inferred)', () => {
    const r = row({ metadata: { context: { examAttemptId: ATTEMPT, simulationSource: true }, framework: { examVersionId: VERSION } }, attemptTargetId: PAA });
    expect(evidenceExamTargetId(r)).toBe(PAA);
    expect(classifyEvidenceScope(r, PAA)).toBe('EXAM_TARGET');
    expect(classifyEvidenceScope(r, PISA)).toBe('OTHER_EXAM_TARGET');
  });

  it('T10 UNSCOPED_LEGACY: exam-attempt evidence without identity (F7 bridge shape) satisfies no target', () => {
    const f7 = row({ activityType: null, metadata: { skillIds: ['s'] } });
    expect(isExamAttemptEvidence(f7)).toBe(true);
    expect(classifyEvidenceScope(f7, PAA)).toBe('UNSCOPED_LEGACY');
    expect(isInExamScope(f7, PAA)).toBe(false);
    expect(isInExamScope(f7, PISA)).toBe(false);
    // An attempt id that is not a uuid is not an identity.
    expect(classifyEvidenceScope(row({ metadata: { context: { examAttemptId: 'nope' } } }), PAA)).toBe('UNSCOPED_LEGACY');
  });

  it('T11 longitudinal Learning OS evidence (incl. the exam-style quiz mode) stays valid for every target', () => {
    for (const r of [row({ sourceType: 'PRACTICE_QUIZ', activityType: 'quiz' }), row({ sourceType: 'EXAM_SIMULATION', activityType: 'quiz' }), row({ sourceType: 'DIAGNOSTIC', activityType: 'quiz' }), row({ sourceType: 'PRACTICE_QUESTION', activityType: null })]) {
      expect(classifyEvidenceScope(r, PAA)).toBe('LONGITUDINAL');
      expect(isInExamScope(r, PISA)).toBe(true);
    }
  });

  it('T17 a technical / fixture attempt is another target: it never unlocks a Student target', () => {
    const tech = row({ metadata: { examScope: examEvidenceScopeMetadata({ examTargetId: TECH, examVersionId: VERSION, examAttemptId: ATTEMPT }) } });
    expect(classifyEvidenceScope(tech, PAA)).toBe('OTHER_EXAM_TARGET');
    expect(isInExamScope(tech, PAA)).toBe(false);
  });

  it('SQL: the target is always a bound parameter, never inferred from concept / subject / family', () => {
    const sql = inExamScopeSql('le', '$3');
    expect(sql).toContain('$3::uuid');
    expect(sql).toContain(examAttemptEvidenceSql('le'));
    expect(sql).toContain('es_ea.student_exam_profile_id');
    expect(sql).not.toMatch(/concept|subject|family|config_key/i);
  });
});

// ------------------------------------------------------------------ KNOWLEDGE_MASTERY vs EXAM_REQUIREMENT_SATISFACTION
const learner = (over: Partial<LearnerConceptState> = {}): LearnerConceptState => ({
  studentConceptId: 'sc', subjectId: 's', masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY_FOR_VALIDATION' as any, memoryStatus: 'STABLE' as any, retentionDue: false, criticalMisconceptions: 0, evidenceCount: 6, ...over,
});
const req = (code: string, l: LearnerConceptState | null, over: Partial<RequirementInput> = {}): RequirementInput => ({
  learningObjectiveId: `lo-${code}`, code, description: code, area: 'A', weight: 0.5, ownEvidence: null,
  concepts: [{ canonicalConceptId: `cc-${code}`, name: code, learner: l, examEvidence: null, alsoRelevantFor: [] }], ...over,
});
const OPTS = { examDaysLeft: 100, canPractice: true, canRunDiagnostic: true };
const step = (plan: ReturnType<typeof buildPreparationPlan>) => nextStep({ openAttemptId: null, plan, canPractice: true, canRunDiagnostic: true, diagnosticDone: false, canViewStructure: true, canPlanDiploma: false, hasExamDate: true }).kind;

describe('Knowledge State vs exam requirement', () => {
  it('T4 the Knowledge State label is untouched (longitudinal)', () => {
    const l = learner({ examScope: { inScopeEvidence: 0, outOfScopeExamEvidence: 6 } });
    expect(conceptKnowledgeLabel(l)).toBe('DEMONSTRATED');
  });

  it('T1 knowledge resting ONLY on another target\'s attempts is NO_EVIDENCE for this exam', () => {
    expect(examRequirementLabel(learner({ examScope: { inScopeEvidence: 0, outOfScopeExamEvidence: 6 } }))).toBe('NO_EVIDENCE');
  });

  it('knowledge partly built from another exam\'s attempts can be confirmed here, never "already strong" here', () => {
    expect(examRequirementLabel(learner({ examScope: { inScopeEvidence: 2, outOfScopeExamEvidence: 4 } }))).toBe('IN_PROGRESS');
    expect(classifyRequirement(req('a', learner({ examScope: { inScopeEvidence: 2, outOfScopeExamEvidence: 4 } }))).status).toBe('NEEDS_CONFIRMATION');
  });

  it('longitudinal / own-target knowledge keeps its full meaning', () => {
    expect(examRequirementLabel(learner({ examScope: { inScopeEvidence: 6, outOfScopeExamEvidence: 0 } }))).toBe('DEMONSTRATED');
    expect(classifyRequirement(req('a', learner({ examScope: { inScopeEvidence: 6, outOfScopeExamEvidence: 0 } }))).status).toBe('ALREADY_STRONG');
  });

  it('T1 the known case: another exam\'s attempts on shared concepts no longer skip THIS target\'s diagnostic', () => {
    const otherOnly = learner({ masteryState: 'DEVELOPING' as any, examScope: { inScopeEvidence: 0, outOfScopeExamEvidence: 5 } });
    const plan = buildPreparationPlan(['a', 'b', 'c', 'd'].map((c) => req(c, otherOnly)), OPTS);
    expect(plan.counts.NO_EVIDENCE).toBe(4);
    expect(step(plan)).toBe('DIAGNOSTIC');
    // The same learner state read WITHOUT scope (the pre-G6 reading) would have skipped it.
    const unscoped = buildPreparationPlan(['a', 'b', 'c', 'd'].map((c) => req(c, { ...otherOnly, examScope: undefined })), OPTS);
    expect(step(unscoped)).not.toBe('DIAGNOSTIC');
  });

  it('T2/T3 this target\'s own evidence advances it', () => {
    const own = learner({ masteryState: 'DEVELOPING' as any, examScope: { inScopeEvidence: 5, outOfScopeExamEvidence: 0 } });
    const plan = buildPreparationPlan(['a', 'b', 'c', 'd'].map((c) => req(c, own)), OPTS);
    expect(plan.counts.NEEDS_CONFIRMATION).toBe(4);
    expect(step(plan)).not.toBe('DIAGNOSTIC');
  });

  it('another exam\'s RESULT alone is context: NO_EVIDENCE + OTHER_EXAM reason, and it is reported as other-exam-only', () => {
    const other = { classification: 'STRENGTH' as const, at: '2026-10-01', examName: 'PAA', sameExam: false };
    const plan = buildPreparationPlan([req('a', null, { concepts: [{ canonicalConceptId: 'cc-a', name: 'a', learner: null, examEvidence: other, alsoRelevantFor: [] }] })], OPTS);
    expect(plan.requirements[0].status).toBe('NO_EVIDENCE');
    expect(plan.requirements[0].recommendation.reasons).toEqual(expect.arrayContaining(['OTHER_EXAM_STRENGTH', 'NO_EVIDENCE']));
    expect(learningFactsFromPlan(plan, null)).toMatchObject({ mappedWithEvidence: 0, otherExamOnlyRequirements: 1, crossExamEvidenceConcepts: 0 });
  });

  it('display keeps both labels: knowledgeLabel (longitudinal) and label (this exam)', () => {
    const plan = buildPreparationPlan([req('a', learner({ examScope: { inScopeEvidence: 0, outOfScopeExamEvidence: 6 } }))], OPTS);
    expect(plan.requirements[0].concepts[0]).toMatchObject({ label: 'NO_EVIDENCE', knowledgeLabel: 'DEMONSTRATED' });
  });
});

// ------------------------------------------------------------------ write + read path wiring (static)
describe('write path captures the exam identity', () => {
  it('recordSimulationItemResponse stores metadata.examScope from the attempt (caller target must agree)', () => {
    const src = read('src/lib/simulation/scoring.service.ts');
    expect(src).toMatch(/metadata\.examScope = examEvidenceScopeMetadata\(/);
    expect(src).toMatch(/SELECT student_exam_profile_id FROM exam_attempts WHERE id = \$1/);
    expect(src).toMatch(/exam target mismatch/);
  });
  it('the live item path passes the attempt\'s target', () => {
    expect(read('src/lib/simulation/item-resolution.service.ts')).toMatch(/examTargetId: loaded\.attempt\.examProfileId/);
  });
});

describe('exam-specific readers are target-scoped', () => {
  it('examEvidence / learnerStates (preparation.service)', () => {
    const src = read('src/lib/exam-core/objectives/preparation.service.ts');
    expect(src).toMatch(/\(sa\.exam_profile_id = \$4::uuid\) AS own_target/);
    expect(src).toMatch(/inExamScopeSql\('le', '\$3'\)/);
    expect(src).toMatch(/learnerStates\(studentId, canonicalIds, profile\.id\)/);
    expect(src).toMatch(/examEvidence\(studentId, reqs\.map\(\(r\) => r\.code\), canonicalIds, profile\.id\)/);
    expect(src).not.toMatch(/configKeys\.includes\(x\.config_key\)/);
  });
  it('T5 deriveExamGaps: latest per target x objective; getExamPreparationPlan passes its target', () => {
    const src = read('src/lib/learning-plan/exam-bridge.service.ts');
    expect(src).toMatch(/\$\{r\.student_id\}:\$\{r\.exam_profile_id\}:\$\{r\.learning_objective_id\}/);
    expect(src).toMatch(/ea\.student_exam_profile_id = \$2::uuid/);
    expect(src).toMatch(/deriveExamGaps\(\[studentId\], conceptIds, \{ examProfileId \}\)/);
  });
  it('T6 readiness snapshot: this target\'s simulations, this target\'s evidence scope', () => {
    const src = read('src/lib/readiness/readiness.service.ts');
    expect(src).toMatch(/sa\.exam_profile_id = \$3/);
    expect(src).toMatch(/inExamScopeSql\('le', '\$2'\)/);
    expect(src).toMatch(/classifyBlueprintTargetCoverage\(t, params\.studentId, params\.examVersionId, params\.examProfileId\)/);
  });
  it('T7 blueprint coverage and its diagnosis read only the target\'s scope', () => {
    const cov = read('src/lib/readiness/blueprint-coverage.service.ts');
    expect(cov).toMatch(/inExamScopeSql\('le', '\$3'\)/);
    expect(cov).toMatch(/examTargetId: examProfileId/);
    expect(read('src/lib/diagnostics/evidence-gate.service.ts')).toMatch(/inExamScopeSql\('le', '\$3'\)/);
    expect(read('src/lib/simulation/post-exam-diagnosis.service.ts')).toMatch(/examTargetId,/);
  });
  it('T8 examGapsFor: the domain comes from the attempt\'s own exam version', () => {
    const src = read('src/lib/exam-core/exam-gaps.service.ts');
    expect(src).toMatch(/b\.exam_version_id = g\.exam_version_id/);
    expect(src).toMatch(/group\(\(r\) => `\$\{r\.family\}\|\$\{r\.exam\}\|\$\{r\.objective_id\}`\)/);
  });
  it('T15 G6 adds no Blueprint V2 dependency to any reader (Blueprint SHADOW stays observation-only)', () => {
    for (const f of ['src/lib/exam-core/evidence-scope.ts', 'src/lib/exam-core/objectives/preparation.service.ts', 'src/lib/learning-plan/exam-bridge.service.ts', 'src/lib/readiness/readiness.service.ts', 'src/lib/readiness/blueprint-coverage.service.ts', 'src/lib/diagnostics/evidence-gate.service.ts', 'src/lib/exam-core/exam-gaps.service.ts', 'src/lib/student/onboarding-gate.ts']) {
      expect(read(f), f).not.toMatch(/blueprint-v2/);
    }
  });
});

describe('T12 / T13 onboarding: only Student-valid targets count', () => {
  it('the ONE predicate reuses the QB-0 audience rule (no duplicated audience logic)', () => {
    expect(VALID_EXAM_TARGET_PREDICATE).toContain(`status <> 'ARCHIVED'`);
    expect(VALID_EXAM_TARGET_PREDICATE).toContain(studentVisibleDefinitionSql('vt_d'));
    expect(VALID_EXAM_TARGET_PREDICATE).toContain('exam_definition_id IS NULL'); // objective-first targets stay valid
    // The audience rule lives only in the shared helper: no technical prefix literal in the gate's code.
    expect(read('src/lib/student/onboarding-gate.ts')).not.toMatch(/['`"][^'`"\n]*dev-cert/);
  });
});
