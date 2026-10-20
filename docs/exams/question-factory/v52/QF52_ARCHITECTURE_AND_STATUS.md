# QF V5.2 — the Exam Question Bank

**Scope: standardized exam content, and nothing else.** By the product decision of 2026-10-13, StudyUs has three
independent capabilities over one curriculum, each with its own item type and its own supply:

| Capability | Item type | Supply | Owner |
|---|---|---|---|
| Learning | `LEARNING_ITEM` | Dynamic AI generation on an explicit command, quality-gated, frozen when presented | Track A (another line) |
| Internal Assessment (AD_HOC) | `INTERNAL_ASSESSMENT_ITEM` | Generated, validated and frozen before the attempt starts | Track A (another line) |
| Exam Preparation | `EXAM_BANK_ITEM` | Certified ahead of time; **never** generated at runtime | **This work (QF V5.2)** |

They share response evaluation, concept identity, difficulty concepts and the evidence infrastructure. They do not
share a supply authority. A learner's `KNOWLEDGE_STATE` and their `EXAM_READINESS(system)` stay two different
things: a Student may learn without Exam Prep, use Exam Prep with no StudyUs learning history, or do both.

Worktree `studyos-qf-step4b`, branch `feat/qf-step4b-real-content-governance`, HEAD `53abc42`, uncommitted.
Offline: no provider call, no shared database, nothing deployed.

## Who is doing what

**Track A is not in this worktree and was not executed from this session.** When this re-scope began, another
session was already implementing it in `studyos-curriculum-first` (branch `feat/curriculum-first-learning`, on
top of the certified Preview line): its tree held an in-progress merge of the AD_HOC line, a revised OE-014
(`student-runtime/question-supply-policy.ts`), and a new `src/lib/assessment-supply/` with the supply boundary
and the learning-item supply, all modified within minutes. Running a second implementation of the same track
against the same DEV database and Preview would have produced two competing lines, so this session did not touch
it. Its vocabulary is mirrored here on purpose (`LEARNING` / `INTERNAL_ASSESSMENT` / `STANDARDIZED_EXAM`,
`LEARNING_ITEM` / `INTERNAL_ASSESSMENT_ITEM` / `EXAM_BANK_ITEM`), so that the two lines merge on one set of names.

Everything reported about DEV and Preview acceptance of Learning and AD_HOC therefore belongs to that line's own
report, not to this one.

## What the re-scope changed here

| Piece | Class | What was done |
|---|---|---|
| `v52/certification-policy.ts`, `certification-engine.ts`, `object-governance.ts`, `instance-certification.ts` | KEEP_EXAM_BANK | Unchanged: they certify exam content |
| `v52/rights-provenance.ts` | KEEP_SHARED | Unchanged: a rights gate is not exam-specific |
| `v52/audit.ts` | KEEP_EXAM_BANK | Unchanged |
| `v52/inventory-recovery.ts` | KEEP_EXAM_BANK | Unchanged; Canary stays rights-blocked by its own label |
| `v52/supply-authority.ts` | REWRITTEN | Was a universal Student supply. Now the Exam Bank authority: `supplyForConcepts` (Practice / AD_HOC consumers) is gone; `supplyForExamPractice` requires a registered component and refuses any consumer that is not a standardized exam; delivery kinds `PRACTICE` / `AD_HOC` are gone; every item carries `itemType: EXAM_BANK_ITEM` |
| `v52/coverage.ts` | REWRITTEN | Demand is exam demand only: `EXAM_PRACTICE`, `REDUCED_MOCK`, `FULL_MOCK`, `EXAM_SIMULATION`, `CHALLENGE`, `BLUEPRINT_BUCKET`. Practice and AD_HOC demand units are gone. The KPI is `CERTIFIED_EXAM_DELIVERY_CAPACITY` |
| `library/` (parametric framework, constructs, catalogue) | KEEP_EXAM_BANK | Extended with four more cores |
| `renderer-envelope.ts`, `certification.ts` (Step 4B) | KEEP_EXAM_BANK | Unchanged; the recorded human approvals still hold |
| `response-evaluation.ts` (V5.1) | KEEP_SHARED | Unchanged; the three item types can share it |
| Persistence proposal | REWRITTEN | Renamed to the next free slot (intent 91); instances are `EXAM_BANK_ITEM` by constraint; coverage gaps accept exam demand kinds only |
| Step 4B design doc, sections 5–6 | OBSOLETE | Marked obsolete in place (Practice and AD_HOC reading the certified supply) |
| Earlier V5.2 success criteria `PRACTICE_GLOBAL_SUPPLY`, `AD_HOC_GLOBAL_SUPPLY` | REMOVED | Replaced by the boundary below |

The boundary is tested, not only stated: a `LEARNING` or `INTERNAL_ASSESSMENT` consumer is REFUSED by the Exam
Bank with or without inventory; an empty Exam Bank makes a standardized mock NOT_READY and says nothing about
Learning; exam eligibility takes no Student input, so a Student with no learning history is served; and no file
of the bank imports a provider client.

## Certification

