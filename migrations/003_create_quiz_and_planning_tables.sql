-- StudyOS Quiz & Planning Tables Migration
-- Phase 3: Quiz Generation & Grading
-- Phase 6: Study Planning & Exam Readiness

-- Quiz Sessions (persistent quiz state)
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  questions JSONB NOT NULL, -- Array of GeneratedQuestion
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  INDEX student_quizzes_idx (student_id),
  INDEX quiz_status_idx (status, expires_at)
);

-- Quiz Responses (student answers)
CREATE TABLE IF NOT EXISTS quiz_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_index INT NOT NULL,
  answer TEXT NOT NULL,
  is_correct BOOLEAN,
  score DECIMAL(3, 2), -- 0.00 to 1.00 (partial credit)
  feedback TEXT,
  confidence DECIMAL(3, 2), -- Grading confidence
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX quiz_responses_idx (quiz_session_id),
  INDEX student_responses_idx (student_id)
);

-- Study Plans
CREATE TABLE IF NOT EXISTS study_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_minutes INT NOT NULL,
  subjects_in_plan JSONB, -- Array of subject names
  critical_concepts_count INT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  INDEX student_plans_idx (student_id),
  INDEX plan_dates_idx (start_date, end_date)
);

-- Study Sessions (daily schedule)
CREATE TABLE IF NOT EXISTS study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_plan_id UUID NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  total_minutes INT NOT NULL,
  subject_breakdown JSONB, -- Array of { subject, minutes, conceptCount }
  items JSONB NOT NULL, -- Array of StudySessionItem
  notes TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX plan_sessions_idx (study_plan_id),
  INDEX student_sessions_idx (student_id),
  INDEX session_date_idx (session_date)
);

-- Study Session Progress (track what student actually did)
CREATE TABLE IF NOT EXISTS study_session_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_session_id UUID NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  time_spent_minutes INT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  INDEX progress_session_idx (study_session_id),
  INDEX progress_student_idx (student_id),
  INDEX progress_status_idx (status)
);

-- Exam Readiness Snapshots (track readiness over time)
CREATE TABLE IF NOT EXISTS exam_readiness_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id),
  overall_score INT CHECK (overall_score >= 0 AND overall_score <= 100),
  mastery_score INT,
  retention_score INT,
  debt_score INT,
  error_score INT,
  predicted_exam_score INT,
  risk_level TEXT, -- LOW, MEDIUM, HIGH, CRITICAL
  days_until_exam INT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX readiness_student_idx (student_id),
  INDEX readiness_date_idx (created_at)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_quiz_concept ON quiz_sessions(concept_id);
CREATE INDEX IF NOT EXISTS idx_quiz_expires ON quiz_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_response_quiz ON quiz_responses(quiz_session_id);
CREATE INDEX IF NOT EXISTS idx_plan_student ON study_plans(student_id);
CREATE INDEX IF NOT EXISTS idx_session_plan ON study_sessions(study_plan_id);
CREATE INDEX IF NOT EXISTS idx_readiness_student ON exam_readiness_history(student_id);
