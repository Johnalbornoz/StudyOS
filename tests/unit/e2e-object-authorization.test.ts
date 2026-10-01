/**
 * STUDENT E2E DEV certification -- object-level authorization (Student A vs B).
 *
 * The E2E ownership audit found Student-owned ids accepted from the client
 * without being bound to the authenticated Student:
 *   1. POST /api/content/extract-concepts   -- sourceId / studentId / subjectId (no check at all)
 *   2. POST /api/learning-debt/check-and-resolve -- studentId (no check)
 *   3. GET  /api/learning-debt/get-active    -- studentId (no check; confirmed live on DEV: B read A's list, 200)
 *   4. POST /api/quizzes/generate-and-take (generate) -- subjectId / conceptId(s) not bound
 *   5. POST /api/quizzes/generate-and-take (submit)   -- diagnosisId / remediationStepId not bound
 *   6. POST /api/learning/record-evidence    -- conceptId / subjectId not bound
 * Each is now bound; this file proves B gets 403 on A's ids and A still works.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const A = { clerk: 'clerk_A', student: '11111111-1111-4111-8111-111111111111', subject: 'aaaaaaaa-0000-4000-8000-000000000001', concept: 'aaaaaaaa-0000-4000-8000-000000000002', source: 'aaaaaaaa-0000-4000-8000-000000000003', diagnosis: 'aaaaaaaa-0000-4000-8000-000000000004', step: 'aaaaaaaa-0000-4000-8000-000000000005' };
const B = { clerk: 'clerk_B', student: '22222222-2222-4222-8222-222222222222', subject: 'bbbbbbbb-0000-4000-8000-000000000001', concept: 'bbbbbbbb-0000-4000-8000-000000000002', source: 'bbbbbbbb-0000-4000-8000-000000000003' };

const h = vi.hoisted(() => ({ clerk: 'clerk_B', services: {} as Record<string, (...a: any[]) => any> }));

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.clerk, sessionClaims: {} }) }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_: string, fn: any) => fn }));

/** Ownership fixture shaped like the real schema: students, subjects, concepts, content_sources, diagnoses, remediation. */
vi.mock('@/lib/db', () => {
  const q = async (sql: string, p: any[] = []) => {
    const students: Record<string, string> = { clerk_A: '11111111-1111-4111-8111-111111111111', clerk_B: '22222222-2222-4222-8222-222222222222' };
    const subjects: Record<string, string> = { 'aaaaaaaa-0000-4000-8000-000000000001': students.clerk_A, 'bbbbbbbb-0000-4000-8000-000000000001': students.clerk_B };
    const concepts: Record<string, string> = { 'aaaaaaaa-0000-4000-8000-000000000002': 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002': 'bbbbbbbb-0000-4000-8000-000000000001' };
    const sources: Record<string, [string, string]> = {
      'aaaaaaaa-0000-4000-8000-000000000003': [students.clerk_A, 'aaaaaaaa-0000-4000-8000-000000000001'],
      'bbbbbbbb-0000-4000-8000-000000000003': [students.clerk_B, 'bbbbbbbb-0000-4000-8000-000000000001'],
    };
    const one = (ok: boolean) => ({ rows: ok ? [{ '?column?': 1 }] : [], rowCount: ok ? 1 : 0 });
    if (/FROM students WHERE clerk_id = \$1 AND id = \$2/.test(sql)) return one(students[p[0]] === p[1]);
    if (/FROM subjects\s+WHERE id = \$1 AND student_id = \$2/.test(sql)) return one(subjects[p[0]] === p[1]);
    if (/FROM content_sources\s+WHERE id = \$1 AND student_id = \$2/.test(sql)) return one(sources[p[0]]?.[0] === p[1]);
    if (/FROM content_sources WHERE id = \$1 AND subject_id = \$2/.test(sql)) return one(sources[p[0]]?.[1] === p[1]);
    if (/SELECT 1 FROM concepts c JOIN subjects s/.test(sql)) {
      const subj = concepts[p[0]];
      return one(!!subj && subjects[subj] === p[1] && (p[2] === null || subj === p[2]));
    }
    if (/SELECT count\(\*\)::int AS n FROM concepts c JOIN subjects s/.test(sql)) {
      const n = (p[0] as string[]).filter((id) => { const subj = concepts[id]; return !!subj && subjects[subj] === p[1] && (p[2] === null || subj === p[2]); }).length;
      return { rows: [{ n }] };
    }
    if (/FROM cognitive_diagnoses WHERE id = \$1 AND student_id = \$2/.test(sql)) return one(p[0] === 'aaaaaaaa-0000-4000-8000-000000000004' && p[1] === students.clerk_A);
    if (/FROM remediation_steps rs JOIN remediation_paths rp/.test(sql)) return one(p[0] === 'aaaaaaaa-0000-4000-8000-000000000005' && p[1] === students.clerk_A);
    return { rows: [], rowCount: 0 };
  };
  return { db: { query: q }, query: q };
});

vi.mock('@/services/concept-extraction.service', () => ({
  extractConceptsFromSource: (...a: any[]) => h.services.extract(...a),
  getSubjectConcepts: (...a: any[]) => h.services.subjectConcepts(...a),
}));
vi.mock('@/services/learning-debt.service', () => ({
  getActiveDebts: (...a: any[]) => h.services.getActiveDebts(...a),
  checkAndResolveDebt: (...a: any[]) => h.services.checkAndResolve(...a),
}));
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => h.services.updateMastery(...a) }));

