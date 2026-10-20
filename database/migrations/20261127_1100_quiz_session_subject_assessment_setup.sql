-- LEARNING / INTERNAL ASSESSMENT -- the frozen setup of a subject-level test or mock (ADDITIVE ONLY). Follows 20261127_1000.
--
-- Operator decision (STUDYOS PEDAGOGICAL JOURNEY, sections 10-11, 2026-10-17): a subject test ("Prueba por materia",
-- quiz_mode cumulative_assessment) and a subject mock ("Simulacro por materia", quiz_mode exam_simulation) freeze,
-- before the attempt begins: the exact selected concept ids, the question count, the scheduled date, the StudyUs
-- recommended date (not available until a governed rule exists) and the per-concept blueprint of the questions. The
-- questions themselves are already frozen in quiz_sessions.questions.
--
-- This is deliberately NOT quiz_sessions.assessment_snapshot: that column is the Blueprint Core (B2) frozen-assessment
-- contract, and its presence routes a session to the canonical execution path.
--
-- What this migration does: adds one nullable jsonb column. No row is rewritten; no other table is touched.
--
-- Rollback:
--   ALTER TABLE public.quiz_sessions DROP COLUMN IF EXISTS subject_assessment_setup;
--   DELETE FROM schema_migrations WHERE version = '20261127_1100';

ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS subject_assessment_setup jsonb;
