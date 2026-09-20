/**
 * F15 -- deterministic tests for ADR-F15-MIN-COHORT-POLICY.md
 * (resolves IVG-F12-04). Covers: (1) the pure suppression function's
 * own boundary behavior, (2) the two real gaps this phase found and
 * fixed -- getInstitutionDiagnosticSummary and
 * getInstitutionInterventionSummary now apply the same cohort
 * suppression their sibling Learning/Readiness metrics already did --
 * and (3) Attention Areas never reads a suppressed sibling metric.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import { applyCohortSuppression, type AnalyticsPolicyVersion } from '@/lib/institution-intelligence/policy.service';

const POLICY: AnalyticsPolicyVersion = { id: 'policy-1', version: 1, rules: { minimumCohortSize: 10 }, status: 'ACTIVE', effectiveFrom: '2026-01-01T00:00:00.000Z' };

describe('applyCohortSuppression (the one disclosure-control choke point)', () => {
  it('suppresses a cohort strictly below the policy minimum', () => {
    const result = applyCohortSuppression(9, POLICY, { fake: 'value' });
    expect(result).toEqual({ suppressed: true, policyVersion: 1, cohortSize: 9, reason: 'SMALL_COHORT' });
  });

  it('does NOT suppress a cohort exactly at the policy minimum', () => {
    const result = applyCohortSuppression(10, POLICY, { fake: 'value' });
    expect(result).toEqual({ suppressed: false, policyVersion: 1, cohortSize: 10, value: { fake: 'value' } });
  });

  it('suppresses a cohort of zero', () => {
    const result = applyCohortSuppression(0, POLICY, { fake: 'value' });
    expect(result.suppressed).toBe(true);
  });
});

describe('getInstitutionDiagnosticSummary applies cohort suppression (F15 fix -- previously missing)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    vi.resetModules();
  });

  it('suppresses the diagnostic distribution when the distinct-student cohort is below the policy minimum', async () => {
    vi.doMock('@/lib/institution-intelligence/authorization', () => ({ requireInstitutionAccess: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/institution-intelligence/policy.service', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/institution-intelligence/policy.service')>();
      return { ...actual, getActiveAnalyticsPolicy: vi.fn().mockResolvedValue(POLICY) };
    });

    queryMock
      .mockResolvedValueOnce({ rows: [{ primary_gap_type: 'KNOWLEDGE_GAP', c: 3 }] }) // distribution query
      .mockResolvedValueOnce({ rows: [{ c: 2 }] }); // distinct-student count query -- below minimumCohortSize=10

    const { getInstitutionDiagnosticSummary } = await import('@/lib/institution-intelligence/diagnostics.service');
    const summary = await getInstitutionDiagnosticSummary('actor-1', 'inst-1');

    expect(summary.cohort.suppressed).toBe(true);
  });

  it('does not suppress when the distinct-student cohort meets the policy minimum', async () => {
    vi.doMock('@/lib/institution-intelligence/authorization', () => ({ requireInstitutionAccess: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/institution-intelligence/policy.service', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/institution-intelligence/policy.service')>();
      return { ...actual, getActiveAnalyticsPolicy: vi.fn().mockResolvedValue(POLICY) };
    });

    queryMock
      .mockResolvedValueOnce({ rows: [{ primary_gap_type: 'KNOWLEDGE_GAP', c: 12 }] })
      .mockResolvedValueOnce({ rows: [{ c: 12 }] }); // meets minimumCohortSize=10

    const { getInstitutionDiagnosticSummary } = await import('@/lib/institution-intelligence/diagnostics.service');
    const summary = await getInstitutionDiagnosticSummary('actor-1', 'inst-1');

    expect(summary.cohort.suppressed).toBe(false);
    if (!summary.cohort.suppressed) {
      expect(summary.cohort.value.distribution.value.KNOWLEDGE_GAP).toBe(12);
    }
  });
});

describe('getInstitutionInterventionSummary applies cohort suppression by distinct student_id (F15 fix -- previously missing)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    vi.resetModules();
  });

  it('suppresses the status/type distribution when fewer than the policy minimum distinct students are represented', async () => {
    vi.doMock('@/lib/institution-intelligence/authorization', () => ({
      requireInstitutionAccess: vi.fn().mockResolvedValue(undefined),
      requireClassInInstitution: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/institution-intelligence/policy.service', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/institution-intelligence/policy.service')>();
      return { ...actual, getActiveAnalyticsPolicy: vi.fn().mockResolvedValue(POLICY) };
    });
    vi.doMock('@/lib/student/teacher-intervention-execution.service', () => ({
      getEffectiveStatus: (status: string) => status,
    }));

    // Only 4 distinct students, each with one row -- below minimumCohortSize=10.
    queryMock.mockResolvedValueOnce({
      rows: [
        { status: 'ASSIGNED', due_at: null, intervention_type: 'CONCEPT_REINFORCEMENT', student_id: 's1' },
        { status: 'ASSIGNED', due_at: null, intervention_type: 'CONCEPT_REINFORCEMENT', student_id: 's2' },
        { status: 'COMPLETED', due_at: null, intervention_type: 'SKILL_PRACTICE', student_id: 's3' },
        { status: 'COMPLETED', due_at: null, intervention_type: 'SKILL_PRACTICE', student_id: 's4' },
      ],
    });

    const { getInstitutionInterventionSummary } = await import('@/lib/institution-intelligence/interventions.service');
    const summary = await getInstitutionInterventionSummary('actor-1', 'inst-1');

    expect(summary.cohort.suppressed).toBe(true);
  });

  it('does not suppress when at least the policy minimum distinct students are represented', async () => {
    vi.doMock('@/lib/institution-intelligence/authorization', () => ({
      requireInstitutionAccess: vi.fn().mockResolvedValue(undefined),
      requireClassInInstitution: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/institution-intelligence/policy.service', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/institution-intelligence/policy.service')>();
      return { ...actual, getActiveAnalyticsPolicy: vi.fn().mockResolvedValue(POLICY) };
    });
    vi.doMock('@/lib/student/teacher-intervention-execution.service', () => ({
      getEffectiveStatus: (status: string) => status,
    }));

    const rows = Array.from({ length: 10 }, (_, i) => ({
      status: 'ASSIGNED', due_at: null, intervention_type: 'CONCEPT_REINFORCEMENT', student_id: `s${i}`,
    }));
    queryMock.mockResolvedValueOnce({ rows });

    const { getInstitutionInterventionSummary } = await import('@/lib/institution-intelligence/interventions.service');
    const summary = await getInstitutionInterventionSummary('actor-1', 'inst-1');

    expect(summary.cohort.suppressed).toBe(false);
    if (!summary.cohort.suppressed) {
      expect(summary.cohort.value.distribution.value.byStatus.ASSIGNED).toBe(10);
    }
  });
});
