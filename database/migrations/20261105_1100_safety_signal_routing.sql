-- Human Agency P0-4 -- deterministic safety signal: designated safety contacts + minimal safety events (additive).
--
-- Routing (decision D-HA-01):
--   institutional learner  -> the institution-designated Safeguarding Lead(s) / counsellor(s)
--                             (scope INSTITUTION, role SAFEGUARDING_LEAD);
--   independent learner    -> the designated StudyUs Safety Operator(s) for the pilot
--                             (scope PLATFORM, role SAFETY_OPERATOR);
--   never a parent/guardian automatically.
-- An institutional learner whose institution has no ACTIVE lead falls back to the StudyUs Safety Operator
-- (routing_reason INSTITUTION_LEAD_NOT_DESIGNATED) -- a signal is never silently dropped.
--
-- safety_signal_events holds MINIMAL data only: who (student), when, which status, which surface, detector
-- version, how it was routed and how many recipients were notified. It never stores the Student's text, the
-- matched phrase, a diagnosis or any clinical label.
--
-- Repeated signals from the same Student within SAFETY_NOTIFY_DEDUPE_MINUTES (10) are recorded (routing_status
-- DEDUPLICATED) but do not re-notify -- e.g. a phrase typed into a search-as-you-type box.
--
-- Designations are written only by the operator CLI (scripts/operations/safety-contacts.ts); no backfill.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.safety_signal_events;
--   DROP TABLE IF EXISTS public.safety_contact_designations;
--   DELETE FROM schema_migrations WHERE version = '20261105_1100';

CREATE TABLE IF NOT EXISTS public.safety_contact_designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('INSTITUTION', 'PLATFORM')),
  institution_id uuid REFERENCES public.institutions(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  role text NOT NULL CHECK (role IN ('SAFEGUARDING_LEAD', 'SAFETY_OPERATOR')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  designated_by_user_id uuid REFERENCES public.users(id),
  designated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT safety_contact_designations_scope_shape_check CHECK (
    (scope = 'INSTITUTION' AND institution_id IS NOT NULL AND role = 'SAFEGUARDING_LEAD')
    OR (scope = 'PLATFORM' AND institution_id IS NULL AND role = 'SAFETY_OPERATOR')
  ),
  CONSTRAINT safety_contact_designations_revocation_check CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_contact_active
  ON public.safety_contact_designations (scope, COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), user_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.safety_signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  signal_status text NOT NULL CHECK (signal_status IN ('SAFETY_SIGNAL', 'IMMEDIATE_DANGER_SIGNAL')),
  surface text NOT NULL CHECK (char_length(surface) BETWEEN 1 AND 80),
  detector_version text NOT NULL,
  routing text NOT NULL CHECK (routing IN ('INSTITUTION_SAFEGUARDING', 'STUDYUS_SAFETY_OPERATOR')),
  routing_reason text NOT NULL CHECK (routing_reason IN ('INSTITUTIONAL_LEARNER', 'INDEPENDENT_LEARNER', 'INSTITUTION_LEAD_NOT_DESIGNATED')),
  institution_id uuid REFERENCES public.institutions(id),
  routing_status text NOT NULL CHECK (routing_status IN ('NOTIFIED', 'NO_RECIPIENT_DESIGNATED', 'NOTIFICATION_FAILED', 'DEDUPLICATED')),
  recipient_count integer NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  resource_country text CHECK (resource_country IS NULL OR resource_country ~ '^[A-Z]{2}$'),
  resource_allowlist_version text,
  resources_shown integer NOT NULL DEFAULT 0 CHECK (resources_shown >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_signal_events_created ON public.safety_signal_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_signal_events_student ON public.safety_signal_events (student_id, created_at DESC);
