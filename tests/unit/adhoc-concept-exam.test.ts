/**
 * A Student's own partial exam ("Crear examen" on a Subject).
 *
 *   Subject -> the concepts the Student chose -> size / time limit -> start now or schedule
 *   -> the existing learning assessment -> results -> evidence, with its provenance explicit.
 *
 * It needs no institution, programme, qualification, exam definition or official blueprint, and it is never
 * an official paper, a mock or an institutional examination.
 *
 * These tests drive the REAL Blueprint Core pipeline, the real freeze and the real evidence planner (same
 * technique as b3-evidence-loop); the database, the start authority's solver and the schedule writer are
 * replaced where a test is about routing or authorization. Letters refer to the required regression list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT = '22222222-2222-4222-8222-222222222222';
const SUBJECT = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_SUBJECT = 'aaaaaaaa-0000-4000-8000-000000000002';
const FOREIGN_SUBJECT = 'aaaaaaaa-0000-4000-8000-000000000003';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const C2 = 'cccccccc-0000-4000-8000-000000000002';
const C3 = 'cccccccc-0000-4000-8000-000000000003';
const C_OTHER_SUBJECT = 'cccccccc-0000-4000-8000-000000000009';
const C_FOREIGN = 'cccccccc-0000-4000-8000-00000000000f';
const OCCURRENCE = 'eeeeeeee-0000-4000-8000-000000000001';

/** A small world: who owns which Subject, which concept is in which Subject. */
const world = {
  subjects: [
    { id: SUBJECT, student_id: STUDENT, name: 'Matemáticas' },
    { id: OTHER_SUBJECT, student_id: STUDENT, name: 'Física' },
    { id: FOREIGN_SUBJECT, student_id: OTHER_STUDENT, name: 'Química' },
  ],
  concepts: [
    { id: C1, subject_id: SUBJECT }, { id: C2, subject_id: SUBJECT }, { id: C3, subject_id: SUBJECT },
    { id: C_OTHER_SUBJECT, subject_id: OTHER_SUBJECT },
    { id: C_FOREIGN, subject_id: FOREIGN_SUBJECT },
  ],
};
const h = vi.hoisted(() => ({ sql: [] as string[], clerk: 'clerk_owner' as string | null, studentRole: 'ACTIVE', scheduled: [] as any[], updated: [] as any[] }));

vi.mock('@/lib/db', () => {
  const query = async (sql: string, params: any[] = []) => {
    h.sql.push(sql);
    if (/^SELECT id, name FROM subjects WHERE id = \$1 AND student_id = \$2/.test(sql)) return { rows: world.subjects.filter((s) => s.id === params[0] && s.student_id === params[1]) };
    if (/^SELECT c\.id FROM concepts c WHERE c\.subject_id = \$1 AND c\.id = ANY/.test(sql)) return { rows: world.concepts.filter((c) => c.subject_id === params[0] && (params[1] as string[]).includes(c.id)).map((c) => ({ id: c.id })) };
    if (/^SELECT student_id FROM subjects WHERE id = \$1/.test(sql)) return { rows: world.subjects.filter((s) => s.id === params[0]).map((s) => ({ student_id: s.student_id })) };
    if (/FROM assessment_occurrences ao\s+JOIN subjects s/.test(sql)) return { rows: params[0] === OCCURRENCE ? [{ student_id: STUDENT, subject_id: SUBJECT }] : [] };
    if (/FROM quiz_sessions/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
  return { db: { query, connect: vi.fn() }, query };
});
vi.mock('@/lib/auth', () => ({
  verifyAuth: async () => (h.clerk ? { userId: h.clerk, role: 'student' } : null),
  verifyStudentAccess: async (_clerk: string, studentId: string) => h.studentRole === 'ACTIVE' && h.clerk === 'clerk_owner' && studentId === '11111111-1111-4111-8111-111111111111',
  requireStudentId: async () => (h.studentRole === 'ACTIVE' ? '11111111-1111-4111-8111-111111111111' : null),
  getOrCreateStudentId: async () => '11111111-1111-4111-8111-111111111111',
}));
vi.mock('@/services/assessment.service', () => ({
  scheduleAssessment: async (subjectId: string, scheduledDate: string, options: any) => { h.scheduled.push({ subjectId, scheduledDate, ...options }); return { id: 'occ-new', subjectId, scheduledDate, topics: options.topics ?? [] }; },
  updateOccurrence: async (id: string, patch: any) => { h.updated.push({ id, ...patch }); return { id, ...patch }; },
  cancelAssessment: async () => undefined,
}));
vi.mock('@/services/mastery.service', () => ({ updateMastery: async () => { throw new Error('no evidence is written by these tests'); } }));
vi.mock('@/services/knowledge-state.service', () => ({ getConceptKnowledgeState: async () => null }));
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ deriveExamGaps: async () => [] }));
vi.mock('@/lib/catalog/concept-identity.service', () => ({ resolveStudentConceptIdentities: async () => [] }));

