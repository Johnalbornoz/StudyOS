-- Student-level academic context (Learning OS Phase 1).
-- Deliberately separate from subjects.ib_programme/ib_subject_group/
-- ib_level, which stay per-subject (a DP1 student can have both HL and
-- SL subjects). This table is the student's overall context: where
-- they study, what grade/curriculum, and (if IB) programme + year --
-- never SL/HL, which is a subject-level fact, not a student one.
CREATE TABLE IF NOT EXISTS student_academic_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  country_of_study TEXT NOT NULL DEFAULT 'OTHER' CHECK (country_of_study IN ('CO', 'MX', 'US', 'DE', 'OTHER')),
  school_year TEXT,
  curriculum_type TEXT NOT NULL DEFAULT 'not_sure' CHECK (curriculum_type IN ('national', 'ib', 'other', 'not_sure')),
  ib_programme TEXT CHECK (ib_programme IN ('MYP', 'DP')),
  ib_year TEXT,
  academic_year TEXT,
  school_name TEXT,
  profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
