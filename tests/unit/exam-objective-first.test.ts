/**
 * Exam preparation, objective first -- catalogue, capability gating,
 * personalized plan, next step, routing and route security (pure / mocked).
 *
 *   "Exam availability ≠ activity availability": every governed objective is
 *   selectable; readiness only decides the activities inside the preparation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { examObjectives, objectiveByKey, objectiveForConfig, objectiveForNode, searchObjectives, OBJECTIVE_FRAMEWORKS } from '@/lib/exam-core/objectives/objective-catalog';
import { computeCapabilities, objectiveStatusKey, type ObjectiveEntry } from '@/lib/exam-core/objectives/capabilities';
import { buildPreparationPlan, classifyRequirement, conceptKnowledgeLabel, nextStep, type RequirementInput, type LearnerConceptState } from '@/lib/exam-core/objectives/preparation-plan';
import { resolveFirstDestination, onboardingRouteRedirect } from '@/lib/lx/first-destination';
import { V2_VERTICALS } from '@/lib/exam-core/verticals/v2';

const ROOT = join(__dirname, '../..');

// ------------------------------------------------------------------ catalogue
describe('objective catalogue: every governed exam objective is selectable', () => {
  const list = examObjectives();
  it('covers every framework, with the framework-specific objective level', () => {
    const by = (fw: string) => list.filter((o) => o.framework === fw);
    expect(new Set(list.map((o) => o.framework))).toEqual(new Set(OBJECTIVE_FRAMEWORKS.map((f) => f.key)));
    expect(by('PAA').map((o) => o.key)).toEqual(['paa']);
    expect(by('PISA').map((o) => o.key)).toEqual(['pisa.2022']);
    expect(by('SABER11').map((o) => o.key)).toEqual(['saber11']);
    expect(by('CIE_AICE').map((o) => o.key)).toEqual(['cie.aice.diploma']);
    expect(by('CIE_AICE')[0].kind).toBe('PROGRAMME_PLAN');
    // 49 Cambridge subjects / 87 subject-levels, each ONE objective even when listed in several AICE groups.
    expect(by('CIE_AS_A')).toHaveLength(87);
    expect(new Set(by('CIE_AS_A').map((o) => o.context.syllabusCode)).size).toBe(49);
    expect(by('IB_DP').length).toBeGreaterThan(50);
    expect(list.length).toBe(by('IB_DP').length + 87 + 2 + 4);
  });
  it('IB: subject -> SL / HL; TOK and EE are objectives; CAS (not examined) is not', () => {
    expect(objectiveByKey('ib.dp.physics.hl')?.context.subject).toBe('Physics');
    expect(objectiveByKey('ib.dp.physics.sl')).not.toBeNull();
    expect(objectiveByKey('ib.dp.theory-of-knowledge')).not.toBeNull();
    expect(objectiveByKey('ib.dp.extended-essay')).not.toBeNull();
    expect(objectiveByKey('ib.dp.cas')).toBeNull();
  });
  it('Cambridge: subject -> syllabus code -> AS / A Level; a multi-group subject keeps every group', () => {
    const o = objectiveByKey('cie.asal.8291.as')!;
    expect(o.nodeKeys.length).toBeGreaterThan(1);
    expect(o.context.groups.length).toBeGreaterThan(1);
    expect(objectiveByKey('cie.asal.9709.a')?.context.level).toBe('A Level');
  });
  it('every configured exam (V2 vertical) belongs to an objective; a node maps to its objective', () => {
    for (const v of V2_VERTICALS) expect(objectiveForConfig(v.key), v.key).not.toBeNull();
    expect(objectiveForConfig('v2.pisa.2022')?.key).toBe('pisa.2022');
    expect(objectiveForConfig('v2.aice.9709-as')?.key).toBe('cie.asal.9709.as');
    expect(objectiveForNode('pisa.2022.math.reason')?.key).toBe('pisa.2022');
    expect(objectiveForNode('cie.aice.g3.8291.as')?.key).toBe('cie.asal.8291.as');
  });
  it('search "Physics" returns IB Physics and Cambridge 9702, with enough context to tell them apart', () => {
    const r = searchObjectives('physics');
    expect(r.map((o) => o.key)).toEqual(expect.arrayContaining(['ib.dp.physics.hl', 'ib.dp.physics.sl', 'cie.asal.9702.as', 'cie.asal.9702.a']));
    expect(new Set(r.map((o) => o.context.programme)).size).toBeGreaterThan(1);
    expect(searchObjectives('9709').every((o) => o.context.syllabusCode === '9709')).toBe(true);
    expect(searchObjectives('ciencias pisa')).toEqual([]); // every word must match; nothing invented
  });
  it('objective keys are safe identifiers (stored, and validated by the API regex)', () => {
    for (const o of list) expect(o.key).toMatch(/^[a-z0-9._-]{1,120}$/);
  });
});

// ------------------------------------------------------------------ capabilities
const entry = (over: Partial<ObjectiveEntry>): ObjectiveEntry => ({ key: 'x', type: 'LEVEL', label: 'X', purpose: null, state: 'CATALOG_ONLY', modes: [], selectable: false, bankInProgress: false, sectionBound: false, lengthCoveragePercent: null, ...over });
const SUBJECT = { key: 'ib.dp.physics.hl', kind: 'SUBJECT_LEVEL' as const };

describe('getExamPreparationCapabilities: readiness gates capabilities, never selection', () => {
  it('CATALOG_ONLY: selectable, nothing to launch, transparent reasons', () => {
    const c = computeCapabilities(SUBJECT, [], 0);
    expect(c).toMatchObject({ canSelect: true, readiness: 'CATALOG_ONLY', canViewStructure: false, canPractice: false, canRunDiagnostic: false, canRunReducedMock: false, canRunFullMock: false, canUseLearningBridge: false });
    expect(c.unavailableReasons.map((r) => r.reason)).toContain('NOT_CONFIGURED');
    expect(objectiveStatusKey(c)).toBe('canAdd');
  });
  it('STRUCTURE_READY: structure visible; practice and mocks unavailable (bank in progress explained)', () => {
    const c = computeCapabilities(SUBJECT, [entry({ state: 'STRUCTURE_READY', bankInProgress: true })], 0);
    expect(c.canViewStructure).toBe(true);
    expect(c.canPractice).toBe(false);
    expect(c.unavailableReasons).toContainEqual({ capability: 'PRACTICE', reason: 'BANK_IN_PROGRESS' });
    expect(objectiveStatusKey(c)).toBe('bankInProgress');
  });
  it('PRACTICE_READY: practice + diagnostic; no mock', () => {
    const c = computeCapabilities(SUBJECT, [entry({ state: 'PRACTICE_READY', modes: ['PRACTICE'], selectable: true })], 3);
    expect(c).toMatchObject({ canPractice: true, canRunDiagnostic: true, canRunReducedMock: false, canRunFullMock: false, canUseLearningBridge: true });
    expect(c.unavailableReasons).toContainEqual({ capability: 'REDUCED_MOCK', reason: 'PRACTICE_ONLY' });
  });
  it('REDUCED_MOCK_READY: reduced mock with its coverage; full mock unavailable (REDUCED_ONLY)', () => {
    const c = computeCapabilities(SUBJECT, [entry({ state: 'REDUCED_MOCK_READY', modes: ['PRACTICE', 'MOCK', 'CHALLENGE'], selectable: true, lengthCoveragePercent: 27 })], 1);
    expect(c.reducedMocks).toEqual([expect.objectContaining({ lengthCoveragePercent: 27 })]);
    expect(c.canRunFullMock).toBe(false);
    expect(c.unavailableReasons).toContainEqual({ capability: 'FULL_MOCK', reason: 'REDUCED_ONLY' });
  });
  it('only FULL_MOCK_READY offers a full mock; a non-selectable or paper node is never launchable', () => {
    const full = computeCapabilities(SUBJECT, [entry({ state: 'FULL_MOCK_READY', modes: ['MOCK'], selectable: true })], 0);
    expect(full.canRunFullMock).toBe(true);
    const notSelectable = computeCapabilities(SUBJECT, [entry({ state: 'FULL_MOCK_READY', modes: ['MOCK'], selectable: false })], 0);
    expect(notSelectable.canRunFullMock).toBe(false);
    const paper = computeCapabilities(SUBJECT, [entry({ type: 'PAPER', state: 'FULL_MOCK_READY', modes: ['MOCK', 'PRACTICE'], selectable: true })], 0);
    expect(paper.canRunFullMock || paper.canPractice).toBe(false);
  });
  it('the AICE Diploma is a planner: no practice / mock of its own, explained', () => {
    const c = computeCapabilities({ key: 'cie.aice.diploma', kind: 'PROGRAMME_PLAN' }, [], 0);
    expect(c.canPlanDiploma).toBe(true);
    expect(c.canPractice).toBe(false);
    expect(c.unavailableReasons.every((r) => r.reason === 'PLANNED_BY_SUBJECT')).toBe(true);
  });
});

// ------------------------------------------------------------------ the plan
const learner = (over: Partial<LearnerConceptState>): LearnerConceptState => ({ studentConceptId: 'sc', subjectId: 'sub', masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE', memoryStatus: null, retentionDue: false, criticalMisconceptions: 0, evidenceCount: 3, ...over });
const req = (code: string, concepts: RequirementInput['concepts'], over: Partial<RequirementInput> = {}): RequirementInput => ({ learningObjectiveId: `lo-${code}`, code, description: code, area: 'Math', weight: 0.25, ownEvidence: null, concepts, ...over });
const concept = (id: string, l: LearnerConceptState | null, over: Partial<RequirementInput['concepts'][number]> = {}) => ({ canonicalConceptId: id, name: id, learner: l, examEvidence: null, alsoRelevantFor: [], ...over });

describe('personalized preparation plan: from the existing learner model, never a curriculum replay', () => {
  it('absence of evidence is NOT a weakness', () => {
    expect(classifyRequirement(req('a', [concept('c', null)])).status).toBe('NO_EVIDENCE');
    expect(conceptKnowledgeLabel(null)).toBe('NO_EVIDENCE');
    expect(classifyRequirement(req('b', [])).status).toBe('NOT_YET_MAPPED');
  });
  it('existing knowledge: A demonstrated (transfer done), B in retention, C practising', () => {
    const A = learner({ masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY', memoryStatus: 'STABLE' });
    const B = learner({ masteryState: 'VALIDATED_MASTERY', validationReadiness: 'WAITING_FOR_RETENTION', memoryStatus: 'WAITING_FOR_RETENTION', retentionDue: true });
    const C = learner({ masteryState: 'DEVELOPING' });
    expect(conceptKnowledgeLabel(A)).toBe('DEMONSTRATED');
    expect(conceptKnowledgeLabel(B)).toBe('MAINTENANCE');
    expect(conceptKnowledgeLabel(C)).toBe('IN_PROGRESS');
    const plan = buildPreparationPlan([req('A', [concept('A', A)]), req('B', [concept('B', B)]), req('C', [concept('C', C)]), req('D', [concept('D', null)])], { examDaysLeft: null, canPractice: true, canRunDiagnostic: true });
    expect(plan.requirements.map((r) => r.status)).toEqual(['ALREADY_STRONG', 'NEEDS_CONFIRMATION', 'NEEDS_CONFIRMATION', 'NO_EVIDENCE']);
    // Strong requirements are not re-taught; nothing is enrolled by the plan itself (pure, no writes).
    expect(plan.recommendations.map((r) => r.code)).not.toContain('A');
    expect(plan.requirements.find((r) => r.code === 'B')!.recommendation).toMatchObject({ action: 'CONTINUE_CONCEPT', reasons: expect.arrayContaining(['RETENTION_DUE']) });
    expect(plan.requirements.find((r) => r.code === 'D')!.recommendation.action).toBe('DIAGNOSTIC');
    expect(plan.coverage).toEqual({ total: 4, mapped: 4, mappedWithEvidence: 3 });
  });
  it('an evidenced difficulty wins: a gap in THIS exam, or an at-risk learner state', () => {
    const own = classifyRequirement(req('x', [concept('c', null)], { ownEvidence: { classification: 'GAP', at: '2026-10-01', examName: 'PISA 2022', sameExam: true } }));
    expect(own).toMatchObject({ status: 'NEEDS_REINFORCEMENT', gapExam: 'PISA 2022' });
    expect(classifyRequirement(req('z', [concept('c', learner({ masteryState: 'AT_RISK' }))])).status).toBe('NEEDS_REINFORCEMENT');
  });
  it('same content, different exams: another exam\'s result is context, never "covered", "gap" or "to confirm" here (G6)', () => {
    const otherGap = { classification: 'GAP' as const, at: '2026-10-01', examName: 'PAA', sameExam: false };
    const otherStrength = { classification: 'STRENGTH' as const, at: '2026-10-01', examName: 'PAA', sameExam: false };
    // G6: another exam's result alone leaves the requirement without evidence for THIS target.
    expect(classifyRequirement(req('y', [concept('c', null, { examEvidence: otherGap })]))).toMatchObject({ status: 'NO_EVIDENCE', gapExam: null, otherExam: otherGap });
    expect(classifyRequirement(req('w', [concept('c', null, { examEvidence: otherStrength })])).status).toBe('NO_EVIDENCE');
    const plan = buildPreparationPlan([req('y', [concept('c', null, { examEvidence: otherGap })]), req('w', [concept('d', null, { examEvidence: otherStrength })])], { examDaysLeft: null, canPractice: true, canRunDiagnostic: true });
    // ... so this target finds out for itself (diagnostic); the other exam is shown as context.
    expect(plan.requirements[0].recommendation).toMatchObject({ action: 'DIAGNOSTIC', otherExam: 'PAA', reasons: expect.arrayContaining(['OTHER_EXAM_GAP', 'NO_EVIDENCE']) });
    expect(plan.requirements[1].recommendation.reasons).toContain('OTHER_EXAM_STRENGTH');
    // The concept's learner state is shared; this exam's result is what confirms the format.
    const known = buildPreparationPlan([req('k', [concept('e', learner({ masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY', memoryStatus: 'STABLE' }))])], { examDaysLeft: null, canPractice: true, canRunDiagnostic: true });
    expect(known.requirements[0]).toMatchObject({ status: 'ALREADY_STRONG', formatConfirmed: false, recommendation: { reasons: ['CONFIRM_IN_EXAM_FORMAT'] } });
  });
  it('recommendation reuses the SAME learner state: studied -> continue, not studied -> add (one concept)', () => {
    const plan = buildPreparationPlan(
      [req('s', [concept('studied', learner({ masteryState: 'AT_RISK' }))]), req('n', [concept('new', null)], { ownEvidence: { classification: 'GAP', at: '2026-10-01', examName: 'X', sameExam: true } })],
      { examDaysLeft: null, canPractice: false, canRunDiagnostic: false }
    );
    expect(plan.requirements[0].recommendation).toMatchObject({ action: 'CONTINUE_CONCEPT', canonicalConceptId: 'studied' });
    expect(plan.requirements[1].recommendation).toMatchObject({ action: 'ADD_TO_PLAN', canonicalConceptId: 'new', reasons: ['EXAM_GAP'] });
  });
  it('transparent priority: gap severity, blueprint weight, exam date, retention -- explained factors', () => {
    const plan = buildPreparationPlan(
      [req('heavy', [concept('c1', null)], { weight: 0.6, ownEvidence: { classification: 'GAP', at: '2026-10-01', examName: 'X', sameExam: true } }), req('light', [concept('c2', null)], { weight: 0.1 }), req('l2', [concept('c3', null)], { weight: 0.3 })],
      { examDaysLeft: 10, canPractice: true, canRunDiagnostic: true }
    );
    const top = plan.recommendations[0];
    expect(top.code).toBe('heavy');
    expect(top.priority).toMatchObject({ band: 'HIGH', factors: expect.arrayContaining(['GAP_SEVERITY', 'HIGH_BLUEPRINT_WEIGHT', 'EXAM_SOON']) });
  });
  it('one next step: resume > planner > high-priority concept > diagnostic (mostly unknown) > practice > structure > goal details', () => {
    const empty = buildPreparationPlan([req('a', [concept('c', null)])], { examDaysLeft: null, canPractice: true, canRunDiagnostic: true });
    const base = { plan: empty, canPractice: true, canRunDiagnostic: true, diagnosticDone: false, canViewStructure: true, canPlanDiploma: false, hasExamDate: false };
    expect(nextStep({ ...base, openAttemptId: 'att' }).kind).toBe('RESUME');
    expect(nextStep({ ...base, openAttemptId: null }).kind).toBe('DIAGNOSTIC');
    expect(nextStep({ ...base, openAttemptId: null, diagnosticDone: true, canPractice: true }).kind).toBe('PRACTICE');
    expect(nextStep({ ...base, openAttemptId: null, plan: null, canPractice: false, canRunDiagnostic: false }).kind).toBe('REVIEW_STRUCTURE');
    expect(nextStep({ ...base, openAttemptId: null, plan: null, canPractice: false, canRunDiagnostic: false, canViewStructure: false }).kind).toBe('SET_GOAL_DETAILS');
    expect(nextStep({ ...base, openAttemptId: null, canPlanDiploma: true }).kind).toBe('PLAN_DIPLOMA');
  });
});

// ------------------------------------------------------------------ onboarding
describe('exam-first onboarding: no subject needed before choosing an exam goal', () => {
  it('a Student with an exam goal and no subject resumes in the preparation, never trapped in onboarding', () => {
    expect(resolveFirstDestination({ hasSubject: false, hasExamGoal: true }).path).toBe('/dashboard/exam-prep');
    expect(onboardingRouteRedirect({ hasSubject: false, hasExamGoal: true })).toBe('/dashboard/exam-prep');
    expect(resolveFirstDestination({ hasSubject: false }).path).toBe('/dashboard/onboarding');
    expect(resolveFirstDestination({ hasSubject: true, hasExamGoal: true }).path).toBe('/dashboard/today');
  });
  it('onboarding offers both entries: learn a subject / prepare an exam', () => {
    const src = readFileSync(join(ROOT, 'src/app/dashboard/onboarding/page.tsx'), 'utf-8');
    expect(src).toMatch(/prep\.onboarding\.learn/);
    // REM-T1-05: both journeys navigate to a dedicated step; the exam one is Exam Prep (Back returns here).
    expect(src).toMatch(/href=\{ONBOARDING_EXAM_PATH\}/);
    expect(readFileSync(join(ROOT, 'src/lib/lx/onboarding-paths.ts'), 'utf-8')).toMatch(/ONBOARDING_EXAM_PATH = '\/dashboard\/exam-prep\?from=onboarding'/);
  });
});

// ------------------------------------------------------------------ UI contract (source)
describe('Explorer / preparation UI contract', () => {
  const picker = readFileSync(join(ROOT, 'src/app/dashboard/exam-prep/ObjectivePicker.tsx'), 'utf-8');
  const home = readFileSync(join(ROOT, 'src/app/dashboard/exam-prep/[examProfileId]/PreparationHome.tsx'), 'utf-8');
  it('no objective is disabled or hidden by readiness; filters are name / framework / region only', () => {
    expect(picker).not.toMatch(/disabled=\{[^}]*status/);
    expect(picker).not.toMatch(/filter\([^)]*status/);
    expect(picker).not.toMatch(/Próximamente/);
  });
  it('status is text (not colour only) and CTAs are touch-sized, with screen-reader labels', () => {
    // T1 UI polish (M06): still text, now resolved from the actual preparation state (never "can add" once added).
    expect(picker).toMatch(/\{l\[preparationBadgeLabelKey\(badgeOf\(o\)\)\]\}/);
    expect(picker).toMatch(/aria-label=\{`\$\{ctaLabel\(o\)\}: \$\{o\.label\}`\}/);
    expect(readFileSync(join(ROOT, 'src/app/globals.css'), 'utf-8')).toMatch(/\.prep-cta \{ min-height: var\(--touch-target\); \}/);
  });
  it('the home never claims official readiness / content and labels reduced vs full mocks', () => {
    expect(home).toMatch(/prep\.home\.estimate/);
    expect(home).toMatch(/prep\.cap\.reducedMock/);
    expect(home).toMatch(/c\.fullMocks\.map/);
    const es = readFileSync(join(ROOT, 'src/lib/i18n/messages.ts'), 'utf-8');
    expect(es).toMatch(/'prep\.home\.estimateNote': 'Es una orientación de StudyUs a partir de tu evidencia\. No es una predicción del resultado oficial\.'/);
    expect(es).not.toMatch(/'prep\.[^']+': '[^']*[Ss]imulacro oficial/);
  });
});

// ------------------------------------------------------------------ migration
describe('migration 20261025_1000 is additive', () => {
  const sql = readFileSync(join(ROOT, 'database/migrations/20261025_1000_track_b_exam_objective_first.sql'), 'utf-8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  it('relaxes one NOT NULL, adds columns / constraints / indexes, drops nothing but a widened check', () => {
    expect(sql).toMatch(/ALTER COLUMN exam_definition_id DROP NOT NULL/);
    expect(sql).toMatch(/CHECK \(exam_definition_id IS NOT NULL OR objective_key IS NOT NULL\)/);
    expect(sql).toMatch(/uq_student_exam_profiles_one_active_objective[\s\S]*WHERE status <> 'ARCHIVED' AND objective_key IS NOT NULL/);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/);
    expect(sql.match(/DROP CONSTRAINT/g) ?? []).toHaveLength(1);
    expect(sql).toMatch(/CHECK \(source IN \('EXAM_GAP', 'EXAM_PREPARATION'\)\)/);
  });
});

// ------------------------------------------------------------------ route security
const gate = vi.hoisted(() => ({ requireActor: vi.fn(), ownStudentId: vi.fn(), requireOwnerOf: vi.fn() }));
vi.mock('@/lib/exam-core/route-auth', () => gate);
const svc = vi.hoisted(() => ({ createObjectivePreparation: vi.fn(), startPreparationDiagnostic: vi.fn(), addConceptFromPreparation: vi.fn(), getPreparationView: vi.fn(), updatePreparationDetails: vi.fn(), allObjectiveCapabilities: vi.fn() }));
vi.mock('@/lib/exam-core/objectives/preparation.service', async () => {
  class PreparationError extends Error {
    constructor(public readonly code: string) { super(code); }
  }
  return { ...svc, PreparationError };
});
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));

import { POST as createPOST } from '@/app/api/exam-preparation/route';
import { POST as diagPOST } from '@/app/api/exam-preparation/[id]/diagnostic/route';
import { POST as conceptPOST } from '@/app/api/exam-preparation/[id]/concepts/route';
import { GET as viewGET, PATCH as viewPATCH } from '@/app/api/exam-preparation/[id]/route';
import { PreparationError } from '@/lib/exam-core/objectives/preparation.service';

const PID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const httpReq = (body?: unknown) => new Request('http://localhost/api/exam-preparation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as any;
const ctx = (id = PID) => ({ params: Promise.resolve({ id }) });

describe('exam preparation routes: owner-only, server-authoritative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.requireActor.mockResolvedValue({ ok: true, actorUserId: 'u1' });
    gate.ownStudentId.mockResolvedValue('s1');
    gate.requireOwnerOf.mockResolvedValue({ ok: true, actorUserId: 'u1' });
  });
  it('unauthenticated -> 401; no own learner account -> 403', async () => {
    gate.requireActor.mockResolvedValueOnce({ ok: false, status: 401, error: 'UNAUTHORIZED' });
    expect((await (createPOST as any)(httpReq({ objectiveKey: 'paa' }))).status).toBe(401);
    gate.ownStudentId.mockResolvedValueOnce(null);
    expect((await (createPOST as any)(httpReq({ objectiveKey: 'paa' }))).status).toBe(403);
    expect(svc.createObjectivePreparation).not.toHaveBeenCalled();
  });
  it('a client cannot send readiness / capabilities / another Student: strict body', async () => {
    for (const body of [{ objectiveKey: 'paa', capabilities: { canRunFullMock: true } }, { objectiveKey: 'paa', studentId: UUID2 }, { objectiveKey: 'paa', readiness: 'FULL_MOCK_READY' }, { objectiveKey: "paa'; drop" }]) {
      expect((await (createPOST as any)(httpReq(body))).status).toBe(400);
    }
    expect(svc.createObjectivePreparation).not.toHaveBeenCalled();
  });
  it('the Student is the authenticated owner; unknown objective -> 404; retry -> same preparation (200)', async () => {
    svc.createObjectivePreparation.mockResolvedValueOnce({ profile: { id: PID, objectiveKey: 'paa', status: 'ACTIVE' }, created: true, capabilities: {} });
    expect((await (createPOST as any)(httpReq({ objectiveKey: 'paa' }))).status).toBe(201);
    expect(svc.createObjectivePreparation).toHaveBeenCalledWith('s1', { objectiveKey: 'paa' });
    svc.createObjectivePreparation.mockResolvedValueOnce({ profile: { id: PID, objectiveKey: 'paa', status: 'ACTIVE' }, created: false, capabilities: {} });
    expect((await (createPOST as any)(httpReq({ objectiveKey: 'paa' }))).status).toBe(200);
    svc.createObjectivePreparation.mockRejectedValueOnce(new (PreparationError as any)('OBJECTIVE_NOT_FOUND'));
    expect((await (createPOST as any)(httpReq({ objectiveKey: 'nope.nope' }))).status).toBe(404);
  });
  it('diagnostic on a preparation that cannot practise -> 409; another Student’s preparation -> 404', async () => {
    svc.startPreparationDiagnostic.mockRejectedValueOnce(new (PreparationError as any)('CAPABILITY_NOT_AVAILABLE'));
    expect((await (diagPOST as any)(httpReq(), ctx())).status).toBe(409);
    svc.startPreparationDiagnostic.mockRejectedValueOnce(new (PreparationError as any)('NOT_FOUND'));
    expect((await (diagPOST as any)(httpReq(), ctx())).status).toBe(404);
    expect((await (diagPOST as any)(httpReq(), ctx('not-a-uuid'))).status).toBe(404);
  });
  it('"Añadir a mi plan" only for a requirement of THIS preparation (else 400); foreign -> 404', async () => {
    svc.addConceptFromPreparation.mockRejectedValueOnce(new (PreparationError as any)('REQUIREMENT_NOT_IN_PREPARATION'));
    expect((await (conceptPOST as any)(httpReq({ learningObjectiveId: PID, canonicalConceptId: UUID2 }), ctx())).status).toBe(400);
    svc.addConceptFromPreparation.mockRejectedValueOnce(new (PreparationError as any)('NOT_FOUND'));
    expect((await (conceptPOST as any)(httpReq({ learningObjectiveId: PID, canonicalConceptId: UUID2 }), ctx())).status).toBe(404);
    expect((await (conceptPOST as any)(httpReq({ learningObjectiveId: PID, canonicalConceptId: UUID2, all: true }), ctx())).status).toBe(400);
  });
  it('view of another Student’s preparation -> 404; goal details are validated', async () => {
    svc.getPreparationView.mockResolvedValueOnce(null);
    expect((await (viewGET as any)(new Request(`http://localhost/api/exam-preparation/${PID}`) as any, ctx())).status).toBe(404);
    const patch = (body: unknown) => new Request(`http://localhost/api/exam-preparation/${PID}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
    expect((await (viewPATCH as any)(patch({ examDate: 'tomorrow' }), ctx())).status).toBe(400);
    expect((await (viewPATCH as any)(patch({ objectiveKey: 'ib.dp.physics.hl' }), ctx())).status).toBe(400);
  });
});
