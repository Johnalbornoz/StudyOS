# QB-R2A — Question Production OS Foundation

Branch `feat/qb-r2a-production-os`, on the integration line after QB-R1C. Contracts, a planning backlog and dry-run evaluators. No production question was ingested, no review, qualification, rights record or pool membership was created, no database was written, and Kognity was not accessed.

```
Requirement Cell -> Reference Intelligence Pack -> Author / AI Generation -> Automated Structural Validation
-> Originality / Similarity Check -> Human SME Review -> Rights Validation -> Pool Assignment -> PILOT_ELIGIBLE
```

Everything is in `src/lib/exam-core/question-bank/production/`. Every module is pure: no database import, no query, no environment read. Nothing outside that directory uses them yet.

| Stage | Module | What it is |
|---|---|---|
| Requirement Cell | `requirement-cell.ts` | the contract of one unit of demand |
| Backlog | `paa-backlog.ts`, `paa-backlog-data.ts` | the certified 865-item PAA demand as planning rows |
| Reference Intelligence Pack | `draft-package.ts` | sources and restated pedagogical facts |
| Generation | `generation-contract.ts` | request in, candidates out |
| Structural validation | `structural-validation.ts` | eleven automated checks |
| Originality | `originality-gate.ts` | three outcomes and the content of the originality record |
| Human review | `review-package.ts` | what a reviewer receives and may do |
| Rights | `rights-gate.ts` | which reuse right the evidence supports |
| Pool assignment | `pool-assignment.ts` | whether an assignment may be made |
| Projection | `pilot-projection.ts` | dry run of the twelve conditions |

## 1. Requirement cell

Fields: exam family, exam version, section, Domain and Topic (structure-node codes), PRIMARY concept and optional SUPPORTING concepts (canonical ids), Exam Skill (null until the Curriculum has one), response format, difficulty band, stimulus requirement, asset requirement, intended pool, authority (official with at least one source, or a named StudyUs policy), and the blueprint requirement it serves.

Rules: one PRIMARY concept, never also listed as SUPPORTING; a mock cell must name a blueprint requirement whose purpose matches its pool; unknown fields are refused. For PAA, `paaCellViolations` checks by code that the Topic is one of the 84, under one of the 17 Domains, in one of the 4 Sections.

The single-item draft package of QB-R1B stays as it was. It carries the same demand flattened for one item; the two contracts are not yet unified.

## 2. PAA backlog

`buildPaaBacklog()` returns 353 planning rows for **865 unique items**, rebuilt from the certified data on every call. `npx tsx scripts/operations/qb-paa-backlog.ts` prints it; the script connects to nothing.

| Pool | Items | Rows | Granularity |
|---|---|---|---|
| Practice | 183 | 61 | one row per certified concept (3 each) |
| Diagnostic | 122 | 61 | one row per concept (2 each) |
| Verification | 122 | 61 | one row per concept (2 each) |
| Reduced Mock | 88 | mock rows | Domain × response format × difficulty band |
| Full Mock 1 | 175 | mock rows | same |
| Full Mock 2 | 175 | mock rows | same |

By section: Lectura 197, Redacción 97, Matemáticas 383, Inglés 188. Each Full Mock keeps 45 / 25 / 55 / 50 and the Reduced Mock 23 / 12 / 28 / 25.

Sources: the per-concept part is the Q1-C.1 certified concept list; the mock part is the Q1-C requirement matrix (its mock rows; the per-concept rows of that file predate the 61-concept catalogue and are not used). A mock's section totals are official; the split by Domain follows the published practice test and is StudyUs policy; difficulty bands are an editorial estimate.

Zero intentional overlap: each row is in one pool, row keys are unique, and totals are of unique items. A row is not a requirement cell yet: a per-concept row lists the concept's certified Topics and a mock row the Domain's Topics; choosing the Topic (and, for a mock row, the concept) and resolving canonical ids happens when cells are made. Per-concept rows carry no difficulty band or response format; the pool follows the 30 / 50 / 20 policy as a whole. No item exists for any row.

## 3. Reference Intelligence Pack

A source has an identity (`sourceKey`), a type, how it can be read, a permitted-use class, an access status and the time it was consulted. A fact is one of thirteen kinds — curriculum fact, learning objective, concept definition, prerequisite, misconception, reasoning skill, expected difficulty, difficulty driver, appropriate context, typical task form, response-format guidance, stimulus guidance, style rule — restated by StudyUs, tied to its sources, and declared free of copied expression.

`PEDAGOGICAL_REFERENCE` (the source), content provenance (who writes the item) and reuse rights (whether it may be delivered) are separate: a pack has no provenance field and no rights field, and refuses them.

`PEDAGOGICAL_REFERENCE_SOURCE` for a future external source such as Kognity: it needs access validation (it cannot be marked as needing none); while access is not validated it can be listed, carries no consultation time and supports no fact; once validated it is reference-only. A source row has no field for question text, and the pack must declare it holds no copied protected expression.

`KOGNITY_ACCESS_VALIDATION = DEFERRED`.

## 4. Generation contract

