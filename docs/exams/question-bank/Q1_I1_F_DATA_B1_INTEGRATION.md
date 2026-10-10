# Q1-I1 — PAA foundation data integrated with the Assessment B1 foundation

Date: 2026-10-10. Branch `integration/q1-paa-assessment-b1`, created from `foundation/assessment-b1` at `373563d`, with the Q1 F-DATA commit `1011545` cherry-picked on top.

B0/B1 is the canonical StudyOS assessment architecture. The independent "F-ARCH" track proposed during Q1 is **superseded**: nothing from it was implemented. This document records how every remaining Q1 need maps onto the B architecture.

## Result

| Check | Result |
|---|---|
| Cherry-pick of `1011545` onto B1 | applied with no conflict; no B1 file was changed by it |
| TypeScript | clean |
| Unit suite | 492 files, 8,693 tests, 0 failures — identical to the B1 final baseline |
| Repo migrations vs DEV ledger | aligned: 69 migration files + baseline = 70 ledger rows, including `20261107_1000` |
| DEV vs integrated code (read-only) | 168 canonical concepts, 224 labels, 373 published and 5 retired objective → concept mappings; every pair declared in code is published in DEV and no undeclared pair is published |

## Certified Q1 state carried by this branch

- Product: PAA revisada / Latin America / paper; effective from August 2018; end open; applicability for 2026 not verified.
- 17 official Domains and 84 Topics, as **requirements** (`audits/q1-paa/Q1C1_paa_certified_topics.csv`). They are not stored in the database.
- 61 certified concepts (`audits/q1-paa/Q1C1_paa_certified_concepts.csv`): 28 existing rows and the 33 created by F-DATA, all with Spanish and English labels.
- Bank requirement: 865 unique items = 438 (two Full forms and one Reduced form) + 61 concepts × 7 (Practice 3, Diagnostic 2, Verification 2). Eligible today: 0.

## Ownership of every former F-ARCH requirement

| Requirement | Canonical owner | Already implemented? | Target phase | Blocker / dependency |
|---|---|---|---|---|
| Stable semantic concept id | Curriculum Authority (B0 X.10: identity is `canonical_concepts.id`) | No. The 61 ids are recorded in `PAA_F_DATA_FOUNDATION.md` | Decision for the B track; not needed by B2 | Needed only for cross-environment seeding and the merges below; no column is added here |
| Merge of true-equivalent concepts (Ecuaciones lineales / Linear Equations; Técnicas de conteo / Permutations and combinations; Probabilidad / Probability and events) | Curriculum Authority | No | Governed curriculum operation after B1 | B0 MUST WAIT: changes to learner ↔ canonical links |
| Specification identity (revision, region, modality, effective period) | Exam configuration, referencing Curriculum Authority | No | With the new PAA version (B2 timeframe) | Published configs are immutable per label; region and modality have no field |
| New PAA version | Exam configuration through `applyVerticalConfig` and the curriculum bootstrap boundary | No | B2, together with the official blueprint | Depends on the Domain decision and on blueprint ownership |
| Domain hierarchy (17) | Curriculum Authority (B0 X.11: real hierarchy as curriculum structure) | No. Certified as requirements | Curriculum operation feeding B2 | No Q1-specific table is to be created |
| Topic hierarchy (84) | Curriculum Authority | No. Certified as requirements | Curriculum operation feeding B5 concept/topic readiness | Same |
| Exam Skill | Curriculum Authority (`skills`) | Partly: 22 skills exist | B2 when blueprints reference skills | Redacción operations and English error identification need skills, not concepts |
| Question → concept attribution (PRIMARY / SECONDARY / SUPPORTING) | B1 contract (`question-coverage.ts`), data in the Question Bank | Contract yes, item-level data no | Schema: B track (B0 MUST WAIT); consumption: B3 | See the semantic gap below |
| Evidence semantics | B1 planner (`evidence-attribution.ts`), consumed in B3 | Planner yes, consumption no | B3 | See the semantic gap below |
| Stimulus sets | **Unresolved** — shared assessment infrastructure | No (text inside item JSON) | To be assigned | About 370 of the 865 items are stimulus-bound; ownership must be decided before content build |
| Figures / assets | **Unresolved** — shared assessment infrastructure | No (items are text-only) | To be assigned | About a third of Matemáticas items need a figure |
| Blueprint variants; Full, Reduced, Diagnostic | B2 (Blueprint V2, `blueprint-contract.ts`) | Requirement schema yes; variants no | B2 | Cutover is B0 MUST WAIT |
| Protected pools | B2 | No | B2 | Selection and solver are B2 |
| Hard exposure exclusion | B2 (`exposure` block of the requirement) | No | B2 | Same |
| Rights / provenance on items | B1 vocabulary at the abstraction; item fields in the Question Bank | Vocabulary yes, item fields no | Schema: B track (MUST WAIT); completeness: Q1 | See the semantic gap below |
| Human-authored provenance value | B1 vocabulary | No | B track | `QuestionProvenance` has no human-authored class |
| Review authority (qualified reviewer) | Q1 (Question Bank review) | Partly: review rows, checklist for pilot-tagged items | Q1 content phase | Reviewer qualification is not modelled |
| `dev-cert.paa` / `v2.paa` shared objective codes | Exam configuration | No | With the new PAA version | Changing a published technical config |
| Retirement of `paa.red.cohesion` | Exam configuration + Curriculum Authority | No | With the new PAA version | The objective still holds a blueprint slot |
| Legacy "PAA Mathematics (Pilot)" | Exam configuration | Unchanged; frozen for new use by policy | Cleanup | One active student profile and one in-progress attempt |
| Question-bank content, item review, per-cell coverage, eligibility, `QUESTION_BANK_READY` | **Q1** | Requirement computed; content 0 eligible | Q1 content build, after B2 alignment and the stimulus decision | — |

