/**
 * F11-C2 -- source guards for the Skill Reinforcement invariants:
 * (1) zero direct learning_evidence/learner_skill_state/
 *     learner_competency_state/mastery_records/Canonical writes anywhere
 *     in the orchestration service;
 * (2) explicit Skill targeting is threaded through storeQuiz's
 *     targetSkillIds parameter, never derived from graph traversal after
 *     the fact;
 * (3) the Concept path (startConceptReinforcementExecution) never passes
 *     skillIds to storeQuiz -- Concept-only execution never tags a Skill;
 * (4) metadata.competencyIds is never referenced anywhere in F11-C2 --
 *     Competency non-fabrication holds structurally, not defensively.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ORCHESTRATION_SERVICE = 'src/lib/student/teacher-intervention-execution.service.ts';
const QUIZ_PERSISTENCE_SERVICE = 'src/services/quiz-persistence.service.ts';
const GENERATE_AND_TAKE_ROUTE = 'src/app/api/quizzes/generate-and-take/route.ts';

describe('F11-C2 Skill Reinforcement never becomes a second learning-state authority', () => {
  it('required files exist', () => {
    for (const p of [ORCHESTRATION_SERVICE, QUIZ_PERSISTENCE_SERVICE, GENERATE_AND_TAKE_ROUTE]) {
      expect(existsSync(join(process.cwd(), p)), `${p} should exist`).toBe(true);
    }
  });

  it('the orchestration service contains zero direct writes to learning_evidence, mastery_records, learner_skill_state, learner_competency_state, or any Canonical V2 table', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    expect(src).not.toMatch(/INSERT INTO learning_evidence|UPDATE learning_evidence/);
    expect(src).not.toMatch(/INSERT INTO mastery_records|UPDATE mastery_records/);
    expect(src).not.toMatch(/INSERT INTO learner_skill_state|UPDATE learner_skill_state/);
    expect(src).not.toMatch(/INSERT INTO learner_competency_state|UPDATE learner_competency_state/);
    expect(src).not.toMatch(/pedagogical_requirement_recognition|canonical_prepared_activity|concept_transfer_state|concept_knowledge_state/);
    expect(src).not.toMatch(/\bupdateMastery\(/);
  });

  it('the orchestration service never references metadata.competencyIds -- Competency non-fabrication holds structurally', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    expect(src).not.toMatch(/competencyIds/);
  });

  it('the Skill target flows through storeQuiz\'s explicit targetSkillIds parameter, never via graph traversal after generation', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('export async function startSkillReinforcementExecution');
    const body = src.slice(start, start + 4000);
    expect(body).toMatch(/storeQuiz\([\s\S]*?\[claimed\.skillId\]/);
  });

  it("the Concept path (startConceptReinforcementExecution) never passes skillIds to storeQuiz -- Concept-only execution never tags a Skill", () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('export async function startConceptReinforcementExecution');
    const end = src.indexOf('export async function', start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    const storeQuizCall = body.match(/storeQuiz\(([\s\S]*?)\);/);
    expect(storeQuizCall).not.toBeNull();
    expect(storeQuizCall![1]).not.toMatch(/skillId/i);
  });

  it('Skill resolution is deterministic: exactly one candidate resolves, or the function fails controlled (null/AMBIGUOUS), never an arbitrary pick', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('async function resolveDeterministicConceptForSkill');
    const body = src.slice(start, start + 1200);
    expect(body).toMatch(/resolved\.size === 0/);
    expect(body).toMatch(/resolved\.size > 1/);
    expect(body).toMatch(/'AMBIGUOUS'/);
  });

  it('quiz-persistence.service.ts\'s new targetSkillIds parameter is optional and defaults to no behavior change', () => {
    const src = readFileSync(join(process.cwd(), QUIZ_PERSISTENCE_SERVICE), 'utf-8');
    expect(src).toMatch(/targetSkillIds\?:\s*string\[\]\s*\|\s*null/);
  });

  it('generate-and-take\'s new skillIds metadata line is conditional on quizSession.targetSkillIds -- never unconditional, never graph-derived', () => {
    const src = readFileSync(join(process.cwd(), GENERATE_AND_TAKE_ROUTE), 'utf-8');
    expect(src).toMatch(/quizSession\.targetSkillIds[\s\S]{0,80}\{\s*skillIds:\s*quizSession\.targetSkillIds\s*\}/);
    expect(src).not.toMatch(/canonical_concept_skills/);
  });
});
