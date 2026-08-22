CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subtopics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id),
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS subtopic_id UUID REFERENCES subtopics(id);

CREATE INDEX IF NOT EXISTS topics_subject_idx ON topics(subject_id);
CREATE INDEX IF NOT EXISTS subtopics_topic_idx ON subtopics(topic_id);
CREATE INDEX IF NOT EXISTS concepts_subtopic_idx ON concepts(subtopic_id);
