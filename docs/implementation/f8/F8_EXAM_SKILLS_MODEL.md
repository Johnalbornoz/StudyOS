# F8 — Exam Skills Model

Covers task §16-18 operationalization (command term / question format / procedure training) plus the session/attempt persistence that carries it (task §30).

## Tables: `intervention_sessions` + `intervention_attempts`

```sql
CREATE TABLE intervention_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  diagnosis_id uuid NOT NULL REFERENCES learner_gap_diagnoses(id),
  intervention_policy_version_id uuid NOT NULL REFERENCES intervention_policy_versions(id),
  intervention_type text NOT NULL CHECK (intervention_type IN
    ('EXPLAIN','WORKED_EXAMPLE','GUIDED_PRACTICE','CONTEXTUAL_HELP','INDEPENDENT_PRACTICE','PROVE')),
  gap_type text NOT NULL,                        -- frozen copy of diagnosis.primaryGapType at creation
  reason_codes text[] NOT NULL DEFAULT '{}',      -- frozen copy of the rationale
  framework_context jsonb,                        -- frozen FrameworkIdentity snapshot, nullable (no active framework)
  assistance_level text CHECK (assistance_level IN
    ('NONE','HINT','MULTIPLE_HINTS','TUTOR_GUIDANCE','TUTOR_EXPLANATION','WORKED_EXAMPLE','OTHER')),
  status text NOT NULL CHECK (status IN ('ACTIVE','COMPLETED','ABANDONED')) DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_intervention_sessions_student ON intervention_sessions (student_id, created_at DESC);

CREATE TABLE intervention_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_session_id uuid NOT NULL REFERENCES intervention_sessions(id),
  attempt_number int NOT NULL,
  evidence_id uuid NOT NULL REFERENCES learning_evidence(id),
  outcome text NOT NULL CHECK (outcome IN ('correct','incorrect','partial')),
  feedback jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intervention_session_id, attempt_number)
);
```

`assistance_level` reuses the exact `ai_assistance_type` domain (F5) rather than inventing a parallel scale (task §21's "or compatible current representation"). Default mapping at session creation: `EXPLAIN`/`WORKED_EXAMPLE` → `WORKED_EXAMPLE`; `GUIDED_PRACTICE` → `TUTOR_GUIDANCE`; `CONTEXTUAL_HELP` → `HINT`; `INDEPENDENT_PRACTICE` → `NONE`; `PROVE` → `NONE` (but PROVE attempts are never recorded through this table — see below).

## Why a new session pair, not an extension of `quiz_sessions`

`quiz_sessions` is a *quiz* attempt record — it doesn't fit `EXPLAIN`/standalone `WORKED_EXAMPLE`/`CONTEXTUAL_HELP`, none of which are quizzes, and it has no linkage to a diagnosis or a versioned intervention policy. `exam_attempts`/`exam_attempt_item_responses` (F7) is the structural precedent this pair follows: one parent "launch" row (frozen configuration) + append-only child "attempt" rows. This is additive, narrowly scoped to F8's own diagnostic/teaching flow, and does not touch `quiz_sessions` at all (per the current-state assessment's explicit recommendation).

## Retry model (task §20, case M)

Each learner response within a session inserts one new `intervention_attempts` row with an incrementing `attempt_number` — the prior attempt row (and its `evidence_id`, and the underlying immutable `learning_evidence` row) is never overwritten or deleted. `recordInterventionAttempt(sessionId, response)`:
1. Grades the response through the appropriate existing grader (`gradeStructuredAnswer`/`gradeAnswer`, chosen by content shape — never a new grader).
2. Classifies feedback (see `F8_FEEDBACK_RETRY_MODEL.md`).
3. Writes evidence via `writeInterventionEvidence` (see `F8_EVIDENCE_INTEGRATION.md`).
4. Inserts the `intervention_attempts` row referencing the new evidence id, `attempt_number = COUNT(*) + 1` for that session (computed inside the same transaction to avoid a race).
5. Never marks the session `COMPLETED` automatically on a correct answer alone — completion is caller-driven (the student/route explicitly ends the session), so a correct answer can still be followed by voluntary further practice.

## PROVE exclusion

`recordInterventionAttempt` rejects (400, `PROVE_NOT_RECORDABLE_HERE`) any attempt against a session whose `intervention_type = 'PROVE'`. This is enforced in code, not just documentation — see `F8_INTERVENTION_SELECTION_MODEL.md`'s PROVE handling section for the rationale (avoids duplicating Canonical V2's own PROVE launch/authorization machinery).

## Cross-learner isolation (task §37 case Q)

Every session/attempt read and write path requires `student_id` to match the resolved learner from `canAccessLearner`/ownership — the same discipline as every prior phase's routes. No session or attempt is ever fetchable by id alone without that check.