Input: requirement cell, reference pack, generation policy (who writes: a person, or a model run a person requested; language; `copyReferenceExpression` fixed to false), desired count.

Output per candidate: stem, response format, options, answer key, rationale, PRIMARY and SUPPORTING concepts as the author intends them, difficulty band, marks, stimulus and asset specification, provenance, lineage.

Lineage decides provenance: a model's first draft is `STUDYUS_GENERATED` and stays so; the people who edited it are listed in the lineage and do not change the class. A person's own draft is `STUDYUS_AUTHORED`. No generator is implemented: this is the contract one must satisfy.

## 5. Structural validation

Eleven checks: one PRIMARY concept (the cell's), valid Domain / Topic, response format, answer-key consistency, option uniqueness (ids and normalised text), mark allocation, difficulty band, stimulus and asset requirements, supported blueprint cell (a mock cell must name a requirement of a published variant), valid pool target, provenance present and consistent with lineage.

The Domain / Topic check is the exam's own and is supplied by the caller (for PAA, `paaCellViolations`); without it the validation fails rather than assume. Every result carries `isHumanReview: false`.

Today a mock candidate cannot pass the blueprint check: no variant is published.

## 6. Originality gate

Outcomes: `PASS_LOW_SIMILARITY`, `REVIEW_STRUCTURAL_SIMILARITY`, `REJECT_TEXTUAL_SIMILARITY`.

Method: Jaccard similarity of word 3-shingles on normalised text, plus equality of the bank's template fingerprint. Defaults: 0.8 or more is a rejection; 0.5 or more, or the same template, goes to a person. The thresholds are a starting policy, not calibrated on real content.

It compares with the internal bank, batch siblings, reference material where permitted, and official or sample material where allowed. An entry whose comparison is not permitted is skipped and named as skipped. The result holds keys and a number, never text. Its `record` uses the existing schema's vocabulary: `CLEAR` accepted, `MATCH` rejected, `SIMILAR` with no disposition until a person decides. Writing the record happens at ingestion.

It is a lexical measure: it does not detect paraphrase or translated copies. That limit is for the human reviewer and for a later, stronger method.

## 7. Human review package

One object with the question, answer and rationale, Domain and Topic, the author's proposed PRIMARY / SUPPORTING concepts (marked as a proposal), response format, difficulty, provenance and lineage, the reference sources, the structural result, the originality result, the rights status and the intended pool.

Reviewer actions: approve, reject, request revision, correct attribution — recorded, when they can be, through the existing review decisions and the governed attribution writer. `reviewExecutionBlockers` returns `NO_QUALIFIED_REVIEWER` today. No screen renders the package yet.

## 8. Rights gate

Deliverable rights remain `STUDYUS_OWNED`, `LICENSED_FOR_USE`, `OFFICIALLY_AUTHORIZED`. Reading a publicly accessible source grants nothing.

Evidence for `STUDYUS_OWNED` on StudyUs content: provenance authored or generated; a citable reference to the authorship terms (the author's agreement, or the model provider's terms for ownership and commercial use of output); every source consulted only; originality passed, or a similarity accepted by a person; established rights on the stimulus and every asset. Content that adapts or reproduces a source cannot be owned: it needs a licence. Third-party content needs a licence reference, a rights holder and a permitted use.

The gate returns the record a person would write at ingestion; it writes none. Which documents count as authorship terms is a legal decision this code does not make.

## 9. Pool assignment

Assignable only after an approving review, established rights and accepted originality, to one of the six pools. An item already in another pool is refused; a stimulus-bound item is assigned through its stimulus, so a group is in one pool as a whole.

## 10. Pilot eligibility projection

`projectPilotEligibility` takes declared facts about a package and returns, for each of the twelve conditions, `SATISFIED`, `UNSATISFIED`, `BLOCKED` or `NOT_YET_APPLICABLE` with a reason. `BLOCKED` means the cause is outside the package. It is marked `isStoredVerdict: false`: the verdict is computed on the ingested version from stored facts.

What it shows today: review, reviewer and attribution are blocked (no qualified reviewer); condition 5 is blocked for Matemáticas (draft structure version); condition 12 is blocked for mock items (no published variant); condition 6 is blocked for every item (no persisted response-format requirement).

## 11. Verification

| Check | Result |
|---|---|
| TypeScript | clean |
| Unit suite | 508 files / 9,048 tests, 0 failures (38 new in `qb-r2a-production-os.test.ts`) |
| Existing certifications (governance, CURR-PAA, B2-B1, B2-B2, platform chain) | pass |
| Production build | exit 0 |

Three existing guards shaped the code: the production contracts restate the six pool names instead of importing the selection engine (a test keeps them equal), contain no exam-family branch, and name no Question Bank table.

## 12. What this phase does not give

No generator, no ingestion path, no screen. The backlog has rows, not cells: canonical concept ids are resolved when cells are made. Reviewer identities are still missing: `REAL_REVIEWER_IDENTITIES_AVAILABLE = NO`, `READY_FOR_REAL_QUALIFICATION_GRANTS = NO`.