import { verifyConceptAccess, verifyConceptsAccess, verifyDiagnosisAccess, verifyRemediationStepAccess } from '@/lib/auth';
import { POST as extractConcepts } from '@/app/api/content/extract-concepts/route';
import { GET as getActive } from '@/app/api/learning-debt/get-active/route';
import { POST as checkAndResolve } from '@/app/api/learning-debt/check-and-resolve/route';
import { POST as recordEvidence } from '@/app/api/learning/record-evidence/route';
import { NextRequest } from 'next/server';

const post = (body: unknown) => new NextRequest('https://dev.test/x', { method: 'POST', body: JSON.stringify(body) });
const as = (who: 'A' | 'B') => { h.clerk = who === 'A' ? A.clerk : B.clerk; };

beforeEach(() => {
  h.services = {
    // vi.fn mocks: asserted with toHaveBeenCalled below
    extract: vi.fn(async () => ({ conceptsCreated: 1, chunksProcessed: 1, mappingsCreated: 1 })),
    subjectConcepts: vi.fn(async () => []),
    getActiveDebts: vi.fn(async () => []),
    checkAndResolve: vi.fn(async () => null),
    updateMastery: vi.fn(async () => ({ masteryScore: 50 })),
  };
});

describe('helpers bind every object id to the Student (fail closed)', () => {
  it('concept / concepts / diagnosis / remediation step', async () => {
    expect(await verifyConceptAccess(A.student, A.concept)).toBe(true);
    expect(await verifyConceptAccess(B.student, A.concept)).toBe(false);
    expect(await verifyConceptAccess(A.student, A.concept, B.subject)).toBe(false); // concept not in that subject
    expect(await verifyConceptsAccess(B.student, [B.concept, A.concept])).toBe(false); // one foreign id poisons the set
    expect(await verifyConceptsAccess(B.student, [B.concept, B.concept], B.subject)).toBe(true);
    expect(await verifyConceptsAccess(B.student, [])).toBe(true);
    expect(await verifyDiagnosisAccess(B.student, A.diagnosis)).toBe(false);
    expect(await verifyDiagnosisAccess(A.student, A.diagnosis)).toBe(true);
    expect(await verifyRemediationStepAccess(B.student, A.step)).toBe(false);
    expect(await verifyRemediationStepAccess(A.student, A.step)).toBe(true);
  });
});

describe('#1 content/extract-concepts', () => {
  it('B cannot use A ids (student, subject or source) -- 403, nothing extracted', async () => {
    as('B');
    const bodies = [
      { sourceId: A.source, studentId: A.student, subjectId: A.subject, subjectName: 'x' },
      { sourceId: A.source, studentId: B.student, subjectId: B.subject, subjectName: 'x' }, // A's source
      { sourceId: B.source, studentId: B.student, subjectId: A.subject, subjectName: 'x' }, // A's subject
    ];
    for (const b of bodies) expect((await extractConcepts(post(b))).status).toBe(403);
    expect(h.services.extract).not.toHaveBeenCalled();
  });
  it('A with A ids works', async () => {
    as('A');
    const res = await extractConcepts(post({ sourceId: A.source, studentId: A.student, subjectId: A.subject, subjectName: 'x' }));
    expect(res.status).toBe(200);
    expect(h.services.extract).toHaveBeenCalledOnce();
  });
});

describe('#2/#3 learning-debt', () => {
  it('B cannot read A debts (get-active) or resolve them (check-and-resolve)', async () => {
    as('B');
    expect((await getActive(new NextRequest(`https://dev.test/x?studentId=${A.student}`))).status).toBe(403);
    expect((await checkAndResolve(post({ studentId: A.student, conceptId: A.concept, currentMastery: 100, daysSinceLastSuccess: 0, forgettingRisk: 0 }))).status).toBe(403);
    expect(h.services.getActiveDebts).not.toHaveBeenCalled();
    expect(h.services.checkAndResolve).not.toHaveBeenCalled();
  });
  it('A reads / checks own debts', async () => {
    as('A');
    expect((await getActive(new NextRequest(`https://dev.test/x?studentId=${A.student}`))).status).toBe(200);
    expect((await checkAndResolve(post({ studentId: A.student, conceptId: A.concept, currentMastery: 90, daysSinceLastSuccess: 1, forgettingRisk: 10 }))).status).toBe(200);
  });
});

