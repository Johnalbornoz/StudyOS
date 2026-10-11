/**
 * L10-R1 -- the two Shared Foundation dependencies of L11.
 *
 * CR-L11-05  A manual payment approval never moves an administrator-set subscription row (a licence
 *            grant, a revoked grant, an administrative suspension) into "active but no access".
 *            This release: explicit refusal (409), nothing written.
 * CR-L11-06  Transfer exactly-once. An OPEN transfer task may be continued (D-8(c)); a task that was
 *            already answered and graded is refused on a repeat, and the AI grader is NOT invoked.
 *            The proof is existing state -- the `learning_evidence.operation_key` the graded
 *            submission itself writes -- so no schema change.
 *
 * Unit level here; both also run against a real Postgres in scripts/l10-ephemeral-db-test.sh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const { w, h } = vi.hoisted(() => ({
  w: {
    subscription: { id: 'sub-1', status: 'active', manuallySetByAdmin: true, grantExpiresAt: '2026-01-01T00:00:00Z' } as any,
    evidenceKeys: new Set<string>(),
    locks: new Set<string>(),
    connections: 0,
    taskInstances: new Map<string, any>(),
    sql: [] as string[],
  },
  h: { grade: null as any, updateMastery: null as any, transition: null as any, audit: null as any, isAdmin: true },
}));

const STUDENT = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const OTHER_TASK = '55555555-5555-4555-8555-555555555555';
const PROMPT = 'A cyclist rides 12 km in 40 minutes. How far in 2 hours at the same speed?';

vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_: string, fn: any) => fn }));
vi.mock('@/lib/auth', () => ({ verifyAuth: async () => ({ userId: 'clerk_kid', email: '', role: 'student' }), verifyStudentAccess: async () => true, verifyRemediationStepAccess: async () => true, checkRateLimit: () => true }));
vi.mock('@/lib/safety/safety-route', () => ({ studentTextSafetyResponse: async () => null }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/observability/operational-log', () => ({ logOperationalWarning: vi.fn() }));
vi.mock('@/services/remediation.service', () => ({ completeRemediationStep: vi.fn(async () => undefined) }));
vi.mock('@/services/transfer-novelty.service', () => ({ getRecentTransferFingerprints: async () => [], isDuplicateTransferFingerprint: () => ({ duplicate: false }) }));
vi.mock('@/services/transfer.service', () => ({ evaluateTransferResponse: (...a: any[]) => h.grade(...a) }));
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => h.updateMastery(...a) }));
vi.mock('@/lib/entitlements/subscription.service', () => ({ getSubscription: async () => ({ ...w.subscription }), transitionSubscriptionStatus: (...a: any[]) => h.transition(...a) }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: (...a: any[]) => h.audit(...a) }));
vi.mock('@/lib/admin/route-guard', () => ({ guardAdminUsersRoute: async () => ({ admin: { actor: { id: 'admin-1' } } }) }));
vi.mock('@/lib/db', () => {
  const query = async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    w.sql.push(s);
    if (/^SELECT 1 FROM learning_evidence WHERE operation_key = \$1 LIMIT 1/.test(s)) return { rows: w.evidenceKeys.has(p[0]) ? [{ ok: 1 }] : [] };
    if (/FROM transfer_task_instances WHERE id = \$1/.test(s)) return { rows: w.taskInstances.has(p[0]) ? [w.taskInstances.get(p[0])] : [] };
    if (/^INSERT INTO subscriptions \(student_id, status\)/.test(s)) return { rows: [{ id: 'sub-1' }] };
    return { rows: [] };
  };
  // One dedicated connection per claim: a transaction-scoped advisory lock, released when the transaction ends.
  const connect = async () => {
    w.connections++;
    const held: string[] = [];
    return {
      query: async (sql: string, p: any[] = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (/pg_try_advisory_xact_lock/.test(s)) {
          const key = String(p[0]);
          if (w.locks.has(key)) return { rows: [{ locked: false }] };
          w.locks.add(key);
          held.push(key);
          return { rows: [{ locked: true }] };
        }
        if (s === 'ROLLBACK' || s === 'COMMIT') for (const k of held.splice(0)) w.locks.delete(k);
        return { rows: [] };
      },
      release: () => { w.connections--; },
    };
  };
  return { db: { query, connect }, query };
});

import { NextRequest } from 'next/server';
import { POST as transferPOST } from '@/app/api/cognitive/transfer/submit/route';
import { POST as approvePOST } from '@/app/api/admin/memberships/approve-payment/route';
import { approveManualPayment, AdminControlledSubscriptionError } from '@/services/membership-admin.service';
import { isTransferTaskAlreadyGraded } from '@/services/transfer-task-instance.service';
import { buildOperationKey } from '@/lib/algorithms/evidence-idempotency';
import { computeTransferPromptExactHash, computeTransferPromptFingerprint } from '@/lib/transfer-task-identity';

const keyOf = (taskId: string, conceptId = CONCEPT) => buildOperationKey({ operationType: 'TRANSFER', operationId: taskId, conceptId });
const instanceRow = (id: string) => ({
  id, student_id: STUDENT, concept_id: CONCEPT, subject_id: SUBJECT, transfer_distance: 'NEAR', transfer_modality: 'STRUCTURAL', novelty_dimensions: [], target_concept_ids: [], context_domain: null,
  task_family_id: 'fam', prompt_fingerprint: computeTransferPromptFingerprint(PROMPT), prompt_exact_hash: computeTransferPromptExactHash(PROMPT), generator_version: null, generator_prompt_version: 'v1', novelty_validation_passed: false, created_at: new Date('2026-10-01'),
});
const submit = (taskId: string = TASK) =>
  transferPOST(new NextRequest('https://app.test/api/cognitive/transfer/submit', { method: 'POST', body: JSON.stringify({ studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, conceptLabel: 'Proportional reasoning', prompt: PROMPT, studentResponse: '36 km', transferTaskId: taskId }) }));

beforeEach(() => {
  w.subscription = { id: 'sub-1', studentId: STUDENT, status: 'active', plan: null, payerUserId: null, currentPeriodEnd: null, manuallySetByAdmin: true, grantExpiresAt: '2026-01-01T00:00:00Z' };
  w.evidenceKeys.clear();
  w.locks.clear();
  w.connections = 0;
  w.taskInstances.clear();
  w.taskInstances.set(TASK, instanceRow(TASK));
  w.sql.length = 0;
  h.grade = vi.fn(async () => ({ result: 'correct', feedback: 'ok', aiExecution: { aiExecutionId: 'ai-1' } }));
  // The real updateMastery claims the operation key; the mock records the same fact.
  h.updateMastery = vi.fn(async (input: any) => {
    const key = buildOperationKey(input.identity);
    const duplicate = w.evidenceKeys.has(key);
    w.evidenceKeys.add(key);
    return { duplicate, oldMastery: 40, newMastery: 55, delta: 15 };
  });
  h.transition = vi.fn(async () => undefined);
  h.audit = vi.fn(async () => undefined);
});

describe('CR-L11-06: Transfer exactly-once', () => {
  it('OPEN valid transfer => continuation allowed: graded once, evidence written under the task\'s operation key', async () => {
    const res: any = await submit();
    expect(res.status).toBe(200);
    expect(h.grade).toHaveBeenCalledTimes(1);
    expect(h.updateMastery).toHaveBeenCalledTimes(1);
    expect(h.updateMastery.mock.calls[0][0].identity).toEqual({ operationType: 'TRANSFER', operationId: TASK, conceptId: CONCEPT });
    expect(w.evidenceKeys.has(keyOf(TASK))).toBe(true);
  });

  it('ALREADY ANSWERED / GRADED transfer => the repeat is rejected (409) and the AI grader is NOT invoked', async () => {
    expect(((await submit()) as any).status).toBe(200);
    const repeat: any = await submit();
    expect(repeat.status).toBe(409);
    expect((await repeat.json()).error).toBe('TRANSFER_TASK_ALREADY_ANSWERED');
    expect(h.grade).toHaveBeenCalledTimes(1); // still only the first submission
    expect(h.updateMastery).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) expect(((await submit()) as any).status).toBe(409);
    expect(h.grade).toHaveBeenCalledTimes(1);
  });

  it('a task graded in an earlier session (evidence already persisted) is refused without any grading call', async () => {
    w.evidenceKeys.add(keyOf(TASK));
    expect(((await submit()) as any).status).toBe(409);
    expect(h.grade).not.toHaveBeenCalled();
    expect(h.updateMastery).not.toHaveBeenCalled();
  });

  it('the check is per task: another OPEN task of the same concept is unaffected', async () => {
    w.evidenceKeys.add(keyOf(TASK));
    w.taskInstances.set(OTHER_TASK, instanceRow(OTHER_TASK));
    expect(((await submit(OTHER_TASK)) as any).status).toBe(200);
    expect(h.grade).toHaveBeenCalledTimes(1);
  });

  it('a submission whose grading failed leaves the task OPEN (no evidence was written), so the Student can answer again', async () => {
    h.grade = vi.fn(async () => { throw new Error('grader unavailable'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(((await submit()) as any).status).toBe(500);
    expect(w.evidenceKeys.size).toBe(0);
    h.grade = vi.fn(async () => ({ result: 'partial', feedback: 'ok', aiExecution: { aiExecutionId: 'ai-2' } }));
    expect(((await submit()) as any).status).toBe(200);
    err.mockRestore();
  });

  it('the proof is the existing evidence key -- and it is checked BEFORE grading', async () => {
    expect(await isTransferTaskAlreadyGraded(TASK, CONCEPT)).toBe(false);
    w.evidenceKeys.add(keyOf(TASK));
    expect(await isTransferTaskAlreadyGraded(TASK, CONCEPT)).toBe(true);
    expect(w.sql.filter((s) => s.includes('learning_evidence')).every((s) => /^SELECT 1 FROM learning_evidence WHERE operation_key = \$1 LIMIT 1$/.test(s))).toBe(true);
    // In the route the grader is only reachable INSIDE the exclusive runner, which checks the answered state first.
    const route = readFileSync(join(process.cwd(), 'src/app/api/cognitive/transfer/submit/route.ts'), 'utf8');
    const open = route.indexOf('await runTransferSubmissionExclusively(canonicalTaskId, validated.conceptId, async () => {');
    expect(open).toBeGreaterThan(0);
    expect(route.match(/evaluateTransferResponse\(/g)).toHaveLength(1);
    expect(route.indexOf('await evaluateTransferResponse(')).toBeGreaterThan(open);
    expect(route.indexOf('await updateMastery(')).toBeGreaterThan(open);
    const service = readFileSync(join(process.cwd(), 'src/services/transfer-task-instance.service.ts'), 'utf8');
    const runner = service.slice(service.indexOf('export async function runTransferSubmissionExclusively'));
    expect(runner.indexOf('pg_try_advisory_xact_lock')).toBeLessThan(runner.indexOf('isTransferTaskAlreadyGraded('));
    expect(runner.indexOf('isTransferTaskAlreadyGraded(')).toBeLessThan(runner.indexOf('await gradeAndRecord()'));
  });

  it('if the answered state cannot be read, the submission does not proceed to grading', async () => {
    const { db } = await import('@/lib/db');
    const original = (db as any).query;
    (db as any).query = async (sql: string, p: any[]) => { if (/learning_evidence/.test(sql)) throw new Error('db down'); return original(sql, p); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(((await submit()) as any).status).toBe(500);
    expect(h.grade).not.toHaveBeenCalled();
    (db as any).query = original;
    err.mockRestore();
  });

  describe('L10-R2: CONCURRENT first submissions', () => {
    const slowGrader = () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      h.grade = vi.fn(async () => { await gate; return { result: 'correct', feedback: 'ok', aiExecution: { aiExecutionId: 'ai-1' } }; });
      return release;
    };

    it('two simultaneous submissions of the same task: ONE grading invocation, the other refused deterministically (409 IN_PROGRESS)', async () => {
      const release = slowGrader();
      const first = submit();
      const second = submit();
      const loser: any = await second; // the loser never waits for the grader
      expect(loser.status).toBe(409);
      expect((await loser.json()).error).toBe('TRANSFER_TASK_SUBMISSION_IN_PROGRESS');
      expect(h.grade).toHaveBeenCalledTimes(1);
      release();
      expect(((await first) as any).status).toBe(200);
      expect(h.grade).toHaveBeenCalledTimes(1);
      expect(h.updateMastery).toHaveBeenCalledTimes(1);
      expect([...w.evidenceKeys]).toEqual([keyOf(TASK)]); // one completion / evidence outcome
    });

    it('ten at once: still one grading invocation and one evidence outcome; nine identical refusals', async () => {
      const release = slowGrader();
      const all = Array.from({ length: 10 }, () => submit());
      await new Promise((r) => setTimeout(r, 5));
      release();
      const statuses = (await Promise.all(all)).map((r: any) => r.status).sort();
      expect(statuses).toEqual([200, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
      expect(h.grade).toHaveBeenCalledTimes(1);
      expect(w.evidenceKeys.size).toBe(1);
    });

    it('after the winner finishes, a later request reads ALREADY_ANSWERED (not IN_PROGRESS): the claim was released', async () => {
      expect(((await submit()) as any).status).toBe(200);
      expect(w.locks.size).toBe(0);
      expect(w.connections).toBe(0);
      expect((await ((await submit()) as any).json()).error).toBe('TRANSFER_TASK_ALREADY_ANSWERED');
    });

    it('crash / failure while grading does not strand the task: the claim is released, nothing was written, the next submission grades', async () => {
      h.grade = vi.fn(async () => { throw new Error('process died mid-grading'); });
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(((await submit()) as any).status).toBe(500);
      err.mockRestore();
      expect([w.locks.size, w.connections, w.evidenceKeys.size]).toEqual([0, 0, 0]);
      h.grade = vi.fn(async () => ({ result: 'correct', feedback: 'ok', aiExecution: { aiExecutionId: 'ai-2' } }));
      expect(((await submit()) as any).status).toBe(200);
      expect(h.grade).toHaveBeenCalledTimes(1);
    });

    it('the claim is per task: two different tasks are graded in parallel', async () => {
      w.taskInstances.set(OTHER_TASK, instanceRow(OTHER_TASK));
      const release = slowGrader();
      const a = submit(TASK);
      const b = submit(OTHER_TASK);
      await new Promise((r) => setTimeout(r, 5));
      release();
      expect((await Promise.all([a, b])).map((r: any) => r.status)).toEqual([200, 200]);
      expect(h.grade).toHaveBeenCalledTimes(2);
    });

    it('the claim is transaction-scoped (never a session lock, which is unsafe behind the pooler) and never waits', () => {
      const service = readFileSync(join(process.cwd(), 'src/services/transfer-task-instance.service.ts'), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
      expect(service).toMatch(/pg_try_advisory_xact_lock\(\$1::bigint\)/);
      expect(service).not.toMatch(/pg_advisory_lock\(|pg_advisory_unlock|pg_try_advisory_lock\(/);
    });
  });

  it('no schema was added for it', () => {
    const { readdirSync } = require('fs');
    const batch = readdirSync(join(process.cwd(), 'database/migrations')).filter((f: string) => f.startsWith('20261120_'));
    for (const f of batch) expect(readFileSync(join(process.cwd(), 'database/migrations', f), 'utf8')).not.toMatch(/transfer_task_instances/);
  });
});

describe('CR-L11-05: manual payment approval on an administrator-set row is refused', () => {
  const params = { studentId: STUDENT, plan: 'MONTHLY', amountCents: 50000, currency: 'COP', occurredAt: '2026-10-11T00:00:00Z', reference: 'bank-1', method: 'transfer', validUntil: '2026-11-11T00:00:00Z' };
  const wrote = (pattern: RegExp) => w.sql.some((s) => pattern.test(s));

  for (const [label, row] of [
    ['an expired licence grant', { status: 'active', manuallySetByAdmin: true, grantExpiresAt: '2026-01-01T00:00:00Z' }],
    ['a live licence grant', { status: 'active', manuallySetByAdmin: true, grantExpiresAt: '2027-01-01T00:00:00Z' }],
    ['an administrative suspension', { status: 'suspended', manuallySetByAdmin: true, grantExpiresAt: null }],
    ['a revoked grant', { status: 'cancelled', manuallySetByAdmin: true, grantExpiresAt: null }],
  ] as const) {
    it(`${label}: refused before anything is written -- no payment row, no status change, no "active but no access"`, async () => {
      Object.assign(w.subscription, row);
      await expect(approveManualPayment('admin-1', params)).rejects.toBeInstanceOf(AdminControlledSubscriptionError);
      expect(wrote(/^INSERT INTO payments/)).toBe(false);
      expect(wrote(/^UPDATE subscriptions SET plan/)).toBe(false);
      expect(h.transition).not.toHaveBeenCalled();
      expect(h.audit).not.toHaveBeenCalled();
    });
  }

  it('the route answers 409 ADMIN_CONTROLLED_SUBSCRIPTION', async () => {
    const res: any = await approvePOST(new NextRequest('https://app.test/api/admin/memberships/approve-payment', { method: 'POST', body: JSON.stringify(params) }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ADMIN_CONTROLLED_SUBSCRIPTION');
  });

  it('a row an administrator did not set keeps the existing behaviour: the payment is recorded and the plan applied', async () => {
    Object.assign(w.subscription, { status: 'unpaid', manuallySetByAdmin: false, grantExpiresAt: null });
    await expect(approveManualPayment('admin-1', params)).resolves.toEqual({ subscriptionId: 'sub-1' });
    expect(wrote(/^INSERT INTO payments/)).toBe(true);
    expect(wrote(/^UPDATE subscriptions SET plan = \$1, source = \$2, current_period_end = \$3/)).toBe(true);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PAYMENT_APPROVED' }));
  });

  it('admin suspension / revocation protections are untouched: the refusal clears no grant field', () => {
    const src = readFileSync(join(process.cwd(), 'src/services/membership-admin.service.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function approveManualPayment'), src.indexOf('export async function', src.indexOf('export async function approveManualPayment') + 10));
    expect(fn).not.toMatch(/manually_set_by_admin\s*=\s*false/);
    expect(fn.indexOf('if (before.manuallySetByAdmin) throw new AdminControlledSubscriptionError()')).toBeLessThan(fn.indexOf('INSERT INTO payments'));
  });
});