## Semantic gaps to carry into the B phases

**Question → concept roles.** Q1 locked three roles; B1's `ConceptCoverageRole` has `PRIMARY`, `SUPPORTING` and `UNSPECIFIED`.

| Q1 role | Q1 meaning | Closest B1 form | Exact? |
|---|---|---|---|
| PRIMARY (exactly one) | counts as an independent observation | role `PRIMARY` → credit `DIRECT`; B1 already allows at most one DIRECT target | Yes |
| SECONDARY | needed to solve; supporting signal only | role `SUPPORTING` → credit `CONTRIBUTORY`, never independent | Yes in effect; the name differs |
| SUPPORTING | context only; no effect on evidence | none: B1 has no "context only" role | **No** — needs either a third role or the rule that such concepts are simply not attributed |
| analytic weight | optional, never overrides independence | none: B1 states that no weight field exists and reports weight as `UNKNOWN` | **No** — B3 decision |

Two further differences: B1 marks an observation as independent evidence only for the `LEARNING` family, so the Q1 rule "two independent PRIMARY observations per concept" for an exam Diagnostic has no carrier yet (B3); and B1 has no notion of stimulus dependence between questions.

**Rights.** Q1 separates access to a source from the right to reuse its content. B1's `question-eligibility.ts` accepts a licence in `{PUBLIC, LICENSED}` as deliverable for official or licensed content. Under the Q1 contract `PUBLIC` describes access only. This is a rule to revisit in the B track before any official or licensed content exists; it has no effect today because the bank holds none.

**Curriculum write boundary.** `scripts/operations/q1-f-data-paa-retire-mappings.ts` sets five `objective_concept_mappings` rows to RETIRED directly. It was a one-off operator step, already run on DEV. The B1 bootstrap boundary offers `ensure…` operations but no retirement; a future retirement should be a Curriculum Authority operation.

## Not done here, by rule

No item-level concept schema, no Domain or Topic tables, no change to learner ↔ canonical links, no Blueprint V2 cutover, no pools or exposure enforcement, no evidence consumption, no item rights fields, no content, no item review, no migration.
