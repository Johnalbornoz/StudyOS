# Q1-I2 — B2 alignment and assessment content carrier decisions

Date: 2026-10-10. Status: **decisions locked by the product owner** (Q1-I2 accepted, Q1-I2.1). Design only: nothing in this document is implemented, and no schema is authorised by it.

B0/B1 is the canonical StudyOS assessment architecture. This document states what the Q1 track (Question Bank & Exam Content Readiness) needs from it, in B's terms, and who owns each piece. Source material: `docs/audits/B0_INTEGRATED_ASSESSMENT_ARCHITECTURE_CERTIFICATION.md`, `docs/audits/B1_CANONICAL_ASSESSMENT_FOUNDATION_CERTIFICATION.md`, `Q1_I1_F_DATA_B1_INTEGRATION.md`, and the artefacts in `audits/q1-paa/`.

## Locked decisions

| Decision | Value |
|---|---|
| Stimulus owner | `QUESTION_BANK` (the reviewed exam bank) |
| Asset owner | `QUESTION_BANK` (one generic asset registry, referenced by stimuli and by items) |
| Role of B2 | consumes stimulus, group and asset facts for selection; owns no authored content or its lifecycle |
| Q1 attribution terms | `PRIMARY`, `SECONDARY`, `CONTEXT` |
| Attribution weight | `NOT_REQUIRED_FOR_B2_OR_B3`; no weight field; analytics may revisit |
| Rights | `PUBLICLY_ACCESSIBLE != REUSABLE`; `SOURCE_ACCESS` and `REUSE_RIGHTS` are separate facts; only established reuse rights make content deliverable |
| Human-written content | future provenance class `STUDYUS_AUTHORED`; AI-drafted content stays `STUDYUS_GENERATED` even after human editing and review |
| Content | planning may start; **no PAA item is ingested into the bank yet** |

## 1. Stimulus sets

A stimulus is authored, reviewed, versioned, rights-bearing content, so it lives in the reviewed bank under the same lifecycle, immutability and human-review regime as items (B0 X.9, Model B). The selector does not own authored content. The bank already carries stimuli informally: text inside item content with a `stimulus.key`, a `stimulus_fingerprint` per version, and form assembly that keeps same-stimulus items together.

B2 and B3 see a stimulus only through B1's question coverage abstraction, as a fact on each question.

Minimum contract:

| Element | Requirement |
|---|---|
| Stimulus set | stable identity, version, lifecycle state, language |
| Kind | passage, paired passage, poem, numbered text, draft paragraph, table, graph, figure, data set, composite |
| Parts | ordered; a paired passage is one set with two parts; a part is structured text or a reference to an asset |
| Questions | one set to many questions, each with an order inside the set |
| Provenance | the same vocabulary as items (section 8) |
| Rights | source access and reuse rights recorded separately; source reference |
| Review | reviewed as a unit before any of its questions can be eligible |
| Shared-stimulus fact | every question exposes the identity of its stimulus set, so `QUESTIONS_SHARE_STIMULUS` is derivable for any pair |

About 370 of the 865 required PAA items depend on a stimulus (Lectura 197, Redacción 97, English reading and paragraph revision about 76).

## 2. Assets

One generic registry, owned by the Question Bank, referenced by stimuli and by items. An asset is not a kind of stimulus: a geometry diagram on a single question is an item asset with no stimulus; a graph shared by two questions is a stimulus whose part references an asset.

- Kinds: diagram, graph, chart, image, data visualisation. Tables are structured content where possible, an image only as a fallback.
- Each asset carries its own provenance, rights, source reference, alternative text and lifecycle state.
- `exam_media_objects` is not this registry: it stores student submissions and is owned per student.

Roughly a third of the Matemáticas requirement needs a figure or graph.

## 3. Selection unit (for B2)

B2 selects units of two kinds: `ITEM` (one independent question) and `STIMULUS_GROUP` (a stimulus set with the questions that travel with it).

| Aspect | Requirement |
|---|---|
| Group integrity | a group is selected whole or as a declared subset (minimum and maximum questions); a protected form never takes a lone question out of a group |
| Counting | every quantitative constraint counts questions, not units |
| Ordering | a group's questions are contiguous and in stimulus order; sections in official order |
| Set requirements | a form can require sets by kind (Lectura: literary prose, poem, text with a graphic, paired reading) |
| Exposure | evaluated on the item and on the stimulus set |
| Pools | a group belongs to one pool as a whole |

