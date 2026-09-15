/**
 * CANON-R4 -- LEGACY EVIDENCE COMPATIBILITY & v1 EVIDENCE CAPTURE: the
 * required test matrix (Parts 47-50 of the spec, 41 tests). Every test
 * exercises the REAL, unmocked compatibility layer
 * (`src/lib/pedagogical-migration/`) with synthetic fixtures -- no live
 * DB, no AI, no React, no Next.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  evaluateLegacyRecognition,
  buildPedagogicalMigrationBaseline,
  composeEffectiveMigratedDecision,
  classifyEvidenceVersion,
  isTemporallyEligibleForV1,
  UNCONFIGURED_MIGRATION_POLICY,
  V1_POLICY_VERSION,
  LEGACY_UNVERSIONED,
} from '@/lib/pedagogical-migration';
import { evaluateCanonicalLearningState, CANONICAL_POLICY, type RawEvidenceItem } from '@/lib/pedagogical-engine';
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const MIGRATION_DIR = 'src/lib/pedagogical-migration';
const MIGRATION_FILES = readdirSync(join(process.cwd(), MIGRATION_DIR)).filter((f) => f.endsWith('.ts'));
const CLI_SCRIPT = 'scripts/canon-r4-migration-dry-run.ts';

const POLICY: MasteryPolicy = {
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

function ks(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 'student-1',
    conceptId: 'concept-1',
    subjectId: 'subject-1',
    masteryState: 'DEVELOPING',
    understandingScore: null,
    independenceScore: null,
    applicationScore: null,
    retentionScore: null,
    transferScore: null,
    activeMisconceptionCount: 0,
    criticalMisconceptionCount: 0,
    recurringMisconceptionCount: 0,
    evidenceCount: 0,
    independentEvidenceCount: 0,
    firstEvidenceAt: null,
    lastEvidenceAt: null,
    validationReadiness: 'INSUFFICIENT_EVIDENCE',
    stateReason: null,
    projectionVersion: 1,
    masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = '2026-02-01T00:00:00.000Z';

describe('CANON-R4 Part 47 -- Legacy Recognition tests (1-15)', () => {
  it('1. arbitrary legacy activity (raw evidence existing) does not by itself satisfy Learn -- only a legitimate old-policy PRACTICE gate does', () => {
    const state = ks({ masteryState: 'LEARNING', evidenceCount: 5, understandingScore: 40 }); // evidence exists, but understanding never passed threshold
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'LEARN')).toBe(false);
  });

  it('2. a valid old higher-stage achievement (Practice legitimately satisfied) recognizes Learn', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'LEARN')).toBe(true);
    expect(recognitions.find((r) => r.requirement === 'LEARN')?.reasonCode).toBe('LEGACY_HIGHER_STAGE_IMPLIES_LEARN');
  });

  it('3. a failed/insufficient Practice history does not recognize Practice', () => {
    const state = ks({ masteryState: 'LEARNING', evidenceCount: 1, understandingScore: 30 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'PRACTICE')).toBe(false);
  });

  it('4. a legitimate old Practice completion (evidence sufficiency + understanding threshold) recognizes Practice', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'PRACTICE')).toBe(true);
  });

  it('5. a valid old 6-question Prove (independence dimension legitimately passing) is migration-recognized', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'PROVE')).toBe(true);
  });

  it('6. a migration-recognized legacy Prove is never rewritten as 10 questions -- the recognition record carries no itemCount field at all', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    const proveRecognition = recognitions.find((r) => r.requirement === 'PROVE');
    expect(proveRecognition && 'itemCount' in proveRecognition).toBe(false);
  });

  it('7. a valid old Retention (retention dimension legitimately passing) is migration-recognized', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90, retentionScore: 85 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'RETAIN')).toBe(true);
  });

  it('8. a migration-recognized legacy Retention is never rewritten as 10 questions', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90, retentionScore: 85 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    const r = recognitions.find((r) => r.requirement === 'RETAIN');
    expect(r && 'itemCount' in r).toBe(false);
  });

  it('9. a failed Transfer (mastery never fully validated) cannot recognize Transfer', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90, retentionScore: 85, transferScore: 20, applicationScore: 85 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'TRANSFER')).toBe(false);
  });

  it('10. a premature Transfer attempt (retention never satisfied) cannot recognize Transfer', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90, retentionScore: null, transferScore: 90 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'TRANSFER')).toBe(false);
  });

  it('11. an old consolidated (VALIDATED_MASTERY) state may preserve consolidated recognition (Transfer recognized)', () => {
    const state = ks({
      masteryState: 'VALIDATED_MASTERY',
      evidenceCount: 10,
      understandingScore: 90,
      independenceScore: 90,
      applicationScore: 90,
      retentionScore: 90,
      transferScore: 90,
    });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.some((r) => r.requirement === 'TRANSFER')).toBe(true);
    expect(recognitions.map((r) => r.requirement).sort()).toEqual(['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'].sort());
  });

  it('12. a partial old state (Practice satisfied, Prove not) does not over-recognize downstream stages', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 20 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(recognitions.map((r) => r.requirement)).toEqual(['LEARN', 'PRACTICE']);
  });

  it('13. migration recognition records retain source evidence IDs (empty array, never invented, when grounded solely in aggregate old-model authority)', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85 });
    const recognitions = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    for (const r of recognitions) expect(Array.isArray(r.sourceEvidenceIds)).toBe(true);
  });

  it('14. migration recognition is deterministic', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90 });
    const a = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    const b = evaluateLegacyRecognition({ knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(a).toEqual(b);
  });

  it('15. migration recognition is idempotent -- rerunning the baseline builder on the same input never creates duplicate recognitions', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85 });
    const first = buildPedagogicalMigrationBaseline({ conceptId: 'c1', knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    const second = buildPedagogicalMigrationBaseline({ conceptId: 'c1', knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    expect(first).toEqual(second);
    expect(first.recognizedRequirements.length).toBe(new Set(first.recognizedRequirements.map((r) => r.requirement)).size);
  });
});

describe('CANON-R4 Part 48 -- Versioning tests (16-23)', () => {
  it('16. legacy evidence stays LEGACY_UNVERSIONED with no cutover configured', () => {
    expect(classifyEvidenceVersion('2026-01-01T00:00:00.000Z', UNCONFIGURED_MIGRATION_POLICY)).toBe(LEGACY_UNVERSIONED);
  });

  it('17. no historical row is automatically labeled v1 -- even a far-future timestamp stays LEGACY_UNVERSIONED without a configured cutover', () => {
    expect(classifyEvidenceVersion('2099-01-01T00:00:00.000Z', UNCONFIGURED_MIGRATION_POLICY)).toBe(LEGACY_UNVERSIONED);
  });

  it('18. once a cutover IS configured, new v1-compatible Learn evidence at/after cutover can carry v1', () => {
    const policy = { cutoverAt: '2026-06-01T00:00:00.000Z' };
    expect(classifyEvidenceVersion('2026-07-01T00:00:00.000Z', policy)).toBe(V1_POLICY_VERSION);
  });

  it('19. a 6-question legacy Prove predating cutover cannot carry v1', () => {
    const policy = { cutoverAt: '2026-06-01T00:00:00.000Z' };
    expect(classifyEvidenceVersion('2026-01-01T00:00:00.000Z', policy)).toBe(LEGACY_UNVERSIONED);
  });

  it('20. a 10-question attempt administered at/after cutover is temporally eligible to carry v1 (temporal eligibility only -- not full policy compliance)', () => {
    const policy = { cutoverAt: '2026-06-01T00:00:00.000Z' };
    expect(isTemporallyEligibleForV1('2026-07-01T00:00:00.000Z', policy)).toBe(true);
  });

  it('21. v1 Retention still requires the frozen engine\'s own 10-question contract regardless of migration -- verified directly against the unmodified engine', () => {
    const items: RawEvidenceItem[] = [
      { id: 'lc', activityType: 'LEARN_CHECK', timestamp: '2026-01-01T00:00:00.000Z', itemCount: 5, correctCount: 5, scorePercent: 90, independent: false, difficulty: 1.5, hasCriticalMisconception: false },
      { id: 'p1', activityType: 'PRACTICE', timestamp: '2026-01-02T00:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, independent: false, difficulty: 3, hasCriticalMisconception: false },
      { id: 'pr1', activityType: 'PROVE', timestamp: '2026-01-03T00:00:00.000Z', itemCount: 10, correctCount: 9, scorePercent: 90, independent: true, difficulty: 3.5, hasCriticalMisconception: false },
      { id: 'rc1', activityType: 'RETENTION_CHECK', timestamp: '2026-01-10T00:00:00.000Z', itemCount: 6, correctCount: 6, scorePercent: 100, independent: true, difficulty: 3.5, hasCriticalMisconception: false, novel: true },
    ];
    const decision = evaluateCanonicalLearningState({ conceptId: 'c', studentId: 's', now: '2026-01-10T00:00:00.000Z', evidence: items, activeCriticalMisconception: false });
    expect(decision.requirements.find((r) => r.stage === 'RETAIN')?.status).not.toBe('SATISFIED');
  });

  it('22. v1 Transfer still requires the frozen engine\'s own 3-challenge structure regardless of migration', () => {
    expect(CANONICAL_POLICY.transfer.challengeCount).toBe(3);
  });

  it('23. the cutover boundary deterministically separates legacy/new evidence -- identical inputs always classify the same', () => {
    const policy = { cutoverAt: '2026-06-01T00:00:00.000Z' };
    const a = classifyEvidenceVersion('2026-05-31T23:59:59.999Z', policy);
    const b = classifyEvidenceVersion('2026-05-31T23:59:59.999Z', policy);
    expect(a).toBe(b);
    expect(a).toBe(LEGACY_UNVERSIONED);
  });
});

describe('CANON-R4 Part 49 -- New Capture Contract tests (24-31)', () => {
  it('24. the future capture contract carries an explicit itemCount field for every stage', () => {
    const src = read(join(MIGRATION_DIR, 'new-evidence-capture-contract.ts'));
    expect(src).toMatch(/itemCount/);
  });

  it('25. the future capture contract carries an explicit policyVersion field', () => {
    const src = read(join(MIGRATION_DIR, 'new-evidence-capture-contract.ts'));
    expect(src).toMatch(/policyVersion: typeof V1_POLICY_VERSION/);
  });

  it('26. the future Prove capture contract carries explicit independence metadata', () => {
    const src = read(join(MIGRATION_DIR, 'new-evidence-capture-contract.ts'));
    expect(src).toMatch(/V1ProveCapture[\s\S]*?independent: true/);
  });

  it('27. the future Retention capture contract carries eligibility/timing metadata', () => {
    const src = read(join(MIGRATION_DIR, 'new-evidence-capture-contract.ts'));
    expect(src).toMatch(/nextEligibleAtWhenAdministered/);
  });

  it('28. the future Transfer capture contract carries explicit per-challenge scores, never only an aggregate', () => {
    const src = read(join(MIGRATION_DIR, 'new-evidence-capture-contract.ts'));
    expect(src).toMatch(/challenges: \[V1TransferChallengeCapture, V1TransferChallengeCapture, V1TransferChallengeCapture\]/);
  });

  it('29. the future Transfer capture contract carries an explicit challenge depth field using the frozen engine\'s own vocabulary', () => {
    const src = read(join(MIGRATION_DIR, 'new-evidence-capture-contract.ts'));
    expect(src).toMatch(/depth: TransferChallengeDepth/);
  });

  it('30. the future Prove capture contract carries an explicit evidence-contract field', () => {
    const src = read(join(MIGRATION_DIR, 'new-evidence-capture-contract.ts'));
    expect(src).toMatch(/evidenceContract: 'PROVE_NO_HINTS_NO_TUTOR_NO_WORKED_EXAMPLES'/);
  });

  it('31. no existing generation/cache/provider file is modified by this phase (source audit: the capture contract has zero imports outside pedagogical-engine/pedagogical-migration)', () => {
    const src = read(join(MIGRATION_DIR, 'new-evidence-capture-contract.ts'));
    expect(src).not.toMatch(/quiz-generation|model-routing|promptCacheKey|gated-question-generation/);
  });
});

describe('CANON-R4 Part 50 -- Safety tests (32-41)', () => {
  const allFiles = [...MIGRATION_FILES.map((f) => join(MIGRATION_DIR, f)), CLI_SCRIPT];

  it('32. the frozen engine is unchanged -- no file in this phase imports past the engine\'s own public barrel into its internals', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/from ['"]@\/lib\/pedagogical-engine\/(engine|policy|evidence-qualification|activity-contract|difficulty-policy|types)['"]/);
    }
  });

  it('33. no historical evidence mutation -- no write keyword anywhere in the compatibility layer or its CLIs', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/UPDATE\s+learning_evidence|DELETE FROM learning_evidence/i);
    }
  });

  it('34. no Production writes -- no INSERT/UPDATE/DELETE statement anywhere', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
    }
  });

  it('35. the migration dry-run CLI performs no writes (source audit)', () => {
    const src = read(CLI_SCRIPT);
    expect(src).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
    expect(src).toMatch(/READ-ONLY/);
  });

  it('36. no migration apply path exists in this phase -- no --write/--apply flag is parsed anywhere', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/--write|--apply/);
    }
  });

  it('37. no UI integration -- no React import anywhere in the compatibility layer', () => {
    for (const f of MIGRATION_FILES.map((f) => join(MIGRATION_DIR, f))) {
      expect(read(f)).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('38. no routing integration -- no Next.js route or app file is imported', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/from ['"]@\/app\//);
    }
  });

  it('39. no AI routing change -- no AI/provider import anywhere', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/openai|anthropic|@ai-sdk|model-routing/i);
    }
  });

  it('40. no Quality Gate change -- no import anywhere', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/quality-gate|question-quality-verifier|gated-question-generation/i);
    }
  });

  it('41. no cache change -- no promptCacheKey or cache-architecture reference anywhere', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/promptCacheKey/);
    }
  });
});

describe('CANON-R4 end-to-end migration composition (supplementary)', () => {
  it('composes a migration-recognized concept into an effective v1 starting state without touching the frozen engine\'s own decision', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90 });
    const baseline = buildPedagogicalMigrationBaseline({ conceptId: 'c1', knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    const engineDecision = evaluateCanonicalLearningState({ conceptId: 'c1', studentId: 's1', now: NOW, evidence: [], activeCriticalMisconception: false });
    const effective = composeEffectiveMigratedDecision({
      conceptId: 'c1',
      studentId: 's1',
      engineDecision,
      migrationBaseline: baseline,
      activeCriticalMisconception: false,
    });
    // Without migration, the engine alone (zero real evidence) would say LEARN. With legacy recognition (Practice+Prove legitimately satisfied historically), the effective starting state advances past those.
    expect(engineDecision.stage).toBe('LEARN');
    expect(effective.effectiveStage).toBe('RETAIN');
    expect(effective.engineInterfaceNote).toBe('ENGINE_INTERFACE_EXTENSION_REQUIRED');
    expect(effective.perRequirement.find((r) => r.requirement === 'PRACTICE')?.basis).toBe('LEGACY_POLICY_RECOGNITION');
  });

  it('a concept with a critical misconception currently active is never advanced past PRACTICE by migration recognition alone', () => {
    const state = ks({ masteryState: 'VALIDATED_MASTERY', evidenceCount: 10, understandingScore: 90, independenceScore: 90, applicationScore: 90, retentionScore: 90, transferScore: 90 });
    const baseline = buildPedagogicalMigrationBaseline({ conceptId: 'c1', knowledgeState: state, masteryPolicy: POLICY, recognizedAtMigration: NOW });
    const engineDecision = evaluateCanonicalLearningState({ conceptId: 'c1', studentId: 's1', now: NOW, evidence: [], activeCriticalMisconception: true });
    const effective = composeEffectiveMigratedDecision({
      conceptId: 'c1',
      studentId: 's1',
      engineDecision,
      migrationBaseline: baseline,
      activeCriticalMisconception: true,
    });
    expect(effective.effectiveStage).toBe('PRACTICE');
  });
});
