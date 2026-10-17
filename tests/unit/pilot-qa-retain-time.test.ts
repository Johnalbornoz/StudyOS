import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getDecision: vi.fn(),
  evaluate: vi.fn(),
  mapEvidence: vi.fn(),
  fetchRows: vi.fn(),
  recordAdminAction: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('@clerk/backend', () => ({ createClerkClient: vi.fn() }));
vi.mock('@/lib/pedagogical-decision/canonical-decision.service', () => ({ getCanonicalPedagogicalDecision: h.getDecision }));
vi.mock('@/lib/pedagogical-engine', () => ({ evaluateCanonicalLearningState: h.evaluate }));
vi.mock('@/lib/pedagogical-shadow', () => ({ mapStudyUSEvidenceToPedagogicalEvidence: h.mapEvidence, fetchStudyUSEvidenceRows: h.fetchRows }));
vi.mock('@/lib/pedagogical-migration', () => ({ loadRecognizedRequirementsForEngine: vi.fn(async () => []), INITIAL_MIGRATION_VERSION: 'v' }));
vi.mock('@/services/misconception.service', () => ({ getMisconceptionCountsForConcept: vi.fn(async () => ({ criticalCount: 0 })) }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: h.recordAdminAction }));

import {
  assertCandidateFingerprint, parseDays, parseArgs, resolveQaStudentEmail, planShift, orderingPreserved, samePlan,
  resolveTarget, buildPlan, applyShift, AUDIT_REASON, type PlanResult,
} from '../../scripts/operations/pilot-qa-retain-time';

const STUDENT = '11111111-1111-1111-1111-111111111111';
const OTHER_STUDENT = '22222222-2222-2222-2222-222222222222';
const CONCEPT = '33333333-3333-3333-3333-333333333333';
const ADMIN = '44444444-4444-4444-4444-444444444444';
const FP = '4baac799b9bd2a6a';
const EMAIL = 'studyus-qa-student-a+clerk_test@example.com';
const ROWS = [
  { id: 'e1', timestamp: '2026-10-17T18:26:00.000Z', activity_type: 'LEARN_CHECK' },
  { id: 'e2', timestamp: '2026-10-17T18:30:00.000Z', activity_type: 'PRACTICE' },
  { id: 'e3', timestamp: '2026-10-17T18:30:00.000Z', activity_type: 'PRACTICE' },
  { id: 'e4', timestamp: '2026-10-17T18:41:00.000Z', activity_type: 'PROVE' },
];
const decision = (stage: string, actionState: string, next = 'NONE') => ({
  stage, actionState, nextCanonicalAction: next, nextEligibleAt: null, lastQualifyingProveAt: null, proveAttemptsInCycle: 1, rollback: null,
  qualifiedEvidence: [{ qualifyingEvidenceIds: ['e1'], nonQualifyingEvidenceIds: [] }],
});

/** A fake pg client: answers the tool's SELECTs; records every statement. */
function fakeClient(opts: { conceptOwner?: string; rows?: typeof ROWS; updateCount?: number } = {}) {
  const calls: string[] = [];
  const rows = opts.rows ?? ROWS;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push(sql.trim().split(/\s+/)[0]);
    if (/FROM users u JOIN students/.test(sql)) return { rows: params[0] === EMAIL ? [{ user_id: 'u-a', email: EMAIL, student_id: STUDENT }] : [] };
    if (/FROM concepts c JOIN subjects/.test(sql)) return { rows: (opts.conceptOwner ?? STUDENT) === params[1] ? [{ id: CONCEPT, student_id: params[1], label: 'Ecuaciones lineales' }] : [] };
    if (/FROM learning_evidence WHERE student_id/.test(sql)) return { rows };
    if (/pedagogical_requirement_recognition/.test(sql)) return { rows: [{ n: 0 }] };
    if (/^\s*UPDATE learning_evidence/.test(sql)) return { rows: [], rowCount: opts.updateCount ?? (params[3] as string[]).length };
    if (/FROM users WHERE email/.test(sql)) return { rows: [{ id: ADMIN }] };
    return { rows: [] };
  });
  return { query, release: vi.fn(), calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fetchRows.mockResolvedValue(ROWS.map((r) => ({ id: r.id, timestamp: r.timestamp })));
  h.mapEvidence.mockImplementation((rows: any[]) => ({ items: rows }));
});

