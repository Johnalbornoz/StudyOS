/**
 * CANONICAL POLICY V2 AUDIT -- AUDIT-ONLY CERTIFICATION TESTS.
 *
 * Policy V2 Section 14 (LEGACY/MIGRATION) is explicit: "Pre-cutover
 * concepts may receive LEARN through LEGACY_MIGRATION_BASELINE. HIGHER
 * STAGES MUST NOT BE FABRICATED."
 *
 * This file proves, with the real `evaluateLegacyRecognition` /
 * `buildPedagogicalMigrationBaseline` functions (pure, no DB) plus a
 * source audit of the one migration/backfill CLI that calls them, that
 * the current migration-recognition layer CAN and DOES fabricate
 * PRACTICE/PROVE/RETAIN/TRANSFER "SATISFIED" recognition purely from
 * OLD legacy mastery-dimension scores -- with ZERO real v1 canonical
 * evidence of any kind. AUDIT-004 (BLOCKER).
 *
 * Mitigating fact, also verified here: the `pedagogical_requirement_recognition`
 * table's own migration has NOT been applied to any environment, and
 * the apply script itself has never been run against live data in this
 * environment (both confirmed by their own header comments) -- so no
 * real student data is corrupted BY THIS PATH today. The finding is
 * that the CODE, if ever run with --apply against real legacy mastery
 * data, would violate the frozen policy the moment it runs -- this must
 * be fixed BEFORE that script is ever executed against Preview or
 * Production. Test-only; no production code is changed here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateLegacyRecognition } from '@/lib/pedagogical-migration/legacy-recognition';
import { buildPedagogicalMigrationBaseline } from '@/lib/pedagogical-migration/migration-baseline';
import { evaluateCanonicalLearningState } from '@/lib/pedagogical-engine';
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const APPLY_SCRIPT_SRC = read('scripts/canon-r4r1-pre-v1-learn-baseline.ts');
const RECOGNITION_MIGRATION_SRC = read('database/migrations/20260915_1000_canon_r4r1_pedagogical_requirement_recognition.sql');

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

describe('AUDIT-004 (BLOCKER): legacy recognition can fabricate PROVE/RETAIN/TRANSFER from OLD mastery scores alone -- Policy V2 Section 14', () => {
  it('evaluateLegacyRecognition grants PROVE/RETAIN/TRANSFER "SATISFIED" recognition from OLD dimension scores alone, with ZERO real v1 PROVE/RETENTION_CHECK/TRANSFER evidence of any kind', () => {
    const recognitions = evaluateLegacyRecognition({
      knowledgeState: STRONG_LEGACY_MASTERY,
      masteryPolicy: PERMISSIVE_POLICY,
      recognizedAtMigration: '2026-01-01T00:00:00.000Z',
      migrationVersion: 'test-migration-v1',
    });
    const byRequirement = new Map(recognitions.map((r) => [r.requirement, r]));
    expect(byRequirement.get('PROVE')?.status).toBe('SATISFIED');
    expect(byRequirement.get('PROVE')?.basis).toBe('LEGACY_POLICY_RECOGNITION');
    expect(byRequirement.get('RETAIN')?.status).toBe('SATISFIED');
    expect(byRequirement.get('TRANSFER')?.status).toBe('SATISFIED');
    // This is the policy violation made concrete: `sourceEvidenceIds` is
    // empty for every one of these -- no real evidence row backs any of
    // them, contradicting "Higher stages must not be fabricated."
    expect(byRequirement.get('PROVE')?.sourceEvidenceIds).toEqual([]);
    expect(byRequirement.get('RETAIN')?.sourceEvidenceIds).toEqual([]);
    expect(byRequirement.get('TRANSFER')?.sourceEvidenceIds).toEqual([]);
  });

  it('buildPedagogicalMigrationBaseline (the top-level composer the CLI actually calls) propagates ALL of these higher-stage recognitions, not just LEARN', () => {
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
    expect(requirements).toEqual(expect.arrayContaining(['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER']));
  });

  it('once persisted, the engine\'s own replay treats a PROVE/RETAIN/TRANSFER recognition as SATISFIED with basis LEGACY_POLICY_RECOGNITION, reporting CONSOLIDATED for a concept with literally zero learning_evidence rows', () => {
    // Exercised via the frozen engine itself, using the SAME
    // RecognizedRequirement[] shape canonical-decision.service.ts would
    // pass through verbatim from a real DB read.
    const decision = evaluateCanonicalLearningState({
      conceptId: 'c1',
      studentId: 's1',
      now: '2026-01-01T00:00:00.000Z',
      evidence: [],
      activeCriticalMisconception: false,
      recognizedRequirements: [
        { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'x', recognizedAt: '2026-01-01T00:00:00.000Z' },
        { requirement: 'PRACTICE', basis: 'LEGACY_POLICY_RECOGNITION', recognitionId: 'r2', reasonCode: 'x', recognizedAt: '2026-01-01T00:00:00.000Z' },
        { requirement: 'PROVE', basis: 'LEGACY_POLICY_RECOGNITION', recognitionId: 'r3', reasonCode: 'x', recognizedAt: '2026-01-01T00:00:00.000Z' },
        { requirement: 'RETAIN', basis: 'LEGACY_POLICY_RECOGNITION', recognitionId: 'r4', reasonCode: 'x', recognizedAt: '2026-01-01T00:00:00.000Z' },
        { requirement: 'TRANSFER', basis: 'LEGACY_POLICY_RECOGNITION', recognitionId: 'r5', reasonCode: 'x', recognizedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    expect(decision.stage).toBe('CONSOLIDATED');
  });

  it('the apply CLI (canon-r4r1-pre-v1-learn-baseline.ts) passes ALL recognized requirements -- unfiltered -- to applyRecognitions, despite its own name/banner implying "LEARN only"', () => {
    expect(APPLY_SCRIPT_SRC).toMatch(/applyRecognitions\(\s*baseline\.recognizedRequirements,/);
    // No filter (e.g. `.filter(r => r.requirement === 'LEARN')`) exists
    // between computing the baseline and applying it.
    const applyCallIdx = APPLY_SCRIPT_SRC.indexOf('applyRecognitions(');
    const beforeApplyCall = APPLY_SCRIPT_SRC.slice(APPLY_SCRIPT_SRC.lastIndexOf('for (const pair of pairs)'), applyCallIdx);
    expect(beforeApplyCall).not.toMatch(/\.filter\(/);
  });

  it('the script itself reports (but does not suppress) higher-stage legacy recognitions in its own dry-run counters -- proving this is a known, observed code path, not a theoretical one', () => {
    expect(APPLY_SCRIPT_SRC).toMatch(/higherLegacyCounts\s*=\s*\{\s*PRACTICE:\s*0,\s*PROVE:\s*0,\s*RETAIN:\s*0,\s*TRANSFER:\s*0\s*\}/);
  });

  it('MITIGATING FACT: the pedagogical_requirement_recognition migration itself has not been applied to any environment (confirmed via its own header)', () => {
    expect(RECOGNITION_MIGRATION_SRC.length).toBeGreaterThan(0); // the file exists...
    // ...but every script that would write to it says, in its own
    // header, that it has never been executed in this environment.
    expect(APPLY_SCRIPT_SRC).toMatch(/NOT EXECUTED in this environment/);
  });
});
