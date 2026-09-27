-- QUIZ_SESSION_TIMEZONE -- make quiz_sessions timestamps absolute instants.
--
-- created_at / completed_at / expires_at were `timestamp without time zone`.
-- node-pg sends a JS Date as local time + offset and a timestamp column
-- silently drops the offset, then parses the value back as process-local
-- time. The Vercel runtime is UTC, so production held UTC wall time, but
-- any process in another zone (a UTC-6 laptop script) stored and read
-- shifted values, and `expires_at > NOW()` / `le.timestamp >= created_at`
-- then used the wrong expiry and resume windows.
--
-- Every existing value is UTC wall time: rows written by the application
-- came from the UTC Vercel runtime, and `DEFAULT now()` / `completed_at =
-- NOW()` were evaluated in the database session zone (GMT). They are
-- therefore reinterpreted explicitly `AT TIME ZONE 'UTC'`, never via the
-- session TimeZone. The instant each row denotes is unchanged. Rows a
-- non-UTC script wrote (DEV only: 74 expired benchmark sessions, shifted
-- -6 h, detectable from the Date.now() embedded in the quiz id) keep
-- that shift; this migration does not guess at a repair.
--
-- Rewrites quiz_sessions and rebuilds quiz_sessions_status_idx
-- (status, expires_at) under an ACCESS EXCLUSIVE lock. Code before and
-- after this migration is compatible with both column types (storeQuiz
-- computes the timestamps with the database now()). Governed runner only.

ALTER TABLE public.quiz_sessions
    ALTER COLUMN created_at TYPE timestamp with time zone USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN completed_at TYPE timestamp with time zone USING completed_at AT TIME ZONE 'UTC',
    ALTER COLUMN expires_at TYPE timestamp with time zone USING expires_at AT TIME ZONE 'UTC';
