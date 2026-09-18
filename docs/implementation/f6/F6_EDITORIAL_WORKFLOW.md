# F6 — Editorial Workflow

## Roles: a new, narrow grant table — not a `Role` enum change (task §14/32)

Per the assessment (§5), F1's `Role` is closed and F2's own permission model is deliberately
narrow and additive rather than a general RBAC table. F6 follows the same discipline:

```sql
CREATE TABLE curriculum_editorial_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  grant_role text NOT NULL CHECK (grant_role IN ('EDITOR', 'REVIEWER', 'PUBLISHER')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz,
  revoked_at timestamptz
);
```

A user may hold zero, one, or several of these grants independently of their F1 platform role.
Holding `TEACHER` or `INSTITUTION_ADMIN` **confers no editorial capability whatsoever** — the
authorization check for every editorial action queries `curriculum_editorial_grants` directly,
never `user_roles` (task §32's explicit requirement, tested in the adversarial certification).

## State machine (task §14)

```
DRAFT ──propose──▶ PROPOSED ──beginReview──▶ IN_REVIEW ──approve──▶ APPROVED ──publish──▶ PUBLISHED
                       │                         │                                            │
                       └──────reject──────────▶ REJECTED                              retire/supersede
                                                                                               │
                                                                                          RETIRED
```

Applies identically (same status vocabulary, same transition function shape) to
`objective_concept_mappings`, `objective_skill_mappings`, `objective_competency_mappings`, and
`academic_resources` — four independent instances of the same state machine, never
cross-linked (task §13/AC-F6-09: content approval and mapping approval are separate authorities,
even though they share a vocabulary).

## Segregation of duties (task §15, AC-F6-10)

Enforced at the service layer, not just by convention:

- `proposeMapping(actorUserId, ...)` requires an `ACTIVE` `EDITOR` grant, and stamps
  `created_by = actorUserId`.
- `approveMapping(actorUserId, mappingId)` requires an `ACTIVE` `REVIEWER` grant **and**
  `actorUserId !== mapping.created_by` — an explicit equality check, not an inferred one. If they
  match, the function throws `SelfApprovalError` before any write.
- `publishMapping(actorUserId, mappingId)` requires an `ACTIVE` `PUBLISHER` grant. A `PUBLISHER`
  publishing their own `APPROVED` mapping is allowed (approval, not publication, is the
  self-check gate here) — task §15 scopes the creator≠reviewer rule to the review/approval step
  specifically ("creator != reviewer for published mapping/content fixture flows"), and approval
  is that step.
- If no eligible reviewer exists for a proposal (nobody holds an `ACTIVE` `REVIEWER` grant other
  than the creator), the mapping simply **remains `PROPOSED`/`IN_REVIEW` indefinitely** — never
  auto-approved, never escalated to a fallback path (task §15's explicit "remain pending"
  instruction).

## AI-assisted proposals never bypass this (task §16, INV-F6-11)

`proposeMapping` accepts `provenance: 'AI_SUGGESTED'` and a `confidence` score, but the resulting
row still requires the exact same `REVIEWER`/`PUBLISHER` gates to advance — there is no
`autoApprove`/`autoPublish` code path keyed on provenance or confidence. `confidence` is stored
and surfaced for human judgment only.

## Catalog request flow (task §17)

```
active academic profile (existing F1/onboarding data, read-only from F6's perspective)
  → resolve organization/programme/qualification/subject/version (new F6 lookup)
  → retrieve structure (structure_versions/structure_nodes)
  → search canonical concept (reuses F4's findCanonicalConceptsByExactName)
  → proposeMapping (DRAFT/PROPOSED, provenance MANUAL or AI_SUGGESTED)
  → beginReview / approveMapping / publishMapping
```

If the required academic information (organization/programme/subject/version) is missing or
ambiguous, the contract explicitly supports **not forcing an alignment claim** — a learner or
service caller can proceed with personal, unaligned learning (exactly as they do today) rather
than the system inventing a framework association. This is enforced by every F6 read function
returning `null`/empty rather than a fabricated guess when the scoping information is absent.
