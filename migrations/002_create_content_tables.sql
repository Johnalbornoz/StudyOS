-- StudyOS Content Tables Migration
-- Phase 2: RAG, Embeddings, Content Chunking

-- Content Sources (student uploaded files)
CREATE TABLE IF NOT EXISTS content_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id),
  name TEXT NOT NULL,
  source_type TEXT, -- pdf, text, url, etc.
  original_size INT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX student_sources_idx (student_id)
);

-- Content Chunks (semantic splits)
CREATE TABLE IF NOT EXISTS content_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  sequence_order INT NOT NULL,
  content TEXT NOT NULL,
  token_count INT,
  reading_time_minutes DECIMAL(5, 2),
  difficulty INT CHECK (difficulty >= 1 AND difficulty <= 5),
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX source_chunks_idx (source_id),
  INDEX student_chunks_idx (student_id)
);

-- Vector Embeddings (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID NOT NULL REFERENCES content_chunks(id) ON DELETE CASCADE,
  embedding vector(1536), -- OpenAI text-embedding-3-small
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX chunk_embed_idx (chunk_id)
);

-- Chunk-Concept Mappings (many-to-many)
CREATE TABLE IF NOT EXISTS chunk_concept_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID NOT NULL REFERENCES content_chunks(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relevance_score DECIMAL(3, 2), -- 0.00 to 1.00
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(chunk_id, concept_id),
  INDEX chunk_concepts_idx (chunk_id),
  INDEX concept_chunks_idx (concept_id)
);

-- Create indexes for vector similarity search
CREATE INDEX IF NOT EXISTS chunk_embeddings_idx
ON chunk_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_errors_context ON errors USING GIN (context);
