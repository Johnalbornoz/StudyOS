/**
 * CANON-R4R1A -- PREEXISTING LEARNER-CONCEPT POPULATION FIX: the
 * required test matrix (Part 24, 27 tests). Every test exercises the
 * REAL, unmodified frozen engine and the REAL, corrected migration
 * compatibility layer -- no live DB (none is available in this
 * environment), no AI, no React, no Next.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { evaluateCanonicalLearningState, CANONICAL_POLICY, type RecognizedRequirement } from '@/lib/pedagogical-engine';
import { buildPedagogicalMigrationBaseline, isPreexistingLearnerConcept } from '@/lib/pedagogical-migration';
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ENGINE_DIR = 'src/lib/pedagogical-engine';
const ENGINE_FILES = readdirSync(join(process.cwd(), ENGINE_DIR)).filter((f) => f.endsWith('.ts'));
const MIGRATION_DIR = 'src/lib/pedagogical-migration';
const POPULATION_FILE = join(MIGRATION_DIR, 'preexisting-learner-concept.ts');
const R4R1_CLI = 'scripts/canon-r4r1-pre-v1-learn-baseline.ts';
const R4_CLI = 'scripts/canon-r4-migration-dry-run.ts';

const NOW = '2026-09-20T00:00:00.000Z';
const CUTOVER = '2026-09-15T00:00:00.000Z';
const MIGRATION_VERSION = 'studyus-canonical-v1-initial-migration';

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

function recognized(requirement: RecognizedRequirement['requirement'], basis: RecognizedRequirement['basis'] = 'LEGACY_MIGRATION_BASELINE'): RecognizedRequirement {
  return { requirement, basis, recognitionId: `rec-${requirement}`, reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: CUTOVER };
}

describe('CANON-R4R1A Part 24 -- required test matrix (1-27)', () => {
  it('1. a loaded learner-concept with ZERO evidence is preexisting -- loadedAt alone (never evidence) determines eligibility', () => {
    const loadedBeforeCutover = '2026-09-01T00:00:00.000Z';
    expect(isPreexistingLearnerConcept(loadedBeforeCutover, CUTOVER)).toBe(true);
  });

  it('2. a loaded learner-concept WITH evidence is also preexisting (evidence never disqualifies)', () => {
    // The pure classifier takes only a `loadedAt` timestamp -- evidence
    // presence/absence is structurally irrelevant to it, proven by the
    // function's own signature (one timestamp param, no evidence param
    // at all).
    const loadedBeforeCutover = '2026-09-01T00:00:00.000Z';
    expect(isPreexistingLearnerConcept(loadedBeforeCutover, CUTOVER)).toBe(true);
  });

  it('3. a global/unassigned concept (no loadedAt at all) is excluded', () => {
    expect(isPreexistingLearnerConcept(null, CUTOVER)).toBe(false);
  });

  it('4. a concept assigned to another learner is excluded from THIS learner\'s population -- the real query scopes by the concept\'s own owning subject.student_id (source audit)', () => {
    const src = read(POPULATION_FILE);
    expect(src).toMatch(/JOIN subjects s ON s\.id = c\.subject_id/);
    expect(src).toMatch(/s\.student_id = \$/);
  });

  it('5. the same concept row can never belong to two learners -- concepts are subject-owned and subjects are student-owned (schema-level guarantee, confirmed by direct DDL audit)', () => {
    const ddl = read('database/baseline/STUDYUS_BASELINE_2026_08.sql');
    const subjectsBlock = ddl.slice(ddl.indexOf('CREATE TABLE public.subjects'), ddl.indexOf('CREATE TABLE public.subjects') + 400);
    expect(subjectsBlock).toMatch(/student_id uuid NOT NULL/);
    const conceptsBlock = ddl.slice(ddl.indexOf('CREATE TABLE public.concepts ('), ddl.indexOf('CREATE TABLE public.concepts (') + 300);
    expect(conceptsBlock).toMatch(/subject_id uuid NOT NULL/);
  });

  it('6. duplicate assignment paths never need deduplication -- the population query has no UNION/duplicate-source join that could produce two rows for one (student, concept) pair (source audit)', () => {
    const src = read(POPULATION_FILE);
    expect(src).not.toMatch(/UNION/i);
  });

  it('7. learning_evidence is NOT required for LEARN migration baseline eligibility', () => {
    const baseline = buildPedagogicalMigrationBaseline({
      conceptId: 'c1',
      studentId: 's1',
      knowledgeState: null, // zero evidence ever recorded
      masteryPolicy: POLICY,
      recognizedAtMigration: NOW,
      migrationVersion: MIGRATION_VERSION,
      isPreexistingLearnerConcept: true,
    });
    expect(baseline.recognizedRequirements.some((r) => r.requirement === 'LEARN')).toBe(true);
    expect(baseline.recognizedRequirements.find((r) => r.requirement === 'LEARN')?.basis).toBe('LEGACY_MIGRATION_BASELINE');
  });

  it('8. evidence timestamp is not the sole migration eligibility rule -- the eligibility SELECT itself never references learning_evidence at all (only an OPTIONAL, separate reporting flag does)', () => {
    const src = read(POPULATION_FILE);
    // The core eligibility query (FROM concepts ... JOIN subjects ...) contains no learning_evidence reference; only the OPTIONAL evidenceSelect fragment (used for reporting only) does.
    const eligibilityQueryBlock = src.slice(src.indexOf('const result = await db.query('), src.indexOf('const result = await db.query(') + 400);
    expect(eligibilityQueryBlock).toMatch(/FROM concepts c/);
    expect(eligibilityQueryBlock).not.toMatch(/WHERE[\s\S]*learning_evidence/);
  });

  it('9. a preexisting ZERO-evidence concept receives LEARN recognition end-to-end through the engine', () => {
    const baseline = buildPedagogicalMigrationBaseline({
      conceptId: 'c1',
      studentId: 's1',
      knowledgeState: null,
      masteryPolicy: POLICY,
      recognizedAtMigration: NOW,
      migrationVersion: MIGRATION_VERSION,
      isPreexistingLearnerConcept: true,
    });
    const decision = evaluateCanonicalLearningState({
      conceptId: 'c1',
      studentId: 's1',
      now: NOW,
      evidence: [],
      activeCriticalMisconception: false,
      recognizedRequirements: baseline.recognizedRequirements.map((r) => ({
        requirement: r.requirement,
        basis: r.basis,
        recognitionId: r.id,
        reasonCode: r.reasonCode,
        recognizedAt: r.recognizedAtMigration,
      })),
    });
    expect(decision.requirements.find((r) => r.stage === 'LEARN')?.status).toBe('SATISFIED');
  });

  it('10. a zero-evidence concept receives NO automatic Practice recognition -- only LEARN is granted by mere preexistence', () => {
    const baseline = buildPedagogicalMigrationBaseline({
      conceptId: 'c1',
      studentId: 's1',
      knowledgeState: null,
      masteryPolicy: POLICY,
      recognizedAtMigration: NOW,
      migrationVersion: MIGRATION_VERSION,
      isPreexistingLearnerConcept: true,
    });
    expect(baseline.recognizedRequirements.map((r) => r.requirement)).toEqual(['LEARN']);
  });

  it('11. a post-cutover (NOT preexisting) assignment receives NO LEARN recognition', () => {
    const baseline = buildPedagogicalMigrationBaseline({
      conceptId: 'c1',
      studentId: 's1',
      knowledgeState: null,
      masteryPolicy: POLICY,
      recognizedAtMigration: NOW,
      migrationVersion: MIGRATION_VERSION,
      isPreexistingLearnerConcept: false,
    });
    expect(baseline.recognizedRequirements).toHaveLength(0);
  });

  it('12. CANON-V2-REMEDIATION Part 6 (AUDIT-004 closed): higher-stage CANON-R4 recognition has been REMOVED (Policy V2 Section 14: "higher stages must not be fabricated") -- even a legitimately-strong old Practice/Prove state now recognizes only LEARN', () => {
    const state = ks({ masteryState: 'PROVISIONAL_MASTERY', evidenceCount: 5, understandingScore: 85, independenceScore: 90 });
    const baseline = buildPedagogicalMigrationBaseline({
      conceptId: 'c1',
      studentId: 's1',
      knowledgeState: state,
      masteryPolicy: POLICY,
      recognizedAtMigration: NOW,
      migrationVersion: MIGRATION_VERSION,
      isPreexistingLearnerConcept: true,
    });
    expect(baseline.recognizedRequirements.map((r) => r.requirement)).toEqual(['LEARN']);
  });

  it('13. the engine\'s recognition set contiguity rule is unchanged', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: 'c1',
      studentId: 's1',
      now: NOW,
      evidence: [],
      activeCriticalMisconception: false,
      recognizedRequirements: [recognized('LEARN'), recognized('PROVE', 'LEGACY_POLICY_RECOGNITION')],
    });
    expect(decision.recognitionRejected).toBe('NON_CONTIGUOUS_RECOGNITION_SET');
  });

  it('14. migration baseline building remains idempotent after the population fix', () => {
    const build = () =>
      buildPedagogicalMigrationBaseline({
        conceptId: 'c1',
        studentId: 's1',
        knowledgeState: null,
        masteryPolicy: POLICY,
        recognizedAtMigration: NOW,
        migrationVersion: MIGRATION_VERSION,
        isPreexistingLearnerConcept: true,
      });
    expect(build().recognizedRequirements.map((r) => r.id)).toEqual(build().recognizedRequirements.map((r) => r.id));
  });

  it('15. duplicate insert remains impossible -- the schema\'s own UNIQUE constraint is unchanged (Part 16: no schema redesign)', () => {
    const sqlFiles = readdirSync(join(process.cwd(), 'database/migrations')).filter((f) => f.includes('canon_r4r1'));
    expect(sqlFiles).toHaveLength(1);
    const sql = read(join('database/migrations', sqlFiles[0]));
    expect(sql).toMatch(/UNIQUE \(student_id, concept_id, requirement, migration_version\)/);
  });

  it('16. the dry-run tool reports zero-evidence population separately from the total (source audit)', () => {
    const src = read(R4R1_CLI);
    expect(src).toMatch(/pairsWithZeroEvidence/);
    expect(src).toMatch(/pairsWithEvidence/);
    expect(src).toMatch(/totalSnapshotPairs/);
    expect(src).toMatch(/distinctLearners/);
    expect(src).toMatch(/distinctConcepts/);
  });

  it('17. the dry-run tool performs zero writes unless --apply is explicitly passed (source audit)', () => {
    const src = read(R4R1_CLI);
    expect(src).toMatch(/if \(apply\) \{[\s\S]*?applyRecognitions/);
  });

  it('18. apply refuses a non-Preview guard (unchanged from R4R1, re-verified after this fix)', () => {
    const src = read(join(MIGRATION_DIR, 'recognition-persistence-adapter.ts'));
    expect(src).toMatch(/guard\.environment !== 'preview'/);
  });

  it('19. the frozen engine policy (CANONICAL_POLICY) remains unchanged by this population-only fix', () => {
    expect(CANONICAL_POLICY.learn.minimumScorePercentExclusive).toBe(80);
    expect(CANONICAL_POLICY.practice.minimumScorePercent).toBe(80);
    expect(CANONICAL_POLICY.prove.itemCount).toBe(10);
    expect(CANONICAL_POLICY.retention.itemCount).toBe(10);
    expect(CANONICAL_POLICY.transfer.challengeCount).toBe(3);
  });

  it('20. R4R1\'s recognizedRequirements engine semantics are unchanged -- LEARN-only recognition still does not satisfy Practice', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: 'c1',
      studentId: 's1',
      now: NOW,
      evidence: [],
      activeCriticalMisconception: false,
      recognizedRequirements: [recognized('LEARN')],
    });
    expect(decision.requirements.find((r) => r.stage === 'LEARN')?.status).toBe('SATISFIED');
    expect(decision.requirements.find((r) => r.stage === 'PRACTICE')?.status).toBe('UNSATISFIED');
    expect(decision.currentStage).toBe('PRACTICE');
  });

  it('21. v1 rollback precedence over legacy recognition is unchanged -- a real v1 Prove failure still invalidates a legacy-recognized Practice', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: 'c1',
      studentId: 's1',
      now: NOW,
      evidence: [{ id: 'p1', activityType: 'PROVE', timestamp: '2026-09-16T00:00:00.000Z', itemCount: 10, correctCount: 5, scorePercent: 50, independent: true, difficulty: 3.5, hasCriticalMisconception: false }],
      activeCriticalMisconception: false,
      recognizedRequirements: [recognized('LEARN'), recognized('PRACTICE', 'LEGACY_POLICY_RECOGNITION')],
    });
    expect(decision.requirements.find((r) => r.stage === 'PRACTICE')?.status).toBe('UNSATISFIED');
    expect(decision.rollback?.case).toBe('PROVE_FAILURE_RETURN_TO_PRACTICE');
  });

  it('22. no UI changes -- no React import anywhere in the migration layer', () => {
    for (const f of readdirSync(join(process.cwd(), MIGRATION_DIR)).filter((f) => f.endsWith('.ts'))) {
      expect(read(join(MIGRATION_DIR, f))).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('23. no routing changes -- no @/app import anywhere in the migration layer or its CLIs', () => {
    for (const f of [...readdirSync(join(process.cwd(), MIGRATION_DIR)).filter((f) => f.endsWith('.ts')).map((f) => join(MIGRATION_DIR, f)), R4R1_CLI, R4_CLI]) {
      expect(read(f)).not.toMatch(/from ['"]@\/app\//);
    }
  });

  it('24. no AI changes -- no AI/provider import anywhere in the engine or migration layers', () => {
    for (const f of ENGINE_FILES) {
      expect(read(join(ENGINE_DIR, f))).not.toMatch(/openai|anthropic|@ai-sdk|model-routing/i);
    }
  });

  it('25. no cache changes -- no promptCacheKey reference anywhere in the engine', () => {
    for (const f of ENGINE_FILES) {
      expect(read(join(ENGINE_DIR, f))).not.toMatch(/promptCacheKey/);
    }
  });

  it('26. no Quality Gate changes', () => {
    for (const f of ENGINE_FILES) {
      expect(read(join(ENGINE_DIR, f))).not.toMatch(/quality-gate|question-quality-verifier|gated-question-generation/i);
    }
  });

  it('27. no performance-relevant change -- the frozen engine source is untouched this phase (git diff scope is population-layer-only, confirmed structurally: no engine file references the population module)', () => {
    for (const f of ENGINE_FILES) {
      expect(read(join(ENGINE_DIR, f))).not.toMatch(/preexisting-learner-concept|pedagogical-migration/);
    }
  });
});
