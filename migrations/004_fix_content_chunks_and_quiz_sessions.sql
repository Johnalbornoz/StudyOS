-- Fix migration: 002 and 003 used MySQL-style inline "INDEX name (col)"
-- syntax inside CREATE TABLE, which is invalid in PostgreSQL, so those
-- scripts never actually ran. The live schema was built separately and
-- is missing pieces the application code depends on. This adds exactly
-- those pieces, matching the column names the code already queries.

-- content_chunks: embedding.service.ts writes/reads chunk_embedding and
-- concept_mappings directly on this table (no separate junction tables).
ALTER TABLE content_chunks
  ADD COLUMN IF NOT EXISTS chunk_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS concept_mappings UUID[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS content_chunks_embedding_idx
  ON content_chunks USING ivfflat (chunk_embedding vector_cosine_ops)
  WITH (lists = 100);

-- quiz-persistence.service.ts: stores generated quizzes here.
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  questions JSONB NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS quiz_sessions_student_idx ON quiz_sessions(student_id);
CREATE INDEX IF NOT EXISTS quiz_sessions_status_idx ON quiz_sessions(status, expires_at);