describe('guards', () => {
  it('refuses every fingerprint except the pilot candidate', () => {
    expect(() => assertCandidateFingerprint('4baac799b9bd2a6a')).not.toThrow();
    expect(() => assertCandidateFingerprint('2a29b99ee14a22b4')).toThrow(/DEV/);
    expect(() => assertCandidateFingerprint('4c249c68e0627b9f')).toThrow(/Preview/);
    expect(() => assertCandidateFingerprint('deadbeefdeadbeef')).toThrow(/not the pilot candidate/);
  });
  it('the DB commands refuse a non-candidate database before any query', async () => {
    const c = fakeClient();
    await expect(buildPlan(c as any, { student: 'student-a', concept: 'x', days: 3, fingerprint: '2a29b99ee14a22b4' })).rejects.toThrow(/DEV/);
    await expect(buildPlan(c as any, { student: 'student-a', concept: 'x', days: 3, fingerprint: '4c249c68e0627b9f' })).rejects.toThrow(/Preview/);
    expect(c.query).not.toHaveBeenCalled();
  });
  it('--days is required, integer, 1..14', () => {
    expect(() => parseDays(undefined)).toThrow(/required/);
    expect(() => parseDays('0')).toThrow(/1\.\.14/);
    expect(() => parseDays('15')).toThrow(/1\.\.14/);
    expect(() => parseDays('2.5')).toThrow(/integer/);
    expect(() => parseDays('-3')).toThrow(/integer/);
    expect(parseDays('3')).toBe(3);
    expect(parseDays('14')).toBe(14);
  });
  it('parses args and refuses unknown flags', () => {
    expect(parseArgs(['shift', '--student', 'student-a', '--concept', 'Ecuaciones lineales', '--days', '3', '--apply'])).toEqual({ cmd: 'shift', student: 'student-a', concept: 'Ecuaciones lineales', days: '3', apply: true });
    expect(() => parseArgs(['plan', '--force'])).toThrow(/unknown/);
    expect(() => parseArgs(['plan', '--days'])).toThrow(/needs a value/);
  });
  it('accepts only synthetic QA STUDENT identities', () => {
    expect(resolveQaStudentEmail('student-a')).toBe(EMAIL);
    expect(resolveQaStudentEmail(EMAIL)).toBe(EMAIL);
    expect(() => resolveQaStudentEmail('teacher')).toThrow(/not a synthetic QA student/);
    expect(() => resolveQaStudentEmail('studyus-qa-admin+clerk_test@example.com')).toThrow(/not a synthetic QA student/);
    expect(() => resolveQaStudentEmail('studyus-qa-student-z+clerk_test@example.com')).toThrow(/not a synthetic QA student/);
    expect(() => resolveQaStudentEmail('real.student@school.edu')).toThrow(/not a synthetic QA student/);
    expect(() => resolveQaStudentEmail('student-a@evil.com')).toThrow();
  });
  it('refuses a concept that belongs to another student', async () => {
    await expect(resolveTarget(fakeClient({ conceptOwner: OTHER_STUDENT }) as any, 'student-a', 'Ecuaciones lineales')).rejects.toThrow(/does not belong/);
    await expect(resolveTarget(fakeClient() as any, 'student-a', 'Ecuaciones lineales')).resolves.toMatchObject({ studentId: STUDENT, conceptId: CONCEPT });
  });
});

describe('shift planning', () => {
  const times = ROWS.map((r) => ({ id: r.id, timestamp: r.timestamp, activityType: r.activity_type }));
  it('moves every row back by exactly N days and preserves ordering (incl. ties)', () => {
    const p = planShift(times, 3);
    expect(p).toHaveLength(4);
    for (const e of p) expect(new Date(e.before).getTime() - new Date(e.after).getTime()).toBe(3 * 86_400_000);
    expect(orderingPreserved(p)).toBe(true);
  });
  it('detects a plan / database mismatch', () => {
    const p = planShift(times, 3);
    expect(samePlan(p, times)).toBeNull();
    expect(samePlan(p, times.slice(1))).toMatch(/row count differs/);
    expect(samePlan(p, [...times.slice(0, 3), { ...times[3], timestamp: '2026-10-17T19:00:00.000Z' }])).toMatch(/changed since the plan/);
  });
  it('plan predicts with the in-memory shifted evidence and touches only the target rows (read-only)', async () => {
    h.getDecision.mockResolvedValue({ decision: decision('RETAIN', 'WAITING') });
    h.evaluate.mockReturnValue(decision('RETAIN', 'EXECUTABLE', 'RETENTION_CHECK'));
    const c = fakeClient();
    const plan = await buildPlan(c as any, { student: 'student-a', concept: 'Ecuaciones lineales', days: 3, now: '2026-10-17T20:00:00.000Z', fingerprint: FP });
    expect(plan.applicable).toBe(true);
    expect(plan.current.journeyStage).toBe('WAIT_FOR_RETENTION');
    expect(plan.predicted.stage).toBe('RETAIN');
    expect(h.fetchRows).toHaveBeenCalledWith(STUDENT, CONCEPT, c);
    const passed = h.evaluate.mock.calls[0][0];
    expect(passed.evidence.map((e: any) => e.timestamp)).toEqual(ROWS.map((r) => new Date(new Date(r.timestamp).getTime() - 3 * 86_400_000).toISOString()));
    expect(c.calls.every((k) => k === 'SELECT')).toBe(true);
  });
  it('plan is not applicable when the decision is not RETAIN/WAITING', async () => {
    h.getDecision.mockResolvedValue({ decision: decision('PROVE', 'EXECUTABLE', 'PROVE') });
    h.evaluate.mockReturnValue(decision('PROVE', 'EXECUTABLE', 'PROVE'));
    const plan = await buildPlan(fakeClient() as any, { student: 'student-a', concept: 'Ecuaciones lineales', days: 3, fingerprint: FP });
    expect(plan.applicable).toBe(false);
    expect(plan.refusal).toMatch(/expected RETAIN\/WAITING/);
  });
});

