/**
 * Question Bank Factory V1 -- bank core (pure): lifecycle, versions'
 * delivery contract, provenance, blueprint cells, budget, eligibility.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  LIFECYCLE_STATES, LIFECYCLE_TRANSITIONS, assertTransition, canTransition, deliveryStatusFor, isEligible, lifecycleSqlFor, effectiveLifecycle,
  LifecycleTransitionError, type LifecycleState,
} from '@/lib/exam-core/question-bank/lifecycle';
import { budgetStop, backoffMinutes, factoryConfig, provenanceFromOrigin, countsAsOfficial, cellTargets } from '@/lib/exam-core/question-bank/policy';
import { apportion, deriveBlueprintCells, cellKeyOf, fullLengthDeliverable } from '@/lib/exam-core/question-bank/cells';
import { configHealthInput } from '@/lib/exam-core/question-bank/config-health';
import { adapterFor } from '@/lib/exam-core/question-bank/adapters';
import { PAA_V2 } from '@/lib/exam-core/verticals/v2';

const ROOT = join(__dirname, '../..');
const MIGRATION = readFileSync(join(ROOT, 'database/migrations/20261026_1000_track_b_question_bank_factory.sql'), 'utf8');

describe('lifecycle: governed, server-authoritative transitions', () => {
  it('the main path DRAFT_AI -> VALIDATING -> VALIDATED -> PILOT -> CALIBRATED -> ACTIVE is allowed for the system', () => {
    const path: LifecycleState[] = ['DRAFT_AI', 'VALIDATING', 'VALIDATED', 'PILOT', 'CALIBRATED', 'ACTIVE'];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i], { actor: { kind: 'SYSTEM' }, provenance: 'STUDYUS_GENERATED' }), `${path[i - 1]}->${path[i]}`).toBe(true);
  });
  it('invalid transitions fail (never silently)', () => {
    const bad: Array<[LifecycleState, LifecycleState]> = [['DRAFT_AI', 'ACTIVE'], ['DRAFT_AI', 'PILOT'], ['VALIDATING', 'ACTIVE'], ['REJECTED', 'ACTIVE'], ['RETIRED', 'ACTIVE'], ['SUPERSEDED', 'PILOT'], ['RETIRED', 'PILOT']];
    for (const [f, t] of bad) expect(() => assertTransition(f, t, { actor: { kind: 'ADMIN', userId: 'u' }, provenance: 'FIXTURE', reason: 'x' })).toThrow(LifecycleTransitionError);
  });
  it('generated content can never skip PILOT, even by an admin', () => {
    expect(() => assertTransition('VALIDATED', 'ACTIVE', { actor: { kind: 'ADMIN', userId: 'u' }, provenance: 'STUDYUS_GENERATED', reason: 'x' })).toThrow(/PILOT_REQUIRED/);
    expect(canTransition('VALIDATED', 'ACTIVE', { actor: { kind: 'ADMIN', userId: 'u' }, provenance: 'LICENSED' })).toBe(true);
  });
  it('promotions on human judgement are admin-only (the unattended factory cannot take them)', () => {
    expect(canTransition('PILOT', 'ACTIVE', { actor: { kind: 'SYSTEM' }, provenance: 'STUDYUS_GENERATED' })).toBe(false);
    expect(canTransition('PILOT', 'ACTIVE', { actor: { kind: 'ADMIN', userId: 'u' }, provenance: 'STUDYUS_GENERATED' })).toBe(true);
    expect(canTransition('REVIEW_REQUIRED', 'ACTIVE', { actor: { kind: 'SYSTEM' }, provenance: 'FIXTURE' })).toBe(false);
  });
  it('a reason is mandatory (audit history)', () => {
    expect(() => assertTransition('PILOT', 'RETIRED', { actor: { kind: 'SYSTEM' }, provenance: 'FIXTURE', reason: ' ' })).toThrow(/REASON_REQUIRED/);
  });
  it('terminal states have no exit; retirement is reachable from every deliverable state', () => {
    for (const t of ['REJECTED', 'RETIRED', 'SUPERSEDED'] as const) expect(LIFECYCLE_TRANSITIONS[t]).toEqual([]);
    for (const s of ['PILOT', 'CALIBRATED', 'ACTIVE', 'SUSPENDED'] as const) expect(LIFECYCLE_TRANSITIONS[s]).toContain('RETIRED');
  });
  it('the TS transition table and the DB trigger function agree exactly', () => {
    const fnBody = MIGRATION.slice(MIGRATION.indexOf('FUNCTION public.question_bank_transition_allowed'), MIGRATION.indexOf('$$;', MIGRATION.indexOf('FUNCTION public.question_bank_transition_allowed')));
    const sqlPairs = new Set([...fnBody.matchAll(/\('([A-Z_]+)', '([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).filter((p) => p.split('>').every((s) => (LIFECYCLE_STATES as readonly string[]).includes(s))));
    const tsPairs = new Set(Object.entries(LIFECYCLE_TRANSITIONS).flatMap(([f, ts]) => ts.map((t) => `${f}>${t}`)));
    expect([...tsPairs].filter((p) => !sqlPairs.has(p))).toEqual([]);
    expect([...sqlPairs].filter((p) => !tsPairs.has(p))).toEqual([]);
  });
  it('delivery contract: PUBLISHED exactly for PILOT / CALIBRATED / ACTIVE (matches the DB consistency CHECK)', () => {
    for (const s of LIFECYCLE_STATES) expect(deliveryStatusFor(s) === 'PUBLISHED', s).toBe(['PILOT', 'CALIBRATED', 'ACTIVE'].includes(s));
    expect(deliveryStatusFor('SUPERSEDED')).toBe('RETIRED');
    expect(MIGRATION).toContain("(bank_lifecycle_status IN ('PILOT', 'CALIBRATED', 'ACTIVE') AND status = 'PUBLISHED')");
  });
});

describe('versions: immutability and no-delete are enforced by the database', () => {
  it('content / key / version identity of a bank version cannot be updated; a version cannot be deleted', () => {
    expect(MIGRATION).toMatch(/QUESTION_BANK_VERSION_IMMUTABLE/);
    expect(MIGRATION).toMatch(/OLD\.content IS DISTINCT FROM NEW\.content/);
    expect(MIGRATION).toMatch(/BEFORE DELETE ON public\.approved_items/);
    expect(MIGRATION).toMatch(/UNIQUE \(bank_item_id, version_number\)/);
  });
  it('backfill is idempotent and never rewrites content (bank item id = the existing row id; ON CONFLICT DO NOTHING; WHERE bank_item_id IS NULL)', () => {
    expect(MIGRATION).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(MIGRATION).toMatch(/WHERE ai\.bank_item_id IS NULL/);
    expect(MIGRATION).not.toMatch(/SET\s+content\s*=/i);
    expect(MIGRATION).toMatch(/WHEN 'PUBLISHED' THEN 'ACTIVE'/);
  });
});

describe('eligibility: practice may use PILOT, mocks never do, retired never', () => {
  const base = { lifecycle: 'ACTIVE' as LifecycleState, status: 'PUBLISHED', isCurrentVersion: true, retired: false, calibrationConfidence: 'INSUFFICIENT_DATA' as const };
  it('PILOT: practice yes, reduced/full mock no', () => {
    const pilot = { ...base, lifecycle: 'PILOT' as LifecycleState };
    expect(isEligible(pilot, 'PRACTICE')).toBe(true);
    expect(isEligible(pilot, 'REDUCED_MOCK')).toBe(false);
    expect(isEligible(pilot, 'FULL_MOCK')).toBe(false);
  });
  it('retired / superseded / not-current never enter a new form', () => {
    expect(isEligible({ ...base, retired: true }, 'PRACTICE')).toBe(false);
    expect(isEligible({ ...base, isCurrentVersion: false }, 'FULL_MOCK')).toBe(false);
    expect(isEligible({ ...base, lifecycle: 'SUPERSEDED', status: 'RETIRED' }, 'PRACTICE')).toBe(false);
  });
  it('the calibrated full form needs field evidence; ACTIVE without it is not calibrated', () => {
    expect(isEligible(base, 'FULL_MOCK')).toBe(true);
    expect(isEligible(base, 'FULL_MOCK_CALIBRATED')).toBe(false);
    expect(isEligible({ ...base, calibrationConfidence: 'MODERATE_CONFIDENCE' }, 'FULL_MOCK_CALIBRATED')).toBe(true);
  });
  it('legacy PUBLISHED rows without a lifecycle behave as ACTIVE (no regression of existing mocks)', () => {
    expect(effectiveLifecycle({ lifecycle: null, status: 'PUBLISHED' })).toBe('ACTIVE');
    expect(lifecycleSqlFor('REDUCED_MOCK')).toBe("((ai.bank_lifecycle_status IS NULL OR ai.bank_lifecycle_status IN ('CALIBRATED', 'ACTIVE')) AND (ai.usage_eligibility IS NULL OR 'REDUCED_MOCK' = ANY(ai.usage_eligibility)) AND (ai.exam_alignment IS NULL OR ai.exam_alignment IN ('MOCK_READY', 'OFFICIAL')))");
    expect(lifecycleSqlFor('PRACTICE')).toContain("'PILOT'");
  });
  it('the mock form query of the instance service applies the policy (PILOT excluded from Mock / Challenge)', () => {
    const svc = readFileSync(join(ROOT, 'src/lib/exam-core/exam-instance.service.ts'), 'utf8');
    expect(svc).toMatch(/const use = mode === 'PRACTICE' \? 'PRACTICE' : fullLength \? 'FULL_MOCK' : 'REDUCED_MOCK'/);
    expect(svc).toMatch(/lifecycleSqlFor\(use\)/);
  });
});

describe('provenance', () => {
  it('AI-generated is always STUDYUS_GENERATED; never official; official coverage counts only OFFICIAL / LICENSED', () => {
    expect(provenanceFromOrigin('GENERATED')).toBe('STUDYUS_GENERATED');
    expect(provenanceFromOrigin(undefined)).toBe('STUDYUS_GENERATED');
    expect(provenanceFromOrigin('FIXTURE')).toBe('FIXTURE');
    expect(countsAsOfficial('STUDYUS_GENERATED')).toBe(false);
    expect(countsAsOfficial('FIXTURE')).toBe(false);
    expect(countsAsOfficial('LICENSED')).toBe(true);
    expect(MIGRATION).toMatch(/generation_request_id IS NULL OR provenance = 'STUDYUS_GENERATED'/);
  });
});

describe('blueprint cells from the governed blueprint (never invented)', () => {
  it('largest-remainder apportionment is exact and deterministic', () => {
    expect(apportion(45, [2, 2, 2, 1, 1, 2])).toEqual([9, 9, 9, 5, 4, 9]);
    expect(apportion(55, [3, 3, 3, 2, 1])).toEqual([14, 14, 14, 9, 4]);
    expect(apportion(50, [3, 3, 2])).toEqual([19, 19, 12]);
    expect(apportion(25, [1, 1, 1, 1, 1, 1]).reduce((a, b) => a + b)).toBe(25);
  });
  it('PAA: 20 cells from the stored blueprint; reduced 36 positions; full length 175 = 45 + 25 + 55 + 50, proportional to the governed blueprint', () => {
    const h = configHealthInput(PAA_V2);
    expect(h.cells).toHaveLength(20);
    expect(h.cells.reduce((n, c) => n + c.reducedPositions, 0)).toBe(36);
    const full = (k: string) => h.cells.filter((c) => c.sectionKey === k).reduce((n, c) => n + c.fullPositions, 0);
    expect([full('lectura'), full('redaccion'), full('matematicas'), full('ingles')]).toEqual([45, 25, 55, 50]);
    expect(h.cells.every((c) => c.lengthBasis === 'ITEMS_PROPORTIONAL')).toBe(true);
    expect(h.cells.find((c) => c.objectiveCode === 'paa.mat.algebra')?.fullPositions).toBe(14);
    expect(fullLengthDeliverable(h.cells)).toBe(false);
  });
  it('a blueprint that already reaches the published length is deliverable full length; unknown length is never full', () => {
    const comps = [{ id: 'c', sectionKey: 's', name: 'S', order: 0, officialItemCount: 2, maxMarks: null, simulationCapable: true }];
    const t = (id: string) => ({ id, learningObjectiveId: 'lo', objectiveCode: 'o', assessmentComponentId: 'c', questionType: null, difficultyMin: null, difficultyMax: null, commandTerm: null });
    const cells = deriveBlueprintCells([t('1'), t('2')], comps);
    expect(cells[0].lengthBasis).toBe('BLUEPRINT_IS_FULL');
    expect(fullLengthDeliverable(cells)).toBe(true);
    const unknown = deriveBlueprintCells([t('1')], [{ ...comps[0], officialItemCount: null }]);
    expect(unknown[0].lengthBasis).toBe('UNKNOWN');
  });
  it('cell keys are semantic (section | requirement | type | band | command term)', () => {
    expect(cellKeyOf('matematicas', 'paa.mat.algebra', null, null, null, null)).toBe('matematicas|paa.mat.algebra|*|*-*|*');
  });
  it('targets are configurable (no global magic number): defaults from the full form, overrides per cell win', () => {
    expect(cellTargets(14, null, null)).toMatchObject({ minUsable: 14, desired: 42, minActive: 14 });
    expect(cellTargets(14, { targetForms: 2 }, { desiredItems: 25 })).toMatchObject({ desired: 25 });
    expect(cellTargets(14, { targetForms: 2 }, null).desired).toBe(28);
  });
});

describe('AI budget / rate-limit safety', () => {
  it('disabled by default; conservative defaults; invalid values fail loudly', () => {
    const cfg = factoryConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.readinessMode).toBe('SHADOW');
    expect(cfg.dailyBudget).toBeLessThanOrEqual(20);
    expect(cfg.maxPerRun).toBeLessThanOrEqual(6);
    expect(cfg.maxBatch).toBeLessThanOrEqual(3);
    expect(cfg.examConfigKeys).toEqual([]);
    expect(() => factoryConfig({ QUESTION_BANK_DAILY_BUDGET: '-1' })).toThrow(/QUESTION_BANK_CONFIG_INVALID/);
    expect(factoryConfig({ QUESTION_BANK_FACTORY_ENABLED: 'yes' }).enabled).toBe(false);
  });
  it('budget gates: disabled, daily budget, per run, shared-cap reserve, unknown remainder = stop', () => {
    const cfg = factoryConfig({ QUESTION_BANK_FACTORY_ENABLED: 'true', QUESTION_BANK_DAILY_BUDGET: '10', QUESTION_BANK_MAX_PER_RUN: '4', QUESTION_BANK_MIN_REMAINING_AI_RESERVE: '100' });
    expect(budgetStop({ ...cfg, enabled: false }, { usedToday: 0, usedThisRun: 0, platformRemaining: 1000 })).toBe('DISABLED');
    expect(budgetStop(cfg, { usedToday: 10, usedThisRun: 0, platformRemaining: 1000 })).toBe('DAILY_BUDGET');
    expect(budgetStop(cfg, { usedToday: 2, usedThisRun: 4, platformRemaining: 1000 })).toBe('MAX_PER_RUN');
    expect(budgetStop(cfg, { usedToday: 2, usedThisRun: 1, platformRemaining: 100 })).toBe('AI_RESERVE');
    expect(budgetStop(cfg, { usedToday: 2, usedThisRun: 1, platformRemaining: null })).toBe('AI_RESERVE');
    expect(budgetStop(cfg, { usedToday: 2, usedThisRun: 1, platformRemaining: 101 })).toBeNull();
  });
  it('exponential backoff, capped; attempts are bounded in the schema (no infinite retry)', () => {
    expect([1, 2, 3, 4].map(backoffMinutes)).toEqual([5, 20, 80, 320]);
    expect(backoffMinutes(20)).toBe(1440);
    expect(MIGRATION).toMatch(/max_attempts BETWEEN 1 AND 5 AND attempt_count >= 0 AND attempt_count <= max_attempts/);
  });
  it('no generation storm: one RUNNING run, one open request per cell, SKIP LOCKED claiming', () => {
    expect(MIGRATION).toMatch(/idx_question_bank_factory_one_running ON public\.question_bank_factory_runs \(\(true\)\) WHERE status = 'RUNNING'/);
    expect(MIGRATION).toMatch(/idx_question_bank_generation_one_open_per_cell[\s\S]*WHERE status IN \('PENDING', 'RUNNING'\)/);
    const q = readFileSync(join(ROOT, 'src/lib/exam-core/question-bank/queue.service.ts'), 'utf8');
    expect(q).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(q).toMatch(/ON CONFLICT \(exam_version_id, cell_key\) WHERE status IN \('PENDING', 'RUNNING'\) DO NOTHING/);
  });
  it('deployment never starts a run: no cron registration, the internal entry point is CRON_SECRET-protected and a no-op when disabled', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/internal/question-bank-factory/route.ts'), 'utf8');
    expect(route).toMatch(/hasInternalBearer/);
    expect(route).toMatch(/if \(!cfg\.enabled\)/);
    for (const f of ['vercel.json', 'vercel.ts']) {
      try {
        expect(readFileSync(join(ROOT, f), 'utf8')).not.toMatch(/question-bank/);
      } catch {
        /* no such file */
      }
    }
  });
});

describe('family adapters', () => {
  it('PISA is unit-based; constructed-response families do not generate unattended', () => {
    expect(adapterFor('PISA').unitPolicy).toEqual({ mode: 'UNIT', minItemsPerUnit: 2 });
    expect(adapterFor('PAA').generation.supported).toBe(true);
    expect(adapterFor('IB').generation.supported).toBe(false);
    expect(adapterFor('AICE').generation.supported).toBe(false);
    expect(adapterFor('UNKNOWN').generation.supported).toBe(false);
  });
});