import { NextRequest } from 'next/server';
import { coverageOfLearningCacheItem, type LearningCacheItemRow, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import type { ConceptIdentity } from '@/lib/catalog/concept-identity';
import { projectEvidenceNeeds, solveLearningBlueprint, type EvidenceCountPolicy } from '@/lib/assessment-blueprint';
import { LEARNING_INTENTS, activitySemanticsOf, buildLearningBlueprint } from '@/lib/assessment-blueprint/policy/learning';
import { freezeAssessment, planEvidence, type FrozenAssessment, type ScoredResponse } from '@/lib/assessment-execution';
import { learningActivityFor } from '@/lib/assessment-execution/assessment-execution.service';
import { startLearningAssessment } from '@/lib/assessment-execution/assessment-start.service';
import { ASSESSMENT_INTENT_OF_QUIZ_MODE } from '@/lib/assessment-experience/entry';
import { LAUNCH_ORIGINS, parseLaunchRequest } from '@/lib/assessment-experience/launch';
import { AD_HOC_EXAM_INTENT, AD_HOC_EXAM_SIZES, adHocExamHref, isAdHocExamIntent, toggleGroup } from '@/lib/assessment-experience/ad-hoc-exam';
import { AD_HOC_EXAM_MAX_CONCEPTS, normalizeSelection } from '@/lib/ad-hoc-exam/selection';
import { resolveAdHocExamScope } from '@/services/ad-hoc-exam.service';
import { hiddenFieldsOf, launchRequestOfQuery } from '@/app/dashboard/assessment/launch-params';
import { getAdHocExamMessages } from '@/lib/i18n/ad-hoc-exam-messages';
import { LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };
const AS_OF = '2026-10-12T12:00:00.000Z';
const canonical = (canonicalConceptId: string): ConceptIdentity => ({ status: 'CANONICAL', learnerConceptId: `lc-${canonicalConceptId}`, canonicalConceptId, basis: 'CREATED_FROM_CANONICAL' });
function cached(id: string, concept: string, over: Partial<LearningCacheItemRow> = {}): QuestionCoverage {
  return coverageOfLearningCacheItem({ candidateId: id, studentId: STUDENT, learnerConceptId: `lc-${concept}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: canonical(concept), ...over });
}
const POOL = [cached('a1', 'K1'), cached('a2', 'K1'), cached('a3', 'K1'), cached('b1', 'K2'), cached('b2', 'K2'), cached('b3', 'K2'), cached('c1', 'K3'), cached('c2', 'K3'), cached('z1', 'K9'), cached('z2', 'K9')];
const solve = (concepts: string[], pool = POOL, opts: { depth?: 'QUICK' | 'BALANCED' | 'DEEP'; curriculum?: Array<{ structureVersionId: string; academicSubjectId: string }> } = {}) =>
  solveLearningBlueprint({ policy: { studentId: STUDENT, intent: AD_HOC_EXAM_INTENT, depth: opts.depth ?? 'BALANCED', canonicalConceptIds: concepts, needs: projectEvidenceNeeds(concepts, [], POLICY, AS_OF), curriculum: opts.curriculum }, coverages: pool, asOf: AS_OF });
function exam(concepts: string[], pool = POOL, opts: Parameters<typeof solve>[2] = {}): FrozenAssessment {
  const solution = solve(concepts, pool, opts);
  return freezeAssessment({ solution, coverages: pool, studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', intent: AD_HOC_EXAM_INTENT, activity: learningActivityFor(solution.requirement!.evidence!.activityType, AD_HOC_EXAM_INTENT) });
}
const conceptsOf = (f: FrozenAssessment) => [...new Set(f.items.flatMap((i) => i.coverage.map((c) => c.canonicalConceptId)))].sort();
const scored = (itemKey: string, fraction: number): ScoredResponse => ({ itemKey, responseRef: `resp-${itemKey}`, status: 'SCORED', fraction });
const post = (body: unknown) => new NextRequest('https://app.test/x', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  h.sql = []; h.clerk = 'clerk_owner'; h.studentRole = 'ACTIVE'; h.scheduled = []; h.updated = [];
});

/* ================================================================== */

describe('one canonical representation: the learning intent AD_HOC_CONCEPT_EXAM', () => {
  it('is a learning intent, independent, with the activity semantics of a mastery check', () => {
    expect(LEARNING_INTENTS).toContain('AD_HOC_CONCEPT_EXAM');
    expect(isAdHocExamIntent(AD_HOC_EXAM_INTENT)).toBe(true);
    expect(activitySemanticsOf('AD_HOC_CONCEPT_EXAM')).toEqual(activitySemanticsOf('MASTERY_CHECK'));
    expect(activitySemanticsOf('AD_HOC_CONCEPT_EXAM')).toMatchObject({ activityType: 'PROVE', independence: true });
  });

  it('the Student chooses its size from the existing depths; it is launched from a Subject', () => {
    expect([...AD_HOC_EXAM_SIZES]).toEqual(['QUICK', 'BALANCED', 'DEEP']);
    expect(LAUNCH_ORIGINS).toContain('SUBJECT');
    expect(read('src/lib/assessment-experience/assessment-experience.service.ts')).toMatch(/DEPTH_INTENTS[^\n]*'AD_HOC_CONCEPT_EXAM'/);
  });
});

describe('A + B. with or without a formal curriculum', () => {
  it('B. no curriculum, programme or qualification: the requirement is stated from Subject concepts alone', () => {
    const plan = buildLearningBlueprint({ studentId: STUDENT, intent: 'AD_HOC_CONCEPT_EXAM', depth: 'BALANCED', canonicalConceptIds: ['K1', 'K2'], needs: projectEvidenceNeeds(['K1', 'K2'], [], POLICY, AS_OF) });
    expect(plan.requirement).not.toBeNull();
    expect(plan.requirement).toMatchObject({ family: 'LEARNING', curriculum: [], targets: { canonicalConceptIds: ['K1', 'K2'], learningObjectiveIds: [] } });
    expect(plan.requirement!.evidence).toMatchObject({ activityType: 'PROVE', independence: true, supportLevel: 'NONE', evidenceContract: 'B2:AD_HOC_CONCEPT_EXAM:BALANCED', itemCount: null });
    const f = exam(['K1', 'K2']);
    expect(f.items.length).toBeGreaterThan(0);
    expect(conceptsOf(f)).toEqual(['K1', 'K2']);
    expect(f.curriculum).toEqual([]);
  });

  it('A. a curriculum is recorded as context, and the exam is still only the subset the Student chose', () => {
    const f = exam(['K2'], POOL, { curriculum: [{ structureVersionId: 'sv-ib', academicSubjectId: 'subj-math' }] });
    expect(conceptsOf(f)).toEqual(['K2']);
    expect(f.curriculum).toEqual([{ structureVersionId: 'sv-ib', academicSubjectId: 'subj-math' }]);
    expect(f.targets.canonicalConceptIds).toEqual(['K2']);
  });

  it('nothing in the entry needs an exam definition, an official blueprint, a programme or an institution', () => {
    for (const p of ['src/lib/assessment-experience/ad-hoc-exam.ts', 'src/lib/ad-hoc-exam/selection.ts', 'src/services/ad-hoc-exam.service.ts', 'src/app/dashboard/subjects/[id]/CreateExamPanel.tsx']) {
      const code = read(p).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(code, p).not.toMatch(/exam_definition|examDefinition|exam_version|blueprint_id|qualification|programme|institution_id|institutionId|student_exam_profiles/i);
    }
  });
});

describe('C + D. one concept, or several', () => {
  it('C. one concept only', () => {
    const f = exam(['K3']);
    expect(conceptsOf(f)).toEqual(['K3']);
    expect(f.targets.canonicalConceptIds).toEqual(['K3']);
  });

  it('D. several concepts: every one is assessed, and no other', () => {
    const f = exam(['K1', 'K2', 'K3']);
    expect(conceptsOf(f)).toEqual(['K1', 'K2', 'K3']);
    expect(f.items.some((i) => i.coverage.some((c) => c.canonicalConceptId === 'K9'))).toBe(false);
  });

  it('the size is the Student\'s choice: a fuller exam is never smaller', () => {
    const size = (depth: 'QUICK' | 'BALANCED' | 'DEEP') => solve(['K1', 'K2'], POOL, { depth }).outcome.selected.length;
    expect(size('QUICK')).toBeLessThanOrEqual(size('BALANCED'));
    expect(size('BALANCED')).toBeLessThanOrEqual(size('DEEP'));
  });
});

describe('the selector: exactly what the Student chose', () => {
  it('a Topic or Subtopic selects its concepts; clearing it clears them; nothing else moves', () => {
    expect(toggleGroup([], [C1, C2]).sort()).toEqual([C1, C2]);
    expect(toggleGroup([C1, C3], [C1, C2]).sort()).toEqual([C1, C2, C3]);
    expect(toggleGroup([C1, C2, C3], [C1, C2])).toEqual([C3]);
    expect(toggleGroup([C3], [])).toEqual([C3]);
  });

  it('the selection is de-duplicated, never extended, and bounded', () => {
    expect(normalizeSelection([C2, C1, C2])).toEqual({ ok: true, conceptIds: [C1, C2] });
    expect(normalizeSelection([])).toEqual({ ok: false, issue: 'NO_CONCEPTS' });
    expect(normalizeSelection([C1, 'not-an-id'])).toEqual({ ok: false, issue: 'MALFORMED_CONCEPT' });
    const many = Array.from({ length: AD_HOC_EXAM_MAX_CONCEPTS + 1 }, (_, i) => `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(normalizeSelection(many)).toEqual({ ok: false, issue: 'TOO_MANY_CONCEPTS' });
  });

  it('the link names the Subject, exactly those concepts, the size and the time limit', () => {
    const href = adHocExamHref({ subjectId: SUBJECT, conceptIds: [C2, C1], depth: 'DEEP', minutes: 30 })!;
    const q = new URL(href, 'https://app.test').searchParams;
    expect(href.startsWith('/dashboard/assessment?')).toBe(true);
    expect(Object.fromEntries(q)).toEqual({ intent: 'AD_HOC_CONCEPT_EXAM', origin: 'SUBJECT', s: SUBJECT, lc: `${C1},${C2}`, depth: 'DEEP', m: '30' });
    expect(adHocExamHref({ subjectId: SUBJECT, conceptIds: [] })).toBeNull();
    expect(adHocExamHref({ subjectId: 'x', conceptIds: [C1] })).toBeNull();
    // an unsupported size or time limit is not invented: it is left out
    expect(new URL(adHocExamHref({ subjectId: SUBJECT, conceptIds: [C1], depth: 'HUGE' as any, minutes: 7 })!, 'https://app.test').searchParams.has('m')).toBe(false);
  });

  it('the setup reads that link back as the same request, and keeps the Subject on every step', () => {
    const request = launchRequestOfQuery({ intent: 'AD_HOC_CONCEPT_EXAM', origin: 'SUBJECT', lc: `${C1},${C2}`, depth: 'QUICK', m: '45', s: SUBJECT })!;
    expect(request).toMatchObject({ family: 'LEARNING', intent: 'AD_HOC_CONCEPT_EXAM', origin: 'SUBJECT', depth: 'QUICK', availableMinutes: 45, scope: { learnerConceptIds: [C1, C2], canonicalConceptIds: [] } });
    expect(hiddenFieldsOf(request, { subjectId: SUBJECT })).toMatchObject({ intent: 'AD_HOC_CONCEPT_EXAM', origin: 'SUBJECT', lc: `${C1},${C2}`, m: '45', s: SUBJECT, confirm: '1' });
    expect(launchRequestOfQuery({ intent: 'AD_HOC_CONCEPT_EXAM', origin: 'SUBJECT', lc: C1, m: '9999' })!.availableMinutes).toBeNull();
  });
});

