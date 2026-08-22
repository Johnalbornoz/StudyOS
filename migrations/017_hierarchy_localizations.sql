CREATE TABLE IF NOT EXISTS topic_localizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(topic_id, language)
);

CREATE TABLE IF NOT EXISTS subtopic_localizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtopic_id UUID NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subtopic_id, language)
);

CREATE INDEX IF NOT EXISTS topic_localizations_topic_idx ON topic_localizations(topic_id);
CREATE INDEX IF NOT EXISTS subtopic_localizations_subtopic_idx ON subtopic_localizations(subtopic_id);
