/**
 * Candidate #12 follow-up A (OE-014): an insufficient-L4 (or exact-novelty) PROVE is an explicit, AUDITED shortage.
 * The learner route never enqueues replenishment, never dispatches the worker and never falls back to 10xL3 for a
 * qualifying learner. Replenishment stays an Operator / Admin workflow (worker handlers reached only from operator
 * scripts and the CRON_SECRET internal routes).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const p = join(dir, e);
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}
const QUEUE_MODULES = /@\/services\/(activity-delivery-worker|generation-queue|worker-dispatch)\.service/;

describe('OE-014 -- no learner route can reach replenishment', () => {
  it('only the CRON_SECRET internal routes import the worker / queue / dispatch modules', () => {
    const importers = walk('src/app').filter((f) => QUEUE_MODULES.test(src(f)));
    expect(importers.sort()).toEqual(['src/app/api/internal/delivery-bench/route.ts', 'src/app/api/internal/generation-worker/route.ts'].sort());
    for (const f of importers) expect(src(f), f).toMatch(/hasInternalBearer/);
  });
  it('the only lib importer of the replenishment trigger (assessment-supply.service) is imported by no src module', () => {
    const users = walk('src').filter((f) => f !== 'src/lib/assessment-experience/assessment-supply.service.ts' && /assessment-supply\.service/.test(src(f)));
    expect(users).toEqual([]);
  });
  it('the Prove learner route and its delivery services never enqueue, schedule or dispatch', () => {
    for (const f of ['src/app/api/quizzes/generate-and-take/route.ts', 'src/services/activity-delivery.service.ts', 'src/services/canonical-prove-generation.service.ts', 'src/services/canonical-prepared-activity.service.ts', 'src/services/activity-assembly.service.ts']) {
      expect(src(f), f).not.toMatch(/enqueueGenerationJob\(|scheduleDeliveryReplenishment\(|dispatchDeliveryWorker\(/);
    }
  });
  it('a PROVE supply shortage is explicit and AUDITED (analytics_events), with replenishmentQueued: false', () => {
    const r = src('src/app/api/quizzes/generate-and-take/route.ts');
    expect(r).toMatch(/else if \(proveShortageCheck\.levelMixSupplyShortage\) proveReasonCode = PROVE_LEVEL_MIX_SUPPLY_SHORTAGE;/);
    expect(r).toMatch(/await track\(validated\.studentId, 'CANONICAL_PROVE_SUPPLY_SHORTAGE', \{[\s\S]{0,200}replenishmentQueued: false/);
    expect(r).toMatch(/error: 'GENERATION_FAILED', reason: proveReasonCode/);
  });
});
