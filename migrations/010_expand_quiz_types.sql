-- Support quizzes that span more than one concept (cumulative
-- assessment, exam simulation): concept_id becomes optional, and
-- concept_ids tracks the full set covered. Individual questions still
-- carry their own conceptId (already true), so per-concept mastery
-- updates work the same either way.
ALTER TABLE quiz_sessions ALTER COLUMN concept_id DROP NOT NULL;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS concept_ids UUID[];
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS quiz_mode VARCHAR(30) NOT NULL DEFAULT 'topic_practice';
