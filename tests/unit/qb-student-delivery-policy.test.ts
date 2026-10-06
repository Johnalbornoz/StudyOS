/**
 * Question Bank -- Student delivery requires HUMAN approval (PILOT is never Student content).
 *
 * ONE rule (`DEFAULT_ELIGIBILITY`, lifecycle.ts) governs every Student use, in memory (`isEligible`) and in SQL
 * (`lifecycleSqlFor`); this file proves the lifecycle matrix for every use and that every Student-facing selector
 * reads the bank only through that rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { DEFAULT_ELIGIBILITY, STUDENT_DELIVERABLE_STATES, isEligible, lifecycleSqlFor, deliveryStatusFor, LIFECYCLE_STATES, type DeliveryUse, type LifecycleState } from '@/lib/exam-core/question-bank/lifecycle';

const ROOT = join(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const USES: DeliveryUse[] = ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'FULL_MOCK_CALIBRATED'];

/** A generated version usable for every use when its lifecycle allows it. */
const facts = (lifecycle: LifecycleState, over: Record<string, unknown> = {}) => ({
  lifecycle,
  usage: ['PRACTICE', 'DIAGNOSTIC', 'QUIZ', 'REDUCED_MOCK', 'FULL_MOCK'],
  alignment: 'MOCK_READY',
  provenance: 'STUDYUS_GENERATED',
  status: deliveryStatusFor(lifecycle),
  isCurrentVersion: true,
  retired: false,
  calibrationConfidence: 'HIGH_CONFIDENCE' as const,
  ...over,
});

describe('the lifecycle rule', () => {
  it('Student-deliverable states are exactly ACTIVE and CALIBRATED (derived from the one policy)', () => {
    expect([...STUDENT_DELIVERABLE_STATES].sort()).toEqual(['ACTIVE', 'CALIBRATED']);
    for (const use of USES) for (const s of DEFAULT_ELIGIBILITY.states[use]) expect(STUDENT_DELIVERABLE_STATES).toContain(s);
  });

  it('13. HUMAN_APPROVED (ACTIVE) and CALIBRATED are Student-eligible for every use', () => {
    for (const use of USES) {
      expect(isEligible(facts('ACTIVE'), use === 'FULL_MOCK_CALIBRATED' ? 'FULL_MOCK' : use), use).toBe(true);
      expect(isEligible(facts('CALIBRATED'), use), use).toBe(true);
    }
  });

  it('8-10. PILOT (automated pass awaiting human review) is never Student-eligible: practice, diagnostic, mocks', () => {
    // PUBLISHED in the legacy status column, yet never delivered: PUBLISHED is not "Student-deliverable".
    expect(deliveryStatusFor('PILOT')).toBe('PUBLISHED');
    for (const use of USES) expect(isEligible(facts('PILOT'), use), use).toBe(false);
  });

  it('14-15. CORRECTION_REQUIRED (REVIEW_REQUIRED), REJECTED / AUTO_REJECTED and every pre-review state: never', () => {
    for (const s of LIFECYCLE_STATES.filter((x) => !STUDENT_DELIVERABLE_STATES.includes(x))) {
      for (const use of USES) expect(isEligible(facts(s), use), `${s} ${use}`).toBe(false);
    }
  });

  it('16. fixtures / unknown provenance are never Student-eligible, even ACTIVE', () => {
    for (const use of USES) {
      expect(isEligible(facts('ACTIVE', { provenance: 'FIXTURE' }), use)).toBe(false);
      expect(isEligible(facts('ACTIVE', { provenance: undefined }), use)).toBe(false);
    }
  });

  it('the SQL form excludes PILOT for every Student use (and keeps the fixture exclusion)', () => {
    for (const use of USES) {
      const sql = lifecycleSqlFor(use);
      expect(sql, use).not.toContain("'PILOT'");
      expect(sql, use).toContain("IN ('CALIBRATED', 'ACTIVE')");
      expect(sql, use).toContain("NOT (ai.content_origin = 'FIXTURE'");
    }
  });
});

describe('every Student-facing selector uses the one rule', () => {
  const walk = (d: string, out: string[] = []): string[] => {
    for (const f of readdirSync(join(ROOT, d))) {
      const p = join(d, f);
      if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(f)) out.push(p);
    }
    return out;
  };
  const SRC = walk('src');
  /** Files that read approved_items content for DELIVERY / readiness (admin, review, factory, demand planning and calibration tools are not Student-facing). */
  const NON_STUDENT = /question-bank\/(review|review-admin|admin|bank|factory|calibration|health|demand)\.service\.ts$|apply-vertical-config\.service\.ts$|assessment\/item-bank\.service\.ts$/;
  const readers = SRC.filter((f) => /FROM approved_items|JOIN approved_items/.test(read(f)) && !NON_STUDENT.test(f));

  it('8 / 9 / 10 / 12. the Student readers are exactly: practice & dynamic sourcing, exam instances (practice, diagnostic, mocks), the full-mock guard', () => {
    expect(readers.sort()).toEqual(['src/lib/assessment/full-mock-guard.service.ts', 'src/lib/exam-core/exam-instance.service.ts', 'src/lib/exam-core/item-sourcing.service.ts']);
  });

  it('each of them filters through lifecycleSqlFor (never a status / state list of its own)', () => {
    for (const f of readers) {
      const src = read(f);
      expect(src, f).toMatch(/lifecycleSqlFor\(/);
      expect(src, f).not.toMatch(/'PILOT'/);
    }
    expect(read('src/lib/exam-core/item-sourcing.service.ts')).toMatch(/lifecycleSqlFor\('PRACTICE', undefined, params\.contentAudience \?\? 'STUDENT'\)/);
    // Diagnostic and practice instances use PRACTICE, mocks REDUCED_MOCK / FULL_MOCK -- all from the same rule.
    expect(read('src/lib/exam-core/exam-instance.service.ts')).toMatch(/const use = mode === 'PRACTICE' \? 'PRACTICE' : fullLength \? 'FULL_MOCK' : 'REDUCED_MOCK'/);
  });

  it('11 / 12. readiness and coverage pools use isEligible (bank health), and Student readiness ignores snapshots of an older rule', () => {
    expect(read('src/lib/exam-core/question-bank/health.ts')).toMatch(/items\.filter\(\(i\) => isEligible\(i, use, policy, audience\)\)/);
    expect(read('src/lib/exam-core/question-bank/health.ts')).toMatch(/HEALTH_ENGINE_VERSION = 'qb-health-v2'/);
    expect(read('src/lib/exam-core/question-bank/capability-overlay.service.ts')).toMatch(/latestSnapshots\(versionIds, \{ currentEngineOnly: true \}\)/);
  });

  it('certification blockers name the human-approval reason from the same rule (no second state list)', () => {
    const src = read('src/lib/exam-core/question-bank/mock-certification.ts');
    expect(src).toMatch(/STUDENT_DELIVERABLE_STATES\.includes/);
    expect(src).not.toMatch(/\['ACTIVE', 'CALIBRATED'\]\.includes/);
  });

  it('the legacy F7 published-items lister is not reachable by any Student code path', () => {
    const callers = SRC.filter((f) => f !== 'src/lib/assessment/item-bank.service.ts' && /listPublishedItemsForObjective/.test(read(f)));
    expect(callers).toEqual([]);
  });
});
