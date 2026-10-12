# Question Bank — offline governance work (no provider calls)

What must exist before certified items can become Student-eligible content, and where each piece stands. This is
an inventory and a design. Nothing here was implemented in the schema: the schema and migrations lock is not
held by this lane, and every decision marked OPEN is the operator's.

## 1. Full-length blueprint governance

Inventory: `docs/audits/BLUEPRINT_GOVERNANCE_INVENTORY.csv` (263 sections, one row each).

| Family | Full form governed | Reduced only | Not item-bankable | Structure only, no profile |
|---|---|---|---|---|
| ICFES / Saber 11 | 1 | 0 | 0 | 0 |
| PAA | 0 | 4 | 0 | 0 |
| PISA | 0 (no fixed form exists) | 3 | 0 | 0 |
| Cambridge 0580 | 0 | 2 | 0 | 0 |
| IB | 0 | 28 | 76 | 97 |
| AICE | 0 | 41 | 11 | 0 |

Of the 78 reduced sections, 71 record the official maximum marks of the paper and 14 record an official item
count. That split matters:

- **Count-based papers** (multiple choice: Saber, PAA, IB Paper 1A, AICE Paper 1, 9708 Papers 1 and 3) can be
  governed in the existing slot model by raising slot counts to the official item count with a documented
  distribution.
- **Marks-based papers** (IB mathematics, Cambridge 0580, 9709, structured science papers) cannot. A full form is
  "questions totalling N marks across the syllabus", not a number of items. The slot model counts positions; it
  has a `MARKS` slot dimension but the readiness engine counts items. Governing these needs a marks budget per
  section and per syllabus area, and a readiness check that sums marks.

Section completeness gaps found in the inventory:

- no section outside Saber 11 has `blueprintSpecification.status = DOCUMENTED`;
- PAA's runtime blueprint holds 36 slots while the certified Q1 requirement is 175 scored items; the 865-item
  plan in `production/paa-generation-plan.ts` is not bound to it;
- 97 IB sections are structure-only (not simulation capable): they have no objectives to govern.

OPEN: which papers Students are expected to sit as full mocks first. Governing all 78 is not needed to pilot.

## 2. Concept attribution

Approval of an item requires exactly one PRIMARY canonical concept on the item version
(`question_bank_item_concepts`, migration `20261112_1000`). Today:

- no blueprint bucket in the V2 configurations carries a concept id; buckets carry objective codes;
- all 50 items of the human calibration set therefore show "not attributed";
- only the PAA line has a certified concept catalogue (61 concepts) and a cell model that binds concept to slot.

Design, in order of preference:

1. **Attribute at the bucket.** Each bucket lists the canonical concepts it may be met by. A specification then
   carries one PRIMARY concept chosen before authoring, and the item inherits it. This is the PAA cell model
   generalised, and it makes `PRIMARY_CONCEPT_CLEAR` checkable.
2. **Supporting concepts** are proposed by the author and confirmed in review; they never count as independent
   evidence (locked earlier: only PRIMARY counts).
3. Attribution by a model after the fact is not acceptable as PRIMARY: the locked rule is that approval scope is
   never inferred from objective mapping or derived coverage.

OPEN: who owns the objective → concept catalogue for IB, Cambridge, AICE and PISA. For Saber the three objectives
are competencies, already recorded as such.

## 3. Rights model

Existing: `question_bank_content_rights` (migration `20261110_1000`), one current row per item version, stimulus
version or asset; only `STUDYUS_OWNED`, `LICENSED_FOR_USE` and `OFFICIALLY_AUTHORIZED` deliver.

For a V5 item the truthful row is `STUDYUS_OWNED`, with the generation run as its basis. What is missing is the
evidence behind that claim:

- the provider's terms for generated output, recorded once per provider and model (a rights record existed for
  the Canary run; none exists for V5);
- an originality result per item (`question_bank_originality_checks`): V5 compares against the bank and its own
  batches, and a model judge flags resemblance to published material, but nothing is compared against a corpus of
  published papers;
- a stimulus is content too: a reading passage needs its own rights row and its own originality result.

OPEN: whether a model's "does not resemble published material" is sufficient originality evidence, or a human
check is required for passages.

## 4. Batch certification — design only

The gap: the database accepts an approval only from a qualified human reviewer, item by item. The brief asks for
machine certification of the majority. These are reconciled by certifying a **batch** under a human's authority,
not by letting a pipeline approve.

| Element | Content |
|---|---|
| Certification batch | profile, tier, profile version, validator version, run id, the item versions it covers |
| Evidence | the batch's calibration gate, its validation records, the human audit sample and its result |
| Authority | a qualified human reviewer for that subject and family signs the batch after auditing the sample |
| Effect | each item version of the batch receives an approval that cites the batch and that reviewer; the existing guard still sees a qualified human |
| Revocation | a material error found later suspends the whole batch, not one item |

What this needs, none of it done: a migration (batch table, a reference from the review to its batch), the
schema lock, at least one real reviewer qualification (none exists on DEV or Stage), and the result of the human
calibration to set the audit sample size. Until the 98 % rule is met, a batch could only be certified by auditing
every item, which is ordinary human review.

OPEN: whether batch certification is acceptable at all; this reverses "approval is per item version by a
qualified reviewer" in spirit, even if the guard is technically satisfied.

## 5. Readiness calculations

Implemented and tested (`production/v5/readiness.ts`): per family and mode, with bucket, required, available and
gap. Known limits, unchanged: it counts items, not marks; it does not check item-type or difficulty distribution
within a bucket; it does not treat a stimulus and its questions as one unit; it does not assemble a form; it is
not wired to the Student UI.

Current values are those of `QUESTION_BANK_GLOBAL_READINESS.md`: every family at 0 eligible items.

## Order of work, all offline

1. Decide the first papers to govern at full length (operator).
2. Add a marks budget to the blueprint for marks-based papers, and make readiness sum marks.
3. Attach canonical concepts to buckets for those papers.
4. Record provider output terms for the V5 models.
5. Decide on batch certification after the human calibration result.
