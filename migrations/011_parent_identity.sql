-- Parent accounts are profiles rows (user_type='parent') linked to a
-- Clerk user, same identity pattern as students -- but students resolve
-- Clerk -> profile via the legacy `students.clerk_id` table, which only
-- ever stores students. Parents have no equivalent table, so profiles
-- gets its own clerk_id column for non-student profile types.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS clerk_id VARCHAR;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_clerk_id_key ON profiles(clerk_id) WHERE clerk_id IS NOT NULL;