describe('E. start now: an attempt with the exact concept scope', () => {
  it('the frozen assessment is this exam: its intent, its concepts, a learning activity', () => {
    const f = exam(['K1', 'K3']);
    expect(f).toMatchObject({ family: 'LEARNING', path: 'LEARNING_ACTIVITY', intent: 'AD_HOC_CONCEPT_EXAM', studentId: STUDENT });
    expect(f.targets.canonicalConceptIds).toEqual(['K1', 'K3']);
    expect(conceptsOf(f)).toEqual(['K1', 'K3']);
  });

  it('the start authority is asked for exactly the chosen concepts and that intent', async () => {
    const asked: any[] = [];
    const result = await startLearningAssessment(
      { studentId: STUDENT, request: { intent: 'AD_HOC_CONCEPT_EXAM', depth: 'BALANCED', canonicalConceptIds: ['K2', 'K1'], learnerConceptIds: [], availableMinutes: 30 }, asOf: AS_OF, language: 'es' } as any,
      { enabled: () => true, solve: (async (studentId: string, request: any) => { asked.push({ studentId, ...request }); return { ok: false, reason: 'CONTEXT_UNAVAILABLE' }; }) as any }
    );
    expect(result).toEqual({ ok: false, reason: 'CONTEXT_UNAVAILABLE' });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ studentId: STUDENT, intent: 'AD_HOC_CONCEPT_EXAM', depth: 'BALANCED', canonicalConceptIds: ['K2', 'K1'], availableMinutes: 30 });
  });

  it('the Start control posts the request to the one start route and opens the session it returns', () => {
    const start = read('src/app/dashboard/assessment/StartAssessment.tsx');
    expect(start).toMatch(/fetch\('\/api\/assessments\/learning\/start'/);
    const page = read('src/app/dashboard/assessment/page.tsx');
    expect(page).toMatch(/isAdHocExamIntent\(request\.intent\)/);
    expect(page).toMatch(/resolveAdHocExamScope\(studentId, query\.s, request\.scope\.learnerConceptIds\)/);
    // canonical ids given directly would skip the Subject check: refused for this intent
    expect(page).toMatch(/if \(request\.scope\.canonicalConceptIds\.length > 0 \|\| request\.scope\.node\) return unavailable;/);
  });
});

