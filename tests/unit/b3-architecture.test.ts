/**
 * B3 -- architecture boundaries: one evidence writer, existing projectors, server-side semantics, additive
 * persistence, no runtime cutover. Source-level guards over the block and the authorities it relies on.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const B3 = walk('src/lib/assessment-execution');
const PURE = B3.filter((f) => !f.endsWith('.service.ts'));
const SERVICE = 'src/lib/assessment-execution/assessment-execution.service.ts';
const MIGRATION = 'database/migrations/20261110_1000_assessment_snapshot.sql';

describe('B3 has no second evidence, mastery or state authority', () => {
  it('evidence is written only by calling updateMastery; B3 contains no SQL against evidence, mastery or state tables', () => {
    expect(B3.map((f) => f.replace('src/lib/assessment-execution/', '')).sort()).toEqual(['assessment-execution.service.ts', 'evidence-plan.ts', 'frozen-assessment.ts', 'index.ts', 'post-assessment.ts']);
    for (const f of B3) {
      const c = code(f);
      expect(c, f).not.toMatch(/learning_evidence|mastery_records|mastery_events|concept_knowledge_state|concept_memory_state|concept_transfer_state|learner_skill_state|learning_debt/);
      expect(c, f).not.toMatch(/\bINSERT\s+INTO\b|\bDELETE\s+FROM\b/i);
    }
    const service = code(SERVICE);
    expect(service).toMatch(/import \{ updateMastery as canonicalUpdateMastery/);
    expect(service.match(/deps\.updateMastery\(/g)).toHaveLength(1);
    // the only UPDATE in the block writes the snapshot column, once
    expect(service.match(/\bUPDATE\b[^`]*`?/g)!.length).toBe(1);
    expect(service).toMatch(/UPDATE \$\{table\} SET assessment_snapshot = \$2::jsonb WHERE id = \$1 AND student_id = \$3 AND assessment_snapshot IS NULL/);
  });

  it('no mastery threshold, state formula, spacing or transfer depth is computed in B3', () => {
    for (const f of B3) {
      const c = code(f);
      expect(c, f).not.toMatch(/nextReviewAt|next_review_at|forgetting|memoryStability|memory_stability|transferDepth|transfer_depth|masteryPolicy|minimumEvidenceCount|validation_readiness|calculateMastery|recalculateConceptKnowledgeState|projectConcept/);
      // B2's planning strength is never used as a multiplier
      expect(c, f).not.toMatch(/strength\s*[*]|[*]\s*\w*strength|confidenceWeight: (?!0\.9\b)/);
    }
    expect(code('src/lib/assessment-execution/evidence-plan.ts')).toMatch(/confidenceWeight: 0\.9/);
  });

  it('the pure contracts do no IO and read no clock, flag or randomness', () => {
    for (const f of PURE) expect(code(f), f).not.toMatch(/@\/lib\/db'|from '[^']*\.service'|process\.env|Date\.now|new Date\(|Math\.random|fetch\(/);
    for (const f of B3) expect(code(f), f).not.toMatch(/process\.env|EXAM_BLUEPRINT_V2|STUDENT_JOURNEY_V2|CANONICAL_ENGINE_V1|isCanonicalEngineV1Enabled/);
  });
});

describe('B3 relies on guarantees the canonical writer already gives', () => {
  const writer = read('src/services/mastery.service.ts');

  it('exactly-once is enforced by the database, not by a process-local lock', () => {
    const migration = read('database/migrations/20260901_1200_evidence_idempotency.sql');
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS learning_evidence_operation_key_unique_idx\s+ON learning_evidence \(operation_key\)\s+WHERE operation_key IS NOT NULL/);
    expect(writer).toMatch(/const operationKey = identity \? buildOperationKey\(identity\) : null/);
    expect(writer).toMatch(/isOperationKeyConflict\(err\)/);
    expect(writer).toMatch(/pgErr\?\.code === PG_UNIQUE_VIOLATION && pgErr\?\.constraint === OPERATION_KEY_CONSTRAINT/);
    // B3 reuses the two existing operation types; it adds none and never lets a caller name one
    const idem = read('src/lib/algorithms/evidence-idempotency.ts');
    for (const t of ['QUIZ_SUBMISSION', 'EXAM_SIMULATION_RESPONSE']) expect(idem).toContain(`'${t}'`);
    expect(code('src/lib/assessment-execution/evidence-plan.ts').match(/operationType: '([A-Z_]+)'/g)).toEqual(["operationType: 'QUIZ_SUBMISSION'", "operationType: 'EXAM_SIMULATION_RESPONSE'"]);
    expect(B3.some((f) => /EVIDENCE_OPERATION_TYPES|RECORD_EVIDENCE/.test(code(f)))).toBe(false);
  });

  it('the writer recalculates the Knowledge State and runs the memory and transfer projectors in its own transaction', () => {
    expect(writer).toMatch(/await recalculateConceptKnowledgeState\(studentId, conceptId, client\)/);
    expect(writer).toMatch(/await projectConceptMemoryState\(client, studentId, conceptId\)/);
    expect(writer).toMatch(/await projectConceptTransferState\(client, studentId, conceptId, learningEvidenceId\)/);
    expect(writer).toMatch(/metadata\?\.activityType === 'RETENTION_CHECK' \? memoryProjection\.stateChanged : undefined/);
  });

  it('the learning and exam evidence rules mirror the existing write sites exactly', () => {
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/conceptScore >= 70 \? 'correct' : conceptScore >= 50 \? 'partial' : 'incorrect'/);
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/confidenceWeight: 0\.9/);
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/identity: \{ operationType: 'QUIZ_SUBMISSION', operationId: validated\.quizId, conceptId \}/);
    expect(read('src/lib/simulation/scoring.service.ts')).toMatch(/sourceType: 'EXAM_SIMULATION', result: grade\.fraction >= 1 \? 'correct' : grade\.fraction > 0 \? 'partial' : 'incorrect'/);
    expect(read('src/lib/simulation/scoring.service.ts')).toMatch(/telemetry: \{ activityType: 'EXAM_SIMULATION', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' \}/);
    const plan = code('src/lib/assessment-execution/evidence-plan.ts');
    expect(plan).toMatch(/scorePercent >= 70 \? 'correct' : scorePercent >= 50 \? 'partial' : 'incorrect'/);
    expect(plan).toMatch(/fraction >= 1 \? 'correct' : fraction > 0 \? 'partial' : 'incorrect'/);
    expect(plan).toMatch(/aggregateEvidenceDifficulty\(difficulties\)/);
    expect(plan).toMatch(/examEvidenceScopeMetadata\(examScope!\)/);
  });
});

describe('B3 evidence semantics are server-controlled and framework-neutral', () => {
  it('no input of the loop carries a source type, an evidence mode, an activity type or an exam target', () => {
    const plan = read('src/lib/assessment-execution/evidence-plan.ts');
    const scoredResponse = /export interface ScoredResponse \{([\s\S]*?)\n\}/.exec(plan)![1];
    expect(scoredResponse).not.toMatch(/sourceType|evidenceMode|activityType|conceptId|examTarget|independent/);
    const service = read(SERVICE);
    const input = /export interface EvidenceLoopInput \{([\s\S]*?)\n\}/.exec(service)![1];
    expect(input).not.toMatch(/sourceType|evidenceMode|activityType|examTargetId|conceptId|contentAudience/);
    // the exam target is the attempt's own foreign key
    expect(code(SERVICE)).toMatch(/SELECT ea\.student_exam_profile_id FROM exam_instances ei JOIN simulation_attempts sa ON sa\.id = ei\.simulation_attempt_id JOIN exam_attempts ea ON ea\.id = sa\.exam_attempt_id WHERE ei\.id = \$1 AND ea\.id = \$2/);
    // the activity is bound from the existing registries
    for (const fn of ['resolveCanonicalImplementation', 'activityTypeForQuizMode', 'evidenceModeForQuizMode', 'QUIZ_MODE_CONFIG']) expect(code(SERVICE)).toContain(fn);
    // the legacy client-sourced route gains no new caller or authority here
    for (const f of B3) expect(code(f), f).not.toMatch(/record-evidence/);
  });

  it('no branch on a curriculum framework or an exam family decides evidence', () => {
    const terms = /\b(IB|IBO|IGCSE|CAMBRIDGE|SEP|MEN|PAA|SABER|ICFES|AICE|MCCEMS)\b/i;
    for (const f of B3) expect(code(f), f).not.toMatch(terms);
  });

  it('B3 never selects: it has no solver call and no bank or cache query', () => {
    for (const f of B3) {
      const c = code(f);
      expect(c, f).not.toMatch(/solveBlueprint|solveLearningBlueprint|solveExamPreparationBlueprint|solveOfficialBlueprint|eligibleSolverCandidates|assembleForm/);
      expect(c, f).not.toMatch(/approved_items|question_bank_candidates|question_bank_items/);
    }
    // the only thing imported from the Blueprint Core is the type of its result
    expect(B3.flatMap((f) => code(f).match(/^import[^;]*assessment-blueprint[^;]*;/gm) ?? [])).toEqual(["import type { BlueprintSolution } from '@/lib/assessment-blueprint/result';"]);
  });
});

describe('B3 persistence is one additive migration on existing records', () => {
  const sql = read(MIGRATION).replace(/^\s*--.*$/gm, '');

  it('adds one nullable JSONB column to quiz_sessions and to exam_instances, and nothing else', () => {
    expect(sql.match(/ALTER TABLE public\.(\w+) ADD COLUMN IF NOT EXISTS (\w+) (\w+);/g)).toEqual(['ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS assessment_snapshot jsonb;', 'ALTER TABLE public.exam_instances ADD COLUMN IF NOT EXISTS assessment_snapshot jsonb;']);
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE |NOT NULL|DEFAULT|ALTER COLUMN|RENAME/i);
    // the only DROP is the idempotent re-creation of its own two CHECK constraints
    expect(sql.match(/DROP CONSTRAINT IF EXISTS (\w+)/g)).toEqual(['DROP CONSTRAINT IF EXISTS quiz_sessions_assessment_snapshot_check', 'DROP CONSTRAINT IF EXISTS exam_instances_assessment_snapshot_check']);
    expect(sql.match(/CHECK \(assessment_snapshot IS NULL OR/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });

  it('is the only migration after B1, and the B1 migrations are untouched', () => {
    const migrations = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect(migrations).toHaveLength(72);
    expect(migrations.slice(-3)).toEqual(['20261108_1000_simulation_type_exam_practice.sql', '20261109_1000_simulation_type_challenge_reduced_mock.sql', '20261110_1000_assessment_snapshot.sql']);
    expect(read('database/migrations/20261109_1000_simulation_type_challenge_reduced_mock.sql')).toMatch(/'EXAM_CHALLENGE', 'REDUCED_MOCK'/);
  });

  it('no crosswalk between curricula, and the deferred institution link was not added', () => {
    const all = readdirSync(join(ROOT, 'database/migrations')).map((f) => read(`database/migrations/${f}`)).join('\n');
    expect(all).not.toMatch(/CREATE TABLE[^;]*(crosswalk|objective_objective|objective_equivalen|curriculum_alignment)/i);
    expect(all).not.toMatch(/teaching_structure_version_id/);
  });
});

describe('B3 is not cut over', () => {
  it('nothing in the delivered runtime imports the execution module', () => {
    const importers = walk('src').filter((f) => !f.startsWith('src/lib/assessment-execution/') && /from '[^']*assessment-execution[^']*'|import\('[^']*assessment-execution/.test(read(f)));
    // B4: the experience layer and its shared components read B3's result TYPES to present them (asserted
    // type-only below). No page, route or service under src/app imports the execution module.
    const presentation = (f: string) => f.startsWith('src/lib/assessment-experience/') || f.startsWith('src/components/assessment/');
    expect(importers.filter((f) => !presentation(f))).toEqual([]);
    for (const f of importers.filter(presentation)) expect((read(f).match(/^import [^;]*assessment-execution[^;]*;/gm) ?? []).every((line) => line.startsWith('import type ')), f).toBe(true);
  });

  it('the existing write sites are still the ones the runtime uses, and historical records read as before', () => {
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/await updateMastery\(\{/);
    expect(read('src/lib/simulation/scoring.service.ts')).toMatch(/await updateMastery\(\{/);
    // a record without a snapshot is refused by B3 and is otherwise untouched: the B1 projections still describe it
    expect(code(SERVICE)).toMatch(/if \(!row\.assessment_snapshot\) return \{ ok: false, reason: 'NO_SNAPSHOT' \}/);
    expect(read('src/lib/assessment-foundation/generated-assessment.ts')).toMatch(/export function snapshotFromQuizSession/);
    expect(read('src/lib/assessment-foundation/generated-assessment.ts')).toMatch(/export function snapshotFromExamInstance/);
  });
});
