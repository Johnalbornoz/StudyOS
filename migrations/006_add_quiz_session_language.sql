-- Remember which language a quiz was generated in, so grading later
-- uses the same language even if the student's interface language or
-- a subject's settings change in between.
ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'en';
