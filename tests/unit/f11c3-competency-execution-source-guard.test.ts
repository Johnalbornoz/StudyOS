/**
 * F11-C3 -- source guards for the Competency Reinforcement invariants:
 * (1) zero direct learning_evidence/learner_skill_state/
 *     learner_competency_state/mastery_records/Canonical writes;
 * (2) explicit Competency targeting is threaded through storeQuiz's
 *     targetCompetencyIds parameter, never derived from graph traversal;
 * (3) the Competency path never sets targetSkillIds, and the Skill path
 *     never sets targetCompetencyIds -- the two tags remain structurally
 *     independent, never conflated;
 * (4) the Concept path never sets either tag;
 * (5) Competency resolution uses the DIRECT canonical_concept_competencies
 *     mapping, never routed through skill_competencies.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ORCHESTRATION_SERVICE = 'src/lib/student/teacher-intervention-execution.service.ts';
const QUIZ_PERSISTENCE_SERVICE = 'src/services/quiz-persistence.service.ts';
const GENERATE_AND_TAKE_ROUTE = 'src/app/api/quizzes/generate-and-take/route.ts';

describe('F11-C3 Competency Reinforcement never becomes a second learning-state authority', () => {
  it('required files exist', () => {
    for (const p of [ORCHESTRATION_SERVICE, QUIZ_PERSISTENCE_SERVICE, GENERATE_AND_TAKE_ROUTE]) {
      expect(existsSync(join(process.cwd(), p)), `${p} should exist`).toBe(true);
    }
  });

  it('the orchestration service still contains zero direct writes to learning_evidence, mastery_records, learner_skill_state, learner_competency_state, or any Canonical V2 table', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    expect(src).not.toMatch(/INSERT INTO learning_evidence|UPDATE learning_evidence/);
    expect(src).not.toMatch(/INSERT INTO mastery_records|UPDATE mastery_records/);
    expect(src).not.toMatch(/INSERT INTO learner_skill_state|UPDATE learner_skill_state/);
    expect(src).not.toMatch(/INSERT INTO learner_competency_state|UPDATE learner_competency_state/);
    expect(src).not.toMatch(/pedagogical_requirement_recognition|canonical_prepared_activity|concept_transfer_state|concept_knowledge_state/);
    expect(src).not.toMatch(/\bupdateMastery\(/);
  });

  it('the Competency target flows through storeQuiz\'s explicit targetCompetencyIds parameter, never via graph traversal after generation', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('export async function startCompetencyReinforcementExecution');
    const body = src.slice(start, start + 4500);
    expect(body).toMatch(/storeQuiz\([\s\S]*?\[claimed\.competencyId\]/);
  });

  it('the Competency path never sets targetSkillIds -- the two tags remain structurally independent', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('export async function startCompetencyReinforcementExecution');
    const end = src.indexOf('export async function', start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    const storeQuizCall = body.match(/storeQuiz\(([\s\S]*?)\);/);
    expect(storeQuizCall).not.toBeNull();
    // storeQuiz(studentId, conceptId, subjectId, questions, language, quizMode, conceptIds, v1Marker, targetSkillIds, targetCompetencyIds)
    // -- the Competency call must pass null for targetSkillIds (position 9) and the real array for targetCompetencyIds (position 10).
    expect(storeQuizCall![1]).toMatch(/,\s*null,\s*\[claimed\.competencyId\]\s*\)?$/);
  });

  it('the Skill path (startSkillReinforcementExecution) never sets targetCompetencyIds', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('export async function startSkillReinforcementExecution');
    const end = src.indexOf('export async function', start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    const storeQuizCall = body.match(/storeQuiz\(([\s\S]*?)\);/);
    expect(storeQuizCall).not.toBeNull();
    expect(storeQuizCall![1]).not.toMatch(/competencyId/i);
  });

  it('the Concept path (startConceptReinforcementExecution) never sets targetSkillIds or targetCompetencyIds', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('export async function startConceptReinforcementExecution');
    const end = src.indexOf('export async function', start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    const storeQuizCall = body.match(/storeQuiz\(([\s\S]*?)\);/);
    expect(storeQuizCall).not.toBeNull();
    expect(storeQuizCall![1]).not.toMatch(/skillId|competencyId/i);
  });

  it('Competency concept-context resolution uses the DIRECT canonical_concept_competencies mapping, never routed through skill_competencies', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('async function resolveDeterministicConceptForCompetency');
    const body = src.slice(start, start + 1200);
    expect(body).toMatch(/canonical_concept_competencies/);
    expect(body).not.toMatch(/skill_competencies/);
    expect(body).toMatch(/resolved\.size === 0/);
    expect(body).toMatch(/resolved\.size > 1/);
    expect(body).toMatch(/'AMBIGUOUS'/);
  });

  it('quiz-persistence.service.ts\'s new targetCompetencyIds parameter is optional and defaults to no behavior change', () => {
    const src = readFileSync(join(process.cwd(), QUIZ_PERSISTENCE_SERVICE), 'utf-8');
    expect(src).toMatch(/targetCompetencyIds\?:\s*string\[\]\s*\|\s*null/);
  });

  it('generate-and-take\'s new competencyIds metadata line is conditional on quizSession.targetCompetencyIds -- never unconditional, never graph-derived', () => {
    const src = readFileSync(join(process.cwd(), GENERATE_AND_TAKE_ROUTE), 'utf-8');
    expect(src).toMatch(/quizSession\.targetCompetencyIds[\s\S]{0,80}\{\s*competencyIds:\s*quizSession\.targetCompetencyIds\s*\}/);
    expect(src).not.toMatch(/canonical_concept_competencies|skill_competencies/);
  });
});
