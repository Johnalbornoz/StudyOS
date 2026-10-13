# Exam blueprint readiness

What each governed blueprint can support, independent of how many items exist.

## The blueprints are reduced demonstration blueprints

Every V2 configuration is `contentStatus: DEV_CERT_FIXTURE`. Only one section in the repository governs an
official full-length form:

| Configuration | Section | Slots governed | Official length | Full form governed |
|---|---|---|---|---|
| `v2.saber11.math` | Matemáticas | 50 | 50 | YES |
| `v2.paa` | Lectura / Redacción / Matemáticas / Inglés | 10 / 6 / 12 / 8 (36) | 175 scored items in total (Q1, locked) | NO |
| `v2.pisa.2022` | Math / Reading / Science | 8 / 7 / 6 | rotated booklets | not applicable |
| `v2.cambridge.0580-extended` | P2 / P4 | 4 / 4 | full paper | NO |
| IB mathematics and sciences (10 configurations) | each paper | 1–7 | full paper | NO |
| AICE (14 configurations) | each paper | 1–4 | full paper | NO |

The engine therefore reports `FULL_FORM_BLUEPRINT_NOT_GOVERNED` for 75 of the 79 item-bankable sections. Filling
those blueprints with items makes a **reduced mock** ready. It can never make a full mock ready, and the engine
will not call it one, however deep the bank.

## What "ready" means, per mode

| Mode | Condition | Blocker when not met |
|---|---|---|
| PRACTICE | ≥ 1 eligible item in every bucket | `PRACTICE_BUCKET_EMPTY` |
| REDUCED_MOCK | every bucket holds at least its governed count | `BUCKET_BELOW_BLUEPRINT` |
| FULL_MOCK | reduced-mock condition **and** the section's full form is governed | `FULL_FORM_BLUEPRINT_NOT_GOVERNED` |
| REPEATABLE_FULL_MOCK | full-mock condition at 3 × depth | `BUCKET_BELOW_REPEATABLE_DEPTH` |
| CHALLENGE | ≥ 5 CHALLENGE-tier items in the family, ≥ 1 in every section | `CHALLENGE_POOL_TOO_SMALL`, `SECTION_WITHOUT_CHALLENGE_ITEM` |

Every blocker carries bucket, required, available and gap. The thresholds (1, 3, 5, 1) are StudyUs policy
(`READINESS_POLICY`), not official rules.

## What this engine does not yet check

Section 37 of the brief lists conditions for a certified full mock. Counts per bucket and full-form governance are
implemented. These are not:

- marks satisfiable per paper (the engine counts items, not marks);
- item-type and difficulty distribution inside a bucket;
- stimulus groups (a reading text and its questions as one unit);
- form assembly itself — whether one compliant form can actually be drawn without reuse. The existing
  `mock-certification.ts` and the B2 solver do this for the legacy path; V5 readiness does not call them.

`MINIMUM_READY` here means "the counts allow it", not "a form was assembled".

## Student UI

Not wired. The Student UI still derives availability from the existing health engine
(`question-bank/health.ts`). Nothing in the UI was changed and nothing is hard-coded READY by this work.

## Priority order for blueprint work

1. Govern full-length blueprints for the papers Students are expected to sit as mocks; without them, FULL_MOCK is
   structurally unreachable for IB, Cambridge, AICE and PAA.
2. Bind the PAA 865-item plan (`paa-generation-plan.ts`) to the runtime blueprint, which today holds 36 slots.
3. Attach canonical concept ids to blueprint buckets, so a generated item can carry the PRIMARY attribution that
   approval requires.
