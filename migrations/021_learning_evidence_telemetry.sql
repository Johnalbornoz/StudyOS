-- Extends the existing learning_evidence table (written from
-- mastery.service.ts's updateMastery) with the fields needed for AI
-- Assistance Telemetry and the SOLO/COACH/AI_NATIVE learning-mode
-- distinction -- additive only, nothing here changes how mastery
-- itself is calculated.
ALTER TABLE learning_evidence
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id),
  ADD COLUMN IF NOT EXISTS activity_type TEXT,
  ADD COLUMN IF NOT EXISTS learning_mode TEXT CHECK (learning_mode IN ('SOLO', 'COACH', 'AI_NATIVE')),
  ADD COLUMN IF NOT EXISTS hints_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_assistance_type TEXT NOT NULL DEFAULT 'NONE'
    CHECK (ai_assistance_type IN ('NONE', 'HINT', 'MULTIPLE_HINTS', 'TUTOR_GUIDANCE', 'TUTOR_EXPLANATION', 'WORKED_EXAMPLE', 'OTHER')),
  ADD COLUMN IF NOT EXISTS confidence_before_answer TEXT
    CHECK (confidence_before_answer IN ('NOT_SURE', 'SOMEWHAT_SURE', 'VERY_SURE')),
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Which question indices (within a quiz session) a hint was requested
-- for -- the hint endpoint appends to this; quiz submission reads it
-- to know hints-per-concept when recording evidence.
ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS hints_used_questions INT[] NOT NULL DEFAULT '{}';
