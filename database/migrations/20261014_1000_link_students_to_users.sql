-- Membership/entitlement sync -- repair the F1 canonical identity link for
-- Students created after F1.
--
-- F1 made students.user_id (and the Student profile's profiles.user_id) the
-- canonical link to `users`; ownership for entitlements (LEARNING_FULL_ACCESS)
-- and for F2 authorization is decided on it. The Student provisioning path
-- (src/lib/auth.ts::upsertStudentRecord) never set it, so every Student it
-- created stayed unlinked: an active licence (paid or administrative) could
-- never grant access, and the owner could not be authorized on their own
-- learner. The code now links on creation; this backfills existing rows with
-- the SAME exact-clerk_id rule the F1 identity backfill used.
--
-- Data-only, idempotent (fills NULLs only, never overwrites a link), no
-- schema change. Technical identities are never linked. Governed runner only.

UPDATE public.students s
SET user_id = u.id
FROM public.users u
WHERE s.user_id IS NULL
  AND u.clerk_id = s.clerk_id
  AND NOT u.is_system;

UPDATE public.profiles p
SET user_id = s.user_id
FROM public.students s
WHERE p.id = s.id
  AND p.user_type = 'student'
  AND p.user_id IS NULL
  AND s.user_id IS NOT NULL;
