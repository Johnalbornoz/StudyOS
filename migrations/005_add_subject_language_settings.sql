-- Language settings per subject.
--
-- target_language: set when the subject itself IS a language course
-- (e.g. "Alemán" -> 'de'). When set, quizzes/content for this subject
-- are ALWAYS generated in that language, regardless of the student's
-- interface language -- learning German means practicing in German.
--
-- quiz_language_mode: only relevant when target_language IS NULL
-- (i.e. a non-language subject like Math or History). Lets the
-- student choose whether quiz questions follow their current
-- interface language or stay fixed in English.
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS target_language VARCHAR(10),
  ADD COLUMN IF NOT EXISTS quiz_language_mode VARCHAR(20) NOT NULL DEFAULT 'match_interface'
    CHECK (quiz_language_mode IN ('match_interface', 'fixed_english'));
