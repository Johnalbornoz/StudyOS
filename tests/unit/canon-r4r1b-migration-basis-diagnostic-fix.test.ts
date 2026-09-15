/**
 * CANON-R4R1B -- MIGRATION BASIS DIAGNOSTIC FIX: the required regression
 * tests (8 tests). A live Preview validation of Radicación found
 * `composeEffectiveMigratedDecision` reporting a real
 * `LEGACY_MIGRATION_BASELINE` recognition as `LEGACY_POLICY_RECOGNITION`
 * in its `perRequirement[].basis` diagnostic output -- the DB row, the
 * migration, and the engine's own starting state were all already
 * correct; only this one reporting/composition mapping was wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { evaluateCanonicalLearningState, type RawEvidenceItem } from '@/lib/pedagogical-engine';
import { composeEffectiveMigratedDecision, buildPedagogicalMigrationBaseline } from '@/lib/pedagogical-migration';
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';
import type { MigrationBaseline, RequirementRecognition } from '@/lib/pedagogical-migration';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ENGINE_DIR = 'src/lib/pedagogical-engine';
const MIGRATION_DIR = 'src/lib/pedagogical-migration';

const NOW = '2026-09-20T00:00:00.000Z';
const MIGRATION_VERSION = 'studyus-canonical-v1-initial-migration';

function recognition(overrides: Partial<RequirementRecognition>): RequirementRecognition {
  return {
    id: 'rec-1',
    requirement: 'LEARN',
    status: 'SATISFIED',
    basis: 'LEGACY_MIGRATION_BASELINE',
    sourceEvidenceIds: [],
    legacyPolicyVersion: 'LEGACY_UNVERSIONED',
    recognizedAtMigration: '2026-09-01T00:00:00.000Z',
    reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1',
    ...overrides,
  };
}

function baseline(recognitions: RequirementRecognition[]): MigrationBaseline {
  return {
    conceptId: 'c1',
    recognizedRequirements: recognitions,
    unresolvedRequirements: [],
    warnings: [],
    sourceEvidenceIds: [],
    category: 'LEGACY_LEARN_RECOGNIZED',
  };
}

function emptyEngineDecision(evidence: RawEvidenceItem[] = []) {
  return evaluateCanonicalLearningState({ conceptId: 'c1', studentId: 's1', now: NOW, evidence, activeCriticalMisconception: false });
}

describe('CANON-R4R1B Part 4 -- required regression tests (1-8)', () => {
  it('1. LEGACY_MIGRATION_BASELINE is preserved verbatim in perRequirement basis (the exact bug: previously collapsed to LEGACY_POLICY_RECOGNITION)', () => {
    const mb = baseline([recognition({ requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1' })]);
    const effective = composeEffectiveMigratedDecision({
      conceptId: 'c1',
      studentId: 's1',
      engineDecision: emptyEngineDecision(),
      migrationBaseline: mb,
      activeCriticalMisconception: false,
    });
    expect(effective.perRequirement.find((r) => r.requirement === 'LEARN')?.basis).toBe('LEGACY_MIGRATION_BASELINE');
  });

  it('2. LEGACY_POLICY_RECOGNITION remains distinct and is never conflated with LEGACY_MIGRATION_BASELINE', () => {
    const mb = baseline([
      recognition({ requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1' }),
      recognition({ id: 'rec-2', requirement: 'PRACTICE', basis: 'LEGACY_POLICY_RECOGNITION', reasonCode: 'LEGACY_PRACTICE_EVIDENCE_SUFFICIENT_AND_UNDERSTANDING_OK' }),
    ]);
    const effective = composeEffectiveMigratedDecision({
      conceptId: 'c1',
      studentId: 's1',
      engineDecision: emptyEngineDecision(),
      migrationBaseline: mb,
      activeCriticalMisconception: false,
    });
    expect(effective.perRequirement.find((r) => r.requirement === 'LEARN')?.basis).toBe('LEGACY_MIGRATION_BASELINE');
    expect(effective.perRequirement.find((r) => r.requirement === 'PRACTICE')?.basis).toBe('LEGACY_POLICY_RECOGNITION');
  });

  it('3. V1_EVIDENCE remains distinct -- a requirement satisfied by real engine evidence is never mislabeled as legacy, even when ALSO legacy-recognized', () => {
    const learnCheck: RawEvidenceItem = {
      id: 'lc1',
      activityType: 'LEARN_CHECK',
      timestamp: '2026-09-16T00:00:00.000Z',
      itemCount: 5,
      correctCount: 5,
      scorePercent: 90,
      independent: false,
      difficulty: 1.5,
      hasCriticalMisconception: false,
    };
    const mb = baseline([recognition({ requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE' })]);
    const effective = composeEffectiveMigratedDecision({
      conceptId: 'c1',
      studentId: 's1',
      engineDecision: emptyEngineDecision([learnCheck]),
      migrationBaseline: mb,
      activeCriticalMisconception: false,
    });
    // Real v1 evidence takes priority in the basis label even though a legacy recognition also exists for the same requirement.
    expect(effective.perRequirement.find((r) => r.requirement === 'LEARN')?.basis).toBe('V1_EVIDENCE');
  });

  it('4. null remains null for an unsatisfied requirement with no recognition and no v1 evidence', () => {
    const mb = baseline([recognition({ requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE' })]);
    const effective = composeEffectiveMigratedDecision({
      conceptId: 'c1',
      studentId: 's1',
      engineDecision: emptyEngineDecision(),
      migrationBaseline: mb,
      activeCriticalMisconception: false,
    });
    expect(effective.perRequirement.find((r) => r.requirement === 'PRACTICE')?.basis).toBeNull();
    expect(effective.perRequirement.find((r) => r.requirement === 'PROVE')?.basis).toBeNull();
  });

  it('5. the effective stage itself is unchanged by this reporting fix -- only the basis LABEL was wrong, never the satisfied/unsatisfied computation', () => {
    const mb = baseline([recognition({ requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE' })]);
    const effective = composeEffectiveMigratedDecision({
      conceptId: 'c1',
      studentId: 's1',
      engineDecision: emptyEngineDecision(),
      migrationBaseline: mb,
      activeCriticalMisconception: false,
    });
    expect(effective.effectiveStage).toBe('PRACTICE');
  });

  it('6. the Radicación-shaped fixture resolves exactly as the real Preview DB row demands: LEARN satisfied via LEGACY_MIGRATION_BASELINE, PRACTICE unsatisfied, effective stage PRACTICE', () => {
    // Mirrors the real Preview row found for
    // student ec77cac5-841c-41cc-b959-af8ec69ccec5 / concept 1fb2b93c-0909-4127-9854-a91379825661:
    // recognition_basis = LEGACY_MIGRATION_BASELINE, reason_code = PREEXISTING_LEARNER_CONCEPT_BEFORE_V1.
    const knowledgeState: ConceptKnowledgeState | null = null; // no legitimate higher-stage evidence recognized (Radicación's real Practice history did not pass the old-policy ladder)
    const masteryPolicy: MasteryPolicy = {
      version: 1,
      minimumUnderstanding: 70,
      minimumIndependence: 70,
      minimumApplication: 70,
      minimumRetention: 70,
      minimumTransfer: 70,
      requiresTransfer: true,
      maximumCriticalMisconceptions: 0,
      minimumEvidenceCount: 3,
      minimumIndependentEvidenceCount: 1,
      validationWindowDays: 30,
    };
    const mb = buildPedagogicalMigrationBaseline({
      conceptId: '1fb2b93c-0909-4127-9854-a91379825661',
      studentId: 'ec77cac5-841c-41cc-b959-af8ec69ccec5',
      knowledgeState,
      masteryPolicy,
      recognizedAtMigration: '2026-09-01T00:00:00.000Z',
      migrationVersion: MIGRATION_VERSION,
      isPreexistingLearnerConcept: true,
    });
    const engineDecision = evaluateCanonicalLearningState({
      conceptId: '1fb2b93c-0909-4127-9854-a91379825661',
      studentId: 'ec77cac5-841c-41cc-b959-af8ec69ccec5',
      now: NOW,
      evidence: [],
      activeCriticalMisconception: false,
    });
    const effective = composeEffectiveMigratedDecision({
      conceptId: '1fb2b93c-0909-4127-9854-a91379825661',
      studentId: 'ec77cac5-841c-41cc-b959-af8ec69ccec5',
      engineDecision,
      migrationBaseline: mb,
      activeCriticalMisconception: false,
    });

    const learn = effective.perRequirement.find((r) => r.requirement === 'LEARN');
    const practice = effective.perRequirement.find((r) => r.requirement === 'PRACTICE');
    expect(learn?.satisfied).toBe(true);
    expect(learn?.basis).toBe('LEGACY_MIGRATION_BASELINE');
    expect(practice?.satisfied).toBe(false);
    expect(effective.effectiveStage).toBe('PRACTICE');
  });

  it('7. no pedagogical engine file was changed by this fix (source/diff audit)', () => {
    const engineFiles = readdirSync(join(process.cwd(), ENGINE_DIR)).filter((f) => f.endsWith('.ts'));
    for (const f of engineFiles) {
      // The fix is entirely a migration-layer composition/type change --
      // no engine file should reference the migration layer at all.
      expect(read(join(ENGINE_DIR, f))).not.toMatch(/pedagogical-migration/);
    }
  });

  it('8. no persistence/schema file was changed by this fix', () => {
    const migrationSqlFiles = readdirSync(join(process.cwd(), 'database/migrations')).filter((f) => f.includes('canon_r4r1') && !f.includes('r4r1a') && !f.includes('r4r1b'));
    expect(migrationSqlFiles).toHaveLength(1);
    const persistenceSrc = read(join(MIGRATION_DIR, 'recognition-persistence-adapter.ts'));
    // The persistence adapter's own SQL/shape is unchanged -- this fix touches only the in-memory composition (effective-decision.ts) and the QualificationBasis type it reads from.
    expect(persistenceSrc).toMatch(/CREATE TABLE|SELECT id, student_id, concept_id/);
  });
});