describe('G. the result produces learner evidence with ad-hoc provenance', () => {
  it('every evidence event names this exam: its intent, a learning path, the frozen snapshot', () => {
    const f = exam(['K1', 'K2']);
    const plan = planEvidence(f, { assessmentRef: 'qs-adhoc-1' }, f.items.map((i) => scored(i.key, 1)), { identities: [canonical('K1'), canonical('K2')], subjectByLearnerConcept: new Map([['lc-K1', SUBJECT], ['lc-K2', SUBJECT]]) });
    expect(plan.writes.length).toBeGreaterThan(0);
    expect([...new Set(plan.writes.map((w) => w.canonicalConceptId))].sort()).toEqual(['K1', 'K2']);
    for (const w of plan.writes) {
      expect(JSON.stringify(w.metadata)).toContain('"intent":"AD_HOC_CONCEPT_EXAM"');
      expect(JSON.stringify(w.metadata)).toContain('"path":"LEARNING_ACTIVITY"');
      expect(JSON.stringify(w.metadata)).toContain(f.snapshotId);
      expect(w.subjectId).toBe(SUBJECT);
    }
  });

  it('it is independent evidence: no assistance is recorded', () => {
    const f = exam(['K1']);
    const plan = planEvidence(f, { assessmentRef: 'qs-adhoc-2' }, f.items.map((i) => scored(i.key, 1)), { identities: [canonical('K1')], subjectByLearnerConcept: new Map([['lc-K1', SUBJECT]]) });
    expect(plan.outcomes.filter((o) => o.status === 'ATTRIBUTED').every((o) => o.independent)).toBe(true);
  });
});