describe('#6 learning/record-evidence', () => {
  const ev = (studentId: string, conceptId: string, subjectId: string) =>
    post({ studentId, conceptId, subjectId, result: 'correct', difficulty: 2, sourceType: 'PRACTICE_QUIZ', idempotencyKey: 'e2e-authz-probe-1' });
  it('B cannot record evidence against A concept/subject, even under B own studentId', async () => {
    as('B');
    expect((await recordEvidence(ev(B.student, A.concept, A.subject))).status).toBe(403);
    expect((await recordEvidence(ev(B.student, B.concept, A.subject))).status).toBe(403);
    expect(h.services.updateMastery).not.toHaveBeenCalled();
  });
});

describe('#4/#5 generate-and-take binds subject, concepts, diagnosis and remediation step', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf-8');
  it('generate: subject + every concept id verified before generation (403)', () => {
    const i = src.indexOf('const subjectOwned = await verifySubjectAccess(validated.studentId, validated.subjectId);');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 700)).toMatch(/verifyConceptsAccess\(\s*validated\.studentId,\s*\[\.\.\.\(validated\.conceptId \? \[validated\.conceptId\] : \[\]\), \.\.\.\(validated\.conceptIds \?\? \[\]\)\],\s*validated\.subjectId,/);
    // before any generation / session write in the generate handler
    expect(i).toBeLessThan(src.indexOf('isSingleConceptMode(validated.quizMode) && !validated.conceptId'));
  });
  it('submit: diagnosisId / remediationStepId verified before they are resolved or advanced', () => {
    const guard = src.indexOf('verifyDiagnosisAccess(validated.studentId, validated.diagnosisId)');
    expect(guard).toBeGreaterThan(0);
    expect(src).toMatch(/verifyRemediationStepAccess\(validated\.studentId, validated\.remediationStepId\)/);
    expect(guard).toBeLessThan(src.indexOf('resolveDiagnosticCheck(validated.diagnosisId'));
    expect(guard).toBeLessThan(src.indexOf('completeRemediationStep(validated.remediationStepId'));
  });
});

describe('no TODO authorization placeholders remain on Student routes', () => {
  it('the three routes that literally said "TODO: Verify authorization" now verify', () => {
    for (const f of ['src/app/api/content/extract-concepts/route.ts', 'src/app/api/learning-debt/get-active/route.ts', 'src/app/api/learning-debt/check-and-resolve/route.ts']) {
      const s = readFileSync(join(process.cwd(), f), 'utf-8');
      expect(s, f).not.toMatch(/TODO: Verify/);
      expect(s, f).toMatch(/verifyStudentAccess\(authContext\.userId/);
      expect(s, f).not.toMatch(/details: String\(error\)/);
    }
  });
});

describe('E2E a11y regression: inline continuation never announces a success headline', () => {
  it('the kind headline renders only when visible (not as an sr-only label inside the results panel)', () => {
    const ui = readFileSync(join(process.cwd(), 'src/app/dashboard/quiz/ContinuationPanel.tsx'), 'utf-8');
    expect(ui).not.toMatch(/'label sr-only'/);
    expect(ui).toMatch(/aria-labelledby=\{showHeadline \|\| waitingResult \? 'lx-cp-heading' : undefined\}/);
    expect(ui).toMatch(/\{\(showHeadline \|\| waitingResult\) && \(\s*<p\s+id="lx-cp-heading"/);
  });
});

describe('E2E regression: simulation attempt page shows labels and an honest "no score"', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/dashboard/exam-prep/attempt/[attemptId]/page.tsx'), 'utf-8');
  it('never renders the raw simulationType / timingMode enums', () => {
    expect(src).not.toMatch(/subtitle=\{attempt\.simulationType\}/);
    expect(src).not.toMatch(/: \{attempt\.timingMode\}/);
    expect(src).toMatch(/label\(`ex\.type\.\$\{attempt\.simulationType\}`/);
    expect(src).toMatch(/label\(`ex\.timing\.\$\{attempt\.timingMode\}`/);
  });
  it('0 gradable items is "no score", never 0% (Track B: shown on the attempt RESULT page)', () => {
    const result = readFileSync(join(process.cwd(), 'src/app/dashboard/exam-prep/attempt/[attemptId]/result/page.tsx'), 'utf-8');
    expect(src).not.toMatch(/: 0\}%/);
    expect(result).not.toMatch(/: 0\}%/);
    expect(result).toMatch(/result\.maxScore === 0[\s\S]{0,120}t\['examPrep\.attempt\.noGradedItems'\]/);
    expect(src).toMatch(/redirect\(`\/dashboard\/exam-prep\/attempt\/\$\{attempt\.id\}\/result`\)/);
  });
});
