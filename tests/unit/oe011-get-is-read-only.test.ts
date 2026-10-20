/**
 * OE-011 -- a page render or a GET handler is read-only with respect to
 * question supply: it never queues a generation job, never asks for
 * inventory replenishment and never calls a question generator. When
 * eligible content is missing the Student sees "not available"; supply is
 * only ever requested by an explicit write (POST) operation.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf-8');
/** Source without comments, so a comment that names a forbidden call is not a hit. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SUPPLY = /scheduleDeliveryReplenishment|requestAssessmentSupply|requestSupplyForSession|enqueueGenerationJob|runGenerationWorker|dispatchDeliveryWorker|generateActivityCandidates|deliverCanonicalActivity|INSERT INTO generation_jobs/;

const appFiles = walk('src/app');
const renders = appFiles.filter((f) => /\/(page|layout|loading|error|not-found|template)\.tsx$/.test(f));
const getHandlers = appFiles.filter((f) => /\/route\.ts$/.test(f) && /export (async )?function GET\b|export const GET\b/.test(read(f)));

describe('OE-011: GET is read-only for question supply', () => {
  it('finds the surfaces it is meant to guard', () => {
    expect(renders.length).toBeGreaterThan(50);
    expect(getHandlers.length).toBeGreaterThan(50);
    for (const rel of ['src/app/dashboard/today/page.tsx', 'src/app/dashboard/assessment/page.tsx', 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx', 'src/app/dashboard/quiz/page.tsx']) {
      expect(renders).toContain(rel);
    }
  });

  it('no page, layout or boundary queues a job, requests supply or generates', () => {
    expect(renders.filter((rel) => SUPPLY.test(code(rel)))).toEqual([]);
  });

  it('no route module that serves GET queues a job, requests supply or generates', () => {
    expect(getHandlers.filter((rel) => SUPPLY.test(code(rel)))).toEqual([]);
  });

  it('the setup read model cannot reach the supply service', () => {
    for (const rel of ['src/lib/assessment-experience/assessment-experience.service.ts', 'src/lib/assessment-experience/views.ts', 'src/lib/assessment-experience/entry.ts', 'src/lib/assessment-experience/launch.ts']) {
      expect(code(rel), rel).not.toMatch(SUPPLY);
      expect(code(rel), rel).not.toMatch(/assessment-supply\.service|activity-delivery-worker\.service|generation-queue\.service/);
    }
  });

  it('the only writer of generation_jobs is the queue itself, and no Student-facing route reaches it (OE-014)', () => {
    expect(walk('src').filter((f) => /INSERT INTO generation_jobs/.test(read(f)))).toEqual(['src/services/generation-queue.service.ts']);
    const callers = appFiles.filter((f) => /scheduleDeliveryReplenishment|requestAssessmentSupply|requestSupplyForSession|enqueueGenerationJob/.test(code(f)));
    // the internal benchmark endpoint is the one caller left: operator-only, never a Student request
    expect(callers).toEqual(['src/app/api/internal/delivery-bench/route.ts']);
  });
});

describe('OE-011: insufficient inventory answers "not available" without asking for supply', () => {
  it('a setup that cannot be solved calls neither the supply scheduler nor a generator', async () => {
    const schedule = vi.fn();
    vi.doMock('@/services/activity-delivery-worker.service', () => ({ scheduleDeliveryReplenishment: schedule }));
    vi.doMock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));
    const { learningSetupForStudent } = await import('@/lib/assessment-experience/assessment-experience.service');
    const solve = vi.fn(async () => ({ ok: false as const, reason: 'CONTEXT_UNAVAILABLE' }));
    const result = await learningSetupForStudent(
      'student-1',
      { family: 'LEARNING', intent: 'MASTERY_CHECK', depth: 'BALANCED', origin: 'LEARNING_PATH', scope: { canonicalConceptIds: [], learnerConceptIds: ['lc-1'] } } as never,
      new Date(0).toISOString(),
      { solve: solve as never }
    );
    expect(result.ok).toBe(false);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
  });
});