Gap in B1 today: an official slot is per question and cannot tie slots to a shared stimulus or state a set requirement.

## 4. Question to concept attribution

| Q1 term | Meaning | B1 representation |
|---|---|---|
| `PRIMARY` (exactly one per question) | the concept the question measures | role `PRIMARY`, credit `DIRECT` |
| `SECONDARY` | needed to answer; a supporting signal only | role `SUPPORTING`, credit `CONTRIBUTORY` |
| `CONTEXT` | background needed to read or solve; no credit, no independent evidence, no contributory evidence | **not an attribution**: metadata outside coverage and evidence |

The earlier Q1 wording "SUPPORTING (context only)" is retired because it collides with B1's `SUPPORTING` role. A `CONTEXT` concept never appears in a question's concept coverage; if recorded at all it is a descriptive tag for authoring and search.

No weight field. Role is enough for selection and credit is enough for evidence; B1 forbids inventing weights.

## 5. Diagnostic independence (for B3)

Q1 policy: a Diagnostic needs two independent `PRIMARY` observations per concept. Two observations of a concept are independent only if all of these hold:

1. both name the concept as their single `PRIMARY` target;
2. they are different items (two versions of one item are the same item);
3. they are not variants of each other (different template or variant family);
4. they do not share a stimulus set, subject to section 6;
5. neither item was previously shown to the Student with its answer revealed;
6. both were answered without assistance.

In order of dependence: the same question repeated is never independent; the same variant family is not independent; the same stimulus group follows section 6; anything else is independent.

- Item independence is not occasion independence. The Q1 rule is about two independent items, which may be in one sitting. Whether mastery also needs separate occasions stays a Learning OS policy.
- B1 marks independent evidence only for the `LEARNING` family. B3 needs an independence judgement for an exam-preparation Diagnostic under the existing `DIAGNOSE` dimension. This stays consistent with B1's rule that exam evidence never sets a Learning Stage: two diagnostic observations are a diagnostic signal, not mastery.

## 6. Shared-stimulus evidence (for B3)

Recommended policy:

- same stimulus, same `PRIMARY` concept: at most one response counts as an independent observation of that concept; the others corroborate;
- same stimulus, different `PRIMARY` concepts: each may count for its own concept, with the dependence recorded;
- different stimuli: independent, subject to section 5.

Each evidence input must therefore carry the item identity, the stimulus set identity (or none), the variant family and the attempt or session. None of these is on the evidence input today.

## 7. B2 requirement package

Blueprint purposes of one exam version: `FULL`, `REDUCED`, `DIAGNOSTIC`. Practice only if B2's own model needs it.

| Blueprint | Items | Lectura | Redacción | Matemáticas | Inglés | Scored time |
|---|---:|---:|---:|---:|---:|---|
| Full PAA | 175 | 45 | 25 | 55 | 50 | 180 min (50 / 30 / 60 / 40) |
| Reduced PAA | 88 | 23 | 12 | 28 | 25 | pro-rated, about 90 min |
| Diagnostic | concept-driven | — | — | — | — | time-budgeted |

Dimensions B2 must be able to constrain: Section; Domain (17); Topic where a policy uses it; concept attribution (`PRIMARY`); Exam Skill; response format, including student-produced answers in Matemáticas; difficulty band; stimulus and set requirements; exposure; pool; item eligibility; rights eligibility.

- Every constraint is tagged `OFFICIAL` (section counts, timing, order, no calculator, formats) or `STUDYUS_POLICY` (the Domain split taken from the practice-test reference pattern, difficulty 30 / 50 / 20, reduced size).
- Full never binds to a reduced blueprint. Reduced is labelled as such, covers all 17 Domains and states its fraction.
- Diagnostic requires two independent `PRIMARY` observations per targeted concept and makes no single-item claim.

Gaps in B1's requirement schema that B2 must close: no purpose or variant; no stimulus or group construct; no pool; exposure is a single "avoid seen" flag. The numeric detail is in `audits/q1-paa/Q1C_paa_requirement_matrix.csv`.

## 8. Pools and exposure (for B2)

Six logical pools: `PRACTICE`, `DIAGNOSTIC`, `VERIFICATION`, `REDUCED_MOCK`, `FULL_MOCK_1`, `FULL_MOCK_2`. Pilot policy: zero intentional overlap.

