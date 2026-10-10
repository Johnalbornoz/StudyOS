-- B1-D -- simulation type EXAM_PRACTICE (ADDITIVE / WIDENING ONLY).
--
-- FULL_MOCK means an official-fidelity full mock, and nothing else. A PRACTICE-mode exam instance is an
-- exam-instance-based PREPARATION assessment over the instance's selected components / positions: it may
-- be full-length, and it is not an official mock. Until now its attempt was stored with simulation_type
-- 'FULL_MOCK' (the type was used as a plan-shape selector). From this migration on, the canonical
-- exam-instance start flow stores:
--
--   exam_instances.mode = PRACTICE            -> simulation_type = 'EXAM_PRACTICE'
--   exam_instances.mode = MOCK / CHALLENGE    -> simulation_type = 'FULL_MOCK'   (unchanged)
--
-- What this migration does: widens the two CHECK constraints that enumerate the type, on simulation_plans
-- and simulation_attempts, to also accept 'EXAM_PRACTICE'. Nothing else.
--   - no column is added, dropped or renamed;
--   - no row is backfilled or rewritten: historical PRACTICE-instance attempts stored as 'FULL_MOCK' stay as
--     they are and stay readable (presentation derives their label from the linked instance mode);
--   - teacher_interventions.simulation_type is NOT widened: a Teacher expresses intent through the
--     intervention model; only the exam-instance start flow writes 'EXAM_PRACTICE';
--   - the CHECKs are only widened, so no existing row can be invalidated.
--
-- DEPLOYMENT ORDER (required): apply this migration to an environment BEFORE deploying any code that writes
-- 'EXAM_PRACTICE' there. With the code first and the migration missing, starting a PRACTICE exam instance
-- fails the CHECK (the start is rejected; nothing is half-written). Never applied automatically -- governed
-- runner only (DEV first; Stage / Production by their own release).
--
-- Rollback (only while no row stores 'EXAM_PRACTICE'):
--   ALTER TABLE public.simulation_plans DROP CONSTRAINT IF EXISTS simulation_plans_type_check;
--   ALTER TABLE public.simulation_plans ADD CONSTRAINT simulation_plans_type_check
--     CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'));
--   ALTER TABLE public.simulation_attempts DROP CONSTRAINT IF EXISTS simulation_attempts_type_check;
--   ALTER TABLE public.simulation_attempts ADD CONSTRAINT simulation_attempts_type_check
--     CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'));
--   DELETE FROM schema_migrations WHERE version = '20261108_1000';

ALTER TABLE public.simulation_plans DROP CONSTRAINT IF EXISTS simulation_plans_type_check;
ALTER TABLE public.simulation_plans ADD CONSTRAINT simulation_plans_type_check
  CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE'));

ALTER TABLE public.simulation_attempts DROP CONSTRAINT IF EXISTS simulation_attempts_type_check;
ALTER TABLE public.simulation_attempts ADD CONSTRAINT simulation_attempts_type_check
  CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE'));
