/**
 * CANONICAL POLICY V2 -- AUDIT-004 REMEDIATION VERIFICATION.
 *
 * Was: AUDIT-004 (BLOCKER) -- `evaluateLegacyRecognition` could grant
 * PROVE/RETAIN/TRANSFER "SATISFIED" recognition from OLD legacy
 * mastery-dimension scores alone, with ZERO real v1 evidence
 * (`sourceEvidenceIds: []`), directly violating Policy V2 Section 14:
 * "Pre-cutover concepts may receive LEARN through
 * LEGACY_MIGRATION_BASELINE. Higher stages must not be fabricated."
 *
 * Now: `evaluateLegacyRecognition` returns AT MOST a single LEARN
 * recognition -- the higher-stage cascade has been removed at its
 * source. A second, independent defensive guard also exists at the
 * persistence boundary (`applyRecognitions`), rejecting (and logging)
 * any non-LEARN recognition from ANY future caller, never silently.
 * These tests assert the CORRECTED behavior. Test-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateLegacyRecognition } from '@/lib/pedagogical-migration/legacy-recognition';
import { buildPedagogicalMigrationBaseline } from '@/lib/pedagogical-migration/migration-baseline';
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const APPLY_SCRIPT_SRC = read('scripts/canon-r4r1-pre-v1-learn-baseline.ts');
const LEGACY_RECOGNITION_SRC = read('src/lib/pedagogical-migration/legacy-recognition.ts');

const STRONG_LEGACY_MASTERY: ConceptKnowledgeState = {
  studentId: 's1',
  conceptId: 'c1',
  masteryState: 'VALIDATED_MASTERY',
  evidenceCount: 20,
  independentEvidenceCount: 10,
  understandingScore: 95,
  independenceScore: 95,
  applicationScore: 95,
  retentionScore: 95,
  transferScore: 95,
  criticalMisconceptionCount: 0,
} as unknown as ConceptKnowledgeState;

const PERMISSIVE_POLICY: MasteryPolicy = {
  minimumEvidenceCount: 3,
  minimumIndependentEvidenceCount: 1,
  minimumUnderstanding: 70,
  minimumIndependence: 70,
  minimumApplication: 70,
  minimumRetention: 70,
  minimumTransfer: 70,
  requiresTransfer: true,
  maximumCriticalMisconceptions: 0,
} as unknown as MasteryPolicy;

describe('AUDIT-004 CLOSED: legacy recognition can no longer fabricate PROVE/RETAIN/TRANSFER -- Policy V2 Section 14', () => {
  it('evaluateLegacyRecognition, even given a MAXIMALLY strong legacy mastery record, grants ONLY LEARN -- never PRACTICE/PROVE/RETAIN/TRANSFER', () => {
    const recognitions = evaluateLegacyRecognition({
      knowledgeState: STRONG_LEGACY_MASTERY,
      masteryPolicy: PERMISSIVE_POLICY,
      recognizedAtMigration: '2026-01-01T00:00:00.000Z',
      migrationVersion: 'test-migration-v1',
    });
    expect(recognitions).toHaveLength(1);
    expect(recognitions[0].requirement).toBe('LEARN');
    expect(recognitions[0].status).toBe('SATISFIED');
    expect(recognitions.some((r) => r.requirement !== 'LEARN')).toBe(false);
  });

  it('a weak legacy mastery record (understanding below bar) recognizes nothing at all', () => {
    const weak: ConceptKnowledgeState = { ...STRONG_LEGACY_MASTERY, understandingScore: 40 };
    const recognitions = evaluateLegacyRecognition({
      knowledgeState: weak,
      masteryPolicy: PERMISSIVE_POLICY,
      recognizedAtMigration: '2026-01-01T00:00:00.000Z',
      migrationVersion: 'test-migration-v1',
    });
    expect(recognitions).toEqual([]);
  });

  it('buildPedagogicalMigrationBaseline (the top-level composer the CLI actually calls) never propagates a higher-stage recognition, even from a maximally strong legacy record', () => {
    const baseline = buildPedagogicalMigrationBaseline({
      conceptId: 'c1',
      studentId: 's1',
      knowledgeState: STRONG_LEGACY_MASTERY,
      masteryPolicy: PERMISSIVE_POLICY,
      recognizedAtMigration: '2026-01-01T00:00:00.000Z',
      migrationVersion: 'test-migration-v1',
      isPreexistingLearnerConcept: true,
    });
    const requirements = baseline.recognizedRequirements.map((r) => r.requirement);
    expect(requirements).toEqual(['LEARN']);
  });

  it('source-level proof: the cascading PRACTICE/PROVE/RETENTION/TRANSFER ladder no longer exists in evaluateLegacyRecognition at all', () => {
    expect(LEGACY_RECOGNITION_SRC).not.toMatch(/record\('PRACTICE'/);
    expect(LEGACY_RECOGNITION_SRC).not.toMatch(/record\('PROVE'/);
    expect(LEGACY_RECOGNITION_SRC).not.toMatch(/record\('RETAIN'/);
    expect(LEGACY_RECOGNITION_SRC).not.toMatch(/record\('TRANSFER'/);
  });

  it('the CLI\'s own permanent regression sentinel (higherLegacyCounts) is still present and documented to always report zero', () => {
    expect(APPLY_SCRIPT_SRC).toMatch(/higherLegacyCounts\s*=\s*\{\s*PRACTICE:\s*0,\s*PROVE:\s*0,\s*RETAIN:\s*0,\s*TRANSFER:\s*0\s*\}/);
    expect(APPLY_SCRIPT_SRC).toMatch(/must always be all-zero/);
  });
});

describe('AUDIT-004 defense-in-depth: applyRecognitions independently rejects any non-LEARN recognition', () => {
  const queryMock = vi.fn();
  beforeEach(() => {
    queryMock.mockReset();
    vi.resetModules();
  });

  it('rejects a PROVE recognition outright -- never issues an INSERT for it, and reports it in rejectedHigherStage', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));
    queryMock.mockResolvedValue({ rows: [{ id: 'r1' }] });
    const { applyRecognitions } = await import('@/lib/pedagogical-migration/recognition-persistence-adapter');
    const result = await applyRecognitions(
      [
        { id: 'r1', requirement: 'LEARN', status: 'SATISFIED', basis: 'LEGACY_POLICY_RECOGNITION', sourceEvidenceIds: [], legacyPolicyVersion: 'unversioned', recognizedAtMigration: '2026-01-01T00:00:00.000Z', reasonCode: 'x' },
        { id: 'r2', requirement: 'PROVE', status: 'SATISFIED', basis: 'LEGACY_POLICY_RECOGNITION', sourceEvidenceIds: [], legacyPolicyVersion: 'unversioned', recognizedAtMigration: '2026-01-01T00:00:00.000Z', reasonCode: 'x' },
      ] as any,
      's1',
      'c1',
      'test-migration-v1',
      '2026-01-01T00:00:00.000Z',
      { environment: 'preview' },
    );
    expect(result.rejectedHigherStage).toBe(1);
    // Only ONE query (the LEARN insert) was ever issued -- the PROVE
    // recognition never reached the database at all.
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toContain('LEARN');
  });

  it('logs the rejection observably (never silently)', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));
    queryMock.mockResolvedValue({ rows: [] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { applyRecognitions } = await import('@/lib/pedagogical-migration/recognition-persistence-adapter');
    await applyRecognitions(
      [{ id: 'r1', requirement: 'TRANSFER', status: 'SATISFIED', basis: 'LEGACY_POLICY_RECOGNITION', sourceEvidenceIds: [], legacyPolicyVersion: 'unversioned', recognizedAtMigration: '2026-01-01T00:00:00.000Z', reasonCode: 'x' }] as any,
      's1',
      'c1',
      'test-migration-v1',
      '2026-01-01T00:00:00.000Z',
      { environment: 'preview' },
    );
    expect(warnSpy).toHaveBeenCalledWith('legacy_recognition_higher_stage_rejected', expect.stringContaining('TRANSFER'));
    warnSpy.mockRestore();
  });
});