| B2 must express | Requirement |
|---|---|
| Item eligibility | each item, and each stimulus group as a whole, is assigned to exactly one pool for the pilot; several pools only by explicit policy |
| Form eligibility | Full 1, Full 2 and Reduced 1 are fixed, frozen forms; a Student who has taken one is offered another |
| Hard exclusion | per purpose: a protected purpose excludes any item or stimulus the Student has been exposed to; it does not merely penalise it |
| What counts as exposure | delivery in any purpose, and answer reveal in result review |
| Group exposure | exposure to any question of a stimulus exposes the whole stimulus |
| Student-specific | exposure is per Student; `exam_item_usage` records delivery and its purpose but is used only as a soft cost today |
| Protected content | mock pools are never served by the practice path or by generated fallback |

## 9. Rights and provenance

Two separate facts on items, stimuli and assets:

- `SOURCE_ACCESS`: publicly accessible, private, licensed source;
- `REUSE_RIGHTS`: StudyUs-owned, licensed for use, officially authorised, unknown, prohibited.

Only StudyUs-owned, licensed-for-use or officially-authorised content is deliverable. Required B-track change: B1's eligibility rule accepts a licence of `PUBLIC` or `LICENSED` for official and licensed content (`src/lib/assessment-foundation/question-eligibility.ts`); `PUBLIC` must stop being a deliverable value. The source records marked `PUBLIC` describe access only. No data is affected today: the bank holds no official or licensed item.

`STUDYUS_AUTHORED` means written by an identified person working for StudyUs, with the author recorded. Content drafted by a model and edited by a person stays `STUDYUS_GENERATED` with a human review. Adding the value needs a migration (the bank's provenance column has a fixed list of values), so it is not implemented here.

## 10. `PILOT_ELIGIBLE` contract

A PAA item is pilot-eligible only when all of these are true:

1. lifecycle is active or calibrated, on the current version, not retired;
2. a human review exists with an approving decision;
3. the reviewer is qualified for the subject and the exam family, and is not the author;
4. it has exactly one `PRIMARY` concept, drawn from the 61 certified concepts;
5. it maps to one official Domain and one certified Topic of the current PAA version;
6. its response format is one the section allows;
7. if stimulus-bound, its stimulus set is itself reviewed and eligible, and so is any asset it uses;
8. reuse rights are established for the item, its stimulus and its assets;
9. provenance is complete: class, author or generator, and generation lineage where generated;
10. an originality and similarity check against official material is recorded;
11. it is assigned to exactly one pool;
12. it fits at least one cell of a published blueprint.

Fixtures never qualify. Conditions 3, 4, 5, 7, 8, 10 and 11 cannot be recorded in the current schema.

## 11. Dependency chain

1. **Curriculum Authority** adds the real hierarchy for the PAA structure version — Section, Domain, Topic as curriculum structure — and re-parents objectives by a governed operation (B0 X.11). Q1 creates no Domain or Topic table. The certified lists are `audits/q1-paa/Q1C1_paa_certified_topics.csv` and `Q1C1_paa_certified_concepts.csv`.
2. **B2** consumes Domains for the official blueprints. B0 keys official blueprint requirements on learning objectives, so each of the 17 Domains needs an objective a slot can reference; how a Domain is laid out as node and objective is the Curriculum Authority's design.
3. **B3** consumes item attribution and the independence rules of sections 5 and 6.
4. **B5** ("Readiness + Certification" in B0's plan) measures readiness at Topic and concept level.

Also owned by the Curriculum Authority, and deferred: a stable semantic concept code (`canonical_concepts.id` is sufficient for B2), and the merge of the three true-equivalent concept pairs (Ecuaciones lineales / Linear Equations; Técnicas de conteo / Permutations and combinations; Probabilidad / Probability and events), which must happen before B5.

## 12. What Q1 may do meanwhile

Safe in parallel: item authoring guidelines per section and Domain; the stimulus authoring specification; the reviewer rubric and reviewer qualification criteria; the rights and originality checklist; item templates per coverage cell; the per-cell production backlog from the 865-item requirement; the pool assignment plan.

Not allowed: ingestion of PAA items into the bank. Seven of the twelve eligibility conditions cannot be recorded yet, so anything ingested now could not become eligible without rework.