describe('H. it is not an official exam, a mock or an institutional examination', () => {
  it('family and path are learning; the evidence source is never the exam simulation', () => {
    const f = exam(['K1', 'K2']);
    expect(f.family).toBe('LEARNING');
    expect(f.path).toBe('LEARNING_ACTIVITY');
    expect(['OFFICIAL_MOCK', 'EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK']).not.toContain(f.path);
    const plan = planEvidence(f, { assessmentRef: 'qs-adhoc-3' }, f.items.map((i) => scored(i.key, 1)), { identities: [canonical('K1'), canonical('K2')], subjectByLearnerConcept: new Map([['lc-K1', SUBJECT], ['lc-K2', SUBJECT]]) });
    for (const w of plan.writes) expect(w.evidence.sourceType).not.toBe('EXAM_SIMULATION');
  });

  it('it is not an exam-preparation or official launch, and no quiz mode maps to it', () => {
    const parsed = parseLaunchRequest({ family: 'LEARNING', origin: 'SUBJECT', intent: 'AD_HOC_CONCEPT_EXAM', depth: 'BALANCED', scope: { learnerConceptIds: [C1] } });
    expect(parsed.ok && parsed.request.family).toBe('LEARNING');
    expect(parseLaunchRequest({ family: 'EXAM_PREPARATION', origin: 'SUBJECT', intent: 'AD_HOC_CONCEPT_EXAM', depth: 'BALANCED', scope: { learnerConceptIds: [C1] } }).ok).toBe(false);
    expect(Object.values(ASSESSMENT_INTENT_OF_QUIZ_MODE)).not.toContain('AD_HOC_CONCEPT_EXAM');
  });
});

