-- B1-E -- simulation types EXAM_CHALLENGE and REDUCED_MOCK (ADDITIVE / WIDENING ONLY).
--
-- FULL_MOCK means a VERIFIED COMPLETE official-format mock, and nothing else. Until now every MOCK and
-- CHALLENGE exam instance stored its attempt as 'FULL_MOCK'. From this migration on, the canonical
-- exam-instance start service derives and stores:
--
--   exam_instances.mode = PRACTICE                         -> 'EXAM_PRACTICE'   (20261108_1000)
--   exam_instances.mode = CHALLENGE                        -> 'EXAM_CHALLENGE'  frozen, officially timed, deliberately
--                                                             more demanding than the official exam
--   exam_instances.mode = MOCK, form fidelity FULL         -> 'FULL_MOCK'
--   exam_instances.mode = MOCK, form fidelity REDUCED      -> 'REDUCED_MOCK'    official model, smaller than the
--                                                             complete official form
--   exam_instances.mode = MOCK, form fidelity UNKNOWN      -> nothing is started
--
-- What this migration does: widens the two CHECK constraints that enumerate the type, on simulation_plans
-- and simulation_attempts, to also accept 'EXAM_CHALLENGE' and 'REDUCED_MOCK'. Nothing else.
--   - no column is added, dropped or renamed;
--   - no row is backfilled or rewritten: historical CHALLENGE and reduced-MOCK attempts stored as 'FULL_MOCK'
--     stay as they are and stay readable (presentation and classification use the linked exam instance);
--   - teacher_interventions.simulation_type is NOT widened: a Teacher asks for a mock; the start service
--     derives the stored type;
--   - the CHECKs are only widened, so no existing row can be invalidated.
--
-- DEPLOYMENT ORDER (required), per environment:
--   1. 20261108_1000_simulation_type_exam_practice.sql
--   2. this migration
--   3. application code that writes the new values
-- With the code first, starting a CHALLENGE or reduced-MOCK instance fails the CHECK (the start is rejected;
-- nothing is half-written). Never applied automatically -- governed runner only. Do not assume either
-- migration is applied in an environment until it is verified there.
--
-- Rollback (only while no row stores 'EXAM_CHALLENGE' / 'REDUCED_MOCK'):
--   ALTER TABLE public.simulation_plans DROP CONSTRAINT IF EXISTS simulation_plans_type_check;
--   ALTER TABLE public.simulation_plans ADD CONSTRAINT simulation_plans_type_check
--     CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE'));
--   ALTER TABLE public.simulation_attempts DROP CONSTRAINT IF EXISTS simulation_attempts_type_check;
--   ALTER TABLE public.simulation_attempts ADD CONSTRAINT simulation_attempts_type_check
--     CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE'));
--   DELETE FROM schema_migrations WHERE version = '20261109_1000';

ALTER TABLE public.simulation_plans DROP CONSTRAINT IF EXISTS simulation_plans_type_check;
ALTER TABLE public.simulation_plans ADD CONSTRAINT simulation_plans_type_check
  CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE', 'EXAM_CHALLENGE', 'REDUCED_MOCK'));

ALTER TABLE public.simulation_attempts DROP CONSTRAINT IF EXISTS simulation_attempts_type_check;
ALTER TABLE public.simulation_attempts ADD CONSTRAINT simulation_attempts_type_check
  CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE', 'EXAM_CHALLENGE', 'REDUCED_MOCK'));
