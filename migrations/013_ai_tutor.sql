-- AI Tutor conversations: a chat interface over the same RAG pipeline
-- that already grounds quiz generation in the student's own uploaded
-- material. One conversation optionally scoped to a subject (for
-- RAG grounding); messages keep full history for context.
CREATE TABLE IF NOT EXISTS tutor_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  subject_id UUID REFERENCES subjects(id),
  title VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tutor_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tutor_conversations_student_idx ON tutor_conversations(student_id);
CREATE INDEX IF NOT EXISTS tutor_messages_conversation_idx ON tutor_messages(conversation_id);