describe('apply', () => {
  async function readyPlan(): Promise<PlanResult> {
    h.getDecision.mockResolvedValue({ decision: decision('RETAIN', 'WAITING') });
    h.evaluate.mockReturnValue(decision('RETAIN', 'EXECUTABLE', 'RETENTION_CHECK'));
    return buildPlan(fakeClient() as any, { student: 'student-a', concept: 'Ecuaciones lineales', days: 3, fingerprint: FP });
  }
  it('refuses without --apply (no connection opened)', async () => {
    const plan = await readyPlan();
    const pool = { connect: vi.fn() };
    await expect(applyShift(pool, plan, { apply: false })).rejects.toThrow(/--apply/);
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('commits one transaction: FOR UPDATE re-read, scoped UPDATE, audit row', async () => {
    const plan = await readyPlan();
    const c = fakeClient();
    h.getDecision.mockReset();
    h.getDecision.mockResolvedValueOnce({ decision: decision('RETAIN', 'WAITING') }).mockResolvedValueOnce({ decision: decision('RETAIN', 'EXECUTABLE', 'RETENTION_CHECK') });
    const r = await applyShift({ connect: async () => c as any }, plan, { apply: true });
    expect(r.shifted).toBe(4);
    expect(c.calls[0]).toBe('BEGIN');
    expect(c.calls.at(-1)).toBe('COMMIT');
    const upd = c.query.mock.calls.find(([s]) => /^\s*UPDATE/.test(s))!;
    expect(upd[0]).toMatch(/WHERE student_id = \$1 AND concept_id = \$2 AND id = ANY/);
    expect(upd[1]).toEqual([STUDENT, CONCEPT, 3, ['e1', 'e2', 'e3', 'e4']]);
    expect(c.query.mock.calls.some(([s]) => /FOR UPDATE/.test(s))).toBe(true);
    expect(h.recordAdminAction).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ADMIN, reason: AUDIT_REASON, action: 'PILOT_QA_RETAIN_TIME_SHIFT' }), c);
    expect(c.release).toHaveBeenCalled();
  });
  it('rolls back when the row count differs from the plan', async () => {
    const plan = await readyPlan();
    const c = fakeClient({ rows: ROWS.slice(0, 3) });
    await expect(applyShift({ connect: async () => c as any }, plan, { apply: true })).rejects.toThrow(/ROLLBACK: row count differs/);
    expect(c.calls).toContain('ROLLBACK');
    expect(c.calls).not.toContain('UPDATE');
    expect(c.calls).not.toContain('COMMIT');
    expect(h.recordAdminAction).not.toHaveBeenCalled();
  });
  it('rolls back when the UPDATE touches a different number of rows', async () => {
    const plan = await readyPlan();
    const c = fakeClient({ updateCount: 5 });
    h.getDecision.mockResolvedValue({ decision: decision('RETAIN', 'WAITING') });
    await expect(applyShift({ connect: async () => c as any }, plan, { apply: true })).rejects.toThrow(/ROLLBACK: updated 5 rows/);
    expect(c.calls).toContain('ROLLBACK');
    expect(c.calls).not.toContain('COMMIT');
  });
  it('rolls back when the decision is no longer RETAIN/WAITING, or not due after the shift', async () => {
    const plan = await readyPlan();
    const c1 = fakeClient();
    h.getDecision.mockResolvedValue({ decision: decision('PROVE', 'EXECUTABLE', 'PROVE') });
    await expect(applyShift({ connect: async () => c1 as any }, plan, { apply: true })).rejects.toThrow(/expected RETAIN\/WAITING/);
    expect(c1.calls).not.toContain('UPDATE');
    const c2 = fakeClient();
    h.getDecision.mockReset();
    h.getDecision.mockResolvedValueOnce({ decision: decision('RETAIN', 'WAITING') }).mockResolvedValueOnce({ decision: decision('RETAIN', 'WAITING') });
    await expect(applyShift({ connect: async () => c2 as any }, plan, { apply: true })).rejects.toThrow(/post-shift decision/);
    expect(c2.calls).toContain('ROLLBACK');
    expect(c2.calls).not.toContain('COMMIT');
  });
  it('refuses a plan that is not applicable', async () => {
    const plan = { ...(await readyPlan()), applicable: false, refusal: 'current canonical decision is PROVE/EXECUTABLE' };
    await expect(applyShift({ connect: vi.fn() as any }, plan, { apply: true })).rejects.toThrow(/PROVE\/EXECUTABLE/);
  });
});
