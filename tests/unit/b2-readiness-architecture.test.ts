/**
 * B2 -- Q1 readiness / feasibility (the same solver, no Student), the read-only service, and the
 * architecture boundaries of the block (no writes, no cutover, no flag, no migration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const query = vi.fn();
const loadStudentAssessmentContextMock = vi.fn();
const loadQuestionCoverageMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: unknown[]) => query(sql, params) } }));
vi.mock('@/lib/assessment-foundation/student-assessment-context.service', () => ({ loadStudentAssessmentContext: (...a: unknown[]) => loadStudentAssessmentContextMock(...a) }));
vi.mock('@/lib/assessment-foundation/question-coverage.service', () => ({ loadQuestionCoverage: (...a: unknown[]) => loadQuestionCoverageMock(...a) }));

import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type QuestionCoverage, type ReviewedBankItemRow } from '@/lib/assessment-foundation/question-coverage';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import { evaluateFeasibility, evaluateOfficialSlotFeasibility, solveBlueprint, neutralEvidenceNeeds, depthRequirementFor, targetKey, DEPTH_PRESETS, type EvidenceCountPolicy, type TargetPlan } from '@/lib/assessment-blueprint';
import { eligibleSolverCandidates } from '@/lib/assessment-blueprint/pipeline';
import { evaluateExamVersionReadiness, loadLearningCandidates, RECENT_EXPOSURE_DAYS, solveLearningForStudent } from '@/lib/assessment-blueprint/assessment-blueprint.service';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };

function bank(id: string, objective: string, over: Partial<ReviewedBankItemRow> = {}): QuestionCoverage {
  return coverageOfReviewedBankItem({
    approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 1, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
    usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null,
    bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' },
    sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1, scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: [{ canonicalConceptId: `c-of-${objective}`, relationType: 'FULL' }], ...over,
  });
}
const cached = (id: string, concept: string, studentId = 'stu-1'): QuestionCoverage =>
  coverageOfLearningCacheItem({ candidateId: id, studentId, learnerConceptId: `lc-${concept}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: { status: 'CANONICAL', learnerConceptId: `lc-${concept}`, canonicalConceptId: concept, basis: 'CREATED_FROM_CANONICAL' } });

describe('B2 Q1 feasibility -- the same solver, a generic learner, no Student selection', () => {
  const OBJECTIVES = ['lo-1', 'lo-2', 'lo-3', 'lo-4'];
  const BANK = [
    bank('a1', 'lo-1'), bank('a2', 'lo-1', { questionType: 'short_answer', content: { difficulty: 4, marks: 1 } }), bank('a3', 'lo-1'), bank('a4', 'lo-1'),
    bank('b1', 'lo-2'),
    bank('fixture', 'lo-3', { contentOrigin: 'FIXTURE' }),
    bank('other-version', 'lo-3', { bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-2', assessmentComponentId: 'comp-1', currentVersionId: 'other-version', retired: false, language: 'es' } }),
    bank('unmapped', 'lo-2', { objectiveConcepts: [] }),
  ];
  const report = evaluateFeasibility({ kind: 'OBJECTIVE', targetIds: OBJECTIVES, coverages: BANK, eligibility: { family: 'EXAM_PREPARATION', examVersionId: 'ev-1' }, evidencePolicy: POLICY });

  it('counts only student-eligible content and says why the rest is out', () => {
    expect(report).toMatchObject({ kind: 'OBJECTIVE', targets: 4, eligibleQuestions: 6, unresolvedQuestions: 1, durationKnown: false });
    expect(report.rejected).toEqual({ BANK_DELIVERY_RULE: 1, EXAM_VERSION_MISMATCH: 1 });
  });

  it('classifies the coverage of every target; an objective with only a fixture or another version is UNCOVERED', () => {
    expect(report.coverage).toEqual({ DIRECT: 2, SUPPORTING_ONLY: 0, DERIVED_ONLY: 0, UNCOVERED: 2 });
    expect(report.coverageByTarget).toEqual([
      { id: 'lo-1', class: 'DIRECT', direct: 4, supporting: 0, derived: 0 },
      { id: 'lo-2', class: 'DIRECT', direct: 2, supporting: 0, derived: 0 },
      { id: 'lo-3', class: 'UNCOVERED', direct: 0, supporting: 0, derived: 0 },
      { id: 'lo-4', class: 'UNCOVERED', direct: 0, supporting: 0, derived: 0 },
    ]);
    expect(report.repeatSafeTargets).toBe(2);
    expect(report.diversity).toEqual({ difficultyLevels: 2, difficultyUnknown: 0, questionTypes: 2, questionTypeUnknown: 0 });
  });

  it('reports honest non-ready depth results with their causes -- UNKNOWN stays unknown', () => {
    for (const d of ['QUICK', 'BALANCED', 'DEEP'] as const) {
      expect(report.depth[d].status, d).toBe('INSUFFICIENT_COVERAGE');
      expect(report.depth[d].causes.NO_ELIGIBLE_CANDIDATE, d).toBeGreaterThan(0);
    }
    expect(report.depth.QUICK).toEqual({ status: 'INSUFFICIENT_COVERAGE', questionsNeeded: 2, targetsUnmet: 2, causes: { NO_ELIGIBLE_CANDIDATE: 2 } });
    expect(report.depth.DEEP.questionsNeeded).toBeGreaterThan(report.depth.QUICK.questionsNeeded);
    expect(report.diagnostic.status).toBe('INSUFFICIENT_COVERAGE');
  });

  it('its numbers ARE the solver\'s: the same plan through solveBlueprint gives the same answer', () => {
    const { candidates } = eligibleSolverCandidates(BANK, { family: 'EXAM_PREPARATION', studentId: '', examVersionId: 'ev-1' });
    for (const d of ['QUICK', 'BALANCED', 'DEEP'] as const) {
      const plan: TargetPlan = {
        mode: 'TARGETS', family: 'EXAM_PREPARATION',
        targets: neutralEvidenceNeeds(OBJECTIVES, POLICY).map((n) => ({ targetKey: targetKey('OBJECTIVE', n.canonicalConceptId), kind: 'OBJECTIVE' as const, id: n.canonicalConceptId, priority: n.priority, ...depthRequirementFor(n, d, false) })),
        accept: { supporting: DEPTH_PRESETS[d].acceptSupporting, derived: false }, soft: { difficulty: null, diversity: DEPTH_PRESETS[d].diversity, avoidRecent: false }, hard: { excludeRecent: false, maxSeconds: null }, unresolvedTargets: [],
      };
      const outcome = solveBlueprint(plan, candidates);
      expect(report.depth[d].status).toBe(outcome.status);
      expect(report.depth[d].questionsNeeded).toBe(outcome.selected.length);
    }
    const src = read('src/lib/assessment-blueprint/readiness/feasibility.ts');
    expect(src).toMatch(/from '\.\.\/solver\/solve'/);
    expect(src).not.toMatch(/assembleForm|selectItems/);
  });

  it('a ready bank is reported ready, and it selects nothing for anybody', () => {
    const full = OBJECTIVES.flatMap((o) => [1, 2, 3, 4].map((i) => bank(`${o}-${i}`, o, { questionType: i % 2 ? 'multiple_choice' : 'short_answer', content: { difficulty: 2 + (i % 3), marks: 1 } })));
    const r = evaluateFeasibility({ kind: 'OBJECTIVE', targetIds: OBJECTIVES, coverages: full, eligibility: { family: 'EXAM_PREPARATION', examVersionId: 'ev-1' }, evidencePolicy: POLICY });
    expect(Object.values(r.depth).map((d) => d.status)).toEqual(['READY', 'READY', 'READY']);
    expect([r.depth.QUICK.questionsNeeded, r.depth.BALANCED.questionsNeeded, r.depth.DEEP.questionsNeeded]).toEqual([4, 8, 12]);
    expect(JSON.stringify(r)).not.toMatch(/studentId|selected|"key"/);
  });

  it('per-Student cached questions are never bank readiness', () => {
    const r = evaluateFeasibility({ kind: 'CONCEPT', targetIds: ['C1'], coverages: [cached('g1', 'C1'), cached('g2', 'C1', 'stu-2')], eligibility: { family: 'LEARNING' }, evidencePolicy: POLICY });
    expect(r.eligibleQuestions).toBe(0);
    expect(r.rejected).toEqual({ NOT_OWNED_BY_STUDENT: 2 });
    expect(r.coverage.UNCOVERED).toBe(1);
  });

  it('exam-bank coverage of a CONCEPT is objective-derived: reported as DERIVED_ONLY, never credited as direct', () => {
    const r = evaluateFeasibility({ kind: 'CONCEPT', targetIds: ['c-of-lo-1'], coverages: [bank('a1', 'lo-1'), bank('a2', 'lo-1')], eligibility: { family: 'LEARNING' }, evidencePolicy: POLICY });
    expect(r.coverageByTarget).toEqual([{ id: 'c-of-lo-1', class: 'DERIVED_ONLY', direct: 0, supporting: 0, derived: 2 }]);
    expect(r.depth.QUICK).toMatchObject({ status: 'INSUFFICIENT_COVERAGE', questionsNeeded: 0, causes: { ONLY_WEAKER_COVERAGE: 1 } });
  });

  it('official slot feasibility: which positions the reviewed bank cannot fill', () => {
    const position = (index: number, objective: string): FormPosition => ({ index, blueprintObjectiveTargetId: `bot-${index}`, assessmentComponentId: 'comp-1', learningObjectiveId: objective, questionType: null, difficultyRange: null });
    const positions = [position(0, 'lo-1'), position(1, 'lo-2'), position(2, 'lo-2'), position(3, 'lo-3')];
    const r = evaluateOfficialSlotFeasibility({ examVersionId: 'ev-1', positions, coverages: BANK });
    expect(r).toMatchObject({ positions: 4, eligibleQuestions: 6, status: 'INSUFFICIENT_COVERAGE', unfillablePositions: [3] });
    expect(evaluateOfficialSlotFeasibility({ examVersionId: 'ev-1', positions: positions.slice(0, 3), coverages: BANK }).status).toBe('READY');
  });
});

describe('B2 service -- read-only wiring over the B1 loaders', () => {
  beforeEach(() => {
    query.mockReset();
    loadStudentAssessmentContextMock.mockReset();
    loadQuestionCoverageMock.mockReset();
  });
  const AS_OF = '2026-10-10T12:00:00.000Z';

  function arrange() {
    loadStudentAssessmentContextMock.mockResolvedValue({ ok: true, context: {
      curriculum: [{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1', extra: 'ignored' }],
      learnerState: { concepts: [
        { status: 'CANONICAL', learnerConceptId: 'lc-C1', canonicalConceptId: 'C1', basis: 'CREATED_FROM_CANONICAL' },
        { status: 'CANONICAL', learnerConceptId: 'lc-C2', canonicalConceptId: 'C2', basis: 'CREATED_FROM_CANONICAL' },
        { status: 'TRANSITIONAL', learnerConceptId: 'lc-C3', canonicalConceptId: 'C3', basis: 'LABEL_MATCH' },
      ] },
    } });
    query.mockImplementation(async (sql: string) => {
      if (/FROM mastery_policies/.test(sql)) return { rows: [{ version: 1, minimum_evidence_count: 3, minimum_independent_evidence_count: 2 }] };
      if (/FROM concept_knowledge_state/.test(sql)) return { rows: [{ concept_id: 'lc-C1', mastery_state: 'VALIDATED_MASTERY', validation_readiness: 'READY', evidence_count: 6, independent_evidence_count: 3, next_review_at: null }] };
      if (/FROM question_bank_candidates/.test(sql)) return { rows: [
        { id: 'a1', usage_count: 2, last_used_at: new Date('2026-10-08T00:00:00.000Z') },
        { id: 'a2', usage_count: 0, last_used_at: null },
        { id: 'b1', usage_count: 1, last_used_at: new Date('2026-08-01T00:00:00.000Z') },
        { id: 'b2', usage_count: 0, last_used_at: null },
      ] };
      return { rows: [] };
    });
    loadQuestionCoverageMock.mockImplementation(async (refs: Array<{ id: string }>) => refs.map((r) => cached(r.id, r.id.startsWith('a') ? 'C1' : 'C2')));
  }

  it('solves for a Student from canonical state, reports unresolved targets, and only reads', async () => {
    arrange();
    const r = await solveLearningForStudent('stu-1', { intent: 'CUSTOM_CONCEPT_PRACTICE', depth: 'BALANCED', learnerConceptIds: ['lc-C1', 'lc-C2', 'lc-C3'], asOf: AS_OF });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.solution;
    // C1 is mastered: one look, on the question not seen recently. C2 has no evidence: two opportunities.
    expect(s.outcome.selected.map((x) => x.question.id).sort()).toEqual(['a2', 'b1', 'b2']);
    expect(s.outcome.status).toBe('PARTIAL');
    expect(s.outcome.unmet).toEqual([{ subject: 'LEARNER_CONCEPT:lc-C3', requirement: 'IDENTITY', missing: 1, cause: 'UNRESOLVED_TARGET' }]);
    expect(s.snapshot).toMatchObject({ curriculum: [{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }], learnerEvidence: { asOf: AS_OF }, depth: 'BALANCED' });
    expect(loadStudentAssessmentContextMock).toHaveBeenCalledWith('stu-1', { family: 'LEARNING', purpose: 'PRACTICE' });
    for (const [sql] of query.mock.calls) {
      expect(String(sql).trim()).toMatch(/^SELECT/);
      expect(String(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE|UPSERT|ALTER|CREATE)\b/);
    }
    // the cache is read for the Student's CANONICAL instances only
    const cacheCall = query.mock.calls.find(([sql]) => /question_bank_candidates/.test(String(sql)))!;
    expect(cacheCall[1]).toEqual(['stu-1', ['lc-C1', 'lc-C2']]);
  });

  it('exposure comes from recorded usage against the explicit asOf', async () => {
    arrange();
    const { exposure } = await loadLearningCandidates('stu-1', ['lc-C1', 'lc-C2'], AS_OF);
    expect(RECENT_EXPOSURE_DAYS).toBe(14);
    expect(Object.fromEntries(exposure)).toEqual({ 'LEARNING_ITEM_CACHE:a1': { seen: true, recent: true }, 'LEARNING_ITEM_CACHE:b1': { seen: true, recent: false } });
    expect((await loadLearningCandidates('stu-1', [], AS_OF)).coverages).toEqual([]);
  });

  it('a context that cannot be loaded is returned as issues: nothing is solved from a guess', async () => {
    loadStudentAssessmentContextMock.mockResolvedValue({ ok: false, issues: [{ code: 'NO_PREPARATION' }] });
    expect(await solveLearningForStudent('stu-1', { intent: 'DIAGNOSTIC', depth: 'QUICK', canonicalConceptIds: ['C1'], asOf: AS_OF })).toEqual({ ok: false, issues: [{ code: 'NO_PREPARATION' }] });
    expect(query).not.toHaveBeenCalled();
  });

  it('exam-version readiness reads the blueprint objectives and the current reviewed items, and writes nothing', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/FROM mastery_policies/.test(sql)) return { rows: [{ version: 1, minimum_evidence_count: 3, minimum_independent_evidence_count: 2 }] };
      if (/blueprint_objective_targets/.test(sql)) return { rows: [{ learning_objective_id: 'lo-1' }, { learning_objective_id: 'lo-2' }] };
      if (/FROM approved_items/.test(sql)) return { rows: [{ id: 'i1' }] };
      return { rows: [] };
    });
    loadQuestionCoverageMock.mockResolvedValue([bank('i1', 'lo-1')]);
    const r = await evaluateExamVersionReadiness('ev-1');
    expect(r).toMatchObject({ targets: 2, eligibleQuestions: 1, coverage: { DIRECT: 1, UNCOVERED: 1 } });
    expect(loadQuestionCoverageMock).toHaveBeenCalledWith([{ store: 'REVIEWED_EXAM_BANK', id: 'i1' }]);
    for (const [sql] of query.mock.calls) expect(String(sql).trim()).toMatch(/^SELECT/);
  });
});

/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const B2_DIR = join(ROOT, 'src/lib/assessment-blueprint');
const B2_FILES = walk(B2_DIR);

describe('B2 architecture', () => {
  // B2-B2: ONE file of the module writes -- the persistence adapter -- and only the tables B2 owns.
  const PERSISTENCE_ADAPTER = 'protected/blueprint-persistence.service.ts';
  const B2_OWNED_TABLES = ['assessment_blueprints', 'assessment_blueprint_requirements', 'assessment_blueprint_requirement_sources', 'assessment_frozen_forms', 'assessment_frozen_form_positions'];

  it('B2 writes no evidence, mastery or snapshot; mutation SQL exists only in the persistence adapter', () => {
    for (const f of B2_FILES) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (!f.endsWith(PERSISTENCE_ADAPTER)) expect(code, f).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ON\s+CONFLICT)\b/i);
      expect(code, f).not.toMatch(/updateMastery|recordEvidence|learning_evidence|writeEvidence|\.connect\(/);
    }
    // IO lives in exactly two files: the read-only loaders and the persistence adapter
    const withIo = B2_FILES.filter((f) => /^import (?!type\b)[^;]*?from '[^']*(@\/lib\/db|\.service)';/m.test(stripComments(readFileSync(f, 'utf8')))).map((f) => f.replace(`${B2_DIR}/`, '')).sort();
    expect(withIo).toEqual(['assessment-blueprint.service.ts', PERSISTENCE_ADAPTER]);
  });

  it('the persistence adapter writes only the five B2-owned tables: never a Question Bank table, never a legacy blueprint, never an instance', () => {
    const code = stripComments(read(`src/lib/assessment-blueprint/${PERSISTENCE_ADAPTER}`));
    const written = [...code.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?([a-z_]+)/g)].map((m) => m[1]);
    expect(written.length).toBeGreaterThanOrEqual(6);
    expect([...new Set(written)].sort()).toEqual([...B2_OWNED_TABLES].sort());
    expect(written.some((t) => t.startsWith('question_bank_') || t === 'approved_items' || t === 'exam_instances' || t === 'exam_item_usage')).toBe(false);
    expect(code).not.toMatch(/ON\s+CONFLICT|TRUNCATE|ALTER\s+TABLE|DROP\s+|DISABLE\s+TRIGGER|session_replication_role/i);
    // every blueprint row it inserts or updates is a variant: the legacy blueprint (purpose NULL) is never written or returned
    expect(code).toMatch(/INSERT INTO assessment_blueprints \(exam_version_id, purpose, form_number, revision, pool\)/);
    for (const m of code.matchAll(/UPDATE assessment_blueprints[^`]*`/g)) expect(m[0]).toMatch(/purpose IS NOT NULL/);
    for (const m of code.matchAll(/(?:FROM|JOIN) assessment_blueprints[^`]*`/g)) expect(m[0]).toMatch(/purpose IS NOT NULL/);
    // it reads no Question Bank fact either: positions come from the pure form, candidates from B1 coverage
    expect(code).not.toMatch(/question_bank_|approved_items|reuse_rights|content_rights/);
    // writers take the caller's transaction (no default executor) and decide no rights or eligibility
    for (const fn of ['createDraftVariant', 'publishVariant', 'createDraftFrozenForm', 'publishFrozenForm', 'discardDraftFrozenForm']) expect(code).toMatch(new RegExp(`export async function ${fn}\\(tx: DbExecutor,`));
  });

  it('no runtime cutover: nothing outside the module imports it', () => {
    const importers = walk(join(ROOT, 'src')).filter((f) => !f.startsWith(B2_DIR) && /from '[^']*assessment-blueprint[^']*'|import\('[^']*assessment-blueprint/.test(readFileSync(f, 'utf8')));
    expect(importers).toEqual([]);
  });

  it('reads no feature flag and no environment', () => {
    for (const f of B2_FILES) expect(stripComments(readFileSync(f, 'utf8')), f).not.toMatch(/process\.env|EXAM_BLUEPRINT_V2|STUDENT_JOURNEY_V2|CANONICAL_ENGINE_V1|feature-flags|isEnabled\(/);
  });

  it('policy is separate from the solver: the solver knows no family rule, no depth and no evidence', () => {
    for (const f of ['solver/solve.ts', 'solver/candidate.ts', 'solver/plan.ts']) {
      const code = stripComments(read(`src/lib/assessment-blueprint/${f}`));
      expect(code, f).not.toMatch(/\.\.\/policy\/|practice-depth|evidence-requirement|pedagogical-engine|knowledge-state|exam-gap|QUICK|BALANCED|DEEP/);
    }
    // the three policies never select: none calls the solver
    for (const f of ['policy/learning.ts', 'policy/exam-preparation.ts', 'policy/official-exam.ts', 'policy/practice-depth.ts', 'policy/evidence-requirement.ts']) {
      expect(stripComments(read(`src/lib/assessment-blueprint/${f}`)), f).not.toMatch(/solveBlueprint|solver\/solve/);
    }
    // one solver: every pipeline and the readiness projection call the same function
    expect(stripComments(read('src/lib/assessment-blueprint/pipeline.ts')).match(/solveBlueprint\(/g)).toHaveLength(3);
    expect(walk(join(ROOT, 'src')).filter((f) => /export function solveBlueprint\b/.test(readFileSync(f, 'utf8')))).toHaveLength(1);
  });

  it('B2 defines no mastery threshold of its own', () => {
    for (const f of B2_FILES) {
      const code = stripComments(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/minimumEvidenceCount\s*[:=]\s*\d|minimumIndependentEvidenceCount\s*[:=]\s*\d|minimumScorePercent\s*[:=]\s*\d/);
    }
    expect(read('src/lib/assessment-blueprint/policy/learning.ts')).toMatch(/CANONICAL_POLICY/);
    expect(read('src/lib/assessment-blueprint/assessment-blueprint.service.ts')).toMatch(/FROM mastery_policies/);
  });

  it('the B2 core added no migration; B2-B1 adds exactly the eight persistence migrations after the B1-E one', () => {
    const migrations = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    // CURR-PAA added the curriculum-node link (20261111_1000) after them.
    expect(migrations.filter((f) => f < '20261110_1800')).toHaveLength(79);
    expect(migrations[70]).toBe('20261109_1000_simulation_type_challenge_reduced_mock.sql');
    expect(migrations.slice(71, 79)).toEqual(['20261110_1000_qb_provenance_rights_content_sources.sql', '20261110_1100_qb_asset_registry.sql', '20261110_1200_qb_stimuli.sql', '20261110_1300_qb_item_concept_attribution.sql', '20261110_1400_qb_pool_memberships.sql', '20261110_1500_qb_review_authority_originality.sql', '20261110_1600_assessment_blueprint_variants.sql', '20261110_1700_assessment_frozen_forms.sql']);
    // deferred by decision: answer reveal (migration 9) and the curriculum-node link (migration 10)
    const all = migrations.slice(71, 79).map((f) => readFileSync(join(ROOT, 'database/migrations', f), 'utf8').replace(/^\s*--.*$/gm, '')).join('\n');
    expect(all).not.toMatch(/exam_answer_reveals|question_bank_item_curriculum_nodes/);
    // 20261110_1800 (assessment snapshot column) comes from the B5 line; it sorts between the eight and the curriculum link.
    // + L10 shared-foundation schema batch (20261120_1000..1500): identity, relationships and memberships only; none touches a B2 table.
    expect(migrations.filter((f) => f >= '20261110_1800')).toEqual(['20261110_1800_assessment_snapshot.sql', '20261111_1000_qb_item_curriculum_nodes.sql', '20261112_1000_qb_review_requires_primary_attribution.sql', '20261120_1000_sf7_parent_relationship_lifecycle.sql', '20261120_1100_sf12_institution_student_memberships.sql', '20261120_1200_en1_institution_licenses.sql', '20261120_1300_sf8_role_onboarding_state.sql', '20261120_1400_sf10_single_persona_constraint.sql', '20261120_1500_cr_l9_02_enrollment_history.sql']);
  });

  it('the B1 authorities are consumed, not redefined', () => {
    const all = B2_FILES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    expect(all).toMatch(/evaluateQuestionEligibility/);
    expect(all).toMatch(/BlueprintRequirementSchema/);
    expect(all).toMatch(/BlueprintResultSchema/);
    expect(all).toMatch(/deriveInstanceAttemptType/);
    expect(all).toMatch(/canonicalConceptIdForAssessment/);
    expect(all).not.toMatch(/export function (evaluateQuestionEligibility|classifyExamFormFidelity|deriveInstanceAttemptType|isEligible)\b/);
  });
});