describe('I + J. the scope is the Student\'s own concepts of that Subject', () => {
  it('the Student\'s own Subject and concepts are accepted, exactly as chosen', async () => {
    expect(await resolveAdHocExamScope(STUDENT, SUBJECT, [C3, C1])).toEqual({ ok: true, subjectId: SUBJECT, subjectName: 'Matemáticas', conceptIds: [C1, C3] });
  });

  it('I. a concept of another Subject refuses the whole selection (nothing is narrowed silently)', async () => {
    expect(await resolveAdHocExamScope(STUDENT, SUBJECT, [C1, C_OTHER_SUBJECT])).toEqual({ ok: false, reason: 'CONCEPT_OUTSIDE_SUBJECT' });
  });

  it('J. a concept of another Student is refused; another Student\'s Subject is "not found"', async () => {
    expect(await resolveAdHocExamScope(STUDENT, SUBJECT, [C1, C_FOREIGN])).toEqual({ ok: false, reason: 'CONCEPT_OUTSIDE_SUBJECT' });
    expect(await resolveAdHocExamScope(STUDENT, FOREIGN_SUBJECT, [C_FOREIGN])).toEqual({ ok: false, reason: 'SUBJECT_NOT_FOUND' });
    expect(await resolveAdHocExamScope(STUDENT, 'not-an-id', [C1])).toEqual({ ok: false, reason: 'SUBJECT_NOT_FOUND' });
    expect(await resolveAdHocExamScope(STUDENT, SUBJECT, [])).toEqual({ ok: false, reason: 'NO_CONCEPTS' });
  });

  it('the start route resolves the Student from the session, never from the request (revoked => 403)', () => {
    const route = read('src/app/api/assessments/learning/start/route.ts');
    expect(route).toMatch(/const studentId = await requireStudentId\(authContext\.userId\);\s*if \(!studentId\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}, \{ status: 403 \}\);/);
    expect(route).not.toMatch(/studentId: (v|body|parsed)\./);
  });
});

