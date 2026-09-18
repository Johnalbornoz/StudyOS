# F7 — Institution Exam Policy Model

## Separate from the exam itself (task §20, INV-F7-10)

`institution_exam_policies` references `institutions` (F2) and `exam_definitions`/`exam_versions`
(F7) by id — it is never a column on `exam_definitions`/`exam_versions` themselves, since the same
exam version is used by many institutions with different (or no) admission policies attached.

| Column | Notes |
|---|---|
| `institution_id` | FK → F2's `institutions`. |
| `exam_definition_id` | FK, required. |
| `exam_version_id` | Nullable FK — a policy may apply across versions, or to one specific version. |
| `admission_context` | Free text, e.g. "Undergraduate Admission 2026". |
| `verification_status` | `CHECK (POLICY_PENDING\|VERIFIED)` — task §20/§22's central distinction. |
| `source_locator` | Nullable citation for where the policy was verified from. |
| `sections_considered` | Nullable jsonb — which components/domains this policy weighs. |
| `threshold_rules` | Nullable jsonb — **only meaningful when `verification_status = 'VERIFIED'`**. |
| `status` | `CHECK (DRAFT\|ACTIVE\|RETIRED)`. |
| `policy_group_id` / `version` | Same retire-and-insert versioning discipline as F6's mappings — a policy "change" is a new row in the same group, never an in-place edit of a published policy. |

## Unverified policy produces no admission claim (task §20/§22, AC-F7-07)

The service layer enforces this as a hard rule, not a UI convention: any function that would
compute admission compliance (`evaluatePolicyCompliance`, if a future phase builds it) must check
`verification_status === 'VERIFIED'` first and refuse — returning an explicit `POLICY_PENDING`
result — for any `POLICY_PENDING` policy. F7 itself implements no compliance calculation at all
(task's own instruction: "Do not calculate admission compliance") — only the policy *data model*
and the profile can still exist and be usable for preparation regardless of verification status
(adversarial case B).

## Two independent policies for the same PAA version (task §22, adversarial case C)

Nothing in the schema limits one exam version to one policy — `institution_exam_policies` has no
uniqueness constraint on `(exam_version_id)`, only on nothing at all beyond the primary key, so two
different institutions can each hold their own row against the exact same `exam_version_id`
with completely independent `threshold_rules`/`sections_considered`/`verification_status`, proven
in the real-Postgres certification by creating two such rows and asserting neither one's data
leaks into or constrains the other.

## Target score is learner intent, not an admission requirement (INV-F7-11)

A `preparation_goals` row of type `TARGET_SCORE` on a student's own profile is never read by, or
linked to, `institution_exam_policies.threshold_rules` — they are structurally unconnected tables.
A learner's personal goal of "score 350" and an institution's verified admission threshold of
"320 minimum" are two independent facts; nothing in F7 conflates a learner exceeding their own
goal with satisfying any institution's actual requirement.
