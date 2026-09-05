import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

const PHASE_3D_SERVICE_FILES = [
  'src/lib/learning-execution-policy.ts',
  'src/services/learning-execution-scheduler.service.ts',
  'src/services/learning-session-engine.service.ts',
  'src/services/next-best-action-v3.service.ts',
];

describe('35. No Phase 3D service imports nbaPriority for decision-making', () => {
  it('none of the Phase 3D files reference nbaPriority at all', () => {
    for (const file of PHASE_3D_SERVICE_FILES) {
      expect(read(file)).not.toMatch(/nbaPriority/);
    }
  });
});

describe('36. No Phase 3D service imports calculateConceptPriority', () => {
  it('none of the Phase 3D files reference calculateConceptPriority or getStudentStudyPriorities', () => {
    for (const file of PHASE_3D_SERVICE_FILES) {
      expect(read(file)).not.toMatch(/calculateConceptPriority|getStudentStudyPriorities|getRankedConceptsByPriority/);
    }
  });
});

describe('37. NBA v3 priority originates from LearningDecision', () => {
  it('next-best-action-v3.service.ts imports LearningDecision-shaped fields from the scheduler/session engine, not a re-derivation', () => {
    const source = read('src/services/next-best-action-v3.service.ts');
    expect(source).toMatch(/pedagogicalPriority: decision\.pedagogicalPriority/);
    expect(source).toMatch(/temporalUrgency: decision\.temporalUrgency/);
    expect(source).not.toMatch(/pedagogicalPriority\s*=\s*['"](CRITICAL|HIGH|MEDIUM|LOW)['"]/); // never a hardcoded/re-decided value
  });
});

describe('38. learning-scheduler.service.ts remains time-source only', () => {
  it('no Phase 3D vocabulary leaked into the Phase 3 Pre-flight Scheduling Clock', () => {
    const source = read('src/services/learning-scheduler.service.ts');
    expect(source).not.toMatch(/priorityScore|pedagogicalPriority|rankLearningDecisions|LearningDecision|DailyLearningPlan|startLearningSession/);
  });
});

describe('39. adaptive-learning-policy.ts remains the sole Phase 3C priority authority', () => {
  it('the priority BAND table and dominantSignal/rankLearningDecisions exist only in adaptive-learning-policy.ts, never duplicated in any Phase 3D file', () => {
    const authority = read('src/lib/adaptive-learning-policy.ts');
    expect(authority).toMatch(/const BAND = \{/);
    expect(authority).toMatch(/export function dominantSignal/);
    expect(authority).toMatch(/export function rankLearningDecisions/);

    for (const file of PHASE_3D_SERVICE_FILES) {
      const source = read(file);
      expect(source).not.toMatch(/const BAND\s*=/);
      expect(source).not.toMatch(/function dominantSignal/);
      expect(source).not.toMatch(/function rankLearningDecisions/);
    }
  });
});

describe('40. Study Plan / Today are not migrated in this phase -- no copied Phase 3C policy exists in their files', () => {
  it('study-plan.service.ts contains no copy of Phase 3C\'s BAND table or dominant-signal logic (today-plan.service.ts has zero production callers -- confirmed in Steps 6J-B2/6J-C -- but is retained as a manual regression/E2E fixture for scripts/e2e-cognitive-loop.ts, not deleted)', () => {
    for (const file of ['src/services/study-plan.service.ts']) {
      const source = read(file);
      expect(source).not.toMatch(/const BAND\s*=/);
      expect(source).not.toMatch(/function dominantSignal/);
      expect(source).not.toMatch(/ACTIVE_ESCALATION|PREREQUISITE_GAP:\s*80|DIAGNOSTIC_EVIDENCE/);
    }
  });
});

describe('No LLM dependency anywhere in Phase 3D', () => {
  it('none of the Phase 3D files import an AI client or generation function', () => {
    for (const file of PHASE_3D_SERVICE_FILES) {
      expect(read(file)).not.toMatch(/openai|anthropic|generateText|generateObject/i);
    }
  });
});

describe('No second Knowledge State writer in Phase 3D', () => {
  it('none of the Phase 3D files write concept_knowledge_state or call the projector', () => {
    for (const file of PHASE_3D_SERVICE_FILES) {
      const source = read(file);
      expect(source).not.toMatch(/INSERT INTO concept_knowledge_state|UPDATE concept_knowledge_state/i);
      expect(source).not.toMatch(/recalculateConceptKnowledgeState/);
    }
  });
});

describe('EvidenceMode mapping is reused, never duplicated', () => {
  it('only learning-session-engine.service.ts calls evidenceModeForActivity, and no file redefines the ActivityType->EvidenceMode table', () => {
    const sessionEngine = read('src/services/learning-session-engine.service.ts');
    expect(sessionEngine).toMatch(/evidenceModeForActivity/);
    for (const file of PHASE_3D_SERVICE_FILES) {
      const source = read(file);
      expect(source).not.toMatch(/EVIDENCE_MODE_BY_ACTIVITY/);
    }
  });
});