describe('K. not enough eligible content: a controlled answer, and the scope is never widened', () => {
  it('a chosen concept with no eligible question is reported unmet; unrelated content is not used instead', () => {
    const solution = solve(['K1', 'K7']); // K7 has no eligible question; K9 has plenty and was not chosen
    const chosen = solution.outcome.selected.map((q) => q.key);
    expect(chosen.some((k) => /:z[12]$/.test(k))).toBe(false); // the K9 questions were never chosen
    expect(chosen.some((k) => /:a[123]$/.test(k))).toBe(true);
    expect(JSON.stringify(solution.outcome)).toContain('K7');
    expect(solution.requirement!.targets.canonicalConceptIds).toEqual(['K1', 'K7']);
  });

  it('with nothing eligible at all, nothing is selected', () => {
    const solution = solve(['K7']);
    expect(solution.outcome.selected).toEqual([]);
    expect(solution.requirement!.targets.canonicalConceptIds).toEqual(['K7']);
  });

  it('the start authority answers NOT_STARTABLE and creates no session', async () => {
    const solution = solve(['K7']);
    const result = await startLearningAssessment(
      { studentId: STUDENT, request: { intent: 'AD_HOC_CONCEPT_EXAM', depth: 'BALANCED', canonicalConceptIds: ['K7'], learnerConceptIds: [] }, asOf: AS_OF, language: 'es' } as any,
      { enabled: () => true, solve: (async () => ({ ok: true, solution, coverages: POOL })) as any, log: () => undefined } as any
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_STARTABLE' });
    expect(h.sql.some((s) => /INSERT INTO quiz_sessions/i.test(s))).toBe(false);
  });

  it('no generation is introduced by this change', () => {
    for (const p of ['src/lib/assessment-experience/ad-hoc-exam.ts', 'src/services/ad-hoc-exam.service.ts', 'src/app/dashboard/subjects/[id]/CreateExamPanel.tsx']) {
      expect(read(p), p).not.toMatch(/executeAI|generate-and-take|factory|openai|anthropic/i);
    }
  });
});

describe('L. the official exam and blueprint paths are untouched', () => {
  it('exam-preparation and official launches still parse exactly as before', () => {
    expect(parseLaunchRequest({ family: 'EXAM_PREPARATION', origin: 'EXAM_PREPARATION', examTargetId: 'target-1', objective: 'CLOSE_GAPS' }).ok).toBe(true);
    expect(ASSESSMENT_INTENT_OF_QUIZ_MODE).toEqual({ topic_practice: 'CONCEPT_PRACTICE', quick_check: 'MASTERY_CHECK', canonical_prove: 'MASTERY_CHECK', canonical_retain: 'RETENTION_CHECK' });
  });

  it('every earlier learning intent keeps its semantics', () => {
    expect(activitySemanticsOf('CONCEPT_PRACTICE').activityType).toBe('PRACTICE');
    expect(activitySemanticsOf('CUSTOM_CONCEPT_PRACTICE').activityType).toBe('PRACTICE');
    expect(activitySemanticsOf('MASTERY_CHECK').activityType).toBe('PROVE');
    expect(activitySemanticsOf('RETENTION_CHECK').activityType).toBe('RETENTION_CHECK');
    expect(activitySemanticsOf('DIAGNOSTIC').activityType).toBe('DIAGNOSTIC_CHECK');
    expect(LEARNING_INTENTS.slice(0, 7)).toEqual(['CONCEPT_PRACTICE', 'TOPIC_PRACTICE', 'CUSTOM_CONCEPT_PRACTICE', 'DIAGNOSTIC', 'MASTERY_CHECK', 'RETENTION_CHECK', 'MIXED_CUMULATIVE']);
  });

  it('this change adds exactly one migration, its own, and it touches no official-exam table', () => {
    const files = require('fs').readdirSync(join(process.cwd(), 'database/migrations')).filter((f: string) => f.endsWith('.sql')).sort();
    const at = files.indexOf('20261121_1000_student_scheduled_assessments.sql');
    expect(files.slice(at - 1, at + 1)).toEqual(['20261120_1200_sf10_single_persona_constraint.sql', '20261121_1000_student_scheduled_assessments.sql']);
    const ddl = read('database/migrations/20261121_1000_student_scheduled_assessments.sql').replace(/^--.*$/gm, '');
    expect(ddl).not.toMatch(/ALTER TABLE|DROP |assessment_occurrences|exam_definitions|exam_versions|simulation_plans/);
  });
});

describe('the Subject page: discoverable, in the Student\'s words', () => {
  it('the CTA is on the Subject for every Student with concepts, whatever their curriculum', () => {
    const page = read('src/app/dashboard/subjects/[id]/page.tsx');
    expect(page).toMatch(/<CreateExamPanel subjectId=\{id\} locale=\{locale\} hierarchy=\{hierarchy\} canonicalAssessment=\{isSnapshotExecutionEnabled\(\)\} \/>/);
    const panel = read('src/app/dashboard/subjects/[id]/CreateExamPanel.tsx');
    expect(panel).toMatch(/if \(allConcepts\.length === 0\) return null;/);
    expect(panel).toMatch(/hierarchy\.topics\.map/);
    expect(panel).toMatch(/hierarchy\.unassigned/);
    // parent selection selects descendants
    expect(panel).toMatch(/toggleGroup\(prev, ids\)/);
  });

  it('copy in every language says what it is, with no implementation vocabulary', () => {
    for (const locale of LOCALES) {
      const m = getAdHocExamMessages(locale);
      for (const [key, text] of Object.entries(m)) {
        expect(text.length, `${locale} ${key}`).toBeGreaterThan(0);
        expect(text, `${locale} ${key}`).not.toMatch(/blueprint|exam_definition|canonical|lifecycle|snapshot|AD_HOC|intent/i);
      }
    }
    expect(getAdHocExamMessages('es')['adhoc.cta']).toBe('Crear examen');
    expect(getAdHocExamMessages('es')['adhoc.lead']).toContain('Elige exactamente qué quieres evaluar');
  });
});