Unchanged in substance. A deterministic exam item is certified by `HUMAN50_POLICY_V1` when every blocking rule
passes; no person approves the item. Objects are certified against listed conditions. `HUMAN_CERTIFIED` is used
only where a recorded approval of exactly that content exists (seven Step 4B objects). Certification grants
`PILOT_PREVIEW` only; production eligibility is 0 and needs an explicit release with out-of-sample evidence.

**Eight cores have now been written and machine-certified with no academic review**: line slope, single-draw
probability, right-triangle side, mean of a data set, and in this run percent, linear equation in one unknown,
linear system in two unknowns, rectangle area and perimeter. Per the decision of 2026-10-13 they stay
`AUTOMATED_CERTIFIED_PILOT` and are not held for approval. All of them are in the initial audit stream
(`QF52_AUDIT_SAMPLE.json`, 90 blind items, three per band per envelope). A critical defect found by audit freezes
the envelope and quarantines its instances; that path is implemented and tested.

## State of the bank

| | |
|---|---|
| Certified cores / adapters / renderer envelopes / governed blueprints | 10 / 5 / 10 / 2 |
| Exam Bank items certified in this batch | 326 (296 answer-only, 30 marked on working) |
| Raw parameter sets / distinct wordings / recognition classes | 56,142 / 56,072 / 7,863 |
| **CERTIFIED_EXAM_DELIVERY_CAPACITY** (recognition classes capped at 30 per core and band) | **822** of a 2,000 target |
| Weakest concept × band depth | 6 |

The target blocks neither Learning nor Internal Assessment.

PAA Matemáticas (blueprint class REDUCED): exam practice, exam practice by concept, the reduced mock and the
challenge mode are READY through the authority. The full mock and the exam simulation are NOT_READY and cannot be
otherwise on a REDUCED blueprint. With ten cores the reduced mock now draws its arithmetic and geometry positions
from two cores each and its algebra positions from three; data and probability still have one core each. Every
item is a numeric entry: no selected-response envelope exists, and PAA is mostly selected response.

Readiness by registered system, in execution priority (a sort order of the report, not architecture):

| System | Readiness | Governed slots | With certified supply | Gap |
|---|---|---|---|---|
| PAA | PARTIAL | 36 | 12 | 24 slots in Lectura, Redacción, Inglés: passages, so a provider |
| IB | PARTIAL | 92 | 1 | 29 for new deterministic cores; 62 need a provider. Only quadratics has an established concept link |
| Cambridge | NOT_READY | 8 (0580) | 0 | No governed adapter: 0580 has no rule profile and 9709 P1 fails on unsourced command terms |
| PISA | NOT_READY | 21 | 0 | 8 for deterministic cores; 13 need a provider |
| ICFES / Saber | NOT_READY | 50 | 0 | Every item needs a stimulus and selected response; no envelope supports either |
| AICE | NOT_READY | 112 | 0 | No governed rule profile for any component |

What stops reuse of the existing cores in IB and Cambridge is governance, not rendering: a core is placed in a
system only where that system's blueprint links its concept, and those links exist only for quadratics.

## Migration order

Enumerated from every line before choosing a slot:

| Intent | File | Line |
|---|---|---|
| 87 | `20261121_1000_student_scheduled_assessments.sql` | AD_HOC, `557707f` |
| 88 | `20261121_1100_qf51_construct_core_lineage.sql` | QF V5.1, `53abc42` |
| 89 | `20261122_1000_learner_concept_curriculum_provenance.sql` | Curriculum convergence, `9007a0a` |
| 90 | `20261122_1100_canonical_concept_reviewed_aliases.sql` | Reviewed aliases, `9007a0a` |
| **91** | `20261122_1200_qf52_exam_bank_certification_coverage.sql` | This proposal |

The earlier assumption (intent 90, prefix `20261122_1100`) collided with the reviewed-aliases migration. The
proposal was moved. Proved on a throwaway Postgres: all five in order, no object of any lost, no row inserted, 58
behavioural rules, and the invariant that detects a weaker eligibility view. Migrations 89 and 90 are one-time
files and are not required to be re-appliable.

The Track A line was still writing when this was computed. If it adds a migration, the slot is to be re-checked
before this file is moved into `database/migrations`.

## One consolidated provider proposal

Not authorised, not executed, and not requested gap by gap. `QF52_COVERAGE.json` holds it per system in priority
order: 180 slots that only a provider can fill (passages, stimuli, drawn representations), about 1,660 candidates
and about 230 USD at the yield of the recorded runs; 126 further slots can be met by deterministic cores at no
provider cost. This is the Exam Factory budget; Learning and Internal Assessment runtime generation is a
different budget and is not in the figure. Before any generation, provider terms and an originality result must
be on record, because generated material is not a deliverable rights state under the policy.

## Not done

- Exam delivery is not wired to the authority: the Exam V2 runtime is not in this worktree.
- Legacy database items were not read.
- No Admin screen was changed (the smallest integration is one read of the latest coverage snapshot).
- Nothing was committed, deployed or applied.
