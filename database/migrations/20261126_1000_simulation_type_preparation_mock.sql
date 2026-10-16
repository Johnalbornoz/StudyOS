-- TRACK B -- simulation type PREPARATION_MOCK (ADDITIVE / WIDENING ONLY). Follows 20261125_1000.
--
-- A full-length StudyUs PREPARATION mock: the frozen form has the complete official size, but the official structure
-- cannot be verified (the exam board publishes no per-area time, or no documented distribution), so it is neither a
-- verified FULL_MOCK (that would claim official fidelity) nor a REDUCED_MOCK (that would claim a smaller form).
-- It is started only under a recorded governance authorisation for its system and delivery scope
-- (src/lib/exam-bank/full-mock-authorization.ts; Saber 11 Matemáticas, PILOT_PREVIEW, John 2026-10-15) and is
-- presented as StudyUs preparation content, never as an official exam.
--
--   exam_instances.mode = MOCK, form fidelity FULL                                   -> 'FULL_MOCK'
--   exam_instances.mode = MOCK, form fidelity REDUCED                                -> 'REDUCED_MOCK'
--   exam_instances.mode = MOCK, complete size, structure unverifiable, AUTHORISED    -> 'PREPARATION_MOCK'
--   exam_instances.mode = MOCK, fidelity UNKNOWN otherwise                           -> nothing is started
--
-- What this migration does: widens the two CHECK constraints that enumerate the type, on simulation_plans and
-- simulation_attempts, to also accept 'PREPARATION_MOCK'. Nothing else: no column, no row rewritten, no other table
-- (assessment_frozen_forms belongs to the protected blueprint path and is unchanged).
--
-- DEPLOYMENT ORDER: this migration, then the application code that writes the value. Governed runner only.
--
-- Rollback (only while no row stores 'PREPARATION_MOCK'):
--   ALTER TABLE public.simulation_plans DROP CONSTRAINT IF EXISTS simulation_plans_type_check;
--   ALTER TABLE public.simulation_plans ADD CONSTRAINT simulation_plans_type_check
--     CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE', 'EXAM_CHALLENGE', 'REDUCED_MOCK'));
--   ALTER TABLE public.simulation_attempts DROP CONSTRAINT IF EXISTS simulation_attempts_type_check;
--   ALTER TABLE public.simulation_attempts ADD CONSTRAINT simulation_attempts_type_check
--     CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE', 'EXAM_CHALLENGE', 'REDUCED_MOCK'));
--   DELETE FROM schema_migrations WHERE version = '20261126_1000';

ALTER TABLE public.simulation_plans DROP CONSTRAINT IF EXISTS simulation_plans_type_check;
ALTER TABLE public.simulation_plans ADD CONSTRAINT simulation_plans_type_check
  CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE', 'EXAM_CHALLENGE', 'REDUCED_MOCK', 'PREPARATION_MOCK'));

ALTER TABLE public.simulation_attempts DROP CONSTRAINT IF EXISTS simulation_attempts_type_check;
ALTER TABLE public.simulation_attempts ADD CONSTRAINT simulation_attempts_type_check
  CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE', 'EXAM_CHALLENGE', 'REDUCED_MOCK', 'PREPARATION_MOCK'));
