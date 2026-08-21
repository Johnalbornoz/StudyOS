-- StudyOS Core Tables Migration
-- Phase 1: Mastery Engine, Learning Debt, Errors

-- Students table (multi-tenancy)
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  language TEXT DEFAULT 'en',
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Subjects (Math, Science, History, etc.)
CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Concepts (Linear Equations, Sign Rules, etc.)
CREATE TABLE IF NOT EXISTS concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  canonical_id TEXT UNIQUE NOT NULL, -- MATH_ALG_LINEAR_EQ
  difficulty INT CHECK (difficulty >= 1 AND difficulty <= 5),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(subject_id, canonical_id)
);

-- Concept Localizations (translations)
CREATE TABLE IF NOT EXISTS concept_localizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(concept_id, language)
);

-- Mastery Records (student understanding per concept)
CREATE TABLE IF NOT EXISTS mastery_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  mastery_score DECIMAL(5, 4) DEFAULT 0.0 CHECK (mastery_score >= 0 AND mastery_score <= 1),
  last_studied_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, concept_id),
  INDEX student_concept_idx (student_id, concept_id),
  INDEX subject_student_idx (subject_id, student_id)
);

-- Learning Debt (unresolved gaps)
CREATE TABLE IF NOT EXISTS learning_debt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id),
  severity INT CHECK (severity >= 1 AND severity <= 5),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),
  INDEX student_active_idx (student_id, status)
);

-- Errors (wrong answers)
CREATE TABLE IF NOT EXISTS errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id),
  error_type TEXT, -- CALCULATION, CONCEPTUAL, etc.
  context JSONB, -- { question, answer, correct, difficulty }
  timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX student_concept_errors_idx (student_id, concept_id)
);

-- Error Patterns (recurring mistakes)
CREATE TABLE IF NOT EXISTS error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id),
  error_type TEXT NOT NULL,
  error_count INT DEFAULT 1,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  first_error_at TIMESTAMP,
  last_error_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  UNIQUE(student_id, concept_id, error_type),
  INDEX student_pattern_idx (student_id, status)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_mastery_student ON mastery_records(student_id);
CREATE INDEX IF NOT EXISTS idx_mastery_concept ON mastery_records(concept_id);
CREATE INDEX IF NOT EXISTS idx_debt_student ON learning_debt(student_id);
CREATE INDEX IF NOT EXISTS idx_debt_status ON learning_debt(status);
CREATE INDEX IF NOT EXISTS idx_errors_student ON errors(student_id);
CREATE INDEX IF NOT EXISTS idx_patterns_student ON error_patterns(student_id);
